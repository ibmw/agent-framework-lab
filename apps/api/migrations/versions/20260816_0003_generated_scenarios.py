"""Persist personas and versioned generated initial state."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260816_0003"
down_revision: str | None = "20260816_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    naming_convention = {"uq": "uq_%(table_name)s_%(column_0_name)s"}
    with op.batch_alter_table("customers", naming_convention=naming_convention) as batch_op:
        batch_op.drop_constraint("uq_customers_email", type_="unique")
    with op.batch_alter_table("products", naming_convention=naming_convention) as batch_op:
        batch_op.drop_constraint("uq_products_sku", type_="unique")

    op.create_table(
        "personas",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("locale", sa.String(length=32), nullable=False),
        sa.Column("support_traits", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "generated_scenarios",
        sa.Column("initial_state_hash", sa.String(length=64), nullable=False),
        sa.Column("scenario_id", sa.String(length=64), nullable=False),
        sa.Column("scenario_version", sa.String(length=64), nullable=False),
        sa.Column("policy_set_version", sa.String(length=64), nullable=False),
        sa.Column("canonical_schema_version", sa.String(length=64), nullable=False),
        sa.Column("seed", sa.BigInteger(), nullable=False),
        sa.Column("persona_id", sa.String(length=36), nullable=False),
        sa.Column("customer_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "seed >= 0 AND seed <= 4294967295",
            name="ck_generated_seed_range",
        ),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
        sa.ForeignKeyConstraint(["persona_id"], ["personas.id"]),
        sa.PrimaryKeyConstraint("initial_state_hash"),
        sa.UniqueConstraint(
            "scenario_id",
            "scenario_version",
            "seed",
            name="uq_generated_scenarios_reference",
        ),
    )
    op.create_table(
        "generated_scenario_products",
        sa.Column("initial_state_hash", sa.String(length=64), nullable=False),
        sa.Column("product_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(
            ["initial_state_hash"],
            ["generated_scenarios.initial_state_hash"],
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.PrimaryKeyConstraint("initial_state_hash", "product_id"),
    )
    op.create_table(
        "generated_scenario_orders",
        sa.Column("initial_state_hash", sa.String(length=64), nullable=False),
        sa.Column("order_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(
            ["initial_state_hash"],
            ["generated_scenarios.initial_state_hash"],
        ),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"]),
        sa.PrimaryKeyConstraint("initial_state_hash", "order_id"),
    )


def downgrade() -> None:
    connection = op.get_bind()
    blockers = [
        table_name
        for table_name in (
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

    duplicate_columns = [
        column_name
        for column_name, query in (
            (
                "products.sku",
                "SELECT 1 FROM products GROUP BY sku HAVING count(*) > 1 LIMIT 1",
            ),
            (
                "customers.email",
                "SELECT 1 FROM customers GROUP BY email HAVING count(*) > 1 LIMIT 1",
            ),
        )
        if connection.scalar(sa.text(query)) is not None
    ]
    blockers.extend(f"duplicate values in {column}" for column in duplicate_columns)
    if blockers:
        reasons = ", ".join(blockers)
        raise RuntimeError(
            "refusing to downgrade generated-scenario persistence because the old schema cannot "
            f"represent the current data: {reasons}; remove generated feature data and resolve "
            "duplicate product SKUs and customer emails before retrying"
        )

    op.drop_table("generated_scenario_orders")
    op.drop_table("generated_scenario_products")
    op.drop_table("generated_scenarios")
    op.drop_table("personas")
    with op.batch_alter_table("products") as batch_op:
        batch_op.create_unique_constraint("uq_products_sku", ["sku"])
    with op.batch_alter_table("customers") as batch_op:
        batch_op.create_unique_constraint("uq_customers_email", ["email"])
