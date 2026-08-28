"""Public v1 contract for agent-configuration authoring, validation, and publication.

The prompt travels as the template it is, `{{variable}}` tokens and all. Resolution is a
separate read — the preview's `resolution` — because the configuration is shop-independent
and a resolved prompt would silently become a per-shop artifact.

The temperature is a decimal string for the same reason a price is: the value is exact, and
a JSON number would introduce the binary float ADR 0007 keeps out of the canonical document
it is hashed in.
"""

from collections.abc import Callable, Generator
from decimal import Decimal, InvalidOperation
from typing import Annotated, Literal, Self
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query
from pydantic import Field

from capability_lab.application.agent_capabilities import ProvenFramework
from capability_lab.application.agent_configurations import (
    AgentConfigurationDraftPreview,
    AgentConfigurationDraftRecord,
    AgentConfigurationPreview,
    AgentConfigurationResolution,
    AgentConfigurationResources,
    AgentConfigurationService,
    AgentConfigurationSummary,
    AgentConfigurationVersionRecord,
    PreviewShopOption,
    ResolvedToolBinding,
    ResolvedVariable,
    SupportIdentityOption,
)
from capability_lab.application.ports import AgentCapability
from capability_lab.application.sandbox_tool_contracts import ToolContract, ToolEffect
from capability_lab.domain.agent_configuration import (
    AgentArchitecture,
    AgentConfigurationError,
    AgentConfigurationPayload,
    MemoryMode,
    ModelSettings,
    PromptVariable,
    PromptVariableGroup,
    ToneOfVoiceSelection,
    ToneOfVoiceSource,
)
from capability_lab.domain.support_identity import SupportPermission
from capability_lab.presentation.base import StrictApiModel
from capability_lab.presentation.definitions import (
    DefinitionChangeSchema,
    DefinitionIssueSchema,
    DefinitionVersionPath,
    DefinitionVersionSummarySchema,
    InvalidResponses,
    Label,
    NotFoundResponses,
    PublishFailureResponses,
    Slug,
)

ConfigurationIdPath = Annotated[UUID, Path(description="Stable agent-configuration identifier.")]
PreviewShopQuery = Annotated[
    UUID | None,
    Query(description="Resolve the prompt's variables against this shop's latest version."),
]
Temperature = Annotated[str, Field(pattern=r"^\d(?:\.\d{1,2})?$")]
PromptBody = Annotated[str, Field(max_length=20000)]
Description = Annotated[str, Field(max_length=4000)]
ToolName = Annotated[str, Field(min_length=1, max_length=100)]


def _temperature(value: str) -> Decimal:
    try:
        return Decimal(value)
    except InvalidOperation as cause:
        raise AgentConfigurationError("model temperature must be a decimal number") from cause


class ModelSettingsSchema(StrictApiModel):
    provider: Slug
    model_id: Label
    temperature: Temperature = Field(
        description="Exact decimal sampling temperature; never a binary float."
    )
    max_tool_rounds: int = Field(ge=1, le=50)

    @classmethod
    def from_domain(cls, model: ModelSettings) -> Self:
        return cls(
            provider=model.provider,
            model_id=model.model_id,
            temperature=model.canonical_temperature,
            max_tool_rounds=model.max_tool_rounds,
        )

    def to_domain(self) -> ModelSettings:
        return ModelSettings(
            provider=self.provider,
            model_id=self.model_id,
            temperature=_temperature(self.temperature),
            max_tool_rounds=self.max_tool_rounds,
        )


class ToneOfVoiceSelectionSchema(StrictApiModel):
    source: ToneOfVoiceSource
    guideline_id: str = Field(default="", max_length=64)

    @classmethod
    def from_domain(cls, selection: ToneOfVoiceSelection) -> Self:
        return cls(source=selection.source, guideline_id=selection.guideline_id)

    def to_domain(self) -> ToneOfVoiceSelection:
        return ToneOfVoiceSelection(source=self.source, guideline_id=self.guideline_id)


class AgentConfigurationPayloadSchema(StrictApiModel):
    """The whole authored content of a configuration draft or published version."""

    name: Label
    description: Description
    framework_id: Slug
    architecture: AgentArchitecture
    support_identity_id: UUID
    prompt: PromptBody
    tone_of_voice: ToneOfVoiceSelectionSchema
    tools: list[ToolName]
    memory: MemoryMode
    model: ModelSettingsSchema

    @classmethod
    def from_domain(cls, payload: AgentConfigurationPayload) -> Self:
        return cls(
            name=payload.name,
            description=payload.description,
            framework_id=payload.framework_id,
            architecture=payload.architecture,
            support_identity_id=payload.support_identity_id,
            prompt=payload.prompt,
            tone_of_voice=ToneOfVoiceSelectionSchema.from_domain(payload.tone_of_voice),
            tools=list(payload.tools),
            memory=payload.memory,
            model=ModelSettingsSchema.from_domain(payload.model),
        )

    def to_domain(self) -> AgentConfigurationPayload:
        return AgentConfigurationPayload(
            name=self.name,
            framework_id=self.framework_id,
            support_identity_id=self.support_identity_id,
            model=self.model.to_domain(),
            architecture=self.architecture,
            description=self.description,
            prompt=self.prompt,
            tone_of_voice=self.tone_of_voice.to_domain(),
            tools=tuple(self.tools),
            memory=self.memory,
        )


class CreateAgentConfigurationRequest(StrictApiModel):
    name: Label
    support_identity_id: UUID


class ReplaceAgentConfigurationDraftRequest(StrictApiModel):
    payload: AgentConfigurationPayloadSchema


class AgentConfigurationDraftResponse(StrictApiModel):
    configuration_id: UUID
    lifecycle_state: Literal["draft"] = "draft"
    content: AgentConfigurationPayloadSchema
    created_at: str
    updated_at: str

    @classmethod
    def from_record(cls, record: AgentConfigurationDraftRecord) -> Self:
        return cls(
            configuration_id=record.definition.id,
            content=AgentConfigurationPayloadSchema.from_domain(record.payload),
            created_at=record.created_at.isoformat(),
            updated_at=record.updated_at.isoformat(),
        )


class AgentConfigurationVersionResponse(StrictApiModel):
    configuration_id: UUID
    lifecycle_state: Literal["published"] = "published"
    version: int
    content_fingerprint: str
    published_at: str
    support_identity_version: int
    content: AgentConfigurationPayloadSchema

    @classmethod
    def from_record(cls, record: AgentConfigurationVersionRecord) -> Self:
        return cls(
            configuration_id=record.published.definition.id,
            version=record.published.version,
            content_fingerprint=record.published.content_fingerprint,
            published_at=record.published.published_at.isoformat(),
            support_identity_version=record.published.references[0].version,
            content=AgentConfigurationPayloadSchema.from_domain(record.payload),
        )


class AgentConfigurationVersionListResponse(StrictApiModel):
    versions: list[DefinitionVersionSummarySchema]


class AgentConfigurationSummarySchema(StrictApiModel):
    configuration_id: UUID
    name: str
    framework_id: str
    framework_label: str
    model_id: str
    support_identity_id: UUID
    tool_count: int
    updated_at: str
    latest_published_version: int | None
    published_version_count: int

    @classmethod
    def from_domain(cls, summary: AgentConfigurationSummary) -> Self:
        return cls(
            configuration_id=summary.configuration_id,
            name=summary.name,
            framework_id=summary.framework_id,
            framework_label=summary.framework_label,
            model_id=summary.model_id,
            support_identity_id=summary.support_identity_id,
            tool_count=summary.tool_count,
            updated_at=summary.updated_at.isoformat(),
            latest_published_version=summary.latest_published_version,
            published_version_count=summary.published_version_count,
        )


class AgentConfigurationListResponse(StrictApiModel):
    configurations: list[AgentConfigurationSummarySchema]


class ProvenFrameworkSchema(StrictApiModel):
    """One framework the lab has proven, and the envelope it was proven inside."""

    framework_id: str
    label: str
    summary: str
    architectures: list[AgentArchitecture]
    providers: list[str]
    models: list[str]
    capabilities: list[AgentCapability]

    @classmethod
    def from_domain(cls, framework: ProvenFramework) -> Self:
        return cls(
            framework_id=framework.framework_id,
            label=framework.label,
            summary=framework.summary,
            architectures=sorted(framework.architectures),
            providers=sorted(framework.providers),
            models=list(framework.models),
            capabilities=sorted(framework.capabilities),
        )


class ToolContractSchema(StrictApiModel):
    """One published tool a configuration may enable, and what enabling it requires."""

    name: str
    version: str
    summary: str
    effect: ToolEffect
    required_permission: SupportPermission | None

    @classmethod
    def from_domain(cls, contract: ToolContract) -> Self:
        return cls(
            name=contract.name,
            version=contract.version,
            summary=contract.summary,
            effect=contract.effect,
            required_permission=contract.required_permission,
        )


class PromptVariableSchema(StrictApiModel):
    name: str
    group: PromptVariableGroup
    description: str
    injectable: bool

    @classmethod
    def from_domain(cls, variable: PromptVariable) -> Self:
        return cls(
            name=variable.name,
            group=variable.group,
            description=variable.description,
            injectable=variable.injectable,
        )


class SupportIdentityOptionSchema(StrictApiModel):
    identity_id: UUID
    name: str
    title: str
    permissions: list[SupportPermission]
    latest_published_version: int | None

    @classmethod
    def from_domain(cls, option: SupportIdentityOption) -> Self:
        return cls(
            identity_id=option.identity_id,
            name=option.name,
            title=option.title,
            permissions=list(option.permissions),
            latest_published_version=option.latest_published_version,
        )


class PreviewShopOptionSchema(StrictApiModel):
    shop_id: UUID
    name: str
    latest_published_version: int | None

    @classmethod
    def from_domain(cls, option: PreviewShopOption) -> Self:
        return cls(
            shop_id=option.shop_id,
            name=option.name,
            latest_published_version=option.latest_published_version,
        )


class AgentConfigurationResourcesResponse(StrictApiModel):
    """Exactly what a configuration may name, so a picker cannot offer a gate error."""

    frameworks: list[ProvenFrameworkSchema]
    tools: list[ToolContractSchema]
    variables: list[PromptVariableSchema]
    support_identities: list[SupportIdentityOptionSchema]
    preview_shops: list[PreviewShopOptionSchema]

    @classmethod
    def from_domain(cls, resources: AgentConfigurationResources) -> Self:
        return cls(
            frameworks=[
                ProvenFrameworkSchema.from_domain(framework) for framework in resources.frameworks
            ],
            tools=[ToolContractSchema.from_domain(contract) for contract in resources.tools],
            variables=[
                PromptVariableSchema.from_domain(variable) for variable in resources.variables
            ],
            support_identities=[
                SupportIdentityOptionSchema.from_domain(option)
                for option in resources.support_identities
            ],
            preview_shops=[
                PreviewShopOptionSchema.from_domain(option) for option in resources.preview_shops
            ],
        )


class ResolvedVariableSchema(StrictApiModel):
    """One variable, whether the prompt names it, and what a run would inject.

    A `null` value is a variable the chosen preview context cannot resolve — including
    every non-injectable one, which resolves to nothing anywhere by design.
    """

    name: str
    group: PromptVariableGroup
    description: str
    injectable: bool
    used: bool
    value: str | None

    @classmethod
    def from_domain(cls, resolved: ResolvedVariable) -> Self:
        return cls(
            name=resolved.variable.name,
            group=resolved.variable.group,
            description=resolved.variable.description,
            injectable=resolved.variable.injectable,
            used=resolved.used,
            value=resolved.value,
        )


class ResolvedToolBindingSchema(StrictApiModel):
    name: str
    version: str
    summary: str
    effect: ToolEffect
    required_permission: SupportPermission | None
    enabled: bool
    permitted: bool

    @classmethod
    def from_domain(cls, binding: ResolvedToolBinding) -> Self:
        return cls(
            name=binding.contract.name,
            version=binding.contract.version,
            summary=binding.contract.summary,
            effect=binding.contract.effect,
            required_permission=binding.contract.required_permission,
            enabled=binding.enabled,
            permitted=binding.permitted,
        )


class AgentConfigurationResolutionSchema(StrictApiModel):
    """What a run would inject, read beside the publish gate."""

    framework_label: str | None
    shop_id: UUID | None
    shop_name: str | None
    shop_version: int | None
    support_identity_id: UUID
    support_identity_name: str | None
    support_identity_version: int | None
    tone_of_voice_label: str | None
    tone_of_voice_resolved: bool
    variables: list[ResolvedVariableSchema]
    tools: list[ResolvedToolBindingSchema]

    @classmethod
    def from_domain(cls, resolution: AgentConfigurationResolution) -> Self:
        return cls(
            framework_label=resolution.framework_label,
            shop_id=resolution.shop_id,
            shop_name=resolution.shop_name,
            shop_version=resolution.shop_version,
            support_identity_id=resolution.support_identity_id,
            support_identity_name=resolution.support_identity_name,
            support_identity_version=resolution.support_identity_version,
            tone_of_voice_label=resolution.tone_of_voice_label,
            tone_of_voice_resolved=resolution.tone_of_voice_resolved,
            variables=[
                ResolvedVariableSchema.from_domain(variable) for variable in resolution.variables
            ],
            tools=[ResolvedToolBindingSchema.from_domain(tool) for tool in resolution.tools],
        )


class AgentConfigurationPreviewResponse(StrictApiModel):
    """The publish gate and the resolved context, which an author reads side by side."""

    configuration_id: UUID
    publishable: bool
    issues: list[DefinitionIssueSchema]
    changes: list[DefinitionChangeSchema]
    content_fingerprint: str
    latest_published_version: int | None
    next_version: int
    matches_latest_published: bool
    content: AgentConfigurationPayloadSchema
    resolution: AgentConfigurationResolutionSchema

    @classmethod
    def from_preview(cls, configuration_id: UUID, preview: AgentConfigurationPreview) -> Self:
        draft: AgentConfigurationDraftPreview = preview.draft
        return cls(
            configuration_id=configuration_id,
            publishable=draft.validation.publishable,
            issues=[DefinitionIssueSchema.from_domain(issue) for issue in draft.validation.issues],
            changes=[DefinitionChangeSchema.from_domain(change) for change in draft.changes],
            content_fingerprint=draft.content_fingerprint,
            latest_published_version=draft.latest_published_version,
            next_version=draft.next_version,
            matches_latest_published=draft.matches_latest_published,
            content=AgentConfigurationPayloadSchema.from_domain(draft.payload),
            resolution=AgentConfigurationResolutionSchema.from_domain(preview.resolution),
        )


class AgentConfigurationRoutes:
    """Route handlers bound to a request-scoped `AgentConfigurationService` dependency."""

    def __init__(
        self, service: Callable[[], Generator[AgentConfigurationService, None, None]]
    ) -> None:
        self._service = service

    def register(self, router: APIRouter) -> None:
        dependency = Depends(self._service)

        def list_configurations(
            service: Annotated[AgentConfigurationService, dependency],
        ) -> AgentConfigurationListResponse:
            return AgentConfigurationListResponse(
                configurations=[
                    AgentConfigurationSummarySchema.from_domain(summary)
                    for summary in service.list_configurations()
                ]
            )

        def read_resources(
            service: Annotated[AgentConfigurationService, dependency],
        ) -> AgentConfigurationResourcesResponse:
            return AgentConfigurationResourcesResponse.from_domain(service.resources())

        def create_configuration(
            command: CreateAgentConfigurationRequest,
            service: Annotated[AgentConfigurationService, dependency],
        ) -> AgentConfigurationDraftResponse:
            return AgentConfigurationDraftResponse.from_record(
                service.create_configuration(command.name, command.support_identity_id)
            )

        def get_configuration_draft(
            configuration_id: ConfigurationIdPath,
            service: Annotated[AgentConfigurationService, dependency],
        ) -> AgentConfigurationDraftResponse:
            return AgentConfigurationDraftResponse.from_record(service.get_draft(configuration_id))

        def replace_configuration_draft(
            configuration_id: ConfigurationIdPath,
            command: ReplaceAgentConfigurationDraftRequest,
            service: Annotated[AgentConfigurationService, dependency],
        ) -> AgentConfigurationDraftResponse:
            return AgentConfigurationDraftResponse.from_record(
                service.replace_configuration(configuration_id, command.payload.to_domain())
            )

        def preview_configuration_draft(
            configuration_id: ConfigurationIdPath,
            service: Annotated[AgentConfigurationService, dependency],
            preview_shop_id: PreviewShopQuery = None,
        ) -> AgentConfigurationPreviewResponse:
            return AgentConfigurationPreviewResponse.from_preview(
                configuration_id,
                service.preview_configuration(configuration_id, preview_shop_id=preview_shop_id),
            )

        def publish_configuration(
            configuration_id: ConfigurationIdPath,
            service: Annotated[AgentConfigurationService, dependency],
        ) -> AgentConfigurationVersionResponse:
            return AgentConfigurationVersionResponse.from_record(service.publish(configuration_id))

        def list_configuration_versions(
            configuration_id: ConfigurationIdPath,
            service: Annotated[AgentConfigurationService, dependency],
        ) -> AgentConfigurationVersionListResponse:
            return AgentConfigurationVersionListResponse(
                versions=[
                    DefinitionVersionSummarySchema.from_domain(published)
                    for published in service.list_versions(configuration_id)
                ]
            )

        def get_configuration_version(
            configuration_id: ConfigurationIdPath,
            version: DefinitionVersionPath,
            service: Annotated[AgentConfigurationService, dependency],
        ) -> AgentConfigurationVersionResponse:
            return AgentConfigurationVersionResponse.from_record(
                service.get_version(configuration_id, version)
            )

        router.add_api_route(
            "/agent-configurations",
            list_configurations,
            methods=["GET"],
            response_model=AgentConfigurationListResponse,
            operation_id="listAgentConfigurations",
            summary="List agent configurations with their published-version provenance",
            responses=InvalidResponses,
        )
        router.add_api_route(
            "/agent-configurations/resources",
            read_resources,
            methods=["GET"],
            response_model=AgentConfigurationResourcesResponse,
            operation_id="readAgentConfigurationResources",
            summary="Read the frameworks, tools, variables, identities and preview shops",
            responses=InvalidResponses,
        )
        router.add_api_route(
            "/agent-configurations",
            create_configuration,
            methods=["POST"],
            status_code=201,
            response_model=AgentConfigurationDraftResponse,
            operation_id="createAgentConfiguration",
            summary="Create an agent configuration and its first draft",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/agent-configurations/{configuration_id}/draft",
            get_configuration_draft,
            methods=["GET"],
            response_model=AgentConfigurationDraftResponse,
            operation_id="getAgentConfigurationDraft",
            summary="Retrieve the mutable agent-configuration draft",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/agent-configurations/{configuration_id}/draft",
            replace_configuration_draft,
            methods=["PUT"],
            response_model=AgentConfigurationDraftResponse,
            operation_id="replaceAgentConfigurationDraft",
            summary="Replace the draft without touching any published version",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/agent-configurations/{configuration_id}/draft/preview",
            preview_configuration_draft,
            methods=["GET"],
            response_model=AgentConfigurationPreviewResponse,
            operation_id="previewAgentConfigurationDraft",
            summary="Validate the draft and resolve what a run would inject",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/agent-configurations/{configuration_id}/versions",
            publish_configuration,
            methods=["POST"],
            status_code=201,
            response_model=AgentConfigurationVersionResponse,
            operation_id="publishAgentConfiguration",
            summary="Freeze the draft into the next immutable published version",
            responses=NotFoundResponses | PublishFailureResponses,
        )
        router.add_api_route(
            "/agent-configurations/{configuration_id}/versions",
            list_configuration_versions,
            methods=["GET"],
            response_model=AgentConfigurationVersionListResponse,
            operation_id="listAgentConfigurationVersions",
            summary="List a configuration's published versions",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/agent-configurations/{configuration_id}/versions/{version}",
            get_configuration_version,
            methods=["GET"],
            response_model=AgentConfigurationVersionResponse,
            operation_id="getAgentConfigurationVersion",
            summary="Retrieve one immutable published agent-configuration version",
            responses=NotFoundResponses | InvalidResponses,
        )
