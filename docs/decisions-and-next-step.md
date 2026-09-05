# Decisions, superseded scope, and next step

Status: current — 2026-09-05

## Authoritative direction

The approved product is the Simulation Studio and Experiment Lab in
`docs/product-direction.md`, accepted by ADR 0011. The current application is a POC baseline. Future
work follows the redesigned roadmap in `docs/PLAN.md`, not the former instruction to add Vercel AI
SDK immediately.

## Accepted product decisions

- Configure realistic, synthetic e-commerce environments without building a customer-facing
  storefront in V1.
- Keep core commerce concepts typed while allowing administrator-defined typed attributes and
  versioned non-critical extensions.
- Give agents minimal interaction references directly and provide most commerce information through
  framework-neutral, versioned tools.
- Separate shop, customer, support identity, ticket, scenario, agent configuration, experiment,
  run, sandbox snapshot, and evaluation concepts.
- Author inside a shop-scoped admin workspace: orders, tickets, and scenarios belong to one shop;
  customer profiles are reusable across shops while their commerce/support history stays
  shop-scoped. Agent configurations remain shop-independent through prompt variables and tool
  bindings resolved at experiment start.
- Compose scenarios from shared, versioned objective and mutation block templates; templates are
  shop-independent while every parameter binding stays same-shop. Context documents (policies,
  support guidelines) are referenced by scenarios, readable by agents through tools, and
  document-read objectives record whether each arm actually consulted them.
- Edit agent prompts as markdown templates with inline variable chips, a grouped insert menu, and
  selectable preview context; customer/order/ticket facts are visibly non-injectable. LLM
  provider/model/runtime are explicit configuration. Tone of voice is a shop-level named guideline
  set with one default; agent configurations select the shop default or a named override.
- Give customer profiles a named address book with one default entry. Orders select an address
  from the book and store a frozen, source-labeled copy; address-book edits never rewrite existing
  orders, published scenarios, or snapshots.
- Use editable drafts and immutable published versions for authorable definitions.
- Run a maximum of two isolated arms from the same canonical starting snapshot and record operator
  input divergence.
- Make human operation the first participant driver while preserving ports for future LLM and
  scripted customer drivers.
- Evaluate deterministic objectives, anonymized versioned LLM-judge dimensions, and quantitative
  metrics separately.
- Treat turns, tokens, latency, calls, retries, and cost as contextual observations, not universal
  framework scores.
- Make experiment history, evidence, replay, and fork the primary review journey.
- Use the wrong-shipping-address incident as the first complete target vertical slice.
- Permit cohesive replacement of the POC domain and contracts; existing local POC data does not
  require backward compatibility.

## Technical principles retained from the POC

- Pragmatic clean architecture and inward dependencies.
- Framework-neutral application ports and isolated SDK adapters.
- Versioned OpenAPI and tool contracts.
- Canonical starting-state fingerprints and explicit replay context.
- Confirmed, idempotent, concurrency-safe modifying actions.
- SQLite-first portable persistence until its documented trigger is reached.
- Sanitized OpenTelemetry evidence with optional exporters.
- Deterministic test doubles and no required live-model calls in CI.

## Superseded instructions

- `docs/PLAN.md` Milestone 4 previously named Vercel AI SDK as the next task. Domain and product
  redesign now precede another framework adapter.
- ADR 0006's hard-coded generated scenario/persona model is implemented history, not the target
  authoring model.
- The POC's `RetailSupportTools` (`read_customer`, `list_products`, `list_customer_orders`) remain
  implemented POC behavior serving the persona-first conversation contracts. The target tool surface
  is the versioned read-tool set over a sandbox arm (ADR 0021).
- ADR 0010's persona library and conversation history are superseded: their frontend was removed by
  ADR 0013 in favour of the Studio shell, and their two listings — `listConversations` and
  `listGeneratedScenarios` — were removed by ADR 0034, which delivers the experiment-first
  historical record that replaces them. The remaining conversation and persona HTTP contracts
  (start, resume, message, delete, and the order-action protocol) stay published POC behavior.
- ADR 0009's order-cancellation proposal/confirmation protocol remains implemented POC behavior on
  the persona-first conversation contracts. The target modifying-tool protocol is the propose/apply
  pair over a sandbox arm, whose confirmation is the hash of the change and therefore serves as both
  the consent binding and the idempotency key (ADR 0022).
- The minimal customer/product/order canonical schema in ADR 0007 remains valid for POC replay but
  is not the target commerce schema. The target snapshot format is `sandbox-v2` (ADR 0019), the
  mutable clone an arm works in is `sandbox-state-v1` (ADR 0020), what a tool answers with is
  `tool-result-v1` (ADR 0021), and what a confirmation is the hash of is
  `address-change-proposal-v1` (ADR 0022); a further change to what any of them holds requires
  another canonical schema version.
- The M2 provider/model policy remains a historical POC policy. Target agent and judge configuration
  will be versioned authorable definitions.

## Explicitly deferred

- Customer-facing storefront.
- Autonomous LLM customer driver and broad regression runner.
- Managed image upload or object storage.
- External commerce platform integrations.
- Multi-user authentication and tenancy.
- PostgreSQL or durable workflow runtime without a documented operational trigger.
- Global framework leaderboard.

## Recommended next steps

1. Milestone 0.5 is complete. The design direction is selected and recorded in
   `docs/design-direction.md` (Direction A merged with named strengths of B and C), and the 18
   authoritative frames live on the design canvas page "Shop workspace — v2 IA", with a local
   export in `tmp/design-frames/` (see `docs/design-direction.md`). No further design exploration
   is required before implementation; UI slices cite those frames.
2. Milestone 1 Slice 1 is complete: ADR 0012 records the target identifiers, draft/published
   version lifecycle, `sandbox-v1` canonical boundary, and migration/reset policy, implemented as
   pure domain/application code with tests and formalizing the `docs/design-direction.md` model
   revisions in `docs/product-direction.md`.
3. Milestone 1 Slice 2 is complete: ADR 0013 records the `shop-payload-v1` payload schema, the
   split between structural invariants and the publish gate, the canonical-document persistence
   for `definition_drafts`/`definition_versions`, the `/api/v1/shops` contract, and the Studio
   application shell. The POC's persona-first frontend was removed with that shell; its HTTP
   contracts remain published and tested without a UI consumer.
4. Milestone 1 Slice 3 is complete: ADR 0014 records the `customer-profile-payload-v1` and
   `support-identity-payload-v1` schemas, the field-sensitivity classification that keeps synthetic
   personal data out of logs and traces, the per-shop attachment that scopes the Studio's customer
   list without making the profile shop-scoped, and the extraction of the shared draft/published
   authoring lifecycle that every shop-independent definition now uses. Tone of voice stays
   shop-level under ADR 0012 rather than joining the support identity.
5. Milestone 2 is complete. The order editor with frozen address copies (ADR 0015), versioned
   tickets (ADR 0016), the objective and mutation block libraries (ADR 0017), the scenario recipe
   and its composition editor (ADR 0018), the canonical sandbox snapshot a published version
   materializes into (ADR 0019), the independently mutable clone each arm works in (ADR 0020), the
   versioned read tools an arm interrogates that clone through (ADR 0021), the safe address change
   it may actually make (ADR 0022), and the evidence that holds them together (ADR 0023) are
   delivered.
6. ADR 0023 adds two standing constraints rather than behavior. The canonical serializer and the
   `sandbox-v2` and `sandbox-state-v1` envelopes now have recorded fingerprints, so changing any of
   them means deliberately answering whether every starting state frozen before that change is a
   different one — the answer is sometimes yes, and must never be silent. And the tool suites sweep
   `SANDBOX_TOOL_CONTRACTS` through a sample-call table checked against it, so a tool published
   without a call in `tool_call_factories.py` fails a test instead of quietly leaving every sweep.
7. Milestone 3 Slice 1 is delivered: the agent configuration is a versioned definition (ADR 0024).
   The framework, architecture, model, prompt template, tool bindings, memory, and support identity
   an experiment runs on are published inputs rather than composition defaults, judged against a
   declared catalog of what the lab has proven it can run. A prompt may name shop and
   support-identity facts and may never name customer, order, or ticket facts, because discovering
   those through tools is part of what an experiment compares. The permission a write tool needs is
   now declared on its contract, so the runtime and the publish gate read one table.
8. Milestone 3 Slice 2 is delivered, together with the Milestone 4 runner it was sequenced against
   (ADR 0025). An experiment binds a published scenario version to one or two published agent
   configurations, freezes one canonical snapshot, clones an arm per configuration, and opens both
   threads on the ticket's triggering message; every later customer turn arrives through a
   participant-driver port whose first implementation is the human operator. One delivery is one
   composition however many arms it reaches, so a reply sent to a single arm is divergence the
   record keeps rather than something a later comparison of the bodies would have to guess at. The
   setup gate answers the tone-of-voice check ADR 0012 placed at experiment setup and warns when
   the arms differ along more than one dimension.
9. The runner that executes an arm is delivered (ADR 0026). Advancing an arm resolves its
   published configuration against the versions the experiment pinned, renders the prompt, offers
   exactly the tools that configuration enables, and runs the framework it names against that arm's
   own sandbox — recording what it answered, every tool call it made, the confirmation and revision
   each write carried, and the attempt in which it failed. It is a new `SupportAgentRuntime` port,
   not a bent `AgentAdapter`: the POC's port hands an agent a pre-loaded support context, which is
   the opposite of the tool-first rule an arm runs under. Two frameworks sit behind it — a declared
   deterministic control policy that runs offline, and Pydantic AI deriving its tool schemas from
   the published contract table. Evidence is a property of the call path: a runtime reaches the
   world only through an invoker bound to one arm and one actor, and that invoker is what writes
   the event.
10. The normalized execution timeline is delivered (ADR 0027). One ordered, framework-neutral
   stream reads an experiment's whole execution back — the compositions both arms share, each
   arm's attempts, and every tool call with what it did to that arm — and every entry carries the
   project-owned file and line of the code that ran it, resolved from the tool registry and the
   runtime that produced the turn rather than from a map kept by hand. It is a projection, not a
   record: nothing is stored, because a second stored shape is a second chance to disagree with
   the first. It carries no message body, so the surface built to be filtered, counted, and later
   handed to an evaluation never repeats what anyone said.
11. The scenario's mutations now fire (ADR 0028). A published recipe's bound fault reaches the
   arm it was authored for at the moment it named — between two of the agent's calls, because
   that is where the world has to be able to move for the conflict ADR 0022 built to be
   reachable at all. The lab declares what it can carry out rather than trying: one effect,
   applied to a bound order, and two moments it can observe from the arm's own record, with an
   experiment refused at setup when its recipe names anything else. A firing happens once per
   arm and both arms carry the identical schedule, so the fault is not a comparison variable —
   meeting it is.
12. Resume is delivered (ADR 0029). An experiment is entirely in the record, so coming back to
   one is an ordinary read — and each arm now says what it is waiting for, derived from its own
   two streams rather than stored beside them, so the runner deciding what an advance does and
   the bench drawing the button read one rule. A question an arm passed over, which ADR 0026
   made deliberate, is reported rather than left looking like a gap.
13. Deterministic evaluation is delivered (ADR 0030), which completes Milestone 4 and opens
   Milestone 5. Each of a scenario's bound objectives is judged from one arm's own record — the
   calls it obtained answers from, and how its sandbox differs from the one it was cloned from —
   with "not yet" kept apart from "no", a judge's rows deferred rather than counted, and the
   evidence this build cannot read saying so instead of failing the arm. The scenario's turn cap
   now ends an arm and settles what it never did; the completion statement is still a judge's.
14. The judge is delivered (ADR 0031). A judge is a published definition — a rubric, a model,
   and a declared list of what it is shown — and it scores one anonymized brief per objective
   per arm: what that arm did and said, and nothing about what ran it, with a rubric naming a
   framework refused at the publish gate. Its three outcomes are the lab's, and "unclear" is
   one of them, because a judge forced to choose would guess. Every execution is recorded with
   the judge version, the model, and the fingerprint of the exact input it read; scoring again
   writes the next attempt rather than replacing the last, and a judge the lab cannot reach
   records nothing rather than counting against an arm.
15. The quantitative record (ADR 0032), the objective-level comparison on frame 9's General tab
   (ADR 0033), and experiment-first history (ADR 0034) are delivered. History is one cross-shop
   listing whose every row — each arm's standing, what it met out of what was decided for it, and
   the versions it pinned — is projected from the record the bench and the results screen read;
   it replaces the persona-first listings, which were removed with it. An experiment's status is
   read the same way and is still not a state anything sets: running while an arm can be acted
   on, failed once every arm is finished and one missed a required objective.
16. The per-arm state diff is delivered (ADR 0035). The business-state card now says what an
   arm's world became and not only that it moved: the difference between the exact bytes the
   arm's two fingerprints cover, walked over the whole canonical state document so a field
   authored tomorrow appears without a change, grouped by the order the incident names and
   paired by order identity. A field that was never there is kept apart from one that was
   emptied, and what lies outside every order is reported rather than dropped — which is what
   keeps "no other state changed" a claim that could fail.
17. Next is the rest of Milestone 5: notes, tags, traces (frame 9b), the code excerpt of frame 9c,
   replay and fork provenance, and judge failure/rerun tested apart from the deterministic
   outcome calculation.

Do not add another agent framework or grow the POC scenario registry before the roadmap reaches
them.
