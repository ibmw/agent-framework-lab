"""The span tree recorded beside one attempt, and what it says the record cannot (ADR 0037)."""

from collections.abc import Generator, Mapping
from dataclasses import fields
from datetime import UTC, datetime
from itertools import pairwise
from pathlib import Path
from uuid import uuid4

import pytest
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from sqlalchemy import delete
from sqlalchemy.orm import Session

from agent_factories import READ_TOOL_NAMES, model_settings
from capability_lab.application.agent_capabilities import FAKE_FRAMEWORK_ID
from capability_lab.application.agent_runtime import (
    AgentAnswer,
    AgentTurnRequest,
    SandboxToolInvoker,
    SupportAgentProviderError,
    SupportAgentRuntime,
    SupportAgentRuntimeRegistry,
)
from capability_lab.application.experiment_traces import (
    AttemptTraceDraft,
    RunSpan,
    RunSpanRecord,
    RunTrace,
    SpanDraft,
    SpanKind,
)
from capability_lab.application.experiments import (
    ArmSelection,
    ExperimentDetail,
    StartExperiment,
)
from capability_lab.application.model_cost import ModelUsage
from capability_lab.application.sandbox_tool_contracts import (
    ADDRESS_CHANGE_APPLY,
    ADDRESS_CHANGE_PROPOSE,
    INTERACTION_CONTEXT,
    SUPPORT_DOCUMENT,
)
from capability_lab.application.sandbox_tools import ToolHandler, ToolOutcome
from capability_lab.domain.agent_turn import AgentTurnFailure, AgentTurnOutcome
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.models import RunSpanModel
from capability_lab.infrastructure.participants.human import HumanParticipantDriver
from capability_lab.infrastructure.telemetry import Telemetry, create_run_tracer
from workspace_factories import (
    SEED,
    Workspace,
    author,
    build_experiments,
    build_runner,
    build_traces,
    publish_prerequisites,
    published_configuration,
    published_identity,
    seed_workspace,
)

WRITE_TOOL_NAMES = (ADDRESS_CHANGE_APPLY, ADDRESS_CHANGE_PROPOSE)
TRIGGER_ORDINAL = 0


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'traces.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def workspace(session: Session) -> Workspace:
    return seed_workspace(session)


def control_arm(session: Session, **overrides: object) -> ArmSelection:
    fields: dict[str, object] = {
        "framework_id": FAKE_FRAMEWORK_ID,
        "model": model_settings(provider="fake", model_id="deterministic"),
        "tools": (*READ_TOOL_NAMES, *WRITE_TOOL_NAMES),
    }
    fields.update(overrides)
    return published_configuration(session, published_identity(session), **fields)


def start(session: Session, workspace: Workspace, *arms: ArmSelection) -> ExperimentDetail:
    publish_prerequisites(workspace)
    scenario_id = author(workspace)
    version = workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id)
    return build_experiments(session).start(
        workspace.shop_id,
        StartExperiment(
            label="Wrong shipping address",
            scenario_id=scenario_id,
            scenario_version=version.published.version,
            seed=SEED,
            arms=arms,
        ),
    )


async def advance(
    session: Session,
    detail: ExperimentDetail,
    position: int = 0,
    runtimes: SupportAgentRuntimeRegistry | None = None,
    handlers: Mapping[str, ToolHandler] | None = None,
) -> None:
    run = detail.runs[position]
    runner = build_runner(session, runtimes, handlers)
    await runner.advance(run.shop_id, run.experiment_id, run.run_id)


def traces(session: Session, detail: ExperimentDetail) -> tuple[RunTrace, ...]:
    service = build_traces(session)
    return service.traces(detail.record.shop_id, detail.record.experiment_id).traces


# -- what a trace is -----------------------------------------------------------


@pytest.mark.asyncio
async def test_an_attempt_is_recorded_as_one_trace_rooted_in_the_advance(
    session: Session, workspace: Workspace
) -> None:
    """One root, one runtime span under it, and one span per call the arm made."""
    detail = start(session, workspace, control_arm(session))

    await advance(session, detail)

    (trace,) = traces(session, detail)
    assert trace.traced
    assert trace.trace_id is not None
    assert len(trace.trace_id) == 32
    kinds = [span.kind for span in trace.spans]
    assert kinds[0] is SpanKind.ATTEMPT
    assert kinds[1] is SpanKind.RUNTIME
    assert set(kinds[2:]) == {SpanKind.TOOL}
    read = build_experiments(session).get_experiment(
        detail.record.shop_id, detail.record.experiment_id
    )
    assert kinds.count(SpanKind.TOOL) == len(read.tool_events)


@pytest.mark.asyncio
async def test_only_the_root_has_no_parent_and_every_call_hangs_off_the_runtime(
    session: Session, workspace: Workspace
) -> None:
    """The stored parentage is what the exporter received, not a convention a reader infers."""
    detail = start(session, workspace, control_arm(session))

    await advance(session, detail)

    (trace,) = traces(session, detail)
    root = trace.spans[0]
    runtime = trace.spans[1]
    assert root.parent_span_id is None
    assert runtime.parent_span_id == root.span_id
    assert [span.parent_span_id for span in trace.spans[2:]] == [runtime.span_id] * (
        len(trace.spans) - 2
    )


@pytest.mark.asyncio
async def test_a_call_says_where_inside_the_attempt_it_ran(
    session: Session, workspace: Workspace
) -> None:
    """The one fact no other reading of an experiment can supply.

    The record timestamps an attempt and every call it made from one reading of the clock
    (ADR 0027), so it can say a call took 310ms and never when in the attempt those 310ms
    were spent. Here the calls sit at increasing offsets inside the runtime span, and the
    space between them is the framework's own time.
    """
    detail = start(session, workspace, control_arm(session))

    await advance(session, detail)

    (trace,) = traces(session, detail)
    runtime = trace.spans[1]
    calls = [span for span in trace.spans if span.kind is SpanKind.TOOL]
    assert len(calls) > 1
    offsets = [span.started_offset_ms for span in calls]
    assert offsets == sorted(offsets)
    assert offsets[0] >= runtime.started_offset_ms
    # Every call ends before the next one starts, and none of them abuts it: what lies
    # between two calls is the framework deciding what to ask next.
    for before, after in pairwise(calls):
        assert before.started_offset_ms + before.duration_ms < after.started_offset_ms


@pytest.mark.asyncio
async def test_a_span_carries_the_measurement_the_record_already_holds(
    session: Session, workspace: Workspace
) -> None:
    """One measurement, two readers: two durations for one call would leave an operator none."""
    detail = start(session, workspace, control_arm(session))

    await advance(session, detail)

    read = build_experiments(session).get_experiment(
        detail.record.shop_id, detail.record.experiment_id
    )
    (trace,) = traces(session, detail)
    (turn,) = read.agent_turns
    events = {entry.event.sequence: entry.event for entry in read.tool_events}
    assert trace.spans[1].duration_ms == turn.duration_ms
    for span in trace.spans[2:]:
        assert span.sequence is not None
        assert span.duration_ms == events[span.sequence].duration_ms


@pytest.mark.asyncio
async def test_the_attempt_span_holds_the_lab_s_own_work_as_well_as_the_framework_s(
    session: Session, workspace: Workspace
) -> None:
    """Resolving what an arm runs is this project's code, and it is not the framework's cost."""
    detail = start(session, workspace, control_arm(session))

    await advance(session, detail)

    (trace,) = traces(session, detail)
    root, runtime = trace.spans[0], trace.spans[1]
    assert root.started_offset_ms == 0
    assert runtime.started_offset_ms > 0
    assert root.duration_ms > runtime.duration_ms


@pytest.mark.asyncio
async def test_a_span_names_the_call_the_record_says_it_timed(
    session: Session, workspace: Workspace
) -> None:
    """A stored span holds no attribute of its own; the tool is joined through the sequence."""
    detail = start(session, workspace, control_arm(session))

    await advance(session, detail)

    read = build_experiments(session).get_experiment(
        detail.record.shop_id, detail.record.experiment_id
    )
    (trace,) = traces(session, detail)
    called = [(span.sequence, span.tool, span.tool_version) for span in trace.spans[2:]]
    assert called == [
        (entry.event.sequence, entry.event.tool, entry.event.version) for entry in read.tool_events
    ]
    assert all(span.tool_outcome is ToolOutcome.SUCCESS for span in trace.spans[2:])
    assert trace.spans[0].tool is None
    assert trace.spans[1].tool is None


@pytest.mark.asyncio
async def test_a_refused_call_keeps_its_span_and_reports_the_refusal(
    session: Session, workspace: Workspace
) -> None:
    """A refusal is the world answering (ADR 0021); a trace of it is a trace of a call."""
    detail = start(session, workspace, control_arm(session))

    await advance(session, detail, runtimes=_registry(_CallingRuntime(SUPPORT_DOCUMENT)))

    (trace,) = traces(session, detail)
    (call,) = [span for span in trace.spans if span.kind is SpanKind.TOOL]
    assert call.tool == SUPPORT_DOCUMENT
    assert call.tool_outcome is ToolOutcome.REFUSED


# -- what a trace never carries ------------------------------------------------


@pytest.mark.asyncio
async def test_a_trace_carries_no_word_anyone_said(session: Session, workspace: Workspace) -> None:
    """Asserted against the reading rather than trusted to review.

    A stored span has no attribute column at all, which is what stops a trace from becoming
    the way synthetic customer content leaves the lab. Every string it can carry is a hex
    identifier, a published tool name, or a closed enum value.
    """
    detail = start(session, workspace, control_arm(session))
    build_experiments(session).deliver_turn(
        detail.record.shop_id,
        detail.record.experiment_id,
        tuple(run.run_id for run in detail.runs),
        HumanParticipantDriver("Please send it to my Lyon address instead."),
    )

    await advance(session, detail)

    words = {"Lyon", "Please", "address instead"}
    for trace in traces(session, detail):
        for span in trace.spans:
            values = [getattr(span, entry.name) for entry in fields(span)]
            rendered = " ".join(str(value) for value in values)
            assert not any(word in rendered for word in words)


# -- absence, failure, and the arm beside it -----------------------------------


@pytest.mark.asyncio
async def test_the_arm_beside_it_records_nothing(session: Session, workspace: Workspace) -> None:
    detail = start(session, workspace, control_arm(session), control_arm(session))

    await advance(session, detail)

    recorded = traces(session, detail)
    assert [trace.run_id for trace in recorded] == [detail.runs[0].run_id]


@pytest.mark.asyncio
async def test_a_failed_attempt_is_traced_and_a_retry_is_traced_beside_it(
    session: Session, workspace: Workspace
) -> None:
    """A failure is evidence, so how long it took before it broke is evidence too."""
    detail = start(session, workspace, control_arm(session))

    await advance(session, detail, runtimes=_registry(_FailingRuntime()))
    await advance(session, detail)

    first, second = traces(session, detail)
    assert (first.ordinal, first.attempt) == (TRIGGER_ORDINAL, 1)
    assert first.outcome is AgentTurnOutcome.FAILED
    assert first.failure is AgentTurnFailure.MODEL_PROVIDER
    assert [span.kind for span in first.spans] == [SpanKind.ATTEMPT, SpanKind.RUNTIME]
    assert (second.ordinal, second.attempt) == (TRIGGER_ORDINAL, 2)
    assert second.outcome is AgentTurnOutcome.ANSWERED
    assert first.trace_id != second.trace_id


@pytest.mark.asyncio
async def test_an_attempt_the_lab_never_traced_says_so_rather_than_showing_nothing(
    session: Session, workspace: Workspace
) -> None:
    """An attempt recorded before this revision has no trace, and that is the honest reading.

    Backfilling an invented waterfall would be the mistake ADR 0032 refused when it left an
    unmeasured duration null.
    """
    detail = start(session, workspace, control_arm(session))
    await advance(session, detail)
    session.execute(delete(RunSpanModel))
    session.flush()

    (trace,) = traces(session, detail)
    assert not trace.traced
    assert trace.trace_id is None
    assert trace.spans == ()
    assert trace.outcome is AgentTurnOutcome.ANSWERED


@pytest.mark.asyncio
async def test_an_arm_that_was_never_run_has_no_attempt_to_trace(
    session: Session, workspace: Workspace
) -> None:
    detail = start(session, workspace, control_arm(session))

    assert traces(session, detail) == ()


def test_a_shop_that_holds_no_such_experiment_is_not_answered_with_traces(
    session: Session, workspace: Workspace
) -> None:
    start(session, workspace, control_arm(session))

    with pytest.raises(Exception, match="is not in shop"):
        build_traces(session).traces(workspace.shop_id, uuid4())


# -- the shape a span is allowed to have ---------------------------------------


def span(**overrides: object) -> RunSpan:
    fields: dict[str, object] = {
        "span_id": "00000000000000ab",
        "parent_span_id": None,
        "kind": SpanKind.ATTEMPT,
        "ordinal": 0,
        "attempt": 1,
        "started_offset_ms": 0,
        "duration_ms": 10,
    }
    fields.update(overrides)
    return RunSpan(**fields)  # type: ignore[arg-type]


def test_exactly_a_tool_span_carries_the_sequence_of_the_call_it_timed() -> None:
    """The coordinate is the join, so it has to mean one thing."""
    with pytest.raises(ValueError, match="sequence of the call"):
        span(kind=SpanKind.TOOL, parent_span_id="00000000000000cd", sequence=None)
    with pytest.raises(ValueError, match="sequence of the call"):
        span(sequence=0)


def test_exactly_the_attempt_span_is_the_root_of_a_trace() -> None:
    with pytest.raises(ValueError, match="root of a trace"):
        span(kind=SpanKind.RUNTIME, parent_span_id=None)
    with pytest.raises(ValueError, match="root of a trace"):
        span(parent_span_id="00000000000000cd")


def test_a_span_identifier_is_the_one_an_exporter_would_have_seen() -> None:
    """A trace that could not be correlated with what was exported is not a trace of it."""
    with pytest.raises(ValueError, match="16 lowercase hex"):
        span(span_id="not-hex")
    with pytest.raises(ValueError, match="32 lowercase hex"):
        RunSpanRecord(
            run_id=uuid4(),
            experiment_id=uuid4(),
            trace_id="short",
            span=span(),
            created_at=_EPOCH,
        )


def test_a_span_never_starts_or_lasts_a_negative_number_of_milliseconds() -> None:
    with pytest.raises(ValueError, match="negative number of milliseconds"):
        span(started_offset_ms=-1)
    with pytest.raises(ValueError, match="negative number of milliseconds"):
        span(duration_ms=-1)


# -- what actually reaches an exporter -----------------------------------------


def test_an_exported_span_carries_only_the_lab_s_own_pseudonymized_vocabulary() -> None:
    """The half of a trace that leaves the machine, held to the same rule as the stored half.

    Phoenix is a replaceable consumer (ADR 0004), and what it is handed has to be as safe as
    what is stored — which here means the lab's identifiers hashed, the framework, the arm,
    the turn, and the published tool name.
    """
    exporter = InMemorySpanExporter()
    telemetry = _recording_telemetry(exporter)
    tracer = create_run_tracer(telemetry)
    run_id, experiment_id = uuid4(), uuid4()

    recorded = tracer.record(
        AttemptTraceDraft(
            run_id=run_id,
            experiment_id=experiment_id,
            arm_label="A",
            framework_id=FAKE_FRAMEWORK_ID,
            ordinal=0,
            attempt=1,
            started_at=_EPOCH,
            spans=(
                SpanDraft(
                    kind=SpanKind.ATTEMPT, label="attempt", started_offset_ms=0, duration_ms=40
                ),
                SpanDraft(
                    kind=SpanKind.RUNTIME,
                    label=FAKE_FRAMEWORK_ID,
                    started_offset_ms=5,
                    duration_ms=30,
                ),
                SpanDraft(
                    kind=SpanKind.TOOL,
                    label=INTERACTION_CONTEXT,
                    started_offset_ms=10,
                    duration_ms=4,
                    sequence=0,
                    tool=INTERACTION_CONTEXT,
                    tool_version="v1",
                ),
            ),
        )
    )

    exported: tuple[ReadableSpan, ...] = exporter.get_finished_spans()
    assert [entry.name for entry in exported] == [
        "agent.tool",
        "agent.answer",
        "experiment.attempt",
    ]
    attributes = dict(exported[0].attributes or {})
    assert attributes["lab.run.id"] == telemetry.pseudonymize(str(run_id))
    assert str(run_id) not in str(attributes)
    assert attributes["tool.name"] == INTERACTION_CONTEXT
    assert attributes["agent.framework.id"] == FAKE_FRAMEWORK_ID
    assert set(attributes) <= {
        "lab.experiment.id",
        "lab.run.id",
        "lab.arm.label",
        "lab.turn.ordinal",
        "lab.span.label",
        "agent.attempt",
        "agent.framework.id",
        "tool.sequence",
        "tool.name",
        "tool.version",
    }
    # And the stored tree is the tree that was exported, span for span.
    assert {span.span_id for span in recorded.spans} == {
        format(entry.context.span_id, "016x") for entry in exported if entry.context is not None
    }


def test_an_exported_span_lasts_exactly_as_long_as_the_runner_measured() -> None:
    """Opened after the fact from the runner's own numbers, so nothing is measured twice."""
    exporter = InMemorySpanExporter()
    tracer = create_run_tracer(_recording_telemetry(exporter))

    tracer.record(
        AttemptTraceDraft(
            run_id=uuid4(),
            experiment_id=uuid4(),
            arm_label="A",
            framework_id=FAKE_FRAMEWORK_ID,
            ordinal=0,
            attempt=1,
            started_at=_EPOCH,
            spans=(
                SpanDraft(
                    kind=SpanKind.ATTEMPT, label="attempt", started_offset_ms=0, duration_ms=40
                ),
            ),
        )
    )

    (exported,) = exporter.get_finished_spans()
    assert exported.end_time is not None
    assert exported.start_time is not None
    assert (exported.end_time - exported.start_time) == 40_000_000


# -- stand-in runtimes and telemetry -------------------------------------------

_EPOCH = datetime(2026, 9, 7, 12, 0, tzinfo=UTC)


def _recording_telemetry(exporter: InMemorySpanExporter) -> Telemetry:
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return Telemetry(
        tracer=provider.get_tracer("capability_lab.test", "1.0.0"),
        hash_salt=b"test-salt",
        provider=provider,
    )


def _registry(runtime: SupportAgentRuntime) -> SupportAgentRuntimeRegistry:
    return SupportAgentRuntimeRegistry({runtime.framework_id: runtime})


class _StubRuntime(SupportAgentRuntime):
    @property
    def framework_id(self) -> str:
        return FAKE_FRAMEWORK_ID


class _CallingRuntime(_StubRuntime):
    """Calls one named tool with nothing filled in, so the tool declines."""

    def __init__(self, tool: str) -> None:
        self._tool = tool

    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> AgentAnswer:
        tools.invoke(self._tool, {})
        return AgentAnswer(body="Noted.", usage=ModelUsage.none())


class _FailingRuntime(_StubRuntime):
    async def answer(self, request: AgentTurnRequest, tools: SandboxToolInvoker) -> AgentAnswer:
        raise SupportAgentProviderError("the provider rejected the request")
