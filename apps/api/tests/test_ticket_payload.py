"""Canonical serialization of a ticket definition payload.

A published ticket version records this document's fingerprint, and every arm of an
experiment receives the trigger it holds, so it obeys the ADR 0007 rules: one spelling per
ticket, a fingerprint that moves for every behaviourally relevant edit, and a loud failure
naming the path of a drifted document.
"""

import pytest

from capability_lab.application.canonical_json import CanonicalSerializationError
from capability_lab.application.ticket_payload import (
    TICKET_PAYLOAD_CANONICAL_SCHEMA_VERSION,
    ticket_canonical_json,
    ticket_content_fingerprint,
    ticket_document,
    ticket_from_document,
)
from capability_lab.domain.shop import SupportChannel
from capability_lab.domain.ticket import (
    SuggestedDocument,
    SuggestedDocumentKind,
    TicketOrigin,
    TicketOriginKind,
    TicketStatus,
)
from ticket_factories import ORDER_ID, message, prior_history, publishable_ticket


def test_the_document_round_trips_into_the_same_ticket() -> None:
    ticket = publishable_ticket()

    assert ticket_from_document(ticket_document(ticket)) == ticket


def test_a_ticket_with_no_first_message_round_trips_too() -> None:
    ticket = publishable_ticket(trigger=None, history=(), linked_order_ids=())

    assert ticket_from_document(ticket_document(ticket)) == ticket


def test_the_document_declares_its_schema_and_stays_compact_and_sorted() -> None:
    document = ticket_document(publishable_ticket())
    encoded = ticket_canonical_json(publishable_ticket()).decode()

    assert document["canonical_schema_version"] == TICKET_PAYLOAD_CANONICAL_SCHEMA_VERSION
    assert encoded.startswith('{"canonical_schema_version":"ticket-payload-v1"')
    assert "\n" not in encoded
    assert list(document) == sorted(document)


def test_an_absent_trigger_is_an_explicit_null_rather_than_a_missing_key() -> None:
    """A draft with no first message yet is a real state, not an unreadable document."""
    document = ticket_document(publishable_ticket(trigger=None))

    assert "trigger" in document
    assert document["trigger"] is None


def test_the_owning_shop_is_not_part_of_the_content() -> None:
    """A shop scopes a ticket; the published version pins it, the fingerprint never sees it."""
    document = ticket_document(publishable_ticket())

    assert "shop_id" not in document
    assert "shop_version" not in document


def test_derived_thread_facts_are_never_serialized() -> None:
    document = ticket_document(publishable_ticket())

    assert "messages" not in document
    assert "opened_at" not in document


def test_the_fingerprint_is_stable_for_the_same_content() -> None:
    assert ticket_content_fingerprint(publishable_ticket()) == ticket_content_fingerprint(
        publishable_ticket()
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("reference", "T-999"),
        ("subject", "Wrong shipping address"),
        ("channel", SupportChannel.EMAIL),
        ("status", TicketStatus.RESOLVED),
        ("tags", ("address-change",)),
        ("linked_order_ids", ()),
        ("history", prior_history()[:1]),
        ("trigger", message(body="A different first message.")),
        ("origin", TicketOrigin(kind=TicketOriginKind.CHECKOUT)),
        (
            "suggested_documents",
            (SuggestedDocument(kind=SuggestedDocumentKind.POLICY, document_id="returns"),),
        ),
    ],
)
def test_the_fingerprint_moves_for_every_behaviourally_relevant_edit(
    field: str, value: object
) -> None:
    baseline = ticket_content_fingerprint(publishable_ticket())

    assert ticket_content_fingerprint(publishable_ticket(**{field: value})) != baseline


def test_reordering_the_history_changes_the_fingerprint() -> None:
    """The thread's order is what the history means, so it is part of the content."""
    reversed_history = tuple(reversed(prior_history()))

    assert ticket_content_fingerprint(
        publishable_ticket(history=reversed_history)
    ) != ticket_content_fingerprint(publishable_ticket())


def test_an_origin_order_is_serialized_as_its_stable_identifier() -> None:
    document = ticket_document(publishable_ticket())
    origin = document["origin"]

    assert isinstance(origin, dict)
    assert origin["order_id"] == str(ORDER_ID)
    assert origin["product_handle"] is None


def test_a_document_from_another_schema_is_refused() -> None:
    document = ticket_document(publishable_ticket())
    document["canonical_schema_version"] = "ticket-payload-v2"

    with pytest.raises(CanonicalSerializationError, match="unsupported ticket payload schema"):
        ticket_from_document(document)


def test_a_drifted_document_reports_the_failing_path() -> None:
    document = ticket_document(publishable_ticket())
    document["history"] = [{"id": "broken", "author": "supervisor", "body": "x", "sent_at": "x"}]

    with pytest.raises(
        CanonicalSerializationError,
        match=r"history\[0\]\.author is not a supported TicketAuthor",
    ):
        ticket_from_document(document)


def test_an_identifier_that_is_not_a_uuid_reports_its_path() -> None:
    document = ticket_document(publishable_ticket())
    document["linked_order_ids"] = ["NS-10482"]

    with pytest.raises(CanonicalSerializationError, match=r"linked_order_ids\[0\] must be a UUID"):
        ticket_from_document(document)
