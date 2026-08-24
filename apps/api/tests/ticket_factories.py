"""Shared ticket builders for the domain, payload, service, and API tests."""

from uuid import UUID

from capability_lab.domain.shop import SupportChannel
from capability_lab.domain.ticket import (
    SuggestedDocument,
    SuggestedDocumentKind,
    TicketAuthor,
    TicketAuthoringContext,
    TicketMessage,
    TicketOrigin,
    TicketOriginKind,
    TicketPayload,
    TicketStatus,
)

CUSTOMER_ID = UUID("0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac101")
ORDER_ID = UUID("2f8c2b60-9d3d-4a77-9f31-1c7f0f3c9a42")
HISTORY_QUESTION_AT = "2026-08-21T09:14:00.000000Z"
HISTORY_ANSWER_AT = "2026-08-21T09:16:00.000000Z"
TRIGGER_AT = "2026-08-21T13:40:00.000000Z"


def message(
    message_id: str = "trigger",
    author: TicketAuthor = TicketAuthor.CUSTOMER,
    body: str = (
        "I just noticed this is going to my old address. Can you change it before it ships?"
    ),
    sent_at: str = TRIGGER_AT,
) -> TicketMessage:
    return TicketMessage(id=message_id, author=author, body=body, sent_at=sent_at)


def prior_history() -> tuple[TicketMessage, ...]:
    """The payment exchange the wrong-address incident opens on top of."""
    return (
        message(
            "payment-question",
            TicketAuthor.CUSTOMER,
            "Did my payment go through? I got an error at checkout.",
            HISTORY_QUESTION_AT,
        ),
        message(
            "payment-answer",
            TicketAuthor.SUPPORT_AGENT,
            "Your order NS-10482 is confirmed and paid — no action needed.",
            HISTORY_ANSWER_AT,
        ),
    )


def publishable_ticket(**overrides: object) -> TicketPayload:
    """A ticket with no publish-gate errors; tests break exactly one rule at a time."""
    fields: dict[str, object] = {
        "reference": "T-204",
        "subject": "Wrong address concern",
        "customer_profile_id": CUSTOMER_ID,
        "channel": SupportChannel.CHAT,
        "status": TicketStatus.OPEN,
        "origin": TicketOrigin(kind=TicketOriginKind.ORDER_PAGE, order_id=ORDER_ID),
        "tags": ("address-change", "pre-fulfilment"),
        "history": prior_history(),
        "trigger": message(),
        "linked_order_ids": (ORDER_ID,),
        "suggested_documents": (
            SuggestedDocument(kind=SuggestedDocumentKind.POLICY, document_id="address-change"),
            SuggestedDocument(
                kind=SuggestedDocumentKind.SUPPORT_GUIDELINE, document_id="shipping-and-fulfilment"
            ),
        ),
    }
    fields.update(overrides)
    return TicketPayload(**fields)  # type: ignore[arg-type]


def context(**overrides: object) -> TicketAuthoringContext:
    """The shop and customer as they currently stand around `publishable_ticket`."""
    fields: dict[str, object] = {
        "customer_attached": True,
        "shop_published": True,
        "customer_published": True,
        "shop_channels": frozenset({SupportChannel.CHAT, SupportChannel.EMAIL}),
        "product_handles": frozenset({"alpine-shell-jacket"}),
        "shop_order_ids": frozenset({ORDER_ID}),
        "customer_order_ids": frozenset({ORDER_ID}),
        "document_ids": {
            SuggestedDocumentKind.POLICY: frozenset({"address-change", "returns"}),
            SuggestedDocumentKind.SUPPORT_GUIDELINE: frozenset({"shipping-and-fulfilment"}),
            SuggestedDocumentKind.FAQ_ENTRY: frozenset({"delivery-times"}),
        },
    }
    fields.update(overrides)
    return TicketAuthoringContext(**fields)  # type: ignore[arg-type]
