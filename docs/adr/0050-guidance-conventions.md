# ADR 0050 — Guidance conventions live under the field, written in design-direction

Status: accepted — 2026-09-13

Records Slice 1's guidance, required-field, and placeholder convention. The words of that
convention live in `docs/design-direction.md` under *Revision — field hints and the
required-field convention (2026-09-13)*. This ADR exists because PLAN-UX requires a slice that
records a convention to write one. It points at that section rather than restating it.

## Context

PLAN-UX Slice 1 told create forms to carry their own guidance, and named
`docs/design-direction.md` as the place the convention is written once. PLAN-UX also says:
where a slice records a decision of its own — a convention, a router migration, a confirm
policy — it writes an ADR.

Those two instructions agree only if the ADR names the section rather than becoming a second
copy of it.

## Decision

The convention is the design-direction revision named above. `FieldHint` is the primitive that
carries a field's rule. The create forms Slice 1 names apply it.

This ADR records that those words are the decision. It does not add a second wording.

## Deliberately not here

- **A second copy of the convention.** The section this ADR points at is the wording.
- **Later slices' primitives.** DerivedIdField, chips, confirms, and the router migration write
  their own records when PLAN-UX names them.

## Consequences

A later slice that needs the same convention reads the design-direction section, not this ADR's
prose. A later slice that changes the convention amends that section and notes the amendment
here.

## Amendment — 2026-09-13

Slice 2 added a sibling section in `docs/design-direction.md` (*Revision — derived identifiers
(2026-09-13)*). The field-hints section this ADR points at is unchanged.

## Verification

- Vitest per create-form page asserts each hint is in the control's accessible description.
- `make check` and `pnpm build` for the frontend change.

## Migration

None.

## Amendment — 2026-09-14

Slice 3 added a third sibling section in `docs/design-direction.md` (*Revision — enum labels
and the status pill (2026-09-14)*): where a label table lives, how each is keyed to the
contract union, the rule that an explanation may only say what the lab enforces, when an
option carries one at all, and the glyph-with-label rule for status. That section also lists
the tables that pre-date the slice and still sit outside the shared module, so the convention
records what is true rather than an end state. The two sections this ADR already points at are
unchanged.

## Amendment — 2026-09-14 (Slice 4)

Slice 4 added a fourth sibling section in `docs/design-direction.md` (*Revision — currencies on
the create form, and what a group's hint says (2026-09-14)*): that a rule belonging to a set of
controls is tied to the group by `FieldGroupHint` rather than to one box, that a hint naming
something the group derives is paired with a live line showing what it currently is, that a
suggestion is handed back only where the control can express "unanswered", and what a create
form asks before it names the page holding the rest. The three sections this ADR already
points at are unchanged.

## Amendment — 2026-09-14 (Slice 5)

Slice 5 added a fifth sibling section in `docs/design-direction.md` (*Revision — chips, a
country, and what a number field says (2026-09-14)*): that a list entered one value at a time
is one control with its rule on the field that takes the next value, that a remove button is
named after what it removes, that duplicate refusal belongs to the primitive because the domain
requires uniqueness on every list it serves, that respelling is a caller's function previewed
on the paired-line convention, why a country register is not a `lib/enumLabels.ts` table, what
a number field's pattern and hint are both taken from, that a pattern is not a refusal so a
value the form cannot carry must not reach a save, and why a five-value rating is a radio group
with no empty state, which lists the primitive owns and which the results page keeps, that a
respelling must reach the shape the gate wants rather than most of the way to it, that a saved
row shows the chips it was entered with, and that a rule shared by a table's rows lives once
and is reached by `aria-describedby`. The four sections this ADR already points at are
unchanged.

## Amendment — 2026-09-14 (Slice 6)

Slice 6 added a sixth sibling section in `docs/design-direction.md` (*Revision — closed sets the
lab already knows (2026-09-14)*): that frame 5 draws the provider and the model as controls and
the provider under a human label, that where a set comes from decides the control and the
deciding fact is the publish gate's severity, that a select offers whatever the payload carries
so it cannot misreport the draft, that a provider is spelled once for the workspace in
`lib/agents.ts` and why that table cannot live in the enum registry, the reset-or-flag rule — the
provider resets when it leaves its proven set, the model follows the provider and is otherwise
flagged — that makes the judge editor's mandated reset and the agent editor's behaviour one rule,
that a field may not claim a severity its gate did not give (`FieldHint` gained a `warning` tone
in `admin-draft-ink`), that a copied gate sentence is copied character for character and pinned
from both ends until a preview can accept a draft payload, that a picker of what a run will
resolve reads published versions, how a tool argument is labelled and typed from the contract
that declares it, that a kind with no HTML type takes none, and that a choice of one is not a
choice. The five sections this ADR already points at are unchanged.

**No ADR of its own for the contract change.** The slice ships one additive field —
`PreviewShopOptionSchema.tone_of_voice_guidelines` — and that is deliberately recorded in the
design-direction section rather than in an ADR. The repo's ADRs are scoped to decisions about
what the product *is*: ADR 0012 decided that tone of voice is shop-level, ADR 0024 decided what a
preview resolution reads. This field publishes no new domain fact, versions no route, needs no
migration, and takes its one policy question — which version's guidelines a picker offers — from
a rule already recorded: resolution reads published versions, never drafts. An ADR here would be
a second copy of ADR 0024's sentence, which is the failure mode this ADR was written to avoid.
