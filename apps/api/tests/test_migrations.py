from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import BigInteger, create_engine, inspect, text

from capability_lab.domain.entities import MAX_SCENARIO_SEED
from capability_lab.infrastructure import models
from capability_lab.infrastructure.config import get_settings
from capability_lab.infrastructure.database import Base

APPLICATION_TABLES = {
    "customers",
    "products",
    "orders",
    "conversation_sessions",
    "memory_records",
    "idempotency_records",
}


def alembic_config(database_url: str, monkeypatch: pytest.MonkeyPatch) -> Config:
    monkeypatch.setenv("AGENT_LAB_DATABASE_URL", database_url)
    get_settings.cache_clear()
    api_root = Path(__file__).parents[1]
    config = Config(api_root / "alembic.ini")
    config.set_main_option("script_location", str(api_root / "migrations"))
    return config


@pytest.mark.migration
def test_upgrade_empty_database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    database_url = f"sqlite:///{tmp_path / 'empty.db'}"
    command.upgrade(alembic_config(database_url, monkeypatch), "head")

    inspector = inspect(create_engine(database_url))
    assert set(inspector.get_table_names()) >= APPLICATION_TABLES
    assert {"ix_orders_customer_id"} <= {index["name"] for index in inspector.get_indexes("orders")}
    assert {"ix_conversation_sessions_customer_id"} <= {
        index["name"] for index in inspector.get_indexes("conversation_sessions")
    }
    assert {"ix_memory_records_session_id"} <= {
        index["name"] for index in inspector.get_indexes("memory_records")
    }
    assert {"ck_orders_status_valid", "ck_orders_version_positive"} <= {
        constraint["name"] for constraint in inspector.get_check_constraints("orders")
    }
    seed_column = next(
        column
        for column in inspector.get_columns("conversation_sessions")
        if column["name"] == "seed"
    )
    assert isinstance(seed_column["type"], BigInteger)


@pytest.mark.migration
def test_seed_bigint_migration_preserves_existing_session(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_url = f"sqlite:///{tmp_path / 'seed-bigint.db'}"
    config = alembic_config(database_url, monkeypatch)
    command.upgrade(config, "20260816_0001")
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO customers (id, email, display_name, created_at)
                VALUES (:id, :email, :display_name, :created_at)
                """
            ),
            {
                "id": "1f5ab725-e20c-4a40-aa45-75ec7842fab5",
                "email": "customer@example.test",
                "display_name": "Customer",
                "created_at": "2026-08-16 12:30:00.000000",
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO conversation_sessions (
                    id, customer_id, seed, scenario_version, initial_state_hash, created_at
                ) VALUES (
                    :id, :customer_id, :seed, :scenario_version, :initial_state_hash, :created_at
                )
                """
            ),
            {
                "id": "308d5e20-1319-4c00-ad4f-8d97dfa8b07b",
                "customer_id": "1f5ab725-e20c-4a40-aa45-75ec7842fab5",
                "seed": MAX_SCENARIO_SEED,
                "scenario_version": "v1",
                "initial_state_hash": "0" * 64,
                "created_at": "2026-08-16 12:30:00.000000",
            },
        )

    command.upgrade(config, "head")

    with engine.connect() as connection:
        migrated_seed = connection.scalar(
            text("SELECT seed FROM conversation_sessions WHERE id = :id"),
            {"id": "308d5e20-1319-4c00-ad4f-8d97dfa8b07b"},
        )
    assert migrated_seed == MAX_SCENARIO_SEED


@pytest.mark.migration
def test_upgrade_preserves_unmanaged_existing_table(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_url = f"sqlite:///{tmp_path / 'existing.db'}"
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE legacy_marker (id INTEGER PRIMARY KEY)"))

    command.upgrade(alembic_config(database_url, monkeypatch), "head")

    assert "legacy_marker" in inspect(engine).get_table_names()


@pytest.mark.migration
def test_upgrade_downgrade_upgrade_cycle(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_url = f"sqlite:///{tmp_path / 'cycle.db'}"
    config = alembic_config(database_url, monkeypatch)

    command.upgrade(config, "head")
    command.downgrade(config, "base")
    assert APPLICATION_TABLES.isdisjoint(inspect(create_engine(database_url)).get_table_names())

    command.upgrade(config, "head")
    assert set(inspect(create_engine(database_url)).get_table_names()) >= APPLICATION_TABLES


@pytest.mark.migration
def test_model_metadata_matches_migrated_schema(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_url = f"sqlite:///{tmp_path / 'drift.db'}"
    command.upgrade(alembic_config(database_url, monkeypatch), "head")

    assert models.CustomerModel.__tablename__ == "customers"
    with create_engine(database_url).connect() as connection:
        context = MigrationContext.configure(connection)
        assert compare_metadata(context, Base.metadata) == []
