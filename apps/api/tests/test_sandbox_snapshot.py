import json
from uuid import uuid4

import pytest

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
)
from capability_lab.domain.definitions import DefinitionId, DefinitionType


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
    first = fingerprint_sandbox_snapshot(resolution(inputs))
    second = fingerprint_sandbox_snapshot(resolution(tuple(reversed(inputs))))
    assert first.canonical_json == second.canonical_json
    assert first.sandbox_fingerprint == second.sandbox_fingerprint
    assert len(first.sandbox_fingerprint) == 64


def test_envelope_carries_the_pinned_schema_version_and_empty_state() -> None:
    document = json.loads(fingerprint_sandbox_snapshot(resolution(sandbox_inputs())).canonical_json)
    assert document["canonical_schema_version"] == SANDBOX_CANONICAL_SCHEMA_VERSION
    assert document["state"] == {}
    assert document["seed"] == 1234
    assert document["tool_contracts"] == {"commerce.read_order": "v1"}
    assert [entry["definition_type"] for entry in document["definitions"]] == sorted(
        entry["definition_type"] for entry in document["definitions"]
    )


@pytest.mark.parametrize("field", ["seed", "version", "fingerprint", "tool_contract"])
def test_every_behaviorally_relevant_change_alters_the_fingerprint(field: str) -> None:
    inputs = sandbox_inputs()
    base = fingerprint_sandbox_snapshot(resolution(inputs))

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

    assert fingerprint_sandbox_snapshot(changed).sandbox_fingerprint != base.sandbox_fingerprint


def test_arm_inputs_never_enter_the_sandbox_fingerprint() -> None:
    contaminated = (*sandbox_inputs(), resolved(DefinitionType.AGENT_CONFIGURATION))
    with pytest.raises(SandboxBoundaryError, match="arm input"):
        fingerprint_sandbox_snapshot(resolution(contaminated))
    with_identity = (*sandbox_inputs(), resolved(DefinitionType.SUPPORT_IDENTITY))
    with pytest.raises(SandboxBoundaryError, match="arm input"):
        fingerprint_sandbox_snapshot(resolution(with_identity))


def test_adding_removing_or_reidentifying_a_definition_changes_the_fingerprint() -> None:
    inputs = sandbox_inputs()
    base = fingerprint_sandbox_snapshot(resolution(inputs)).sandbox_fingerprint

    added = (*inputs, resolved(DefinitionType.OBJECTIVE_BLOCK))
    assert fingerprint_sandbox_snapshot(resolution(added)).sandbox_fingerprint != base

    removed = inputs[:-1]
    assert fingerprint_sandbox_snapshot(resolution(removed)).sandbox_fingerprint != base

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
    assert fingerprint_sandbox_snapshot(resolution(reidentified)).sandbox_fingerprint != base


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
        fingerprint_sandbox_snapshot(one_arm).sandbox_fingerprint
        == fingerprint_sandbox_snapshot(two_arms).sandbox_fingerprint
    )
