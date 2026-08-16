from collections.abc import Awaitable, Callable, Generator
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal, Self
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, FastAPI, Header, Path, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker
from starlette.exceptions import HTTPException as StarletteHTTPException

from capability_lab.application.ports import Clock
from capability_lab.application.scenario_generation import (
    GeneratedScenario,
    GeneratedScenarioNotFoundError,
    IdempotencyConflictError,
    IdempotencyStateNotFoundError,
    InvalidIdempotencyKeyError,
    ScenarioGenerationKernel,
    ScenarioGenerationService,
    ScenarioGeneratorNotConfiguredError,
    create_retail_profile_kernel,
)
from capability_lab.application.scenario_registry import ScenarioNotFoundError
from capability_lab.domain.entities import MAX_SCENARIO_SEED
from capability_lab.infrastructure.clock import SystemClock
from capability_lab.infrastructure.config import Settings, get_settings
from capability_lab.infrastructure.database import (
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.repositories import (
    GeneratedScenarioConflictError,
    PersistedScenarioIntegrityError,
    SqlAlchemyGeneratedScenarioRepository,
    SqlAlchemyScenarioGenerationIdempotencyRepository,
)

API_TITLE = "Agent Framework Capability Lab API"
API_VERSION = "1.0.0"

ScenarioId = Annotated[
    str,
    Path(
        min_length=1,
        max_length=64,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
        description="Stable scenario family identifier.",
    ),
]
ScenarioVersion = Annotated[
    str,
    Path(
        min_length=2,
        max_length=64,
        pattern=r"^v[1-9][0-9]*$",
        description="Immutable scenario behavior version.",
    ),
]
ScenarioSeed = Annotated[
    int,
    Path(
        ge=0,
        le=MAX_SCENARIO_SEED,
        description="Unsigned 32-bit deterministic generation seed.",
    ),
]


class StrictApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HealthResponse(StrictApiModel):
    status: Literal["ok"]
    api_version: Literal["v1"]


class GenerateScenarioRequest(StrictApiModel):
    seed: int = Field(
        ge=0,
        le=MAX_SCENARIO_SEED,
        description="Unsigned 32-bit deterministic generation seed.",
    )


class ScenarioReferenceResponse(StrictApiModel):
    id: str
    version: str
    policy_set_version: str


class ScenarioMetadataResponse(StrictApiModel):
    scenario_id: str
    scenario_version: str
    policy_set_version: str
    canonical_schema_version: str
    seed: int
    created_at: datetime


class PersonaResponse(StrictApiModel):
    id: UUID
    display_name: str
    email: str
    locale: str
    support_traits: list[str]


class CustomerResponse(StrictApiModel):
    id: UUID
    email: str
    display_name: str
    created_at: datetime


class ProductResponse(StrictApiModel):
    id: UUID
    sku: str
    name: str
    price_amount: str = Field(pattern=r"^[0-9]+\.[0-9]{2}$")
    currency: str = Field(pattern=r"^[A-Z]{3}$")


class OrderResponse(StrictApiModel):
    id: UUID
    customer_id: UUID
    created_at: datetime
    status: Literal["pending", "paid", "cancelled"]
    version: int = Field(ge=1)


class InitialStateResponse(StrictApiModel):
    canonical_schema_version: str
    scenario: ScenarioReferenceResponse
    seed: int
    persona: PersonaResponse
    customer: CustomerResponse
    products: list[ProductResponse]
    orders: list[OrderResponse]


class GeneratedScenarioResponse(StrictApiModel):
    metadata: ScenarioMetadataResponse
    initial_state_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    initial_state: InitialStateResponse

    @classmethod
    def from_generated(cls, generated: GeneratedScenario) -> Self:
        metadata = generated.metadata
        state = generated.state
        definition = state.definition
        return cls(
            metadata=ScenarioMetadataResponse(
                scenario_id=metadata.scenario_id,
                scenario_version=metadata.scenario_version,
                policy_set_version=metadata.policy_set_version,
                canonical_schema_version=metadata.canonical_schema_version,
                seed=metadata.seed,
                created_at=metadata.created_at,
            ),
            initial_state_hash=generated.initial_state_hash,
            initial_state=InitialStateResponse(
                canonical_schema_version=definition.canonical_schema_version,
                scenario=ScenarioReferenceResponse(
                    id=definition.scenario_id,
                    version=definition.scenario_version,
                    policy_set_version=definition.policy_set_version,
                ),
                seed=state.seed,
                persona=PersonaResponse(
                    id=state.persona.id,
                    display_name=state.persona.display_name,
                    email=state.persona.email,
                    locale=state.persona.locale,
                    support_traits=list(state.persona.support_traits),
                ),
                customer=CustomerResponse(
                    id=state.customer.id,
                    email=state.customer.email,
                    display_name=state.customer.display_name,
                    created_at=state.customer.created_at,
                ),
                products=[
                    ProductResponse(
                        id=product.id,
                        sku=product.sku,
                        name=product.name,
                        price_amount=_money(product.price_amount),
                        currency=product.currency,
                    )
                    for product in sorted(state.products, key=lambda item: str(item.id))
                ],
                orders=[
                    OrderResponse(
                        id=order.id,
                        customer_id=order.customer_id,
                        created_at=order.created_at,
                        status=order.status.value,
                        version=order.version,
                    )
                    for order in sorted(state.orders, key=lambda item: str(item.id))
                ],
            ),
        )


class ValidationIssue(StrictApiModel):
    location: str
    message: str
    type: str


class ErrorResponse(StrictApiModel):
    code: str
    message: str
    request_id: str
    details: list[ValidationIssue] | None = None


def _money(value: Decimal) -> str:
    return format(value, ".2f")


def _request_id(request: Request) -> str:
    value = getattr(request.state, "request_id", None)
    return value if isinstance(value, str) else str(uuid4())


def _error_response(
    request: Request,
    *,
    status_code: int,
    code: str,
    message: str,
    details: list[ValidationIssue] | None = None,
) -> JSONResponse:
    request_id = _request_id(request)
    content = ErrorResponse(
        code=code,
        message=message,
        request_id=request_id,
        details=details,
    ).model_dump(exclude_none=True)
    return JSONResponse(
        status_code=status_code,
        content=content,
        headers={"X-Request-ID": request_id},
    )


async def _add_request_id(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    request_id = str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


async def _validation_error_handler(
    request: Request,
    error: Exception,
) -> JSONResponse:
    if not isinstance(error, RequestValidationError):
        raise TypeError("validation error handler received an unexpected exception")
    details = [
        ValidationIssue(
            location=".".join(str(part) for part in issue["loc"]),
            message=str(issue["msg"]),
            type=str(issue["type"]),
        )
        for issue in error.errors()
    ]
    return _error_response(
        request,
        status_code=422,
        code="validation_error",
        message="Request validation failed",
        details=details,
    )


async def _scenario_not_found_handler(
    request: Request,
    _error: Exception,
) -> JSONResponse:
    return _error_response(
        request,
        status_code=404,
        code="scenario_not_found",
        message="The requested scenario version is not registered",
    )


async def _generated_scenario_not_found_handler(
    request: Request,
    _error: Exception,
) -> JSONResponse:
    return _error_response(
        request,
        status_code=404,
        code="generated_scenario_not_found",
        message="No generated state exists for the requested scenario reference and seed",
    )


async def _idempotency_conflict_handler(
    request: Request,
    _error: Exception,
) -> JSONResponse:
    return _error_response(
        request,
        status_code=409,
        code="idempotency_conflict",
        message="The idempotency key was already used for different generation inputs",
    )


async def _invalid_idempotency_key_handler(
    request: Request,
    _error: Exception,
) -> JSONResponse:
    return _error_response(
        request,
        status_code=422,
        code="validation_error",
        message="The idempotency key must not be empty or have surrounding whitespace",
    )


async def _http_error_handler(
    request: Request,
    error: Exception,
) -> JSONResponse:
    if not isinstance(error, StarletteHTTPException):
        raise TypeError("HTTP error handler received an unexpected exception")
    messages = {
        404: ("not_found", "The requested resource was not found"),
        405: ("method_not_allowed", "The HTTP method is not allowed for this resource"),
    }
    code, message = messages.get(
        error.status_code, ("http_error", "The request could not be served")
    )
    return _error_response(
        request,
        status_code=error.status_code,
        code=code,
        message=message,
    )


async def _internal_error_handler(
    request: Request,
    _error: Exception,
) -> JSONResponse:
    return _error_response(
        request,
        status_code=500,
        code="internal_error",
        message="An internal server error occurred",
    )


async def _generated_scenario_conflict_handler(
    request: Request,
    _error: Exception,
) -> JSONResponse:
    return _error_response(
        request,
        status_code=409,
        code="generated_scenario_conflict",
        message="The generated state conflicts with an existing immutable entity",
    )


def health() -> HealthResponse:
    return HealthResponse(status="ok", api_version="v1")


def create_app(
    settings: Settings | None = None,
    *,
    session_factory: sessionmaker[Session] | None = None,
    generation_kernel: ScenarioGenerationKernel | None = None,
    command_clock: Clock | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    if session_factory is None:
        engine = create_database_engine(settings.database_url)
        session_factory = create_session_factory(engine)
    factory = session_factory
    clock = command_clock or SystemClock()
    kernel = generation_kernel or create_retail_profile_kernel(clock)

    application = FastAPI(title=API_TITLE, version=API_VERSION)
    application.middleware("http")(_add_request_id)
    application.add_exception_handler(RequestValidationError, _validation_error_handler)
    application.add_exception_handler(ScenarioNotFoundError, _scenario_not_found_handler)
    application.add_exception_handler(
        GeneratedScenarioNotFoundError,
        _generated_scenario_not_found_handler,
    )
    application.add_exception_handler(IdempotencyConflictError, _idempotency_conflict_handler)
    application.add_exception_handler(
        InvalidIdempotencyKeyError,
        _invalid_idempotency_key_handler,
    )
    application.add_exception_handler(StarletteHTTPException, _http_error_handler)
    application.add_exception_handler(
        GeneratedScenarioConflictError,
        _generated_scenario_conflict_handler,
    )
    application.add_exception_handler(PersistedScenarioIntegrityError, _internal_error_handler)
    application.add_exception_handler(IdempotencyStateNotFoundError, _internal_error_handler)
    application.add_exception_handler(ScenarioGeneratorNotConfiguredError, _internal_error_handler)
    application.add_exception_handler(SQLAlchemyError, _internal_error_handler)
    application.add_exception_handler(Exception, _internal_error_handler)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Idempotency-Key"],
        expose_headers=["X-Request-ID"],
    )
    router = APIRouter(prefix="/api/v1")

    def generation_service() -> Generator[ScenarioGenerationService, None, None]:
        with session_scope(factory) as session:
            yield ScenarioGenerationService(
                kernel,
                SqlAlchemyGeneratedScenarioRepository(session),
                SqlAlchemyScenarioGenerationIdempotencyRepository(session),
                clock,
            )

    def generate_scenario(
        scenario_id: ScenarioId,
        scenario_version: ScenarioVersion,
        command: GenerateScenarioRequest,
        idempotency_key: Annotated[
            str,
            Header(
                alias="Idempotency-Key",
                min_length=1,
                max_length=128,
                description="Unique retry key for this generation command.",
            ),
        ],
        service: Annotated[ScenarioGenerationService, Depends(generation_service)],
    ) -> GeneratedScenarioResponse:
        generated = service.generate(
            scenario_id,
            scenario_version,
            command.seed,
            idempotency_key=idempotency_key,
        )
        return GeneratedScenarioResponse.from_generated(generated)

    def get_generated_scenario(
        scenario_id: ScenarioId,
        scenario_version: ScenarioVersion,
        seed: ScenarioSeed,
        service: Annotated[ScenarioGenerationService, Depends(generation_service)],
    ) -> GeneratedScenarioResponse:
        return GeneratedScenarioResponse.from_generated(
            service.get(scenario_id, scenario_version, seed)
        )

    router.add_api_route(
        "/health",
        health,
        methods=["GET"],
        response_model=HealthResponse,
        operation_id="getHealth",
        summary="Report API availability",
        response_description="Service available",
    )
    router.add_api_route(
        "/scenarios/{scenario_id}/versions/{scenario_version}/generations",
        generate_scenario,
        methods=["POST"],
        status_code=201,
        response_model=GeneratedScenarioResponse,
        operation_id="generateScenario",
        summary="Generate and persist deterministic scenario state",
        response_description="Generated scenario state",
        responses={
            404: {"model": ErrorResponse, "description": "Scenario version is not registered"},
            409: {
                "model": ErrorResponse,
                "description": "Idempotency or generated-state conflict",
            },
            422: {"model": ErrorResponse, "description": "Invalid command"},
            500: {"model": ErrorResponse, "description": "Internal server error"},
        },
    )
    router.add_api_route(
        "/scenarios/{scenario_id}/versions/{scenario_version}/generations/{seed}",
        get_generated_scenario,
        methods=["GET"],
        response_model=GeneratedScenarioResponse,
        operation_id="getGeneratedScenario",
        summary="Retrieve persisted generated scenario state",
        response_description="Persisted generated scenario state",
        responses={
            404: {"model": ErrorResponse, "description": "Generated scenario is not found"},
            422: {"model": ErrorResponse, "description": "Invalid scenario reference"},
            500: {"model": ErrorResponse, "description": "Internal server error"},
        },
    )

    application.include_router(router)
    return application


app = create_app()
