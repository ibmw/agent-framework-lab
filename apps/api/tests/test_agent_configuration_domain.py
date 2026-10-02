"""Agent-configuration invariants, prompt-variable grammar, and the payload publish gate."""

from dataclasses import replace
from decimal import Decimal

import pytest

from agent_factories import model_settings, publishable_configuration
from capability_lab.domain.agent_configuration import (
    MAX_PROMPT_LENGTH,
    AgentConfigurationError,
    AgentConfigurationPayload,
    MemoryMode,
    ToneOfVoiceSelection,
    ToneOfVoiceSource,
    scan_prompt_variables,
    summarize_agent_configuration_changes,
    validate_agent_configuration,
)
from capability_lab.domain.content import MAX_TEXT_LENGTH
from capability_lab.domain.definitions import DefinitionChangeKind


def codes(payload: AgentConfigurationPayload) -> set[str]:
    return {issue.code for issue in validate_agent_configuration(payload).issues}


def errors(payload: AgentConfigurationPayload) -> set[str]:
    return {issue.code for issue in validate_agent_configuration(payload).errors}


# -- invariants ----------------------------------------------------------------


def test_a_configuration_requires_a_name_a_framework_and_an_identity() -> None:
    with pytest.raises(AgentConfigurationError, match="agent configuration name"):
        publishable_configuration(name="  ")
    with pytest.raises(AgentConfigurationError, match="framework ID"):
        publishable_configuration(framework_id="Pydantic AI")
    payload = publishable_configuration()
    with pytest.raises(AgentConfigurationError, match="must name a support identity"):
        replace(payload, support_identity_id="not-a-uuid")  # type: ignore[arg-type]


def test_a_model_rejects_a_temperature_outside_the_supported_range() -> None:
    with pytest.raises(AgentConfigurationError, match="temperature"):
        model_settings(temperature=Decimal("2.5"))
    with pytest.raises(AgentConfigurationError, match="temperature"):
        model_settings(temperature=Decimal("-0.1"))
    with pytest.raises(AgentConfigurationError, match="fractional digits"):
        model_settings(temperature=Decimal("0.123"))


def test_a_model_rejects_a_tool_round_limit_no_run_could_use() -> None:
    with pytest.raises(AgentConfigurationError, match="tool-round limit"):
        model_settings(max_tool_rounds=0)
    with pytest.raises(AgentConfigurationError, match="tool-round limit"):
        model_settings(max_tool_rounds=500)


def test_a_prompt_is_kept_to_its_own_cap_past_the_text_cap() -> None:
    # A prompt is the one text the lab keeps longer than `MAX_TEXT_LENGTH`; a prompt at its
    # cap is accepted, so the shared text rule cannot refuse it first.
    assert MAX_PROMPT_LENGTH > MAX_TEXT_LENGTH
    prompt = "a" * MAX_PROMPT_LENGTH
    assert publishable_configuration(prompt=prompt).prompt == prompt
    with pytest.raises(
        AgentConfigurationError,
        match=f"system prompt must contain at most {MAX_PROMPT_LENGTH} characters",
    ):
        publishable_configuration(prompt="a" * (MAX_PROMPT_LENGTH + 1))


def test_a_description_is_still_kept_to_the_text_cap() -> None:
    with pytest.raises(
        AgentConfigurationError,
        match=f"agent configuration description must contain at most {MAX_TEXT_LENGTH}",
    ):
        publishable_configuration(description="a" * (MAX_TEXT_LENGTH + 1))


def test_the_shop_default_tone_cannot_also_name_an_override() -> None:
    with pytest.raises(AgentConfigurationError, match="cannot also name an override"):
        ToneOfVoiceSelection(source=ToneOfVoiceSource.SHOP_DEFAULT, guideline_id="warm")
    with pytest.raises(AgentConfigurationError, match="tone-of-voice override ID"):
        ToneOfVoiceSelection(source=ToneOfVoiceSource.OVERRIDE)


def test_enabling_a_tool_twice_is_refused() -> None:
    with pytest.raises(AgentConfigurationError, match="enabled tool names"):
        publishable_configuration(tools=("orders.read_order", "orders.read_order"))


def test_enabling_the_same_tools_in_a_different_order_is_the_same_configuration() -> None:
    """Ticking boxes is a set decision, so authoring order cannot move the fingerprint."""
    first = publishable_configuration(tools=("orders.read_order", "catalog.read_product"))
    second = publishable_configuration(
        support_identity_id=first.support_identity_id,
        tools=("catalog.read_product", "orders.read_order"),
    )

    assert first.tools == second.tools == ("catalog.read_product", "orders.read_order")
    assert first == second


# -- prompt variables ----------------------------------------------------------


def test_scanning_reports_each_occurrence_with_the_span_the_editor_chips() -> None:
    tokens = scan_prompt_variables("Hi {{ shop.name }}, from {{shop.name}}.")

    assert [token.name for token in tokens] == ["shop.name", "shop.name"]
    assert tokens[0].start == 3
    assert tokens[0].end == 18
    assert tokens[1].variable is not None


def test_a_variable_the_lab_does_not_resolve_blocks_publication() -> None:
    payload = publishable_configuration(prompt="You work for {{shop.brand_voice}}.")

    assert "prompt_unknown_variable" in errors(payload)


def test_a_customer_fact_is_refused_because_tools_are_how_an_agent_finds_it() -> None:
    payload = publishable_configuration(prompt="Greet {{customer.name}} by name.")
    issue = next(
        issue
        for issue in validate_agent_configuration(payload).errors
        if issue.code == "prompt_non_injectable_variable"
    )

    assert "discovered through tools" in issue.message


def test_an_empty_prompt_blocks_publication() -> None:
    assert "prompt_empty" in errors(publishable_configuration(prompt=""))


def test_a_padded_prompt_is_refused_before_the_gate_ever_sees_it() -> None:
    with pytest.raises(AgentConfigurationError, match="system prompt"):
        publishable_configuration(prompt="  Answer politely.  ")


def test_a_prompt_that_resolves_nothing_only_warns() -> None:
    payload = publishable_configuration(prompt="Answer the customer politely.")
    validation = validate_agent_configuration(payload)

    assert validation.publishable
    assert "prompt_without_variable" in {issue.code for issue in validation.warnings}


# -- the payload's own gate ----------------------------------------------------


def test_a_complete_configuration_has_no_publish_gate_errors() -> None:
    assert validate_agent_configuration(publishable_configuration()).errors == ()


def test_an_agent_bound_to_no_tool_cannot_be_published() -> None:
    assert "configuration_without_tool" in errors(publishable_configuration(tools=()))


def test_a_tone_override_warns_that_the_target_shop_decides() -> None:
    payload = publishable_configuration(
        tone_of_voice=ToneOfVoiceSelection(
            source=ToneOfVoiceSource.OVERRIDE, guideline_id="warm-and-efficient"
        )
    )
    validation = validate_agent_configuration(payload)

    assert validation.publishable
    assert "tone_override_checked_at_setup" in {issue.code for issue in validation.warnings}


# -- change summary ------------------------------------------------------------


def test_the_first_version_is_summarized_as_a_first_publication() -> None:
    payload = publishable_configuration()
    changes = summarize_agent_configuration_changes(None, payload)

    assert changes[0].kind is DefinitionChangeKind.ADDED
    assert payload.name in changes[0].description


def test_the_summary_names_the_tools_and_the_runtime_settings_that_moved() -> None:
    previous = publishable_configuration()
    current = publishable_configuration(
        support_identity_id=previous.support_identity_id,
        tools=(*previous.tools, "orders.propose_address_change"),
        memory=MemoryMode.NONE,
        model=model_settings(temperature=Decimal("0.70")),
    )
    described = {
        change.description for change in summarize_agent_configuration_changes(previous, current)
    }

    assert "Enabled orders.propose_address_change" in described
    assert "Updated memory" in described
    assert "Updated model temperature" in described


def test_the_summary_reports_a_disabled_tool() -> None:
    previous = publishable_configuration()
    current = publishable_configuration(
        support_identity_id=previous.support_identity_id,
        tools=tuple(name for name in previous.tools if name != "orders.read_order"),
    )
    changes = summarize_agent_configuration_changes(previous, current)

    assert changes[0].kind is DefinitionChangeKind.REMOVED
    assert changes[0].description == "Disabled orders.read_order"
