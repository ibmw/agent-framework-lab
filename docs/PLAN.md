# Project plan

## Purpose

Build a human-operated, traceable e-commerce playground where a user generates a fictional
customer persona and then interacts with a support agent. The lab exists to expose how agent
frameworks implement real capabilities; it is not a performance leaderboard.

This document is the execution roadmap for contributors and fresh coding agents. It defines
delivery slices and acceptance evidence. Keep detailed designs in linked ADRs and branch-level
implementation notes in issues or pull requests.

## Read this before starting a task

1. Read `AGENTS.md`, `docs/architecture.md`, and the guideline relevant to the task.
2. Invoke the matching project-local skill under `.codex/skills/` when applicable.
3. Synchronize `main` and create a short-lived branch before modifying files.
4. Start with the first incomplete execution slice in the current milestone unless an issue names a
   smaller independently testable increment.
5. Confirm its API/tool contract, architecture boundary, test level, and observability impact.
6. Mark an outcome checkbox complete in place only when the whole outcome and its automated
   acceptance evidence are present.

Project documentation, code identifiers, and public contracts use English consistently. Preserve
that convention when adding or updating guidance.

## Unit of delivery

- An execution slice is the default unit for one short-lived branch. It must leave `main` coherent,
  reviewable, and automatically testable.
- Outcome checkboxes are roadmap state, not branch boundaries. One slice may complete several
  outcomes; a large outcome may take several branches when every branch has its own useful behavior
  and acceptance evidence.
- Do not split a public contract from the implementation and consumer needed to validate it.
- State the exact slice, expected contract changes, and acceptance commands in the issue or pull
  request before implementation grows beyond the plan.
- Keep completed checkboxes where they are. Add a milestone to the completed summary only after all
  of its acceptance criteria pass; do not duplicate or relocate individual outcomes.

## Current implementation state — 2026-08-16

The foundations already provide:

- domain entities for customers, products, orders, conversation sessions, and memory records;
- immutable persona, versioned scenario, operational metadata, and canonical initial-state domain
  boundaries plus an application-level scenario registry;
- deterministic `retail-profile@v1` persona and initial-state generation with canonical JSON and
  SHA-256 fingerprinting;
- repository ports, optimistic order version/idempotency parameters, `AgentAdapter`, and explicit
  `AgentCapability` values;
- SQLite/SQLAlchemy adapters, Alembic migrations, UTC persistence, and migration drift tests;
- a versioned FastAPI health contract plus deterministic OpenAPI generation;
- a React playground shell with assistant-ui installed but no final persona or chat journey;
- shared quality gates, CI, architecture guidance, and project-local skills.

The project does not yet persist generated scenario state or expose it through the API/UI, and it
does not implement support conversations, an agent SDK adapter, or OpenTelemetry export. Update
this anchor when a milestone is completed so a fresh contributor does not recreate existing
foundations or mistake installed libraries for delivered capabilities.

## Stable vocabulary

- **Persona**: an immutable, fictional, lab-owned profile generated for a scenario. It contains
  only scenario-relevant identity and support traits. It is distinct from the retail `Customer`
  entity, which is derived from the persona and persisted with products and orders.
- **Scenario ID**: a stable kebab-case family name such as `retail-profile`.
- **Scenario version**: an immutable behavior version matching `v[1-9][0-9]*`, such as `v1`.
  A behavior or fixture change creates a new version; it never mutates an existing definition.
- **Policy-set version**: an independently versioned set of business/support rules using the same
  `vN` format. A scenario definition pins exactly one policy-set version.
- **Scenario registry**: an application-level registry keyed by `(scenario_id, scenario_version)`.
  Historical definitions remain resolvable while a persisted or replayable session references them.
- **Seed**: an integer in the inclusive range `0..4294967295`, represented as a JSON integer and
  accepted by the UI as a base-10 integer.
- **Initial state**: the canonical persona, customer, products, orders, and pinned scenario/policy
  metadata produced before a conversation begins. Its fingerprint follows ADR 0007.
- **Human journey**: an interactive playground flow exercised by a person and, when essential, by
  Playwright.
- **Regression scenario**: a deterministic automated replay of a proven human journey. It is not an
  autonomous model simulation or a framework benchmark.

The scenario version, public API prefix (`/api/v1`), and OpenAPI document version (`1.0.0`) are
independent version axes. Name the axis explicitly in documentation and tests.

## Planning principles

### Scenario sandbox

- Use τ³-bench Retail as inspiration for e-commerce vocabulary, policies, tool shapes, fixtures, and
  scenario structure.
- Adapt and version every scenario locally. Do not make τ³-bench a runtime, package, data-download,
  or test-suite dependency for the initial lab.
- Record which concepts are τ³-inspired and which are lab-specific when introducing a scenario or
  policy set.
- Design scenarios for a human demo first. Autonomous model simulation can be considered only after
  the interactive experience and contracts are stable.

See `docs/adr/0006-tau3-inspired-scenario-design.md` for the decision boundary.

### Reproducibility

- Every generated persona and demo session records a `seed`, scenario registry key,
  `policy_set_version`, and `initial_state_hash`.
- The same recorded inputs must recreate the same canonical initial state.
- Scenario behavior changes create a new registry entry; they do not silently alter past sessions.
- Fixtures may use Faker and factory-boy, but all randomness must flow from the recorded seed.
- Serialize and fingerprint initial state only through the canonical boundary defined by
  `docs/adr/0007-canonical-initial-state-hash.md`.

### Architecture and framework neutrality

- Domain rules, scenario policies, and application use cases remain independent of FastAPI,
  SQLAlchemy, agent frameworks, Phoenix, databases, and durable runtimes.
- Pydantic AI and Vercel AI SDK implement the same application-level `AgentAdapter` contract.
- The playground and public API must not require framework-specific messages or events.
- Add abstractions only when a concrete use case or second implementation proves the need.

### Capability evidence

- Advertise an agent capability only when a human-visible scenario and automated test demonstrate
  it.
- Cover relevant failures as well as success: validation, refusal, confirmation, retry, conflict,
  and resume behavior.
- Record unsupported or difficult capabilities explicitly instead of simulating them silently.
- Compare developer experience and observed behavior without producing a global framework score.

### Contracts, safety, and observability

- Version public APIs and agent tools; document incompatible changes.
- Require explicit confirmation and idempotency for modifying actions.
- Use optimistic order versions to detect conflicting writes.
- Emit common OpenTelemetry spans and sanitize them before export. Never store secrets or raw
  sensitive customer content in fixtures, logs, or traces.
- Keep Phoenix optional: telemetry export failures must not change business behavior.

## Definition of done for every checked item

- Behavior and milestone acceptance criteria affected by the item are implemented.
- Appropriate unit, integration, component, or E2E tests pass.
- Contracts, migrations, documentation, and ADRs are updated when affected.
- `make check` passes; frontend/build changes also pass `pnpm build`.
- Essential changed human journeys pass Playwright.
- The outcome checkbox is updated in place in the same change.

## Milestone 1 — Deterministic persona and scenario foundation

### Goal

Prove the architecture with a reproducible customer and initial retail state without introducing an
agent framework. This establishes the scenario sandbox that future agent adapters will consume.

### Execution slice 1 — Scenario contract and registry

Deliver the domain/application vocabulary required by generation without publishing an endpoint
that has no implementation.

- [x] Define immutable `ScenarioDefinition`, `Persona`, and canonical initial-state boundaries.
- [x] Implement the application-level scenario registry keyed by scenario ID and version.
- [x] Define scenario metadata: scenario ID/version, seed, policy-set version, canonical-state schema
  version, and operational creation timestamp.
- [x] Document the initial τ³-inspired retail concepts and their lab-specific adaptations.
- [x] Specify canonical initial-state serialization and SHA-256 fingerprinting in ADR 0007.

Slice evidence: pure tests prove metadata validation, seed bounds, duplicate registry rejection, and
simultaneous resolution of two test scenario versions without FastAPI or a database.

### Execution slice 2 — Deterministic generation kernel

- [x] Implement persona generation in the domain/application layers with all randomness derived
  from the recorded seed.
- [x] Generate a minimal coherent initial state: persona, customer, products, and orders required by
  the first support scenario.
- [x] Compute the initial-state hash through the canonical serializer.
- [x] Record seeded identifiers and scenario timestamps deterministically.

Slice evidence: pure tests prove same inputs produce byte-identical canonical state and hash,
different seeds produce valid independent state, invariants reject invalid generated data, and
generation does not read the system clock or global randomness.

### Execution slice 3 — Persistence and public API

- [x] Persist personas and generated scenario state through repository ports and SQLite adapters.
- [x] Define and publish versioned persona-generation and initial-state API schemas together with
  their implementation.
- [x] Expose generation and retrieval through versioned FastAPI endpoints.
- [x] Preserve exact scenario/policy references needed to load historical definitions.

Slice evidence: repository and API integration tests prove round trips, contract drift protection,
unknown scenario handling, duplicate/idempotent requests, and coexistence of two scenario versions.

Implementation note: `POST /api/v1/scenarios/{scenario_id}/versions/{scenario_version}/generations`
requires an `Idempotency-Key`; the corresponding `GET` route adds the recorded seed. Persisted
aggregates retain the scenario, policy-set, and canonical-schema versions and verify the canonical
fingerprint when loaded. The idempotency key is claimed atomically before generation so concurrent
same-key requests replay one committed result.

### Execution slice 4 — Human persona journey

- [x] Add the frontend flow with scenario selection, seed input, generated persona summary, loading,
  empty, validation, and network-error states.
- [x] Consume only generated/versioned backend contract types from the web application.
- [x] Add component tests for visible states and one essential Playwright persona-generation journey.

Slice evidence: frontend type-check/build and component tests pass, and Playwright proves a user can
generate and retrieve the same persona using the recorded inputs.

Implementation note: OpenAPI v1 is generated into the shared TypeScript contracts package and the
web API adapter uses those request, response, and error types. Component tests isolate HTTP with
MSW; Playwright starts the migrated FastAPI application and Vite against an isolated SQLite file to
prove the real generation and retrieval round trip. The initial selector uses a local catalog for
the single `retail-profile@v1` entry because scenario discovery is not yet a public API contract.

### Acceptance criteria

- Reusing the same seed, scenario version, and policy-set version produces the same canonical state
  and initial-state hash.
- A changed scenario definition receives a new version, and old and new definitions remain
  simultaneously resolvable through the registry.
- Domain and application tests run without FastAPI, a real database, or wall-clock/global-random
  access.
- SQLite integration tests prove persistence through ports, not direct UI/route access to the ORM.
- The UI consumes only versioned backend contracts.
- No Pydantic AI, chat runtime, Phoenix service, live model, or external τ³ dependency is required.
- Architectural decisions and known limitations discovered by the slices are recorded in ADRs or
  milestone documentation.

### Out of scope

Agent conversations, tool execution, modifying actions, autonomous model simulation, PostgreSQL,
Temporal, and importing the full τ³-bench dataset or harness.

## Milestone 2 — First Pydantic AI support agent

### Goal

Deliver the first human-operated support conversation and prove a small set of read-only agent
capabilities against the shared sandbox.

### Execution slices and outcomes

- [ ] Select and document one τ³-inspired read-only retail support scenario.
- [ ] Decide and document the provider/model family, local credential names, supported model
  versions, deterministic test double, and opt-in live-test policy before adding the SDK adapter.
- [ ] Add a deterministic fake `AgentAdapter` and shared adapter-conformance suite so framework
  neutrality is testable before a second real framework exists.
- [ ] Define versioned tools for reading customer, product, and order information.
- [ ] Implement the Pydantic AI infrastructure adapter behind `AgentAdapter`.
- [ ] Add an architecture test that rejects agent-framework SDK imports outside their
  `infrastructure/agents/<framework>/` adapter.
- [ ] Implement a minimal assistant-ui conversation through the framework-neutral backend API.
- [ ] Persist conversation state and support session resume.
- [ ] Add structured responses and expose only capability declarations proven by shared tests.
- [ ] Classify framework, model-provider, tool, validation, and transient failures.
- [ ] Emit sanitized common OpenTelemetry traces and visualize them in local Phoenix.
- [ ] Add integration tests for every advertised capability and relevant failure path.
- [ ] Add one essential Playwright journey for starting and resuming a support conversation.
- [ ] Document Pydantic AI glue code, limitations, and observed developer experience in an ADR.

Organize these outcomes into short slices in this order: provider/test policy and fake adapter;
read-only tool contracts and use cases; Pydantic AI adapter and conversation API; UI/session resume;
telemetry and evidence. Each slice must satisfy the unit-of-delivery rules above.

### Acceptance criteria

- The fake and Pydantic AI adapters pass the same framework-neutral conformance suite.
- No framework-specific type appears in the public API, tool schema, stored session format, or UI.
- Required CI and `make check` tests make no live model call and require no provider credential.
- Credential-gated live smoke tests are explicit, optional, and separate from deterministic evidence.
- A user can inspect tool activity, structured results, session state, and a correlated trace.
- Unsupported capabilities are visible and do not appear as successful framework features.
- Sensitive content is absent from exported trace attributes and structured logs.

### Out of scope

Modifying order actions, Vercel AI SDK, framework scoring, Temporal, autonomous model simulation, and
mandatory live-model tests.

## Milestone 3 — Safe modifying actions

### Goal

Demonstrate that an agent can propose and execute a business-changing action safely and
reproducibly.

### Outcomes

- [ ] Add a τ³-inspired scenario requiring one modifying order action.
- [ ] Define the versioned modifying tool contract and business validation rules.
- [ ] Require explicit user confirmation bound to the exact proposed action.
- [ ] Enforce idempotency and optimistic concurrency through the existing application ports.
- [ ] Add retry rules that never duplicate a successful business action.
- [ ] Expose proposal, confirmation, execution, refusal, conflict, and retry states in the UI.
- [ ] Trace the full action lifecycle with sanitized OpenTelemetry attributes.
- [ ] Test success, cancellation, validation refusal, replay, stale version, and transient failure.
- [ ] Add one essential Playwright journey covering confirmation and execution.

### Acceptance criteria

- No modifying action executes without a confirmation bound to the exact proposed action.
- Replaying a completed request with the same idempotency key does not duplicate the change.
- A stale order version returns a visible conflict instead of overwriting newer state.
- Shared contract tests prove equivalent proposal/action semantics through every available adapter.

### Out of scope

Additional modifying tools, payment processing, external commerce APIs, Temporal, autonomous model
simulation, and framework scoring.

## Milestone 4 — Vercel AI SDK comparison

### Goal

Implement the same proven scenarios through Vercel AI SDK and compare integration characteristics
without changing the sandbox, domain, public API, or playground behavior.

### Outcomes

- [ ] Implement the Vercel AI SDK adapter behind the existing `AgentAdapter` contract.
- [ ] Run the same read-only and modifying scenarios with the same versioned tools.
- [ ] Produce the same common OpenTelemetry trace vocabulary.
- [ ] Prove capability declarations with the shared conformance/integration test suite.
- [ ] Document glue code, framework constraints, missing capabilities, and observed failure behavior.
- [ ] Present a side-by-side capability matrix without a single aggregate score.

### Acceptance criteria

- Shared contract, API, and component tests run unchanged against both adapter selections.
- No scenario, domain rule, public route, stored session format, or shared UI component is forked by
  framework.
- Framework-specific limitations are explicit and supported by scenario/test evidence.
- Both adapters remain independently selectable in application composition.

### Out of scope

Adding new business scenarios solely for one framework, global framework scoring, production model
routing, Temporal, and performance benchmarking.

## Milestone 5 — Regression scenarios

### Goal

Add repeatable automation only after the human demo and capability contracts are stable.

### Outcomes

- [ ] Define a compact, versioned regression-scenario format derived from proven human journeys.
- [ ] Add deterministic runners for selected success and failure cases.
- [ ] Evaluate whether deeper τ³-bench dataset or harness integration provides enough value.
- [ ] Store results and trace references without turning the project into a performance leaderboard.
- [ ] Document which evidence is deterministic replay and which, if any, uses an opt-in live model.

### Acceptance criteria

- Every regression case references an immutable scenario, policy-set, tool-contract, and runner
  version.
- Deterministic cases reproduce their canonical inputs and expected business outcomes without a live
  model or network dependency.
- Results distinguish application regressions, adapter failures, and optional model variability.
- Historical regression definitions and results remain readable after adding a new version.

### Out of scope

Leaderboard scoring, broad model/provider comparisons, uncontrolled autonomous simulation, and
adopting the full τ³-bench harness without a separate accepted ADR.

## Deferred technology decision triggers

### PostgreSQL

Evaluate when SQLite becomes insufficient because of meaningful concurrent writers, shared
deployment, higher load, or a durable runtime. Preserve SQLAlchemy/Alembic portability until then.

### Temporal

Evaluate when workflows must survive process failure, wait for long-running external events, or
coordinate retries beyond stored session recovery. Do not add it only to demonstrate an agent SDK.

### Deeper τ³-bench integration

Evaluate after the interactive scenarios are stable. Adopt it only if its datasets, harness, or
evaluation model adds value beyond locally versioned τ³-inspired scenarios without compromising the
lab's framework-neutral contracts.

## Completed — Project foundations

- [x] Establish pnpm and uv workspaces with versioned lockfiles.
- [x] Define pragmatic clean architecture boundaries and repository ports.
- [x] Define the common agent adapter and capability contract.
- [x] Configure SQLite, SQLAlchemy, Alembic, and portable initial migrations.
- [x] Configure frontend and backend quality tools, tests, prek, and CI.
- [x] Publish the initial versioned OpenAPI contract.
- [x] Document architecture, testing, observability, security, and framework integration.
- [x] Create and validate project-local Codex skills.
