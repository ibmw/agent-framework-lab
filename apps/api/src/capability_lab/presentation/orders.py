"""Public v1 contract for authoring a shop's order fixtures.

Two shapes on purpose: a request expresses *selections* (a catalog SKU, an address-book
entry, a shop method) and a response carries the materialized order plus derived evidence —
frozen line prices, the subtotal and total, and the statuses this order may still move to.
An order's commerce content is therefore never typed in by a client, and the totals in a
response can never disagree with the lines that produced them.
"""

from collections.abc import Callable, Generator
from datetime import UTC, datetime
from typing import Annotated, Any, Self
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Response
from pydantic import AfterValidator, Field

from capability_lab.application.canonical_json import canonical_timestamp
from capability_lab.application.order_fixtures import (
    OrderEdit,
    OrderEventDraft,
    OrderFixtureRecord,
    OrderFixtureService,
    OrderFixtureSummary,
    OrderLineSelection,
)
from capability_lab.domain.definitions import DefinitionValidation
from capability_lab.domain.order_fixture import (
    FULFILMENT_TRANSITIONS,
    PAYMENT_TRANSITIONS,
    FrozenShippingAddress,
    FulfilmentState,
    FulfilmentStatus,
    OrderEvent,
    OrderEventKind,
    OrderFixturePayload,
    OrderLine,
    PaymentState,
    PaymentStatus,
    reachable_statuses,
)
from capability_lab.presentation.base import ErrorResponse, StrictApiModel
from capability_lab.presentation.definitions import (
    Body,
    DefinitionIssueSchema,
    InvalidResponses,
    Label,
    NotFoundResponses,
    ShopNotFoundResponses,
    Slug,
)
from capability_lab.presentation.shops import MoneyAmount, MoneySchema, ShopIdPath

OrderIdPath = Annotated[UUID, Path(description="Stable order identifier inside one shop.")]
OrderReference = Annotated[
    str,
    Field(
        min_length=1,
        max_length=64,
        pattern=r"^[A-Z0-9]+(?:-[A-Z0-9]+)*$",
        description="The business reference support agents quote, unique inside one shop.",
    ),
]
LineQuantity = Annotated[int, Field(ge=1, le=999)]
OrderWriteResponses: dict[int | str, dict[str, Any]] = {
    409: {
        "model": ErrorResponse,
        "description": "Another order in this shop already uses that reference",
    },
    422: {
        "model": ErrorResponse,
        "description": "Invalid order content, an unresolvable selection, "
        "or an illegal status transition",
    },
}
OptionalSlug = Annotated[str | None, Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")]


def require_offset(value: datetime) -> datetime:
    """Refuse a naive instant rather than assuming it is UTC.

    An order's fingerprint depends on this moment, so guessing an offset would make two
    identical-looking fixtures differ. Refusing in the schema answers the contract's own
    422 with the offending field, instead of failing deeper in the handler.
    """
    if value.utcoffset() is None:
        raise ValueError("timestamp must carry a UTC offset, for example 2026-08-20T14:55:00Z")
    return value


AwareTimestamp = Annotated[
    datetime,
    AfterValidator(require_offset),
    Field(description="RFC 3339 instant with an explicit UTC offset."),
]


def canonical_instant(value: datetime) -> str:
    """Normalize a client's RFC 3339 instant into the canonical UTC form."""
    return canonical_timestamp(require_offset(value).astimezone(UTC))


class OrderLineSchema(StrictApiModel):
    """One frozen line item. `unit_price` is what the catalog charged when it was added."""

    id: str
    sku: str
    product_handle: str
    title: str
    variant_summary: str
    unit_price: MoneySchema
    quantity: int
    line_total: MoneySchema

    @classmethod
    def from_domain(cls, line: OrderLine) -> Self:
        return cls(
            id=line.id,
            sku=line.sku,
            product_handle=line.product_handle,
            title=line.title,
            variant_summary=line.variant_summary,
            unit_price=MoneySchema.from_domain(line.unit_price),
            quantity=line.quantity,
            line_total=MoneySchema.from_domain(line.line_total),
        )


class OrderLineSelectionSchema(StrictApiModel):
    """A catalog variant and how many of it; the price is resolved by the lab."""

    sku: Label
    quantity: LineQuantity


class ShippingAddressSchema(StrictApiModel):
    """The frozen copy of the address-book entry this order ships to."""

    source_address_id: str
    source_label: str
    selected_at: str
    recipient: str
    line1: str
    line2: str | None
    postal_code: str
    city: str
    region: str | None
    country: str

    @classmethod
    def from_domain(cls, address: FrozenShippingAddress) -> Self:
        return cls(
            source_address_id=address.source_address_id,
            source_label=address.source_label,
            selected_at=address.selected_at,
            recipient=address.recipient,
            line1=address.line1,
            line2=address.line2,
            postal_code=address.postal_code,
            city=address.city,
            region=address.region,
            country=address.country,
        )


class OrderPaymentSchema(StrictApiModel):
    status: PaymentStatus
    method_id: str | None
    method_name: str | None
    paid_at: str | None

    @classmethod
    def from_domain(cls, payment: PaymentState) -> Self:
        return cls(
            status=payment.status,
            method_id=payment.method_id,
            method_name=payment.method_name,
            paid_at=payment.paid_at,
        )


class OrderFulfilmentSchema(StrictApiModel):
    status: FulfilmentStatus
    method_id: str | None
    method_name: str | None
    shipped_at: str | None

    @classmethod
    def from_domain(cls, fulfilment: FulfilmentState) -> Self:
        return cls(
            status=fulfilment.status,
            method_id=fulfilment.method_id,
            method_name=fulfilment.method_name,
            shipped_at=fulfilment.shipped_at,
        )


class OrderEventSchema(StrictApiModel):
    id: str
    kind: OrderEventKind
    occurred_at: str
    summary: str

    @classmethod
    def from_domain(cls, event: OrderEvent) -> Self:
        return cls(
            id=event.id, kind=event.kind, occurred_at=event.occurred_at, summary=event.summary
        )


class OrderEventInputSchema(StrictApiModel):
    """An authored history entry. The caller owns the identifier so edits stay stable."""

    id: Slug
    kind: OrderEventKind
    occurred_at: AwareTimestamp
    summary: Body

    def to_draft(self) -> OrderEventDraft:
        return OrderEventDraft(
            id=self.id,
            kind=self.kind.value,
            occurred_at=canonical_instant(self.occurred_at),
            summary=self.summary,
        )


class OrderContentSchema(StrictApiModel):
    """The materialized order, including the totals derived from its line items."""

    reference: str
    customer_profile_id: UUID
    currency: str
    placed_at: str
    lines: list[OrderLineSchema]
    payment: OrderPaymentSchema
    fulfilment: OrderFulfilmentSchema
    shipping_fee: MoneySchema
    shipping_address: ShippingAddressSchema | None
    events: list[OrderEventSchema]
    subtotal: MoneySchema
    total: MoneySchema
    item_count: int
    allows_address_change: bool

    @classmethod
    def from_domain(cls, payload: OrderFixturePayload) -> Self:
        return cls(
            reference=payload.reference,
            customer_profile_id=payload.customer_profile_id,
            currency=payload.currency.value,
            placed_at=payload.placed_at,
            lines=[OrderLineSchema.from_domain(line) for line in payload.lines],
            payment=OrderPaymentSchema.from_domain(payload.payment),
            fulfilment=OrderFulfilmentSchema.from_domain(payload.fulfilment),
            shipping_fee=MoneySchema.from_domain(payload.shipping_amount),
            shipping_address=None
            if payload.shipping_address is None
            else ShippingAddressSchema.from_domain(payload.shipping_address),
            events=[OrderEventSchema.from_domain(event) for event in payload.events],
            subtotal=MoneySchema.from_domain(payload.subtotal),
            total=MoneySchema.from_domain(payload.total),
            item_count=payload.item_count,
            allows_address_change=payload.fulfilment.allows_address_change,
        )


class ShopOrderResponse(StrictApiModel):
    """One authored order, its findings, and the statuses it may still move to.

    Named for its shop scope because the POC's scenario contract already publishes an
    `OrderResponse`; two schemas of one name would make the generator rename both, and one
    of them is already published.
    """

    order_id: UUID
    shop_id: UUID
    content: OrderContentSchema
    content_fingerprint: str
    issues: list[DefinitionIssueSchema]
    payment_status_options: list[PaymentStatus]
    fulfilment_status_options: list[FulfilmentStatus]
    created_at: str
    updated_at: str

    @classmethod
    def from_record(cls, record: OrderFixtureRecord, validation: DefinitionValidation) -> Self:
        payload = record.payload
        return cls(
            order_id=record.order_id,
            shop_id=record.shop_id,
            content=OrderContentSchema.from_domain(payload),
            content_fingerprint=record.content_fingerprint,
            issues=[DefinitionIssueSchema.from_domain(issue) for issue in validation.issues],
            payment_status_options=list(
                reachable_statuses(payload.payment.status, PAYMENT_TRANSITIONS)
            ),
            fulfilment_status_options=list(
                reachable_statuses(payload.fulfilment.status, FULFILMENT_TRANSITIONS)
            ),
            created_at=record.created_at.isoformat(),
            updated_at=record.updated_at.isoformat(),
        )


class OrderSummarySchema(StrictApiModel):
    """One row of the Studio's order index."""

    order_id: UUID
    reference: str
    customer_profile_id: UUID
    customer_display_name: str
    placed_at: str
    payment_status: PaymentStatus
    fulfilment_status: FulfilmentStatus
    line_count: int
    total: MoneySchema
    updated_at: str

    @classmethod
    def from_domain(cls, summary: OrderFixtureSummary) -> Self:
        return cls(
            order_id=summary.order_id,
            reference=summary.reference,
            customer_profile_id=summary.customer_profile_id,
            customer_display_name=summary.customer_display_name,
            placed_at=summary.placed_at,
            payment_status=summary.payment_status,
            fulfilment_status=summary.fulfilment_status,
            line_count=summary.line_count,
            total=MoneySchema(amount=summary.total_amount, currency=summary.currency),
            updated_at=summary.updated_at.isoformat(),
        )


class OrderListResponse(StrictApiModel):
    orders: list[OrderSummarySchema]


class CreateOrderRequest(StrictApiModel):
    """The order's identity: a reference, the customer it belongs to, and when it happened."""

    reference: OrderReference
    customer_profile_id: UUID
    placed_at: AwareTimestamp


class ReplaceOrderPaymentSchema(StrictApiModel):
    status: PaymentStatus
    method_id: OptionalSlug
    paid_at: AwareTimestamp | None


class ReplaceOrderFulfilmentSchema(StrictApiModel):
    status: FulfilmentStatus
    method_id: OptionalSlug
    shipped_at: AwareTimestamp | None


class ReplaceOrderRequest(StrictApiModel):
    """The whole order as selections. The customer is fixed at creation and never edited."""

    reference: OrderReference
    placed_at: AwareTimestamp
    lines: list[OrderLineSelectionSchema]
    payment: ReplaceOrderPaymentSchema
    fulfilment: ReplaceOrderFulfilmentSchema
    shipping_fee_amount: MoneyAmount
    shipping_address_id: OptionalSlug
    events: list[OrderEventInputSchema]

    def to_edit(self) -> OrderEdit:
        return OrderEdit(
            reference=self.reference,
            placed_at=canonical_instant(self.placed_at),
            lines=tuple(
                OrderLineSelection(sku=line.sku, quantity=line.quantity) for line in self.lines
            ),
            payment_status=self.payment.status,
            payment_method_id=self.payment.method_id,
            paid_at=None
            if self.payment.paid_at is None
            else canonical_instant(self.payment.paid_at),
            fulfilment_status=self.fulfilment.status,
            fulfilment_method_id=self.fulfilment.method_id,
            shipped_at=None
            if self.fulfilment.shipped_at is None
            else canonical_instant(self.fulfilment.shipped_at),
            shipping_fee_amount=self.shipping_fee_amount,
            shipping_address_id=self.shipping_address_id,
            events=tuple(event.to_draft() for event in self.events),
        )


class OrderRoutes:
    """Route handlers bound to a request-scoped `OrderFixtureService` dependency."""

    def __init__(self, service: Callable[[], Generator[OrderFixtureService, None, None]]) -> None:
        self._service = service

    def register(self, router: APIRouter) -> None:
        dependency = Depends(self._service)

        def respond(service: OrderFixtureService, record: OrderFixtureRecord) -> ShopOrderResponse:
            return ShopOrderResponse.from_record(
                record, service.validate_order(record.shop_id, record.payload)
            )

        def list_orders(
            shop_id: ShopIdPath,
            service: Annotated[OrderFixtureService, dependency],
        ) -> OrderListResponse:
            return OrderListResponse(
                orders=[
                    OrderSummarySchema.from_domain(summary)
                    for summary in service.list_orders(shop_id)
                ]
            )

        def create_order(
            shop_id: ShopIdPath,
            command: CreateOrderRequest,
            service: Annotated[OrderFixtureService, dependency],
        ) -> ShopOrderResponse:
            return respond(
                service,
                service.create_order(
                    shop_id,
                    command.reference,
                    command.customer_profile_id,
                    canonical_instant(command.placed_at),
                ),
            )

        def get_order(
            shop_id: ShopIdPath,
            order_id: OrderIdPath,
            service: Annotated[OrderFixtureService, dependency],
        ) -> ShopOrderResponse:
            return respond(service, service.get_order(shop_id, order_id))

        def replace_order(
            shop_id: ShopIdPath,
            order_id: OrderIdPath,
            command: ReplaceOrderRequest,
            service: Annotated[OrderFixtureService, dependency],
        ) -> ShopOrderResponse:
            return respond(service, service.replace_order(shop_id, order_id, command.to_edit()))

        def delete_order(
            shop_id: ShopIdPath,
            order_id: OrderIdPath,
            service: Annotated[OrderFixtureService, dependency],
        ) -> Response:
            service.delete_order(shop_id, order_id)
            return Response(status_code=204)

        router.add_api_route(
            "/shops/{shop_id}/orders",
            list_orders,
            methods=["GET"],
            response_model=OrderListResponse,
            operation_id="listShopOrders",
            summary="List the authored order fixtures of one shop",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/orders",
            create_order,
            methods=["POST"],
            status_code=201,
            response_model=ShopOrderResponse,
            operation_id="createShopOrder",
            summary="Create an order fixture for a customer attached to this shop",
            responses=ShopNotFoundResponses | OrderWriteResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/orders/{order_id}",
            get_order,
            methods=["GET"],
            response_model=ShopOrderResponse,
            operation_id="getShopOrder",
            summary="Retrieve one authored order and its findings",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/orders/{order_id}",
            replace_order,
            methods=["PUT"],
            response_model=ShopOrderResponse,
            operation_id="replaceShopOrder",
            summary="Replace the order from catalog, method, and address-book selections",
            responses=NotFoundResponses | OrderWriteResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/orders/{order_id}",
            delete_order,
            methods=["DELETE"],
            status_code=204,
            operation_id="deleteShopOrder",
            summary="Delete an order fixture; nothing already published is affected",
            responses=NotFoundResponses | InvalidResponses,
        )
