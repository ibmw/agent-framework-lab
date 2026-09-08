"""The wrong-address incident as one declaration, run offline by every framework.

A two-arm comparison needs both arms to *do* the incident: read the context, read the
order, read the policy, read the customer, propose the redirect, and apply the confirmation
the proposal answered with. Neither offline model the adapters ship can do that. Pydantic
AI's `TestModel` and the scripted model beside it both call every offered tool once with
arguments sampled from its schema, which is the right double for proving that a tool
survives the round trip and the wrong one for proving that an incident was resolved: a
confirmation cannot be sampled, it has to be read back out of the proposal.

So the decisions are declared here, once, and each SDK's own offline seam is driven from
this one declaration. That is what makes the offline comparison honest about its own limit.
Both arms make the same choices *by construction*, so nothing the record shows can be read
as one framework choosing better than the other — and everything the record shows about
plumbing is a property of the frameworks rather than of two scripts that happen to agree.
What is left free to differ is exactly what each framework contributes: how many times it
called the provider, what it metered, and which project-owned adapter produced the turn.

A step whose arguments cannot be resolved is skipped rather than sent, which is how the
declared control policy already behaves (`infrastructure/agents/fake`): applying a
confirmation a refused proposal never issued would be a call the agent had no reason to
make, and an arm that made it would be compared on this module's clumsiness.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import cast

from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.sandbox_tool_contracts import (
    ADDRESS_CHANGE_APPLY,
    ADDRESS_CHANGE_PROPOSE,
    CUSTOMER_PROFILE,
    INTERACTION_CONTEXT,
    ORDER_DETAIL,
    SUPPORT_DOCUMENT,
)
from capability_lab.application.sandbox_tools import ToolOutcome

__all__ = [
    "INCIDENT_REPLY",
    "INCIDENT_SCRIPT",
    "INCIDENT_TOOLS",
    "IncidentDriver",
    "IncidentStep",
    "parse_result",
    "wire_name",
]

# The reference the ticket's trigger quotes, and the shop document the recipe puts in
# context. Both are the workspace's own fixture values (`workspace_factories`); the script
# quotes them rather than deriving them, so what each arm asks for is fixed by this file.
ORDER_REFERENCE = "NS-10482"
POLICY_DOCUMENT = "shipping"

INCIDENT_REPLY = (
    "I have checked order NS-10482 and made sure it ships to the address on your account."
)
"""What both arms answer with.

Identical on purpose. An offline model invents its words either way, and two invented
sentences differing would put a difference into the record that belongs to neither
framework — the reply is the one part of an arm's evidence recorded verbatim.
"""

# The separator every adapter rewrites a contract's namespace dot to, because providers
# accept `[A-Za-z0-9_-]` in a tool name. Spelled here too, because this module speaks to the
# SDKs and an SDK only ever sees the wire name.
_NAMESPACE_SEPARATOR = "__"


def wire_name(tool: str) -> str:
    return tool.replace(".", _NAMESPACE_SEPARATOR)


def parse_result(output: str) -> dict[str, CanonicalValue]:
    """One tool result as both adapters hand it back: the lab's own canonical text.

    Neither SDK decides this any more — an adapter renders the `tool-result-v1` document
    itself (`tool_json_schema`) — so one parse serves both drivers.
    """
    parsed: object = json.loads(output)
    return cast("dict[str, CanonicalValue]", parsed) if isinstance(parsed, dict) else {}


type Answers = Sequence[tuple[str, dict[str, CanonicalValue]]]
"""Every call this turn has already made, as (contract name, result document) in order."""


def _data(document: dict[str, CanonicalValue]) -> dict[str, CanonicalValue] | None:
    """The payload of a successful call, or nothing when the tool declined."""
    if document.get("outcome") != ToolOutcome.SUCCESS.value:
        return None
    data = document.get("data")
    return data if isinstance(data, dict) else None


def _answered(answers: Answers, tool: str) -> list[dict[str, CanonicalValue]]:
    """What one tool has successfully answered this turn, in the order it was asked."""
    return [
        data for name, document in answers if name == tool and (data := _data(document)) is not None
    ]


def _redirect(answers: Answers) -> dict[str, str] | None:
    """Propose the change to the customer's default address, once it is known."""
    for profile in _answered(answers, CUSTOMER_PROFILE):
        addresses = profile.get("addresses")
        if not isinstance(addresses, list):  # pragma: no cover - a profile lists its addresses
            continue
        for entry in addresses:
            if isinstance(entry, dict) and entry.get("is_default") is True:
                identifier = entry.get("id")
                if isinstance(identifier, str):
                    return {"order_reference": ORDER_REFERENCE, "address_id": identifier}
    return None


def _confirmation(answers: Answers) -> dict[str, str] | None:
    """The name the proposal issued, or nothing when the proposal was refused.

    Read back out of the proposal rather than computed, which is what makes it a consent
    binding rather than a value the caller chose (ADR 0022).
    """
    for proposal in _answered(answers, ADDRESS_CHANGE_PROPOSE):
        confirmation = proposal.get("confirmation")
        if isinstance(confirmation, str):
            return {"confirmation": confirmation}
    return None


@dataclass(frozen=True, slots=True)
class IncidentStep:
    """One call the incident makes, and the arguments this turn's answers allow it."""

    tool: str
    arguments: Callable[[Answers], dict[str, str] | None]


INCIDENT_SCRIPT: tuple[IncidentStep, ...] = (
    IncidentStep(INTERACTION_CONTEXT, lambda _answers: {}),
    IncidentStep(ORDER_DETAIL, lambda _answers: {"order_reference": ORDER_REFERENCE}),
    IncidentStep(
        SUPPORT_DOCUMENT,
        lambda _answers: {"kind": "policy", "document_id": POLICY_DOCUMENT},
    ),
    IncidentStep(CUSTOMER_PROFILE, lambda _answers: {}),
    IncidentStep(ADDRESS_CHANGE_PROPOSE, _redirect),
    IncidentStep(ADDRESS_CHANGE_APPLY, _confirmation),
)
"""The incident, in the order an agent has to ask it.

The order read comes second so that a fault bound to "after the first read of the order"
fires while the arm is still working, which is the moment ADR 0028 built the schedule to
reach.
"""

INCIDENT_TOOLS: tuple[str, ...] = tuple(step.tool for step in INCIDENT_SCRIPT)
"""Exactly the tools the script calls, which is what an arm running it enables."""


class IncidentDriver:
    """One turn's walk through the script, shared by both frameworks' offline models.

    Stateful and per turn, because an SDK's model seam is entered afresh on every provider
    call and has to be told where the incident had got to. It holds what it *asked* rather
    than counting what came back: a skipped step would otherwise slide the answers out of
    line with the steps that produced them.
    """

    def __init__(self) -> None:
        self._cursor = 0
        self._asked: list[str] = []

    def next_call(
        self, results: Sequence[dict[str, CanonicalValue]]
    ) -> tuple[str, dict[str, str]] | None:
        """The next call to make, given every result this turn has already seen.

        `results` arrives from the SDK's own message history in call order, so it pairs
        positionally with what this driver asked for. Answers nothing once the script is
        spent, which is the model's cue to reply.
        """
        answers = list(zip(self._asked, results, strict=False))
        while self._cursor < len(INCIDENT_SCRIPT):
            step = INCIDENT_SCRIPT[self._cursor]
            self._cursor += 1
            arguments = step.arguments(answers)
            if arguments is not None:
                self._asked.append(step.tool)
                return wire_name(step.tool), arguments
        return None
