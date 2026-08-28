"""What the lab has actually proven a framework can do, declared apart from the adapters.

`PLAN.md` Milestone 3 requires that a requested configuration be validated against proven
adapter capabilities. "Proven" is a property of this project, not of an SDK's marketing: it
means the lab has run the combination and has tests that keep running it. So the catalog is
a declaration table, in the same spirit as `sandbox_tool_contracts` — the publish gate reads
it without importing an adapter, an SDK, or a model provider, and stays testable offline.

The table is deliberately not the adapter registry. The registry answers "can this process
run it right now", which depends on an API key and an environment; the catalog answers "may
an author publish it at all", which must not change with the machine the Studio runs on. A
test asserts the two agree on capabilities, so a catalog that drifts from the adapters fails
rather than misleads.

A provider is proven or it is not — an unproven one is a publish error, because nothing in
the lab could execute it. A *model* within a proven provider is a softer claim: the lab
cannot run every model of a provider it supports, so an unlisted model is a warning that
names what has actually been exercised.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal
from types import MappingProxyType

from capability_lab.application.ports import AgentCapability
from capability_lab.domain.agent_configuration import (
    AgentArchitecture,
    AgentConfigurationPayload,
    MemoryMode,
    ModelSettings,
)
from capability_lab.domain.definitions import DefinitionIssue, issue_error, issue_warning

__all__ = [
    "DEFAULT_MODEL_SETTINGS",
    "FAKE_FRAMEWORK_ID",
    "MEMORY_CAPABILITIES",
    "PROVEN_FRAMEWORKS",
    "PROVEN_FRAMEWORKS_BY_ID",
    "PYDANTIC_AI_FRAMEWORK_ID",
    "ProvenFramework",
    "capability_issues",
    "default_agent_configuration_model",
]

FAKE_FRAMEWORK_ID = "fake"
PYDANTIC_AI_FRAMEWORK_ID = "pydantic-ai"


@dataclass(frozen=True, slots=True)
class ProvenFramework:
    """One framework the lab can run, and the envelope it has been proven inside."""

    framework_id: str
    label: str
    architectures: frozenset[AgentArchitecture]
    providers: frozenset[str]
    models: tuple[str, ...]
    capabilities: frozenset[AgentCapability]
    summary: str

    def proves(self, capability: AgentCapability) -> bool:
        return capability in self.capabilities


_SINGLE_AGENT = frozenset({AgentArchitecture.SINGLE_AGENT})

# The capability set both adapters declare today. Kept as one name so the catalog and the
# adapters cannot be edited apart without the agreement test noticing.
_PROVEN_CAPABILITIES = frozenset(
    {
        AgentCapability.TOOL_CALLS,
        AgentCapability.CONVERSATION_MEMORY,
        AgentCapability.SESSION_RESUME,
        AgentCapability.STRUCTURED_OUTPUT,
    }
)

PROVEN_FRAMEWORKS: tuple[ProvenFramework, ...] = (
    ProvenFramework(
        framework_id=PYDANTIC_AI_FRAMEWORK_ID,
        label="Pydantic AI",
        architectures=_SINGLE_AGENT,
        providers=frozenset({"openai"}),
        models=("gpt-5-mini",),
        capabilities=_PROVEN_CAPABILITIES,
        summary="The lab's first support adapter, proven end to end against a live model.",
    ),
    ProvenFramework(
        framework_id=FAKE_FRAMEWORK_ID,
        label="Deterministic fake",
        architectures=_SINGLE_AGENT,
        providers=frozenset({"fake"}),
        models=("deterministic",),
        capabilities=_PROVEN_CAPABILITIES,
        summary="Offline adapter with no model call; the control arm for deterministic runs.",
    ),
)

PROVEN_FRAMEWORKS_BY_ID: Mapping[str, ProvenFramework] = MappingProxyType(
    {framework.framework_id: framework for framework in PROVEN_FRAMEWORKS}
)

# What each memory mode asks of the framework running the agent. `NONE` asks nothing.
MEMORY_CAPABILITIES: Mapping[MemoryMode, AgentCapability | None] = MappingProxyType(
    {
        MemoryMode.NONE: None,
        MemoryMode.CONVERSATION: AgentCapability.CONVERSATION_MEMORY,
        MemoryMode.DURABLE: AgentCapability.DURABLE_MEMORY,
    }
)

DEFAULT_MODEL_SETTINGS = ModelSettings(
    provider="openai",
    model_id="gpt-5-mini",
    temperature=Decimal("0.20"),
    max_tool_rounds=8,
)
"""What a new draft starts on: the combination the lab already runs.

The domain has no opinion about which model is reasonable — that is lab policy, and policy
belongs beside the catalog that records what the lab has proven.
"""


def default_agent_configuration_model() -> ModelSettings:
    return DEFAULT_MODEL_SETTINGS


def capability_issues(payload: AgentConfigurationPayload) -> tuple[DefinitionIssue, ...]:
    """Every publish-gate finding that comes from what the lab can actually run."""
    framework = PROVEN_FRAMEWORKS_BY_ID.get(payload.framework_id)
    if framework is None:
        return (
            issue_error(
                "framework_not_proven",
                f"{payload.framework_id} is not a framework the lab has proven it can run",
                "framework_id",
            ),
        )

    issues: list[DefinitionIssue] = []
    if payload.architecture not in framework.architectures:
        issues.append(
            issue_error(
                "architecture_not_proven",
                f"{framework.label} has not been proven in the "
                f"{payload.architecture.value} architecture",
                "architecture",
            )
        )
    if payload.model.provider not in framework.providers:
        issues.append(
            issue_error(
                "provider_not_proven",
                f"{framework.label} has not been proven against the "
                f"{payload.model.provider} provider",
                "model.provider",
            )
        )
    elif payload.model.model_id not in framework.models:
        issues.append(
            issue_warning(
                "model_not_exercised",
                f"{payload.model.model_id} is not a model the lab exercises; "
                f"{framework.label} is proven on {', '.join(framework.models)}",
                "model.model_id",
            )
        )

    required = MEMORY_CAPABILITIES[payload.memory]
    if required is not None and not framework.proves(required):
        issues.append(
            issue_error(
                "capability_not_proven",
                f"{framework.label} has not proven {required.value}, which "
                f"{payload.memory.value} memory requires",
                "memory",
            )
        )
    if payload.tools and not framework.proves(AgentCapability.TOOL_CALLS):
        issues.append(
            issue_error(
                "capability_not_proven",
                f"{framework.label} has not proven tool calls, so it cannot use the "
                f"{len(payload.tools)} tool(s) this configuration enables",
                "tools",
            )
        )
    return tuple(issues)
