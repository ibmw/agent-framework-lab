"""Store experiments, their arms, and the customer turns each arm received."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0012"
down_revision: str | None = "20260826_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "experiments",
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("shop_id", sa.String(length=36), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("scenario_id", sa.String(length=36), nullable=False),
        sa.Column("scenario_version", sa.Integer(), nullable=False),
        sa.Column("seed", sa.BigInteger(), nullable=False),
        sa.Column("snapshot_id", sa.String(length=36), nullable=False),
        sa.Column("sandbox_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("resolution_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("participant_driver", sa.String(length=16), nullable=False),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("experiment_id"),
        sa.CheckConstraint("scenario_version >= 1", name="ck_experiments_version_positive"),
        sa.CheckConstraint("seed >= 0", name="ck_experiments_seed_non_negative"),
        sa.CheckConstraint(
            "participant_driver IN ('human', 'llm', 'scripted')",
            name="ck_experiments_participant_driver_valid",
        ),
        # No uniqueness over the resolution fingerprint, deliberately: the same scenario run
        # against the same arms twice is two experiments, the way one snapshot cloned twice
        # is two arms. Recognizing a repeat is what the fingerprint is for.
    )
    op.create_index("ix_experiments_shop", "experiments", ["shop_id", "created_at"])

    op.create_table(
        "experiment_runs",
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("shop_id", sa.String(length=36), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("agent_configuration_id", sa.String(length=36), nullable=False),
        sa.Column("agent_configuration_version", sa.Integer(), nullable=False),
        sa.Column("sandbox_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("run_id"),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.experiment_id"]),
        sa.CheckConstraint("position >= 0", name="ck_experiment_runs_position_non_negative"),
        sa.CheckConstraint(
            "agent_configuration_version >= 1",
            name="ck_experiment_runs_configuration_version_positive",
        ),
        sa.UniqueConstraint("experiment_id", "position", name="uq_experiment_runs_position"),
        # One arm works one sandbox: two runs sharing a clone would be two arms writing into
        # one world, which is the isolation ADR 0020 exists to guarantee.
        sa.UniqueConstraint("sandbox_id", name="uq_experiment_runs_sandbox"),
    )
    op.create_index(
        "ix_experiment_runs_experiment", "experiment_runs", ["experiment_id", "position"]
    )

    op.create_table(
        "experiment_participant_turns",
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("turn_id", sa.String(length=36), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("driver", sa.String(length=16), nullable=True),
        sa.Column("body", sa.String(length=4000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        # The run plus the ordinal: a turn cannot be renumbered onto another position, and a
        # run cannot receive two turns at the same depth.
        sa.PrimaryKeyConstraint("run_id", "ordinal"),
        sa.ForeignKeyConstraint(["run_id"], ["experiment_runs.run_id"]),
        sa.CheckConstraint("ordinal >= 0", name="ck_participant_turns_ordinal_non_negative"),
        sa.CheckConstraint(
            "source IN ('trigger', 'participant')", name="ck_participant_turns_source_valid"
        ),
        # The scenario authored the trigger and no driver produced it; every other turn was
        # produced by the driver the experiment recorded.
        sa.CheckConstraint(
            "(source = 'trigger') = (driver IS NULL)",
            name="ck_participant_turns_driver_matches_source",
        ),
    )
    op.create_index(
        "ix_participant_turns_experiment",
        "experiment_participant_turns",
        ["experiment_id", "created_at"],
    )
    op.create_index(
        "ix_participant_turns_composition",
        "experiment_participant_turns",
        ["experiment_id", "turn_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_participant_turns_composition", table_name="experiment_participant_turns")
    op.drop_index("ix_participant_turns_experiment", table_name="experiment_participant_turns")
    op.drop_table("experiment_participant_turns")
    op.drop_index("ix_experiment_runs_experiment", table_name="experiment_runs")
    op.drop_table("experiment_runs")
    op.drop_index("ix_experiments_shop", table_name="experiments")
    op.drop_table("experiments")
