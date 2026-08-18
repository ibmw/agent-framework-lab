from __future__ import annotations

import ast
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import NoReturn
from uuid import UUID

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel

from capability_lab.application.conversations import (
    AgentProviderError,
    AgentTransientError,
    AgentValidationError,
)
from capability_lab.application.ports import (
    AgentAdapter,
    AgentCapability,
    AgentRequest,
    AgentResponse,
    ConversationTurn,
    StructuredSupportResult,
)
from capability_lab.application.scenario_generation import create_retail_profile_kernel
from capability_lab.application.support_tools import RetailSupportContext
from capability_lab.infrastructure.agents.fake import FakeAgentAdapter
from capability_lab.infrastructure.agents.pydantic_ai import PydanticAiAgentAdapter
from capability_lab.infrastructure.telemetry import SanitizedTracingAgentAdapter, Telemetry


class FixedClock:
    def now(self) -> datetime:
        return datetime(2026, 8, 18, 12, 0, tzinfo=UTC)


def request_with_history(history_size: int = 0) -> AgentRequest:
    generated = create_retail_profile_kernel(FixedClock()).generate("retail-profile", "v1", 1234)
    state = generated.state
    response = AgentResponse(
        message="Earlier answer",
        structured_result=StructuredSupportResult(
            summary="Earlier summary",
            customer_id=state.customer.id,
            product_ids=(),
            order_ids=(),
        ),
        tool_activity=(),
    )
    history = tuple(
        ConversationTurn(
            id=UUID(f"00000000-0000-4000-8000-{index + 1:012d}"),
            session_id=UUID("10000000-0000-4000-8000-000000000000"),
            ordinal=index + 1,
            request_message="Earlier question",
            response=response,
            created_at=FixedClock().now(),
        )
        for index in range(history_size)
    )
    return AgentRequest(
        session_id=UUID("10000000-0000-4000-8000-000000000000"),
        customer_id=state.customer.id,
        scenario_version="v1",
        message="What is on my account and what orders do I have?",
        history=history,
        support_context=RetailSupportContext(
            customer=state.customer,
            products=state.products,
            orders=state.orders,
        ),
    )


ADAPTER_FACTORIES: tuple[Callable[[], AgentAdapter], ...] = (
    FakeAgentAdapter,
    lambda: PydanticAiAgentAdapter(TestModel()),
)


@pytest.mark.parametrize("adapter_factory", ADAPTER_FACTORIES)
async def test_agent_adapter_conformance_for_tools_structure_and_resume(
    adapter_factory: Callable[[], AgentAdapter],
) -> None:
    adapter = adapter_factory()

    first = await adapter.run(request_with_history())
    resumed = await adapter_factory().run(request_with_history(history_size=1))

    expected = frozenset(
        {
            AgentCapability.TOOL_CALLS,
            AgentCapability.CONVERSATION_MEMORY,
            AgentCapability.SESSION_RESUME,
            AgentCapability.STRUCTURED_OUTPUT,
        }
    )
    assert adapter.capabilities() == expected
    assert first.message
    assert resumed.message
    assert first.structured_result.customer_id == request_with_history().customer_id
    assert {activity.tool_name for activity in first.tool_activity} == {
        "read_customer",
        "list_products",
        "list_customer_orders",
    }
    assert all(activity.tool_version == "v1" for activity in first.tool_activity)
    assert all(activity.outcome == "success" for activity in first.tool_activity)


async def test_pydantic_adapter_rejects_output_without_proven_tool_use() -> None:
    adapter = PydanticAiAgentAdapter(TestModel(call_tools=[]))

    with pytest.raises(AgentValidationError, match="without using"):
        await adapter.run(request_with_history())


async def test_pydantic_adapter_classifies_provider_throttling_as_transient() -> None:
    def throttled(_messages: object, _info: object) -> NoReturn:
        raise ModelHTTPError(429, "offline-test", {"error": "rate limited"})

    adapter = PydanticAiAgentAdapter(FunctionModel(throttled))

    with pytest.raises(AgentTransientError, match="temporarily unavailable"):
        await adapter.run(request_with_history())


async def test_pydantic_adapter_classifies_non_transient_provider_failure() -> None:
    def rejected(_messages: object, _info: object) -> NoReturn:
        raise ModelHTTPError(400, "offline-test", {"error": "rejected"})

    adapter = PydanticAiAgentAdapter(FunctionModel(rejected))

    with pytest.raises(AgentProviderError, match="rejected"):
        await adapter.run(request_with_history())


async def test_common_traces_are_correlated_and_exclude_sensitive_content() -> None:
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    adapter = SanitizedTracingAgentAdapter(
        FakeAgentAdapter(),
        Telemetry(provider.get_tracer("test"), b"unit-test-salt"),
    )
    request = request_with_history()

    response = await adapter.run(request)

    spans = exporter.get_finished_spans()
    assert response.trace_id is not None and len(response.trace_id) == 32
    assert {span.name for span in spans} == {"agent.run", "agent.tool"}
    parent = next(span for span in spans if span.name == "agent.run")
    attributes = dict(parent.attributes or {})
    assert attributes["agent.framework.id"] == "fake"
    assert attributes["lab.scenario.version"] == "v1"
    assert attributes["lab.session.id"] != str(request.session_id)
    exported = repr([(span.attributes, span.events) for span in spans])
    assert request.message not in exported
    assert request.support_context.customer.email not in exported


def test_agent_sdk_imports_are_isolated_to_framework_adapters() -> None:
    source_root = Path(__file__).parents[1] / "src" / "capability_lab"
    offenders: list[str] = []
    for path in source_root.rglob("*.py"):
        tree = ast.parse(path.read_text())
        imports_sdk = any(
            (
                isinstance(node, ast.ImportFrom)
                and node.module is not None
                and node.module.startswith("pydantic_ai")
            )
            or (
                isinstance(node, ast.Import)
                and any(alias.name.startswith("pydantic_ai") for alias in node.names)
            )
            for node in ast.walk(tree)
        )
        if not imports_sdk:
            continue
        relative = path.relative_to(source_root).as_posix()
        if not relative.startswith("infrastructure/agents/pydantic_ai/"):
            offenders.append(relative)

    assert offenders == []
