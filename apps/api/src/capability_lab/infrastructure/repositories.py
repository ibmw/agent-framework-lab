from __future__ import annotations

from datetime import datetime
from typing import cast
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from capability_lab.application.canonical_state import fingerprint_initial_state
from capability_lab.application.ports import (
    AgentResponse,
    ConversationTurn,
    StructuredSupportResult,
    ToolActivity,
)
from capability_lab.application.scenario_generation import GeneratedScenario
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
    ConversationSessionModel,
    ConversationTurnModel,
    CustomerModel,
    GeneratedScenarioModel,
    GeneratedScenarioOrderModel,
    GeneratedScenarioProductModel,
    IdempotencyRecordModel,
    OrderModel,
    PersonaModel,
    ProductModel,
)

_GENERATION_OPERATION = "generate_scenario_v1"


class GeneratedScenarioConflictError(ValueError):
    """Raised when an immutable scenario reference is saved with different state."""


class ConversationTurnConflictError(ValueError):
    """Raised when a conversation advances before a turn can claim its ordinal."""


class PersistedScenarioIntegrityError(RuntimeError):
    """Raised when persisted state no longer matches its recorded fingerprint."""


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
        order_models = self._session.scalars(
            select(OrderModel)
            .join(
                GeneratedScenarioOrderModel,
                GeneratedScenarioOrderModel.order_id == OrderModel.id,
            )
            .where(GeneratedScenarioOrderModel.initial_state_hash == model.initial_state_hash)
            .order_by(OrderModel.id)
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
            orders=tuple(_order_from_model(order) for order in order_models),
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
            )
            for order in state.orders
        )


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
