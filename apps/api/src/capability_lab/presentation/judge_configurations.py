"""Public v1 contract for judge authoring, validation, and publication.

A judge travels as what it is: a provider, a model, a rubric, and the list of what it is
shown. There is no resolution beside the gate — a rubric names nothing the lab resolves —
and no reference to any other definition, because a judge scores a record rather than
composing one.

The temperature is a decimal string for the same reason a price is: the value is exact, and
a JSON number would introduce the binary float ADR 0007 keeps out of the canonical document
it is hashed in.
"""

from collections.abc import Callable, Generator
from decimal import Decimal, InvalidOperation
from typing import Annotated, Literal, Self
from uuid import UUID

from fastapi import APIRouter, Depends, Path
from pydantic import Field

from capability_lab.application.judge_capabilities import ProvenJudge
from capability_lab.application.judge_configurations import (
    JudgeConfigurationDraftPreview,
    JudgeConfigurationDraftRecord,
    JudgeConfigurationResources,
    JudgeConfigurationService,
    JudgeConfigurationSummary,
    JudgeConfigurationVersionRecord,
)
from capability_lab.domain.judge import (
    MAX_RUBRIC_LENGTH,
    JudgeConfigurationError,
    JudgeConfigurationPayload,
    JudgeEvidenceScope,
    JudgeModel,
)
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

JudgeIdPath = Annotated[UUID, Path(description="Stable judge-configuration identifier.")]
Temperature = Annotated[str, Field(pattern=r"^\d(?:\.\d{1,2})?$")]
RubricBody = Annotated[str, Field(max_length=MAX_RUBRIC_LENGTH)]
Description = Annotated[str, Field(max_length=4000)]


def _temperature(value: str) -> Decimal:
    try:
        return Decimal(value)
    except InvalidOperation as cause:
        raise JudgeConfigurationError("judge temperature must be a decimal number") from cause


class JudgeModelSchema(StrictApiModel):
    provider: Slug
    model_id: Label
    temperature: Temperature = Field(
        description="Exact decimal sampling temperature; never a binary float."
    )

    @classmethod
    def from_domain(cls, model: JudgeModel) -> Self:
        return cls(
            provider=model.provider,
            model_id=model.model_id,
            temperature=model.canonical_temperature,
        )

    def to_domain(self) -> JudgeModel:
        return JudgeModel(
            provider=self.provider,
            model_id=self.model_id,
            temperature=_temperature(self.temperature),
        )


class JudgeConfigurationPayloadSchema(StrictApiModel):
    """The whole authored content of a judge draft or published version."""

    name: Label
    description: Description
    rubric: RubricBody
    evidence: list[JudgeEvidenceScope]
    model: JudgeModelSchema

    @classmethod
    def from_domain(cls, payload: JudgeConfigurationPayload) -> Self:
        return cls(
            name=payload.name,
            description=payload.description,
            rubric=payload.rubric,
            evidence=list(payload.evidence),
            model=JudgeModelSchema.from_domain(payload.model),
        )

    def to_domain(self) -> JudgeConfigurationPayload:
        return JudgeConfigurationPayload(
            name=self.name,
            model=self.model.to_domain(),
            description=self.description,
            rubric=self.rubric,
            evidence=tuple(self.evidence),
        )


class CreateJudgeConfigurationRequest(StrictApiModel):
    name: Label


class ReplaceJudgeConfigurationDraftRequest(StrictApiModel):
    payload: JudgeConfigurationPayloadSchema


class JudgeConfigurationDraftResponse(StrictApiModel):
    judge_id: UUID
    lifecycle_state: Literal["draft"] = "draft"
    content: JudgeConfigurationPayloadSchema
    created_at: str
    updated_at: str

    @classmethod
    def from_record(cls, record: JudgeConfigurationDraftRecord) -> Self:
        return cls(
            judge_id=record.definition.id,
            content=JudgeConfigurationPayloadSchema.from_domain(record.payload),
            created_at=record.created_at.isoformat(),
            updated_at=record.updated_at.isoformat(),
        )


class JudgeConfigurationVersionResponse(StrictApiModel):
    judge_id: UUID
    lifecycle_state: Literal["published"] = "published"
    version: int
    content_fingerprint: str
    published_at: str
    content: JudgeConfigurationPayloadSchema

    @classmethod
    def from_record(cls, record: JudgeConfigurationVersionRecord) -> Self:
        return cls(
            judge_id=record.published.definition.id,
            version=record.published.version,
            content_fingerprint=record.published.content_fingerprint,
            published_at=record.published.published_at.isoformat(),
            content=JudgeConfigurationPayloadSchema.from_domain(record.payload),
        )


class JudgeConfigurationVersionListResponse(StrictApiModel):
    versions: list[DefinitionVersionSummarySchema]


class JudgeConfigurationSummarySchema(StrictApiModel):
    judge_id: UUID
    name: str
    provider: str
    provider_label: str
    model_id: str
    evidence_count: int
    updated_at: str
    latest_published_version: int | None
    published_version_count: int

    @classmethod
    def from_domain(cls, summary: JudgeConfigurationSummary) -> Self:
        return cls(
            judge_id=summary.judge_id,
            name=summary.name,
            provider=summary.provider,
            provider_label=summary.provider_label,
            model_id=summary.model_id,
            evidence_count=summary.evidence_count,
            updated_at=summary.updated_at.isoformat(),
            latest_published_version=summary.latest_published_version,
            published_version_count=summary.published_version_count,
        )


class JudgeConfigurationListResponse(StrictApiModel):
    judges: list[JudgeConfigurationSummarySchema]


class ProvenJudgeSchema(StrictApiModel):
    """One provider the lab has proven it can judge with."""

    provider: str
    label: str
    models: list[str]
    summary: str

    @classmethod
    def from_domain(cls, judge: ProvenJudge) -> Self:
        return cls(
            provider=judge.provider,
            label=judge.label,
            models=list(judge.models),
            summary=judge.summary,
        )


class JudgeConfigurationResourcesResponse(StrictApiModel):
    """Exactly what a judge may name, so an editor cannot offer a gate error.

    `reserved_terms` is what a rubric may not contain: the names of what the arms run. It is
    served rather than restated in the client, because the list grows the day the lab proves
    a second framework and an editor with its own copy would stop matching the gate.
    """

    judges: list[ProvenJudgeSchema]
    evidence: list[JudgeEvidenceScope]
    reserved_terms: list[str]

    @classmethod
    def from_domain(cls, resources: JudgeConfigurationResources) -> Self:
        return cls(
            judges=[ProvenJudgeSchema.from_domain(judge) for judge in resources.judges],
            evidence=list(resources.evidence),
            reserved_terms=list(resources.reserved_terms),
        )


class JudgeConfigurationPreviewResponse(StrictApiModel):
    """The publish gate: what blocks publication and what a publish would freeze."""

    judge_id: UUID
    publishable: bool
    issues: list[DefinitionIssueSchema]
    changes: list[DefinitionChangeSchema]
    content_fingerprint: str
    latest_published_version: int | None
    next_version: int
    matches_latest_published: bool
    content: JudgeConfigurationPayloadSchema

    @classmethod
    def from_preview(cls, judge_id: UUID, preview: JudgeConfigurationDraftPreview) -> Self:
        return cls(
            judge_id=judge_id,
            publishable=preview.validation.publishable,
            issues=[
                DefinitionIssueSchema.from_domain(issue) for issue in preview.validation.issues
            ],
            changes=[DefinitionChangeSchema.from_domain(change) for change in preview.changes],
            content_fingerprint=preview.content_fingerprint,
            latest_published_version=preview.latest_published_version,
            next_version=preview.next_version,
            matches_latest_published=preview.matches_latest_published,
            content=JudgeConfigurationPayloadSchema.from_domain(preview.payload),
        )


class JudgeConfigurationRoutes:
    """Route handlers bound to a request-scoped `JudgeConfigurationService` dependency."""

    def __init__(
        self, service: Callable[[], Generator[JudgeConfigurationService, None, None]]
    ) -> None:
        self._service = service

    def register(self, router: APIRouter) -> None:
        dependency = Depends(self._service)

        def list_judges(
            service: Annotated[JudgeConfigurationService, dependency],
        ) -> JudgeConfigurationListResponse:
            return JudgeConfigurationListResponse(
                judges=[
                    JudgeConfigurationSummarySchema.from_domain(summary)
                    for summary in service.list_judges()
                ]
            )

        def read_resources(
            service: Annotated[JudgeConfigurationService, dependency],
        ) -> JudgeConfigurationResourcesResponse:
            return JudgeConfigurationResourcesResponse.from_domain(service.resources())

        def create_judge(
            command: CreateJudgeConfigurationRequest,
            service: Annotated[JudgeConfigurationService, dependency],
        ) -> JudgeConfigurationDraftResponse:
            return JudgeConfigurationDraftResponse.from_record(service.create_judge(command.name))

        def get_judge_draft(
            judge_id: JudgeIdPath,
            service: Annotated[JudgeConfigurationService, dependency],
        ) -> JudgeConfigurationDraftResponse:
            return JudgeConfigurationDraftResponse.from_record(service.get_draft(judge_id))

        def replace_judge_draft(
            judge_id: JudgeIdPath,
            command: ReplaceJudgeConfigurationDraftRequest,
            service: Annotated[JudgeConfigurationService, dependency],
        ) -> JudgeConfigurationDraftResponse:
            return JudgeConfigurationDraftResponse.from_record(
                service.replace_judge(judge_id, command.payload.to_domain())
            )

        def preview_judge_draft(
            judge_id: JudgeIdPath,
            service: Annotated[JudgeConfigurationService, dependency],
        ) -> JudgeConfigurationPreviewResponse:
            return JudgeConfigurationPreviewResponse.from_preview(
                judge_id, service.preview_draft(judge_id)
            )

        def publish_judge(
            judge_id: JudgeIdPath,
            service: Annotated[JudgeConfigurationService, dependency],
        ) -> JudgeConfigurationVersionResponse:
            return JudgeConfigurationVersionResponse.from_record(service.publish(judge_id))

        def list_judge_versions(
            judge_id: JudgeIdPath,
            service: Annotated[JudgeConfigurationService, dependency],
        ) -> JudgeConfigurationVersionListResponse:
            return JudgeConfigurationVersionListResponse(
                versions=[
                    DefinitionVersionSummarySchema.from_domain(published)
                    for published in service.list_versions(judge_id)
                ]
            )

        def get_judge_version(
            judge_id: JudgeIdPath,
            version: DefinitionVersionPath,
            service: Annotated[JudgeConfigurationService, dependency],
        ) -> JudgeConfigurationVersionResponse:
            return JudgeConfigurationVersionResponse.from_record(
                service.get_version(judge_id, version)
            )

        router.add_api_route(
            "/judge-configurations",
            list_judges,
            methods=["GET"],
            response_model=JudgeConfigurationListResponse,
            operation_id="listJudgeConfigurations",
            summary="List judges with their published-version provenance",
            responses=InvalidResponses,
        )
        router.add_api_route(
            "/judge-configurations/resources",
            read_resources,
            methods=["GET"],
            response_model=JudgeConfigurationResourcesResponse,
            operation_id="getJudgeConfigurationResources",
            summary="What a judge may name: proven providers, evidence scopes, reserved terms",
            description=(
                "The catalog the publish gate reads. `reserved_terms` are the names of what "
                "the arms run — a rubric may not contain them, because a judge is shown an "
                "anonymized record and must score behavior rather than a label."
            ),
            responses=InvalidResponses,
        )
        router.add_api_route(
            "/judge-configurations",
            create_judge,
            methods=["POST"],
            status_code=201,
            response_model=JudgeConfigurationDraftResponse,
            operation_id="createJudgeConfiguration",
            summary="Create a judge and its first draft",
            description=(
                "The first draft carries the model and the evidence scopes the lab has "
                "proven, and deliberately no rubric: the rubric is the whole of what a judge "
                "is, and a default one would publish an evaluator nobody wrote."
            ),
            responses=InvalidResponses,
        )
        router.add_api_route(
            "/judge-configurations/{judge_id}/draft",
            get_judge_draft,
            methods=["GET"],
            response_model=JudgeConfigurationDraftResponse,
            operation_id="getJudgeConfigurationDraft",
            summary="Retrieve the mutable judge draft",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/judge-configurations/{judge_id}/draft",
            replace_judge_draft,
            methods=["PUT"],
            response_model=JudgeConfigurationDraftResponse,
            operation_id="replaceJudgeConfigurationDraft",
            summary="Replace the draft without touching any published version",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/judge-configurations/{judge_id}/draft/preview",
            preview_judge_draft,
            methods=["GET"],
            response_model=JudgeConfigurationPreviewResponse,
            operation_id="previewJudgeConfigurationDraft",
            summary="Validate the draft and preview the version publishing would create",
            description=(
                "Refuses a judge the lab cannot run, and a rubric that names any of what the "
                "arms run — the one gate finding that reaches outside the payload, because "
                "anonymization is the property the whole evaluation rests on."
            ),
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/judge-configurations/{judge_id}/versions",
            publish_judge,
            methods=["POST"],
            status_code=201,
            response_model=JudgeConfigurationVersionResponse,
            operation_id="publishJudgeConfiguration",
            summary="Freeze the draft into the next immutable published version",
            responses=NotFoundResponses | PublishFailureResponses,
        )
        router.add_api_route(
            "/judge-configurations/{judge_id}/versions",
            list_judge_versions,
            methods=["GET"],
            response_model=JudgeConfigurationVersionListResponse,
            operation_id="listJudgeConfigurationVersions",
            summary="List a judge's published versions, newest first",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/judge-configurations/{judge_id}/versions/{version}",
            get_judge_version,
            methods=["GET"],
            response_model=JudgeConfigurationVersionResponse,
            operation_id="getJudgeConfigurationVersion",
            summary="Retrieve one immutable published judge version",
            responses=NotFoundResponses | InvalidResponses,
        )


__all__ = ["JudgeConfigurationRoutes"]
