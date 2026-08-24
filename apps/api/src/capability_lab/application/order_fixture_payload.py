"""Canonical serialization of an order fixture.

`order-fixture-v1` follows the ADR 0013 payload pattern even though an order is not a
versioned definition: the scenario slice freezes a copy of this exact document, so it needs
a lossless canonical form and a stable content fingerprint under the ADR 0007 rules.
"""

from __future__ import annotations

from decimal import Decimal
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
from capability_lab.domain.order_fixture import (
    FrozenShippingAddress,
    FulfilmentState,
    FulfilmentStatus,
    OrderEvent,
    OrderEventKind,
    OrderFixturePayload,
    OrderLine,
    PaymentState,
    PaymentStatus,
)
from capability_lab.domain.shop import Currency, Money

ORDER_FIXTURE_CANONICAL_SCHEMA_VERSION = "order-fixture-v1"


def order_fixture_document(payload: OrderFixturePayload) -> dict[str, CanonicalValue]:
    """Render one order as its canonical `order-fixture-v1` document."""
    address = payload.shipping_address
    return {
        "canonical_schema_version": ORDER_FIXTURE_CANONICAL_SCHEMA_VERSION,
        "currency": payload.currency.value,
        "customer_profile_id": str(payload.customer_profile_id),
        "events": [
            {
                "id": event.id,
                "kind": event.kind.value,
                "occurred_at": event.occurred_at,
                "summary": event.summary,
            }
            for event in payload.events
        ],
        "fulfilment": {
            "method_id": payload.fulfilment.method_id,
            "method_name": payload.fulfilment.method_name,
            "shipped_at": payload.fulfilment.shipped_at,
            "status": payload.fulfilment.status.value,
        },
        "lines": [
            {
                "id": line.id,
                "product_handle": line.product_handle,
                "quantity": line.quantity,
                "sku": line.sku,
                "title": line.title,
                "unit_amount": line.unit_price.canonical_amount,
                "variant_summary": line.variant_summary,
            }
            for line in payload.lines
        ],
        "payment": {
            "method_id": payload.payment.method_id,
            "method_name": payload.payment.method_name,
            "paid_at": payload.payment.paid_at,
            "status": payload.payment.status.value,
        },
        "placed_at": payload.placed_at,
        "reference": payload.reference,
        "shipping_address": None
        if address is None
        else {
            "city": address.city,
            "country": address.country,
            "line1": address.line1,
            "line2": address.line2,
            "postal_code": address.postal_code,
            "recipient": address.recipient,
            "region": address.region,
            "selected_at": address.selected_at,
            "source_address_id": address.source_address_id,
            "source_label": address.source_label,
        },
        "shipping_fee_amount": payload.shipping_amount.canonical_amount,
    }


def order_fixture_canonical_json(payload: OrderFixturePayload) -> bytes:
    return canonical_json_bytes(order_fixture_document(payload))


def order_fixture_content_fingerprint(payload: OrderFixturePayload) -> str:
    """The SHA-256 content fingerprint a scenario records when it freezes this order."""
    return canonical_sha256(order_fixture_canonical_json(payload))


def _money(amount: str, currency: Currency, path: str) -> Money:
    try:
        return Money(amount=Decimal(amount), currency=currency)
    except ArithmeticError as cause:
        raise CanonicalSerializationError(f"{path} must be a decimal amount") from cause


def _uuid(value: str, path: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as cause:
        raise CanonicalSerializationError(f"{path} must be a UUID") from cause


def order_fixture_from_document(document: object) -> OrderFixturePayload:
    """Rebuild the typed order from a stored canonical document."""
    root = DocumentReader(document, "order fixture")
    require_schema_version(root, ORDER_FIXTURE_CANONICAL_SCHEMA_VERSION, "order fixture")
    currency = root.enum(Currency, "currency")
    payment = root.reader("payment")
    fulfilment = root.reader("fulfilment")
    address = root.optional_reader("shipping_address")
    return OrderFixturePayload(
        reference=root.text("reference"),
        customer_profile_id=_uuid(
            root.text("customer_profile_id"), "order fixture.customer_profile_id"
        ),
        currency=currency,
        placed_at=root.text("placed_at"),
        lines=tuple(
            OrderLine(
                id=line.text("id"),
                sku=line.text("sku"),
                product_handle=line.text("product_handle"),
                title=line.text("title"),
                variant_summary=line.text("variant_summary"),
                unit_price=_money(line.text("unit_amount"), currency, f"{line.path}.unit_amount"),
                quantity=line.integer("quantity"),
            )
            for line in root.readers("lines")
        ),
        payment=PaymentState(
            status=payment.enum(PaymentStatus, "status"),
            method_id=payment.optional_text("method_id"),
            method_name=payment.optional_text("method_name"),
            paid_at=payment.optional_text("paid_at"),
        ),
        fulfilment=FulfilmentState(
            status=fulfilment.enum(FulfilmentStatus, "status"),
            method_id=fulfilment.optional_text("method_id"),
            method_name=fulfilment.optional_text("method_name"),
            shipped_at=fulfilment.optional_text("shipped_at"),
        ),
        shipping_fee=_money(
            root.text("shipping_fee_amount"), currency, "order fixture.shipping_fee_amount"
        ),
        shipping_address=None
        if address is None
        else FrozenShippingAddress(
            source_address_id=address.text("source_address_id"),
            source_label=address.text("source_label"),
            selected_at=address.text("selected_at"),
            recipient=address.text("recipient"),
            line1=address.text("line1"),
            postal_code=address.text("postal_code"),
            city=address.text("city"),
            country=address.text("country"),
            line2=address.optional_text("line2"),
            region=address.optional_text("region"),
        ),
        events=tuple(
            OrderEvent(
                id=event.text("id"),
                kind=event.enum(OrderEventKind, "kind"),
                occurred_at=event.text("occurred_at"),
                summary=event.text("summary"),
            )
            for event in root.readers("events")
        ),
    )
