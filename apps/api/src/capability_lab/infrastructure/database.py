import sqlite3
from collections.abc import Generator
from contextlib import contextmanager
from typing import cast

from sqlalchemy import Connection, Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import ConnectionPoolEntry


class Base(DeclarativeBase):
    pass


def create_database_engine(database_url: str) -> Engine:
    engine = create_engine(database_url, pool_pre_ping=True)
    if engine.dialect.name == "sqlite":
        event.listen(engine, "connect", _enable_sqlite_foreign_keys)
        event.listen(engine, "savepoint", _begin_before_sqlite_savepoint)
    return engine


def _enable_sqlite_foreign_keys(
    dbapi_connection: sqlite3.Connection,
    _connection_record: ConnectionPoolEntry,
) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def _begin_before_sqlite_savepoint(connection: Connection, _name: str | None) -> None:
    """Open the transaction a `SAVEPOINT` nests in, when nothing has opened it yet.

    pysqlite's legacy transaction control emits its implicit `BEGIN` before an `INSERT`,
    `UPDATE`, `DELETE` or `REPLACE` only. A `SAVEPOINT` that is a transaction's first write
    therefore *starts* SQLite's transaction itself, and its `RELEASE` commits it on the spot:
    nothing later in the request could roll it back. Beginning first makes the savepoint nest,
    so its release only merges it into the transaction the request commits or rolls back.

    The legacy control is otherwise kept on purpose (ADR 0003): a read before a request's first
    write takes no lock, so a request that reads never blocks another's commit, and two that
    read then write queue on the write lock rather than deadlock on it.

    A deferred `BEGIN` takes no lock until its first *statement*, a read included: a `SELECT`
    inside the savepoint before its first write takes a shared lock held to the commit, and
    brings the deadlock back. So a savepoint that may open a request's transaction opens on a
    write, with no read inside it before that write. `attach` follows the rule: it reads before
    its savepoint and inserts first inside it.
    """
    dbapi_connection = cast(sqlite3.Connection, connection.connection.dbapi_connection)
    if not dbapi_connection.in_transaction:
        dbapi_connection.execute("BEGIN")


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)


@contextmanager
def session_scope(factory: sessionmaker[Session]) -> Generator[Session, None, None]:
    with factory() as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
