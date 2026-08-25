"""Store the mutable sandbox clones each experiment arm works in."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260825_0010"
down_revision: str | None = "20260825_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sandboxes",
        sa.Column("sandbox_id", sa.String(length=36), nullable=False),
        sa.Column("shop_id", sa.String(length=36), nullable=False),
        sa.Column("snapshot_id", sa.String(length=36), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("snapshot_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("state_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("sandbox_id"),
        sa.CheckConstraint("revision >= 0", name="ck_sandboxes_revision_non_negative"),
        # No uniqueness over the state fingerprint, deliberately: two arms of one experiment
        # begin from the same bytes, which is the claim the comparison rests on rather than
        # a duplicate to collapse.
    )
    op.create_index("ix_sandboxes_snapshot", "sandboxes", ["shop_id", "snapshot_id"])


def downgrade() -> None:
    op.drop_index("ix_sandboxes_snapshot", table_name="sandboxes")
    op.drop_table("sandboxes")
