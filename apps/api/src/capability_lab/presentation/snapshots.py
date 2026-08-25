"""Public v1 contract for the sandbox snapshots a scenario version materializes into.

Three operations, and their shape follows what a snapshot *is* (ADR 0019). Materializing is
a POST on a published scenario version, because a snapshot is derived from one and cannot
exist without it. Reading one is addressed by the shop, because a snapshot is shop-scoped
state and its scenario is provenance rather than a path a client should have to remember.

A snapshot response separates the two halves the document itself separates: `pins` are the
immutable versions it recorded, and `state` is what it copied because nothing pinned it. The
orders travel as a readable projection with their frozen shipping address; the canonical
document behind them is identified by `sandbox_fingerprint`, which is what a reproducibility
claim actually rests on.
"""

from collections.abc import Callable, Generator
from typing import Annotated, Any, Self
from uuid import UUID

from fastapi import APIRouter, Depends, Path
from pydantic import Field

from capability_lab.application.sandbox_materialization import (
    SandboxSnapshotRecord,
    SandboxSnapshotService,
)
from capability_lab.application.sandbox_snapshot import (
    SANDBOX_CANONICAL_SCHEMA_VERSION,
    SandboxSnapshotDocument,
)
from capability_lab.domain.definitions import DefinitionType
from capability_lab.domain.entities import MAX_SCENARIO_SEED, MIN_SCENARIO_SEED
from capability_lab.domain.order_fixture import FulfilmentStatus, PaymentStatus
from capability_lab.domain.sandbox import SandboxOrder, SandboxState
from capability_lab.domain.shop import Currency, SupportChannel
from capability_lab.domain.ticket import TicketOriginKind
from capability_lab.presentation.base import ErrorResponse, StrictApiModel
from capability_lab.presentation.definitions import (
    DefinitionValidationErrorResponse,
    DefinitionVersionPath,
    InvalidResponses,
    NotFoundResponses,
)
from capability_lab.presentation.scenarios import ScenarioIdPath
from capability_lab.presentation.shops import ShopIdPath

SnapshotIdPath = Annotated[
    UUID, Path(description="Stable sandbox snapshot identifier inside one shop.")
]
SandboxSeed = Annotated[
    int,
    Field(
        ge=MIN_SCENARIO_SEED,
        le=MAX_SCENARIO_SEED,
        description="The deterministic seed this starting state is fingerprinted with.",
    ),
]

MaterializeResponses: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse, "description": "The shop or the scenario version is not found"},
    422: {
        "model": DefinitionValidationErrorResponse,
        "description": "The frozen recipe no longer resolves to starting state",
    },
}


class MaterializeSnapshotRequest(StrictApiModel):
    seed: SandboxSeed


class SandboxPinSchema(StrictApiModel):
    """One immutable input this snapshot recorded rather than copied."""

    definition_type: DefinitionType
    definition_id: UUID
    version: int
    content_fingerprint: str


class SandboxInteractionSchema(StrictApiModel):
    """The minimal resource reference the incident started from.

    An identifier and nothing else: an arm resolves "this product" or "this order" through
    tools against the sandbox, so the starting state never embeds the resource.
    """

    origin_kind: TicketOriginKind
    product_handle: str | None
    order_id: UUID | None
    channel: SupportChannel
    ticket_reference: str


class SandboxOrderSchema(StrictApiModel):
    """One frozen order, as the snapshot copied it.

    A readable projection of the canonical `order-fixture-v1` document, whose exact bytes are
    what `sandbox_fingerprint` covers.
    """

    order_id: UUID
    reference: str
    payment_status: PaymentStatus
    fulfilment_status: FulfilmentStatus
    total_amount: str
    currency: Currency
    item_count: int
    shipping_label: str | None

    @classmethod
    def from_domain(cls, order: SandboxOrder) -> Self:
        payload = order.payload
        address = payload.shipping_address
        return cls(
            order_id=order.order_id,
            reference=payload.reference,
            payment_status=payload.payment.status,
            fulfilment_status=payload.fulfilment.status,
            total_amount=format(payload.total.amount, ".2f"),
            currency=payload.currency,
            item_count=payload.item_count,
            shipping_label=None if address is None else address.single_line,
        )


class SandboxStateSchema(StrictApiModel):
    """What the snapshot copied, because no published version pinned it."""

    customer_profile_id: UUID
    interaction: SandboxInteractionSchema
    orders: list[SandboxOrderSchema]

    @classmethod
    def from_domain(cls, state: SandboxState) -> Self:
        origin = state.interaction.origin
        return cls(
            customer_profile_id=state.customer_profile_id,
            interaction=SandboxInteractionSchema(
                origin_kind=origin.kind,
                product_handle=origin.product_handle,
                order_id=origin.order_id,
                channel=state.interaction.channel,
                ticket_reference=state.interaction.ticket_reference,
            ),
            orders=[SandboxOrderSchema.from_domain(order) for order in state.orders],
        )


class SandboxSnapshotSummarySchema(StrictApiModel):
    """One row of a scenario version's snapshot history."""

    snapshot_id: UUID
    scenario_id: UUID
    scenario_version: int
    seed: int
    sandbox_fingerprint: str
    canonical_schema_version: str
    order_count: int
    origin_kind: TicketOriginKind
    ticket_reference: str
    created_at: str

    @classmethod
    def from_record(cls, record: SandboxSnapshotRecord, content: SandboxSnapshotDocument) -> Self:
        """Built from the decoded envelope, so the row can only describe what was frozen.

        The decode is passed in rather than repeated per schema: it checks the schema token,
        and doing that once per response keeps the summary and the detail describing the same
        document.
        """
        state = content.state
        return cls(
            snapshot_id=record.snapshot_id,
            scenario_id=record.scenario_id,
            scenario_version=record.scenario_version,
            seed=record.seed,
            sandbox_fingerprint=record.sandbox_fingerprint,
            # The token the decode already accepted; never a stringified absence.
            canonical_schema_version=SANDBOX_CANONICAL_SCHEMA_VERSION,
            order_count=len(state.orders),
            origin_kind=state.interaction.origin.kind,
            ticket_reference=state.interaction.ticket_reference,
            created_at=record.created_at.isoformat(),
        )


class SandboxSnapshotResponse(SandboxSnapshotSummarySchema):
    """One snapshot in full: what it pinned, and what it copied."""

    pins: list[SandboxPinSchema]
    state: SandboxStateSchema

    # Named apart from the summary's builder rather than overriding it: this one owns the
    # decode instead of receiving it, which is a different contract, not a narrower one.
    @classmethod
    def from_snapshot(cls, record: SandboxSnapshotRecord) -> Self:
        content = record.content
        return cls(
            **SandboxSnapshotSummarySchema.from_record(record, content).model_dump(),
            pins=[
                SandboxPinSchema(
                    definition_type=pin.definition.definition_type,
                    definition_id=pin.definition.id,
                    version=pin.version,
                    content_fingerprint=pin.content_fingerprint,
                )
                for pin in content.pins
            ],
            state=SandboxStateSchema.from_domain(content.state),
        )


class SandboxSnapshotListResponse(StrictApiModel):
    snapshots: list[SandboxSnapshotSummarySchema]


class SandboxSnapshotRoutes:
    """Route handlers bound to a request-scoped `SandboxSnapshotService` dependency."""

    def __init__(
        self, service: Callable[[], Generator[SandboxSnapshotService, None, None]]
    ) -> None:
        self._service = service

    def register(self, router: APIRouter) -> None:
        dependency = Depends(self._service)

        def materialize_snapshot(
            shop_id: ShopIdPath,
            scenario_id: ScenarioIdPath,
            version: DefinitionVersionPath,
            command: MaterializeSnapshotRequest,
            service: Annotated[SandboxSnapshotService, dependency],
        ) -> SandboxSnapshotResponse:
            return SandboxSnapshotResponse.from_snapshot(
                service.materialize(shop_id, scenario_id, version, seed=command.seed)
            )

        def list_snapshots(
            shop_id: ShopIdPath,
            scenario_id: ScenarioIdPath,
            service: Annotated[SandboxSnapshotService, dependency],
        ) -> SandboxSnapshotListResponse:
            return SandboxSnapshotListResponse(
                snapshots=[
                    SandboxSnapshotSummarySchema.from_record(record, record.content)
                    for record in service.list_snapshots(shop_id, scenario_id)
                ]
            )

        def get_snapshot(
            shop_id: ShopIdPath,
            snapshot_id: SnapshotIdPath,
            service: Annotated[SandboxSnapshotService, dependency],
        ) -> SandboxSnapshotResponse:
            return SandboxSnapshotResponse.from_snapshot(service.get_snapshot(shop_id, snapshot_id))

        router.add_api_route(
            "/shops/{shop_id}/scenarios/{scenario_id}/versions/{version}/snapshots",
            materialize_snapshot,
            methods=["POST"],
            status_code=201,
            response_model=SandboxSnapshotResponse,
            operation_id="materializeSandboxSnapshot",
            summary="Freeze one published scenario version into canonical starting state",
            description=(
                "Idempotent by fingerprint: the same recipe, seed, and orders return the "
                "snapshot that already holds them, while an order edited in between "
                "produces a new one."
            ),
            responses=MaterializeResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/scenarios/{scenario_id}/snapshots",
            list_snapshots,
            methods=["GET"],
            response_model=SandboxSnapshotListResponse,
            operation_id="listSandboxSnapshots",
            summary="List the snapshots materialized from one scenario",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/snapshots/{snapshot_id}",
            get_snapshot,
            methods=["GET"],
            response_model=SandboxSnapshotResponse,
            operation_id="getSandboxSnapshot",
            summary="Retrieve one immutable sandbox snapshot",
            responses=NotFoundResponses | InvalidResponses,
        )


__all__ = ["SandboxSnapshotRoutes"]
