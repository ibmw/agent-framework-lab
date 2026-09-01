"""The anonymized, structured input one judge is shown about one arm.

`docs/PLAN.md` requires judge inputs to be framework-blind and every output to be tied to a
model, a prompt, a rubric, and an input fingerprint. This module is the first half of that:
one canonical `judge-brief-v1` document per objective per arm, holding what the arm did and
said and nothing about what ran it.

Four rules decide what goes in.

**Nothing that names the arm.** No framework, no model, no configuration name, no arm label,
no run identifier. Those are exactly the labels a judge must not score, and the surest way
to keep them out of a model's context is for them never to be written into the input at all.
A test walks the document and asserts it.

**What the arm did, not what the world holds.** A call contributes its tool name, the
arguments it was made with, and how it answered — never the data it answered *with*. A judge
handed the order, the customer, and the policy back would be scoring the shop's data rather
than the arm's conduct, and the facts are already deterministic evidence (ADR 0030). What
the judge adds is the reading of conduct that no rule can encode.

**The configuration decides what is present, and absence is visible.** A scope the judge
does not declare is not an empty list; the key is missing. The fingerprint therefore differs
between a judge shown the calls and one shown only the words, which is correct — they
answered different questions.

**A refusal is named but not narrated.** A refused call carries its refusal code, because
"the agent asked for something it was not allowed" is conduct. The message is left out for
the reason ADR 0021 gave it a code at all: the code is the stable, comparable part.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from capability_lab.application.agent_turns import ToolEvent
from capability_lab.application.canonical_json import (
    CanonicalValue,
    canonical_json_bytes,
    canonical_sha256,
)
from capability_lab.application.sandbox_tools import ToolOutcome
from capability_lab.domain.agent_turn import AgentTurn, AgentTurnOutcome
from capability_lab.domain.blocks import ObjectiveBlockPayload
from capability_lab.domain.experiment import ParticipantTurn
from capability_lab.domain.judge import JudgeConfigurationPayload, JudgeEvidenceScope
from capability_lab.domain.scenario import BoundObjective

JUDGE_BRIEF_CANONICAL_SCHEMA_VERSION = "judge-brief-v1"

__all__ = [
    "JUDGE_BRIEF_CANONICAL_SCHEMA_VERSION",
    "ArmRecord",
    "judge_brief",
    "judge_brief_fingerprint",
]


@dataclass(frozen=True, slots=True)
class ArmRecord:
    """Everything about one arm a brief may be built from, already narrowed to that arm.

    Deliberately holds no run identifier. The caller knows which arm this is — it just read
    it — and a field here would be one edit away from reaching the document.
    """

    turns: tuple[ParticipantTurn, ...]
    replies: tuple[AgentTurn, ...]
    calls: tuple[ToolEvent, ...]


def judge_brief(
    objective: BoundObjective,
    template: ObjectiveBlockPayload,
    configuration: JudgeConfigurationPayload,
    record: ArmRecord,
) -> dict[str, CanonicalValue]:
    """One objective, and the parts of one arm's record this judge is shown.

    The objective is always present: it is the question. Everything else is present only
    because the published configuration asked for it.
    """
    brief: dict[str, CanonicalValue] = {
        "canonical_schema_version": JUDGE_BRIEF_CANONICAL_SCHEMA_VERSION,
        "objective": {
            "id": objective.id,
            "statement": template.statement,
            "guidance": template.description,
        },
    }
    if configuration.shows(JudgeEvidenceScope.CUSTOMER_TURNS):
        brief["customer_turns"] = [
            {"ordinal": turn.ordinal, "body": turn.body}
            for turn in sorted(record.turns, key=lambda turn: turn.ordinal)
        ]
    if configuration.shows(JudgeEvidenceScope.AGENT_REPLIES):
        brief["agent_replies"] = [
            {"ordinal": reply.ordinal, "body": reply.body} for reply in _answered(record.replies)
        ]
    if configuration.shows(JudgeEvidenceScope.TOOL_CALLS):
        brief["tool_calls"] = [_call(call) for call in _ordered(record.calls)]
    if configuration.shows(JudgeEvidenceScope.STATE_CHANGES):
        brief["state_changes"] = [
            {"tool": call.tool, "sequence": call.sequence, "ordinal": call.ordinal}
            for call in _ordered(record.calls)
            if call.moved_the_arm
        ]
    return brief


def judge_brief_fingerprint(brief: Mapping[str, CanonicalValue]) -> str:
    """The SHA-256 of the exact bytes the judge was shown.

    What ties a verdict to its input. Two executions carrying one fingerprint were asked the
    same question; two carrying different ones were not, however alike the rubric.
    """
    return canonical_sha256(canonical_json_bytes(dict(brief)))


def _answered(replies: tuple[AgentTurn, ...]) -> tuple[AgentTurn, ...]:
    """The replies the arm actually produced, in thread order.

    A failed attempt is left out because it holds no words: the agent said nothing, and a
    judge told "attempt 1 failed" would be scoring the lab's provider (ADR 0026 keeps that
    failure as the arm's own evidence, where an operator reads it).
    """
    return tuple(
        sorted(
            (reply for reply in replies if reply.outcome is AgentTurnOutcome.ANSWERED),
            key=lambda reply: (reply.ordinal, reply.attempt),
        )
    )


def _ordered(calls: tuple[ToolEvent, ...]) -> tuple[ToolEvent, ...]:
    """Every call this arm made, in the order it asked, attempts included.

    Failed attempts included for the reason `ArmEvidence` includes them (ADR 0030): an arm
    that read the policy in an attempt that later failed still read the policy.
    """
    return tuple(sorted(calls, key=lambda call: (call.ordinal, call.attempt, call.sequence)))


def _call(call: ToolEvent) -> dict[str, CanonicalValue]:
    """One call as conduct: what was asked, and how it answered."""
    entry: dict[str, CanonicalValue] = {
        "tool": call.tool,
        "arguments": _arguments(call),
        "outcome": call.outcome.value,
    }
    if call.outcome is ToolOutcome.REFUSED:
        entry["refusal"] = _refusal_code(call)
    return entry


def _arguments(call: ToolEvent) -> dict[str, CanonicalValue]:
    arguments = call.document.get("arguments")
    return dict(arguments) if isinstance(arguments, dict) else {}


def _refusal_code(call: ToolEvent) -> CanonicalValue:
    refusal = call.document.get("refusal")
    if not isinstance(refusal, dict):  # pragma: no cover - a refusal always names its code
        return None
    code = refusal.get("code")
    return code if isinstance(code, str) else None
