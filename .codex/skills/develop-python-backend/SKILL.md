---
name: develop-python-backend
description: Implement or review Python backend changes in Agent Framework Capability Lab using FastAPI, domain/application ports, SQLAlchemy/Alembic adapters, typed settings, and the repository's test gates. Use for API routes, e-commerce rules, repositories, migrations, backend configuration, or Python tests in this project.
---

# Develop the Python backend

1. Read `docs/architecture.md`, the relevant ADR, and the contract under
   `packages/contracts/openapi/`.
2. Put invariants in `domain`, orchestration and ports in `application`, concrete libraries in
   `infrastructure`, and HTTP translation in `presentation`.
3. Keep FastAPI, Pydantic, SQLAlchemy, agent SDKs and telemetry imports outside domain.
4. Require idempotency for writes; use expected order versions for concurrent updates.
5. Keep SQLAlchemy models and migrations portable to PostgreSQL. Add an Alembic migration for every
   schema change; never mutate an old applied migration.
6. Update the versioned OpenAPI contract with route changes. Reject unknown command fields and
   avoid secrets or sensitive content in errors/logs.
7. Add the fastest behavior-focused tests, plus integration tests for HTTP, persistence or
   migrations.
8. Run targeted pytest, then `uv run ruff check .`, `uv run ruff format --check .`,
   `uv run pyright`, and relevant migration tests.

Do not start or restart the API before checking port 8000 and confirming that a running instance
cannot be reused.
