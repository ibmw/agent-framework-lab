"""Public v1 contract for the images a shop holds: upload, list and serve (ADR 0076).

Multipart lives here and nowhere else. The upload route reads the request's `Content-Length`
before it touches the body, so an oversized request is refused without being parsed; the
service still counts every byte it reads against the cap, so a length that lied buys nothing.
The original file name travels from the multipart part to the service as a label and is never
written to a log, a span or an error body.
"""

from collections.abc import Callable, Generator
from datetime import datetime
from typing import Annotated, Any, Self
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import Field
from starlette.datastructures import UploadFile

from capability_lab.application.shop_media import (
    MediaType,
    ShopMediaAsset,
    ShopMediaService,
    media_too_large_message,
)
from capability_lab.presentation.base import ErrorResponse, StrictApiModel, ValidationIssue

ShopIdPath = Annotated[UUID, Path(description="Stable shop definition identifier.")]
Sha256Path = Annotated[
    str,
    Path(description="The SHA-256 of the image's bytes, as 64 lowercase hexadecimal digits."),
]

# What a multipart envelope adds around one file part: the boundary lines and the part's own
# headers. Generous on purpose — a request refused here is refused before a byte is parsed, so
# the margin only has to keep an honest upload at exactly the cap from being turned away.
MULTIPART_OVERHEAD_BYTES = 64 * 1024

_UPLOAD_FIELD = "file"


class ShopMediaAssetSchema(StrictApiModel):
    """One image a shop holds."""

    reference: str = Field(
        description="What a product's media entry names this image by: `asset:sha256:<hex>`."
    )
    sha256: str = Field(
        pattern=r"^[0-9a-f]{64}$",
        description="The SHA-256 of the stored bytes, which serve the image at "
        "`/shops/{shop_id}/media/{sha256}`.",
    )
    content_type: MediaType = Field(description="The type the image's first bytes say.")
    byte_size: int = Field(gt=0)
    file_name: str = Field(
        max_length=200,
        description="The original file name of the first upload of these bytes, cleaned into "
        "a label for display. Never a path.",
    )
    created_at: datetime

    @classmethod
    def from_domain(cls, asset: ShopMediaAsset) -> Self:
        return cls(
            reference=asset.reference,
            sha256=asset.sha256,
            content_type=asset.content_type,
            byte_size=asset.byte_size,
            file_name=asset.file_name,
            created_at=asset.created_at,
        )


class ShopMediaListResponse(StrictApiModel):
    media: list[ShopMediaAssetSchema] = Field(description="The shop's images, newest first.")


def _declared_length(header: str | None) -> int | None:
    """The `Content-Length` a request declared, or none where it declared no number.

    ASCII digits only: `str.isdigit` alone also accepts "²", which `int` then refuses.
    """
    if header is None or not (header.isascii() and header.isdigit()):
        return None
    return int(header)


def _refusal(request: Request, status_code: int, code: str, message: str) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    body = ErrorResponse(code=code, message=message, request_id=str(request_id))
    return JSONResponse(
        status_code=status_code,
        content=body.model_dump(exclude_none=True),
        headers={"X-Request-ID": str(request_id)},
    )


def _no_file(request: Request) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    body = ErrorResponse(
        code="validation_error",
        message="Request validation failed",
        request_id=str(request_id),
        details=[
            ValidationIssue(
                location=f"body.{_UPLOAD_FIELD}",
                message="an image file is required",
                type="missing",
            )
        ],
    )
    return JSONResponse(
        status_code=422,
        content=body.model_dump(exclude_none=True),
        headers={"X-Request-ID": str(request_id)},
    )


_UPLOAD_REQUEST_BODY: dict[str, Any] = {
    "required": True,
    "content": {
        "multipart/form-data": {
            "schema": {
                "type": "object",
                "required": [_UPLOAD_FIELD],
                "properties": {
                    _UPLOAD_FIELD: {
                        "type": "string",
                        "format": "binary",
                        "description": "One PNG, JPEG or WebP image, told by its first bytes.",
                    }
                },
            }
        }
    },
}

# The served image's headers. `nosniff` holds the browser to the stored type, the policy
# sandboxes the response if it is ever opened as a document, `inline` shows it rather than
# downloading it, and a hash's bytes never change, so a year's `immutable` is the truth.
_SERVING_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": "inline",
    "Cache-Control": "public, max-age=31536000, immutable",
}


class ShopMediaRoutes:
    """Route handlers bound to a request-scoped `ShopMediaService` dependency."""

    def __init__(self, service: Callable[[], Generator[ShopMediaService, None, None]]) -> None:
        self._service = service

    def register(self, router: APIRouter) -> None:
        # `scope="function"`: the session the service writes through commits when the handler
        # returns and before the response is sent, so a 201 is never answered for a claim whose
        # commit then fails. The default, request scope, would commit after the response.
        dependency = Depends(self._service, scope="function")

        async def upload_shop_media(
            shop_id: ShopIdPath,
            request: Request,
            service: Annotated[ShopMediaService, dependency],
        ) -> Response:
            # Refused on the header alone, before `request.form()` reads a byte of the body.
            declared = _declared_length(request.headers.get("content-length"))
            if declared is None:
                return _refusal(
                    request,
                    411,
                    "length_required",
                    "an upload must declare its Content-Length",
                )
            if declared > service.max_bytes + MULTIPART_OVERHEAD_BYTES:
                return _refusal(
                    request,
                    413,
                    "media_too_large",
                    media_too_large_message(service.max_bytes),
                )
            form = await request.form(max_files=1, max_fields=1)
            try:
                upload = form.get(_UPLOAD_FIELD)
                if not isinstance(upload, UploadFile):
                    return _no_file(request)
                stored = await run_in_threadpool(
                    service.upload, shop_id, upload.filename, upload.file
                )
            finally:
                await form.close()
            return JSONResponse(
                status_code=201 if stored.created else 200,
                content=ShopMediaAssetSchema.from_domain(stored.asset).model_dump(mode="json"),
            )

        def list_shop_media(
            shop_id: ShopIdPath,
            service: Annotated[ShopMediaService, dependency],
        ) -> ShopMediaListResponse:
            return ShopMediaListResponse(
                media=[ShopMediaAssetSchema.from_domain(asset) for asset in service.list(shop_id)]
            )

        def get_shop_media(
            shop_id: ShopIdPath,
            sha256: Sha256Path,
            service: Annotated[ShopMediaService, dependency],
        ) -> Response:
            image = service.open(shop_id, sha256)
            return Response(
                content=image.content,
                media_type=image.asset.content_type.value,
                headers={**_SERVING_HEADERS, "ETag": f'"{image.asset.sha256}"'},
            )

        stored_response = {
            "model": ShopMediaAssetSchema,
            "description": "The shop already held these bytes; the image as first uploaded",
        }
        router.add_api_route(
            "/shops/{shop_id}/media",
            upload_shop_media,
            methods=["POST"],
            status_code=201,
            response_model=ShopMediaAssetSchema,
            operation_id="uploadShopMedia",
            summary="Upload an image the shop holds, stored once under the hash of its bytes",
            openapi_extra={"requestBody": _UPLOAD_REQUEST_BODY},
            responses={
                201: {
                    "model": ShopMediaAssetSchema,
                    "description": "The image is stored, and the shop now holds it",
                },
                200: stored_response,
                404: {"model": ErrorResponse, "description": "The shop is not found"},
                411: {"model": ErrorResponse, "description": "No Content-Length was declared"},
                413: {
                    "model": ErrorResponse,
                    "description": "The image is larger than the lab stores (`media_too_large`)",
                },
                415: {
                    "model": ErrorResponse,
                    "description": "Not a PNG, a JPEG or a WebP image (`media_type_unsupported`)",
                },
                422: {"model": ErrorResponse, "description": "The request holds no file"},
            },
        )
        router.add_api_route(
            "/shops/{shop_id}/media",
            list_shop_media,
            methods=["GET"],
            response_model=ShopMediaListResponse,
            operation_id="listShopMedia",
            summary="List the images a shop holds, newest first",
            responses={
                404: {"model": ErrorResponse, "description": "The shop is not found"},
                422: {"model": ErrorResponse, "description": "Invalid shop identifier"},
            },
        )
        router.add_api_route(
            "/shops/{shop_id}/media/{sha256}",
            get_shop_media,
            methods=["GET"],
            response_class=Response,
            operation_id="getShopMedia",
            summary="Serve one image the shop holds, as its stored type",
            responses={
                200: {
                    "description": "The image's bytes, as the type they were stored as",
                    "content": {
                        "image/png": {"schema": {"type": "string", "format": "binary"}},
                        "image/jpeg": {"schema": {"type": "string", "format": "binary"}},
                        "image/webp": {"schema": {"type": "string", "format": "binary"}},
                    },
                },
                404: {
                    "model": ErrorResponse,
                    "description": "The shop holds no image under this hash, or it is malformed",
                },
                422: {"model": ErrorResponse, "description": "Invalid shop identifier"},
            },
        )
