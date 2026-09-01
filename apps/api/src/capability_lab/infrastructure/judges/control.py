"""The deterministic control judge: a declared rule, not a model.

The lab's evaluation path must be runnable and testable with no provider configured, for
the same reason the control arm exists (ADR 0026): an offline lab must still be able to run
the thing end to end, and a difference between two runs of this judge is a difference in the
brief rather than in the judge.

The rule, in full, and deliberately short enough to state:

1. shown no replies at all, it answers `unclear` — its rule reads words, and it has none;
2. shown replies and finding none, it answers `missed` — the arm never spoke;
3. shown the customer's turns and finding one this arm never answered, it answers
   `unclear` — an arm mid-incident has not failed, it is not finished;
4. otherwise it answers `met`: the arm answered everything it was asked.

What it deliberately is not: a reader of meaning. It scores engagement, which is structural,
and it says so in its rationale — a control judge that appeared to weigh tone would invite
exactly the interpretation of a result that a control cannot support.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.judge_capabilities import CONTROL_JUDGE_PROVIDER
from capability_lab.application.judge_runtime import JudgeRequest, JudgeRuntime, JudgeVerdict
from capability_lab.domain.judge import JudgeOutcome

__all__ = ["ControlJudgeRuntime"]


class ControlJudgeRuntime(JudgeRuntime):
    """Score a brief by the declared rule above, offline and identically every time."""

    @property
    def provider(self) -> str:
        return CONTROL_JUDGE_PROVIDER

    async def score(self, request: JudgeRequest) -> JudgeVerdict:
        replies = _entries(request.brief, "agent_replies")
        if replies is None:
            return JudgeVerdict(
                outcome=JudgeOutcome.UNCLEAR,
                rationale="this judge reads what the arm answered, and it was shown no replies",
            )
        if not replies:
            return JudgeVerdict(
                outcome=JudgeOutcome.MISSED,
                rationale="the arm never answered the customer",
            )
        answered = {_ordinal(entry) for entry in replies}
        asked = {_ordinal(entry) for entry in _entries(request.brief, "customer_turns") or ()}
        unanswered = sorted(ordinal for ordinal in asked - answered if ordinal is not None)
        if unanswered:
            return JudgeVerdict(
                outcome=JudgeOutcome.UNCLEAR,
                rationale=(
                    f"the arm has not answered turn {unanswered[0]}, so the incident is still "
                    "open on this evidence"
                ),
            )
        return JudgeVerdict(
            outcome=JudgeOutcome.MET,
            rationale=f"the arm answered every turn it received ({len(answered)} of them)",
        )


def _entries(
    brief: Mapping[str, CanonicalValue], key: str
) -> tuple[Mapping[str, CanonicalValue], ...] | None:
    """One section of the brief, or `None` when this judge was not shown it at all.

    Absent and empty are different answers (`judge_brief`): a scope the configuration did not
    declare is missing, and a scope it declared that holds nothing is a fact about the arm.
    """
    section = brief.get(key)
    if not isinstance(section, Sequence) or isinstance(section, str):
        return None
    return tuple(entry for entry in section if isinstance(entry, Mapping))


def _ordinal(entry: Mapping[str, CanonicalValue]) -> int | None:
    value = entry.get("ordinal")
    return value if isinstance(value, int) and not isinstance(value, bool) else None
