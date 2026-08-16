# Project plan

## Purpose

Build a human-operated, traceable e-commerce playground where a user generates a fictional
customer persona and then interacts with a support agent. The lab exists to expose how agent
frameworks implement real capabilities; it is not a performance leaderboard.

This document is the execution roadmap for contributors and fresh coding agents. Use the linked
guidelines and ADRs for detailed rules, and keep branch-level implementation notes in issues or pull
requests.

## Read this before starting a task

1. Read `AGENTS.md`, `docs/architecture.md`, and the guideline relevant to the task.
2. Invoke the matching project-local skill under `.codex/skills/` when applicable.
3. Synchronize `main` and create a short-lived branch before modifying files.
4. Start with the first coherent unchecked outcome in the current milestone.
5. Confirm its API/tool contract, architecture boundary, test level, and observability impact.
6. Keep the change small enough for linear, fast-forward integration into `main`.
7. Mark a checkbox complete only when its acceptance criteria and automated tests pass.

## Planning principles

### Scenario sandbox

- Use τ³-bench Retail as inspiration for e-commerce vocabulary, policies, tool shapes, fixtures, and
  scenario structure.
- Adapt and version every scenario locally. Do not make τ³-bench a runtime, package, data-download,
  or test-suite dependency for the initial lab.
- Record which concepts are τ³-inspired and which are lab-specific when introducing a scenario or
  policy set.
- Design scenarios for a human demo first. Automated simulation can be added after the interactive
  experience and contracts are stable.

See `docs/adr/0006-tau3-inspired-scenario-design.md` for the decision boundary.

### Reproducibility

- Every generated persona and demo session records a `seed`, `scenario_version`, and
  `initial_state_hash`.
- The same recorded inputs must recreate the same initial state.
- Scenario behavior changes create a new version; they do not silently alter past sessions.
- Fixtures may use Faker and factory-boy, but all randomness must flow from the recorded seed.

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

- Behavior and acceptance criteria are implemented.
- Appropriate unit, integration, component, or E2E tests pass.
- Contracts, migrations, documentation, and ADRs are updated when affected.
- `make check` passes; frontend/build changes also pass `pnpm build`.
- Essential changed human journeys pass Playwright.
- No service was started, stopped, or restarted without checking the existing stack first.
- This plan is updated in the same change when an outcome or milestone is completed.

## Milestone 1 — Deterministic persona and scenario foundation

### Goal

Prove the architecture with one vertical slice that creates a reproducible customer and initial
retail state without introducing an agent framework. This establishes the scenario sandbox that
future agent adapters will consume.

### Outcomes

- [ ] Define scenario v1 metadata: stable identifier, version, seed, initial-state hash, policy-set
  version, and creation timestamp.
- [ ] Document the initial τ³-inspired retail concepts and their local adaptations.
- [ ] Define and publish the versioned persona and initial-state API schemas.
- [ ] Implement deterministic persona generation in the domain/application layers.
- [ ] Generate a minimal coherent retail state for the persona: customer, products, and orders
  required by the first support scenario.
- [ ] Persist the customer and scenario state through repository ports and SQLite adapters.
- [ ] Expose persona generation and retrieval through versioned FastAPI endpoints.
- [ ] Add the minimal frontend flow with seed input, generated persona summary, loading, empty, and
  error states.
- [ ] Cover determinism, invariants, persistence, API contracts, and visible UI behavior.
- [ ] Add one essential Playwright journey for persona generation.
- [ ] Record architectural decisions and known limitations discovered by the vertical slice.

### Acceptance criteria

- Reusing the same seed and scenario version produces the same persona and initial-state hash.
- A changed scenario version can coexist with the previous version.
- Domain and application tests run without FastAPI or a real database.
- SQLite integration tests prove persistence through ports, not direct UI/route access to the ORM.
- The UI consumes only versioned backend contracts.
- No Pydantic AI, chat runtime, Phoenix service, or external τ³ dependency is required.

### Out of scope

Agent conversations, tool execution, modifying actions, automatic evaluation, PostgreSQL, Temporal,
and importing the full τ³-bench dataset or harness.

## Milestone 2 — First Pydantic AI support agent

### Goal

Deliver the first human-operated support conversation and prove a small set of read-only agent
capabilities against the shared sandbox.

### Outcomes

- [ ] Select and document one τ³-inspired read-only retail support scenario.
- [ ] Define versioned tools for reading customer, product, and order information.
- [ ] Implement the Pydantic AI infrastructure adapter behind `AgentAdapter`.
- [ ] Implement a minimal assistant-ui conversation through the framework-neutral backend API.
- [ ] Persist conversation state and support session resume.
- [ ] Add structured responses and explicit capability declarations.
- [ ] Classify framework, model-provider, tool, validation, and transient failures.
- [ ] Emit sanitized common OpenTelemetry traces and visualize them in local Phoenix.
- [ ] Add integration tests proving each advertised capability and relevant failure path.
- [ ] Add one essential Playwright journey for starting and resuming a support conversation.
- [ ] Document Pydantic AI glue code, limitations, and observed developer experience in an ADR.

### Acceptance criteria

- The same sandbox and public contracts can support another agent adapter without modification.
- A user can inspect tool activity, structured results, session state, and a correlated trace.
- Unsupported capabilities are visible and do not appear as successful framework features.
- Sensitive content is absent from exported trace attributes and structured logs.

### Out of scope

Modifying order actions, Vercel AI SDK, framework scoring, Temporal, and automated simulation.

## Milestone 3 — Safe modifying actions

### Goal

Demonstrate that an agent can propose and execute a business-changing action safely and
reproducibly.

### Outcomes

- [ ] Add a τ³-inspired scenario requiring one modifying order action.
- [ ] Define the versioned modifying tool contract and business validation rules.
- [ ] Require explicit user confirmation before execution.
- [ ] Enforce idempotency and optimistic concurrency on the write path.
- [ ] Add retry rules that never duplicate a successful business action.
- [ ] Expose proposal, confirmation, execution, refusal, conflict, and retry states in the UI.
- [ ] Trace the full action lifecycle with sanitized OpenTelemetry attributes.
- [ ] Test success, cancellation, validation refusal, replay, stale version, and transient failure.
- [ ] Add one essential Playwright journey covering confirmation and execution.

### Acceptance criteria

- No modifying action executes without a confirmation bound to the exact proposed action.
- Replaying a completed request with the same idempotency key does not duplicate the change.
- A stale order version returns a visible conflict instead of overwriting newer state.

## Milestone 4 — Vercel AI SDK comparison

### Goal

Implement the same proven scenarios through Vercel AI SDK and compare integration characteristics
without changing the sandbox, domain, public API, or playground behavior.

### Outcomes

- [ ] Implement the Vercel AI SDK adapter behind the existing `AgentAdapter` contract.
- [ ] Run the same read-only and modifying scenarios with the same versioned tools.
- [ ] Produce the same common OpenTelemetry trace vocabulary.
- [ ] Prove capability declarations with the shared contract/integration test suite.
- [ ] Document glue code, framework constraints, missing capabilities, and observed failure behavior.
- [ ] Present a side-by-side capability matrix without a single aggregate score.

### Acceptance criteria

- No scenario, domain rule, public route, or shared UI component is forked by framework.
- Framework-specific limitations are explicit and supported by evidence.
- Both adapters remain independently selectable in application composition.

## Milestone 5 — Regression scenarios

### Goal

Add repeatable automation only after the human demo and capability contracts are stable.

### Outcomes

- [ ] Define a compact, versioned regression scenario format derived from proven human journeys.
- [ ] Add deterministic runners for selected success and failure cases.
- [ ] Evaluate whether deeper τ³-bench dataset or harness integration provides enough value.
- [ ] Store results and trace references without turning the project into a performance leaderboard.

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
