"""One judge execution: what was scored, by which published judge, against what input.

ADR 0030 said an evaluation is a projection and stores nothing, because a deterministic
outcome is a function of a record that only grows. A judge's verdict is not that. It is a
model's reading, produced once, at a cost, and not reproducible by re-deriving it from the
record — so it *is* a record, and this is its shape.

Four rules live here.

**A verdict is tied to what produced it.** The judge configuration and its exact version,
the provider and model that ran, and the fingerprint of the anonymized brief the judge was
shown all travel with the outcome. "The judge said missed" is not evidence; "this rubric at
version 2, on this model, shown this exact input, said missed" is.

**A rerun is an attempt beside the last, never over it.** Judging is nondeterministic and
rerunnable by design (`docs/PLAN.md` Milestone 5), so attempts count from one within
`(run, objective)` and the record keeps every one. What an evaluation reads is the latest;
what an operator can audit is all of them.

**A failed execution is a row too, and it is not a verdict.** A judge the provider refused
says nothing about the arm, so the outcome is absent and a classified failure takes its
place. An evaluation reading a failed attempt leaves the objective deferred — exactly where
it stood before anyone tried — which is what keeps the lab's own outage off the arm's
scorecard.

**The rationale is the judge's words, and it is bounded.** It exists because a verdict with
no reason is a score, which is the one thing this lab refuses to produce. It is not parsed,
not counted, and never treated as a fact about the world.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from functools import partial
from uuid import UUID

from capability_lab.domain.content import (
    require_identifier,
    require_instance,
    require_label,
    require_slug,
    require_text,
)
from capability_lab.domain.entities import DomainError
from capability_lab.domain.judge import JudgeOutcome

__all__ = [
    "MAX_RATIONALE_LENGTH",
    "MIN_JUDGE_ATTEMPT",
    "JudgeFailure",
    "Judgement",
    "JudgementError",
]

MAX_RATIONALE_LENGTH = 2000
"""Long enough to explain a verdict, short enough that nobody mistakes it for a transcript."""

MIN_JUDGE_ATTEMPT = 1

_FINGERPRINT_PATTERN = re.compile(r"[0-9a-f]{64}")


def _require_fingerprint(value: object, field_name: str) -> None:
    """A SHA-256 hex digest, checked the way every other field is checked.

    Takes `object` rather than `str` for the reason the `require_*` helpers do: the type
    annotation is a claim about the caller, and this is the check that makes it true — a
    non-string reaching the pattern would raise `TypeError` from inside `re` instead of the
    domain error every other invariant here raises.
    """
    if not isinstance(value, str) or _FINGERPRINT_PATTERN.fullmatch(value) is None:
        raise JudgementError(f"{field_name} must be a SHA-256 hex digest")


class JudgementError(DomainError):
    """Raised when a judge execution would be recorded incoherently."""


_require_identifier = partial(require_identifier, error=JudgementError)
_require_instance = partial(require_instance, error=JudgementError)
_require_label = partial(require_label, error=JudgementError)
_require_slug = partial(require_slug, error=JudgementError)
_require_text = partial(require_text, error=JudgementError)


class JudgeFailure(StrEnum):
    """Why one judge execution produced no verdict.

    The same taxonomy an agent turn uses, minus the two that cannot happen: a judge runs no
    tools, so there is no round limit, and it is not a framework integration in the sense an
    arm's runtime is. Kept as its own enum rather than shared with `AgentTurnFailure`
    because these are failures of the *evaluator*, and a comparison that counted them
    together with an arm's failures would put the lab's outage in the agent's column.
    """

    PROVIDER = "provider"
    """The provider rejected the request. Running it again unchanged will fail again."""

    TRANSIENT = "transient"
    """The provider was briefly unavailable; a rerun may succeed."""

    INVALID_RESPONSE = "invalid_response"
    """The judge answered outside the verdict vocabulary, or in a shape the lab cannot read."""


@dataclass(frozen=True, slots=True)
class Judgement:
    """One execution of one published judge against one objective of one arm.

    `objective_id` is the scenario's own name for the bound objective, so a judgement is
    addressed the way a matrix row is. `attempt` counts from one within `(run, objective)`:
    scoring the same row again is a new attempt, and the record keeps what the last one
    said.
    """

    objective_id: str
    judge_id: UUID
    judge_version: int
    provider: str
    model_id: str
    brief_fingerprint: str
    attempt: int = MIN_JUDGE_ATTEMPT
    outcome: JudgeOutcome | None = None
    rationale: str = ""
    failure: JudgeFailure | None = None

    def __post_init__(self) -> None:
        _require_slug(self.objective_id, "judged objective ID")
        _require_instance(self.judge_id, UUID, "a judgement must name the judge that produced it")
        if isinstance(self.judge_version, bool) or self.judge_version < 1:
            raise JudgementError("a judgement must name a published judge version")
        _require_identifier(self.provider, "judge provider")
        _require_label(self.model_id, "judge model ID")
        _require_fingerprint(self.brief_fingerprint, "the fingerprint of the brief it read")
        if isinstance(self.attempt, bool) or self.attempt < MIN_JUDGE_ATTEMPT:
            raise JudgementError(f"a judgement's attempt counts from {MIN_JUDGE_ATTEMPT}")
        if self.outcome is None:
            self._failed()
            return
        self._scored()

    def _scored(self) -> None:
        _require_instance(self.outcome, JudgeOutcome, "a judgement carries a supported outcome")
        if self.failure is not None:
            raise JudgementError("a scored judgement names no failure; it is what the judge said")
        _require_text(self.rationale, "judge rationale", allow_empty=True)
        if len(self.rationale) > MAX_RATIONALE_LENGTH:
            raise JudgementError(
                f"a judge rationale must contain at most {MAX_RATIONALE_LENGTH} characters"
            )

    def _failed(self) -> None:
        """A failed execution carries a code and no words.

        No rationale, for the reason a failed agent turn carries no body: a provider's error
        text is neither stable nor safe to store beside synthetic customer content, and a
        sentence in this field would be read as the judge's reasoning about the arm.
        """
        _require_instance(
            self.failure, JudgeFailure, "an unscored judgement must say why it produced no verdict"
        )
        if self.rationale:
            raise JudgementError("a failed judgement carries no rationale; nothing was scored")

    @property
    def scored(self) -> bool:
        """Whether this execution produced a verdict at all."""
        return self.outcome is not None
