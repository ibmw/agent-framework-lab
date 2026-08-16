from typing import Literal

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict

from capability_lab.infrastructure.config import Settings, get_settings

API_TITLE = "Agent Framework Capability Lab API"
API_VERSION = "1.0.0"


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"]
    api_version: Literal["v1"]


def health() -> HealthResponse:
    return HealthResponse(status="ok", api_version="v1")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    application = FastAPI(title=API_TITLE, version=API_VERSION)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Idempotency-Key"],
    )
    router = APIRouter(prefix="/api/v1")

    router.add_api_route(
        "/health",
        health,
        methods=["GET"],
        response_model=HealthResponse,
        operation_id="getHealth",
        summary="Report API availability",
        response_description="Service available",
    )

    application.include_router(router)
    return application


app = create_app()
