"""Record which shops use a shop-independent definition."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260823_0007"
down_revision: str | None = "20260823_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Only shop-independent definitions can be attached: a ticket or scenario already carries
# its owning shop on the definition itself.
_ATTACHABLE_TYPES = "'customer_profile', 'support_identity'"


def upgrade() -> None:
    op.create_table(
        "definition_shop_attachments",
        sa.Column("definition_type", sa.String(length=32), nullable=False),
        sa.Column("definition_id", sa.String(length=36), nullable=False),
        sa.Column("shop_id", sa.String(length=36), nullable=False),
        sa.Column("attached_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("definition_type", "definition_id", "shop_id"),
        sa.CheckConstraint(
            f"definition_type IN ({_ATTACHABLE_TYPES})",
            name="ck_definition_shop_attachments_type_valid",
        ),
    )
    op.create_index(
        "ix_definition_shop_attachments_shop",
        "definition_shop_attachments",
        ["definition_type", "shop_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_definition_shop_attachments_shop", table_name="definition_shop_attachments")
    op.drop_table("definition_shop_attachments")
