"""Record the changes proposed against one arm, and the single result of applying each."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260826_0011"
down_revision: str | None = "20260825_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sandbox_action_proposals",
        sa.Column("sandbox_id", sa.String(length=36), nullable=False),
        sa.Column("confirmation", sa.String(length=64), nullable=False),
        sa.Column("shop_id", sa.String(length=36), nullable=False),
        sa.Column("tool", sa.String(length=120), nullable=False),
        sa.Column("version", sa.String(length=20), nullable=False),
        sa.Column("order_id", sa.String(length=36), nullable=False),
        sa.Column("address_id", sa.String(length=64), nullable=False),
        sa.Column("expected_revision", sa.Integer(), nullable=False),
        sa.Column("proposal", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("applied_revision", sa.Integer(), nullable=True),
        sa.Column("result", sa.JSON(), nullable=True),
        # The arm and the confirmation together. The confirmation is the hash of the change,
        # so two arms proposing the same change against the same state mint the same name on
        # purpose; keying by arm as well is what keeps a name minted in one arm from being a
        # proposal in the arm beside it.
        sa.PrimaryKeyConstraint("sandbox_id", "confirmation"),
        sa.CheckConstraint(
            "expected_revision >= 0", name="ck_sandbox_action_proposals_revision_non_negative"
        ),
        # A row is open or closed, never half of each: the three applied columns are written
        # together or not at all.
        sa.CheckConstraint(
            "(applied_at IS NULL) = (result IS NULL) "
            "AND (applied_at IS NULL) = (applied_revision IS NULL)",
            name="ck_sandbox_action_proposals_applied_together",
        ),
    )
    op.create_index(
        "ix_sandbox_action_proposals_sandbox",
        "sandbox_action_proposals",
        ["sandbox_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_sandbox_action_proposals_sandbox", table_name="sandbox_action_proposals")
    op.drop_table("sandbox_action_proposals")
