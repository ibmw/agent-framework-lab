"""Store what each arm's agent answered and every tool call it made getting there."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260829_0013"
down_revision: str | None = "20260828_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "experiment_agent_turns",
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column("failure", sa.String(length=32), nullable=True),
        sa.Column("body", sa.String(length=4000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        # The run, the customer turn being answered, and the attempt. An arm holds one
        # answer per question, and a retry after a failure is a new row rather than an
        # overwrite of the evidence it is retrying.
        sa.PrimaryKeyConstraint("run_id", "ordinal", "attempt"),
        sa.ForeignKeyConstraint(["run_id"], ["experiment_runs.run_id"]),
        sa.CheckConstraint("ordinal >= 0", name="ck_agent_turns_ordinal_non_negative"),
        sa.CheckConstraint("attempt >= 1", name="ck_agent_turns_attempt_positive"),
        sa.CheckConstraint(
            "outcome IN ('answered', 'failed')", name="ck_agent_turns_outcome_valid"
        ),
        # An answered turn is words with no failure code; a failed one is a code with no
        # words. A framework's exception text is not something the agent said.
        sa.CheckConstraint(
            "(outcome = 'failed') = (failure IS NOT NULL)",
            name="ck_agent_turns_failure_matches_outcome",
        ),
        sa.CheckConstraint(
            "(outcome = 'answered') = (length(body) > 0)",
            name="ck_agent_turns_body_matches_outcome",
        ),
    )
    op.create_index(
        "ix_agent_turns_experiment", "experiment_agent_turns", ["experiment_id", "created_at"]
    )

    op.create_table(
        "experiment_tool_events",
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("tool", sa.String(length=80), nullable=False),
        sa.Column("version", sa.String(length=16), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("revision_before", sa.Integer(), nullable=False),
        sa.Column("revision_after", sa.Integer(), nullable=False),
        sa.Column("state_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        # The attempt that made the call plus the order the agent asked in. Two calls inside
        # one attempt share a moment, so a timestamp could not have ordered them.
        sa.PrimaryKeyConstraint("run_id", "ordinal", "attempt", "sequence"),
        sa.ForeignKeyConstraint(["run_id"], ["experiment_runs.run_id"]),
        sa.CheckConstraint("ordinal >= 0", name="ck_tool_events_ordinal_non_negative"),
        sa.CheckConstraint("attempt >= 1", name="ck_tool_events_attempt_positive"),
        sa.CheckConstraint("sequence >= 0", name="ck_tool_events_sequence_non_negative"),
        sa.CheckConstraint(
            "outcome IN ('success', 'refused', 'failed')", name="ck_tool_events_outcome_valid"
        ),
        # A sandbox revision only moves forward (ADR 0020), so a call that reported it going
        # backwards would be a record of something that cannot have happened.
        sa.CheckConstraint(
            "revision_after >= revision_before", name="ck_tool_events_revision_forward"
        ),
    )
    op.create_index(
        "ix_tool_events_experiment", "experiment_tool_events", ["experiment_id", "created_at"]
    )
    op.create_index(
        "ix_tool_events_attempt",
        "experiment_tool_events",
        ["run_id", "ordinal", "attempt", "sequence"],
    )


def downgrade() -> None:
    op.drop_index("ix_tool_events_attempt", table_name="experiment_tool_events")
    op.drop_index("ix_tool_events_experiment", table_name="experiment_tool_events")
    op.drop_table("experiment_tool_events")
    op.drop_index("ix_agent_turns_experiment", table_name="experiment_agent_turns")
    op.drop_table("experiment_agent_turns")
