"""Public v1 contract for support-identity authoring, validation, and publication.

Tone of voice is deliberately absent: ADR 0012 makes it a shop-level concern that an agent
configuration selects, so a support identity carries only role, permissions, guidance, and
escalation.
"""

from collections.abc import Callable, Generator
from typing import Annotated, Literal, Self
from uuid import UUID

from fastapi import APIRouter, Depends, Path
from pydantic import Field

from capability_lab.application.support_identities import (
    SupportIdentityDraftPreview,
    SupportIdentityDraftRecord,
    SupportIdentityService,
    SupportIdentitySummary,
    SupportIdentityVersionRecord,
)
from capability_lab.domain.support_identity import (
    EscalationPolicy,
    GuidanceNote,
    SupportIdentityPayload,
    SupportPermission,
    SupportRole,
)
from capability_lab.presentation.base import StrictApiModel
from capability_lab.presentation.definitions import (
    Body,
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

IdentityIdPath = Annotated[UUID, Path(description="Stable support-identity identifier.")]
OptionalBody = Annotated[str, Field(max_length=4000)]


class SupportRoleSchema(StrictApiModel):
    name: Label
    title: Label
    description: OptionalBody

    @classmethod
    def from_domain(cls, role: SupportRole) -> Self:
        return cls(name=role.name, title=role.title, description=role.description)

    def to_domain(self) -> SupportRole:
        return SupportRole(name=self.name, title=self.title, description=self.description)


class GuidanceNoteSchema(StrictApiModel):
    id: Slug
    title: Label
    body: Body

    @classmethod
    def from_domain(cls, note: GuidanceNote) -> Self:
        return cls(id=note.id, title=note.title, body=note.body)

    def to_domain(self) -> GuidanceNote:
        return GuidanceNote(id=self.id, title=self.title, body=self.body)


class EscalationPolicySchema(StrictApiModel):
    escalate_to: OptionalBody
    conditions: list[Label]

    @classmethod
    def from_domain(cls, escalation: EscalationPolicy) -> Self:
        return cls(escalate_to=escalation.escalate_to, conditions=list(escalation.conditions))

    def to_domain(self) -> EscalationPolicy:
        return EscalationPolicy(escalate_to=self.escalate_to, conditions=tuple(self.conditions))


class SupportIdentityPayloadSchema(StrictApiModel):
    """The whole authored content of a support-identity draft or published version."""

    role: SupportRoleSchema
    permissions: list[SupportPermission]
    guidance: list[GuidanceNoteSchema]
    escalation: EscalationPolicySchema

    def to_domain(self) -> SupportIdentityPayload:
        return SupportIdentityPayload(
            role=self.role.to_domain(),
            permissions=tuple(self.permissions),
            guidance=tuple(note.to_domain() for note in self.guidance),
            escalation=self.escalation.to_domain(),
        )

    @classmethod
    def from_domain(cls, payload: SupportIdentityPayload) -> Self:
        return cls(
            role=SupportRoleSchema.from_domain(payload.role),
            permissions=list(payload.permissions),
            guidance=[GuidanceNoteSchema.from_domain(note) for note in payload.guidance],
            escalation=EscalationPolicySchema.from_domain(payload.escalation),
        )


class CreateSupportIdentityRequest(StrictApiModel):
    role: SupportRoleSchema


class ReplaceSupportIdentityDraftRequest(StrictApiModel):
    payload: SupportIdentityPayloadSchema


class SupportIdentityDraftResponse(StrictApiModel):
    identity_id: UUID
    lifecycle_state: Literal["draft"] = "draft"
    content: SupportIdentityPayloadSchema
    created_at: str
    updated_at: str

    @classmethod
    def from_record(cls, record: SupportIdentityDraftRecord) -> Self:
        return cls(
            identity_id=record.definition.id,
            content=SupportIdentityPayloadSchema.from_domain(record.payload),
            created_at=record.created_at.isoformat(),
            updated_at=record.updated_at.isoformat(),
        )


class SupportIdentityVersionResponse(StrictApiModel):
    identity_id: UUID
    lifecycle_state: Literal["published"] = "published"
    version: int
    content_fingerprint: str
    published_at: str
    content: SupportIdentityPayloadSchema

    @classmethod
    def from_record(cls, record: SupportIdentityVersionRecord) -> Self:
        return cls(
            identity_id=record.published.definition.id,
            version=record.published.version,
            content_fingerprint=record.published.content_fingerprint,
            published_at=record.published.published_at.isoformat(),
            content=SupportIdentityPayloadSchema.from_domain(record.payload),
        )


class SupportIdentityVersionListResponse(StrictApiModel):
    versions: list[DefinitionVersionSummarySchema]


class SupportIdentitySummarySchema(StrictApiModel):
    identity_id: UUID
    name: str
    title: str
    permission_count: int
    guidance_count: int
    updated_at: str
    latest_published_version: int | None
    published_version_count: int

    @classmethod
    def from_domain(cls, summary: SupportIdentitySummary) -> Self:
        return cls(
            identity_id=summary.definition_id,
            name=summary.name,
            title=summary.title,
            permission_count=summary.permission_count,
            guidance_count=summary.guidance_count,
            updated_at=summary.updated_at.isoformat(),
            latest_published_version=summary.latest_published_version,
            published_version_count=summary.published_version_count,
        )


class SupportIdentityListResponse(StrictApiModel):
    identities: list[SupportIdentitySummarySchema]


class SupportIdentityPreviewResponse(StrictApiModel):
    """The publish gate: what blocks publication and what a publish would freeze."""

    identity_id: UUID
    publishable: bool
    issues: list[DefinitionIssueSchema]
    changes: list[DefinitionChangeSchema]
    content_fingerprint: str
    latest_published_version: int | None
    next_version: int
    matches_latest_published: bool
    content: SupportIdentityPayloadSchema

    @classmethod
    def from_preview(cls, identity_id: UUID, preview: SupportIdentityDraftPreview) -> Self:
        return cls(
            identity_id=identity_id,
            publishable=preview.validation.publishable,
            issues=[
                DefinitionIssueSchema.from_domain(issue) for issue in preview.validation.issues
            ],
            changes=[DefinitionChangeSchema.from_domain(change) for change in preview.changes],
            content_fingerprint=preview.content_fingerprint,
            latest_published_version=preview.latest_published_version,
            next_version=preview.next_version,
            matches_latest_published=preview.matches_latest_published,
            content=SupportIdentityPayloadSchema.from_domain(preview.payload),
        )


class SupportIdentityRoutes:
    """Route handlers bound to a request-scoped `SupportIdentityService` dependency."""

    def __init__(
        self, service: Callable[[], Generator[SupportIdentityService, None, None]]
    ) -> None:
        self._service = service

    def register(self, router: APIRouter) -> None:
        dependency = Depends(self._service)

        def list_identities(
            service: Annotated[SupportIdentityService, dependency],
        ) -> SupportIdentityListResponse:
            return SupportIdentityListResponse(
                identities=[
                    SupportIdentitySummarySchema.from_domain(summary)
                    for summary in service.list_identities()
                ]
            )

        def create_identity(
            command: CreateSupportIdentityRequest,
            service: Annotated[SupportIdentityService, dependency],
        ) -> SupportIdentityDraftResponse:
            return SupportIdentityDraftResponse.from_record(
                service.create_identity(command.role.to_domain())
            )

        def get_identity_draft(
            identity_id: IdentityIdPath,
            service: Annotated[SupportIdentityService, dependency],
        ) -> SupportIdentityDraftResponse:
            return SupportIdentityDraftResponse.from_record(service.get_draft(identity_id))

        def replace_identity_draft(
            identity_id: IdentityIdPath,
            command: ReplaceSupportIdentityDraftRequest,
            service: Annotated[SupportIdentityService, dependency],
        ) -> SupportIdentityDraftResponse:
            return SupportIdentityDraftResponse.from_record(
                service.replace_draft(identity_id, command.payload.to_domain())
            )

        def preview_identity_draft(
            identity_id: IdentityIdPath,
            service: Annotated[SupportIdentityService, dependency],
        ) -> SupportIdentityPreviewResponse:
            return SupportIdentityPreviewResponse.from_preview(
                identity_id, service.preview_draft(identity_id)
            )

        def publish_identity(
            identity_id: IdentityIdPath,
            service: Annotated[SupportIdentityService, dependency],
        ) -> SupportIdentityVersionResponse:
            return SupportIdentityVersionResponse.from_record(service.publish(identity_id))

        def list_identity_versions(
            identity_id: IdentityIdPath,
            service: Annotated[SupportIdentityService, dependency],
        ) -> SupportIdentityVersionListResponse:
            return SupportIdentityVersionListResponse(
                versions=[
                    DefinitionVersionSummarySchema.from_domain(published)
                    for published in service.list_versions(identity_id)
                ]
            )

        def get_identity_version(
            identity_id: IdentityIdPath,
            version: DefinitionVersionPath,
            service: Annotated[SupportIdentityService, dependency],
        ) -> SupportIdentityVersionResponse:
            return SupportIdentityVersionResponse.from_record(
                service.get_version(identity_id, version)
            )

        router.add_api_route(
            "/support-identities",
            list_identities,
            methods=["GET"],
            response_model=SupportIdentityListResponse,
            operation_id="listSupportIdentities",
            summary="List support identities with their published-version provenance",
            responses=InvalidResponses,
        )
        router.add_api_route(
            "/support-identities",
            create_identity,
            methods=["POST"],
            status_code=201,
            response_model=SupportIdentityDraftResponse,
            operation_id="createSupportIdentity",
            summary="Create a support identity and its first draft",
            responses=InvalidResponses,
        )
        router.add_api_route(
            "/support-identities/{identity_id}/draft",
            get_identity_draft,
            methods=["GET"],
            response_model=SupportIdentityDraftResponse,
            operation_id="getSupportIdentityDraft",
            summary="Retrieve the mutable support-identity draft",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/support-identities/{identity_id}/draft",
            replace_identity_draft,
            methods=["PUT"],
            response_model=SupportIdentityDraftResponse,
            operation_id="replaceSupportIdentityDraft",
            summary="Replace the draft without touching any published version",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/support-identities/{identity_id}/draft/preview",
            preview_identity_draft,
            methods=["GET"],
            response_model=SupportIdentityPreviewResponse,
            operation_id="previewSupportIdentityDraft",
            summary="Validate the draft and preview the version publishing would create",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/support-identities/{identity_id}/versions",
            publish_identity,
            methods=["POST"],
            status_code=201,
            response_model=SupportIdentityVersionResponse,
            operation_id="publishSupportIdentity",
            summary="Freeze the draft into the next immutable published version",
            responses=NotFoundResponses | PublishFailureResponses,
        )
        router.add_api_route(
            "/support-identities/{identity_id}/versions",
            list_identity_versions,
            methods=["GET"],
            response_model=SupportIdentityVersionListResponse,
            operation_id="listSupportIdentityVersions",
            summary="List an identity's published versions, newest first",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/support-identities/{identity_id}/versions/{version}",
            get_identity_version,
            methods=["GET"],
            response_model=SupportIdentityVersionResponse,
            operation_id="getSupportIdentityVersion",
            summary="Retrieve one immutable published support-identity version",
            responses=NotFoundResponses | InvalidResponses,
        )
