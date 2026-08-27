"""What may be done to the address an order ships to, and what it does to the order.

The one commerce mutation this milestone grants an arm. It is deliberately narrow: an
order's shipping address is **reselected** from the customer's address book, never typed
in. `FrozenShippingAddress` cannot even hold a free-input address — it requires the entry
it was copied from — so the rule ADR 0015 wrote for the order editor is the same rule a
run obeys, enforced by the same type rather than by a second check that could disagree.

Everything here is a pure function of the order and the address book around it. That is
what makes the milestone's acceptance criterion — "backend rules reject unsafe or stale
address changes regardless of model output" — a property of the domain rather than a
promise the tool layer makes: a model that asks for a shipped order to be redirected is
refused by the same code whatever it said to ask for it.

Three rules refuse, and each answers a different question about the world:

- **Too late.** Goods already fully in transit cannot be redirected, so a change is only
  allowed while the order is still `ADDRESS_CHANGEABLE`.
- **Over.** A refunded order is finished; where it would have shipped is no longer a
  question.
- **Nothing to change.** Reselecting the address the order already ships to is refused
  rather than silently applied, because it would append history saying something happened
  when nothing did. The comparison is against the *frozen copy*, not against the entry's
  identity: an order that froze `home` before the entry was edited genuinely moves when
  `home` is reselected, and that is a real change rather than a no-op.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from capability_lab.domain.customer_profile import AddressEntry, CustomerProfilePayload
from capability_lab.domain.entities import DomainError
from capability_lab.domain.order_fixture import (
    ADDRESS_CHANGEABLE_STATUSES,
    FrozenShippingAddress,
    OrderEvent,
    OrderEventKind,
    OrderFixturePayload,
    PaymentStatus,
)

__all__ = [
    "AddressChangePlan",
    "AddressChangeRefusal",
    "AddressChangeRefusalCode",
    "AddressChangeRefusedError",
    "apply_address_change",
    "freeze_address",
    "plan_address_change",
]


class AddressChangeRefusalCode(StrEnum):
    """Why an address change may not be made, in a vocabulary a caller can branch on."""

    ADDRESS_NOT_IN_BOOK = "address_not_in_book"
    """The customer's address book holds no entry with that ID."""

    ORDER_ALREADY_SHIPPED = "order_already_shipped"
    """The goods have left; where they were sent is now history rather than a choice."""

    ORDER_REFUNDED = "order_refunded"
    """The order is over, so it has no shipping destination left to argue about."""

    NOTHING_TO_CHANGE = "nothing_to_change"
    """The order already ships to exactly this address, copy for copy."""


@dataclass(frozen=True, slots=True)
class AddressChangeRefusal:
    code: AddressChangeRefusalCode
    message: str


class AddressChangeRefusedError(DomainError):
    """A change the domain will not make, carrying the reason a caller reports."""

    def __init__(self, code: AddressChangeRefusalCode, message: str) -> None:
        super().__init__(message)
        self.refusal = AddressChangeRefusal(code=code, message=message)


@dataclass(frozen=True, slots=True)
class AddressChangePlan:
    """One permitted change, resolved but not yet applied.

    It holds the *entry* rather than a frozen copy on purpose: freezing stamps the moment
    of selection, and a plan has not been selected yet. Two arms planning the same change
    against the same order therefore hold equal plans, which is what lets a proposal be
    named by its content instead of by a clock.
    """

    order_id: UUID
    reference: str
    current: FrozenShippingAddress | None
    entry: AddressEntry


def plan_address_change(
    order_id: UUID,
    payload: OrderFixturePayload,
    profile: CustomerProfilePayload,
    address_id: str,
) -> AddressChangePlan:
    """Resolve the change, or refuse it. Nothing here touches the order.

    Raises `AddressChangeRefusedError` for every reason the change may not be made, so a
    caller reports one vocabulary rather than inspecting statuses itself.
    """
    entry = next((candidate for candidate in profile.addresses if candidate.id == address_id), None)
    if entry is None:
        raise AddressChangeRefusedError(
            AddressChangeRefusalCode.ADDRESS_NOT_IN_BOOK,
            f"this customer's address book holds no entry {address_id!r}",
        )
    if payload.payment.status is PaymentStatus.REFUNDED:
        raise AddressChangeRefusedError(
            AddressChangeRefusalCode.ORDER_REFUNDED,
            f"order {payload.reference} has been refunded and no longer ships anywhere",
        )
    if payload.fulfilment.status not in ADDRESS_CHANGEABLE_STATUSES:
        raise AddressChangeRefusedError(
            AddressChangeRefusalCode.ORDER_ALREADY_SHIPPED,
            f"order {payload.reference} is {payload.fulfilment.status.value} and can no longer "
            "be redirected",
        )
    current = payload.shipping_address
    if current is not None and _is_same_place(current, entry):
        raise AddressChangeRefusedError(
            AddressChangeRefusalCode.NOTHING_TO_CHANGE,
            f"order {payload.reference} already ships to exactly this address",
        )
    return AddressChangePlan(
        order_id=order_id, reference=payload.reference, current=current, entry=entry
    )


def freeze_address(entry: AddressEntry, selected_at: str) -> FrozenShippingAddress:
    """Copy one address-book entry onto an order, labeled with where it came from.

    The single place a `FrozenShippingAddress` is made, shared by the order editor and by
    the run-time change, so an order authored in the Studio and an order redirected by an
    agent hold the same shape of copy.
    """
    return FrozenShippingAddress(
        source_address_id=entry.id,
        source_label=entry.label,
        selected_at=selected_at,
        recipient=entry.recipient,
        line1=entry.line1,
        postal_code=entry.postal_code,
        city=entry.city,
        country=entry.country,
        line2=entry.line2,
        region=entry.region,
    )


def apply_address_change(
    payload: OrderFixturePayload,
    plan: AddressChangePlan,
    *,
    event_id: str,
    occurred_at: str,
    actor: str,
) -> OrderFixturePayload:
    """Redirect the order and record that it happened.

    The event is not decoration. `ADDRESS_UPDATED` is the history an agent reads back
    through `orders.read_order`, the evidence a deterministic evaluation reads in
    Milestone 5, and the only thing distinguishing an order that was redirected from one
    authored at its destination in the first place. So the write is the address *and* the
    line explaining it, never one without the other.
    """
    events = (
        *payload.events,
        OrderEvent(
            id=event_id,
            kind=OrderEventKind.ADDRESS_UPDATED,
            occurred_at=occurred_at,
            summary=f"Shipping address changed to '{plan.entry.label}' by {actor}.",
        ),
    )
    return OrderFixturePayload(
        reference=payload.reference,
        customer_profile_id=payload.customer_profile_id,
        currency=payload.currency,
        placed_at=payload.placed_at,
        lines=payload.lines,
        payment=payload.payment,
        fulfilment=payload.fulfilment,
        shipping_fee=payload.shipping_fee,
        shipping_address=freeze_address(plan.entry, occurred_at),
        events=tuple(sorted(events, key=lambda event: (event.occurred_at, event.id))),
    )


def _is_same_place(frozen: FrozenShippingAddress, entry: AddressEntry) -> bool:
    """Whether reselecting this entry would leave the order shipping exactly where it is.

    `selected_at` is excluded because it records when the copy was taken rather than where
    the parcel goes, and `source_label` is included because it is part of the copy the
    order carries and an agent can read.
    """
    return (
        frozen.source_address_id == entry.id
        and frozen.source_label == entry.label
        and frozen.recipient == entry.recipient
        and frozen.line1 == entry.line1
        and frozen.line2 == entry.line2
        and frozen.postal_code == entry.postal_code
        and frozen.city == entry.city
        and frozen.region == entry.region
        and frozen.country == entry.country
    )
