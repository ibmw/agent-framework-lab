from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from hashlib import sha256
from typing import Any, cast
from uuid import UUID

from sqlalchemy import (
    ColumnElement,
    CursorResult,
    Integer,
    and_,
    delete,
    func,
    select,
    type_coerce,
    update,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from capability_lab.application.agent_configurations import AGENT_CONFIGURATION_CODEC
from capability_lab.application.agent_turns import (
    AgentTurnRecord,
    ToolEvent,
    ToolEventRecord,
)
from capability_lab.application.blocks import MUTATION_BLOCK_CODEC, OBJECTIVE_BLOCK_CODEC
from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.canonical_state import fingerprint_initial_state
from capability_lab.application.conversations import ConversationListFilter, ConversationSummary
from capability_lab.application.customer_profiles import CUSTOMER_PROFILE_CODEC
from capability_lab.application.definition_authoring import (
    DefinitionDraftRecord,
    DefinitionListing,
    DefinitionVersionRecord,
    PayloadCodec,
)
from capability_lab.application.definition_resolution import PublishedVersionExistsError
from capability_lab.application.experiments import (
    ExperimentRecord,
    ParticipantTurnRecord,
    RunRecord,
)
from capability_lab.application.order_actions import ActionProposal, ActionStatus, OrderActionType
from capability_lab.application.order_fixture_payload import (
    order_fixture_content_fingerprint,
    order_fixture_document,
    order_fixture_from_document,
)
from capability_lab.application.order_fixtures import (
    OrderFixtureRecord,
    OrderReferenceExistsError,
)
from capability_lab.application.ports import (
    AgentResponse,
    Clock,
    ConversationTurn,
    OrderWriteConflictError,
    StructuredSupportResult,
    ToolActivity,
)
from capability_lab.application.sandbox_actions import (
    ActionProposalRecord,
    ProposalAlreadyAppliedError,
)
from capability_lab.application.sandbox_materialization import SandboxSnapshotRecord
from capability_lab.application.sandbox_tools import ToolOutcome
from capability_lab.application.sandboxes import (
    SandboxRecord,
    SandboxRevisionConflictError,
)
from capability_lab.application.scenario_generation import (
    GeneratedScenario,
    GeneratedScenarioSummary,
    PersonaLibraryFilter,
)
from capability_lab.application.scenarios import SCENARIO_CODEC
from capability_lab.application.shops import SHOP_CODEC
from capability_lab.application.support_identities import SUPPORT_IDENTITY_CODEC
from capability_lab.application.tickets import TICKET_CODEC
from capability_lab.domain.agent_configuration import AgentConfigurationPayload
from capability_lab.domain.agent_turn import AgentTurn, AgentTurnFailure, AgentTurnOutcome
from capability_lab.domain.blocks import MutationBlockPayload, ObjectiveBlockPayload
from capability_lab.domain.customer_profile import CustomerProfilePayload
from capability_lab.domain.definitions import (
    DefinitionDraft,
    DefinitionId,
    DefinitionType,
    PublishedDefinitionVersion,
    VersionRef,
)
from capability_lab.domain.entities import (
    CanonicalInitialState,
    ConversationSession,
    Customer,
    Order,
    OrderStatus,
    Persona,
    Product,
    ScenarioDefinition,
    ScenarioMetadata,
)
from capability_lab.domain.experiment import (
    ParticipantDriverType,
    ParticipantTurn,
    ParticipantTurnSource,
)
from capability_lab.domain.scenario import ScenarioPayload
from capability_lab.domain.shop import ShopPayload
from capability_lab.domain.support_identity import SupportIdentityPayload
from capability_lab.domain.ticket import TicketPayload
from capability_lab.infrastructure.models import (
    ActionProposalModel,
    AgentTurnModel,
    ConversationSessionModel,
    ConversationTurnModel,
    CustomerModel,
    DefinitionDraftModel,
    DefinitionShopAttachmentModel,
    DefinitionVersionModel,
    ExperimentModel,
    ExperimentRunModel,
    GeneratedScenarioModel,
    GeneratedScenarioOrderModel,
    GeneratedScenarioProductModel,
    IdempotencyRecordModel,
    MemoryRecordModel,
    OrderFixtureModel,
    OrderModel,
    ParticipantTurnModel,
    PersonaModel,
    ProductModel,
    SandboxActionProposalModel,
    SandboxModel,
    SandboxSnapshotModel,
    ToolEventModel,
)
from capability_lab.infrastructure.sql_types import UtcDateTime

_GENERATION_OPERATION = "generate_scenario_v1"
_CANCEL_ORDER_OPERATION = "cancel_order_v1"
_ACTION_DECISION_OPERATION = "decide_order_action_v1"
_DELETED_CONVERSATION_OPERATION = "deleted_conversation_v1"
_DELETED_GENERATED_SCENARIO_OPERATION = "deleted_generated_scenario_v1"


class GeneratedScenarioConflictError(ValueError):
    """Raised when an immutable scenario reference is saved with different state."""


class ConversationTurnConflictError(ValueError):
    """Raised when a conversation advances before a turn can claim its ordinal."""


class PersistedScenarioIntegrityError(RuntimeError):
    """Raised when persisted state no longer matches its recorded fingerprint."""


class PersistedDefinitionIntegrityError(RuntimeError):
    """Raised when a stored published version no longer matches its content fingerprint."""


def _persona_from_model(model: PersonaModel) -> Persona:
    return Persona(
        id=UUID(model.id),
        display_name=model.display_name,
        email=model.email,
        locale=model.locale,
        support_traits=tuple(model.support_traits),
    )


def _customer_from_model(model: CustomerModel) -> Customer:
    return Customer(
        id=UUID(model.id),
        email=model.email,
        display_name=model.display_name,
        created_at=model.created_at,
    )


def _product_from_model(model: ProductModel) -> Product:
    return Product(
        id=UUID(model.id),
        sku=model.sku,
        name=model.name,
        price_amount=model.price_amount,
        currency=model.currency,
    )


def _order_from_model(model: OrderModel) -> Order:
    return Order(
        id=UUID(model.id),
        customer_id=UUID(model.customer_id),
        created_at=model.created_at,
        status=OrderStatus(model.status),
        version=model.version,
    )


def _save_persona(session: Session, persona: Persona) -> None:
    model = session.get(PersonaModel, str(persona.id))
    if model is not None:
        if _persona_from_model(model) != persona:
            raise GeneratedScenarioConflictError(
                f"persona {persona.id} is already persisted with different state"
            )
        return
    session.add(
        PersonaModel(
            id=str(persona.id),
            display_name=persona.display_name,
            email=persona.email,
            locale=persona.locale,
            support_traits=list(persona.support_traits),
        )
    )


def _save_customer(session: Session, customer: Customer) -> None:
    model = session.get(CustomerModel, str(customer.id))
    if model is not None:
        if _customer_from_model(model) != customer:
            raise GeneratedScenarioConflictError(
                f"customer {customer.id} is already persisted with different state"
            )
        return
    session.add(
        CustomerModel(
            id=str(customer.id),
            email=customer.email,
            display_name=customer.display_name,
            created_at=customer.created_at,
        )
    )


def _save_product(session: Session, product: Product) -> None:
    model = session.get(ProductModel, str(product.id))
    if model is not None:
        if _product_from_model(model) != product:
            raise GeneratedScenarioConflictError(
                f"product {product.id} is already persisted with different state"
            )
        return
    session.add(
        ProductModel(
            id=str(product.id),
            sku=product.sku,
            name=product.name,
            price_amount=product.price_amount,
            currency=product.currency,
        )
    )


def _save_order(session: Session, order: Order) -> None:
    model = session.get(OrderModel, str(order.id))
    if model is not None:
        if _order_from_model(model) != order:
            raise GeneratedScenarioConflictError(
                f"order {order.id} is already persisted with different state"
            )
        return
    session.add(
        OrderModel(
            id=str(order.id),
            customer_id=str(order.customer_id),
            status=order.status.value,
            version=order.version,
            created_at=order.created_at,
        )
    )


class SqlAlchemyCustomerRepository:
    """Map customers without leaking SQLAlchemy into the application port."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, customer_id: UUID) -> Customer | None:
        model = self._session.get(CustomerModel, str(customer_id))
        return None if model is None else _customer_from_model(model)

    def save(self, customer: Customer) -> None:
        self._session.merge(
            CustomerModel(
                id=str(customer.id),
                email=customer.email,
                display_name=customer.display_name,
                created_at=customer.created_at,
            )
        )


class SqlAlchemyOrderRepository:
    """Apply optimistic, idempotent updates to operational order state."""

    def __init__(self, session: Session, clock: Clock) -> None:
        self._session = session
        self._clock = clock

    def get(self, order_id: UUID) -> Order | None:
        model = self._session.get(OrderModel, str(order_id))
        return None if model is None else _order_from_model(model)

    def list_for_customer(self, customer_id: UUID) -> list[Order]:
        models = self._session.scalars(
            select(OrderModel)
            .where(OrderModel.customer_id == str(customer_id))
            .order_by(OrderModel.created_at, OrderModel.id)
        ).all()
        return [_order_from_model(model) for model in models]

    def save(self, order: Order, *, expected_version: int, idempotency_key: str) -> None:
        identity = {
            "order_id": str(order.id),
            "expected_version": expected_version,
            "status": order.status.value,
            "result_version": order.version,
        }
        existing = self._session.get(
            IdempotencyRecordModel, (idempotency_key, _CANCEL_ORDER_OPERATION)
        )
        if existing is not None:
            if existing.response != identity:
                raise OrderWriteConflictError(
                    "the idempotency key was already used for a different order action"
                )
            return
        result = self._session.connection().execute(
            update(OrderModel)
            .where(OrderModel.id == str(order.id), OrderModel.version == expected_version)
            .values(status=order.status.value, version=order.version)
        )
        if result.rowcount != 1:
            raise OrderWriteConflictError("the order version changed before the update")
        self._session.add(
            IdempotencyRecordModel(
                key=idempotency_key,
                operation=_CANCEL_ORDER_OPERATION,
                response=identity,
                created_at=self._clock.now(),
            )
        )
        self._session.flush()


class SqlAlchemyActionProposalRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, proposal_id: UUID) -> ActionProposal | None:
        model = self._session.get(ActionProposalModel, str(proposal_id))
        if model is None:
            return None
        return ActionProposal(
            id=UUID(model.id),
            session_id=UUID(model.session_id),
            action_type=OrderActionType(model.action_type),
            tool_name=model.tool_name,
            tool_version=model.tool_version,
            order_id=UUID(model.order_id),
            expected_version=model.expected_version,
            summary=model.summary,
            confirmation_token=model.confirmation_token,
            status=ActionStatus(model.status),
            attempts=model.attempts,
            result_order_status=model.result_order_status,
            result_order_version=model.result_order_version,
        )

    def save(
        self,
        proposal: ActionProposal,
        *,
        expected_status: ActionStatus | None,
    ) -> None:
        if expected_status is None:
            self._session.add(_proposal_model(proposal))
            self._session.flush()
            return
        result = self._session.connection().execute(
            update(ActionProposalModel)
            .where(
                ActionProposalModel.id == str(proposal.id),
                ActionProposalModel.status == expected_status.value,
            )
            .values(
                status=proposal.status.value,
                attempts=proposal.attempts,
                result_order_status=proposal.result_order_status,
                result_order_version=proposal.result_order_version,
            )
        )
        if result.rowcount != 1:
            current = self.get(proposal.id)
            if current == proposal:
                return
            raise OrderWriteConflictError("the action proposal changed concurrently")


def _proposal_model(proposal: ActionProposal) -> ActionProposalModel:
    return ActionProposalModel(
        id=str(proposal.id),
        session_id=str(proposal.session_id),
        action_type=proposal.action_type.value,
        tool_name=proposal.tool_name,
        tool_version=proposal.tool_version,
        order_id=str(proposal.order_id),
        expected_version=proposal.expected_version,
        summary=proposal.summary,
        confirmation_token=proposal.confirmation_token,
        status=proposal.status.value,
        attempts=proposal.attempts,
        result_order_status=proposal.result_order_status,
        result_order_version=proposal.result_order_version,
    )


class SqlAlchemyActionDecisionIdempotencyRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, idempotency_key: str) -> tuple[UUID, str] | None:
        model = self._session.get(
            IdempotencyRecordModel,
            (idempotency_key, _ACTION_DECISION_OPERATION),
        )
        if model is None:
            return None
        proposal_id = model.response.get("proposal_id")
        decision = model.response.get("decision")
        if not isinstance(proposal_id, str) or decision not in ("confirm", "cancel"):
            raise PersistedScenarioIntegrityError("action decision idempotency record is invalid")
        return UUID(proposal_id), cast(str, decision)

    def claim(
        self,
        idempotency_key: str,
        proposal_id: UUID,
        decision: str,
        created_at: datetime,
    ) -> tuple[UUID, str] | None:
        try:
            self._session.add(
                IdempotencyRecordModel(
                    key=idempotency_key,
                    operation=_ACTION_DECISION_OPERATION,
                    response={"proposal_id": str(proposal_id), "decision": decision},
                    created_at=created_at,
                )
            )
            self._session.flush()
        except IntegrityError as error:
            # OrderActionService makes this claim before any other write. Rollback is required to
            # recover the SQLAlchemy session after a failed flush and cannot discard prior work.
            self._session.rollback()
            replay_identity = self.get(idempotency_key)
            if replay_identity is None:
                raise PersistedScenarioIntegrityError(
                    "action decision idempotency claim could not be resolved"
                ) from error
            return replay_identity
        return None


def _session_last_activity() -> ColumnElement[datetime]:
    """Latest turn time for a session, falling back to when the session was created."""
    return type_coerce(
        func.coalesce(
            select(func.max(ConversationTurnModel.created_at))
            .where(ConversationTurnModel.session_id == ConversationSessionModel.id)
            .correlate(ConversationSessionModel)
            .scalar_subquery(),
            ConversationSessionModel.created_at,
        ),
        UtcDateTime(),
    )


def _session_turn_count() -> ColumnElement[int]:
    return type_coerce(
        select(func.count())
        .select_from(ConversationTurnModel)
        .where(ConversationTurnModel.session_id == ConversationSessionModel.id)
        .correlate(ConversationSessionModel)
        .scalar_subquery(),
        Integer(),
    )


def _delete_session_records(session: Session, session_id: str, deleted_at: datetime) -> bool:
    """Delete one session graph and retain its deterministic identity as a tombstone."""
    connection = session.connection()
    connection.execute(
        delete(ConversationTurnModel).where(ConversationTurnModel.session_id == session_id)
    )
    connection.execute(delete(MemoryRecordModel).where(MemoryRecordModel.session_id == session_id))
    connection.execute(
        delete(ActionProposalModel).where(ActionProposalModel.session_id == session_id)
    )
    result = connection.execute(
        delete(ConversationSessionModel).where(ConversationSessionModel.id == session_id)
    )
    if result.rowcount != 1:
        return False
    session.add(
        IdempotencyRecordModel(
            key=session_id,
            operation=_DELETED_CONVERSATION_OPERATION,
            response={"session_id": session_id},
            created_at=deleted_at,
        )
    )
    session.flush()
    return True


def _generated_scenario_tombstone_key(
    scenario_id: str,
    scenario_version: str,
    seed: int,
) -> str:
    reference = "\x1f".join((scenario_id, scenario_version, str(seed))).encode()
    return sha256(reference).hexdigest()


class SqlAlchemySessionRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, session_id: UUID) -> ConversationSession | None:
        model = self._session.get(ConversationSessionModel, str(session_id))
        if model is None:
            return None
        return ConversationSession(
            id=UUID(model.id),
            customer_id=UUID(model.customer_id),
            seed=model.seed,
            scenario_id=model.scenario_id,
            scenario_version=model.scenario_version,
            framework_id=model.framework_id,
            initial_state_hash=model.initial_state_hash,
            created_at=model.created_at,
        )

    def save(self, session: ConversationSession) -> None:
        existing = self.get(session.id)
        if existing is not None:
            if existing != session:
                raise GeneratedScenarioConflictError(
                    f"conversation session {session.id} already has different state"
                )
            return
        self._session.add(
            ConversationSessionModel(
                id=str(session.id),
                customer_id=str(session.customer_id),
                seed=session.seed,
                scenario_id=session.scenario_id,
                scenario_version=session.scenario_version,
                framework_id=session.framework_id,
                initial_state_hash=session.initial_state_hash,
                created_at=session.created_at,
            )
        )

    def was_deleted(self, session_id: UUID) -> bool:
        return (
            self._session.get(
                IdempotencyRecordModel,
                (str(session_id), _DELETED_CONVERSATION_OPERATION),
            )
            is not None
        )

    def delete(self, session_id: UUID, *, deleted_at: datetime) -> bool:
        return _delete_session_records(self._session, str(session_id), deleted_at)

    def list_summaries(
        self,
        *,
        limit: int,
        offset: int,
        filters: ConversationListFilter,
    ) -> tuple[list[ConversationSummary], int]:
        activity = _session_last_activity()
        statement = select(
            ConversationSessionModel,
            activity.label("last_activity_at"),
            _session_turn_count().label("turn_count"),
        )
        predicates: list[ColumnElement[bool]] = []
        if filters.scenario_id is not None:
            predicates.append(ConversationSessionModel.scenario_id == filters.scenario_id)
        if filters.scenario_version is not None:
            predicates.append(ConversationSessionModel.scenario_version == filters.scenario_version)
        if filters.seed is not None:
            predicates.append(ConversationSessionModel.seed == filters.seed)
        if filters.framework_id is not None:
            predicates.append(ConversationSessionModel.framework_id == filters.framework_id)
        if filters.active_since is not None:
            predicates.append(activity >= filters.active_since)
        if predicates:
            statement = statement.where(*predicates)

        total = self._session.scalar(select(func.count()).select_from(statement.subquery())) or 0
        page = (
            statement.order_by(activity.desc(), ConversationSessionModel.id.desc())
            .offset(offset)
            .limit(limit)
        )

        summaries = [
            ConversationSummary(
                id=UUID(model.id),
                scenario_id=model.scenario_id,
                scenario_version=model.scenario_version,
                seed=model.seed,
                framework_id=model.framework_id,
                created_at=model.created_at,
                last_activity_at=last_activity_at,
                turn_count=turn_count,
            )
            for model, last_activity_at, turn_count in self._session.execute(page).tuples().all()
        ]
        return summaries, total


class SqlAlchemyConversationTurnRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, turn_id: UUID) -> ConversationTurn | None:
        model = self._session.get(ConversationTurnModel, str(turn_id))
        return None if model is None else _turn_from_model(model)

    def list_for_session(self, session_id: UUID) -> list[ConversationTurn]:
        models = self._session.scalars(
            select(ConversationTurnModel)
            .where(ConversationTurnModel.session_id == str(session_id))
            .order_by(ConversationTurnModel.ordinal)
        ).all()
        return [_turn_from_model(model) for model in models]

    def save(self, turn: ConversationTurn) -> None:
        existing = self.get(turn.id)
        if existing is not None:
            if existing != turn:
                raise GeneratedScenarioConflictError(
                    f"conversation turn {turn.id} already has different state"
                )
            return
        result = turn.response.structured_result
        try:
            self._session.add(
                ConversationTurnModel(
                    id=str(turn.id),
                    session_id=str(turn.session_id),
                    ordinal=turn.ordinal,
                    request_message=turn.request_message,
                    response_message=turn.response.message,
                    structured_result={
                        "summary": result.summary,
                        "customer_id": str(result.customer_id),
                        "product_ids": [str(value) for value in result.product_ids],
                        "order_ids": [str(value) for value in result.order_ids],
                    },
                    tool_activity=[
                        {
                            "tool_name": activity.tool_name,
                            "tool_version": activity.tool_version,
                            "outcome": activity.outcome,
                            "result": activity.result,
                        }
                        for activity in turn.response.tool_activity
                    ],
                    trace_id=turn.response.trace_id,
                    created_at=turn.created_at,
                )
            )
            self._session.flush()
        except IntegrityError as error:
            self._session.rollback()
            raise ConversationTurnConflictError(
                f"conversation {turn.session_id} advanced past ordinal {turn.ordinal}"
            ) from error


def _turn_from_model(model: ConversationTurnModel) -> ConversationTurn:
    structured = model.structured_result
    summary = structured.get("summary")
    customer_id = structured.get("customer_id")
    product_ids = _string_tuple(structured.get("product_ids"))
    order_ids = _string_tuple(structured.get("order_ids"))
    if (
        not isinstance(summary, str)
        or not isinstance(customer_id, str)
        or product_ids is None
        or order_ids is None
    ):
        raise PersistedScenarioIntegrityError("conversation turn structured result is invalid")
    activities: list[ToolActivity] = []
    for value in model.tool_activity:
        tool_name = value.get("tool_name")
        tool_version = value.get("tool_version")
        outcome = value.get("outcome")
        result = value.get("result")
        if (
            not isinstance(tool_name, str)
            or not isinstance(tool_version, str)
            or not isinstance(outcome, str)
            or not isinstance(result, dict)
        ):
            raise PersistedScenarioIntegrityError("conversation turn tool activity is invalid")
        activities.append(
            ToolActivity(
                tool_name=tool_name,
                tool_version=tool_version,
                outcome=outcome,
                result=cast(dict[str, object], result),
            )
        )
    return ConversationTurn(
        id=UUID(model.id),
        session_id=UUID(model.session_id),
        ordinal=model.ordinal,
        request_message=model.request_message,
        response=AgentResponse(
            message=model.response_message,
            structured_result=StructuredSupportResult(
                summary=summary,
                customer_id=UUID(customer_id),
                product_ids=tuple(UUID(value) for value in product_ids),
                order_ids=tuple(UUID(value) for value in order_ids),
            ),
            tool_activity=tuple(activities),
            trace_id=model.trace_id,
        ),
        created_at=model.created_at,
    )


def _string_tuple(value: object) -> tuple[str, ...] | None:
    if not isinstance(value, list):
        return None
    values: list[str] = []
    for item in cast(list[object], value):
        if not isinstance(item, str):
            return None
        values.append(item)
    return tuple(values)


class SqlAlchemyPersonaRepository:
    """Persist immutable fictional personas by their deterministic identifier."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, persona_id: UUID) -> Persona | None:
        model = self._session.get(PersonaModel, str(persona_id))
        return None if model is None else _persona_from_model(model)

    def save(self, persona: Persona) -> None:
        _save_persona(self._session, persona)


class SqlAlchemyGeneratedScenarioRepository:
    """Persist and reconstruct the complete deterministic initial-state aggregate."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def get(
        self,
        scenario_id: str,
        scenario_version: str,
        seed: int,
    ) -> GeneratedScenario | None:
        model = self._session.scalar(
            select(GeneratedScenarioModel).where(
                GeneratedScenarioModel.scenario_id == scenario_id,
                GeneratedScenarioModel.scenario_version == scenario_version,
                GeneratedScenarioModel.seed == seed,
            )
        )
        if model is None:
            return None

        persona_model = self._session.get(PersonaModel, model.persona_id)
        customer_model = self._session.get(CustomerModel, model.customer_id)
        if persona_model is None or customer_model is None:
            raise PersistedScenarioIntegrityError("generated scenario has missing identity state")

        product_models = self._session.scalars(
            select(ProductModel)
            .join(
                GeneratedScenarioProductModel,
                GeneratedScenarioProductModel.product_id == ProductModel.id,
            )
            .where(GeneratedScenarioProductModel.initial_state_hash == model.initial_state_hash)
            .order_by(ProductModel.id)
        ).all()
        order_snapshots = self._session.scalars(
            select(GeneratedScenarioOrderModel)
            .where(GeneratedScenarioOrderModel.initial_state_hash == model.initial_state_hash)
            .order_by(GeneratedScenarioOrderModel.order_id)
        ).all()

        definition = ScenarioDefinition(
            scenario_id=model.scenario_id,
            scenario_version=model.scenario_version,
            policy_set_version=model.policy_set_version,
            canonical_schema_version=model.canonical_schema_version,
        )
        state = CanonicalInitialState(
            definition=definition,
            seed=model.seed,
            persona=_persona_from_model(persona_model),
            customer=_customer_from_model(customer_model),
            products=tuple(_product_from_model(product) for product in product_models),
            orders=tuple(
                Order(
                    id=UUID(order.order_id),
                    customer_id=UUID(order.customer_id),
                    created_at=order.created_at,
                    status=OrderStatus(order.status),
                    version=order.version,
                )
                for order in order_snapshots
            ),
        )
        fingerprint = fingerprint_initial_state(state)
        if fingerprint.initial_state_hash != model.initial_state_hash:
            raise PersistedScenarioIntegrityError(
                "generated scenario state does not match its recorded fingerprint"
            )
        return GeneratedScenario(
            metadata=ScenarioMetadata(
                definition=definition,
                seed=model.seed,
                created_at=model.created_at,
            ),
            state=state,
            fingerprint=fingerprint,
        )

    def save(self, generated: GeneratedScenario) -> None:
        metadata = generated.metadata
        state = generated.state
        if metadata.definition != state.definition or metadata.seed != state.seed:
            raise GeneratedScenarioConflictError(
                "generated scenario metadata and canonical state references must match"
            )
        recomputed = fingerprint_initial_state(state)
        if recomputed != generated.fingerprint:
            raise GeneratedScenarioConflictError(
                "generated scenario fingerprint must match its canonical state"
            )

        existing = self.get(metadata.scenario_id, metadata.scenario_version, metadata.seed)
        if existing is not None:
            if existing != generated:
                raise GeneratedScenarioConflictError(
                    "scenario reference is already persisted with different generated state"
                )
            return

        _save_persona(self._session, state.persona)
        _save_customer(self._session, state.customer)
        for product in state.products:
            _save_product(self._session, product)
        self._session.flush()
        for order in state.orders:
            _save_order(self._session, order)
        self._session.flush()
        self._session.add(
            GeneratedScenarioModel(
                initial_state_hash=generated.initial_state_hash,
                scenario_id=metadata.scenario_id,
                scenario_version=metadata.scenario_version,
                policy_set_version=metadata.policy_set_version,
                canonical_schema_version=metadata.canonical_schema_version,
                seed=metadata.seed,
                persona_id=str(state.persona.id),
                customer_id=str(state.customer.id),
                created_at=metadata.created_at,
            )
        )
        self._session.flush()
        self._session.add_all(
            GeneratedScenarioProductModel(
                initial_state_hash=generated.initial_state_hash,
                product_id=str(product.id),
            )
            for product in state.products
        )
        self._session.add_all(
            GeneratedScenarioOrderModel(
                initial_state_hash=generated.initial_state_hash,
                order_id=str(order.id),
                customer_id=str(order.customer_id),
                status=order.status.value,
                version=order.version,
                created_at=order.created_at,
            )
            for order in state.orders
        )

    def was_deleted(self, scenario_id: str, scenario_version: str, seed: int) -> bool:
        return (
            self._session.get(
                IdempotencyRecordModel,
                (
                    _generated_scenario_tombstone_key(scenario_id, scenario_version, seed),
                    _DELETED_GENERATED_SCENARIO_OPERATION,
                ),
            )
            is not None
        )

    def delete(
        self,
        scenario_id: str,
        scenario_version: str,
        seed: int,
        *,
        deleted_at: datetime,
    ) -> bool:
        generated = self._session.scalar(
            select(GeneratedScenarioModel).where(
                GeneratedScenarioModel.scenario_id == scenario_id,
                GeneratedScenarioModel.scenario_version == scenario_version,
                GeneratedScenarioModel.seed == seed,
            )
        )
        if generated is None:
            return False

        fingerprint = generated.initial_state_hash
        persona_id = generated.persona_id
        customer_id = generated.customer_id
        product_ids = list(
            self._session.scalars(
                select(GeneratedScenarioProductModel.product_id).where(
                    GeneratedScenarioProductModel.initial_state_hash == fingerprint
                )
            )
        )
        order_ids = list(
            self._session.scalars(
                select(GeneratedScenarioOrderModel.order_id).where(
                    GeneratedScenarioOrderModel.initial_state_hash == fingerprint
                )
            )
        )
        session_ids = list(
            self._session.scalars(
                select(ConversationSessionModel.id).where(
                    ConversationSessionModel.scenario_id == scenario_id,
                    ConversationSessionModel.scenario_version == scenario_version,
                    ConversationSessionModel.seed == seed,
                )
            )
        )
        for session_id in session_ids:
            if not _delete_session_records(self._session, session_id, deleted_at):
                raise PersistedScenarioIntegrityError(
                    f"conversation session {session_id} disappeared during persona deletion"
                )

        connection = self._session.connection()
        connection.execute(
            delete(GeneratedScenarioProductModel).where(
                GeneratedScenarioProductModel.initial_state_hash == fingerprint
            )
        )
        connection.execute(
            delete(GeneratedScenarioOrderModel).where(
                GeneratedScenarioOrderModel.initial_state_hash == fingerprint
            )
        )
        result = connection.execute(
            delete(GeneratedScenarioModel).where(
                GeneratedScenarioModel.initial_state_hash == fingerprint
            )
        )
        if result.rowcount != 1:
            raise PersistedScenarioIntegrityError(
                "generated scenario disappeared during persona deletion"
            )

        for order_id in order_ids:
            still_snapshotted = self._session.scalar(
                select(GeneratedScenarioOrderModel.order_id)
                .where(GeneratedScenarioOrderModel.order_id == order_id)
                .limit(1)
            )
            still_proposed = self._session.scalar(
                select(ActionProposalModel.order_id)
                .where(ActionProposalModel.order_id == order_id)
                .limit(1)
            )
            if still_snapshotted is None and still_proposed is None:
                connection.execute(delete(OrderModel).where(OrderModel.id == order_id))

        for product_id in product_ids:
            still_referenced = self._session.scalar(
                select(GeneratedScenarioProductModel.product_id)
                .where(GeneratedScenarioProductModel.product_id == product_id)
                .limit(1)
            )
            if still_referenced is None:
                connection.execute(delete(ProductModel).where(ProductModel.id == product_id))

        persona_still_referenced = self._session.scalar(
            select(GeneratedScenarioModel.persona_id)
            .where(GeneratedScenarioModel.persona_id == persona_id)
            .limit(1)
        )
        if persona_still_referenced is None:
            connection.execute(delete(PersonaModel).where(PersonaModel.id == persona_id))

        customer_still_referenced = any(
            value is not None
            for value in (
                self._session.scalar(
                    select(GeneratedScenarioModel.customer_id)
                    .where(GeneratedScenarioModel.customer_id == customer_id)
                    .limit(1)
                ),
                self._session.scalar(
                    select(ConversationSessionModel.customer_id)
                    .where(ConversationSessionModel.customer_id == customer_id)
                    .limit(1)
                ),
                self._session.scalar(
                    select(OrderModel.customer_id)
                    .where(OrderModel.customer_id == customer_id)
                    .limit(1)
                ),
            )
        )
        if not customer_still_referenced:
            connection.execute(delete(CustomerModel).where(CustomerModel.id == customer_id))

        tombstone_key = _generated_scenario_tombstone_key(scenario_id, scenario_version, seed)
        self._session.add(
            IdempotencyRecordModel(
                key=tombstone_key,
                operation=_DELETED_GENERATED_SCENARIO_OPERATION,
                response={
                    "scenario_id": scenario_id,
                    "scenario_version": scenario_version,
                    "seed": seed,
                },
                created_at=deleted_at,
            )
        )
        self._session.flush()
        return True

    def list_summaries(
        self,
        *,
        limit: int,
        offset: int,
        filters: PersonaLibraryFilter,
    ) -> tuple[list[GeneratedScenarioSummary], int]:
        # Aggregate each persona's conversation activity without reconstructing the
        # (heavier) full generated aggregate the way ``get`` does.
        sessions_select = select(
            ConversationSessionModel.scenario_id.label("scenario_id"),
            ConversationSessionModel.scenario_version.label("scenario_version"),
            ConversationSessionModel.seed.label("seed"),
            _session_last_activity().label("activity"),
        )
        # A framework filter narrows the aggregate to that framework's conversations, so the
        # count and activity reflect it, and the inner join drops personas without a match.
        if filters.framework_id is not None:
            sessions_select = sessions_select.where(
                ConversationSessionModel.framework_id == filters.framework_id
            )
        sessions = sessions_select.subquery()
        activity_by_persona = (
            select(
                sessions.c.scenario_id,
                sessions.c.scenario_version,
                sessions.c.seed,
                func.count().label("conversation_count"),
                func.max(sessions.c.activity).label("last_activity"),
            )
            .group_by(sessions.c.scenario_id, sessions.c.scenario_version, sessions.c.seed)
            .subquery()
        )

        activity = type_coerce(
            func.coalesce(activity_by_persona.c.last_activity, GeneratedScenarioModel.created_at),
            UtcDateTime(),
        )
        conversation_count = type_coerce(
            func.coalesce(activity_by_persona.c.conversation_count, 0), Integer()
        )

        statement = (
            select(
                GeneratedScenarioModel,
                PersonaModel,
                activity.label("last_activity_at"),
                conversation_count.label("conversation_count"),
            )
            .join(PersonaModel, PersonaModel.id == GeneratedScenarioModel.persona_id)
            .join(
                activity_by_persona,
                and_(
                    activity_by_persona.c.scenario_id == GeneratedScenarioModel.scenario_id,
                    activity_by_persona.c.scenario_version
                    == GeneratedScenarioModel.scenario_version,
                    activity_by_persona.c.seed == GeneratedScenarioModel.seed,
                ),
                isouter=filters.framework_id is None,
            )
        )

        predicates: list[ColumnElement[bool]] = []
        if filters.scenario_id is not None:
            predicates.append(GeneratedScenarioModel.scenario_id == filters.scenario_id)
        if filters.scenario_version is not None:
            predicates.append(GeneratedScenarioModel.scenario_version == filters.scenario_version)
        if filters.active_since is not None:
            predicates.append(activity >= filters.active_since)
        if predicates:
            statement = statement.where(*predicates)

        # Offset paging over a stable order gives page numbers and a total for the UI; the
        # id tie-breaker keeps the order deterministic when activity timestamps coincide.
        total = self._session.scalar(select(func.count()).select_from(statement.subquery())) or 0
        page = (
            statement.order_by(activity.desc(), GeneratedScenarioModel.initial_state_hash.desc())
            .offset(offset)
            .limit(limit)
        )

        summaries = [
            GeneratedScenarioSummary(
                scenario_id=generated.scenario_id,
                scenario_version=generated.scenario_version,
                seed=generated.seed,
                display_name=persona.display_name,
                locale=persona.locale,
                initial_state_hash=generated.initial_state_hash,
                created_at=generated.created_at,
                last_activity_at=last_activity_at,
                conversation_count=count,
            )
            for generated, persona, last_activity_at, count in self._session.execute(page)
            .tuples()
            .all()
        ]
        return summaries, total


class SqlAlchemyScenarioGenerationIdempotencyRepository:
    """Store command identity separately from the deterministic generated aggregate."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, idempotency_key: str) -> tuple[str, str, int] | None:
        model = self._session.get(
            IdempotencyRecordModel,
            (idempotency_key, _GENERATION_OPERATION),
        )
        if model is None:
            return None
        scenario_id = model.response.get("scenario_id")
        scenario_version = model.response.get("scenario_version")
        seed = model.response.get("seed")
        if (
            not isinstance(scenario_id, str)
            or not isinstance(scenario_version, str)
            or isinstance(seed, bool)
            or not isinstance(seed, int)
        ):
            raise PersistedScenarioIntegrityError("generation idempotency record is invalid")
        return scenario_id, scenario_version, seed

    def claim(
        self,
        idempotency_key: str,
        scenario_id: str,
        scenario_version: str,
        seed: int,
        created_at: datetime,
    ) -> tuple[str, str, int] | None:
        try:
            self._session.add(
                IdempotencyRecordModel(
                    key=idempotency_key,
                    operation=_GENERATION_OPERATION,
                    response={
                        "scenario_id": scenario_id,
                        "scenario_version": scenario_version,
                        "seed": seed,
                    },
                    created_at=created_at,
                )
            )
            self._session.flush()
        except IntegrityError as error:
            # Claiming is the first write in the generation unit of work, so the losing writer can
            # safely restart its transaction and load the winner's now-committed result.
            self._session.rollback()
            replay_identity = self.get(idempotency_key)
            if replay_identity is None:
                raise PersistedScenarioIntegrityError(
                    "generation idempotency claim could not be resolved"
                ) from error
            return replay_identity
        return None


def _reference_row(target: DefinitionId, *, version: int | None) -> dict[str, object]:
    """One stored reference. A draft's targets carry no version until publication pins one."""
    row: dict[str, object] = {
        "definition_type": target.definition_type.value,
        "definition_id": str(target.id),
    }
    if version is not None:
        row["version"] = version
    return row


def _definition_id(reference: dict[str, object]) -> DefinitionId:
    return DefinitionId(
        definition_type=DefinitionType(str(reference["definition_type"])),
        id=UUID(str(reference["definition_id"])),
    )


def _published_version(
    model: DefinitionVersionModel, definition: DefinitionId
) -> PublishedDefinitionVersion:
    """Rebuild one immutable published version and everything it pinned."""
    return PublishedDefinitionVersion(
        definition=definition,
        version=model.version,
        content_fingerprint=model.content_fingerprint,
        published_at=model.published_at,
        shop=_shop_scope(model.shop_id),
        shop_version=model.shop_version,
        references=tuple(
            VersionRef(
                definition=_definition_id(reference),
                version=int(cast("int", reference["version"])),
            )
            for reference in model.references
        ),
    )


def _shop_scope(shop_id: str | None) -> DefinitionId | None:
    if shop_id is None:
        return None
    return DefinitionId(definition_type=DefinitionType.SHOP, id=UUID(shop_id))


class SqlAlchemyDefinitionRepository[PayloadT]:
    """Store one definition type's drafts and immutable versions as canonical documents.

    ADR 0012 requires the storage boundary to reject an overwrite of `(definition_type,
    definition_id, version)` rather than upsert it; the composite primary key enforces that
    and the insert is translated into `PublishedVersionExistsError`.

    Only the payload codec is per-type, so every shop-independent definition shares this
    adapter instead of copying the same six statements.
    """

    def __init__(self, session: Session, codec: PayloadCodec[PayloadT]) -> None:
        self._session = session
        self._codec = codec

    @property
    def _type(self) -> str:
        return self._codec.definition_type.value

    def list_definitions(self) -> tuple[DefinitionListing[PayloadT], ...]:
        return self._listings(None)

    def list_in_shop(self, shop_id: UUID) -> tuple[DefinitionListing[PayloadT], ...]:
        """The drafts of one shop. Shop-independent types have no rows to match."""
        return self._listings(str(shop_id))

    def _listings(self, shop_id: str | None) -> tuple[DefinitionListing[PayloadT], ...]:
        published = self._session.execute(
            select(
                DefinitionVersionModel.definition_id,
                func.max(DefinitionVersionModel.version),
                func.count(),
            )
            .where(DefinitionVersionModel.definition_type == self._type)
            .group_by(DefinitionVersionModel.definition_id)
        ).all()
        latest_versions: dict[str, int] = {row[0]: row[1] for row in published}
        version_counts: dict[str, int] = {row[0]: row[2] for row in published}
        statement = select(DefinitionDraftModel).where(
            DefinitionDraftModel.definition_type == self._type
        )
        if shop_id is not None:
            statement = statement.where(DefinitionDraftModel.shop_id == shop_id)
        drafts = self._session.scalars(
            statement.order_by(DefinitionDraftModel.created_at, DefinitionDraftModel.definition_id)
        ).all()
        return tuple(
            DefinitionListing[PayloadT](
                definition_id=UUID(draft.definition_id),
                payload=self._codec.from_document(draft.payload),
                created_at=draft.created_at,
                updated_at=draft.updated_at,
                latest_published_version=latest_versions.get(draft.definition_id),
                published_version_count=version_counts.get(draft.definition_id, 0),
            )
            for draft in drafts
        )

    def get_draft(self, definition: DefinitionId) -> DefinitionDraftRecord[PayloadT] | None:
        model = self._session.get(
            DefinitionDraftModel, (definition.definition_type.value, str(definition.id))
        )
        if model is None:
            return None
        return DefinitionDraftRecord[PayloadT](
            draft=DefinitionDraft(
                definition=definition,
                shop=_shop_scope(model.shop_id),
                references=tuple(_definition_id(reference) for reference in model.references),
            ),
            payload=self._codec.from_document(model.payload),
            created_at=model.created_at,
            updated_at=model.updated_at,
        )

    def save_draft(self, record: DefinitionDraftRecord[PayloadT]) -> None:
        definition = record.definition
        document = cast("dict[str, object]", self._codec.document(record.payload))
        references = [_reference_row(target, version=None) for target in record.draft.references]
        model = self._session.get(
            DefinitionDraftModel, (definition.definition_type.value, str(definition.id))
        )
        if model is None:
            self._session.add(
                DefinitionDraftModel(
                    definition_type=definition.definition_type.value,
                    definition_id=str(definition.id),
                    shop_id=None if record.draft.shop is None else str(record.draft.shop.id),
                    references=references,
                    payload=document,
                    created_at=record.created_at,
                    updated_at=record.updated_at,
                )
            )
        else:
            # The scope is identity and is never rewritten; the references follow the
            # payload, which the caller may have changed.
            model.references = references
            model.payload = document
            model.updated_at = record.updated_at
        self._session.flush()

    def latest_published_version(self, definition: DefinitionId) -> int | None:
        return self._session.scalar(
            select(func.max(DefinitionVersionModel.version)).where(
                DefinitionVersionModel.definition_type == definition.definition_type.value,
                DefinitionVersionModel.definition_id == str(definition.id),
            )
        )

    def get_version(self, ref: VersionRef) -> DefinitionVersionRecord[PayloadT] | None:
        model = self._session.get(
            DefinitionVersionModel,
            (
                ref.definition.definition_type.value,
                str(ref.definition.id),
                ref.version,
            ),
        )
        if model is None:
            return None
        payload = self._codec.from_document(model.payload)
        # A published version is historical evidence: refuse to serve content that no longer
        # hashes to the fingerprint recorded when it was frozen.
        recomputed = self._codec.fingerprint(payload)
        if recomputed != model.content_fingerprint:
            raise PersistedDefinitionIntegrityError(
                f"{ref.definition.definition_type} {ref.definition.id} version {ref.version} "
                "no longer matches its recorded content fingerprint"
            )
        return DefinitionVersionRecord[PayloadT](
            published=self._published(model, ref.definition),
            payload=payload,
        )

    def list_versions(self, definition: DefinitionId) -> tuple[PublishedDefinitionVersion, ...]:
        models = self._session.scalars(
            select(DefinitionVersionModel)
            .where(
                DefinitionVersionModel.definition_type == definition.definition_type.value,
                DefinitionVersionModel.definition_id == str(definition.id),
            )
            .order_by(DefinitionVersionModel.version.desc())
        ).all()
        return tuple(self._published(model, definition) for model in models)

    def save_version(self, record: DefinitionVersionRecord[PayloadT]) -> None:
        published = record.published
        self._session.add(
            DefinitionVersionModel(
                definition_type=published.definition.definition_type.value,
                definition_id=str(published.definition.id),
                version=published.version,
                content_fingerprint=published.content_fingerprint,
                shop_id=None if published.shop is None else str(published.shop.id),
                shop_version=published.shop_version,
                references=[
                    _reference_row(reference.definition, version=reference.version)
                    for reference in published.references
                ],
                payload=cast("dict[str, object]", self._codec.document(record.payload)),
                published_at=published.published_at,
            )
        )
        try:
            self._session.flush()
        except IntegrityError as error:
            raise PublishedVersionExistsError(
                f"{published.definition.definition_type} {published.definition.id} "
                f"version {published.version} is already published"
            ) from error

    @staticmethod
    def _published(
        model: DefinitionVersionModel, definition: DefinitionId
    ) -> PublishedDefinitionVersion:
        return _published_version(model, definition)


def shop_repository(session: Session) -> SqlAlchemyDefinitionRepository[ShopPayload]:
    return SqlAlchemyDefinitionRepository(session, SHOP_CODEC)


def customer_profile_repository(
    session: Session,
) -> SqlAlchemyDefinitionRepository[CustomerProfilePayload]:
    return SqlAlchemyDefinitionRepository(session, CUSTOMER_PROFILE_CODEC)


def support_identity_repository(
    session: Session,
) -> SqlAlchemyDefinitionRepository[SupportIdentityPayload]:
    return SqlAlchemyDefinitionRepository(session, SUPPORT_IDENTITY_CODEC)


def ticket_repository(session: Session) -> SqlAlchemyDefinitionRepository[TicketPayload]:
    return SqlAlchemyDefinitionRepository(session, TICKET_CODEC)


def objective_block_repository(
    session: Session,
) -> SqlAlchemyDefinitionRepository[ObjectiveBlockPayload]:
    return SqlAlchemyDefinitionRepository(session, OBJECTIVE_BLOCK_CODEC)


def mutation_block_repository(
    session: Session,
) -> SqlAlchemyDefinitionRepository[MutationBlockPayload]:
    return SqlAlchemyDefinitionRepository(session, MUTATION_BLOCK_CODEC)


def scenario_repository(session: Session) -> SqlAlchemyDefinitionRepository[ScenarioPayload]:
    return SqlAlchemyDefinitionRepository(session, SCENARIO_CODEC)


def agent_configuration_repository(
    session: Session,
) -> SqlAlchemyDefinitionRepository[AgentConfigurationPayload]:
    return SqlAlchemyDefinitionRepository(session, AGENT_CONFIGURATION_CODEC)


class SqlAlchemyPublishedVersionDirectory:
    """Published versions of any definition, read without their payload codecs.

    Publishing a shop-scoped definition pins its shop and its references, which are other
    definition types entirely, and resolving a sandbox walks that whole closure. Only the
    version provenance is needed either way, so this reads version rows directly instead of
    decoding five different payload documents.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    def get_published(self, ref: VersionRef) -> PublishedDefinitionVersion | None:
        model = self._session.get(
            DefinitionVersionModel,
            (ref.definition.definition_type.value, str(ref.definition.id), ref.version),
        )
        if model is None:
            return None
        return _published_version(model, ref.definition)

    def latest_published(self, definition: DefinitionId) -> PublishedDefinitionVersion | None:
        model = self._session.scalars(
            select(DefinitionVersionModel)
            .where(
                DefinitionVersionModel.definition_type == definition.definition_type.value,
                DefinitionVersionModel.definition_id == str(definition.id),
            )
            .order_by(DefinitionVersionModel.version.desc())
            .limit(1)
        ).first()
        if model is None:
            return None
        return _published_version(model, definition)


class SqlAlchemyShopDirectory:
    """Existence check for a shop, without decoding its whole catalog document."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def exists(self, shop_id: UUID) -> bool:
        return (
            self._session.scalar(
                select(DefinitionDraftModel.definition_id).where(
                    DefinitionDraftModel.definition_type == DefinitionType.SHOP.value,
                    DefinitionDraftModel.definition_id == str(shop_id),
                )
            )
            is not None
        )


class SqlAlchemyDefinitionShopAttachmentRepository:
    """Store which shops use a shop-independent definition.

    The composite primary key makes attaching twice idempotent, which matters because the
    Studio's "attach existing profile" control is a plain button, not a toggle.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    def attach(self, definition: DefinitionId, shop_id: UUID, attached_at: datetime) -> None:
        key = (definition.definition_type.value, str(definition.id), str(shop_id))
        if self._session.get(DefinitionShopAttachmentModel, key) is not None:
            return
        savepoint = self._session.begin_nested()
        self._session.add(
            DefinitionShopAttachmentModel(
                definition_type=key[0],
                definition_id=key[1],
                shop_id=key[2],
                attached_at=attached_at,
            )
        )
        try:
            self._session.flush()
        except IntegrityError:
            # The composite primary key already says this attachment exists. Losing the
            # insert race means the caller got what it asked for, so the savepoint rolls
            # back and attach stays idempotent instead of surfacing a 500.
            savepoint.rollback()
        else:
            savepoint.commit()

    def detach(self, definition: DefinitionId, shop_id: UUID) -> bool:
        model = self._session.get(
            DefinitionShopAttachmentModel,
            (definition.definition_type.value, str(definition.id), str(shop_id)),
        )
        if model is None:
            return False
        self._session.delete(model)
        self._session.flush()
        return True

    def is_attached(self, definition: DefinitionId, shop_id: UUID) -> bool:
        return (
            self._session.get(
                DefinitionShopAttachmentModel,
                (definition.definition_type.value, str(definition.id), str(shop_id)),
            )
            is not None
        )

    def shops_for(self, definition: DefinitionId) -> tuple[UUID, ...]:
        rows = self._session.scalars(
            select(DefinitionShopAttachmentModel.shop_id)
            .where(
                DefinitionShopAttachmentModel.definition_type == definition.definition_type.value,
                DefinitionShopAttachmentModel.definition_id == str(definition.id),
            )
            .order_by(
                DefinitionShopAttachmentModel.attached_at,
                DefinitionShopAttachmentModel.shop_id,
            )
        ).all()
        return tuple(UUID(row) for row in rows)

    def definitions_for_shop(
        self, definition_type: DefinitionType, shop_id: UUID
    ) -> frozenset[UUID]:
        rows = self._session.scalars(
            select(DefinitionShopAttachmentModel.definition_id).where(
                DefinitionShopAttachmentModel.definition_type == definition_type.value,
                DefinitionShopAttachmentModel.shop_id == str(shop_id),
            )
        ).all()
        return frozenset(UUID(row) for row in rows)

    def attachment_counts(self, definition_type: DefinitionType) -> dict[UUID, int]:
        rows = self._session.execute(
            select(DefinitionShopAttachmentModel.definition_id, func.count())
            .where(DefinitionShopAttachmentModel.definition_type == definition_type.value)
            .group_by(DefinitionShopAttachmentModel.definition_id)
        ).all()
        return {UUID(row[0]): row[1] for row in rows}


class SqlAlchemyOrderFixtureRepository:
    """Store one shop's authored orders as canonical `order-fixture-v1` documents.

    The typed constructors re-validate every stored document on read, so a fixture that
    drifted out of the schema fails loudly instead of seeding a sandbox nobody can explain.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    def list_for_shop(self, shop_id: UUID) -> tuple[OrderFixtureRecord, ...]:
        models = self._session.scalars(
            select(OrderFixtureModel)
            .where(OrderFixtureModel.shop_id == str(shop_id))
            .order_by(OrderFixtureModel.created_at.desc(), OrderFixtureModel.order_id)
        ).all()
        return tuple(self._record(model) for model in models)

    def get(self, shop_id: UUID, order_id: UUID) -> OrderFixtureRecord | None:
        model = self._session.get(OrderFixtureModel, (str(shop_id), str(order_id)))
        return None if model is None else self._record(model)

    def reference_owner(self, shop_id: UUID, reference: str) -> UUID | None:
        owner = self._session.scalar(
            select(OrderFixtureModel.order_id).where(
                OrderFixtureModel.shop_id == str(shop_id),
                OrderFixtureModel.reference == reference,
            )
        )
        return None if owner is None else UUID(owner)

    def save(self, record: OrderFixtureRecord) -> None:
        document = cast("dict[str, object]", order_fixture_document(record.payload))
        fingerprint = order_fixture_content_fingerprint(record.payload)
        model = self._session.get(OrderFixtureModel, (str(record.shop_id), str(record.order_id)))
        if model is None:
            self._session.add(
                OrderFixtureModel(
                    shop_id=str(record.shop_id),
                    order_id=str(record.order_id),
                    reference=record.payload.reference,
                    customer_profile_id=str(record.payload.customer_profile_id),
                    content_fingerprint=fingerprint,
                    payload=document,
                    created_at=record.created_at,
                    updated_at=record.updated_at,
                )
            )
        else:
            model.reference = record.payload.reference
            model.content_fingerprint = fingerprint
            model.payload = document
            model.updated_at = record.updated_at
        try:
            self._session.flush()
        except IntegrityError as error:
            # The unique constraint is the last word on a shop-unique reference, even when
            # the service's own check lost a race. Only that violation is translated: every
            # dialect names the offending column or constraint in the message, and both
            # spellings contain `reference`, so anything else still surfaces as a fault.
            if "reference" not in str(error.orig):
                raise
            raise OrderReferenceExistsError(
                f"another order in this shop already uses the reference {record.payload.reference}"
            ) from error

    def delete(self, shop_id: UUID, order_id: UUID) -> bool:
        model = self._session.get(OrderFixtureModel, (str(shop_id), str(order_id)))
        if model is None:
            return False
        self._session.delete(model)
        self._session.flush()
        return True

    @staticmethod
    def _record(model: OrderFixtureModel) -> OrderFixtureRecord:
        return OrderFixtureRecord(
            shop_id=UUID(model.shop_id),
            order_id=UUID(model.order_id),
            payload=order_fixture_from_document(model.payload),
            created_at=model.created_at,
            updated_at=model.updated_at,
        )


class SqlAlchemySandboxSnapshotRepository:
    """Store canonical `sandbox-v2` documents; a snapshot is written once, never updated.

    Immutability is the point of a snapshot, so there is no update path at all: a shop that
    already holds this fingerprint already holds this starting state, and the service hands
    the existing record back instead of writing a second row for the same bytes.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, shop_id: UUID, snapshot_id: UUID) -> SandboxSnapshotRecord | None:
        model = self._session.get(SandboxSnapshotModel, str(snapshot_id))
        if model is None or model.shop_id != str(shop_id):
            return None
        return self._record(model)

    def find_by_fingerprint(
        self, shop_id: UUID, sandbox_fingerprint: str
    ) -> SandboxSnapshotRecord | None:
        model = self._session.scalars(
            select(SandboxSnapshotModel).where(
                SandboxSnapshotModel.shop_id == str(shop_id),
                SandboxSnapshotModel.sandbox_fingerprint == sandbox_fingerprint,
            )
        ).first()
        return None if model is None else self._record(model)

    def list_for_scenario(
        self, shop_id: UUID, scenario_id: UUID
    ) -> tuple[SandboxSnapshotRecord, ...]:
        models = self._session.scalars(
            select(SandboxSnapshotModel)
            .where(
                SandboxSnapshotModel.shop_id == str(shop_id),
                SandboxSnapshotModel.scenario_id == str(scenario_id),
            )
            .order_by(
                SandboxSnapshotModel.created_at.desc(),
                SandboxSnapshotModel.snapshot_id,
            )
        ).all()
        return tuple(self._record(model) for model in models)

    def save(self, record: SandboxSnapshotRecord) -> SandboxSnapshotRecord:
        self._session.add(
            SandboxSnapshotModel(
                snapshot_id=str(record.snapshot_id),
                shop_id=str(record.shop_id),
                scenario_id=str(record.scenario_id),
                scenario_version=record.scenario_version,
                seed=record.seed,
                sandbox_fingerprint=record.sandbox_fingerprint,
                document=cast("dict[str, object]", record.document),
                created_at=record.created_at,
            )
        )
        try:
            self._session.flush()
        except IntegrityError as error:
            # Two writers can miss the same fingerprint lookup and both insert. The unique
            # constraint is the last word, and the loser wants the winner's row rather than
            # a 500: identical starting state is one snapshot, whoever wrote it. The insert
            # is the first write of this unit of work, so the losing writer can restart its
            # transaction and read the now-committed winner, as the generation idempotency
            # claim does above.
            if "sandbox_fingerprint" not in str(error.orig):
                raise
            self._session.rollback()
            winner = self.find_by_fingerprint(record.shop_id, record.sandbox_fingerprint)
            if winner is None:
                raise PersistedScenarioIntegrityError(
                    "a sandbox snapshot was refused as a duplicate but cannot be resolved"
                ) from error
            return winner
        return record

    @staticmethod
    def _record(model: SandboxSnapshotModel) -> SandboxSnapshotRecord:
        return SandboxSnapshotRecord(
            snapshot_id=UUID(model.snapshot_id),
            shop_id=UUID(model.shop_id),
            scenario_id=UUID(model.scenario_id),
            scenario_version=model.scenario_version,
            seed=model.seed,
            sandbox_fingerprint=model.sandbox_fingerprint,
            document=cast("dict[str, CanonicalValue]", model.document),
            created_at=model.created_at,
        )


class SqlAlchemySandboxRepository:
    """Store one row per arm; the isolation between two arms is that they are two rows.

    A clone never reads back into the snapshot's document, so a write here cannot be seen
    from the arm beside it or from the starting state both were taken from.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, shop_id: UUID, sandbox_id: UUID) -> SandboxRecord | None:
        model = self._session.get(SandboxModel, str(sandbox_id))
        if model is None or model.shop_id != str(shop_id):
            return None
        return self._record(model)

    def list_for_snapshot(self, shop_id: UUID, snapshot_id: UUID) -> tuple[SandboxRecord, ...]:
        models = self._session.scalars(
            select(SandboxModel)
            .where(
                SandboxModel.shop_id == str(shop_id),
                SandboxModel.snapshot_id == str(snapshot_id),
            )
            .order_by(SandboxModel.created_at, SandboxModel.sandbox_id)
        ).all()
        return tuple(self._record(model) for model in models)

    def save(self, record: SandboxRecord) -> SandboxRecord:
        self._session.add(
            SandboxModel(
                sandbox_id=str(record.sandbox_id),
                shop_id=str(record.shop_id),
                snapshot_id=str(record.snapshot_id),
                label=record.label,
                revision=record.revision,
                snapshot_fingerprint=record.snapshot_fingerprint,
                state_fingerprint=record.state_fingerprint,
                document=cast("dict[str, object]", record.document),
                created_at=record.created_at,
                updated_at=record.updated_at,
            )
        )
        self._session.flush()
        return record

    def update(self, record: SandboxRecord, *, expected_revision: int) -> SandboxRecord:
        """Write the next revision only while the arm is still where the writer left it.

        The revision predicate lives in the statement rather than in a prior read: the
        service's read-then-write can be overtaken between the two, and only the store can
        decide which writer wins.

        Executed through the session rather than the connection so the ORM synchronizes any
        instance of this row already loaded here. Through the connection the UPDATE bypasses
        the identity map, and a later read in the same unit of work would answer with
        pre-update attributes for as long as something held that instance alive — freshness
        by garbage collection rather than by contract.
        """
        result = cast(
            "CursorResult[Any]",
            self._session.execute(
                update(SandboxModel)
                .where(
                    SandboxModel.sandbox_id == str(record.sandbox_id),
                    SandboxModel.shop_id == str(record.shop_id),
                    SandboxModel.revision == expected_revision,
                )
                .values(
                    revision=record.revision,
                    state_fingerprint=record.state_fingerprint,
                    document=cast("dict[str, object]", record.document),
                    updated_at=record.updated_at,
                )
            ),
        )
        if result.rowcount != 1:
            # The re-read runs inside this transaction, so a writer that overtook us may not
            # be visible from here. Only report a revision this one can actually see.
            current = self.get(record.shop_id, record.sandbox_id)
            raise SandboxRevisionConflictError(
                expected_revision, None if current is None else current.revision
            )
        return record

    @staticmethod
    def _record(model: SandboxModel) -> SandboxRecord:
        return SandboxRecord(
            sandbox_id=UUID(model.sandbox_id),
            shop_id=UUID(model.shop_id),
            snapshot_id=UUID(model.snapshot_id),
            label=model.label,
            revision=model.revision,
            snapshot_fingerprint=model.snapshot_fingerprint,
            state_fingerprint=model.state_fingerprint,
            document=cast("dict[str, CanonicalValue]", model.document),
            created_at=model.created_at,
            updated_at=model.updated_at,
        )


class SqlAlchemySandboxActionProposalRepository:
    """Store proposed changes per arm, and close each one against a single application.

    The row is both the consent record and the idempotency record. `save` upserts on the
    confirmation, because the confirmation is the hash of the change: a second proposal of the
    same change against a byte-identical world computes the key that is already there.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, sandbox_id: UUID, confirmation: str) -> ActionProposalRecord | None:
        model = self._session.get(
            SandboxActionProposalModel,
            {"sandbox_id": str(sandbox_id), "confirmation": confirmation},
        )
        return None if model is None else self._record(model)

    def save(self, record: ActionProposalRecord) -> ActionProposalRecord:
        existing = self.get(record.sandbox_id, record.confirmation)
        if existing is not None:
            return self._reconciled(existing, record)
        try:
            self._session.add(
                SandboxActionProposalModel(
                    sandbox_id=str(record.sandbox_id),
                    confirmation=record.confirmation,
                    shop_id=str(record.shop_id),
                    tool=record.tool,
                    version=record.version,
                    order_id=str(record.order_id),
                    address_id=record.address_id,
                    expected_revision=record.expected_revision,
                    proposal=cast("dict[str, object]", record.proposal),
                    created_at=record.created_at,
                )
            )
            self._session.flush()
        except IntegrityError as error:
            # Two proposals of the same change racing: the read above found nothing for both,
            # and the primary key let only one of them in. The loser has not lost anything —
            # the row that won says exactly what its own proposal said — so it reads the
            # winner rather than reporting the lab as broken, which is what an uncaught
            # IntegrityError would become.
            #
            # Recording a proposal is the only write in a propose call, so the rollback the
            # session needs to recover from a failed flush cannot discard earlier work.
            self._session.rollback()
            winner = self.get(record.sandbox_id, record.confirmation)
            if winner is None:
                raise PersistedDefinitionIntegrityError(
                    "a proposal was refused as a duplicate but cannot be read back"
                ) from error
            return self._reconciled(winner, record)
        return record

    def _reconciled(
        self, existing: ActionProposalRecord, proposed: ActionProposalRecord
    ) -> ActionProposalRecord:
        """Return the recorded proposal, moved to the revision it was just computed against.

        An identical confirmation is proof that the world is byte-identical: the hash covers
        the order, the address-book entry, and the arm's whole state (ADR 0022). What it does
        *not* cover is the revision, which counts writes rather than describing state — so an
        arm that changed and changed back sits at a higher revision with the fingerprint it
        had before.

        Without this the proposal recorded at the old revision could never be applied: the
        write would lose to the revision guard forever, and the refusal would tell the agent
        to propose again, which mints the same confirmation and finds the same stale row. The
        change is legitimate and the world is the one it was computed in; only the counter has
        moved, so the counter is what is refreshed.

        An applied row keeps everything it recorded, including its revision. It is history:
        the result it holds is what a replay must answer with, and re-opening it against a
        newer revision would offer a second application of a change that already happened.
        (A state that recurs *after* an apply would have to un-write the order event the apply
        appended, which nothing in the lab can do.)
        """
        if existing.applied or existing.expected_revision == proposed.expected_revision:
            return existing
        outcome = cast(
            "CursorResult[Any]",
            self._session.execute(
                update(SandboxActionProposalModel)
                .where(
                    SandboxActionProposalModel.sandbox_id == str(existing.sandbox_id),
                    SandboxActionProposalModel.confirmation == existing.confirmation,
                    SandboxActionProposalModel.applied_at.is_(None),
                )
                .values(expected_revision=proposed.expected_revision)
            ),
        )
        if outcome.rowcount != 1:
            # Applied between the read and the refresh. The recorded result is the answer.
            return self.get(existing.sandbox_id, existing.confirmation) or existing
        return replace(existing, expected_revision=proposed.expected_revision)

    def mark_applied(
        self,
        record: ActionProposalRecord,
        *,
        applied_at: datetime,
        applied_revision: int,
        result: dict[str, CanonicalValue],
    ) -> ActionProposalRecord:
        """Close the proposal, and only while it is still open.

        The still-open predicate lives in the statement for the same reason the sandbox's
        revision does (ADR 0020): the service's read-then-write can be overtaken between the
        two, and only the statement can decide which of two applies wrote the result.
        """
        outcome = cast(
            "CursorResult[Any]",
            self._session.execute(
                update(SandboxActionProposalModel)
                .where(
                    SandboxActionProposalModel.sandbox_id == str(record.sandbox_id),
                    SandboxActionProposalModel.confirmation == record.confirmation,
                    SandboxActionProposalModel.applied_at.is_(None),
                )
                .values(
                    applied_at=applied_at,
                    applied_revision=applied_revision,
                    result=cast("dict[str, object]", result),
                )
            ),
        )
        if outcome.rowcount != 1:
            raise ProposalAlreadyAppliedError(
                f"proposal {record.confirmation} has already been applied to this arm"
            )
        return replace(
            record, applied_at=applied_at, applied_revision=applied_revision, result=result
        )

    @staticmethod
    def _record(model: SandboxActionProposalModel) -> ActionProposalRecord:
        return ActionProposalRecord(
            sandbox_id=UUID(model.sandbox_id),
            shop_id=UUID(model.shop_id),
            confirmation=model.confirmation,
            tool=model.tool,
            version=model.version,
            order_id=UUID(model.order_id),
            address_id=model.address_id,
            expected_revision=model.expected_revision,
            proposal=cast("dict[str, CanonicalValue]", model.proposal),
            created_at=model.created_at,
            applied_at=model.applied_at,
            applied_revision=model.applied_revision,
            result=cast("dict[str, CanonicalValue] | None", model.result),
        )


class SqlAlchemyExperimentRepository:
    """Store one experiment as the `experiment-v1` document it was fingerprinted from.

    Write-once, like the snapshot repository beside it: there is no update path, because an
    experiment's inputs are what explain its result and nothing may edit them after a run
    has begun.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, shop_id: UUID, experiment_id: UUID) -> ExperimentRecord | None:
        model = self._session.get(ExperimentModel, str(experiment_id))
        if model is None or model.shop_id != str(shop_id):
            return None
        return self._record(model)

    def list_for_shop(self, shop_id: UUID) -> tuple[ExperimentRecord, ...]:
        models = self._session.scalars(
            select(ExperimentModel)
            .where(ExperimentModel.shop_id == str(shop_id))
            # Newest first: an operator opening the bench is looking for what they just ran.
            .order_by(ExperimentModel.created_at.desc(), ExperimentModel.experiment_id)
        ).all()
        return tuple(self._record(model) for model in models)

    def save(self, record: ExperimentRecord) -> ExperimentRecord:
        self._session.add(
            ExperimentModel(
                experiment_id=str(record.experiment_id),
                shop_id=str(record.shop_id),
                label=record.label,
                scenario_id=str(record.scenario_id),
                scenario_version=record.scenario_version,
                seed=record.seed,
                snapshot_id=str(record.snapshot_id),
                sandbox_fingerprint=record.sandbox_fingerprint,
                resolution_fingerprint=record.resolution_fingerprint,
                participant_driver=record.participant_driver.value,
                document=cast("dict[str, object]", record.document),
                created_at=record.created_at,
            )
        )
        self._session.flush()
        return record

    @staticmethod
    def _record(model: ExperimentModel) -> ExperimentRecord:
        return ExperimentRecord(
            experiment_id=UUID(model.experiment_id),
            shop_id=UUID(model.shop_id),
            label=model.label,
            scenario_id=UUID(model.scenario_id),
            scenario_version=model.scenario_version,
            seed=model.seed,
            snapshot_id=UUID(model.snapshot_id),
            sandbox_fingerprint=model.sandbox_fingerprint,
            resolution_fingerprint=model.resolution_fingerprint,
            participant_driver=ParticipantDriverType(model.participant_driver),
            document=cast("dict[str, CanonicalValue]", model.document),
            created_at=model.created_at,
        )


class SqlAlchemyExperimentRunRepository:
    """One row per arm, ordered by the position a comparison refers to them by."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def list_for_experiment(self, experiment_id: UUID) -> tuple[RunRecord, ...]:
        models = self._session.scalars(
            select(ExperimentRunModel)
            .where(ExperimentRunModel.experiment_id == str(experiment_id))
            .order_by(ExperimentRunModel.position)
        ).all()
        return tuple(self._record(model) for model in models)

    def save(self, record: RunRecord) -> RunRecord:
        self._session.add(
            ExperimentRunModel(
                run_id=str(record.run_id),
                experiment_id=str(record.experiment_id),
                shop_id=str(record.shop_id),
                position=record.position,
                label=record.label,
                agent_configuration_id=str(record.agent_configuration_id),
                agent_configuration_version=record.agent_configuration_version,
                sandbox_id=str(record.sandbox_id),
                created_at=record.created_at,
            )
        )
        self._session.flush()
        return record

    @staticmethod
    def _record(model: ExperimentRunModel) -> RunRecord:
        return RunRecord(
            run_id=UUID(model.run_id),
            experiment_id=UUID(model.experiment_id),
            shop_id=UUID(model.shop_id),
            position=model.position,
            label=model.label,
            agent_configuration_id=UUID(model.agent_configuration_id),
            agent_configuration_version=model.agent_configuration_version,
            sandbox_id=UUID(model.sandbox_id),
            created_at=model.created_at,
        )


class SqlAlchemyParticipantTurnRepository:
    """Append one turn per arm; the run-and-ordinal key is what makes the stream a stream."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def list_for_experiment(self, experiment_id: UUID) -> tuple[ParticipantTurnRecord, ...]:
        models = self._session.scalars(
            select(ParticipantTurnModel)
            .where(ParticipantTurnModel.experiment_id == str(experiment_id))
            # By run and then by depth rather than by time: two arms driven in one call share
            # a timestamp, and a thread read in insertion order would interleave them.
            .order_by(ParticipantTurnModel.run_id, ParticipantTurnModel.ordinal)
        ).all()
        return tuple(self._record(model) for model in models)

    def append(self, record: ParticipantTurnRecord) -> ParticipantTurnRecord:
        self._session.add(
            ParticipantTurnModel(
                run_id=str(record.run_id),
                ordinal=record.turn.ordinal,
                experiment_id=str(record.experiment_id),
                turn_id=str(record.turn.turn_id),
                source=record.turn.source.value,
                driver=None if record.turn.driver is None else record.turn.driver.value,
                body=record.turn.body,
                created_at=record.created_at,
            )
        )
        self._session.flush()
        return record

    @staticmethod
    def _record(model: ParticipantTurnModel) -> ParticipantTurnRecord:
        return ParticipantTurnRecord(
            run_id=UUID(model.run_id),
            experiment_id=UUID(model.experiment_id),
            turn=ParticipantTurn(
                turn_id=UUID(model.turn_id),
                ordinal=model.ordinal,
                source=ParticipantTurnSource(model.source),
                driver=None if model.driver is None else ParticipantDriverType(model.driver),
                body=model.body,
            ),
            created_at=model.created_at,
        )


class SqlAlchemyAgentTurnRepository:
    """Append one attempt per arm; the run, ordinal, and attempt key is the append-only rule."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def list_for_experiment(self, experiment_id: UUID) -> tuple[AgentTurnRecord, ...]:
        models = self._session.scalars(
            select(AgentTurnModel)
            .where(AgentTurnModel.experiment_id == str(experiment_id))
            # By run, then depth, then attempt: an arm's thread is read as a thread, and the
            # retries of one question stay in the order they were made.
            .order_by(AgentTurnModel.run_id, AgentTurnModel.ordinal, AgentTurnModel.attempt)
        ).all()
        return tuple(self._record(model) for model in models)

    def append(self, record: AgentTurnRecord) -> AgentTurnRecord:
        turn = record.turn
        self._session.add(
            AgentTurnModel(
                run_id=str(record.run_id),
                ordinal=turn.ordinal,
                attempt=turn.attempt,
                experiment_id=str(record.experiment_id),
                outcome=turn.outcome.value,
                failure=None if turn.failure is None else turn.failure.value,
                body=turn.body,
                created_at=record.created_at,
            )
        )
        self._session.flush()
        return record

    @staticmethod
    def _record(model: AgentTurnModel) -> AgentTurnRecord:
        return AgentTurnRecord(
            run_id=UUID(model.run_id),
            experiment_id=UUID(model.experiment_id),
            turn=AgentTurn(
                ordinal=model.ordinal,
                attempt=model.attempt,
                outcome=AgentTurnOutcome(model.outcome),
                body=model.body,
                failure=None if model.failure is None else AgentTurnFailure(model.failure),
            ),
            created_at=model.created_at,
        )


class SqlAlchemyToolEventRepository:
    """Append one attempt's calls together, in the sequence the agent asked."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def list_for_experiment(self, experiment_id: UUID) -> tuple[ToolEventRecord, ...]:
        models = self._session.scalars(
            select(ToolEventModel)
            .where(ToolEventModel.experiment_id == str(experiment_id))
            .order_by(
                ToolEventModel.run_id,
                ToolEventModel.ordinal,
                ToolEventModel.attempt,
                ToolEventModel.sequence,
            )
        ).all()
        return tuple(self._record(model) for model in models)

    def append_all(self, records: tuple[ToolEventRecord, ...]) -> tuple[ToolEventRecord, ...]:
        for record in records:
            event = record.event
            self._session.add(
                ToolEventModel(
                    run_id=str(record.run_id),
                    ordinal=event.ordinal,
                    attempt=event.attempt,
                    sequence=event.sequence,
                    experiment_id=str(record.experiment_id),
                    # Written from the document rather than decided again, the way an
                    # experiment's provenance columns are.
                    tool=event.tool,
                    version=event.version,
                    outcome=event.outcome.value,
                    document=cast("dict[str, object]", event.document),
                    revision_before=event.revision_before,
                    revision_after=event.revision_after,
                    state_fingerprint=event.state_fingerprint,
                    created_at=record.created_at,
                )
            )
        self._session.flush()
        return records

    @staticmethod
    def _record(model: ToolEventModel) -> ToolEventRecord:
        return ToolEventRecord(
            run_id=UUID(model.run_id),
            experiment_id=UUID(model.experiment_id),
            event=ToolEvent(
                ordinal=model.ordinal,
                attempt=model.attempt,
                sequence=model.sequence,
                tool=model.tool,
                version=model.version,
                outcome=ToolOutcome(model.outcome),
                document=cast("dict[str, CanonicalValue]", model.document),
                revision_before=model.revision_before,
                revision_after=model.revision_after,
                state_fingerprint=model.state_fingerprint,
            ),
            created_at=model.created_at,
        )
