# UX plan — a list is edited in the form below it

Status: proposed — 2026-09-29. Open slices only: a slice that lands is removed from this file.
Supersedes the 13 September plan, whose delivered Slices 1–8 and reread Slices 9–16 are in
`docs/history/PLAN-UX-2026-09-13.md`; the 20 September plan, whose delivered Milestone 8's goal
and acceptance criteria are in `docs/history/PLAN-UX-2026-09-20.md`; and the 28 September plan,
whose delivered Milestone 9's are in `docs/history/PLAN-UX-2026-09-28.md`.

## Purpose and authority

`docs/PLAN.md` records what the lab holds; this plan records how the operator's workspace reaches
the design it was handed on 19 September 2026: the whole-workspace prototype in
`tmp/design-frames/Workspace.html`, its handoff `README.md`, and `form-decisions.md`. Since
29 September 2026 it also records how the lists an editor edits with a form reach the pattern
Shop details' *Payment methods* draws (Milestone 10). Read, in
order, `AGENTS.md`, `docs/product-direction.md`, `docs/architecture.md`, `docs/PLAN.md`'s delivery
rules, `docs/design-direction.md` (its *Authority* section settles which authority governs where the
prototype, the README and the codebase disagree), then a slice's brief and the ADRs it names.
ADR 0052 and ADR 0053 decide the model connection and the provider, and both are implemented;
ADR 0054 is the route scheme every slice is written against.

The plan sits under `docs/PLAN.md`'s delivery rules and changes none of them.

## What every slice observes

- **One branch, one slice.** Branch from an up-to-date `main`, land by fast-forward, delete the
  branch. The suggested branch name is given per slice.
- **The prototype is the frame.** A `Frames:` line names the screen by its line in
  `Workspace.dc.html` and the numbered frame under `tmp/design-frames/DEPRECADED/` where one
  still describes the surface's composition. Where the prototype, the README and the codebase
  disagree, `docs/design-direction.md`'s *Authority* section decides, and the slice writes
  the departure in one sentence. "The handoff is silent" is not a licence.
- **The primitive ships with its first consumers.** A component or a token no page uses is not a
  slice.
- **Behaviour tests first.** Vitest with React Testing Library for what the operator sees, MSW
  where HTTP participates, Playwright only where a covered journey changes. `make check` and
  `pnpm build` pass before handoff, and `pnpm test:e2e` when the *Checks* line names a spec.
- **No new UI dependency.** The primitives are the class sets in `lib/ui.ts` and the chrome in
  `components/WorkspaceChrome.tsx` and `shell/AppShell.tsx`.
- **No backend change unless the slice says so.** None of the slices below says so.
- **Standing decisions hold.** ADR 0044 refused a stored checklist and ADR 0045 removed the
  derived progress strip; ADR 0049 keeps the tours per surface; ADR 0051 asks about unsaved work
  once; ADR 0052 and ADR 0053 decide the connection and the provider; ADR 0054 decides the two
  modes and the routes, ADR 0055 the top bar — the switcher's menu, the one tour mount that
  reads the route, and Settings as a toggle over a remembered location — and ADR 0056 puts the
  listings a rail counts on the workspace, with the index reading the same one. Where a slice
  takes a decision of its own — a route scheme, a confirm policy, a preference — it writes an
  ADR.
- **Accessible names do not move casually.** `nav[aria-label="Shop workspace"]`, the tour
  anchors and every button's name are what eleven Playwright specs reach the app by — as is
  `nav[aria-label="Experiment lab workspace"]` beside it. A slice that renames one lists the
  specs it touched.

## Decisions already taken

Three things the prototype draws are decided outside this plan, so that no slice has to:

- **The lab is a mode, and the routes say so** — ADR 0054: the two modes, the `/lab` route
  scheme, the current-shop rule, the redirects, and what the shop rail lost. Landed; every
  slice below is written against the routes it left behind.
- **The overview's readiness card reads one listing** — `docs/design-direction.md`,
  *Navigation and chrome*. Built with the overview. The setup pages' checklist reads the shop's
  own gate and nothing else (ADR 0071).
- **A rail entry's count comes from the listing its index renders**, held by the workspace —
  ADR 0056, which also measured and refused the additive counts read. Landed.
- **Three of the five proposed preferences earn a consumer**, and the logo was built as a shop
  customization — `docs/design-direction.md`, *Proposals, not decisions*. Two landed with the
  settings zones, and how a timestamp is written and what a reset puts back are ADR 0058;
  confirm-before-delete landed with the confirm it governs (ADR 0060); the logo is ADR 0070.

The assessment that produced this plan — the prototype read screen by screen against the
application, and the verdict on each slice of the 13 September plan — is
`docs/history/PLAN-UX-2026-09-13.md`.

## Sequencing

Milestones 8 and 9 are delivered. Their record is the commits and ADR 0052–0073; their goals and
acceptance criteria are `docs/history/PLAN-UX-2026-09-20.md` and
`docs/history/PLAN-UX-2026-09-28.md`. Milestone 10's first slice, 36, is delivered: it shared the
method list (`components/ItemList.tsx`, `lib/itemForm.ts`), put an order's lines and events on it
and wrote ADR 0074, which the rest cite. Its three remaining slices run in order, 37 to 39, one
editor or pair of editors to a branch:

- **37** takes the customer editor and an identity's guidance: prose lists whose items carry no
  control of their own beyond *Make default*, and it adds the Playwright helper that edits an item.
- **38** takes the product editor's four lists: one route file, one test file and one scope
  (ADR 0061), and none of them reached by a spec that edits.
- **39** takes the two lists that keep a control on the item — the default guideline's radio and a
  parameter's ↑/↓ — for which the item gains its `lead` slot and the actions their arrows. It
  follows 37, whose helper its block journeys use.

## Milestone 10 — A list is edited in the form below it

### Goal

An operator correcting an order's line, an address or a guideline meets the list Shop details'
*Payment methods* draws, so that editing an entry is learned once. The pattern replaces the open
row (`EntryCard` edit mode) on the lists named below, as the operator asked on 29 September 2026.
The change is the UI's only: no backend, contract or payload moves. The slices' `Frames:` lines cite
the methods handoff ADR 0072 was built from
(`tmp/design-frames/design_handoff_shop_details_methods/shop-details.template.html`) beside
`Workspace.dc.html`.

The pattern is what `components/ItemList.tsx` and `lib/itemForm.ts` draw (ADR 0072, ADR 0074):

- **Two rows in the card** (`FieldRows`): the list under its row label and hint, then the form,
  labelled "Add a …" while adding and "Edit {name}" while editing, with its hint. A list row takes
  the prototype's label where it draws one — *Items* (`Workspace.dc.html` :2745), *Entries*
  (:2880), *Typed parameters* (:607) — and otherwise one the slice writes for what the list holds;
  a hint only where its rule is true (*Guidance lives under the field*).
- **An item** (`ListItem`): the name at 13.5px 700, the ID in monospace, one detail line;
  its actions — a control of the list's own where it has one, the 30px pencil, the 30px trash —
  wrapping as one group; `aria-current` and the pine border and ground while the form holds it.
- **Edit** loads the item into the form, highlights it and moves focus to the form's first field;
  a key another record names the entry by is shown and fixed while editing. *Save changes*
  writes the entry where it stands and *Cancel* empties the form, both returning focus to that
  Edit; an Edit while the form holds something replaces it.
- **Remove** is the trash, named "Remove {name}", asking twice under the preference (ADR 0060):
  `ConfirmRemove` takes the item's place and the notice line takes focus after.
- **One refusal line after the buttons** (`ItemFormRow`): the submit is `PrimaryAction`,
  refused with the first rule the form breaks in the order its fields ask, said once in a polite
  live region; the field that breaks it is `aria-invalid` and described by that line; a blank form
  is refused and says why and marks nothing until something is typed; the handler checks the
  refusal too (ADR 0063, ADR 0072).
- **The form is unsaved work** while it holds something other than what it was filled with
  (`useItemForm`; ADR 0051); an entry taken off the list while the form edits it empties
  the form, and a clean edit follows the draft through a discard.

The lists converted: an order's line items and events; a profile's addresses, background and
hidden facts; an identity's guidance; a product's options, media, attributes and reviews; the
tone-of-voice guidelines; a template's parameters. Not converted, as the operator scoped it: the
product's variants table, a scenario's composed objectives and mutations, the create pages' rows
and a ticket's thread.

### Slice 37 — A profile's lists and an identity's guidance

The customer editor's three lists and the support identity's guidance are edited in the form below
them.

- [ ] **Addresses** (`CustomerEditorPage.tsx:651`): items — the label as the name, the entry's ID,
  `addressLine` (:1184) as the detail — with the *Default* pill beside the name (:695–699) and
  *Make default* ("Make {label} the default address", :740–749) in the item's actions before the
  pencil, as the prototype draws it (:2888–2891); the default carries none. `AddressForm` (:1245)
  and `AddressFieldset` (:1203) become the one form, "Add an address" — the name its group already
  has — / "Edit {label}", with `ADDRESS_FIELDS_RULE` (`lib/fieldRules.ts:587`) after the buttons.
  The default is never the form's answer (:713–716), and the country still follows the profile's
  locale while adding.
- [ ] **Background** (:822): the date · kind as the name, its controls' names unchanged (:880), the
  ID, the note as the detail; `BackgroundForm` (:1321) and `BackgroundFieldset` (:136) the one
  form, "Add a background entry" / "Edit {date · kind}", submitted by *Add entry*.
- [ ] **Hidden simulator facts** (:920): the fact as the name, its controls' names unchanged (:968),
  the ID, "Revealed when …" as the detail where it has one; `HiddenFactForm` (:1351) and
  `HiddenFactFieldset` (:182) the one form, "Add a hidden fact" / "Edit {fact}", submitted by *Add
  fact*.
- [ ] **Guidance** (`SupportIdentityEditorPage.tsx:284`): the title as the name, the ID, the body as
  the detail; `GuidanceForm` (:517) and `GuidanceFieldset` (:486) the one form, "Add a note" /
  "Edit {title}", submitted by *Add guidance*.
- [ ] Each form's rules, today a native `required` on each field it needs (`CustomerEditorPage.tsx`
  :173, :196; `SupportIdentityEditorPage.tsx` :500, :509), are said after the buttons in field
  order, in the lab's words where `lib/fieldRules.ts` holds them. The editors' `useEntryEdit`
  (:242–250; `SupportIdentityEditorPage.tsx:99`) and `EntryEditNotice`s (:774, :899, :989;
  `SupportIdentityEditorPage.tsx:349`) go.
- [ ] `tests/e2e/support/authoring.ts` gains `editItem`: press "Edit {name}", answer inside the
  group "Edit {name}", press its *Save changes*, and see the group go. `editRow` (:29) stays for a
  scenario's composed blocks, and its comment says so.
- [ ] `docs/design-direction.md`: the list rule names these four lists, and *A saved row opens
  where it stands* loses them; *A blocked primary action says why* rewrites *Add address*'s reason
  (:488–489); *Every editor section is on rows* (:380–382) stops citing "the guidance form" as an
  add form that stacks.

Frames: `Workspace.dc.html` :2877–2899 (the address book: the *Entries* row :2880, an item :2884,
the pill :2888, *Make default* :2891), :1853–1866 (guidance); methods handoff
`shop-details.template.html` :160–186.

Authority: ADR 0051, ADR 0060 (the address removal's findings), ADR 0063, ADR 0074.

Departures to record: the prototype draws an address with neither Edit nor Remove (:2884–2893)
and a guidance note with a one-press × and no Edit (:1858–1866); the items carry the pencil and a
trash that asks twice.

Branch: `feat/profile-and-guidance-lists`. Checks: `Customers.test.tsx` *editing a saved customer
entry in place* (:1087), which becomes loading into the form, *removing is deliberate* (:1285) and
*the address book* (:1879) — the confirm in the item's place, *Make default* on the item, the
default untouched by an edit, each form's first rule after its button, the prompt for a typed
address and an edited fact; `SupportIdentities.test.tsx` *editing a saved guidance note in place*
(:457) and *support identity workspace* (:189). Playwright `order-fixture` (:27 the group "Add an
address"; :132 `editRow` becomes `editItem`, with "Street" in the form), `customer-publication`
(:55 the group, :66 *Add address*, and :67 `getByText("Default")`, which the *Entries* row's hint
must not make ambiguous — keep "default" out of it or make the read exact, and say which),
`experiment-start` (:134–152, *Make Home the default address*), `scenario-authoring` (:103–117)
and `ticket-authoring` (:109). The names that move — the open rows' forms "Edit {label}", "Save
{label}", "Cancel editing {label}" — are reached only by `order-fixture.spec.ts:132`, through
`editRow`.

Slice evidence: on a profile, the operator presses the pencil on "Bordeaux previous flat", the form
reads "Edit Bordeaux previous flat", a new street saves into the item, and *Make default* on
another entry moves the pill; an identity's guidance note is corrected the same way.

### Slice 38 — The product editor's four lists

A product's options, media, attributes and reviews are edited in the form below them.

- [ ] **Options** (`ProductEditorPage.tsx:788`): the option's name, its key as the ID, its values as
  the detail, the `ChipList` the row already draws (:820). The add form (:883–921) is the one form,
  "Add an option" / "Edit {name}": *Option name*, *Option key* (`DerivedIdField` while adding,
  fixed while editing — a variant chooses by it) and *Values* (`OptionValuesField`, :737), with
  `OPTION_NEEDS_VALUE` (:728) after the buttons. "Remove {name}" stays the trash's name and stops
  being its visible word (:871).
- [ ] **Media references** (:1479): the reference in monospace as the name — its own key, which
  nothing else names, so it stays editable while editing (`docs/design-direction.md` :315) — and
  the alt text as the detail. `MediaFieldset` (:1407) is the one form, "Add a media reference" /
  "Edit {reference}", submitted by *Add media*. `MEDIA_NEEDS_REFERENCE` (:731) and a reference
  another entry holds move from the Reference field's second line (`extra`, :1425) to the line
  after the buttons, the field `aria-invalid` and described by it.
- [ ] **Custom attributes (typed)** (:1727): the label, the key as the ID, the type (`EntryKind`)
  beside them, and the value with its unit and "one of" its choices as the detail (:1798–1812).
  `AttributeFieldset` (:1614) is the one form, "Add an attribute" / "Edit {label}", submitted by
  *Add attribute*, the key derived while adding and fixed while editing; the type still decides
  what the value, unit and choices ask.
- [ ] **Ratings & reviews** (:1895): "{rating}★" as the name, the review's ID, "“{body}” —
  {author}" as the detail, the line `sticky-header` reads; the controls keep "review {id}"
  (:1959). `ReviewFieldset` (:1852) with `StarRatingField` (:2017) is the one form, "Add a
  review" / "Edit review {id}", submitted by *Add review*.
- [ ] The four cards' `useEntryEdit` (:764, :1454, :1706, :1886) and `EntryEditNotice`s (:881,
  :1571, :1820, :1973) go; the removals keep `useRemoval(product.key, discarding)` (ADR 0061), and
  the page is keyed by the product (:161), so no form carries one product's edit onto another. The
  variants table (:1021) is untouched.
- [ ] `docs/design-direction.md`: the list rule names the product's four lists, and *A saved row
  opens where it stands* keeps the variants alone of the product's; *A blocked primary action says
  why* rewrites *Add media*'s reason (:489–490), and *Two refusals with one cause are one sentence*
  (:504–507) its media sentence.

Frames: `Workspace.dc.html` :955–975 (an option: its name, its values, the confirm in its place);
methods handoff `shop-details.template.html` :160–186. The prototype draws no media, attribute or
review list on the product frame.

Authority: ADR 0060 (an option's removal takes its variants' values), ADR 0061, ADR 0063,
ADR 0074.

Departures to record: none beyond ADR 0074's, unless the slice finds one; the *Departures* row
"The option's confirm" (`docs/design-direction.md` :150) still holds, the confirm taking the
item's place.

Branch: `feat/product-lists-in-one-form`. Checks: `App.test.tsx` *editing a saved entry in place*
(:2356 — the option :2461, the attributes :2493, :2530, :2557, the review :2601), the media
refusals (:2773, :2829), the keys derived and fixed (:1510), the saved rows read back (:1267, :1284,
:1345, :1842), the chip fields (:1666, :1709), the stars (:1762) and *removing is deliberate*'s
option confirms (:4597–:4715) — each through the one form, with the prompt for a typed option and
an edited review. Playwright `agent-configuration`, `shop-publication`, `experiment-start`,
`order-fixture`, `scenario-authoring` and `ticket-authoring` fill *Option name* in *Options*,
press *Add option* and read "Remove Ocean Blue", a value chip's name in the form
(`shop-publication.spec.ts:103`), none of which moves; `sticky-header` adds a review through
*Author*, *Body* and *Add review* in the region "Ratings and reviews", reads its line and holds *Add
review* in view at the foot (:55–72, :207–226), which the shorter items must keep true. The names
that move — the open rows' forms and their Save and Cancel — no spec reaches.

Slice evidence: on a product, the operator loads an option into the form, adds a value, and saves;
a media reference another entry holds is refused after *Save changes* with the field marked; the
variants table still opens in place.

### Slice 39 — Tone of voice and a template's parameters

The two lists that keep a control on the item — the default guideline's radio, a parameter's
↑/↓ — are edited in the form below them.

- [ ] The item gains a `lead` slot before the name, as `EntryCard`'s `lead`
  (`WorkspaceChrome.tsx:578`), for a control the list keeps on each item that is neither Edit nor
  Remove and reads first.
- [ ] **Guidelines** (`ShopSetupPages.tsx:447`): the default radio as the item's lead (:488–501,
  "Make {name} the shop default", unchanged), the name with `DefaultToneChip` (:506), the slug as
  the ID (the *Departures* row "A guideline's `slug · version` line", `docs/design-direction.md`
  :146), the guidance as the detail; the default's way-out line (`TONE_DEFAULT_REMOVAL_RULE`, :550)
  stands where its trash would (*A refusal that has a way out*, :520). The add form (:572–629) is
  the one form, "Add a guideline" / "Edit {name}": *Name*, *ID* (derived while adding, fixed while
  editing — an agent configuration names a guideline by it) and *Guidance*, with `TONE_NAME_RULE`
  after the buttons; *Add tone of voice* keeps its name, and the card its name "Guidelines", the
  tour's anchor (`lib/tours.ts:472`). The radio is the list's, never the form's, as the payment
  switch is (ADR 0072): it reads the draft, which always holds the guideline's saved name, so it is
  no longer refused while the form holds a nameless edit (:420–432, :450–454, :494–496), and an
  edit still never moves the default (:520–522).
- [ ] **Parameters** (`BlockEditorPage.tsx:260`): `ParameterRow` (:350) becomes an item — the name
  in monospace, the kind (`EntryKind`) and *bound same-shop* beside it, the description, default
  and binding as the detail (:450–481), `optional_parameter_without_default`'s `GateFindingLine`
  under it (:482–486) — with ↑/↓ ("Move {name} up/down", unchanged, :415–432) at the icon buttons'
  30px before the pencil, because the order is authored. One form, "Add a parameter" / "Edit
  {name}", asks what the add form and the open row ask between them: *Label* (derived to an
  identifier with its "Saved as" line while adding, fixed while editing — a scenario binds by it),
  *Kind*, *Description*, *Default* and *A scenario must bind this* (`ParameterFieldset`, :496),
  the gate's finding under the checkbox as today (ADR 0063's lab amendment). Refused after the
  buttons, in order: the cap (`PARAMETERS_FULL`, `components/ParameterForm.tsx:11`; adding only),
  an empty label. `ParameterForm` stays the new-block page's. The labels "Kind of {name}",
  "Description of {name}" and "Default of {name}" (:514, :532, :547, :562) give way to the form's
  own.
- [ ] `docs/design-direction.md`: the list rule names the guidelines and a template's parameters,
  and *A saved row opens where it stands* keeps only what stays on `EntryCard` edit mode — the
  variants and a scenario's composed blocks — and says so; the *Departures* rows "*New guideline*
  on the Guidelines card" (:148), "The guideline editor's two validation messages" (:149) and "A
  template's parameters" (:166) are rewritten for the form; *Two refusals with one cause are one
  sentence* (:504–507) loses its guideline example and is rewritten, or removed if no example is
  left, as the slice says; *A blocked primary action says why* rewrites *Add parameter* at the cap
  (:487).

Frames: `Workspace.dc.html` :1914–1935 (a guideline: its pill, its slug line, *Make default* and
*Edit*), :604–620 (a template's *Typed parameters*, an item :611); methods handoff
`shop-details.template.html` :160–186.

Authority: ADR 0051, ADR 0060, ADR 0063 (and its lab amendment), ADR 0072 (the list's control is
never the form's), ADR 0074.

Departures to record: the prototype's *Make default* button on a guideline (:1926–1928) stays the
radio, the operator's decision of 29 September 2026; the prototype's read-only parameter item
(:611–616) is the *Departures* row this slice rewrites.

Branch: `feat/guideline-and-parameter-lists`. Checks: `App.test.tsx` *a tone-of-voice guideline's
own rules* (:2894 — :2953's radio refused beside a nameless open row becomes a radio that stays
free while the form holds one), :1425, :1493; `Blocks.test.tsx` *a template's parameters* (:1195),
*objective block editor* (:595) and *mutation block editor* (:817) — ↑/↓ on the item, the finding on
the item and in the form, a description and a default given while adding. Playwright
`block-library` (:59 and :118 read the form "Add a parameter", which is now a group of that name;
:63, :71, :122 and :135 `editRow` becomes `editItem`, reaching *Description* and *Default* by their
own labels), `scenario-authoring` (:221, :244, :249) and `experiment-start` (:257, :296, :301) the
same, their composed-block edits (:301, :314; :375, :386) staying on `editRow`;
`agent-configuration` (:27–31), `shop-publication`, `scenario-authoring`, `ticket-authoring` and
`experiment-start` fill the guideline's *ID*, *Name* and *Guidance* and press *Add tone of voice*,
unchanged; `sticky-header`'s tone-of-voice editor (:515–525) the same, and its tour step "taller
than the room under the header" (:470–495), whose premise is the Guidelines card's height, which
compact items shrink — the slice restores the premise and says how; `tour-anchors` for
`[aria-label="Guidelines"]`.

Slice evidence: on Tone of voice, the pencil on "Warm and precise" loads it into the form with its
ID fixed, *Save changes* rewords it, and the radio still names the shop default; on an objective
block, a parameter is moved up, loaded into the form, given a default and saved.

### Acceptance criteria

- Every list named in the goal is items in one row of its card and one form in the next, and none
  of them opens in place.
- Edit loads and highlights the entry and fixes the key another record names it by; *Save changes*
  writes it where it stands; *Cancel*, and the entry's removal, empty the form; focus goes to the
  form's first field and back to the Edit.
- Every Remove on them is the trash, asking twice under the preference, the confirm in the item's
  place.
- Every form's submit is refused before the press with the first rule it breaks, in one line after
  its buttons.
- A form holding something is unsaved work, and the prompt says it cannot be saved from there.
- Shop details' two cards draw, sound and behave as before, through the shared pieces.
- ADR 0074 records the pattern and what stays on `EntryCard`; nothing in the backend or a contract
  moved; the Playwright journeys pass, and every moved accessible name lists the specs it touched.

## Deliberately not here

- **Any reading of what the lab still lacks across listings.** ADR 0044 and ADR 0045 stand; the
  overview's readiness card reads one listing and says one sentence, and the setup checklist
  reads the shop's own gate only (ADR 0071).
- **Checklist lines in an editor's Publish gate card.** The card is a frame over the findings
  `IssueList` draws; only the setup pages carry lines (ADR 0071).
- **Counts on History's status chips.** The listing carries none.
- **Auto-offered tours and table density.** Neither preference decides anything a surface reads;
  ADR 0049 refused the first outright.
- **A model on the connection, a masked key, a per-configuration endpoint.** Refused in ADR 0052
  and ADR 0053 with the reasons; the prototype's rows for them are departures already recorded.
- **Merging the three document lists in the payload.** The Documents table is a presentation of
  three lists and not a new canonical shape; `lib/documents.ts` writes every row back into the
  collection it came from, and a document is named by its kind and its slug (ADR 0057).
- **The next-step sentence from `SETUP_CHAIN`**, `GuideProse` card footers, the matrix's per-cell
  evidence sentence and a copy control on `Fingerprint` — the parts of the old Slices 13 and 16
  the prototype does not draw.
- **A component library or a new UI dependency.** The `CreatePage` layout, `ConfirmRemove` and
  `ActionStatus` are small components on the existing chrome, as the switcher's panel was.
- **The product's variants, a scenario's composed blocks, the create pages' rows and a ticket's
  thread in the form below them.** Outside Milestone 10 as the operator scoped it; they keep
  `EntryCard` and `EntryEditButtons`, and the thread its composer (ADR 0073).
- **Read-only version pages for configurations and scenarios.** The results link a pinned
  version to its definition's editor (ADR 0068); a frozen view per definition is worth its own
  slice in `docs/PLAN.md` if a review journey needs it.
