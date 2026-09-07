"""The span tree of one attempt, recorded because the record cannot answer for it.

Every other reading over an experiment is a projection: the timeline (ADR 0027), the arm
standing (ADR 0029), the evaluation (ADR 0030), the metrics (ADR 0032), the state diff
(ADR 0035). Each is recomputed from rows the lab already keeps, and each ADR refused a
stored copy for the same reason — a second shape is a second chance to disagree with the
first.

A trace is the exception, and the reason is the same one ADR 0032 gave for a duration and a
provider's meter: it is gone the moment the attempt returns. The record timestamps an
attempt and every call it made from **one** reading of the clock, deliberately, so that the
order of a turn's calls is the sequence the agent asked in rather than a clock's opinion of
it. That decision is what makes a waterfall unprojectable: the record says a call took
310ms and never says *when* in the attempt those 310ms were spent, so the gaps between the
calls — which are the framework's own time, and the single most interesting quantity in a
comparison of two frameworks — cannot be located afterwards from anything the lab keeps.

So an offset is stored, and almost nothing else.

**A span carries coordinates, timing, and identity, and no content at all.** There is no
attribute bag on a stored span. What a span *is about* — which tool, which version, what it
answered, which revisions it moved, what the arm replied — is joined from the record by the
`(run, ordinal, attempt, sequence)` the span carries. That is not tidiness: a free-form
attribute map on an evidence row is exactly the back door around the `CUSTOMER_ONLY` rule
ADR 0021 enforces on tools and the anonymity rule ADR 0031 enforces on a judge's brief. A
row whose every column is a hex identifier, a small integer, or a closed enum cannot leak,
by construction rather than by a reviewer noticing.

**One measurement, two readers.** A tool span's duration is the same number the tool event
carries and the runtime span's is the same number the attempt row carries, because the
runner measures once and hands the value to both. Measuring again for the trace would
produce two durations for one call, and an operator with two numbers has none.

**Only spans the lab opened itself are recorded.** A framework's own instrumentation may
still reach an exporter — Phoenix is a replaceable consumer and always has been (ADR 0004) —
but nothing the lab did not open enters the stored trace. The lab cannot promise the
sanitization of an attribute it did not write, and an SDK's model span routinely carries the
prompt and the completion.

The three kinds below are the three things the runner can honestly see. `ATTEMPT` is the
whole advance, including the lab's own resolution of what this arm runs and the scenario
faults due before it starts. `RUNTIME` is the framework's part of it. `TOOL` is one call
back into the world. The distance between the attempt and the runtime is the lab's own glue
code, which is the half of a framework comparison this project owns.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from capability_lab.application.agent_turns import AgentTurnRecord, ToolEventRecord
from capability_lab.application.experiments import (
    ExperimentDetail,
    ExperimentService,
    RunRecord,
)
from capability_lab.application.sandbox_tools import ToolOutcome
from capability_lab.domain.agent_turn import AgentTurnFailure, AgentTurnOutcome

__all__ = [
    "AttemptTraceDraft",
    "ExperimentTraceService",
    "ExperimentTraces",
    "RecordedTrace",
    "RunSpan",
    "RunSpanRecord",
    "RunSpanRepository",
    "RunTrace",
    "RunTraceSpan",
    "RunTracer",
    "SpanDraft",
    "SpanKind",
    "build_traces",
]

_SPAN_ID = re.compile(r"^[0-9a-f]{16}$")
_TRACE_ID = re.compile(r"^[0-9a-f]{32}$")


class SpanKind(StrEnum):
    """The three things the lab's own code can time inside one attempt.

    Closed and lab-owned, exactly as `TimelineEntryKind` is. A framework reporting its own
    idea of a step would put its vocabulary into evidence two arms are compared on, which is
    what Milestone 4's fourth acceptance criterion forbids.
    """

    ATTEMPT = "attempt"
    """The whole advance: resolving what this arm runs, the faults due before it starts, and
    the framework's turn."""

    RUNTIME = "runtime"
    """The framework's part of the attempt — the one span whose duration is what the attempt
    row already stores."""

    TOOL = "tool"
    """One call back into this arm's world, through the invoker that records it."""


@dataclass(frozen=True, slots=True)
class RunSpan:
    """One span of one attempt: where it sits, when it ran, and nothing about what it did.

    `started_offset_ms` is measured from the start of the attempt rather than from an epoch,
    because an absolute timestamp here would be a second answer to a question `created_at`
    already answers — and a wrong one, since the runner reads its clock once for the whole
    attempt. A relative offset says the one thing the record cannot.
    """

    span_id: str
    parent_span_id: str | None
    kind: SpanKind
    ordinal: int
    attempt: int
    started_offset_ms: int
    duration_ms: int
    sequence: int | None = None
    """The call's position in the attempt, on a `TOOL` span and nowhere else.

    It is the join back to `experiment_tool_events`, which is where the tool, its version,
    what it answered, and the revisions it moved actually live."""

    def __post_init__(self) -> None:
        if not _SPAN_ID.match(self.span_id):
            raise ValueError("a span id is 16 lowercase hex characters")
        if self.parent_span_id is not None and not _SPAN_ID.match(self.parent_span_id):
            raise ValueError("a parent span id is 16 lowercase hex characters")
        if self.ordinal < 0 or self.attempt < 1:
            raise ValueError("a span belongs to an attempt of a turn the arm received")
        if self.started_offset_ms < 0 or self.duration_ms < 0:
            raise ValueError("a span cannot start or last a negative number of milliseconds")
        if (self.kind is SpanKind.TOOL) != (self.sequence is not None):
            # The coordinate is the join, so it has to mean one thing. A tool span without a
            # sequence could not be tied to the call it timed, and a non-tool span with one
            # would claim a call that is not there.
            raise ValueError("exactly a tool span carries the sequence of the call it timed")
        if self.sequence is not None and self.sequence < 0:
            raise ValueError("a call's sequence counts from zero")
        if (self.kind is SpanKind.ATTEMPT) != (self.parent_span_id is None):
            raise ValueError("exactly the attempt span is the root of a trace")


@dataclass(frozen=True, slots=True)
class RunSpanRecord:
    """One stored span, bound to the arm and the trace it belongs to."""

    run_id: UUID
    experiment_id: UUID
    trace_id: str
    span: RunSpan
    created_at: datetime

    def __post_init__(self) -> None:
        if not _TRACE_ID.match(self.trace_id):
            raise ValueError("a trace id is 32 lowercase hex characters")


class RunSpanRepository(Protocol):
    """Append-only per attempt, exactly as the tool events beside it are."""

    def list_for_experiment(self, experiment_id: UUID) -> tuple[RunSpanRecord, ...]: ...

    def append_all(self, records: tuple[RunSpanRecord, ...]) -> tuple[RunSpanRecord, ...]:
        """Write one attempt's spans together, after the attempt they belong to."""
        ...


@dataclass(frozen=True, slots=True)
class SpanDraft:
    """One span the runner measured, before anything has given it an identity.

    `tool` and `tool_version` exist for the **exporter** and are deliberately not stored: a
    span reaching Phoenix needs to say which published tool it timed, and the stored row
    joins for the same fact instead — so the two views of one execution cannot drift into
    naming a call differently.

    There is no free-text label. A span's name is decided from its kind by the tracer, and
    the only other word an exported span carries is a tool name the lab itself publishes.
    """

    kind: SpanKind
    started_offset_ms: int
    duration_ms: int
    sequence: int | None = None
    tool: str | None = None
    tool_version: str | None = None


@dataclass(frozen=True, slots=True)
class AttemptTraceDraft:
    """Everything one attempt's trace is made of, measured by the runner that produced it.

    The tracer is handed timings rather than asked to take its own. ADR 0032 established
    that the runner holds the clock a run is measured on; a tracer reading a second one
    would put two answers to "how long did this call take" into one record.
    """

    run_id: UUID
    experiment_id: UUID
    arm_position: int
    framework_id: str
    ordinal: int
    attempt: int
    started_at: datetime
    spans: tuple[SpanDraft, ...]
    """Outermost first, with the runtime span ahead of every call it contains.

    A tracer parents each span on the last one above it, so this order is part of the port
    rather than a habit of the caller: a draft listing a call before the runtime span would
    hang it off the root and record a tree the attempt did not have."""


@dataclass(frozen=True, slots=True)
class RecordedTrace:
    """The identities a tracer minted for one attempt's spans."""

    trace_id: str
    spans: tuple[RunSpan, ...]


class RunTracer(Protocol):
    """Turn one attempt's measurements into a trace, and let an exporter see it.

    The port exists so the runner never holds an OpenTelemetry type. What crosses it is a
    draft of what the lab measured and a set of hex identifiers, which is what a trace is
    for evidence purposes — a correlation and a shape. Whether anything is exported, and to
    what, is composition's (ADR 0004).
    """

    def record(self, draft: AttemptTraceDraft) -> RecordedTrace: ...


@dataclass(frozen=True, slots=True)
class RunTraceSpan:
    """One span as it reads back, with what the record says it was about joined onto it."""

    span_id: str
    parent_span_id: str | None
    kind: SpanKind
    started_offset_ms: int
    duration_ms: int
    sequence: int | None = None
    tool: str | None = None
    tool_version: str | None = None
    tool_outcome: ToolOutcome | None = None


@dataclass(frozen=True, slots=True)
class RunTrace:
    """One attempt, and the trace of it if the lab recorded one.

    Every recorded attempt gets an entry, including the ones made before this lab traced
    anything: `trace_id` is `None` and `spans` is empty, which says "nobody watched this"
    rather than "nothing happened". Backfilling an invented waterfall would be the mistake
    ADR 0032 refused when it left an unmeasured duration null.
    """

    run_id: UUID
    arm_label: str
    framework_id: str
    model_id: str
    ordinal: int
    attempt: int
    outcome: AgentTurnOutcome
    failure: AgentTurnFailure | None
    duration_ms: int | None
    trace_id: str | None
    spans: tuple[RunTraceSpan, ...] = field(default_factory=tuple)

    @property
    def traced(self) -> bool:
        return self.trace_id is not None


@dataclass(frozen=True, slots=True)
class ExperimentTraces:
    """Every attempt both arms made, arm by arm and turn by turn."""

    experiment_id: UUID
    traces: tuple[RunTrace, ...]


def build_traces(
    detail: ExperimentDetail, spans: tuple[RunSpanRecord, ...]
) -> tuple[RunTrace, ...]:
    """Pair each recorded attempt with the spans stored for it.

    A pure function over one experiment reading and one listing, for the reason
    `build_timeline` is one: what the stream *says* is testable without a store, and the
    service above it does nothing but supply the two inputs.
    """
    arms = {run.run_id: run for run in detail.runs}
    runtimes = {runtime.run_id: runtime for runtime in detail.arm_runtimes}
    events = _events_by_attempt(detail.tool_events)
    recorded = _spans_by_attempt(spans)
    traces: list[RunTrace] = []
    for turn in sorted(detail.agent_turns, key=lambda entry: _attempt_key(arms, entry)):
        run = arms.get(turn.run_id)
        runtime = runtimes.get(turn.run_id)
        if run is None or runtime is None:  # pragma: no cover - one runtime row per arm
            continue
        key = (turn.run_id, turn.turn.ordinal, turn.turn.attempt)
        trace_id, stored = recorded.get(key, (None, ()))
        traces.append(
            RunTrace(
                run_id=turn.run_id,
                arm_label=run.label,
                framework_id=runtime.framework_id,
                model_id=runtime.model_id,
                ordinal=turn.turn.ordinal,
                attempt=turn.turn.attempt,
                outcome=turn.turn.outcome,
                failure=turn.turn.failure,
                duration_ms=turn.duration_ms,
                trace_id=trace_id,
                spans=tuple(_join(span, events.get(key, {})) for span in stored),
            )
        )
    return tuple(traces)


def _join(span: RunSpan, events: dict[int, ToolEventRecord]) -> RunTraceSpan:
    """What the record says this span was about, read through the coordinate it carries.

    A tool span whose call is not in the record keeps its timing and reports no tool, which
    is the honest reading of a trace stored beside an event that is not there. Nothing in
    this build produces one — a span and its event are written in the same advance — and
    that is exactly why the join must not assume it.
    """
    event = events.get(span.sequence) if span.sequence is not None else None
    return RunTraceSpan(
        span_id=span.span_id,
        parent_span_id=span.parent_span_id,
        kind=span.kind,
        started_offset_ms=span.started_offset_ms,
        duration_ms=span.duration_ms,
        sequence=span.sequence,
        tool=None if event is None else event.event.tool,
        tool_version=None if event is None else event.event.version,
        tool_outcome=None if event is None else event.event.outcome,
    )


def _events_by_attempt(
    events: tuple[ToolEventRecord, ...],
) -> dict[tuple[UUID, int, int], dict[int, ToolEventRecord]]:
    grouped: dict[tuple[UUID, int, int], dict[int, ToolEventRecord]] = {}
    for entry in events:
        key = (entry.run_id, entry.event.ordinal, entry.event.attempt)
        grouped.setdefault(key, {})[entry.event.sequence] = entry
    return grouped


def _spans_by_attempt(
    spans: tuple[RunSpanRecord, ...],
) -> dict[tuple[UUID, int, int], tuple[str, tuple[RunSpan, ...]]]:
    """One attempt's spans, ordered by the record's own coordinates and never by the clock.

    The offset says where a bar is drawn and decides nothing about the order the rows are
    listed in. That is ADR 0027's rule, and it has teeth here: an operational clock can be
    stepped backwards under a running process — the case `_elapsed_ms` clamps at zero for —
    and a trace sorted by the offset would then list a later call above an earlier one while
    the timeline beside it listed the opposite. The sequence is what the agent asked in, so
    the sequence is what this lists in.
    """
    grouped: dict[tuple[UUID, int, int], list[RunSpanRecord]] = {}
    for record in spans:
        key = (record.run_id, record.span.ordinal, record.span.attempt)
        grouped.setdefault(key, []).append(record)
    ordered: dict[tuple[UUID, int, int], tuple[str, tuple[RunSpan, ...]]] = {}
    for key, records in grouped.items():
        rows = sorted(records, key=lambda entry: _span_key(entry.span))
        ordered[key] = (rows[0].trace_id, tuple(entry.span for entry in rows))
    return ordered


def _span_key(span: RunSpan) -> tuple[int, int]:
    depth = {SpanKind.ATTEMPT: 0, SpanKind.RUNTIME: 1, SpanKind.TOOL: 2}[span.kind]
    return (depth, span.sequence if span.sequence is not None else 0)


def _attempt_key(arms: dict[UUID, RunRecord], turn: AgentTurnRecord) -> tuple[int, int, int]:
    run = arms.get(turn.run_id)
    return (
        run.position if run is not None else 0,
        turn.turn.ordinal,
        turn.turn.attempt,
    )


class ExperimentTraceService:
    """Read one experiment's recorded traces beside the record that explains them.

    Built over `ExperimentService` for the reason `ExperimentTimelineService` is: the tool
    events a span joins to are the ones `getExperiment` serves, so a trace cannot describe a
    call differently from the thread it happened in.
    """

    def __init__(self, experiments: ExperimentService, spans: RunSpanRepository) -> None:
        self._experiments = experiments
        self._spans = spans

    def traces(self, shop_id: UUID, experiment_id: UUID) -> ExperimentTraces:
        detail = self._experiments.get_experiment(shop_id, experiment_id)
        return ExperimentTraces(
            experiment_id=experiment_id,
            traces=build_traces(detail, self._spans.list_for_experiment(experiment_id)),
        )
