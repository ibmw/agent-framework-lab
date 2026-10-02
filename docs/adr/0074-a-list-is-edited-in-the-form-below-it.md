# ADR 0074 — A list of records is edited in the form below it

Status: accepted — 2026-09-30

Amendment: 2026-10-01 — A profile's addresses, background and hidden facts and an identity's
guidance notes are on the pattern (*A profile's lists and an identity's guidance*, below). The
item gains a `tag` beside its name, a detail line it may go without and one that keeps its line
breaks (`multiline`), and the trash a name of its list's own; `ItemFormRow`'s hint becomes
optional; `useEntryEdit` and `EntryEditNotice` leave the customer and support identity editors.

Amendment: 2026-10-01 — A product's options, media references, typed attributes and reviews are
on the pattern (*A product's four lists*, below); its variants table stays open in place. The
item takes a detail it draws rather than writes and a name that is its own key; the form row's
chip lists can be the field a rule marks; a field the form holds as a list is clean while it
holds the values it was filled with; `useEntryEdit` and `EntryEditNotice` leave the product's
four cards.

Amendment: 2026-10-01 — The tone-of-voice guidelines and a template's parameters are on the
pattern (*The guidelines and a template's parameters*, below), the last lists Milestone 10 names.
The item gains a `lead` before its name and the list its arrows (`MoveButton`); the fixed key's
field is shared (`FixedKeyField`). `useEntryEdit` leaves both, and its `units` goes with its
last consumer: what stays on `EntryCard` edit mode is the product's variants and a scenario's
composed blocks.

Amendment: 2026-10-01 — What stays on `EntryCard` draws the item's pencil and trash: the closed
row's Edit is `EditButton`, its Remove `RemoveButton` or, one press, `TrashButton`, and a
composed block's arrows `MoveButton`; the open row's Save and Cancel keep their words (ADR 0075).

Amendment: 2026-10-01 — Four behaviours review left open. *Make default* on an address hands
focus to the new default's pencil, which the pill describes, since the button that had it is not
drawn on the default. A variant's typed option value, kept across a *Discard changes*, is dropped
once the option no longer offers it, in the open row and the add form alike: what is written
falls back to the value the variant holds (or the option's first). A reference
parameter the draft holds as not required — authored through the API, which the gate refuses
with "make it required" — is asked the `required` checkbox, with that finding under it, while
the form edits it with its kind kept; it stays for as long as the form is open, so ticking it
keeps focus, and a reference saved required is asked nothing, as before. And, applying ADR 0063
to the experiment setup, a preview the lab refuses (a 4xx) is said only on Start's refusal line,
while one that fails on the lab's side (a 5xx) or cannot be reached is said above the form until
a later preview answers: two refusals with one cause are one sentence.

Amendment: 2026-10-02 — The option's values and the attribute's choices draw no empty line of
their own ("No value yet; an option needs at least one."): the form's refusal line names the
missing value (`OPTION_NEEDS_VALUE`, `ATTRIBUTE_NEEDS_CHOICE`). `ChipListField` takes where it
stands as one decision every caller makes — `placement: "card"` with the `empty` line it says,
on the cards with no refusal line of their own (traits, tags, conditions, hidden facts), or
`placement: "item-form"` with none. The field draws one label, its legend; the input is named
by the legend followed by its own hidden label ("Values New value"), the drawn words first. In
the form's grid the input takes one track as the fields above it and *Add* the next; on a card
the row aligns its items at the top rather than the bottom (`items-end` to `items-start`). In
both, *Add* is the control's height (`subtleFieldButtonClasses`) and top-aligned with the input
rather than its hint, so the two are level.

Amendment: 2026-10-03 — A variant whose stored option value the option no longer offers —
authored through the API, or left by an option value's one-press removal (ADR 0060) — shows that
value in its open row's select, as a disabled "XL (not offered)", where the select fell to the
option's first value while Save wrote the stored one. What the row shows is what it writes; the
gate still raises `variant_unknown_option_value` until an offered value is picked, which
replaces it.

Amendment: 2026-10-03 — A preview answered `408` (timed out) or `429` (rate limited) is not a
refusal of the setup, though it is a 4xx. The preview's contract answers only 200, 404 and 422,
so either can only come from something between the browser and the lab, such as a proxy: a
passing failure, which the same setup asked again may not meet. It is said above the form until
a later preview answers, as a 5xx or an unreachable lab is, and refuses nothing at Start.

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

### A product's four lists

- **Options.** Each option is an item under *Declared*, whose hint is the prototype's card line,
  "Every variant chooses one value of each option." (`Workspace.dc.html` :956), which the gate
  enforces — the name, the key, and the values as the chips frame 2c draws for the detail
  (`ListItem`'s `detail` may be drawn, not only written). The one form, "Add an option" / "Edit
  {name}", asks *Option name*, *Option key* — `DerivedIdField` while adding, shown read-only
  while editing, because a variant chooses by it — and *Values* (`ChipListField`). Refused in
  order: the name empty (`OPTION_NAME_RULE`), the key not a slug or another option's while
  adding (`ENTRY_KEY_RULE`, "{key} is already in the draft."), then no value
  (`OPTION_NEEDS_VALUE`), which marks *New value* (`ChipListField`'s `refusedBy`). "Remove
  {name}" stays the trash's name and is no longer its visible word. The removal still takes the
  variants' values of the option with it and still says how many and which it leaves identical
  (ADR 0060); the confirm takes the item's place, which the *Departures* row "The option's
  confirm" in `docs/design-direction.md` already records.
- **Media references.** The reference is the item's name, in monospace and with no second key
  (`ListItem`'s `monospace`, its `id` left out), the alt text the detail. Its reference is its
  own key and nothing else names it, so the form, "Add a media reference" / "Edit {reference}",
  asks it while editing too, and *Save changes* moves the entry under the reference typed and
  hands focus to the Edit it now stands under. Refused in order: the reference empty
  (`MEDIA_NEEDS_REFERENCE`), another entry's reference, as the lab would store it — said once,
  in the line after the buttons, the Reference field marked and described by it, where the
  field's own second line said it before — then the alt text empty (`MEDIA_ALT_TEXT_RULE`).
- **Typed attributes.** The label, the key, the type (`EntryKind`) as the item's `tag` between
  them, and as the detail the value, its unit and "one of" the choices as chips. The form, "Add
  an attribute" / "Edit {label}", asks *Label*, *Key* (derived while adding, fixed while
  editing: agents read it through the catalog tools), *Type*, *Value*, and *Unit* or
  *Choices* as the type brings them. Refused in order: the label, the key while adding, the
  value empty, a number's or a measurement's value not a decimal, a yes-or-no's not `true` or
  `false`, a measurement's unit empty, then a choice's choices — none
  (`ATTRIBUTE_NEEDS_CHOICE`), or none that is its value
  (`ATTRIBUTE_VALUE_AMONG_CHOICES_RULE`) — the two marking *New choice*. The builder still writes
  only what the type holds.
- **The attribute's fields are one unit through a discard.** `useEntryEdit` followed them as one
  unit (`units`); the form follows the entry whole while clean and keeps all it holds while
  dirty, so a type never follows the record under a value typed for another. And whatever a
  discard leaves, a choice whose value is none of its choices is refused before the press.
- **Reviews.** "{rating}★" as the name, the review's ID, "“{body}” — {author}" as the detail,
  the line `sticky-header` reads. The controls keep "review {id}": "Edit review {id}", "Remove
  review {id}", and the form's "Edit review {id}". The form, "Add a review", asks *Author*,
  *Rating* (`StarRatingField`) and *Body*; refused in order: the author empty, then the body.
- **What holds for all four.** The removals keep `useRemoval(product.key, discarding)` (ADR
  0061), and the page is keyed by the product, so no form carries one product's edit onto
  another. Every text is stored stripped (`pythonStrip`); an edit that changed nothing writes
  nothing. The fields and the builders moved to `lib/productEntries.ts`, beside the refusals.
- **A list held in the form compares by its values.** `useItemForm` reads a field that is a list
  — an option's values, an attribute's choices — as unchanged while it holds the same values in
  the same order: the record hands back a new array on every read, and a chip added and removed
  again leaves what was loaded.
- **A chip field starts empty in every session of the form.** `ChipListField` keeps the value
  typed and not yet added in its own state; under the open row it was remounted with the row,
  under the one form it was not, so "Charcoal" typed in *New value* while editing Color stood in
  the add form after *Save changes* or *Cancel*. `useItemForm` gives each filling of the form a
  `session` — moved by every Edit, every reset and every entry taken away under it — and the
  values and choices fields are keyed by it. What is typed there and not added is still not the
  form's, and so not unsaved work, as it was not under the add forms. The profile's, the
  identity's, the order's and Shop details' forms hold no control with typing of its own beyond
  `DerivedIdField`, which is drawn only while adding and so is remounted by every Edit.
- **What is proven where.** The confirm in the item's place, the form emptied when its entry is
  removed, and a clean form following a Discard while a dirty one keeps its work are proven on
  the options and the attributes; media and reviews carry them by the same `useItemForm` and
  `ConfirmRemove`. *Cancel* returning to an empty add form, focus on the Edit, is proven on all
  four.

### The guidelines and a template's parameters

- **Guidelines.** Each guideline is an item under *Voices* — the name, the *shop default* pill
  beside it (`ListItem`'s `tag`), the ID, the guidance as the detail with its line breaks — and
  the default's radio, "Make {name} the shop default", as the item's `lead`: a control the list
  keeps on each entry that is neither Edit nor Remove and reads first, as `EntryCard`'s `lead`
  did. The radio is the list's, never the form's, as the payment switch is (ADR 0072): it reads
  the draft, which always holds a guideline's saved name, so it is free while the form holds an
  edit — a nameless one included, where the open row refused it — and *Save changes* writes the
  entry's own `is_default`, so an edit never moves the default; the first guideline added becomes
  it. The default carries no trash: `TONE_DEFAULT_REMOVAL_RULE` stands where it would (*A refusal
  that has a way out*). The one form, "Add a guideline" / "Edit {name}", asks *Name*, *ID* —
  derived while adding (`DerivedIdField`, keyed by the form's `session`), shown and fixed while
  editing, because an agent configuration names a guideline by it — and *Guidance*, and is
  submitted by *Add tone of voice*, which keeps its name. Refused in order: the name empty
  (`TONE_NAME_RULE`), the ID not kebab-case (`TONE_ID_RULE`) or another guideline's while adding,
  then the guidance empty (`TONE_GUIDANCE_RULE`), where the add form left the ID to native
  `pattern` and `required`, and the add form and the open row both refused an empty guidance only
  natively, and one of spaces not at all. The fields and the builder are `lib/toneGuidelines.ts`;
  both texts are stored stripped.
- **A template's parameters.** Each parameter is an item under *Typed parameters*
  (`Workspace.dc.html` :607) — the name in monospace with no second key, the kind (`EntryKind`)
  and *bound same-shop* as its tag, and as the detail the description, the default where the kind
  carries one and how a scenario binds it as `check_bindings` holds it (`bindingSentence`):
  `binding_missing` is raised for a required parameter with no default and nothing else, whatever
  the kind, so such a parameter reads "A scenario must bind this." (a reference "Always bound by
  the scenario…"), one with a default "A scenario may leave it to the default.", and any other "A
  scenario may leave it unbound." — with `optional_parameter_without_default`'s `GateFindingLine`
  under them. ↑ and ↓ ("Move {name} up/down", unchanged) stand before the pencil at the icon
  buttons' 30px (`MoveButton`, `itemMoveButtonClasses`), natively disabled at the end they cannot
  pass, because the order is authored; they are free while the form edits any parameter. The one
  form, "Add a parameter" / "Edit {name}", asks what the add form and the open row asked between
  them: *Label* — derived to an identifier with its "Saved as" line while adding, shown and fixed
  while editing, because a scenario binds by it — *Kind*, *Description* and *Default* (both
  optional) and the checkbox that writes `required`, now named "A scenario must bind this, unless
  the template gives a default", which is what `required` holds a scenario to; the gate's finding
  under it as before (ADR 0063's lab amendment), naming the parameter only once a label is typed
  while adding. A reference is asked the checkbox only when the draft holds it as not required and
  its kind is kept, which is the one way the gate's "make it required" is answered here. Edit
  moves focus to *Kind*, the first field the form asks while editing. Refused, adding only: the
  template's cap (`PARAMETERS_FULL`, which marks no field), then an empty label
  (`PARAMETER_LABEL_RULE`); an edit asks nothing the lab refuses. The labels "Kind of {name}",
  "Description of {name}" and "Default of {name}" give way to the form's own. `ParameterForm`
  stays the new-block page's; `withParameter` and `parameterRefusal` in `lib/blocks.ts` are the
  editor's, and `parameterEntry` stores the description and the default stripped, a default of
  only spaces as none.
- **The parameter's kind, requiredness and default are one unit through a discard** without
  `units`: the form follows the entry whole while clean and keeps all it holds while dirty, so a
  kind never follows the record under a default typed for another, and no reference reaches the
  draft with a default.
- **`useEntryEdit` loses `units`.** Its one consumer left, so the hook follows field by field
  again; the variants table and a scenario's composed blocks declared no unit.

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

- The prototype draws each option as a field row of its own, labelled by the option's name, its
  chips in a field and *Remove this option* under them (`Workspace.dc.html` :955–975); the
  options are items with their chips as the detail and one form below, as the milestone
  decides.
- The four list rows' labels — *Declared*, *References*, *Attributes*, *Reviews* — and the option
  and attribute forms' hints are the slice's own: the prototype draws no media, attribute or
  review list on the product frame.
- The forms refuse before the press what the add forms left to the lab: a number's or a
  measurement's value that is no decimal, a yes-or-no's that is not `true` or `false`, and a
  choice's value that is none of its choices. The alt text, an empty value and a measurement's
  unit, which the add forms left to native `required`, move to the line after the buttons. A
  decimal is read narrower than Python's `Decimal`, which also takes digit-grouping underscores:
  the form refuses what the lab might accept rather than letting through what it would not.
- A review's form opens on five stars again after each addition, where the add form kept the
  last rating chosen: the form's blank is the one place it starts.
- A review's body stays one line, as the add form and the open row asked it.

- The prototype's *Make default* button on a guideline (`Workspace.dc.html` :1926–1928) stays
  the radio, the operator's decision of 29 September 2026.
- The prototype draws a parameter as a read-only item of name, kind and *same-shop*
  (:611–616); the item carries the description, the default, the binding, the arrows, the pencil
  and the trash, and the form below authors it.
- The guidelines' row label, *Voices*, and both forms' hints are the slice's own; the prototype
  draws none. *Typed parameters* keeps the prototype's label, and its hint says what the arrows
  do rather than the prototype's sentence about same-shop bindings, which the card's line says.
- The guideline's guidance and the ID are refused before the press, in the line after the
  buttons, where the add form left the ID to native validation, and the add form and the open
  row refused an empty guidance only natively, and one of spaces not at all.
- A required parameter with a default reads "A scenario may leave it to the default." on its
  item, an optional one with none "A scenario may leave it unbound.", as does a reference that is
  not required, and the checkbox says "unless the template gives a default", where the open row
  said a scenario must bind it: `check_bindings` lets a scenario leave each of them unbound.
- A guideline typed in the form is unsaved work the prompt names, where the add form was not
  (ADR 0051's *a half-typed create form is not unsaved work*): the form below a list is one form
  for adding and editing, and ADR 0074 decided it registers either way.

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

- The accessible names that moved with the product's four lists: the open rows' forms "Edit
  {name}", "Edit {reference}" and "Edit review {id}" (now groups of the same name), their "Save
  {name}", "Save review {id}" and "Cancel editing {name}" (now *Save changes* and *Cancel*), the
  four add forms' unnamed forms (now the groups "Add an option", "Add a media reference", "Add
  an attribute" and "Add a review"), the option's trash, whose visible "Remove {name}" became
  its glyph with the name kept, and the line "Editing {name}. Save or Cancel before opening
  another row" (gone). Every item's Edit and Remove, *Option name*, *Option key*, *Values*,
  *New value*, *Reference*, *Alt text*, *Label*, *Key*, *Type*, *Value*, *Unit*, *Choices*,
  *Author*, *Rating*, *Body*, and *Add option*, *Add media*, *Add attribute* and *Add review*,
  kept their names. No spec was touched: the six journeys that add an option fill it through
  the add form, and `sticky-header` adds a review through it, whose *Add review* stays in view
  at the foot of the page.
- `useEntryEdit` leaves the product's options, media, attributes and reviews; the product's
  variants, the tone-of-voice guidelines and a template's parameters (until the third amendment,
  above, and *The guidelines and a template's parameters*), and a scenario's composed objectives
  and mutations keep it. Its `units` keeps a consumer in a template's parameters, whose kind,
  requiredness and default follow as one unit (`BlockEditorPage.tsx`, `Blocks.test.tsx`), until
  that same amendment.

- The accessible names that moved with the guidelines and the parameters: the open rows' forms
  "Edit {name}" (now groups of the same name), their "Save {name}" and "Cancel editing {name}"
  (now *Save changes* and *Cancel*), "Kind of {name}", "Description of {name}" and "Default of
  {name}" (now the form's *Kind*, *Description (optional)* and *Default (optional)*), the
  checkbox "A scenario must bind this" (now "A scenario must bind this, unless the template gives
  a default", which no spec reaches), the item's binding line for a required parameter with a
  default (now "A scenario may leave it to the default.") and for an optional parameter with none
  and a reference that is not required (now "A scenario may leave it unbound."), the editor's
  form "Add a parameter" (now a group of that name; the new-block page's form keeps it), the
  guideline add form's unnamed form (now the group "Add a guideline"), every guideline's and
  parameter's visible *Remove* (now the trash, its name kept), the line "Editing {name}. Save or
  Cancel before opening another row" (gone), and the paragraph under the guidelines (now
  *Voices*' hint). "Make {name} the shop default", "Move {name} up/down", "Edit {name}", "Remove
  {name}", *Name*, *ID*, *Guidance*, *Label*, *Kind*, *Add tone of voice*, *Add parameter* and
  the card's "Guidelines" kept their names. Specs touched: `block-library` (the form a group,
  `editRow` become `editItem`, *Description* and *Default* by their own labels, and a parameter
  moved up before it is given a default), `scenario-authoring` and `experiment-start` (the
  parameters through `editItem`, their composed blocks still on `editRow`), and `sticky-header`
  (its tour step's pane, below). `agent-configuration`, `shop-publication`, `ticket-authoring`,
  `tour-anchors` and the other journeys that fill a guideline's *ID*, *Name* and *Guidance* and
  press *Add tone of voice* were not touched.
- `sticky-header`'s tour step "taller than the room under the header" read its premise off the
  Guidelines card's height, which compact items shrink. The card is now mostly its form, and at
  1280×720 it outgrew the room by some 80px; the test sets a 1280×560 pane, so the premise is the
  test's own rather than a margin the form's next field could take away.
- `useEntryEdit` keeps two consumers, the variants table and a scenario's composed blocks, and
  loses `units`, with its `EntryCard.test.tsx` case and the sentence ADR 0051's amendment gave
  it.

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
- `lib/productEntries.test.ts`: every combination of each product form's broken fields refused
  with the first in the order it asks, while adding and while editing; a key another entry
  holds and one past the cap; a reference another entry holds as the lab would store it, its
  own excepted; the value each attribute type holds; every text stored stripped.
  `ItemList.test.tsx`: a name that is its own key, a drawn detail, and a form holding a list
  clean while its values are the ones it was filled with.
- `App.test.tsx`, *a product's four lists, edited in the form below them*: each form's rules
  walked in the order its controls stand (`expectRulesInFieldOrder`, which reads a read-only
  key and a star's radio as breaking no rule); a blank form refused and unmarked; an option
  loaded, given a value and saved where it stands with focus out and back; the option key and
  the attribute key fixed while editing, and an option key derived and refused while adding; a
  media reference another entry holds refused after *Save changes* and *Add media*, the field
  marked and described by the one line; a reference moved where it stands; the option's removal
  emptying the form and taking its variants' values (ADR 0060); a clean option form following a
  Discard and a dirty one keeping its work; an attribute's type, value and choices one unit
  through a Discard, and a choice whose value is none of its choices refused after one; the
  prompt for a typed option and an edited review; an untouched option, media entry and review
  saved leaving the draft clean. The S-tests of *a product's identity* keep an edit typed in the
  options form, its element and its focus through three kinds of discard.
  The same block cancels an edit on each of the four lists to an empty add form with focus on
  the Edit; leaves nothing typed in *New value* behind a *Cancel*, a *Save changes* or another
  option's Edit; and asks nothing when an option is loaded and left untouched before leaving,
  as *Duplicate* does not either (*deleting and duplicating a product*).
- `lib/toneGuidelines.test.ts`: every combination of the guideline form's broken fields refused
  with the first in the order it asks, the ID only while adding, one another guideline holds
  and one past the cap; both texts stored stripped. `lib/blocks.test.ts`: the cap before the
  label while adding, nothing asked of an edit, and every field the form asks added under a
  derived name, stored stripped. `ItemList.test.tsx`: a lead before the name, and arrows named
  by the entry before the pencil, the end they cannot pass disabled. `lib/ui.test.ts`: the
  arrows' class set.
- `App.test.tsx`, *a tone-of-voice guideline's own rules*: a guideline loaded with its ID fixed
  and focus on *Name*, its guidance reworded and saved where it stands, the radio still naming
  the default; the edit form's rules walked in the order its controls stand
  (`expectRulesInFieldOrder`); the ID refused after the name and before the guidance while
  adding; the radio free while the form holds a nameless edit, moving the default, and an edit
  never moving it back; *Cancel* emptying the form with focus on the Edit; an untouched guideline
  saved leaving the draft clean; a typed guideline asked about before leaving. The open-row
  cases of *editing a saved entry in place* and *unsaved work is protected* that read the
  guidelines read a variant's row instead.
- `Blocks.test.tsx`: each parameter's item read back, its controls in order; a parameter loaded
  with its name fixed and focus on *Kind*, saved where it stands; an empty label refused in
  field order (`expectRulesInFieldOrder`) and a blank form unmarked; the cap refusing an
  addition, marking nothing, and leaving an edit free; ↑ on one item while the form edits
  another, the edit kept and saved after the move; *Cancel* and an untouched *Save changes*
  writing nothing; the prompt for a typed and an edited parameter; the removal emptying the
  form. *Objective block editor* and *mutation block editor*: the finding on the item and in the
  form; a description and a default given while adding; and the Discard pair — a dirty form
  keeping its kind, requiredness and default, a clean one following the lab's reference whole —
  each proving no reference reaches the draft with a default.
- `App.test.tsx`: a variant's stored option value its option no longer offers shown in the open
  row's select as the disabled "(not offered)" entry and saved as it was through a SKU-only
  correction; an offered value picked replacing it.
- `Experiments.test.tsx`: a preview answered `408` and one answered `429` each said above the form
  and not on Start's refusal line, Start left free, and the alert gone once a later preview
  answers.
