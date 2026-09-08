"""What the lab has proven a framework can do, declared apart from the adapters.

`PLAN.md` Milestone 3 requires that a requested configuration be validated against proven
adapter capabilities. "Proven" is a property of this project rather than of an SDK's
marketing, and it means two different things about the two halves of an entry.

A **capability** is proven in the strong sense: there is an implementation in this repository
and a required suite that keeps exercising it offline. A capability nothing exercises is not
declared, which is why a framework the lab reaches only through `SupportAgentRuntime` claims
less than one with a conversation adapter behind it — that port answers with text, so nothing
about it proves structured output (ADR 0041).

A **provider and model** is a different claim: the combination an author may select this
framework for, and the one the lab's own live smoke tests are written against. It is
deliberately *not* "somebody made a call with it today". Whether a live call has ever been
made depends on a credential, which is a fact about the machine — and keeping machine facts
out of this table is the whole reason it is separate from the adapter registry below. Which
frameworks have actually been run against a provider, and when, belongs in their ADRs where
it can be dated (ADR 0024, amended).

So the catalog is a declaration table, in the same spirit as `sandbox_tool_contracts` — the
publish gate reads it without importing an adapter, an SDK, or a model provider, and stays
testable offline.

The table is deliberately not the adapter registry. The registry answers "can this process
run it right now", which depends on an API key and an environment; the catalog answers "may
an author publish it at all", which must not change with the machine the Studio runs on. A
test asserts the two agree, so a catalog that drifts from the code fails rather than
misleads: every declared framework is one this lab has an implementation for, and one that
implements the POC's `AgentAdapter` declares exactly the capabilities that adapter does.

A framework may reach the catalog through either port. The POC's conversation adapter proves
one set; `SupportAgentRuntime` — the port an experiment arm actually runs through (ADR 0026)
— proves a narrower one, because it answers with text rather than a typed object. A
framework added for experiments alone therefore declares less than the two POC adapters do,
which is the catalog working: it records what was run, not what an SDK advertises
(ADR 0041).

A provider a framework is not published for is a publish error, because nothing in the lab
could execute it. A *model* within a published provider is softer still: the lab does not
publish a framework for every model of a provider it supports, so an unlisted model is a
warning naming the ones it does.
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
    "OPENAI_AGENTS_FRAMEWORK_ID",
    "PROVEN_FRAMEWORKS",
    "PROVEN_FRAMEWORKS_BY_ID",
    "PYDANTIC_AI_FRAMEWORK_ID",
    "ProvenFramework",
    "capability_issues",
    "default_agent_configuration_model",
]

FAKE_FRAMEWORK_ID = "fake"
PYDANTIC_AI_FRAMEWORK_ID = "pydantic-ai"
OPENAI_AGENTS_FRAMEWORK_ID = "openai-agents"


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

# What the two POC conversation adapters declare. Kept as one name so the catalog and the
# adapters cannot be edited apart without the agreement test noticing.
_ADAPTER_CAPABILITIES = frozenset(
    {
        AgentCapability.TOOL_CALLS,
        AgentCapability.CONVERSATION_MEMORY,
        AgentCapability.SESSION_RESUME,
        AgentCapability.STRUCTURED_OUTPUT,
    }
)

# What a framework proven only through `SupportAgentRuntime` can claim. Narrower by exactly
# one member, and the difference is the point: the runtime port answers with text, because
# every fact an arm touched is already the tool event that produced it (ADR 0026). A
# framework the lab has never asked for a typed object has not proven it can return one, and
# a catalog that said otherwise would be advertising an SDK's feature list rather than the
# lab's evidence.
_RUNTIME_CAPABILITIES = frozenset(
    {
        AgentCapability.TOOL_CALLS,
        AgentCapability.CONVERSATION_MEMORY,
        AgentCapability.SESSION_RESUME,
    }
)

PROVEN_FRAMEWORKS: tuple[ProvenFramework, ...] = (
    ProvenFramework(
        framework_id=PYDANTIC_AI_FRAMEWORK_ID,
        label="Pydantic AI",
        architectures=_SINGLE_AGENT,
        providers=frozenset({"openai"}),
        models=("gpt-5-mini",),
        capabilities=_ADAPTER_CAPABILITIES,
        summary="The lab's first support adapter, proven end to end against a live model.",
    ),
    ProvenFramework(
        framework_id=OPENAI_AGENTS_FRAMEWORK_ID,
        label="OpenAI Agents SDK",
        architectures=_SINGLE_AGENT,
        providers=frozenset({"openai"}),
        models=("gpt-5-mini",),
        capabilities=_RUNTIME_CAPABILITIES,
        summary=(
            "The lab's second experiment framework, on the same provider and model as the "
            "first so a two-arm run moves only the framework."
        ),
    ),
    ProvenFramework(
        framework_id=FAKE_FRAMEWORK_ID,
        label="Deterministic fake",
        architectures=_SINGLE_AGENT,
        providers=frozenset({"fake"}),
        models=("deterministic",),
        capabilities=_ADAPTER_CAPABILITIES,
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
