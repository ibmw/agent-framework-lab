from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import BigInteger, create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from capability_lab.application.scenario_generation import create_retail_profile_kernel
from capability_lab.domain.entities import MAX_SCENARIO_SEED
from capability_lab.infrastructure import models
from capability_lab.infrastructure.config import get_settings
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.repositories import SqlAlchemyGeneratedScenarioRepository

# The definition lifecycle tables arrive alongside the POC tables; a downgrade past their
# revision removes only them.
DEFINITION_TABLES = {
    "definition_drafts",
    "definition_versions",
    "definition_shop_attachments",
}
POC_TABLES = {
    "action_proposals",
    "customers",
    "generated_scenario_orders",
    "generated_scenario_products",
    "generated_scenarios",
    "products",
    "orders",
    "personas",
    "conversation_sessions",
    "conversation_turns",
    "memory_records",
    "idempotency_records",
}
APPLICATION_TABLES = POC_TABLES | DEFINITION_TABLES


def alembic_config(database_url: str, monkeypatch: pytest.MonkeyPatch) -> Config:
    monkeypatch.setenv("AGENT_LAB_DATABASE_URL", database_url)
    get_settings.cache_clear()
    api_root = Path(__file__).parents[1]
    config = Config(api_root / "alembic.ini")
    config.set_main_option("script_location", str(api_root / "migrations"))
    return config


class FixedClock:
    def now(self) -> datetime:
        return datetime(2026, 8, 16, 12, 30, tzinfo=UTC)


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
    assert {"ix_conversation_turns_session_id"} <= {
        index["name"] for index in inspector.get_indexes("conversation_turns")
    }
    assert {"scenario_id", "framework_id"} <= {
        column["name"] for column in inspector.get_columns("conversation_sessions")
    }
    assert {"ix_memory_records_session_id"} <= {
        index["name"] for index in inspector.get_indexes("memory_records")
    }
    assert {"ix_action_proposals_session_id"} <= {
        index["name"] for index in inspector.get_indexes("action_proposals")
    }
    assert {"customer_id", "status", "version", "created_at"} <= {
        column["name"] for column in inspector.get_columns("generated_scenario_orders")
    }
    assert {"ck_orders_status_valid", "ck_orders_version_positive"} <= {
        constraint["name"] for constraint in inspector.get_check_constraints("orders")
    }
    assert {"ck_generated_seed_range"} <= {
        constraint["name"] for constraint in inspector.get_check_constraints("generated_scenarios")
    }
    assert frozenset({"scenario_id", "scenario_version", "seed"}) in {
        frozenset(constraint["column_names"])
        for constraint in inspector.get_unique_constraints("generated_scenarios")
    }
    assert inspector.get_unique_constraints("customers") == []
    assert inspector.get_unique_constraints("products") == []
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
        migrated_session = connection.execute(
            text(
                "SELECT seed, scenario_id, framework_id FROM conversation_sessions WHERE id = :id"
            ),
            {"id": "308d5e20-1319-4c00-ad4f-8d97dfa8b07b"},
        ).one()
    assert migrated_session.seed == MAX_SCENARIO_SEED
    assert migrated_session.scenario_id == "retail-profile"
    assert migrated_session.framework_id == "fake"


@pytest.mark.migration
def test_definition_versions_reject_overwriting_a_published_version(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_url = f"sqlite:///{tmp_path / 'definitions.db'}"
    command.upgrade(alembic_config(database_url, monkeypatch), "head")
    engine = create_engine(database_url)
    row = {
        "definition_type": "shop",
        "definition_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac001",
        "version": 1,
        "content_fingerprint": "a" * 64,
        "shop_id": None,
        "shop_version": None,
        "references": "[]",
        "payload": "{}",
        "published_at": "2026-08-23 12:00:00.000000",
    }
    insert = text(
        """
        INSERT INTO definition_versions (
            definition_type, definition_id, version, content_fingerprint,
            shop_id, shop_version, "references", payload, published_at
        ) VALUES (
            :definition_type, :definition_id, :version, :content_fingerprint,
            :shop_id, :shop_version, :references, :payload, :published_at
        )
        """
    )
    with engine.begin() as connection:
        connection.execute(insert, row)

    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(insert, {**row, "content_fingerprint": "b" * 64})

    with engine.connect() as connection:
        stored = connection.scalar(
            text("SELECT content_fingerprint FROM definition_versions WHERE version = 1")
        )
    assert stored == "a" * 64


@pytest.mark.migration
def test_downgrade_refuses_to_drop_published_definition_versions(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_url = f"sqlite:///{tmp_path / 'published-downgrade.db'}"
    config = alembic_config(database_url, monkeypatch)
    command.upgrade(config, "head")
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO definition_versions (
                    definition_type, definition_id, version, content_fingerprint,
                    shop_id, shop_version, "references", payload, published_at
                ) VALUES (
                    'shop', '0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac002', 1, :fingerprint,
                    NULL, NULL, '[]', '{}', '2026-08-23 12:00:00.000000'
                )
                """
            ),
            {"fingerprint": "c" * 64},
        )

    with pytest.raises(RuntimeError, match="refusing to downgrade"):
        command.downgrade(config, "20260818_0005")

    assert {"definition_drafts", "definition_versions"} <= set(inspect(engine).get_table_names())


@pytest.mark.migration
def test_shop_attachments_reject_a_definition_type_that_cannot_be_attached(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Tickets and scenarios already carry their shop; only shop-independent types attach."""
    database_url = f"sqlite:///{tmp_path / 'attachments.db'}"
    command.upgrade(alembic_config(database_url, monkeypatch), "head")
    engine = create_engine(database_url)
    insert = text(
        """
        INSERT INTO definition_shop_attachments (
            definition_type, definition_id, shop_id, attached_at
        ) VALUES (:definition_type, :definition_id, :shop_id, '2026-08-23 12:00:00.000000')
        """
    )
    row = {
        "definition_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac003",
        "shop_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac004",
    }
    with engine.begin() as connection:
        connection.execute(insert, {**row, "definition_type": "customer_profile"})

    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(insert, {**row, "definition_type": "ticket"})

    # Attaching the same profile to the same shop twice is refused at the storage boundary,
    # so the repository's idempotent attach can never create a duplicate row.
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(insert, {**row, "definition_type": "customer_profile"})


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
def test_downgrade_refuses_populated_generated_state_without_schema_damage(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_url = f"sqlite:///{tmp_path / 'populated-downgrade.db'}"
    config = alembic_config(database_url, monkeypatch)
    command.upgrade(config, "head")
    engine = create_database_engine(database_url)
    factory = create_session_factory(engine)
    kernel = create_retail_profile_kernel(FixedClock())
    with session_scope(factory) as session:
        repository = SqlAlchemyGeneratedScenarioRepository(session)
        repository.save(kernel.generate("retail-profile", "v1", 1))
        repository.save(kernel.generate("retail-profile", "v1", 2))
        repository.save(kernel.generate("retail-profile", "v1", 3))

    with pytest.raises(RuntimeError, match="refusing to downgrade"):
        command.downgrade(config, "20260816_0002")

    inspector = inspect(engine)
    assert set(inspector.get_table_names()) >= POC_TABLES
    assert DEFINITION_TABLES.isdisjoint(inspector.get_table_names())
    assert not any(table.startswith("_alembic_tmp") for table in inspector.get_table_names())
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "20260818_0005"
        assert connection.scalar(text("SELECT count(*) FROM generated_scenarios")) == 3

    with engine.begin() as connection:
        connection.execute(text("DELETE FROM generated_scenario_orders"))
        connection.execute(text("DELETE FROM generated_scenario_products"))
        connection.execute(text("DELETE FROM generated_scenarios"))
        connection.execute(text("DELETE FROM personas"))
        connection.execute(
            text("DELETE FROM idempotency_records WHERE operation = 'generate_scenario_v1'")
        )

    command.downgrade(config, "20260818_0004")

    inspector = inspect(engine)
    assert set(inspector.get_table_names()) >= POC_TABLES - {"action_proposals"}
    assert "action_proposals" not in inspector.get_table_names()
    assert {"customer_id", "status", "version", "created_at"}.isdisjoint(
        column["name"] for column in inspector.get_columns("generated_scenario_orders")
    )
    assert not any(table.startswith("_alembic_tmp") for table in inspector.get_table_names())
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "20260818_0004"
        assert (
            connection.scalar(
                text(
                    "SELECT count(*) FROM ("
                    "SELECT sku FROM products GROUP BY sku HAVING count(*) > 1"
                    ") AS duplicate_skus"
                )
            )
            == 2
        )

    with pytest.raises(RuntimeError, match=r"duplicate values in products\.sku"):
        command.downgrade(config, "20260816_0002")

    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "20260818_0004"


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
