"""The record one judge execution leaves, and the append-only store that keeps it.

Split out from the service that produces them and the evaluation that reads them back, in
the same shape as an agent turn and its tool calls (ADR 0026): the judge service writes
them while scoring, and the evaluation projects them into the matrix rows they fill, so an
operator reads one table rather than two that could disagree.

The store is append-only per `(run, objective, attempt)`. Nothing is ever updated: a
rerun writes attempt *n+1* and the previous verdict stays exactly as it was recorded, which
is what makes "the judge changed its mind when we reran it" a readable fact rather than a
lost one.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from capability_lab.application.definition_resolution import DefinitionResolutionError
from capability_lab.domain.judgement import Judgement

__all__ = ["JudgementConflictError", "JudgementRecord", "JudgementRepository"]


class JudgementConflictError(DefinitionResolutionError):
    """Raised when another scoring pass wrote the attempt this one had counted on.

    The attempt a pass writes is one past the highest it read, so two passes running at once
    compute the same number and the second insert meets the primary key. That is the store
    refusing to overwrite a verdict, which is the rule this table exists to keep — but it has
    to reach the operator as a conflict they can act on ("someone scored this; read it and
    score again") rather than as an opaque failure.
    """


@dataclass(frozen=True, slots=True)
class JudgementRecord:
    """One judge execution as it is stored, bound to the arm whose record it read."""

    run_id: UUID
    experiment_id: UUID
    judgement: Judgement
    created_at: datetime


class JudgementRepository(Protocol):
    """Append-only per arm and objective; the attempt is what makes a rerun a new row."""

    def list_for_experiment(self, experiment_id: UUID) -> tuple[JudgementRecord, ...]:
        """Every execution against this experiment, oldest attempt first."""
        ...

    def append_all(self, records: tuple[JudgementRecord, ...]) -> tuple[JudgementRecord, ...]:
        """Write one scoring pass together, after every verdict in it is known.

        Raises `JudgementConflictError` when an attempt this pass numbered has already been
        written, which is how a concurrent pass is reported rather than silently overwritten.
        """
        ...
