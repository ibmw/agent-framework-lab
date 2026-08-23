# ADR 0012 — Definition lifecycle, identifiers, and sandbox snapshot boundary

Status: accepted — 2026-08-23

Implements the foundation decisions of `docs/PLAN.md` Milestone 1 Slice 1 under the product
direction accepted by ADR 0011. Formalizes the model revisions recorded in
`docs/design-direction.md` (first-class tickets, composable objective/mutation blocks, the customer
address book with frozen order copies, and shop-level tone of voice) and aligns
`docs/product-direction.md` with them.

## Context

The target product authors versioned definitions (shops, customer profiles, support identities,
tickets, scenarios, objective/mutation blocks, agent configurations) and runs experiments whose
evidence must remain explainable and reproducible. The POC has only a hard-coded scenario registry
with string versions and the ADR 0007 `v1` canonical fingerprint over a minimal
persona/customer/product/order aggregate. Before any target contract, persistence table, or UI is
built, the lab needs one recorded decision for identifiers, the draft/published lifecycle,
reference rules, experiment resolution, the sandbox snapshot boundary, and the migration path from
POC databases.

## Decision

### Model revisions formalized

The design-direction revisions of 2026-08-23 are the accepted target model:

- **Ticket** is a first-class versioned definition scoped to one shop and one customer profile:
  channel, origin references, prior message history, and the triggering first message.
- **Scenarios build on one ticket** plus same-shop linked objects, adding hidden facts, context
  documents, bound objective and mutation blocks, and completion conditions.
- **Objective and mutation blocks** are shared, versioned, parameterized, shop-independent
  templates; a scenario binds template versions to same-shop objects. Objective order is display
  priority only; mutation order is the injected run timeline.
- **Customer profiles carry a named address book** with one default entry. Orders select an entry
  and store a frozen, source-labeled copy; address-book edits never rewrite existing orders,
  published scenarios, or snapshots.
- **Tone of voice is shop-level**: shops own named, versioned tone-of-voice guidelines with one
  default. Support identities keep role, permissions, and guidance. Agent configurations select the
  shop default or a named override; an override missing from the target shop fails experiment
  setup validation and any override is a reported comparison variable.

### Identifiers and versions

- A definition is identified by `(definition_type, UUID)`; the UUID is assigned at draft creation
  and stable across the draft and every published version. Display names are content, not
  identity.
- The definition types are `shop`, `customer_profile`, `support_identity`, `ticket`, `scenario`,
  `objective_block`, `mutation_block`, and `agent_configuration`. `ticket` and `scenario` are
  shop-scoped and carry their owning shop's definition ID; all other types are shop-independent.
- Published versions are positive integers starting at 1 and monotonic per definition. The UI may
  render them as `v3`; the POC's `"v1"` string pattern remains a POC-only convention.

### Draft/published lifecycle

- Each definition has at most one mutable draft. Publishing freezes the draft into the next
  version; published versions are immutable forever and are never overwritten. Editing continues
  on the draft and never alters any published version.
- Publishing pins every definition-to-definition reference to an exact published version of its
  target — the latest published version at publish time. Publishing fails when a referenced
  definition has no published version.
- Publishing a shop-scoped definition additionally pins the shop version it was published against
  (`shop_version`). A ticket or scenario therefore freezes the exact catalog/support configuration
  it was authored on, satisfying "a ticket referenced by a published scenario version is frozen
  with it".
- Allowed reference targets by source type: `ticket → customer_profile`;
  `scenario → ticket, objective_block, mutation_block`; `agent_configuration → support_identity`;
  every other type holds no definition references. A `scenario → ticket` reference must stay in
  the scenario's shop. Same-shop parameter bindings inside scenario payloads arrive with later
  slices and must obey the same rule.
- Published versions enforce required reference cardinalities: a ticket references exactly one
  customer profile, a scenario exactly one ticket, and an agent configuration exactly one support
  identity; block references stay 0..N. Drafts may remain incomplete — publishing is the
  completeness gate.
- This reference type graph is acyclic by construction, so reference cycles cannot be built from
  valid domain objects; resolution deduplicates shared targets.

### Experiment resolution

Resolving an experiment walks the pinned reference closure (including pinned shop scopes) from one
scenario version and one or two agent-configuration versions and produces a deterministic
resolution with two parts:

- **Sandbox inputs** — every definition version shaping the shared starting state (shop, customer
  profile, ticket, scenario, blocks), each identified by type, definition ID, version, and content
  fingerprint, plus the seed and tool-contract versions.
- **Arm inputs** — per arm: the agent configuration and its support identity versions, plus the
  participant-driver type (`human`, `llm`, or `scripted`).

A closure that pins two different versions of the same definition (for example a scenario
published against shop v2 whose ticket pinned shop v1) fails resolution; the author republishes
the stale definition. Resolution never substitutes a newer version for a pinned one.

### Sandbox snapshot boundary and fingerprint

- The target canonical schema token is `sandbox-v1`. ADR 0007's `v1` schema remains authoritative
  for POC replay only and is not extended.
- The `sandbox-v1` envelope contains: `canonical_schema_version`, the sorted sandbox definition
  entries (`definition_type`, `definition_id`, `version`, `content_fingerprint`), `seed`,
  `tool_contracts` (name → version), and a `state` map of named materialized-state sections. In
  `sandbox-v1` the section map is empty; each later slice that materializes commerce state defines
  its sections under a new canonical schema version. Adding, removing, or changing a section or
  envelope rule always requires a new schema version.
- The sandbox fingerprint is the SHA-256 of the envelope's canonical JSON under ADR 0007's
  serialization rules (UTF-8, NFC, sorted keys, compact separators, schema-decided field presence,
  decimal-string money, UTC RFC 3339 timestamps with six fractional digits, no binary floats).
- **Excluded from the sandbox fingerprint** and recorded on the experiment instead: agent
  configurations, support identities, participant-driver type, evaluator and rubric versions, run
  IDs, operational timestamps, and trace IDs. Both arms of an experiment share one sandbox
  fingerprint while differing in arm inputs.
- Content fingerprints of definition payloads use the same canonical serialization; their concrete
  payload schemas are defined by the slices that introduce each payload.

### Migration and reset path from POC databases

- Target definition tables arrive with later slices **alongside** the POC tables. POC data is
  never migrated into the target schema. POC tables are dropped only by the slice that replaces
  their user-facing behavior, in that slice's tested migration.
- The supported Alembic starting states are (a) an empty database and (b) a POC database at any
  revision of the current migration history. Local POC data may be discarded at any time by
  deleting `var/*.db` and re-running `make migrate`.
- This slice adds no migration; the existing migration tests already cover both supported states
  and model-metadata parity.

## Verification

Pure domain/application tests (`apps/api/tests/test_definitions.py`,
`test_definition_resolution.py`, `test_sandbox_snapshot.py`) prove that published versions cannot
mutate and cannot be overwritten, draft edits never change published versions, publishing pins
exact reference and shop versions and rejects missing, unpublished, disallowed, duplicate, and
cross-shop references, resolution deterministically identifies every behaviorally relevant input
and rejects version conflicts, and the `sandbox-v1` fingerprint is order-insensitive, changes for
every behaviorally relevant change, and rejects arm inputs. The POC `v1` fingerprint output is
byte-identical after the canonical serializer extraction.

## Consequences

- Later slices implement persistence, contracts, and UI against this lifecycle instead of
  designing their own; the shared canonical serializer backs both POC `v1` and `sandbox-v1`.
- The first persistence adapter must enforce a unique `(definition_type, definition_id, version)`
  constraint (raising the overwrite error instead of upserting) and re-check the same-shop rule at
  the storage boundary, because a `VersionRef` alone does not carry the target's shop.
- Publish failures surface two error families: domain `DefinitionLifecycleError` subtypes for
  rule violations and application `DefinitionResolutionError` subtypes for missing drafts,
  unpublished references, and repository conflicts. The first HTTP slice maps both families
  explicitly rather than expecting a single hierarchy.
- Republish cascades are explicit: publishing a new shop version does not update tickets or
  scenarios until each is republished, and stale mixed closures fail loudly at resolution.
- Every materialized-state slice must version the sandbox schema; `sandbox-v1` fingerprints only
  resolution identity, seed, and tool contracts until sections exist.
- `docs/product-direction.md` is aligned with the formalized model revisions; the
  design-direction precedence note is replaced by this ADR.
