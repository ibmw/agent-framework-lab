"""The judge as a versioned experiment input, and the verdict it is allowed to return.

ADR 0030 left every objective a scenario marked `judge` sitting in a `deferred` row: a
question the lab had asked and had no one to answer. This is the answerer, and it is a
definition for the same reason an agent configuration is one — a result explained by "a
model scored it" is not explained at all, so what scored it has to be an authored,
published, immutable input a historical evaluation can name.

Four rules shape the payload.

**The verdict vocabulary is the lab's, never the rubric's.** `JudgeOutcome` is a closed
set of three, and a judge configuration cannot add a fourth or rename one. An objective's
outcome is a cell in one matrix beside deterministic rows (ADR 0030), so a judge that
invented its own scale would be reporting in units nothing else in the lab uses.

**"Unclear" is one of the three, deliberately.** A judge forced to choose between met and
missed guesses when the record does not say, and a guess recorded as a miss is precisely
the leaderboard scoring `docs/PLAN.md` refuses. A judge that cannot tell says so, and the
row reports that rather than counting against the arm.

**What the judge is shown is authored, and it is the comparison variable that matters.**
A judge reading only the words scores a different question from one reading the calls
beside them, so the evidence scope is part of the published version and part of its
fingerprint — two runs of "the same judge" that saw different things are not the same
judge.

**A rubric may not name a framework, a model, or an arm.** That is checked outside this
module, where the catalog of what the lab runs lives, but the reason is here: the input is
anonymized so the judge scores behavior rather than a label, and a rubric that says
"prefer the Pydantic AI arm" would defeat every other precaution in one sentence.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from functools import partial

from capability_lab.domain.content import (
    require_identifier,
    require_instance,
    require_label,
    require_text,
    require_unique,
)
from capability_lab.domain.definitions import (
    DefinitionChange,
    DefinitionChangeKind,
    DefinitionIssue,
    DefinitionValidation,
    field_changes,
    issue_error,
    issue_warning,
    validation_of,
)
from capability_lab.domain.entities import DomainError


class JudgeConfigurationError(DomainError):
    """Raised when judge-configuration content violates a structural invariant."""


_error_type = JudgeConfigurationError
_require_identifier = partial(require_identifier, error=_error_type)
_require_instance = partial(require_instance, error=_error_type)
_require_label = partial(require_label, error=_error_type)
_require_text = partial(require_text, error=_error_type)
_require_unique = partial(require_unique, error=_error_type)

MAX_RUBRIC_LENGTH = 8000
"""A rubric is prose about how to read a record; longer than a label, shorter than a prompt."""

MAX_TEMPERATURE = Decimal("2")


class JudgeOutcome(StrEnum):
    """What one judge execution may answer, and nothing else.

    Three values, closed and lab-owned. `UNCLEAR` is not a failure of the judge: it is the
    honest reading of a record that does not settle the question, and it keeps a model from
    being asked to guess in a matrix cell an operator will read as evidence.
    """

    MET = "met"
    MISSED = "missed"
    UNCLEAR = "unclear"


class JudgeEvidenceScope(StrEnum):
    """One part of an arm's record a judge configuration may ask to be shown.

    Every member is something the lab already records and can anonymize. There is
    deliberately no "everything" member: a scope that grew silently when a new kind of
    record was added would change what a published judge sees without a new version.
    """

    CUSTOMER_TURNS = "customer_turns"
    """What the participant said to this arm, in the order it was said."""

    AGENT_REPLIES = "agent_replies"
    """What this arm answered. Absent, the judge scores conduct without the words."""

    TOOL_CALLS = "tool_calls"
    """Which published tools this arm called, with what arguments, and how each answered."""

    STATE_CHANGES = "state_changes"
    """Which calls moved this arm's world, read from the revisions they recorded."""


@dataclass(frozen=True, slots=True)
class JudgeModel:
    """The model that scores, and the temperature it scores at.

    Deliberately not `ModelSettings`: a judge calls no tools, so a tool-round limit would be
    a field no judge could ever spend. Sharing the agent's type to save a dataclass would
    have put a meaningless number into every published judge's fingerprint.
    """

    provider: str
    model_id: str
    temperature: Decimal = Decimal("0.00")

    def __post_init__(self) -> None:
        _require_identifier(self.provider, "judge model provider")
        _require_label(self.model_id, "judge model ID")
        _require_instance(self.temperature, Decimal, "judge temperature must be a finite decimal")
        if not self.temperature.is_finite() or not 0 <= self.temperature <= MAX_TEMPERATURE:
            raise JudgeConfigurationError(
                f"judge temperature must be a finite decimal between 0 and {MAX_TEMPERATURE}"
            )
        exponent = self.temperature.as_tuple().exponent
        if not isinstance(exponent, int) or exponent < -2:
            raise JudgeConfigurationError(
                "judge temperature cannot have more than two fractional digits"
            )

    @property
    def canonical_temperature(self) -> str:
        """The decimal string the canonical document carries; ADR 0007 forbids floats."""
        return f"{self.temperature:.2f}"


@dataclass(frozen=True, slots=True)
class JudgeConfigurationPayload:
    """The complete authored content of one judge-configuration draft or version."""

    name: str
    model: JudgeModel
    description: str = ""
    rubric: str = ""
    evidence: tuple[JudgeEvidenceScope, ...] = ()

    def __post_init__(self) -> None:
        _require_label(self.name, "judge configuration name")
        _require_instance(self.model, JudgeModel, "a judge configuration must declare a model")
        _require_text(self.description, "judge configuration description", allow_empty=True)
        _require_text(self.rubric, "judge rubric", allow_empty=True)
        if len(self.rubric) > MAX_RUBRIC_LENGTH:
            raise JudgeConfigurationError(
                f"a judge rubric must contain at most {MAX_RUBRIC_LENGTH} characters"
            )
        for scope in self.evidence:
            _require_instance(scope, JudgeEvidenceScope, "judge evidence scope")
        _require_unique(tuple(scope.value for scope in self.evidence), "judge evidence scopes")
        # Ticking two boxes in either order is one configuration, so it must reach one
        # fingerprint. Normalized here rather than in the codec, for the reason the agent
        # configuration normalizes its tools: the typed value and its document say one thing.
        object.__setattr__(self, "evidence", tuple(sorted(self.evidence)))

    @property
    def scopes(self) -> frozenset[JudgeEvidenceScope]:
        return frozenset(self.evidence)

    def shows(self, scope: JudgeEvidenceScope) -> bool:
        return scope in self.scopes


def validate_judge_configuration(payload: JudgeConfigurationPayload) -> DefinitionValidation:
    """Report every publish-gate finding a judge's own content can produce.

    What the lab can actually run and what a rubric may not name are the surrounding world's
    answers — the catalog of proven providers and the catalog of frameworks the arms run
    both live in the application layer — and the authoring service adds them.
    """
    return validation_of(list(judge_configuration_issues(payload)))


def judge_configuration_issues(
    payload: JudgeConfigurationPayload,
) -> tuple[DefinitionIssue, ...]:
    """The payload-only findings, unsorted, so a caller can add its own before ordering."""
    issues: list[DefinitionIssue] = []

    if not payload.rubric:
        issues.append(
            issue_error(
                "rubric_empty",
                "a published judge must carry the rubric it scores by",
                "rubric",
            )
        )

    if not payload.evidence:
        issues.append(
            issue_error(
                "evidence_scope_empty",
                "a judge shown nothing about the run cannot score anything",
                "evidence",
            )
        )
    elif not payload.shows(JudgeEvidenceScope.AGENT_REPLIES):
        # Not an error: a judge scoring conduct from the calls alone is a legitimate rubric,
        # and one an operator may deliberately want. It is a warning because it is the one
        # scope whose absence is easy to leave in place by accident.
        issues.append(
            issue_warning(
                "evidence_without_agent_replies",
                "this judge never reads what the arm said, so it scores the calls alone",
                "evidence",
            )
        )

    return tuple(issues)


def summarize_judge_configuration_changes(
    previous: JudgeConfigurationPayload | None, current: JudgeConfigurationPayload
) -> tuple[DefinitionChange, ...]:
    """Describe what publishing this draft would freeze, against the latest version."""
    if previous is None:
        return (
            DefinitionChange(
                kind=DefinitionChangeKind.ADDED,
                path="",
                description=f"First published version of {current.name}",
            ),
        )

    changes: list[DefinitionChange] = []
    changes.extend(
        field_changes(
            "",
            (
                ("name", previous.name, current.name),
                ("description", previous.description, current.description),
                ("rubric", previous.rubric, current.rubric),
            ),
            lambda name: f"Updated {name.replace('_', ' ')}",
        )
    )
    changes.extend(
        field_changes(
            "model",
            (
                ("provider", previous.model.provider, current.model.provider),
                ("model_id", previous.model.model_id, current.model.model_id),
                ("temperature", previous.model.temperature, current.model.temperature),
            ),
            lambda name: f"Updated judge model {name.replace('_', ' ')}",
        )
    )
    for scope in sorted(current.scopes - previous.scopes):
        changes.append(
            DefinitionChange(
                kind=DefinitionChangeKind.ADDED,
                path=f"evidence.{scope.value}",
                description=f"Now shows {scope.value.replace('_', ' ')}",
            )
        )
    for scope in sorted(previous.scopes - current.scopes):
        changes.append(
            DefinitionChange(
                kind=DefinitionChangeKind.REMOVED,
                path=f"evidence.{scope.value}",
                description=f"No longer shows {scope.value.replace('_', ' ')}",
            )
        )
    return tuple(changes)


__all__ = [
    "MAX_RUBRIC_LENGTH",
    "JudgeConfigurationError",
    "JudgeConfigurationPayload",
    "JudgeEvidenceScope",
    "JudgeModel",
    "JudgeOutcome",
    "judge_configuration_issues",
    "summarize_judge_configuration_changes",
    "validate_judge_configuration",
]
