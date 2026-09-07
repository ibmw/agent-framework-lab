import logging
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
    # Orders are not definitions, but they are target authoring state and share the
    # definition tables' migration fate rather than the POC's. So is a snapshot, which is
    # what a published scenario version freezes those orders into.
    "shop_order_fixtures",
    "sandbox_snapshots",
    # And so are the arms cloned from a snapshot: mutable run state, but state that only
    # exists because the target authoring model above produced it — along with the changes
    # proposed against those arms, and the experiment that binds a scenario to the
    # configurations its arms run.
    "sandboxes",
    "sandbox_action_proposals",
    "experiments",
    "experiment_runs",
    "experiment_participant_turns",
    # And the evidence those arms produce: what each agent answered, and every tool call it
    # made getting there.
    "experiment_agent_turns",
    "experiment_tool_events",
    # And what the scenario itself did to those arms while they worked.
    "experiment_mutation_events",
    # And what a published judge answered about the rows no rule can decide.
    "experiment_judgements",
    # And what an operator concluded afterwards, stored beside the record rather than in it.
    "experiment_notes",
    "experiment_tags",
    # And the one measurement of an attempt the record cannot reproduce: where inside it
    # each part of it ran.
    "experiment_run_spans",
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
def test_migrating_leaves_the_application_loggers_it_found_alive(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Configuring alembic's logging must not switch off the application's.

    `logging.config.fileConfig` disables every existing logger unless told otherwise, and the
    migration environment configures logging from `alembic.ini`. That is harmless for the CLI,
    where migrating is all the process does, but this environment also runs in-process: a
    session that migrates and then exercises the application would afterwards log nothing —
    and a silent logger reports its own absence to no one.
    """
    logger = logging.getLogger("capability_lab.application.sandbox_tools")
    assert not logger.disabled

    command.upgrade(alembic_config(f"sqlite:///{tmp_path / 'logging.db'}", monkeypatch), "head")

    assert not logger.disabled


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
    assert {"ck_mutation_events_revision_forward"} <= {
        constraint["name"]
        for constraint in inspector.get_check_constraints("experiment_mutation_events")
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
def test_order_references_are_unique_inside_one_shop(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The reference a customer quotes must name exactly one order in a shop."""
    database_url = f"sqlite:///{tmp_path / 'orders.db'}"
    command.upgrade(alembic_config(database_url, monkeypatch), "head")
    engine = create_engine(database_url)
    insert = text(
        """
        INSERT INTO shop_order_fixtures (
            shop_id, order_id, reference, customer_profile_id, content_fingerprint,
            payload, created_at, updated_at
        ) VALUES (
            :shop_id, :order_id, :reference, :customer_profile_id, :fingerprint,
            '{}', '2026-08-24 12:00:00.000000', '2026-08-24 12:00:00.000000'
        )
        """
    )
    row = {
        "shop_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac005",
        "customer_profile_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac006",
        "fingerprint": "d" * 64,
    }
    with engine.begin() as connection:
        connection.execute(
            insert,
            {**row, "order_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac007", "reference": "NS-10482"},
        )

    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(
            insert,
            {**row, "order_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac008", "reference": "NS-10482"},
        )

    # The same reference in another shop is a different order and stays legal.
    with engine.begin() as connection:
        connection.execute(
            insert,
            {
                **row,
                "shop_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac009",
                "order_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac00a",
                "reference": "NS-10482",
            },
        )


@pytest.mark.migration
def test_identical_starting_state_is_one_snapshot_per_shop(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A fingerprint identifies starting state, so a shop never holds it twice."""
    database_url = f"sqlite:///{tmp_path / 'snapshots.db'}"
    command.upgrade(alembic_config(database_url, monkeypatch), "head")
    engine = create_engine(database_url)
    insert = text(
        """
        INSERT INTO sandbox_snapshots (
            snapshot_id, shop_id, scenario_id, scenario_version, seed,
            sandbox_fingerprint, document, created_at
        ) VALUES (
            :snapshot_id, :shop_id, :scenario_id, 1, 1234,
            :fingerprint, '{}', '2026-08-25 12:00:00.000000'
        )
        """
    )
    row = {
        "shop_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac00b",
        "scenario_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac00c",
        "fingerprint": "e" * 64,
    }
    with engine.begin() as connection:
        connection.execute(insert, {**row, "snapshot_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac00d"})

    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(insert, {**row, "snapshot_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac00e"})

    # The same starting state authored in another shop is another shop's snapshot.
    with engine.begin() as connection:
        connection.execute(
            insert,
            {
                **row,
                "shop_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac00f",
                "snapshot_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac010",
            },
        )


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


@pytest.mark.migration
def test_two_arms_may_hold_the_same_starting_state(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The opposite of the snapshot rule: two clones sharing bytes is the point, not a
    duplicate to collapse. What the table does refuse is a negative revision."""
    database_url = f"sqlite:///{tmp_path / 'sandboxes.db'}"
    command.upgrade(alembic_config(database_url, monkeypatch), "head")
    engine = create_engine(database_url)
    insert = text(
        """
        INSERT INTO sandboxes (
            sandbox_id, shop_id, snapshot_id, label, revision,
            snapshot_fingerprint, state_fingerprint, document, created_at, updated_at
        ) VALUES (
            :sandbox_id, :shop_id, :snapshot_id, :label, :revision,
            :fingerprint, :fingerprint, '{}',
            '2026-08-25 12:00:00.000000', '2026-08-25 12:00:00.000000'
        )
        """
    )
    row = {
        "shop_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac011",
        "snapshot_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac012",
        "fingerprint": "f" * 64,
        "revision": 0,
    }
    with engine.begin() as connection:
        connection.execute(
            insert,
            {**row, "sandbox_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac013", "label": "Arm A"},
        )
        connection.execute(
            insert,
            {**row, "sandbox_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac014", "label": "Arm B"},
        )

    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(
            insert,
            {
                **row,
                "sandbox_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac015",
                "label": "Arm C",
                "revision": -1,
            },
        )


@pytest.mark.migration
def test_an_attempt_s_usage_is_whole_and_never_spent_without_a_request(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The three usage columns are written together, and tokens need a request that spent them.

    Both rules live in `ModelUsage` too, and that is exactly why the table holds them: the
    value object raises on the way *out*, so one incoherent row would make every read of the
    experiment holding it fail. Refused on the way in, the mistake stays with whoever made it.
    """
    database_url = f"sqlite:///{tmp_path / 'usage.db'}"
    command.upgrade(alembic_config(database_url, monkeypatch), "head")
    engine = create_engine(database_url)
    insert = text(
        """
        INSERT INTO experiment_agent_turns (
            run_id, ordinal, attempt, experiment_id, outcome, failure, body, created_at,
            duration_ms, input_tokens, output_tokens, model_requests
        ) VALUES (
            :run_id, :ordinal, 1, :experiment_id, 'answered', NULL, 'Noted.',
            '2026-09-01 12:00:00.000000',
            :duration_ms, :input_tokens, :output_tokens, :model_requests
        )
        """
    )
    row = {
        "run_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac021",
        "experiment_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac022",
        "duration_ms": 1000,
        "input_tokens": 0,
        "output_tokens": 0,
        "model_requests": 0,
    }
    # An attempt that called no model: zeros with zero requests, which is a measurement.
    with engine.begin() as connection:
        connection.execute(insert, {**row, "ordinal": 0})

    # Half a reading: the request count without the tokens it spent.
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(insert, {**row, "ordinal": 1, "input_tokens": None})

    # And tokens nobody asked for: a meter reading that could not have been produced.
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(insert, {**row, "ordinal": 2, "input_tokens": 40})


@pytest.mark.migration
def test_a_span_s_coordinate_means_one_thing_and_a_trace_has_one_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A stored span carries no attribute, so the sequence is the only join back to the call.

    Both rules live in `RunSpan` too, and the table holds them for the reason it holds the
    usage rules above: the value object raises on the way out, where the constraint refuses
    the row on the way in.
    """
    database_url = f"sqlite:///{tmp_path / 'spans.db'}"
    command.upgrade(alembic_config(database_url, monkeypatch), "head")
    engine = create_engine(database_url)
    insert = text(
        """
        INSERT INTO experiment_run_spans (
            run_id, span_id, experiment_id, trace_id, parent_span_id, kind, ordinal, attempt,
            sequence, started_offset_ms, duration_ms, created_at
        ) VALUES (
            :run_id, :span_id, :experiment_id, :trace_id, :parent_span_id, :kind, 0, 1,
            :sequence, :started_offset_ms, 40, '2026-09-07 12:00:00.000000'
        )
        """
    )
    row = {
        "run_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac041",
        "experiment_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac042",
        "trace_id": "b" * 32,
        "parent_span_id": None,
        "kind": "attempt",
        "sequence": None,
        "started_offset_ms": 0,
    }
    child = {**row, "parent_span_id": "a" * 16}
    with engine.begin() as connection:
        connection.execute(insert, {**row, "span_id": "a" * 16})
        connection.execute(insert, {**child, "span_id": "c" * 16, "kind": "tool", "sequence": 0})

    # A tool span with nothing to join back to the call it timed.
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(insert, {**child, "span_id": "d" * 16, "kind": "tool"})

    # And one claiming a call that is not there.
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(insert, {**child, "span_id": "e" * 16, "kind": "runtime", "sequence": 0})

    # A trace has exactly one root, and it is the attempt.
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(insert, {**row, "span_id": "f" * 16, "kind": "runtime"})

    # Nothing runs for a negative number of milliseconds.
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(insert, {**row, "span_id": "0" * 16, "started_offset_ms": -1})


@pytest.mark.migration
def test_a_proposal_is_open_or_closed_and_never_half_of_each(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The three applied columns are written together; the table refuses a half-closed row."""
    database_url = f"sqlite:///{tmp_path / 'proposals.db'}"
    command.upgrade(alembic_config(database_url, monkeypatch), "head")
    engine = create_engine(database_url)
    insert = text(
        """
        INSERT INTO sandbox_action_proposals (
            sandbox_id, confirmation, shop_id, tool, version, order_id, address_id,
            expected_revision, proposal, created_at, applied_at, applied_revision, result
        ) VALUES (
            :sandbox_id, :confirmation, :shop_id, 'orders.propose_address_change', 'v1',
            :order_id, 'home', :expected_revision, '{}', '2026-08-26 12:00:00.000000',
            :applied_at, :applied_revision, :result
        )
        """
    )
    row = {
        "sandbox_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac013",
        "shop_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac011",
        "order_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac012",
        "expected_revision": 0,
        "applied_at": None,
        "applied_revision": None,
        "result": None,
    }
    with engine.begin() as connection:
        connection.execute(insert, {**row, "confirmation": "a" * 64})

    # Applied, but with no result to replay: a row nothing could answer an idempotent
    # retry from.
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(
            insert,
            {
                **row,
                "confirmation": "b" * 64,
                "applied_at": "2026-08-26 12:00:01.000000",
                "applied_revision": 1,
            },
        )

    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(insert, {**row, "confirmation": "c" * 64, "expected_revision": -1})


@pytest.mark.migration
def test_a_run_is_filed_under_one_shelf_only_once(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The tag table's key is what makes the set a set, rather than a check the writer runs.

    Notes are the opposite and the same test says so: two reviewers who wrote the same
    sentence wrote two notes, and the store must not collapse them.
    """
    database_url = f"sqlite:///{tmp_path / 'annotations.db'}"
    command.upgrade(alembic_config(database_url, monkeypatch), "head")
    engine = create_engine(database_url)
    experiment_id = "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac031"
    tag = text("INSERT INTO experiment_tags (experiment_id, tag) VALUES (:id, :tag)")
    note = text(
        """
        INSERT INTO experiment_notes (note_id, experiment_id, body, created_at)
        VALUES (:note_id, :id, :body, '2026-09-05 12:00:00.000000')
        """
    )
    with engine.begin() as connection:
        connection.execute(tag, {"id": experiment_id, "tag": "read-check-gap"})
        connection.execute(tag, {"id": experiment_id, "tag": "two-arm"})
        connection.execute(
            note,
            {
                "note_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac032",
                "id": experiment_id,
                "body": "Worth rerunning.",
            },
        )
        connection.execute(
            note,
            {
                "note_id": "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac033",
                "id": experiment_id,
                "body": "Worth rerunning.",
            },
        )

    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(tag, {"id": experiment_id, "tag": "read-check-gap"})
