from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from capability_lab.domain.entities import Customer
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.models import CustomerModel, OrderModel
from capability_lab.infrastructure.repositories import SqlAlchemyCustomerRepository


def database_url(tmp_path: Path) -> str:
    return f"sqlite:///{tmp_path / 'repository.db'}"


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
