"""The resolved world one tool call runs against, and the lookups every tool shares.

Extracted from `sandbox_tools` when the write tools arrived, because a reader and a writer
must resolve the same world the same way. An order named `NS-10482` has to mean one order
whether the agent is reading it or redirecting it; two copies of that lookup would be two
chances for `orders.read_order` and `orders.apply_address_change` to disagree about which
order the customer is talking about.

Nothing here decides anything. It is the context a handler is given and the lookups a
handler shares — the rules live in the domain, and what a handler may *do* with the context
is decided by its contract's declared effect (ADR 0021, ADR 0022).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from uuid import UUID

from capability_lab.application.sandbox_tool_contracts import (
    ToolRefusalCode,
    ToolRefusedError,
)
from capability_lab.domain.customer_profile import CustomerProfilePayload
from capability_lab.domain.sandbox import SandboxOrder, SandboxState
from capability_lab.domain.shop import ShopPayload
from capability_lab.domain.ticket import TicketPayload

__all__ = ["SandboxToolContext", "resolve_order"]


@dataclass(frozen=True, slots=True)
class SandboxToolContext:
    """Everything a tool may see: one arm's state and the versions behind it.

    The state is the arm's own mutable copy; the shop, the ticket, and the customer profile
    are the exact published versions the snapshot pinned, never the drafts they have since
    become. That is what makes a historical run explainable: the same arm answers the same
    way however far the authoring surface has moved on.
    """

    state: SandboxState
    shop: ShopPayload
    ticket: TicketPayload
    customer: CustomerProfilePayload


def resolve_order(state: SandboxState, arguments: Mapping[str, str]) -> SandboxOrder:
    """Find the order a call names, by the reference the customer quotes or by identifier.

    Both spellings are accepted because both are things an arm actually holds: the customer
    quotes `NS-10482` in the thread, and the interaction context carries an order ID. Naming
    it twice or not at all is refused rather than guessed — in a run these are model output,
    and an agent that filled the wrong field must be able to read what it did and retry.
    """
    reference = arguments.get("order_reference")
    identifier = arguments.get("order_id")
    if (reference is None) == (identifier is None):
        raise ToolRefusedError(
            ToolRefusalCode.INVALID_ARGUMENTS,
            "name the order either by 'order_reference' or by 'order_id', not by both "
            "and not by neither",
        )
    if identifier is not None:
        order = state.order(UUID(identifier))
        named = identifier
    else:
        order = next(
            (candidate for candidate in state.orders if candidate.payload.reference == reference),
            None,
        )
        named = str(reference)
    if order is None:
        # A sandbox holds one customer's whole order set, so "not one of theirs" and "no
        # such order" are the same answer here; there is no other customer to refuse on
        # behalf of.
        raise ToolRefusedError(ToolRefusalCode.NOT_FOUND, f"this customer holds no order {named!r}")
    return order
