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
