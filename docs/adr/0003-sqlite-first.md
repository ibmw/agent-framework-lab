# ADR 0003 — SQLite first

Status: accepted — 2026-08-16

SQLite is sufficient for the local demonstration. SQLAlchemy and Alembic are used from the start
without SQLite-specific types or SQL. Command writes use optimistic concurrency and idempotency.
Scenario seeds use `BigInteger` so the documented unsigned 32-bit seed range is portable to
PostgreSQL rather than relying on SQLite's wider `INTEGER` storage.
PostgreSQL will be introduced only for demonstrated needs involving concurrent writers, shared
deployment, load, or a durable runtime.
