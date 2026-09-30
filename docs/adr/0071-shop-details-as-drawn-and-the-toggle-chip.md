# ADR 0071 — Shop details as drawn, the setup checklist, and the toggle chip

Status: accepted — 2026-09-27

The user asked for Shop details in the prototype's organisation (`Workspace.dc.html` :1993-2170):
the *Identity*, *Commerce* and *Channels* cards, the *Setup checklist* panel in place of *Draft
validation*, and the prototype's toggle chips for currencies and channels, reused for every
multi-select of that shape. Two of those reverse or narrow standing decisions — the checklist was
recorded as not built (`docs/design-direction.md`, *Departures*; `docs/PLAN-UX.md`), and the
prototype's locked currency would refuse a write the lab accepts — so the decisions are recorded
here rather than left to the code.

## Context

**What Shop details held.** One *Shop identity* card with Name, Slug, Locale, Currencies and
*Support channels*; the *Logo* card (ADR 0070); *Payment methods*; *Fulfilment methods*; and, in
a 320px column beside them from `xl`, a *Draft validation* card that was `IssueList` over the
saved draft's `preview.issues`, flat: each finding's severity word, the gate's message and its
path, or "No validation findings." The *Tone of voice* page shares the same frame (`SetupPage`)
and so the same card.

**What the prototype draws.** *Identity* holds Name and Slug; *Logo* follows; *Commerce* holds
Locale and Currencies; *Channels* holds one field, *Answers on*. A 312px *Setup checklist* sits
beside a column at most 790px wide, each line a ✓ or a !, a label and a note: a sellable product,
a support identity, a tone of voice default, an FAQ, and "No blocking findings". Currencies and
channels are chips: on is pine with "✓ CODE", off is plain. The prototype's EUR cannot be
unticked once a variant is priced in it.

**The standing refusals.** ADR 0044 refused a *stored* checklist and argued that where a step is
not complete, "the publish gate already computes it … a second set of words for why a shop is
not publishable would be a second gate". ADR 0045 removed the derived progress strip, which read
ten listings to say how far a lab had walked the chain.

## Decision

### The cards are the prototype's, in its order

Identity (Name, Slug), Logo, Commerce (Locale, Currencies), Channels (*Answers on*), then the two
method lists the prototype does not draw on this page and this page still holds. Each card
carries the prototype's line under its title except Identity's: "The slug was fixed at creation
and cannot change" is false here, since ADR 0069 lets the slug change and refuses only a taken
one, so the line says what the two fields are for instead. Every behaviour of the page is kept:
the slug's refusal and held value, the logo card, the pinned header with Save and what it
reports, unsaved-work handling. The tour's first step now lights *Commerce*, which is where the
locale and the currencies it talks about live, and its last lights *Setup checklist*.

### The setup checklist is the gate's findings, grouped

The panel replaces *Draft validation* on both setup pages. It stores nothing and reads nothing
the page did not already read: every line is decided by `preview.issues`, the saved draft's
gate, which the old card rendered flat.

| Line | Gate codes it owns | Note while done |
| --- | --- | --- |
| At least one product | `shop_without_product` | "N products in the draft" |
| A payment method enabled | `shop_without_payment_method` | "N enabled" |
| A fulfilment method | `shop_without_fulfilment_method` | "N offered" |
| A policy | `shop_without_policy` | "N authored" |
| A tone of voice default | `shop_without_tone_of_voice`, `tone_of_voice_without_default` | the default's name |
| An FAQ | `shop_without_faq` (warning) | "N answers authored" |
| Support guidelines | `shop_without_support_guideline` (warning) | "N authored" |
| No blocking findings | every other code: a product's or a variant's, and any code the gate grows | a tally, or "Nothing else in the draft is refused." |

A line is done when the gate raises none of its codes; the last is done while none of its
findings is an error. A line still to do carries its findings through `IssueList`, so each keeps
its severity word, the gate's message and its path — nothing the flat card said is lost — and
the last groups them by product with an *Open* to the product editor, as the overview does; a
product the draft on screen no longer holds keeps every finding and loses only its *Open*. The
notes are counted off the draft on screen; while that has unsaved edits a line under the
panel's title says it reads the saved draft.

This is ADR 0044's own argument taken at its word: the gate is the readiness engine, and this is
it read with labels over it, in its own words. It is not ADR 0045's strip: it reads one
definition's gate, on the page that edits that definition. The prototype's *A support identity*
line is **not built**, because identities are a lab listing and counting them here is exactly the
cross-listing progress reading ADR 0045 removed.

Beside the cards from `xl`, 312px, top-aligned; below that it follows the cards, which is where
the prototype's wrapping row puts it.

### One toggle-chip multi-select, on native checkboxes

`ToggleChipGroup` draws a small closed set of toggles. Each chip is a **native checkbox**,
transparent and laid over the chip it sits in, and the label is the chip: announced as checked
or not, toggled by Space, one tab stop per chip, and found by `getByRole("checkbox", { name })`
as every existing test and journey already found these sets. Enter on a chip does nothing: a
native checkbox is toggled by Space, not Enter, and Enter in one is the browser's implicit
submission, so the chip holds it as `ChipListField` already holds Enter, and it never submits
the form around it. `aria-pressed` buttons would carry the state with none of the form
semantics; they stay with filters and with the scenario's compose chips, whose press starts a
read. The group is `FieldGroupHint`'s fieldset, in either arrangement.

- `keepOne`: the last chip on is natively `disabled` (ADR 0063 keeps native controls `disabled`)
  and titled with the rule, which the group's hint also states.
- `disabledReason`: a chip that cannot change for a reason of its own is disabled, titled, and
  described by a muted line under the chips that says it.
- `findings`: a publish-gate error a chip's state causes marks that chip `aria-invalid` and is
  said in `GateFindingLine`, polite and mounted while empty, refusing nothing.
- `spoken`: a chip shows the code the prototype draws and is named more fully — `EUR` is
  "EUR — Euro" — through the input's `aria-label`, which starts with what is shown.

### A currency a variant is priced in is not locked

The prototype locks it. The lab does not refuse the write: the draft saves, and the gate raises
`variant_currency_unsupported` on each such variant. ADR 0063's amendment says a publish-gate
error is said on its control and refuses no write, so unticking such a currency is allowed and
its chip says, in the gate's sentence, which variants it leaves unsold
(`unsoldCurrencyFindings`, pinned to `domain/shop.py` in `fieldRules.test.ts`).

### A new shop is asked which channels it answers on

The prototype fixes a new shop at chat. The create request carries `channels`, so the create
page asks, with the same group, on chat until the operator chooses otherwise.

### Which multi-selects are this pattern

Built on `ToggleChipGroup`: the currencies on the create page and Shop details (`CurrencyField`),
the channels on both, and the bench's *Deliver to*, whose completed arm is a chip disabled with
its reason. Left as they are, each for a reason the pattern does not carry:

- a support identity's permissions and a judge's evidence scopes — each option carries an
  explanation an operator needs to choose right;
- an agent configuration's tool bindings, a scenario's context documents, a ticket's linked
  orders — each row carries metadata (effect, permission, readers and a cap, totals and
  statuses);
- a ticket's suggested documents — the shop's documents, an open-ended list with a kind beside
  each title;
- the scenario create page's compose chips — the library is open-ended and a press reads the
  template before it counts as pressed, so it is an `aria-pressed` action with a busy state;
- single booleans (a payment method's *enabled*, the rail and delete preferences, a block
  parameter's *required*, marketing opt-in), and single choices and filters (`FilterChips`, the
  timeline's lenses, the traces' attempts, the author toggle, the snapshot inspector).

## Consequences

- Accessible names: the region *Shop identity* on Shop details is *Identity*; the group *Support
  channels* is *Answers on*; every checkbox keeps its name. The tour anchors
  `[aria-label="Shop identity"]` and `[aria-label="Draft validation"]` become
  `[aria-label="Commerce"]` and `[aria-label="Setup checklist"]`; `tour-anchors.spec.ts` sweeps
  them.
- `docs/design-direction.md` drops the *Setup checklist — not built* departure, adds the chip and
  the checklist to the form language, and narrows *Nothing about progress is stored and no surface
  reads it* by this one reading.

## Verification

- `ToggleChipGroup.test.tsx`: one named fieldset of native checkboxes in both arrangements; the
  prototype's two looks; order kept; Tab and Space; `keepOne`; `disabledReason`; `findings`
  marked, described and polite; the finding line mounted while empty; the fuller name.
- `lib/setupChecklist.test.ts` reads the gate's codes out of `domain/shop.py`, holds every
  shop-wide code to exactly one line and every product code to the last, and puts each finding,
  whole, under exactly one line.
- `App.test.tsx`: the cards in order and each field in its card; the checklist's lines and
  glyphs; every finding of a five-finding gate on the panel with its severity and path; both
  findings of a product the draft on screen no longer holds, here and on the overview
  (`ShopHome.test.tsx`), which `IssueList` used to cut to the first; the saved-draft line under
  the title, before the first line; the checklist on Tone of voice; channels saved and the last
  one held; an unsold currency said on its chip and saved.
- `Shops.test.tsx`: a new shop created on the channels chosen. `Experiments.test.tsx`: a
  completed arm's chip says why.
