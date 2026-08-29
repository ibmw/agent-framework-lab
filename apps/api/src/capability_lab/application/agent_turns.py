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
    """One attempt at one arm's reply, with when it was made."""

    run_id: UUID
    experiment_id: UUID
    turn: AgentTurn
    created_at: datetime


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
