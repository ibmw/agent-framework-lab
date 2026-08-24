"""Public v1 contract for authoring a shop's support tickets.

A ticket follows the definition lifecycle every authorable resource uses — draft, preview,
publish, immutable versions — under the shop that scopes it, so its routes live beside the
shop's orders rather than at the top level.

Two shapes, as with orders: a request carries **selections** (a channel the shop offers, a
catalog handle, an order identifier, a shop document ID) plus the prose a ticket genuinely
authors, and a response carries the ticket plus derived context the workspace shows and never
stores — the customer, the linked orders as they read right now, this customer's other
tickets, and the exact resources the backend would accept.
"""

from collections.abc import Callable, Generator
from datetime import datetime
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from fastapi import APIRouter, Depends, Path
from pydantic import Field

from capability_lab.application.tickets import (
    TicketContext,
    TicketCustomerSummary,
    TicketDraftPreview,
    TicketDraftRecord,
    TicketOrderOption,
    TicketReferenceSummary,
    TicketService,
    TicketShopResources,
    TicketSummary,
    TicketVersionRecord,
)
from capability_lab.domain.order_fixture import FulfilmentStatus, PaymentStatus
from capability_lab.domain.shop import SupportChannel
from capability_lab.domain.ticket import (
    SuggestedDocument,
    SuggestedDocumentKind,
    TicketAuthor,
    TicketMessage,
    TicketOrigin,
    TicketOriginKind,
    TicketPayload,
    TicketStatus,
)
from capability_lab.presentation.base import ErrorResponse, StrictApiModel
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
    ShopNotFoundResponses,
    Slug,
)
from capability_lab.presentation.orders import AwareTimestamp, canonical_instant
from capability_lab.presentation.shops import ShopIdPath

TicketIdPath = Annotated[UUID, Path(description="Stable ticket identifier inside one shop.")]
TicketReference = Annotated[
    str,
    Field(
        min_length=1,
        max_length=64,
        pattern=r"^[A-Z0-9]+(?:-[A-Z0-9]+)*$",
        description="The business reference support agents quote, unique inside one shop.",
    ),
]
TicketWriteResponses: dict[int | str, dict[str, Any]] = {
    409: {
        "model": ErrorResponse,
        "description": "Another ticket in this shop already uses that reference",
    },
    422: {
        "model": ErrorResponse,
        "description": "Invalid ticket content, or a customer this shop does not use",
    },
}
PublishTicketResponses: dict[int | str, dict[str, Any]] = PublishFailureResponses | {
    422: {
        "model": ErrorResponse,
        "description": "The draft has publish-gate errors, or its shop or customer profile "
        "has no published version to pin",
    }
}


class TicketMessageSchema(StrictApiModel):
    """One fixture message. Live replies happen on the Bench and are never authored here."""

    id: Slug
    author: TicketAuthor
    body: Body
    sent_at: AwareTimestamp

    @classmethod
    def from_domain(cls, message: TicketMessage) -> Self:
        return cls(
            id=message.id,
            author=message.author,
            body=message.body,
            sent_at=datetime.fromisoformat(message.sent_at),
        )

    def to_domain(self) -> TicketMessage:
        return TicketMessage(
            id=self.id,
            author=self.author,
            body=self.body,
            sent_at=canonical_instant(self.sent_at),
        )


class TicketOriginSchema(StrictApiModel):
    """Where the interaction started, as a minimal reference the agent resolves by tool."""

    kind: TicketOriginKind
    product_handle: Slug | None = Field(
        description="Set only for a product-page origin; null otherwise."
    )
    order_id: UUID | None = Field(description="Set only for an order-page origin; null otherwise.")

    @classmethod
    def from_domain(cls, origin: TicketOrigin) -> Self:
        return cls(kind=origin.kind, product_handle=origin.product_handle, order_id=origin.order_id)

    def to_domain(self) -> TicketOrigin:
        return TicketOrigin(
            kind=self.kind, product_handle=self.product_handle, order_id=self.order_id
        )


class SuggestedDocumentSchema(StrictApiModel):
    kind: SuggestedDocumentKind
    document_id: Slug

    @classmethod
    def from_domain(cls, document: SuggestedDocument) -> Self:
        return cls(kind=document.kind, document_id=document.document_id)

    def to_domain(self) -> SuggestedDocument:
        return SuggestedDocument(kind=self.kind, document_id=self.document_id)


class TicketPayloadSchema(StrictApiModel):
    """The whole authored content of a ticket draft or published version."""

    reference: TicketReference
    subject: Label
    channel: SupportChannel
    status: TicketStatus
    origin: TicketOriginSchema
    tags: list[Slug]
    history: list[TicketMessageSchema]
    trigger: TicketMessageSchema | None = Field(
        description="The first message every arm receives; null while the draft has none."
    )
    linked_order_ids: list[UUID]
    suggested_documents: list[SuggestedDocumentSchema]

    def to_domain(self, customer_profile_id: UUID) -> TicketPayload:
        """Rebuild the payload around the customer the ticket was created for.

        The customer is deliberately not on the wire for a draft write: it is fixed at
        creation, and a field a client could send would invite a change the service refuses.
        """
        return TicketPayload(
            reference=self.reference,
            subject=self.subject,
            customer_profile_id=customer_profile_id,
            channel=self.channel,
            status=self.status,
            origin=self.origin.to_domain(),
            tags=tuple(self.tags),
            history=tuple(message.to_domain() for message in self.history),
            trigger=None if self.trigger is None else self.trigger.to_domain(),
            linked_order_ids=tuple(self.linked_order_ids),
            suggested_documents=tuple(
                document.to_domain() for document in self.suggested_documents
            ),
        )


class TicketContentSchema(TicketPayloadSchema):
    """A ticket as the API returns it, with the derived evidence a client must not author."""

    customer_profile_id: UUID
    opened_at: str | None = Field(
        description="When the incident opened: the trigger's moment, never authored separately."
    )
    message_count: int

    @classmethod
    def from_domain(cls, payload: TicketPayload) -> Self:
        return cls(
            reference=payload.reference,
            subject=payload.subject,
            channel=payload.channel,
            status=payload.status,
            origin=TicketOriginSchema.from_domain(payload.origin),
            tags=list(payload.tags),
            history=[TicketMessageSchema.from_domain(message) for message in payload.history],
            trigger=(
                None
                if payload.trigger is None
                else TicketMessageSchema.from_domain(payload.trigger)
            ),
            linked_order_ids=list(payload.linked_order_ids),
            suggested_documents=[
                SuggestedDocumentSchema.from_domain(document)
                for document in payload.suggested_documents
            ],
            customer_profile_id=payload.customer_profile_id,
            opened_at=payload.opened_at,
            message_count=len(payload.messages),
        )


class TicketOrderSchema(StrictApiModel):
    """One of this customer's orders, as the pickers and the linked-objects card show it."""

    order_id: UUID
    reference: str
    placed_at: str
    payment_status: PaymentStatus
    fulfilment_status: FulfilmentStatus
    total_amount: str
    currency: str
    shipping_label: str | None

    @classmethod
    def from_domain(cls, option: TicketOrderOption) -> Self:
        return cls(
            order_id=option.order_id,
            reference=option.reference,
            placed_at=option.placed_at,
            payment_status=option.payment_status,
            fulfilment_status=option.fulfilment_status,
            total_amount=option.total_amount,
            currency=option.currency.value,
            shipping_label=option.shipping_label,
        )


class TicketShopResourcesSchema(StrictApiModel):
    """Exactly what this ticket may name, so a picker cannot offer a publish-gate error."""

    channels: list[SupportChannel]
    product_handles: list[str]
    orders: list[TicketOrderSchema]
    policy_ids: list[str]
    support_guideline_ids: list[str]
    faq_entry_ids: list[str]

    @classmethod
    def from_domain(cls, resources: TicketShopResources) -> Self:
        return cls(
            channels=list(resources.channels),
            product_handles=list(resources.product_handles),
            orders=[TicketOrderSchema.from_domain(order) for order in resources.orders],
            policy_ids=list(resources.policy_ids),
            support_guideline_ids=list(resources.support_guideline_ids),
            faq_entry_ids=list(resources.faq_entry_ids),
        )


class TicketCustomerSchema(StrictApiModel):
    profile_id: UUID
    display_name: str
    email: str
    locale: str
    persona_traits: list[str]
    default_address_label: str | None
    latest_published_version: int | None
    order_count: int

    @classmethod
    def from_domain(cls, customer: TicketCustomerSummary) -> Self:
        return cls(
            profile_id=customer.profile_id,
            display_name=customer.display_name,
            email=customer.email,
            locale=customer.locale,
            persona_traits=list(customer.persona_traits),
            default_address_label=customer.default_address_label,
            latest_published_version=customer.latest_published_version,
            order_count=customer.order_count,
        )


class TicketReferenceSchema(StrictApiModel):
    ticket_id: UUID
    reference: str
    subject: str
    status: TicketStatus

    @classmethod
    def from_domain(cls, summary: TicketReferenceSummary) -> Self:
        return cls(
            ticket_id=summary.ticket_id,
            reference=summary.reference,
            subject=summary.subject,
            status=summary.status,
        )


class TicketContextSchema(StrictApiModel):
    """Everything around the ticket the workspace shows and the ticket never stores."""

    customer: TicketCustomerSchema
    linked_orders: list[TicketOrderSchema]
    other_tickets: list[TicketReferenceSchema]
    resources: TicketShopResourcesSchema

    @classmethod
    def from_domain(cls, context: TicketContext) -> Self:
        return cls(
            customer=TicketCustomerSchema.from_domain(context.customer),
            linked_orders=[TicketOrderSchema.from_domain(order) for order in context.linked_orders],
            other_tickets=[
                TicketReferenceSchema.from_domain(summary) for summary in context.other_tickets
            ],
            resources=TicketShopResourcesSchema.from_domain(context.resources),
        )


class CreateTicketRequest(StrictApiModel):
    reference: TicketReference
    subject: Label
    customer_profile_id: UUID
    channel: SupportChannel


class ReplaceTicketDraftRequest(StrictApiModel):
    payload: TicketPayloadSchema


class TicketDraftResponse(StrictApiModel):
    ticket_id: UUID
    shop_id: UUID
    lifecycle_state: Literal["draft"] = "draft"
    content: TicketContentSchema
    created_at: str
    updated_at: str

    @classmethod
    def from_record(cls, shop_id: UUID, record: TicketDraftRecord) -> Self:
        return cls(
            ticket_id=record.definition.id,
            shop_id=shop_id,
            content=TicketContentSchema.from_domain(record.payload),
            created_at=record.created_at.isoformat(),
            updated_at=record.updated_at.isoformat(),
        )


class TicketVersionResponse(StrictApiModel):
    """One frozen version, with the exact shop and customer versions it pinned."""

    ticket_id: UUID
    shop_id: UUID
    lifecycle_state: Literal["published"] = "published"
    version: int
    content_fingerprint: str
    published_at: str
    shop_version: int
    customer_profile_version: int
    content: TicketContentSchema

    @classmethod
    def from_record(cls, shop_id: UUID, record: TicketVersionRecord) -> Self:
        published = record.published
        # ADR 0012 requires a published ticket to pin its shop and exactly one customer
        # profile. The domain enforces both, so a version that reaches here without them is
        # corrupted evidence rather than a response to render around.
        shop_version = published.shop_version
        if shop_version is None or len(published.references) != 1:
            raise ValueError(
                "a published ticket version must pin its shop and one customer profile"
            )
        return cls(
            ticket_id=published.definition.id,
            shop_id=shop_id,
            version=published.version,
            content_fingerprint=published.content_fingerprint,
            published_at=published.published_at.isoformat(),
            shop_version=shop_version,
            customer_profile_version=published.references[0].version,
            content=TicketContentSchema.from_domain(record.payload),
        )


class TicketVersionListResponse(StrictApiModel):
    versions: list[DefinitionVersionSummarySchema]


class TicketSummarySchema(StrictApiModel):
    ticket_id: UUID
    reference: str
    subject: str
    customer_profile_id: UUID
    customer_display_name: str
    channel: SupportChannel
    status: TicketStatus
    origin_kind: TicketOriginKind
    preview: str
    opened_at: str | None
    message_count: int
    tags: list[str]
    updated_at: str
    latest_published_version: int | None
    published_version_count: int

    @classmethod
    def from_domain(cls, summary: TicketSummary) -> Self:
        return cls(
            ticket_id=summary.ticket_id,
            reference=summary.reference,
            subject=summary.subject,
            customer_profile_id=summary.customer_profile_id,
            customer_display_name=summary.customer_display_name,
            channel=summary.channel,
            status=summary.status,
            origin_kind=summary.origin_kind,
            preview=summary.preview,
            opened_at=summary.opened_at,
            message_count=summary.message_count,
            tags=list(summary.tags),
            updated_at=summary.updated_at.isoformat(),
            latest_published_version=summary.latest_published_version,
            published_version_count=summary.published_version_count,
        )


class TicketListResponse(StrictApiModel):
    tickets: list[TicketSummarySchema]


class TicketPreviewResponse(StrictApiModel):
    """The publish gate: what blocks publication and what a publish would freeze."""

    ticket_id: UUID
    publishable: bool
    issues: list[DefinitionIssueSchema]
    changes: list[DefinitionChangeSchema]
    content_fingerprint: str
    latest_published_version: int | None
    next_version: int
    matches_latest_published: bool
    content: TicketContentSchema

    @classmethod
    def from_preview(cls, ticket_id: UUID, preview: TicketDraftPreview) -> Self:
        return cls(
            ticket_id=ticket_id,
            publishable=preview.validation.publishable,
            issues=[
                DefinitionIssueSchema.from_domain(issue) for issue in preview.validation.issues
            ],
            changes=[DefinitionChangeSchema.from_domain(change) for change in preview.changes],
            content_fingerprint=preview.content_fingerprint,
            latest_published_version=preview.latest_published_version,
            next_version=preview.next_version,
            matches_latest_published=preview.matches_latest_published,
            content=TicketContentSchema.from_domain(preview.payload),
        )


class TicketRoutes:
    """Route handlers bound to a request-scoped `TicketService` dependency."""

    def __init__(self, service: Callable[[], Generator[TicketService, None, None]]) -> None:
        self._service = service

    def register(self, router: APIRouter) -> None:
        dependency = Depends(self._service)

        def list_tickets(
            shop_id: ShopIdPath,
            service: Annotated[TicketService, dependency],
        ) -> TicketListResponse:
            return TicketListResponse(
                tickets=[
                    TicketSummarySchema.from_domain(summary)
                    for summary in service.list_tickets(shop_id)
                ]
            )

        def create_ticket(
            shop_id: ShopIdPath,
            command: CreateTicketRequest,
            service: Annotated[TicketService, dependency],
        ) -> TicketDraftResponse:
            return TicketDraftResponse.from_record(
                shop_id,
                service.create_ticket(
                    shop_id,
                    command.reference,
                    command.subject,
                    command.customer_profile_id,
                    command.channel,
                ),
            )

        def get_ticket_draft(
            shop_id: ShopIdPath,
            ticket_id: TicketIdPath,
            service: Annotated[TicketService, dependency],
        ) -> TicketDraftResponse:
            return TicketDraftResponse.from_record(shop_id, service.get_ticket(shop_id, ticket_id))

        def replace_ticket_draft(
            shop_id: ShopIdPath,
            ticket_id: TicketIdPath,
            command: ReplaceTicketDraftRequest,
            service: Annotated[TicketService, dependency],
        ) -> TicketDraftResponse:
            existing = service.get_ticket(shop_id, ticket_id)
            return TicketDraftResponse.from_record(
                shop_id,
                service.replace_ticket(
                    shop_id,
                    ticket_id,
                    command.payload.to_domain(existing.payload.customer_profile_id),
                ),
            )

        def preview_ticket_draft(
            shop_id: ShopIdPath,
            ticket_id: TicketIdPath,
            service: Annotated[TicketService, dependency],
        ) -> TicketPreviewResponse:
            return TicketPreviewResponse.from_preview(
                ticket_id, service.preview_ticket(shop_id, ticket_id)
            )

        def get_ticket_context(
            shop_id: ShopIdPath,
            ticket_id: TicketIdPath,
            service: Annotated[TicketService, dependency],
        ) -> TicketContextSchema:
            return TicketContextSchema.from_domain(service.ticket_context(shop_id, ticket_id))

        def publish_ticket(
            shop_id: ShopIdPath,
            ticket_id: TicketIdPath,
            service: Annotated[TicketService, dependency],
        ) -> TicketVersionResponse:
            return TicketVersionResponse.from_record(
                shop_id, service.publish_ticket(shop_id, ticket_id)
            )

        def list_ticket_versions(
            shop_id: ShopIdPath,
            ticket_id: TicketIdPath,
            service: Annotated[TicketService, dependency],
        ) -> TicketVersionListResponse:
            return TicketVersionListResponse(
                versions=[
                    DefinitionVersionSummarySchema.from_domain(published)
                    for published in service.list_ticket_versions(shop_id, ticket_id)
                ]
            )

        def get_ticket_version(
            shop_id: ShopIdPath,
            ticket_id: TicketIdPath,
            version: DefinitionVersionPath,
            service: Annotated[TicketService, dependency],
        ) -> TicketVersionResponse:
            return TicketVersionResponse.from_record(
                shop_id, service.get_ticket_version(shop_id, ticket_id, version)
            )

        router.add_api_route(
            "/shops/{shop_id}/tickets",
            list_tickets,
            methods=["GET"],
            response_model=TicketListResponse,
            operation_id="listTickets",
            summary="List one shop's tickets",
            responses=ShopNotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/tickets",
            create_ticket,
            methods=["POST"],
            status_code=201,
            response_model=TicketDraftResponse,
            operation_id="createTicket",
            summary="Open a ticket for one of this shop's customers",
            responses=ShopNotFoundResponses | TicketWriteResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/tickets/{ticket_id}/draft",
            get_ticket_draft,
            methods=["GET"],
            response_model=TicketDraftResponse,
            operation_id="getTicketDraft",
            summary="Retrieve the mutable ticket draft",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/tickets/{ticket_id}/draft",
            replace_ticket_draft,
            methods=["PUT"],
            response_model=TicketDraftResponse,
            operation_id="replaceTicketDraft",
            summary="Replace the draft without touching any published version",
            responses=NotFoundResponses | TicketWriteResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/tickets/{ticket_id}/draft/preview",
            preview_ticket_draft,
            methods=["GET"],
            response_model=TicketPreviewResponse,
            operation_id="previewTicketDraft",
            summary="Validate the draft against its shop and preview the version it would freeze",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/tickets/{ticket_id}/context",
            get_ticket_context,
            methods=["GET"],
            response_model=TicketContextSchema,
            operation_id="getTicketContext",
            summary="Read the customer, linked orders, and same-shop resources around a ticket",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/tickets/{ticket_id}/versions",
            publish_ticket,
            methods=["POST"],
            status_code=201,
            response_model=TicketVersionResponse,
            operation_id="publishTicket",
            summary="Freeze the draft, pinning its shop and customer-profile versions",
            responses=NotFoundResponses | PublishTicketResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/tickets/{ticket_id}/versions",
            list_ticket_versions,
            methods=["GET"],
            response_model=TicketVersionListResponse,
            operation_id="listTicketVersions",
            summary="List a ticket's published versions, newest first",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/tickets/{ticket_id}/versions/{version}",
            get_ticket_version,
            methods=["GET"],
            response_model=TicketVersionResponse,
            operation_id="getTicketVersion",
            summary="Retrieve one immutable published ticket version",
            responses=NotFoundResponses | InvalidResponses,
        )


__all__ = ["TicketRoutes"]
