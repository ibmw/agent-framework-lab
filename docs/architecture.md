# Architecture

Status: the application as built — 2026-09-20.

Read `docs/product-direction.md` first. This document states the structure, the binding rules and
the shape of each boundary, with the ADR that reasoned it out; it does not repeat the reasoning.
Open work is in `docs/PLAN.md` and `docs/PLAN-UX.md`, never here. What remains of the original
proof of concept is listed at the end.

## Structure

```text
apps/
  api/                          FastAPI API, seed command and composition
    src/capability_lab/
      domain/                   definitions, sandbox, experiment, evaluation and judge invariants
      application/              use cases, canonical documents, ports and readings of the record
      infrastructure/
        agents/                 SupportAgentRuntime adapters: pydantic_ai, openai_agents, scripted, fake
        judges/                 JudgeRuntime adapters: control, pydantic_ai
        participants/           ParticipantDriver adapters: human, scripted
        models.py, repositories.py, database.py, config.py, telemetry.py
      presentation/             HTTP routes and schemas, one module per resource; seed/ is the demo
  web/                          React/Vite workspace
    src/
      api/                      one module per backend resource, typed from the contract
      routes/                   one page per surface
      shell/                    AppShell, ShopWorkspace, LabWorkspace, LabSurface
      components/               chrome and field primitives
      lib/                      pure rules mirrored from the backend, with their tests
packages/
  contracts/                    OpenAPI v1 contract and generated shared types
infra/
  phoenix/                      optional local trace consumer
docs/                           product, architecture, guidelines, ADRs, open plans, history/
.codex/skills/                  project skills; .claude/skills/ links to them
```

## Binding dependency rule

```text
presentation ──> application ──> domain
      │                 ▲
      └──> infrastructure ┘
```

- `domain` imports no web, ORM, agent SDK, telemetry, database, or durable-runtime library.
- `application` depends on domain concepts and declares the ports use cases require.
- `infrastructure` implements ports. Adapters do not import one another to compose workflows.
- `presentation` translates HTTP interactions and performs composition; it implements no business
  rule. A command is an entry point of the same kind, not a layer: the demo seed composes there and
  reaches the world only through application services, so no gate has a second way around it
  (ADR 0043).
- Composition is the only place allowed to select databases, agent frameworks, model providers,
  participant drivers, judge providers, or trace exporters.

Product areas may be organized as modules within these layers. A product-area name is never
permission for domain code to import infrastructure.

## Product areas and what implements them

| Area | Holds | Recorded in |
| --- | --- | --- |
| Catalog and commerce | versioned shops with catalog, policies, FAQ, tone of voice; shop-scoped order fixtures | ADR 0013, ADR 0015 |
| Customers and support | versioned customer profiles and support identities on one authoring lifecycle | ADR 0014 |
| Scenario Studio | versioned tickets; objective and mutation block libraries; the scenario recipe; preview and publish gates | ADR 0016–0018 |
| Agent configuration | versioned configuration of framework, model, prompt, tools, memory and support identity; the proven-capability catalog | ADR 0024, ADR 0053 |
| Experiments | snapshots, isolated clones, versioned tools, the runner, participant input, mutations, resume, replay and fork | ADR 0019–0022, ADR 0025–0029, ADR 0038–0039 |
| Evaluation | deterministic objectives, the versioned judge, cost, state diffs, traces, comparison, history, notes and tags | ADR 0030–0037, ADR 0040 |
| The lab layer | settings, the seed, per-surface tours, the two modes and their routes, the model connection | ADR 0043–0054 |

The exact aggregates, routes and tables of each area are the ones its ADRs record. A new area, or
a change to what one holds, is designed in a cohesive slice with its contract, persistence,
consumer, migration behavior and tests together.

## Definitions

An authorable resource is a **definition**: a mutable draft and immutable published versions,
stored as one canonical document per draft and per version in `definition_drafts` and
`definition_versions`. The composite key `(definition_type, definition_id, version)` is the
overwrite guard, and typed domain constructors re-validate every document on read (ADR 0013). Only
the payload codec and the publish gate are per type; the lifecycle is shared (ADR 0014). The
definitions are the shop, the customer profile, the support identity, the ticket, the scenario, the
objective block, the mutation block, the agent configuration and the judge configuration.

- Which shops use a shop-independent definition is an unversioned relation in
  `definition_shop_attachments`, never a pinned reference and never part of a fingerprint.
- An order fixture is shop-scoped authored state with no version of its own, stored with a content
  fingerprint so a published scenario can freeze a copy (ADR 0015).
- Publishing a scenario pins the exact ticket, block template and shop versions it was authored
  against; a ticket pins its shop and customer versions (ADR 0016).
- An agent configuration's prompt is a template over a closed variable table: shop and
  support-identity facts resolve at experiment start, while customer, order and ticket facts are
  never injectable, because discovering them through tools is part of what an experiment compares
  (ADR 0024). Its provider is authored content, never inherited from the lab's connection
  (ADR 0053).
- What an author may publish is judged against a declared catalog of what the lab has proven a
  framework can run, kept apart from the adapter registry so the gate does not change with the
  machine. A permission a write tool needs is declared on the tool contract, so the runtime that
  refuses an unauthorized call and the gate that refuses a configuration enabling it read one table.

Typed domain objects protect commerce invariants. Configurable typed attributes extend catalog
content without one schema change per display field; versioned metadata extensions are reserved for
non-critical information. Prices, variants, inventory, order state, permissions and action rules
never depend on unvalidated JSON.

## Tool-first execution boundary

The backend simulation is the source of truth. Direct agent input carries the customer message and a
minimal interaction context of references — channel, origin page, product, variant, locale, run
scope — and never a dump of the shop, catalog, customer or order database.

Framework-neutral versioned tools query or mutate an arm's sandbox through application use cases.
Tool adapters do not bypass application rules and do not use ORM models as public or tool schemas.
Run scoping and authorization prevent access to other synthetic customers. Safety and commerce
rules remain backend invariants whatever the model understood of a retrieved policy.

- A tool is scoped to one arm: it is given that arm's mutable state and the published versions its
  snapshot pinned, never a shop, a definition or a version as an argument (ADR 0021).
- A result distinguishes success, a refusal the agent can act on, and a technical failure that
  carries no explanation. Argument mistakes are refusals, because in a run the arguments are model
  output.
- No tool serves a `CUSTOMER_ONLY` field; `SENSITIVE` synthetic personal data is served in full and
  still never logged or traced. The published tool set enters the starting-state fingerprint.
- Each contract declares its `effect`. A write is proposed before it is applied. The confirmation
  names the change by its content, so it is both the consent binding and the idempotency key: the
  change applies exactly once and a repeat returns the first result. A proposal carries the
  revision it was computed at, so an arm that moved in between is refused as a refusal, not a
  transport error (ADR 0022).
- The acting support identity travels in the call envelope, never among the arguments, and its
  granted permissions are what authorize a write.

## Runtime ports

Three application ports stand between the lab and anything that runs a model. Agent SDK types never
enter the domain, the stored event format, the public API or the shared UI.

**`SupportAgentRuntime`** runs one arm's turn (ADR 0026). It is handed an invoker bound to one arm,
one actor, one tool set and one tool budget; the invoker is the only path to the world and is what
writes the tool event, so a framework's own event objects have nowhere to leak. A runtime chooses a
tool, never a version. Three implementations stand behind it, and only two are frameworks: the
declared control policy, which is the lab's own code and what makes the rest falsifiable, and
Pydantic AI and the OpenAI Agents SDK, which run the same single-agent shape on the same provider
and model so that a two-arm run moves the framework and nothing else (ADR 0041). Both derive their
tool schema from one rendering of the published argument table and render a tool result through
one canonical serialization (ADR 0042). Where an SDK's defaults disagree with that the adapter
overrides them: a strict schema dialect, an error wrapper that relabels a lab fault as a framework
fault, concurrent tool execution, and a vendor trace exporter. Nothing that would change the
request the provider receives is overridden. `docs/adding-agent-framework.md` is the procedure.

**`ParticipantDriver`** produces the next customer turn in one arm (ADR 0025). It is given that
arm's own turn history and nothing else: not the agent's replies, not the sandbox, not the arm
beside it. The human operator and the scripted driver are implemented; an LLM customer driver uses
the same protocol and stays independent of the support-agent framework. The scenario's first
message does not travel through the port: the pinned ticket carries it, so "both arms started from
the same question" is a property of the starting state.

**`JudgeRuntime`** consumes a versioned, anonymized brief and returns structured dimension-level
evidence (ADR 0031). A judge cannot mutate sandbox state or replace deterministic evidence. The
declared control judge and Pydantic AI over structured output stand behind it.

Composition selects the members of each registry from the lab's model connection and the
environment. A framework this process cannot run is refused at the advance and never recorded as a
turn.

## Experiment execution

An experiment binds one published scenario to one or two published agent configurations.

```text
published definitions
        │
        ▼
resolve + validate ──> canonical sandbox snapshot + fingerprint
                              │
                  ┌───────────┴───────────┐
                  ▼                       ▼
              arm A clone             arm B clone
                  │                       │
                  └──── normalized evidence ────> comparison
```

- A **snapshot** is materialized from a published scenario version and a seed. It pins every input
  that is already an immutable version and copies only what none of them pinned, the shop's order
  fixtures. Its identity is its `sandbox-v2` fingerprint, so the same recipe over a moved order is a
  different snapshot (ADR 0019).
- A **clone** pins the snapshot by fingerprint and copies its mutable state into a
  `sandbox-state-v1` document of its own. Every clone starts at the same current-state
  fingerprint; materializing is idempotent, cloning is not. A sandbox write is guarded by the arm's
  revision, and the store decides the race (ADR 0020).
- The **experiment** records its resolved inputs in an `experiment-v1` document: the arms pinned by
  content, the shared world by fingerprint, and the dimensions along which the arms differ. That
  difference set is part of its identity, and more than one dimension is warned about at setup.
- The **first message** is written into each arm from the pinned ticket before any driver is
  consulted. Later inputs are one **composition** however many arms it reaches, so two arms sent the
  same words by two decisions read as divergence. Turn ordinals are per arm.
- An arm is **advanced** explicitly and one at a time. Advancing is idempotent over an answer and not
  over an attempt: an answered turn returns its answer and calls no model; a failed attempt gets a
  new attempt beside it. A failure is recorded as a code from a closed table, never as what the
  framework said (ADR 0026).
- A bound **mutation** fires into one arm at the moment the recipe named, checked before a runtime
  starts and after every call it makes. What the lab can inject is a declared table read by the
  setup gate and the runtime, so an experiment whose fault would never fire is refused. A firing is
  recorded once per arm and reads back as a state change that is never a tool call (ADR 0028).
- An experiment has no session and no resume operation: coming back to it is a read (ADR 0029).

## Readings of the record

Almost everything a surface shows about a run is **projected** from the record at read time rather
than stored beside it, so no client and no second writer can disagree with the streams. The
exceptions are named as such.

- **Timeline.** One ordered stream per experiment, counted in compositions, carrying no message
  body; project-owned source symbols are attached to execution events and resolved from the tool
  registry and the runtime, never hand-maintained (ADR 0027).
- **Standing.** Whether an arm owes an answer or waits for the customer, the turn it stands on and
  its attempts, computed once in the domain and read by the runner and the client. Never stored
  (ADR 0029).
- **Evaluation.** Each bound objective decided from the arm's own calls and the difference between
  its starting and current sandbox, against the pinned objective template versions. Deterministic
  evidence is monotone: pending while the arm can act, a miss only when it cannot. The scenario's
  turn cap ends an arm (ADR 0030).
- **Judge verdicts** are the one part of an evaluation that is *stored*, because a model's reading
  cannot be re-derived. Scoring builds one anonymized `judge-brief-v1` per objective per arm,
  never naming what ran it or the data its tools answered with, and records the verdict with the
  judge version, the model and the input fingerprint. A failed judge leaves the standing verdict in
  place (ADR 0031, ADR 0040).
- **Cost.** Duration and provider usage are stored on the attempt that produced them; every other
  number is counted over the record. An absence is preserved, never filled. A cost is estimated at
  read time from a dated price table, and there is no aggregate (ADR 0032).
- **Comparison** presents standing, evaluation, metrics and writes objective by objective, arm
  beside arm, and derives nothing of its own. Counts are never combined across arms (ADR 0033).
- **History** is one cross-shop listing, `GET /experiments`, filtered by shop, scenario,
  framework, status, objective outcome, date and text, read through the same services as the
  results screen. Status is a reading too: running while any arm can be acted on, failed once
  every arm finished and one missed something required, completed otherwise (ADR 0034).
- **State diff** is the difference between the bytes an arm's two fingerprints cover, walked over
  the canonical documents with no list of watched fields (ADR 0035).
- **Traces** are the one reading that is stored: a span tree per advance in
  `experiment_run_spans`, three kinds only (the advance, the framework's turn, each tool call),
  with no attribute column at all. Spans are real OpenTelemetry spans opened after the fact from
  the stored measurements (ADR 0037).
- **Replay and fork** derive a new experiment from an old one by cloning the snapshot it froze, the
  replay driving it through the scripted driver with the source's own compositions, the fork
  changing which published configuration version each arm runs and nothing else. The derivation
  and its kind are stored in `experiment_derivations` (ADR 0038, ADR 0039).
- **Notes and tags** are stored beside an experiment nothing updates: notes append-only, tags
  replaced whole and folded to one slug (ADR 0036).

## Persistence

SQLite is the store for the local single-user phase, through portable SQLAlchemy types and Alembic
migrations. Every schema change ships a migration; migrations handle every supported starting
repository state and are tested on clean and existing databases. The deferred triggers for
PostgreSQL and a durable workflow runtime are in `docs/PLAN.md`.

| Tables | Hold |
| --- | --- |
| `definition_drafts`, `definition_versions`, `definition_shop_attachments` | every definition and its shop attachments |
| `shop_order_fixtures` | shop-scoped authored orders with a content fingerprint |
| `sandbox_snapshots`, `sandboxes`, `sandbox_action_proposals` | frozen starting states, one clone per arm, proposed writes |
| `experiments`, `experiment_runs` | the experiment document and one row per arm referencing its clone |
| `experiment_participant_turns`, `experiment_agent_turns`, `experiment_tool_events`, `experiment_mutation_events` | append-only evidence keyed so a turn can never be renumbered; the confirmation is inside the tool result and the state change is the pair of revisions the event carries |
| `experiment_run_spans` | stored span trees with identifiers, kind, offset and duration only |
| `experiment_judgements` | stored verdicts, one attempt beside the last |
| `experiment_derivations`, `experiment_notes`, `experiment_tags` | replay and fork provenance; what an operator concluded |

Experiments and judge executions are append-oriented historical evidence. Sandbox state is
mutable only inside one run and never changes a published definition or a snapshot.

## Reproducibility

An experiment records every input that can affect a run: the published definition versions, the
sandbox schema version and starting-state fingerprint, the seed, the tool-contract set, the
framework, model, prompt and runtime settings, the participant-driver type, every composition sent
and the judge version. Adding data or functionality never makes a historical experiment unreadable.

Canonical serialization is an application boundary, never an ORM or incidental response dump. Every
behaviorally relevant starting-state field belongs to a versioned canonical schema (`sandbox-v2`,
`sandbox-state-v1`, `tool-result-v1`, `address-change-proposal-v1`, `experiment-v1`,
`judge-brief-v1`); a change to what any of them holds is a new schema version. Runtime IDs, row
order, trace IDs, operational timestamps, evaluation outputs and the lab's model connection do not
enter a fingerprint.

## The lab layer

Some of the lab belongs to no shop and to no definition.

- **Two modes.** The workspace is a shop fixture under `/shops/:shopId/…` and an experiment lab
  under `/lab/…`, each with its own rail; `/shops`, `/settings` and `/glossary` are in neither and
  draw no rail. A mode is which branch of the route tree the operator stands in, never stored
  state. The lab keeps a current shop as a browser preference, resolved against the shop list
  rather than trusted, and a surface that needs one and has none says so rather than guessing.
  Every former shop-scoped lab path redirects and carries its shop into that preference (ADR 0054).
- **Settings** sits outside shop scope in zones told apart by surface: the preferences this
  browser holds, the lab-wide model connection, a collapsed read-only report of what this build
  can run and how it is composed, and the demo seed (ADR 0044, ADR 0047). The only stored
  operator state is a few browser preferences — three an operator chooses and two the shell
  records, and a reset reaches only the three (ADR 0058); nothing about progress is stored or
  derived (ADR 0045, ADR 0046).
- **The model connection** is a capability of the lab: one per provider, holding a base URL and an
  encrypted key and no model, editable from Settings, with the environment as the bootstrap. A run
  pins the endpoint it reached and refuses an advance against another; the connection never enters
  a fingerprint. ADR 0052 is accepted and its slice is open in `docs/PLAN-UX.md`; until it lands
  the environment is the only source.
- **Guidance is per surface**: a tour started only when asked, and a glossary reached by term links
  (ADR 0049, ADR 0050). Unsaved work is asked about once (ADR 0051).

## Safety and observability

- Synthetic personal information is fictional and follows the access and redaction discipline of
  sensitive data.
- Never log or trace secrets, raw customer content, full addresses, raw email addresses,
  authentication values, complete tool payloads or judge inputs. The allowlist for authored
  definitions is derived from each payload's leaf classification (`docs/observability.md`).
- OpenTelemetry is the trace format; exporters such as Phoenix are replaceable and never affect
  behavior. A framework's own instrumentation is never swept into the record.
- Model or judge failure never silently becomes a successful deterministic result.

## Public contracts

`packages/contracts/openapi/v1/openapi.yaml` is a versioned public contract and so are the tool
schemas. A route change updates the contract and its generated types in the same change; the
frontend never hand-maintains a divergent response type (`docs/api-and-schema-conventions.md`,
`docs/frontend-backend-boundaries.md`). A new contract is introduced with its domain and
application behavior, persistence, consumer, migration behavior and tests together.

## What remains of the POC

The original proof of concept established principles the lab keeps: the dependency rule, a common
agent port, versioned contracts, deterministic fingerprints, safe modifying actions and sanitized
tracing. Its own workflow has no UI consumer and is not the product. What is still in the tree:

- the persona-first conversation routes under `/conversations`, with their order-action
  proposal protocol, and the generated-scenario routes under `/scenarios/…/generations`;
- `application/conversations.py`, `order_actions.py`, `scenario_generation.py`,
  `scenario_registry.py` and `support_tools.py`, the `AgentAdapter` port and `AgentRegistry`, and
  `domain/entities.py`;
- the tables `customers`, `products`, `orders`, `personas`, `conversation_sessions`,
  `conversation_turns`, `memory_records`, `idempotency_records`, `action_proposals`,
  `generated_scenarios`, `generated_scenario_products` and `generated_scenario_orders`.

These stay published, working and tested. They are not extended, not bent toward the lab's model,
and not what a new framework implements. They are removed or replaced only in a cohesive versioned
slice that carries the contract change, migration behavior, consumers, tests and documentation
together. Local POC data needs no backward compatibility. `docs/decisions-and-next-step.md` lists
the ADRs they came from under *Superseded instructions*.
