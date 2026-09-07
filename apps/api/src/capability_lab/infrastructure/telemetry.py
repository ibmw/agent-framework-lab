from __future__ import annotations

import hashlib
import hmac
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, replace
from typing import ClassVar
from uuid import UUID

from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import Span, Tracer, set_span_in_context

from capability_lab.application.experiment_traces import (
    AttemptTraceDraft,
    RecordedTrace,
    RunSpan,
    RunTracer,
    SpanDraft,
    SpanKind,
)
from capability_lab.application.order_actions import ActionProposalDraft, OrderActionRequest
from capability_lab.application.ports import (
    AgentAdapter,
    AgentCapability,
    AgentRequest,
    AgentResponse,
)
from capability_lab.infrastructure.config import Settings


@dataclass(frozen=True, slots=True)
class Telemetry:
    tracer: Tracer
    hash_salt: bytes
    provider: TracerProvider | None = None

    def pseudonymize(self, value: str) -> str:
        return hmac.new(self.hash_salt, value.encode(), hashlib.sha256).hexdigest()

    @contextmanager
    def action_span(
        self,
        stage: str,
        *,
        session_id: UUID,
        attempt: int = 1,
    ) -> Generator[Span, None, None]:
        with self.tracer.start_as_current_span(
            f"agent.action.{stage}",
            record_exception=False,
            set_status_on_exception=False,
        ) as span:
            span.set_attribute("lab.session.id", self.pseudonymize(str(session_id)))
            span.set_attribute("tool.name", "cancel_order")
            span.set_attribute("tool.version", "v1")
            span.set_attribute("action.stage", stage)
            span.set_attribute("action.attempt", attempt)
            try:
                yield span
            except Exception as error:
                span.set_attribute("action.outcome", "error")
                span.set_attribute("error.type", type(error).__name__)
                raise

    def shutdown(self) -> None:
        if self.provider is None:
            return
        self.provider.force_flush()
        self.provider.shutdown()


class SanitizedTracingAgentAdapter(AgentAdapter):
    """Emit common spans using only allowlisted, pseudonymized metadata."""

    def __init__(self, adapter: AgentAdapter, telemetry: Telemetry) -> None:
        self._adapter = adapter
        self._telemetry = telemetry

    @property
    def framework_id(self) -> str:
        return self._adapter.framework_id

    def capabilities(self) -> frozenset[AgentCapability]:
        return self._adapter.capabilities() | {AgentCapability.TRACING}

    async def run(self, request: AgentRequest) -> AgentResponse:
        with self._telemetry.tracer.start_as_current_span(
            "agent.run",
            record_exception=False,
            set_status_on_exception=False,
        ) as span:
            span.set_attribute("agent.framework.id", self.framework_id)
            span.set_attribute("lab.scenario.version", request.scenario_version)
            span.set_attribute("lab.session.id", self._pseudonymize(str(request.session_id)))
            span.set_attribute("lab.customer.id", self._pseudonymize(str(request.customer_id)))
            span.set_attribute("agent.attempt", 1)
            try:
                response = await self._adapter.run(request)
            except Exception as error:
                span.set_attribute("agent.outcome", "error")
                span.set_attribute("error.type", type(error).__name__)
                raise
            span.set_attribute("agent.outcome", "success")
            for activity in response.tool_activity:
                with self._telemetry.tracer.start_as_current_span(
                    "agent.tool",
                    record_exception=False,
                    set_status_on_exception=False,
                ) as tool_span:
                    tool_span.set_attribute("tool.name", activity.tool_name)
                    tool_span.set_attribute("tool.version", activity.tool_version)
                    tool_span.set_attribute("tool.outcome", activity.outcome)
                    tool_span.set_attribute("tool.attempt", 1)
            trace_id = format(span.get_span_context().trace_id, "032x")
            return replace(response, trace_id=trace_id)

    async def propose_action(self, request: OrderActionRequest) -> ActionProposalDraft:
        with self._telemetry.tracer.start_as_current_span(
            "agent.action.propose",
            record_exception=False,
            set_status_on_exception=False,
        ) as span:
            span.set_attribute("agent.framework.id", self.framework_id)
            span.set_attribute("lab.session.id", self._pseudonymize(str(request.session_id)))
            span.set_attribute("lab.customer.id", self._pseudonymize(str(request.customer_id)))
            span.set_attribute("tool.name", request.action_type.value)
            span.set_attribute("tool.version", "v1")
            span.set_attribute("action.expected_version", request.expected_version)
            try:
                proposal = await self._adapter.propose_action(request)
            except Exception as error:
                span.set_attribute("action.outcome", "error")
                span.set_attribute("error.type", type(error).__name__)
                raise
            span.set_attribute("action.outcome", "proposed")
            return proposal

    def _pseudonymize(self, value: str) -> str:
        return self._telemetry.pseudonymize(value)


def create_telemetry(settings: Settings) -> Telemetry:
    provider = TracerProvider(resource=Resource.create({"service.name": "agent-lab-api"}))
    if settings.otel_exporter_otlp_endpoint:
        exporter = OTLPSpanExporter(endpoint=settings.otel_exporter_otlp_endpoint)
        provider.add_span_processor(BatchSpanProcessor(exporter))
    return Telemetry(
        tracer=provider.get_tracer("capability_lab.agent", "1.0.0"),
        hash_salt=settings.telemetry_hash_salt.get_secret_value().encode(),
        provider=provider,
    )


class OtelRunTracer:
    """Turn one attempt's measurements into real OpenTelemetry spans, and keep their ids.

    The runner measured everything already (ADR 0032), so the spans are opened with explicit
    start and end times taken from that one measurement rather than from a clock read here.
    That is what makes a tool span's extent and the tool event's `duration_ms` the same
    number by construction instead of by coincidence.

    Opening them after the fact costs the trace nothing that matters. A span carries no
    context that has to be live: the parentage is explicit, the timing is the runner's, and
    an exporter reads a finished span either way. What it buys is that the runner stays an
    application object holding no SDK type, and that an attempt that breaks halfway can
    never leave a span open in an evidence record.

    The attributes are the allowlist ADR 0004 asks for, written rather than filtered: the
    lab's own identifiers pseudonymized, the framework, the arm, the turn, and the published
    tool name and version. Nothing here is a value a tool answered with or a word anybody
    said — which is the same rule the stored span keeps by having no attribute column at all.
    """

    _NAMES: ClassVar[dict[SpanKind, str]] = {
        SpanKind.ATTEMPT: "experiment.attempt",
        SpanKind.RUNTIME: "agent.answer",
        SpanKind.TOOL: "agent.tool",
    }

    def __init__(self, telemetry: Telemetry) -> None:
        self._telemetry = telemetry

    def record(self, draft: AttemptTraceDraft) -> RecordedTrace:
        base = int(draft.started_at.timestamp() * 1_000_000_000)
        common: dict[str, str | int] = {
            "lab.experiment.id": self._telemetry.pseudonymize(str(draft.experiment_id)),
            "lab.run.id": self._telemetry.pseudonymize(str(draft.run_id)),
            "lab.arm.label": draft.arm_label,
            "lab.turn.ordinal": draft.ordinal,
            "agent.attempt": draft.attempt,
            "agent.framework.id": draft.framework_id,
        }
        opened: list[tuple[SpanDraft, Span, str | None]] = []
        root: Span | None = None
        runtime: Span | None = None
        for entry in draft.spans:
            parent = None if entry.kind is SpanKind.ATTEMPT else (runtime or root)
            span = self._telemetry.tracer.start_span(
                self._NAMES[entry.kind],
                context=None if parent is None else set_span_in_context(parent),
                attributes=common | self._attributes(entry),
                start_time=base + entry.started_offset_ms * 1_000_000,
                record_exception=False,
                set_status_on_exception=False,
            )
            if entry.kind is SpanKind.ATTEMPT:
                root = span
            elif entry.kind is SpanKind.RUNTIME:
                runtime = span
            opened.append((entry, span, None if parent is None else _span_id(parent)))

        recorded: list[RunSpan] = []
        trace_id = ""
        # Ended in reverse so a child never outlives the parent that contains it, which is
        # the one thing a waterfall renders wrong if it is untrue.
        for entry, span, parent_id in reversed(opened):
            span.end(end_time=base + (entry.started_offset_ms + entry.duration_ms) * 1_000_000)
            trace_id = format(span.get_span_context().trace_id, "032x")
            recorded.append(
                RunSpan(
                    span_id=_span_id(span),
                    parent_span_id=parent_id,
                    kind=entry.kind,
                    ordinal=draft.ordinal,
                    attempt=draft.attempt,
                    started_offset_ms=entry.started_offset_ms,
                    duration_ms=entry.duration_ms,
                    sequence=entry.sequence,
                )
            )
        return RecordedTrace(trace_id=trace_id, spans=tuple(reversed(recorded)))

    @staticmethod
    def _attributes(entry: SpanDraft) -> dict[str, str | int]:
        attributes: dict[str, str | int] = {"lab.span.label": entry.label}
        if entry.sequence is not None:
            attributes["tool.sequence"] = entry.sequence
        if entry.tool is not None:
            attributes["tool.name"] = entry.tool
        if entry.tool_version is not None:
            attributes["tool.version"] = entry.tool_version
        return attributes


def _span_id(span: Span) -> str:
    return format(span.get_span_context().span_id, "016x")


def create_run_tracer(telemetry: Telemetry) -> RunTracer:
    """The tracer an experiment arm records through.

    Over the same `Telemetry` the POC's conversation adapter uses, so one process has one
    tracer provider, one salt, and one exporter setting. Whether a span leaves this machine
    is that provider's business and never the runner's (ADR 0004).
    """
    return OtelRunTracer(telemetry)
