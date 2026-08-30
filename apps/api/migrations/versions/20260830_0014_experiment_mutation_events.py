"""Store the scenario faults that fired into each arm and what they moved."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260830_0014"
down_revision: str | None = "20260829_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "experiment_mutation_events",
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("mutation_id", sa.String(length=64), nullable=False),
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("block_id", sa.String(length=36), nullable=False),
        sa.Column("block_version", sa.Integer(), nullable=False),
        sa.Column("effect", sa.String(length=32), nullable=False),
        sa.Column("timing", sa.String(length=64), nullable=False),
        sa.Column("target", sa.String(length=128), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("after_calls", sa.Integer(), nullable=False),
        sa.Column("revision_before", sa.Integer(), nullable=False),
        sa.Column("revision_after", sa.Integer(), nullable=False),
        sa.Column("state_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        # The arm and the bound fault. A scenario's mutation happens to a world once: the
        # key is the once-per-arm rule rather than a check the runtime has to remember.
        sa.PrimaryKeyConstraint("run_id", "mutation_id"),
        sa.ForeignKeyConstraint(["run_id"], ["experiment_runs.run_id"]),
        sa.CheckConstraint("ordinal >= 0", name="ck_mutation_events_ordinal_non_negative"),
        sa.CheckConstraint("attempt >= 1", name="ck_mutation_events_attempt_positive"),
        sa.CheckConstraint("after_calls >= 0", name="ck_mutation_events_after_calls_non_negative"),
        sa.CheckConstraint("block_version >= 1", name="ck_mutation_events_block_version_positive"),
        # A firing moved the arm. One that changed nothing is not recorded at all, so a row
        # claiming an unchanged revision would describe something that did not happen.
        sa.CheckConstraint(
            "revision_after > revision_before", name="ck_mutation_events_revision_forward"
        ),
    )
    op.create_index(
        "ix_mutation_events_experiment",
        "experiment_mutation_events",
        ["experiment_id", "created_at"],
    )
    op.create_index(
        "ix_mutation_events_arm",
        "experiment_mutation_events",
        ["run_id", "ordinal", "attempt", "after_calls"],
    )


def downgrade() -> None:
    op.drop_index("ix_mutation_events_arm", table_name="experiment_mutation_events")
    op.drop_index("ix_mutation_events_experiment", table_name="experiment_mutation_events")
    op.drop_table("experiment_mutation_events")
