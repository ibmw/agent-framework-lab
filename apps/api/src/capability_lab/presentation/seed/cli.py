"""`make seed`: the command itself, and the only thing that reads or writes a terminal.

Kept to argument parsing, exit codes and printing, so that everything worth testing is
testable without a process. A refusal is exit code 1 with the reason on stderr, because the
operator has something to do about it; anything else is the seed having run.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections.abc import Sequence
from pathlib import Path

from capability_lab.infrastructure.config import Settings, get_settings
from capability_lab.presentation.seed.demo import DemoSeed
from capability_lab.presentation.seed.runner import (
    SeedRefusedError,
    default_alembic_config,
    run_seed,
)

__all__ = ["main"]


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="agent-lab-seed",
        description=(
            "Fill an empty database with one complete demo: the wrong-address incident, "
            "authored end to end and run offline under both agent frameworks."
        ),
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help=(
            "Where to write. Defaults to the configured AGENT_LAB_DATABASE_URL, which is "
            "the same database `make migrate` and `make dev-api` use."
        ),
    )
    parser.add_argument(
        "--alembic-config",
        default=None,
        type=Path,
        help="Path to alembic.ini, used to check the database is at this build's head.",
    )
    return parser


def _report(seeded: DemoSeed, database_url: str) -> str:
    return "\n".join(
        (
            f"Seeded {database_url}.",
            "",
            f"  shop                {seeded.shop_id}",
            f"  customer            {seeded.customer_id}",
            f"  support identity    {seeded.support_identity_id}",
            f"  order               {seeded.order_id}",
            f"  ticket              {seeded.ticket_id}",
            f"  scenario            {seeded.scenario_id} v{seeded.scenario_version}",
            f"  snapshot            {seeded.snapshot_id}",
            f"  judge               {seeded.judge_id}",
            *(
                f"  agent configuration {configuration_id}"
                for configuration_id in seeded.configuration_ids
            ),
            f"  experiment          {seeded.experiment_id}",
            *(f"  run                 {run_id}" for run_id in seeded.run_ids),
            "",
            "Start the stack with `make dev-api` and `make dev-web`; the experiment is on "
            "the history screen.",
        )
    )


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    settings = _settings(arguments.database_url)
    alembic_config = arguments.alembic_config or default_alembic_config()
    try:
        seeded, database_url = asyncio.run(run_seed(settings, alembic_config=alembic_config))
    except SeedRefusedError as refusal:
        print(f"Refusing to seed: {refusal}", file=sys.stderr)
        return 1
    print(_report(seeded, database_url))
    return 0


def _settings(database_url: str | None) -> Settings:
    """The process's own configuration, with the one thing the command may override."""
    settings = get_settings()
    return (
        settings
        if database_url is None
        else settings.model_copy(update={"database_url": database_url})
    )


if __name__ == "__main__":  # pragma: no cover - the console entry point
    raise SystemExit(main())
