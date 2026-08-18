"""Persist framework-neutral support conversation turns."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260818_0004"
down_revision: str | None = "20260816_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("conversation_sessions") as batch:
        batch.add_column(
            sa.Column(
                "scenario_id",
                sa.String(length=64),
                nullable=False,
                server_default="retail-profile",
            )
        )
        batch.add_column(
            sa.Column("framework_id", sa.String(length=64), nullable=False, server_default="fake")
        )

    op.create_table(
        "conversation_turns",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("request_message", sa.String(length=4000), nullable=False),
        sa.Column("response_message", sa.String(length=8000), nullable=False),
        sa.Column("structured_result", sa.JSON(), nullable=False),
        sa.Column("tool_activity", sa.JSON(), nullable=False),
        sa.Column("trace_id", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["conversation_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "ordinal", name="uq_conversation_turns_ordinal"),
    )
    op.create_index(
        "ix_conversation_turns_session_id",
        "conversation_turns",
        ["session_id"],
        unique=False,
    )


def downgrade() -> None:
    connection = op.get_bind()
    blockers = [
        table_name
        for table_name in (
            "conversation_turns",
            "conversation_sessions",
            "generated_scenario_orders",
            "generated_scenario_products",
            "generated_scenarios",
            "personas",
        )
        if connection.scalar(sa.text(f"SELECT 1 FROM {table_name} LIMIT 1")) is not None
    ]
    if (
        connection.scalar(
            sa.text(
                "SELECT 1 FROM idempotency_records WHERE operation = 'generate_scenario_v1' LIMIT 1"
            )
        )
        is not None
    ):
        blockers.append("idempotency_records(generate_scenario_v1)")
    for column_name, query in (
        ("products.sku", "SELECT 1 FROM products GROUP BY sku HAVING count(*) > 1 LIMIT 1"),
        (
            "customers.email",
            "SELECT 1 FROM customers GROUP BY email HAVING count(*) > 1 LIMIT 1",
        ),
    ):
        if connection.scalar(sa.text(query)) is not None:
            blockers.append(f"duplicate values in {column_name}")
    if blockers:
        raise RuntimeError(
            "refusing to downgrade support-conversation persistence because an older schema "
            f"cannot safely represent current state: {', '.join(blockers)}"
        )

    op.drop_index("ix_conversation_turns_session_id", table_name="conversation_turns")
    op.drop_table("conversation_turns")
    with op.batch_alter_table("conversation_sessions") as batch:
        batch.drop_column("framework_id")
        batch.drop_column("scenario_id")
