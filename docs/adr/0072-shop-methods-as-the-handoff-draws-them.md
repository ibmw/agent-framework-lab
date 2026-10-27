# ADR 0072 — Shop details' payment and fulfilment methods, as the methods handoff draws them

Status: accepted — 2026-09-27

The user pointed at `tmp/design-frames/design_handoff_shop_details_methods/` to redesign the two
method cards on Shop details. The handoff is a prototype with its own validation, edit and
discard behaviour; four of its choices meet a standing workspace rule, and this records how each
was settled.

## Context

The cards were two `EntryCard` lists: a payment row with its kind, ID and an *enabled* checkbox,
a fulfilment row with "carrier · min–max days", each with Edit (the row opened in place, ADR
0051) and Remove (asked twice, ADR 0060), and an add form under the list. *Add fulfilment method*
was refused before the press for an inverted window, said under Max days (ADR 0063's
amendment); the other rules were native `required` and `pattern` and `DerivedIdField`'s taken
line.

The handoff draws each card as two form rows: **Accepted** / **Offered**, the methods as items
(name, monospace ID, kind or "Carrier · window"; a payment switch; 30px Edit and Remove icon
buttons), and one form whose label is "Add a method" or "Edit {name}". It validates on submit in
one order and writes one error after the buttons; its Edit loads the method into the form; it
keeps one payment method enabled; and its Discard restores a published snapshot.

The lab's own rules, from the Python:

- `PaymentMethod` and `FulfilmentMethod` (`domain/shop.py` :371–403): the ID is `require_slug` —
  `[a-z0-9]+(?:-[a-z0-9]+)*`, full match, at most 64 (`domain/content.py` :22–41), which is the
  handoff's `^[a-z0-9]+(-[a-z0-9]+)*$`; the name, and the carrier, are `require_label` —
  non-empty, unpadded, at most 200 (`content.py` :72–77), so **a carrier is required**; each
  transit day is `require_non_negative_int` and `FulfilmentMethodSchema` bounds it at `le=365`
  (`presentation/shops.py` :311–312); a maximum under the minimum is refused with "maximum
  transit days cannot be shorter than minimum transit days" (`shop.py` :400–403).
- IDs are unique per list (`ShopPayload.__post_init__`, `shop.py` :659–662).
- **Zero enabled payment methods is not refused.** It is a publish-gate error,
  `shop_without_payment_method` (`shop.py` :824–830): the draft saves, publication is refused.

## Decision

### The refusal is said before the press, after the buttons, in the handoff's order

The handoff says an error after the press. The house rule is ADR 0063's: a refused primary
action stays reachable and says why before it is pressed. So *Add payment method*, *Add
fulfilment method* and *Save changes* are `PrimaryAction`s refused with the **first** rule the
form breaks, in the handoff's order — name, ID shape, ID unique (the method being edited
excluded), carrier, then the window — and the one `RefusalLine` stands where the handoff draws its
error, after the buttons, in a polite live region. The field that breaks the rule is
`aria-invalid` and described by that line; a blank form is refused and says why, and marks no
field until something is typed. Each submit handler checks the refusal too. (Amended by ADR 0078,
27 October 2026: a field is marked only once the form is touched, which a press with nothing
typed also does.)

The handoff's last rule, `max ≥ min ≥ 0`, is said as three: Min days, then Max days, as a whole
number from 0 to 365 (the contract's bound), then the lab's transit sentence, character for
character. That sentence **moves** from under Max days to the line after the buttons, which
supersedes the placement in ADR 0063's amendment for this form: one line, one place, for every
rule the form has. `DerivedIdField` gains `refusedBy`, so its field is marked and described by a
line it does not draw, and `monospace`, drawn with `idControlClasses` (a second font size
composed after the control's would lose to it). The taken ID is no longer said on the field: the
sentence is the handoff's, "{id} is already used by another method.", after the buttons.

The ID follows the name through `DerivedIdField` and the existing `slugify` and
`uniqueSuggestion`, not the handoff's slug function: both give IDs the lab stores, and `slugify`
also folds accents ("Crêpe" is `crepe`, not `cr-pe`) and steps off a taken ID (`visa-2`), which
the field says.

### Edit loads the method into the form; the ID is fixed while editing

The form replaces the open row for these two lists. Edit fills the form, names it "Edit {name}",
highlights the item (`aria-current`) and moves focus to Name; *Save changes* writes the method
where it stands and *Cancel* empties the form, both returning focus to the Edit that opened it.
Edit while the form holds something replaces it, as the handoff does.

The handoff "locks the ID as hand-edited" but leaves it editable. Here it is **read-only** while
editing: an order names its method by ID (`payment.method_id`, `fulfilment.method_id` in
`domain/order_fixture.py`) and the change summary keys the list on it, so a moved ID is a
removal and an addition. A saved method's ID is shown, never asked (`docs/design-direction.md`).

A payment's *enabled* is the list's switch, never the form's: *Save changes* reads it from the
method as it stands, so a switch turned while the form was open survives the save.

The form is unsaved work while it holds something other than what it was filled with — a
method typed and not added, or an unsaved edit — and says so to the guard (ADR 0051) with its
own reason, `METHOD_FORM_REASON`, since there is no row and no row Save. A method taken off the
list while the form edits it empties the form, so Add cannot write it back. A clean edit
follows the method as the draft holds it, so after a discard puts back an older version *Save
changes* cannot write the discarded one; a dirty edit keeps the operator's typing.

### One payment method stays enabled — a workspace rule, stricter than the lab

The user confirmed this rule after being told the lab does not refuse zero enabled methods.

The lab stores a draft with none enabled and refuses it only at publication. The handoff keeps
one on, and the user asked for the handoff, so the workspace keeps it, as the Channels chip's
`keepOne` does (ADR 0071) — with the difference that the lab refuses empty channels at the write
and does not refuse zero enabled methods. The last enabled method's switch is natively disabled
and titled "The last enabled method stays on"; its Remove is natively disabled (a secondary
control, ADR 0063) and titled "Enable another method before removing the last one."; both are
described by one muted line under the list that says the two sentences, shown only while exactly
one method is enabled. A confirm armed before the others were switched off is dropped, so no removal of the last
enabled method reaches the card's handler and it carries no guard of its own for it. A draft
already holding none enabled is not blocked: any switch turns on, any method can be removed.
Consequence: the `shop_without_payment_method` removal clause is no longer reachable from this
card and is deleted from `REMOVAL_FINDINGS`, and the checklist line still owns the gate code.

New payment methods are added enabled.

The switch is named by its method alone ("Visa") and its role and checked state say on or off;
the visible "Enabled"/"Disabled" is `aria-hidden`, so the name never contradicts the word
beside it (WCAG 2.5.3, label in name, in both states).

### Removing keeps ADR 0060

The trash is the Remove: named "Remove {name}", it asks twice under the confirm-before-delete
preference, the confirm takes the item's place, and the notice line takes focus after.

### Discard is the app's, not the prototype's

Every change to a list is a draft edit and marks the draft dirty. *Discard changes* reads the
saved draft again, as on every editor; the handoff's "restores from the published snapshot" is
its prototype's model, not the lab's. The form is not the draft, so a discard leaves what is
typed in it, as it leaves an open row.

### What is drawn as the handoff draws it, and what is the house's

Reproduced: the item (11px 14px, 9px radius, `admin-border` on `#fafbfb`; `#8fc3a5` on `#f1f8f3`
while edited), the name at 13.5px 700, the ID in monospace 11.5px `#8c9196`, the second line
12.5px `#6a7580`, the switch (34×20 track, `lab-primary` on, `admin-field-border` off, a 16px
knob at 2px or 16px with `0 1px 2px rgb(0 0 0/25%)`, "Enabled"/"Disabled" at 12.5px 650), the
30×30 icon buttons (`admin-quiet-border`, `admin-muted`; Edit hover `#f6f7f8` and `admin-ink`,
Remove hover `#c98676` and `lab-error`), the row labels and hints, the auto-fit grid and the
Min/Max sub-grid, the ID helper, the empty state at the validation weight. The colours that are
tokens are the tokens; `#fafbfb`, `#8fc3a5`, `#f1f8f3`, `#8c9196`, `#6a7580`, `#f6f7f8` and
`#c98676` are literals, each used by one file for this role.

The house's, where a component already draws the role: the card (`Card`, as ADR 0071's cards),
the buttons (`PrimaryAction` accent, so the pine hover is `lab-primary-hover` rather than the
handoff's `#174f35`, and the outline Cancel), the stacked field label (`FieldHint`, 12px 600
muted where the handoff has 12.5px 700 `#42474c`), the glyphs (`lucide`'s pencil, trash, plus
and check). Departures: the item's actions wrap as one group, so a narrow item never leaves the
trash on a line of its own; the grid's minimum is `min(160px, 100%)`, so it does not overflow a
card narrower than 160px; the Kind select keeps the handoff's order (Card, Wallet, Gift card,
Bank transfer).

### The hints say what the lab does

Four of the handoff's hints claim what the lab does not do, and a hint is only written where its
rule is true (`docs/design-direction.md`). The user chose truthful sentences in the same places:

| Row | Handoff | Here, and why |
| --- | --- | --- |
| Accepted | "A disabled method stays on past orders but cannot be chosen for a new one. At least one stays enabled." | "A disabled method stays on the orders that recorded it. At least one stays enabled: a shop with none is refused at publication." — an order accepts any configured method (`order_fixture.py` :605, `order_fixtures.py` :258) and only the publish gate reads `enabled` (`shop.py` :824). |
| Payment form | "The kind decides which refund path an agent may take for it." | "The name and kind can change later; the ID is fixed once the method is added." — nothing in the lab reads the kind. |
| Offered | "An order keeps the method and window it was placed with, even if you change them here." | "An order keeps the name of the method it was placed with, even if you change it here." — an order freezes `method_id` and `method_name` (`order_fixtures.py` :408–422), not the window. |
| Fulfilment form | "Min and max days are business days from dispatch." | "Min and max days are the method's delivery window, in whole days." — nothing models business days or dispatch. |

The page's first card stays *Identity* and *Logo* (ADR 0071); the handoff's README says
"Brand", its template draws the two.

## Verification

- `lib/shopMethods.test.ts`: every window of up to three days, with its en dash; what a day
  field takes; the contract's 365 and the label cap read out of the Python; the first rule
  broken for all 60 fulfilment and 6 payment combinations; the lab's transit sentence; the edited
  method's own ID; the 64 cap; trimming; the last enabled method for all 8 patterns of three;
  the Kind order.
- `App.test.tsx`, *payment and fulfilment methods, as the handoff draws them*: the lists, labels
  and hints; each rule in order, on the field that breaks it, after the button; Edit, highlight,
  fixed ID, focus, Cancel and *Save changes* in place; a new method enabled; the last enabled
  method held with its reasons, by keyboard too; an armed confirm dropped; the confirm, the
  preference and the notice; the form emptied when its method goes; the unsaved-work prompt for
  an add and an edit; dirty and Discard; a clean edit reloaded after a Discard and a dirty one
  kept; the switch named by its method with its state word hidden; the four hints. *The shop draft's refusals* keeps the transit rule,
  now after the button, and *editing a saved entry in place* the two method edits.
- `lib/ui.test.ts`: `idControlClasses` is the control's box at one font size, and in the width
  sweep.
