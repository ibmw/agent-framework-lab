"""The rules that decide whether an order may be redirected, and what happens if it is."""

from dataclasses import replace
from uuid import uuid4

import pytest

from capability_lab.domain.address_change import (
    AddressChangeRefusalCode,
    AddressChangeRefusedError,
    apply_address_change,
    plan_address_change,
)
from capability_lab.domain.customer_profile import CustomerProfilePayload
from capability_lab.domain.order_fixture import (
    FulfilmentState,
    FulfilmentStatus,
    OrderEventKind,
    OrderFixturePayload,
    PaymentState,
    PaymentStatus,
)
from definition_factories import address, publishable_profile
from order_factories import PLACED_AT, paid_order

CHANGED_AT = "2026-08-24T09:30:00.000000Z"
STALE = "bordeaux-previous-flat"
CURRENT = "home"


def profile(**overrides: object) -> CustomerProfilePayload:
    """The address book behind `paid_order`: the Lyon home and the Bordeaux flat it left."""
    stale: dict[str, object] = {
        "label": "Bordeaux — previous flat",
        "is_default": False,
        "line1": "42 cours de la Marne",
        "postal_code": "33800",
        "city": "Bordeaux",
    }
    stale.update(overrides)
    return publishable_profile(addresses=(address(), address(STALE, **stale)))  # type: ignore[arg-type]


def order(**overrides: object) -> OrderFixturePayload:
    """The paid, unfulfilled order shipping to the stale address."""
    return paid_order(**overrides)


def refusal(payload: OrderFixturePayload, address_id: str = CURRENT) -> AddressChangeRefusalCode:
    with pytest.raises(AddressChangeRefusedError) as raised:
        plan_address_change(uuid4(), payload, profile(), address_id)
    return raised.value.refusal.code


# -- what may be changed ----------------------------------------------------


def test_a_paid_unfulfilled_order_can_be_redirected_to_another_entry_in_the_book() -> None:
    payload = order()

    plan = plan_address_change(uuid4(), payload, profile(), CURRENT)

    assert plan.entry.id == CURRENT
    assert plan.reference == "NS-10482"
    # The plan says where it is now as well as where it would go, so a proposal can show
    # both without a second lookup.
    assert plan.current is not None
    assert plan.current.city == "Bordeaux"


def test_an_address_the_customer_does_not_have_is_refused() -> None:
    assert refusal(order(), "an-address-nobody-has") is AddressChangeRefusalCode.ADDRESS_NOT_IN_BOOK


def test_a_shipped_order_can_no_longer_be_redirected() -> None:
    shipped = order(
        fulfilment=FulfilmentState(
            status=FulfilmentStatus.FULFILLED,
            method_id="standard",
            method_name="Standard",
            shipped_at=PLACED_AT,
        )
    )

    assert refusal(shipped) is AddressChangeRefusalCode.ORDER_ALREADY_SHIPPED


def test_a_partly_shipped_order_can_still_be_redirected() -> None:
    """The rest of the parcel has somewhere to go, so the question is still open."""
    partial = order(
        fulfilment=FulfilmentState(
            status=FulfilmentStatus.PARTIALLY_FULFILLED,
            method_id="standard",
            method_name="Standard",
            shipped_at=PLACED_AT,
        )
    )

    assert plan_address_change(uuid4(), partial, profile(), CURRENT).entry.id == CURRENT


def test_a_refunded_order_has_no_destination_left_to_argue_about() -> None:
    refunded = order(
        payment=PaymentState(
            status=PaymentStatus.REFUNDED,
            method_id="visa",
            method_name="Visa",
            paid_at=PLACED_AT,
        )
    )

    assert refusal(refunded) is AddressChangeRefusalCode.ORDER_REFUNDED


def test_reselecting_the_address_the_order_already_ships_to_is_refused() -> None:
    """Applying it would append history saying something happened when nothing did."""
    assert refusal(order(), STALE) is AddressChangeRefusalCode.NOTHING_TO_CHANGE


def test_reselecting_an_entry_the_customer_has_since_edited_is_a_real_change() -> None:
    """The order ships to the frozen *copy*, so an edited entry genuinely moves it."""
    plan = plan_address_change(uuid4(), order(), profile(line1="9 quai des Chartrons"), STALE)

    assert plan.entry.line1 == "9 quai des Chartrons"


# -- what changing does -----------------------------------------------------


def test_applying_moves_the_address_and_records_the_line_that_explains_it() -> None:
    payload = order()
    plan = plan_address_change(uuid4(), payload, profile(), CURRENT)

    changed = apply_address_change(
        payload,
        plan,
        event_id="address-change-abc123",
        occurred_at=CHANGED_AT,
        actor="Northstar tier 1",
    )

    assert changed.shipping_address is not None
    assert changed.shipping_address.source_address_id == CURRENT
    assert changed.shipping_address.city == "Lyon"
    # The copy is stamped with when it was selected, not with when the entry was authored.
    assert changed.shipping_address.selected_at == CHANGED_AT
    event = changed.events[-1]
    assert event.kind is OrderEventKind.ADDRESS_UPDATED
    assert event.id == "address-change-abc123"
    assert "Northstar tier 1" in event.summary


def test_applying_leaves_the_order_it_was_applied_to_alone() -> None:
    payload = order()
    plan = plan_address_change(uuid4(), payload, profile(), CURRENT)

    apply_address_change(
        payload, plan, event_id="address-change-abc123", occurred_at=CHANGED_AT, actor="Agent"
    )

    assert payload.shipping_address is not None
    assert payload.shipping_address.source_address_id == STALE
    assert not payload.has_event(OrderEventKind.ADDRESS_UPDATED)


def test_applying_changes_nothing_an_order_is_identified_or_priced_by() -> None:
    """A run changes where an order goes, never what it is or what it cost."""
    payload = order()
    plan = plan_address_change(uuid4(), payload, profile(), CURRENT)

    changed = apply_address_change(
        payload, plan, event_id="address-change-abc123", occurred_at=CHANGED_AT, actor="Agent"
    )

    assert replace(changed, shipping_address=None, events=()) == replace(
        payload, shipping_address=None, events=()
    )
    assert changed.total == payload.total
