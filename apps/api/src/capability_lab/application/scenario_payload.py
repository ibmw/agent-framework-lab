"""Canonical serialization of the scenario definition payload.

`scenario-payload-v1` follows the ADR 0013 pattern: a lossless canonical document under the
ADR 0007 serialization rules, so a published version's content fingerprint is stable across
processes and a stored version round-trips back into the typed aggregate.

Two things are deliberately absent from the document, and for the same reason in both cases —
they are provenance, not content:

- **The owning shop.** A scenario's scope is carried by the draft record, and a published
  version pins the exact shop version beside the fingerprint.
- **Every pinned version.** The document names the ticket and each template by definition ID
  only. Which version a publication froze them at lives on the published version's
  references, so re-publishing an unchanged draft against newer templates produces the same
  content fingerprint with different pins — which is exactly what happened.

Bound-block order *is* content: objective order is priority and mutation order is the run
timeline. Binding order is not, so bindings are emitted sorted by parameter name (the domain
normalizes them to the same order, so the round trip is an identity).
"""

from __future__ import annotations

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
from capability_lab.domain.blocks import ObjectiveSeverity
from capability_lab.domain.scenario import (
    BoundMutation,
    BoundObjective,
    CompletionConditions,
    ContextDocument,
    ScenarioBinding,
    ScenarioPayload,
)
from capability_lab.domain.shop import ShopDocumentKind

SCENARIO_PAYLOAD_CANONICAL_SCHEMA_VERSION = "scenario-payload-v1"


def _binding_documents(bindings: tuple[ScenarioBinding, ...]) -> list[CanonicalValue]:
    return [
        {"parameter": binding.parameter, "value": binding.value}
        for binding in sorted(bindings, key=lambda binding: binding.parameter)
    ]


def _bindings_from(reader: DocumentReader) -> tuple[ScenarioBinding, ...]:
    return tuple(
        ScenarioBinding(parameter=binding.text("parameter"), value=binding.text("value"))
        for binding in reader.readers("bindings")
    )


def scenario_document(payload: ScenarioPayload) -> dict[str, CanonicalValue]:
    """Render one scenario as its canonical `scenario-payload-v1` document."""
    return {
        "canonical_schema_version": SCENARIO_PAYLOAD_CANONICAL_SCHEMA_VERSION,
        "completion": {
            "max_turns": payload.completion.max_turns,
            "statement": payload.completion.statement,
        },
        "context_documents": [
            {"document_id": document.document_id, "kind": document.kind.value}
            for document in payload.context_documents
        ],
        "hidden_facts": payload.hidden_facts,
        "mutations": [
            {
                "bindings": _binding_documents(mutation.bindings),
                "block_id": str(mutation.block_id),
                "id": mutation.id,
            }
            for mutation in payload.mutations
        ],
        "name": payload.name,
        "objectives": [
            {
                "bindings": _binding_documents(objective.bindings),
                "block_id": str(objective.block_id),
                "id": objective.id,
                "severity": objective.severity.value,
            }
            for objective in payload.objectives
        ],
        "ticket_id": str(payload.ticket_id),
    }


def scenario_canonical_json(payload: ScenarioPayload) -> bytes:
    return canonical_json_bytes(scenario_document(payload))


def scenario_content_fingerprint(payload: ScenarioPayload) -> str:
    """The SHA-256 content fingerprint a published scenario version records."""
    return canonical_sha256(scenario_canonical_json(payload))


def _uuid(value: str, path: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as cause:
        raise CanonicalSerializationError(f"{path} must be a UUID") from cause


def scenario_from_document(document: object) -> ScenarioPayload:
    """Rebuild the typed aggregate from a stored canonical document."""
    root = DocumentReader(document, "scenario payload")
    require_schema_version(root, SCENARIO_PAYLOAD_CANONICAL_SCHEMA_VERSION, "scenario payload")
    completion = root.reader("completion")
    return ScenarioPayload(
        name=root.text("name"),
        ticket_id=_uuid(root.text("ticket_id"), "scenario payload.ticket_id"),
        context_documents=tuple(
            ContextDocument(
                kind=reader.enum(ShopDocumentKind, "kind"),
                document_id=reader.text("document_id"),
            )
            for reader in root.readers("context_documents")
        ),
        objectives=tuple(
            BoundObjective(
                id=reader.text("id"),
                block_id=_uuid(reader.text("block_id"), f"{reader.path}.block_id"),
                severity=reader.enum(ObjectiveSeverity, "severity"),
                bindings=_bindings_from(reader),
            )
            for reader in root.readers("objectives")
        ),
        mutations=tuple(
            BoundMutation(
                id=reader.text("id"),
                block_id=_uuid(reader.text("block_id"), f"{reader.path}.block_id"),
                bindings=_bindings_from(reader),
            )
            for reader in root.readers("mutations")
        ),
        hidden_facts=root.text("hidden_facts"),
        completion=CompletionConditions(
            statement=completion.text("statement"),
            max_turns=completion.integer("max_turns"),
        ),
    )
