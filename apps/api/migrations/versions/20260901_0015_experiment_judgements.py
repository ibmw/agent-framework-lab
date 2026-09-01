"""Admit the judge definition, and store what it answered about each arm's judge rows."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260901_0015"
down_revision: str | None = "20260830_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PREVIOUS_TYPES = (
    "'shop', 'customer_profile', 'support_identity', 'ticket', 'scenario', "
    "'objective_block', 'mutation_block', 'agent_configuration'"
)
_DEFINITION_TYPES = f"{_PREVIOUS_TYPES}, 'judge_configuration'"


def _drafts() -> sa.Table:
    """`definition_drafts` as it stands, so SQLite knows what to copy when it rebuilds it.

    SQLite cannot alter a check constraint in place and does not reflect one either, so the
    existing definition is handed over rather than discovered — otherwise the rebuilt table
    would silently lose every constraint and index this migration is not changing.
    """
    metadata = sa.MetaData()
    table = sa.Table(
        "definition_drafts",
        metadata,
        sa.Column("definition_type", sa.String(length=32), nullable=False),
        sa.Column("definition_id", sa.String(length=36), nullable=False),
        sa.Column("shop_id", sa.String(length=36), nullable=True),
        sa.Column("references", sa.JSON(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("definition_type", "definition_id"),
        sa.CheckConstraint(
            f"definition_type IN ({_PREVIOUS_TYPES})", name="ck_definition_drafts_type_valid"
        ),
    )
    sa.Index("ix_definition_drafts_shop_id", table.c.shop_id)
    return table


def _versions() -> sa.Table:
    """`definition_versions` as it stands, for the same reason."""
    metadata = sa.MetaData()
    table = sa.Table(
        "definition_versions",
        metadata,
        sa.Column("definition_type", sa.String(length=32), nullable=False),
        sa.Column("definition_id", sa.String(length=36), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("shop_id", sa.String(length=36), nullable=True),
        sa.Column("shop_version", sa.Integer(), nullable=True),
        sa.Column("references", sa.JSON(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("definition_type", "definition_id", "version"),
        sa.CheckConstraint("version >= 1", name="ck_definition_versions_version_positive"),
        sa.CheckConstraint(
            "shop_version IS NULL OR shop_version >= 1",
            name="ck_definition_versions_shop_version_positive",
        ),
        sa.CheckConstraint(
            f"definition_type IN ({_PREVIOUS_TYPES})", name="ck_definition_versions_type_valid"
        ),
    )
    sa.Index("ix_definition_versions_definition", table.c.definition_type, table.c.definition_id)
    return table


def _retype(table: sa.Table, allowed: str) -> None:
    constraint = f"ck_{table.name}_type_valid"
    with op.batch_alter_table(table.name, copy_from=table, recreate="always") as batch:
        batch.drop_constraint(constraint, type_="check")
        batch.create_check_constraint(constraint, f"definition_type IN ({allowed})")


def _retype_all(allowed: str) -> None:
    _retype(_drafts(), allowed)
    _retype(_versions(), allowed)


def upgrade() -> None:
    # A judge is a definition like any other: one mutable draft and immutable published
    # versions, in the same two tables (ADR 0031). What has to move is the closed list of
    # types those tables accept.
    _retype_all(_DEFINITION_TYPES)
    op.create_table(
        "experiment_judgements",
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("objective_id", sa.String(length=64), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("judge_id", sa.String(length=36), nullable=False),
        sa.Column("judge_version", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("model_id", sa.String(length=200), nullable=False),
        sa.Column("brief_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=True),
        sa.Column("failure", sa.String(length=32), nullable=True),
        sa.Column("rationale", sa.String(length=2000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        # The arm, the row, and the attempt. Scoring again writes the next attempt rather
        # than replacing a verdict, so a rerun is readable as a rerun.
        sa.PrimaryKeyConstraint("run_id", "objective_id", "attempt"),
        sa.ForeignKeyConstraint(["run_id"], ["experiment_runs.run_id"]),
        sa.CheckConstraint("attempt >= 1", name="ck_judgements_attempt_positive"),
        sa.CheckConstraint("judge_version >= 1", name="ck_judgements_judge_version_positive"),
        sa.CheckConstraint(
            "outcome IS NULL OR outcome IN ('met', 'missed', 'unclear')",
            name="ck_judgements_outcome_valid",
        ),
        # An execution either produced a verdict or said why it did not; never both, never
        # neither. A row with both would let a failed judge count against the arm.
        sa.CheckConstraint(
            "(outcome IS NULL) = (failure IS NOT NULL)",
            name="ck_judgements_failure_matches_outcome",
        ),
        sa.CheckConstraint(
            "failure IS NULL OR length(rationale) = 0",
            name="ck_judgements_failure_has_no_rationale",
        ),
    )
    op.create_index(
        "ix_judgements_experiment",
        "experiment_judgements",
        ["experiment_id", "created_at"],
    )


def downgrade() -> None:
    """Drop the executions and narrow the type list back.

    Deliberately not tolerant of published judges: narrowing the check while
    `judge_configuration` rows exist fails the rebuild, which refuses to leave a definition
    behind that the schema no longer admits. A downgrade past this revision is a downgrade
    past the judge, and dropping an author's published evaluators silently would be worse
    than stopping.
    """
    op.drop_index("ix_judgements_experiment", table_name="experiment_judgements")
    op.drop_table("experiment_judgements")
    _retype_all(_PREVIOUS_TYPES)
