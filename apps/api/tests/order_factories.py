"""Shared order-fixture builders for the domain, payload, service, and API tests."""

from decimal import Decimal
from uuid import UUID

from capability_lab.domain.order_fixture import (
    FrozenShippingAddress,
    FulfilmentState,
    FulfilmentStatus,
    OrderAuthoringContext,
    OrderEvent,
    OrderEventKind,
    OrderFixturePayload,
    OrderLine,
    PaymentState,
    PaymentStatus,
)
from capability_lab.domain.shop import Currency, Money

CUSTOMER_ID = UUID("0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac101")
PLACED_AT = "2026-08-20T14:55:00.000000Z"
CAPTURED_AT = "2026-08-21T13:12:00.000000Z"


def line(**overrides: object) -> OrderLine:
    fields: dict[str, object] = {
        "id": "ns-asj-ob-m",
        "sku": "NS-ASJ-OB-M",
        "product_handle": "alpine-shell-jacket",
        "title": "Alpine Shell Jacket",
        "variant_summary": "Ocean Blue · M",
        "unit_price": Money(amount=Decimal("249.00"), currency=Currency.EUR),
        "quantity": 1,
    }
    fields.update(overrides)
    return OrderLine(**fields)  # type: ignore[arg-type]


def frozen_address(**overrides: object) -> FrozenShippingAddress:
    """The Bordeaux copy the wrong-address scenario exploits."""
    fields: dict[str, object] = {
        "source_address_id": "bordeaux-previous-flat",
        "source_label": "Bordeaux — previous flat",
        "selected_at": PLACED_AT,
        "recipient": "Maya Laurent",
        "line1": "42 cours de la Marne",
        "line2": None,
        "postal_code": "33800",
        "city": "Bordeaux",
        "region": None,
        "country": "FR",
    }
    fields.update(overrides)
    return FrozenShippingAddress(**fields)  # type: ignore[arg-type]


def event(
    event_id: str = "order-created",
    kind: OrderEventKind = OrderEventKind.PLACED,
    occurred_at: str = PLACED_AT,
    summary: str = "Order created — checkout, order page",
) -> OrderEvent:
    return OrderEvent(id=event_id, kind=kind, occurred_at=occurred_at, summary=summary)


def paid_order(**overrides: object) -> OrderFixturePayload:
    """A complete, coherent fixture; tests break exactly one rule at a time."""
    fields: dict[str, object] = {
        "reference": "NS-10482",
        "customer_profile_id": CUSTOMER_ID,
        "currency": Currency.EUR,
        "placed_at": PLACED_AT,
        "lines": (line(),),
        "payment": PaymentState(
            status=PaymentStatus.PAID,
            method_id="card",
            method_name="Card · synthetic",
            paid_at=CAPTURED_AT,
        ),
        "fulfilment": FulfilmentState(
            status=FulfilmentStatus.UNFULFILLED,
            method_id="standard",
            method_name="Standard 3-5 days",
        ),
        "shipping_fee": Money(amount=Decimal("0.00"), currency=Currency.EUR),
        "shipping_address": frozen_address(),
        "events": (
            event(),
            event(
                "payment-captured",
                OrderEventKind.PAYMENT_CAPTURED,
                CAPTURED_AT,
                "Payment captured — order marked paid",
            ),
        ),
    }
    fields.update(overrides)
    return OrderFixturePayload(**fields)  # type: ignore[arg-type]


def context(**overrides: object) -> OrderAuthoringContext:
    """The shop and customer as they currently stand around `paid_order`."""
    fields: dict[str, object] = {
        "customer_attached": True,
        "address_book_ids": frozenset({"bordeaux-previous-flat", "home"}),
        "catalog_prices": {"NS-ASJ-OB-M": "249.00"},
        "payment_method_ids": frozenset({"card"}),
        "fulfilment_method_ids": frozenset({"standard"}),
    }
    fields.update(overrides)
    return OrderAuthoringContext(**fields)  # type: ignore[arg-type]
