"""Order-fixture invariants: typed transitions, derived totals, and data sensitivity."""

from decimal import Decimal

import pytest

from capability_lab.application.order_fixture_payload import order_fixture_document
from capability_lab.domain.content import FieldSensitivity
from capability_lab.domain.definitions import DefinitionValidation
from capability_lab.domain.order_fixture import (
    FULFILMENT_TRANSITIONS,
    PAYMENT_TRANSITIONS,
    FulfilmentState,
    FulfilmentStatus,
    OrderEventKind,
    OrderFixtureConfigurationError,
    OrderTransitionError,
    PaymentState,
    PaymentStatus,
    reachable_statuses,
    require_reachable_status,
    restricted_values,
    telemetry_attributes,
    unclassified_paths,
    validate_order_fixture,
)
from capability_lab.domain.shop import Currency, Money
from order_factories import context, event, frozen_address, line, paid_order


def codes(validation: DefinitionValidation) -> set[str]:
    return {issue.code for issue in validation.issues}


def test_totals_derive_from_the_line_items() -> None:
    order = paid_order(
        lines=(line(quantity=2), line(id="ns-cap-one", sku="NS-CAP-ONE", quantity=3)),
        shipping_fee=Money(amount=Decimal("4.90"), currency=Currency.EUR),
    )

    assert order.subtotal.canonical_amount == "1245.00"
    assert order.total.canonical_amount == "1249.90"
    assert order.item_count == 5


def test_an_order_without_a_shipping_fee_is_free_rather_than_unknown() -> None:
    order = paid_order(shipping_fee=None)

    assert order.shipping_amount.canonical_amount == "0.00"
    assert order.total == order.subtotal


def test_lines_must_use_the_order_currency() -> None:
    with pytest.raises(OrderFixtureConfigurationError, match="but the order is in EUR"):
        paid_order(lines=(line(unit_price=Money(amount=Decimal("249.00"), currency=Currency.USD)),))


def test_two_lines_cannot_name_the_same_variant() -> None:
    with pytest.raises(OrderFixtureConfigurationError, match="order line SKUs must be unique"):
        paid_order(lines=(line(), line(id="second")))


def test_a_reference_is_a_business_identifier_not_free_text() -> None:
    with pytest.raises(OrderFixtureConfigurationError, match="like NS-10482"):
        paid_order(reference="ns 10482")


def test_an_authored_instant_must_be_canonical_utc() -> None:
    """Two spellings of one moment would be two fingerprints of one fixture."""
    with pytest.raises(OrderFixtureConfigurationError, match="must be a UTC timestamp"):
        paid_order(placed_at="2026-08-20T14:55:00Z")


def test_payment_moves_forward_along_the_typed_graph() -> None:
    assert reachable_statuses(PaymentStatus.PENDING, PAYMENT_TRANSITIONS) == (
        PaymentStatus.PENDING,
        PaymentStatus.AUTHORIZED,
        PaymentStatus.PAID,
        PaymentStatus.REFUNDED,
    )
    assert reachable_statuses(PaymentStatus.PAID, PAYMENT_TRANSITIONS) == (
        PaymentStatus.PAID,
        PaymentStatus.REFUNDED,
    )

    # Authoring a paid order in one step is fine; un-refunding it is not a history.
    assert (
        require_reachable_status(
            PaymentStatus.PENDING, PaymentStatus.PAID, PAYMENT_TRANSITIONS, "payment status"
        )
        is PaymentStatus.PAID
    )
    with pytest.raises(OrderTransitionError, match="cannot move from refunded to paid"):
        require_reachable_status(
            PaymentStatus.REFUNDED, PaymentStatus.PAID, PAYMENT_TRANSITIONS, "payment status"
        )


def test_fulfilment_moves_forward_and_gates_address_changes() -> None:
    assert reachable_statuses(FulfilmentStatus.PARTIALLY_FULFILLED, FULFILMENT_TRANSITIONS) == (
        FulfilmentStatus.PARTIALLY_FULFILLED,
        FulfilmentStatus.FULFILLED,
    )
    with pytest.raises(OrderTransitionError, match="cannot move from fulfilled to unfulfilled"):
        require_reachable_status(
            FulfilmentStatus.FULFILLED,
            FulfilmentStatus.UNFULFILLED,
            FULFILMENT_TRANSITIONS,
            "fulfilment status",
        )

    assert FulfilmentState(status=FulfilmentStatus.UNFULFILLED).allows_address_change
    assert not FulfilmentState(status=FulfilmentStatus.FULFILLED).allows_address_change


def test_a_state_cannot_record_a_moment_it_never_reached() -> None:
    with pytest.raises(OrderFixtureConfigurationError, match="cannot record a capture time"):
        PaymentState(status=PaymentStatus.AUTHORIZED, paid_at="2026-08-21T13:12:00.000000Z")
    with pytest.raises(OrderFixtureConfigurationError, match="cannot record a shipping time"):
        FulfilmentState(
            status=FulfilmentStatus.UNFULFILLED, shipped_at="2026-08-21T13:12:00.000000Z"
        )


def test_a_method_carries_both_its_identifier_and_its_frozen_name() -> None:
    with pytest.raises(OrderFixtureConfigurationError, match="both its identifier and its name"):
        PaymentState(status=PaymentStatus.PENDING, method_id="card")


def test_a_complete_order_reports_no_finding() -> None:
    assert validate_order_fixture(paid_order(), context()).issues == ()


def test_an_empty_order_reports_what_it_still_needs() -> None:
    order = paid_order(
        lines=(),
        payment=PaymentState(status=PaymentStatus.PENDING),
        fulfilment=FulfilmentState(status=FulfilmentStatus.UNFULFILLED),
        shipping_address=None,
        events=(),
    )

    validation = validate_order_fixture(order, context())

    assert not validation.publishable
    assert codes(validation) == {
        "order_without_line",
        "payment_without_method",
        "fulfilment_without_method",
        "order_without_shipping_address",
        "order_without_event",
    }


def test_a_paid_order_must_say_when_it_was_captured() -> None:
    order = paid_order(
        payment=PaymentState(
            status=PaymentStatus.PAID, method_id="card", method_name="Card · synthetic"
        )
    )

    assert "paid_order_without_capture_time" in codes(validate_order_fixture(order, context()))


def test_a_removed_address_book_entry_warns_and_never_rewrites_the_order() -> None:
    """ADR 0014 left this check to the order editor: the frozen copy is what ships."""
    order = paid_order()

    validation = validate_order_fixture(order, context(address_book_ids=frozenset({"home"})))

    assert codes(validation) == {"shipping_address_source_removed"}
    assert validation.publishable
    assert order.shipping_address == frozen_address()


def test_a_repriced_variant_warns_while_the_order_keeps_what_it_froze() -> None:
    validation = validate_order_fixture(
        paid_order(), context(catalog_prices={"NS-ASJ-OB-M": "199.00"})
    )

    assert codes(validation) == {"line_price_differs_from_catalog"}
    assert "249.00" in next(iter(validation.warnings)).message


def test_a_variant_that_left_the_catalog_is_an_error_not_a_warning() -> None:
    validation = validate_order_fixture(paid_order(), context(catalog_prices={}))

    assert "line_sku_missing_from_catalog" in codes(validation)
    assert not validation.publishable


def test_a_variant_that_only_lost_its_price_is_not_reported_as_missing() -> None:
    """The SKU is still in the catalog; saying otherwise sends the author hunting."""
    validation = validate_order_fixture(paid_order(), context(catalog_prices={"NS-ASJ-OB-M": None}))

    assert codes(validation) == {"line_variant_without_price"}
    assert validation.publishable
    assert "249.00" in next(iter(validation.warnings)).message


def test_a_detached_customer_makes_the_order_incoherent() -> None:
    validation = validate_order_fixture(paid_order(), context(customer_attached=False))

    assert "customer_not_attached_to_shop" in codes(validation)
    assert not validation.publishable


def test_a_state_an_agent_can_read_should_be_a_state_it_can_explain() -> None:
    order = paid_order(events=(event(),))

    assert "payment_status_without_event" in codes(validate_order_fixture(order, context()))


def test_an_event_before_the_order_existed_is_reported() -> None:
    order = paid_order(
        events=(
            event(),
            event(
                "support-contact",
                OrderEventKind.SUPPORT_CONTACT,
                "2026-08-19T09:00:00.000000Z",
                "Asked about delivery windows",
            ),
            event(
                "payment-captured",
                OrderEventKind.PAYMENT_CAPTURED,
                "2026-08-21T13:12:00.000000Z",
                "Payment captured — order marked paid",
            ),
        )
    )

    assert "event_precedes_placement" in codes(validate_order_fixture(order, context()))


def test_every_document_leaf_carries_a_sensitivity_decision() -> None:
    """A newly authored field fails this suite until someone decides it may be logged."""
    assert unclassified_paths(order_fixture_document(paid_order())) == frozenset()


def test_telemetry_attributes_describe_an_order_without_disclosing_it() -> None:
    order = paid_order()
    attributes = telemetry_attributes(order)
    emitted = " ".join(str(value) for value in attributes.values())

    assert attributes["lab.order.total_amount"] == "249.00"
    assert attributes["lab.order.shipping_country"] == "FR"
    for value in restricted_values(order):
        assert value not in emitted


def test_restricted_values_cover_every_sensitive_leaf() -> None:
    from capability_lab.domain.order_fixture import FIELD_SENSITIVITY

    sensitive_paths = {
        path
        for path, sensitivity in FIELD_SENSITIVITY.items()
        if sensitivity is not FieldSensitivity.OPERATIONAL
    }
    order = paid_order()
    values = restricted_values(order)

    assert sensitive_paths == {
        "shipping_address.source_label",
        "shipping_address.recipient",
        "shipping_address.line1",
        "shipping_address.line2",
        "shipping_address.postal_code",
        "shipping_address.city",
        "shipping_address.region",
        "events[].summary",
    }
    assert "42 cours de la Marne" in values
    assert "Order created — checkout, order page" in values
