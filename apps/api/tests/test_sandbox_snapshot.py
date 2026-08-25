import json
from typing import Any, cast
from uuid import UUID, uuid4

import pytest

from capability_lab.application.canonical_json import CanonicalSerializationError
from capability_lab.application.definition_resolution import (
    ArmResolution,
    ExperimentResolution,
    ParticipantDriverType,
    ResolvedDefinition,
)
from capability_lab.application.sandbox_snapshot import (
    SANDBOX_CANONICAL_SCHEMA_VERSION,
    SandboxBoundaryError,
    fingerprint_sandbox_snapshot,
    sandbox_snapshot_from_document,
    sandbox_state_document,
    sandbox_state_from_document,
)
from capability_lab.domain.definitions import DefinitionId, DefinitionType
from capability_lab.domain.order_fixture import FulfilmentState, FulfilmentStatus
from capability_lab.domain.sandbox import (
    SandboxInteraction,
    SandboxOrder,
    SandboxState,
)
from capability_lab.domain.shop import SupportChannel
from capability_lab.domain.ticket import TicketOrigin, TicketOriginKind
from order_factories import CUSTOMER_ID, paid_order

ORDER_ID = UUID("4b7c0c2e-1f2a-4c3d-8e5f-6a7b8c9d0e1f")
OTHER_ORDER_ID = UUID("9f8e7d6c-5b4a-4938-8271-605f4e3d2c1b")


def sandbox_state(**overrides: object) -> SandboxState:
    fields: dict[str, object] = {
        "customer_profile_id": CUSTOMER_ID,
        "interaction": SandboxInteraction(
            origin=TicketOrigin(kind=TicketOriginKind.ORDER_PAGE, order_id=ORDER_ID),
            channel=SupportChannel.EMAIL,
            ticket_reference="T-204",
        ),
        "orders": (SandboxOrder(order_id=ORDER_ID, payload=paid_order()),),
    }
    fields.update(overrides)
    return SandboxState(**fields)  # type: ignore[arg-type]


def resolved(
    definition_type: DefinitionType,
    *,
    version: int = 1,
    fingerprint: str = "a" * 64,
) -> ResolvedDefinition:
    return ResolvedDefinition(
        definition=DefinitionId(definition_type=definition_type, id=uuid4()),
        version=version,
        content_fingerprint=fingerprint,
    )


def resolution(
    sandbox_inputs: tuple[ResolvedDefinition, ...],
    *,
    seed: int = 1234,
    tool_contract_versions: tuple[tuple[str, str], ...] = (("commerce.read_order", "v1"),),
) -> ExperimentResolution:
    agent = resolved(DefinitionType.AGENT_CONFIGURATION)
    identity = resolved(DefinitionType.SUPPORT_IDENTITY)
    return ExperimentResolution(
        sandbox_inputs=sandbox_inputs,
        arms=(ArmResolution(agent_configuration=agent, support_identities=(identity,)),),
        seed=seed,
        tool_contract_versions=tool_contract_versions,
        participant_driver=ParticipantDriverType.HUMAN,
    )


def sandbox_inputs() -> tuple[ResolvedDefinition, ...]:
    return (
        resolved(DefinitionType.SHOP),
        resolved(DefinitionType.CUSTOMER_PROFILE),
        resolved(DefinitionType.TICKET),
        resolved(DefinitionType.SCENARIO, version=3),
    )


def test_fingerprint_is_deterministic_and_input_order_insensitive() -> None:
    inputs = sandbox_inputs()
    first = fingerprint_sandbox_snapshot(resolution(inputs), sandbox_state())
    second = fingerprint_sandbox_snapshot(resolution(tuple(reversed(inputs))), sandbox_state())
    assert first.canonical_json == second.canonical_json
    assert first.sandbox_fingerprint == second.sandbox_fingerprint
    assert len(first.sandbox_fingerprint) == 64


def test_envelope_carries_the_pinned_schema_version_and_the_frozen_state() -> None:
    envelope = fingerprint_sandbox_snapshot(resolution(sandbox_inputs()), sandbox_state())
    document = json.loads(envelope.canonical_json)
    assert document["canonical_schema_version"] == SANDBOX_CANONICAL_SCHEMA_VERSION
    assert document["state"]["customer_profile_id"] == str(CUSTOMER_ID)
    assert document["state"]["interaction"] == {
        "channel": "email",
        "order_id": str(ORDER_ID),
        "origin_kind": "order_page",
        "product_handle": None,
        "ticket_reference": "T-204",
    }
    assert [order["order_id"] for order in document["state"]["orders"]] == [str(ORDER_ID)]
    # The order travels as its own canonical document, not as a reduced projection of one.
    assert document["state"]["orders"][0]["document"]["reference"] == "NS-10482"
    assert document["seed"] == 1234
    assert document["tool_contracts"] == {"commerce.read_order": "v1"}
    assert [entry["definition_type"] for entry in document["definitions"]] == sorted(
        entry["definition_type"] for entry in document["definitions"]
    )


@pytest.mark.parametrize("field", ["seed", "version", "fingerprint", "tool_contract"])
def test_every_behaviorally_relevant_change_alters_the_fingerprint(field: str) -> None:
    inputs = sandbox_inputs()
    base = fingerprint_sandbox_snapshot(resolution(inputs), sandbox_state())

    if field == "seed":
        changed = resolution(inputs, seed=1235)
    elif field == "version":
        scenario = inputs[-1]
        changed = resolution(
            (
                *inputs[:-1],
                ResolvedDefinition(
                    definition=scenario.definition,
                    version=scenario.version + 1,
                    content_fingerprint=scenario.content_fingerprint,
                ),
            )
        )
    elif field == "fingerprint":
        scenario = inputs[-1]
        changed = resolution(
            (
                *inputs[:-1],
                ResolvedDefinition(
                    definition=scenario.definition,
                    version=scenario.version,
                    content_fingerprint="b" * 64,
                ),
            )
        )
    else:
        changed = resolution(inputs, tool_contract_versions=(("commerce.read_order", "v2"),))

    assert (
        fingerprint_sandbox_snapshot(changed, sandbox_state()).sandbox_fingerprint
        != base.sandbox_fingerprint
    )


def test_arm_inputs_never_enter_the_sandbox_fingerprint() -> None:
    contaminated = (*sandbox_inputs(), resolved(DefinitionType.AGENT_CONFIGURATION))
    with pytest.raises(SandboxBoundaryError, match="arm input"):
        fingerprint_sandbox_snapshot(resolution(contaminated), sandbox_state())
    with_identity = (*sandbox_inputs(), resolved(DefinitionType.SUPPORT_IDENTITY))
    with pytest.raises(SandboxBoundaryError, match="arm input"):
        fingerprint_sandbox_snapshot(resolution(with_identity), sandbox_state())


def test_adding_removing_or_reidentifying_a_definition_changes_the_fingerprint() -> None:
    inputs = sandbox_inputs()
    base = fingerprint_sandbox_snapshot(resolution(inputs), sandbox_state()).sandbox_fingerprint

    added = (*inputs, resolved(DefinitionType.OBJECTIVE_BLOCK))
    assert (
        fingerprint_sandbox_snapshot(resolution(added), sandbox_state()).sandbox_fingerprint != base
    )

    removed = inputs[:-1]
    assert (
        fingerprint_sandbox_snapshot(resolution(removed), sandbox_state()).sandbox_fingerprint
        != base
    )

    scenario = inputs[-1]
    reidentified = (
        *inputs[:-1],
        ResolvedDefinition(
            definition=DefinitionId(
                definition_type=scenario.definition.definition_type, id=uuid4()
            ),
            version=scenario.version,
            content_fingerprint=scenario.content_fingerprint,
        ),
    )
    assert (
        fingerprint_sandbox_snapshot(resolution(reidentified), sandbox_state()).sandbox_fingerprint
        != base
    )


def test_changing_arm_inputs_keeps_the_shared_sandbox_fingerprint() -> None:
    inputs = sandbox_inputs()
    one_arm = resolution(inputs)
    other_agent = resolved(DefinitionType.AGENT_CONFIGURATION, version=2)
    two_arms = ExperimentResolution(
        sandbox_inputs=inputs,
        arms=(
            *one_arm.arms,
            ArmResolution(agent_configuration=other_agent, support_identities=()),
        ),
        seed=one_arm.seed,
        tool_contract_versions=one_arm.tool_contract_versions,
        participant_driver=one_arm.participant_driver,
    )
    assert (
        fingerprint_sandbox_snapshot(one_arm, sandbox_state()).sandbox_fingerprint
        == fingerprint_sandbox_snapshot(two_arms, sandbox_state()).sandbox_fingerprint
    )


def test_state_is_part_of_the_fingerprint() -> None:
    """A snapshot is starting state, so an order that moved is a different snapshot."""
    inputs = sandbox_inputs()
    base = fingerprint_sandbox_snapshot(resolution(inputs), sandbox_state()).sandbox_fingerprint

    fulfilled = SandboxOrder(
        order_id=ORDER_ID,
        payload=paid_order(
            fulfilment=FulfilmentState(
                status=FulfilmentStatus.FULFILLED,
                method_id="standard",
                method_name="Standard delivery",
                shipped_at="2026-08-22T09:00:00.000000Z",
            )
        ),
    )
    assert (
        fingerprint_sandbox_snapshot(
            resolution(inputs), sandbox_state(orders=(fulfilled,))
        ).sandbox_fingerprint
        != base
    )

    other_origin = SandboxInteraction(
        origin=TicketOrigin(kind=TicketOriginKind.SUPPORT_ENTRY),
        channel=SupportChannel.EMAIL,
        ticket_reference="T-204",
    )
    assert (
        fingerprint_sandbox_snapshot(
            resolution(inputs), sandbox_state(interaction=other_origin)
        ).sandbox_fingerprint
        != base
    )


def test_the_state_section_round_trips() -> None:
    state = sandbox_state(
        orders=(
            SandboxOrder(order_id=ORDER_ID, payload=paid_order()),
            SandboxOrder(order_id=OTHER_ORDER_ID, payload=paid_order(reference="NS-10500")),
        )
    )
    restored = sandbox_state_from_document(sandbox_state_document(state))
    assert restored == state


def test_a_product_page_origin_travels_as_a_handle_and_nothing_more() -> None:
    state = sandbox_state(
        interaction=SandboxInteraction(
            origin=TicketOrigin(
                kind=TicketOriginKind.PRODUCT_PAGE, product_handle="alpine-shell-jacket"
            ),
            channel=SupportChannel.CHAT,
            ticket_reference="T-311",
        )
    )
    document = sandbox_state_document(state)
    assert document["interaction"] == {
        "channel": "chat",
        "order_id": None,
        "origin_kind": "product_page",
        "product_handle": "alpine-shell-jacket",
        "ticket_reference": "T-311",
    }
    assert sandbox_state_from_document(document) == state


def test_a_drifted_state_document_names_its_failing_path() -> None:
    document = sandbox_state_document(sandbox_state())
    orders = document["orders"]
    assert isinstance(orders, list)
    entry = orders[0]
    assert isinstance(entry, dict)
    entry["order_id"] = "not-a-uuid"
    with pytest.raises(CanonicalSerializationError, match=r"state.orders\[0\].order_id"):
        sandbox_state_from_document(document)


def envelope() -> dict[str, Any]:
    return json.loads(
        fingerprint_sandbox_snapshot(resolution(sandbox_inputs()), sandbox_state()).canonical_json
    )


def test_a_whole_envelope_round_trips() -> None:
    document = envelope()
    restored = sandbox_snapshot_from_document(document)

    definitions = cast("list[dict[str, Any]]", document["definitions"])

    assert restored.seed == 1234
    assert restored.state == sandbox_state()
    assert {pin.definition.definition_type.value for pin in restored.pins} == {
        entry["definition_type"] for entry in definitions
    }


def test_an_envelope_of_another_schema_version_is_refused_by_its_token() -> None:
    """A `sandbox-v1` row says so, rather than failing three levels down on a shape."""
    document = envelope()
    document["canonical_schema_version"] = "sandbox-v1"

    with pytest.raises(CanonicalSerializationError, match="unsupported sandbox snapshot schema"):
        sandbox_snapshot_from_document(document)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("definition_id", "not-a-uuid", r"definitions\[0\].definition_id"),
        ("definition_type", "invented_type", r"definitions\[0\].definition_type"),
        ("version", "1", r"definitions\[0\].version"),
        ("content_fingerprint", 7, r"definitions\[0\].content_fingerprint"),
    ],
)
def test_a_drifted_pin_is_refused_rather_than_dropped(
    field: str, value: object, message: str
) -> None:
    """The pins are the reproducibility claim: losing one silently is worse than failing."""
    document = envelope()
    cast("list[dict[str, Any]]", document["definitions"])[0][field] = value

    with pytest.raises(CanonicalSerializationError, match=message):
        sandbox_snapshot_from_document(document)
