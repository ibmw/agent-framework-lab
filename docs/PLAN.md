# Project plan

Status: current redesign roadmap — 2026-08-24

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

Milestone 1 Slice 2 replaced the persona-first frontend with the target Studio shell and delivered
the versioned shop and catalog (ADR 0013). Slice 3 added versioned customer profiles and support
identities on a shared authoring lifecycle (ADR 0014). Milestone 2 has begun with shop-scoped order
fixtures: typed status axes, derived totals, authored events, and selection-only line items and
shipping addresses (ADR 0015), followed by versioned tickets — the first shop-scoped definition,
pinning its shop and customer-profile versions at publication (ADR 0016), then the shared objective-
and mutation-block libraries a scenario composes (ADR 0017), and then the scenario recipe and its
composition editor, which binds those templates to same-shop objects and pins every version a
publication freezes (ADR 0018), and then the canonical sandbox snapshot that turns a published
recipe into starting state by pinning what is immutable and copying the order fixtures nothing
pinned (ADR 0019), and then the independently mutable clone each experiment arm works in
(ADR 0020), and then the versioned read tools an arm interrogates that clone through (ADR 0021), and
then the safe address change an arm may actually make (ADR 0022), and finally the evidence that
holds all of it: recorded fingerprints for the canonical envelopes and a conformance sweep driven by
the tool registry rather than by a list (ADR 0023), which completes the milestone. Milestone 3 has
begun with the agent configuration: the support agent published as a versioned experiment input —
framework, architecture, model, prompt template, tool bindings, memory, and the support identity it
adopts — validated against what the lab has actually proven it can run (ADR 0024), and then the
experiment that binds one published scenario version to one or two of those configurations,
clones an arm per configuration from one canonical snapshot, opens both threads on the ticket's
triggering message, and takes every later customer turn through a participant-driver port whose
first implementation is the human operator (ADR 0025) — which also completes Milestone 4's
experiment record, shared trigger, linked composer, and comparison-variable warning. Milestone 4
has since gained the other half of those threads: advancing one arm runs its published
configuration against that arm's own sandbox through a new framework-neutral runtime port, and
records what it answered, every versioned tool call it made, the confirmation and revision each
write carried, and the attempt in which it failed — with two frameworks behind that port, a
declared deterministic control policy and Pydantic AI over the published tool contracts
(ADR 0026), then the normalized execution timeline that reads all of it back as one
framework-neutral stream, each entry carrying the project-owned file and line of the code that ran
it where this build can resolve one (ADR 0027), and finally the scenario's own faults firing into a
running arm at the moment the recipe bound them to — between two of the agent's calls, against a
declared table of what this build can actually carry out, recorded once per arm (ADR 0028), and finally the experiment an operator comes back to: each
arm's standing read from its own record so a bench reopened cold says what it is waiting for,
and the question an arm passed over reported rather than left to be noticed (ADR 0029).
The POC's conversation, persona, and order-action HTTP contracts
remain published and tested but have no UI consumer until the Milestone 2–4 surfaces are built on
the new shell.

The POC does not implement the target Scenario Studio, published agent configurations, LLM judge,
experiment-first history, or target wrong-address journey. Existing persona-first contracts and data may be replaced through cohesive
tested slices.

## Delivery rules

- One short-lived branch delivers one independently useful, reviewable slice.
- Do not split a public contract from its application behavior, persistence, frontend consumer,
  migration behavior, and acceptance evidence.
- Prefer a vertical path that works end to end over broad disconnected tables or forms.
- Keep current POC behavior working unless the slice explicitly replaces it and tests the new
  boundary.
- Do not add compatibility layers for discarded local POC data unless the slice declares that
  starting state supported.
- UI-bearing slices implement the frames named in their "Frames:" line from the Milestone 0.5
  authoritative set (`docs/design-direction.md`; local export with index in
  `tmp/design-frames/README.md`) instead of inventing layout ad hoc.
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

- [x] Add shop drafts and published versions.
- [x] Add products, option definitions, variants, prices, availability, media references, ratings,
  reviews, and a first bounded set of typed custom attributes.
- [x] Add FAQ, policy, payment-method, fulfilment, and support-guideline configuration needed by the
  first scenario.
- [x] Persist through ports and publish the contract together with a minimal Studio UI.
- [x] Introduce the selected design direction's application shell and Studio navigation with this
  first target UI instead of extending persona-first navigation (requires the Milestone 0.5
  decision).
- [x] Validate and preview a shop before publication.

Frames: 1 · Shop home (the application shell: pine top bar, shop switcher, resource sidebar,
index-table and draft/published-chip conventions) and 2c · Product editor. Shop setup surfaces
(identity, policies, FAQ, tone of voice) have no dedicated frame; they live under the sidebar's
Shop setup section and follow the same shell conventions.

Slice evidence: an author can publish a shop containing a product with size/color variants and
retrieve the same immutable version through the public contract. ADR 0013 records the
`shop-payload-v1` schema, the publish gate, the definition-document persistence shape, and the
Studio shell that replaced the POC's persona-first navigation.

### Slice 3 — Synthetic customer and support identity

- [x] Add versioned customer profiles separating fictional personal facts from behavioral persona.
- [x] Support addresses, account facts, relevant commerce/support history, and hidden simulator facts.
  Authored pre-sandbox background travels with the profile; shop-scoped order and ticket history
  stays with its shop and arrives with Milestone 2, as the design direction requires.
- [x] Add versioned support identities with role, permissions, and guidance. Tone of voice is
  shop-level under ADR 0012 and is deliberately not part of a support identity.
- [x] Clearly label synthetic data and prove sensitive fields are excluded from logs/traces.
- [x] Add Studio forms, validation, persistence, and contract tests.

Frames: 6 · Customers and 6b · Customer editor — address book. Support-identity forms have no
dedicated frame and follow the shell's resource-editor conventions. The address book authored here
is the selection source for the order editor's frozen address copies (frame 2b, Milestone 2).

Slice evidence: an author creates a synthetic customer inside a shop, authors the address book and
persona, publishes it, and the published version stays frozen while the draft moves on. ADR 0014
records the `customer-profile-payload-v1` and `support-identity-payload-v1` schemas, the
field-sensitivity classification that keeps synthetic personal data out of logs and traces, the
per-shop attachment relation, and the extraction of the shared draft/published lifecycle that
ADR 0013 anticipated.

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

- [x] Author order fixtures through the order editor: typed status transitions, derived totals,
  authored order events, and a shipping address selected from the customer's address book and
  stored as a frozen, source-labeled copy.
- [x] Define versioned tickets: channel, origin references, prior conversation, and the triggering
  first message every arm receives.
- [x] Define the shared objective/mutation block libraries: parameterized templates, draft/published
  versions, and same-shop binding validation.
- [x] Define the scenario recipe on top of a published ticket: hidden facts, context documents,
  composed objective and mutation blocks, and completion conditions.
- [x] Build a scenario editor with validation and a resolved-state preview.
- [x] Support product-page and order-page origins using minimal resource references.
- [x] Materialize the paid-order/wrong-shipping-address scenario into a canonical snapshot.
- [x] Clone a snapshot into independently mutable sandbox state.
- [x] Add versioned read tools for interaction context, catalog, customer, order, and support
  knowledge.
- [x] Add a safe address-change proposal/action with authorization, confirmation, idempotency, and
  optimistic concurrency.
- [x] Prove deterministic generation, canonical serialization, and tool behavior with unit and
  integration tests.

Frames: 2 · Orders, 2b · Order editor, 3 · Tickets — helpdesk view, 4 · Scenario editor — composed
blocks, 4a · Objective block library, and 4b · Mutation block library.

Ticket evidence (frame 3): an author opens the wrong-address incident on one shop's customer, authors
the prior support history and the triggering first message, links the stale-address order, and
publishes; the frozen version keeps what it froze while the draft moves on. ADR 0016 records the
`ticket-payload-v1` schema, the decision that a ticket **is** a definition where the order beside it
is not, the separation of prior history from the trigger, the minimal origin reference, and the
extension of the shared authoring lifecycle to shop-scoped types that pin their shop and their
references. The scenario recipe is deliberately deferred to the slice that also delivers the block
libraries and the scenario editor, because a scenario payload is mostly block bindings whose shape
those libraries fix.

Block-library evidence (frames 4a and 4b): an author publishes the `read-required-document`
objective and the `concurrent-entity-mutation` fault, and a mutation refuses to publish until it says
when it fires. ADR 0017 records the `objective-block-payload-v1` and `mutation-block-payload-v1`
schemas, the typed parameter model whose kind decides what a scenario must bind inside its own shop,
the rule that a template may never default a reference, the timing rules that separate a scheduled
mutation from a goal-based objective, and the assessment/evidence pairing. The libraries landed
**before** the scenario recipe deliberately: a scenario payload is mostly block bindings, so the
templates had to fix that shape first. ADR 0016 deferred the recipe to "the slice that also delivers
the block libraries and the scenario editor"; ADR 0017 splits that slice, delivering the libraries on
their own so each stays reviewable.

Scenario evidence (frame 4): an author composes the wrong-address recipe on the published ticket —
the context document the incident turns on, a read-check bound to that document, and a concurrent
mutation bound to the stale-address order — reads the resolved starting state beside the publish
gate, and publishes; the frozen version keeps the shop, ticket, and template versions it pinned while
every draft around it moves on. ADR 0018 records the `scenario-payload-v1` schema, the reference
grammar a binding resolves through and the rules that keep every one of them inside the scenario's
own shop and its ticket's customer, the decision that an objective's severity is the instance's
rather than a binding, the multi-target pin that freezes one version per composed template however many
times it is bound, and the resolved-state preview that travels with the publish gate because the two
answer one question together. It also extracts `ShopDocumentKind` so a ticket's suggestion, a
scenario's context entry, and a read-check's binding name the shop's document collections once.

Snapshot evidence (no frame; the page follows the shell's resource conventions): an author freezes a
published wrong-address version into canonical starting state, reads the versions it pinned beside
the order fixtures it had to copy, and freezes it again to the same snapshot — while an order edited
in between produces a new one. ADR 0019 records the `sandbox-v2` envelope, the rule that a snapshot
pins what is already immutable and copies only what no published version pinned, the decision that a
snapshot is identified by its fingerprint rather than by its inputs, the whole-customer order set a
sandbox holds, the minimal interaction reference that carries a product-page or order-page origin
into the runtime, and the publish gate re-run against the world as it is now. It also splits
`resolve_sandbox_inputs` out of the experiment resolution, because a snapshot is materialized before
any agent configuration is chosen.

Clone evidence (no frame; the arms live on the snapshot page under the shell's resource
conventions): an operator clones one frozen snapshot into two arms, reads back the one current-state
fingerprint they share, and a change applied inside one arm moves that arm alone — never the arm
beside it and never the snapshot both were taken from. ADR 0020 records the `sandbox-state-v1`
document, the rule that a clone copies the state and pins the snapshot, the two fingerprints that say
where an arm started and where it is, the write seam a run's tools mutate through and why no public
write endpoint exists until there is an actor to authorize, the optimistic-concurrency token the store
decides, and the decision that cloning is deliberately not idempotent where materializing is.

Read-tool evidence (no frame; the console follows the shell's resource conventions beside the arms
it reads): an operator selects one arm, reads the interaction the incident opened from, follows the
identifier it carries to the order that ships to the stale address, reads the shipping policy the
incident turns on — and gets a refusal, not an error, for an order reference the customer never had.
ADR 0021 records the eight published tool contracts, the `tool-result-v1` envelope, the rule that a
tool never serves a `CUSTOMER_ONLY` field while serving `SENSITIVE` ones in full, the decision that a
refusal is a value and an unknown tool name is not, the string-only argument table a framework
adapter later derives its schema from, and the entry of the tool versions into the sandbox
fingerprint — which makes a snapshot frozen after this slice a different starting state from one
frozen before it, correctly and without a migration.

Address-change evidence (no frame; the write lives in the console beside the arms it moves): an
operator reads the order that ships to the stale address, proposes redirecting it to the customer's
current entry under a support identity permitted to make that change, applies the confirmation the
proposal answered with — and the arm beside it still ships to the old address. ADR 0022 records the
two write tools and why the mutation is split into a proposal and an application, the confirmation
that names a change by its content and so serves as the consent binding and the idempotency key at
once, the actor that travels in the call envelope because an agent that could name its own actor
would be choosing its own permissions, the revision a proposal carries from the read into the write,
the decision that a stale write is a refusal rather than a 409 because the world moving under an
agent is something the agent must recover from, and the declared `effect` that keeps a read handler
structurally unable to move an arm. It also enters the write tools into the sandbox fingerprint, for
the same reason and with the same absence of a migration as ADR 0021.

Conformance evidence (no frame; this outcome is a test slice with no production code change): the
canonical serializer writes one recorded byte string and the wrong-address starting state hashes to
one recorded fingerprint, so a change to either is a deliberate answer to "is every snapshot frozen
before now a different starting state" rather than a silent one; a snapshot whose stored row is
deleted between two freezes is recomputed to the same document rather than recognized; and every
published tool — not a list of the ones somebody sampled — answers a valid call with a canonical
document, leaves the arm where it stood if it reads, refuses an argument it does not declare without
having moved the arm on the way, enforces the arguments it calls required, runs under an actor if it
writes, and serves no `CUSTOMER_ONLY` value. ADR 0023 records the goldens and the rule that a golden
owns its inputs, the difference between a fingerprint that is recomputable and one that is merely
recognizable, the sample-call table checked against the contract registry so a new tool joins every
sweep the day it is declared, the non-emptiness checks that keep a parameterized sweep from passing
vacuously, and the argument-for-argument check that the published listing is the declaration table
rendered.

Order evidence (frames 2 and 2b): an author builds the paid, unfulfilled order that ships to
the customer's stale address, and the frozen copy survives an edit to the address-book entry it came
from. ADR 0015 records the `order-fixture-v1` schema, the decision that an order is shop-scoped
authored state rather than a definition, the forward-only status graph, the selection-only write
contract, and the drift findings that replace ADR 0014's deferred address-deletion check. Freezing an
order into a published scenario version arrives with the scenario outcome above.

### Acceptance criteria

- An author can publish the scenario and reproduce the same canonical snapshot from recorded inputs.
- A product-page question can resolve “this product” from the interaction reference and tool calls,
  without embedding the full product payload in the initial prompt.
- Two sandbox clones begin with the same fingerprint and mutations remain isolated.
- Backend rules reject unsafe or stale address changes regardless of model output.

## Milestone 3 — Agent configurations and human participant driver

### Goal

Make the support agent and customer-input mechanism reusable, versioned experiment inputs.

### Slice 1 — Agent configuration definition and prompt editor

- [x] Add draft/published agent configurations covering framework, architecture, model, prompt,
  tools, memory, support identity, and runtime settings.
- [x] Validate requested configuration against proven adapter capabilities.
- [x] Keep deterministic adapter tests and optional live-model smoke tests separate.

Frames: 5 · Agent configuration — variables (markdown prompt editor with variable chips, grouped
insert menu with the non-injectable group, preview context, and the LLM/runtime configuration
card).

Slice evidence: an author publishes a shop and a support identity, composes a shop-independent
configuration on top of them, reads every `{{variable}}` in its prompt resolved against a chosen
preview shop and the identity's published version, and publishes — after the gate has refused the
two things a configuration must never carry: a fact the agent is meant to discover through tools,
and a write its identity could never be authorized to make. The frozen version keeps the
support-identity version it pinned while every draft around it moves on. ADR 0024 records the
`agent-configuration-payload-v1` schema, the closed prompt-variable table and why customer, order,
and ticket facts are declared in it but never injectable, the proven-capability catalog declared
apart from the adapters so the gate stays testable offline, the gate rules that reach outside the
payload, the permission a write tool now declares on its own contract so the runtime and the gate
read one table, and the preview resolution that travels with the gate without ever entering the
payload.

### Slice 2 — Participant driver and resolved run inputs

- [x] Evolve the agent port only for requirements proven by the target scenario. Nothing here
  proves one — no arm runs a model — so `AgentAdapter` is deliberately unchanged. (Milestone 4's
  runner does prove one, and answers it with a separate `SupportAgentRuntime` port rather than by
  bending this one: ADR 0026.)
- [x] Introduce a participant-driver port and human-operator implementation.
- [x] Persist resolved configurations and participant events without framework SDK types.

Frames: 7 · Experiment setup, and the participant half of 8 · Live bench (the two threads, the
customer composer, and the provenance strip; the agent's side of each thread arrives with the
runner that produces it).

Sequencing: this slice was delivered against the Milestone 4 runner that calls it, so it also
completes that milestone's first two outcomes. A port designed before it has a caller would be
shaped by a hypothetical one.

Slice evidence: an operator publishes a scenario and two agent configurations, reads the
comparison matrix before anything is frozen — one arm differing nowhere, two arms differing only
in their prompt — starts the experiment, and finds both arms opening on the ticket's triggering
message from one shared starting-state fingerprint; a message sent to both arms is one
composition, and the same words sent to one arm alone are a second the record keeps apart.
ADR 0025 records the `experiment-v1` envelope that pins the arms by content and the world by
fingerprint, the one-method participant port and why the trigger does not travel through it, the
composition identity that makes divergence readable rather than inferred, the setup gate that
answers the tone-of-voice check ADR 0024 deferred to experiment setup, and the comparison matrix
whose difference set enters the experiment's fingerprint.

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

- [x] Create immutable experiment records and independently progressing runs (ADR 0025, with
  Milestone 3 Slice 2).
- [x] Start both arms from one canonical snapshot and send the same trigger (ADR 0025).
- [x] Add a linked customer composer that can split into arm-specific replies (ADR 0025).
- [x] Persist operator input divergence, assistant turns, tool events, confirmations, state changes,
  and failures (ADR 0025 for operator input; ADR 0026 for everything an agent produces; ADR 0028
  for the state changes the scenario itself makes). Traces
  arrive with the timeline outcome below; completion is judged against the scenario's completion
  conditions and belongs with Milestone 5's evaluation.
- [x] Warn when framework, architecture, model, prompt, or tools introduce multiple comparison
  variables (ADR 0025).
- [x] Show normalized execution timelines and project-owned source locations where available.
  Traces (frame 9b) arrive with Milestone 5's evaluation surfaces, and the code excerpt beside a
  location (frame 9c) with them (ADR 0027).
- [x] Fire the scenario's bound mutation blocks into a running arm at their bound timing, and
  record what each one moved (ADR 0028).
- [ ] Cover start, divergence, independent action, resume, and completion with focused tests and an
  essential Playwright journey. Start, divergence, and independent action are covered (ADR 0025,
  ADR 0026) and resume is (ADR 0029); completion is judged against the scenario's completion
  conditions and follows with Milestone 5's evaluation.

Frames: 7 · Experiment setup and 8 · Live bench (icon-only rail, ticket-thread chat UI, provenance
chip strip, director's notes, objectives matrix), plus 9a · Execution timeline and the source
locations of 9c · Code paths, which this milestone's fifth outcome needs and Milestone 5 completes
with the traces and the code excerpt beside them.

Runner evidence (frame 8, the agent half): an operator runs one arm's agent and watches it follow
the incident from the interaction to the order, read the customer, and redirect the order to the
address on file — every call a recorded event, the write visible as the revision it moved — while
the arm beside it stays exactly where it was; a failed attempt is kept and the retry sits beside
it. ADR 0026 records the `SupportAgentRuntime` port and why it is new rather than an evolution of
the POC's `AgentAdapter`, the recording invoker that makes a tool event a property of the call path
rather than of an adapter reporting, the advance operation that is idempotent over an answer and
not over an attempt, the attempt as the unit a failure and a retry are recorded in, the failure
classified rather than described, the confirmation and the state change that need no record of
their own because the tool result and its revisions already carry them, the resolution that reads
the versions the experiment pinned, and the two runtimes: the declared control policy that makes
tool bindings a real comparison variable offline, and Pydantic AI deriving its tool schemas from
the contract table the lab publishes.

Timeline evidence (frame 9a, and the location half of 9c): an operator who has driven both arms
reads the incident as one stream — the opening both arms share, the reply only one of them heard,
each arm's calls in the order it asked, and the one write per arm that moved a world — then
narrows it to what changed something, and reads the project's own file and line behind every
entry. ADR 0027 records the timeline as a projection rather than a record and why a second stored
shape would be ADR 0026's refused confirmation record one level up, the composition as the
coordinate two arms share where an ordinal counts only one arm's turns, the merge of each arm's
ordinals that orders the stream without trusting a clock the runner reads once per attempt, the
entry that carries no word anyone said, the refusal kept apart from the error because ADR 0021
made them different things, and the source location resolved from the tool registry rather than
from a hand-kept map — project-owned only, never stored, and allowed to be absent, which is what
"where available" means. It also turns the write dispatch into the handler table that locates it,
so the map that names a write's code is the one that ran it.

Resume evidence (frame 8): an operator who ran one arm reloads the browser, leaves the bench, and
returns to the experiment through the shop's list — finding both threads as they stood, the answered
arm's reply with its calls and the fault that fired among them, and the arm that was never run still
the one offered to run. ADR 0029 records that resume has no mechanism of its own because an
experiment is entirely in the record, the arm standing derived rather than stored for the reason
ADR 0026 refused a status, the two things an arm can wait for and the "completed" value deliberately
left to Milestone 5's evaluation, the turn an arm passed over reported rather than implied, and the
one reading the runner and the bench now share so a button never offers a run the backend would
decline.

Fault evidence (frames 8 and 9a, the scenario's own half): an operator runs an arm and watches the
incident change under it — the order the recipe bound moves out of band at the moment it bound,
between two of the agent's calls, with the agent never told and the arm beside it untouched until
its own advance reaches the same moment. ADR 0028 records the firing that happens on the call path
rather than at a turn boundary and why the conflict ADR 0022 built needs it, the declared table of
effects and moments this build can actually carry out and the setup gate that refuses an experiment
whose fault would never fire, the moment decided from the arm's own record rather than from a clock,
the single step along the fulfilment graph that makes the world stale without making the incident
unwinnable, the once-per-arm key the store rather than the runtime enforces, and the timeline entry
that is a state change and never a tool call because no agent asked for it.

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

Frames: 9 · Experiment results — General tab, 9b · Traces tab, the code excerpt of 9c · Code paths
tab, and 10 · History; 9a · Execution timeline and 9c's source locations arrived with Milestone 4's
fifth outcome (ADR 0027) and are extended here rather than built again. Together with the
Milestone 4 frames this completes the 18-frame authoritative set.

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

Frames: none new; this milestone reuses the Milestone 3–5 surfaces (frames 5, 7–10).

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
