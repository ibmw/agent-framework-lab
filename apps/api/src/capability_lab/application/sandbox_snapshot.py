"""The `sandbox-v2` envelope: one canonical document per snapshot, and its fingerprint.

ADR 0012 fixed the envelope and left `state` empty, noting that "materialized commerce state
sections are defined by later slices; adding or changing a section requires a new canonical
schema version". This is that slice, and this is that version bump: `sandbox-v1` carried the
pins alone, `sandbox-v2` carries the frozen state beside them.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol, cast
from uuid import UUID

from capability_lab.application.canonical_document import (
    DocumentReader,
    require_document_text,
    require_schema_version,
)
from capability_lab.application.canonical_json import (
    CanonicalSerializationError,
    CanonicalValue,
    canonical_json_bytes,
    canonical_sha256,
)
from capability_lab.application.definition_resolution import ResolvedDefinition
from capability_lab.application.order_fixture_payload import (
    order_fixture_document,
    order_fixture_from_document,
)
from capability_lab.domain.definitions import DefinitionId, DefinitionType
from capability_lab.domain.sandbox import (
    SandboxInteraction,
    SandboxOrder,
    SandboxState,
)
from capability_lab.domain.shop import SupportChannel
from capability_lab.domain.ticket import TicketOrigin, TicketOriginKind


class SandboxBoundaryError(ValueError):
    """Raised when arm-specific input would leak into the shared sandbox fingerprint."""


SANDBOX_CANONICAL_SCHEMA_VERSION = "sandbox-v2"

# Arm inputs are recorded on the experiment; both arms must share one sandbox fingerprint.
ARM_INPUT_DEFINITION_TYPES: frozenset[DefinitionType] = frozenset(
    {DefinitionType.AGENT_CONFIGURATION, DefinitionType.SUPPORT_IDENTITY}
)


class SandboxInputs(Protocol):
    """The half of a resolution that decides a sandbox fingerprint.

    A resolution of the whole experiment satisfies this too, which is the point: the arms it
    also carries must never reach the fingerprint, so the envelope reads only these three.
    """

    @property
    def sandbox_inputs(self) -> tuple[ResolvedDefinition, ...]: ...

    @property
    def seed(self) -> int: ...

    @property
    def tool_contract_versions(self) -> tuple[tuple[str, str], ...]: ...


@dataclass(frozen=True, slots=True)
class SandboxSnapshotFingerprint:
    canonical_json: bytes
    sandbox_fingerprint: str


def sandbox_state_document(state: SandboxState) -> dict[str, CanonicalValue]:
    """Render the frozen starting state as the `state` section of the envelope.

    Only what no pin covers: the order fixtures, as complete `order-fixture-v1` documents,
    and the minimal interaction reference. The catalog, the support knowledge, the ticket
    thread, and the customer profile are pinned published versions listed in `definitions`,
    so copying them here would create a second source of truth for the same bytes.
    """
    origin = state.interaction.origin
    return {
        "customer_profile_id": str(state.customer_profile_id),
        "interaction": {
            "channel": state.interaction.channel.value,
            "order_id": None if origin.order_id is None else str(origin.order_id),
            "origin_kind": origin.kind.value,
            "product_handle": origin.product_handle,
            "ticket_reference": state.interaction.ticket_reference,
        },
        "orders": [
            {"document": order_fixture_document(order.payload), "order_id": str(order.order_id)}
            for order in state.orders
        ],
    }


@dataclass(frozen=True, slots=True)
class SandboxSnapshotDocument:
    """One stored envelope, decoded: what it pinned and what it copied."""

    pins: tuple[ResolvedDefinition, ...]
    seed: int
    tool_contracts: tuple[tuple[str, str], ...]
    """The published tool versions this starting state was frozen against, sorted by name.

    Part of the fingerprint since ADR 0021, so a build that publishes a newer contract set
    freezes different starting state. Read back because a caller that reuses a recorded
    snapshot rather than freezing a new one has to be able to tell whether this build would
    still run the tools it names (ADR 0038)."""
    state: SandboxState


def sandbox_snapshot_from_document(document: object) -> SandboxSnapshotDocument:
    """Rebuild a whole stored envelope, refusing anything this codec does not implement.

    The schema token is checked first, so a `sandbox-v1` row — or any future envelope whose
    sections happen to be shape-compatible — says *that* rather than failing incidentally
    three levels down. Serving a snapshot nobody can reproduce is worse than serving none.
    """
    reader = DocumentReader(document, "sandbox snapshot")
    require_schema_version(reader, SANDBOX_CANONICAL_SCHEMA_VERSION, "sandbox snapshot")
    return SandboxSnapshotDocument(
        pins=sandbox_pins_from_document(reader),
        seed=reader.integer("seed"),
        tool_contracts=sandbox_tool_contracts_from_document(reader),
        state=sandbox_state_from_document(reader.embedded("state")),
    )


def sandbox_pins_from_document(reader: DocumentReader) -> tuple[ResolvedDefinition, ...]:
    """The exact versions this snapshot froze, read back off its own envelope.

    Decoded as strictly as the state beside it. The pins *are* the reproducibility claim, so
    a drifted entry must not be quietly dropped: a snapshot that silently lost a pin looks
    like a snapshot that never had one.
    """
    pins: list[ResolvedDefinition] = []
    for entry in reader.readers("definitions"):
        definition_type = entry.enum(DefinitionType, "definition_type")
        pins.append(
            ResolvedDefinition(
                definition=DefinitionId(
                    definition_type=definition_type,
                    id=_uuid(entry.text("definition_id"), f"{entry.path}.definition_id"),
                ),
                version=entry.integer("version"),
                content_fingerprint=entry.text("content_fingerprint"),
            )
        )
    return tuple(pins)


def sandbox_tool_contracts_from_document(
    reader: DocumentReader,
) -> tuple[tuple[str, str], ...]:
    """The tool contract set this snapshot froze, read back off its own envelope.

    Sorted by name, because the caller compares it with what this build publishes and a
    mapping's iteration order is not part of what was fingerprinted.
    """
    contracts = reader.embedded("tool_contracts")
    if not isinstance(contracts, Mapping):  # pragma: no cover - `embedded` requires a mapping
        raise CanonicalSerializationError(f"{reader.path}.tool_contracts must be an object")
    entries = cast("Mapping[str, object]", contracts)
    return tuple(
        (name, require_document_text(entries[name], f"{reader.path}.tool_contracts.{name}"))
        for name in sorted(entries)
    )


def sandbox_state_from_document(document: object) -> SandboxState:
    """Rebuild the frozen state from a stored envelope's `state` section.

    A snapshot is served from what was fingerprinted rather than from a parallel set of
    columns, so a stored document that no longer matches this schema fails loudly instead of
    being served as starting state nothing can reproduce.
    """
    reader = DocumentReader(document, "state")
    interaction = reader.reader("interaction")
    origin_order = interaction.optional_text("order_id")
    return SandboxState(
        customer_profile_id=_uuid(reader.text("customer_profile_id"), "state.customer_profile_id"),
        interaction=SandboxInteraction(
            origin=TicketOrigin(
                kind=interaction.enum(TicketOriginKind, "origin_kind"),
                product_handle=interaction.optional_text("product_handle"),
                order_id=(
                    None
                    if origin_order is None
                    else _uuid(origin_order, "state.interaction.order_id")
                ),
            ),
            channel=interaction.enum(SupportChannel, "channel"),
            ticket_reference=interaction.text("ticket_reference"),
        ),
        orders=tuple(
            SandboxOrder(
                order_id=_uuid(order.text("order_id"), f"{order.path}.order_id"),
                payload=order_fixture_from_document(order.embedded("document")),
            )
            for order in reader.readers("orders")
        ),
    )


def _uuid(value: str, path: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as error:
        raise CanonicalSerializationError(f"{path} must be a UUID") from error


def fingerprint_sandbox_snapshot(
    resolution: SandboxInputs, state: SandboxState
) -> SandboxSnapshotFingerprint:
    """Fingerprint one snapshot: the resolved pins, the seed, the tools, and the state.

    Both arms of an experiment start from this one document, so anything an arm chooses is
    refused here rather than silently averaged into a shared fingerprint.
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
            raise SandboxBoundaryError(
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
        "state": sandbox_state_document(state),
        "tool_contracts": tool_contracts,
    }
    canonical_json = canonical_json_bytes(payload)
    return SandboxSnapshotFingerprint(
        canonical_json=canonical_json,
        sandbox_fingerprint=canonical_sha256(canonical_json),
    )
