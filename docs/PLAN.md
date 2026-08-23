# Project plan

Status: current redesign roadmap — 2026-08-23

## Purpose and authority

Build the Simulation Studio and Experiment Lab defined by `docs/product-direction.md` and accepted
by ADR 0011. This roadmap replaces the former plan whose next milestone was the Vercel AI SDK
adapter.

Read documents in this order before changing code:

1. `AGENTS.md`;
2. `docs/product-direction.md`;
3. `docs/architecture.md`;
4. this roadmap; and
5. the task-specific guideline and ADRs.

For target UI work, also read `docs/design-brief.md` and `docs/design-direction.md` (the selected
direction and its retained mockups).

When an old ADR describes currently implemented POC behavior and conflicts with the approved target
product, preserve it as history but follow ADR 0011 and this roadmap for new work.

## Current implementation state

The current POC already proves:

- a pnpm/uv monorepo, FastAPI backend, React/Vite frontend, and generated OpenAPI types;
- clean architecture boundaries, repositories, and a framework-neutral `AgentAdapter`;
- a minimal customer, product, order, scenario, session, memory, and action domain;
- deterministic seeded personas and canonical initial-state fingerprints;
- SQLite/SQLAlchemy/Alembic persistence with migration tests;
- read-only commerce tools and one confirmed, idempotent, optimistic cancellation action;
- Pydantic AI plus deterministic fake-adapter evidence;
- durable conversations, resume, persona/conversation listings, and a basic comparison view; and
- sanitized OpenTelemetry traces with optional Phoenix export.

The POC does not implement the target Shop/Scenario Studio, rich commerce model, published agent
configurations, paired experiment runner, participant-driver port, LLM judge, experiment-first
history, or target wrong-address journey. Existing persona-first contracts and data may be replaced
through cohesive tested slices.

## Delivery rules

- One short-lived branch delivers one independently useful, reviewable slice.
- Do not split a public contract from its application behavior, persistence, frontend consumer,
  migration behavior, and acceptance evidence.
- Prefer a vertical path that works end to end over broad disconnected tables or forms.
- Keep current POC behavior working unless the slice explicitly replaces it and tests the new
  boundary.
- Do not add compatibility layers for discarded local POC data unless the slice declares that
  starting state supported.
- Mark an outcome complete only when its tests, contracts, migrations, documentation, and UI where
  applicable are present.
- `make check` passes before handoff. Frontend/build changes also pass `pnpm build`; essential changed
  journeys pass Playwright.

## Stable target vocabulary

- **Definition:** an authorable resource with a mutable draft and immutable published versions.
- **Shop:** versioned synthetic commerce configuration and support knowledge, including named
  tone-of-voice guidelines with one shop default.
- **Customer profile:** versioned fictional identity and behavior used to create sandbox customer
  state, including a named address book with one default; orders select an address and store a
  frozen, source-labeled copy.
- **Support identity:** versioned role, permissions, and guidance adopted by the support agent;
  tone of voice comes from the shop's guidelines.
- **Ticket:** versioned support-incident record scoped to one shop and one customer: channel,
  origin references, prior message history, and the triggering first message.
- **Scenario:** versioned experiment recipe built on one ticket and its linked shop-scoped objects,
  adding hidden facts, context documents, bound objective and mutation blocks, and completion
  conditions.
- **Objective block:** versioned, parameterized, shop-independent objective template; a scenario
  binds its parameters to same-shop objects and a severity.
- **Mutation block:** versioned, parameterized, shop-independent fault/mutation template applied by
  the scenario runtime at a bound trigger time, never visible to the support agent.
- **Agent configuration:** versioned framework, architecture, model, prompt, tools, memory, support
  identity, and runtime settings.
- **Sandbox snapshot:** canonical immutable starting state resolved for an experiment.
- **Experiment:** immutable record binding one scenario to one or two agent configurations.
- **Run:** independently mutable experiment arm and its evidence.
- **Participant driver:** human, future LLM, or scripted source of customer turns.
- **Evaluation:** deterministic, judge, or quantitative evidence associated with a run or comparison.

Exact code names may evolve through accepted designs; documents and UI should use these meanings
consistently.

## Planning principles

### Tool-first simulation

- Direct agent input carries the customer message and minimal interaction resource references.
- Most commerce facts and all commerce mutations flow through versioned, framework-neutral tools.
- Tool handlers call application use cases and never bypass authorization or domain rules.
- Comparison treats tool selection, arguments, ordering, retries, and effects as evidence.

### Reproducibility and isolation

- Publish immutable versions of every definition that can affect behavior.
- Resolve and fingerprint the complete sandbox before execution.
- Clone equivalent starting state into isolated arms; one arm never mutates the other.
- Record all configuration and evaluator versions needed to explain a historical result.
- Record human input divergence after the identical scenario trigger.

### Evidence, not leaderboard scoring

- Deterministic state/event/policy evidence is authoritative for encoded rules.
- LLM judge evidence is anonymized, versioned, structured, rerunnable, and separate.
- Quantitative metrics are interpreted in context and only compare efficiency after outcome quality.
- Do not collapse evidence into one global framework score.

### Extensibility with invariants

- Use typed models for variants, money, inventory, orders, permissions, and business transitions.
- Use administrator-defined typed attributes for extensible catalog content.
- Use versioned extension metadata only where it cannot silently bypass core rules.
- Add concrete capability before generalizing a speculative abstraction.

## Milestone 0 — Direction reset

### Goal

Prevent further work from extending obsolete POC assumptions.

### Outcomes

- [x] Approve the Simulation Studio and Experiment Lab product direction.
- [x] Record ADR 0011 and its relationship to POC ADRs.
- [x] Replace the old Vercel-first roadmap.
- [x] Mark persona-first and hard-coded scenario documentation as historical where necessary.
- [x] Update contributor entry points to distinguish current code from target architecture.

### Acceptance criteria

- A fresh contributor can identify the product source of truth and next implementation slice.
- No current document names a second framework adapter as the immediate next task.
- Historical POC behavior remains documented without being presented as the target product.

## Milestone 0.5 — Design direction selection

### Goal

Select the product design direction before building any target UI, so Studio, Bench, and History
increments implement one coherent information architecture instead of extending the POC's
persona-first navigation.

### Outcomes

- [x] Produce the three concept directions defined by `docs/design-brief.md`. A first iteration may
  scope each direction to its most differentiating signature frame (the live split-view experiment)
  before investing in the full stage-one frame set.
- [x] Evaluate the directions against the brief's evaluation criteria and record strengths, risks,
  and implementation implications per direction.
- [x] Select or deliberately merge one direction and record the decision in a design-decision
  document or ADR, with pointers to the retained mockups. See `docs/design-direction.md`.
- [x] Expand the selected direction to the brief's stage-one deliverables: the four high-fidelity
  key frames, supporting workflow frames, and the navigation/information-architecture model. (The
  brief's narrow-width live-comparison treatment was deliberately dropped; desktop is the
  operating environment.) The full frame set lives on the canvas page "Shop workspace — v2 IA"
  and is exported locally to `tmp/design-frames/` (see `docs/design-direction.md`).
- [x] Update this roadmap's UI-bearing slices where the selected direction changes their scope or
  ordering (ticket model, block libraries, shop-level tone of voice, and address-book decisions
  are reflected in the vocabulary and milestone outcomes above).

### Sequencing

Milestone 1 Slice 1 is UI-free and may proceed in parallel with this milestone. No UI-bearing slice
(Milestone 1 Slice 2 onward) starts before the direction decision is recorded.

### Acceptance criteria

- A discoverable, recorded decision names the selected direction and its mockups.
- The Studio/Bench/History application shell is assigned to a concrete implementation slice.
- Subsequent UI increments can cite the frames they implement instead of inventing layout ad hoc.

## Milestone 1 — Versioned simulation definitions

### Goal

Establish the target authoring and snapshot foundations without prematurely rebuilding the entire
frontend or adding another agent framework.

### Slice 1 — Definition lifecycle and snapshot boundary

- [x] Define stable identifiers and the draft/published-version lifecycle for target definitions.
- [x] Define the canonical sandbox snapshot boundary and version axes without copying the POC's
  minimal aggregate shape.
- [x] Decide and test the supported migration/reset path from existing POC databases.
- [x] Add pure domain/application tests for immutability, version resolution, and invalid references.
- [x] Record the schema and fingerprint decisions in an ADR before publishing new contracts; the
  same ADR formalizes the model revisions in `docs/design-direction.md` (ticket, objective/mutation
  blocks, address book, shop-level tone of voice) and aligns `docs/product-direction.md`. See
  ADR 0012.

Slice evidence: no live model or server is required; pure tests demonstrate that a published version
cannot mutate and that an experiment resolution can identify every behaviorally relevant input.

### Slice 2 — Shop and extensible catalog

- [ ] Add shop drafts and published versions.
- [ ] Add products, option definitions, variants, prices, availability, media references, ratings,
  reviews, and a first bounded set of typed custom attributes.
- [ ] Add FAQ, policy, payment-method, fulfilment, and support-guideline configuration needed by the
  first scenario.
- [ ] Persist through ports and publish the contract together with a minimal Studio UI.
- [ ] Introduce the selected design direction's application shell and Studio navigation with this
  first target UI instead of extending persona-first navigation (requires the Milestone 0.5
  decision).
- [ ] Validate and preview a shop before publication.

Slice evidence: an author can publish a shop containing a product with size/color variants and
retrieve the same immutable version through the public contract.

### Slice 3 — Synthetic customer and support identity

- [ ] Add versioned customer profiles separating fictional personal facts from behavioral persona.
- [ ] Support addresses, account facts, relevant commerce/support history, and hidden simulator facts.
- [ ] Add versioned support identities with role, tone, permissions, and guidance.
- [ ] Clearly label synthetic data and prove sensitive fields are excluded from logs/traces.
- [ ] Add Studio forms, validation, persistence, and contract tests.

### Milestone acceptance

- Published definitions remain immutable and historical versions resolvable.
- Core commerce concepts enforce typed invariants while configured attributes can grow safely.
- The UI and API distinguish drafts from published versions.
- Target UI increments follow the design direction selected in Milestone 0.5.
- The current POC contract is either preserved or deliberately replaced according to the accepted
  slice design; there is no accidental hybrid model.

## Milestone 2 — Scenario Studio and wrong-address sandbox

### Goal

Author and materialize the first complete target incident without editing code for each scenario
instance.

### Outcomes

- [ ] Define versioned tickets (channel, origin references, prior conversation, trigger) and the
  scenario recipe on top of them: hidden facts, context documents, composed objective and mutation
  blocks, and completion conditions.
- [ ] Define the shared objective/mutation block libraries: parameterized templates, draft/published
  versions, and same-shop binding validation.
- [ ] Build a scenario editor with validation and a resolved-state preview.
- [ ] Support product-page and order-page origins using minimal resource references.
- [ ] Materialize the paid-order/wrong-shipping-address scenario into a canonical snapshot.
- [ ] Clone a snapshot into independently mutable sandbox state.
- [ ] Add versioned read tools for interaction context, catalog, customer, order, and support
  knowledge.
- [ ] Add a safe address-change proposal/action with authorization, confirmation, idempotency, and
  optimistic concurrency.
- [ ] Prove deterministic generation, canonical serialization, and tool behavior with unit and
  integration tests.

### Acceptance criteria

- An author can publish the scenario and reproduce the same canonical snapshot from recorded inputs.
- A product-page question can resolve “this product” from the interaction reference and tool calls,
  without embedding the full product payload in the initial prompt.
- Two sandbox clones begin with the same fingerprint and mutations remain isolated.
- Backend rules reject unsafe or stale address changes regardless of model output.

## Milestone 3 — Agent configurations and human participant driver

### Goal

Make the support agent and customer-input mechanism reusable, versioned experiment inputs.

### Outcomes

- [ ] Add draft/published agent configurations covering framework, architecture, model, prompt,
  tools, memory, support identity, and runtime settings.
- [ ] Validate requested configuration against proven adapter capabilities.
- [ ] Evolve the agent port only for requirements proven by the target scenario.
- [ ] Introduce a participant-driver port and human-operator implementation.
- [ ] Persist resolved configurations and participant events without framework SDK types.
- [ ] Keep deterministic adapter tests and optional live-model smoke tests separate.

### Acceptance criteria

- The same published agent configuration can be selected for multiple experiments.
- Human participant input flows through a port that can later support LLM/scripted implementations.
- Framework, model, prompt, tools, and architecture are explicit versioned inputs rather than hidden
  composition defaults.

## Milestone 4 — Paired experiment runner and live bench

### Goal

Run one or two agent configurations against isolated copies of the same incident and expose their
behavior side by side.

### Outcomes

- [ ] Create immutable experiment records and independently progressing runs.
- [ ] Start both arms from one canonical snapshot and send the same trigger.
- [ ] Add a linked customer composer that can split into arm-specific replies.
- [ ] Persist operator input divergence, assistant turns, tool events, confirmations, state changes,
  failures, traces, and completion.
- [ ] Warn when framework, architecture, model, prompt, or tools introduce multiple comparison
  variables.
- [ ] Show normalized execution timelines and project-owned source locations where available.
- [ ] Cover start, divergence, independent action, resume, and completion with focused tests and an
  essential Playwright journey.

### Acceptance criteria

- An action in one arm cannot alter the other arm.
- Both arms are explainably tied to the same initial fingerprint and exact published inputs.
- Divergent human replies remain visible in later comparison.
- A framework-specific event never leaks into the shared public or stored evidence contract.

## Milestone 5 — Evaluation and experiment history

### Goal

Turn completed runs into durable, searchable comparison evidence.

### Outcomes

- [ ] Evaluate deterministic state, event, tool, policy, safety, and completion objectives.
- [ ] Add a versioned judge configuration and anonymized structured LLM-judge execution.
- [ ] Record turns, token usage, model/tool calls, duration, retries, failures, and estimated cost
  when available.
- [ ] Present objective-level comparison without a global framework score.
- [ ] Replace persona-first history with experiment-first filters and detail pages.
- [ ] Preserve evaluator executions, notes, tags, state diffs, traces, replay, and fork provenance.
- [ ] Test judge failure/rerun separately from deterministic outcome calculation.

### Acceptance criteria

- Deterministic evidence remains readable and unchanged when a judge is unavailable or rerun.
- Judge inputs are framework-blind and every output is tied to a model, prompt, rubric, and input
  fingerprint.
- Efficiency metrics are displayed with outcome and configuration context.
- Historical experiments remain reproducible after newer definition versions are published.

## Milestone 6 — Second comparison implementation

### Goal

Add the second framework or a materially different agent architecture only after the target
environment, scenario, runner, and evidence model are proven.

### Outcomes

- [ ] Select whether the first controlled comparison changes framework or architecture.
- [ ] Implement it behind the shared target contracts and conformance suite.
- [ ] Produce equivalent normalized tools, events, traces, and evaluation inputs.
- [ ] Document project-owned glue code, constraints, failures, and observed behavior.
- [ ] Prove the wrong-address scenario in a two-arm comparison.

Vercel AI SDK remains a candidate, not an automatic next task.

## Deferred decision triggers

### Autonomous customer simulator

Implement after the human driver and scenario hidden-fact contract are stable. It must use the
participant-driver port, remain independent of the support framework, and record its model/prompt
configuration and nondeterministic outputs.

### PostgreSQL

Evaluate when meaningful concurrent writers, shared deployment, or query/load requirements exceed
SQLite. Preserve SQLAlchemy/Alembic portability until then.

### Durable workflow runtime

Evaluate when experiments must survive process failure or coordinate long waits/retries beyond
stored run recovery. Do not add one solely to demonstrate a framework feature.

### Deeper benchmark integration

Evaluate external datasets, harnesses, or evaluator patterns only after the local authoring and
experiment contracts are stable and only when they add evidence without taking ownership of the
product model away from the lab.

## Historical POC milestones

The former Milestones 1–3.5 were completed and remain documented by ADRs 0005–0010, Git history,
tests, and the running code. Their outcomes are the POC baseline summarized above; they are not
unfinished target-product milestones.
