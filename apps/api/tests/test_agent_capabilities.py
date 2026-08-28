"""The proven-capability catalog, and its agreement with the adapters it describes."""

from decimal import Decimal

from agent_factories import model_settings, publishable_configuration
from capability_lab.application.agent_capabilities import (
    FAKE_FRAMEWORK_ID,
    PROVEN_FRAMEWORKS,
    PROVEN_FRAMEWORKS_BY_ID,
    PYDANTIC_AI_FRAMEWORK_ID,
    capability_issues,
)
from capability_lab.application.ports import AgentAdapter, AgentCapability
from capability_lab.domain.agent_configuration import (
    AgentArchitecture,
    AgentConfigurationPayload,
    MemoryMode,
)
from capability_lab.infrastructure.agents.fake import FakeAgentAdapter
from capability_lab.infrastructure.agents.pydantic_ai import PydanticAiAgentAdapter


def codes(payload: AgentConfigurationPayload) -> set[str]:
    return {issue.code for issue in capability_issues(payload)}


def test_the_catalog_declares_what_the_registered_adapters_actually_prove() -> None:
    """A catalog that drifts from its adapters would refuse or admit the wrong publication."""
    adapters: tuple[AgentAdapter, ...] = (FakeAgentAdapter(), PydanticAiAgentAdapter.for_test())

    assert {adapter.framework_id for adapter in adapters} == set(PROVEN_FRAMEWORKS_BY_ID)
    for adapter in adapters:
        declared = PROVEN_FRAMEWORKS_BY_ID[adapter.framework_id]
        assert declared.capabilities == adapter.capabilities()


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
