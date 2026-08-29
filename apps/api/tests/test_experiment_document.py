"""The `experiment-v1` envelope: what it records, and what it refuses to (ADR 0025)."""

import json
import re
from typing import Any, cast
from uuid import uuid4

import pytest

from capability_lab.application.canonical_json import CanonicalSerializationError
from capability_lab.application.definition_resolution import (
    ArmResolution,
    ExperimentResolution,
    ResolvedDefinition,
)
from capability_lab.application.experiment_document import (
    EXPERIMENT_CANONICAL_SCHEMA_VERSION,
    experiment_from_document,
    fingerprint_experiment,
)
from capability_lab.domain.definitions import DefinitionId, DefinitionType
from capability_lab.domain.experiment import ComparisonDimension, ParticipantDriverType

SANDBOX_FINGERPRINT = "a" * 64


def resolved(definition_type: DefinitionType, version: int = 1) -> ResolvedDefinition:
    return ResolvedDefinition(
        definition=DefinitionId(definition_type=definition_type, id=uuid4()),
        version=version,
        content_fingerprint="b" * 64,
    )


def resolution(**overrides: object) -> ExperimentResolution:
    fields: dict[str, object] = {
        "sandbox_inputs": (resolved(DefinitionType.SCENARIO),),
        "arms": (
            ArmResolution(
                agent_configuration=resolved(DefinitionType.AGENT_CONFIGURATION),
                support_identities=(resolved(DefinitionType.SUPPORT_IDENTITY),),
            ),
        ),
        "seed": 20260828,
        "tool_contract_versions": (("orders.read_order", "1.0.0"),),
        "participant_driver": ParticipantDriverType.HUMAN,
    }
    fields.update(overrides)
    return ExperimentResolution(**fields)  # type: ignore[arg-type]


def document(**overrides: object) -> dict[str, Any]:
    fingerprint = fingerprint_experiment(
        resolution(**overrides),
        sandbox_fingerprint=SANDBOX_FINGERPRINT,
        comparison_variables=(ComparisonDimension.FRAMEWORK,),
    )
    return cast("dict[str, Any]", json.loads(fingerprint.canonical_json))


def test_the_envelope_records_the_arms_and_the_world_by_reference() -> None:
    """The shared pins live on the snapshot; copying them here could disagree with it."""
    written = document()

    assert written["canonical_schema_version"] == EXPERIMENT_CANONICAL_SCHEMA_VERSION
    assert written["sandbox_fingerprint"] == SANDBOX_FINGERPRINT
    assert "definitions" not in written
    assert len(written["arms"]) == 1
    assert written["participant_driver"] == "human"
    assert written["comparison_variables"] == ["framework"]


def test_a_round_trip_rebuilds_the_arms_and_the_driver() -> None:
    original = resolution()
    written = json.loads(
        fingerprint_experiment(
            original,
            sandbox_fingerprint=SANDBOX_FINGERPRINT,
            comparison_variables=(ComparisonDimension.FRAMEWORK,),
        ).canonical_json
    )

    rebuilt = experiment_from_document(written, sandbox_inputs=original.sandbox_inputs)

    assert rebuilt.sandbox_fingerprint == SANDBOX_FINGERPRINT
    assert rebuilt.resolution == original
    assert rebuilt.comparison_variables == (ComparisonDimension.FRAMEWORK,)


def test_the_fingerprint_moves_with_the_arm_that_runs() -> None:
    other = ArmResolution(
        agent_configuration=resolved(DefinitionType.AGENT_CONFIGURATION, version=2),
        support_identities=(),
    )

    first = fingerprint_experiment(
        resolution(),
        sandbox_fingerprint=SANDBOX_FINGERPRINT,
        comparison_variables=(),
    )
    second = fingerprint_experiment(
        resolution(arms=(other,)),
        sandbox_fingerprint=SANDBOX_FINGERPRINT,
        comparison_variables=(),
    )

    assert first.resolution_fingerprint != second.resolution_fingerprint


def test_the_fingerprint_moves_with_the_world_the_arms_run_in() -> None:
    first = fingerprint_experiment(
        resolution(), sandbox_fingerprint=SANDBOX_FINGERPRINT, comparison_variables=()
    )
    second = fingerprint_experiment(
        resolution(), sandbox_fingerprint="c" * 64, comparison_variables=()
    )

    assert first.resolution_fingerprint != second.resolution_fingerprint


def test_the_fingerprint_moves_with_what_the_arms_differ_in() -> None:
    """Two experiments over one scenario with differently-differing arms are not the same."""
    first = fingerprint_experiment(
        resolution(), sandbox_fingerprint=SANDBOX_FINGERPRINT, comparison_variables=()
    )
    second = fingerprint_experiment(
        resolution(),
        sandbox_fingerprint=SANDBOX_FINGERPRINT,
        comparison_variables=(ComparisonDimension.MODEL,),
    )

    assert first.resolution_fingerprint != second.resolution_fingerprint


def test_the_driver_is_part_of_what_explains_a_result() -> None:
    first = fingerprint_experiment(
        resolution(), sandbox_fingerprint=SANDBOX_FINGERPRINT, comparison_variables=()
    )
    second = fingerprint_experiment(
        resolution(participant_driver=ParticipantDriverType.SCRIPTED),
        sandbox_fingerprint=SANDBOX_FINGERPRINT,
        comparison_variables=(),
    )

    assert first.resolution_fingerprint != second.resolution_fingerprint


def test_a_document_of_another_schema_says_so_rather_than_failing_three_levels_down() -> None:
    written = document()
    written["canonical_schema_version"] = "experiment-v2"

    with pytest.raises(CanonicalSerializationError, match="unsupported experiment schema"):
        experiment_from_document(written, sandbox_inputs=())


def test_a_corrupted_identifier_names_its_own_path() -> None:
    written = document()
    written["arms"][0]["agent_configuration"]["definition_id"] = "not-a-uuid"

    with pytest.raises(CanonicalSerializationError, match="definition_id"):
        experiment_from_document(written, sandbox_inputs=())


def test_a_tool_version_that_is_not_a_string_names_its_own_path() -> None:
    written = document()
    written["tool_contracts"]["orders.read_order"] = 1

    with pytest.raises(
        CanonicalSerializationError, match=re.escape("tool_contracts.orders.read_order")
    ):
        experiment_from_document(written, sandbox_inputs=())
