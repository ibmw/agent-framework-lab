"""Judging one arm against the objectives its scenario composed.

ADR 0017 published the objective template — how it is assessed and what evidence that
assessment reads — and ADR 0018 let a scenario bind one to its own objects with a severity.
Neither decided anything. This is the decision: given what an arm's record says happened and
whether the arm can still act, what each bound objective is now.

Three rules live here rather than in the reader that gathers the evidence.

**Deterministic evidence is monotone, so "not yet" is not "no".** An arm that has not read
the policy document may still read it on its next turn. The outcome is therefore `PENDING`
until the arm can no longer act, and only then does an unmet objective become `MISSED`. The
inverse holds for something forbidden: the moment it occurs the objective is missed, and no
later turn can unmake it.

**An arm can no longer act when it reaches its scenario's turn cap.** That is the one half of
`CompletionConditions` this build decides: the cap is a number the runtime can count, while
the completion *statement* is prose about whether the incident was resolved, which is a
judge's reading (`docs/PLAN.md` Milestone 5). An objective settled by a cap is settled by
something both arms met identically, which is what keeps completion out of the comparison.

**A severity decides what a miss costs, never whether it is a miss.** A missed `expected`
objective is recorded exactly as a missed `required` one; what differs is that only the
required one makes the arm's run a failure. The read/no-read fact is the evidence either way
(ADR 0017), so the two must not be judged differently.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from functools import partial
from uuid import UUID

from capability_lab.domain.blocks import (
    ObjectiveAssessment,
    ObjectiveEvidence,
    ObjectiveSeverity,
)
from capability_lab.domain.content import require_instance, require_non_negative_int, require_slug
from capability_lab.domain.entities import DomainError

__all__ = [
    "ArmEvaluation",
    "EvaluationError",
    "EvidencePolarity",
    "ObjectiveOutcome",
    "ObjectiveResult",
    "decide",
]


class EvaluationError(DomainError):
    """Raised when an arm's judgement would be recorded incoherently."""


_require_instance = partial(require_instance, error=EvaluationError)
_require_non_negative_int = partial(require_non_negative_int, error=EvaluationError)
_require_slug = partial(require_slug, error=EvaluationError)


class ObjectiveOutcome(StrEnum):
    """Where one bound objective stands for one arm.

    Five values rather than a pass/fail, because three of the things an operator needs to
    tell apart are not verdicts. An objective nothing has decided yet, one a judge will
    decide, and one no evidence this build reads can decide are three different states, and
    collapsing any of them into "failed" would report the lab's own limits as the agent's.
    """

    MET = "met"
    """The evidence says it happened — or, for a forbidden objective, that it never did."""

    MISSED = "missed"
    """The evidence says it did not happen and the arm can no longer make it happen."""

    PENDING = "pending"
    """Not yet, and the arm still can. Never a verdict."""

    DEFERRED = "deferred"
    """A judge decides this one, and the judge is a slice of its own."""

    UNDECIDABLE = "undecidable"
    """No evidence this build reads decides it. A statement about the lab, not the arm."""


class EvidencePolarity(StrEnum):
    """What an observation means for the objective that asked for it.

    The evidence kind says *where to look*; this says what the answer means when it is found.
    `FORBIDDEN` differs from `EVENT` in exactly this and in nothing else, which is why the two
    share every reader (ADR 0030).
    """

    MUST_OCCUR = "must_occur"
    MUST_NOT_OCCUR = "must_not_occur"


def decide(polarity: EvidencePolarity, *, observed: bool, settled: bool) -> ObjectiveOutcome:
    """What one objective is, given the evidence and whether the arm can still act.

    `settled` is the arm's, not the objective's: every objective of an arm that has reached
    its cap settles at once, because what settles them is that nothing more will happen.
    """
    _require_instance(polarity, EvidencePolarity, "an objective must declare what it asks for")
    if polarity is EvidencePolarity.MUST_OCCUR:
        if observed:
            return ObjectiveOutcome.MET
        return ObjectiveOutcome.MISSED if settled else ObjectiveOutcome.PENDING
    if observed:
        # No later turn can unmake it, so this is a verdict even mid-run.
        return ObjectiveOutcome.MISSED
    return ObjectiveOutcome.MET if settled else ObjectiveOutcome.PENDING


@dataclass(frozen=True, slots=True)
class ObjectiveResult:
    """One bound objective as one arm's record answers it.

    `detail` is the sentence the evidence made — which call answered it, or which call was
    never made. It is the whole reason a matrix cell is readable: "missed" beside "the
    address-change policy was never read" is a finding, and "missed" on its own is a score.
    """

    objective_id: str
    block_id: UUID
    block_version: int
    statement: str
    severity: ObjectiveSeverity
    assessment: ObjectiveAssessment
    evidence: ObjectiveEvidence
    outcome: ObjectiveOutcome
    detail: str

    def __post_init__(self) -> None:
        _require_slug(self.objective_id, "bound objective ID")
        _require_instance(self.block_id, UUID, "an objective result must name its template")
        _require_non_negative_int(self.block_version, "objective template version")
        _require_instance(
            self.severity, ObjectiveSeverity, "an objective result carries a severity"
        )
        _require_instance(
            self.assessment, ObjectiveAssessment, "an objective result carries an assessment"
        )
        _require_instance(self.evidence, ObjectiveEvidence, "an objective result carries evidence")
        _require_instance(self.outcome, ObjectiveOutcome, "an objective result carries an outcome")

    @property
    def failed(self) -> bool:
        """Whether this miss is one the scenario said must not happen."""
        return (
            self.outcome is ObjectiveOutcome.MISSED and self.severity is ObjectiveSeverity.REQUIRED
        )


@dataclass(frozen=True, slots=True)
class ArmEvaluation:
    """Every objective of one arm, and whether that arm can still move.

    The counts are properties rather than fields for the reason ADR 0027 gave a projection:
    two stored numbers beside the rows they count are two chances to disagree with them.
    """

    run_id: UUID
    settled: bool
    results: tuple[ObjectiveResult, ...] = ()

    def __post_init__(self) -> None:
        _require_instance(self.run_id, UUID, "an evaluation must name the arm it judged")
        _require_instance(self.settled, bool, "an evaluation must say whether the arm can act")
        for result in self.results:
            _require_instance(result, ObjectiveResult, "an evaluation holds objective results")

    @property
    def decided(self) -> tuple[ObjectiveResult, ...]:
        """The objectives this build actually answered, which is what a count is out of."""
        return tuple(
            result
            for result in self.results
            if result.outcome in {ObjectiveOutcome.MET, ObjectiveOutcome.MISSED}
        )

    @property
    def met(self) -> int:
        return sum(1 for result in self.decided if result.outcome is ObjectiveOutcome.MET)

    @property
    def failed(self) -> bool:
        """Whether any required objective is missed, which is what makes a run a failure."""
        return any(result.failed for result in self.results)
