"""What the command does before and around the story: refuse, compose, write, report.

Two refusals sit in front of the seed, and both of them exist because the alternative is
worse than doing nothing. A database that is not at the migration head would be seeded into
a schema the build no longer describes, and the failure would surface later as something
unrelated. A database that already holds a demo would have to be merged with, wiped, or
written over, and this project refuses rather than guesses: the operator is told exactly
what is in the way and how to get rid of it.

Nothing here upserts, truncates or deletes. `make seed` on a database with anything in it
does not run.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, func, inspect, select
from sqlalchemy.orm import Session

from capability_lab.application.agent_runtime import SupportAgentRuntimeRegistry
from capability_lab.application.judge_runtime import JudgeRuntimeRegistry
from capability_lab.infrastructure import models
from capability_lab.infrastructure.agents.scripted import incident_runtimes
from capability_lab.infrastructure.clock import SteppingClock
from capability_lab.infrastructure.config import Settings
from capability_lab.infrastructure.database import (
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.judges import ControlJudgeRuntime
from capability_lab.infrastructure.telemetry import create_run_tracer, create_telemetry
from capability_lab.presentation.seed.demo import DemoSeed, seed_demo
from capability_lab.presentation.seed.services import build_services

__all__ = [
    "DatabaseNotEmptyError",
    "DatabaseNotMigratedError",
    "SeedRefusedError",
    "default_alembic_config",
    "head_revision",
    "occupied_tables",
    "run_seed",
]

DEMO_STARTS_AT = datetime(2026, 8, 24, 9, 0, tzinfo=UTC)
"""When the demo's run happened: three days after the customer opened the ticket."""

# Every table the story writes, in the order the chain builds them. The seed refuses if any
# of them holds a row, and names the ones that do. The POC's own tables are deliberately not
# here: the seed writes none of them, so rows left over from the persona-first prototype are
# not something it would be overwriting.
SEEDED_TABLES: tuple[str, ...] = (
    "definition_drafts",
    "definition_versions",
    "definition_shop_attachments",
    "shop_order_fixtures",
    "sandbox_snapshots",
    "sandboxes",
    "sandbox_action_proposals",
    "experiments",
    "experiment_runs",
    "experiment_participant_turns",
    "experiment_agent_turns",
    "experiment_tool_events",
    "experiment_mutation_events",
    "experiment_run_spans",
    "experiment_judgements",
    "experiment_derivations",
    "experiment_notes",
    "experiment_tags",
)


class SeedRefusedError(RuntimeError):
    """The seed declined to run, and says what the operator should do instead."""


class DatabaseNotMigratedError(SeedRefusedError):
    """The database is missing the schema, or is not at the revision this build expects."""


class DatabaseNotEmptyError(SeedRefusedError):
    """The database already holds authored or recorded rows, and none are overwritten."""

    def __init__(self, occupied: tuple[tuple[str, int], ...], database_url: str) -> None:
        listing = ", ".join(f"{table} ({rows})" for table, rows in occupied)
        super().__init__(
            f"{database_url} already holds seeded data: {listing}. The seed writes one "
            "complete example into an empty database and never merges with, overwrites or "
            "deletes what is already there. To start again, delete the database file this "
            "URL points at and run `make migrate` before `make seed`."
        )
        self.occupied = occupied


def occupied_tables(session: Session) -> tuple[tuple[str, int], ...]:
    """Every table the seed writes that already holds rows, with how many."""
    tables = models.CustomerModel.metadata.tables
    occupied: list[tuple[str, int]] = []
    for name in SEEDED_TABLES:
        table = tables.get(name)
        if table is None:  # pragma: no cover - SEEDED_TABLES names the mapped tables
            continue
        rows = session.scalar(select(func.count()).select_from(table)) or 0
        if rows:
            occupied.append((name, rows))
    return tuple(occupied)


def _require_migrated(engine: Engine, alembic_config: Path | None) -> None:
    """Refuse a database that has no schema, or one the build has moved on from."""
    inspector = inspect(engine)
    present = set(inspector.get_table_names())
    if "alembic_version" not in present or not present.issuperset(SEEDED_TABLES):
        raise DatabaseNotMigratedError(
            "this database has not been migrated. Run `make migrate` first."
        )
    with engine.connect() as connection:
        stamped = connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalars()
        revisions = set(stamped.all())
    expected = head_revision(alembic_config)
    if expected is not None and revisions != {expected}:
        raise DatabaseNotMigratedError(
            f"this database is stamped {sorted(revisions) or ['nothing']} but this build's "
            f"migration head is {expected}. Run `make migrate` first, and delete the "
            "database file if the migrations cannot be applied to it."
        )


def head_revision(alembic_config: Path | None) -> str | None:
    """The revision this checkout's migrations end at, when they can be located.

    Returned rather than raised when the configuration is not where it was expected: the
    package can legitimately be installed without the migration tree beside it, and a seed
    that refused to run because it could not find a file it only wanted for a warning would
    be refusing for the wrong reason. The schema check above still stands in that case.
    """
    if alembic_config is None or not alembic_config.is_file():
        return None
    return ScriptDirectory.from_config(Config(str(alembic_config))).get_current_head()


def default_alembic_config() -> Path | None:
    """`apps/api/alembic.ini`, as the Makefile names it and as the package sits beside it."""
    for candidate in (
        Path("apps/api/alembic.ini"),
        Path(__file__).resolve().parents[4] / "alembic.ini",
    ):
        if candidate.is_file():
            return candidate
    return None


def _control_judge() -> JudgeRuntimeRegistry:
    control = ControlJudgeRuntime()
    return JudgeRuntimeRegistry({control.provider: control})


@dataclass(frozen=True, slots=True)
class _Composition:
    """What this command is, as opposed to what the API is: offline, and fixed in time."""

    runtimes: SupportAgentRuntimeRegistry
    judges: JudgeRuntimeRegistry


def _compose() -> _Composition:
    """The two frameworks the demo compares, and the judge that scores it — all offline.

    Exactly the two model-backed frameworks and nothing else, because the demo's whole
    point is a comparison between them. Each runs its real adapter against a double at its
    own provider-neutral seam (`infrastructure/agents/scripted`), so no credential is read,
    no request leaves the machine, and the record is the same one every time. Composition is
    the only place that could have chosen otherwise, which is why this is the only place it
    is decided.
    """
    return _Composition(
        runtimes=SupportAgentRuntimeRegistry(
            {runtime.framework_id: runtime for runtime in incident_runtimes()}
        ),
        judges=_control_judge(),
    )


async def run_seed(
    settings: Settings, *, alembic_config: Path | None = None
) -> tuple[DemoSeed, str]:
    """Refuse or seed the database this process is configured for, and say which one it was.

    Answers with the database URL beside the result so the command can name the file it
    wrote, which is the one thing an operator has to know afterwards.
    """
    database_url = settings.database_url
    engine = create_database_engine(database_url)
    try:
        _require_migrated(engine, alembic_config)
        factory = create_session_factory(engine)
        with session_scope(factory) as session:
            occupied = occupied_tables(session)
            if occupied:
                raise DatabaseNotEmptyError(occupied, database_url)

        composition = _compose()
        configured = create_telemetry(settings)
        try:
            with session_scope(factory) as session:
                # One session and one transaction for the whole story: a seed that failed
                # halfway would otherwise leave a partly authored shop behind and then
                # refuse to run again because the database was no longer empty.
                seeded = await seed_demo(
                    build_services(
                        session,
                        SteppingClock(DEMO_STARTS_AT),
                        composition.runtimes,
                        composition.judges,
                        create_run_tracer(configured),
                    )
                )
        finally:
            configured.shutdown()
    finally:
        engine.dispose()
    return seeded, database_url
