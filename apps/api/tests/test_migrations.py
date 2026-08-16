from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text

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
