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

### UI-5 · Page header alignment
`branch: ui/page-header-full-width`

`PageHeader` in `WorkspaceChrome.tsx` gains the variant the mock uses on Tone of voice, Shop
details and Tickets: title and actions span the full content width, side panel starts below.
This is why the Save button currently sits in a different place on three pages.

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

### UI-7 · The field control itself
`branch: ui/field-control`

The three input rules UI-2 could not reach: `min-height:44px`, a field border `#c9cccf` distinct
from the card border, and `14.5px` text. They live in `fieldControlClasses` and `textAreaClasses`
in `lib/ui.ts`, which every route shares, so a four-route slice may not apply them — the same
string paints a create form, an in-place row editor and a compact add-form. Its own slice, whose
consumer is the whole workspace.

The focus ring the handoff asks for on fields is already there from UI-1 and is not part of this.

*Checks:* the existing page tests, which assert on controls rather than on their metrics, plus
the whole Playwright suite — a 44px minimum changes where things sit on every surface a spec
scrolls.

### UI-8 · The rules the rows are missing
`branch: ui/field-hint-copy`

UI-2 shipped the row and authored no copy, which was the right line for a layout slice and leaves
the pattern half-delivered: the handoff writes a hint for all 107 rows and the workspace shows two
of them. This slice writes the rest, and it is a content slice — each hint is read against what
the surface actually renders, not transcribed.

Two things it must fix on the way, both found while adopting UI-2:

- **Five create-form hints are inline string literals, not exports** — Title
  (`ProductsPage.tsx:165`), Given name, Family name, Email, Customer since
  (`CustomersPage.tsx:208,217,227,240`) and the shop's own at `ShopsPage.tsx:185`. They are
  written, but not written once, so an editor row cannot reuse one without first pulling it into
  `lib/fieldRules.ts`. That is what makes them drift.
- **A rule is shown only where it is true.** `PRODUCT_CATEGORY_RULE` offers a pick list of the
  draft's categories; the product editor renders no datalist, so UI-2 left the rule off that row
  rather than promise what is not there. Either this slice's copy accounts for the difference or
  the datalist lands first — see the defect recorded in `docs/decisions-and-next-step.md`.

*Checks:* a sweep asserting every rule in `lib/fieldRules.ts` is consumed somewhere, so an export
nothing shows fails; per-page tests that the hint is in its control's accessible description, the
pattern Slice 1 of `docs/PLAN-UX.md` established.

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
