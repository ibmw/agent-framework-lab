"""Agent-configuration authoring: draft editing, publish gate, and immutable versions.

An agent configuration is shop-independent and references exactly one support identity, so
it uses the shared lifecycle with a `references` codec hook and a publish gate that has to
look outside the payload. Three of its rules are the surrounding world's answers rather than
the content's:

- what the lab has proven a framework can do (`agent_capabilities`);
- which tools exist at all (`sandbox_tool_contracts`); and
- what the referenced support identity is permitted to do, which decides whether enabling a
  write tool is coherent — an agent bound to a tool its identity may never use would be
  refused at its first call, and a publish gate that can see that should say so first.

Beside the gate travels a **preview resolution**: the same variables the prompt names,
resolved against a chosen shop and the identity's published version, so the author reads what
a run would inject rather than guessing. The two answer one question together, exactly as the
scenario editor's resolved state does (ADR 0018), so they are computed in one call.

Resolution reads *published* versions, never drafts: publishing pins the latest published
version of every reference, so a preview computed from a draft would show values no
experiment could ever see.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from capability_lab.application.agent_capabilities import (
    PROVEN_FRAMEWORKS,
    PROVEN_FRAMEWORKS_BY_ID,
    ProvenFramework,
    capability_issues,
    default_agent_configuration_model,
)
from capability_lab.application.agent_configuration_payload import (
    agent_configuration_content_fingerprint,
    agent_configuration_document,
    agent_configuration_from_document,
)
from capability_lab.application.definition_authoring import (
    AuthoringErrors,
    DefinitionAuthoringService,
    DefinitionDraftPreview,
    DefinitionDraftRecord,
    DefinitionNotFoundError,
    DefinitionNotPublishableError,
    DefinitionRepository,
    DefinitionVersionNotFoundError,
    DefinitionVersionRecord,
    PayloadCodec,
    PublishedVersionDirectory,
)
from capability_lab.application.ports import Clock
from capability_lab.application.sandbox_tool_contracts import (
    SANDBOX_TOOL_CONTRACTS,
    ToolContract,
    ToolEffect,
)
from capability_lab.application.support_identities import SupportIdentityNotFoundError
from capability_lab.domain.agent_configuration import (
    PROMPT_VARIABLES,
    AgentConfigurationPayload,
    PromptVariable,
    ToneOfVoiceSelection,
    ToneOfVoiceSource,
    agent_configuration_issues,
    summarize_agent_configuration_changes,
    validate_agent_configuration,
)
from capability_lab.domain.definitions import (
    DefinitionId,
    DefinitionIssue,
    DefinitionType,
    DefinitionValidation,
    VersionRef,
    issue_error,
    issue_warning,
    validation_of,
)
from capability_lab.domain.shop import ShopPayload, ToneOfVoiceGuideline
from capability_lab.domain.support_identity import SupportIdentityPayload, SupportPermission

TOOL_CONTRACTS_BY_NAME = {contract.name: contract for contract in SANDBOX_TOOL_CONTRACTS}


class AgentConfigurationNotFoundError(DefinitionNotFoundError):
    """Raised when an agent-configuration definition has never been created."""


class AgentConfigurationVersionNotFoundError(DefinitionVersionNotFoundError):
    """Raised when a published agent-configuration version does not exist."""


class AgentConfigurationNotPublishableError(DefinitionNotPublishableError):
    """Raised when an agent-configuration draft still has publish-gate errors."""

    noun = "agent configuration"


def agent_configuration_definition_id(configuration_id: UUID) -> DefinitionId:
    return DefinitionId(definition_type=DefinitionType.AGENT_CONFIGURATION, id=configuration_id)


def support_identity_definition_id(identity_id: UUID) -> DefinitionId:
    return DefinitionId(definition_type=DefinitionType.SUPPORT_IDENTITY, id=identity_id)


def agent_configuration_references(payload: AgentConfigurationPayload) -> tuple[DefinitionId, ...]:
    """The support identity the payload names, derived from its content (ADR 0012)."""
    return (support_identity_definition_id(payload.support_identity_id),)


AGENT_CONFIGURATION_CODEC: PayloadCodec[AgentConfigurationPayload] = PayloadCodec(
    definition_type=DefinitionType.AGENT_CONFIGURATION,
    document=agent_configuration_document,
    from_document=agent_configuration_from_document,
    fingerprint=agent_configuration_content_fingerprint,
    validate=validate_agent_configuration,
    summarize_changes=summarize_agent_configuration_changes,
    references=agent_configuration_references,
)

AgentConfigurationDraftRecord = DefinitionDraftRecord[AgentConfigurationPayload]
AgentConfigurationVersionRecord = DefinitionVersionRecord[AgentConfigurationPayload]
AgentConfigurationDraftPreview = DefinitionDraftPreview[AgentConfigurationPayload]
AgentConfigurationRepository = DefinitionRepository[AgentConfigurationPayload]


@dataclass(frozen=True, slots=True)
class AgentConfigurationSummary:
    """One row of the Studio's agent-configuration index."""

    configuration_id: UUID
    name: str
    framework_id: str
    framework_label: str
    model_id: str
    support_identity_id: UUID
    tool_count: int
    updated_at: datetime
    latest_published_version: int | None
    published_version_count: int


@dataclass(frozen=True, slots=True)
class SupportIdentityOption:
    """One identity the configuration may adopt, as the picker offers it."""

    identity_id: UUID
    name: str
    title: str
    permissions: tuple[SupportPermission, ...]
    latest_published_version: int | None


@dataclass(frozen=True, slots=True)
class PreviewShopOption:
    """One shop the author can resolve the prompt's variables against."""

    shop_id: UUID
    name: str
    latest_published_version: int | None


@dataclass(frozen=True, slots=True)
class AgentConfigurationResources:
    """Exactly what a configuration may name, so a picker cannot offer a gate error."""

    frameworks: tuple[ProvenFramework, ...]
    tools: tuple[ToolContract, ...]
    variables: tuple[PromptVariable, ...]
    support_identities: tuple[SupportIdentityOption, ...]
    preview_shops: tuple[PreviewShopOption, ...]


@dataclass(frozen=True, slots=True)
class ResolvedVariable:
    """One prompt variable, and what the chosen preview context resolves it to."""

    variable: PromptVariable
    used: bool
    value: str | None


@dataclass(frozen=True, slots=True)
class ResolvedToolBinding:
    """One published tool, whether this configuration enables it, and whether it may."""

    contract: ToolContract
    enabled: bool
    permitted: bool


@dataclass(frozen=True, slots=True)
class AgentConfigurationResolution:
    """What a run would inject, read beside the publish gate.

    A `None` version is a reference with nothing to pin, which the gate reports as an error
    beside it; a `None` value is a variable the chosen preview context cannot resolve.
    """

    framework_label: str | None
    shop_id: UUID | None
    shop_name: str | None
    shop_version: int | None
    support_identity_id: UUID
    support_identity_name: str | None
    support_identity_version: int | None
    tone_of_voice_label: str | None
    tone_of_voice_resolved: bool
    variables: tuple[ResolvedVariable, ...]
    tools: tuple[ResolvedToolBinding, ...]


@dataclass(frozen=True, slots=True)
class AgentConfigurationPreview:
    """The publish gate and the resolved context, which an author reads side by side."""

    draft: AgentConfigurationDraftPreview
    resolution: AgentConfigurationResolution


def new_agent_configuration(name: str, support_identity_id: UUID) -> AgentConfigurationPayload:
    """The deliberately incomplete first draft: an agent that can look but not speak.

    Every read tool is enabled and every write is off. A configuration whose tools were all
    off would be refused by its own gate before the author had written anything, and a
    configuration that could redirect an order before anyone chose to let it would invert
    the safety model the write tools were built on.
    """
    return AgentConfigurationPayload(
        name=name,
        framework_id=PROVEN_FRAMEWORKS[0].framework_id,
        support_identity_id=support_identity_id,
        model=default_agent_configuration_model(),
        tools=tuple(
            contract.name
            for contract in SANDBOX_TOOL_CONTRACTS
            if contract.effect is ToolEffect.READ
        ),
    )


class AgentConfigurationService(DefinitionAuthoringService[AgentConfigurationPayload]):
    """Author, validate, and publish the lab's cross-shop agent configurations."""

    def __init__(
        self,
        repository: AgentConfigurationRepository,
        identities: DefinitionRepository[SupportIdentityPayload],
        shops: DefinitionRepository[ShopPayload],
        versions: PublishedVersionDirectory,
        clock: Clock,
    ) -> None:
        super().__init__(
            repository,
            clock,
            AGENT_CONFIGURATION_CODEC,
            AuthoringErrors(
                not_found=AgentConfigurationNotFoundError,
                version_not_found=AgentConfigurationVersionNotFoundError,
                not_publishable=AgentConfigurationNotPublishableError,
            ),
            noun="agent configuration",
            versions=versions,
        )
        self._identities = identities
        self._shops = shops

    # -- the capability- and identity-aware publish gate ------------------------

    def _validate(self, record: AgentConfigurationDraftRecord) -> DefinitionValidation:
        """Judge the draft against the payload, the catalog, and the pinned identity."""
        payload = record.payload
        issues: list[DefinitionIssue] = list(agent_configuration_issues(payload))
        issues.extend(capability_issues(payload))
        issues.extend(self._tool_issues(payload))
        return validation_of(issues)

    def _tool_issues(self, payload: AgentConfigurationPayload) -> tuple[DefinitionIssue, ...]:
        """What the tool registry and the referenced identity say about the bindings."""
        issues: list[DefinitionIssue] = []
        for tool_name in payload.tools:
            if tool_name not in TOOL_CONTRACTS_BY_NAME:
                issues.append(
                    issue_error(
                        "tool_not_published",
                        f"{tool_name} is not a tool the lab publishes",
                        f"tools.{tool_name}",
                    )
                )

        identity, _ = self._published_identity(payload.support_identity_id)
        if identity is None:
            issues.append(
                issue_error(
                    "support_identity_unpublished",
                    "publishing pins the latest published version of the support identity, "
                    "and this one has none",
                    "support_identity_id",
                )
            )
            return tuple(issues)

        for tool_name in payload.tools:
            contract = TOOL_CONTRACTS_BY_NAME.get(tool_name)
            required = None if contract is None else contract.required_permission
            if required is not None and required not in identity.granted:
                issues.append(
                    issue_error(
                        "tool_without_permission",
                        f"{tool_name} needs {required.value}, which {identity.role.title} "
                        "is not granted",
                        f"tools.{tool_name}",
                    )
                )
        # Per permission rather than once for all of them: an identity granted two write
        # permissions with a tool for only one of them is half-configured, and a single
        # warning keyed on "any write tool at all" would call that fine.
        for permission in sorted(identity.granted & _write_tool_permissions() - _covered(payload)):
            issues.append(
                issue_warning(
                    "permission_without_tool",
                    f"{identity.role.title} is granted {permission.value}, but this "
                    "configuration enables no tool that would use it",
                    "tools",
                )
            )
        return tuple(issues)

    # -- listing and authoring --------------------------------------------------

    def list_configurations(self) -> tuple[AgentConfigurationSummary, ...]:
        return tuple(
            AgentConfigurationSummary(
                configuration_id=listing.definition_id,
                name=listing.payload.name,
                framework_id=listing.payload.framework_id,
                framework_label=_framework_label(listing.payload.framework_id),
                model_id=listing.payload.model.model_id,
                support_identity_id=listing.payload.support_identity_id,
                tool_count=len(listing.payload.tools),
                updated_at=listing.updated_at,
                latest_published_version=listing.latest_published_version,
                published_version_count=listing.published_version_count,
            )
            for listing in self.list_definitions()
        )

    def create_configuration(
        self, name: str, support_identity_id: UUID
    ) -> AgentConfigurationDraftRecord:
        """Create the configuration's stable identity and its first, incomplete draft."""
        self._require_identity(support_identity_id)
        return self.create(new_agent_configuration(name, support_identity_id))

    def replace_configuration(
        self, configuration_id: UUID, payload: AgentConfigurationPayload
    ) -> AgentConfigurationDraftRecord:
        self._require_identity(payload.support_identity_id)
        return self.replace_draft(configuration_id, payload)

    def preview_configuration(
        self, configuration_id: UUID, *, preview_shop_id: UUID | None = None
    ) -> AgentConfigurationPreview:
        """The publish gate and the context resolution publishing this draft would freeze."""
        record = self.get_draft(configuration_id)
        return AgentConfigurationPreview(
            draft=self.preview_draft(configuration_id),
            resolution=self.resolve(record.payload, preview_shop_id=preview_shop_id),
        )

    def resources(self) -> AgentConfigurationResources:
        return AgentConfigurationResources(
            frameworks=PROVEN_FRAMEWORKS,
            tools=SANDBOX_TOOL_CONTRACTS,
            variables=PROMPT_VARIABLES,
            support_identities=tuple(
                SupportIdentityOption(
                    identity_id=listing.definition_id,
                    name=listing.payload.role.name,
                    title=listing.payload.role.title,
                    permissions=listing.payload.permissions,
                    latest_published_version=listing.latest_published_version,
                )
                for listing in self._identities.list_definitions()
            ),
            preview_shops=tuple(
                PreviewShopOption(
                    shop_id=listing.definition_id,
                    name=listing.payload.identity.name,
                    latest_published_version=listing.latest_published_version,
                )
                for listing in self._shops.list_definitions()
            ),
        )

    # -- preview resolution -----------------------------------------------------

    def resolve(
        self, payload: AgentConfigurationPayload, *, preview_shop_id: UUID | None = None
    ) -> AgentConfigurationResolution:
        """Resolve every variable against a preview shop and the pinned identity."""
        shop, shop_version = self._published_shop(preview_shop_id)
        identity, identity_version = self._published_identity(payload.support_identity_id)
        guideline = _tone_of_voice(shop, payload.tone_of_voice)
        used = {token.name for token in payload.prompt_tokens}
        values = _variable_values(shop, identity, guideline)
        granted: frozenset[SupportPermission] = (
            frozenset() if identity is None else identity.granted
        )
        return AgentConfigurationResolution(
            framework_label=(
                None
                if payload.framework_id not in PROVEN_FRAMEWORKS_BY_ID
                else PROVEN_FRAMEWORKS_BY_ID[payload.framework_id].label
            ),
            shop_id=None if shop is None else preview_shop_id,
            shop_name=None if shop is None else shop.identity.name,
            shop_version=shop_version,
            support_identity_id=payload.support_identity_id,
            support_identity_name=None if identity is None else identity.role.name,
            support_identity_version=identity_version,
            tone_of_voice_label=None if guideline is None else guideline.name,
            tone_of_voice_resolved=guideline is not None,
            variables=tuple(
                ResolvedVariable(
                    variable=variable,
                    used=variable.name in used,
                    value=values.get(variable.name),
                )
                for variable in PROMPT_VARIABLES
            ),
            tools=tuple(
                ResolvedToolBinding(
                    contract=contract,
                    enabled=contract.name in payload.enabled_tools,
                    permitted=(
                        contract.required_permission is None
                        or contract.required_permission in granted
                    ),
                )
                for contract in SANDBOX_TOOL_CONTRACTS
            ),
        )

    # -- reference reads --------------------------------------------------------

    def _require_identity(self, identity_id: UUID) -> None:
        """Refuse an identity that does not exist, naming the resource actually missing.

        Deliberately not this service's own not-found error: creating a configuration
        against an unknown identity involves no configuration at all, and a caller has to be
        able to tell a stale identity from a stale configuration.
        """
        if self._identities.get_draft(support_identity_definition_id(identity_id)) is None:
            raise SupportIdentityNotFoundError(f"support identity {identity_id} does not exist")

    def _published_identity(
        self, identity_id: UUID
    ) -> tuple[SupportIdentityPayload | None, int | None]:
        """The identity version a publication would pin, and the content it froze."""
        definition = support_identity_definition_id(identity_id)
        version = self._latest_published(definition)
        if version is None:
            return None, None
        record = self._identities.get_version(VersionRef(definition=definition, version=version))
        return (None, None) if record is None else (record.payload, version)

    def _published_shop(self, shop_id: UUID | None) -> tuple[ShopPayload | None, int | None]:
        if shop_id is None:
            return None, None
        definition = DefinitionId(definition_type=DefinitionType.SHOP, id=shop_id)
        version = self._latest_published(definition)
        if version is None:
            return None, None
        record = self._shops.get_version(VersionRef(definition=definition, version=version))
        return (None, None) if record is None else (record.payload, version)


def _framework_label(framework_id: str) -> str:
    framework = PROVEN_FRAMEWORKS_BY_ID.get(framework_id)
    return framework_id if framework is None else framework.label


def _write_tool_permissions() -> frozenset[SupportPermission]:
    """Every permission some published write tool needs; a grant beyond these buys nothing."""
    return frozenset(
        contract.required_permission
        for contract in SANDBOX_TOOL_CONTRACTS
        if contract.required_permission is not None
    )


def _covered(payload: AgentConfigurationPayload) -> frozenset[SupportPermission]:
    """The permissions this configuration's enabled tools would actually exercise."""
    return frozenset(
        contract.required_permission
        for contract in SANDBOX_TOOL_CONTRACTS
        if contract.name in payload.enabled_tools and contract.required_permission is not None
    )


def _tone_of_voice(
    shop: ShopPayload | None, selection: ToneOfVoiceSelection
) -> ToneOfVoiceGuideline | None:
    """The guideline the target shop resolves this selection to, if it has one."""
    if shop is None:
        return None
    if selection.source is ToneOfVoiceSource.SHOP_DEFAULT:
        return shop.default_tone_of_voice
    return next(
        (
            guideline
            for guideline in shop.tone_of_voice_guidelines
            if guideline.id == selection.guideline_id
        ),
        None,
    )


def _variable_values(
    shop: ShopPayload | None,
    identity: SupportIdentityPayload | None,
    guideline: ToneOfVoiceGuideline | None,
) -> dict[str, str]:
    """What each injectable variable resolves to; a missing source resolves to nothing.

    The interaction group is deliberately absent: it has no value here by design, and
    supplying one — even in a preview — would suggest a prompt could carry it.
    """
    values: dict[str, str] = {}
    if shop is not None:
        values["shop.name"] = shop.identity.name
        values["shop.locale"] = shop.identity.locale
        values["shop.currencies"] = ", ".join(
            currency.value for currency in shop.identity.currencies
        )
    if guideline is not None:
        values["shop.tone_of_voice"] = guideline.name
    if identity is not None:
        # A published identity resolves every one of its variables, including to empty text.
        # "Resolves to nothing" has to keep meaning "the source is missing": a preview that
        # said unresolvable while a run injected an empty string would be the worse of the
        # two answers, and the runtime resolution has to make the same call.
        values["support_identity.role"] = identity.role.title
        values["support_identity.guidance"] = "; ".join(note.title for note in identity.guidance)
        values["support_identity.permissions"] = ", ".join(
            permission.value for permission in identity.permissions
        )
    return values


__all__ = [
    "AGENT_CONFIGURATION_CODEC",
    "AgentConfigurationDraftPreview",
    "AgentConfigurationDraftRecord",
    "AgentConfigurationNotFoundError",
    "AgentConfigurationNotPublishableError",
    "AgentConfigurationPreview",
    "AgentConfigurationRepository",
    "AgentConfigurationResolution",
    "AgentConfigurationResources",
    "AgentConfigurationService",
    "AgentConfigurationSummary",
    "AgentConfigurationVersionNotFoundError",
    "AgentConfigurationVersionRecord",
    "PreviewShopOption",
    "ResolvedToolBinding",
    "ResolvedVariable",
    "SupportIdentityOption",
    "agent_configuration_definition_id",
    "agent_configuration_references",
    "new_agent_configuration",
]
