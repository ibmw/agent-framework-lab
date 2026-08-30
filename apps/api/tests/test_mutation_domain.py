"""When a bound moment arrives, and what an out-of-band write does to an order (ADR 0028)."""

from uuid import UUID, uuid4

import pytest

from capability_lab.domain.blocks import MutationTiming, MutationTimingKind, parse_timing
from capability_lab.domain.mutation import (
    ArmProgress,
    MutationError,
    MutationNotApplicableError,
    advance_fulfilment,
    is_due,
)
from capability_lab.domain.order_fixture import (
    FulfilmentState,
    FulfilmentStatus,
    OrderEventKind,
    OrderFixturePayload,
)
from order_factories import paid_order

ORDER_ID = UUID("2f8c2b60-9d3d-4a77-9f31-1c7f0f3c9a42")


def timing(value: str) -> MutationTiming:
    parsed = parse_timing(value)
    assert parsed is not None, value
    return parsed


# -- when a moment arrives -----------------------------------------------------


def test_a_turn_timing_arrives_when_the_arm_reaches_that_turn() -> None:
    moment = timing("at_turn:2")

    assert not is_due(moment, ORDER_ID, ArmProgress(ordinal=1))
    assert is_due(moment, ORDER_ID, ArmProgress(ordinal=2))


def test_a_turn_timing_stays_due_once_the_arm_has_passed_it() -> None:
    """An arm advanced twice before the fault fired must still meet it, not skip it."""
    assert is_due(timing("at_turn:1"), ORDER_ID, ArmProgress(ordinal=4))


def test_a_read_timing_arrives_only_after_this_arm_read_that_entity() -> None:
    moment = timing("after_first_read")

    assert not is_due(moment, ORDER_ID, ArmProgress(ordinal=0))
    assert not is_due(moment, ORDER_ID, ArmProgress(ordinal=0, read_entities=frozenset({uuid4()})))
    assert is_due(moment, ORDER_ID, ArmProgress(ordinal=0, read_entities=frozenset({ORDER_ID})))


def test_an_offset_timing_never_arrives_because_a_sandbox_has_no_clock() -> None:
    """Refused at experiment setup instead. Here it is simply a moment nothing observes."""
    moment = timing("at_offset:PT30M")

    assert moment.kind is MutationTimingKind.AT_OFFSET
    assert not is_due(moment, ORDER_ID, ArmProgress(ordinal=9, read_entities=frozenset({ORDER_ID})))


def test_a_moment_is_asked_of_a_timing_rather_than_of_a_string() -> None:
    with pytest.raises(MutationError):
        is_due("after_first_read", ORDER_ID, ArmProgress(ordinal=0))  # type: ignore[arg-type]


# -- what the write does -------------------------------------------------------


def order(**overrides: object) -> OrderFixturePayload:
    return paid_order(**overrides)


def test_the_fault_moves_the_order_one_step_along_its_graph() -> None:
    """One step, not a jump to the end: the redirect has to stay possible."""
    moved = advance_fulfilment(
        order(), event_id="mutation-order-moves", occurred_at="2026-08-30T09:00:00.000000Z"
    )

    assert moved.fulfilment.status is FulfilmentStatus.PARTIALLY_FULFILLED
    assert moved.fulfilment.allows_address_change


def test_the_step_records_the_history_that_explains_it() -> None:
    moved = advance_fulfilment(
        order(), event_id="mutation-order-moves", occurred_at="2026-08-30T09:00:00.000000Z"
    )

    appended = next(event for event in moved.events if event.id == "mutation-order-moves")
    assert appended.kind is OrderEventKind.SHIPPED
    assert appended.occurred_at == "2026-08-30T09:00:00.000000Z"
    assert moved.fulfilment.shipped_at == "2026-08-30T09:00:00.000000Z"


def test_the_fault_moves_where_the_order_is_and_never_where_it_ships() -> None:
    """The stale address is the incident; a fault that fixed it would delete the experiment."""
    before = order()

    moved = advance_fulfilment(
        before, event_id="mutation-order-moves", occurred_at="2026-08-30T09:00:00.000000Z"
    )

    assert moved.shipping_address == before.shipping_address
    assert moved.reference == before.reference
    assert moved.lines == before.lines


def test_a_second_step_fulfils_the_order_and_ends_the_redirect() -> None:
    partially = advance_fulfilment(
        order(), event_id="mutation-first", occurred_at="2026-08-30T09:00:00.000000Z"
    )

    fulfilled = advance_fulfilment(
        partially, event_id="mutation-second", occurred_at="2026-08-30T10:00:00.000000Z"
    )

    assert fulfilled.fulfilment.status is FulfilmentStatus.FULFILLED
    assert not fulfilled.fulfilment.allows_address_change


def test_an_order_the_graph_cannot_move_is_left_alone() -> None:
    """Nothing is recorded for a fault whose world has already moved past it."""
    with pytest.raises(MutationNotApplicableError):
        advance_fulfilment(
            order(fulfilment=FulfilmentState(status=FulfilmentStatus.FULFILLED)),
            event_id="mutation-order-moves",
            occurred_at="2026-08-30T09:00:00.000000Z",
        )


def test_an_out_of_band_write_carries_the_whole_order() -> None:
    with pytest.raises(MutationError):
        advance_fulfilment(
            "NS-10482",  # type: ignore[arg-type]
            event_id="mutation-order-moves",
            occurred_at="2026-08-30T09:00:00.000000Z",
        )
