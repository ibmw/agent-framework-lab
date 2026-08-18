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
- The first support scenario is `retail-profile@v1`, with three customer-scoped read tools, a
  framework-neutral conversation API, durable neutral turns, and explicit capability declarations.
- Pydantic AI uses OpenAI Responses with the credential-gated `gpt-5-mini` configuration. Required
  evidence uses Pydantic AI `TestModel` and a separate fake adapter without live calls.
- Sanitized common OpenTelemetry spans can be exported to the pinned local Phoenix Compose service;
  native prompt/payload instrumentation remains disabled.
- `retail-order-cancellation@v1` and policy set `v2` add the single `cancel_order@v1` modifying
  action with persisted exact proposals, separate confirmation/execution, idempotency, optimistic
  concurrency, safe retries, immutable initial snapshots, and sanitized lifecycle traces.

## Explicitly deferred

Vercel AI SDK comparison, additional modifying support actions, Temporal runtime, PostgreSQL,
autonomous simulation, and deeper τ³-bench dataset or harness integration.

## Recommended next task

Begin Milestone 4 by implementing the same read-only and modifying semantics behind the Vercel AI
SDK adapter without changing the public API, stored session/action formats, or playground behavior.
