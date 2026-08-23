# Decisions, superseded scope, and next step

Status: current — 2026-08-23

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
- ADR 0010's persona library and conversation history remain current POC behavior, not the target
  primary navigation or historical record.
- The minimal customer/product/order canonical schema in ADR 0007 remains valid for POC replay but
  is not the target commerce schema. A target snapshot format requires a new canonical schema
  version and ADR amendment or replacement.
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
2. The next implementation task is `docs/PLAN.md` Milestone 1 Slice 1, which is UI-free: define the
   target identifiers, draft/published version lifecycle, canonical sandbox boundary, and
   migration/reset policy in domain and application code with pure tests. Its ADR also formalizes
   the model revisions recorded in `docs/design-direction.md` and aligns
   `docs/product-direction.md`.
3. The Studio application shell and navigation land with Milestone 1 Slice 2, the first UI-bearing
   slice.

Do not add another agent framework or grow the POC scenario registry before the roadmap reaches
them.
