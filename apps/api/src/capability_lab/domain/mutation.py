"""A scenario's mutations as they fire in a run: when a moment arrives, and what it moves.

ADR 0017 published the mutation template — what it perturbs, and the single timing
parameter that says when — and ADR 0018 let a scenario bind one to its own objects. Neither
made anything happen. This is what happens: given a bound moment and what one arm has done
so far, whether the moment has arrived, and given an order, the out-of-band write that
arrives with it.

Three rules live here rather than in the runtime that applies them.

**A moment is decided from the arm's own record, never from a clock.** An arm's ordinals and
its recorded reads are facts the lab wrote down; a wall-clock reading during a run is not
reproducible and would make the same scenario fire differently on a slower machine. Both
supported forms are therefore questions about evidence: which customer turn this arm has
reached, and whether it has already read the entity about to move.

**A mutation is invisible as a cause and undeniable as an effect.** It is never a tool, never
a message, and never announced to the agent (ADR 0017). What the arm can see is the world
afterwards — an order that now says something else — which is exactly what makes a mutation
a fault rather than an instruction.

**The out-of-band write obeys the same rules an authored order does.** It moves the
fulfilment status one step along the graph ADR 0015 published and records the event that
explains it, because an order an agent reads back has to describe a history a real order
could have had. An order the graph cannot move is left alone rather than forced: the fault
is asking for something that cannot happen, and saying so is better than inventing it.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import partial
from uuid import UUID

from capability_lab.domain.blocks import MutationTiming, MutationTimingKind
from capability_lab.domain.content import require_instance, require_non_negative_int
from capability_lab.domain.entities import DomainError
from capability_lab.domain.order_fixture import (
    FULFILMENT_EVIDENCE,
    FULFILMENT_TRANSITIONS,
    FulfilmentState,
    FulfilmentStatus,
    OrderEvent,
    OrderFixturePayload,
)

__all__ = [
    "ArmProgress",
    "MutationError",
    "MutationNotApplicableError",
    "advance_fulfilment",
    "is_due",
]


class MutationError(DomainError):
    """Raised when a mutation would be judged or applied incoherently."""


class MutationNotApplicableError(MutationError):
    """Raised when the world is not in a state this mutation can move.

    A refusal aimed at the scenario rather than at the arm: the agent did nothing wrong, and
    an order that has already been fulfilled cannot be fulfilled again. The runtime records
    nothing, which is the honest answer — the fault did not fire.
    """


_require_instance = partial(require_instance, error=MutationError)
_require_non_negative_int = partial(require_non_negative_int, error=MutationError)


@dataclass(frozen=True, slots=True)
class ArmProgress:
    """How far one arm has got, in the two terms a bound moment is expressed in.

    `ordinal` is the customer turn this arm is working on — the last one it received, which
    is also the one it is about to answer. `read_entities` are the entities this arm has
    already read through a tool, across every attempt it has made, because a fault bound to
    "after the first read" is about what the agent has seen rather than about which attempt
    saw it.
    """

    ordinal: int
    read_entities: frozenset[UUID] = frozenset()

    def __post_init__(self) -> None:
        _require_non_negative_int(self.ordinal, "arm progress ordinal")
        _require_instance(
            self.read_entities, frozenset, "read entities must be a frozen set of identifiers"
        )

    def has_read(self, entity_id: UUID | None) -> bool:
        return entity_id is not None and entity_id in self.read_entities


def is_due(timing: MutationTiming, target: UUID | None, progress: ArmProgress) -> bool:
    """Whether this bound moment has arrived for this arm.

    `at_offset` answers `False` here rather than raising: the sandbox has no clock to
    measure an offset against, so nothing this build can observe makes it arrive. That an
    experiment may not *start* with one is the runtime's gate to enforce, said once where an
    operator can read it, instead of a silent never inside the schedule.
    """
    _require_instance(timing, MutationTiming, "a mutation must carry its bound moment")
    match timing.kind:
        case MutationTimingKind.AFTER_FIRST_READ:
            return progress.has_read(target)
        case MutationTimingKind.AT_TURN:
            return timing.turn is not None and progress.ordinal >= timing.turn
        case MutationTimingKind.AT_OFFSET:
            return False


def advance_fulfilment(
    payload: OrderFixturePayload, *, event_id: str, occurred_at: str
) -> OrderFixturePayload:
    """Move the order one step along its fulfilment graph, out of band.

    The one entity mutation this milestone applies, and it is deliberately a *step* rather
    than a jump to the end. An unfulfilled order becomes partially fulfilled: its revision
    moves, so an agent holding a proposal computed a moment ago now holds a stale one — which
    is what the template promises and what ADR 0022 built the conflict refusal for — while
    the redirect itself stays legal, so the incident remains winnable by an agent that
    notices and re-reads. A fault that made the goal unreachable would be measuring the
    scenario rather than the agent.

    Run twice, it does end the incident: the second step fulfils the order, and a fulfilled
    order can no longer be redirected. That escalation is the graph's, not this function's.

    `shipped_at` is the moment the mutation fired rather than an authored time, because this
    movement happens during the run: an arm that reads the order back sees when it shipped,
    and it shipped now.
    """
    _require_instance(payload, OrderFixturePayload, "an out-of-band write carries the whole order")
    nowhere_to_go = not FULFILMENT_TRANSITIONS[payload.fulfilment.status]
    if nowhere_to_go:
        raise MutationNotApplicableError(
            f"order {payload.reference} is already {payload.fulfilment.status.value} and cannot "
            "move any further"
        )
    # The graph answers with a set, and a fault has to be reproducible: the next status in
    # declaration order is the smallest step it offers, and declaration order is how the
    # statuses were written down as a progression in the first place.
    moved_to = next(
        status
        for status in FulfilmentStatus
        if status in FULFILMENT_TRANSITIONS[payload.fulfilment.status]
    )
    events = (
        *payload.events,
        OrderEvent(
            id=event_id,
            kind=FULFILMENT_EVIDENCE[moved_to],
            occurred_at=occurred_at,
            summary=(
                f"Order {payload.reference} moved to {moved_to.value.replace('_', ' ')} "
                "while support was handling it."
            ),
        ),
    )
    return OrderFixturePayload(
        reference=payload.reference,
        customer_profile_id=payload.customer_profile_id,
        currency=payload.currency,
        placed_at=payload.placed_at,
        lines=payload.lines,
        payment=payload.payment,
        fulfilment=FulfilmentState(
            status=moved_to,
            method_id=payload.fulfilment.method_id,
            method_name=payload.fulfilment.method_name,
            shipped_at=occurred_at,
        ),
        shipping_fee=payload.shipping_fee,
        # Unchanged, deliberately. The fault moves where the order *is*, never where it is
        # going: the stale address is the incident, and a fault that quietly fixed it would
        # delete the thing the experiment is comparing.
        shipping_address=payload.shipping_address,
        events=tuple(sorted(events, key=lambda event: (event.occurred_at, event.id))),
    )
