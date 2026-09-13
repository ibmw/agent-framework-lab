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

## Verification

- Vitest per create-form page asserts each hint is in the control's accessible description.
- `make check` and `pnpm build` for the frontend change.

## Migration

None.
