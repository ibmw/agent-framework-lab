# ADR 0003 — SQLite en premier

Statut : accepté — 2026-08-16

SQLite suffit à la démo locale. SQLAlchemy et Alembic sont utilisés dès le départ, sans type ni SQL
propre à SQLite. Les écritures de commande utilisent version optimiste et idempotence. PostgreSQL
sera introduit seulement pour concurrence, déploiement partagé, charge ou runtime durable réels.
