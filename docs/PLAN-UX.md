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
agreed, 30 to 35. The editor's side panel landed first — the 790/312 grid, `GateCard` and the
panel's order on every editor — and Slice 30 builds the ticket editor on it; Slice 31 moves the
ticket editor's back link onto the header slot with every other editor's, and gives Slice 34 the
neutral pill class set it draws *Shared across shops* with. Slices 32, 33 and 35 depend on no open
slice; 34 follows 30 and 31. The order reshapes an editor from the outside in: panel, header,
rows, lists, then the indexes.

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

### Slice 30 — Tickets as an index, a create page and an editor

The Tickets page becomes the three templates every other surface already is (direction B),
leaving the three-pane helpdesk.

- [ ] Write ADR 0073 (the next free number when this plan was written; check `docs/adr/` at
  branch time) with the slice: it supersedes ADR 0016's *The helpdesk workspace* (the three-pane
  anatomy) and amends ADR 0066's paragraph on the ticket editor as the one editor that is not
  its page; it records the three routes, the redirect's removal, the create page, and that the
  thread still authors history and never live replies. It records the prototype's (:2170–2322)
  and the README's ("Three-pane; header spans list + customer panel") drawings as departures.
- [ ] **Index** at `/shops/:shopId/tickets` (`routeTree.tsx:177`): `PageHeader` "Tickets", one
  sentence, and *New ticket* with the create glyph, linking to `new`. One index card: a title
  that says what it lists (added to the *Index card titles* departure row), `SearchField` over
  subject, reference and customer, `FilterChips` All, then Published and Never published —
  `TicketSummarySchema` carries `latest_published_version` and `published_version_count`
  (`openapi.yaml`:13926–13932) — then Open and Resolved. Table: the subject as the link with the
  mono reference under it, the customer, the channel with "from <origin>" under it, the status
  as `StatusBadge` draws it (`TicketsPage.tsx:276`), Published in the words the other indexes
  write today (Slice 34 makes it the pill with theirs), Draft updated. The empty state says a
  ticket is raised by a customer attached to this shop and links to Customers when none is;
  the miss reads "No ticket matches this view"; a failed listing says its failure and nothing
  else. The "N in this shop" description goes (`TicketsPage.tsx:176–179`): the count is the All
  chip's, off the listing the rail counts (ADR 0056). The redirect to the newest ticket
  (:142–166) goes.
- [ ] **Create page** at `/shops/:shopId/tickets/new`: `CreatePage` with the fields
  `NewTicketForm` asks today (:284–450) — Subject, Customer (attached customers only, one
  already chosen when it is the only one, ADR 0064), Channel (the shop's channels), Reference
  (`DerivedIdField`, `nextReference("T", …)`, `TICKET_REFERENCE_RULE`) — and a *Created as a
  draft* card saying the first message is written in the thread. Create is `CreatePage`'s
  `PrimaryAction`, refused with its reason; it refreshes `listings.tickets` and lands in the
  editor. The route is added to `CREATE_ROUTES` (`lib/tours.ts:529`). Its Create is named as the
  other create pages name theirs ("Create ticket"), and the specs that press "Open ticket"
  change with it.
- [ ] **Editor** at `/shops/:shopId/tickets/:ticketId` (`routeTree.tsx:178`), its own page on the
  editor template: pinned `PageHeader` with the subject as its title, the reference as a mono
  chip, the status, `VersionChips`, `EditorSaveActions`, `PublishButton` and the reasons
  (:536–600); the back link to Tickets goes in `description` as the other editors' do until Slice
  31 gives every editor the slot. Main column: **Incident** (Subject, Status, Channel, Opened
  from with its product or order, Tags — from *Ticket details*, :950–1073, on field rows);
  **Conversation** (the thread, :625–790, as a card: prior history, the trigger divider and the
  bubbles, with the composer as the card's add form below its rule — "Add a history message" and
  "Add to thread" keep their names); **Linked orders** (from *Linked objects*, :1115);
  **Suggested documents** (:1174, grouped by kind). Side panel (`editorPanelClasses`): `GateCard`
  titled "Publish gate" in place of *Validation* (:609); **Customer** (:1076) with *Other tickets from this customer*
  (:1233) inside it; "What publishing freezes", saying a scenario built on the ticket freezes
  its published version.
- [ ] The tours: the `tickets` tour loses `alsoAt: [":ticketId"]` (`lib/tours.ts:352`) and stays
  the index's; the editor and the create page carry none. `lib/tours.test.ts` (:252–253,
  :310–341) and the settling comment in `tour-anchors.spec.ts` (:136–150) change with it.
- [ ] `docs/design-direction.md`: *Direction*'s "Tickets use the three-pane helpdesk anatomy";
  *The form language*'s "Ticket authoring stays inside the three-pane screen" and its list of the
  creates that are pages; *A blocked primary action says why*'s count of create pages; *Lists
  and counts*' "the ticket editor's own header in its column included"; *Principles*' "the
  ticket side panels"; the *Departures* rows "The Tickets page's title and count" (removed) and
  "Filter chips on Tickets and the block libraries" (Tickets leaves it).

Frames: `Workspace.dc.html` :2170–2322 for what the helpdesk holds — the list's head and rows
(:2174–2193), the subject (:2200), the composer (:2243), the customer (:2251), what is linked
(:2267) and the suggested documents (:2293); :149–200 and :3225–3285 for the index; :1195 and
:1326 for a create page; :385–480 for the editor.

Authority: ADR 0016, ADR 0051, ADR 0054, ADR 0056, ADR 0060, ADR 0063, ADR 0064, ADR 0066,
ADR 0067.

Departures to record: the whole composition departs from the prototype's three panes and from
the README's screen table, which the ADR records; the prototype draws no chips on Tickets, and
the four built are the ones the listing can count.

Branch: `feat/tickets-index-and-editor`. Checks: `Tickets.test.tsx` for the index (chips and
their counts, search, the empty state and its link, the miss, the failed listing, no redirect),
the create page (the refusal and its reason, the derived reference, one customer already chosen,
landing in the editor with the listing refreshed) and the editor (cards in order, the panel, the
header); `App.test.tsx` for the route tree against `CREATE_ROUTES`; `lib/tours.test.ts`;
Playwright `ticket-authoring`, `scenario-authoring` and `experiment-start` (they create a ticket
through "Open ticket" and read `card(page, "Tickets")`, "Ticket thread", "Ticket details",
"Linked objects" and "Validation"), `sticky-header` (the ticket editor becomes its page at its
own address, and the create page joins the surface table; the fixture makes a ticket
(`tests/e2e/support/lab.ts:222–231`) and does not return it, so its return value, :438, gains the
ticket's id), `workspace-shell`, and `tour-anchors`.

Slice evidence: an operator opens Tickets and reads a table of the shop's incidents with Open 3 ·
Resolved 1; presses *New ticket*, types a subject, is refused Create until a customer is chosen,
and lands on the ticket's own page with the thread in the main column and the gate on the right.

### Slice 31 — The editor's back link and the card's first line

The way back to an index and the sentence that says what a card is for sit in one place on every
editor.

- [ ] `PageHeader` (`WorkspaceChrome.tsx:107`) gains a back slot drawing what the prototype draws
  above an editor's title — the ← button and the "Index · kind" line (:388–390) — which is what
  `CreatePage` already draws (`CreatePage.tsx:99–113`): one piece for both, named "Back to
  {index}" as `CreatePage`'s is. Consumers: the six editors whose link lives in `description`
  (Agent config :339, Judge :184, Block :141, Scenario :214, Customer :469, Support identity
  :142), the three that have none (Product :392, Order :380, Document :118), the ticket editor
  (Slice 30), Shop version ("back to the draft", `ShopVersionPage.tsx:85`) and Snapshots ("Back
  to the scenario", `SnapshotsPage.tsx:164`). The setup pages have no index and take none.
- [ ] `Card` (`WorkspaceChrome.tsx:261`) gains `description`, the 13px muted first line under the
  title (:408), which the reference pages draw by hand today (`ShopSetupPages.tsx:324`, :366,
  :389; `ShopMethodCards.tsx:524`, :764) and move onto. Every editor card whose explanation is
  a `footer` note or a trailing `text-xs` paragraph moves it there — Customer's Address book,
  Persona, Background and Hidden facts (`CustomerEditorPage.tsx:664`, :823, :862, :960), Block
  Parameters (`BlockEditorPage.tsx:244`), Judge Rubric and Evidence
  (`JudgeConfigurationEditorPage.tsx:293`, :301), Support identity Permissions
  (`SupportIdentityEditorPage.tsx:276`), Order events (`OrderEditorPage.tsx:851`) and the rest a
  sweep of `footer=` and trailing notes on editor cards finds. A note that is a control's
  accessible description keeps its `id`; a footer that holds an action (Order events' *Add
  event*, the Document card's Remove) stays a footer.
- [ ] `CreatePage`'s standing chip (`CreatePage.tsx:120`) and Cancel (:126) leave their raw
  classes: the chip for a neutral pill class set in `lib/ui.ts`, which `VersionChips`' two grey
  pills (`WorkspaceChrome.tsx:45`, :54) draw through too, and Cancel for the button table.

Frames: `Workspace.dc.html` :387–392 for the header; :407–408 for a card's first line.

Authority: ADR 0063 (what a header reports), ADR 0066.

Departures to record: the audit named the link "‹ Index"; the prototype draws ← and a
breadcrumb line, and that is what is built.

Branch: `feat/editor-header-and-card-description`. Checks: `WorkspaceChrome.test.tsx` for the
slot (name, target, the kind line) and the description (first line, absent when not given);
`CreatePage.test.tsx`, and the create-page tests that pin "Back to {index}" on its consumers
(`AgentConfigurations.test.tsx` :1311, `Orders.test.tsx` :636), which the shared piece must keep
green; new coverage, one test per editor, that the link is there and where it goes; Playwright
`scenario-authoring`, which presses "Back to the scenario" (:411) — the name stays or the spec
changes with it — and `sticky-header` for the header's height.

Slice evidence: on every editor the way back is the same button in the same corner, and every
card's first line says what the card is for.

### Slice 32 — Field rows on the editors that still stack

The editors that stack a label over its control take the row the reference pages use.

- [ ] Agent config: the stacked labels (`AgentConfigurationEditorPage.tsx:401`, :409, :424,
  :444, :462, :483, :512, :556, :859), the raw `sm:grid-cols-2` pair (:673) and the memory
  fieldset (:738) go onto `Field`/`FieldGroup` rows inside their current cards.
- [ ] Judge: Name, Description and the rubric (`JudgeConfigurationEditorPage.tsx:253`, :261,
  :270), and the Model card's Provider, Model and Temperature (the `FieldHint`s at :335 and
  :371, and `ProvenModelField`). The card keeps the name "Model"; the prototype draws Provider and
  Model in the card that holds Name (:503–518), and moving them there would rename the card
  `experiment-start.spec.ts:350` reaches.
- [ ] Block: Name, Statement and Description (`BlockEditorPage.tsx:209`, :217, :230), and the
  Assessment (:514, :544) and Effect (:585) cards. `ParameterForm`'s stacked labels (:413, :429,
  :443) are an add form's and stay.
- [ ] Support identity: Role's fields (`SupportIdentityEditorPage.tsx:210`, :220, :230),
  Escalation (:369), and the two permission fieldsets with their uppercase legends (:250–275),
  which become `FieldGroup` rows named Read and Act as the prototype names them (:1818, :1834).
  The guidance add form (:463, :472) stays stacked.
- [ ] Scenario: *Built on* (`ScenarioEditorPage.tsx:307`) — Name (:308) and the read-only
  ticket, customer and shop version (`Row`, :732) — and *Completion* (:579) with
  `TurnCapField` (:705). The bound blocks' `BindingField` (:864) is a list row's, and Slice 33's.
- [ ] Every hint stays in its control's accessible description and every label keeps its text,
  which is what the specs reach the controls by.

Frames: `Workspace.dc.html` :407–466 (agent), :503–518 (judge), :588–612 and :662–680 (blocks),
:1787–1834 (identity), :3047–3062 (scenario *Built on*).

Authority: ADR 0050, ADR 0069 (a field states its own width); `docs/design-direction.md`, *The
form language*, *The row*.

Departures to record: the cards keep the codebase's grouping (the prototype groups the agent
editor as Runtime, Identity and Tools, :407, :442, :452); only the rows change.

Branch: `feat/editor-field-rows`. Checks: `AgentConfigurations.test.tsx`,
`JudgeConfigurations.test.tsx`, `Blocks.test.tsx`, `SupportIdentities.test.tsx`,
`Scenarios.test.tsx` — each field found by its label, its hint in its description, a fieldset
named by its row; `lib/fieldRules.test.ts` where a hint moves; Playwright `agent-configuration`,
`block-library`, `scenario-authoring` and `experiment-start`, which fill these fields by label.

Slice evidence: the agent configuration, judge, block, identity and scenario editors read like
*Shop details* — label and rule on the left, control on the right, wrapping when narrow.

### Slice 33 — Lists on `EntryCard`, and one add form

Every list a page edits is the same row, opened the same way, added to by the same form.

- [ ] `addFormClasses` moves from `ShopSetupPages.tsx:151` to `lib/ui.ts`, because the lists below
  in five other route files draw their add form with it.
- [ ] Order events (`OrderEditorPage.tsx:879`), always-editable divs today: `EntryCard` rows that
  open in place; *Add event* (:845) becomes the add form below the rule, asking the event's
  fields; the `ConfirmRemove` (:860) stays.
- [ ] Customer addresses (`CustomerEditorPage.tsx:699`), always-editable today: `EntryCard` rows
  that open in place, the default chip and *Make default* on the row, `AddressForm` (:1157) as
  the add form.
- [ ] Block parameters: `ParameterRow` (`BlockEditorPage.tsx:320`) becomes an `EntryCard` whose
  kind, description and default are edited in the open row; the ↑/↓ (:385, :394) stay on the row,
  because the order is authored; `ParameterForm` is the add form.
- [ ] Scenario bound blocks: `BoundBlockRow` (`ScenarioEditorPage.tsx:750`) draws through
  `EntryCard` rather than copying its classes, and its bindings (`BindingField`, :864) move onto
  field rows in the open row.
- [ ] New block's parameters (`BlockLibraryPage.tsx:366–391`) are `EntryCard`s and keep their
  one-press Remove: ADR 0060 exempts a removal on a create page before Create is pressed, and
  names these parameters (ADR 0060, *Every removal that is not trivially re-added asks twice*).
- [ ] New scenario's composed rows (`ScenariosPage.tsx:333–352`) are `EntryCard`s without Edit —
  nothing can be edited before the first write.
- [ ] Every add form's submit is `PrimaryAction` with the create glyph and its `RefusalLine`, as
  *Tone of voice* draws it (`ShopSetupPages.tsx:623–631`): the raw accent submits
  (`ProductEditorPage.tsx:1380`, :1573, :1815, :1960), the raw ink ones
  (`SupportIdentityEditorPage.tsx:498`, `CustomerEditorPage.tsx:1230`, :1259, :1280) and the raw
  outline one (`OrderEditorPage.tsx:581`). Their names do not move.
- [ ] `docs/design-direction.md`: *A blocked primary action says why* stops restricting
  `PrimaryAction` to "the add forms refused for a reason no field states"; *A saved row opens
  where it stands* names the lists it now covers.

Frames: `Workspace.dc.html` :1914 (the guidelines list, the reference), :607–612 (a block's
parameters), :3091–3120 (a scenario's composed blocks).

Authority: ADR 0051 (an open row is not in the draft until Save), ADR 0060, ADR 0063;
`form-decisions.md` 8.2 and 9.2.

Branch: `feat/lists-on-entry-card`. Checks: `EntryCard.test.tsx`; `Orders.test.tsx`,
`Customers.test.tsx`, `Blocks.test.tsx`, `Scenarios.test.tsx`, `SupportIdentities.test.tsx` and
`App.test.tsx` (the product lists) — one row open at a time, Cancel writes nothing, the confirm
takes the row, the add form's refusal; `lib/ui.test.ts` if the class set is pinned; Playwright
`order-fixture`, `customer-publication`, `block-library` and `scenario-authoring`, which add
addresses, lines, events, parameters and bindings by name.

Slice evidence: an operator corrects an order event, an address and a block parameter by pressing
Edit on the row, and adds each through a form below the list that says why it will not submit.

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
  libraries, and the ticket index's (Slice 30). Whether `VersionChips`' own pill draws through it
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
- [ ] **"⇄ Shared across shops"** (`BlockLibraryPage.tsx:133`) draws through the neutral pill
  class set of Slice 31. The premise paragraph (:154) stays, as the prototype's callout (:3565).
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
