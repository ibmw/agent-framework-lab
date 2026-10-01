# ADR 0074 — A list of records is edited in the form below it

Status: accepted — 2026-09-30

Amendment: 2026-10-01 — A profile's addresses, background and hidden facts and an identity's
guidance notes are on the pattern (*A profile's lists and an identity's guidance*, below). The
item gains a `tag` beside its name, a detail line it may go without and one that keeps its line
breaks (`multiline`), and the trash a name of its list's own; `ItemFormRow`'s hint becomes
optional; `useEntryEdit` and `EntryEditNotice` leave the customer and support identity editors.

On 29 September 2026 the operator asked that the lists an editor edits with a form meet the
pattern Shop details' *Payment methods* draws (ADR 0072), so that editing an entry is learned
once. This records that pattern as the workspace's, what stays on `EntryCard`, and how the
pattern meets the standing decisions. It is built first on the method lists and on an order's
line items and events (`docs/PLAN-UX.md`, Milestone 10); the other lists the milestone names
adopt it slice by slice under this record.

## Context

Two patterns edited a saved entry. `EntryCard` edit mode opened the row where it stood, with its
own Save and Cancel, one open row per list, siblings' Edit disabled (`form-decisions.md` 8.2,
*A saved row opens where it stands* in `docs/design-direction.md`). ADR 0072 put Shop details'
two method lists on the methods handoff's pattern instead: the entries as items, one form below
them that adds or edits, one refusal line after its buttons. An order's line items were a third
shape: a table whose quantity was typed in place, with an add form under it.

## Decision

### The method list is the workspace's pattern for a list of records edited with a form

The pieces ADR 0072 built in `routes/ShopMethodCards.tsx` move to `components/ItemList.tsx` —
`ListItem`, `EditButton`, `RemoveButton`, `ItemFormRow` — and `lib/itemForm.ts` — `useItemForm`,
`useFocusAfterCommit`, `useEditButtons`, `refusedProps`, `formTitle` and the refusal's
`{ field, reason }` shape, `ItemRefusal` — with the item's class sets in `lib/ui.ts`. Shop
details' cards draw through them with nothing anyone can see, hear or press changed; the
payment switch, the ID field and the name and day fields stay in the route, their one consumer.

A list so edited is two rows of its card: the list under its row label and hint, then the form,
labelled "Add a …" while adding and "Edit {name}" while editing. An item reads its name, its key
in monospace and one detail line; its pencil and trash, 30px, are named "Edit {name}" and
"Remove {name}". Edit loads the entry into the form, marks the item `aria-current`, and moves
focus to the form's first field it asks; *Save changes* writes the entry where it stands and
*Cancel* empties the form, both returning focus to that Edit; an Edit while the form holds
something replaces it.

This supersedes *A saved row opens where it stands* and `form-decisions.md` 8.2 for the lists
Milestone 10 converts: the method lists, an order's line items and events (this slice); a
profile's addresses, background and hidden facts, an identity's guidance, a product's options,
media, attributes and reviews, the tone-of-voice guidelines and a template's parameters (the
slices that follow, each citing this record).

### What stays on `EntryCard`

- **Edit mode stays** on the product's variants table and on a scenario's composed objectives
  and mutations, as the operator scoped the milestone.
- **`EntryCard` without Edit stays** on the create pages' rows (a new block's parameters, a new
  scenario's composed blocks), on the shop version page's lists, and on the lab's frameworks.
- A ticket's thread keeps its composer (ADR 0073).

### A key another record names the entry by is shown and fixed while editing

A method's ID, as ADR 0072 decided. An order line's variant: the lab keys a line on its SKU and
keeps the price it was frozen at (`_materialize_lines` in `application/order_fixtures.py`), so a
line whose variant moved would be a removal and an addition that re-prices it. While editing,
the form shows the variant read-only and asks only the quantity. An event's ID was never asked
and stays on the item.

### How it meets ADR 0051, ADR 0060 and ADR 0063

- **ADR 0051.** The form registers itself as unsaved work while it holds something other than
  what it was filled with, and the prompt cannot save it: there is no `save`, and its reason,
  `itemFormReason`, is written from the list's noun and the record the form writes into, so
  Shop details' reads word for word as ADR 0072's `METHOD_FORM_REASON` and an order's says "A
  line typed in its form…" or "An event typed in its form…". An entry taken off the list while
  the form edits it empties the form; a clean edit follows the entry through a discard. A clean
  add follows its blank the same way, so a choice the lab makes for the operator (ADR 0064) —
  the one priced variant not yet on the order — is where the form starts, not something it asks
  about.
- **ADR 0060.** The trash asks twice under the preference; `ConfirmRemove` takes the item's place
  and the list's notice line takes focus after.
- **ADR 0063.** The submit is `PrimaryAction`, refused before the press with the first rule the
  form breaks in the order its fields ask, in one polite line after the buttons; the field that
  breaks it is `aria-invalid` and described by that line; a blank form is refused, says why and
  marks nothing until something is typed; the handler checks the refusal too. This is ADR 0072's
  placement, and every converted form takes it, a field's native `required` included: the
  event's time and summary are no longer `required`, and an empty one is said in the line like
  any other rule. A rule about the list rather than a field — the order's cap on its events,
  nothing left to add as a line — marks no field.

### The order's two forms

- **Line items.** The table goes: each line is an item under *Items* — the product title and
  variant summary as the name, the SKU as the key, "{quantity} × {unit} = {line total}" as the
  detail — named by its SKU on its controls, so "Remove {SKU}" keeps its name. The quantity
  typed in place goes with it (`quantityDraft`, `changeQuantity`); the form asks *Variant* (the
  priced variants not yet a line, already chosen when only one is left) and *Quantity* (1 to 999,
  1 when adding). Refused in order: nothing left to add (adding only), no variant chosen — a
  chosen variant that is no longer addable, because a discard brought its line back, counts as
  none — and a quantity outside the bounds. The totals follow *Save changes*, not each
  keystroke, and a *Save changes* that changed nothing writes nothing, so the order stays clean.
  `clampQuantity` stays for the create page. The payment rows and the totals stay below, in the
  same card, and the card's line keeps "Totals derive from the line items — never edited
  directly." while the second sentence it carried moves to *Items* as the prototype's hint.
- **Events.** Each event is an item — the kind as the name, its ID, the time and the summary as
  the detail — named by kind and ID on its controls as before. The one form asks Kind, Occurred
  at and Summary, opening on a support contact at the order's placement. Refused in order: the
  cap (adding only), the time, the summary. A time left alone keeps the instant it opened on to
  the second — the event's own when editing, the placement when adding (`orderEventEntry`).

### A profile's lists and an identity's guidance

- **Addresses.** Each entry is an item under *Entries* — the label as the name, the ID, the
  address on one line as the detail — with the *Default* pill beside the name (`ListItem`'s
  `tag`) and *Make default* ("Make {label} the default address") on the item before the pencil,
  as `Workspace.dc.html` :2888–2891 draws them; the default carries none. Which entry is the
  default is the list's answer and never the form's: *Save changes* keeps the entry's flag, the
  first entry added becomes the default, and *Make default* stays free while the form edits
  another entry. The one form, "Add an address" / "Edit {label}", asks every field the entry
  stores while editing and, while adding, what a new entry cannot do without — the recipient is
  the customer and the country follows the profile's locale until one is typed
  (`ADDRESS_FORM_FIELDS`, `resolvedAddress` in `lib/customerEntries.ts`). Refused in order: the
  first of the label, recipient, street, postal code and city empty or only spaces
  (`ADDRESS_FIELDS_RULE`), then a country that is not two uppercase letters (`COUNTRY_RULE`); an
  address being added for a profile with no name yet is refused with the same sentence and no
  field marked, because the recipient is not asked there.
- **Background.** The date · kind as the name, the ID, the note as the detail. "Edit {date ·
  kind}" and "Remove the {date} background entry" keep the names they had (`RemoveButton`'s
  `label`): the trash names the entry by its date, as its confirm and its notice do. The form,
  "Add a background entry" / "Edit {date · kind}", asks Kind, Date and Note and opens on a
  purchase today; refused in order: a day missing (`BACKGROUND_DATE_RULE`), a note empty
  (`BACKGROUND_NOTE_RULE`).
- **Hidden facts.** The fact as the name, the ID, "Revealed when …" as the detail where it has
  one and no detail line where it has none. The form, "Add a hidden fact" / "Edit {fact}", asks
  *Hidden fact* and *Revealed when (optional)*, without the placeholder that repeated the
  label; refused when the fact is empty (`HIDDEN_FACT_RULE`).
- **Guidance.** The title as the name, the ID, the body as the detail, its line breaks kept
  (`ListItem`'s `multiline`, which Shop details' and an order's items do not take). The form,
  "Add a note" / "Edit {title}", asks Title and Guidance — a text area now, where the add form
  and the open row asked the body on one line — submitted by *Add guidance*; refused in order: a
  title empty (`GUIDANCE_TITLE_RULE`), then the guidance (`GUIDANCE_BODY_RULE`).
- **The form row's hint is optional.** `ItemFormRow` takes no hint where the form has no rule
  of its own to state (*Guidance lives under the field*): the background, hidden-fact and
  guidance forms draw none, and the address form draws its own only while adding.
- **A rule is heard once.** The Country field's hint is `COUNTRY_RULE`, which is also the
  refusal it can be marked with; while marked, `FieldHint`'s `hintDescribes` leaves the hint out
  of its description, so the field is described by the refusal's line and the rule is heard
  once rather than twice in a row. The hint stays drawn.
- Every text is stored stripped as the lab strips it (`pythonStrip`), where the background and
  the hidden facts sent the note as typed and met a 422 over surrounding whitespace; an edit that
  changed nothing writes nothing.

## Departures

- `form-decisions.md` 8.2's open row is superseded for the converted lists, as above.
- The prototype's order line reads "authored at the price below" beside its total
  (`Workspace.dc.html` :2749–2750); the item's detail says quantity × unit = total instead,
  the arithmetic the totals derive.
- The prototype's order frame draws no events card; the codebase's keeps its card and takes the
  methods handoff's items and form.
- The prototype's order card is titled *Lines*; it stays *Line items & payment*, the name four
  Playwright journeys reach it by.
- The events list's row label, *History*, and both order forms' hints are the slice's own: the
  prototype draws none for them.
- Edit on a line moves focus to *Quantity*, the first field the form asks while editing, rather
  than to the fixed variant ahead of it.
- A line's empty state reads at the validation weight, as the handoff's empty fulfilment list
  does (`shop-details.template.html` :200), because an order with no line is a gate error; the
  events' stays muted, because an order with no event is a warning.
- Both order forms' submits wear the accent weight the methods handoff draws, where the add
  forms they replace were outline.

- The prototype draws an address with neither Edit nor Remove (`Workspace.dc.html` :2884–2893)
  and a guidance note with a one-press × and no Edit (:1858–1866); their items carry the pencil
  and a trash that asks twice (ADR 0060).
- The prototype's *Entries* hint, "Exactly one is the default. Removing an entry never touches
  an order already authored against it.", is written as the lab holds it — "Exactly one is the
  default before the profile can publish; the first entry added becomes it." — because the gate,
  not the list, requires the default, and the card's line already says what a removal leaves.
- The prototype's address item carries no ID (:2884–2893); it shows the ID in monospace as every
  item does, and the pill stands between the name and the ID.
- The prototype's validation-weight line under the address book, "No default set, so no order in
  this shop can ship to this customer yet." (:2894–2896), is not drawn, as it was not on `main`:
  the publish gate says a book without a default.
- The prototype puts *Add note* in the guidance card's header; the note is added by the form
  below the list, as every converted list is.
- The prototype's customer frame draws only Identity, Persona and Address book, so no
  background or hidden-fact list (its hidden facts are a scenario's); their row labels *History*
  and *Facts*, the guidance row's *Notes*, and the address form's hint while adding are the
  slice's own.
- The address book's empty line drops "with one default", which the *Entries* hint now says.
- The four forms' submits wear the accent weight the methods handoff draws, where the add forms
  they replace were ink.

## Consequences

- It amends ADR 0069's width for the order line's quantity: the quantity left the table's narrow
  column for the form grid, which the methods handoff draws at 100%
  (`shop-details.template.html` :176–178), so it composes `w-full` rather than `w-20`.
- Two risks are accepted. The line form counts as unsaved work when the operator re-picks
  "Select a variant" over the sole variant the form opened on: it then holds something other
  than what it was filled with, and the prompt names it, though nothing was typed. And a variant
  chosen in the add form whose line a discard brings back stays in the form, which the select can
  no longer show: *Add line* refuses with the variant rule, the unsaved-work prompt still names
  the form, and the form does not follow a new sole candidate until it is cancelled or the variant
  is chosen again.

- The accessible names that moved, none of which a Playwright spec reaches: "Quantity for
  {SKU}" (now the form's "Quantity"), "Add product" (now "Variant"), the forms named "Add a
  line", "Add an event" and "Edit {label}" (now groups of the same name), "Save {label}" and
  "Cancel editing {label}" (now *Save changes* and *Cancel*). *Add line*, *Add event*, "Edit
  {label}", "Remove {SKU}" and "Remove {label}" kept their names.
- No backend, contract or payload moved.

- The accessible names that moved with the profile's lists and the guidance: the open rows'
  forms "Edit {label}" (now groups of the same name), their "Save {label}" and "Cancel editing
  {label}" (now *Save changes* and *Cancel*), the add forms' unnamed fieldsets (now the groups
  "Add a background entry", "Add a hidden fact" and "Add a note"; "Add an address" kept its
  name), and the hidden fact's "Revealed when" (now "Revealed when (optional)"). The Country
  field's description while refused loses its hint's copy of the refusal. Every item's
  Edit, Remove and *Make default*, and *Add address*, *Add entry*, *Add fact* and *Add guidance*,
  kept their names. Specs touched: `order-fixture` (`editRow` became `editItem`, the helper
  `tests/e2e/support/authoring.ts` gained) and `customer-publication` (the pill read on its item,
  since the *Entries* hint names the default too).

## Verification

- `ItemList.test.tsx`: the item's name, key, detail and `aria-current`; the pencil's and trash's
  names and a held trash; the confirm in the item's place; the form row's label and hint, *Save
  changes* and *Cancel* while editing with focus into the form and back to the Edit; one refusal
  line after the buttons, a blank form marking nothing; the form emptied when its entry leaves;
  the unsaved-work labels and the reason written from the noun.
- `lib/ui.test.ts`: the moved class sets. `lib/orders.test.ts`: every combination of the line's
  and the event's rules, first broken first.
- `Orders.test.tsx`: the order editor's tests edit through the form; the variant fixed while
  editing; each rule in order; a blank form refused and unmarked; the form emptied when its line
  or event is removed; the prompt for a typed line and an edited event; a line's frozen price
  kept through *Save changes*; the second of two lines edited where it stands; a typed line kept
  when the variants it could choose change under it; *Add line* refused when a discard brings
  back the chosen variant's line; an untouched line or event saved leaving the order clean.
- *Quantity* is at the form grid's full width, as the methods handoff draws every field of the
  form (`shop-details.template.html` :176–178): `Orders.test.tsx` asserts its `w-full`, and
  `lib/ui.test.ts`'s width sweep that `OrderEditorPage` no longer composes `w-20`.
- `App.test.tsx`: *payment and fulfilment methods, as the handoff draws them*, the two method
  edits of *editing a saved entry in place* and the prompt's method labels, unchanged.
- `lib/customerEntries.test.ts` and `lib/guidanceNotes.test.ts`: every combination of each
  form's broken fields refused with the first in the order it asks, and every text stored
  stripped as Python strips it. `ItemList.test.tsx`: the tag beside the name, the item without
  a detail line, the trash's own name.
- `Customers.test.tsx` and `SupportIdentities.test.tsx`: each form's rules walked in the order
  its controls stand in the document (`expectRulesInFieldOrder`, `test/itemForm.ts`), each said
  after its submit with that control alone marked; a blank form refused and unmarked; an edit
  loaded, focused and saved where it stands; the default untouched by an edit of either entry;
  *Make default* on the item moving the pill while the form edits another; the confirm in the
  item's place; the form emptied when its entry is removed; a clean form following the draft
  through a Discard and a dirty one keeping its work; the country following the locale while
  adding; the prompt for a typed address, an edited fact and a typed note; an untouched entry
  of each list saved leaving the draft clean; Home's typed city saved after *Make default* moved
  the default to Office, the payload holding both; a marked field described by the refusal's
  own line and told the rule once; a guidance body's line breaks kept on its item.
