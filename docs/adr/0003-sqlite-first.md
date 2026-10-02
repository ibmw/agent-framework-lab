# ADR 0003 — SQLite first

Status: accepted — 2026-08-16

Amendment: 2026-08-16 — Added persisted generated-scenario aggregates and scoped reusable retail
attributes to those aggregates.

Amendment: 2026-08-23 — ADR 0011 permits replacing the POC aggregate schema and discarding local POC
data through an explicit, tested migration/reset slice. SQLite-first portability, idempotency, and
optimistic-concurrency decisions remain accepted.

Amendment: 2026-10-03 — A savepoint nests in the request's transaction. pysqlite's legacy
transaction control emits its implicit `BEGIN` before DML only, so a `SAVEPOINT` that was a
transaction's first write started SQLite's transaction itself and its `RELEASE` committed it:
nothing later in the request could roll it back. `create_database_engine` now listens for
SQLAlchemy's `savepoint` event and, when the DBAPI connection has no transaction open, emits a
deferred `BEGIN` on it first. The legacy control is otherwise kept on purpose, so a read before a
request's first write still takes no lock. A deferred `BEGIN` takes no lock until its first
statement, a read included, so the rule for a savepoint that may open a request's transaction is
that it opens on a write, with no read inside it before that write: a `SELECT` there would take a
shared lock held to the commit and bring back the deadlock below. `attach` follows the rule.
SQLAlchemy's documented pysqlite recipe (`isolation_level = None` and a `BEGIN` on every `begin`
event) and Python 3.12's `autocommit=False` both open the transaction at a request's first read
instead: under the rollback journal the lab runs, that read's shared lock holds back every other
connection's commit until the request ends, and two requests that read and then write deadlock, one
failing at once with `database is locked`. `BEGIN IMMEDIATE` avoids the deadlock by serialising
every request, reads included: a read-only request waits behind another as a write does.
`test_sqlite_transactions.py` holds the savepoint and the lock-free read; the recipe fails its
lock-free read with `database is locked`.

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
