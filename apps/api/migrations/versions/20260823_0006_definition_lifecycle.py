"""Persist authorable definition drafts and immutable published versions."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260823_0006"
down_revision: str | None = "20260818_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DEFINITION_TYPES = (
    "'shop', 'customer_profile', 'support_identity', 'ticket', 'scenario', "
    "'objective_block', 'mutation_block', 'agent_configuration'"
)


def upgrade() -> None:
    op.create_table(
        "definition_drafts",
        sa.Column("definition_type", sa.String(length=32), nullable=False),
        sa.Column("definition_id", sa.String(length=36), nullable=False),
        sa.Column("shop_id", sa.String(length=36), nullable=True),
        sa.Column("references", sa.JSON(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("definition_type", "definition_id"),
        sa.CheckConstraint(
            f"definition_type IN ({_DEFINITION_TYPES})",
            name="ck_definition_drafts_type_valid",
        ),
    )
    op.create_index("ix_definition_drafts_shop_id", "definition_drafts", ["shop_id"])

    op.create_table(
        "definition_versions",
        sa.Column("definition_type", sa.String(length=32), nullable=False),
        sa.Column("definition_id", sa.String(length=36), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("shop_id", sa.String(length=36), nullable=True),
        sa.Column("shop_version", sa.Integer(), nullable=True),
        sa.Column("references", sa.JSON(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        # The composite primary key is the ADR 0012 overwrite guard: a published version
        # can only ever be inserted once.
        sa.PrimaryKeyConstraint("definition_type", "definition_id", "version"),
        sa.CheckConstraint("version >= 1", name="ck_definition_versions_version_positive"),
        sa.CheckConstraint(
            "shop_version IS NULL OR shop_version >= 1",
            name="ck_definition_versions_shop_version_positive",
        ),
        sa.CheckConstraint(
            f"definition_type IN ({_DEFINITION_TYPES})",
            name="ck_definition_versions_type_valid",
        ),
    )
    op.create_index(
        "ix_definition_versions_definition",
        "definition_versions",
        ["definition_type", "definition_id"],
    )


def downgrade() -> None:
    connection = op.get_bind()
    published = connection.scalar(sa.text("SELECT count(*) FROM definition_versions"))
    if published:
        raise RuntimeError(
            f"refusing to downgrade: {published} published definition version(s) are "
            "immutable historical evidence; delete them deliberately before downgrading"
        )

    op.drop_index("ix_definition_versions_definition", table_name="definition_versions")
    op.drop_table("definition_versions")
    op.drop_index("ix_definition_drafts_shop_id", table_name="definition_drafts")
    op.drop_table("definition_drafts")
