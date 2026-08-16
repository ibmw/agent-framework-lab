from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError

from capability_lab.application.canonical_state import fingerprint_initial_state
from capability_lab.application.scenario_generation import create_retail_profile_kernel
from capability_lab.domain.entities import Customer, Persona
from capability_lab.infrastructure.clock import SystemClock
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.models import (
    CustomerModel,
    OrderModel,
    PersonaModel,
    ProductModel,
)
from capability_lab.infrastructure.repositories import (
    GeneratedScenarioConflictError,
    PersistedScenarioIntegrityError,
    SqlAlchemyCustomerRepository,
    SqlAlchemyGeneratedScenarioRepository,
    SqlAlchemyPersonaRepository,
)


def database_url(tmp_path: Path) -> str:
    return f"sqlite:///{tmp_path / 'repository.db'}"


class FixedClock:
    def now(self) -> datetime:
        return datetime(2026, 8, 16, 12, 30, tzinfo=UTC)


def test_customer_repository_round_trip_preserves_utc_and_upserts(tmp_path: Path) -> None:
    engine = create_database_engine(database_url(tmp_path))
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    created_at = datetime(2026, 8, 16, 10, 30, 15, 123456, tzinfo=UTC)
    customer = Customer(
        id=uuid4(),
        email="customer@example.com",
        display_name="Initial name",
        created_at=created_at,
    )

    with session_scope(factory) as session:
        SqlAlchemyCustomerRepository(session).save(customer)
    with session_scope(factory) as session:
        repository = SqlAlchemyCustomerRepository(session)
        loaded = repository.get(customer.id)
        repository.save(replace(customer, display_name="Updated name"))
    with session_scope(factory) as session:
        updated = SqlAlchemyCustomerRepository(session).get(customer.id)

    assert loaded == customer
    assert loaded is not None and loaded.created_at.tzinfo is UTC
    assert updated is not None and updated.display_name == "Updated name"


def test_sqlite_rejects_orphan_order(tmp_path: Path) -> None:
    engine = create_database_engine(database_url(tmp_path))
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)

    with pytest.raises(IntegrityError), session_scope(factory) as session:
        session.add(
            OrderModel(
                id=str(uuid4()),
                customer_id=str(uuid4()),
                status="pending",
                version=1,
                created_at=datetime(2026, 8, 16, tzinfo=UTC),
            )
        )


def test_sqlite_rejects_invalid_order_status(tmp_path: Path) -> None:
    engine = create_database_engine(database_url(tmp_path))
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    customer_id = str(uuid4())

    with session_scope(factory) as session:
        session.add(
            CustomerModel(
                id=customer_id,
                email="order-owner@example.com",
                display_name="Order owner",
                created_at=datetime(2026, 8, 16, tzinfo=UTC),
            )
        )

    with pytest.raises(IntegrityError), session_scope(factory) as session:
        session.add(
            OrderModel(
                id=str(uuid4()),
                customer_id=customer_id,
                status="unknown",
                version=1,
                created_at=datetime(2026, 8, 16, tzinfo=UTC),
            )
        )


def test_session_scope_rolls_back_on_failure(tmp_path: Path) -> None:
    engine = create_database_engine(database_url(tmp_path))
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    customer_id = str(uuid4())

    with pytest.raises(RuntimeError, match="force rollback"), session_scope(factory) as session:
        session.add(
            CustomerModel(
                id=customer_id,
                email="rollback@example.com",
                display_name="Rollback",
                created_at=datetime(2026, 8, 16, tzinfo=UTC),
            )
        )
        raise RuntimeError("force rollback")

    with session_scope(factory) as session:
        assert session.get(CustomerModel, customer_id) is None


def test_persona_repository_round_trip(tmp_path: Path) -> None:
    engine = create_database_engine(database_url(tmp_path))
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    persona = Persona(
        id=uuid4(),
        display_name="Morgan Martin",
        email="morgan@example.test",
        locale="en-US",
        support_traits=("concise", "patient"),
    )

    with session_scope(factory) as session:
        SqlAlchemyPersonaRepository(session).save(persona)
    with session_scope(factory) as session:
        loaded = SqlAlchemyPersonaRepository(session).get(persona.id)

    assert loaded == persona


def test_generated_scenario_repository_round_trip_and_multiple_seeds(tmp_path: Path) -> None:
    engine = create_database_engine(database_url(tmp_path))
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    kernel = create_retail_profile_kernel(FixedClock())
    first = kernel.generate("retail-profile", "v1", 1234)
    second = kernel.generate("retail-profile", "v1", 4321)

    with session_scope(factory) as session:
        repository = SqlAlchemyGeneratedScenarioRepository(session)
        repository.save(first)
        repository.save(second)
    with session_scope(factory) as session:
        repository = SqlAlchemyGeneratedScenarioRepository(session)
        loaded_first = repository.get("retail-profile", "v1", 1234)
        loaded_second = repository.get("retail-profile", "v1", 4321)

    assert loaded_first is not None
    assert loaded_first.metadata == first.metadata
    assert loaded_first.initial_state_hash == first.initial_state_hash
    assert loaded_first.canonical_json == first.canonical_json
    assert loaded_first.state.persona == first.state.persona
    assert set(loaded_first.state.products) == set(first.state.products)
    assert set(loaded_first.state.orders) == set(first.state.orders)
    assert loaded_second is not None
    assert loaded_second.initial_state_hash == second.initial_state_hash


def test_generated_scenario_repository_detects_persisted_state_drift(tmp_path: Path) -> None:
    engine = create_database_engine(database_url(tmp_path))
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    generated = create_retail_profile_kernel(FixedClock()).generate("retail-profile", "v1", 1234)

    with session_scope(factory) as session:
        SqlAlchemyGeneratedScenarioRepository(session).save(generated)
    with session_scope(factory) as session:
        product = session.get(ProductModel, str(generated.state.products[0].id))
        assert product is not None
        product.name = "Unexpected mutation"
    with (
        pytest.raises(PersistedScenarioIntegrityError, match="recorded fingerprint"),
        session_scope(factory) as session,
    ):
        SqlAlchemyGeneratedScenarioRepository(session).get("retail-profile", "v1", 1234)


def test_repository_rejects_fingerprint_that_does_not_match_state(tmp_path: Path) -> None:
    engine = create_database_engine(database_url(tmp_path))
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    generated = create_retail_profile_kernel(FixedClock()).generate("retail-profile", "v1", 1234)
    changed_state = replace(
        generated.state,
        persona=replace(generated.state.persona, locale="fr-FR"),
    )
    changed = replace(generated, state=changed_state)

    with pytest.raises(ValueError, match="fingerprint"), session_scope(factory) as session:
        SqlAlchemyGeneratedScenarioRepository(session).save(changed)

    assert fingerprint_initial_state(changed_state) != generated.fingerprint


@pytest.mark.parametrize("entity_kind", ["persona", "customer", "product", "order"])
def test_generated_scenario_repository_rejects_conflicting_immutable_entity(
    tmp_path: Path,
    entity_kind: str,
) -> None:
    engine = create_database_engine(database_url(tmp_path))
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    generated = create_retail_profile_kernel(FixedClock()).generate("retail-profile", "v1", 1234)
    state = generated.state
    with session_scope(factory) as session:
        if entity_kind == "persona":
            session.add(
                PersonaModel(
                    id=str(state.persona.id),
                    display_name="Conflicting persona",
                    email=state.persona.email,
                    locale=state.persona.locale,
                    support_traits=list(state.persona.support_traits),
                )
            )
        elif entity_kind == "customer":
            session.add(
                CustomerModel(
                    id=str(state.customer.id),
                    email=state.customer.email,
                    display_name="Conflicting customer",
                    created_at=state.customer.created_at,
                )
            )
        elif entity_kind == "product":
            product = state.products[0]
            session.add(
                ProductModel(
                    id=str(product.id),
                    sku=product.sku,
                    name="Conflicting product",
                    price_amount=product.price_amount,
                    currency=product.currency,
                )
            )
        else:
            order = state.orders[0]
            session.add(
                CustomerModel(
                    id=str(state.customer.id),
                    email=state.customer.email,
                    display_name=state.customer.display_name,
                    created_at=state.customer.created_at,
                )
            )
            session.flush()
            session.add(
                OrderModel(
                    id=str(order.id),
                    customer_id=str(order.customer_id),
                    status="cancelled",
                    version=order.version,
                    created_at=order.created_at,
                )
            )

    with (
        pytest.raises(
            GeneratedScenarioConflictError,
            match=rf"{entity_kind} .* different state",
        ),
        session_scope(factory) as session,
    ):
        SqlAlchemyGeneratedScenarioRepository(session).save(generated)


def test_generated_scenario_repository_detects_missing_identity_state(tmp_path: Path) -> None:
    engine = create_database_engine(database_url(tmp_path))
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    generated = create_retail_profile_kernel(FixedClock()).generate("retail-profile", "v1", 1234)
    with session_scope(factory) as session:
        SqlAlchemyGeneratedScenarioRepository(session).save(generated)
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        connection.execute(
            delete(PersonaModel).where(PersonaModel.id == str(generated.state.persona.id))
        )
        connection.commit()
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")

    with (
        pytest.raises(PersistedScenarioIntegrityError, match="missing identity state"),
        session_scope(factory) as session,
    ):
        SqlAlchemyGeneratedScenarioRepository(session).get("retail-profile", "v1", 1234)


def test_system_clock_returns_current_utc_time() -> None:
    before = datetime.now(UTC)
    actual = SystemClock().now()
    after = datetime.now(UTC)

    assert actual.tzinfo is UTC
    assert before <= actual <= after
