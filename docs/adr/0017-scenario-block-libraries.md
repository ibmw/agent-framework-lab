# ADR 0017 — Objective and mutation blocks: shop-independent templates a scenario binds

Status: accepted — 2026-08-25

Implements `docs/PLAN.md` Milestone 2's fourth outcome under ADR 0011, the lifecycle fixed by
ADR 0012, and the payload pattern established by ADR 0013, generalized by ADR 0014, and extended to
shop-scoped types by ADR 0016. Records the `objective-block-payload-v1` and
`mutation-block-payload-v1` schemas, the typed parameter model, the rule that a template may never
name a shop object, the two publish gates that separate an objective from a mutation, and the
libraries' shared editor surface (frames 4a and 4b).

The **scenario recipe** is not in this ADR. ADR 0016 deferred it to "the slice that also delivers
the block libraries and the scenario editor" on the grounds that a scenario payload is mostly block
bindings whose shape the templates fix. This slice fixes that shape; see "Deliberately not here".

## Context

Milestone 2 outcome 3 is the scenario recipe, and outcome 4 is the block libraries it composes. They
cannot be built in that order. A scenario's payload is a list of *bound instances* — template
version, parameter bindings, severity — and none of that has a shape until the templates say what a
parameter is. Building the scenario first would mean inventing a binding model and rewriting it
once the templates existed, which the delivery rules forbid: a public contract does not ship without
its consumer, and a guessed contract is worse than a late one.

So this slice delivers outcome 4 alone. It is independently useful — an author can build and publish
the eight objective templates and four mutation templates frames 4a and 4b show — and it is what
lets the scenario slice be wiring rather than invention.

The lifecycle already anticipated it. `DefinitionType.OBJECTIVE_BLOCK` and `MUTATION_BLOCK` have
existed since ADR 0012, `ALLOWED_REFERENCE_TARGETS` already lets a scenario reference both, and
`REQUIRED_REFERENCE_COUNTS` already leaves block references at 0..N. Nothing about the storage or
the authoring service needed to change.

## Decision

### A block is a shop-independent definition, like a support identity

Blocks hold no definition-to-definition reference and belong to no shop, so they run on
`DefinitionAuthoringService` unchanged: `create` takes no shop, the codec's `references` keeps its
default, and a published version pins neither a shop version nor a target version. Only the codec,
the publish gate, and the index projection are per-type.

This is deliberately the *opposite* choice from ADR 0016's ticket. A ticket is one shop's incident
and names that shop's customer throughout; a template is a rule about how experiments are judged and
names nothing at all. The two halves of ADR 0012's lifecycle are now both exercised by real types.

**No migration and no table.** `definition_drafts` and `definition_versions` already accept both
types in their check constraints; this slice starts writing them.

### A template may never name a shop object — the parameter kind is how it says so

This is the rule the whole model exists to enforce, and it is stated in exactly one place:
`SHOP_BOUND_PARAMETER_KINDS`. A parameter declares a `BlockParameterKind`, and the kind decides
whether a scenario must resolve that parameter inside its own shop.

Eight kinds, each justified by a template the frames actually show:

| Kind | Bound same-shop | Frame parameter |
| --- | --- | --- |
| `document_reference` | yes | `doc_ref`, `policy_ref` |
| `entity_reference` | yes | `entity_ref` — "order or customer reference" |
| `data_reference` | yes | `data_ref` — the address that must not be revealed |
| `tool_reference` | no | `action_ref`, `tool_ref` |
| `severity` | no | `severity` |
| `timing` | no | `timing`, `window` |
| `duration` | no | `duration` |
| `text` | no | — |

`tool_reference` is deliberately outside the shop set: a tool belongs to the lab, not to a shop, so
binding one crosses no boundary. The frames' `action_ref` and `tool_ref` are the same kind under two
authored names — the *parameter name* stays the author's, only the kind is shared.

Two rules fall straight out of the classification, and both are structural rather than cosmetic:

- **A reference parameter cannot carry a default** (`reference_parameter_with_default`). A default
  reference would name one shop's object and hand it to every other shop that binds the template,
  which is precisely the leak shop-independence exists to prevent. The editor does not render the
  field at all rather than rendering one the gate refuses.
- **An optional parameter must carry a default** (`optional_parameter_without_default`). Optional
  means "the scenario may omit it"; with nothing to fall back on, omitting it leaves the runtime
  with no value. Combined with the rule above, a reference parameter is always required.

A template declares at most eight parameters. The cap is a domain invariant and is also declared on
the wire as `maxItems`, so a consumer reads the limit off the schema instead of discovering it by
being refused; the editor mirrors the same constant rather than restating the literal.

`shop_bound` travels on the wire as a derived field and is never read back from a client: it is
decided by the kind, and a second authored copy could contradict it. It is likewise absent from the
canonical document, so it can never drift from the kind that produced it.

### Timing is what separates an objective from a mutation

`docs/design-direction.md` states the semantics: "Objective order is display and priority only —
scenarios stay goal-based and never imply a scripted conversation. Mutation order is real: it is the
run timeline of injected events." That is not a UI note; it is a publish-gate rule in both
directions.

- A published **mutation** declares exactly one `timing` parameter
  (`mutation_without_timing`, `mutation_with_several_timings`). A mutation with no bound moment has
  no place on the timeline, and a mutation fires once. Both arms receive the identical schedule, so
  the moment has to be authored rather than emergent.
- An **objective** may not declare a `timing` parameter at all
  (`objective_parameter_schedules`). A scenario that could schedule an objective would be describing
  a scripted conversation, which is the thing the goal-based model refuses to become.

A timing value names a moment the runtime can actually observe: `after_first_read`, `at_turn:<n>`, or
`at_offset:<duration>`. A duration is ISO 8601 restricted to days, hours, minutes, and seconds —
months and years have no fixed length, so the sandbox cannot advance by one and two identical
fixtures could not agree on what they meant.

### Assessment and evidence are two axes, and only real pairings exist

Frame 4a's "Type" column shows pairs — `deterministic · event`, `deterministic · policy`,
`deterministic · state`, `judge · dimension` — and frame 4's badges add `forbidden`. So an objective
declares how it is assessed (`deterministic` or `judge`) and what that assessment reads (`event`,
`policy`, `state`, `forbidden`, `dimension`).

A judge scores a rubric dimension and nothing else; a dimension is not recorded fact, so it is never
deterministic. The pairing lives in `JUDGE_EVIDENCE` / `DETERMINISTIC_EVIDENCE` rather than inside
the validator, so the contract and the editor can offer only combinations that exist — and the
editor moves the evidence when the assessment changes, rather than leaving a pairing the gate
refuses. `objective_assessment_evidence_mismatch` catches anything that reaches the backend anyway.

A mutation has one axis instead: `MutationEffect` — `entity_mutation`, `tool_fault`, `clock_shift`,
`service_outage` — covering exactly the four templates frame 4b shows.

### Three prose fields, and no authored evidence sample

A template carries `name`, `statement`, and `description`.

`statement` earns its place: frame 4 renders each bound objective as a sentence — "Read document →
Address-change policy", "Confirm exact parameters of → update_shipping_address" — and the phrase
before the arrow is authored, not derivable from the name. The scenario editor needs it.

Frames 4a and 4b also show an "Evidence produced" card with sample lines. That is **not** authored
here. The shape of the evidence a block produces is determined by its assessment, its evidence kind,
and its bound parameters; asking an author to type a sample would create a second source of truth
that drifts from the first the moment a parameter changes. The card is rendered from the real thing
when there is a real run to render.

### The name is a human-facing key, not an identity

**A binding never holds a name.** A scenario references a template by its `DefinitionId` — type plus
UUID — and publishing pins an exact `VersionRef`, exactly as ADR 0016's ticket pins its customer
profile. Nothing in the reference model resolves by string.

That settles what the uniqueness check is for, and it is worth stating plainly because the obvious
reading is wrong. Uniqueness is **not** an identity guarantee. `_require_free_name` scans live
drafts only, so this sequence is legal and produces two published lineages sharing one name:

1. block A publishes as `read-required-document`; v1 carries that name forever;
2. A's draft is renamed to `read-required-document-v2` — the new name is free;
3. block B is created as `read-required-document` — no draft holds it — and publishes.

This is deliberate, and it is the price of renaming being safe at all. The two lineages have
different ids, so every scenario that bound either one still resolves to the block it bound; the
shared name is a display collision, not an ambiguity. Requiring the name to be free across published
versions too would forbid renaming, which buys nothing the id does not already provide.

What the check does buy is the library index — the one surface where a human picks a template by
reading it. Two *live drafts* called `read-required-document` would be indistinguishable there, and
that is the state it prevents. A test pins the rename-and-reuse sequence so the weaker guarantee is
recorded behavior rather than an accident.

The name is a kebab-case slug — `read-required-document` — because it is what a human reads in a URL
and a table; a parameter name is snake_case — `doc_ref` — because it is what the runtime looks up
when it resolves a binding. `require_identifier` joins `require_slug` and `require_business_reference`
in `domain/content.py` as the third spelling rule, one regex per shape. The frontend mirrors both
rules separately: a parameter name is trimmed to start with a letter, a block slug is not, because
the contract accepts a digit-first slug.

The two libraries are separate namespaces: an objective block and a mutation block are different
definition types, so `clock-advance` may legitimately exist in both.

The draft check carries the same concurrency caveat ADR 0016 recorded for a ticket's reference: two
concurrent creations could both pass. Closing it needs a unique index over
`json_extract(payload, '$.name')` on `definition_drafts`, and belongs with the first slice that has a
real concurrent-authoring requirement — together with ADR 0013's last-write-wins caveat and
ADR 0016's.

### Bindings are judged as far as a template can judge them

`check_bindings(parameters, bindings)` is pure domain and reports what is decidable from the template
alone: an unknown parameter, a required parameter with neither binding nor default, an empty value,
and a literal that does not fit its kind. It deliberately does **not** judge whether a reference
resolves — only a scenario knows its shop, and `shop_bound_parameters` names exactly the bindings a
scenario must answer for.

This is the seam the scenario slice plugs into: the scenario's publish gate calls `check_bindings`
for the template-decidable half and resolves `shop_bound_parameters` against its own shop for the
rest. Splitting it this way is what keeps the same-shop rule from being restated in two places.

### Public contract

Eight operations per library under `/api/v1/objective-blocks` and `/api/v1/mutation-blocks`: list,
create, read/replace/preview the draft, publish, list versions, and read one version. Both sit at the
root of the contract beside support identities, because both are cross-shop.

A block is created with its name only — everything else is decided in the editor, so there is no
field a client could use to smuggle a type axis past the incomplete-first-draft state. A duplicate
name is a 409 (`block_name_exists`), distinct from a publish conflict.

The index row carries `type_label` and `shop_bound_parameter_count`: how many bindings a scenario
will have to resolve in its own shop is the number that tells an author what composing this template
will cost them.

### The editor holds only templates the lab would take

The same rule ADR 0015 set for the order editor and ADR 0016 for the thread composer:

- **Retyping a parameter drops a default the new kind cannot carry.** Otherwise the form keeps
  showing a value the backend refuses with `reference_parameter_with_default` while offering no
  affordance to clear it — an author reading a finding about a field that is no longer editable. The
  same edit restores `required`, because the default that made optional legal has just gone.
- **Choosing `judge` moves the evidence to `dimension`** and hides the evidence picker, rather than
  leaving a pairing the gate refuses.
- **A reference parameter renders no default field at all**, with the reason in its place.

Parameter order is authored content: it is the order the editor shows and the order a scenario binds
in, so it is in the canonical document and moving a parameter changes the fingerprint.

The Scenarios sidebar section gained nested entries, as `docs/design-direction.md` requires: "All
scenarios" (still inert, arriving with the scenario slice), "Objective blocks", and "Mutation
blocks". Nesting indents only while the rail is expanded — a collapsed rail has no room for a
hierarchy, and every label survives as an accessible name either way.

### No field-sensitivity classification

`FIELD_SENSITIVITY` exists for customer profiles, order fixtures, and tickets because those documents
hold synthetic personal data. A block template holds none: it is a rule about how experiments are
judged, written by the lab's operator about the lab. Adding an all-`OPERATIONAL` classification would
be ceremony that asserts nothing.

## Deliberately not here

- **The scenario recipe** — hidden facts, context documents, bound objective and mutation blocks, and
  completion conditions — is Milestone 2 outcome 3, and now has the shape it was waiting for.
- **The scenario editor** (frame 4) is outcome 5 and lands with it.
- **"Used by"** on a block is partial for the same reason frame 3's was after ADR 0016: it explains
  the freezing rule and says scenario usage arrives with scenarios.
- **The evidence a block produces at runtime** is Milestone 5's; this slice authors the declaration,
  not the evaluator.

## Verification

- Domain tests (`test_block_domain.py`) cover the name and parameter-name spellings, unique and
  bounded parameters, the incomplete first draft, the shop-binding classification against the whole
  kind enumeration, the reference-default and optional-default rules, every assessment/evidence
  pairing in both directions, the objective scheduling refusal, both mutation timing rules, the
  timing and duration value shapes including the calendar spans that are refused, every binding
  finding, the deliberate silence on reference resolution, and change summaries that name the type
  axis and each parameter that moved.
- Serialization tests (`test_block_payloads.py`) prove both documents round-trip, are sorted and
  compact, keep an absent default as an explicit null, exclude the derived shop-binding rule,
  preserve parameter order, change their fingerprint for every behaviourally relevant edit including
  reordering and a kind change alone, never let one block type hash like the other for the same
  prose, and report the failing path for a drifted document or an unsupported kind.
- Service tests (`test_blocks.py`) prove a new block starts incomplete, shop-independent, and
  reference-free, the name is unique across a library while the two libraries are separate
  namespaces, a rename onto a taken name is refused, one library never finds the other's block, a
  published version pins no shop and no reference, publishing freezes the template while the draft
  moves on, two publications are independent, the preview reports the gate before a publish can
  refuse it, the index counts the same-shop bindings, and the storage boundary refuses to overwrite a
  published version.
- Contract tests (`test_block_api.py`) prove a block is created with its name only, a non-slug name
  and an unsupported kind are refused by the contract, duplicate parameter names answer the domain
  code, a duplicate block name is a 409, `shop_bound` is derived and cannot be authored, the preview
  and the publish enforce the same gate, a published version stays frozen while the draft moves on,
  the index carries the type axis, and unknown blocks and versions answer their own 404s.
- Frontend tests (`Blocks.test.tsx`) cover both indexes with their type axis and same-shop counts, a
  parameterless template rendered as a design rather than a gap, creation under a derived slug, both
  libraries reachable from the rail while the scenario editor stays inert, the same-shop marker, the
  default field appearing only for a literal kind, the retype that drops a default, the assessment
  that moves the evidence, adding and reordering parameters, publication, and a refused publish of
  unsaved edits. `lib/blocks.ts` has its own unit tests for the classification mirrors, identifier
  derivation, and every parameter edit.
- Two Playwright journeys publish an objective read-check end to end and prove a mutation cannot be
  published until it declares when it fires.

## Consequences

- The scenario slice composes published block versions: it pins each template version alongside the
  ticket version, calls `check_bindings` for the template-decidable half of its gate, and resolves
  `shop_bound_parameters` against its own shop for the rest. It binds by `DefinitionId` and never by
  name — see "The name is a human-facing key" for why that distinction has to survive the slice.
- The evaluation slice (Milestone 5) reads `assessment` and `evidence` to route an objective to the
  deterministic evaluator or the judge, and the runtime reads `MutationEffect` and the bound timing
  to schedule an injection.
- A new parameter kind, evidence kind, or mutation effect is a code change by design: the runtime
  resolves a binding by kind, so a kind that does not exist in the enumeration can never be bound to
  anything.
- `require_identifier` is available to every payload that needs a machine-bound name; the agent
  configuration's prompt variables (Milestone 3) are the next likely caller.
- Existing definition types are untouched: the codec's `references` default, `create`'s optional
  shop, and `_validate`'s fall-through all still apply.
- Local databases keep working; this slice adds no migration and no table.
