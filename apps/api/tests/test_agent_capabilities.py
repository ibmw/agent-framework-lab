"""The proven-capability catalog, and its agreement with the adapters it describes."""

from decimal import Decimal

from agent_factories import model_settings, publishable_configuration
from capability_lab.application.agent_capabilities import (
    FAKE_FRAMEWORK_ID,
    OPENAI_AGENTS_FRAMEWORK_ID,
    PROVEN_FRAMEWORKS,
    PROVEN_FRAMEWORKS_BY_ID,
    PYDANTIC_AI_FRAMEWORK_ID,
    capability_issues,
)
from capability_lab.application.agent_runtime import SupportAgentRuntime
from capability_lab.application.ports import AgentAdapter, AgentCapability
from capability_lab.domain.agent_configuration import (
    AgentArchitecture,
    AgentConfigurationPayload,
    MemoryMode,
)
from capability_lab.infrastructure.agents.fake import FakeAgentAdapter, FakeSupportAgentRuntime
from capability_lab.infrastructure.agents.openai_agents import OpenAiAgentsSupportAgentRuntime
from capability_lab.infrastructure.agents.pydantic_ai import (
    PydanticAiAgentAdapter,
    PydanticAiSupportAgentRuntime,
)


def codes(payload: AgentConfigurationPayload) -> set[str]:
    return {issue.code for issue in capability_issues(payload)}


ADAPTERS: tuple[AgentAdapter, ...] = (FakeAgentAdapter(), PydanticAiAgentAdapter.for_test())
"""Every framework behind the POC's conversation port."""

RUNTIMES: tuple[SupportAgentRuntime, ...] = (
    FakeSupportAgentRuntime(),
    PydanticAiSupportAgentRuntime.for_test(),
    OpenAiAgentsSupportAgentRuntime.for_test(),
)
"""Every framework behind the port an experiment arm runs through (ADR 0026)."""


def test_the_catalog_declares_exactly_the_frameworks_the_lab_has_an_implementation_for() -> None:
    """A catalog that drifted either way would refuse or admit the wrong publication.

    A framework may arrive through either port, so the union is what the catalog answers to.
    An entry with neither implementation would let an author publish a configuration nothing
    can run; an implementation with no entry would be a framework nobody may publish.
    """
    implemented = {adapter.framework_id for adapter in ADAPTERS} | {
        runtime.framework_id for runtime in RUNTIMES
    }

    assert implemented == set(PROVEN_FRAMEWORKS_BY_ID)


def test_a_framework_with_a_conversation_adapter_declares_what_that_adapter_proves() -> None:
    """The catalog's claim about the POC port is the adapter's own answer, not a copy."""
    for adapter in ADAPTERS:
        declared = PROVEN_FRAMEWORKS_BY_ID[adapter.framework_id]
        assert declared.capabilities == adapter.capabilities()


def test_a_framework_proven_only_as_an_experiment_runtime_claims_no_structured_output() -> None:
    """The runtime port answers with text, so nothing about it proves a typed object.

    `SupportAgentRuntime.answer` returns the arm's reply and its usage, because every fact
    an arm touched is already the tool event that produced it (ADR 0026). A framework the lab
    reaches only that way has never been asked for structured output, and the catalog says so
    rather than repeating an SDK's feature list.
    """
    adapters = {adapter.framework_id for adapter in ADAPTERS}
    runtime_only = [
        framework for framework in PROVEN_FRAMEWORKS if framework.framework_id not in adapters
    ]

    assert [framework.framework_id for framework in runtime_only] == [OPENAI_AGENTS_FRAMEWORK_ID]
    for framework in runtime_only:
        assert not framework.proves(AgentCapability.STRUCTURED_OUTPUT)
        assert framework.proves(AgentCapability.TOOL_CALLS)
        assert framework.proves(AgentCapability.CONVERSATION_MEMORY)


def test_every_declared_framework_can_run_the_only_architecture_that_exists() -> None:
    for framework in PROVEN_FRAMEWORKS:
        assert AgentArchitecture.SINGLE_AGENT in framework.architectures
        assert framework.models
        assert framework.providers


def test_a_framework_the_lab_has_not_proven_cannot_be_published() -> None:
    payload = publishable_configuration(framework_id="langgraph")

    assert codes(payload) == {"framework_not_proven"}


def test_a_provider_outside_the_framework_is_an_error_and_an_unrun_model_a_warning() -> None:
    assert "provider_not_proven" in codes(
        publishable_configuration(model=model_settings(provider="anthropic"))
    )
    assert "model_not_exercised" in codes(
        publishable_configuration(model=model_settings(model_id="gpt-4.1"))
    )


def test_the_two_model_gate_messages_are_the_exact_words_the_studio_repeats() -> None:
    """Pinned because the Studio holds a second copy of both.

    `apps/web/src/lib/fieldRules.ts` writes these sentences under the provider and the model
    fields as they are typed, because `GET /draft/preview` previews the saved draft and cannot
    be asked about a value still being typed. Until a preview accepts a draft payload, one rule
    has two authors; this test is the end that stops the backend moving silently. The other end
    is `apps/web/src/lib/fieldRules.test.ts`.
    """
    provider = next(
        issue
        for issue in capability_issues(
            publishable_configuration(model=model_settings(provider="anthropic"))
        )
        if issue.code == "provider_not_proven"
    )
    model = next(
        issue
        for issue in capability_issues(
            publishable_configuration(model=model_settings(model_id="gpt-4.1"))
        )
        if issue.code == "model_not_exercised"
    )

    assert provider.message == "Pydantic AI has not been proven against the anthropic provider"
    assert model.message == (
        "gpt-4.1 is not a model the lab exercises; Pydantic AI is proven on gpt-5-mini"
    )


def test_memory_the_lab_has_never_persisted_cannot_be_published() -> None:
    payload = publishable_configuration(memory=MemoryMode.DURABLE)
    issue = next(
        issue for issue in capability_issues(payload) if issue.code == "capability_not_proven"
    )

    assert AgentCapability.DURABLE_MEMORY.value in issue.message
    assert capability_issues(publishable_configuration(memory=MemoryMode.NONE)) == ()


def test_a_proven_combination_reports_nothing() -> None:
    assert (
        capability_issues(
            publishable_configuration(
                framework_id=PYDANTIC_AI_FRAMEWORK_ID,
                model=model_settings(temperature=Decimal("0.00")),
            )
        )
        == ()
    )
    assert (
        capability_issues(
            publishable_configuration(
                framework_id=FAKE_FRAMEWORK_ID,
                model=model_settings(provider="fake", model_id="deterministic"),
            )
        )
        == ()
    )
