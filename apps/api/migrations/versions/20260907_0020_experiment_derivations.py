"""Generalize the replay's provenance into a derivation that records its kind."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260907_0020"
down_revision: str | None = "20260907_0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Built beside the old table and filled from it rather than altered in place. SQLite
    # rewrites a table to add a constraint anyway, and both the check constraint and the
    # table itself are renamed here — a batch alter would have left the old names on the
    # new shape, which is the kind of drift a migration is supposed to remove.
    op.create_table(
        "experiment_derivations",
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("source_experiment_id", sa.String(length=36), nullable=False),
        # How this run was derived: `replay` re-ran the versions its source pinned, `fork`
        # moved them on purpose. Recorded rather than inferred, because a fork whose chosen
        # versions happen to compare equal is still a fork.
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        # The derived experiment alone. It is derived by the one act that created it, so a
        # second row here would be a second story about where it came from.
        sa.PrimaryKeyConstraint("experiment_id"),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.experiment_id"]),
        sa.ForeignKeyConstraint(["source_experiment_id"], ["experiments.experiment_id"]),
        # An experiment cannot be derived from itself: the source has to exist before the
        # derived one is written, so a self-reference is a corrupted row rather than a loop
        # anybody could have created.
        sa.CheckConstraint(
            "experiment_id <> source_experiment_id", name="ck_experiment_derivations_distinct"
        ),
        # The kind is a closed vocabulary, held here as every other one in this schema is
        # (`ck_experiments_participant_driver_valid`, `ck_run_spans_kind_valid`). A stray
        # value would not be a bad row in isolation: reading it back raises on the way to a
        # `DerivationKind`, which would take out the experiment's own screen and the whole
        # cross-shop listing that projects every run through it.
        sa.CheckConstraint(
            "kind IN ('replay', 'fork')", name="ck_experiment_derivations_kind_valid"
        ),
    )
    # Every row written before this migration was written by the only operation that could
    # write one, so the kind is known rather than defaulted.
    op.execute(
        sa.text(
            "INSERT INTO experiment_derivations "
            "(experiment_id, source_experiment_id, kind, created_at) "
            "SELECT experiment_id, source_experiment_id, 'replay', created_at "
            "FROM experiment_replays"
        )
    )
    op.drop_table("experiment_replays")


def downgrade() -> None:
    # The schema this returns to has no shape for a fork, so it refuses rather than dropping
    # the rows — the rule ADR 0003's migration set: a downgrade that cannot represent the
    # data it holds says so instead of quietly discarding it.
    connection = op.get_bind()
    if (
        connection.scalar(sa.text("SELECT 1 FROM experiment_derivations WHERE kind = 'fork'"))
        is not None
    ):
        raise RuntimeError(
            "refusing to downgrade experiment derivations because the old schema cannot "
            "represent a fork; delete the forked experiments and their derivation rows "
            "before retrying"
        )
    op.create_table(
        "experiment_replays",
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("source_experiment_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("experiment_id"),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.experiment_id"]),
        sa.ForeignKeyConstraint(["source_experiment_id"], ["experiments.experiment_id"]),
        sa.CheckConstraint(
            "experiment_id <> source_experiment_id", name="ck_experiment_replays_distinct"
        ),
    )
    op.execute(
        sa.text(
            "INSERT INTO experiment_replays (experiment_id, source_experiment_id, created_at) "
            "SELECT experiment_id, source_experiment_id, created_at FROM experiment_derivations"
        )
    )
    op.drop_table("experiment_derivations")
