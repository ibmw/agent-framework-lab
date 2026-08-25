"""Public v1 contract for the shared objective- and mutation-block libraries.

Both libraries are cross-shop, so they sit at the root of the contract beside support
identities rather than under `/shops/{shop_id}`. A block names no shop object anywhere; what
it publishes is the *shape* a scenario must bind, which is why `shop_bound` travels with each
parameter: it is the rule the scenario editor offers a same-shop picker for, and the rule a
scenario's publish gate will judge its bindings against.

The two resources are near-identical apart from their type axis — an objective declares how
it is assessed and what evidence it reads, a mutation declares what it perturbs — so the
parameter schema and the index row are shared. The two route classes are not: FastAPI needs a
concrete response model per operation to publish a typed contract, so each library registers
its own, exactly as every other definition resource here does.
"""

from collections.abc import Callable, Generator
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from fastapi import APIRouter, Depends, Path
from pydantic import Field

from capability_lab.application.blocks import (
    BlockSummary,
    MutationBlockDraftPreview,
    MutationBlockDraftRecord,
    MutationBlockService,
    MutationBlockVersionRecord,
    ObjectiveBlockDraftPreview,
    ObjectiveBlockDraftRecord,
    ObjectiveBlockService,
    ObjectiveBlockVersionRecord,
)
from capability_lab.domain.blocks import (
    MAX_BLOCK_PARAMETERS,
    BlockParameter,
    BlockParameterKind,
    MutationBlockPayload,
    MutationEffect,
    ObjectiveAssessment,
    ObjectiveBlockPayload,
    ObjectiveEvidence,
)
from capability_lab.presentation.base import ErrorResponse, StrictApiModel
from capability_lab.presentation.definitions import (
    DefinitionChangeSchema,
    DefinitionIssueSchema,
    DefinitionVersionPath,
    DefinitionVersionSummarySchema,
    InvalidResponses,
    NotFoundResponses,
    PublishFailureResponses,
    Slug,
)

BlockIdPath = Annotated[UUID, Path(description="Stable block identifier.")]
BlockWriteResponses: dict[int | str, dict[str, Any]] = InvalidResponses | {
    409: {
        "model": ErrorResponse,
        "description": "Another block in this library already answers to that name",
    }
}
Identifier = Annotated[
    str, Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$")
]
# A draft may hold an empty statement or description; the publish gate is what refuses to
# freeze a template nobody could bind without guessing.
OptionalBody = Annotated[str, Field(max_length=4000)]


class BlockParameterSchema(StrictApiModel):
    name: Identifier
    kind: BlockParameterKind
    description: OptionalBody
    required: bool
    default: str | None
    shop_bound: bool = False
    """Derived: whether a scenario must resolve this parameter inside its own shop."""

    @classmethod
    def from_domain(cls, parameter: BlockParameter) -> Self:
        return cls(
            name=parameter.name,
            kind=parameter.kind,
            description=parameter.description,
            required=parameter.required,
            default=parameter.default,
            shop_bound=parameter.binds_shop_object,
        )

    def to_domain(self) -> BlockParameter:
        # `shop_bound` is derived from the kind and never read back: a client that sent a
        # contradictory value would otherwise be authoring a rule it does not own.
        return BlockParameter(
            name=self.name,
            kind=self.kind,
            description=self.description,
            required=self.required,
            default=self.default,
        )


BlockParameters = Annotated[list[BlockParameterSchema], Field(max_length=MAX_BLOCK_PARAMETERS)]


class ObjectiveBlockPayloadSchema(StrictApiModel):
    """The whole authored content of an objective-block draft or published version."""

    name: Slug
    statement: OptionalBody
    description: OptionalBody
    assessment: ObjectiveAssessment
    evidence: ObjectiveEvidence
    parameters: BlockParameters

    @classmethod
    def from_domain(cls, payload: ObjectiveBlockPayload) -> Self:
        return cls(
            name=payload.name,
            statement=payload.statement,
            description=payload.description,
            assessment=payload.assessment,
            evidence=payload.evidence,
            parameters=[
                BlockParameterSchema.from_domain(parameter) for parameter in payload.parameters
            ],
        )

    def to_domain(self) -> ObjectiveBlockPayload:
        return ObjectiveBlockPayload(
            name=self.name,
            statement=self.statement,
            description=self.description,
            assessment=self.assessment,
            evidence=self.evidence,
            parameters=tuple(parameter.to_domain() for parameter in self.parameters),
        )


class MutationBlockPayloadSchema(StrictApiModel):
    """The whole authored content of a mutation-block draft or published version."""

    name: Slug
    statement: OptionalBody
    description: OptionalBody
    effect: MutationEffect
    parameters: BlockParameters

    @classmethod
    def from_domain(cls, payload: MutationBlockPayload) -> Self:
        return cls(
            name=payload.name,
            statement=payload.statement,
            description=payload.description,
            effect=payload.effect,
            parameters=[
                BlockParameterSchema.from_domain(parameter) for parameter in payload.parameters
            ],
        )

    def to_domain(self) -> MutationBlockPayload:
        return MutationBlockPayload(
            name=self.name,
            statement=self.statement,
            description=self.description,
            effect=self.effect,
            parameters=tuple(parameter.to_domain() for parameter in self.parameters),
        )


class CreateBlockRequest(StrictApiModel):
    """A block is created with its name only; everything else is decided in the editor."""

    name: Slug


class BlockSummarySchema(StrictApiModel):
    block_id: UUID
    name: str
    statement: str
    type_label: str
    parameter_count: int
    shop_bound_parameter_count: int
    updated_at: str
    latest_published_version: int | None
    published_version_count: int

    @classmethod
    def from_domain(cls, summary: BlockSummary) -> Self:
        return cls(
            block_id=summary.definition_id,
            name=summary.name,
            statement=summary.statement,
            type_label=summary.type_label,
            parameter_count=summary.parameter_count,
            shop_bound_parameter_count=summary.shop_bound_parameter_count,
            updated_at=summary.updated_at.isoformat(),
            latest_published_version=summary.latest_published_version,
            published_version_count=summary.published_version_count,
        )


class BlockListResponse(StrictApiModel):
    blocks: list[BlockSummarySchema]


class BlockVersionListResponse(StrictApiModel):
    versions: list[DefinitionVersionSummarySchema]


class ReplaceObjectiveBlockDraftRequest(StrictApiModel):
    payload: ObjectiveBlockPayloadSchema


class ObjectiveBlockDraftResponse(StrictApiModel):
    block_id: UUID
    lifecycle_state: Literal["draft"] = "draft"
    content: ObjectiveBlockPayloadSchema
    created_at: str
    updated_at: str

    @classmethod
    def from_record(cls, record: ObjectiveBlockDraftRecord) -> Self:
        return cls(
            block_id=record.definition.id,
            content=ObjectiveBlockPayloadSchema.from_domain(record.payload),
            created_at=record.created_at.isoformat(),
            updated_at=record.updated_at.isoformat(),
        )


class ObjectiveBlockVersionResponse(StrictApiModel):
    block_id: UUID
    lifecycle_state: Literal["published"] = "published"
    version: int
    content_fingerprint: str
    published_at: str
    content: ObjectiveBlockPayloadSchema

    @classmethod
    def from_record(cls, record: ObjectiveBlockVersionRecord) -> Self:
        return cls(
            block_id=record.published.definition.id,
            version=record.published.version,
            content_fingerprint=record.published.content_fingerprint,
            published_at=record.published.published_at.isoformat(),
            content=ObjectiveBlockPayloadSchema.from_domain(record.payload),
        )


class ObjectiveBlockPreviewResponse(StrictApiModel):
    """The publish gate: what blocks publication and what a publish would freeze."""

    block_id: UUID
    publishable: bool
    issues: list[DefinitionIssueSchema]
    changes: list[DefinitionChangeSchema]
    content_fingerprint: str
    latest_published_version: int | None
    next_version: int
    matches_latest_published: bool
    content: ObjectiveBlockPayloadSchema

    @classmethod
    def from_preview(cls, block_id: UUID, preview: ObjectiveBlockDraftPreview) -> Self:
        return cls(
            block_id=block_id,
            publishable=preview.validation.publishable,
            issues=[
                DefinitionIssueSchema.from_domain(issue) for issue in preview.validation.issues
            ],
            changes=[DefinitionChangeSchema.from_domain(change) for change in preview.changes],
            content_fingerprint=preview.content_fingerprint,
            latest_published_version=preview.latest_published_version,
            next_version=preview.next_version,
            matches_latest_published=preview.matches_latest_published,
            content=ObjectiveBlockPayloadSchema.from_domain(preview.payload),
        )


class ReplaceMutationBlockDraftRequest(StrictApiModel):
    payload: MutationBlockPayloadSchema


class MutationBlockDraftResponse(StrictApiModel):
    block_id: UUID
    lifecycle_state: Literal["draft"] = "draft"
    content: MutationBlockPayloadSchema
    created_at: str
    updated_at: str

    @classmethod
    def from_record(cls, record: MutationBlockDraftRecord) -> Self:
        return cls(
            block_id=record.definition.id,
            content=MutationBlockPayloadSchema.from_domain(record.payload),
            created_at=record.created_at.isoformat(),
            updated_at=record.updated_at.isoformat(),
        )


class MutationBlockVersionResponse(StrictApiModel):
    block_id: UUID
    lifecycle_state: Literal["published"] = "published"
    version: int
    content_fingerprint: str
    published_at: str
    content: MutationBlockPayloadSchema

    @classmethod
    def from_record(cls, record: MutationBlockVersionRecord) -> Self:
        return cls(
            block_id=record.published.definition.id,
            version=record.published.version,
            content_fingerprint=record.published.content_fingerprint,
            published_at=record.published.published_at.isoformat(),
            content=MutationBlockPayloadSchema.from_domain(record.payload),
        )


class MutationBlockPreviewResponse(StrictApiModel):
    """The publish gate: what blocks publication and what a publish would freeze."""

    block_id: UUID
    publishable: bool
    issues: list[DefinitionIssueSchema]
    changes: list[DefinitionChangeSchema]
    content_fingerprint: str
    latest_published_version: int | None
    next_version: int
    matches_latest_published: bool
    content: MutationBlockPayloadSchema

    @classmethod
    def from_preview(cls, block_id: UUID, preview: MutationBlockDraftPreview) -> Self:
        return cls(
            block_id=block_id,
            publishable=preview.validation.publishable,
            issues=[
                DefinitionIssueSchema.from_domain(issue) for issue in preview.validation.issues
            ],
            changes=[DefinitionChangeSchema.from_domain(change) for change in preview.changes],
            content_fingerprint=preview.content_fingerprint,
            latest_published_version=preview.latest_published_version,
            next_version=preview.next_version,
            matches_latest_published=preview.matches_latest_published,
            content=MutationBlockPayloadSchema.from_domain(preview.payload),
        )


class ObjectiveBlockRoutes:
    """Route handlers bound to a request-scoped `ObjectiveBlockService` dependency."""

    def __init__(self, service: Callable[[], Generator[ObjectiveBlockService, None, None]]) -> None:
        self._service = service

    def register(self, router: APIRouter) -> None:
        dependency = Depends(self._service)

        def list_blocks(
            service: Annotated[ObjectiveBlockService, dependency],
        ) -> BlockListResponse:
            return BlockListResponse(
                blocks=[
                    BlockSummarySchema.from_domain(summary) for summary in service.list_blocks()
                ]
            )

        def create_block(
            command: CreateBlockRequest,
            service: Annotated[ObjectiveBlockService, dependency],
        ) -> ObjectiveBlockDraftResponse:
            return ObjectiveBlockDraftResponse.from_record(service.create_block(command.name))

        def get_block_draft(
            block_id: BlockIdPath,
            service: Annotated[ObjectiveBlockService, dependency],
        ) -> ObjectiveBlockDraftResponse:
            return ObjectiveBlockDraftResponse.from_record(service.get_draft(block_id))

        def replace_block_draft(
            block_id: BlockIdPath,
            command: ReplaceObjectiveBlockDraftRequest,
            service: Annotated[ObjectiveBlockService, dependency],
        ) -> ObjectiveBlockDraftResponse:
            return ObjectiveBlockDraftResponse.from_record(
                service.replace_block(block_id, command.payload.to_domain())
            )

        def preview_block_draft(
            block_id: BlockIdPath,
            service: Annotated[ObjectiveBlockService, dependency],
        ) -> ObjectiveBlockPreviewResponse:
            return ObjectiveBlockPreviewResponse.from_preview(
                block_id, service.preview_draft(block_id)
            )

        def publish_block(
            block_id: BlockIdPath,
            service: Annotated[ObjectiveBlockService, dependency],
        ) -> ObjectiveBlockVersionResponse:
            return ObjectiveBlockVersionResponse.from_record(service.publish(block_id))

        def list_block_versions(
            block_id: BlockIdPath,
            service: Annotated[ObjectiveBlockService, dependency],
        ) -> BlockVersionListResponse:
            return BlockVersionListResponse(
                versions=[
                    DefinitionVersionSummarySchema.from_domain(published)
                    for published in service.list_versions(block_id)
                ]
            )

        def get_block_version(
            block_id: BlockIdPath,
            version: DefinitionVersionPath,
            service: Annotated[ObjectiveBlockService, dependency],
        ) -> ObjectiveBlockVersionResponse:
            return ObjectiveBlockVersionResponse.from_record(service.get_version(block_id, version))

        router.add_api_route(
            "/objective-blocks",
            list_blocks,
            methods=["GET"],
            response_model=BlockListResponse,
            operation_id="listObjectiveBlocks",
            summary="List the shared objective-block library with version provenance",
            responses=InvalidResponses,
        )
        router.add_api_route(
            "/objective-blocks",
            create_block,
            methods=["POST"],
            status_code=201,
            response_model=ObjectiveBlockDraftResponse,
            operation_id="createObjectiveBlock",
            summary="Create an objective block and its first draft",
            responses=BlockWriteResponses,
        )
        router.add_api_route(
            "/objective-blocks/{block_id}/draft",
            get_block_draft,
            methods=["GET"],
            response_model=ObjectiveBlockDraftResponse,
            operation_id="getObjectiveBlockDraft",
            summary="Retrieve the mutable objective-block draft",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/objective-blocks/{block_id}/draft",
            replace_block_draft,
            methods=["PUT"],
            response_model=ObjectiveBlockDraftResponse,
            operation_id="replaceObjectiveBlockDraft",
            summary="Replace the draft without touching any published version",
            responses=NotFoundResponses | BlockWriteResponses,
        )
        router.add_api_route(
            "/objective-blocks/{block_id}/draft/preview",
            preview_block_draft,
            methods=["GET"],
            response_model=ObjectiveBlockPreviewResponse,
            operation_id="previewObjectiveBlockDraft",
            summary="Validate the draft and preview the version publishing would create",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/objective-blocks/{block_id}/versions",
            publish_block,
            methods=["POST"],
            status_code=201,
            response_model=ObjectiveBlockVersionResponse,
            operation_id="publishObjectiveBlock",
            summary="Freeze the draft into the next immutable published version",
            responses=NotFoundResponses | PublishFailureResponses,
        )
        router.add_api_route(
            "/objective-blocks/{block_id}/versions",
            list_block_versions,
            methods=["GET"],
            response_model=BlockVersionListResponse,
            operation_id="listObjectiveBlockVersions",
            summary="List a block's published versions, newest first",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/objective-blocks/{block_id}/versions/{version}",
            get_block_version,
            methods=["GET"],
            response_model=ObjectiveBlockVersionResponse,
            operation_id="getObjectiveBlockVersion",
            summary="Retrieve one immutable published objective-block version",
            responses=NotFoundResponses | InvalidResponses,
        )


class MutationBlockRoutes:
    """Route handlers bound to a request-scoped `MutationBlockService` dependency."""

    def __init__(self, service: Callable[[], Generator[MutationBlockService, None, None]]) -> None:
        self._service = service

    def register(self, router: APIRouter) -> None:
        dependency = Depends(self._service)

        def list_blocks(
            service: Annotated[MutationBlockService, dependency],
        ) -> BlockListResponse:
            return BlockListResponse(
                blocks=[
                    BlockSummarySchema.from_domain(summary) for summary in service.list_blocks()
                ]
            )

        def create_block(
            command: CreateBlockRequest,
            service: Annotated[MutationBlockService, dependency],
        ) -> MutationBlockDraftResponse:
            return MutationBlockDraftResponse.from_record(service.create_block(command.name))

        def get_block_draft(
            block_id: BlockIdPath,
            service: Annotated[MutationBlockService, dependency],
        ) -> MutationBlockDraftResponse:
            return MutationBlockDraftResponse.from_record(service.get_draft(block_id))

        def replace_block_draft(
            block_id: BlockIdPath,
            command: ReplaceMutationBlockDraftRequest,
            service: Annotated[MutationBlockService, dependency],
        ) -> MutationBlockDraftResponse:
            return MutationBlockDraftResponse.from_record(
                service.replace_block(block_id, command.payload.to_domain())
            )

        def preview_block_draft(
            block_id: BlockIdPath,
            service: Annotated[MutationBlockService, dependency],
        ) -> MutationBlockPreviewResponse:
            return MutationBlockPreviewResponse.from_preview(
                block_id, service.preview_draft(block_id)
            )

        def publish_block(
            block_id: BlockIdPath,
            service: Annotated[MutationBlockService, dependency],
        ) -> MutationBlockVersionResponse:
            return MutationBlockVersionResponse.from_record(service.publish(block_id))

        def list_block_versions(
            block_id: BlockIdPath,
            service: Annotated[MutationBlockService, dependency],
        ) -> BlockVersionListResponse:
            return BlockVersionListResponse(
                versions=[
                    DefinitionVersionSummarySchema.from_domain(published)
                    for published in service.list_versions(block_id)
                ]
            )

        def get_block_version(
            block_id: BlockIdPath,
            version: DefinitionVersionPath,
            service: Annotated[MutationBlockService, dependency],
        ) -> MutationBlockVersionResponse:
            return MutationBlockVersionResponse.from_record(service.get_version(block_id, version))

        router.add_api_route(
            "/mutation-blocks",
            list_blocks,
            methods=["GET"],
            response_model=BlockListResponse,
            operation_id="listMutationBlocks",
            summary="List the shared mutation-block library with version provenance",
            responses=InvalidResponses,
        )
        router.add_api_route(
            "/mutation-blocks",
            create_block,
            methods=["POST"],
            status_code=201,
            response_model=MutationBlockDraftResponse,
            operation_id="createMutationBlock",
            summary="Create a mutation block and its first draft",
            responses=BlockWriteResponses,
        )
        router.add_api_route(
            "/mutation-blocks/{block_id}/draft",
            get_block_draft,
            methods=["GET"],
            response_model=MutationBlockDraftResponse,
            operation_id="getMutationBlockDraft",
            summary="Retrieve the mutable mutation-block draft",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/mutation-blocks/{block_id}/draft",
            replace_block_draft,
            methods=["PUT"],
            response_model=MutationBlockDraftResponse,
            operation_id="replaceMutationBlockDraft",
            summary="Replace the draft without touching any published version",
            responses=NotFoundResponses | BlockWriteResponses,
        )
        router.add_api_route(
            "/mutation-blocks/{block_id}/draft/preview",
            preview_block_draft,
            methods=["GET"],
            response_model=MutationBlockPreviewResponse,
            operation_id="previewMutationBlockDraft",
            summary="Validate the draft and preview the version publishing would create",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/mutation-blocks/{block_id}/versions",
            publish_block,
            methods=["POST"],
            status_code=201,
            response_model=MutationBlockVersionResponse,
            operation_id="publishMutationBlock",
            summary="Freeze the draft into the next immutable published version",
            responses=NotFoundResponses | PublishFailureResponses,
        )
        router.add_api_route(
            "/mutation-blocks/{block_id}/versions",
            list_block_versions,
            methods=["GET"],
            response_model=BlockVersionListResponse,
            operation_id="listMutationBlockVersions",
            summary="List a block's published versions, newest first",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/mutation-blocks/{block_id}/versions/{version}",
            get_block_version,
            methods=["GET"],
            response_model=MutationBlockVersionResponse,
            operation_id="getMutationBlockVersion",
            summary="Retrieve one immutable published mutation-block version",
            responses=NotFoundResponses | InvalidResponses,
        )
