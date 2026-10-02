"""Public v1 contract for deleting a shop that never published (ADR 0077)."""

from collections.abc import Callable, Generator
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Response

from capability_lab.application.shop_deletion import ShopDeletionService
from capability_lab.presentation.base import ErrorResponse

ShopIdPath = Annotated[UUID, Path(description="Stable shop definition identifier.")]


class ShopDeletionRoutes:
    """The one route bound to a request-scoped `ShopDeletionService` dependency.

    The dependency is composition's: it commits the rows the use case removed and only then
    removes the shop's media directory, so the files go only once the rows are gone for good.
    """

    def __init__(self, service: Callable[[], Generator[ShopDeletionService, None, None]]) -> None:
        self._service = service

    def register(self, router: APIRouter) -> None:
        # `scope="function"`: the dependency exits — commits, then removes the directory —
        # when the handler returns and before the response is sent, so a 204 means the rows
        # are gone. Under the default request scope the 204 would be on the wire first.
        dependency = Depends(self._service, scope="function")

        def delete_shop(
            shop_id: ShopIdPath,
            service: Annotated[ShopDeletionService, dependency],
        ) -> Response:
            service.delete_shop(shop_id)
            return Response(status_code=204)

        router.add_api_route(
            "/shops/{shop_id}",
            delete_shop,
            methods=["DELETE"],
            status_code=204,
            operation_id="deleteShop",
            summary="Delete a shop that never published, with everything it holds",
            description=(
                "Removes the shop's draft, the drafts of its tickets and scenarios, its orders, "
                "its attachments and its images. The customer profiles, support identities, "
                "blocks, agent configurations and judges it used are kept. A shop that has "
                "published a version, or that an experiment names, is refused."
            ),
            responses={
                404: {"model": ErrorResponse, "description": "The shop is not found"},
                409: {
                    "model": ErrorResponse,
                    "description": "The shop has published a version and is kept "
                    "(`shop_published`)",
                },
                422: {"model": ErrorResponse, "description": "Invalid shop identifier"},
            },
        )
