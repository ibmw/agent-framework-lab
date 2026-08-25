# ADR 0018 — The scenario recipe: one ticket, bound blocks, and a resolved starting state

Status: accepted — 2026-08-25

Implements `docs/PLAN.md` Milestone 2's scenario recipe and scenario editor (the outcomes ADR 0016
deferred and ADR 0017 split away from the block libraries), under ADR 0011, the lifecycle fixed by
ADR 0012, and the payload pattern established by ADR 0013, generalized by ADR 0014, extended to
shop-scoped types by ADR 0016, and given its parameter model by ADR 0017. Records the
`scenario-payload-v1` schema, the reference grammar a binding resolves through, the rule that
severity is the instance's rather than a binding, the multi-target pin a publication writes, and the
composition surface of frame 4.

## Context

A scenario is the last authorable definition before an experiment can run, and it is the first that
is mostly *composition*. ADR 0016 deferred it on the grounds that "a scenario payload is mostly
block bindings whose shape those libraries fix", and ADR 0017 then fixed that shape: a parameter has
a name, a kind, and — through `SHOP_BOUND_PARAMETER_KINDS` — a declaration of whether a scenario
must resolve it inside its own shop.

So this slice is where that declaration is finally cashed in. A template says "bind me a document";
only a scenario knows which shop's documents exist. Everything below follows from having to answer
that question without letting one shop's object reach another's recipe.

Four things a scenario adds on top of its ticket, and they are the four the design direction names:
context documents, hidden facts, bound objective and mutation blocks, and completion conditions.

## Decision

### A scenario is a shop-scoped definition that references four kinds of thing

`DefinitionType.SCENARIO` has been in `SHOP_SCOPED_DEFINITION_TYPES` since ADR 0012, and
`ALLOWED_REFERENCE_TARGETS` has always let it reference a ticket and both block types. This slice
starts writing them, so ADR 0012's reference table is now fully exercised — a scenario is the first
definition whose references span more than one target type, and the first whose reference *count* is
authored rather than fixed.

References are derived from the payload, like a ticket's customer: `scenario_references` reads the
ticket ID and every distinct `block_id`. **Distinct** is the load-bearing word. Two read-checks on
two documents bind one template, and a reference is per definition, so the publication pins that
template once. `_require_allowed_references` already refuses a duplicate target, so deduplicating in
the codec is not a convenience — it is what makes the frame's two `read-required-document v1` rows
legal at all.

**No migration and no table.** `definition_drafts` and `definition_versions` already accept the
`scenario` type in their check constraints; the shared `SqlAlchemyDefinitionRepository` needs only a
codec.

### `scenario-payload-v1`

```
name                     the shop-unique title the index is read by
ticket_id                the incident this recipe is built on (an ADR 0012 reference)
context_documents[]      kind + document_id — the shop documents that matter here
objectives[]             id + block_id + severity + bindings — order is priority
mutations[]              id + block_id + bindings — order is the run timeline
hidden_facts             operator-only prose the support agent never sees
completion               statement + max_turns
```

Two things are deliberately **absent** from the document, for the same reason in both cases — they
are provenance, not content:

- **The owning shop.** As with a ticket, the draft record carries the scope and the published
  version pins the exact shop version. Two identical recipes authored in two shops therefore hash
  alike.
- **Every pinned version.** The document names the ticket and each template by definition ID only.
  Re-publishing an unchanged draft against a newer template produces the *same* content fingerprint
  with *different* pins — which is exactly what happened, and is the distinction that lets a
  historical run be explained.

**Bound-block order is content; binding order is not.** Objective order is priority and mutation
order is the run timeline, so both are preserved and a reorder changes the fingerprint (and is
reported in the change summary — a membership diff alone would leave an author reading "no changes"
beside a genuinely different version). Bindings are a *map*, so `BoundObjective.__post_init__`
normalizes them to parameter order. Normalizing in the domain rather than in the codec is what makes
the round trip an identity: two authoring orders are the same scenario and must not publish as two
versions.

### A binding value is a reference the scenario's own shop resolves

A binding is a string, because a template parameter has one value. The grammar is small, closed, and
resolved by the publish gate rather than by shape alone:

| Kind | Value | Resolved against |
| --- | --- | --- |
| `document_reference` | `policy:address-change` | the shop's policies, guidelines, FAQ |
| `entity_reference` | `order:<id>`, `customer:<id>`, `product:<handle>` | the shop's orders, attached customers, catalog |
| `data_reference` | `order:<id>#shipping_address` | the entity, then `DATA_FIELDS` |
| `tool_reference` | `update_shipping_address` | nothing yet — see below |

An order or customer is named by its stable identifier and a product by its catalog handle, exactly
as a ticket's origin names them: an author may rename a reference and a renamed order is still the
same order, while a handle *is* the shop's own key.

Three rules the gate enforces, and each is an error rather than a warning because a binding that
resolves to nothing would materialize a snapshot with a hole in it:

- **The object exists in this shop.** `binding_document_missing_from_shop`,
  `binding_order_missing_from_shop`, `binding_customer_missing_from_shop`,
  `binding_product_missing_from_catalog`.
- **The object belongs to this incident's customer.** `binding_order_of_another_customer` and
  `binding_customer_not_the_ticket_customer`. The same rule ADR 0016 gave a ticket's linked orders,
  for the same reason: an arm that could reach another customer's order would be comparing something
  the ticket never described. Two order sets are kept apart in the authoring context so "that order
  is gone" and "that order is somebody else's" stay distinguishable findings.
- **A data reference names a field the sandbox can answer for.** `DATA_FIELDS` is a small closed
  table per entity kind, driven by what the wrong-address incident needs — the address an arm must
  not reveal and its immediate neighbours. Without it, `#secret_sauce` would publish and fail at run
  time instead of at the gate.

`tool_reference` is deliberately shape-checked only. ADR 0017 already placed tools outside the
shop-bound set because a tool belongs to the lab; the lab has no versioned tool catalog until
Milestone 2's read-tool outcome, and a gate that invented one now would be guessing at a contract
that slice will fix.

### Severity is the instance's, and a template's severity parameter resolves from it

Frame 4 shows a severity chip on *every* objective, including `verify-before-disclosure` and
`clear-resolution-explanation`, which declare no parameters at all. A field every instance must
answer is not a parameter some templates happen to declare, so `BoundObjective.severity` is a
first-class field.

That leaves ADR 0017's `severity` parameter kind, which `read-required-document` uses. The two are
reconciled in one rule rather than allowed to coexist and disagree: **a `severity`-kind parameter is
resolved from the instance's severity field, never from the bindings map.** Binding one explicitly
is `objective_binds_severity`, and the editor renders no row for it. The template's declaration is
still doing work — it is how a template says its runtime logic reads the severity, and its *default*
is the value the editor starts a new binding at, which is exactly what frame 4a's "default:
required" annotation means.

The alternative — dropping the field and making severity a binding — was rejected because it would
make the frame's chip unexplainable for parameterless templates and would let two scenarios express
the same objective in two shapes.

### The template-decidable half of the gate is ADR 0017's, unchanged

`check_bindings` already judges everything a template can judge alone: unknown parameters, missing
required ones, and literals that do not fit their kind. This slice calls it and re-roots the
findings under the instance that produced them (`objectives.<id>.template.bindings.<name>`), so
there is one implementation of "does this binding fit this parameter" rather than a second copy that
drifts.

What a scenario adds is the half a template cannot reach: `shop_bound_parameters` names exactly the
bindings it must answer for, and the table above is the answer.

### Publishing pins the shop, the ticket, and one version per template

`publish_draft` needed no change: the shop pin, the same-shop check on `(SCENARIO, TICKET)`, and the
"pinned references must cover exactly the draft's references" rule all already existed. What is new
is that they now run against more than one reference at once.

The gate reports every target that has nothing to pin — `ticket_unpublished`,
`objective_block_unpublished`, `mutation_block_unpublished`, `shop_unpublished` — rather than
leaving the pin step to refuse the click. An author must not read a clean preview and then get a
422, so the preview and the freeze are one rule set, as they are for a ticket.

### The resolved-state preview travels inside the publish preview

Frame 4's right rail pairs "Valid — publishable" with the resolved starting state, and they answer
one question together: *may this be frozen*, and *what would it freeze*. So `previewScenarioDraft`
carries a `resolution` alongside the issues rather than exposing a second route the editor would
have to keep in step.

The resolution is derived on every read and never stored: the shop, the ticket and its customer,
each context document's title, each entity a binding points at, and the exact version each composed
template would pin. Every one of those lives elsewhere and would go stale the moment it moved. A
`null` version means "nothing to pin", which is the same fact the gate reports as an error beside
it.

The entities are read from the *binding values* rather than from a stored list, for the same reason
the references are derived from the payload: the binding is where the scenario actually names an
object, and a second list would drift from it.

### A scenario is created on a ticket and never moves off it

The ticket is fixed at creation, exactly as a ticket's customer is, and is deliberately absent from
the draft-write shape so a client cannot send a field the service would refuse. The context
documents, the bindings, and the hidden facts all describe one incident; rebuilding on another
ticket would leave every one of them describing something else. Create a second scenario instead.

A new scenario's context documents are **pre-filled from the ticket's suggested documents**. That is
what a suggestion is for — ADR 0016 called it "authoring convenience, not sandbox content", and the
author who wrote "read the address-change policy" beside the incident should not have to say it
twice.

The name is kept unique among a shop's live scenario drafts, like a block's name in its library and
a ticket's reference in its shop: not an identity rule (an experiment binds a scenario by ID and
pins an exact version), but what keeps the index a human can pick from. Checked in the service, with
the same concurrent-creation caveat ADR 0017 recorded.

### Two errors, two warnings, and why each is which

- `scenario_without_objective` (error) — a recipe that asserts nothing produces no evidence, so a
  run of it could not be compared to anything.
- `scenario_without_completion` (error) — the turn cap alone says when to stop, not what success
  was.
- `scenario_without_context_document` and `scenario_without_hidden_facts` (warnings) — both are
  authoring an operator will miss rather than a sandbox that cannot be built.
- `objective_document_outside_context` (warning) — a read-check whose document is not in the context
  list still works, because the binding is already resolved against the shop. What is missing is the
  curation: the document will not appear beside the incident for the operator.

### Completion is a statement plus a turn cap

Two halves answering different questions. The statement is what the operator and, later, the judge
read; `max_turns` is the hard cap that guarantees a run terminates whatever the arms do, so both
arms are bounded identically. Bounded 1..100 as a domain invariant and declared on the wire, so a
consumer reads the limit off the schema instead of discovering it by being refused.

### Hidden facts are one prose field, and the only `CUSTOMER_ONLY` leaf in the payload

`FieldSensitivity.CUSTOMER_ONLY` exists for exactly this: simulation-side content the support agent
must never see. `restricted_values` names it and `telemetry_attributes` carries only counts and
identifiers, so a span can say which recipe a run started from without disclosing a fact the agent
is not meant to have.

It is a single field rather than a list of individually revealable facts. Frame 4 shows one block of
prose, and the consumer that would want them separated — the customer simulator — is a deferred
decision trigger. Splitting it is a payload revision that slice can make when it has a use for the
seam.

### `ShopDocumentKind`, extracted

A ticket *suggests* a shop document, a scenario *includes* one as context, and a read-check *binds*
one. All three name the same three collections, so the enumeration moved to `domain/shop.py` — which
owns those collections — and `domain.ticket.SuggestedDocumentKind` is now an alias. The wire values
are unchanged; only the schema component is renamed, which is why the frontend rename came with it.
This is the same move ADR 0014 made for the draft/published lifecycle: a second copy of a set would
eventually disagree with the first about what a document can be.

### Public contract

Nine operations under `/api/v1/shops/{shop_id}/scenarios`, beside that shop's tickets and orders
because a scenario is shop-scoped.

- **The request carries selections and prose**; the ticket and the derived counts are response-only.
- **`/resources`** answers what a binding may name — the shop's documents with their titles and
  reference values, this customer's orders, the catalog handles, the customer, and both libraries'
  templates *with their parameters*. The parameters travel because binding is the editor's whole
  job: without them a picker could only offer a name and the author would be typing values blind
  against a gate that already knows the answer.
- **Each option carries its `reference_value`.** The grammar is the backend's, so the backend writes
  it and the editor never spells one.
- **A published version names every pin**: `shop_version`, `ticket_version`, and one
  `PinnedTemplateSchema` per composed template with its definition type.
- The binding cap, the collection caps, and the turn range are declared as `maxItems`/`ge`/`le`
  rather than left to be discovered by refusal.

### The editor holds only recipes the lab would take

Frame 4, as a composition surface rather than a set of bespoke forms. Two rules mirror the backend
rather than restating it:

- **A shop-bound parameter is picked, never typed.** The pickers offer what `/resources` returned,
  so an author cannot spell a reference wrong or name another customer's order.
- **A severity parameter renders no binding row**, because the instance's own severity field
  resolves it.
- **A data reference is retargeted, not patched.** It is two controls over one value, so
  clearing the object clears the whole reference and a field the new object has no answer for
  does not survive the switch — `retargetDataReference` holds both halves of the gate's rule.
  Without the first, clearing the object built `#shipping_address`: a truthy string the editor
  stored, no control displayed, and the gate refused with a finding nothing on screen
  explained.
- **Whatever is bound is always offered.** The timing list is a convenience and the shop's
  objects can move under a draft, so a controlled select appends its current value when the
  list does not name it. Otherwise a draft holding `at_turn:5` would read as unbound and the
  first interaction would silently replace it.
- **A picker that has not loaded is not an empty one.** The resources are a three-state load,
  so a bound row whose template is still arriving is not rendered as an orphan and an
  unreachable library is not rendered as an empty one; a failed load says so, with a retry.

Clearing a picker *removes* the binding rather than writing an empty one, because "not bound yet" is
a state a draft is legitimately in while `binding_empty` is a publish-gate error. A new instance
starts with every literal default its template carries — which is a reference parameter never, by
ADR 0017's rule. The read-checks shown beside each context document are derived from the bindings,
so the two can never disagree.

## Deliberately not here

- **The canonical snapshot** (Milestone 2's materialization outcome) is what turns this recipe into
  starting state. This slice resolves and *reports* that state; it does not freeze a sandbox.
- **Cloning a snapshot into two isolated arms** follows it.
- **Product-page and order-page origins** are the ticket's (ADR 0016) and already resolve; the tools
  that read them arrive with the read-tool outcome.
- **Tool-reference validation** waits for the versioned tool catalog, as above.
- **A scenario's own "used by"** — which experiments pinned which version — belongs to Milestone 4,
  which is where experiments first exist.
- **Delete**, as for every definition so far: a published version is evidence, and no slice yet has
  a reason to remove one.

## Verification

- Domain tests (`test_scenario_domain.py`) cover the structural invariants, the whole reference
  grammar in both directions including every malformed shape, the two errors and two warnings, the
  content-only gate that consults no shop, the shop-resolution rules for documents, orders,
  customers, products, and data fields, a template the library dropped, an unpublished template, the
  re-rooted `check_bindings` findings, both halves of the severity rule, the read-check warning, the
  telemetry that never carries hidden facts, and change summaries including the reorder that a
  membership diff would miss.
- Serialization tests (`test_scenario_payload.py`) prove the payload round-trips, the document is
  canonical, it carries neither its shop nor any pin, bound-block order changes the fingerprint
  while binding order does not, severity is frozen content, both bound shapes and completion
  serialize exactly, a drifted schema and a malformed identifier name their failing path, and every
  document leaf carries a sensitivity decision.
- Service tests (`test_scenario_authoring.py`) prove a new scenario inherits the ticket's
  suggestions and is saveable while incomplete, the ticket is fixed at creation and refused inside
  another shop, the name is unique per shop, the references follow the payload, a publication pins
  the shop, the ticket, and one version per template — once for a template bound twice — an
  unpublished target is reported before the pin step could refuse it, republishing an unchanged
  draft repins the newest template version without changing the content fingerprint, a published
  version stays frozen, one shop never finds another's scenario, the resolved preview names every
  version and reports an unresolvable target without raising, and the pickers offer only what the
  gate would accept.
- Contract tests (`test_scenario_api.py`) prove the create/read/preview/resources/publish/version
  surface, a duplicate name is a 409, a ticket outside the shop answers the scenario-ticket code,
  the ticket cannot be moved through the draft shape, an out-of-range turn cap is refused by the
  schema, a duplicate binding answers the domain code, the preview carries the gate and the resolved
  state together, an unresolvable binding blocks publication with its finding, a published version
  names every pin, and one shop never finds another's scenario.
- Frontend tests (`Scenarios.test.tsx`) cover the index, creation on a ticket, the gate paired with
  the resolved state, binding through the shop's own pickers, severity declared once, a mutation's
  timing offered as the forms the runtime observes, the derived read-check markers, a data reference
  cleared and retargeted, a bound value the list does not name, the publish that retires its own
  notice on the next edit, a failed picker load and its retry, and the refused publish of unsaved
  edits. `lib/scenarios.ts` has its own unit tests for the binding rules, the picker choices, the
  data-reference grammar, the turn cap, reordering, and the request shape.
- A Playwright journey builds the whole chain — shop, customer, order, ticket, both templates — then
  composes the wrong-address recipe, reads the resolved state, publishes it, and proves the frozen
  version survives an edit to the draft.

## Consequences

- The snapshot slice reads a published scenario version and its pins: the ticket version supplies
  the trigger, the shop version the catalog and support knowledge, and each template version the
  assertions and injections. Nothing it needs is stored twice.
- The runtime resolves a binding by parsing it with the same helpers the gate uses
  (`parse_document_reference`, `parse_entity_reference`, `parse_data_reference`), so the value it
  resolves is the value the gate accepted.
- A new entity kind or data field is a code change by design, as a new parameter kind is under
  ADR 0017: the sandbox resolves a reference by kind, so one that does not exist in the table can
  never be bound.
- The evaluation slice reads `severity` per bound objective to decide whether a missed objective
  fails the run or warns it, and `completion.max_turns` bounds every arm identically.
- `ShopDocumentKind` is now the single name for the shop's document collections; the next resource
  that references one uses it rather than declaring a fourth copy.
- Existing definition types are untouched. Local databases keep working; this slice adds no
  migration and no table.
