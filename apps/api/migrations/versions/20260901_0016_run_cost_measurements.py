"""Record how long each attempt and each tool call took, and what the provider metered."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260901_0016"
down_revision: str | None = "20260901_0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The four measurements and the six rules they carry, named once so the upgrade that adds
# them and the downgrade that removes them cannot fall out of step.
_MEASUREMENT_COLUMNS = ("duration_ms", "input_tokens", "output_tokens", "model_requests")
_AGENT_TURN_MEASUREMENT_CHECKS = (
    ("ck_agent_turns_duration_non_negative", "duration_ms IS NULL OR duration_ms >= 0"),
    ("ck_agent_turns_input_tokens_non_negative", "input_tokens IS NULL OR input_tokens >= 0"),
    ("ck_agent_turns_output_tokens_non_negative", "output_tokens IS NULL OR output_tokens >= 0"),
    (
        "ck_agent_turns_model_requests_non_negative",
        "model_requests IS NULL OR model_requests >= 0",
    ),
    # Usage is one reading or none of it. A row that knew its input tokens but not its
    # output tokens would total as if the missing half were zero.
    (
        "ck_agent_turns_usage_is_whole",
        "(input_tokens IS NULL) = (model_requests IS NULL) "
        "AND (output_tokens IS NULL) = (model_requests IS NULL)",
    ),
    # The rule the value object refuses, held here too: a row claiming tokens with no
    # request that spent them would raise on every read of the experiment holding it.
    (
        "ck_agent_turns_usage_has_a_request",
        "model_requests IS NULL OR model_requests > 0 OR (input_tokens = 0 AND output_tokens = 0)",
    ),
)
_TOOL_EVENT_MEASUREMENT_CHECK = (
    "ck_tool_events_duration_non_negative",
    "duration_ms IS NULL OR duration_ms >= 0",
)


def _agent_turns(*, measured: bool) -> sa.Table:
    """`experiment_agent_turns` before or after this revision, for SQLite to copy from.

    SQLite cannot add a check constraint to a live table, so both directions rebuild it —
    and it reflects its own constraints well enough to carry a rule about a column the
    downgrade is removing. So the definition is handed over on both sides rather than
    discovered: `measured=False` is the table this revision found, `measured=True` the one
    it leaves.
    """
    metadata = sa.MetaData()
    table = sa.Table(
        "experiment_agent_turns",
        metadata,
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column("failure", sa.String(length=32), nullable=True),
        sa.Column("body", sa.String(length=4000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        *(
            sa.Column(name, sa.Integer(), nullable=True)
            for name in (_MEASUREMENT_COLUMNS if measured else ())
        ),
        sa.PrimaryKeyConstraint("run_id", "ordinal", "attempt"),
        sa.ForeignKeyConstraint(["run_id"], ["experiment_runs.run_id"]),
        sa.CheckConstraint("ordinal >= 0", name="ck_agent_turns_ordinal_non_negative"),
        sa.CheckConstraint("attempt >= 1", name="ck_agent_turns_attempt_positive"),
        sa.CheckConstraint(
            "outcome IN ('answered', 'failed')", name="ck_agent_turns_outcome_valid"
        ),
        sa.CheckConstraint(
            "(outcome = 'failed') = (failure IS NOT NULL)",
            name="ck_agent_turns_failure_matches_outcome",
        ),
        sa.CheckConstraint(
            "(outcome = 'answered') = (length(body) > 0)",
            name="ck_agent_turns_body_matches_outcome",
        ),
        *(
            sa.CheckConstraint(condition, name=name)
            for name, condition in (_AGENT_TURN_MEASUREMENT_CHECKS if measured else ())
        ),
    )
    sa.Index("ix_agent_turns_experiment", table.c.experiment_id, table.c.created_at)
    return table


def _tool_events(*, measured: bool) -> sa.Table:
    """`experiment_tool_events` on either side of this revision, for the same reason."""
    metadata = sa.MetaData()
    name, condition = _TOOL_EVENT_MEASUREMENT_CHECK
    table = sa.Table(
        "experiment_tool_events",
        metadata,
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
        *((sa.Column("duration_ms", sa.Integer(), nullable=True),) if measured else ()),
        sa.PrimaryKeyConstraint("run_id", "ordinal", "attempt", "sequence"),
        sa.ForeignKeyConstraint(["run_id"], ["experiment_runs.run_id"]),
        sa.CheckConstraint("ordinal >= 0", name="ck_tool_events_ordinal_non_negative"),
        sa.CheckConstraint("attempt >= 1", name="ck_tool_events_attempt_positive"),
        sa.CheckConstraint("sequence >= 0", name="ck_tool_events_sequence_non_negative"),
        sa.CheckConstraint(
            "outcome IN ('success', 'refused', 'failed')", name="ck_tool_events_outcome_valid"
        ),
        sa.CheckConstraint(
            "revision_after >= revision_before", name="ck_tool_events_revision_forward"
        ),
        *((sa.CheckConstraint(condition, name=name),) if measured else ()),
    )
    sa.Index("ix_tool_events_experiment", table.c.experiment_id, table.c.created_at)
    sa.Index(
        "ix_tool_events_attempt",
        table.c.run_id,
        table.c.ordinal,
        table.c.attempt,
        table.c.sequence,
    )
    return table


def upgrade() -> None:
    # Nullable, and deliberately not defaulted to zero. An attempt recorded before the lab
    # measured genuinely has no duration and no usage, and backfilling either with a zero
    # would put a number nobody measured into a total a comparison reads.
    with op.batch_alter_table(
        "experiment_agent_turns", copy_from=_agent_turns(measured=False)
    ) as batch:
        for column in _MEASUREMENT_COLUMNS:
            batch.add_column(sa.Column(column, sa.Integer(), nullable=True))
        for name, condition in _AGENT_TURN_MEASUREMENT_CHECKS:
            batch.create_check_constraint(name, condition)

    with op.batch_alter_table(
        "experiment_tool_events", copy_from=_tool_events(measured=False)
    ) as batch:
        batch.add_column(sa.Column("duration_ms", sa.Integer(), nullable=True))
        batch.create_check_constraint(*_TOOL_EVENT_MEASUREMENT_CHECK)


def downgrade() -> None:
    with op.batch_alter_table(
        "experiment_tool_events", copy_from=_tool_events(measured=True)
    ) as batch:
        batch.drop_constraint(_TOOL_EVENT_MEASUREMENT_CHECK[0], type_="check")
        batch.drop_column("duration_ms")

    with op.batch_alter_table(
        "experiment_agent_turns", copy_from=_agent_turns(measured=True)
    ) as batch:
        for name, _condition in _AGENT_TURN_MEASUREMENT_CHECKS:
            batch.drop_constraint(name, type_="check")
        for column in reversed(_MEASUREMENT_COLUMNS):
            batch.drop_column(column)
