from __future__ import annotations

from dataclasses import dataclass

from capability_lab.application.canonical_json import (
    CanonicalSerializationError,
    CanonicalValue,
    canonical_json_bytes,
    canonical_sha256,
)
from capability_lab.application.definition_resolution import ExperimentResolution
from capability_lab.domain.definitions import DefinitionType

SANDBOX_CANONICAL_SCHEMA_VERSION = "sandbox-v1"

# Arm inputs are recorded on the experiment; both arms must share one sandbox fingerprint.
ARM_INPUT_DEFINITION_TYPES: frozenset[DefinitionType] = frozenset(
    {DefinitionType.AGENT_CONFIGURATION, DefinitionType.SUPPORT_IDENTITY}
)


@dataclass(frozen=True, slots=True)
class SandboxSnapshotFingerprint:
    canonical_json: bytes
    sandbox_fingerprint: str


def fingerprint_sandbox_snapshot(
    resolution: ExperimentResolution,
) -> SandboxSnapshotFingerprint:
    """Fingerprint the shared starting state identified by an experiment resolution.

    The `sandbox-v1` envelope carries the resolved sandbox definition versions, the seed,
    the tool-contract versions, and an empty `state` section map. Materialized commerce
    state sections are defined by later slices; adding or changing a section requires a
    new canonical schema version.
    """
    definitions: list[CanonicalValue] = []
    for entry in sorted(
        resolution.sandbox_inputs,
        key=lambda candidate: (
            candidate.definition.definition_type.value,
            str(candidate.definition.id),
            candidate.version,
        ),
    ):
        if entry.definition.definition_type in ARM_INPUT_DEFINITION_TYPES:
            raise CanonicalSerializationError(
                f"{entry.definition.definition_type} is an arm input and cannot enter "
                "the sandbox fingerprint"
            )
        definitions.append(
            {
                "content_fingerprint": entry.content_fingerprint,
                "definition_id": str(entry.definition.id),
                "definition_type": entry.definition.definition_type.value,
                "version": entry.version,
            }
        )

    tool_contracts: dict[str, CanonicalValue] = {
        name: version for name, version in resolution.tool_contract_versions
    }
    payload: dict[str, CanonicalValue] = {
        "canonical_schema_version": SANDBOX_CANONICAL_SCHEMA_VERSION,
        "definitions": definitions,
        "seed": resolution.seed,
        "state": {},
        "tool_contracts": tool_contracts,
    }
    canonical_json = canonical_json_bytes(payload)
    return SandboxSnapshotFingerprint(
        canonical_json=canonical_json,
        sandbox_fingerprint=canonical_sha256(canonical_json),
    )
