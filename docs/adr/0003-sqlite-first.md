# ADR 0003 — SQLite first

Status: accepted — 2026-08-16

Amendment: 2026-08-16 — Added persisted generated-scenario aggregates and scoped reusable retail
attributes to those aggregates.

SQLite is sufficient for the local demonstration. SQLAlchemy and Alembic are used from the start
without SQLite-specific types or SQL. Command writes use optimistic concurrency and idempotency.
Scenario seeds use `BigInteger` so the documented unsigned 32-bit seed range is portable to
PostgreSQL rather than relying on SQLite's wider `INTEGER` storage.
PostgreSQL will be introduced only for demonstrated needs involving concurrent writers, shared
deployment, load, or a durable runtime.

Generated state is normalized across personas, customers, products, orders, and explicit
scenario-membership tables. The aggregate records the immutable scenario ID/version, policy-set
version, canonical-schema version, seed, operational creation timestamp, and state fingerprint.
Customer email and product SKU are not globally unique because separate generated scenarios may
legitimately reuse those fictional attributes; entity identifiers remain deterministic primary keys,
and product/order membership is scoped by the generated-state fingerprint. Loading an aggregate
reconstructs its domain state and verifies its canonical fingerprint before returning it.

Generation claims the idempotency key as the first database write. A competing writer either loads
the committed command identity and result or reports a key conflict; the idempotency record uses
the command clock rather than the original scenario creation time. Identical deterministic entity
rows may be shared by multiple scenario versions, while a conflicting row for the same identifier
is rejected.

The pre-feature schema cannot represent populated generated state reliably because it requires
globally unique customer emails and product SKUs. Migration `20260816_0003` therefore refuses its
downgrade before executing any DDL whenever feature data exists or duplicate `customers.email` or
`products.sku` values remain in the base tables. Operators must explicitly remove generated data
and resolve those duplicates before retrying; this avoids SQLite's non-transactional batch DDL
leaving a partially downgraded database.
