"""Canonical serialization of the ticket definition payload.

`ticket-payload-v1` follows the ADR 0013 pattern: a lossless canonical document under the
ADR 0007 serialization rules, so a published version's content fingerprint is stable across
processes and a stored version round-trips back into the typed aggregate.

The owning shop is deliberately **not** in the document. A shop is the ticket's scope, not
its content: the draft record carries it and a published version pins the exact shop version
beside the fingerprint. Two identical incidents authored in two shops therefore hash alike,
and it is the published version — not the payload — that says which catalog they belong to.
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
from capability_lab.domain.shop import SupportChannel
from capability_lab.domain.ticket import (
    SuggestedDocument,
    SuggestedDocumentKind,
    TicketAuthor,
    TicketMessage,
    TicketOrigin,
    TicketOriginKind,
    TicketPayload,
    TicketStatus,
)

TICKET_PAYLOAD_CANONICAL_SCHEMA_VERSION = "ticket-payload-v1"


def _message_document(message: TicketMessage) -> dict[str, CanonicalValue]:
    return {
        "author": message.author.value,
        "body": message.body,
        "id": message.id,
        "sent_at": message.sent_at,
    }


def ticket_document(payload: TicketPayload) -> dict[str, CanonicalValue]:
    """Render one ticket as its canonical `ticket-payload-v1` document."""
    return {
        "canonical_schema_version": TICKET_PAYLOAD_CANONICAL_SCHEMA_VERSION,
        "channel": payload.channel.value,
        "customer_profile_id": str(payload.customer_profile_id),
        "history": [_message_document(message) for message in payload.history],
        "linked_order_ids": [str(order_id) for order_id in payload.linked_order_ids],
        "origin": {
            "kind": payload.origin.kind.value,
            "order_id": (None if payload.origin.order_id is None else str(payload.origin.order_id)),
            "product_handle": payload.origin.product_handle,
        },
        "reference": payload.reference,
        "status": payload.status.value,
        "subject": payload.subject,
        "suggested_documents": [
            {"document_id": document.document_id, "kind": document.kind.value}
            for document in payload.suggested_documents
        ],
        "tags": list(payload.tags),
        # An absent trigger stays an explicit null: a draft with no first message yet is a
        # real state, and dropping the key would make it indistinguishable from a schema
        # this codec cannot read.
        "trigger": None if payload.trigger is None else _message_document(payload.trigger),
    }


def ticket_canonical_json(payload: TicketPayload) -> bytes:
    return canonical_json_bytes(ticket_document(payload))


def ticket_content_fingerprint(payload: TicketPayload) -> str:
    """The SHA-256 content fingerprint a published ticket version records."""
    return canonical_sha256(ticket_canonical_json(payload))


def _uuid(value: str, path: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as cause:
        raise CanonicalSerializationError(f"{path} must be a UUID") from cause


def _message(reader: DocumentReader) -> TicketMessage:
    return TicketMessage(
        id=reader.text("id"),
        author=reader.enum(TicketAuthor, "author"),
        body=reader.text("body"),
        sent_at=reader.text("sent_at"),
    )


def ticket_from_document(document: object) -> TicketPayload:
    """Rebuild the typed aggregate from a stored canonical document."""
    root = DocumentReader(document, "ticket payload")
    require_schema_version(root, TICKET_PAYLOAD_CANONICAL_SCHEMA_VERSION, "ticket payload")
    origin = root.reader("origin")
    origin_order = origin.optional_text("order_id")
    trigger = root.optional_reader("trigger")
    return TicketPayload(
        reference=root.text("reference"),
        subject=root.text("subject"),
        customer_profile_id=_uuid(
            root.text("customer_profile_id"), "ticket payload.customer_profile_id"
        ),
        channel=root.enum(SupportChannel, "channel"),
        status=root.enum(TicketStatus, "status"),
        origin=TicketOrigin(
            kind=origin.enum(TicketOriginKind, "kind"),
            product_handle=origin.optional_text("product_handle"),
            order_id=(
                None
                if origin_order is None
                else _uuid(origin_order, "ticket payload.origin.order_id")
            ),
        ),
        tags=root.texts("tags"),
        history=tuple(_message(reader) for reader in root.readers("history")),
        trigger=None if trigger is None else _message(trigger),
        linked_order_ids=tuple(
            _uuid(value, f"ticket payload.linked_order_ids[{index}]")
            for index, value in enumerate(root.texts("linked_order_ids"))
        ),
        suggested_documents=tuple(
            SuggestedDocument(
                kind=reader.enum(SuggestedDocumentKind, "kind"),
                document_id=reader.text("document_id"),
            )
            for reader in root.readers("suggested_documents")
        ),
    )
