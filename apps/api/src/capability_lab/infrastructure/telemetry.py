from __future__ import annotations

import hashlib
import hmac
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, replace
from uuid import UUID

from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import Span, Tracer

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
