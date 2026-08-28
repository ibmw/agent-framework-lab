"""Typed agent configuration: the support agent as a versioned experiment input.

An agent configuration is the authored content of an `agent_configuration` definition. It
is shop-independent (ADR 0012), so one configuration can be run against any shop, and it
references exactly one published support-identity version — what the agent *is* stays with
the identity, while what *runs* it stays here.

What the payload holds is everything that can change an agent's behavior and therefore has
to be an explicit versioned input rather than a composition default: the framework and
architecture, the model and its runtime settings, the system prompt, which tools are
enabled, how much memory the run keeps, and which tone of voice the shop resolves.

Two rules shape the prompt. It is a **template**, not resolved text: `{{shop.name}}` stays a
token until an experiment starts, so the same configuration can be compared across shops.
And the variables it may name are a closed table — shop and support-identity facts only.
Customer, order, and ticket facts appear in the table as declared-but-not-injectable,
because an agent is meant to discover them through tools; how it does that is part of what
an experiment compares, and a prompt that pre-injects them would erase the difference.

Which tools *exist* is not decided here: the tool contracts live in the application layer
beside the sandbox they run against, so a configuration names them and the publish gate
checks the names against the registry.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from functools import partial
from types import MappingProxyType
from uuid import UUID

from capability_lab.domain.content import (
    require_identifier,
    require_instance,
    require_integer_in_range,
    require_label,
    require_slug,
    require_text,
    require_unique,
)
from capability_lab.domain.definitions import (
    DefinitionChange,
    DefinitionChangeKind,
    DefinitionIssue,
    DefinitionValidation,
    field_changes,
    issue_error,
    issue_warning,
    validation_of,
)
from capability_lab.domain.entities import DomainError


class AgentConfigurationError(DomainError):
    """Raised when agent-configuration content violates a structural invariant."""


_error_type = AgentConfigurationError
_require_slug = partial(require_slug, error=_error_type)
_require_identifier = partial(require_identifier, error=_error_type)
_require_label = partial(require_label, error=_error_type)
_require_text = partial(require_text, error=_error_type)
_require_unique = partial(require_unique, error=_error_type)
_require_instance = partial(require_instance, error=_error_type)
_require_integer_in_range = partial(require_integer_in_range, error=_error_type)

MAX_PROMPT_LENGTH = 20000
"""A system prompt is longer than any other authored text field in the lab."""

MIN_TOOL_ROUNDS = 1
MAX_TOOL_ROUNDS = 50
MAX_TEMPERATURE = Decimal("2")


class AgentArchitecture(StrEnum):
    """How the framework is asked to organize the work.

    One member until a second is proven end to end. Milestone 6 decides whether the first
    controlled comparison changes framework or architecture; adding the member before there
    is an implementation behind it would let an author publish a configuration nothing can
    run.
    """

    SINGLE_AGENT = "single_agent"


class MemoryMode(StrEnum):
    """How much of a run the agent is allowed to remember."""

    NONE = "none"
    """Every turn starts from the prompt and the tools."""

    CONVERSATION = "conversation"
    """The run's own turns are replayed to the model."""

    DURABLE = "durable"
    """Memory the lab persists and can restore across runs."""


class ToneOfVoiceSource(StrEnum):
    """Where the agent's tone comes from when a shop resolves the configuration."""

    SHOP_DEFAULT = "shop_default"
    """The shop's own default guideline; the recommended choice (ADR 0012)."""

    OVERRIDE = "override"
    """A named guideline, which the target shop must define at experiment setup."""


class PromptVariableGroup(StrEnum):
    """The three sources a prompt variable could name."""

    SHOP = "shop"
    SUPPORT_IDENTITY = "support_identity"
    INTERACTION = "interaction"
    """Customer, order, and ticket facts: declared so the editor can explain them, never
    injectable, because they are the agent's job to discover."""


@dataclass(frozen=True, slots=True)
class PromptVariable:
    """One name a prompt may contain, and whether it resolves to a value."""

    name: str
    group: PromptVariableGroup
    description: str
    injectable: bool = True


PROMPT_VARIABLES: tuple[PromptVariable, ...] = (
    PromptVariable(
        name="shop.name",
        group=PromptVariableGroup.SHOP,
        description="The shop's display name.",
    ),
    PromptVariable(
        name="shop.locale",
        group=PromptVariableGroup.SHOP,
        description="The shop's locale, such as fr-FR.",
    ),
    PromptVariable(
        name="shop.currencies",
        group=PromptVariableGroup.SHOP,
        description="The currencies the shop sells in.",
    ),
    PromptVariable(
        name="shop.tone_of_voice",
        group=PromptVariableGroup.SHOP,
        description="The tone-of-voice guidance this configuration resolves to.",
    ),
    PromptVariable(
        name="support_identity.role",
        group=PromptVariableGroup.SUPPORT_IDENTITY,
        description="The role title the agent adopts.",
    ),
    PromptVariable(
        name="support_identity.guidance",
        group=PromptVariableGroup.SUPPORT_IDENTITY,
        description="The guidance notes the identity expects the agent to follow.",
    ),
    PromptVariable(
        name="support_identity.permissions",
        group=PromptVariableGroup.SUPPORT_IDENTITY,
        description="A summary of what the identity is authorized to do.",
    ),
    PromptVariable(
        name="customer.name",
        group=PromptVariableGroup.INTERACTION,
        description="The customer's name.",
        injectable=False,
    ),
    PromptVariable(
        name="order.id",
        group=PromptVariableGroup.INTERACTION,
        description="The order the incident is about.",
        injectable=False,
    ),
    PromptVariable(
        name="ticket.subject",
        group=PromptVariableGroup.INTERACTION,
        description="The subject of the ticket the run opens from.",
        injectable=False,
    ),
)

PROMPT_VARIABLES_BY_NAME: Mapping[str, PromptVariable] = MappingProxyType(
    {variable.name: variable for variable in PROMPT_VARIABLES}
)

NON_INJECTABLE_REASON = (
    "customer, order, and ticket facts are discovered through tools by design; how an agent "
    "discovers them is part of what an experiment compares"
)

_VARIABLE_PATTERN = re.compile(r"\{\{([^{}]*)\}\}")


@dataclass(frozen=True, slots=True)
class PromptToken:
    """One `{{ name }}` occurrence, with the span the editor renders as a chip."""

    name: str
    start: int
    end: int

    @property
    def variable(self) -> PromptVariable | None:
        return PROMPT_VARIABLES_BY_NAME.get(self.name)


def scan_prompt_variables(body: str) -> tuple[PromptToken, ...]:
    """Every variable occurrence in a prompt, in the order it is written.

    Offsets travel with the name so the publish gate and the editor point at the same
    place; whitespace inside the braces is tolerated and stripped, because an author who
    types `{{ shop.name }}` means the same variable.
    """
    return tuple(
        PromptToken(name=match.group(1).strip(), start=match.start(), end=match.end())
        for match in _VARIABLE_PATTERN.finditer(body)
    )


@dataclass(frozen=True, slots=True)
class ToneOfVoiceSelection:
    """Which of the target shop's tone-of-voice guidelines the agent writes in."""

    source: ToneOfVoiceSource = ToneOfVoiceSource.SHOP_DEFAULT
    guideline_id: str = ""

    def __post_init__(self) -> None:
        _require_instance(
            self.source, ToneOfVoiceSource, "tone of voice must name a supported source"
        )
        if self.source is ToneOfVoiceSource.OVERRIDE:
            _require_slug(self.guideline_id, "tone-of-voice override ID")
        elif self.guideline_id:
            raise AgentConfigurationError(
                "the shop default tone of voice cannot also name an override"
            )


@dataclass(frozen=True, slots=True)
class ModelSettings:
    """The model that runs the agent and the runtime limits it runs under."""

    provider: str
    model_id: str
    temperature: Decimal
    max_tool_rounds: int

    def __post_init__(self) -> None:
        _require_identifier(self.provider, "model provider")
        _require_label(self.model_id, "model ID")
        _require_instance(self.temperature, Decimal, "model temperature must be a finite decimal")
        if not self.temperature.is_finite() or not 0 <= self.temperature <= MAX_TEMPERATURE:
            raise AgentConfigurationError(
                f"model temperature must be a finite decimal between 0 and {MAX_TEMPERATURE}"
            )
        exponent = self.temperature.as_tuple().exponent
        if not isinstance(exponent, int) or exponent < -2:
            raise AgentConfigurationError(
                "model temperature cannot have more than two fractional digits"
            )
        _require_integer_in_range(
            self.max_tool_rounds, MIN_TOOL_ROUNDS, MAX_TOOL_ROUNDS, "tool-round limit"
        )

    @property
    def canonical_temperature(self) -> str:
        """The decimal string the canonical document carries; ADR 0007 forbids floats."""
        return f"{self.temperature:.2f}"


@dataclass(frozen=True, slots=True)
class AgentConfigurationPayload:
    """The complete authored content of one agent-configuration draft or version."""

    name: str
    framework_id: str
    support_identity_id: UUID
    model: ModelSettings
    architecture: AgentArchitecture = AgentArchitecture.SINGLE_AGENT
    description: str = ""
    prompt: str = ""
    tone_of_voice: ToneOfVoiceSelection = ToneOfVoiceSelection()
    tools: tuple[str, ...] = ()
    memory: MemoryMode = MemoryMode.CONVERSATION

    def __post_init__(self) -> None:
        _require_label(self.name, "agent configuration name")
        _require_slug(self.framework_id, "framework ID")
        _require_instance(
            self.support_identity_id, UUID, "an agent configuration must name a support identity"
        )
        _require_instance(self.model, ModelSettings, "an agent configuration must declare a model")
        _require_instance(
            self.architecture, AgentArchitecture, "architecture must be a supported architecture"
        )
        _require_instance(self.memory, MemoryMode, "memory must be a supported memory mode")
        _require_instance(
            self.tone_of_voice,
            ToneOfVoiceSelection,
            "an agent configuration must declare a tone of voice",
        )
        _require_text(self.description, "agent configuration description", allow_empty=True)
        _require_text(self.prompt, "system prompt", allow_empty=True)
        if len(self.prompt) > MAX_PROMPT_LENGTH:
            raise AgentConfigurationError(
                f"system prompt must contain at most {MAX_PROMPT_LENGTH} characters"
            )
        for tool_name in self.tools:
            _require_text(tool_name, "enabled tool name")
        _require_unique(self.tools, "enabled tool names")
        # Enabling a tool is a set decision, not an ordering: two authors who tick the same
        # boxes in a different order have written the same configuration and must reach the
        # same fingerprint. Normalizing here rather than in the codec keeps the typed value
        # and its canonical document saying one thing.
        object.__setattr__(self, "tools", tuple(sorted(self.tools)))

    @property
    def enabled_tools(self) -> frozenset[str]:
        return frozenset(self.tools)

    @property
    def prompt_tokens(self) -> tuple[PromptToken, ...]:
        return scan_prompt_variables(self.prompt)


def validate_agent_configuration(payload: AgentConfigurationPayload) -> DefinitionValidation:
    """Report every publish-gate finding a configuration's own content can produce.

    Everything here is answerable from the payload alone. What the framework can actually
    do, which tools exist, and what the referenced identity is permitted to do are the
    surrounding world's answers, and the authoring service adds them.
    """
    return validation_of(list(agent_configuration_issues(payload)))


def agent_configuration_issues(
    payload: AgentConfigurationPayload,
) -> tuple[DefinitionIssue, ...]:
    """The payload-only findings, unsorted, so a caller can add its own before ordering."""
    issues: list[DefinitionIssue] = []

    # `require_text` already refuses a padded prompt, so empty is the only empty there is.
    if not payload.prompt:
        issues.append(
            issue_error(
                "prompt_empty",
                "a published agent configuration must carry a system prompt",
                "prompt",
            )
        )

    seen: set[str] = set()
    for token in payload.prompt_tokens:
        if token.name in seen:
            continue
        seen.add(token.name)
        variable = token.variable
        if variable is None:
            issues.append(
                issue_error(
                    "prompt_unknown_variable",
                    f"the prompt names {token.name or 'an empty variable'}, "
                    "which is not a variable the lab resolves",
                    "prompt",
                )
            )
        elif not variable.injectable:
            issues.append(
                issue_error(
                    "prompt_non_injectable_variable",
                    f"the prompt injects {variable.name}, but {NON_INJECTABLE_REASON}",
                    "prompt",
                )
            )

    if not payload.tools:
        issues.append(
            issue_error(
                "configuration_without_tool",
                "an agent bound to no tool cannot answer a single commerce question",
                "tools",
            )
        )

    if payload.tone_of_voice.source is ToneOfVoiceSource.OVERRIDE:
        issues.append(
            issue_warning(
                "tone_override_checked_at_setup",
                f"tone-of-voice override {payload.tone_of_voice.guideline_id} is checked "
                "against the target shop at experiment setup, not here",
                "tone_of_voice",
            )
        )

    if payload.prompt and not seen:
        issues.append(
            issue_warning(
                "prompt_without_variable",
                "the prompt resolves nothing, so it reads the same in every shop",
                "prompt",
            )
        )

    return tuple(issues)


def summarize_agent_configuration_changes(
    previous: AgentConfigurationPayload | None, current: AgentConfigurationPayload
) -> tuple[DefinitionChange, ...]:
    """Describe what publishing this draft would freeze, against the latest version."""
    if previous is None:
        return (
            DefinitionChange(
                kind=DefinitionChangeKind.ADDED,
                path="",
                description=f"First published version of {current.name}",
            ),
        )

    changes: list[DefinitionChange] = []
    changes.extend(
        field_changes(
            "",
            (
                ("name", previous.name, current.name),
                ("description", previous.description, current.description),
                ("framework_id", previous.framework_id, current.framework_id),
                ("architecture", previous.architecture, current.architecture),
                ("support_identity_id", previous.support_identity_id, current.support_identity_id),
                ("prompt", previous.prompt, current.prompt),
                ("memory", previous.memory, current.memory),
                ("tone_of_voice", previous.tone_of_voice, current.tone_of_voice),
            ),
            lambda name: f"Updated {name.replace('_', ' ')}",
        )
    )
    changes.extend(
        field_changes(
            "model",
            (
                ("provider", previous.model.provider, current.model.provider),
                ("model_id", previous.model.model_id, current.model.model_id),
                ("temperature", previous.model.temperature, current.model.temperature),
                (
                    "max_tool_rounds",
                    previous.model.max_tool_rounds,
                    current.model.max_tool_rounds,
                ),
            ),
            lambda name: f"Updated model {name.replace('_', ' ')}",
        )
    )
    for tool_name in sorted(current.enabled_tools - previous.enabled_tools):
        changes.append(
            DefinitionChange(
                kind=DefinitionChangeKind.ADDED,
                path=f"tools.{tool_name}",
                description=f"Enabled {tool_name}",
            )
        )
    for tool_name in sorted(previous.enabled_tools - current.enabled_tools):
        changes.append(
            DefinitionChange(
                kind=DefinitionChangeKind.REMOVED,
                path=f"tools.{tool_name}",
                description=f"Disabled {tool_name}",
            )
        )
    return tuple(changes)
