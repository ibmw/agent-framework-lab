# ADR 0011 — Simulation Studio and experiment model

Status: accepted — 2026-08-23

Supersedes the future-roadmap assumptions in `docs/PLAN.md` as they existed through Milestone 5 and
partially supersedes the target product assumptions in ADR 0006 and ADR 0010. Those ADRs remain
accurate records of implemented POC behavior.

## Context

The POC proved deterministic synthetic state, framework-neutral agent execution, safe modifying
actions, persisted conversations, and a basic comparison view. Its product journey nevertheless
binds a generated persona, minimal retail fixture, support incident, and conversation too closely.
Adding a second framework on that foundation would compare adapters against a narrow hard-coded
demo rather than against a configurable, realistic, and evaluable support environment.

The lab needs to represent richer commerce data, author support incidents without code changes,
run controlled one- or two-arm experiments, and distinguish deterministic success from qualitative
and quantitative evidence. Most commerce information must be observed through tools so tool use is
part of the behavior being compared.

## Decision

The product becomes a Simulation Studio and Experiment Lab as defined in
`docs/product-direction.md`.

The target domain separates shops, customers, support identities, scenarios, agent configurations,
experiments, runs, sandbox snapshots, and evaluations. Authorable definitions use editable drafts
and immutable published versions. Experiments bind exact versions and clone one canonical starting
snapshot into isolated run state for each arm.

The direct agent input contains the user message and a minimal interaction context with resource
references. Framework-neutral, versioned tools provide commerce facts and perform actions. Backend
rules continue to enforce authorization, confirmation, validation, idempotency, and optimistic
concurrency.

V1 uses a human customer driver behind a participant-driver port. The port must allow a future LLM
customer simulator and scripted regression driver without coupling either to the support-agent
framework.

Evaluation preserves three independent layers: deterministic assertions, anonymized versioned LLM
judge executions, and quantitative measurements. The product compares evidence by objective and
does not publish a single aggregate framework score.

The current domain and public API are a POC baseline, not compatibility constraints for the target
model. Cohesive redesign slices may replace them. Existing local POC data may be discarded, while
migration behavior for supported states remains explicit and tested.

The clean dependency rule, framework-neutral application ports, versioned contracts, canonical
fingerprinting, safe modifying actions, and sanitized OpenTelemetry vocabulary remain accepted
principles unless separately superseded.

## Consequences

- Domain redesign and authoring infrastructure precede adding another agent framework.
- The old persona library ceases to be the target primary navigation; experiment history replaces
  conversation history as the comparison record.
- Reproducibility must cover shop, actor, scenario, agent, tool, evaluator, and runtime versions,
  not only a scenario ID, seed, policy version, and minimal initial-state hash.
- Catalog and commerce design must allow typed extension without reducing core invariants to
  arbitrary JSON.
- Each comparison arm needs independently mutable state cloned from the same canonical snapshot.
- Operator input divergence, judge variability, and model-dependent efficiency metrics become
  recorded evidence rather than hidden noise.
- The first complete target journey is the wrong-shipping-address scenario.
