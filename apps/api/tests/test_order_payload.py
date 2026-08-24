"""Canonical serialization of an order fixture.

An order is not a versioned definition, but the scenario slice freezes a copy of this
document, so it obeys the same ADR 0007 rules: one spelling per fixture, a fingerprint that
moves for every behaviourally relevant edit, and a loud failure on a drifted document.
"""

from decimal import Decimal

import pytest

from capability_lab.application.canonical_json import CanonicalSerializationError
from capability_lab.application.order_fixture_payload import (
    ORDER_FIXTURE_CANONICAL_SCHEMA_VERSION,
    order_fixture_canonical_json,
    order_fixture_content_fingerprint,
    order_fixture_document,
    order_fixture_from_document,
)
from capability_lab.domain.order_fixture import (
    FulfilmentState,
    FulfilmentStatus,
    OrderEventKind,
    PaymentState,
    PaymentStatus,
)
from capability_lab.domain.shop import Currency, Money
from order_factories import event, line, paid_order


def test_the_document_round_trips_into_the_same_order() -> None:
    order = paid_order()

    assert order_fixture_from_document(order_fixture_document(order)) == order


def test_the_document_declares_its_schema_and_stays_compact_and_sorted() -> None:
    document = order_fixture_document(paid_order())
    encoded = order_fixture_canonical_json(paid_order()).decode()

    assert document["canonical_schema_version"] == ORDER_FIXTURE_CANONICAL_SCHEMA_VERSION
    assert encoded.startswith('{"canonical_schema_version":"order-fixture-v1"')
    # Compact and sorted: no indentation, and every key in one deterministic order.
    assert "\n" not in encoded
    assert list(document) == sorted(document)


def test_an_absent_address_is_an_explicit_null_rather_than_a_missing_key() -> None:
    document = order_fixture_document(paid_order(shipping_address=None))

    assert "shipping_address" in document
    assert document["shipping_address"] is None


def test_derived_totals_are_never_serialized() -> None:
    """A total is a function of the lines; storing it would create a second truth."""
    document = order_fixture_document(paid_order())

    assert "total" not in document
    assert "subtotal" not in document
    assert document["shipping_fee_amount"] == "0.00"


@pytest.mark.parametrize(
    "mutation",
    [
        {"reference": "NS-10483"},
        {"placed_at": "2026-08-20T14:56:00.000000Z"},
        {"lines": (line(quantity=2),)},
        {"shipping_fee": Money(amount=Decimal("4.90"), currency=Currency.EUR)},
        {
            "fulfilment": FulfilmentState(
                status=FulfilmentStatus.FULFILLED,
                method_id="standard",
                method_name="Standard 3-5 days",
                shipped_at="2026-08-22T08:00:00.000000Z",
            )
        },
        {
            "payment": PaymentState(
                status=PaymentStatus.REFUNDED,
                method_id="card",
                method_name="Card · synthetic",
                paid_at="2026-08-21T13:12:00.000000Z",
            )
        },
        {
            "events": (
                event(),
                event(
                    "payment-captured",
                    OrderEventKind.PAYMENT_CAPTURED,
                    "2026-08-21T13:12:00.000000Z",
                    "Payment captured — a different wording",
                ),
            )
        },
    ],
)
def test_the_fingerprint_moves_for_every_behaviourally_relevant_edit(
    mutation: dict[str, object],
) -> None:
    baseline = order_fixture_content_fingerprint(paid_order())

    assert order_fixture_content_fingerprint(paid_order(**mutation)) != baseline


def test_reordering_the_line_items_changes_the_fingerprint() -> None:
    """Line order is authored content: it is the order the agent reads the basket in."""
    second = line(id="ns-cap-one", sku="NS-CAP-ONE")
    forward = paid_order(lines=(line(), second))
    backward = paid_order(lines=(second, line()))

    assert order_fixture_content_fingerprint(forward) != order_fixture_content_fingerprint(backward)


def test_a_stored_document_from_another_schema_is_refused() -> None:
    document = order_fixture_document(paid_order())
    document["canonical_schema_version"] = "order-fixture-v2"

    with pytest.raises(CanonicalSerializationError, match="unsupported order fixture schema"):
        order_fixture_from_document(document)


def test_a_drifted_document_reports_the_failing_path() -> None:
    document = order_fixture_document(paid_order())
    lines = document["lines"]
    assert isinstance(lines, list)
    first = lines[0]
    assert isinstance(first, dict)
    del first["unit_amount"]

    with pytest.raises(CanonicalSerializationError, match=r"order fixture.lines\[0\].unit_amount"):
        order_fixture_from_document(document)


def test_an_unparsable_customer_identifier_is_refused() -> None:
    document = order_fixture_document(paid_order())
    document["customer_profile_id"] = "not-a-uuid"

    with pytest.raises(CanonicalSerializationError, match="customer_profile_id must be a UUID"):
        order_fixture_from_document(document)
