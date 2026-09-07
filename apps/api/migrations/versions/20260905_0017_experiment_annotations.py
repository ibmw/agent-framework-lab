"""Store the notes an operator writes on a run and the tags they file it under."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260905_0017"
down_revision: str | None = "20260901_0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "experiment_notes",
        sa.Column("note_id", sa.String(length=36), nullable=False),
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("body", sa.String(length=2000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("note_id"),
        # Beside the experiment rather than inside it: `experiments` is written once because
        # its document explains the result, and this is what lets a run be written *about*
        # without the record it is fingerprinted from ever moving.
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.experiment_id"]),
    )
    op.create_index(
        "ix_experiment_notes_experiment", "experiment_notes", ["experiment_id", "created_at"]
    )
    op.create_table(
        "experiment_tags",
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("tag", sa.String(length=64), nullable=False),
        # The run and the shelf. A run filed twice under one tag is filed once: the set is
        # the key rather than a rule the writer has to remember.
        sa.PrimaryKeyConstraint("experiment_id", "tag"),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.experiment_id"]),
    )
    # History narrows by tag across every shop, so the shelf is indexed on its own rather
    # than only under the run it belongs to.
    op.create_index("ix_experiment_tags_tag", "experiment_tags", ["tag"])


def downgrade() -> None:
    op.drop_index("ix_experiment_tags_tag", table_name="experiment_tags")
    op.drop_table("experiment_tags")
    op.drop_index("ix_experiment_notes_experiment", table_name="experiment_notes")
    op.drop_table("experiment_notes")
