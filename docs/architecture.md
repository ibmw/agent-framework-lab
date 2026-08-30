# Architecture

Status: target architecture with an implemented POC baseline — 2026-08-29

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
  web/                    React/Vite Studio workspace
packages/
  contracts/              OpenAPI v1 contract and generated shared types
infra/
  phoenix/                optional local observability service
docs/                     product, architecture, guidelines, and ADRs
.codex/skills/            project-local procedures
```

The POC implements generated personas, minimal customers/products/orders, hard-coded scenario
definitions, conversations, one safe cancellation action, a Pydantic AI adapter, and framework
selection. This is reusable evidence, not the target domain model.

Milestone 1 has begun replacing it: the definition lifecycle (ADR 0012), the versioned shop and
extensible catalog with its publish gate (ADR 0013), versioned customer profiles and support
identities on a shared authoring lifecycle (ADR 0014), shop-scoped order fixtures (ADR 0015),
versioned tickets — the first shop-scoped definition, pinning its shop and customer versions at
publication (ADR 0016), and versioned agent configurations, the first definition to describe the
agent rather than the world it works in (ADR 0024) — the
`definition_drafts`/`definition_versions`/`definition_shop_attachments`/`shop_order_fixtures`
tables, and the Studio application shell are target code. Beyond the definitions, the experiment
that binds a published scenario version to one or two of those configurations, clones an arm per
configuration, and takes its customer turns through a participant-driver port is target code too
(ADR 0025), and the runner that advances one arm of that experiment through a framework-neutral
support-agent port, recording what it answered and every versioned tool call it made (ADR 0026),
and the normalized execution timeline that reads all of it back as one framework-neutral stream
carrying the project's own file and line behind every entry (ADR 0027).
The POC's persona-first frontend was removed with that shell; its HTTP contracts remain published
and tested without a UI consumer.

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

A tool is scoped to one arm: it is given that arm's own mutable state and the exact published
versions its snapshot pinned, and never a shop, a definition, or a version as an argument (ADR 0021).
A tool result distinguishes success, a refusal the agent can act on, and a technical failure that
carries no explanation; argument mistakes are refusals, because in a run the arguments are model
output. No tool serves a `CUSTOMER_ONLY` field — the persona and the hidden facts drive the simulated
customer, not the support agent — while `SENSITIVE` synthetic personal data is served in full and
still never logged or traced. The published tool set is part of a snapshot's identity, so it enters
the starting-state fingerprint rather than belonging to the runtime that calls it.

Each contract declares its `effect`. A write is proposed before it is applied, and the confirmation a
proposal answers with names the change by its content — which makes it both the consent binding and
the idempotency key, so the change applies exactly once and a repeat returns the first result. The
acting support identity travels in the call envelope rather than among the arguments, because
arguments are model output and an agent that could name its own actor would be choosing its own
permissions; its granted permissions are what authorize the write. A proposal carries the revision it
was computed at into the write, so an arm that moved in between is refused — as a refusal the agent
can recover from, not a transport error (ADR 0022).

## Framework and participant neutrality

The current `AgentAdapter` is an application port and remains useful evidence, and still serves the
POC's conversation routes unchanged. The experiment runner proved requirements it cannot express —
an arm runs a *published* configuration, reaches the world only through the versioned tools that
configuration enables, and acts under the support identity it adopts — so the target runtime is a
separate `SupportAgentRuntime` port rather than a bent version of the old one (ADR 0026). A runtime
is handed an invoker bound to one arm, one actor, one tool set, and one tool budget; it is the only
path to the world and it is what writes the tool event, so a framework's own event objects have
nowhere to leak. A runtime chooses a tool, never a version: the tool contract set is a pinned input
of the experiment. Agent SDK types never enter the domain, stored neutral event format, public API,
or shared UI.

What an agent *is* for one experiment is authored rather than composed: a published agent
configuration carries the framework, architecture, model and runtime settings, system prompt, tool
bindings, memory, and the support-identity version it adopts (ADR 0024). Its prompt is a template
over a closed variable table — shop and support-identity facts resolve at experiment start, while
customer, order, and ticket facts are declared as never injectable, because discovering them through
tools is part of what an experiment compares. What an author may publish is judged against a declared
catalog of what the lab has proven a framework can run, kept apart from the adapter registry so the
gate does not change with the machine the Studio runs on; a permission a write tool needs is declared
on the tool contract, so the runtime that refuses an unauthorized call and the gate that refuses a
configuration enabling it read one table.

Participant input has a separate application port, and its first implementation is the human
operator (ADR 0025). The port has one method — the next customer turn in one arm — and is given
that arm's own turn history and nothing else: not the agent's replies, not the sandbox state, not
the arm beside it, because a simulator that could read the sandbox would answer questions the
customer has no way to know the answer to. What only one implementation needs travels on the
instance rather than in the request, so composition constructs a human driver with the operator's
sentence where it will construct a simulator with a model client. The trigger deliberately does
not travel through the port: the pinned ticket carries the first message every arm receives, and
"both arms started from the same question" must be a property of the starting state rather than
of a driver behaving. Future LLM and scripted drivers use the same protocol and remain
independent of the support-agent framework.

The LLM judge is also a separate port. It consumes a versioned, anonymized evaluation input and
returns structured dimension-level evidence. A judge cannot mutate sandbox state or replace
deterministic assertions.

## Experiment execution

An experiment binds one published scenario to one or two published agent configurations. Starting
it resolves all referenced versions and creates one canonical sandbox snapshot. Each arm receives
an independently mutable clone with the same starting-state fingerprint.

A snapshot is materialized from a published scenario version and a seed, and can be created before
any agent configuration is chosen. It **pins** every input that is already an immutable published
version and **copies** only what none of them pinned — the shop's order fixtures, which keep being
authored after the recipe is frozen. Its identity is the resulting `sandbox-v2` fingerprint, so the
same recipe over a moved order is a different snapshot rather than an overwritten one (ADR 0019).

Cloning applies the same rule one level up: a snapshot is itself immutable, so a clone **pins** it by
fingerprint and **copies** the mutable state inside it into a `sandbox-state-v1` document of its own
(ADR 0020). Every clone of one snapshot therefore starts at the same current-state fingerprint, and
diverges from its sibling only when something writes. Cloning is deliberately not idempotent where
materializing is: the same starting state frozen twice is one snapshot, while the same snapshot cloned
twice is two arms. A sandbox write is guarded by the arm's revision, and the store decides the race.

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

The first message is equivalent across arms by construction: it is written into each arm from the
ticket the snapshot pinned, before any driver is consulted. Later inputs may be linked or
independent, and one delivery is one **composition** however many arms it reaches — so two arms
sent the same words by two separate decisions read as divergence rather than as agreement, which
no comparison of the bodies could recover afterwards. Turn ordinals are per arm: one arm may be
driven twice while the other waits. Tool writes in one arm never affect the other arm.

An experiment records its own resolved inputs in an `experiment-v1` document beside the
snapshot's: the arm pins by content, the shared world by fingerprint, and the dimensions along
which the arms differ. That difference set is part of the experiment's identity — two experiments
over one scenario whose arms differ differently are not the same experiment — and an experiment
whose arms differ along more than one dimension is warned about at setup rather than discovered
months later, because nothing it produces can be attributed to either difference.

An arm is advanced explicitly and one at a time, because the arms progress independently and a
model call must not be a side effect of recording what the customer said. Advancing is idempotent
over an *answer* and not over an *attempt*: an arm whose latest customer turn is answered returns
that answer and calls no model, while one whose last attempt failed makes a new attempt beside it —
a failure is evidence, and a retry is a thing an operator does. An assistant turn is addressed to
the customer turn it answers rather than carrying a counter of its own, and an arm answers the
conversation as it now stands rather than the oldest question it has not replied to. A failure is
recorded as a code from a closed table and never as what the framework said; a framework this
process cannot run at all is refused rather than recorded, because that is a fact about the machine
(ADR 0026).

Normalized run evidence includes participant and assistant turns, model usage, tool requests and
results, proposals and confirmations, retries and failures, state changes, trace correlations, and
completion status. It is read back as one ordered stream per experiment, projected from those
records rather than stored beside them, so a client never interleaves three listings itself — which
is where a framework's own idea of a step would otherwise re-enter, one consumer at a time. The
stream is counted in **compositions** rather than in ordinals, because an ordinal counts one arm's
turns and the arms may sit at different depths, and it carries no message body: what was said is
the thread's, and what happened is the stream's. Project-owned source symbols are attached to
execution events for the code evidence view, resolved from the tool registry and the runtime that
produced the turn rather than stored or hand-maintained, and absent whenever the code is not this
project's to point at; manually maintained pseudo-code is not authoritative evidence (ADR 0027).

## Persistence, versioning, and extensibility

Authorable definitions use mutable drafts and immutable published versions, stored as one canonical
document per draft and per version in `definition_drafts` and `definition_versions`; the composite
primary key `(definition_type, definition_id, version)` is the overwrite guard, and typed domain
constructors re-validate every document on read (ADR 0013). Only the payload codec and the publish
gate are per-type: the draft/published lifecycle itself is shared (ADR 0014). Which shops use a
shop-independent definition is a separate, unversioned relation in `definition_shop_attachments`,
never a pinned reference and never part of a fingerprint. Not every authored resource is a
definition: an order fixture is shop-scoped authored state with no version of its own, stored as one
canonical document with a content fingerprint so a published scenario can freeze a copy of it
(ADR 0015). A snapshot's clones live in `sandboxes`, one row per arm, each holding its own copy of the
frozen state; the isolation between arms is that layout rather than a rule something must remember
(ADR 0020). An experiment is written once into `experiments` as its canonical document, with one
row per arm in `experiment_runs` referencing the clone that arm works rather than embedding any of
it, and an append-only `experiment_participant_turns` keyed by run and ordinal so a turn can never
be renumbered onto another position (ADR 0025). What the agent produced is append-only beside it:
`experiment_agent_turns` keyed by run, answered ordinal, and attempt, and `experiment_tool_events`
keyed by that attempt plus the sequence the agent asked in, each holding the published
`tool-result-v1` document whole. There is deliberately no separate confirmation or state-change
table: the confirmation is inside the result the proposal answered with, and the state change is
the pair of revisions the event carries (ADR 0026). Experiments and judge executions are
append-oriented historical evidence. Operational sandbox state is mutable only inside one run and
never changes the published definitions or canonical starting snapshot.

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

`packages/contracts/openapi/v1/openapi.yaml` carries both the POC routes and the target routes added
by accepted slices; the shop operations under `/api/v1/shops` are the first target contract. The POC
persona, conversation, and order-action routes remain published until a roadmap slice deliberately
replaces or versions them. Do not incrementally bend persona or conversation routes into the target
model. Introduce target contracts with their domain, application behavior, persistence, frontend
consumer, migration behavior, and tests in the same cohesive slice.
