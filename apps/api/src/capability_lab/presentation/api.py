from collections.abc import AsyncGenerator, Awaitable, Callable, Generator
from contextlib import asynccontextmanager, nullcontext
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal, Self
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, FastAPI, Header, Path, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker
from starlette.exceptions import HTTPException as StarletteHTTPException

from capability_lab.application.agent_configurations import (
    AgentConfigurationNotFoundError,
    AgentConfigurationNotPublishableError,
    AgentConfigurationService,
    AgentConfigurationVersionNotFoundError,
)
from capability_lab.application.agent_runtime import (
    SupportAgentRuntimeRegistry,
    SupportAgentUnavailableError,
)
from capability_lab.application.blocks import (
    BlockNameExistsError,
    MutationBlockNotFoundError,
    MutationBlockNotPublishableError,
    MutationBlockService,
    MutationBlockVersionNotFoundError,
    ObjectiveBlockNotFoundError,
    ObjectiveBlockNotPublishableError,
    ObjectiveBlockService,
    ObjectiveBlockVersionNotFoundError,
)
from capability_lab.application.conversations import (
    AgentExecutionError,
    AgentFrameworkNotFoundError,
    AgentRegistry,
    AgentTransientError,
    ConversationConflictError,
    ConversationNotFoundError,
    ConversationService,
    FrameworkDeclaration,
    InvalidConversationMessageError,
)
from capability_lab.application.customer_profiles import (
    CustomerProfileNotFoundError,
    CustomerProfileNotPublishableError,
    CustomerProfileService,
    CustomerProfileVersionNotFoundError,
)
from capability_lab.application.definition_authoring import DefinitionNotPublishableError
from capability_lab.application.definition_resolution import (
    MissingDraftError,
    PublishedVersionExistsError,
    UnpublishedReferenceError,
)
from capability_lab.application.evaluation import ExperimentEvaluationService
from capability_lab.application.experiment_annotations import (
    ExperimentAnnotationService,
    ExperimentTagConflictError,
)
from capability_lab.application.experiment_history import ExperimentHistoryService
from capability_lab.application.experiment_runs import ExperimentRunner
from capability_lab.application.experiment_timeline import ExperimentTimelineService
from capability_lab.application.experiments import (
    ExperimentArmError,
    ExperimentCompletedError,
    ExperimentLabelError,
    ExperimentNotFoundError,
    ExperimentNotStartableError,
    ExperimentRunNotFoundError,
    ExperimentService,
    ParticipantDriverMismatchError,
)
from capability_lab.application.judge_configurations import (
    JudgeConfigurationNotFoundError,
    JudgeConfigurationNotPublishableError,
    JudgeConfigurationService,
    JudgeConfigurationVersionNotFoundError,
)
from capability_lab.application.judge_runs import ExperimentJudgeService, JudgeUnpublishedError
from capability_lab.application.judge_runtime import JudgeRuntimeRegistry, JudgeUnavailableError
from capability_lab.application.judgements import JudgementConflictError
from capability_lab.application.order_actions import (
    ActionConfirmationError,
    ActionConflictError,
    ActionProposal,
    ActionProposalNotFoundError,
    ActionRefusedError,
    ActionTransientError,
    OrderActionService,
)
from capability_lab.application.order_fixtures import (
    OrderFixtureNotFoundError,
    OrderFixtureService,
    OrderReferenceExistsError,
    OrderSelectionError,
)
from capability_lab.application.participants import ParticipantTurnUnavailableError
from capability_lab.application.ports import Clock, ConversationTurn, OrderWriteConflictError
from capability_lab.application.sandbox_actions import SandboxActionService
from capability_lab.application.sandbox_materialization import (
    SandboxNotMaterializableError,
    SandboxSnapshotNotFoundError,
    SandboxSnapshotService,
)
from capability_lab.application.sandbox_tools import (
    SandboxToolService,
    ToolActorRequiredError,
    ToolNotFoundError,
)
from capability_lab.application.sandboxes import (
    SandboxLabelError,
    SandboxNotFoundError,
    SandboxService,
)
from capability_lab.application.scenario_generation import (
    GeneratedScenario,
    GeneratedScenarioDeletedError,
    GeneratedScenarioNotFoundError,
    IdempotencyConflictError,
    IdempotencyStateNotFoundError,
    InvalidIdempotencyKeyError,
    ScenarioGenerationKernel,
    ScenarioGenerationService,
    ScenarioGeneratorNotConfiguredError,
    create_retail_profile_kernel,
)
from capability_lab.application.scenario_mutations import ScenarioMutationRuntime
from capability_lab.application.scenario_registry import ScenarioNotFoundError
from capability_lab.application.scenarios import (
    ScenarioNameExistsError,
    ScenarioNotPublishableError,
    ScenarioService,
    ScenarioTicketChangeError,
    ScenarioTicketNotInShopError,
)
from capability_lab.application.scenarios import (
    # Aliased: the POC's `scenario_registry` still owns the unqualified names, and the two
    # resources are unrelated — one is a hard-coded generated scenario, the other the
    # authored definition. They are renamed here rather than in the module they belong to.
    ScenarioNotFoundError as ScenarioDefinitionNotFoundError,
)
from capability_lab.application.scenarios import (
    ScenarioVersionNotFoundError as ScenarioDefinitionVersionNotFoundError,
)
from capability_lab.application.shops import (
    ShopNotFoundError,
    ShopNotPublishableError,
    ShopService,
    ShopVersionNotFoundError,
)
from capability_lab.application.support_identities import (
    SupportIdentityNotFoundError,
    SupportIdentityNotPublishableError,
    SupportIdentityService,
    SupportIdentityVersionNotFoundError,
)
from capability_lab.application.tickets import (
    TicketCustomerChangeError,
    TicketCustomerNotInShopError,
    TicketNotFoundError,
    TicketNotPublishableError,
    TicketReferenceExistsError,
    TicketService,
    TicketVersionNotFoundError,
)
from capability_lab.domain.agent_configuration import AgentConfigurationError
from capability_lab.domain.blocks import BlockConfigurationError
from capability_lab.domain.customer_profile import CustomerProfileConfigurationError
from capability_lab.domain.definitions import DefinitionLifecycleError
from capability_lab.domain.entities import MAX_SCENARIO_SEED, ConversationSession
from capability_lab.domain.experiment import ExperimentConfigurationError
from capability_lab.domain.judge import JudgeConfigurationError
from capability_lab.domain.order_fixture import (
    OrderFixtureConfigurationError,
    OrderTransitionError,
)
from capability_lab.domain.scenario import ScenarioConfigurationError
from capability_lab.domain.shop import ShopConfigurationError
from capability_lab.domain.support_identity import SupportIdentityConfigurationError
from capability_lab.domain.ticket import TicketConfigurationError
from capability_lab.infrastructure.agents.registry import (
    create_agent_registry,
    create_judge_runtimes,
    create_support_agent_runtimes,
)
from capability_lab.infrastructure.clock import SystemClock
from capability_lab.infrastructure.config import Settings, get_settings
from capability_lab.infrastructure.database import (
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.participants.human import HumanParticipantDriver
from capability_lab.infrastructure.repositories import (
    ConversationTurnConflictError,
    GeneratedScenarioConflictError,
    PersistedDefinitionIntegrityError,
    PersistedScenarioIntegrityError,
    SqlAlchemyActionDecisionIdempotencyRepository,
    SqlAlchemyActionProposalRepository,
    SqlAlchemyAgentTurnRepository,
    SqlAlchemyConversationTurnRepository,
    SqlAlchemyDefinitionShopAttachmentRepository,
    SqlAlchemyExperimentAnnotationRepository,
    SqlAlchemyExperimentRepository,
    SqlAlchemyExperimentRunRepository,
    SqlAlchemyGeneratedScenarioRepository,
    SqlAlchemyJudgementRepository,
    SqlAlchemyMutationEventRepository,
    SqlAlchemyOrderFixtureRepository,
    SqlAlchemyOrderRepository,
    SqlAlchemyParticipantTurnRepository,
    SqlAlchemyPublishedVersionDirectory,
    SqlAlchemySandboxActionProposalRepository,
    SqlAlchemySandboxRepository,
    SqlAlchemySandboxSnapshotRepository,
    SqlAlchemyScenarioGenerationIdempotencyRepository,
    SqlAlchemySessionRepository,
    SqlAlchemyShopDirectory,
    SqlAlchemyToolEventRepository,
    agent_configuration_repository,
    customer_profile_repository,
    judge_configuration_repository,
    mutation_block_repository,
    objective_block_repository,
    scenario_repository,
    shop_repository,
    support_identity_repository,
    ticket_repository,
)
from capability_lab.infrastructure.telemetry import Telemetry, create_telemetry
from capability_lab.presentation.agent_configurations import AgentConfigurationRoutes
from capability_lab.presentation.base import ErrorResponse, StrictApiModel, ValidationIssue
from capability_lab.presentation.blocks import MutationBlockRoutes, ObjectiveBlockRoutes
from capability_lab.presentation.customer_profiles import CustomerProfileRoutes
from capability_lab.presentation.definitions import DefinitionIssueSchema
from capability_lab.presentation.experiments import ExperimentRoutes
from capability_lab.presentation.history import ExperimentHistoryRoutes
from capability_lab.presentation.judge_configurations import JudgeConfigurationRoutes
from capability_lab.presentation.orders import OrderRoutes
from capability_lab.presentation.sandboxes import SandboxRoutes
from capability_lab.presentation.scenarios import ScenarioRoutes
from capability_lab.presentation.shops import ShopRoutes
from capability_lab.presentation.snapshots import SandboxSnapshotRoutes
from capability_lab.presentation.support_identities import SupportIdentityRoutes
from capability_lab.presentation.tickets import TicketRoutes
from capability_lab.presentation.tools import SandboxToolRoutes

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


class StartConversationRequest(StrictApiModel):
    scenario_id: str = Field(
        min_length=1,
        max_length=64,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
    )
    scenario_version: str = Field(min_length=2, max_length=64, pattern=r"^v[1-9][0-9]*$")
    seed: int = Field(ge=0, le=MAX_SCENARIO_SEED)
    framework_id: str = Field(min_length=1, max_length=64)


class SendConversationMessageRequest(StrictApiModel):
    message: str = Field(min_length=1, max_length=4000)


class ProposeOrderActionRequest(StrictApiModel):
    action_type: Literal["cancel_order"]
    order_id: UUID
    expected_version: int = Field(ge=1)


class DecideOrderActionRequest(StrictApiModel):
    decision: Literal["confirm", "cancel"]
    confirmation_token: str | None = Field(default=None, min_length=64, max_length=64)


class ActionProposalResponse(StrictApiModel):
    id: UUID
    session_id: UUID
    action_type: Literal["cancel_order"]
    tool_name: Literal["cancel_order"]
    tool_version: Literal["v1"]
    order_id: UUID
    expected_version: int
    summary: str
    confirmation_token: str
    status: Literal["proposed", "confirmed", "cancelled", "executed"]
    attempts: int
    result_order_status: Literal["cancelled"] | None
    result_order_version: int | None
    trace_id: str | None = None

    @classmethod
    def from_proposal(cls, proposal: ActionProposal, trace_id: str | None = None) -> Self:
        if proposal.result_order_status not in (None, "cancelled"):
            raise ValueError("persisted action result has an unsupported order status")
        result_order_status: Literal["cancelled"] | None = (
            "cancelled" if proposal.result_order_status == "cancelled" else None
        )
        return cls(
            id=proposal.id,
            session_id=proposal.session_id,
            action_type="cancel_order",
            tool_name="cancel_order",
            tool_version="v1",
            order_id=proposal.order_id,
            expected_version=proposal.expected_version,
            summary=proposal.summary,
            confirmation_token=proposal.confirmation_token,
            status=proposal.status.value,
            attempts=proposal.attempts,
            result_order_status=result_order_status,
            result_order_version=proposal.result_order_version,
            trace_id=trace_id,
        )


class AgentFrameworkResponse(StrictApiModel):
    framework_id: str
    available: bool
    model_id: str | None
    capabilities: list[str]
    unavailability_reason: str | None = None

    @classmethod
    def from_declaration(cls, declaration: FrameworkDeclaration) -> Self:
        return cls(
            framework_id=declaration.framework_id,
            available=declaration.available,
            model_id=declaration.model_id,
            capabilities=list(declaration.capabilities),
            unavailability_reason=declaration.unavailability_reason,
        )


class AgentFrameworkListResponse(StrictApiModel):
    frameworks: list[AgentFrameworkResponse]


class ToolActivityResponse(StrictApiModel):
    tool_name: str
    tool_version: str
    outcome: str
    result: dict[str, object]


class StructuredSupportResultResponse(StrictApiModel):
    summary: str
    customer_id: UUID
    product_ids: list[UUID]
    order_ids: list[UUID]


class ConversationTurnResponse(StrictApiModel):
    id: UUID
    ordinal: int
    request_message: str
    response_message: str
    structured_result: StructuredSupportResultResponse
    tool_activity: list[ToolActivityResponse]
    trace_id: str | None
    created_at: datetime

    @classmethod
    def from_turn(cls, turn: ConversationTurn) -> Self:
        result = turn.response.structured_result
        return cls(
            id=turn.id,
            ordinal=turn.ordinal,
            request_message=turn.request_message,
            response_message=turn.response.message,
            structured_result=StructuredSupportResultResponse(
                summary=result.summary,
                customer_id=result.customer_id,
                product_ids=list(result.product_ids),
                order_ids=list(result.order_ids),
            ),
            tool_activity=[
                ToolActivityResponse(
                    tool_name=activity.tool_name,
                    tool_version=activity.tool_version,
                    outcome=activity.outcome,
                    result=activity.result,
                )
                for activity in turn.response.tool_activity
            ],
            trace_id=turn.response.trace_id,
            created_at=turn.created_at,
        )


class ConversationResponse(StrictApiModel):
    id: UUID
    customer_id: UUID
    scenario_id: str
    scenario_version: str
    seed: int
    framework_id: str
    initial_state_hash: str
    created_at: datetime
    turns: list[ConversationTurnResponse]

    @classmethod
    def from_conversation(
        cls,
        value: tuple[ConversationSession, list[ConversationTurn]],
    ) -> Self:
        session_value, turns = value
        return cls(
            id=session_value.id,
            customer_id=session_value.customer_id,
            scenario_id=session_value.scenario_id,
            scenario_version=session_value.scenario_version,
            seed=session_value.seed,
            framework_id=session_value.framework_id,
            initial_state_hash=session_value.initial_state_hash,
            created_at=session_value.created_at,
            turns=[ConversationTurnResponse.from_turn(turn) for turn in turns],
        )


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


async def _generated_scenario_deleted_handler(request: Request, _error: Exception) -> JSONResponse:
    return _error_response(
        request,
        status_code=409,
        code="generated_scenario_deleted",
        message="The generated persona was permanently deleted and cannot be recreated",
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


async def _conversation_not_found_handler(request: Request, _error: Exception) -> JSONResponse:
    return _error_response(
        request,
        status_code=404,
        code="conversation_not_found",
        message="The conversation or its generated scenario state was not found",
    )


async def _agent_framework_not_found_handler(request: Request, _error: Exception) -> JSONResponse:
    return _error_response(
        request,
        status_code=422,
        code="agent_framework_unavailable",
        message="The requested agent framework is unavailable",
    )


async def _conversation_conflict_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request,
        status_code=409,
        code="conversation_conflict",
        message=str(error),
    )


async def _conversation_turn_conflict_handler(
    request: Request,
    _error: Exception,
) -> JSONResponse:
    return _error_response(
        request,
        status_code=409,
        code="conversation_advanced",
        message="The conversation advanced before this message could be persisted; retry it",
    )


async def _invalid_conversation_message_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request,
        status_code=422,
        code="validation_error",
        message=str(error),
    )


async def _agent_execution_error_handler(request: Request, error: Exception) -> JSONResponse:
    if not isinstance(error, AgentExecutionError):
        raise TypeError("agent error handler received an unexpected exception")
    return _error_response(
        request,
        status_code=503 if isinstance(error, AgentTransientError) else 502,
        code=error.code,
        message=str(error),
    )


async def _action_not_found_handler(request: Request, _error: Exception) -> JSONResponse:
    return _error_response(
        request,
        status_code=404,
        code="action_not_found",
        message="The action proposal or scoped order was not found",
    )


async def _action_conflict_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request,
        status_code=409,
        code="action_conflict",
        message=str(error),
    )


async def _action_confirmation_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request,
        status_code=422,
        code="action_confirmation_required",
        message=str(error),
    )


async def _action_refused_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request,
        status_code=422,
        code="action_refused",
        message=str(error),
    )


async def _action_transient_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request,
        status_code=503,
        code="action_transient_error",
        message=str(error),
    )


async def _shop_not_found_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request,
        status_code=404,
        code="shop_not_found",
        message=str(error),
    )


async def _shop_version_not_found_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request,
        status_code=404,
        code="shop_version_not_found",
        message=str(error),
    )


_NOT_PUBLISHABLE_CODES: dict[type[DefinitionNotPublishableError], str] = {
    ShopNotPublishableError: "shop_not_publishable",
    CustomerProfileNotPublishableError: "customer_profile_not_publishable",
    SupportIdentityNotPublishableError: "support_identity_not_publishable",
    TicketNotPublishableError: "ticket_not_publishable",
    ObjectiveBlockNotPublishableError: "objective_block_not_publishable",
    MutationBlockNotPublishableError: "mutation_block_not_publishable",
    ScenarioNotPublishableError: "scenario_not_publishable",
    AgentConfigurationNotPublishableError: "agent_configuration_not_publishable",
    JudgeConfigurationNotPublishableError: "judge_configuration_not_publishable",
}


async def _not_publishable_handler(request: Request, error: Exception) -> JSONResponse:
    """Refuse publication with the exact publish-gate findings, not a bare 422."""
    issues = (
        [DefinitionIssueSchema.from_domain(issue).model_dump() for issue in error.validation.issues]
        if isinstance(error, DefinitionNotPublishableError)
        else []
    )
    code = (
        _NOT_PUBLISHABLE_CODES.get(type(error), "definition_not_publishable")
        if isinstance(error, DefinitionNotPublishableError)
        else "definition_not_publishable"
    )
    request_id = _request_id(request)
    return JSONResponse(
        status_code=422,
        content={
            "code": code,
            "message": str(error),
            "request_id": request_id,
            "issues": issues,
        },
        headers={"X-Request-ID": request_id},
    )


async def _sandbox_snapshot_not_found_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request, status_code=404, code="sandbox_snapshot_not_found", message=str(error)
    )


async def _sandbox_not_found_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(request, status_code=404, code="sandbox_not_found", message=str(error))


async def _tool_not_found_handler(request: Request, error: Exception) -> JSONResponse:
    """An unknown tool name is a contract mistake, never a refusal the agent should see."""
    return _error_response(request, status_code=404, code="tool_not_found", message=str(error))


async def _tool_actor_required_handler(request: Request, error: Exception) -> JSONResponse:
    """A write offered with nobody acting is the caller's mistake, not the agent's.

    422 rather than a refusal for the same reason an unknown tool name is a 404: the actor is
    not model output, so getting it wrong is a client that built the call badly rather than an
    agent asking something the world declines.
    """
    return _error_response(request, status_code=422, code="tool_actor_required", message=str(error))


async def _sandbox_label_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request, status_code=422, code="sandbox_label_invalid", message=str(error)
    )


async def _sandbox_not_materializable_handler(request: Request, error: Exception) -> JSONResponse:
    """Refuse the freeze with the findings that explain it, exactly as a publish refusal does.

    A snapshot is refused for the same reasons a publication is — a reference nothing answers
    — so an operator reads one shape of finding whichever gate refused them.
    """
    issues = (
        [DefinitionIssueSchema.from_domain(issue).model_dump() for issue in error.validation.issues]
        if isinstance(error, SandboxNotMaterializableError)
        else []
    )
    request_id = _request_id(request)
    return JSONResponse(
        status_code=422,
        content={
            "code": "sandbox_not_materializable",
            "message": str(error),
            "request_id": request_id,
            "issues": issues,
        },
        headers={"X-Request-ID": request_id},
    )


async def _experiment_configuration_handler(request: Request, error: Exception) -> JSONResponse:
    """A turn or an experiment the domain will not build, whoever asked for it.

    The backstop every other resource has. A human driver trims what the operator typed, but
    a driver is a port: the next implementation may return a body this rule refuses, and that
    has to reach the caller as a refusal rather than as a broken lab.
    """
    return _error_response(
        request, status_code=422, code="experiment_configuration_error", message=str(error)
    )


async def _experiment_not_found_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request, status_code=404, code="experiment_not_found", message=str(error)
    )


async def _experiment_run_not_found_handler(request: Request, error: Exception) -> JSONResponse:
    """An arm this experiment does not have is a 404 on the arm, not on the experiment.

    A client delivering a turn to the wrong run has to be able to tell that from an
    experiment that is gone; collapsing the two would have it retry against a thread that
    was never there.
    """
    return _error_response(
        request, status_code=404, code="experiment_run_not_found", message=str(error)
    )


async def _experiment_setup_handler(request: Request, error: Exception) -> JSONResponse:
    """The operator's setup is not runnable as stated, before any state has been frozen."""
    return _error_response(
        request, status_code=422, code="experiment_setup_invalid", message=str(error)
    )


async def _experiment_completed_handler(request: Request, error: Exception) -> JSONResponse:
    """This arm has answered every turn its scenario allows.

    Its own code rather than the setup one: nothing about the experiment is invalid, and the
    client's next move is to read the arm rather than to correct what it sent.
    """
    return _error_response(
        request, status_code=422, code="experiment_completed", message=str(error)
    )


async def _participant_turn_handler(request: Request, error: Exception) -> JSONResponse:
    """The driver had nothing to deliver.

    422 rather than a conflict: nothing raced. The request asked for a turn that does not
    exist yet, and the run is exactly where it was.
    """
    return _error_response(
        request, status_code=422, code="participant_turn_unavailable", message=str(error)
    )


async def _participant_driver_mismatch_handler(request: Request, error: Exception) -> JSONResponse:
    """The driver offering this turn is not the one the experiment recorded.

    Its own code rather than the unavailable one beside it: "write something first" and "you
    are driving this run with the wrong participant" are different mistakes, and a client that
    could not tell them apart would retry the second one forever.
    """
    return _error_response(
        request, status_code=422, code="participant_driver_mismatch", message=str(error)
    )


async def _agent_runtime_unavailable_handler(request: Request, error: Exception) -> JSONResponse:
    """This lab cannot run the framework this arm was published against.

    422 and never a recorded turn. A missing provider key is a fact about the process, not
    something the agent did, so writing it into the run's evidence would put the operator's
    machine into a comparison — the same reason the proven-capability catalog is kept apart
    from the adapter registry (ADR 0024).
    """
    return _error_response(
        request, status_code=422, code="agent_runtime_unavailable", message=str(error)
    )


async def _experiment_not_startable_handler(request: Request, error: Exception) -> JSONResponse:
    """Refuse the start with the findings that explain it, as a publish refusal does.

    Same shape as the materialization refusal beside it, and for the same reason: an
    operator reads one kind of finding whichever gate refused them.
    """
    issues = (
        [DefinitionIssueSchema.from_domain(issue).model_dump() for issue in error.validation.issues]
        if isinstance(error, ExperimentNotStartableError)
        else []
    )
    request_id = _request_id(request)
    return JSONResponse(
        status_code=422,
        content={
            "code": "experiment_not_startable",
            "message": str(error),
            "request_id": request_id,
            "issues": issues,
        },
        headers={"X-Request-ID": request_id},
    )


async def _missing_draft_handler(request: Request, error: Exception) -> JSONResponse:
    """Reference resolution asked for a draft that does not exist.

    Per-resource authoring answers its own not-found code; this covers the shared
    resolution path, which has no resource of its own to name.
    """
    return _error_response(
        request, status_code=404, code="definition_draft_missing", message=str(error)
    )


async def _customer_profile_not_found_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request, status_code=404, code="customer_profile_not_found", message=str(error)
    )


async def _customer_profile_version_not_found_handler(
    request: Request, error: Exception
) -> JSONResponse:
    return _error_response(
        request, status_code=404, code="customer_profile_version_not_found", message=str(error)
    )


async def _customer_profile_configuration_handler(
    request: Request, error: Exception
) -> JSONResponse:
    """A structural profile invariant the contract cannot express in a field schema."""
    return _error_response(
        request, status_code=422, code="customer_profile_configuration_error", message=str(error)
    )


async def _support_identity_not_found_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request, status_code=404, code="support_identity_not_found", message=str(error)
    )


async def _support_identity_version_not_found_handler(
    request: Request, error: Exception
) -> JSONResponse:
    return _error_response(
        request, status_code=404, code="support_identity_version_not_found", message=str(error)
    )


async def _support_identity_configuration_handler(
    request: Request, error: Exception
) -> JSONResponse:
    return _error_response(
        request, status_code=422, code="support_identity_configuration_error", message=str(error)
    )


async def _agent_configuration_not_found_handler(
    request: Request, error: Exception
) -> JSONResponse:
    return _error_response(
        request, status_code=404, code="agent_configuration_not_found", message=str(error)
    )


async def _agent_configuration_version_not_found_handler(
    request: Request, error: Exception
) -> JSONResponse:
    return _error_response(
        request,
        status_code=404,
        code="agent_configuration_version_not_found",
        message=str(error),
    )


async def _agent_configuration_handler(request: Request, error: Exception) -> JSONResponse:
    """A structural configuration invariant the contract cannot express in a field schema."""
    return _error_response(
        request, status_code=422, code="agent_configuration_error", message=str(error)
    )


async def _judge_configuration_not_found_handler(
    request: Request, error: Exception
) -> JSONResponse:
    return _error_response(
        request, status_code=404, code="judge_configuration_not_found", message=str(error)
    )


async def _judge_configuration_version_not_found_handler(
    request: Request, error: Exception
) -> JSONResponse:
    return _error_response(
        request,
        status_code=404,
        code="judge_configuration_version_not_found",
        message=str(error),
    )


async def _judge_unpublished_handler(request: Request, error: Exception) -> JSONResponse:
    """A judge asked to score before it was ever published.

    422 rather than 404: the judge exists, and what is missing is the frozen version a
    verdict has to name to stay explainable (ADR 0031). Registered beside the version
    handler it derives from, so the more specific one answers this case.
    """
    return _error_response(
        request, status_code=422, code="judge_configuration_unpublished", message=str(error)
    )


async def _judge_configuration_handler(request: Request, error: Exception) -> JSONResponse:
    """A structural judge invariant the contract cannot express in a field schema."""
    return _error_response(
        request, status_code=422, code="judge_configuration_error", message=str(error)
    )


async def _judgement_conflict_handler(request: Request, error: Exception) -> JSONResponse:
    """Another pass wrote the attempt this one numbered.

    409 rather than 500: the store refused to overwrite a verdict, which is what it is for,
    and the operator's move is to read the evaluation and score again (ADR 0031).
    """
    return _error_response(request, status_code=409, code="judgement_conflict", message=str(error))


async def _experiment_tag_conflict_handler(request: Request, error: Exception) -> JSONResponse:
    """Another request replaced this run's tags while this one was replacing them.

    409 rather than 500: the store refused to file one run under one shelf twice, which is
    what the key is for, and the operator's move is to read the chips and set them again —
    which is safe, because setting a tag set is idempotent (ADR 0036).
    """
    return _error_response(
        request, status_code=409, code="experiment_tag_conflict", message=str(error)
    )


async def _judge_runtime_unavailable_handler(request: Request, error: Exception) -> JSONResponse:
    """This lab cannot reach the provider this judge was published against.

    422 and never a recorded judgement, for the reason an unrunnable framework is never a
    recorded turn: a missing provider key is a fact about the process, and an evaluation that
    recorded it would put the operator's machine into an arm's column.
    """
    return _error_response(
        request, status_code=422, code="judge_runtime_unavailable", message=str(error)
    )


async def _order_not_found_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(request, status_code=404, code="order_not_found", message=str(error))


async def _order_reference_exists_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request, status_code=409, code="order_reference_exists", message=str(error)
    )


async def _order_selection_handler(request: Request, error: Exception) -> JSONResponse:
    """An order selected catalog, method, or address content that does not exist.

    Selection is what keeps commerce data out of a client's hands, so an unresolvable
    selection is refused rather than stored and reported later as a finding.
    """
    return _error_response(
        request, status_code=422, code="order_selection_error", message=str(error)
    )


async def _order_transition_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request, status_code=422, code="order_transition_error", message=str(error)
    )


async def _order_configuration_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request, status_code=422, code="order_configuration_error", message=str(error)
    )


async def _objective_block_not_found_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request, status_code=404, code="objective_block_not_found", message=str(error)
    )


async def _objective_block_version_not_found_handler(
    request: Request, error: Exception
) -> JSONResponse:
    return _error_response(
        request, status_code=404, code="objective_block_version_not_found", message=str(error)
    )


async def _mutation_block_not_found_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request, status_code=404, code="mutation_block_not_found", message=str(error)
    )


async def _mutation_block_version_not_found_handler(
    request: Request, error: Exception
) -> JSONResponse:
    return _error_response(
        request, status_code=404, code="mutation_block_version_not_found", message=str(error)
    )


async def _block_name_exists_handler(request: Request, error: Exception) -> JSONResponse:
    """A block's name is how a scenario binds it, so the library keeps it unique."""
    return _error_response(request, status_code=409, code="block_name_exists", message=str(error))


async def _block_configuration_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request, status_code=422, code="block_configuration_error", message=str(error)
    )


async def _ticket_not_found_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(request, status_code=404, code="ticket_not_found", message=str(error))


async def _ticket_version_not_found_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request, status_code=404, code="ticket_version_not_found", message=str(error)
    )


async def _ticket_reference_exists_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request, status_code=409, code="ticket_reference_exists", message=str(error)
    )


async def _ticket_customer_handler(request: Request, error: Exception) -> JSONResponse:
    """A ticket named a customer this shop does not use, or tried to change its own."""
    return _error_response(
        request, status_code=422, code="ticket_customer_error", message=str(error)
    )


async def _ticket_configuration_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request, status_code=422, code="ticket_configuration_error", message=str(error)
    )


async def _scenario_definition_not_found_handler(
    request: Request, error: Exception
) -> JSONResponse:
    return _error_response(request, status_code=404, code="scenario_not_found", message=str(error))


async def _scenario_definition_version_not_found_handler(
    request: Request, error: Exception
) -> JSONResponse:
    return _error_response(
        request, status_code=404, code="scenario_version_not_found", message=str(error)
    )


async def _scenario_name_exists_handler(request: Request, error: Exception) -> JSONResponse:
    """The scenario index is the one place a human picks a recipe by reading it."""
    return _error_response(
        request, status_code=409, code="scenario_name_exists", message=str(error)
    )


async def _scenario_ticket_handler(request: Request, error: Exception) -> JSONResponse:
    """A scenario named a ticket this shop does not hold, or tried to move to another."""
    return _error_response(
        request, status_code=422, code="scenario_ticket_error", message=str(error)
    )


async def _scenario_configuration_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request, status_code=422, code="scenario_configuration_error", message=str(error)
    )


async def _unpublished_reference_handler(request: Request, error: Exception) -> JSONResponse:
    """Publishing pins exact versions, so an unpublished target stops the publication."""
    return _error_response(
        request, status_code=422, code="definition_reference_unpublished", message=str(error)
    )


async def _definition_lifecycle_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request,
        status_code=422,
        code="definition_lifecycle_error",
        message=str(error),
    )


async def _shop_configuration_handler(request: Request, error: Exception) -> JSONResponse:
    """A structural shop invariant the contract cannot express in a field schema."""
    return _error_response(
        request,
        status_code=422,
        code="shop_configuration_error",
        message=str(error),
    )


async def _published_version_exists_handler(request: Request, error: Exception) -> JSONResponse:
    return _error_response(
        request,
        status_code=409,
        code="published_version_exists",
        message=str(error),
    )


def health() -> HealthResponse:
    return HealthResponse(status="ok", api_version="v1")


def create_app(
    settings: Settings | None = None,
    *,
    session_factory: sessionmaker[Session] | None = None,
    generation_kernel: ScenarioGenerationKernel | None = None,
    command_clock: Clock | None = None,
    agent_registry: AgentRegistry | None = None,
    agent_runtimes: SupportAgentRuntimeRegistry | None = None,
    judge_runtimes: JudgeRuntimeRegistry | None = None,
    telemetry: Telemetry | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    if session_factory is None:
        engine = create_database_engine(settings.database_url)
        session_factory = create_session_factory(engine)
    factory = session_factory
    clock = command_clock or SystemClock()
    kernel = generation_kernel or create_retail_profile_kernel(clock)
    configured_telemetry = telemetry
    if agent_registry is None:
        configured_telemetry = configured_telemetry or create_telemetry(settings)
        agents = create_agent_registry(settings, configured_telemetry)
    else:
        agents = agent_registry
    # Composition selects which frameworks can run an arm, the way it selects which can serve
    # a conversation (`docs/architecture.md`). A test that wants one arm to fail supplies its
    # own registry here rather than reaching into the runner.
    runtimes = agent_runtimes or create_support_agent_runtimes(settings)
    # The same choice, one port over: a test that wants a judge to fail supplies its own
    # registry here rather than reaching into the scoring service.
    judges = judge_runtimes or create_judge_runtimes(settings)

    @asynccontextmanager
    async def lifespan(_application: FastAPI) -> AsyncGenerator[None]:
        try:
            yield
        finally:
            if configured_telemetry is not None:
                configured_telemetry.shutdown()

    application = FastAPI(title=API_TITLE, version=API_VERSION, lifespan=lifespan)
    application.middleware("http")(_add_request_id)
    application.add_exception_handler(RequestValidationError, _validation_error_handler)
    application.add_exception_handler(ScenarioNotFoundError, _scenario_not_found_handler)
    application.add_exception_handler(
        GeneratedScenarioNotFoundError,
        _generated_scenario_not_found_handler,
    )
    application.add_exception_handler(
        GeneratedScenarioDeletedError,
        _generated_scenario_deleted_handler,
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
    application.add_exception_handler(ConversationNotFoundError, _conversation_not_found_handler)
    application.add_exception_handler(
        AgentFrameworkNotFoundError,
        _agent_framework_not_found_handler,
    )
    application.add_exception_handler(ConversationConflictError, _conversation_conflict_handler)
    application.add_exception_handler(
        ConversationTurnConflictError,
        _conversation_turn_conflict_handler,
    )
    application.add_exception_handler(
        InvalidConversationMessageError,
        _invalid_conversation_message_handler,
    )
    application.add_exception_handler(AgentExecutionError, _agent_execution_error_handler)
    application.add_exception_handler(ActionProposalNotFoundError, _action_not_found_handler)
    application.add_exception_handler(ActionConflictError, _action_conflict_handler)
    application.add_exception_handler(OrderWriteConflictError, _action_conflict_handler)
    application.add_exception_handler(ActionConfirmationError, _action_confirmation_handler)
    application.add_exception_handler(ActionRefusedError, _action_refused_handler)
    application.add_exception_handler(ActionTransientError, _action_transient_handler)
    application.add_exception_handler(PersistedScenarioIntegrityError, _internal_error_handler)
    application.add_exception_handler(PersistedDefinitionIntegrityError, _internal_error_handler)
    application.add_exception_handler(IdempotencyStateNotFoundError, _internal_error_handler)
    application.add_exception_handler(ShopNotFoundError, _shop_not_found_handler)
    application.add_exception_handler(ShopVersionNotFoundError, _shop_version_not_found_handler)
    application.add_exception_handler(DefinitionNotPublishableError, _not_publishable_handler)
    application.add_exception_handler(
        CustomerProfileNotFoundError, _customer_profile_not_found_handler
    )
    application.add_exception_handler(
        CustomerProfileVersionNotFoundError, _customer_profile_version_not_found_handler
    )
    application.add_exception_handler(
        CustomerProfileConfigurationError, _customer_profile_configuration_handler
    )
    application.add_exception_handler(
        SupportIdentityNotFoundError, _support_identity_not_found_handler
    )
    application.add_exception_handler(
        SupportIdentityVersionNotFoundError, _support_identity_version_not_found_handler
    )
    application.add_exception_handler(
        SupportIdentityConfigurationError, _support_identity_configuration_handler
    )
    application.add_exception_handler(
        AgentConfigurationNotFoundError, _agent_configuration_not_found_handler
    )
    application.add_exception_handler(
        AgentConfigurationVersionNotFoundError, _agent_configuration_version_not_found_handler
    )
    application.add_exception_handler(AgentConfigurationError, _agent_configuration_handler)
    application.add_exception_handler(
        JudgeConfigurationNotFoundError, _judge_configuration_not_found_handler
    )
    application.add_exception_handler(
        JudgeConfigurationVersionNotFoundError, _judge_configuration_version_not_found_handler
    )
    application.add_exception_handler(JudgeUnpublishedError, _judge_unpublished_handler)
    application.add_exception_handler(JudgeConfigurationError, _judge_configuration_handler)
    application.add_exception_handler(JudgeUnavailableError, _judge_runtime_unavailable_handler)
    application.add_exception_handler(JudgementConflictError, _judgement_conflict_handler)
    application.add_exception_handler(ExperimentTagConflictError, _experiment_tag_conflict_handler)
    application.add_exception_handler(
        PublishedVersionExistsError, _published_version_exists_handler
    )
    application.add_exception_handler(OrderFixtureNotFoundError, _order_not_found_handler)
    application.add_exception_handler(OrderReferenceExistsError, _order_reference_exists_handler)
    application.add_exception_handler(OrderSelectionError, _order_selection_handler)
    application.add_exception_handler(OrderTransitionError, _order_transition_handler)
    application.add_exception_handler(OrderFixtureConfigurationError, _order_configuration_handler)
    application.add_exception_handler(
        ObjectiveBlockNotFoundError, _objective_block_not_found_handler
    )
    application.add_exception_handler(
        ObjectiveBlockVersionNotFoundError, _objective_block_version_not_found_handler
    )
    application.add_exception_handler(MutationBlockNotFoundError, _mutation_block_not_found_handler)
    application.add_exception_handler(
        MutationBlockVersionNotFoundError, _mutation_block_version_not_found_handler
    )
    application.add_exception_handler(BlockNameExistsError, _block_name_exists_handler)
    application.add_exception_handler(BlockConfigurationError, _block_configuration_handler)
    application.add_exception_handler(TicketNotFoundError, _ticket_not_found_handler)
    application.add_exception_handler(TicketVersionNotFoundError, _ticket_version_not_found_handler)
    application.add_exception_handler(TicketReferenceExistsError, _ticket_reference_exists_handler)
    application.add_exception_handler(TicketCustomerNotInShopError, _ticket_customer_handler)
    application.add_exception_handler(TicketCustomerChangeError, _ticket_customer_handler)
    application.add_exception_handler(TicketConfigurationError, _ticket_configuration_handler)
    application.add_exception_handler(
        ScenarioDefinitionNotFoundError, _scenario_definition_not_found_handler
    )
    application.add_exception_handler(
        ScenarioDefinitionVersionNotFoundError, _scenario_definition_version_not_found_handler
    )
    application.add_exception_handler(ScenarioNameExistsError, _scenario_name_exists_handler)
    application.add_exception_handler(ScenarioTicketNotInShopError, _scenario_ticket_handler)
    application.add_exception_handler(ScenarioTicketChangeError, _scenario_ticket_handler)
    application.add_exception_handler(ScenarioConfigurationError, _scenario_configuration_handler)
    application.add_exception_handler(
        SandboxSnapshotNotFoundError, _sandbox_snapshot_not_found_handler
    )
    application.add_exception_handler(
        SandboxNotMaterializableError, _sandbox_not_materializable_handler
    )
    application.add_exception_handler(SandboxNotFoundError, _sandbox_not_found_handler)
    application.add_exception_handler(ExperimentNotFoundError, _experiment_not_found_handler)
    application.add_exception_handler(ExperimentRunNotFoundError, _experiment_run_not_found_handler)
    application.add_exception_handler(ExperimentLabelError, _experiment_setup_handler)
    application.add_exception_handler(ExperimentArmError, _experiment_setup_handler)
    application.add_exception_handler(ExperimentCompletedError, _experiment_completed_handler)
    application.add_exception_handler(
        ExperimentNotStartableError, _experiment_not_startable_handler
    )
    application.add_exception_handler(
        SupportAgentUnavailableError, _agent_runtime_unavailable_handler
    )
    application.add_exception_handler(
        ExperimentConfigurationError, _experiment_configuration_handler
    )
    application.add_exception_handler(
        ParticipantDriverMismatchError, _participant_driver_mismatch_handler
    )
    application.add_exception_handler(ParticipantTurnUnavailableError, _participant_turn_handler)
    application.add_exception_handler(SandboxLabelError, _sandbox_label_handler)
    application.add_exception_handler(ToolNotFoundError, _tool_not_found_handler)
    application.add_exception_handler(ToolActorRequiredError, _tool_actor_required_handler)
    application.add_exception_handler(UnpublishedReferenceError, _unpublished_reference_handler)
    application.add_exception_handler(MissingDraftError, _missing_draft_handler)
    application.add_exception_handler(DefinitionLifecycleError, _definition_lifecycle_handler)
    application.add_exception_handler(ShopConfigurationError, _shop_configuration_handler)
    application.add_exception_handler(ScenarioGeneratorNotConfiguredError, _internal_error_handler)
    application.add_exception_handler(SQLAlchemyError, _internal_error_handler)
    application.add_exception_handler(Exception, _internal_error_handler)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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

    def conversation_service() -> Generator[ConversationService, None, None]:
        with session_scope(factory) as session:
            yield ConversationService(
                SqlAlchemySessionRepository(session),
                SqlAlchemyConversationTurnRepository(session),
                SqlAlchemyGeneratedScenarioRepository(session),
                agents,
                clock,
                SqlAlchemyOrderRepository(session, clock),
            )

    def shop_service() -> Generator[ShopService, None, None]:
        with session_scope(factory) as session:
            yield ShopService(shop_repository(session), clock)

    def customer_profile_service() -> Generator[CustomerProfileService, None, None]:
        with session_scope(factory) as session:
            yield CustomerProfileService(
                customer_profile_repository(session),
                SqlAlchemyDefinitionShopAttachmentRepository(session),
                SqlAlchemyShopDirectory(session),
                clock,
            )

    def support_identity_service() -> Generator[SupportIdentityService, None, None]:
        with session_scope(factory) as session:
            yield SupportIdentityService(support_identity_repository(session), clock)

    def agent_configuration_service() -> Generator[AgentConfigurationService, None, None]:
        with session_scope(factory) as session:
            yield AgentConfigurationService(
                agent_configuration_repository(session),
                support_identity_repository(session),
                shop_repository(session),
                SqlAlchemyPublishedVersionDirectory(session),
                clock,
            )

    def judge_configuration_service() -> Generator[JudgeConfigurationService, None, None]:
        with session_scope(factory) as session:
            yield JudgeConfigurationService(judge_configuration_repository(session), clock)

    def objective_block_service() -> Generator[ObjectiveBlockService, None, None]:
        with session_scope(factory) as session:
            yield ObjectiveBlockService(objective_block_repository(session), clock)

    def mutation_block_service() -> Generator[MutationBlockService, None, None]:
        with session_scope(factory) as session:
            yield MutationBlockService(mutation_block_repository(session), clock)

    def order_service() -> Generator[OrderFixtureService, None, None]:
        with session_scope(factory) as session:
            yield OrderFixtureService(
                SqlAlchemyOrderFixtureRepository(session),
                shop_repository(session),
                customer_profile_repository(session),
                SqlAlchemyDefinitionShopAttachmentRepository(session),
                clock,
            )

    def ticket_service() -> Generator[TicketService, None, None]:
        with session_scope(factory) as session:
            yield TicketService(
                ticket_repository(session),
                shop_repository(session),
                customer_profile_repository(session),
                SqlAlchemyOrderFixtureRepository(session),
                SqlAlchemyDefinitionShopAttachmentRepository(session),
                SqlAlchemyPublishedVersionDirectory(session),
                clock,
            )

    def scenario_service() -> Generator[ScenarioService, None, None]:
        with session_scope(factory) as session:
            yield ScenarioService(
                scenario_repository(session),
                shop_repository(session),
                ticket_repository(session),
                customer_profile_repository(session),
                SqlAlchemyOrderFixtureRepository(session),
                objective_block_repository(session),
                mutation_block_repository(session),
                SqlAlchemyDefinitionShopAttachmentRepository(session),
                SqlAlchemyPublishedVersionDirectory(session),
                clock,
            )

    def sandbox_snapshot_service() -> Generator[SandboxSnapshotService, None, None]:
        with session_scope(factory) as session:
            yield SandboxSnapshotService(
                SqlAlchemySandboxSnapshotRepository(session),
                scenario_repository(session),
                shop_repository(session),
                ticket_repository(session),
                SqlAlchemyOrderFixtureRepository(session),
                objective_block_repository(session),
                mutation_block_repository(session),
                SqlAlchemyPublishedVersionDirectory(session),
                clock,
            )

    def sandbox_service() -> Generator[SandboxService, None, None]:
        with session_scope(factory) as session:
            yield SandboxService(
                SqlAlchemySandboxRepository(session),
                SqlAlchemySandboxSnapshotRepository(session),
                clock,
            )

    def build_scenario_mutations(session: Session) -> ScenarioMutationRuntime:
        """The fault schedule a scenario carries, and the arm it fires into.

        Built beside the experiment service rather than inside it: the setup gate asks it
        what this build can run, the runner asks it to fire, and both readings have to come
        from one table.
        """
        return ScenarioMutationRuntime(
            scenario_repository(session),
            mutation_block_repository(session),
            SandboxService(
                SqlAlchemySandboxRepository(session),
                SqlAlchemySandboxSnapshotRepository(session),
                clock,
            ),
            SqlAlchemyMutationEventRepository(session),
            clock,
        )

    def build_experiment_service(session: Session) -> ExperimentService:
        """One construction, read by the experiment routes and by the timeline over them."""
        return ExperimentService(
            SqlAlchemyExperimentRepository(session),
            SqlAlchemyExperimentRunRepository(session),
            SqlAlchemyParticipantTurnRepository(session),
            SqlAlchemyAgentTurnRepository(session),
            SqlAlchemyToolEventRepository(session),
            SandboxSnapshotService(
                SqlAlchemySandboxSnapshotRepository(session),
                scenario_repository(session),
                shop_repository(session),
                ticket_repository(session),
                SqlAlchemyOrderFixtureRepository(session),
                objective_block_repository(session),
                mutation_block_repository(session),
                SqlAlchemyPublishedVersionDirectory(session),
                clock,
            ),
            SandboxService(
                SqlAlchemySandboxRepository(session),
                SqlAlchemySandboxSnapshotRepository(session),
                clock,
            ),
            scenario_repository(session),
            shop_repository(session),
            ticket_repository(session),
            agent_configuration_repository(session),
            build_scenario_mutations(session),
            SqlAlchemyPublishedVersionDirectory(session),
            clock,
        )

    def experiment_service() -> Generator[ExperimentService, None, None]:
        with session_scope(factory) as session:
            yield build_experiment_service(session)

    def experiment_timeline_service() -> Generator[ExperimentTimelineService, None, None]:
        with session_scope(factory) as session:
            # The same runtime registry the runner is given: an attempt's source location is
            # the adapter that produced it, and only this process knows which are here.
            yield ExperimentTimelineService(build_experiment_service(session), runtimes)

    def build_evaluation_service(session: Session) -> ExperimentEvaluationService:
        # Over the same experiment construction the timeline reads, so an evaluation and a
        # thread can never disagree about what an arm did.
        return ExperimentEvaluationService(
            build_experiment_service(session),
            objective_block_repository(session),
            SqlAlchemyJudgementRepository(session),
        )

    def experiment_evaluation_service() -> Generator[ExperimentEvaluationService, None, None]:
        with session_scope(factory) as session:
            yield build_evaluation_service(session)

    def experiment_history_service() -> Generator[ExperimentHistoryService, None, None]:
        with session_scope(factory) as session:
            # Over the same experiment construction the evaluation is built on, so a history
            # row and the bench it opens are one reading of one record (ADR 0034).
            experiments = build_experiment_service(session)
            yield ExperimentHistoryService(
                SqlAlchemyExperimentRepository(session),
                experiments,
                ExperimentEvaluationService(
                    experiments,
                    objective_block_repository(session),
                    SqlAlchemyJudgementRepository(session),
                ),
                SqlAlchemyExperimentAnnotationRepository(session),
                shop_repository(session),
                scenario_repository(session),
            )

    def experiment_annotation_service() -> Generator[ExperimentAnnotationService, None, None]:
        with session_scope(factory) as session:
            # The experiment repository rather than the service that resolves one: writing a
            # note needs to know the run exists in this shop and nothing else (ADR 0036).
            yield ExperimentAnnotationService(
                SqlAlchemyExperimentRepository(session),
                SqlAlchemyExperimentAnnotationRepository(session),
                clock,
            )

    def experiment_judge_service() -> Generator[ExperimentJudgeService, None, None]:
        with session_scope(factory) as session:
            # One session for the pass and the reading it answers with: a verdict written in
            # one transaction and read back in another would answer with a matrix that does
            # not yet hold it (ADR 0031).
            yield ExperimentJudgeService(
                build_experiment_service(session),
                build_evaluation_service(session),
                objective_block_repository(session),
                judge_configuration_repository(session),
                SqlAlchemyJudgementRepository(session),
                judges,
                clock,
            )

    def experiment_runner() -> Generator[ExperimentRunner, None, None]:
        with session_scope(factory) as session:
            yield ExperimentRunner(
                SqlAlchemyExperimentRepository(session),
                SqlAlchemyExperimentRunRepository(session),
                SqlAlchemyParticipantTurnRepository(session),
                SqlAlchemyAgentTurnRepository(session),
                SqlAlchemyToolEventRepository(session),
                SandboxSnapshotService(
                    SqlAlchemySandboxSnapshotRepository(session),
                    scenario_repository(session),
                    shop_repository(session),
                    ticket_repository(session),
                    SqlAlchemyOrderFixtureRepository(session),
                    objective_block_repository(session),
                    mutation_block_repository(session),
                    SqlAlchemyPublishedVersionDirectory(session),
                    clock,
                ),
                SqlAlchemySandboxRepository(session),
                scenario_repository(session),
                shop_repository(session),
                support_identity_repository(session),
                agent_configuration_repository(session),
                SandboxToolService(
                    SqlAlchemySandboxRepository(session),
                    SqlAlchemySandboxSnapshotRepository(session),
                    shop_repository(session),
                    ticket_repository(session),
                    customer_profile_repository(session),
                    support_identity_repository(session),
                    SandboxActionService(
                        SandboxService(
                            SqlAlchemySandboxRepository(session),
                            SqlAlchemySandboxSnapshotRepository(session),
                            clock,
                        ),
                        SqlAlchemySandboxActionProposalRepository(session),
                        clock,
                    ),
                ),
                build_scenario_mutations(session),
                runtimes,
                clock,
            )

    def sandbox_tool_service() -> Generator[SandboxToolService, None, None]:
        with session_scope(factory) as session:
            yield SandboxToolService(
                SqlAlchemySandboxRepository(session),
                SqlAlchemySandboxSnapshotRepository(session),
                shop_repository(session),
                ticket_repository(session),
                customer_profile_repository(session),
                support_identity_repository(session),
                SandboxActionService(
                    SandboxService(
                        SqlAlchemySandboxRepository(session),
                        SqlAlchemySandboxSnapshotRepository(session),
                        clock,
                    ),
                    SqlAlchemySandboxActionProposalRepository(session),
                    clock,
                ),
            )

    def order_action_service() -> Generator[OrderActionService, None, None]:
        with session_scope(factory) as session:
            yield OrderActionService(
                SqlAlchemySessionRepository(session),
                SqlAlchemyGeneratedScenarioRepository(session),
                SqlAlchemyOrderRepository(session, clock),
                SqlAlchemyActionProposalRepository(session),
                SqlAlchemyActionDecisionIdempotencyRepository(session),
                agents,
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

    def delete_generated_scenario(
        scenario_id: ScenarioId,
        scenario_version: ScenarioVersion,
        seed: ScenarioSeed,
        service: Annotated[ScenarioGenerationService, Depends(generation_service)],
    ) -> Response:
        service.delete(scenario_id, scenario_version, seed)
        return Response(status_code=204)

    def list_agent_frameworks() -> AgentFrameworkListResponse:
        return AgentFrameworkListResponse(
            frameworks=[
                AgentFrameworkResponse.from_declaration(value) for value in agents.declarations()
            ]
        )

    def start_conversation(
        command: StartConversationRequest,
        idempotency_key: Annotated[
            str,
            Header(alias="Idempotency-Key", min_length=1, max_length=128),
        ],
        service: Annotated[ConversationService, Depends(conversation_service)],
    ) -> ConversationResponse:
        return ConversationResponse.from_conversation(
            service.start(
                scenario_id=command.scenario_id,
                scenario_version=command.scenario_version,
                seed=command.seed,
                framework_id=command.framework_id,
                idempotency_key=idempotency_key,
            )
        )

    def get_conversation(
        session_id: UUID,
        service: Annotated[ConversationService, Depends(conversation_service)],
    ) -> ConversationResponse:
        return ConversationResponse.from_conversation(service.get(session_id))

    def delete_conversation(
        session_id: UUID,
        service: Annotated[ConversationService, Depends(conversation_service)],
    ) -> Response:
        service.delete(session_id)
        return Response(status_code=204)

    async def send_conversation_message(
        session_id: UUID,
        command: SendConversationMessageRequest,
        idempotency_key: Annotated[
            str,
            Header(alias="Idempotency-Key", min_length=1, max_length=128),
        ],
        service: Annotated[ConversationService, Depends(conversation_service)],
    ) -> ConversationResponse:
        return ConversationResponse.from_conversation(
            await service.send(
                session_id,
                command.message,
                idempotency_key=idempotency_key,
            )
        )

    async def propose_order_action(
        session_id: UUID,
        command: ProposeOrderActionRequest,
        idempotency_key: Annotated[
            str,
            Header(alias="Idempotency-Key", min_length=1, max_length=128),
        ],
        service: Annotated[OrderActionService, Depends(order_action_service)],
    ) -> ActionProposalResponse:
        context = (
            configured_telemetry.action_span("propose", session_id=session_id)
            if configured_telemetry is not None
            else nullcontext()
        )
        with context as span:
            proposal = await service.propose_cancel(
                session_id,
                order_id=command.order_id,
                expected_version=command.expected_version,
                idempotency_key=idempotency_key,
            )
            trace_id = None
            if span is not None:
                span.set_attribute("action.outcome", proposal.status.value)
                trace_id = format(span.get_span_context().trace_id, "032x")
            return ActionProposalResponse.from_proposal(proposal, trace_id)

    def get_order_action(
        session_id: UUID,
        proposal_id: UUID,
        service: Annotated[OrderActionService, Depends(order_action_service)],
    ) -> ActionProposalResponse:
        return ActionProposalResponse.from_proposal(service.get(session_id, proposal_id))

    def decide_order_action(
        session_id: UUID,
        proposal_id: UUID,
        command: DecideOrderActionRequest,
        idempotency_key: Annotated[
            str,
            Header(alias="Idempotency-Key", min_length=1, max_length=128),
        ],
        service: Annotated[OrderActionService, Depends(order_action_service)],
    ) -> ActionProposalResponse:
        context = (
            configured_telemetry.action_span(command.decision, session_id=session_id)
            if configured_telemetry is not None
            else nullcontext()
        )
        with context as span:
            proposal = service.decide(
                session_id,
                proposal_id,
                confirm=command.decision == "confirm",
                confirmation_token=command.confirmation_token,
                idempotency_key=idempotency_key,
            )
            trace_id = None
            if span is not None:
                span.set_attribute("action.outcome", proposal.status.value)
                trace_id = format(span.get_span_context().trace_id, "032x")
            return ActionProposalResponse.from_proposal(proposal, trace_id)

    def execute_order_action(
        session_id: UUID,
        proposal_id: UUID,
        idempotency_key: Annotated[
            str,
            Header(alias="Idempotency-Key", min_length=1, max_length=128),
        ],
        service: Annotated[OrderActionService, Depends(order_action_service)],
    ) -> ActionProposalResponse:
        context = (
            configured_telemetry.action_span("execute", session_id=session_id)
            if configured_telemetry is not None
            else nullcontext()
        )
        with context as span:
            proposal = service.execute(
                session_id,
                proposal_id,
                idempotency_key=idempotency_key,
            )
            trace_id = None
            if span is not None:
                span.set_attribute("action.outcome", proposal.status.value)
                span.set_attribute("action.attempt", proposal.attempts)
                trace_id = format(span.get_span_context().trace_id, "032x")
            return ActionProposalResponse.from_proposal(proposal, trace_id)

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
        "/agent-frameworks",
        list_agent_frameworks,
        methods=["GET"],
        response_model=AgentFrameworkListResponse,
        operation_id="listAgentFrameworks",
        summary="List agent frameworks and proven capabilities",
    )
    router.add_api_route(
        "/conversations",
        start_conversation,
        methods=["POST"],
        status_code=201,
        response_model=ConversationResponse,
        operation_id="startConversation",
        summary="Start a support conversation from generated scenario state",
        responses={
            404: {"model": ErrorResponse, "description": "Generated state is not found"},
            409: {"model": ErrorResponse, "description": "Idempotency conflict"},
            422: {"model": ErrorResponse, "description": "Invalid command or framework"},
            500: {"model": ErrorResponse, "description": "Internal server error"},
        },
    )
    router.add_api_route(
        "/conversations/{session_id}",
        get_conversation,
        methods=["GET"],
        response_model=ConversationResponse,
        operation_id="getConversation",
        summary="Resume a persisted support conversation",
        responses={
            404: {"model": ErrorResponse, "description": "Conversation is not found"},
            422: {"model": ErrorResponse, "description": "Invalid session ID"},
            500: {"model": ErrorResponse, "description": "Internal server error"},
        },
    )
    router.add_api_route(
        "/conversations/{session_id}",
        delete_conversation,
        methods=["DELETE"],
        status_code=204,
        operation_id="deleteConversation",
        summary="Permanently delete a conversation and its records",
        responses={
            404: {"model": ErrorResponse, "description": "Conversation is not found"},
            422: {"model": ErrorResponse, "description": "Invalid session ID"},
            500: {"model": ErrorResponse, "description": "Internal server error"},
        },
    )
    router.add_api_route(
        "/conversations/{session_id}/messages",
        send_conversation_message,
        methods=["POST"],
        response_model=ConversationResponse,
        operation_id="sendConversationMessage",
        summary="Send one message to a support conversation",
        responses={
            404: {"model": ErrorResponse, "description": "Conversation is not found"},
            409: {
                "model": ErrorResponse,
                "description": "Idempotency or advanced-conversation conflict",
            },
            422: {"model": ErrorResponse, "description": "Invalid message"},
            502: {"model": ErrorResponse, "description": "Agent execution failed"},
            503: {"model": ErrorResponse, "description": "Transient agent failure"},
            500: {"model": ErrorResponse, "description": "Internal server error"},
        },
    )
    router.add_api_route(
        "/conversations/{session_id}/actions/proposals",
        propose_order_action,
        methods=["POST"],
        status_code=201,
        response_model=ActionProposalResponse,
        operation_id="proposeOrderAction",
        summary="Propose one versioned modifying order action",
        responses={
            404: {"model": ErrorResponse, "description": "Conversation or order is not found"},
            409: {"model": ErrorResponse, "description": "Stale version or idempotency conflict"},
            422: {"model": ErrorResponse, "description": "Action is refused or invalid"},
            500: {"model": ErrorResponse, "description": "Internal server error"},
        },
    )
    router.add_api_route(
        "/conversations/{session_id}/actions/{proposal_id}",
        get_order_action,
        methods=["GET"],
        response_model=ActionProposalResponse,
        operation_id="getOrderAction",
        summary="Retrieve a persisted order-action proposal",
        responses={
            404: {"model": ErrorResponse, "description": "Action proposal is not found"},
            422: {"model": ErrorResponse, "description": "Invalid identifier"},
        },
    )
    router.add_api_route(
        "/conversations/{session_id}/actions/{proposal_id}/decision",
        decide_order_action,
        methods=["POST"],
        response_model=ActionProposalResponse,
        operation_id="decideOrderAction",
        summary="Confirm or cancel an exact proposed action",
        responses={
            404: {"model": ErrorResponse, "description": "Action proposal is not found"},
            409: {"model": ErrorResponse, "description": "Action state conflict"},
            422: {"model": ErrorResponse, "description": "Confirmation does not match"},
        },
    )
    router.add_api_route(
        "/conversations/{session_id}/actions/{proposal_id}/execution",
        execute_order_action,
        methods=["POST"],
        response_model=ActionProposalResponse,
        operation_id="executeOrderAction",
        summary="Execute a confirmed order action idempotently",
        responses={
            404: {"model": ErrorResponse, "description": "Action proposal is not found"},
            409: {"model": ErrorResponse, "description": "Stale order version"},
            422: {"model": ErrorResponse, "description": "Action is unconfirmed or refused"},
            503: {"model": ErrorResponse, "description": "Safe retries were exhausted"},
        },
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
    router.add_api_route(
        "/scenarios/{scenario_id}/versions/{scenario_version}/generations/{seed}",
        delete_generated_scenario,
        methods=["DELETE"],
        status_code=204,
        operation_id="deleteGeneratedScenario",
        summary="Permanently delete a generated persona and its conversations",
        responses={
            404: {"model": ErrorResponse, "description": "Generated scenario is not found"},
            422: {"model": ErrorResponse, "description": "Invalid scenario reference"},
            500: {"model": ErrorResponse, "description": "Internal server error"},
        },
    )

    ShopRoutes(shop_service).register(router)
    OrderRoutes(order_service).register(router)
    CustomerProfileRoutes(customer_profile_service).register(router)
    SupportIdentityRoutes(support_identity_service).register(router)
    AgentConfigurationRoutes(agent_configuration_service).register(router)
    TicketRoutes(ticket_service).register(router)
    ScenarioRoutes(scenario_service).register(router)
    SandboxSnapshotRoutes(sandbox_snapshot_service).register(router)
    SandboxRoutes(sandbox_service).register(router)
    SandboxToolRoutes(sandbox_tool_service).register(router)
    # The participant driver is composed per delivery, from the words the request carries:
    # selecting it is composition's job, and its lifetime is one turn.
    ExperimentHistoryRoutes(experiment_history_service).register(router)
    ExperimentRoutes(
        experiment_service,
        HumanParticipantDriver,
        experiment_runner,
        experiment_timeline_service,
        experiment_evaluation_service,
        experiment_judge_service,
        experiment_annotation_service,
    ).register(router)
    JudgeConfigurationRoutes(judge_configuration_service).register(router)
    ObjectiveBlockRoutes(objective_block_service).register(router)
    MutationBlockRoutes(mutation_block_service).register(router)
    application.include_router(router)
    return application


app = create_app()
