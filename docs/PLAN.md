# Project plan

Status: current roadmap — 2026-09-20. Open work only; delivered milestones are one line each in
the index below, and their narrative is `docs/history/PLAN.md`.

## Purpose and authority

Build the Simulation Studio and Experiment Lab defined by `docs/product-direction.md` and accepted
by ADR 0011.

Read documents in this order before changing code:

1. `AGENTS.md`;
2. `docs/product-direction.md`;
3. `docs/architecture.md`;
4. this roadmap; and
5. the task-specific guideline and ADRs.

For target UI work, also read `docs/design-direction.md` (the rules that govern the workspace
today) and the slice's brief in `docs/PLAN-UX.md`. `docs/history/` holds how the rules and the
plans were reached and is read on demand, never by default.

When an old ADR describes currently implemented POC behavior and conflicts with the approved target
product, preserve it as history but follow ADR 0011 and this roadmap for new work.

## Delivery rules

- One short-lived branch delivers one independently useful, reviewable slice.
- Do not split a public contract from its application behavior, persistence, frontend consumer,
  migration behavior, and acceptance evidence.
- Prefer a vertical path that works end to end over broad disconnected tables or forms.
- Keep current POC behavior working unless the slice explicitly replaces it and tests the new
  boundary.
- Do not add compatibility layers for discarded local POC data unless the slice declares that
  starting state supported.
- UI-bearing slices implement the frames named in their "Frames:" line instead of inventing
  layout ad hoc; `docs/design-direction.md`'s *Authority* section says what a frame is and which
  authority wins where they disagree.
- Mark an outcome complete only when its tests, contracts, migrations, documentation, and UI where
  applicable are present.
- A plan holds open work only. A slice that has landed is removed from the plan it came from —
  its commit, its ADR and its tests are the record — and the reasoning behind a plan or a rule
  goes to an ADR or to `docs/history/`, never into the plan. A plan file is a brief for the next
  slice, not a log of the last one.
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
- **Judge configuration:** versioned rubric, model, and declared evidence scope; scores the
  objectives a scenario leaves to a judge, from an anonymized record of one arm.
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

## Milestone index

| Milestone | Outcome | Record |
| --- | --- | --- |
| 0 — Direction reset | POC assumptions stopped spreading; the target product written down. | ADR 0011, `docs/product-direction.md` |
| 0.5 — Design direction | Direction A with three named strengths selected; the frames exported. | `docs/design-direction.md`, `docs/history/design-brief.md` |
| 1 — Versioned simulation definitions | Draft/published lifecycle, the shop and catalog, customer profiles and support identities, the Studio shell. | ADR 0012–0014 |
| 2 — Scenario Studio and wrong-address sandbox | Order fixtures, tickets, block libraries, the scenario recipe, canonical snapshots, isolated clones, read tools, the safe address change, conformance evidence. | ADR 0015–0023 |
| 3 — Agent configurations and human participant driver | The agent configuration as a versioned input; the experiment binding a scenario to one or two of them through a participant-driver port. | ADR 0024–0025 |
| 4 — Paired experiment runner and live bench | The runtime port with two frameworks behind it, the execution timeline, mutations firing, resume, deterministic evaluation. | ADR 0026–0030 |
| 5 — Evaluation and experiment history | The versioned judge, cost, the objective-level comparison, cross-shop history, state diffs, notes and tags, traces, replay, fork, judge evidence. | ADR 0031–0040 |
| 6 — Second comparison implementation | The OpenAI Agents SDK behind the same port, and the first controlled two-arm comparison. | ADR 0041–0042 |
| 7 — Guided setup and lab settings | The settings surface, the seed from it, per-surface tours, guide mode and the written guides retired. | ADR 0043–0049 |
| UX — Forms that guide the operator | Hints, derived identifiers, enum labels, currencies at creation, typed controls, closed sets, edit-in-place, the unsaved-work guard. Slices 1–8 of the 13 September plan. | ADR 0050–0051, `docs/history/PLAN-UX-2026-09-13.md` |
| UX — The refresh's pattern layer | Pine primary and the glyph vocabulary, the field row, the rail's metrics, filter chips, display type, search, control metrics, row copy. | `docs/history/workspace-refresh-pattern-slices.md` |
| **8 — The workspace becomes the prototype** | **Open.** Two modes with their rails, the top bar, creation as a page, the overview, documents, settings in three zones, the model connection, and the behaviour the prototype specifies everywhere. | ADR 0052–0054 accepted; slices in `docs/PLAN-UX.md` |

## Milestone 8 — The workspace becomes the prototype

Bring `apps/web` to the whole-workspace design handed over on 19 September 2026
(`tmp/design-frames/Workspace.html`), on the primitives the workspace already has and without a
new UI dependency. `docs/PLAN-UX.md` is the authority for its scope, order and checks. The
lab-as-a-mode slice wrote its ADR before its code, because it moves every lab route out of shop
scope: ADR 0054 is the route scheme every later slice is written against. Acceptance is that
plan's, plus: nothing about progress is stored (ADR 0044, ADR 0045 stand), the connection never
enters a fingerprint (ADR 0052), and the eleven Playwright journeys pass on the new routes
without the application having been bent to them.

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

### SQLite write concurrency under the parallel browser suite

`infrastructure/database.py` composes the engine with no `busy_timeout` and no WAL journal, so a
write that queues behind another for longer than SQLite's own five-second default is refused rather
than delayed — which reaches a browser as a failed request and a wrong page, not as a slow one. The
Playwright suite runs every journey at once against one API process and one database file, and two
of those journeys now build a whole chain apiece, so the margin is narrower than it was. Evaluate a
`busy_timeout` and `journal_mode=WAL` when a suite run produces a `database is locked` failure, or
when a third chain-building journey joins the suite. Do not change the engine to make a test wait
longer: a wait is the suite's business and belongs in the suite.

### Deeper benchmark integration

Evaluate external datasets, harnesses, or evaluator patterns only after the local authoring and
experiment contracts are stable and only when they add evidence without taking ownership of the
product model away from the lab.

