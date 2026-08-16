# Decisions, scope, and next step

## Accepted decisions

- pnpm/uv monorepo with two versioned lockfiles.
- Pragmatic clean architecture and a common agent contract defined before adding SDKs.
- SQLite, SQLAlchemy, and Alembic with PostgreSQL-portable types and migrations.
- OpenAPI v1 as the published contract and OpenTelemetry as the trace format.
- Typed startup configuration and secret-free environment examples.
- Optimistic concurrency and idempotency keys represented in application ports and the schema.
- τ³-bench Retail as inspiration for locally adapted and versioned scenarios and policies, without
  an initial runtime dependency.
- Chosen frontend and fixture libraries are locked from the foundation stage to validate
  compatibility. They are not delivered capabilities until exercised by a scenario and test.
  OpenTelemetry runtime dependencies will wait for the trace-adapter implementation.

## Explicitly deferred

Pydantic AI agent, final assistant-ui chat, persisted/public persona generation, Vercel AI SDK
comparison, Temporal runtime, PostgreSQL, running Phoenix, autonomous simulation, and deeper
τ³-bench dataset or harness integration.

## Recommended next task

Complete Milestone 1 execution slice 3: persist personas and generated scenario state through the
repository ports, then publish generation and retrieval through the versioned API contract.
Idempotent requests, exact historical scenario references, and deterministic round trips are the
required evidence; the UI remains in the following slice.
