"""Ticket invariants: the thread, the minimal origin reference, and data sensitivity."""

from uuid import UUID

import pytest

from capability_lab.application.ticket_payload import ticket_document
from capability_lab.domain.content import FieldSensitivity
from capability_lab.domain.definitions import DefinitionChangeKind, DefinitionValidation
from capability_lab.domain.shop import SupportChannel
from capability_lab.domain.ticket import (
    FIELD_SENSITIVITY,
    SuggestedDocument,
    SuggestedDocumentKind,
    TicketAuthor,
    TicketConfigurationError,
    TicketOrigin,
    TicketOriginKind,
    TicketStatus,
    restricted_values,
    summarize_ticket_changes,
    telemetry_attributes,
    unclassified_paths,
    validate_ticket,
    validate_ticket_content,
)
from ticket_factories import (
    ORDER_ID,
    TRIGGER_AT,
    context,
    message,
    prior_history,
    publishable_ticket,
)

OTHER_CUSTOMER_ID = UUID("9d0e1a44-77b1-4a0e-8b2e-3c4d5e6f7a80")


def codes(validation: DefinitionValidation) -> set[str]:
    return {issue.code for issue in validation.issues}


def test_a_publishable_ticket_reports_nothing_that_blocks_the_freeze() -> None:
    assert validate_ticket(publishable_ticket(), context()).publishable
    assert codes(validate_ticket(publishable_ticket(), context())) == set()


# -- the thread ---------------------------------------------------------------


def test_the_thread_is_the_history_followed_by_the_trigger() -> None:
    ticket = publishable_ticket()

    assert [entry.id for entry in ticket.messages] == [
        "payment-question",
        "payment-answer",
        "trigger",
    ]
    assert ticket.opened_at == TRIGGER_AT


def test_a_ticket_without_a_trigger_has_a_thread_but_no_opening_moment() -> None:
    ticket = publishable_ticket(trigger=None)

    assert [entry.id for entry in ticket.messages] == ["payment-question", "payment-answer"]
    assert ticket.opened_at is None


def test_the_triggering_message_must_come_from_the_customer() -> None:
    with pytest.raises(TicketConfigurationError, match="must come from the customer"):
        publishable_ticket(trigger=message("trigger", TicketAuthor.SUPPORT_AGENT))


def test_two_messages_cannot_share_an_identifier() -> None:
    with pytest.raises(TicketConfigurationError, match="ticket message IDs must be unique"):
        publishable_ticket(trigger=message("payment-question"))


def test_a_draft_without_a_first_message_cannot_be_published() -> None:
    assert "ticket_without_trigger" in codes(
        validate_ticket(publishable_ticket(trigger=None), context())
    )


def test_a_trigger_older_than_the_history_it_opens_is_refused() -> None:
    stale = publishable_ticket(trigger=message(sent_at="2026-08-21T09:15:00.000000Z"))

    assert "trigger_precedes_history" in codes(validate_ticket(stale, context()))


def test_a_trigger_only_ticket_is_publishable() -> None:
    """The frame shows the trigger even when it is the only message in the thread."""
    ticket = publishable_ticket(history=())

    assert validate_ticket(ticket, context()).publishable


# -- the minimal origin reference ---------------------------------------------


def test_an_order_page_origin_cannot_also_name_a_product() -> None:
    with pytest.raises(TicketConfigurationError, match="order_page origin cannot name a product"):
        TicketOrigin(
            kind=TicketOriginKind.ORDER_PAGE,
            order_id=ORDER_ID,
            product_handle="alpine-shell-jacket",
        )


def test_a_generic_support_origin_cannot_name_an_order() -> None:
    with pytest.raises(TicketConfigurationError, match="support_entry origin cannot name an order"):
        TicketOrigin(kind=TicketOriginKind.SUPPORT_ENTRY, order_id=ORDER_ID)


def test_an_origin_that_should_name_a_resource_and_does_not_blocks_publication() -> None:
    """A draft may sit incomplete between picking the page and picking the resource."""
    ticket = publishable_ticket(
        origin=TicketOrigin(kind=TicketOriginKind.PRODUCT_PAGE), linked_order_ids=()
    )

    assert "origin_without_reference" in codes(validate_ticket(ticket, context()))


def test_a_checkout_origin_names_nothing_and_still_publishes() -> None:
    ticket = publishable_ticket(origin=TicketOrigin(kind=TicketOriginKind.CHECKOUT))

    assert validate_ticket(ticket, context()).publishable


def test_an_origin_product_that_left_the_catalog_is_an_error() -> None:
    ticket = publishable_ticket(
        origin=TicketOrigin(
            kind=TicketOriginKind.PRODUCT_PAGE, product_handle="discontinued-jacket"
        ),
        linked_order_ids=(),
    )

    assert "origin_product_missing_from_catalog" in codes(validate_ticket(ticket, context()))


def test_the_origin_order_counts_as_a_referenced_order() -> None:
    ticket = publishable_ticket(linked_order_ids=())

    assert ticket.referenced_order_ids == (ORDER_ID,)


def test_the_origin_order_is_not_referenced_twice_when_it_is_also_linked() -> None:
    assert publishable_ticket().referenced_order_ids == (ORDER_ID,)


# -- what the shop answers ----------------------------------------------------


def test_a_channel_the_shop_does_not_offer_blocks_publication() -> None:
    ticket = publishable_ticket(channel=SupportChannel.PHONE)

    assert "channel_not_offered_by_shop" in codes(validate_ticket(ticket, context()))


def test_a_customer_the_shop_does_not_use_blocks_publication() -> None:
    validation = validate_ticket(publishable_ticket(), context(customer_attached=False))

    assert "customer_not_attached_to_shop" in codes(validation)


def test_a_linked_order_that_left_the_shop_is_an_error() -> None:
    validation = validate_ticket(
        publishable_ticket(),
        context(shop_order_ids=frozenset[UUID](), customer_order_ids=frozenset[UUID]()),
    )

    assert "linked_order_missing_from_shop" in codes(validation)


def test_a_linked_order_of_another_customer_is_an_error() -> None:
    """A ticket may only show the agent its own customer's orders."""
    validation = validate_ticket(
        publishable_ticket(), context(customer_order_ids=frozenset[UUID]())
    )

    assert "linked_order_of_another_customer" in codes(validation)


def test_an_unpublished_shop_or_customer_blocks_the_freeze() -> None:
    """What publishing must pin is part of the gate, not only of the pin step."""
    validation = validate_ticket(
        publishable_ticket(), context(shop_published=False, customer_published=False)
    )

    assert codes(validation) == {"shop_unpublished", "customer_profile_unpublished"}
    assert not validation.publishable


def test_the_publication_findings_name_what_the_author_has_to_publish() -> None:
    issues = validate_ticket(publishable_ticket(), context(shop_published=False)).issues

    assert [(issue.code, issue.path) for issue in issues] == [("shop_unpublished", "shop")]


def test_a_suggested_document_the_shop_dropped_only_warns() -> None:
    """A suggestion pre-fills a form; it never enters the sandbox, so it never blocks."""
    validation = validate_ticket(
        publishable_ticket(),
        context(document_ids={SuggestedDocumentKind.POLICY: frozenset({"address-change"})}),
    )

    assert "suggested_document_missing_from_shop" in codes(validation)
    assert validation.publishable


def test_a_suggested_document_the_shop_dropped_is_said_to_still_pre_fill() -> None:
    """A new scenario copies every suggestion, resolved or not (ADR 0018); the warning says so."""
    validation = validate_ticket(
        publishable_ticket(),
        context(document_ids={SuggestedDocumentKind.POLICY: frozenset({"address-change"})}),
    )

    [warning] = [
        issue
        for issue in validation.warnings
        if issue.code == "suggested_document_missing_from_shop"
    ]
    assert "still pre-fills" in warning.message
    assert "will not pre-fill" not in warning.message


def test_a_ticket_pointing_at_nothing_warns_without_blocking() -> None:
    ticket = publishable_ticket(
        origin=TicketOrigin(kind=TicketOriginKind.SUPPORT_ENTRY), linked_order_ids=()
    )
    validation = validate_ticket(ticket, context())

    assert "ticket_without_resource_reference" in codes(validation)
    assert validation.publishable


def test_a_ticket_suggesting_no_document_warns_without_blocking() -> None:
    validation = validate_ticket(publishable_ticket(suggested_documents=()), context())

    assert "ticket_without_suggested_document" in codes(validation)
    assert validation.publishable


def test_content_validation_reports_only_what_holds_without_a_shop() -> None:
    """The codec's gate must not invent findings it has no shop to check."""
    assert codes(validate_ticket_content(publishable_ticket())) == set()
    assert codes(validate_ticket_content(publishable_ticket(channel=SupportChannel.PHONE))) == set()
    assert "ticket_without_trigger" in codes(
        validate_ticket_content(publishable_ticket(trigger=None))
    )


# -- structural limits --------------------------------------------------------


def test_a_tag_must_be_a_slug() -> None:
    with pytest.raises(TicketConfigurationError, match="ticket tag must be a lowercase"):
        publishable_ticket(tags=("Address Change",))


def test_the_same_document_cannot_be_suggested_twice() -> None:
    with pytest.raises(TicketConfigurationError, match="suggested documents must be unique"):
        publishable_ticket(
            suggested_documents=(
                SuggestedDocument(kind=SuggestedDocumentKind.POLICY, document_id="address-change"),
                SuggestedDocument(kind=SuggestedDocumentKind.POLICY, document_id="address-change"),
            )
        )


def test_one_document_id_may_appear_once_per_collection() -> None:
    """A policy and an FAQ entry can legitimately share an ID; they are different documents."""
    ticket = publishable_ticket(
        suggested_documents=(
            SuggestedDocument(kind=SuggestedDocumentKind.POLICY, document_id="address-change"),
            SuggestedDocument(kind=SuggestedDocumentKind.FAQ_ENTRY, document_id="address-change"),
        )
    )

    assert len(ticket.suggested_documents) == 2


def test_the_same_order_cannot_be_linked_twice() -> None:
    with pytest.raises(TicketConfigurationError, match="linked orders must be unique"):
        publishable_ticket(linked_order_ids=(ORDER_ID, ORDER_ID))


def test_a_reference_must_be_a_quotable_business_identifier() -> None:
    with pytest.raises(TicketConfigurationError, match="uppercase alphanumeric"):
        publishable_ticket(reference="t-204")


def test_a_message_time_must_be_canonical() -> None:
    with pytest.raises(TicketConfigurationError, match="ticket message time must be a UTC"):
        publishable_ticket(trigger=message(sent_at="2026-08-21T13:40:00Z"))


# -- data sensitivity ---------------------------------------------------------


def test_every_document_leaf_carries_a_sensitivity_decision() -> None:
    """A newly authored field fails this suite until someone decides it may be logged."""
    assert unclassified_paths(ticket_document(publishable_ticket())) == frozenset()


def test_telemetry_attributes_describe_a_ticket_without_disclosing_it() -> None:
    ticket = publishable_ticket()
    attributes = telemetry_attributes(ticket)
    emitted = " ".join(str(value) for value in attributes.values())

    assert attributes["lab.ticket.reference"] == "T-204"
    assert attributes["lab.ticket.history_count"] == 2
    assert attributes["lab.ticket.has_trigger"] is True
    for value in restricted_values(ticket):
        assert value not in emitted


def test_restricted_values_cover_every_sensitive_leaf() -> None:
    sensitive_paths = {
        path
        for path, sensitivity in FIELD_SENSITIVITY.items()
        if sensitivity is not FieldSensitivity.OPERATIONAL
    }
    values = restricted_values(publishable_ticket())

    assert sensitive_paths == {"subject", "history[].body", "trigger.body"}
    assert "Wrong address concern" in values
    assert "Did my payment go through? I got an error at checkout." in values


# -- change summaries ---------------------------------------------------------


def test_a_first_publication_summarizes_itself() -> None:
    changes = summarize_ticket_changes(None, publishable_ticket())

    assert [change.kind for change in changes] == [DefinitionChangeKind.ADDED]
    assert "T-204" in changes[0].description


def test_a_change_summary_names_what_moved_without_quoting_the_thread() -> None:
    previous = publishable_ticket()
    current = publishable_ticket(
        status=TicketStatus.RESOLVED,
        tags=("address-change",),
        history=prior_history()[:1],
        trigger=message(body="Actually it still shows the Bordeaux address."),
    )

    changes = summarize_ticket_changes(previous, current)
    paths = {change.path for change in changes}
    described = " ".join(change.description for change in changes)

    assert paths == {
        "ticket.status",
        "tags.pre-fulfilment",
        "history.payment-answer",
        "trigger",
    }
    assert "Actually it still shows" not in described
    assert "customer at 2026-08-21T13:40:00.000000Z" in described


def test_linking_an_order_is_reported_as_a_change() -> None:
    changes = summarize_ticket_changes(
        publishable_ticket(linked_order_ids=()), publishable_ticket()
    )

    assert [change.path for change in changes] == [f"linked_order_ids.{ORDER_ID}"]


def test_moving_a_ticket_to_another_customer_shows_up_as_a_change() -> None:
    """The service refuses the move; the summary still has to be able to describe one."""
    changes = summarize_ticket_changes(
        publishable_ticket(), publishable_ticket(customer_profile_id=OTHER_CUSTOMER_ID)
    )

    assert [change.path for change in changes] == ["ticket.customer_profile_id"]
