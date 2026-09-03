"""What one arm cost to run, read back out of its own record.

`PLAN.md` Milestone 5 asks a run to record turns, token usage, model and tool calls,
duration, retries, failures, and an estimated cost. Almost all of that is already in the
record: an arm's turns are its participant stream, its retries are the attempts beside each
ordinal, and its failures are the codes those attempts carry. Only two things could not be
recovered afterwards — how long an attempt took and what the provider metered — so those are
stored on the rows that produced them (`agent_turns`), and this is the reading over them.

Four decisions shape it.

**A metric is projected, never stored.** Exactly the rule ADR 0027 gave the timeline and
ADR 0030 gave the evaluation: a second stored shape would be a second writer of a fact the
streams already hold, free to disagree the day one of them is edited. An arm's counts are
therefore a function of its record and cannot drift from the thread beside them.

**Nothing is inferred to fill a gap.** An unreported usage is `None` and stays `None`
through every total it takes part in; a duration missing from a row recorded before the lab
measured is skipped rather than counted as zero. Both partial totals carry their own
denominator — `measured_attempts` and `metered_attempts` — so a total that covers half the
arm reads as partial rather than as a fast or cheap run. Usage is partial by design and not
only by accident: a failed attempt reports none (ADR 0032), so every arm that was retried
has a token count covering fewer attempts than it made.

**Failures are counted by code, not summarized.** `AgentTurnFailure` is a closed vocabulary
built so a comparison can count kinds (ADR 0026), and collapsing it into "3 failures" here
would throw away the one thing that distinguishes a provider outage from a configuration
whose tool budget is too small.

**Cost is derived at read time.** It is recomputed from the usage the record holds against
the declared price table (`model_cost`), so correcting a rate corrects every historical
estimate at once and no row ever carries a price that has since moved.

There is deliberately no aggregate: no score, no winner, no arm-versus-arm delta.
`docs/product-direction.md` forbids collapsing evidence into one number, and an efficiency
reading is only interpretable beside the outcome, which is the evaluation's (ADR 0030).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from uuid import UUID

from capability_lab.application.agent_turns import AgentTurnRecord, ToolEventRecord
from capability_lab.application.model_cost import (
    EstimatedCost,
    ModelUsage,
    estimate_cost,
    total_usage,
)
from capability_lab.domain.agent_turn import AgentTurnFailure, AgentTurnOutcome

__all__ = ["ArmMetrics", "arm_metrics"]


@dataclass(frozen=True, slots=True)
class ArmMetrics:
    """What one arm has spent so far, in the units an operator reads it in.

    "So far" is exact: every count is of the record as it stands, so an arm still being
    driven reports a growing total rather than waiting for a completion nobody sets
    (ADR 0029).
    """

    run_id: UUID

    turns: int
    """Customer turns this arm has received, which is what the scenario's cap counts."""

    answered_turns: int
    """How many of those turns the arm actually replied to."""

    attempts: int
    """Agent attempts, retries included — the number of times a runtime was started."""

    retries: int
    """Attempts beyond the first at a turn.

    `attempts - turns attempted`, so an arm that answered every question first time reports
    zero however many turns it took. A retry is an operator's act on a failure (ADR 0026),
    and counting it apart from the failure is what separates "it broke" from "we ran it
    again"."""

    failures: Mapping[AgentTurnFailure, int]
    """How many attempts ended in each kind of failure. Absent kinds are simply not there."""

    tool_calls: int
    """Every call the arm's attempts made, refusals included: asking is what was compared."""

    tool_writes: int
    """The calls that actually moved the arm, read off the revisions the events carry."""

    model_requests: int | None
    """Provider calls, summed from what the frameworks metered, or nothing if none did."""

    usage: ModelUsage | None
    duration_ms: int | None
    """Wall-clock milliseconds across the measured attempts, or nothing if none were."""

    tool_duration_ms: int | None
    """How much of that was spent waiting on tools, when the calls were measured."""

    measured_attempts: int
    """How many attempts contributed a duration — the denominator of `duration_ms`."""

    metered_attempts: int
    """How many attempts contributed usage — the denominator of `usage` and the cost.

    Below `attempts` whenever one of them failed, because a failed attempt reports nothing it
    spent. Without it a retried arm's tokens and cost would look like the whole arm's."""

    estimated_cost: EstimatedCost | None
    """What the declared rates say the usage was worth; nothing when either half is unknown."""


def arm_metrics(
    run_id: UUID,
    *,
    turns: int,
    attempts: tuple[AgentTurnRecord, ...],
    events: tuple[ToolEventRecord, ...],
    provider: str,
    model_id: str,
) -> ArmMetrics:
    """Count one arm, from rows the caller has already narrowed to that arm.

    Narrowed by the caller rather than here so this module never has to know how an
    experiment holds its streams — which is also what keeps it out of the import cycle a
    metric-aware `ExperimentDetail` would otherwise create.
    """
    answered = frozenset(
        entry.turn.ordinal for entry in attempts if entry.turn.outcome is AgentTurnOutcome.ANSWERED
    )
    attempted = frozenset(entry.turn.ordinal for entry in attempts)
    failures: dict[AgentTurnFailure, int] = {}
    for entry in attempts:
        if entry.turn.failure is not None:
            failures[entry.turn.failure] = failures.get(entry.turn.failure, 0) + 1

    metered = tuple(entry.usage for entry in attempts if entry.usage is not None)
    usage = total_usage(metered)
    measured = tuple(entry.duration_ms for entry in attempts if entry.duration_ms is not None)
    tool_measured = tuple(
        entry.event.duration_ms for entry in events if entry.event.duration_ms is not None
    )
    return ArmMetrics(
        run_id=run_id,
        turns=turns,
        answered_turns=len(answered),
        attempts=len(attempts),
        retries=len(attempts) - len(attempted),
        failures=MappingProxyType(failures),
        tool_calls=len(events),
        tool_writes=sum(1 for entry in events if entry.event.moved_the_arm),
        model_requests=None if usage is None else usage.model_requests,
        usage=usage,
        duration_ms=sum(measured) if measured else None,
        tool_duration_ms=sum(tool_measured) if tool_measured else None,
        measured_attempts=len(measured),
        metered_attempts=len(metered),
        estimated_cost=estimate_cost(usage, provider, model_id),
    )
