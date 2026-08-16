"""Store the full unsigned 32-bit scenario seed range portably."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260816_0002"
down_revision: str | None = "20260816_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("conversation_sessions") as batch_op:
        batch_op.alter_column(
            "seed",
            existing_type=sa.Integer(),
            type_=sa.BigInteger(),
            existing_nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("conversation_sessions") as batch_op:
        batch_op.alter_column(
            "seed",
            existing_type=sa.BigInteger(),
            type_=sa.Integer(),
            existing_nullable=False,
        )
