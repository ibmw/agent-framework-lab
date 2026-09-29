# UX plan — every page is one of three templates

Status: proposed — 2026-09-28. Open slices only: a slice that lands is removed from this file.
Supersedes the 13 September plan, whose delivered Slices 1–8 and reread Slices 9–16 are in
`docs/history/PLAN-UX-2026-09-13.md`, and the 20 September plan, whose delivered Milestone 8's goal
and acceptance criteria are in `docs/history/PLAN-UX-2026-09-20.md`.

## Purpose and authority

`docs/PLAN.md` records what the lab holds; this plan records how the operator's workspace reaches
the design it was handed on 19 September 2026: the whole-workspace prototype in
`tmp/design-frames/Workspace.html`, its handoff `README.md`, and `form-decisions.md`. Since
28 September 2026 it also records how every page reaches one of the three templates that
*Shop details* and *Tone of voice* already follow (Milestone 9). Read, in
order, `AGENTS.md`, `docs/product-direction.md`, `docs/architecture.md`, `docs/PLAN.md`'s delivery
rules, `docs/design-direction.md` (its *Authority* section settles which authority governs where the
prototype, the README and the codebase disagree), then the slice's brief below and the ADRs it
names. ADR 0052 and ADR 0053 decide the model connection and the provider, and both are
implemented; ADR 0054 is the route scheme every slice below is written against.

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

Milestone 8 is delivered: Groups B and C landed, the shop logo last (ADR 0070), and its record is
the commits and ADR 0052–0072, its goal and acceptance criteria
`docs/history/PLAN-UX-2026-09-20.md`. Milestone 9 runs its slices in the order the operator
agreed, 34 then 35. The editor's side panel landed first — the 790/312 grid, `GateCard` and the
panel's order on every editor — and Tickets followed as an index, a create page and an editor
built on it (ADR 0073); then the header: every editor's way back in one slot (`HeaderBack`, the
create page's piece), every card's first line on `Card`'s `description`, and the neutral pill
(`neutralPillClasses`) Slice 34 draws *Shared across shops* with; then the rows: the agent
configuration, judge, block, identity and scenario editors on `Field`/`FieldGroup` rows, with
a gate error the draft still saves with drawn as the row's second line (`Field`'s `finding`
tone); then the lists: the editors' lists on `EntryCard`, opened in place and grown by
the add form below a rule (`addFormClasses`) whose submit is `PrimaryAction`. No open slice
depends on another. The order reshapes an editor from the outside in: panel, header, rows,
lists, then the indexes.

## Milestone 9 — Every page is one of three templates

### Goal

An operator moving between pages meets the same organisation everywhere, so that nothing about
where a control sits has to be learned twice. Every page that lists, edits or creates one thing
is one of three templates, with *Shop details* and *Tone of voice* (`routes/ShopSetupPages.tsx`)
as the reference; the Tickets page becomes the operator's direction B. The change is the UI's
only: no backend, contract or payload moves.

- **Index** — `PageHeader` (not pinned) with a one-sentence description and the create action,
  with its glyph, on the right; one index card: `SearchRow` title and `SearchField`,
  `FilterChips` (All, then the published subset and *Never published* where the listing carries
  a published version, then the domain's chips), a table whose first cell is the link with a
  muted second line, the Published column as a pill; an empty state that says why and links to
  the prerequisite; a miss that reads "No X matches this view".
- **Editor** — pinned `PageHeader` with the back link above the title, `VersionChips`,
  `EditorSaveActions` and `PublishButton` where the definition publishes, reasons beneath; body
  `grid items-start gap-5 xl:grid-cols-[minmax(0,790px)_312px]` (`ShopSetupPages.tsx:98`); a main
  column of `Card`s, each with its 13px muted description as its first line, sections on
  `Field`/`FieldGroup`/`FieldRows` rows (stacked labels only inside an add form, as
  `ProseFieldset` draws them); lists on `EntryCard` with open-in-place edit, `ConfirmRemove`
  taking the row's place, and the add form below a top rule, submitted by `PrimaryAction` with
  its `RefusalLine`; a 312px side panel holding the gate card first, read-only context cards
  next and "What publishing freezes" last — never a field of the draft.
- **Create** — `CreatePage` as built, one 790px column, landing in the editor.

Live bench, Results (with Timeline and Traces), Overview, Lab settings, Glossary and New
experiment keep templates of their own and are not reshaped here.

### Slice 34 — The indexes finished

The indexes that are already close take what is left of the index template.

- [ ] **Published as a pill.** `StatusPill` (`WorkspaceChrome.tsx:804`) gains a publication
  tone, following *The form language*'s "a status column is a `StatusPill`: glyph for the axis,
  word for the meaning" and *Principles*' "status is never colour alone": one glyph for the axis
  (the prototype's dot, drawn on both states, :189, :192), the word "v3 · 2 versions" or "Never
  published", and the two fills the prototype gives the two states from the tokens `VersionChips`
  already uses (`admin-published`, `admin-border`). Every index writes "v3 · 2 version(s)" today,
  so the wording moves with the pill. It replaces the plain text on Shops, Customers,
  Support identities, Agent configs and Judges, the *Version* column on Scenarios and the block
  libraries, and the ticket index's (`TicketsPage.tsx`). Whether `VersionChips`' own pill draws through it
  is decided in the slice and said in one sentence.
- [ ] **The create glyph** (`ButtonIcon verb="create"`) on every *New X*: Shops, Orders,
  Customers (`CustomersPage.tsx:207`), Scenarios (`ScenariosPage.tsx:101`), Support identities,
  Agent configs, Judges, the block libraries (`BlockLibraryPage.tsx:143`), Documents and *New
  product*. The glyph is `aria-hidden`; no name moves.
- [ ] **Empty states link to the prerequisite**: Orders to Customers, Scenarios to Tickets, Agent
  configs to Support identities.
- [ ] **Judges' *Never published* chip**, after *Usable* (`JudgeConfigurationsPage.tsx:46–53`).
- [ ] **The block libraries' chips**: All, Published and Never published, off
  `latest_published_version` (`BlockSummarySchema`). The prototype's domain chips (:6284–6310 —
  *Decided by a rule*, *Scored by a judge*, *Fault hooks*, *Setup mutations*, *Not composed yet*)
  are not built: the listing carries no usage figure, and the kind is the composed display
  string `type_label` (`application/blocks.py:223`, :256) rather than a field.
- [ ] **"⇄ Shared across shops"** (`BlockLibraryPage.tsx:133`) draws through the neutral pill,
  `neutralPillClasses` in `lib/ui.ts`. The premise paragraph (:154) stays, as the prototype's
  callout (:3565).
- [ ] **New document in the header** (`DocumentsPage.tsx:165`), beside the shop draft's Save and
  Discard.
- [ ] **A failed listing says its failure and nothing else**: Scenarios (`ScenariosPage.tsx:135`),
  Shops (`ShopsPage.tsx:162`) and Customers (`CustomersPage.tsx:299`) stop falling through to
  "No … yet" under the alert.
- [ ] `docs/design-direction.md`: the *Departures* row "Filter chips on Tickets and the block
  libraries" becomes the block libraries' five undrawn chips; a row for *New document*'s place.

Frames: `Workspace.dc.html` :189 and :192 (the pill; also :1178, :1481, :1618, :3262, :3443);
:3556–3590 (a block library, its chips at :3573); :1514–1536 (Documents); :3406–3453 (Judges).

Authority: ADR 0056 (the listing a chip counts), ADR 0057 (the Documents table).

Departures to record: *New document* leaves the card's header row the prototype draws (:1535)
for the page header, the operator's request; the five block chips above.

Branch: `feat/index-polish`. Checks: `WorkspaceChrome.test.tsx` for the tone; `Shops.test.tsx`,
`Customers.test.tsx`, `SupportIdentities.test.tsx`, `AgentConfigurations.test.tsx`,
`JudgeConfigurations.test.tsx`, `Scenarios.test.tsx`, `Blocks.test.tsx`, `Orders.test.tsx` and
`Documents.test.tsx` — the pill's word, the glyph without a name change, the link in the empty
state, the chips and their counts, the failure without the empty sentence; Playwright
`block-library` (it reads "v1 · 1 version(s)", :94), `customer-publication` and
`shop-publication` (they read "Never published" by text, which the pill and the chip must not
make ambiguous).

Slice evidence: every index says a record's publication the same way, in a pill; an empty Orders
page says an order needs a customer and links to Customers; the block libraries filter.

### Slice 35 — History as an index card

History keeps its submitted, URL-backed form and takes the index's card.

- [ ] The form outside any card (`ExperimentHistoryPage.tsx:396–550`) moves into the index card:
  a `SearchRow` titled for what it lists with the search box, submitted as today; the status as
  `FilterChips` inside the card, each press narrowing the address's `status` at once as the
  selects do now; Shop, Scenario, Framework, Tag, Objective outcome and Started as a second row of
  the card; *Clear filters* and *Search* keep their order and their behaviour.
- [ ] `FilterChips` takes a chip without a count (`FilterChips.tsx:18–23`), whose name is its
  label alone: `ExperimentHistoryResponse` carries a page and a total and no count per status,
  and a figure the payload lacks is not faked.
- [ ] The status is `StatusPill` (`WorkspaceChrome.tsx:804`) with a run-status tone, replacing
  the colour map (:33–37) and its span (:763–767).
- [ ] The empty state and the miss part (:571–576): with nothing recorded at all — the lab's
  total, which the shell already holds (`shell/listings.ts:270`) — the page says so and links to
  the bench; otherwise "No experiment matches this view".
- [ ] *New experiment* with the create glyph in the header, to `/lab/bench`.
- [ ] The rows' secondary lines at 13px, as the other indexes' (`text-xs` at :703, :708, :721).
- [ ] `docs/design-direction.md`: *Lists and counts*' sentence on History's form is rewritten for
  the card; *A chip lives in the component unless an address has to name it* gains History's
  status as its second exception; a *Departures* row for the filters inside the card where the
  prototype draws them above it (:2676–2682).

Frames: `Workspace.dc.html` :2670–2697; :3569–3580 for the card's head and chips.

Authority: ADR 0033 (the URL-backed history), ADR 0056, ADR 0063 (*Clear filters*).

Departures to record: the filters inside the card, the operator's request; status chips without
counts.

Branch: `feat/history-index-card`. Checks: `History.test.tsx` (a chip narrows the address and
the listing, *Clear filters* drops it, the empty state and the miss apart, the pill);
`FilterChips.test.tsx` for the count-less chip's name; Playwright `experiment-start`, which
narrows history by Framework and searches (:731–760) and reads "No experiment matches these
filters".

Slice evidence: an operator on History presses *Failed*, the address says so, a reload keeps it,
and *Clear filters* brings every run back; a lab with no run is told how to start one.

### Acceptance criteria

- Every editor's body is the 790/312 grid, with the gate card first, the freeze card last and no
  editable field in the panel.
- Every editor has its way back in one slot, and every card says what it is for on its first
  line.
- Every editor section is on field rows, stacked only inside an add form.
- Every list is `EntryCard`, removes through `ConfirmRemove` wherever ADR 0060 asks twice, and
  grows through an add form below a rule whose submit is `PrimaryAction`.
- Every index has a header with a description and a create action with its glyph, one card with
  a title, a search and chips, publication as a pill, an empty state that links, a miss that
  says so, and a failed listing that says only that.
- Tickets are an index, a create page and an editor, with an ADR, and nothing redirects.
- History narrows inside one card and its form is still the address.
- Nothing in the backend or a contract moved, no figure a payload lacks is drawn, the Playwright
  journeys pass, and every renamed accessible name lists the specs it touched.

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
- **Read-only version pages for configurations and scenarios.** The results link a pinned
  version to its definition's editor (ADR 0068); a frozen view per definition is worth its own
  slice in `docs/PLAN.md` if a review journey needs it.
