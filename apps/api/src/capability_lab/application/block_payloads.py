"""Canonical serialization of the objective- and mutation-block definition payloads.

`objective-block-payload-v1` and `mutation-block-payload-v1` follow the ADR 0013 pattern: a
lossless canonical document under the ADR 0007 serialization rules, so a published version's
content fingerprint is stable across processes and a stored version round-trips back into the
typed aggregate.

A scenario pins the exact template version it composed, so these fingerprints are what makes
a historical experiment explainable: change a parameter and the next publication is a new
version, while every scenario that pinned the old one keeps the template it was built on.
"""

from __future__ import annotations

from capability_lab.application.canonical_document import (
    DocumentReader,
    require_schema_version,
)
from capability_lab.application.canonical_json import (
    CanonicalValue,
    canonical_json_bytes,
    canonical_sha256,
)
from capability_lab.domain.blocks import (
    BlockParameter,
    BlockParameterKind,
    MutationBlockPayload,
    MutationEffect,
    ObjectiveAssessment,
    ObjectiveBlockPayload,
    ObjectiveEvidence,
)

OBJECTIVE_BLOCK_PAYLOAD_CANONICAL_SCHEMA_VERSION = "objective-block-payload-v1"
MUTATION_BLOCK_PAYLOAD_CANONICAL_SCHEMA_VERSION = "mutation-block-payload-v1"


def _parameter_documents(
    parameters: tuple[BlockParameter, ...],
) -> list[CanonicalValue]:
    """Parameters keep their authored order: it is the order the editor shows and binds in."""
    return [
        {
            # An absent default is an explicit null rather than a missing key: "this
            # parameter has no default" is authored state a scenario reads, not an omission.
            "default": parameter.default,
            "description": parameter.description,
            "kind": parameter.kind.value,
            "name": parameter.name,
            "required": parameter.required,
        }
        for parameter in parameters
    ]


def _parameters_from(root: DocumentReader) -> tuple[BlockParameter, ...]:
    return tuple(
        BlockParameter(
            name=parameter.text("name"),
            kind=parameter.enum(BlockParameterKind, "kind"),
            description=parameter.text("description"),
            required=parameter.boolean("required"),
            default=parameter.optional_text("default"),
        )
        for parameter in root.readers("parameters")
    )


def objective_block_document(payload: ObjectiveBlockPayload) -> dict[str, CanonicalValue]:
    """Render one objective block as its canonical `objective-block-payload-v1` document."""
    return {
        "assessment": payload.assessment.value,
        "canonical_schema_version": OBJECTIVE_BLOCK_PAYLOAD_CANONICAL_SCHEMA_VERSION,
        "description": payload.description,
        "evidence": payload.evidence.value,
        "name": payload.name,
        "parameters": _parameter_documents(payload.parameters),
        "statement": payload.statement,
    }


def objective_block_canonical_json(payload: ObjectiveBlockPayload) -> bytes:
    return canonical_json_bytes(objective_block_document(payload))


def objective_block_content_fingerprint(payload: ObjectiveBlockPayload) -> str:
    """The SHA-256 content fingerprint a published objective-block version records."""
    return canonical_sha256(objective_block_canonical_json(payload))


def objective_block_from_document(document: object) -> ObjectiveBlockPayload:
    """Rebuild the typed aggregate from a stored canonical document."""
    root = DocumentReader(document, "objective block payload")
    require_schema_version(
        root, OBJECTIVE_BLOCK_PAYLOAD_CANONICAL_SCHEMA_VERSION, "objective block payload"
    )
    return ObjectiveBlockPayload(
        name=root.text("name"),
        statement=root.text("statement"),
        description=root.text("description"),
        assessment=root.enum(ObjectiveAssessment, "assessment"),
        evidence=root.enum(ObjectiveEvidence, "evidence"),
        parameters=_parameters_from(root),
    )


def mutation_block_document(payload: MutationBlockPayload) -> dict[str, CanonicalValue]:
    """Render one mutation block as its canonical `mutation-block-payload-v1` document."""
    return {
        "canonical_schema_version": MUTATION_BLOCK_PAYLOAD_CANONICAL_SCHEMA_VERSION,
        "description": payload.description,
        "effect": payload.effect.value,
        "name": payload.name,
        "parameters": _parameter_documents(payload.parameters),
        "statement": payload.statement,
    }


def mutation_block_canonical_json(payload: MutationBlockPayload) -> bytes:
    return canonical_json_bytes(mutation_block_document(payload))


def mutation_block_content_fingerprint(payload: MutationBlockPayload) -> str:
    """The SHA-256 content fingerprint a published mutation-block version records."""
    return canonical_sha256(mutation_block_canonical_json(payload))


def mutation_block_from_document(document: object) -> MutationBlockPayload:
    """Rebuild the typed aggregate from a stored canonical document."""
    root = DocumentReader(document, "mutation block payload")
    require_schema_version(
        root, MUTATION_BLOCK_PAYLOAD_CANONICAL_SCHEMA_VERSION, "mutation block payload"
    )
    return MutationBlockPayload(
        name=root.text("name"),
        statement=root.text("statement"),
        description=root.text("description"),
        effect=root.enum(MutationEffect, "effect"),
        parameters=_parameters_from(root),
    )
