# ADR 0078 — A refusal on an untouched form is a hint

Status: accepted — 2026-10-25; amended 2026-10-27

Amends ADR 0063, *The reason line and the validation message are one weight*. Every other
decision of ADR 0063 stands: a refused action is `aria-disabled`, reachable and titled with its
reason, swallows its own activation, and every submit handler still checks the refusal itself.

The 27 October amendment also amends ADR 0072 and ADR 0074 where they say a blank form below a
list marks no field "until something is typed": it marks none until it is touched, which a
press with nothing typed also does (*What touched means*).

## Context

ADR 0063 drew a refused action's reason at the validation weight — 13px, 600, `#9d3028` — from
the first frame. On the seeded run's results page, opened and not touched, that is three red
sentences: the Fork panel's "Change at least one arm: a fork that changes nothing is a
replay.", the tag form's "Type the tag to file this run under." and the note form's "Write the
note before adding it." None of them reports anything the operator did. The same is true of
Start's list on a setup the lab opened for them, of an editor's "identical to vN" beside a
Publish nobody pressed, and of every add form below a list, whose empty fields refuse their
submit before anyone has typed.

The operator decided on 22 October 2026 that such a refusal is muted until the form is touched
(PLAN-UX Milestone 12), and on 25 October 2026 that the rule holds for every refusal line in the
workspace, with no page-by-page exception. On 27 October 2026 they decided that a field's
`aria-invalid` follows the same touch as the line that names its refusal (PLAN-UX Milestone 13).

## Decision

### The line's weight follows the attempt, and on the action nothing else moves

A refused action's own line is drawn at the README's **hint** — 13px, 400, `#42474c`
(`refusalHintClasses` in `lib/ui.ts`, which sets `font-normal` rather than inheriting a
parent's weight; *The form pattern*: "hint: 13px/1.5; #42474c") — while
its form is untouched, and at the **validation message** (`validationMessageClasses`) once the
operator has touched it. `refusalLineClasses(touched)` is that choice, and the only place it is
made. The README's 1.5 leading is not set: the line inherits its parent's, as the validation
message does, so it keeps its height when it turns and nothing below it moves.

On the action, only the weight moves. The words are the same sentence, so the line still is the
reason, and colour is not what makes it read as one. The button keeps its dashed weight, `aria-disabled`,
`title` and `aria-describedby`; the line keeps its id. A screen reader hears the same
description either way, and a keyboard reader who lands on the refused action is told the same
thing as before.

`#42474c` (`admin-ink-soft`) rather than `admin-muted`: it is the hint the README specifies for
the form pattern, and it holds WCAG 2.2 AA for 13px text on every ground a refusal is drawn on —
9.4:1 on the card (`#ffffff`), 9.2:1 on the lab's paper, 8.7:1 on the admin canvas, 8.3:1 on the
lab canvas (`#f4f1e8`) and 7.8:1 on its darker end (`#eeeade`). `admin-muted` (`#6d7175`) falls
to 4.36:1 on the lab canvas, under AA.

### What touched means

**Touched is a property of the form, not of the refusal's cause.** A form is touched once the
operator has:

- **edited it** — a field in it changed, or a control in it was pressed (a chip, an author
  toggle, *Keep the current key*). A click that only places the caret in a field edits nothing.
- **pressed the refused action** — a click, Enter or Space on it, or Enter in one of its fields,
  which a browser performs as a click on the form's default button. ADR 0063 makes the button
  swallow that press; it is the one press that does nothing, and the one that most needs the
  reason said firmly.

A form is untouched again when a new attempt starts: an accepted submit that empties it (a tag,
a note, a thread message, a clone, an add below a list, a template added to a scenario, a
parameter), an entry of a list opened or put back, the attach panel opened, a publish that was
taken. The refusal that follows an accepted press — the cap an add has just reached, "identical
to vN" after a publish — reports no mistake, so it is a hint.

A submission that reaches a form without a press (`form.requestSubmit`) touches nothing: the
handler refuses it, as ADR 0063 requires, and no operator made it.

**The field a refusal names is invalid exactly while its line is the validation message.** A
control the refused action's line names — the field a form below a list marks, the ID or values
field, the image picker, the open variant row's SKU — carries `aria-invalid`, and is described
by that line, only once its form is touched. On an untouched form the line is a hint and the
field says nothing invalid, so a screen reader is never told a field is wrong while the screen
draws its reason as guidance. It is the same touch, not a second one: a press with nothing
typed turns the line and marks the field together, and an edit undone leaves both as they
turned. A line whose words are a rule the field is already described by — the variant
row's misshapen SKU, whose line is the rename rule — is not added to its description a second
time; the field is still marked.

A refusal the field finds in its own value and says on its own line — an ID or a value another
entry already holds, a value past its cap, a handle the lab would not store, a fee that is not
an amount — is not the action's line, and says `aria-invalid` from the keystroke that causes it,
touched or not. So does a publish-gate finding on its control, which refuses nothing.

### A refusal whose cause the operator cannot edit

The bench's "Every arm has completed, so there is no arm left to send a turn to." has no field
that could clear it. The plan's rule read on its cause would leave it muted until pressed; read
on its form — the reading this ADR takes — it also turns when the operator types a message or
ticks an arm. That is deliberate: an operator composing a turn that cannot be sent is the reader
the reason is for, and telling them only after they press would be the late refusal ADR 0063
removed. One definition, the form's, serves every adopter; no refusal is classified by whether
its cause is editable. Opened and left alone, the composer's reason is a hint.

### Touched from the first frame: the unsaved-changes prompt

*Save and leave* is refused while an open row's typing is outside every draft. The prompt opens
only because the operator edited that work and tried to leave it, so its form — the work it
would save — is touched by construction, and the line is drawn at the validation weight from the
first frame. This is the rule applied, not an exception to it. Likewise `PublishReasons`'
"Save the draft first" exists only while the draft holds the operator's edits, so it is never a
hint.

### One primitive

- `RefusalLine` takes a required `touched`, so no surface can draw a reason without saying
  whose attempt it is.
- `useRefusalTouch(edited?)` (`lib/refusalTouch.ts`) is how a form knows. It returns `touched`,
  `touch`, `reset` and `watch`. `watch` is spread on the element that holds the form and hears
  React's bubbling `change` and the `click` of any button inside it — the refused action's
  swallowed click included, since `PrimaryAction` cancels the default and not the propagation.
  `edited` latches a state the page already knows is the operator's (a draft made dirty).
- `PrimaryAction` takes `onRefusedPress`, called when it swallows a press because it is refused
  (not while busy), for an action that sits outside the element `watch` is on.
- A field takes the form's `touched` with the refusal that names it: `refusedProps(refusal,
  field, reasonId, touched)` (`lib/itemForm.ts`) for a plain control, and `refusedBy`, a
  `RefusedBy` (`{ id, touched }`, built by `refusalOn`), for `DerivedIdField`, `ChipListField`
  and `MediaDropZone`. A form below a list holds its touch in `useItemForm().touch`, which
  `ItemFormRow` takes and watches, so the form's fields and its line read one value.
- A reason drawn as more than one line wears `refusalLineClasses(touched)` itself:
  `PublishReasons` and Start's list.

### The adopters, and how each knows

| Surface | Line | Touched by |
| --- | --- | --- |
| Results, *Add tag* and *Add note* | `RefusalLine` each | `watch` on each form; reset when an add empties it |
| Results, *Fork this run* | `RefusalLine` | `watch` on the Fork panel (its two selects per arm, and the button) |
| Bench, *Send as the customer* | `RefusalLine` | `watch` on the composer form (message, *Deliver to*, Send); reset after a send |
| Setup, *Start experiment* | Start's list | `watch` on the setup form; the scenario and arms the page chose itself are not edits |
| Ticket, *Add to thread* | `RefusalLine` | `watch` on the thread form (author toggles, time, message); reset after an add |
| Settings, *Save connection* and *Test connection* | one `RefusalLine` | `watch` on the card holding the fields (a typed key of spaces, a preset, *Replace*, *Keep the current key*, Test), and `onRefusedPress` on Save, which sits above it |
| Scenario, *Add* at a cap | `RefusalLine` | `watch` on the picker form; reset after an add |
| New block, *Add parameter* at the cap | `RefusalLine` | `watch` on the form; reset after an add |
| Every form below a list (`ItemFormRow`), and the field its refusal names | `RefusalLine` | `useItemForm().touch`, watched on the form; reset on an accepted submit and on every new filling of the form (an Edit opened, a reset, an entry taken away under it) |
| Product editor, an open variant row's Save, and the row's SKU | `RefusalLine` under the table, inside an always-mounted polite live region (it used to be an alert) | `watch` on the open row's `<tr>`; reset when another row opens or the row closes |
| Starting states, *Freeze snapshot* and *Clone sandbox* | `RefusalLine` each | `watch` on each form; reset after a clone |
| Customers, *Attach to this shop* | `RefusalLine` | `watch` on the form; reset when the panel is toggled and after an attach |
| Every create page (`CreatePage`) | `RefusalLine` in the header | `watch` on the body, and `onRefusedPress` on Create, which sits outside it. The page body is the form Create submits, so typing in a sub-form inside it — the new-block page's parameter form — touches Create's line too |
| Publish on seven editors (`useDefinitionEditor().publishTouch`) and the overview's two | `PublishReasons` | `edited` = the draft is dirty (latched), and `onRefusedPress`; reset after a publish |
| *Save and leave* (`UnsavedChangesGuard`) | `RefusalLine` | always touched (above) |

### What is not a refusal line

A validation message a control says about its own value — `Field`'s or `FieldHint`'s error
line, `DerivedIdField`'s "taken", the transit window under *Max days* — keeps the validation
weight. It says what is wrong with a value on screen rather than why a press would be refused,
and it is drawn in response to that value; Shop details' slug, refused because another shop
holds it, is said on the *Slug* field and named by a Save that `EditorSaveActions` draws only
once the page holds unsaved work. A publish-gate finding said on its control or on an
empty list (`GateFindingLine`, "No line item yet…") refuses no write (ADR 0063's shop amendment)
and is the gate's, not a refusal's. Neither is in this ADR's scope, and both keep ADR 0063's
weight. A line a refused action names that is no field's own message is a refusal line,
wherever it sits: the variant row's SKU refusal under the Variants table is one, and adopts the
rule above.

The variant row's line moves from the `role="alert"` it had to the always-mounted polite live
region every form below a list already uses (`ItemFormRow`). A refusal that appears while the
operator types in the row is heard without interrupting them; an assertive alert inserted with
the row would announce a hint over the press that opened it — and on a stored SKU of the wrong
shape its words are the rename rule, which the SKU field already reads in its description.

## Departures

- `tmp/design-frames/README.md`, *The form pattern*: "Validation messages sit under the
  control: 13px 600 `#9d3028`." The validation colour is kept for a refusal the operator has
  caused; an untouched form's reason is drawn at the same README's hint. Recorded in
  `docs/design-direction.md`, *Departures from the handoff, in force*.

## Consequences

- On the refused action, no accessible name, description, `title` or `aria-disabled` changes.
  The field the refusal names changes its `aria-invalid` and its description with the touch
  (27 October amendment). No Playwright spec reaches a field by either, so none moves.
- A surface that adds a refused action decides `touched` when it draws the line, because
  `RefusalLine` will not compile without it.
- `docs/design-direction.md`, *A blocked primary action says why*, says the rule.

## Verification

- `ui.test.ts`: the hint is 13px, `font-normal`, `admin-ink-soft`, `#42474c`; `refusalLineClasses` is the hint
  untouched and `validationMessageClasses` touched; the hint holds 4.5:1 on the card, the
  admin canvas, the lab's paper, both ends of the lab canvas and the ground a list item and the
  blocked weight share (read off `itemClasses`),
  and `admin-muted` does not on the lab canvas.
- `PrimaryAction.test.tsx`: on a form drawn as the adopters draw one, the line is the hint, then
  the validation message after typing, after a press, after Enter on the action and after
  implicit submission, and after a press on a chip, but not after a click into a field —
  `refusalFacts` (`aria-disabled`, `disabled`, `title`, `aria-describedby` and the described
  text) equal before and after; a submission without a press (`form.requestSubmit`) leaves it a
  hint; `useRefusalTouch` resets and latches `edited`;
  `onRefusedPress` is called for a refused press and not for a busy or a free one.
- `test/refused.ts`: `expectRefusalWeight(button, "hint" | "touched")` reads the line the
  button's refusal names, so it cannot pass on a sentence found elsewhere.
- One adopter test per field component the refusal names, the control without `aria-invalid`
  on an untouched form whose action is refused, then marked after an edit and after a press:
  `ItemList.test.tsx` (`refusedProps` through `ItemFormRow`, reset when an entry is opened and
  put back and after an accepted add, and still marked after an edit undone),
  `DerivedIdField.test.tsx`, `ChipListField.test.tsx` and `MediaDropZone.test.tsx` (on
  `test/refusingForm.tsx`), `Blocks.test.tsx` (the parameter form's Label), and `App.test.tsx`
  (the variant row's SKU). A collision of the field's own is marked from the keystroke that
  causes it while the form's refusal names another field (`DerivedIdField.test.tsx`,
  `ChipListField.test.tsx`).
- One adopter test per surface, each muted on first render, then at the refusal's weight after
  an edit and after a press where the form has both, with the button's facts unchanged:
  `Experiments.test.tsx` (tags, notes, Fork, the bench's composer, Start), `Tickets.test.tsx`
  (thread), `LabSettings.test.tsx` (Test, *Replace*, a key of spaces), `Scenarios.test.tsx` (the cap, and a hint after the add that
  reached it), `Blocks.test.tsx` (`ItemFormRow` and `ParameterForm`), `Snapshots.test.tsx`,
  `Customers.test.tsx`, `CreatePage.test.tsx`, `WorkspaceChrome.test.tsx` and
  `JudgeConfigurations.test.tsx` and `ShopHome.test.tsx` (Publish), and `App.test.tsx`
  (*Save and leave*, touched from the first frame; the variant row's Save, opened on a stored
  SKU of the wrong shape).
- ADR 0063's tests that submit without pressing and write nothing are unchanged and pass.

## Migration

None. No contract, payload, route, stored value or accessible name changes.
