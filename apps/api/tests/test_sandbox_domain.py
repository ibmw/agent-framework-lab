"""The structural invariants of frozen starting state (ADR 0019) and its clones (ADR 0020)."""

from uuid import UUID, uuid4

import pytest

from capability_lab.domain.order_fixture import OrderFixturePayload
from capability_lab.domain.sandbox import (
    Sandbox,
    SandboxConfigurationError,
    SandboxInteraction,
    SandboxMutationError,
    SandboxOrder,
    SandboxState,
    resolve_interaction,
)
from capability_lab.domain.shop import SupportChannel
from capability_lab.domain.ticket import TicketOrigin, TicketOriginKind
from order_factories import CUSTOMER_ID, frozen_address, paid_order
from ticket_factories import publishable_ticket

ORDER_ID = UUID("4b7c0c2e-1f2a-4c3d-8e5f-6a7b8c9d0e1f")
OTHER_ORDER_ID = UUID("9f8e7d6c-5b4a-4938-8271-605f4e3d2c1b")


def interaction(**overrides: object) -> SandboxInteraction:
    fields: dict[str, object] = {
        "origin": TicketOrigin(kind=TicketOriginKind.SUPPORT_ENTRY),
        "channel": SupportChannel.EMAIL,
        "ticket_reference": "T-204",
    }
    fields.update(overrides)
    return SandboxInteraction(**fields)  # type: ignore[arg-type]


def sandbox_order(order_id: UUID = ORDER_ID, **overrides: object) -> SandboxOrder:
    return SandboxOrder(order_id=order_id, payload=paid_order(**overrides))


def test_orders_are_ordered_and_unique() -> None:
    ordered = tuple(
        sorted(
            (sandbox_order(), sandbox_order(OTHER_ORDER_ID, reference="NS-10500")),
            key=lambda order: str(order.order_id),
        )
    )
    state = SandboxState(customer_profile_id=CUSTOMER_ID, interaction=interaction(), orders=ordered)
    assert [order.order_id for order in state.orders] == [order.order_id for order in ordered]

    with pytest.raises(SandboxConfigurationError, match="ordered by order ID"):
        SandboxState(
            customer_profile_id=CUSTOMER_ID,
            interaction=interaction(),
            orders=tuple(reversed(ordered)),
        )
    with pytest.raises(SandboxConfigurationError, match="unique"):
        SandboxState(
            customer_profile_id=CUSTOMER_ID,
            interaction=interaction(),
            orders=(sandbox_order(), sandbox_order()),
        )


def test_a_sandbox_holds_one_customer_only() -> None:
    """An arm that could reach another customer's order would leave the incident."""
    with pytest.raises(SandboxConfigurationError, match="another customer"):
        SandboxState(
            customer_profile_id=uuid4(),
            interaction=interaction(),
            orders=(sandbox_order(),),
        )


def test_the_interaction_order_must_be_in_the_sandbox() -> None:
    origin = TicketOrigin(kind=TicketOriginKind.ORDER_PAGE, order_id=ORDER_ID)
    SandboxState(
        customer_profile_id=CUSTOMER_ID,
        interaction=interaction(origin=origin),
        orders=(sandbox_order(),),
    )
    with pytest.raises(SandboxConfigurationError, match="not in the sandbox"):
        SandboxState(customer_profile_id=CUSTOMER_ID, interaction=interaction(origin=origin))


def test_the_interaction_is_read_off_the_frozen_ticket() -> None:
    ticket = publishable_ticket(
        origin=TicketOrigin(
            kind=TicketOriginKind.PRODUCT_PAGE, product_handle="alpine-shell-jacket"
        )
    )
    resolved = resolve_interaction(ticket)
    assert resolved.origin.product_handle == "alpine-shell-jacket"
    assert resolved.origin.order_id is None
    assert resolved.channel is ticket.channel
    assert resolved.ticket_reference == ticket.reference


def test_a_sandbox_order_is_found_by_its_identifier() -> None:
    state = SandboxState(
        customer_profile_id=CUSTOMER_ID, interaction=interaction(), orders=(sandbox_order(),)
    )
    found = state.order(ORDER_ID)
    assert found is not None
    assert found.payload.reference == "NS-10482"
    assert state.order(OTHER_ORDER_ID) is None


# -- the clone one arm works in (ADR 0020) ---------------------------------


def cloned(*orders: SandboxOrder) -> Sandbox:
    return Sandbox(
        state=SandboxState(
            customer_profile_id=CUSTOMER_ID,
            interaction=interaction(),
            orders=orders or (sandbox_order(),),
        )
    )


def moved_to_lyon() -> OrderFixturePayload:
    return paid_order(
        shipping_address=frozen_address(
            source_address_id="lyon-current-flat",
            source_label="Lyon — current flat",
            line1="12 rue de la République",
            postal_code="69002",
            city="Lyon",
        )
    )


def test_a_clone_starts_at_revision_zero_and_a_change_advances_it() -> None:
    start = cloned()
    assert start.revision == 0

    moved = start.with_order(ORDER_ID, moved_to_lyon())

    assert moved.revision == 1
    order = moved.order(ORDER_ID)
    assert order is not None
    assert order.payload.shipping_address is not None
    assert order.payload.shipping_address.city == "Lyon"


def test_a_change_leaves_the_state_it_was_applied_to_alone() -> None:
    """The isolation between two arms rests on this: a change is a new value."""
    start = cloned()

    start.with_order(ORDER_ID, moved_to_lyon())

    unchanged = start.order(ORDER_ID)
    assert unchanged is not None
    assert unchanged.payload.shipping_address is not None
    assert unchanged.payload.shipping_address.city == "Bordeaux"
    assert start.revision == 0


def test_a_change_keeps_the_order_ordering_a_snapshot_froze() -> None:
    first, second = sorted(
        (sandbox_order(), sandbox_order(OTHER_ORDER_ID, reference="NS-10500")),
        key=lambda order: str(order.order_id),
    )
    start = cloned(first, second)

    moved = start.with_order(first.order_id, paid_order(reference=first.payload.reference))

    assert [order.order_id for order in moved.state.orders] == [first.order_id, second.order_id]


def test_a_run_cannot_introduce_an_order_the_sandbox_never_held() -> None:
    with pytest.raises(SandboxMutationError, match="cannot introduce one"):
        cloned().with_order(OTHER_ORDER_ID, paid_order(reference="NS-10500"))


def test_a_run_cannot_renumber_an_order_or_move_it_to_another_customer() -> None:
    start = cloned()

    with pytest.raises(SandboxMutationError, match="keeps the reference"):
        start.with_order(ORDER_ID, paid_order(reference="NS-99999"))
    with pytest.raises(SandboxMutationError, match="another customer"):
        start.with_order(ORDER_ID, paid_order(customer_profile_id=uuid4()))


def test_a_revision_is_never_negative() -> None:
    with pytest.raises(SandboxMutationError, match="non-negative"):
        Sandbox(state=cloned().state, revision=-1)
