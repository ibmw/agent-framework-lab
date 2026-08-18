# Decisions, scope, and next step

## Accepted decisions

- pnpm/uv monorepo with two versioned lockfiles.
- Pragmatic clean architecture and a common agent contract defined before adding SDKs.
- SQLite, SQLAlchemy, and Alembic with PostgreSQL-portable types and migrations, including
  fingerprint-verified generated scenario aggregates.
- OpenAPI v1 as the published contract and OpenTelemetry as the trace format.
- OpenAPI-generated TypeScript v1 types as the only backend contract types consumed by the web
  application.
- Typed startup configuration and secret-free environment examples.
- Optimistic concurrency and idempotency keys represented in application ports and the schema.
- τ³-bench Retail as inspiration for locally adapted and versioned scenarios and policies, without
  an initial runtime dependency.
- Chosen frontend and fixture libraries are locked from the foundation stage to validate
  compatibility. They are not delivered capabilities until exercised by a scenario and test.
  OpenTelemetry runtime dependencies will wait for the trace-adapter implementation.
- Playground components use Tailwind utilities over semantic theme tokens; shadcn primitives are
  added when a control is reusable rather than duplicating one-off component CSS.

## Explicitly deferred

Pydantic AI agent, final assistant-ui chat, Vercel AI SDK comparison, Temporal runtime, PostgreSQL,
running Phoenix, autonomous simulation, and deeper τ³-bench dataset or harness integration.

## Recommended next task

Begin Milestone 2 with the provider and deterministic-test policy, the fake `AgentAdapter` and its
shared conformance suite, and one selected τ³-inspired read-only retail support scenario.
