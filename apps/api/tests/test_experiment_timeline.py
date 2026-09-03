"""One experiment's execution read as one normalized stream (ADR 0027)."""

from collections.abc import Generator, Mapping, Sequence
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

from agent_factories import READ_TOOL_NAMES, model_settings
from capability_lab.application.agent_capabilities import FAKE_FRAMEWORK_ID
from capability_lab.application.agent_runtime import (
    AgentAnswer,
    AgentTurnRequest,
    SandboxToolInvoker,
    SupportAgentProviderError,
    SupportAgentRuntime,
    SupportAgentRuntimeRegistry,
)
from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.experiment_timeline import (
    ExperimentTimelineService,
    TimelineCategory,
    TimelineEntry,
    TimelineEntryKind,
)
from capability_lab.application.experiments import (
    ArmSelection,
    ExperimentDetail,
    StartExperiment,
)
from capability_lab.application.model_cost import ModelUsage
from capability_lab.application.sandbox_tool_context import SandboxToolContext
from capability_lab.application.sandbox_tool_contracts import (
    ADDRESS_CHANGE_APPLY,
    ADDRESS_CHANGE_PROPOSE,
    CUSTOMER_PROFILE,
    INTERACTION_CONTEXT,
    ORDER_DETAIL,
    SUPPORT_DOCUMENT,
)
from capability_lab.application.sandbox_tools import ToolHandler, ToolOutcome
from capability_lab.domain.agent_turn import AgentTurnFailure, AgentTurnOutcome
from capability_lab.domain.blocks import MutationEffect
from capability_lab.domain.scenario import BoundMutation, ScenarioBinding
from capability_lab.infrastructure.agents.fake import FakeSupportAgentRuntime
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.participants.human import HumanParticipantDriver
from workspace_factories import (
    SEED,
    Workspace,
    author,
    build_experiments,
    build_runner,
    publish_prerequisites,
    published_configuration,
    published_identity,
    seed_workspace,
)

WRITE_TOOL_NAMES = (ADDRESS_CHANGE_APPLY, ADDRESS_CHANGE_PROPOSE)


def concurrent_fault(workspace: Workspace) -> BoundMutation:
    """The frame-4 fault: this workspace's order moves once the arm has read it."""
    return BoundMutation(
        id="order-moves-under-the-arm",
        block_id=workspace.mutation_block_id,
        bindings=(
            ScenarioBinding(parameter="entity_ref", value=f"order:{workspace.order_id}"),
            ScenarioBinding(parameter="timing", value="after_first_read"),
        ),
    )


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'timeline.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def workspace(session: Session) -> Workspace:
    return seed_workspace(session)


def control_arm(session: Session, **overrides: object) -> ArmSelection:
    fields: dict[str, object] = {
        "framework_id": FAKE_FRAMEWORK_ID,
        "model": model_settings(provider="fake", model_id="deterministic"),
        "tools": (*READ_TOOL_NAMES, *WRITE_TOOL_NAMES),
    }
    fields.update(overrides)
    return published_configuration(session, published_identity(session), **fields)


def start(
    session: Session,
    workspace: Workspace,
    *arms: ArmSelection,
    mutations: tuple[BoundMutation, ...] = (),
) -> ExperimentDetail:
    publish_prerequisites(workspace)
    scenario_id = author(workspace, mutations=mutations)
    version = workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id)
    return build_experiments(session).start(
        workspace.shop_id,
        StartExperiment(
            label="Wrong shipping address",
            scenario_id=scenario_id,
            scenario_version=version.published.version,
            seed=SEED,
            arms=arms,
        ),
    )


async def advance(
    session: Session,
    detail: ExperimentDetail,
    position: int = 0,
    runtimes: SupportAgentRuntimeRegistry | None = None,
    handlers: Mapping[str, ToolHandler] | None = None,
) -> None:
    run = detail.runs[position]
    runner = build_runner(session, runtimes, handlers)
    await runner.advance(run.shop_id, run.experiment_id, run.run_id)


def say(session: Session, detail: ExperimentDetail, message: str, *positions: int) -> None:
    """One composition, delivered to the named arms — or to every arm when none are named."""
    runs = detail.runs if not positions else tuple(detail.runs[index] for index in positions)
    build_experiments(session).deliver_turn(
        detail.record.shop_id,
        detail.record.experiment_id,
        tuple(run.run_id for run in runs),
        HumanParticipantDriver(message),
    )


def timeline(
    session: Session,
    detail: ExperimentDetail,
    runtimes: SupportAgentRuntimeRegistry | None = None,
) -> tuple[TimelineEntry, ...]:
    control = FakeSupportAgentRuntime()
    service = ExperimentTimelineService(
        build_experiments(session),
        runtimes or SupportAgentRuntimeRegistry({control.framework_id: control}),
    )
    return service.timeline(detail.record.shop_id, detail.record.experiment_id).entries


def of_kind(entries: Sequence[TimelineEntry], kind: TimelineEntryKind) -> tuple[TimelineEntry, ...]:
    return tuple(entry for entry in entries if entry.kind is kind)


def for_run(entries: Sequence[TimelineEntry], run_id: UUID) -> tuple[TimelineEntry, ...]:
    return tuple(entry for entry in entries if run_id in entry.run_ids)


# -- the shape of the stream ---------------------------------------------------


def test_the_trigger_is_one_entry_naming_every_arm_that_received_it(
    session: Session, workspace: Workspace
) -> None:
    """One composition is one entry, however many arms it reached.

    The record keeps a turn per arm because each thread has to stand alone; a timeline that
    showed the shared opening twice would read as divergence where there is none.
    """
    detail = start(session, workspace, control_arm(session), control_arm(session))

    entries = timeline(session, detail)

    assert [entry.kind for entry in entries] == [TimelineEntryKind.TRIGGER]
    opening = entries[0]
    assert opening.step == 0
    assert opening.run_ids == tuple(run.run_id for run in detail.runs)
    assert opening.categories == (TimelineCategory.CUSTOMER,)
    assert opening.ordinal is None


@pytest.mark.asyncio
async def test_an_arm_contributes_its_calls_in_order_and_then_its_reply(
    session: Session, workspace: Workspace
) -> None:
    """Tools before the answer, because that is the order it happened in."""
    detail = start(session, workspace, control_arm(session))

    await advance(session, detail)

    entries = timeline(session, detail)
    assert [entry.kind for entry in entries] == [
        TimelineEntryKind.TRIGGER,
        *[TimelineEntryKind.TOOL_CALL] * 5,
        TimelineEntryKind.AGENT_TURN,
    ]
    assert [entry.tool for entry in of_kind(entries, TimelineEntryKind.TOOL_CALL)] == [
        INTERACTION_CONTEXT,
        ORDER_DETAIL,
        CUSTOMER_PROFILE,
        ADDRESS_CHANGE_PROPOSE,
        ADDRESS_CHANGE_APPLY,
    ]
    assert {entry.step for entry in entries} == {0}


@pytest.mark.asyncio
async def test_the_arm_beside_it_contributes_nothing_until_it_is_run(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session), control_arm(session))

    await advance(session, detail, position=0)

    entries = timeline(session, detail)
    waiting = detail.runs[1].run_id
    assert [entry.kind for entry in for_run(entries, waiting)] == [TimelineEntryKind.TRIGGER]


@pytest.mark.asyncio
async def test_two_arms_answering_one_composition_share_its_step(
    session: Session, workspace: Workspace
) -> None:
    """The composition is the shared coordinate; the ordinal is one arm's own count.

    Arm A is driven twice before arm B is driven once, so the message they both receive is
    A's second turn and B's first. A timeline keyed on the ordinal would show them as two
    different moments in the incident; keyed on the composition, it shows one.
    """
    detail = start(session, workspace, control_arm(session), control_arm(session))
    say(session, detail, "Any update?", 0)
    say(session, detail, "Please use my Lyon address.")

    entries = timeline(session, detail)

    shared = of_kind(entries, TimelineEntryKind.CUSTOMER_TURN)[-1]
    assert shared.step == 2
    assert shared.run_ids == tuple(run.run_id for run in detail.runs)
    ordinals = {
        record.run_id: record.turn.ordinal
        for record in build_experiments(session)
        .get_experiment(detail.record.shop_id, detail.record.experiment_id)
        .turns
        if record.turn.turn_id == shared.composition_id
    }
    assert sorted(ordinals.values()) == [1, 2]


def test_two_linked_messages_stay_one_sequence_for_both_arms(
    session: Session, workspace: Workspace
) -> None:
    """Both arms recorded the same succession, and it is counted once, not twice."""
    detail = start(session, workspace, control_arm(session), control_arm(session))
    say(session, detail, "Any update?")
    say(session, detail, "Please use my Lyon address.")

    entries = timeline(session, detail)

    assert [entry.step for entry in entries] == [0, 1, 2]
    assert all(len(entry.run_ids) == 2 for entry in entries)


def test_a_reply_sent_to_one_arm_names_that_arm_alone(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session), control_arm(session))

    say(session, detail, "Only you, arm A.", 0)

    split = of_kind(timeline(session, detail), TimelineEntryKind.CUSTOMER_TURN)[0]
    assert split.run_ids == (detail.runs[0].run_id,)


# -- what an entry says --------------------------------------------------------


@pytest.mark.asyncio
async def test_a_write_is_a_state_change_and_a_read_is_not(
    session: Session, workspace: Workspace
) -> None:
    """The revisions the event already carries are the state change (ADR 0026)."""
    detail = start(session, workspace, control_arm(session))

    await advance(session, detail)

    calls = of_kind(timeline(session, detail), TimelineEntryKind.TOOL_CALL)
    moved = [entry for entry in calls if TimelineCategory.STATE in entry.categories]
    assert [entry.tool for entry in moved] == [ADDRESS_CHANGE_APPLY]
    applied = moved[0]
    assert applied.revision_after == (applied.revision_before or 0) + 1
    read = next(entry for entry in calls if entry.tool == ORDER_DETAIL)
    assert read.revision_before == read.revision_after
    assert read.categories == (TimelineCategory.TOOL,)


@pytest.mark.asyncio
async def test_a_refused_call_is_a_refusal_and_never_an_error(
    session: Session, workspace: Workspace
) -> None:
    """ADR 0021 made them different things; collapsing them here would undo that.

    An agent correctly told no has to be distinguishable from a lab that broke, or every
    comparison counting "errors" would count the world answering as a fault.
    """
    detail = start(session, workspace, control_arm(session))

    await advance(session, detail, runtimes=_registry(_CallingRuntime(SUPPORT_DOCUMENT)))

    call = of_kind(timeline(session, detail), TimelineEntryKind.TOOL_CALL)[0]
    assert call.tool_outcome is ToolOutcome.REFUSED
    assert TimelineCategory.REFUSAL in call.categories
    assert TimelineCategory.ERROR not in call.categories


@pytest.mark.asyncio
async def test_a_tool_that_broke_is_an_error_and_never_a_refusal(
    session: Session, workspace: Workspace
) -> None:
    """The other half of the same distinction: this one *is* the lab's fault (ADR 0021)."""
    detail = start(session, workspace, control_arm(session))

    await advance(
        session,
        detail,
        runtimes=_registry(_CallingRuntime(INTERACTION_CONTEXT)),
        handlers={INTERACTION_CONTEXT: _broken_handler},
    )

    call = of_kind(timeline(session, detail), TimelineEntryKind.TOOL_CALL)[0]
    assert call.tool_outcome is ToolOutcome.FAILED
    assert TimelineCategory.ERROR in call.categories
    assert TimelineCategory.REFUSAL not in call.categories


@pytest.mark.asyncio
async def test_a_failed_attempt_is_a_model_event_and_an_error(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))

    await advance(session, detail, runtimes=_registry(_FailingRuntime()))
    await advance(session, detail)

    attempts = of_kind(timeline(session, detail), TimelineEntryKind.AGENT_TURN)
    assert [entry.attempt for entry in attempts] == [1, 2]
    assert attempts[0].turn_outcome is AgentTurnOutcome.FAILED
    assert attempts[0].failure is AgentTurnFailure.MODEL_PROVIDER
    assert attempts[0].categories == (TimelineCategory.MODEL, TimelineCategory.ERROR)
    assert attempts[1].categories == (TimelineCategory.MODEL,)


@pytest.mark.asyncio
async def test_an_entry_carries_no_word_anyone_said(session: Session, workspace: Workspace) -> None:
    """The thread serves what was said; this stream serves what happened.

    Asserted on the projection rather than trusted to review, because the one surface built
    to be filtered, counted, and later handed to an evaluation is the last place synthetic
    customer content should reappear.
    """
    detail = start(session, workspace, control_arm(session))
    say(session, detail, "Please use my Lyon address.")
    await advance(session, detail)

    # Words only content carries: a tool's own name is a published contract, not something
    # anyone said.
    said = ("Lyon", "NS-10482", "Please use")
    for entry in timeline(session, detail):
        rendered = str(entry)
        assert not any(word in rendered for word in said), entry.kind


# -- the scenario's own faults -------------------------------------------------


@pytest.mark.asyncio
async def test_a_fault_sits_between_the_calls_it_fired_between(
    session: Session, workspace: Workspace
) -> None:
    """Placed by the calls the attempt had made, so "the world moved here" is readable."""
    detail = start(
        session, workspace, control_arm(session), mutations=(concurrent_fault(workspace),)
    )

    await advance(session, detail)

    entries = timeline(session, detail)
    assert [entry.kind for entry in entries] == [
        TimelineEntryKind.TRIGGER,
        *[TimelineEntryKind.TOOL_CALL] * 2,
        TimelineEntryKind.MUTATION,
        *[TimelineEntryKind.TOOL_CALL] * 3,
        TimelineEntryKind.AGENT_TURN,
    ]
    assert entries[2].tool == ORDER_DETAIL
    assert entries[4].tool == CUSTOMER_PROFILE


@pytest.mark.asyncio
async def test_a_fault_is_a_state_change_and_neither_a_tool_call_nor_an_error(
    session: Session, workspace: Workspace
) -> None:
    """Nothing selected it, and the incident working as authored is not something breaking."""
    detail = start(
        session, workspace, control_arm(session), mutations=(concurrent_fault(workspace),)
    )

    await advance(session, detail)

    fired = of_kind(timeline(session, detail), TimelineEntryKind.MUTATION)[0]
    assert fired.categories == (TimelineCategory.STATE,)
    assert fired.mutation == "order-moves-under-the-arm"
    assert fired.mutation_effect is MutationEffect.ENTITY_MUTATION
    assert fired.tool is None
    assert (fired.revision_before, fired.revision_after) == (0, 1)
    assert fired.run_ids == (detail.runs[0].run_id,)


@pytest.mark.asyncio
async def test_a_fault_names_the_project_owned_code_that_performed_it(
    session: Session, workspace: Workspace
) -> None:
    """Resolved from the applier table that ran, never from a map somebody keeps by hand."""
    detail = start(
        session, workspace, control_arm(session), mutations=(concurrent_fault(workspace),)
    )

    await advance(session, detail)

    fired = of_kind(timeline(session, detail), TimelineEntryKind.MUTATION)[0]
    assert fired.source is not None
    assert fired.source.path == "capability_lab/domain/mutation.py"
    assert fired.source.symbol == "advance_fulfilment"


# -- where the code that ran it lives ------------------------------------------


@pytest.mark.asyncio
async def test_every_call_names_the_project_owned_handler_that_answered_it(
    session: Session, workspace: Workspace
) -> None:
    """Resolved from the tool registry, never from a map somebody keeps by hand."""
    detail = start(session, workspace, control_arm(session))

    await advance(session, detail)

    located = {
        entry.tool: entry.source
        for entry in of_kind(timeline(session, detail), TimelineEntryKind.TOOL_CALL)
    }
    order = located[ORDER_DETAIL]
    assert order is not None
    assert order.path == "capability_lab/application/sandbox_tools.py"
    assert order.symbol == "_read_order"
    assert order.line > 0
    applied = located[ADDRESS_CHANGE_APPLY]
    assert applied is not None
    assert applied.path == "capability_lab/application/sandbox_actions.py"
    assert applied.symbol == "SandboxActionService._apply"


@pytest.mark.asyncio
async def test_an_attempt_names_the_adapter_that_produced_it(
    session: Session, workspace: Workspace
) -> None:
    """The project-owned glue code, which is the half of a framework the lab owns."""
    detail = start(session, workspace, control_arm(session))

    await advance(session, detail)

    attempt = of_kind(timeline(session, detail), TimelineEntryKind.AGENT_TURN)[0]
    assert attempt.source is not None
    assert attempt.source.path.startswith("capability_lab/infrastructure/agents/")
    assert attempt.source.symbol.endswith(".answer")


@pytest.mark.asyncio
async def test_an_arm_this_process_cannot_run_keeps_its_stream_and_loses_its_location(
    session: Session, workspace: Workspace
) -> None:
    """ "Where available" is a real answer: the rest of the timeline is unaffected.

    A historical experiment read on a machine with no provider configured still shows every
    call it made; only the one thing that machine genuinely cannot resolve is absent.
    """
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)

    entries = timeline(session, detail, runtimes=SupportAgentRuntimeRegistry({}))

    attempt = of_kind(entries, TimelineEntryKind.AGENT_TURN)[0]
    assert attempt.source is None
    assert all(entry.source is not None for entry in of_kind(entries, TimelineEntryKind.TOOL_CALL))


def test_a_shop_that_holds_no_such_experiment_is_not_answered_with_a_timeline(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))
    control = FakeSupportAgentRuntime()
    service = ExperimentTimelineService(
        build_experiments(session),
        SupportAgentRuntimeRegistry({control.framework_id: control}),
    )

    with pytest.raises(Exception, match="is not in shop"):
        service.timeline(detail.record.shop_id, uuid4())


# -- stand-in runtimes ---------------------------------------------------------


def _registry(runtime: SupportAgentRuntime) -> SupportAgentRuntimeRegistry:
    return SupportAgentRuntimeRegistry({runtime.framework_id: runtime})


class _StubRuntime(SupportAgentRuntime):
    @property
    def framework_id(self) -> str:
        return FAKE_FRAMEWORK_ID


class _CallingRuntime(_StubRuntime):
    """Calls one named tool with nothing filled in, so the tool declines."""

    def __init__(self, tool: str) -> None:
        self._tool = tool

    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> AgentAnswer:
        tools.invoke(self._tool, {})
        return AgentAnswer(body="Noted.", usage=ModelUsage.none())


def _broken_handler(
    context: SandboxToolContext, arguments: Mapping[str, str]
) -> dict[str, CanonicalValue]:
    """A handler with a bug in it, which is what a failed tool result reports."""
    del context, arguments
    raise ZeroDivisionError("a handler bug nobody classified")


class _FailingRuntime(_StubRuntime):
    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> AgentAnswer:
        raise SupportAgentProviderError("the provider rejected the request")
