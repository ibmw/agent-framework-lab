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

A snapshot is starting state, not the state a run works in. `Sandbox` below is that second
thing: one arm's independently mutable copy of a snapshot, which a run moves and the arm
beside it never sees (ADR 0020).
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import partial
from uuid import UUID

from capability_lab.domain.content import require_instance, require_non_negative_int
from capability_lab.domain.entities import DomainError
from capability_lab.domain.order_fixture import OrderFixturePayload
from capability_lab.domain.shop import SupportChannel
from capability_lab.domain.ticket import TicketOrigin, TicketPayload

__all__ = [
    "Sandbox",
    "SandboxConfigurationError",
    "SandboxInteraction",
    "SandboxMutationError",
    "SandboxOrder",
    "SandboxState",
    "resolve_interaction",
]


class SandboxConfigurationError(DomainError):
    """Raised when starting state would be frozen with a reference nothing answers."""


class SandboxMutationError(SandboxConfigurationError):
    """Raised when a change would take a sandbox outside the world it was cloned from."""


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


@dataclass(frozen=True, slots=True)
class Sandbox:
    """One arm's independently mutable copy of a snapshot's starting state.

    A snapshot is shared by every arm and never moves; a sandbox is what one arm works in.
    Cloning is a copy rather than a reference precisely so that a write in one arm cannot be
    seen from the other — the isolation an experiment's comparison rests on.

    The value is immutable in the ordinary Python sense: a change returns the next sandbox
    and leaves this one alone, so the snapshot it was cloned from is structurally
    unreachable from any later revision.

    `revision` counts applied changes and starts at zero. It is the optimistic-concurrency
    token a writer presents: two tools that read the same sandbox and both write must not
    both win, and the loser is told rather than silently overwritten.
    """

    state: SandboxState
    revision: int = 0

    def __post_init__(self) -> None:
        _require_instance(self.state, SandboxState, "a sandbox must carry its state")
        require_non_negative_int(self.revision, "sandbox revision", error=SandboxMutationError)

    def with_order(self, order_id: UUID, payload: OrderFixturePayload) -> Sandbox:
        """Replace one order's document, and refuse what a run may not do to it.

        Every commerce write an arm can make lands here, because an order fixture document
        is the whole of the mutable commerce world a sandbox holds. The rules are about
        identity rather than content: a run changes what an order *says*, never which order
        it is or whose it is.
        """
        _require_instance(
            payload, OrderFixturePayload, "a sandbox order must carry its whole document"
        )
        current = self.order(order_id)
        if current is None:
            raise SandboxMutationError(
                f"order {order_id} is not in this sandbox; a run cannot introduce one"
            )
        if payload.reference != current.payload.reference:
            raise SandboxMutationError(
                f"order {order_id} keeps the reference the customer and the agent quote"
            )
        if payload.customer_profile_id != current.payload.customer_profile_id:
            raise SandboxMutationError(
                f"order {order_id} cannot move to another customer inside a sandbox"
            )
        return Sandbox(
            state=SandboxState(
                customer_profile_id=self.state.customer_profile_id,
                interaction=self.state.interaction,
                orders=tuple(
                    SandboxOrder(order_id=order_id, payload=payload)
                    if order.order_id == order_id
                    else order
                    for order in self.state.orders
                ),
            ),
            revision=self.revision + 1,
        )

    def order(self, order_id: UUID) -> SandboxOrder | None:
        return self.state.order(order_id)


def resolve_interaction(ticket: TicketPayload) -> SandboxInteraction:
    """Read the starting interaction reference off the frozen ticket."""
    return SandboxInteraction(
        origin=ticket.origin, channel=ticket.channel, ticket_reference=ticket.reference
    )
