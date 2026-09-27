"""Public v1 contract for authoring a shop's scenarios.

A scenario follows the definition lifecycle every authorable resource uses — draft, preview,
publish, immutable versions — under the shop that scopes it, so its routes live beside that
shop's tickets and orders.

Three shapes, where a ticket needed two. A **request** carries selections and the prose a
scenario genuinely authors: bound template IDs, binding values, a severity, hidden facts, and
what completion means. A **response** adds the derived counts a client must not author. And a
**resolved state** carries what publishing would freeze — the shop, ticket, customer,
documents, entities, and the exact template version each composed block would pin. That last
one travels inside the preview rather than on its own route, because the author reads it
beside the publish gate and the two answer one question together.

The ticket is deliberately absent from the draft-write shape, exactly as a ticket's customer
is: it is fixed at creation, and a field a client could send would invite a change the service
refuses.
"""

from collections.abc import Callable, Generator
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from fastapi import APIRouter, Depends, Path
from pydantic import Field

from capability_lab.application.scenarios import (
    ResolvedDocument,
    ResolvedEntity,
    ResolvedTemplate,
    ScenarioBlockOption,
    ScenarioCustomerOption,
    ScenarioDraftRecord,
    ScenarioOrderOption,
    ScenarioPreview,
    ScenarioResolution,
    ScenarioResources,
    ScenarioService,
    ScenarioSummary,
    ScenarioVersionRecord,
)
from capability_lab.application.shop_documents import ShopDocumentOption
from capability_lab.domain.blocks import ObjectiveSeverity
from capability_lab.domain.definitions import DefinitionType, PublishedDefinitionVersion
from capability_lab.domain.order_fixture import FulfilmentStatus, PaymentStatus
from capability_lab.domain.scenario import (
    MAX_COMPLETION_TURNS,
    MAX_CONTEXT_DOCUMENTS,
    MAX_SCENARIO_BINDINGS,
    MAX_SCENARIO_MUTATIONS,
    MAX_SCENARIO_OBJECTIVES,
    MIN_COMPLETION_TURNS,
    BoundMutation,
    BoundObjective,
    CompletionConditions,
    ContextDocument,
    ScenarioBinding,
    ScenarioEntityKind,
    ScenarioPayload,
)
from capability_lab.domain.shop import ShopDocumentKind
from capability_lab.presentation.base import ErrorResponse, StrictApiModel
from capability_lab.presentation.blocks import BlockParameterSchema, Identifier
from capability_lab.presentation.definitions import (
    DefinitionChangeSchema,
    DefinitionIssueSchema,
    DefinitionVersionPath,
    DefinitionVersionSummarySchema,
    InvalidResponses,
    Label,
    NotFoundResponses,
    PublishFailureResponses,
    ShopNotFoundResponses,
    Slug,
)
from capability_lab.presentation.shops import ShopIdPath

ScenarioIdPath = Annotated[UUID, Path(description="Stable scenario identifier inside one shop.")]
# A draft may hold empty prose; the publish gate is what refuses to freeze a recipe whose
# completion nobody could judge.
OptionalBody = Annotated[str, Field(max_length=4000)]
BindingValue = Annotated[
    str,
    Field(
        min_length=1,
        max_length=4000,
        description=(
            "A literal, or a reference the scenario's own shop resolves: "
            "`policy:address-change`, `order:<id>`, `product:<handle>`, or "
            "`order:<id>#shipping_address`."
        ),
    ),
]
CompletionTurns = Annotated[
    int,
    Field(
        ge=MIN_COMPLETION_TURNS,
        le=MAX_COMPLETION_TURNS,
        description="The hard turn cap that guarantees a run terminates; both arms share it.",
    ),
]

ScenarioWriteResponses: dict[int | str, dict[str, Any]] = {
    409: {
        "model": ErrorResponse,
        "description": "Another scenario in this shop already answers to that name",
    },
    422: {
        "model": ErrorResponse,
        "description": "Invalid scenario content, or a ticket this shop does not hold",
    },
}
PublishScenarioResponses: dict[int | str, dict[str, Any]] = PublishFailureResponses | {
    422: {
        "model": ErrorResponse,
        "description": "The draft has publish-gate errors, or one of the definitions it would "
        "pin has no published version",
    }
}


class ScenarioBindingSchema(StrictApiModel):
    """One template parameter and the value this scenario supplies for it."""

    parameter: Identifier
    value: BindingValue

    @classmethod
    def from_domain(cls, binding: ScenarioBinding) -> Self:
        return cls(parameter=binding.parameter, value=binding.value)

    def to_domain(self) -> ScenarioBinding:
        return ScenarioBinding(parameter=self.parameter, value=self.value)


ScenarioBindings = Annotated[list[ScenarioBindingSchema], Field(max_length=MAX_SCENARIO_BINDINGS)]


class BoundObjectiveSchema(StrictApiModel):
    """One objective template bound to this shop's objects, with its severity.

    `severity` is a field rather than a binding because every objective answers it, including
    templates that declare no parameter at all. A template that declares a `severity`
    parameter is resolved from this field, so binding it explicitly is refused rather than
    silently allowed to disagree.
    """

    id: Slug
    block_id: UUID
    severity: ObjectiveSeverity
    bindings: ScenarioBindings

    @classmethod
    def from_domain(cls, objective: BoundObjective) -> Self:
        return cls(
            id=objective.id,
            block_id=objective.block_id,
            severity=objective.severity,
            bindings=[ScenarioBindingSchema.from_domain(binding) for binding in objective.bindings],
        )

    def to_domain(self) -> BoundObjective:
        return BoundObjective(
            id=self.id,
            block_id=self.block_id,
            severity=self.severity,
            bindings=tuple(binding.to_domain() for binding in self.bindings),
        )


class BoundMutationSchema(StrictApiModel):
    """One mutation template bound to this shop's objects. Its moment is a binding."""

    id: Slug
    block_id: UUID
    bindings: ScenarioBindings

    @classmethod
    def from_domain(cls, mutation: BoundMutation) -> Self:
        return cls(
            id=mutation.id,
            block_id=mutation.block_id,
            bindings=[ScenarioBindingSchema.from_domain(binding) for binding in mutation.bindings],
        )

    def to_domain(self) -> BoundMutation:
        return BoundMutation(
            id=self.id,
            block_id=self.block_id,
            bindings=tuple(binding.to_domain() for binding in self.bindings),
        )


class ContextDocumentSchema(StrictApiModel):
    kind: ShopDocumentKind
    document_id: Slug

    @classmethod
    def from_domain(cls, document: ContextDocument) -> Self:
        return cls(kind=document.kind, document_id=document.document_id)

    def to_domain(self) -> ContextDocument:
        return ContextDocument(kind=self.kind, document_id=self.document_id)


class CompletionConditionsSchema(StrictApiModel):
    """What "done" means, and the cap that guarantees a run reaches it or stops."""

    statement: OptionalBody
    max_turns: CompletionTurns

    @classmethod
    def from_domain(cls, completion: CompletionConditions) -> Self:
        return cls(statement=completion.statement, max_turns=completion.max_turns)

    def to_domain(self) -> CompletionConditions:
        return CompletionConditions(statement=self.statement, max_turns=self.max_turns)


class ScenarioPayloadSchema(StrictApiModel):
    """The whole authored content of a scenario draft or published version."""

    name: Label
    context_documents: Annotated[
        list[ContextDocumentSchema], Field(max_length=MAX_CONTEXT_DOCUMENTS)
    ]
    objectives: Annotated[list[BoundObjectiveSchema], Field(max_length=MAX_SCENARIO_OBJECTIVES)]
    mutations: Annotated[list[BoundMutationSchema], Field(max_length=MAX_SCENARIO_MUTATIONS)]
    hidden_facts: OptionalBody = Field(
        description="Operator-only prose. Never shown to the support agent, logged, or traced."
    )
    completion: CompletionConditionsSchema

    def to_domain(self, ticket_id: UUID) -> ScenarioPayload:
        """Rebuild the payload around the ticket the scenario was built on.

        The ticket is deliberately not on the wire for a draft write: it is fixed at
        creation, and a field a client could send would invite a change the service refuses.
        """
        return ScenarioPayload(
            name=self.name,
            ticket_id=ticket_id,
            context_documents=tuple(document.to_domain() for document in self.context_documents),
            objectives=tuple(objective.to_domain() for objective in self.objectives),
            mutations=tuple(mutation.to_domain() for mutation in self.mutations),
            hidden_facts=self.hidden_facts,
            completion=self.completion.to_domain(),
        )


class ScenarioContentSchema(ScenarioPayloadSchema):
    """A scenario as the API returns it, with the derived evidence a client must not author."""

    ticket_id: UUID
    objective_count: int
    mutation_count: int

    @classmethod
    def from_domain(cls, payload: ScenarioPayload) -> Self:
        return cls(
            name=payload.name,
            context_documents=[
                ContextDocumentSchema.from_domain(document)
                for document in payload.context_documents
            ],
            objectives=[
                BoundObjectiveSchema.from_domain(objective) for objective in payload.objectives
            ],
            mutations=[BoundMutationSchema.from_domain(mutation) for mutation in payload.mutations],
            hidden_facts=payload.hidden_facts,
            completion=CompletionConditionsSchema.from_domain(payload.completion),
            ticket_id=payload.ticket_id,
            objective_count=len(payload.objectives),
            mutation_count=len(payload.mutations),
        )


class ScenarioDocumentOptionSchema(StrictApiModel):
    kind: ShopDocumentKind
    document_id: str
    title: str
    reference_value: str = Field(
        description="The value a document binding takes, such as `policy:address-change`."
    )

    @classmethod
    def from_domain(cls, option: ShopDocumentOption) -> Self:
        return cls(
            kind=option.kind,
            document_id=option.document_id,
            title=option.title,
            reference_value=f"{option.kind.value}:{option.document_id}",
        )


class ScenarioOrderOptionSchema(StrictApiModel):
    order_id: UUID
    reference: str
    payment_status: PaymentStatus
    fulfilment_status: FulfilmentStatus
    total_amount: str
    currency: str
    shipping_label: str | None
    reference_value: str = Field(description="The value an entity binding takes: `order:<id>`.")

    @classmethod
    def from_domain(cls, option: ScenarioOrderOption) -> Self:
        return cls(
            order_id=option.order_id,
            reference=option.reference,
            payment_status=option.payment_status,
            fulfilment_status=option.fulfilment_status,
            total_amount=option.total_amount,
            currency=option.currency.value,
            shipping_label=option.shipping_label,
            reference_value=f"order:{option.order_id}",
        )


class ScenarioCustomerOptionSchema(StrictApiModel):
    profile_id: UUID
    display_name: str
    reference_value: str

    @classmethod
    def from_domain(cls, option: ScenarioCustomerOption) -> Self:
        return cls(
            profile_id=option.profile_id,
            display_name=option.display_name,
            reference_value=f"customer:{option.profile_id}",
        )


class ScenarioBlockOptionSchema(StrictApiModel):
    """One library template the editor can bind, with the parameters it declares."""

    block_id: UUID
    name: str
    statement: str
    description: str
    type_label: str
    latest_published_version: int | None
    parameters: list[BlockParameterSchema]

    @classmethod
    def from_domain(cls, option: ScenarioBlockOption) -> Self:
        return cls(
            block_id=option.block_id,
            name=option.name,
            statement=option.statement,
            description=option.description,
            type_label=option.type_label,
            latest_published_version=option.latest_published_version,
            parameters=[
                BlockParameterSchema.from_domain(parameter) for parameter in option.parameters
            ],
        )


class ScenarioResourcesSchema(StrictApiModel):
    """Exactly what this scenario may name, so a picker cannot offer a publish-gate error."""

    documents: list[ScenarioDocumentOptionSchema]
    orders: list[ScenarioOrderOptionSchema]
    product_handles: list[str]
    customers: list[ScenarioCustomerOptionSchema]
    objective_blocks: list[ScenarioBlockOptionSchema]
    mutation_blocks: list[ScenarioBlockOptionSchema]

    @classmethod
    def from_domain(cls, resources: ScenarioResources) -> Self:
        return cls(
            documents=[
                ScenarioDocumentOptionSchema.from_domain(option) for option in resources.documents
            ],
            orders=[ScenarioOrderOptionSchema.from_domain(order) for order in resources.orders],
            product_handles=list(resources.product_handles),
            customers=[
                ScenarioCustomerOptionSchema.from_domain(option) for option in resources.customers
            ],
            objective_blocks=[
                ScenarioBlockOptionSchema.from_domain(option)
                for option in resources.objective_blocks
            ],
            mutation_blocks=[
                ScenarioBlockOptionSchema.from_domain(option)
                for option in resources.mutation_blocks
            ],
        )


class ResolvedDocumentSchema(StrictApiModel):
    kind: ShopDocumentKind
    document_id: str
    title: str | None
    resolved: bool

    @classmethod
    def from_domain(cls, document: ResolvedDocument) -> Self:
        return cls(
            kind=document.kind,
            document_id=document.document_id,
            title=document.title,
            resolved=document.resolved,
        )


class ResolvedEntitySchema(StrictApiModel):
    kind: ScenarioEntityKind
    identifier: str
    label: str | None
    detail: str | None
    resolved: bool

    @classmethod
    def from_domain(cls, entity: ResolvedEntity) -> Self:
        return cls(
            kind=entity.kind,
            identifier=entity.identifier,
            label=entity.label,
            detail=entity.detail,
            resolved=entity.resolved,
        )


class ResolvedTemplateSchema(StrictApiModel):
    """One composed template and the version publishing this draft would pin it at."""

    block_id: UUID
    name: str
    definition_type: DefinitionType
    version: int | None
    instance_count: int

    @classmethod
    def from_domain(cls, template: ResolvedTemplate) -> Self:
        return cls(
            block_id=template.block_id,
            name=template.name,
            definition_type=template.definition_type,
            version=template.version,
            instance_count=template.instance_count,
        )


class ScenarioResolutionSchema(StrictApiModel):
    """The complete starting state publishing this draft would freeze."""

    shop_name: str
    shop_version: int | None
    ticket_id: UUID
    ticket_reference: str
    ticket_subject: str
    ticket_version: int | None
    customer_profile_id: UUID | None
    customer_display_name: str
    customer_profile_version: int | None
    documents: list[ResolvedDocumentSchema]
    entities: list[ResolvedEntitySchema]
    templates: list[ResolvedTemplateSchema]
    objective_count: int
    mutation_count: int
    max_turns: int

    @classmethod
    def from_domain(cls, resolution: ScenarioResolution) -> Self:
        return cls(
            shop_name=resolution.shop_name,
            shop_version=resolution.shop_version,
            ticket_id=resolution.ticket_id,
            ticket_reference=resolution.ticket_reference,
            ticket_subject=resolution.ticket_subject,
            ticket_version=resolution.ticket_version,
            customer_profile_id=resolution.customer_profile_id,
            customer_display_name=resolution.customer_display_name,
            customer_profile_version=resolution.customer_profile_version,
            documents=[
                ResolvedDocumentSchema.from_domain(document) for document in resolution.documents
            ],
            entities=[ResolvedEntitySchema.from_domain(entity) for entity in resolution.entities],
            templates=[
                ResolvedTemplateSchema.from_domain(template) for template in resolution.templates
            ],
            objective_count=resolution.objective_count,
            mutation_count=resolution.mutation_count,
            max_turns=resolution.max_turns,
        )


class CreateScenarioRequest(StrictApiModel):
    """A scenario is created on a ticket; its context documents pre-fill from that ticket."""

    name: Label
    ticket_id: UUID


class ReplaceScenarioDraftRequest(StrictApiModel):
    payload: ScenarioPayloadSchema


class ScenarioDraftResponse(StrictApiModel):
    scenario_id: UUID
    shop_id: UUID
    lifecycle_state: Literal["draft"] = "draft"
    content: ScenarioContentSchema
    created_at: str
    updated_at: str

    @classmethod
    def from_record(cls, shop_id: UUID, record: ScenarioDraftRecord) -> Self:
        return cls(
            scenario_id=record.definition.id,
            shop_id=shop_id,
            content=ScenarioContentSchema.from_domain(record.payload),
            created_at=record.created_at.isoformat(),
            updated_at=record.updated_at.isoformat(),
        )


class PinnedTemplateSchema(StrictApiModel):
    """One template a published scenario version froze, at the exact version it composed."""

    block_id: UUID
    definition_type: DefinitionType
    version: int


class ScenarioVersionResponse(StrictApiModel):
    """One frozen version, with every version it pinned."""

    scenario_id: UUID
    shop_id: UUID
    lifecycle_state: Literal["published"] = "published"
    version: int
    content_fingerprint: str
    published_at: str
    shop_version: int
    ticket_version: int
    templates: list[PinnedTemplateSchema]
    content: ScenarioContentSchema

    @classmethod
    def from_record(cls, shop_id: UUID, record: ScenarioVersionRecord) -> Self:
        published = record.published
        shop_version = published.shop_version
        ticket_version = _ticket_version(published)
        # ADR 0012 requires a published scenario to pin its shop and exactly one ticket. The
        # domain enforces both, so a version that reaches here without them is corrupted
        # evidence rather than a response to render around.
        if shop_version is None or ticket_version is None:
            raise ValueError("a published scenario version must pin its shop and one ticket")
        return cls(
            scenario_id=published.definition.id,
            shop_id=shop_id,
            version=published.version,
            content_fingerprint=published.content_fingerprint,
            published_at=published.published_at.isoformat(),
            shop_version=shop_version,
            ticket_version=ticket_version,
            templates=[
                PinnedTemplateSchema(
                    block_id=reference.definition.id,
                    definition_type=reference.definition.definition_type,
                    version=reference.version,
                )
                for reference in published.references
                if reference.definition.definition_type is not DefinitionType.TICKET
            ],
            content=ScenarioContentSchema.from_domain(record.payload),
        )


def _ticket_version(published: PublishedDefinitionVersion) -> int | None:
    for reference in published.references:
        if reference.definition.definition_type is DefinitionType.TICKET:
            return reference.version
    return None


class ScenarioVersionListResponse(StrictApiModel):
    versions: list[DefinitionVersionSummarySchema]


class ScenarioSummarySchema(StrictApiModel):
    scenario_id: UUID
    name: str
    ticket_id: UUID
    ticket_reference: str
    ticket_subject: str
    customer_display_name: str
    objective_count: int
    mutation_count: int
    context_document_count: int
    max_turns: int
    updated_at: str
    latest_published_version: int | None
    published_version_count: int

    @classmethod
    def from_domain(cls, summary: ScenarioSummary) -> Self:
        return cls(
            scenario_id=summary.scenario_id,
            name=summary.name,
            ticket_id=summary.ticket_id,
            ticket_reference=summary.ticket_reference,
            ticket_subject=summary.ticket_subject,
            customer_display_name=summary.customer_display_name,
            objective_count=summary.objective_count,
            mutation_count=summary.mutation_count,
            context_document_count=summary.context_document_count,
            max_turns=summary.max_turns,
            updated_at=summary.updated_at.isoformat(),
            latest_published_version=summary.latest_published_version,
            published_version_count=summary.published_version_count,
        )


class ScenarioListResponse(StrictApiModel):
    scenarios: list[ScenarioSummarySchema]


class ScenarioPreviewResponse(StrictApiModel):
    """The publish gate and the resolved state, which an author reads side by side."""

    scenario_id: UUID
    publishable: bool
    issues: list[DefinitionIssueSchema]
    changes: list[DefinitionChangeSchema]
    content_fingerprint: str
    latest_published_version: int | None
    next_version: int
    matches_latest_published: bool
    content: ScenarioContentSchema
    resolution: ScenarioResolutionSchema

    @classmethod
    def from_preview(cls, scenario_id: UUID, preview: ScenarioPreview) -> Self:
        draft = preview.draft
        return cls(
            scenario_id=scenario_id,
            publishable=draft.validation.publishable,
            issues=[DefinitionIssueSchema.from_domain(issue) for issue in draft.validation.issues],
            changes=[DefinitionChangeSchema.from_domain(change) for change in draft.changes],
            content_fingerprint=draft.content_fingerprint,
            latest_published_version=draft.latest_published_version,
            next_version=draft.next_version,
            matches_latest_published=draft.matches_latest_published,
            content=ScenarioContentSchema.from_domain(draft.payload),
            resolution=ScenarioResolutionSchema.from_domain(preview.resolution),
        )


class ScenarioRoutes:
    """Route handlers bound to a request-scoped `ScenarioService` dependency."""

    def __init__(self, service: Callable[[], Generator[ScenarioService, None, None]]) -> None:
        self._service = service

    def register(self, router: APIRouter) -> None:
        dependency = Depends(self._service)

        def list_scenarios(
            shop_id: ShopIdPath,
            service: Annotated[ScenarioService, dependency],
        ) -> ScenarioListResponse:
            return ScenarioListResponse(
                scenarios=[
                    ScenarioSummarySchema.from_domain(summary)
                    for summary in service.list_scenarios(shop_id)
                ]
            )

        def create_scenario(
            shop_id: ShopIdPath,
            command: CreateScenarioRequest,
            service: Annotated[ScenarioService, dependency],
        ) -> ScenarioDraftResponse:
            return ScenarioDraftResponse.from_record(
                shop_id, service.create_scenario(shop_id, command.name, command.ticket_id)
            )

        def get_scenario_draft(
            shop_id: ShopIdPath,
            scenario_id: ScenarioIdPath,
            service: Annotated[ScenarioService, dependency],
        ) -> ScenarioDraftResponse:
            return ScenarioDraftResponse.from_record(
                shop_id, service.get_scenario(shop_id, scenario_id)
            )

        def replace_scenario_draft(
            shop_id: ShopIdPath,
            scenario_id: ScenarioIdPath,
            command: ReplaceScenarioDraftRequest,
            service: Annotated[ScenarioService, dependency],
        ) -> ScenarioDraftResponse:
            existing = service.get_scenario(shop_id, scenario_id)
            return ScenarioDraftResponse.from_record(
                shop_id,
                service.replace_scenario(
                    shop_id, scenario_id, command.payload.to_domain(existing.payload.ticket_id)
                ),
            )

        def preview_scenario_draft(
            shop_id: ShopIdPath,
            scenario_id: ScenarioIdPath,
            service: Annotated[ScenarioService, dependency],
        ) -> ScenarioPreviewResponse:
            return ScenarioPreviewResponse.from_preview(
                scenario_id, service.preview_scenario(shop_id, scenario_id)
            )

        def get_scenario_resources(
            shop_id: ShopIdPath,
            scenario_id: ScenarioIdPath,
            service: Annotated[ScenarioService, dependency],
        ) -> ScenarioResourcesSchema:
            return ScenarioResourcesSchema.from_domain(
                service.scenario_resources(shop_id, scenario_id)
            )

        def publish_scenario(
            shop_id: ShopIdPath,
            scenario_id: ScenarioIdPath,
            service: Annotated[ScenarioService, dependency],
        ) -> ScenarioVersionResponse:
            return ScenarioVersionResponse.from_record(
                shop_id, service.publish_scenario(shop_id, scenario_id)
            )

        def list_scenario_versions(
            shop_id: ShopIdPath,
            scenario_id: ScenarioIdPath,
            service: Annotated[ScenarioService, dependency],
        ) -> ScenarioVersionListResponse:
            return ScenarioVersionListResponse(
                versions=[
                    DefinitionVersionSummarySchema.from_domain(published)
                    for published in service.list_scenario_versions(shop_id, scenario_id)
                ]
            )

        def get_scenario_version(
            shop_id: ShopIdPath,
            scenario_id: ScenarioIdPath,
            version: DefinitionVersionPath,
            service: Annotated[ScenarioService, dependency],
        ) -> ScenarioVersionResponse:
            return ScenarioVersionResponse.from_record(
                shop_id, service.get_scenario_version(shop_id, scenario_id, version)
            )

        router.add_api_route(
            "/shops/{shop_id}/scenarios",
            list_scenarios,
            methods=["GET"],
            response_model=ScenarioListResponse,
            operation_id="listScenarios",
            summary="List one shop's scenarios",
            responses=ShopNotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/scenarios",
            create_scenario,
            methods=["POST"],
            status_code=201,
            response_model=ScenarioDraftResponse,
            operation_id="createScenario",
            summary="Build a scenario on one of this shop's tickets",
            responses=ShopNotFoundResponses | ScenarioWriteResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/scenarios/{scenario_id}/draft",
            get_scenario_draft,
            methods=["GET"],
            response_model=ScenarioDraftResponse,
            operation_id="getScenarioDraft",
            summary="Retrieve the mutable scenario draft",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/scenarios/{scenario_id}/draft",
            replace_scenario_draft,
            methods=["PUT"],
            response_model=ScenarioDraftResponse,
            operation_id="replaceScenarioDraft",
            summary="Replace the draft without touching any published version",
            responses=NotFoundResponses | ScenarioWriteResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/scenarios/{scenario_id}/draft/preview",
            preview_scenario_draft,
            methods=["GET"],
            response_model=ScenarioPreviewResponse,
            operation_id="previewScenarioDraft",
            summary="Validate the draft and resolve the state publishing it would freeze",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/scenarios/{scenario_id}/resources",
            get_scenario_resources,
            methods=["GET"],
            response_model=ScenarioResourcesSchema,
            operation_id="getScenarioResources",
            summary="Read the same-shop objects and library templates a scenario may bind",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/scenarios/{scenario_id}/versions",
            publish_scenario,
            methods=["POST"],
            status_code=201,
            response_model=ScenarioVersionResponse,
            operation_id="publishScenario",
            summary="Freeze the draft, pinning its shop, ticket, and template versions",
            responses=NotFoundResponses | PublishScenarioResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/scenarios/{scenario_id}/versions",
            list_scenario_versions,
            methods=["GET"],
            response_model=ScenarioVersionListResponse,
            operation_id="listScenarioVersions",
            summary="List a scenario's published versions",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/scenarios/{scenario_id}/versions/{version}",
            get_scenario_version,
            methods=["GET"],
            response_model=ScenarioVersionResponse,
            operation_id="getScenarioVersion",
            summary="Retrieve one immutable published scenario version",
            responses=NotFoundResponses | InvalidResponses,
        )


__all__ = ["ScenarioRoutes"]
