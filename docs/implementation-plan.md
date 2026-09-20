# Landing this mockup in `agent-framework-lab`

Written against the repo's own conventions: `docs/PLAN.md` delivery rules, `docs/PLAN-UX.md`
slice format, `docs/design-direction.md` frame authority, ADRs for decisions. Nothing below
invents a new process — it puts this work into the one already there.

---

## 0. First, separate the three kinds of change

The mockup looks like one thing. It is three, and they land differently.

**A — Pure presentation.** Button colour, icons, hover states, stat strip removal, field
alignment, rail icons, page-header alignment. No contract, no migration, no ADR. These are
edits to `lib/ui.ts` and the route files that consume it.

**B — Behaviour the backend already supports.** Guideline editing, scenario creation, binding
the product/customer editors to the clicked row. The API and contracts already carry these;
the mock exposes what the UI was not reaching.

**C — Genuine architecture decisions.** Two of them, and they are the long pole:

1. **Model provider becomes lab state, not environment state.** Today the provider, base URL,
   key and model are composed at start-up from `AGENT_LAB_OPENAI_API_KEY`, and
   `LabSettingsPage` reports them read-only. The mock makes them editable and lab-wide.
   That contradicts ADR 0044's refusal of a settings table, so it needs its own ADR, not a
   UI slice.
2. **`provider` on an agent configuration.** Additive contract + migration + validation
   against the proven-framework table, and a pin at publication so a recorded run keeps the
   provider it ran against.

Do C's ADRs before any of C's code. A and B can land in parallel and do not wait on them.

---

## 1. Make the mockup citable

`docs/design-direction.md` already says the authoritative frames live in `tmp/design-frames/`,
one self-contained `.dc.html` per frame, and that **UI slices cite frames**. This mockup is a
single document holding ~40 screens, so it does not fit that shape as-is.

Do this:

- Export the workspace mock into `tmp/design-frames/` as `Workspace.dc.html` (the standalone
  bundle already produced), and add it to the README index as the **navigation, chrome and
  form-pattern reference** — explicitly superseding the per-screen frames where they disagree.
- Update `docs/design-direction.md`'s **Implications** section. Its recorded token list says
  accent `#c2532d`; the mock moves primary actions to pine `#1d6241` and reserves the warm red
  for destructive. That is a change to the selected direction and belongs in that document,
  with the reasoning (red carried "safe expected action", which blurred the one signal a UI
  should not blur).
- Every slice below names the part of the frame it implements.

---

## 2. The slices

House rules apply to each: one branch, behaviour tests first, `make check` and `pnpm build`
green, no new UI dependency, the primitive ships with its first consumers.

### UI-1 · The button and colour layer
`branch: ui/primary-pine`

`lib/ui.ts` is the whole surface: `accentButtonClasses` moves off `bg-lab-accent` to pine,
`inkButtonClasses` stays, a destructive variant is added, and every variant gains its hover and
`focus-visible` ring. Add `iconLeadingClasses` so a button's glyph sizing is one decision rather
than 75.

Also: the mock gives ~75 buttons an icon on a fixed vocabulary — plus for create/add, check for
save/confirm, counter-clockwise for discard, pencil/trash/star, play for start, upload for
publish. Encode that as a small `buttonIcon` map next to the class sets so the pairing cannot
drift per page.

*Checks:* `FieldHint.test.tsx` style assertions if any, plus a new `ui.test.ts` asserting each
variant carries a hover and a focus ring.

### UI-2 · The field pattern
`branch: ui/field-pattern`

The mock's 107 rows share one shape: label and hint in a single left column, control right,
both top-aligned, wrapping to stacked below ~540px, label `for`/`id`-bound, visible focus ring.

Add a `Field` component beside `FieldHint.tsx` taking `{ label, hint, htmlFor, children }`,
and adopt it in the editor routes named in the same branch — start with
`ProductEditorPage`, `CustomerEditorPage`, `OrderEditorPage`, `ShopSetupPages`. Later slices
extend adoption; a `Field` no page uses is not a slice.

*Watch:* 44 of the mock's rows label a chip group or a custom widget, not a native control.
Those need `role="group"` + `aria-labelledby`, not a dangling `for`.

### UI-3 · Navigation rail
`branch: ui/rail-icons-collapse`

Most of this slice was already built, and not where this plan first said it was. The rail is
`shell/AppShell.tsx` — `ShopWorkspace.tsx` and `LabSurface.tsx` hold no navigation, they only
mount the shell. It already has a glyph per destination, a collapsed mode, an `sr-only` label
plus `title` on hover so a collapsed row keeps its accessible name, section headings that
become divider lines, a collapse control at the foot above a 1px rule carrying `aria-expanded`,
no rail at all outside shop scope, and the preference: `readNavigationCollapsed` and
`writeNavigationCollapsed` in `lib/preferences.ts` found their consumer there, so that sentence
is discharged rather than pending.

What is left is the remainder, measured against the handoff's *Navigation rail* and against the
prototype where that bullet is silent — metrics and vocabulary, no behaviour: 216px expanded and
a 52px strip collapsed (they were 226 and 58); the glyph at 17px expanded and 19px collapsed in
a 36px row (it was 15px everywhere), dimmed to 0.75 on an expanded row that is not the current
one; headings at `0.07em` in `#8c9196`; the hover wash `#eceef0`; the active row's ink `#14352e`
at 700 and its `#ddeae5` hover; an inactive collapsed row lifted to `admin-muted` at 650, where
a glyph stands alone and a list with its words deleted would read as disabled; and the foot
reading "‹ Collapse menu" at 12.5px 650 in `admin-muted`.

*Watch:* the foot control's **name, visible copy and tooltip are one string**. Collapsed it has
no visible text at all, so the accessible name is the whole of what a reader has; expanded, a
name that differed from the face of it is what a voice-control reader falls into. Moving it
renamed the control in five suites — `tests/e2e/workspace-shell.spec.ts`, `AppShell.test.tsx`,
`Tickets.test.tsx`, `LabSettings.test.tsx` — and nothing else, because `nav[aria-label="Shop
workspace"]` is what the tours anchor on and what every other spec reaches the rail by. That
landmark name does **not** move.

*Checks:* `shell/AppShell.test.tsx` — the two widths, the glyph sizes and the 36px row, the
heading tracking and its collapsed rule, the control's name against its copy and its tooltip
and `aria-expanded`, the preference written and read back, and every collapsed destination
still named.

**Where this follows the codebase against the prototype**, per the rule in
`docs/design-direction.md`: the rail keeps its 13px entry type (the prototype's 13.5px is
inherited from the frame root rather than set on the row, and half a pixel is below a reader's
threshold) and its 2px row gap (the prototype's 3px is collapsed-only and one pixel out); it
takes `admin-border` for the foot rule and the collapsed divider where the prototype draws
`#e5e9ec` and `#dfe3e6`, because the handoff names the rail's own border in that token; it
keeps lucide's stroke width, which the handoff's *Assets* release frees; and it keeps this
workspace's list of destinations, which the prototype does not share — it opens on "Overview"
where the app opens on "Home", files Support identities under *Shop setup*, and has no
cross-shop section because its lab is a second rail behind a top-bar mode. Renaming or
remapping a destination changes an accessible name every journey clicks through.

Two more things are **not** in this slice. The right-aligned per-entry count: the prototype
reads it off its own fixture arrays, the workspace has no such figure at the shell, and UI-4 is
where counts are decided. And the top bar — the other half of the handoff's *Chrome* section,
which is nobody's slice yet.

### UI-4 · List pages: counts move into the filters
`branch: ui/filter-counts`

This plan said the counts *move*. They do not: **there is no KPI stat strip in `apps/web`**,
nothing is at risk of being lost, and there are no count selectors to delete. What there was
is one hand-rolled chip row on `OrdersPage`, a `<select>` of counted options on `TicketsPage`,
and nine index routes with no filter at all. So the slice is additive, and being additive
raises the bar on every chip: a count nobody asked for is clutter, and only the prototype
decides which ones were asked for.

What it builds is **one filter-chip row** — `FilterChips` in `components/`, its class sets and
its glyph table in `lib/ui.ts` — and adopts it on the indexes whose chips the prototype draws
and this workspace can compute. `OrdersPage`'s hand-rolled row goes; the eight are Shops,
Products, Orders, Customers, Scenarios, Support identities, Agent configurations and Judges.
A chip's kind names a glyph on a **closed vocabulary of six**, encoded once beside `buttonIcon`
and deliberately not an extension of `ButtonVerb`: a chip's check means "the published ones"
and a button's means "save". The seventh kind the handoff's *Assets* list gives — the page, for
a document chip — is left out because nothing draws it, per the house rule that a primitive no
page uses is not a slice.

**A chip row waits for something to filter.** The seven server-backed indexes render it inside
the same branch as their table, so it is absent while the listing is in flight and absent when
the listing failed: a row of zeros over "Loading…" answers nothing and presses to nothing,
which is the stat band again at the moment it is least true. `ProductsPage` is the exception
and is not gated — its catalog is the shop draft, already in hand when the route renders, so
the table is there from the first frame and three of its four chips filter correctly at once.
Its *Needs attention* count is 0 until the draft preview lands, which is the same moment the
Findings column beside it stops saying "Clear" for everything.

**Every chip filters.** A chip that showed a number and narrowed nothing would be the stat
strip again in a smaller typeface, so `filterList` returns the counts and the visible rows from
one pass over one table of predicates: an index cannot say *Unfulfilled 3* over a list of two.
A chip counting zero is still drawn and still pressable, which is what the prototype does —
its rows map every entry unconditionally with `String(count)` — and the list answers in words.
The count is in each chip's accessible name, set explicitly because an accessible name is the
element's children run together and the gap between label and number is a flex `gap`.

**Seven of the prototype's chips are not built, and none of them is faked.** Six want a figure
this workspace's index payloads do not carry, and a slice that may not add a route or a payload
cannot invent one: *Referenced by a ticket* (orders — the link lives on a ticket's content),
*Not composed yet* on each of the two block libraries (no composition figure on
`BlockSummarySchema`), *Behind the shop* (scenarios — no pinned shop version on the summary),
*Cannot publish* (identities — publish-readiness is a preview of one draft) and *No rubric*
(judges — the summary names the model and the evidence and not the rubric). The seventh,
*Required by a scenario*, wants no figure but a **table**, and is treated below with the
surfaces that get no chips at all.

Of the five counts this plan named, **one is built and four are not**: *Without a default
address* is built; *Required by a scenario* wants the table; *Referenced by a ticket* and both
*Not composed yet* want a payload. All four are pending, not lost.

**Three index surfaces end with no chips**, and each for the prototype's own reason rather than
for want of effort. **Tickets** — the prototype's three-pane screen draws no filter control at
all, only "4 in this shop" under the panel title, so the `<select>` this workspace already has
is more than the design asks for and stays. **The two block libraries** — beyond *All*, the
prototype's chips are *Decided by a rule* / *Scored by a judge* and *Fault hooks* / *Setup
mutations*, and `BlockSummarySchema` carries neither an assessment nor an effect, only the
display string `type_label` the API composes from them; filtering by splitting a caption is
reading a label as data, and the mutation binary does not map onto this lab's four effects
either way. **Policies & FAQ** — the prototype filters one documents table by *Policies*,
*Guidelines*, *FAQ* and *Required by a scenario*; this workspace has no such table (policies
and FAQ are two authored lists on one page and guidelines are a third page), and merging them
is a restructure this slice does not own.

**Where this follows the codebase against the prototype**, per the rule in
`docs/design-direction.md`: the row takes the card's own `px-4` and `py-2.5` rather than the
prototype's `11px 20px`, because the chips sit directly above `tableHeadClasses`, which is
exactly those two values, and a row that missed the column it labels by a pixel would read as
a second, narrower card; and it wraps, which the prototype does not declare and the handoff's
*Responsive* rule requires of every row. The *Pydantic AI* chip on agent configurations is
dropped: it filters the prototype's fixture by one framework of the two it holds, this lab
proves three, and a chip for one of them would hard-code a backend label while leaving the
other two unreachable.

**Where the README and the prototype conflict**, the README wins, which is the sentence this
slice added to that rule. One value: the unselected chip's hover is the README's `#f6f7f8` —
the hover it gives every white secondary — where the prototype's inline style draws `#f4f6f7`.
This is not a case of following the codebase, which had no chip hover to follow.

**And where the README is ambiguous**, the prototype governs as before. The chip's `7px`
radius is that case: *Radii* offers "8px … chips, 7px small chips" without saying which a 34px
filter chip is, and the prototype draws 7. The unselected ink `#58636d` and the two glyph
opacities (90% selected, 50% otherwise — the prototype nests a 0.55 span inside a 0.9 svg,
and 0.55 × 0.9 is 0.495) are silence rather than ambiguity, and are the prototype's.

The selected-chip trio finds its first consumer here and lands as three tokens in `styles.css`
(`--color-admin-chip`, `-border`, `-hover`); its ink is `--color-lab-primary`, which UI-1
already added.

*Checks:* `FilterChips.test.tsx` — the count in the name, the name against the words on the
chip, `aria-pressed` moving, a zero chip drawn and pressable, every glyph hidden, and each
chip leaving exactly as many rows as it claimed. `lib/ui.test.ts` — the two states' hover and
ring and the handoff's chip metrics, and the six-kind vocabulary as a table, in the spirit of
`enumLabels.test.ts`. Then one test per adopting index in its own spec. Three existing
assertions moved inside `getByRole("table")`, because "Never published" and "Active" are now
also chip labels.

### UI-5 · The workspace's display type
`branch: ui/display-type`

This plan asked for a full-width header variant. **Every header already spans the full content
width.** In every one of the twenty-seven files that draw one, `PageHeader` renders before that
file's `grid-cols-[…]`, so no header sits in a column beside a side panel — and Tone of voice,
Shop details and Tickets, the three pages this plan named, each put `EditorSaveActions` in
that full-width header already. There is no misplaced Save button to move; whoever built the
side-panel layout built the alignment with it.

What was never applied is the header's **type**. `styles.css` has defined `--font-display` as
Georgia since the POC, and `font-display` had exactly one consumer in the application — the app
title in the top bar — beside the tour popover's own title in CSS. So a page title read at 20px
in the sans stack where the handoff's *Type* line asks for Georgia 24–27px 700, and a card
title at 14px where it asks for Georgia 17–18px 700. That, and not the alignment, is the slice.

**Where in each range this workspace lands.** `PageHeader`'s `h1` takes 24px at `-0.015em`,
the size the prototype gives the fourteen titles it writes as a **fixed label** — the ten
indexes and libraries, plus Tone of voice, Shop details, New experiment and History. It is not
the size that prototype uses most: the modal page title there is 22px, on the fifteen titles
bound to data, and 24 is the most common of those the handoff's 24–27px range admits. Shops
`:153` and the shop overview `:722` are drawn at 26 and Settings `:3854` at 27; 24 stands for
all three, because a `size` prop worth two pixels on two screens is not warranted and Settings
draws no `PageHeader` variant of its own. `Card`'s `h2` takes 17px at `-0.01em`, spelled once
as `cardTitleClasses` in `lib/ui.ts`: both Georgia values are in range, and 17 is the one the
prototype draws on the shape this component has — a bordered header over the card's content.

**Three headings are drawn in open code and take the same type**, because a card title left in
sans beside four Georgia ones is the inconsistency this slice exists to remove: the shops
table's header, which is `Card`'s header letter for letter, open-coded so the filter row can sit
between the title and the table; the tickets list panel's, which carries its filter in the
header line; and the ticket thread's subject, the one heading the prototype draws between a page
title and a card title, at Georgia 19px (`Workspace.dc.html`:2200).

**The density knock-on, measured rather than assumed.** A page title's line box goes from 28px
to 32px, and the 8px under it becomes the prototype's 5px (`Workspace.dc.html`:154, 816), so a
header with a description is one pixel taller than it was and one without is four. A card's
title loses `text-sm`'s 20px line box for the 1.5 the page inherits — 25.5px at 17px — which
makes a card header 49.5px where it was 44px, against the prototype's own 54px: the change
moves toward the design rather than past it, and nothing else on a card moves. No surface
breaks under either size.

**Where this follows the codebase against the prototype**, per the rule in
`docs/design-direction.md`. Three times, and the first two are **not** the README-wins clause,
which settles one stated number against one drawn one and does not reach a distinction drawn
consistently across a class. Both of these are such a class, so the prototype governs them and
flattening them is a departure — taken on the ground that one component renders both classes
and no slice has given it a variant, and written down here with the prototype's own rule so the
variant can be added later without redoing the census.

- **Page titles.** The prototype's rule is a **bound name against a fixed label**, not an editor
  against an index: all fifteen titles it binds to data (`{{ prodTitle }}`, `{{ agName }}`,
  `{{ ordRef }}`, `{{ scnNameShown }}`…) are 22px, and all fourteen fixed labels are 24px —
  including Tone of voice `:1897` and Shop details `:1997`, which are editors. One `h1` draws
  both, so the fifteen bound names are 2px larger here than drawn. What to watch when the
  variant arrives: a long product or customer name wraps at 24px Georgia where 22 holds it.
- **Card titles.** The prototype gives its small side-panel note card — a title over a
  paragraph, in a `13px 16px` bordered header — a **sans** header, in forty-four places
  (`:1433`, `:1436`), where its table cards are Georgia 17 and its section cards Georgia 18.
  One `Card` draws all three here, so the note-card class gains display type it is not drawn
  with. Of the hundred-and-thirty-seven `Card`s in this workspace about a dozen stand where the
  prototype draws its table card and the rest where it draws the section card.
- **Card header padding.** `px-4 py-3` rather than the prototype's `17px 20px`. The horizontal
  value is the column the card's body and `tableHeadClasses` already share, and a title that
  missed the rows it labels by four pixels would read as a second, narrower card — UI-4's
  argument, unchanged. The vertical value is the card's own rhythm, and with it kept the line
  box above is the whole of the header's growth.

**What is deliberately left in sans.** Entry-row titles, which the prototype draws at 13.5px
sans like every other saved row; the per-arm run label on the results screen, where the
prototype puts sans 13.5px on the label and reserves Georgia for the numeral beside it
(`Workspace.dc.html`:2581) — those numerals are the *Type* line's third clause and nobody's
slice yet; and the unsaved-changes dialog's title, which the prototype has no modal to draw. The
top bar's shop switcher is left too, although the handoff gives it Georgia 16px 700: it is a
native `<select>` here and a button over a 300px panel there, so its type arrives with its
control, in the top-bar remainder UI-3 named as nobody's slice.

*Watch:* the `h1` is the anchor of every tour's first step through `data-tour="page-name"`, and
`tour-anchors.spec.ts` holds each step to exactly one visible element. Type moves neither the
attribute nor a heading level: an `h1` stays an `h1` and an `h2` an `h2`.

*Checks:* a new `WorkspaceChrome.test.tsx` — the page title's face, size, weight and tracking,
the card title's, and each read off the heading level and the tour anchor that must not move.
Then one assertion per open-coded header in `Shops.test.tsx` and `Tickets.test.tsx`, holding the
copies to `cardTitleClasses` rather than repeating its numbers.

### UI-6 · Search affordance
`branch: ui/search-field`

One `SearchField` component: magnifier, 36px left padding, the `Search <thing>` placeholder
convention. Eleven consumers.

*Decide, do not discover:* every one of the eleven indexes puts the search box **on the same
card as a filter-chip row**, in the header directly above it (`Workspace.dc.html`:163, 827,
1068, 1142, 1460, 1534, 1595, 3238, 3419, 3570, 3714). So this slice has to settle whether a
chip's count is of the whole list or of what the search left. The prototype answers: the whole
list. Each of its chip tables counts the unsearched array — `shopFilters` reads `s.shopList`
while the table renders the searched `shownShops`, and the other ten do the same — so a count
never moves as you type, and the search narrows only what is under the chips. Whichever way
UI-6 goes, `filterList` in `components/FilterChips.tsx` is the one place to decide it, because
the count and the filtering come out of it together.

**The census holds, and its answer is taken.** Re-read rather than trusted: `#bdc7cf` — the
border of the prototype's search input — occurs exactly eleven times in `Workspace.dc.html`,
and the eleven are the lines above; the bundle holds eleven `Search …` strings and no twelfth.
Every one of the eleven chip tables counts an unsearched array (`shopFilters` over
`s.shopList`, `cusFilters` over `s.customerList`, `ordFilters` over `s.orderList`,
`docFilters` over `DOCUMENTS`, `prodFilters` over a constant `PROD_FILTERS`, and the other six
the same) while the table beside it renders the searched `shown…`. So counts are of the whole
list and the search narrows only the rows, and that is settled in `filterList`, which now takes
the search and returns the counts from `rows` and the visible rows from what the pressed chip
left. A page cannot hold the two rules apart.

**The eleven, against this workspace.** `:163` shops → `ShopsPage`; `:827` products →
`ProductsPage`; `:1068` orders → `OrdersPage`; `:1142` customers → `CustomersPage`; `:1460`
scenarios → `ScenariosPage`; `:1595` identities → `SupportIdentitiesPage`; `:3238` agent
configurations → `AgentConfigurationsPage`; `:3419` judges → `JudgeConfigurationsPage`; `:3570`
and `:3714`, the two block libraries → `BlockLibraryPage`, which renders both. **`:1534` has no
counterpart here**: it is the prototype's single Documents table, and this workspace has no such
index — policies and FAQ are two authored lists on `PoliciesAndFaqPage` and guidelines are a
third page. That is the same surface, and the same reason, UI-4 left without chips; merging the
three is a restructure neither slice owns, and a search box on each of two authored lists is not
the control the prototype draws. So ten routes carry the field, eleven references are accounted
for, and two of those routes have search and no chips. Not because the prototype draws none:
it gives both libraries a chip row of their own (`obFilters` at `:6284`, `muFilters` at
`:6305`). They are chipless *here* by UI-4's decision above — `BlockSummarySchema` carries the
composed caption `type_label` and neither the assessment nor the effect those rows filter on,
and filtering by splitting a caption is reading a label as data. So the count question does not
arise on them for a reason this repository took, not one the design did.

**Experiment history is not one of the eleven and was not touched.** The prototype's History
screen (`:2670`–`:2683`) draws a Scenario select, a Configuration select, a Tag box and two
buttons, and no search box at all. The field this workspace already has there is URL-backed and
submitted rather than typed, sits in a labelled form beside its own *Search* button, and
`docs/PLAN-UX.md` Slice 16 owns restructuring that form. Adopting `SearchField` there would mean
changing what submits or what the label says; the slice stops at its edge.

**Where the search sits.** The prototype puts it in the card's **header line**, right-aligned
opposite the card title, with the chip row directly beneath — all eleven, without exception.
Only the shops table draws that header in this workspace (open-coded, so the chip row can sit
under it), and there the field goes into it exactly as drawn. The other nine cards have no title
to sit opposite, so they draw `SearchRow` with the field alone: the same corner of the same
card, in the same order relative to the chips, ruled off from them the way a header is. One
component draws both cases — the shops header passes its `h2` in as a child rather than
respelling the row — so the two cannot drift apart, which is the lesson `ui/display-type` paid
for on card titles. Giving those cards the titles the
prototype writes over them would change a page's heading outline and is not this slice.

**Where this follows the prototype against the README.** The search box does not take the
README's `Inputs:` metrics. That bullet belongs to *The form pattern*, which the same section
says "applies to 107 rows" — a label, a hint and a control in a form row — and a box in a card
header is none of those. The prototype draws it differently in all five values (38px not 44,
`8px 12px 8px 36px` not `10px 14px`, `#bdc7cf` not `#c9cccf`, 8px not 9px, 13px not 14.5px) in
all eleven places and nowhere else, which is a distinction across a class rather than one value
against another — the case `docs/design-direction.md`'s narrowed clause hands to the prototype.

**One known inconsistency, left as it is.** `ProductsPage` draws its search box — and its chip
row, which arrived on `main` a slice earlier — over a catalog with nothing in it, where the rule
stated above ("a box that can only narrow nothing is a control that does nothing") would hide
both. The catalog is the shop draft and is in hand when the route renders, so there is no load
to gate on and no moment at which the controls would appear; hiding the search while the chips
stayed would make the two disagree on one card, which is worse than either. Named here so the
next reader knows it was seen rather than missed, and so that whoever revisits the gate revisits
both controls together.

**And three values are not the prototype's.** The row takes the card header's `px-4 py-3` rather
than `17px 20px`, UI-4's and UI-5's argument unchanged. One width, `min(300px, 34%)`, stands for
the three the prototype draws (that on eight indexes, `min(320px, 36%)` on orders and customers,
a flat `260px` on documents). And a 180px floor sits under that percentage, because 34% of a
narrow card is not a field anyone can read their own word back from and the handoff's
*Responsive* rule requires the row to survive its wrap.

**Two more departures, both named rather than found.** The control is `type="search"`, where the
prototype draws a plain text input: it is the semantic that drawing implies, it is what a reader
is told they have landed in, and it is what a spec reaches for it by. What the role brings with
it is refused rather than inherited — Tailwind's preflight resets `::-webkit-search-decoration`
and sets no `appearance` for `[type=search]`, so WebKit would otherwise draw a native clear x
once there is text, which the prototype has not got, no keyboard reaches and nothing names, and
which on older Safari can overrule the field's own radius and padding; `searchFieldClasses`
carries `appearance-none` and drops the cancel button, and `lib/ui.test.ts` holds it to both. And the "no rows" line on
every adopting index now reads "No X matches this **view**" rather than "this filter", which is
the prototype's own word and the
only honest one once a search narrows beside a chip (`:199`, `:874`, `:1112`, `:1187`, `:1500`,
`:1568`, `:3272`, `:3453` — eight of them, the documents index included). The two libraries gain
the same sentence,
which the prototype does not write for them — its `obEmpty` and `muEmpty` conflate "none match"
with "none exist", where this workspace already distinguishes them.

*Checks:* `SearchField.test.tsx` — the label as an element bound to the field rather than a
placeholder standing in for one, one string in the box and in the name, the magnifier hidden,
and every keystroke reported. `FilterChips.test.tsx` — the counts read off the rendered chips
before and after a word is typed, the search narrowing under the pressed chip, and `searchRows`
itself; its empty line is the harness's own markup and pins the wiring, not the copy.
`Orders.test.tsx` and `Blocks.test.tsx` — the product copy, on the two paths that differ:
Orders for an index that reaches the search through `filterList` under chips, where the count
rule is asserted on a real table, and the objective library for the one that calls `searchRows`
directly with no chips over it. Both assert a miss leaves the sentence and not a blank card.
`lib/ui.test.ts` — the metrics above, so a later slice cannot fold this control into
`fieldControlClasses` and lose the 36px the magnifier stands in, plus the two appearance resets
that keep `type="search"` from drawing chrome of its own.

### UI-7 · The field control itself
`branch: ui/field-control`

The three input rules UI-2 could not reach: `min-height:44px`, a field border `#c9cccf` distinct
from the card border, and `14.5px` text. They live in `fieldControlClasses` and `textAreaClasses`
in `lib/ui.ts`, which every route shares, so a four-route slice may not apply them — the same
string paints a create form, an in-place row editor and a compact add-form. Its own slice, whose
consumer is the whole workspace.

The focus ring the handoff asks for on fields is already there from UI-1 and is not part of this.

**As built.** The shared strings in `lib/ui.ts` now carry the whole `Inputs:` bullet rather than
the three values named above, because the bullet is one declaration and leaving two of its five
behind would have left the field at the card's 8px radius and 12px padding with no reason
recorded anywhere; the README's *Radii* line says "9px fields" outright, and a later slice to
move one shared string by one pixel is the absurd outcome. What is shared is the box —
`border-admin-field-border`, `rounded-[9px]`, `px-3.5` — and **height, vertical padding and type
size are per-export**, because the prototype gives the input and the text area different ones and
a shared string carrying the input's would leave every text area one caller override away from
being right. Thirty-three files consume the two strings and none was edited for the metrics; two
were edited for an override, below.

**`min-height`, not a height.** `h-10` became `min-h-[44px]`, which is what the README writes and
not a transcription nicety: the same string paints a `<select>`, an `<input type="date">` whose
picker glyph is taller than the text beside it, and controls whose value can wrap. A fixed height
clips all three. `box-border` stays, so the 44px is the bordered box.

**The field border is a token.** `--color-admin-field-border: #c9cccf` in `styles.css`, the second
of the refresh's three token additions, arriving with its first consumer as the house rule asks.
Added rather than derived from `admin-border`: the README's table offers "add, or use
`admin-border` darkened", and no single darkening ratio takes `#e1e3e5` to `#c9cccf`. The point of
the token is that it is *not* the card's border, so `lib/ui.test.ts` reads both out of
`styles.css` and asserts they differ — a class name alone cannot say that, and a token defined as
the card's grey would satisfy every other check while making every field on the workspace vanish
into the card behind it. The card's value is read rather than written down there, so a change to
the card cannot fail a field test.

**The census: the prototype draws five classes of control, and this file builds three.** Counted
over every one of the 107 native `input`/`select`/`textarea` elements in `Workspace.dc.html`.
Four classes account for 101; the remaining six are listed with them, because a census that drops
its remainder is not a census.

- **67 at `min-height:44px`, `#c9cccf`, 9px, mostly 14.5px** — the form-row control. This one.
- **11 at 38px, `#bdc7cf`, 8px, 13px** — the index search box, which UI-6 settled and this slice
  does not touch. It exists here as a class of its own (`searchFieldClasses`), built separately,
  and the new test asserts the two sets share none of each other's values in either direction.
- **16 at 42px or 40px, `#c9cccf`, 13–13.5px** — thirteen compact controls in the list
  sub-editors and the Settings provider card (`:2867`, `:2974`, `:3084`, `:3109`, `:3110`,
  `:3135`, `:3672`, `:3673`, `:3816`, `:3817`, `:4018`, `:4038`, `:4053`), and the three on the
  History filter bar (`:2677`, `:2678`, `:2679`).
- **7 text areas, `#c9cccf`, 9px, 14px, `11px 14px`, `line-height:1.6`, no `min-height`**
  (`:530`, `:1677`, `:1724`, `:1807`, `:1954`, `:3205`, `:3515`) — identical in all six values.
- **And the six left over.** `:940` and `:941` are the status **radios**, which are not fields and
  take none of this. `:965` and `:2650` are borderless 28px inputs sitting *inside* a bordered
  chip strip. `:1003` and `:1004` are the variant table's currency select and price input,
  borderless inside a 38px composite cell.

**One class flattened, one kept apart.** The sixteen compact controls are flattened into
`fieldControlClasses`, as a departure from the prototype: no compact component exists here to
give a second size to — every sub-editor add-form row and all eight `ExperimentHistoryPage`
filters already reach for that string — and minting `compactFieldControlClasses` with no caller
asking for it is the primitive-without-a-consumer the house rule refuses. The cost is 2–4px of
height and half a point of type on those thirty-odd controls. The text area is **not** flattened,
and the first draft of this slice was wrong to: `textAreaClasses` is a distinct export with its
own consumers, so the one-component argument does not reach it, and the prototype's seven are
consistent enough to be a class the `Inputs:` bullet summarised away. It keeps 14px, `11px 14px`
and `line-height:1.6`. Both readings are `docs/design-direction.md`'s **narrowed** clause — a
distinction the prototype draws consistently across a class — and neither is the README-wins
clause, which settles one value against one value.

**The four borderless controls are a departure that predates this slice, and it is now on the
record.** The prototype's `:965`, `:2650`, `:1003` and `:1004` are borderless inputs inside a
composite; their counterparts here — `ChipListField.tsx:172`, `ExperimentResultsPage.tsx:364` and
the variant cells at `ProductEditorPage.tsx:609`, `:655`, `:695`, `:725`, `:749` — are bordered
standalone fields and were before this slice too. What this slice changes is their size. It bites
hardest on the results tag box: at 44px it now sits beside a 32px small button in an
`items-center` row, where the prototype draws it 28px and borderless inside a tag strip. Giving a
chip strip or a composite cell a component of its own is a component slice and not this one, so
this is recorded rather than repaired.

**One reading that saves a later measurement.** Every `<select>` in the prototype has **zero**
vertical padding — `0 12px` on twenty-nine of them, `0 11px`, `0 10px` and `0 7px` on the rest —
where `fieldControlClasses` gives `py-2.5`. It changes nothing: `min-height` governs a select's
height and the text centres in it either way, and one padding for every control is worth more
than matching a value with no effect.

**The overrides the shared strings had to be checked against.** Fifteen call sites compose
`fieldControlClasses` or `textAreaClasses` with something of their own. Eleven add only a width
(`w-20`, `w-32`, `w-48`, two `min-w-40 flex-1`, and six `max-w-*` — five in `ProductEditorPage`
and `CustomerEditorPage.tsx:558`); three add `font-mono`, one of them
(`JudgeConfigurationEditorPage.tsx:237`) with `min-h-56` beside it, which works because
`.min-h-24` is emitted at byte 12664 and `.min-h-56` at 12711. None of those fourteen touches a
metric this slice moved. One does, and one more is a width site that also carried a height:

- `AgentConfigurationEditorPage`'s prompt-template editor carries `text-[12.5px]`, which used to
  override the base's `text-sm`. Which of two `text-…` utilities wins is **Tailwind's own emit
  order — lexical on the candidate text for arbitrary values — not the order a caller writes
  them**: `.text-[12.5px]` is emitted at byte 23060 of the built sheet and `.text-[14px]` at
  23272, so against the new base the override would have lost and the template editor would have
  silently grown, the "44px on ten pages and 40px on one" failure in reverse. It is now
  `text-[12.5px]!`, with the reason in a comment at the site. The alternatives were tried and do
  not work: a `@theme` size token is emitted *after* the arbitrary sizes, so it restores nothing.
  **Lexical, not numeric**, and the difference is the trap for whoever comes next: the same sheet
  emits `.text-[14.5px]` at 23237 and `.text-[14px]` at 23272, so a `text-[14.5px]` override on
  the text area's new 14px base would lose — the opposite of what "by value" would predict. An
  override is not safe merely because its number is the smaller one.
- `ExperimentResultsPage`'s tag box — one of the eleven width sites, `w-48` — also carried `h-8`,
  to match the small button beside it. A fixed height under a 44px floor is dead code, so it is
  removed rather than left to read as a metric the field still has; the box is now the standard
  control, and the paragraph above records what that leaves beside the button.

**The unit test reads `styles.css` as text**, which needs `test.css: { include: [/\.css\?raw$/] }`
in `vite.config.ts`: Vitest's CSS enabler matches `styles.css?raw` as a stylesheet and stubs every
stylesheet to `export default ""`, so `?raw` would otherwise hand the test an empty string. Only
the `?raw` form is let through, so a real stylesheet import stays stubbed and the unit suite stays
off Tailwind. This is the same `?raw` route `lib/fieldRules.test.ts` and `lib/enumLabels.test.ts`
already take to read a source file. `tsconfig.app.json`'s `types` allowlist is **not** widened:
adding `node` to it would make `process`, `Buffer`, `require` and `NodeJS.Timeout` visible to every
browser module and change what `setTimeout` returns, which one test does not buy.

**A pre-existing defect found on the way and not fixed here**: `w-full` on the shared surface has
always beaten the `w-20`, `w-32` and `w-48` overrides, so three fields that read as narrow in the
source have never been. It is in `docs/decisions-and-next-step.md` under *Known application
defects, found but not fixed*.

**Nothing in the Playwright suite moved.** All 35 specs pass unchanged. They assert on controls by
role and name and on tour anchors by visibility, and a control growing from 40px to 44px inside a
wrapping flex row moves nothing out of a viewport or out of a scroll.

*Checks:* `lib/ui.test.ts` gains seven cases — the box both controls share; the single-line
control's own padding and size, refused on the text area so folding them back into the shared
string fails here; the text area's `11px 14px`, 14px and 1.6; the 44px floor with no `h-…`
ceiling; the text area's own floor and the absence of the control's; the token's value and its
inequality with the card border; and the disjointness from the search box in both directions.
Every one was mutation-tested: reverting `h-10`, `text-sm`, `border-admin-border`, `rounded-lg`,
`px-3`, a fixed height on the control, the text area's metrics back to the input's, a card-grey
token, and folding the search box into the form pattern each fail exactly the case that should
catch them. Plus the existing web unit tests and the whole Playwright suite, green.

### UI-8 · The rules the rows are missing
`branch: ui/field-hint-copy`

UI-2 shipped the row and authored no copy, which was the right line for a layout slice and leaves
the pattern half-delivered: the handoff writes a hint for all 107 rows and the workspace shows two
of them. This slice writes the rest, and it is a content slice — each hint is read against what
the surface actually renders, not transcribed.

**As built. Twenty-three rows: twenty gained a hint, two already had one, and one is bare.** The
census is of the rows UI-2 actually adopted — `Field` and `FieldGroup` on `ProductEditorPage`
(4), `CustomerEditorPage` (9), `OrderEditorPage` (7) and Shop details' identity card (3) — and
not of the prototype's 107, most of which describe surfaces this workspace has not got. Ship to
and Support channels already carried a rule, Category is the one deliberate blank, and the other
twenty are new: Product 3, Customer 9, Order 6, Shop identity 2. Eighteen exports serve those
twenty, because `CUSTOMER_NAME_RULE` and `ORDER_METHOD_RULE` are each read twice. Two
self-labelling fields sit in those cards drawn as rows and are *not* in the twenty-three —
`LocaleField` and `CurrencyField` are not `Field`s and carry `LOCALE_RULE` and `CURRENCIES_RULE`
themselves.

**Five exports for six literals.** Title (`ProductsPage`), Name (`ShopsPage`) and Given name,
Family name, Email and Customer since (`CustomersPage`) were inline strings; the given-name and
family-name hints were already the same sentence written twice, which is the drift the module
prevents caught one step before it happened. Each is now `PRODUCT_TITLE_RULE`, `SHOP_NAME_RULE`,
`CUSTOMER_NAME_RULE`, `CUSTOMER_EMAIL_RULE` and `CUSTOMER_SINCE_RULE` in `lib/fieldRules.ts`, read
by the create form and by the editor row for the same field. Those pairs are asserted as an
*equality* rather than a substring — `wholeDescription` in `src/test/app.tsx` anchors the match,
because every `Field` keeps an empty second line mounted for a later polite announcement and that
puts one space on the end of the computed description.

**The handoff is a source, and three of its sentences are false here.** Its product Status
row's *Draft option* says a draft product is "present in the catalog but never returned to an
agent" (`Workspace.dc.html`:941 — the row's own hint there is a different claim again, that an
active product needs a priced variant, which is true here of every product and not only an
active one): `_search_products`
in `application/sandbox_tools.py` filters on the query alone and `product_summary` carries the
status into the result, so a draft *is* returned, with its status attached. Its Shop details Slug
row says the slug is "set once, at creation": this workspace's is a plain editable input. Its
Loyalty tier row says the tier is "what the goodwill guideline reads when deciding whether an
exception is allowed": nothing in `apps/api/src` reads either the tier or the account status in a
condition. None of the three was copied, and each row says what this lab does instead. The
prototype also writes no hint at all for the product Description row, the customer Phone, Status
and Account notes rows, or the order's per-axis method and timestamp rows, which are drawn there
as two grouped rows rather than six — so seven of the twenty had nothing to check against and
were written from the domain.

**Every sentence names the code that makes it true**, in the doc comment beside it, because a
content slice has no pixel to measure against and that is the only thing a reviewer can check.
The gate's severity is the gate's own: Description says "a warning, not a refusal" because
`product_without_description` is `_warning`, and Summary says "refuses" because
`persona_without_summary` is `issue_error`.

**Category stays bare, and the defect stands.** `PRODUCT_CATEGORY_RULE`'s second sentence —
"pick one the draft already uses" — is true on the create form, which renders a `<datalist>` of
the draft's categories, and false on the editor, which renders none. The datalist is behaviour
and this is a copy slice, but that is not the whole reason: the anti-fragmentation rule *is* the
useful thing to say about a category, so any other true sentence written on that row would
satisfy the sweep, silence the reminder, and still not tell the reader the one thing they need.
The row keeps its empty accessible description and the test that pins it, so whoever adds the
list is still sent to the hint in the same change.

**Three more rows are bare on purpose.** The lone marketing-opt-in checkbox is not a `Field` and
says what it means beside itself; `LocaleField` and `CurrencyField` are drawn as rows but carry
`LOCALE_RULE` and `CURRENCIES_RULE` themselves, and wrapping either would name it twice.

**The `(optional)` marker was not applied**, although Phone, Account notes and Description are
each the only optional row on their card. `FieldHint`'s own doc records why: the flag is "the
primitive's encoding of that convention for later consumers, not a conversion of that editor",
and UI-2 deliberately left the editors unconverted. Reversing that in a copy slice would change
three accessible names for a convention `docs/design-direction.md` writes for create forms. What
the copy does instead is carry the fact where it is load-bearing: Phone's hint opens "The only
identity fact that may be left out."

**One consequence, stated of its axis and not of the order.** Fulfilment status says "Once
fulfilled, a run can no longer change the address" rather than "Fulfilled is what stops a run
changing the address": `refuse_reasons` in `domain/address_change.py` turns a change away on
four grounds, and two of them are about the order's state — `ORDER_ALREADY_SHIPPED`, which is
this axis, and `ORDER_REFUNDED`, which is the other select on the page. The exclusive form
would have been true of the select and false of the order.

**One rule serves both method selects.** `_method_name` in `application/order_fixtures.py`
freezes a payment method's and a fulfilment method's display name by the same code, so
`ORDER_METHOD_RULE` names neither axis and is read twice.

**Two literals stayed literals**, and the sweep does not ask otherwise: Support channels' rule is
shown on exactly one surface, and the order's Ship to hint is JSX carrying a `<Link>`, not a
string a module can hold.

**No export was unconsumed before this slice** — the sweep's own logic was run over `main`'s
thirty-eight rules before any were added, and every one of them already had an importer.

**A defect found and not fixed**, in `docs/decisions-and-next-step.md`: Shop details will save a
slug another shop already has, where the create form refuses one. The hint on that row says
nothing about it, because a field may not describe a refusal the surface does not make.

*Checks:* `lib/fieldRules.test.ts` gains the sweep — it globs every module under `src` as `?raw`,
reads this module's `export const`/`export function` names out of its own source, and counts a
**value import** rather than an occurrence, because `PRODUCT_CATEGORY_RULE` is named in a comment
in `ProductEditorPage.tsx` explaining why that row does not show it and a text search would read
the explanation as the consumer. What it proves is imported-by-a-shipping-module and not
reaches-a-render: an import nobody uses would satisfy it, and that half is Biome's
`noUnusedImports` over the same files. Both type-import spellings are excluded and pinned on
synthetic sources, since nothing here is a type and neither form would compile. Then one per-page case each in `App.test.tsx` (the product editor's
Details card and Shop details' identity card), `Customers.test.tsx` and `Orders.test.tsx`, on
Slice 1's contract: the hint is in the control's accessible description. Every one was
mutation-tested — dropping the Status hint, widening the Title hint by one clause, dropping one
of the two method hints, swapping the loyalty rule for the account-status one, and giving Shop
details' Slug the create form's `SHOP_SLUG_RULE` each fail exactly the case that should catch
them, and adding an export nobody imports fails the sweep by name.

---

## 3. The behaviour slices

### B-1 · Guideline editing
`ShopSetupPages.tsx`. Inline expand-in-place per row — name + body + slug preview, Done/Cancel,
Delete with the shop default protected. New-then-cancel must remove the appended row, and a
nameless guideline must not be committable or selectable as default. (Both were bugs in the
mock; the tests should encode them.)

### B-2 · Scenario creation
`ScenariosPage` gains a real create route matching the mock: name, ticket (customer and shop
version derived), hidden facts, objective blocks, mutation blocks. Blocked until name + at
least one objective, with the reason on the disabled control. Ticket select values are the
bare ref — the composed label belongs in the hint, not the option value.

### B-3 · Editors bind to the clicked row
`ProductEditorPage` and `CustomerEditorPage` load the record from the route param rather than a
single fixture. Likely already correct in the real app; confirm before writing a slice for it.

---

## 4. The two ADRs

### ADR · Where the model connection lives
The decision, not the form: does the provider connection move into the lab's database, and if
so how is the key stored, who may change it, and what does a run pin?

The mock's position, worth arguing for or against explicitly:

- One connection per lab, OpenAI-compatible only. Presets for OpenAI, Ollama, vLLM, OpenRouter,
  Together, plus Custom; base URL editable in every case.
- The key is per provider, stored encrypted, never returned — the API returns a mask and an
  added-date, never the value.
- Saving a connection affects runs started afterwards. A recorded run keeps provider, base URL
  and model, and Results reads them back from the run.
- Env remains the bootstrap: a lab with no saved connection falls back to
  `AGENT_LAB_OPENAI_API_KEY`, which is what keeps `make seed` and CI working unattended.

This is where ADR 0044's "no settings table" is revisited. The distinction that lets both hold:
0044 refused *stored operator progress*; this stores *a capability of the lab*. Say so in the
ADR or the two decisions will read as contradictory later.

Backend work it implies: contract types, a migration, secret handling, a `POST .../test`
endpoint for the connection check, and provider/base-URL/model columns on the run record.

### ADR · Provider on an agent configuration
Additive field, validated against the proven table: an unproven *framework, architecture or
provider* is refused at publication; an unproven *model* is a warning that publishes anyway —
that asymmetry already exists and should be stated rather than re-derived. A configuration
naming a provider the lab is not currently pointed at is valid but unrunnable, and the editor
says so.

---

## 5. Suggested order

1. Two ADRs (parallel, no code).
2. UI-1, UI-2 — everything else inherits them.
3. UI-3, UI-4, UI-5, UI-6 — independent, parallelisable.
4. UI-7, then UI-8 — both fell out of UI-2 and neither blocks anything above.
5. B-1, B-2, B-3.
6. Provider milestone: contracts → migration → API → `LabSettingsPage` → agent configuration
   field.

UI-1 and UI-2 first is the load-bearing call: every later slice touches buttons and fields, and
doing them last means editing the same lines twice.

UI-7 sits after the independent four rather than beside UI-2 because it repaints every control in
the workspace: doing it while four branches are open would make each of them answer for a
diff it did not cause. UI-8 follows UI-7 because a hint is written against the control the reader
is looking at.

---

## 6. Two things in the mock that are proposals, not requirements

- **Five new browser preferences** — where the app opens, auto-offer tour, confirm before
  delete, timestamp format, table density. Each needs a real consumer to exist, per the house
  rule. Cut any that do not earn one.
- **Shop logo** (icon, background, mark colour) — three columns on the shop record and a
  contrast check in the editor. Pleasant, not load-bearing; sequence it last or drop it.
