# ADR 0063 — A refused action stays reachable and says why

Status: accepted — 2026-09-26

Settles the question `docs/PLAN-UX.md` Slice 22 leaves open and `docs/design-direction.md` defers
to it twice (*A blocked primary action says why*; the *Save connection* row of *Departures from
the handoff, in force*): whether the dashed blocked weight is a natively `disabled` button or an
`aria-disabled` one, decided once for every primary action that can be refused rather than for
the create pages ahead of the rest — nine route files, `BlockLibraryPage` serving both block
libraries, so ten surfaces. The weight itself was minted with those pages in PLAN-UX
Slice 12 (`lib/ui.ts`, `blockedButtonClasses`) without an ADR; this is its first record.

Records six decisions: a primary action refused for a reason is `aria-disabled`, never
`disabled`; the button swallows its own activation, so no press, key or implicit submission gets
through; a press already in flight is not a refusal and keeps native `disabled`; one component
draws the weight, the reason and the guard, and the surface keeps the line; the reason line
and the validation message are one weight; and which actions are primary here.

## Context

A blocked primary action has been drawn two ways on `main`. The create pages (`CreatePage`) wear
the dashed weight, natively `disabled`, with the reason in `title` and in a 13px 600 `#9d3028`
line the button's `aria-describedby` names. Everywhere else — Publish on seven editors and the
overview, Start, *Save connection*, *Fork this run*, *Save and leave*, *Add tone of voice* — the
button keeps its own weight, natively `disabled`, and the reason is a muted line, a
`PublishReasons` block the button does not name, or nothing: *Attach to this shop*, *Add
parameter* and the bench's *Send as the customer* are disabled with their reason nowhere.

Native `disabled` costs four things, each already worked around in the code:

- **The control leaves the tab order.** A keyboard reader never lands on it, so the
  `aria-describedby` that carries the reason is announced to nobody who tabs; it is found only by
  a screen reader's virtual cursor. The plan says so in as many words.
- **`title` is unreliable on it.** A disabled button fires no mouse events in several engines,
  so the tooltip that is half the rule does not show (`ExperimentHistoryPage.tsx`, the Fork
  comment: "a browser does not reliably show a `title` on a disabled control").
- **Focus is dropped when a focused control becomes disabled** (the HTML focus fixup rule).
  `ScenariosPage.tsx`'s compose chips are "busy, never disabled" for exactly this reason, and
  `ShopHomePage.tsx` keeps a ref to put focus back after each publish press.
- **Nothing in the weight can take focus**, so `blockedButtonClasses` carries no ring and
  `ui.test.ts` asserts it carries none — correct for a control that can never be focused, and
  the reason a reachable one needs a decision rather than a class swap.

The prototype draws the blocked weight as a `div` with a `title` (`Workspace.dc.html` :1965,
:2933, :3987) — no element, no role, no focus — so it is silent on the question; the README says
"a dashed disabled variant with the reason in `title` and, where it matters, spelled out inline",
which describes the look and not the attribute.

## Decision

### A primary action refused for a reason is `aria-disabled`, never `disabled`

Every primary action — a button at the accent or ink weight, or the one submit of a form — that
the page refuses to run for a reason it can state renders `aria-disabled="true"` and stays in the
tab order. On focus a screen reader announces its name, "dimmed" or "unavailable", and its
description, which holds the reason; a pointer reader gets the `title` on hover; a sighted reader
reads the line. A control that becomes blocked while focused keeps focus.

`disabled` is refused for this state because it hides the one control the reason belongs to from
the readers most likely to need the reason spelled out, and because every workaround above would
have to be repeated on every adopter.

### The button swallows its own activation

An `aria-disabled` button is still a button: a click, Enter, Space, and a form's implicit
submission all reach it. The primitive therefore handles `click` itself while blocked — it calls
`preventDefault()` and does not call the caller's handler. That one listener covers all four
routes, because Enter and Space on a focused button dispatch `click`, a submit button's
activation is cancelled by `preventDefault()`, and implicit submission from a text field is
specified as a synthetic `click` on the form's default button — including a submit that sits
outside its form under `form=`, as `CreatePage`'s does.

Every **submit** handler keeps a check of its own for the same refusal, because a submission can
reach a form without the click — `form.requestSubmit(button)` does — and because a handler that
trusts its button leaves the page one refactor from losing work: `start` refuses an unnamed
experiment and an unreachable arm, the bench's `send` an empty message and a turn with no arm left
to take it, `attach` an unchosen profile, a saved row's form a refused Save, `ParameterForm` a
template at its cap, and the tag, note and thread forms an empty entry — the thread also a cleared
time. Each is proven by a test that submits without pressing and writes nothing, and fails when
its check is deleted.

A `type="button"` action has no route to its handler but the click, so it relies on the swallow
alone: *Save connection* and *Test connection*, Publish (`PublishButton`), the variant row's Save
(`EntryEditButtons` outside a form, whose `onSave` is the click), *Fork this run* and *Save and
leave*. The last two keep a handler check anyway — without it a press on *Save and leave* would
leave and drop an open row's typing — and neither check has a test of its own: nothing but the
swallowed click reaches them.
The lab refuses what the page misses. The guard is what stops the press; those are what stop a submission that arrives
some other way.

### A press in flight is not a refusal

*Saving…*, *Publishing…*, *Creating…*, *Starting…* and the rest keep native `disabled` and the
button table's `disabled:opacity-55`. They have no reason to state, they end on their own, and
Slice 24 (*ActionStatus*) owns how a running action reports itself. So does a gate that has not
answered yet: Publish while the preview is loading is in flight, not refused, and is drawn so until
Slice 24 writes "Checking the draft…". **Busy wins**: a refusal can arrive while a press is in
flight — the name cleared during *Creating…*, an edit during *Publishing…* — and until the press
ends the button stays natively disabled under its busy label, with no dashed weight and no reason;
once it ends, the refusal takes over.

### One component draws the weight, the reason and the guard; the surface keeps the line

`components/PrimaryAction.tsx` exports `PrimaryAction`, a `<button>` with:

- `variant: "accent" | "ink" | "outline"` — the weight it wears when it can proceed, read off
  `buttonVariantClasses`;
- `refusal?: { id: string; reason: string }` — the shape `entryEdit`'s `saveRefusal` already has.
  Present, the button wears `blockedButtonClasses`, `aria-disabled="true"`, `title={reason}`, and
  `aria-describedby` with `id` merged ahead of any the caller passes, and swallows its click;
- `busy?: boolean` — native `disabled` for a press in flight;
- the rest of a button's attributes (`type`, `form`, `onClick`, `aria-label`, `ref`, `children`).

The line the `id` names is the surface's to place, because where the reason reads best differs:
under the create header, under Start in its card, above the connection form, beside a row's Save.
`RefusalLine` (same file) is that line — `<p id>` at the validation weight — for a surface that has
one sentence; Publish names the `PublishReasons` block it already renders, which gains an `id`.

`blockedButtonClasses` gains `focusRingClasses` and still no hover, and `ui.test.ts`'s "claims no
state it can never show" becomes "shows a focus ring and no hover": the control can now be
focused, and a hover would suggest a press that does nothing.

### The reason line and the validation message are one weight

`validationMessageClasses` in `lib/ui.ts` is the handoff's validation message — 13px, 600,
`#9d3028` (`lab-error`). `RefusalLine` wears it, `CreatePage`'s reason already does, and a `Field`
or `FieldGroup` row's second line wears it at `extraTone="error"` (it does today); the stacked
`FieldHint` arrangement's error line moves from 12px 400 to the same weight, so a refusal reads
the same whichever arrangement drew it. A `Field` whose second line is an error also marks its
control `aria-invalid`. The muted reason lines on Start, *Save connection*, *Save and leave* and
the guideline editor move to it, which retires the two departure rows that were holding them.

### Which actions this is

A primary action is one at the accent or ink weight, or the one submit of a form. "Compose", as
`docs/PLAN-UX.md` Slice 22 named it, is the bench's *Send as the customer* in the Customer
composer card. A saved row's Save (`EntryEditButtons`) is primary: it is the accent action of
the row's own form, so `entryEdit`'s verdict is `true | { id, reason }` and never a bare
`false`. Secondary buttons are not, and keep their weights and native `disabled` (below).

The adopters are `CreatePage` (ten surfaces), `PublishButton` on the seven definition editors
and both of the overview's publish buttons, Start, *Save connection* and *Test connection* — the
connection form's two actions, refused by one line — *Send as the customer*, *Attach to this
shop*, *Fork this run*, *Save and leave*, *Add tone of voice*, *Add parameter*, *Add option*, and
every row Save: the guideline, the product option, the media entry, the variant. *Add tag* and
*Add note* on a run's results and *Add to thread* on a ticket are the one submit of their forms,
so they are adopters too — *Add tag* moves from the subtle weight to the outline *Add note*
wears, since the blocked weight takes a primary's shape. *Add to thread* says its reason beside
the button rather than on a field, because neither field can: an empty message box and a cleared
time are both states those controls legitimately hold. A row whose
refusal is already said on a field — a media reference another entry holds — names that field's
line (`Field`'s `extraId`) rather than writing the sentence twice.

## Deliberately not here

- **Secondary controls refused for a reason** — Replay in the results header, the History row's
  *Replay recorded versions* and *Fork with newer versions*, an entry's Edit while another row is
  open. They keep their own weights and native `disabled` with the reason they already describe;
  whether they follow this rule is a decision about the button table's secondary rows, not the
  blocked weight.
- **Native form controls** — a checkbox, a radio, a select, an option — keep `disabled`.
  `aria-disabled` on an input would also have to suppress `change`, and none of them is an action.
  The guideline's default radio keeps its description.
- **An add form's submit refused only by its own field**: a derived identifier that is empty or a
  field left blank (native `required`, which the browser says on the field) or taken
  (`DerivedIdField`, which says so on the field, audibly, and marks it invalid). *Add fulfilment
  method*, *Add variant*, *Add payment method*, the order's *Add line*, the identity's *Add
  guidance* and the profile's *Add address*, *Add entry* and *Add fact* submit, and their handler
  returns or the browser stops them; the field is the control that is wrong, and it already says
  why. *Attach to this shop* was named by the plan and is an adopter all the same. An
  add form refused for a reason no field states — *Add option* with no value — is an adopter,
  and so is one refused by a relation between two fields (the amendment below).
- **The destructive confirm** (`ConfirmRemove`'s *Remove it* while a read is in flight) is a press
  in flight.
- **Losing focus when a press in flight disables its button** is Slice 24's to settle with the
  status it adds.
- **Refusals said after the press**: *Materialize snapshot* and *Clone sandbox* refuse a cleared
  seed or label with an alert when pressed. They say why, which is the rule this ADR enforces
  rather than the weight; drawing them refused beforehand is a change for the slice that next
  touches that page.

## Consequences

- `docs/design-direction.md`, *A blocked primary action says why*, reads "dashed,
  `aria-disabled` and reachable, the reason in `title` and inline in its accessible description";
  "The ten create pages wear it and nothing else does" and the interim paragraph go; the
  *Save connection* departure row and the "Start, Replay and Fork keep their weights until Slice
  22" clause of the Provider row are removed or narrowed to what stays.
- Every adopter above renders through `PrimaryAction`; three that used to go quiet now say why:
  *Attach to this shop* ("Choose the profile to attach." / "Every profile in the lab is already
  attached to this shop."), *Add parameter* at the cap, and *Send as the customer* once every arm
  has completed. *Fork this run* with nothing moved says so beside it rather than only in the
  panel's introduction.
- `@testing-library/jest-dom`'s `toBeDisabled` reads the `disabled` attribute only, so every page
  test asserting a blocked primary is rewritten against one helper in `src/test/`:
  `expectRefused(button, reason)` — `aria-disabled="true"`, the `title`, the reason in the
  accessible description, and focusable. Playwright 1.62's `toBeDisabled` and its click
  actionability both honour `aria-disabled` (`getAriaDisabled`), so the e2e assertions on Publish,
  Review and *Fork this run* stand unchanged.

## Verification

- `ui.test.ts`: the blocked weight keeps the accent's shape, is dashed and quiet, has a focus ring
  and no hover, and is not a row of the button table; `validationMessageClasses` is 13px, 600 and
  `lab-error`.
- `test/refused.ts`: `expectRefused` reads the reason off the elements `aria-describedby` names,
  each of which must exist, and not off the computed description, which falls back to `title`
  when the ids resolve to nothing; and the refusal's own line — the first id — must hold the
  reason and be drawn (no `hidden`, `display: none` or `visibility: hidden` on it or an
  ancestor). Renaming `RefusalLine`'s id fails 49 tests, `PublishReasons`' 14, and a
  `RefusalLine` rendered `hidden` 49. `submitWithoutPressing` calls `form.requestSubmit(button)`
  for the submit handlers' checks; *Attach to this shop*'s select is natively `required`, which
  stops `requestSubmit` first, so its handler is reached with a `submit` event on the form.
- `PrimaryAction.test.tsx`: refused, it is in the tab order, named, described by the reason and
  titled with it; a click, Enter and Space call no handler, and submit no form it is nested in or
  names with `form=` — including implicit submission, which jsdom does not perform, so the test
  finds the form's default button as the HTML standard does, asserts it is the refused one, and
  clicks it; it keeps focus when it becomes refused; busy, it is natively disabled and says
  nothing, and busy wins over a refusal until the press ends. Removing the click guard fails the three activation tests.
- `FieldHint.test.tsx`: an error line is 13px 600 `lab-error` in both arrangements and marks the
  control `aria-invalid`; a preview does neither.
- `WorkspaceChrome.test.tsx`: `PublishButton` refuses unsaved edits, the gate's errors and an
  unchanged draft, each with its sentence, and is a press in flight while publishing and while
  the gate has not answered.
- One `expectRefused` (`src/test/refused.ts`) per adopter in its page's suite — `aria-disabled`,
  no `disabled`, the reason in `title` and in the description, focusable and focused — and, on
  most, a press, Enter or Space that writes nothing.
- `pnpm test:e2e`, whose `toBeDisabled` on Publish, Review, Create and *Fork this run* reads
  `aria-disabled` unchanged.

## Migration

None. No contract, payload, route or stored value changes; accessible names are unchanged.

## Amendment — 2026-09-27: the shop draft's rules

PLAN-UX Slice 22b says four of the lab's shop-draft rules while the operator types. They are
recorded here rather than in an ADR of their own because three of them are this ADR's rule
applied, and the one exclusion they move is this ADR's.

- **A refusal between two fields refuses the add form's submit.** `FulfilmentMethod` refuses a
  maximum transit shorter than the minimum with `422 shop_configuration_error`. Neither field
  is invalid alone and no native constraint stops the submit, so this is not *refused only by its
  own field*: *Add fulfilment method* becomes an adopter, and the open row's Save refuses through
  `entryEdit`'s verdict. The sentence is said once, under **Max days** — the bound the lab's
  message makes its subject, and the one typed second — at the validation weight, in its
  description, with Max days `aria-invalid` and Min days not; Add and Save name that line
  through `FieldHint`'s `extraId`, as the media row already does. Equal bounds are the lab's and
  are not refused. `FieldHint` takes no `hint` where a stacked field has only a refusal to say,
  so both forms keep their stacked fields.
- **A publish-gate error is said on its control and refuses no write.** `variant_without_price`,
  `variant_in_stock_without_inventory` and `product_without_variant` are gate errors on a draft
  the lab stores, for every product status. The variant's row says the first under its price and
  the second under its stock — the availability select is described by the same line, since
  either control clears it — at the validation weight, with the control `aria-invalid`, and the
  Variants card's empty table says the third. None refuses the row's Save or *Save draft*, since
  the lab does not. The line is polite and stays mounted while empty, as `FieldHint`'s warning
  line does, because nothing has been refused; each sentence is the gate's, character for
  character, so the validation card repeats it in the same words once the draft is saved. The
  gate raises the price finding per variant, so the card says it per variant and never "no
  priced variant", which would pass a product the gate refuses.
- **A status carries the time the lab ties to it.** A payment status moving to Paid fills an
  empty `paid_at` from `placed_at`, which the gate otherwise refuses as
  `paid_order_without_capture_time`, and moving to Pending or Authorized clears it, which the
  lab otherwise refuses. A fulfilment status moving off Unfulfilled fills an empty `shipped_at`
  the same way, and moving back clears it. A time already there, typed or saved, is never
  overwritten; a move that neither enters nor leaves those states touches nothing; an empty or
  unreadable `placed_at` fills nothing. `PAID_AT_RULE` and `SHIPPED_AT_RULE` say so.

Verification: `App.test.tsx` *the shop draft's refusals, said under their controls* (the
slice's evidence — a minimum of 5 and a maximum of 3 read why under Max days, and Add is refused
for it); `Orders.test.tsx` *a status moves the time beside it*; `orders.test.ts` lists all 16
payment moves and all 9 fulfilment moves and holds each rule's sentence to the statuses it
names; `fieldRules.test.ts` reads the four sentences out of `domain/shop.py`, and
`test_shop_domain.py` asserts them from the Python side, for every product status and every
maximum around the minimum.

## Amendment — 2026-09-27: the lab's rules

The last of what the September plan listed: the scenario's caps, the block parameter's
default, the judge's rubric and the bench's Start, each said before the press rather than
after it. Recorded here for the reason the shop amendment above gave — each is this ADR's rule
applied, or the shop amendment's.

- **A cap is counted on its card, and refused at it in the lab's sentence.** `ScenarioPayload`
  refuses a draft over `MAX_CONTEXT_DOCUMENTS`, `MAX_SCENARIO_OBJECTIVES` or
  `MAX_SCENARIO_MUTATIONS` with `422`. Each card's title reads its own "N of 12", "N of 24" or
  "N of 8" (`CappedTitle`), counted from the draft on screen, so it moves with every add and
  removal; the card keeps its bare title as its name. At the cap the editor's *Add* — the one
  submit of the picker's form — is an adopter, refused with the lab's own sentence ("a scenario
  composes at most 24 objectives") under the picker; its handler checks the cap too. An unchosen
  template is its own field's to say, so the select is natively `required` and Add is not
  refused for it. A context document's checkbox and the new-scenario page's compose chips are a
  native control and a secondary one: they keep native `disabled` at the cap, with the sentence
  in `title` and in a muted line their description names. The two workspace sentences the create
  page wrote give way to the lab's, so one cap reads one way everywhere.
- **A publish-gate error is said on its control and refuses no write** — the shop amendment's
  rule, on two more editors. `optional_parameter_without_default` is said under the parameter's
  *A scenario must bind this*, which it marks `aria-invalid`, and describes the default beside
  it, since either clears it. `rubric_empty` is said under an exactly empty rubric, and
  `rubric_names_an_arm` once for every reserved term the rubric names, in the order the catalog
  serves them; the rubric is `aria-required` and marked invalid while either holds. Neither
  refuses *Save draft*. The line is `GateFindingLine`, which moves out of the product editor to
  be shared, polite and mounted while empty. The terms are the served `reserved_terms`, never a
  list of the page's. Which of them a rubric names is `lib/rubric.ts`, a mirror of `_mentions`
  built from an enumeration rather than by analogy: Python's `[\w-]` is `[\p{L}\p{N}_-]` at
  every code point Python assigns, and is read on the neighbours without case folding, because
  a JavaScript `i` flag folds a class too and would count U+0345 as a letter; `re.IGNORECASE`
  is JavaScript's simple case folding at every cased code point but `İ` and `ı`, which Python
  also holds to be `i`, so a term's `i` is written as that class. Where the two Unicode
  databases differ is only at code points Python has not assigned. The tables are Python 3.12's
  (Unicode 15). The repository pins no Python, so they are held to the backend only on a Python
  whose database is the fixture's `unicode_version`, and skipped elsewhere with both versions
  named. The 55 rubric rows answer alike on Unicode 15 and 16 and run on every Python. When the
  Unicode version the lab runs on moves, the fixture is regenerated on that Python, and the web
  suite re-proves the mirror against the new tables.
- **Start lists what it waits for, all of it.** Start is refused until it can work, and its
  reason is a list, one line per cause, in the order the form asks — since ADR 0064 a scenario,
  then a published version of it; one arm with a configuration and a version, and each arm's
  missing version by its letter; a name that is not empty once trimmed; a seed, then one inside
  0..`MAX_SCENARIO_SEED`; every **error** the setup gate raises,
  in its words; the preview's own refusal of the setup (a `4xx`, which the start would answer
  identically); and the provider this lab cannot reach. The request's conditions are said in
  the page's words, because the lab's there are the contract's generic validation messages or
  name padding the page never sends; the gate's are its own. The name field stops at
  `MAX_LABEL_LENGTH`. A gate that has not answered for the setup on screen is a press in flight
  when nothing else refuses Start, and adds its errors when it answers; a preview that could not
  be reached refuses nothing. So is a chosen arm whose provider has not been read, and a lab
  that has not yet said which providers it reaches: "not read" is not "reachable". A read that
  fails says nothing and holds nothing up. A seed the contract would refuse is not sent to the preview, which
  never reads it and would refuse the whole request for it. `start` checks every reason itself.
  Not listed, because nothing before the press can know it: `materialize`'s own gate, re-run
  against the orders as they read at the start (ADR 0019); a start it refuses still answers with
  its findings under the form.

Verification: `Experiments.test.tsx` *is dashed until it can work, and says everything it still
waits for* (the slice's evidence — from nothing chosen and an out-of-range seed, the list goes
from four causes to three, two, one, the gate's error, and none, and Start is free only then);
`experimentStart.test.ts` enumerates all 648 combinations of the seven causes; `Scenarios.test.tsx`
*the scenario's caps, each read on its own card*; `Blocks.test.tsx` and
`JudgeConfigurations.test.tsx` for the two gate findings and the Save each still allows;
`rubric.test.ts` holds `lib/rubric.ts` to `apps/api/tests/fixtures/rubric_mentions.json` — the
gate's own answers for 55 rubrics, Python's `[\w-]` over every assigned code point and its
case classes over every cased one — which `test_rubric_mentions.py` writes and holds to the
backend; `fieldRules.test.ts` reads the six sentences and the three caps out of the Python, and
`test_scenario_domain.py`, `test_block_domain.py` and `test_judge_domain.py` assert them from
the other end.
