"""What every published tool owes its caller, swept across the contract set (ADR 0021/0022).

The tool suites beside this one test what each tool *answers*: the interaction carries the
thread, an unknown handle refuses, a stale proposal conflicts. This one tests what they all
owe regardless of what they answer — and tests it by iterating `SANDBOX_TOOL_CONTRACTS`
rather than a list, so the eleventh tool is held to the same promises on the day it is
declared and not on the day someone remembers to add it here.

The promises are the ones a framework adapter, a fingerprint, and Milestone 5's evidence
each depend on: a declared tool is answerable, a read cannot move an arm, the same read
twice is the same bytes, a call outside its contract refuses instead of raising, and a write
runs under an actor or does not run.
"""

from collections.abc import Generator
from dataclasses import replace
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from capability_lab.application.canonical_json import canonical_json_bytes
from capability_lab.application.sandbox_actions import ToolActor
from capability_lab.application.sandbox_tool_contracts import (
    READ_TOOL_CONTRACTS,
    SANDBOX_TOOL_CONTRACTS,
    TOOL_CONTRACT_VERSIONS,
    TOOL_RESULT_CANONICAL_SCHEMA_VERSION,
    WRITE_TOOL_CONTRACTS,
    ToolArgument,
    ToolArgumentKind,
    ToolContract,
    ToolEffect,
    ToolRefusalCode,
)
from capability_lab.application.sandbox_tools import (
    SandboxToolService,
    ToolActorRequiredError,
    ToolCall,
    ToolOutcome,
)
from capability_lab.application.sandboxes import SandboxRecord
from capability_lab.domain.shop import ShopDocumentKind
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from definition_factories import persona
from tool_call_factories import SAMPLE_ARGUMENTS, sample_call, uncovered_tools
from workspace_factories import (
    Workspace,
    build_sandboxes,
    build_tools,
    cloned_arm,
    profile_with_two_addresses,
    published_identity,
    seed_workspace,
)


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'conformance.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def workspace(session: Session) -> Workspace:
    return seed_workspace(session)


@pytest.fixture
def arm(session: Session, workspace: Workspace) -> SandboxRecord:
    return cloned_arm(session, workspace)


@pytest.fixture
def tools(session: Session) -> SandboxToolService:
    return build_tools(session)


@pytest.fixture
def actor(session: Session) -> ToolActor:
    """A support identity permitted to make the one change this milestone publishes."""
    return published_identity(session)


REQUIRED_ARGUMENTS: list[tuple[ToolContract, ToolArgument]] = [
    (contract, argument)
    for contract in SANDBOX_TOOL_CONTRACTS
    for argument in contract.arguments
    if argument.required
]


def by_name(value: object) -> str | None:
    """Read a case's id off the contract or argument it runs, rather than off its index."""
    name = getattr(value, "name", None)
    return name if isinstance(name, str) else None


# -- the sweep is the contract set ------------------------------------------


def test_every_published_tool_has_a_call_this_suite_sweeps_it_with() -> None:
    """The check that makes every parameterized test below a statement about the whole set.

    The sweeps beside it are also asserted to be non-empty. A parameterized test over a list
    that quietly became empty reports as passing, which is the one way this suite could stop
    proving anything without anybody noticing.
    """
    assert uncovered_tools() == []
    assert READ_TOOL_CONTRACTS and WRITE_TOOL_CONTRACTS and REQUIRED_ARGUMENTS


# -- what a valid call is owed ----------------------------------------------


@pytest.mark.parametrize("contract", SANDBOX_TOOL_CONTRACTS, ids=by_name)
def test_every_published_tool_answers_a_call_that_fills_its_contract(
    tools: SandboxToolService, arm: SandboxRecord, actor: ToolActor, contract: ToolContract
) -> None:
    """A declared tool nothing can answer is a published capability an agent cannot use."""
    result = tools.execute(
        arm.shop_id, arm.sandbox_id, sample_call(tools, arm, contract, actor)
    ).result

    assert result.outcome is ToolOutcome.SUCCESS, result.refusal
    assert result.data is not None
    assert result.refusal is None
    assert result.tool == contract.name
    assert result.version == contract.version == TOOL_CONTRACT_VERSIONS[contract.name]


@pytest.mark.parametrize("contract", SANDBOX_TOOL_CONTRACTS, ids=by_name)
def test_every_answer_is_a_canonical_document_of_the_published_envelope(
    tools: SandboxToolService, arm: SandboxRecord, actor: ToolActor, contract: ToolContract
) -> None:
    """Milestone 5 hashes these documents; a value outside the canonical union breaks that.

    Serializing is the assertion — `canonical_json_bytes` raises on a float, a Decimal, a
    datetime, or anything else a handler might have let through from the domain.
    """
    document = tools.execute(
        arm.shop_id, arm.sandbox_id, sample_call(tools, arm, contract, actor)
    ).result.document

    assert document["canonical_schema_version"] == TOOL_RESULT_CANONICAL_SCHEMA_VERSION
    assert canonical_json_bytes(document)


@pytest.mark.parametrize("contract", READ_TOOL_CONTRACTS, ids=by_name)
def test_every_read_tool_leaves_the_arm_exactly_where_it_stood(
    session: Session, tools: SandboxToolService, arm: SandboxRecord, contract: ToolContract
) -> None:
    """A read that moved an arm would make two arms diverge by being *looked* at."""
    execution = tools.execute(arm.shop_id, arm.sandbox_id, sample_call(tools, arm, contract))
    after = build_sandboxes(session).get_sandbox(arm.shop_id, arm.sandbox_id)

    assert execution.revision == after.revision == arm.revision
    assert after.state_fingerprint == arm.state_fingerprint
    assert after.content.state == arm.content.state


@pytest.mark.parametrize("contract", READ_TOOL_CONTRACTS, ids=by_name)
def test_every_read_tool_repeats_itself_byte_for_byte(
    tools: SandboxToolService, arm: SandboxRecord, contract: ToolContract
) -> None:
    """What `ToolEffect.READ` promises: repeating it against an unmoved arm repeats it."""
    first = tools.execute(arm.shop_id, arm.sandbox_id, sample_call(tools, arm, contract)).result
    second = tools.execute(arm.shop_id, arm.sandbox_id, sample_call(tools, arm, contract)).result

    assert canonical_json_bytes(first.document) == canonical_json_bytes(second.document)


# -- who a call runs as -----------------------------------------------------


@pytest.mark.parametrize("contract", READ_TOOL_CONTRACTS, ids=by_name)
def test_every_read_tool_answers_with_nobody_acting(
    tools: SandboxToolService, arm: SandboxRecord, contract: ToolContract
) -> None:
    """Reads are over the arm's own customer, so a read needs no authority yet (ADR 0021)."""
    result = tools.execute(
        arm.shop_id, arm.sandbox_id, sample_call(tools, arm, contract, actor=None)
    ).result

    assert result.outcome is ToolOutcome.SUCCESS, result.refusal


@pytest.mark.parametrize("contract", WRITE_TOOL_CONTRACTS, ids=by_name)
def test_no_write_tool_runs_with_nobody_acting(
    tools: SandboxToolService, arm: SandboxRecord, contract: ToolContract
) -> None:
    """An error, not a refusal: the actor is the lab's to supply, never the model's.

    The arguments are the tabulated ones with the confirmation stand-in left unresolved,
    because nothing may reach a write handler before the actor is known — including the
    proposal that would otherwise mint a real confirmation.
    """
    with pytest.raises(ToolActorRequiredError):
        tools.execute(
            arm.shop_id,
            arm.sandbox_id,
            ToolCall(
                tool=contract.name,
                version=contract.version,
                arguments=SAMPLE_ARGUMENTS[contract.name],
            ),
        )


# -- what a call outside its contract gets ----------------------------------


UNDECLARED_ARGUMENT = "depth"
"""A name no tool declares. Asserted rather than assumed, so a tool that one day *does*
declare it fails saying "this probe is no longer undeclared" instead of "the tool stopped
refusing"."""


@pytest.mark.parametrize("contract", SANDBOX_TOOL_CONTRACTS, ids=by_name)
def test_every_published_tool_refuses_an_argument_it_does_not_declare(
    tools: SandboxToolService, arm: SandboxRecord, actor: ToolActor, contract: ToolContract
) -> None:
    """In a run the arguments are model output, so an invented one is answered, not raised."""
    assert contract.argument(UNDECLARED_ARGUMENT) is None
    call = sample_call(tools, arm, contract, actor)
    result = tools.execute(
        arm.shop_id,
        arm.sandbox_id,
        replace(call, arguments={**call.arguments, UNDECLARED_ARGUMENT: "2"}),
    ).result

    assert result.outcome is ToolOutcome.REFUSED
    assert result.refusal is not None
    assert result.refusal.code is ToolRefusalCode.INVALID_ARGUMENTS
    assert UNDECLARED_ARGUMENT in result.refusal.message


@pytest.mark.parametrize("contract", WRITE_TOOL_CONTRACTS, ids=by_name)
def test_no_write_tool_moves_the_arm_on_its_way_to_refusing(
    session: Session,
    tools: SandboxToolService,
    arm: SandboxRecord,
    actor: ToolActor,
    contract: ToolContract,
) -> None:
    """The write-side dual of "a read leaves the arm where it stood".

    A handler that wrote before it finished checking would leave an arm carrying half a
    change the agent was told did not happen — and the agent's next read would describe a
    world nothing in the transcript explains. The refusal here is an undeclared argument,
    which is the last check before dispatch and so the one a premature writer would survive.

    There is no sweep for the other half — that a valid write *does* move the arm — because
    it is not true of every write by design: proposing resolves a change and confirms
    nothing (ADR 0022). What each write does when it succeeds is tested per tool, where the
    difference between the two is the point.
    """
    call = sample_call(tools, arm, contract, actor)
    result = tools.execute(
        arm.shop_id,
        arm.sandbox_id,
        replace(call, arguments={**call.arguments, UNDECLARED_ARGUMENT: "2"}),
    ).result
    after = build_sandboxes(session).get_sandbox(arm.shop_id, arm.sandbox_id)

    assert result.outcome is ToolOutcome.REFUSED
    assert after.revision == arm.revision
    assert after.state_fingerprint == arm.state_fingerprint
    assert after.content.state == arm.content.state


@pytest.mark.parametrize(("contract", "argument"), REQUIRED_ARGUMENTS, ids=by_name)
def test_every_required_argument_is_actually_required(
    tools: SandboxToolService,
    arm: SandboxRecord,
    actor: ToolActor,
    contract: ToolContract,
    argument: ToolArgument,
) -> None:
    """An argument documented as required and quietly optional is a contract that lies."""
    call = sample_call(tools, arm, contract, actor)
    result = tools.execute(
        arm.shop_id,
        arm.sandbox_id,
        replace(
            call,
            arguments={
                name: value for name, value in call.arguments.items() if name != argument.name
            },
        ),
    ).result

    assert result.outcome is ToolOutcome.REFUSED
    assert result.refusal is not None
    assert result.refusal.code is ToolRefusalCode.INVALID_ARGUMENTS
    assert argument.name in result.refusal.message


# -- what the declarations themselves must say ------------------------------


@pytest.mark.parametrize("contract", SANDBOX_TOOL_CONTRACTS, ids=by_name)
def test_every_published_tool_is_versioned_in_the_table_a_snapshot_pins(
    contract: ToolContract,
) -> None:
    """A tool outside the fingerprint would let two starting states agree while differing."""
    assert TOOL_CONTRACT_VERSIONS[contract.name] == contract.version


@pytest.mark.parametrize("contract", SANDBOX_TOOL_CONTRACTS, ids=by_name)
def test_every_argument_is_text_a_framework_adapter_can_generate_a_schema_from(
    contract: ToolContract,
) -> None:
    """The string-only argument space Milestone 3 derives its JSON Schema from.

    A nested or numeric argument would leave that derivation with nothing to say, and would
    put a value into a canonical call record that the canonical union does not admit.
    """
    for argument in contract.arguments:
        assert isinstance(argument.kind, ToolArgumentKind)
        assert argument.description
        if argument.kind is ToolArgumentKind.ENUM:
            assert argument.choices
            assert len(set(argument.choices)) == len(argument.choices)


def test_the_document_collections_a_tool_offers_are_the_shops_own() -> None:
    """A collection the shop grows and the contract does not is knowledge nothing can read."""
    offered = [
        argument.choices
        for contract in SANDBOX_TOOL_CONTRACTS
        for argument in contract.arguments
        if argument.name == "kind"
    ]

    assert offered
    assert all(choices == tuple(kind.value for kind in ShopDocumentKind) for choices in offered)


def test_the_effect_a_tool_declares_is_the_shape_it_is_run_as() -> None:
    """Reads are pure handlers and writes go through the action service; nothing is both."""
    assert {contract.name for contract in READ_TOOL_CONTRACTS}.isdisjoint(
        contract.name for contract in WRITE_TOOL_CONTRACTS
    )
    assert all(contract.effect is ToolEffect.READ for contract in READ_TOOL_CONTRACTS)
    assert all(contract.effect is ToolEffect.WRITE for contract in WRITE_TOOL_CONTRACTS)
    assert READ_TOOL_CONTRACTS + WRITE_TOOL_CONTRACTS == SANDBOX_TOOL_CONTRACTS


# -- what no tool may ever serve --------------------------------------------


def test_no_published_tool_serves_a_customer_only_value(
    session: Session, workspace: Workspace
) -> None:
    """Swept across the whole contract set, against the exact strings ADR 0014 forbids.

    A `CUSTOMER_ONLY` field is what drives the simulated customer; the support agent is
    exactly who reads a tool result, so no result — read or write — may contain one. The
    sweep is over the registry rather than a list so a projection added with a future tool
    is checked without anyone updating this test.
    """
    workspace.profiles.replace_draft(
        workspace.customer_id,
        replace(
            profile_with_two_addresses(),
            persona=persona(summary="SIMULATION-ONLY SUMMARY", traits=("SIMULATION-ONLY TRAIT",)),
        ),
    )
    arm = cloned_arm(session, workspace)
    tools = build_tools(session)
    identity = published_identity(session)
    forbidden = (
        "SIMULATION-ONLY SUMMARY",
        "SIMULATION-ONLY TRAIT",
        # The profile's hidden facts, authored by `publishable_profile`.
        "She believes the order already ships to Lyon",
        "The agent reads the shipping address back to her.",
    )

    served = b"".join(
        canonical_json_bytes(
            tools.execute(
                arm.shop_id, arm.sandbox_id, sample_call(tools, arm, contract, identity)
            ).result.document
        )
        for contract in SANDBOX_TOOL_CONTRACTS
    )

    for value in forbidden:
        assert value.encode() not in served
