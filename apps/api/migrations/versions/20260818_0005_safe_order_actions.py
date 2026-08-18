"""Persist safe order-action proposals and immutable order snapshots."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260818_0005"
down_revision: str | None = "20260818_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("generated_scenario_orders") as batch:
        batch.add_column(sa.Column("customer_id", sa.String(length=36), nullable=True))
        batch.add_column(sa.Column("status", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("version", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("created_at", sa.DateTime(timezone=True), nullable=True))

    connection = op.get_bind()
    connection.execute(
        sa.text(
            """
            UPDATE generated_scenario_orders
            SET customer_id = (SELECT customer_id FROM orders WHERE orders.id = order_id),
                status = (SELECT status FROM orders WHERE orders.id = order_id),
                version = (SELECT version FROM orders WHERE orders.id = order_id),
                created_at = (SELECT created_at FROM orders WHERE orders.id = order_id)
            """
        )
    )
    with op.batch_alter_table("generated_scenario_orders") as batch:
        batch.alter_column("customer_id", existing_type=sa.String(length=36), nullable=False)
        batch.alter_column("status", existing_type=sa.String(length=32), nullable=False)
        batch.alter_column("version", existing_type=sa.Integer(), nullable=False)
        batch.alter_column("created_at", existing_type=sa.DateTime(timezone=True), nullable=False)

    op.create_table(
        "action_proposals",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("action_type", sa.String(length=64), nullable=False),
        sa.Column("tool_name", sa.String(length=100), nullable=False),
        sa.Column("tool_version", sa.String(length=64), nullable=False),
        sa.Column("order_id", sa.String(length=36), nullable=False),
        sa.Column("expected_version", sa.Integer(), nullable=False),
        sa.Column("summary", sa.String(length=1000), nullable=False),
        sa.Column("confirmation_token", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("result_order_status", sa.String(length=32), nullable=True),
        sa.Column("result_order_version", sa.Integer(), nullable=True),
        sa.CheckConstraint(
            "status IN ('proposed', 'confirmed', 'cancelled', 'executed')",
            name="ck_action_proposals_status_valid",
        ),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"]),
        sa.ForeignKeyConstraint(["session_id"], ["conversation_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_action_proposals_session_id", "action_proposals", ["session_id"], unique=False
    )


def downgrade() -> None:
    connection = op.get_bind()
    blockers: list[str] = []
    if connection.scalar(sa.text("SELECT 1 FROM action_proposals LIMIT 1")) is not None:
        blockers.append("action_proposals")
    if connection.scalar(sa.text("SELECT 1 FROM generated_scenario_orders LIMIT 1")) is not None:
        blockers.append("generated_scenario_orders")
    if blockers:
        raise RuntimeError(
            "refusing to downgrade safe order actions because an older schema cannot safely "
            f"represent current state: {', '.join(blockers)}"
        )
    op.drop_index("ix_action_proposals_session_id", table_name="action_proposals")
    op.drop_table("action_proposals")
    with op.batch_alter_table("generated_scenario_orders") as batch:
        batch.drop_column("created_at")
        batch.drop_column("version")
        batch.drop_column("status")
        batch.drop_column("customer_id")
