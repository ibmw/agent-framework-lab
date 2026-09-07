"""Record that one experiment was derived by replaying another."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260907_0019"
down_revision: str | None = "20260907_0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "experiment_replays",
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("source_experiment_id", sa.String(length=36), nullable=False),
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
            "experiment_id <> source_experiment_id", name="ck_experiment_replays_distinct"
        ),
    )


def downgrade() -> None:
    op.drop_table("experiment_replays")
