"""Transactions on SQLite behave as they are written (ADR 0003).

pysqlite's legacy transaction control emits its implicit `BEGIN` before DML only, so a
`SAVEPOINT` that was a transaction's first write used to *start* SQLite's transaction, and its
`RELEASE` committed it at once. The engine now begins the transaction before such a savepoint,
and keeps the legacy control otherwise: a read before the first write still takes no lock.
"""

import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from capability_lab.domain.definitions import DefinitionId, DefinitionType
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.models import CustomerModel, DefinitionShopAttachmentModel
from capability_lab.infrastructure.repositories import (
    SqlAlchemyDefinitionShopAttachmentRepository,
)

ATTACHED_AT = datetime(2026, 10, 3, 9, 0, tzinfo=UTC)


def store(tmp_path: Path) -> tuple[Engine, sessionmaker[Session], Path]:
    path = tmp_path / "transactions.db"
    engine = create_database_engine(f"sqlite:///{path}")
    Base.metadata.create_all(engine)
    return engine, create_session_factory(engine), path


def customer(name: str) -> CustomerModel:
    return CustomerModel(
        id=str(uuid4()),
        email=f"{name}@example.com",
        display_name=name,
        created_at=ATTACHED_AT,
    )


def customers(factory: sessionmaker[Session]) -> set[str]:
    with session_scope(factory) as session:
        return set(session.scalars(select(CustomerModel.display_name)).all())


def attachments(factory: sessionmaker[Session]) -> int:
    with session_scope(factory) as session:
        return session.scalar(select(func.count()).select_from(DefinitionShopAttachmentModel)) or 0


def profile(profile_id: UUID) -> DefinitionId:
    return DefinitionId(definition_type=DefinitionType.CUSTOMER_PROFILE, id=profile_id)


def test_an_attachment_that_is_a_requests_first_write_rolls_back_with_the_request(
    tmp_path: Path,
) -> None:
    """`attach` writes inside a savepoint; as the first write it used to commit on release."""
    _, factory, _ = store(tmp_path)

    with pytest.raises(RuntimeError, match="later in the request"), session_scope(factory) as s:
        SqlAlchemyDefinitionShopAttachmentRepository(s).attach(
            profile(uuid4()), uuid4(), ATTACHED_AT
        )
        s.add(customer("after-the-attach"))
        s.flush()
        raise RuntimeError("a failure later in the request")

    assert attachments(factory) == 0
    assert customers(factory) == set()


def test_a_released_savepoint_that_opens_the_request_is_rolled_back_with_it(
    tmp_path: Path,
) -> None:
    _, factory, _ = store(tmp_path)

    with pytest.raises(RuntimeError), session_scope(factory) as session:
        with session.begin_nested():
            session.add(customer("in-the-savepoint"))
        session.add(customer("after-it"))
        session.flush()
        raise RuntimeError("roll the request back")

    assert customers(factory) == set()


def test_a_savepoint_inside_a_request_rolls_back_only_its_own_part(tmp_path: Path) -> None:
    _, factory, _ = store(tmp_path)

    with session_scope(factory) as session:
        session.add(customer("before"))
        session.flush()
        savepoint = session.begin_nested()
        session.add(customer("taken-back"))
        session.flush()
        savepoint.rollback()
        session.add(customer("after"))

    assert customers(factory) == {"before", "after"}


def test_a_savepoint_that_opens_the_request_rolls_back_only_its_own_part(
    tmp_path: Path,
) -> None:
    _, factory, _ = store(tmp_path)

    with session_scope(factory) as session:
        savepoint = session.begin_nested()
        session.add(customer("taken-back"))
        session.flush()
        savepoint.rollback()
        session.add(customer("kept"))

    assert customers(factory) == {"kept"}


def test_a_read_before_the_first_write_blocks_no_other_commit(tmp_path: Path) -> None:
    """The legacy control is kept: a request that has only read holds no lock.

    SQLAlchemy's own pysqlite recipe — `BEGIN` on every transaction — would hold a shared lock
    from this read to the request's end, and the other connection's commit would wait for it.
    """
    _, factory, path = store(tmp_path)

    with session_scope(factory) as session:
        assert session.scalars(select(CustomerModel)).all() == []
        other = sqlite3.connect(path, timeout=0.2)
        try:
            other.execute(
                "INSERT INTO customers (id, email, display_name, created_at) "
                "VALUES (?, 'other@example.com', 'other', '2026-10-03T09:00:00+00:00')",
                (str(uuid4()),),
            )
            other.commit()
        finally:
            other.close()

    assert customers(factory) == {"other"}
