"""The `experiment-v1` envelope: every input that explains one experiment, in one document.

A snapshot already fingerprints what both arms *start from* (ADR 0019), and it deliberately
refuses arm inputs: an agent configuration is a per-arm choice, and letting it into the
shared fingerprint would make two arms of one comparison two different starting states. This
envelope is the other half — the arm inputs, the participant driver, and the snapshot the
arms were taken from, recorded together so a historical result can be explained without
reassembling it from five tables.

It carries a fingerprint of its own for the same reason a snapshot does: an experiment's
inputs are a claim, and a claim that cannot be recognized again is a description. The two
fingerprints answer different questions and are both kept — `sandbox_fingerprint` says which
world this ran in, `resolution_fingerprint` says which inputs ran in it.

What is deliberately **not** here: anything a run produced. Turns, tool calls, and evidence
are appended as a run proceeds, and a document that mixed them with the inputs would change
its fingerprint every time the operator typed a sentence.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import cast
from uuid import UUID

from capability_lab.application.canonical_document import (
    DocumentReader,
    require_schema_version,
)
from capability_lab.application.canonical_json import (
    CanonicalSerializationError,
    CanonicalValue,
    canonical_json_bytes,
    canonical_sha256,
)
from capability_lab.application.definition_resolution import (
    ArmResolution,
    ExperimentResolution,
    ResolvedDefinition,
)
from capability_lab.domain.definitions import DefinitionId, DefinitionType
from capability_lab.domain.experiment import ComparisonDimension, ParticipantDriverType

__all__ = [
    "EXPERIMENT_CANONICAL_SCHEMA_VERSION",
    "ExperimentDocument",
    "ExperimentFingerprint",
    "experiment_from_document",
    "fingerprint_experiment",
]

EXPERIMENT_CANONICAL_SCHEMA_VERSION = "experiment-v1"


@dataclass(frozen=True, slots=True)
class ExperimentFingerprint:
    canonical_json: bytes
    resolution_fingerprint: str


@dataclass(frozen=True, slots=True)
class ExperimentDocument:
    """One stored envelope, decoded: the world, the arms, and who drove them."""

    sandbox_fingerprint: str
    resolution: ExperimentResolution
    comparison_variables: tuple[ComparisonDimension, ...]


def fingerprint_experiment(
    resolution: ExperimentResolution,
    *,
    sandbox_fingerprint: str,
    comparison_variables: tuple[ComparisonDimension, ...],
) -> ExperimentFingerprint:
    """Render and hash the complete input set of one experiment.

    The sandbox half is recorded by reference — its fingerprint — rather than copied. The
    snapshot already holds those pins and is immutable, so restating them here would be a
    second source of truth for bytes that cannot change anyway.

    `comparison_variables` is the dimensions along which the arms differ. It is derived from
    the configurations rather than authored, and it is inside the fingerprint because it is
    a property of exactly this pair of arms: two experiments over the same scenario with
    differently-differing arms are not the same experiment.
    """
    arms: list[CanonicalValue] = [
        {
            "agent_configuration": _definition_document(arm.agent_configuration),
            "support_identities": [_definition_document(entry) for entry in arm.support_identities],
        }
        for arm in resolution.arms
    ]
    payload: dict[str, CanonicalValue] = {
        "arms": arms,
        "canonical_schema_version": EXPERIMENT_CANONICAL_SCHEMA_VERSION,
        "comparison_variables": [dimension.value for dimension in comparison_variables],
        "participant_driver": resolution.participant_driver.value,
        "sandbox_fingerprint": sandbox_fingerprint,
        "seed": resolution.seed,
        "tool_contracts": {name: version for name, version in resolution.tool_contract_versions},
    }
    canonical_json = canonical_json_bytes(payload)
    return ExperimentFingerprint(
        canonical_json=canonical_json,
        resolution_fingerprint=canonical_sha256(canonical_json),
    )


def experiment_from_document(
    document: object, *, sandbox_inputs: tuple[ResolvedDefinition, ...]
) -> ExperimentDocument:
    """Rebuild a stored envelope, checking its schema token first.

    `sandbox_inputs` is supplied by the caller because the envelope records the shared half
    by fingerprint alone: the pins live on the snapshot, which is the only place they can be
    read from without risking a copy that disagrees with it.
    """
    reader = DocumentReader(document, "experiment")
    require_schema_version(reader, EXPERIMENT_CANONICAL_SCHEMA_VERSION, "experiment")
    arms: list[ArmResolution] = []
    for arm in reader.readers("arms"):
        arms.append(
            ArmResolution(
                agent_configuration=_definition_from_document(
                    arm.reader("agent_configuration"),
                ),
                support_identities=tuple(
                    _definition_from_document(entry) for entry in arm.readers("support_identities")
                ),
            )
        )
    return ExperimentDocument(
        sandbox_fingerprint=reader.text("sandbox_fingerprint"),
        resolution=ExperimentResolution(
            sandbox_inputs=sandbox_inputs,
            arms=tuple(arms),
            seed=reader.integer("seed"),
            tool_contract_versions=_tool_contracts(reader),
            participant_driver=reader.enum(ParticipantDriverType, "participant_driver"),
        ),
        comparison_variables=tuple(reader.enums(ComparisonDimension, "comparison_variables")),
    )


def _tool_contracts(reader: DocumentReader) -> tuple[tuple[str, str], ...]:
    """The tool set this experiment ran against, read back as name-to-version pairs.

    An open mapping rather than a declared list of keys, because the published tool set
    grows: a document frozen before a tool existed must still decode after it is declared,
    and a document naming a tool this build no longer publishes must still say so.
    """
    document = reader.embedded("tool_contracts")
    entries: list[tuple[str, str]] = []
    for name, version in cast("Mapping[str, object]", document).items():
        if not isinstance(version, str):
            raise CanonicalSerializationError(f"experiment.tool_contracts.{name} must be a string")
        entries.append((name, version))
    return tuple(sorted(entries))


def _definition_document(entry: ResolvedDefinition) -> dict[str, CanonicalValue]:
    return {
        "content_fingerprint": entry.content_fingerprint,
        "definition_id": str(entry.definition.id),
        "definition_type": entry.definition.definition_type.value,
        "version": entry.version,
    }


def _definition_from_document(reader: DocumentReader) -> ResolvedDefinition:
    return ResolvedDefinition(
        definition=DefinitionId(
            definition_type=reader.enum(DefinitionType, "definition_type"),
            id=_uuid(reader.text("definition_id"), f"{reader.path}.definition_id"),
        ),
        version=reader.integer("version"),
        content_fingerprint=reader.text("content_fingerprint"),
    )


def _uuid(value: str, path: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as error:
        raise CanonicalSerializationError(f"{path} must be a UUID") from error
