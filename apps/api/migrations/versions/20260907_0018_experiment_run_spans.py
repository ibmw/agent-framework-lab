"""Store the span tree of each attempt, which the record cannot answer for afterwards."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260907_0018"
down_revision: str | None = "20260905_0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "experiment_run_spans",
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("span_id", sa.String(length=16), nullable=False),
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("trace_id", sa.String(length=32), nullable=False),
        sa.Column("parent_span_id", sa.String(length=16), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=True),
        sa.Column("started_offset_ms", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        # The arm and the span. A span id is unique inside its trace and a trace belongs to
        # one arm, so the pair is the identity of one row without a surrogate.
        sa.PrimaryKeyConstraint("run_id", "span_id"),
        sa.ForeignKeyConstraint(["run_id"], ["experiment_runs.run_id"]),
        sa.CheckConstraint("ordinal >= 0", name="ck_run_spans_ordinal_non_negative"),
        sa.CheckConstraint("attempt >= 1", name="ck_run_spans_attempt_positive"),
        sa.CheckConstraint(
            "kind IN ('attempt', 'runtime', 'tool')", name="ck_run_spans_kind_valid"
        ),
        sa.CheckConstraint(
            "started_offset_ms >= 0", name="ck_run_spans_started_offset_non_negative"
        ),
        sa.CheckConstraint("duration_ms >= 0", name="ck_run_spans_duration_non_negative"),
        # The two rules that keep the coordinate meaning one thing. A span carries no
        # attribute bag, so what it was about is joined through `sequence` back to the tool
        # event: a tool span without one could not be tied to the call it timed, and a
        # non-tool span with one would claim a call that is not there.
        sa.CheckConstraint(
            "(kind = 'tool') = (sequence IS NOT NULL)", name="ck_run_spans_sequence_matches_kind"
        ),
        sa.CheckConstraint(
            "sequence IS NULL OR sequence >= 0", name="ck_run_spans_sequence_non_negative"
        ),
        sa.CheckConstraint(
            "(kind = 'attempt') = (parent_span_id IS NULL)", name="ck_run_spans_one_root"
        ),
    )
    op.create_index(
        "ix_run_spans_experiment", "experiment_run_spans", ["experiment_id", "created_at"]
    )
    # One attempt's spans in the order they started, which is the order a waterfall draws
    # them and the only order this table is ever read in.
    op.create_index(
        "ix_run_spans_attempt",
        "experiment_run_spans",
        ["run_id", "ordinal", "attempt", "started_offset_ms"],
    )


def downgrade() -> None:
    op.drop_index("ix_run_spans_attempt", table_name="experiment_run_spans")
    op.drop_index("ix_run_spans_experiment", table_name="experiment_run_spans")
    op.drop_table("experiment_run_spans")
