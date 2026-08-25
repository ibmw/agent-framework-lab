"""The starting state a published scenario version materializes into.

A sandbox snapshot is the canonical immutable starting state of an experiment (ADR 0011).
It exists because a published scenario version is *not* one on its own: the recipe names
its shop, its ticket, and its templates by pinned version, but it names an order fixture by
identifier only, and an order fixture is authored state that keeps moving after the
publication (ADR 0015).

So the snapshot draws one line through the inputs: **copy what a run can mutate, pin what a
run can only read.** The catalog, the policies, the ticket thread, the customer profile, and
every composed template are already immutable published versions, so the snapshot records
the pin and never a second copy that could disagree with it. The order fixtures are not, so
the snapshot freezes the exact documents it saw.

The interaction reference is the third thing a snapshot holds, and it is deliberately
minimal: the origin kind plus at most one identifier. An arm resolves "this product" or
"this order" through tools against the state around it, so the starting state names the
resource and never embeds a copy of it (ADR 0016).
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import partial
from uuid import UUID

from capability_lab.domain.content import require_instance
from capability_lab.domain.entities import DomainError
from capability_lab.domain.order_fixture import OrderFixturePayload
from capability_lab.domain.shop import SupportChannel
from capability_lab.domain.ticket import TicketOrigin, TicketPayload

__all__ = [
    "SandboxConfigurationError",
    "SandboxInteraction",
    "SandboxOrder",
    "SandboxState",
    "resolve_interaction",
]


class SandboxConfigurationError(DomainError):
    """Raised when starting state would be frozen with a reference nothing answers."""


_require_instance = partial(require_instance, error=SandboxConfigurationError)


@dataclass(frozen=True, slots=True)
class SandboxInteraction:
    """Where the customer was and how they reached support, as identifiers only.

    The same minimal reference the ticket authored (ADR 0016), carried into the starting
    state so a read tool can answer "this product" or "this order" without the trigger
    prompt embedding either resource.
    """

    origin: TicketOrigin
    channel: SupportChannel
    ticket_reference: str

    def __post_init__(self) -> None:
        _require_instance(self.origin, TicketOrigin, "a sandbox interaction must name its origin")
        _require_instance(
            self.channel, SupportChannel, "a sandbox interaction must name its channel"
        )


@dataclass(frozen=True, slots=True)
class SandboxOrder:
    """One order fixture, frozen as it read at materialization."""

    order_id: UUID
    payload: OrderFixturePayload

    def __post_init__(self) -> None:
        _require_instance(self.order_id, UUID, "a sandbox order must be named by its order ID")
        _require_instance(
            self.payload, OrderFixturePayload, "a sandbox order must carry its frozen document"
        )


@dataclass(frozen=True, slots=True)
class SandboxState:
    """The commerce world one experiment starts from, for one customer of one shop.

    Order membership is a rule rather than a selection: **every order the ticket's customer
    holds in this shop enters the snapshot**, not only the ones the recipe names. An arm can
    list a customer's orders, and a sandbox that held only the referenced ones would answer
    that question differently from the shop the incident was authored in.
    """

    customer_profile_id: UUID
    interaction: SandboxInteraction
    orders: tuple[SandboxOrder, ...] = ()

    def __post_init__(self) -> None:
        _require_instance(
            self.customer_profile_id, UUID, "sandbox state must name its customer profile"
        )
        _require_instance(
            self.interaction, SandboxInteraction, "sandbox state must carry its interaction"
        )
        identifiers = [order.order_id for order in self.orders]
        if len(set(identifiers)) != len(identifiers):
            raise SandboxConfigurationError("sandbox orders must be unique")
        if sorted(identifiers, key=str) != identifiers:
            raise SandboxConfigurationError("sandbox orders must be ordered by order ID")
        for order in self.orders:
            if order.payload.customer_profile_id != self.customer_profile_id:
                raise SandboxConfigurationError(
                    f"order {order.order_id} belongs to another customer and cannot enter "
                    "this sandbox"
                )
        origin_order = self.interaction.origin.order_id
        if origin_order is not None and origin_order not in set(identifiers):
            # The publish gate and the materialization gate both report this as a finding;
            # reaching the constructor with it means a caller skipped them.
            raise SandboxConfigurationError(
                f"the interaction started from order {origin_order}, which is not in the sandbox"
            )

    def order(self, order_id: UUID) -> SandboxOrder | None:
        return next((order for order in self.orders if order.order_id == order_id), None)


def resolve_interaction(ticket: TicketPayload) -> SandboxInteraction:
    """Read the starting interaction reference off the frozen ticket."""
    return SandboxInteraction(
        origin=ticket.origin, channel=ticket.channel, ticket_reference=ticket.reference
    )
