"""Store the authored order fixtures of a shop."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824_0008"
down_revision: str | None = "20260823_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "shop_order_fixtures",
        sa.Column("shop_id", sa.String(length=36), nullable=False),
        sa.Column("order_id", sa.String(length=36), nullable=False),
        sa.Column("reference", sa.String(length=64), nullable=False),
        sa.Column("customer_profile_id", sa.String(length=36), nullable=False),
        sa.Column("content_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("shop_id", "order_id"),
        # An order reference is the business identifier support agents and customers quote,
        # so it must name exactly one order inside a shop.
        sa.UniqueConstraint("shop_id", "reference", name="uq_shop_order_fixtures_reference"),
    )
    op.create_index(
        "ix_shop_order_fixtures_customer",
        "shop_order_fixtures",
        ["shop_id", "customer_profile_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_shop_order_fixtures_customer", table_name="shop_order_fixtures")
    op.drop_table("shop_order_fixtures")
