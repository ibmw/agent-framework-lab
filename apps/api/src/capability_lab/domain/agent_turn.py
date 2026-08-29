"""What one arm's agent produced in reply to one customer turn.

The other half of the thread ADR 0025 opened. A run's customer side is a stream of
`ParticipantTurn`s — the ticket's trigger, then whatever the participant driver supplied —
and this is what the configured agent answered each of them with.

Three rules live here rather than in the runner that applies them.

**A reply is addressed to the customer turn it answers.** Its ordinal is not a counter of
its own: it is the ordinal of the participant turn it replies to. An arm therefore answers
each customer turn at most once, the two streams interleave without a shared sequence
nothing owns, and "this arm has not answered yet" is a question about the record rather
than about a status somebody has to remember to set.

**An attempt is evidence, not a retry hidden inside one.** A turn that failed is kept and
the next attempt is a new row, because "the model failed and the operator ran it again" is
one of the things an experiment is comparing. A model or framework failure must never
quietly become a successful result (`docs/architecture.md`), so the failure is recorded
with a code from a closed table and the reply body is absent — there is nothing the agent
said.

**A tool call belongs to the attempt that made it.** Its sequence is the order the agent
asked, inside one attempt, which is what makes tool selection and ordering comparable
evidence (`docs/product-direction.md`). The call's own content — which tool, at which
version, with what arguments, answered how — is deliberately *not* here: a tool contract is
declared in the application layer, so a record of one call is application evidence, and
what the domain owns is where the call sits in the arm's history.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from functools import partial

from capability_lab.domain.content import (
    require_instance,
    require_non_negative_int,
    require_text,
)
from capability_lab.domain.entities import DomainError

__all__ = [
    "MAX_AGENT_TURN_LENGTH",
    "MIN_ATTEMPT",
    "AgentTurn",
    "AgentTurnError",
    "AgentTurnFailure",
    "AgentTurnOutcome",
]

# An agent's reply is a chat message in the same thread the customer writes into, so it is
# bounded the same way a participant turn is. A model that would answer at greater length
# than the ticket thread can hold is answering the wrong question.
MAX_AGENT_TURN_LENGTH = 4000

MIN_ATTEMPT = 1


class AgentTurnError(DomainError):
    """Raised when an agent turn would be recorded incoherently."""


_require_instance = partial(require_instance, error=AgentTurnError)
_require_text = partial(require_text, error=AgentTurnError)
_require_non_negative_int = partial(require_non_negative_int, error=AgentTurnError)


class AgentTurnOutcome(StrEnum):
    """The two ways an attempt at one reply can end."""

    ANSWERED = "answered"
    """The agent produced a reply. What it says is evidence; that it exists is this."""

    FAILED = "failed"
    """The framework, the model, or a runtime limit ended the attempt. The arm is intact."""


class AgentTurnFailure(StrEnum):
    """Why an attempt failed, in a vocabulary a comparison can count.

    Deliberately about *where* the attempt broke rather than what the message said: a
    provider's error text is neither stable across models nor safe to store beside
    synthetic customer content, and an experiment reading two arms needs the kinds to line
    up. The four execution kinds mirror the error taxonomy the POC's conversation runner
    already answers with, so one failure means one thing across the lab.
    """

    MODEL_PROVIDER = "model_provider"
    """The provider rejected the request. Running it again unchanged will fail again."""

    MODEL_TRANSIENT = "model_transient"
    """The provider was briefly unavailable or a usage limit was hit; a retry may pass."""

    INVALID_RESPONSE = "invalid_response"
    """The model answered in a shape the lab cannot record — including saying nothing."""

    FRAMEWORK = "framework"
    """The framework could not execute the request. The lab's own integration is at fault."""

    TOOL_ROUND_LIMIT = "tool_round_limit"
    """The agent used the tool rounds its configuration allows without answering.

    A finding about the configuration rather than about the lab: the limit is a published
    runtime setting (ADR 0024), and an agent that keeps looking without concluding is one
    of the behaviors a comparison exists to make visible.
    """


@dataclass(frozen=True, slots=True)
class AgentTurn:
    """One attempt at one arm's reply to one customer turn.

    `ordinal` is the participant turn being answered, and `attempt` counts from one within
    it. Together with the run they are the identity of this row: the same arm answering the
    same customer turn a second time is a second attempt, never an overwrite of the first.
    """

    ordinal: int
    attempt: int
    outcome: AgentTurnOutcome
    body: str = ""
    failure: AgentTurnFailure | None = None

    def __post_init__(self) -> None:
        _require_non_negative_int(self.ordinal, "agent turn ordinal")
        _require_instance(self.outcome, AgentTurnOutcome, "an agent turn must declare an outcome")
        _require_non_negative_int(self.attempt, "agent turn attempt")
        if self.attempt < MIN_ATTEMPT:
            raise AgentTurnError(f"an agent turn's attempt counts from {MIN_ATTEMPT}")
        if self.outcome is AgentTurnOutcome.ANSWERED:
            self._answered()
            return
        self._failed()

    def _answered(self) -> None:
        if self.failure is not None:
            raise AgentTurnError("an answered turn names no failure; it is what the agent said")
        _require_text(self.body, "agent turn body")
        if len(self.body) > MAX_AGENT_TURN_LENGTH:
            raise AgentTurnError(
                f"an agent turn must contain at most {MAX_AGENT_TURN_LENGTH} characters"
            )

    def _failed(self) -> None:
        """A failed attempt carries a code and no words.

        No body, deliberately. A framework's exception text is not something the agent said,
        and storing it here would put it in a transcript an operator, a judge, and a later
        comparison all read as the reply — the same discipline that keeps a failed tool
        result from describing itself (ADR 0021).
        """
        _require_instance(
            self.failure, AgentTurnFailure, "a failed turn must say where the attempt broke"
        )
        if self.body:
            raise AgentTurnError("a failed turn carries no reply; the agent never produced one")
