from __future__ import annotations

from datetime import datetime
from hashlib import sha256
from typing import cast
from uuid import UUID

from sqlalchemy import (
    ColumnElement,
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

from capability_lab.application.canonical_state import fingerprint_initial_state
from capability_lab.application.conversations import ConversationListFilter, ConversationSummary
from capability_lab.application.definition_resolution import PublishedVersionExistsError
from capability_lab.application.order_actions import ActionProposal, ActionStatus, OrderActionType
from capability_lab.application.ports import (
    AgentResponse,
    Clock,
    ConversationTurn,
    OrderWriteConflictError,
    StructuredSupportResult,
    ToolActivity,
)
from capability_lab.application.scenario_generation import (
    GeneratedScenario,
    GeneratedScenarioSummary,
    PersonaLibraryFilter,
)
from capability_lab.application.shop_payload import (
    shop_content_fingerprint,
    shop_payload_document,
    shop_payload_from_document,
)
from capability_lab.application.shops import (
    ShopDraftRecord,
    ShopSummary,
    ShopVersionRecord,
)
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
from capability_lab.infrastructure.models import (
    ActionProposalModel,
    ConversationSessionModel,
    ConversationTurnModel,
    CustomerModel,
    DefinitionDraftModel,
    DefinitionVersionModel,
    GeneratedScenarioModel,
    GeneratedScenarioOrderModel,
    GeneratedScenarioProductModel,
    IdempotencyRecordModel,
    MemoryRecordModel,
    OrderModel,
    PersonaModel,
    ProductModel,
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


class SqlAlchemyShopRepository:
    """Store shop drafts and immutable published versions as canonical documents.

    ADR 0012 requires the storage boundary to reject an overwrite of `(definition_type,
    definition_id, version)` rather than upsert it; the composite primary key enforces that
    and the insert is translated into `PublishedVersionExistsError`.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    def list_shops(self) -> tuple[ShopSummary, ...]:
        published = self._session.execute(
            select(
                DefinitionVersionModel.definition_id,
                func.max(DefinitionVersionModel.version),
                func.count(),
            )
            .where(DefinitionVersionModel.definition_type == DefinitionType.SHOP.value)
            .group_by(DefinitionVersionModel.definition_id)
        ).all()
        latest_versions: dict[str, int] = {row[0]: row[1] for row in published}
        version_counts: dict[str, int] = {row[0]: row[2] for row in published}
        drafts = self._session.scalars(
            select(DefinitionDraftModel)
            .where(DefinitionDraftModel.definition_type == DefinitionType.SHOP.value)
            .order_by(DefinitionDraftModel.created_at, DefinitionDraftModel.definition_id)
        ).all()
        summaries: list[ShopSummary] = []
        for draft in drafts:
            payload = shop_payload_from_document(draft.payload)
            summaries.append(
                ShopSummary(
                    definition_id=UUID(draft.definition_id),
                    name=payload.identity.name,
                    slug=payload.identity.slug,
                    updated_at=draft.updated_at,
                    latest_published_version=latest_versions.get(draft.definition_id),
                    published_version_count=version_counts.get(draft.definition_id, 0),
                )
            )
        return tuple(summaries)

    def get_draft(self, definition: DefinitionId) -> ShopDraftRecord | None:
        model = self._session.get(
            DefinitionDraftModel, (definition.definition_type.value, str(definition.id))
        )
        if model is None:
            return None
        return ShopDraftRecord(
            draft=DefinitionDraft(definition=definition),
            payload=shop_payload_from_document(model.payload),
            created_at=model.created_at,
            updated_at=model.updated_at,
        )

    def save_draft(self, record: ShopDraftRecord) -> None:
        definition = record.definition
        document = cast("dict[str, object]", shop_payload_document(record.payload))
        model = self._session.get(
            DefinitionDraftModel, (definition.definition_type.value, str(definition.id))
        )
        if model is None:
            self._session.add(
                DefinitionDraftModel(
                    definition_type=definition.definition_type.value,
                    definition_id=str(definition.id),
                    shop_id=None,
                    references=[],
                    payload=document,
                    created_at=record.created_at,
                    updated_at=record.updated_at,
                )
            )
        else:
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

    def get_version(self, ref: VersionRef) -> ShopVersionRecord | None:
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
        payload = shop_payload_from_document(model.payload)
        # A published version is historical evidence: refuse to serve content that no longer
        # hashes to the fingerprint recorded when it was frozen.
        recomputed = shop_content_fingerprint(payload)
        if recomputed != model.content_fingerprint:
            raise PersistedDefinitionIntegrityError(
                f"{ref.definition.definition_type} {ref.definition.id} version {ref.version} "
                "no longer matches its recorded content fingerprint"
            )
        return ShopVersionRecord(
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

    def save_version(self, record: ShopVersionRecord) -> None:
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
                    {
                        "definition_type": reference.definition.definition_type.value,
                        "definition_id": str(reference.definition.id),
                        "version": reference.version,
                    }
                    for reference in published.references
                ],
                payload=cast("dict[str, object]", shop_payload_document(record.payload)),
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
        return PublishedDefinitionVersion(
            definition=definition,
            version=model.version,
            content_fingerprint=model.content_fingerprint,
            published_at=model.published_at,
            shop=None
            if model.shop_id is None
            else DefinitionId(definition_type=DefinitionType.SHOP, id=UUID(model.shop_id)),
            shop_version=model.shop_version,
            references=tuple(
                VersionRef(
                    definition=DefinitionId(
                        definition_type=DefinitionType(str(reference["definition_type"])),
                        id=UUID(str(reference["definition_id"])),
                    ),
                    version=int(cast("int", reference["version"])),
                )
                for reference in model.references
            ),
        )
