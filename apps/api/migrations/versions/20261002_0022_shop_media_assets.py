"""Hold a shop's claim on the images it holds, one row per shop and hash (ADR 0076)."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261002_0022"
down_revision: str | None = "20260921_0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "shop_media_assets",
        # No foreign key and no `ON DELETE`: a shop is a `definition_drafts` row keyed on
        # `(definition_type, definition_id)`, which a single `shop_id` column cannot reference,
        # as `shop_order_fixtures` and `definition_shop_attachments` cannot either. The claim is
        # bound to a standing draft by the repository's conditional insert instead. Deleting a
        # shop that never published — Milestone 11's Slice 42, still to come — is to remove
        # these rows explicitly, with the shop's directory after them (ADR 0076).
        sa.Column("shop_id", sa.String(length=36), nullable=False),
        # The SHA-256 of the bytes, which is also the file's name under the media root and the
        # hash inside the `asset:sha256:<hex>` reference a draft names.
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("content_type", sa.String(length=32), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        # The original file name cleaned into a label, for display only: a label's length.
        sa.Column("file_name", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        # One row per shop and hash: the same bytes uploaded twice are one image, and the
        # repository's conditional insert relies on this key to lose a race cleanly.
        sa.PrimaryKeyConstraint("shop_id", "sha256"),
        sa.CheckConstraint(
            "content_type IN ('image/png', 'image/jpeg', 'image/webp')",
            name="ck_shop_media_assets_content_type_valid",
        ),
        sa.CheckConstraint("byte_size > 0", name="ck_shop_media_assets_byte_size_positive"),
        sa.CheckConstraint("length(sha256) = 64", name="ck_shop_media_assets_sha256_length"),
    )
    op.create_index(
        "ix_shop_media_assets_shop_created", "shop_media_assets", ["shop_id", "created_at"]
    )


def downgrade() -> None:
    # The schema this returns to has nowhere to say which images a shop holds, and a draft or
    # a published version may name them, so it refuses rather than dropping the claims — the
    # files they name would be left behind with nothing to serve or remove them by.
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT 1 FROM shop_media_assets LIMIT 1")) is not None:
        raise RuntimeError(
            "refusing to downgrade shop media assets because the old schema cannot represent "
            "an uploaded image; reset the database and the media root before retrying"
        )
    op.drop_index("ix_shop_media_assets_shop_created", table_name="shop_media_assets")
    op.drop_table("shop_media_assets")
