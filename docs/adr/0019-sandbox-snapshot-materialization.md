# ADR 0019 — The canonical sandbox snapshot: pin what is immutable, copy what is not

Status: accepted — 2026-08-25

Implements `docs/PLAN.md` Milestone 2's materialization outcome and the runtime half of its
product-page/order-page origin outcome, under ADR 0011, the snapshot boundary fixed by ADR 0012,
the order-fixture lifetime of ADR 0015, the ticket origin of ADR 0016, and the scenario recipe of
ADR 0018. Records the `sandbox-v2` envelope, the rule that decides what a snapshot pins and what it
copies, the identity a snapshot has, the gate it re-runs, and the three operations that publish it.

ADR 0018 deferred exactly this: "the canonical snapshot is what turns this recipe into starting
state. This slice resolves and *reports* that state; it does not freeze a sandbox."

## Context

A published scenario version is a recipe, not starting state, and the gap between the two is a
lifetime mismatch.

Almost everything the recipe reaches is already immutable and pinned: the shop version, the ticket
version, the customer-profile version the ticket pinned, and one version per composed template.
ADR 0012 gave them the pins; ADR 0018 wrote them.

One thing is not. An order fixture is authored state, not a definition (ADR 0015), and a scenario
names one by identifier only. So between publishing a recipe and running it, the order it turns on
can be edited, reassigned, or deleted — and *the recipe would not change*, because nothing about it
did. Two runs a week apart could start from different worlds while claiming the same inputs.

ADR 0012 anticipated the answer and left room for it: `sandbox-v1` carried the pins and an
explicitly empty `state` section, noting that "materialized commerce state sections are defined by
later slices; adding or changing a section requires a new canonical schema version".

## Decision

### Pin what is immutable, copy what is not

One rule decides the whole content of a snapshot:

- **The catalog, the support knowledge, the ticket thread, the customer profile, and every composed
  template are published versions.** They cannot change, so the snapshot records the pin and never
  a second copy. Copying them would create two sources of truth for the same bytes, and the pin
  already carries the content fingerprint that identifies them.
- **The order fixtures are not.** So the snapshot freezes the exact `order-fixture-v1` documents it
  saw, embedded whole. `order_fixture_payload`'s module docstring has said since ADR 0015 that "the
  scenario slice freezes a copy of this exact document"; this is that copy, taken one step later
  than that sentence guessed — at materialization rather than at publication, because publication
  has no reason to touch an order it only names.

The rejected alternative was to copy everything into a self-contained document. It reads simpler and
is worse: a snapshot would then hold a catalog that could silently differ from the shop version
beside it in the same envelope, and every future definition type would have to decide again whether
it is copied or pinned. The rule above answers that question once, from the definition's own
lifetime.

A consequence worth naming: **a snapshot cannot be read without the versions it pins.** That is
intended. Published versions are immutable and never deleted (ADR 0016, ADR 0018), so a pin is a
stronger guarantee than a copy, not a weaker one.

### The whole customer's order history enters the sandbox

Not only the orders the recipe names. An arm can list a customer's orders through a tool, and a
sandbox holding only the referenced ones would answer that question differently from the shop the
incident was authored in — which is precisely the kind of difference a comparison must not
introduce. So `SandboxState` holds every order the ticket's customer has in the scenario's shop, and
refuses one belonging to anybody else.

The scoping rule is the same one ADR 0016 gave a ticket's linked orders and ADR 0018 gave a
binding's entity, for the same reason: an arm that could reach another customer's order would be
acting outside the incident the ticket described.

### The interaction reference is minimal, and this is where it becomes runtime

`state.interaction` carries the origin kind, at most one identifier, the channel, and the ticket
reference — and nothing else. A `product_page` origin travels as a catalog handle; an `order_page`
origin travels as an order ID. Neither embeds the resource.

This completes ADR 0016's decision at the other end. The ticket authored a minimal reference so that
"the agent resolves *this product* or *this order* through tools"; the snapshot is where that
reference becomes the starting state a tool will resolve against. The read tools that consume it
arrive with Milestone 2's tool outcome, against a `state` section that already names what they must
answer for.

`SandboxState` refuses to freeze an origin whose order is not in the sandbox. The gate reports that
as a finding first; reaching the constructor with it means a caller skipped the gate.

### `sandbox-v2`

```
canonical_schema_version   "sandbox-v2"
definitions[]              every pinned version, with its content fingerprint
seed                       the deterministic seed
tool_contracts{}           name → version, empty until the read-tool outcome
state.customer_profile_id  whose world this is
state.interaction          origin kind, product handle or order ID, channel, ticket reference
state.orders[]             order_id + the whole `order-fixture-v1` document
```

The version bump is not cosmetic. `sandbox-v1` fingerprinted the pins alone, so two materializations
of one recipe over two different order sets would have hashed identically — the exact confusion this
slice exists to remove. Anything else that enters `state` later needs `sandbox-v3` for the same
reason.

`DocumentReader.embedded` is new and exists for one purpose: handing a nested `order-fixture-v1`
document to the codec that owns it. The envelope is the first document that embeds another
document's document, and the alternative — re-implementing the order codec against a reader — is the
second copy this codebase keeps refusing to write.

**One decoder reads a stored envelope, and it fails loudly.** `sandbox_snapshot_from_document`
checks the schema token first, so a `sandbox-v1` row — or a future envelope whose sections happen to
be shape-compatible — says *that* instead of failing incidentally on a field three levels down; this
is the check ADR 0015's order repository has always made. The pins are decoded exactly as strictly
as the state beside them: a drifted entry raises with its failing path rather than being skipped,
because the pins *are* the reproducibility claim and a snapshot that silently lost one is
indistinguishable from a snapshot that never had one. A record therefore exposes one `content`
accessor rather than a set of lenient ones, and a response decodes once.

### A snapshot is identified by its fingerprint, not by its inputs

`materialize` is idempotent by `sandbox_fingerprint`, unique per shop. So:

- the same version, the same seed, and the same orders return **the snapshot that already exists**;
- an order edited in between produces **a new one**, because it genuinely is different starting
  state;
- a different seed produces a new one, because the seed is a behavioral input.

Keying on `(scenario_version, seed)` instead was rejected: it would have to either overwrite
recorded starting state when an order moved — destroying the evidence a historical run is explained
by — or refuse the second materialization, which would leave an author unable to freeze the world
they can plainly see. The fingerprint is the honest identity, and it is the one an experiment will
cite.

Snapshots are never updated and never deleted. The repository has no update path at all, and the
service hands back the existing record rather than writing a second row for the same bytes.

The lookup and the insert are two statements, so two concurrent materializations of the same
starting state can both miss and both write. The unique constraint decides, and the loser reads the
winner rather than raising: `save` catches that one `IntegrityError`, restarts its transaction, and
returns the committed row — the pattern the generation idempotency claim already uses, and the only
one consistent with a write this ADR calls idempotent. The insert is the first write of the unit of
work, which is what makes the restart safe.

### The publish gate runs again, against the world as it is now

A published version is immutable, but the orders it names are not — so materialization re-runs
`validate_ticket` and `validate_scenario` against the pinned payloads and the *current* orders, and
refuses the freeze on any error. The findings are the same codes an author already knows
(`binding_order_missing_from_shop`, `linked_order_missing_from_shop`,
`binding_order_of_another_customer`), re-rooted under `ticket.` or `scenario.` so a hole is
locatable in the document that holds it.

Reusing the two rule sets rather than writing a third is the same decision ADR 0016 made when it
moved the gate into an overridable service hook, and ADR 0018 made when it re-rooted
`check_bindings`: "publishable" and "materializable" differ only in *when* they are asked, so they
must not be two implementations that can drift.

The gate reads the **pinned** templates, never their drafts. A template rewritten after the
publication does not change what that scenario version means — which is the entire reason the
publication pinned a version of it.

### A closure that disagrees with itself is an actionable finding

`_resolve_closure` refuses a closure that pins two versions of one definition (ADR 0012). This slice
is the first caller to hit it in practice, and the way it happens is ordinary: publish a ticket
against shop v1, publish a new shop version, then publish a scenario — the scenario pins shop v2
while its ticket still pins shop v1.

A snapshot cannot pick a winner, and the author can fix it by republishing the ticket, so the
conflict joins the gate findings as `sandbox_conflicting_pin` rather than crashing. The message
already names the definition and both versions.

This is a **known rough edge, deliberately left**: the scenario's own publish gate reports a clean
preview and the refusal appears one step later, which is the split ADR 0016 and ADR 0018 both argue
against. Closing it means the scenario gate reasoning about the whole reference closure — which is
what the resolution does — and putting that logic in two places is exactly what this ADR refuses
everywhere else. The honest fix belongs with a shared closure check the publish gate can call, and
it is not this slice's to invent. `MissingReferenceVersionError` stays a raised error rather than a
finding: a pinned version that no longer resolves is corruption, not something an author authored.

### The seed is an input, not a stored default

`materialize` takes it, `resolve_sandbox_inputs` range-checks it with the existing rule, and the
envelope hashes it. Experiments do not exist until Milestone 4, so `resolve_experiment_inputs` was
split rather than duplicated: `resolve_sandbox_inputs` resolves the shared half a scenario can
answer for alone, and the experiment resolution adds the arms to exactly that result. The
arm-exclusion check in the envelope is unchanged and still refuses an agent configuration or a
support identity outright.

`SANDBOX_TOOL_CONTRACT_VERSIONS` is deliberately empty. The lab has no versioned tool catalog until
Milestone 2's read-tool outcome, and the envelope already reads it, so that slice registers versions
in one place rather than changing the schema.

### Persistence

One table, `sandbox_snapshots`, holding the canonical document. `shop_id`, `scenario_id`,
`scenario_version`, `seed`, and `sandbox_fingerprint` are columns so a shop's snapshots can be found
and recognized; they are written **from** the document, never as a second source of truth, and
everything a consumer reads about the frozen state is decoded back out of it. A stored document that
no longer matches `sandbox-v2` fails loudly rather than being served as starting state nobody can
reproduce — the same rule the order repository has held since ADR 0015.

The fingerprint is unique per shop rather than globally: identical starting state authored in two
shops is two snapshots, because each belongs to the shop whose objects it froze.

### Public contract

Three operations. `POST /shops/{shop_id}/scenarios/{scenario_id}/versions/{version}/snapshots`
materializes, because a snapshot is derived from a published version and cannot exist without one.
`GET /shops/{shop_id}/scenarios/{scenario_id}/snapshots` lists what a scenario has been frozen into.
`GET /shops/{shop_id}/snapshots/{snapshot_id}` reads one, addressed by the shop, because a snapshot
is shop-scoped state and its scenario is provenance rather than a path a client must remember.

The response separates the two halves the document separates — `pins` and `state` — because that
distinction *is* the decision above, and a client that could not see it would have to guess which
half an edit can still move. Orders travel as a readable projection with their frozen shipping
address; the canonical bytes behind them are identified by `sandbox_fingerprint`, which is what a
reproducibility claim actually rests on.

A refusal answers 422 with the gate findings, in the same body shape a publish refusal uses
(`DefinitionValidationErrorResponse`), so an operator reads one kind of finding whichever gate
refused them. `LabApiError` now carries those findings: a publish refusal is explained by the
preview the editor already holds, but a materialization refusal has no preview beside it.

### The Studio surface

Frame set: none — the design direction has no snapshot frame, so the page follows the shell's
resource conventions as support-identity forms do (ADR 0014), and lives at
`scenarios/:scenarioId/snapshots`, linked from the scenario editor's header and from its
published-version notice.

It shows what the decision above makes worth showing: which published version to freeze, the
snapshots already taken from it, and for one snapshot the pins beside the copies, including the
identifier the interaction names. The newest published version is preselected because that is the
version an operator means without saying so — computed rather than read off an end of the list,
since the contract promises no order and the server in fact answers newest-first. The seed is
required rather than defaulted from an empty field: it is a behavioral input, so freezing against
one the author never chose is not a convenience.

## Deliberately not here

- **Cloning a snapshot into two isolated arms** is the next outcome. This slice freezes one
  immutable starting state; cloning is what makes a mutable copy per arm, and it is what the
  "mutations remain isolated" acceptance criterion tests.
- **Versioned read tools** consume `state` and arrive with Milestone 2's tool outcome. The
  interaction reference they resolve is frozen here.
- **The safe address-change action** mutates a clone, not a snapshot.
- **A closure check inside the scenario publish gate**, as argued above.
- **Deleting a snapshot**: it is the evidence a historical run is explained by, and no slice yet has
  a reason to remove one.

## Verification

- Domain tests (`test_sandbox_domain.py`) cover the ordering and uniqueness of frozen orders, the
  one-customer rule, the refusal to freeze an origin whose order is absent, and the interaction read
  off a frozen ticket.
- Envelope tests (`test_sandbox_snapshot.py`) prove the schema version, that the state is part of
  the fingerprint (an order that moved and an origin that changed both alter it), that arm inputs
  still cannot enter it, that the whole envelope and the state section round-trip including a
  product-page origin, that an envelope of another schema version is refused by its token, and that
  a drifted state field or a drifted pin names its failing path rather than being dropped.
- Service tests (`test_sandbox_materialization.py`) prove what is pinned and what is copied, that
  the whole customer's order history enters the sandbox, both origin kinds, that identical inputs
  return the same snapshot while another seed or an edited order produce a new one, that an earlier
  snapshot keeps what it froze, that a newer template version does not change a frozen recipe, that
  a deleted order refuses the freeze with locatable findings, that a disagreeing closure is reported
  as `sandbox_conflicting_pin`, that an unresolvable pin raises instead, that a concurrent write of
  the same starting state hands back the committed winner instead of failing, and that one shop
  never finds another's snapshot.
- Contract tests (`test_snapshot_api.py`) prove the three operations, the pins and state a response
  carries, the minimal interaction shape, idempotency, the 422 that carries its findings, the
  schema-refused seed, and shop scoping.
- Migration tests prove the per-shop fingerprint uniqueness constraint and place the table with the
  definition tables' migration fate rather than the POC's.
- Frontend tests (`Snapshots.test.tsx`) prove the preselected newest version against a
  newest-first list, as the contract really answers, the pins-beside-copies reading, the interaction
  read back as an identifier, the findings a refusal shows, the refusal to freeze against a cleared
  seed, and the empty state of a scenario with nothing published.
- The Playwright scenario journey now continues past publication: it freezes the published version,
  reads the pins and the copied order, and materializes twice to show one snapshot rather than two.
