"""What the lab has proven it can judge with, and what a rubric may never say.

A declaration table in the same spirit as `agent_capabilities` and `sandbox_tool_contracts`:
the publish gate reads it without importing an adapter, an SDK, or a provider, and stays
testable offline. "Proven" means the lab runs the combination and has tests that keep running
it, which is a property of this project rather than of a provider's marketing.

The anonymization rule lives here too, because it is the one gate finding that needs to know
what the *arms* run. A rubric that names a framework, a model, or an arm label is asking the
judge to score the label instead of the behavior — which would defeat the anonymized brief in
one sentence, and would do it silently, since nothing downstream can tell a rubric's words
apart from a judge's reasoning. So it is refused at publication, where the author can still
fix it, rather than reported after a run.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from decimal import Decimal
from types import MappingProxyType

from capability_lab.application.agent_capabilities import PROVEN_FRAMEWORKS
from capability_lab.domain.definitions import DefinitionIssue, issue_error, issue_warning
from capability_lab.domain.judge import JudgeConfigurationPayload, JudgeEvidenceScope, JudgeModel

__all__ = [
    "CONTROL_JUDGE_PROVIDER",
    "DEFAULT_JUDGE_MODEL",
    "OPENAI_JUDGE_PROVIDER",
    "PROVEN_JUDGES",
    "PROVEN_JUDGES_BY_PROVIDER",
    "ProvenJudge",
    "default_judge_model",
    "judge_capability_issues",
    "reserved_rubric_terms",
]

CONTROL_JUDGE_PROVIDER = "fake"
OPENAI_JUDGE_PROVIDER = "openai"


@dataclass(frozen=True, slots=True)
class ProvenJudge:
    """One provider the lab can score with, and the models it has been proven on."""

    provider: str
    label: str
    models: tuple[str, ...]
    summary: str


PROVEN_JUDGES: tuple[ProvenJudge, ...] = (
    ProvenJudge(
        provider=OPENAI_JUDGE_PROVIDER,
        label="OpenAI",
        models=("gpt-5-mini",),
        summary="The lab's first judge, structured output over an anonymized brief.",
    ),
    ProvenJudge(
        provider=CONTROL_JUDGE_PROVIDER,
        label="Deterministic control",
        models=("deterministic",),
        summary=(
            "Offline judge with no model call: it reads the brief by a declared rule, so an "
            "evaluation stays runnable and testable without a provider."
        ),
    ),
)

PROVEN_JUDGES_BY_PROVIDER: Mapping[str, ProvenJudge] = MappingProxyType(
    {judge.provider: judge for judge in PROVEN_JUDGES}
)

DEFAULT_JUDGE_MODEL = JudgeModel(
    provider=OPENAI_JUDGE_PROVIDER,
    model_id="gpt-5-mini",
    temperature=Decimal("0.00"),
)
"""What a new draft starts on: the combination the lab already runs, at zero temperature.

Zero because a judge is rerun to see whether a verdict holds, and a judge that varied for
its own reasons would make every rerun unreadable. It is authored rather than forced — an
author who wants a warmer judge may have one, and the version records it.
"""

DEFAULT_JUDGE_EVIDENCE: tuple[JudgeEvidenceScope, ...] = (
    JudgeEvidenceScope.CUSTOMER_TURNS,
    JudgeEvidenceScope.AGENT_REPLIES,
    JudgeEvidenceScope.TOOL_CALLS,
)
"""What a new draft is shown: the incident as a conversation, with the calls beside it.

State changes are off by default because they are the one scope deterministic evidence
already answers completely (ADR 0030): an author who turns them on is deliberately asking a
judge to weigh what the arm moved, rather than getting it by accident.
"""


def default_judge_model() -> JudgeModel:
    return DEFAULT_JUDGE_MODEL


def reserved_rubric_terms() -> tuple[str, ...]:
    """Every word a rubric may not contain, read off what the arms actually run.

    Derived from `PROVEN_FRAMEWORKS` rather than listed, so the day a second framework joins
    the lab its name is refused in a rubric without anyone remembering to add it here — the
    same rule ADR 0023 applied to the conformance sweep.
    """
    terms: set[str] = set()
    for framework in PROVEN_FRAMEWORKS:
        terms.add(framework.framework_id)
        terms.add(framework.label)
        terms.update(framework.models)
        terms.update(framework.providers)
    return tuple(sorted(terms, key=str.casefold))


def _mentions(rubric: str, term: str) -> bool:
    """Whether a rubric names a term as a word rather than inside a longer one.

    Word boundaries so a rubric that says "the agent is fake-friendly" is not refused for the
    control framework's identifier, while one that says "prefer the fake arm" is.
    """
    return re.search(rf"(?<![\w-]){re.escape(term)}(?![\w-])", rubric, re.IGNORECASE) is not None


def judge_capability_issues(payload: JudgeConfigurationPayload) -> tuple[DefinitionIssue, ...]:
    """Every publish-gate finding that comes from outside the payload's own content."""
    issues: list[DefinitionIssue] = []
    judge = PROVEN_JUDGES_BY_PROVIDER.get(payload.model.provider)
    if judge is None:
        issues.append(
            issue_error(
                "judge_provider_not_proven",
                f"{payload.model.provider} is not a provider the lab has proven it can judge with",
                "model.provider",
            )
        )
    elif payload.model.model_id not in judge.models:
        issues.append(
            issue_warning(
                "judge_model_not_exercised",
                f"{payload.model.model_id} is not a model the lab exercises; "
                f"{judge.label} is proven on {', '.join(judge.models)}",
                "model.model_id",
            )
        )
    issues.extend(_anonymity_issues(payload.rubric, reserved_rubric_terms()))
    return tuple(issues)


def _anonymity_issues(rubric: str, terms: Iterable[str]) -> tuple[DefinitionIssue, ...]:
    """One finding per term the rubric names, so an author fixes them all at once."""
    return tuple(
        issue_error(
            "rubric_names_an_arm",
            f"the rubric names {term}, and a judge is shown no such thing: the brief carries "
            "what the arm did, never what ran it",
            "rubric",
        )
        for term in terms
        if _mentions(rubric, term)
    )
