# ADR 0006 — τ³-inspired scenario design

Status: partially superseded by ADR 0011 — 2026-08-23

This ADR remains the record of the implemented POC fixtures and their deterministic generation
rules. ADR 0011 supersedes its hard-coded scenario model and persona-first journey as target product
direction; local ownership, versioning, and useful τ³-inspired vocabulary remain valid.

Amendment: 2026-08-16 — Recorded the initial `retail-profile` family and its local adaptations.

Amendment: 2026-08-16 — Pinned the deterministic `retail-profile@v1` generation rules.

Amendment: 2026-08-18 — Added `retail-order-cancellation@v1` with policy set `v2`.

## Context

τ³-bench Retail offers a useful vocabulary for customer-support work: fictional customers, product
catalogs, order histories, support policies, tool-mediated information retrieval, and tasks that
exercise those rules. The lab needs that recognizable problem space without importing an external
dataset, evaluator, user simulator, or runtime into its deterministic core.

The first lab scenario family is `retail-profile`. It establishes a fictional persona and the
minimal customer, product, and order state needed by later human-operated support scenarios. A
scenario version pins one locally owned policy-set version and one canonical-state schema version.

## Decision

The lab uses τ³-bench Retail as inspiration for e-commerce vocabulary, policies, tool shapes,
fixtures, and scenario structure. Scenarios and policy sets are adapted, owned, and versioned
locally so the first human demo remains reproducible and independent of an external runtime,
package, dataset download, or evaluation harness.

The initial concepts and adaptations are:

- **Retail state:** Customers, products, orders, and order status provide the inspired support
  context. The first canonical state contains only the fields needed by `retail-profile`; fixtures
  are synthetic, seeded, and owned by this repository.
- **Persona:** A customer profile gives support interactions a concrete user context. The lab's
  `Persona` is a distinct immutable fictional profile, and the persisted retail `Customer` is
  derived from it rather than from external benchmark user data. In the initial canonical schema,
  the customer's email and display name are copied from the persona verbatim; transforming either
  value requires a deliberate versioned contract change.
- **Scenario:** A task combines initial state with behavior that support interactions exercise. The
  lab versions `ScenarioDefinition` under `(scenario_id, scenario_version)` and pins its policy and
  canonical-schema versions. Generation behavior is added in a later slice.
- **Policies:** Retail support behavior is constrained by an explicit policy set. Lab policy sets
  use an independent `vN` version and no external policy text is loaded at runtime.
- **Tools:** Support agents inspect or modify retail state through constrained operations. The lab's
  future tool contracts are versioned and framework-neutral; this foundation adds no tool or agent
  runtime.
- **User interaction:** Benchmark tasks may use simulated users and automated evaluation. The lab's
  primary journey is operated by a person, with deterministic regression scenarios deferred until
  that journey is proven.

Operational scenario metadata records the registry key, seed, pinned policy-set version,
canonical-state schema version, and UTC creation time. The creation time describes when generation
ran and is deliberately excluded from the canonical initial state and its hash, as specified by ADR
0007.

`retail-profile@v1` derives fixture choices, identifiers, and fictional timestamps from labeled
SHA-256 digests over the scenario ID, scenario version, policy-set version, canonical schema
version, and recorded seed. Seeded identifiers use UUIDv8 as defined by RFC 9562, with its RFC
4122-compatible variant bits. Fictional customer and order timestamps are offsets from a fixed UTC
epoch; they never use operational time. The local fixture produces one persona, its
verbatim-derived customer, two products selected from a small versioned catalog, and one paid
customer order. Changing the derivation labels, fixture catalog, choice sets, timestamp ranges, or
resulting state requires a new scenario version.

Including `canonical_schema_version` in the derivation context is deliberate: a scenario definition
pins its complete replay context, so adopting a new canonical schema occurs under a new immutable
scenario registry version even when the human-visible fixture rules are otherwise unchanged. This
favors exact historical replay over preserving fictional identities across schema versions.

`retail-order-cancellation@v1` is a separate τ³-inspired scenario rather than a mutation of the
read-only `retail-profile@v1` definition. It reuses the locally owned deterministic retail fixture
shape, but its scenario identity changes every seeded identifier and its policy set `v2` permits
exactly one modifying behavior: cancelling a paid order after exact user confirmation. The original
scenario remains simultaneously resolvable and read-only.

## Consequences

This preserves a recognizable retail problem space without coupling domain rules or agent adapters
to τ³-bench. Deeper dataset or harness integration remains a later decision, made only after the
interactive scenarios and shared contracts are stable.
