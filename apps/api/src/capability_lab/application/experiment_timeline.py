"""One experiment's execution, normalized: what happened, in what order, and where it ran.

`PLAN.md` Milestone 4's fifth outcome. ADR 0025 recorded the customer's side of both threads
and ADR 0026 the agent's, each keyed the way its own writer needed. Read back, they are two
streams a client has to interleave — and interleaving them is exactly where a framework's
own vocabulary would creep back in. This module does it once, in the lab's words.

Six decisions shape it.

**A timeline is a reading, not a record.** Nothing here is stored and no table is added: every
entry is projected from the participant turns, agent turns, and tool events that are already
the evidence. A second stored shape could disagree with the first, which is the reason
ADR 0026 refused a separate confirmation record and a separate state-change table.

**The composition is the shared coordinate, not the ordinal.** An ordinal counts one arm's
turns, and arms are allowed to be at different depths (ADR 0025), so the same customer message
can be turn 3 in one arm and turn 2 in the other. What both arms genuinely share is the
composition — one thing the customer said, however many arms received it — so that is what the
timeline counts in, and what puts two arms' answers to one question beside each other.

**The order is the records' own, not the clock's.** The runner writes an attempt and every
call it made from one reading of the clock, so a timestamp cannot say which came first;
within an arm, the ordinal, the attempt, and the call's sequence already do. Across the arms,
each one's ordinals put the compositions it received in order, and the timeline merges those
sequences rather than sorting by a delivery time. The clock is consulted only to separate two
messages no arm saw both of, where nothing else can.

**An entry says what happened and never what was said.** No message body, no reply, no tool
arguments. The thread already serves those (`getExperiment`), and a stream that repeated them
would put synthetic customer content into the one surface built to be filtered, counted, and
later handed to an evaluation.

**A refusal is not an error.** They are separate categories because ADR 0021 made them
separate things: a tool that declines is the world answering, and an agent that was correctly
told no must not read as a broken lab.

**A fault the scenario fired is an entry like any other.** It moved one arm's world without
any agent asking, so it belongs in the stream that explains what the arm saw — placed by the
number of calls the attempt had already made, which is what puts it between the proposal it
invalidated and the write that was refused (ADR 0028). It is a state change and never a tool
call: nothing selected it, and an operator filtering for what the agent did must not find it
there.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from itertools import pairwise
from typing import NamedTuple
from uuid import UUID

from capability_lab.application.agent_runtime import (
    SupportAgentRuntimeRegistry,
    SupportAgentUnavailableError,
)
from capability_lab.application.agent_turns import AgentTurnRecord, ToolEventRecord
from capability_lab.application.experiments import (
    ExperimentDetail,
    ExperimentService,
    ParticipantTurnRecord,
)
from capability_lab.application.mutation_events import MutationEventRecord
from capability_lab.application.sandbox_tools import TOOL_HANDLERS, ToolOutcome
from capability_lab.application.scenario_mutations import MUTATION_APPLIERS
from capability_lab.application.source_locations import SourceLocation, locate
from capability_lab.domain.agent_turn import AgentTurnFailure, AgentTurnOutcome
from capability_lab.domain.blocks import MutationEffect
from capability_lab.domain.experiment import ParticipantTurnSource

__all__ = [
    "ExperimentTimeline",
    "ExperimentTimelineError",
    "ExperimentTimelineService",
    "TimelineCategory",
    "TimelineEntry",
    "TimelineEntryKind",
    "build_timeline",
]


class ExperimentTimelineError(RuntimeError):
    """Raised when the records cannot be read as one ordered stream.

    A broken invariant rather than a refusal: every entry is projected from evidence that was
    already written, so there is no input a caller could correct.
    """


class TimelineEntryKind(StrEnum):
    """What one entry is, in the lab's vocabulary rather than any framework's."""

    TRIGGER = "trigger"
    """The scenario's own first message, delivered to every arm as it was started."""

    CUSTOMER_TURN = "customer_turn"
    """One composition the participant driver produced, and the arms it reached."""

    AGENT_TURN = "agent_turn"
    """One attempt at one arm's reply — answered, or failed with a code."""

    TOOL_CALL = "tool_call"
    """One published tool one attempt ran, and what it did to that arm."""

    MUTATION = "mutation"
    """One scenario fault firing into one arm, which no agent asked for and none can see."""


class TimelineCategory(StrEnum):
    """The lenses an operator filters this stream through.

    An entry may carry several: a write that succeeded is a tool call *and* a state change,
    and a failed attempt is a model event *and* an error. Filtering is therefore membership
    rather than a single label, which is what lets "show me only what moved an arm" and
    "show me only what broke" both be honest questions about the same stream.
    """

    CUSTOMER = "customer"
    MODEL = "model"
    TOOL = "tool"
    STATE = "state"
    REFUSAL = "refusal"
    ERROR = "error"


@dataclass(frozen=True, slots=True)
class TimelineEntry:
    """One normalized event, and the project-owned code that produced it.

    `step` is the customer composition this belongs to, counted from the start of the
    experiment: the one coordinate both arms share. `ordinal` is the arm's own count of its
    turns and is absent on a customer entry, because a composition delivered to two arms at
    different depths has two of them and no single right answer.

    `source` is where the lab's own code that ran this lives, or nothing when it is not the
    lab's to point at — a framework's internals, or a tool this build no longer publishes.
    """

    step: int
    kind: TimelineEntryKind
    categories: tuple[TimelineCategory, ...]
    run_ids: tuple[UUID, ...]
    occurred_at: datetime
    composition_id: UUID | None = None
    ordinal: int | None = None
    attempt: int | None = None
    sequence: int | None = None
    tool: str | None = None
    tool_version: str | None = None
    tool_outcome: ToolOutcome | None = None
    mutation: str | None = None
    mutation_effect: MutationEffect | None = None
    turn_outcome: AgentTurnOutcome | None = None
    failure: AgentTurnFailure | None = None
    revision_before: int | None = None
    revision_after: int | None = None
    source: SourceLocation | None = None


@dataclass(frozen=True, slots=True)
class ExperimentTimeline:
    """One experiment's normalized execution, in order."""

    experiment_id: UUID
    entries: tuple[TimelineEntry, ...]


class ExperimentTimelineService:
    """Read one experiment and normalize its execution into one ordered stream.

    Holds no repository of its own: everything it needs is what `getExperiment` already
    serves, so the timeline can never describe an experiment differently from the thread it
    was projected out of. The runtime registry is here for one reason — an attempt's source
    location is the adapter that produced it, and which adapters exist is a property of this
    process rather than of the run.
    """

    def __init__(
        self, experiments: ExperimentService, runtimes: SupportAgentRuntimeRegistry
    ) -> None:
        self._experiments = experiments
        self._runtimes = runtimes

    def timeline(self, shop_id: UUID, experiment_id: UUID) -> ExperimentTimeline:
        detail = self._experiments.get_experiment(shop_id, experiment_id)
        return ExperimentTimeline(
            experiment_id=experiment_id,
            entries=build_timeline(detail, self._adapter_sources(detail)),
        )

    def _adapter_sources(self, detail: ExperimentDetail) -> Mapping[UUID, SourceLocation | None]:
        """Where each arm's runtime adapter lives, for the arms this process can run.

        An arm whose framework is not registered here gets no location rather than a guess.
        That is the "where available" in the outcome: a historical experiment read on a
        machine with no provider configured still shows its whole timeline, minus the one
        thing that machine genuinely cannot answer.
        """
        sources: dict[UUID, SourceLocation | None] = {}
        for arm in detail.arm_runtimes:
            try:
                runtime = self._runtimes.get(arm.framework_id)
            except SupportAgentUnavailableError:
                sources[arm.run_id] = None
                continue
            sources[arm.run_id] = locate(type(runtime).answer)
        return sources


def build_timeline(
    detail: ExperimentDetail, adapter_sources: Mapping[UUID, SourceLocation | None]
) -> tuple[TimelineEntry, ...]:
    """Normalize one experiment's records into one ordered stream.

    A function rather than a method so the projection can be read, tested, and reasoned about
    without a service, a session, or a runtime registry: given the records, the stream is
    fully determined.
    """
    positions = {run.run_id: run.position for run in detail.runs}
    steps = _steps(detail.turns)
    ordinals = {
        (record.run_id, record.turn.ordinal): steps[record.turn.turn_id] for record in detail.turns
    }

    entries: list[tuple[_Key, TimelineEntry]] = []
    for composition_id, group in _compositions(detail.turns).items():
        entries.append(
            (
                _Key(step=steps[composition_id], voice=_CUSTOMER),
                _customer_entry(group, steps, positions),
            )
        )
    for record in detail.agent_turns:
        step = ordinals.get((record.run_id, record.turn.ordinal))
        if step is None:  # pragma: no cover - an attempt answers a turn that was delivered
            continue
        entries.append(
            (
                _Key(
                    step=step,
                    voice=_ARM,
                    position=positions[record.run_id],
                    attempt=record.turn.attempt,
                    phase=_REPLY,
                ),
                _agent_entry(record, step, adapter_sources.get(record.run_id)),
            )
        )
    for event in detail.tool_events:
        step = ordinals.get((event.run_id, event.event.ordinal))
        if step is None:  # pragma: no cover - a call belongs to an attempt that was recorded
            continue
        entries.append(
            (
                _Key(
                    step=step,
                    voice=_ARM,
                    position=positions[event.run_id],
                    attempt=event.event.attempt,
                    phase=_CALLS,
                    sequence=event.event.sequence,
                    slot=_ASKED,
                ),
                _tool_entry(event, step),
            )
        )
    for fired in detail.mutation_events:
        step = ordinals.get((fired.run_id, fired.event.ordinal))
        if step is None:  # pragma: no cover - a fault fires into an arm that has a thread
            continue
        entries.append(
            (
                _Key(
                    step=step,
                    voice=_ARM,
                    position=positions[fired.run_id],
                    attempt=fired.event.attempt,
                    phase=_CALLS,
                    # A fault that fired after two calls sits before the third, which is what
                    # `after_calls` counts. Sharing the call sequence and losing the tie is
                    # how "the world moved between these two calls" is expressed with no
                    # coordinate the record does not already carry.
                    sequence=fired.event.after_calls,
                    slot=_UNASKED,
                ),
                _mutation_entry(fired, step),
            )
        )
    return tuple(entry for _, entry in sorted(entries, key=lambda pair: pair[0]))


class _Key(NamedTuple):
    """Where one entry sits: the composition, then whose it is, then what it was.

    Every field is a coordinate the record already carries. Nothing here is a timestamp,
    which is what lets an attempt and the five calls it made — all written from one reading
    of the clock — come back in the order the agent actually asked.
    """

    step: int
    voice: int
    position: int = 0
    attempt: int = 0
    phase: int = 0
    sequence: int = 0
    slot: int = 0


# What the customer said opens its composition; the arms answer it in their own order.
_CUSTOMER, _ARM = 0, 1
# Inside one attempt, the calls happened before the reply that ended it.
_CALLS, _REPLY = 0, 1
# At one point in an attempt, what happened to the arm precedes what the agent asked next.
_UNASKED, _ASKED = 0, 1


def _steps(turns: Sequence[ParticipantTurnRecord]) -> Mapping[UUID, int]:
    """Number the compositions in the order they were delivered.

    Each arm's ordinals already put the compositions *that arm* received in order, so this
    merges those sequences rather than sorting by a timestamp. Two reasons it is worth doing
    structurally. The record listing is grouped by arm, so a message sent to one arm alone
    can be read back before a linked message that was actually sent first — which is the bug
    the naive reading has. And a delivery time is only as good as the clock behind it, while
    an ordinal is what the operator actually did.

    Two compositions no single arm received both of are genuinely unordered by the record;
    they are separated by delivery time, and then by listing position so the numbering is
    deterministic either way. The trigger opens every arm and is therefore always step zero.
    """
    per_arm: dict[UUID, list[tuple[int, UUID]]] = {}
    tiebreak: dict[UUID, tuple[datetime, int]] = {}
    for position, record in enumerate(turns):
        composition = record.turn.turn_id
        per_arm.setdefault(record.run_id, []).append((record.turn.ordinal, composition))
        # One delivery reads the clock once, so every copy of a composition carries the
        # same moment; the first copy seen is as good as any and cheaper than a minimum.
        tiebreak.setdefault(composition, (record.created_at, position))

    follows: dict[UUID, set[UUID]] = {composition: set() for composition in tiebreak}
    waiting = dict.fromkeys(tiebreak, 0)
    for sequence in per_arm.values():
        ordered = [composition for _, composition in sorted(sequence)]
        for earlier, later in pairwise(ordered):
            if later not in follows[earlier]:
                follows[earlier].add(later)
                waiting[later] += 1

    steps: dict[UUID, int] = {}
    ready = [composition for composition, count in waiting.items() if count == 0]
    while ready:
        ready.sort(key=lambda composition: tiebreak[composition])
        composition = ready.pop(0)
        steps[composition] = len(steps)
        for later in follows[composition]:
            waiting[later] -= 1
            if waiting[later] == 0:
                ready.append(later)
    if len(steps) != len(tiebreak):  # pragma: no cover - one delivery numbers every arm at once
        # Unreachable while a delivery assigns every arm it reaches its next ordinal in one
        # transaction, which is what makes the arms agree about what came before what. The
        # invariant lives in `deliver_turn`, though, so it is checked rather than assumed:
        # a cycle would otherwise drop compositions here and surface as a missing key two
        # functions later, which says nothing about what actually went wrong.
        raise ExperimentTimelineError(
            "these arms disagree about the order their compositions were delivered in, so "
            "this experiment cannot be read as one stream"
        )
    return steps


def _compositions(
    turns: Sequence[ParticipantTurnRecord],
) -> Mapping[UUID, tuple[ParticipantTurnRecord, ...]]:
    """One composition's copies, gathered under the `turn_id` they share."""
    grouped: dict[UUID, tuple[ParticipantTurnRecord, ...]] = {}
    for record in turns:
        grouped[record.turn.turn_id] = (*grouped.get(record.turn.turn_id, ()), record)
    return grouped


def _customer_entry(
    group: tuple[ParticipantTurnRecord, ...],
    steps: Mapping[UUID, int],
    positions: Mapping[UUID, int],
) -> TimelineEntry:
    """One thing the customer said, as one entry naming every arm that received it.

    Collapsed deliberately. The record keeps one turn per arm because each arm's thread has
    to stand alone, but a linked message is one act by one operator, and a timeline that
    showed it twice would read as divergence where there is none. What the arms it reached
    *are* is on the entry, so a split reply is still visible as one — by naming fewer arms
    than the experiment has.
    """
    first = min(group, key=lambda record: positions[record.run_id])
    return TimelineEntry(
        step=steps[first.turn.turn_id],
        kind=(
            TimelineEntryKind.TRIGGER
            if first.turn.source is ParticipantTurnSource.TRIGGER
            else TimelineEntryKind.CUSTOMER_TURN
        ),
        categories=(TimelineCategory.CUSTOMER,),
        run_ids=tuple(
            record.run_id for record in sorted(group, key=lambda entry: positions[entry.run_id])
        ),
        occurred_at=first.created_at,
        composition_id=first.turn.turn_id,
    )


def _agent_entry(
    record: AgentTurnRecord, step: int, source: SourceLocation | None
) -> TimelineEntry:
    """One attempt, and the adapter that made it.

    A failed attempt is a model event that is also an error: it is where this arm's turn
    went, and an operator filtering for trouble must find it without also being shown every
    reply that worked.
    """
    failed = record.turn.outcome is AgentTurnOutcome.FAILED
    return TimelineEntry(
        step=step,
        kind=TimelineEntryKind.AGENT_TURN,
        categories=(
            (TimelineCategory.MODEL, TimelineCategory.ERROR)
            if failed
            else (TimelineCategory.MODEL,)
        ),
        run_ids=(record.run_id,),
        occurred_at=record.created_at,
        ordinal=record.turn.ordinal,
        attempt=record.turn.attempt,
        turn_outcome=record.turn.outcome,
        failure=record.turn.failure,
        source=source,
    )


def _tool_entry(record: ToolEventRecord, step: int) -> TimelineEntry:
    """One call, what it did to the arm, and where the code that answered it lives.

    The state change is the pair of revisions the event already carries (ADR 0026) rather
    than anything computed here, so "this moved the arm" and "this arm is at revision 2"
    cannot come apart.
    """
    event = record.event
    return TimelineEntry(
        step=step,
        kind=TimelineEntryKind.TOOL_CALL,
        categories=_tool_categories(event.outcome, moved=event.moved_the_arm),
        run_ids=(record.run_id,),
        occurred_at=record.created_at,
        ordinal=event.ordinal,
        attempt=event.attempt,
        sequence=event.sequence,
        tool=event.tool,
        tool_version=event.version,
        tool_outcome=event.outcome,
        revision_before=event.revision_before,
        revision_after=event.revision_after,
        source=locate(TOOL_HANDLERS.get(event.tool)),
    )


def _mutation_entry(record: MutationEventRecord, step: int) -> TimelineEntry:
    """One fault firing, and the project-owned code that performed it.

    A state change and nothing else. It is not a tool call — no agent selected it and none
    can see it (ADR 0017) — and it is not an error: the scenario asked for exactly this, and
    an operator filtering for what broke must not be shown the incident working as authored.
    """
    event = record.event
    return TimelineEntry(
        step=step,
        kind=TimelineEntryKind.MUTATION,
        categories=(TimelineCategory.STATE,),
        run_ids=(record.run_id,),
        occurred_at=record.created_at,
        ordinal=event.ordinal,
        attempt=event.attempt,
        sequence=event.after_calls,
        mutation=event.mutation_id,
        mutation_effect=event.effect,
        revision_before=event.revision_before,
        revision_after=event.revision_after,
        source=locate(MUTATION_APPLIERS.get(event.effect)),
    )


def _tool_categories(outcome: ToolOutcome, *, moved: bool) -> tuple[TimelineCategory, ...]:
    categories = [TimelineCategory.TOOL]
    if moved:
        categories.append(TimelineCategory.STATE)
    if outcome is ToolOutcome.REFUSED:
        categories.append(TimelineCategory.REFUSAL)
    if outcome is ToolOutcome.FAILED:
        categories.append(TimelineCategory.ERROR)
    return tuple(categories)
