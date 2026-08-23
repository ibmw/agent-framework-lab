# Architecture

Status: target architecture with an implemented POC baseline — 2026-08-23

Read `docs/product-direction.md` first. This document distinguishes principles that remain binding,
the code that exists today, and the target boundaries that future slices must establish. Do not
claim a target capability is implemented merely because it appears here.

## Current POC structure

```text
apps/
  api/                    FastAPI API and composition
    src/capability_lab/
      domain/             current retail/session entities and invariants
      application/        current use cases and ports
      infrastructure/     SQLAlchemy, configuration, traces, and agents
      presentation/       HTTP routes and schemas
  web/                    current React/Vite playground
packages/
  contracts/              OpenAPI v1 contract and generated shared types
infra/
  phoenix/                optional local observability service
docs/                     product, architecture, guidelines, and ADRs
.codex/skills/            project-local procedures
```

The POC implements generated personas, minimal customers/products/orders, hard-coded scenario
definitions, conversations, one safe cancellation action, a Pydantic AI adapter, framework
selection, and a conversation comparison view. This is reusable evidence, not the target domain
model or navigation.

## Binding dependency rule

```text
presentation ──> application ──> domain
      │                 ▲
      └──> infrastructure ┘
```

- `domain` imports no web, ORM, agent SDK, telemetry, database, or durable-runtime library.
- `application` depends on domain concepts and declares ports required by use cases.
- `infrastructure` implements ports. Infrastructure adapters do not import one another to compose
  workflows.
- `presentation` translates HTTP/UI interactions and performs composition; it does not implement
  business rules.
- Composition is the only place allowed to select databases, agent frameworks, model providers,
  participant drivers, judge providers, or trace exporters.

The target may organize product areas within these layers or as modules that each preserve the same
inward dependency direction. A redesign must not turn product-area names into permission for domain
code to import infrastructure.

## Target product areas

The target model has six cohesive areas:

```text
Catalog and commerce
  shops, products, options, variants, media references, attributes,
  policies, FAQ, payments, fulfilment, orders, returns, and refunds

Customers and support
  synthetic identity, behavioral persona, addresses, account state,
  commerce history, support history, and support identity

Scenario Studio
  drafts and published definitions, setup actions, interaction context,
  hidden facts, objectives, faults, validation, and preview

Agent configuration
  drafts and published configurations, framework, architecture, model,
  prompt, support identity, tools, memory, and runtime settings

Experiments
  immutable experiment records, isolated runs, participant input,
  conversations, tool events, state changes, and trace correlations

Evaluation
  deterministic assertions, LLM judge executions, quantitative metrics,
  comparison evidence, notes, replay, and fork
```

These areas are target boundaries. Exact aggregates, packages, public routes, and persistence tables
must be designed in cohesive roadmap slices rather than inferred from this overview.

## Tool-first execution boundary

The backend simulation is the source of truth. Direct agent input contains a customer message and a
minimal `InteractionContext` with resource references such as channel, origin page, product, chosen
variant, locale, and run scope. It does not contain a dump of the shop, catalog, customer, or order
database.

Framework-neutral versioned tools query or mutate the run's commerce sandbox through application
use cases. Tool adapters do not bypass application rules or use ORM models as public/tool schemas.
Run scoping and authorization prevent arbitrary access to other synthetic customers.

Detailed support knowledge is normally retrieved through policy/FAQ tools. Non-negotiable safety
and commerce rules remain backend invariants. Every modifying tool uses explicit proposal and
confirmation semantics where required, idempotency, and optimistic concurrency.

## Framework and participant neutrality

The current `AgentAdapter` is an application port and remains useful evidence. The target port may
evolve only when the experiment runner and a concrete second architecture prove new requirements.
Agent SDK types never enter the domain, stored neutral event format, public API, or shared UI.

Participant input has a separate application port. Its first implementation is the human operator;
future LLM and scripted customer drivers use the same run protocol and remain independent of the
support-agent framework.

The LLM judge is also a separate port. It consumes a versioned, anonymized evaluation input and
returns structured dimension-level evidence. A judge cannot mutate sandbox state or replace
deterministic assertions.

## Experiment execution

An experiment binds one published scenario to one or two published agent configurations. Starting
it resolves all referenced versions and creates one canonical sandbox snapshot. Each arm receives
an independently mutable clone with the same starting-state fingerprint.

```text
published definitions
        │
        ▼
resolve + validate ──> canonical sandbox snapshot + fingerprint
                              │
                  ┌───────────┴───────────┐
                  ▼                       ▼
              run A clone             run B clone
                  │                       │
                  └──── normalized evidence ────> comparison
```

The first message is equivalent across arms. Later human inputs may be linked or independent, and
the persisted event stream records when inputs diverge. Tool writes in one arm never affect the
other arm.

Normalized run evidence includes participant and assistant turns, model usage, tool requests and
results, proposals and confirmations, retries and failures, state changes, trace correlations, and
completion status. Project-owned source symbols may be attached to execution events for the code
evidence view; manually maintained pseudo-code is not authoritative evidence.

## Persistence, versioning, and extensibility

Authorable definitions use mutable drafts and immutable published versions. Experiments and judge
executions are append-oriented historical evidence. Operational sandbox state is mutable only
inside one run and never changes the published definitions or canonical starting snapshot.

Typed domain objects protect important commerce invariants. Configurable typed attributes extend
catalog content without one schema change per display field; versioned metadata extensions are
reserved for non-critical information. Core prices, variants, inventory, order state, permissions,
and action rules must not depend on arbitrary unvalidated JSON.

SQLite remains acceptable for the local, single-user phase. Use portable SQLAlchemy types and
Alembic migrations. Existing POC data need not be carried into the target schema, but migrations
must explicitly handle every supported starting repository state and must be tested for clean and
existing databases.

## Reproducibility

The POC records a scenario ID/version, seed, policy-set version, and `initial_state_hash`. The target
extends this replay context to every published definition, tool contract, agent/runtime setting,
participant-driver type, and evaluator/rubric version that can affect a run.

Canonical serialization remains an application boundary, never an ORM or incidental response dump.
Every behaviorally relevant starting-state field belongs to a versioned canonical schema. Runtime
IDs, database row order, trace IDs, operational timestamps, and evaluation outputs do not alter the
starting-state fingerprint.

## Safety and observability

- Synthetic personal information is clearly fictional and follows the same access and redaction
  discipline expected for sensitive data.
- Never log or trace secrets, raw free-form customer content, full addresses, raw email addresses,
  authentication values, complete tool payloads, or judge inputs.
- OpenTelemetry is the normalized trace format; exporters such as Phoenix are replaceable and must
  not affect business behavior.
- Stable evidence records framework, architecture/configuration version, tool/version, outcome,
  attempt, duration, usage when available, and pseudonymized run identifiers.
- Model or judge failure never silently becomes a successful deterministic result.

## Public contracts during redesign

`packages/contracts/openapi/v1/openapi.yaml` and current tool schemas remain the contracts of the
running POC until a roadmap slice deliberately replaces or versions them. Do not incrementally bend
persona or conversation routes into the target model. Introduce target contracts with their domain,
application behavior, persistence, frontend consumer, migration behavior, and tests in the same
cohesive slice.
