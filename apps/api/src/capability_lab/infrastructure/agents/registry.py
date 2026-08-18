from __future__ import annotations

from capability_lab.application.conversations import AgentRegistry, FrameworkDeclaration
from capability_lab.application.ports import AgentAdapter
from capability_lab.infrastructure.agents.fake import FakeAgentAdapter
from capability_lab.infrastructure.agents.pydantic_ai import PydanticAiAgentAdapter
from capability_lab.infrastructure.agents.pydantic_ai.adapter import create_openai_model
from capability_lab.infrastructure.config import Settings
from capability_lab.infrastructure.telemetry import SanitizedTracingAgentAdapter, Telemetry


def create_agent_registry(settings: Settings, telemetry: Telemetry) -> AgentRegistry:
    adapters: dict[str, AgentAdapter] = {}
    fake = SanitizedTracingAgentAdapter(FakeAgentAdapter(), telemetry)
    adapters[fake.framework_id] = fake

    pydantic_adapter: AgentAdapter | None = None
    unavailable_reason: str | None = None
    if settings.environment == "test":
        pydantic_adapter = PydanticAiAgentAdapter.for_test()
    elif settings.openai_api_key is not None:
        pydantic_adapter = PydanticAiAgentAdapter(
            create_openai_model(
                settings.openai_model,
                settings.openai_api_key.get_secret_value(),
            )
        )
    else:
        unavailable_reason = "AGENT_LAB_OPENAI_API_KEY is not configured"

    if pydantic_adapter is not None:
        pydantic_adapter = SanitizedTracingAgentAdapter(pydantic_adapter, telemetry)
        adapters[pydantic_adapter.framework_id] = pydantic_adapter

    declarations = tuple(
        _declaration(
            adapter,
            model_id=settings.openai_model if adapter.framework_id == "pydantic-ai" else None,
        )
        for adapter in adapters.values()
    ) + (
        ()
        if pydantic_adapter is not None
        else (
            FrameworkDeclaration(
                framework_id="pydantic-ai",
                available=False,
                model_id=settings.openai_model,
                capabilities=(),
                unavailability_reason=unavailable_reason,
            ),
        )
    )
    return AgentRegistry(adapters, declarations)


def _declaration(adapter: AgentAdapter, *, model_id: str | None) -> FrameworkDeclaration:
    return FrameworkDeclaration(
        framework_id=adapter.framework_id,
        available=True,
        model_id=model_id,
        capabilities=tuple(sorted(capability.value for capability in adapter.capabilities())),
    )
