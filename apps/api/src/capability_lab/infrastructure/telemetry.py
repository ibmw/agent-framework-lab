from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass, replace

from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import Tracer

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

    def _pseudonymize(self, value: str) -> str:
        return hmac.new(self._telemetry.hash_salt, value.encode(), hashlib.sha256).hexdigest()


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
