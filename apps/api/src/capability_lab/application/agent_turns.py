"""The records one arm's agent produces, and the append-only stores that keep them.

Split out from the runner that writes them and the service that reads them back, because
both need these shapes and neither should have to import the other. The runner produces an
attempt and its calls; `ExperimentService` serves them beside the customer turns they
answer, so one read of an experiment is one thread rather than two half-threads a client
has to stitch together.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.model_cost import ModelUsage
from capability_lab.application.sandbox_tools import ToolOutcome
from capability_lab.domain.agent_turn import AgentTurn

__all__ = [
    "AgentTurnRecord",
    "AgentTurnRepository",
    "ToolEvent",
    "ToolEventRecord",
    "ToolEventRepository",
]


@dataclass(frozen=True, slots=True)
class AgentTurnRecord:
    """One attempt at one arm's reply, with when it was made and what it cost.

    The measurements sit here rather than on `AgentTurn` deliberately: the domain turn is
    what the agent did — which question it answered, in which attempt, with what words or
    which failure code — and a duration is not part of that. It is operational metadata of
    exactly the kind `created_at` already is, and putting it in the domain would make an
    arm's history depend on how fast the machine that produced it was.

    Both are absent rather than zero when the lab does not know them: `duration_ms` on a row
    written before the lab measured, and `usage` on a framework that does not meter itself
    (`model_cost`). A zero would understate a total, and a total is what a comparison reads.
    """

    run_id: UUID
    experiment_id: UUID
    turn: AgentTurn
    created_at: datetime
    duration_ms: int | None = None
    """Wall-clock milliseconds from before the runtime was started to after it returned.

    The whole attempt including every tool call it made, because that is what an operator
    waited for. What the tools took of it is on the events below, so time spent asking the
    world can be separated from time spent at the model without a second measurement of
    either."""

    usage: ModelUsage | None = None


@dataclass(frozen=True, slots=True)
class ToolEvent:
    """One tool call an attempt made, and what it did to the arm.

    `document` is the `tool-result-v1` envelope the tool answered with (ADR 0021), stored
    whole. The columns beside it — the tool, its version, the outcome — are read out of it
    rather than decided again, exactly as an experiment's provenance columns are read out of
    its document.

    The two revisions are the state change. A read leaves them equal; the one write this
    milestone publishes moves the arm by one, and the confirmation that authorized it is
    inside the document, so "confirmations and state changes" are recorded without a second
    record shape that could disagree with the first.
    """

    ordinal: int
    attempt: int
    sequence: int
    tool: str
    version: str
    outcome: ToolOutcome
    document: dict[str, CanonicalValue]
    revision_before: int
    revision_after: int
    state_fingerprint: str
    duration_ms: int | None = None
    """Wall-clock milliseconds this one call took, measured by the invoker that made it.

    On the event rather than on the attempt because a call is what it measures: two arms
    that asked the same tool the same number of times and waited differently for it are
    telling a comparison something, and an attempt total could not say which call it was."""

    @property
    def moved_the_arm(self) -> bool:
        return self.revision_after != self.revision_before


@dataclass(frozen=True, slots=True)
class ToolEventRecord:
    """One tool event as it is stored, bound to the run and attempt that made it."""

    run_id: UUID
    experiment_id: UUID
    event: ToolEvent
    created_at: datetime


class AgentTurnRepository(Protocol):
    """Append-only per run; `(run, ordinal, attempt)` is the identity of one attempt."""

    def list_for_experiment(self, experiment_id: UUID) -> tuple[AgentTurnRecord, ...]: ...

    def append(self, record: AgentTurnRecord) -> AgentTurnRecord: ...


class ToolEventRepository(Protocol):
    """Append-only per attempt; the sequence is the order the agent asked."""

    def list_for_experiment(self, experiment_id: UUID) -> tuple[ToolEventRecord, ...]: ...

    def append_all(self, records: tuple[ToolEventRecord, ...]) -> tuple[ToolEventRecord, ...]:
        """Write one attempt's calls together, after the attempt they belong to."""
        ...
