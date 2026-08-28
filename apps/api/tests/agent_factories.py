"""Shared agent-configuration fixtures for the Milestone 3 test modules."""

from decimal import Decimal
from uuid import UUID, uuid4

from capability_lab.application.agent_capabilities import (
    PYDANTIC_AI_FRAMEWORK_ID,
    default_agent_configuration_model,
)
from capability_lab.application.sandbox_tool_contracts import (
    READ_TOOL_CONTRACTS,
    ToolEffect,
)
from capability_lab.domain.agent_configuration import (
    AgentConfigurationPayload,
    ModelSettings,
)

PUBLISHABLE_PROMPT = (
    "You are {{support_identity.role}} for {{shop.name}}.\n\n"
    "Write in the shop's tone of voice: {{shop.tone_of_voice}}.\n"
    "Use the provided tools for every commerce fact; never invent one."
)

READ_TOOL_NAMES: tuple[str, ...] = tuple(
    contract.name for contract in READ_TOOL_CONTRACTS if contract.effect is ToolEffect.READ
)


def model_settings(**overrides: object) -> ModelSettings:
    default = default_agent_configuration_model()
    fields: dict[str, object] = {
        "provider": default.provider,
        "model_id": default.model_id,
        "temperature": Decimal("0.20"),
        "max_tool_rounds": 8,
    }
    fields.update(overrides)
    return ModelSettings(**fields)  # type: ignore[arg-type]


def publishable_configuration(
    support_identity_id: UUID | None = None, **overrides: object
) -> AgentConfigurationPayload:
    """An agent configuration with no publish-gate errors of its own."""
    fields: dict[str, object] = {
        "name": "Frontline single agent",
        "framework_id": PYDANTIC_AI_FRAMEWORK_ID,
        "support_identity_id": support_identity_id or uuid4(),
        "model": model_settings(),
        "description": "The lab's first published support agent.",
        "prompt": PUBLISHABLE_PROMPT,
        "tools": READ_TOOL_NAMES,
    }
    fields.update(overrides)
    return AgentConfigurationPayload(**fields)  # type: ignore[arg-type]
