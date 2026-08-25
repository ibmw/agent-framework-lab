"""Public v1 contract for the mutable sandboxes an experiment's arms work in.

A snapshot is starting state shared by every arm; a sandbox is one arm's own copy of it
(ADR 0020). So cloning is a POST on a snapshot, because a sandbox is derived from one and
cannot exist without it, while reading one is addressed by the shop, because a sandbox is
shop-scoped state and its snapshot is provenance rather than a path a client must remember.

The response carries two fingerprints on purpose. `snapshot_fingerprint` is the starting
state this arm claims and never moves; `state_fingerprint` is where the arm is now. Two
clones of one snapshot answer with the same pair until one of them writes, which is the
whole evidence that the arms started together and then diverged.

There is no write operation here, deliberately. The actors that move a sandbox are the
versioned read tools and the safe address-change action, and both arrive later in this
milestone; publishing a general "write any order" endpoint before them would be a hole no
authorization rule guards.
"""

from collections.abc import Callable, Generator
from typing import Annotated, Any, Self
from uuid import UUID

from fastapi import APIRouter, Depends, Path
from pydantic import Field

from capability_lab.application.sandboxes import (
    SANDBOX_STATE_CANONICAL_SCHEMA_VERSION,
    SandboxRecord,
    SandboxService,
)
from capability_lab.domain.content import MAX_LABEL_LENGTH
from capability_lab.presentation.base import ErrorResponse, StrictApiModel
from capability_lab.presentation.definitions import InvalidResponses, NotFoundResponses
from capability_lab.presentation.shops import ShopIdPath
from capability_lab.presentation.snapshots import SandboxStateSchema, SnapshotIdPath

SandboxIdPath = Annotated[UUID, Path(description="Stable sandbox identifier inside one shop.")]

CloneResponses: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse, "description": "The shop or the snapshot is not found"},
    422: {"model": ErrorResponse, "description": "The arm was not given a usable label"},
}


class CloneSandboxRequest(StrictApiModel):
    label: Annotated[
        str,
        Field(
            min_length=1,
            max_length=MAX_LABEL_LENGTH,
            description="How an operator tells this arm from the one beside it.",
        ),
    ]


class SandboxSummarySchema(StrictApiModel):
    """One arm of a snapshot: where it started, where it is, and how far it has moved."""

    sandbox_id: UUID
    snapshot_id: UUID
    label: str
    revision: int
    snapshot_fingerprint: str
    state_fingerprint: str
    canonical_schema_version: str
    created_at: str
    updated_at: str

    @classmethod
    def from_record(cls, record: SandboxRecord) -> Self:
        return cls(
            sandbox_id=record.sandbox_id,
            snapshot_id=record.snapshot_id,
            label=record.label,
            revision=record.revision,
            snapshot_fingerprint=record.snapshot_fingerprint,
            state_fingerprint=record.state_fingerprint,
            # The token the stored document carries; never a stringified absence.
            canonical_schema_version=SANDBOX_STATE_CANONICAL_SCHEMA_VERSION,
            created_at=record.created_at.isoformat(),
            updated_at=record.updated_at.isoformat(),
        )


class SandboxResponse(SandboxSummarySchema):
    """One arm in full, including the commerce world it currently holds.

    The state is the same projection a snapshot answers with, so an operator reads a clone
    and the starting state it came from field by field rather than in two shapes.
    """

    state: SandboxStateSchema

    @classmethod
    def from_sandbox(cls, record: SandboxRecord) -> Self:
        return cls(
            **SandboxSummarySchema.from_record(record).model_dump(),
            state=SandboxStateSchema.from_domain(record.content.state),
        )


class SandboxListResponse(StrictApiModel):
    sandboxes: list[SandboxSummarySchema]


class SandboxRoutes:
    """Route handlers bound to a request-scoped `SandboxService` dependency."""

    def __init__(self, service: Callable[[], Generator[SandboxService, None, None]]) -> None:
        self._service = service

    def register(self, router: APIRouter) -> None:
        dependency = Depends(self._service)

        def clone_sandbox(
            shop_id: ShopIdPath,
            snapshot_id: SnapshotIdPath,
            command: CloneSandboxRequest,
            service: Annotated[SandboxService, dependency],
        ) -> SandboxResponse:
            return SandboxResponse.from_sandbox(service.clone(shop_id, snapshot_id, command.label))

        def list_sandboxes(
            shop_id: ShopIdPath,
            snapshot_id: SnapshotIdPath,
            service: Annotated[SandboxService, dependency],
        ) -> SandboxListResponse:
            return SandboxListResponse(
                sandboxes=[
                    SandboxSummarySchema.from_record(record)
                    for record in service.list_sandboxes(shop_id, snapshot_id)
                ]
            )

        def get_sandbox(
            shop_id: ShopIdPath,
            sandbox_id: SandboxIdPath,
            service: Annotated[SandboxService, dependency],
        ) -> SandboxResponse:
            return SandboxResponse.from_sandbox(service.get_sandbox(shop_id, sandbox_id))

        router.add_api_route(
            "/shops/{shop_id}/snapshots/{snapshot_id}/sandboxes",
            clone_sandbox,
            methods=["POST"],
            status_code=201,
            response_model=SandboxResponse,
            operation_id="cloneSandbox",
            summary="Clone one snapshot into an independently mutable sandbox",
            description=(
                "Deliberately not idempotent: freezing the same starting state twice is one "
                "snapshot, while cloning it twice is two arms. Every clone of a snapshot "
                "starts at the same state fingerprint and moves independently afterwards."
            ),
            responses=CloneResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/snapshots/{snapshot_id}/sandboxes",
            list_sandboxes,
            methods=["GET"],
            response_model=SandboxListResponse,
            operation_id="listSandboxes",
            summary="List the sandboxes cloned from one snapshot",
            responses=NotFoundResponses | InvalidResponses,
        )
        router.add_api_route(
            "/shops/{shop_id}/sandboxes/{sandbox_id}",
            get_sandbox,
            methods=["GET"],
            response_model=SandboxResponse,
            operation_id="getSandbox",
            summary="Retrieve one arm's mutable sandbox",
            responses=NotFoundResponses | InvalidResponses,
        )


__all__ = ["SandboxRoutes"]
