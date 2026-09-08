"""The deterministic control arm: a declared policy, not a model.

`PROVEN_FRAMEWORKS` already calls this framework "the control arm for deterministic runs"
(ADR 0024). This is what that means for an experiment: an arm whose behavior is written
down here, runs offline, produces the same tool calls and the same words every time, and
therefore makes the *rest* of the lab falsifiable — a difference between two runs of this
framework is a difference in the world or in the configuration, never in the agent.

The policy, in full, and deliberately short enough to state:

1. read the interaction context, and take the order the incident opened from;
2. read that order;
3. read the customer, and find their default address;
4. if the order does not ship to that default address, propose the change and apply the
   confirmation the proposal answered with;
5. say what it found and what it did.

Every step is skipped when the configuration does not enable the tool it needs, and every
step that depends on an earlier answer is skipped when that answer was refused. That is the
point of a control arm rather than a fixed script: two configurations of this framework
differing only in their tool bindings genuinely behave differently, so a comparison over
the tool dimension is a real comparison before a single model is called.

It calls no model, so the usage it reports is zeros rather than nothing — the one arm in the
lab whose cost is known exactly.

What it deliberately is not: intelligent. It does not read the customer's words, because a
fake that appeared to understand them would invite exactly the interpretation of a result
that a fake cannot support. It acts on the state of the world, which it can actually see.
"""

from __future__ import annotations

from capability_lab.application.agent_capabilities import FAKE_FRAMEWORK_ID
from capability_lab.application.agent_runtime import (
    AgentAnswer,
    AgentTurnRequest,
    SandboxToolInvoker,
    SupportAgentRuntime,
)
from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.model_cost import ModelUsage
from capability_lab.application.sandbox_tool_contracts import (
    ADDRESS_CHANGE_APPLY,
    ADDRESS_CHANGE_PROPOSE,
    CUSTOMER_PROFILE,
    INTERACTION_CONTEXT,
    ORDER_DETAIL,
)
from capability_lab.application.sandbox_tools import ToolOutcome

__all__ = ["FAKE_RUNTIME_FRAMEWORK_ID", "FakeSupportAgentRuntime"]

FAKE_RUNTIME_FRAMEWORK_ID = FAKE_FRAMEWORK_ID
"""Named out of the capability catalog rather than spelled again here (ADR 0041)."""


class FakeSupportAgentRuntime(SupportAgentRuntime):
    """Run the declared policy against one arm and report what it saw."""

    @property
    def framework_id(self) -> str:
        return FAKE_RUNTIME_FRAMEWORK_ID

    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> AgentAnswer:
        offered = frozenset(contract.name for contract in request.tools)
        seen = _Findings()

        if INTERACTION_CONTEXT in offered:
            context = _data(tools.invoke(INTERACTION_CONTEXT, {}))
            if context is not None:
                seen.order_reference = _order_reference(context)

        if ORDER_DETAIL in offered and seen.order_reference is not None:
            order = _data(tools.invoke(ORDER_DETAIL, {"order_reference": seen.order_reference}))
            if order is not None:
                seen.ships_to = _text(order, "ships_to")
                seen.shipping_address_id = _shipping_address_id(order)

        if CUSTOMER_PROFILE in offered:
            profile = _data(tools.invoke(CUSTOMER_PROFILE, {}))
            if profile is not None:
                seen.default_address_id, seen.default_address = _default_address(profile)

        if self._should_redirect(offered, seen):
            seen.redirected = self._redirect(tools, seen)

        # Zero rather than nothing. This arm calls no provider, which is a fact about it
        # and not an absence of information: a control arm costs nothing, and a comparison
        # should read that as "$0.00" rather than as "the lab could not say" (`model_cost`).
        return AgentAnswer(body=seen.reply(), usage=ModelUsage.none())

    @staticmethod
    def _should_redirect(offered: frozenset[str], seen: _Findings) -> bool:
        """Both write tools, an order, a default address, and an actual disagreement.

        The disagreement is the whole condition. An arm that proposed a change to the
        address the order already uses would be doing something the domain refuses anyway,
        and a control arm that spent a write on it would make every run's evidence carry a
        refusal that says more about this policy than about the incident.
        """
        return (
            ADDRESS_CHANGE_PROPOSE in offered
            and ADDRESS_CHANGE_APPLY in offered
            and seen.order_reference is not None
            and seen.default_address_id is not None
            and seen.shipping_address_id != seen.default_address_id
        )

    @staticmethod
    def _redirect(tools: SandboxToolInvoker, seen: _Findings) -> bool:
        """Propose, then apply the confirmation that proposal answered with.

        Never a confirmation of its own making: the string is read back out of the proposal,
        which is what makes it a consent binding rather than a value the agent chose
        (ADR 0022). A refused proposal ends the attempt to write — there is nothing to
        confirm — and the arm is left exactly where the read found it.
        """
        proposed = tools.invoke(
            ADDRESS_CHANGE_PROPOSE,
            {
                "order_reference": str(seen.order_reference),
                "address_id": str(seen.default_address_id),
            },
        )
        proposal = _data(proposed)
        if proposal is None:
            return False
        confirmation = _text(proposal, "confirmation")
        if confirmation is None:  # pragma: no cover - a proposal always names itself
            return False
        applied = _data(tools.invoke(ADDRESS_CHANGE_APPLY, {"confirmation": confirmation}))
        return applied is not None


class _Findings:
    """What the policy learned, and the sentence it turns into."""

    def __init__(self) -> None:
        self.order_reference: str | None = None
        self.ships_to: str | None = None
        self.shipping_address_id: str | None = None
        self.default_address_id: str | None = None
        self.default_address: str | None = None
        self.redirected = False

    def reply(self) -> str:
        """One sentence per thing that actually happened, in a fixed order.

        Fixed so the reply is a function of the world rather than of the order the policy
        happened to ask: two runs against one starting state produce identical bytes, which
        is what makes this arm usable as a control.
        """
        if self.order_reference is None:
            return (
                "I could not find an order for this conversation, so I have nothing to check yet."
            )
        lines = [f"I found order {self.order_reference}."]
        if self.ships_to is not None:
            lines.append(f"It ships to {self.ships_to}.")
        if self.redirected:
            lines.append(
                f"I have redirected it to {self.default_address}. "
                "Nothing else about the order changes."
            )
        elif self.default_address is not None and self.shipping_address_id == (
            self.default_address_id
        ):
            lines.append("That is already the address on file, so I have changed nothing.")
        return " ".join(lines)


def _data(document: dict[str, CanonicalValue]) -> dict[str, CanonicalValue] | None:
    """The payload of a successful call, or nothing when the tool declined.

    A refusal is read as "this step produced nothing" rather than as an error, which is what
    ADR 0021 built refusals to be: an answer the agent acts on. The policy's next dependent
    step simply does not happen.
    """
    if document.get("outcome") != ToolOutcome.SUCCESS.value:
        return None
    data = document.get("data")
    return data if isinstance(data, dict) else None


def _text(document: dict[str, CanonicalValue], key: str) -> str | None:
    value = document.get(key)
    return value if isinstance(value, str) else None


def _order_reference(context: dict[str, CanonicalValue]) -> str | None:
    """The order the incident opened from, or the first one the ticket links.

    The origin first, because an incident opened on an order page is about that order; the
    linked orders after it, because a ticket opened from a product page still names the
    order it is about.
    """
    origin = context.get("origin")
    if isinstance(origin, dict):
        reference = _text(origin, "order_reference")
        if reference is not None:
            return reference
    linked = context.get("linked_orders")
    if isinstance(linked, list):
        for entry in linked:
            if isinstance(entry, dict):
                reference = _text(entry, "order_reference")
                if reference is not None:
                    return reference
    return None


def _shipping_address_id(order: dict[str, CanonicalValue]) -> str | None:
    """Which address-book entry the order's frozen copy came from, if it names one."""
    address = order.get("shipping_address")
    return None if not isinstance(address, dict) else _text(address, "source_address_id")


def _default_address(profile: dict[str, CanonicalValue]) -> tuple[str | None, str | None]:
    """The customer's default address-book entry: its ID and how it reads."""
    addresses = profile.get("addresses")
    if not isinstance(addresses, list):  # pragma: no cover - a profile always lists addresses
        return None, None
    for entry in addresses:
        if isinstance(entry, dict) and entry.get("is_default") is True:
            return _text(entry, "id"), _single_line(entry)
    return None, None


def _single_line(entry: dict[str, CanonicalValue]) -> str:
    """The address as one line, in the order an address is written."""
    return ", ".join(
        part
        for part in (
            _text(entry, "line1"),
            _text(entry, "line2"),
            " ".join(
                piece for piece in (_text(entry, "postal_code"), _text(entry, "city")) if piece
            ),
            _text(entry, "country"),
        )
        if part
    )
