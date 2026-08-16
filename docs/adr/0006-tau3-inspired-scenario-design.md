# ADR 0006 — τ³-inspired scenario design

Status: accepted — 2026-08-16

Amendment: 2026-08-16 — Recorded the initial `retail-profile` family and its local adaptations.

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

## Consequences

This preserves a recognizable retail problem space without coupling domain rules or agent adapters
to τ³-bench. Deeper dataset or harness integration remains a later decision, made only after the
interactive scenarios and shared contracts are stable.
