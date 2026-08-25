"""Store the canonical sandbox snapshots materialized from scenario versions."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260825_0009"
down_revision: str | None = "20260824_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sandbox_snapshots",
        sa.Column("snapshot_id", sa.String(length=36), nullable=False),
        sa.Column("shop_id", sa.String(length=36), nullable=False),
        sa.Column("scenario_id", sa.String(length=36), nullable=False),
        sa.Column("scenario_version", sa.Integer(), nullable=False),
        sa.Column("seed", sa.BigInteger(), nullable=False),
        sa.Column("sandbox_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("snapshot_id"),
        sa.CheckConstraint("scenario_version >= 1", name="ck_sandbox_snapshots_version_positive"),
        sa.CheckConstraint("seed >= 0", name="ck_sandbox_snapshots_seed_non_negative"),
        # Identical starting state is one snapshot. Scoped to the shop rather than global
        # because a snapshot belongs to the shop whose objects it froze.
        sa.UniqueConstraint(
            "shop_id", "sandbox_fingerprint", name="uq_sandbox_snapshots_fingerprint"
        ),
    )
    op.create_index(
        "ix_sandbox_snapshots_scenario",
        "sandbox_snapshots",
        ["shop_id", "scenario_id", "scenario_version"],
    )


def downgrade() -> None:
    op.drop_index("ix_sandbox_snapshots_scenario", table_name="sandbox_snapshots")
    op.drop_table("sandbox_snapshots")
