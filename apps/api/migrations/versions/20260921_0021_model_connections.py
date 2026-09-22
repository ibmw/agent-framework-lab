"""Hold the lab's own connection to a provider, and record the endpoint a run reached."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260921_0021"
down_revision: str | None = "20260907_0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# One revision for the table and both columns, as ADR 0052's migration section specifies:
# they are one decision — the lab may be pointed somewhere, and a run says where it went —
# and splitting them would let a database exist that can hold a connection but cannot record
# what any run did with it.
_ENDPOINT_TABLES = ("experiment_runs", "experiment_judgements")


def upgrade() -> None:
    op.create_table(
        "model_connections",
        # The provider id the proven-framework and proven-judge tables already use. `openai`
        # names the protocol this lab has proven it can speak rather than the company, so
        # Ollama, vLLM, OpenRouter and a gateway are base URLs in the column below rather
        # than rows of their own (ADR 0052).
        sa.Column("provider_id", sa.String(length=32), nullable=False),
        sa.Column("base_url", sa.String(length=2048), nullable=False),
        # The AES-GCM envelope, never the key. Nullable because an endpoint needing no
        # credential — a local Ollama — is an ordinary connection to hold.
        sa.Column("encrypted_key", sa.String(length=4096), nullable=True),
        sa.Column("key_added_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        # One connection per provider. A second would need a selector on the agent
        # configuration, which is an authored field and ADR 0053's subject rather than this
        # one's.
        sa.PrimaryKeyConstraint("provider_id"),
        # The one fact about the key the lab may serve travels with the key itself: a date
        # without a key would tell the settings page a credential is installed when none is.
        sa.CheckConstraint(
            "(encrypted_key IS NULL) = (key_added_at IS NULL)",
            name="ck_model_connections_key_date_matches_key",
        ),
        sa.CheckConstraint("length(base_url) > 0", name="ck_model_connections_base_url_present"),
    )

    # Nullable, and deliberately not backfilled. Existing rows keep a null endpoint, which is
    # the truthful record: they were produced before the lab knew where it was pointed. Null
    # is also what a deterministic control arm leaves, because it reaches no provider at all —
    # the results surface renders that as *endpoint not recorded* and never as *offline*,
    # since the two are different facts and only one of them is known.
    for table in _ENDPOINT_TABLES:
        op.add_column(table, sa.Column("model_base_url", sa.String(length=2048), nullable=True))


def downgrade() -> None:
    # Additive in both directions: this removes exactly what the upgrade added and can
    # represent everything the older schema held, so there is nothing here to refuse. What is
    # lost is the connection itself and the endpoints recorded since — which is what going
    # back to a schema with nowhere to put them means, and the environment bootstrap the lab
    # keeps either way is what it falls back to.
    for table in reversed(_ENDPOINT_TABLES):
        op.drop_column(table, "model_base_url")
    op.drop_table("model_connections")
