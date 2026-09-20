# UX plan — the workspace becomes the prototype

Status: proposed — 2026-09-20. Supersedes the 13 September plan's Slices 9–16 and the behaviour
and provider sections of `docs/implementation-plan.md`, which is now the record of what the
pattern slices built rather than a plan.

## Purpose and authority

`docs/PLAN.md` records what the lab holds; this plan records how the operator's workspace reaches
the design it was handed on 19 September 2026: the whole-workspace prototype in
`tmp/design-frames/Workspace.html`, its handoff `README.md`, and `form-decisions.md`. Read, in
order, `AGENTS.md`, `docs/product-direction.md`, `docs/architecture.md`, `docs/PLAN.md`'s delivery
rules, `docs/design-direction.md` (its *Authority* section settles which authority governs where the
prototype, the README and the codebase disagree), then this plan and the ADRs a slice
names. ADR 0052 and ADR 0053 are already accepted and precede the slices that implement them.

The plan sits under `docs/PLAN.md`'s delivery rules and changes none of them.

## Where the work stands

Two plans have shipped into the workspace since 13 September, and both are complete for what they
set out to do. Neither made the application *look like* the prototype, and this section says why
before the slices say what to do about it.

**The 13 September plan, Slices 1–8 — forms that guide the operator.** Hints under every field,
derived identifiers, enum labels, currencies on the create form, chip and country and number
controls, closed sets from the proven table, edit-in-place on every saved row, and the unsaved-work
guard with the router migration it needed (ADR 0051). All eight are ticked in Git history and
recorded, rule by rule, in `docs/design-direction.md` and, with their reasoning, in
`docs/design-direction-history.md`. The prototype assumes every one of them —
its 107 form rows carry hints, its saved rows open where they stand, its headers say "All changes
saved" — so nothing here was wasted, and none of it is redone below.

**The 19 September handoff, UI-1 to UI-8 — the pattern layer.** Pine primary and the glyph
vocabulary, the `Field` row, the rail's metrics and collapse, filter chips with counts, the
display type, the search field, the shared control's metrics, and the rows' copy. Each is
recorded in `docs/implementation-plan.md` with its census and its departures. Each is
cross-cutting and real, and each is invisible at the level the operator navigates at: after all
eight, the app opens on the same shell, the same routes, the same side-card create forms and the
same settings page it had on 18 September, drawn in the prototype's colours and type.

**What the prototype is, that the pattern layer is not.** Read screen by screen against the
running app, the prototype's identity is structural. Ten things carry it, and no delivered slice
touches any of them:

1. **Two modes, two rails.** A *Shop fixture* tab and an *Experiment lab* tab in the top bar
   (`Workspace.dc.html`:68–73), each with its own rail (`shopRail` :4753, `labRail` :4822). The
   lab rail is Bench, History and a *Library* of agent configurations, judges, support identities
   and the two block libraries. The app has one rail, inside a shop, with the lab filed under an
   "Experiment lab · cross-shop" heading and the block libraries nested under Scenarios; every lab
   route is `/shops/:shopId/…`. The API already draws the prototype's line — configurations,
   judges, identities and blocks are shop-independent resources and history is one cross-shop
   listing — so the app's routing is the only thing on the wrong side of it.
2. **The top bar.** A shop switcher that opens a panel with logo badges (README, *Chrome*); the
   mode tabs; *Show me around* and *Settings* as bar controls, Settings lit with a close glyph
   while its page is open. The app has a native `<select>`, no tabs, a tour button on each page
   header, and a pill link.
3. **Creating is a page.** New shop (:212), New order (:1202), New customer (:1333), New identity
   (:1643), New scenario (:2925), New configuration (:3293), New judge (:3468) and both New block
   screens are focused pages under a sticky header — back arrow, "Orders · creating an order
   fixture", the typed name as the title, a "nothing created yet" chip, Cancel and a Create button
   that is dashed and disabled with the reason until the form can be submitted — in the 790px
   column `form-decisions.md` chose (*layout 2b*). Every index's header carries the primary
   "New …" button. The app creates from a 380px side card on each index, which is the layout
   `form-decisions.md` says was *not* chosen.
4. **The shop overview** (:722): a version timeline ending on the draft, a two-step "Review N
   changes & publish" that lists what becomes the next version, jump cards for what the shop
   holds, findings on the draft grouped by the entry that is wrong, and recent activity. The app's
   Home is three count cards, an issue list and a versions table.
5. **Settings** (:3854): a centred column with "← Back to workspace", three zones told apart by
   surface — browser preferences, the lab-wide model provider with Save/Discard, a collapsed
   read-only runtime disclosure — and the seed action below. The app's page is two columns of
   read-only cards with a preferences card in the corner.
6. **The model connection** and the provider note it enables in the editors — decided in ADR 0052
   and ADR 0053, with no code behind either yet.
7. **Documents.** Policies, FAQ and support guidelines are one table with kind chips and a
   document editor page (:1518, :3163); the shop rail has no *Support guidelines* entry. The app
   has two authored lists on one page and a third page, which is why UI-4 and UI-6 both left that
   surface without the chips and the search the prototype draws.
8. **New scenario** composes hidden facts, objectives and mutations at creation and refuses to
   create until a name and one objective exist — the one behaviour slice of the handoff the app
   does not already have.
9. **Counts on the rail** — every entry carries its listing's count (:4753), which UI-3 deferred
   to UI-4 and UI-4 did not own.
10. **The Setup checklist** on Shop details (:2156, :6565) and the "Run a comparison — everything
    this needs is ready" card on the overview, both derived readings of the record. See
    *Decisions the prototype forces*.

That is the gap the operator feels, and it is the whole of this plan's Groups A and B.

**What the 13 September plan's unfinished slices were, against the prototype.** Slices 9–16 were
written against the September 13 backlog, before the prototype existed. Each was reread against
it, and the verdicts are these:

| Old slice | Verdict | Where it went |
| --- | --- | --- |
| 9 — Removing is deliberate | The prototype draws two-step confirms and `form-decisions.md` 9.2 chose them. Kept. | Slice 21 |
| 10 — After create, open what you created | Subsumed: a create page lands in the editor by construction, and the prototype's "New product" appends to the draft and opens the editor (:6931). | Slices 12, 13, 14 |
| 11 — Long-running actions report themselves | The prototype's bench says where each arm stands (:2396); `form-decisions.md` 10.2 chose the queue. Kept, re-anchored. | Slice 24 |
| 12 — The form says it before the gate does | The prototype's rule for every refusal (README, *Interactions*). Kept, with the dashed disabled variant and the under-control message it did not have. | Slice 22 |
| 13 — Findings link to the fix, next step named | First bullet is the overview's "Findings on the draft" (11.2). The `SETUP_CHAIN` next-step sentence is drawn nowhere in the prototype and is cut. | Slice 15; cut |
| 14 — Defaults, and setup as a sequence | The prototype's New experiment copy is exactly this ("the only published scenario in the shop, so it is already chosen", :2333). Kept, pruned. | Slice 23 |
| 15 — Save stays in reach | The prototype's ten editor and create pages carry a sticky header (:207 …). Kept. | Slice 25 |
| 16 — Consistency sweep | Items the prototype draws stay (History's *Clear filters* and trailing *Search*, :2673; naming). Items it does not — `GuideProse` footers, the matrix's per-cell sentence, a copy control on `Fingerprint` — are cut. | Slice 26; cut |

Nothing ticked in Slices 1–8 is reopened, and the three defects `docs/decisions-and-next-step.md`
lists under *Known application defects* are given a slice instead of a footnote.

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
- **No backend change unless the slice says so.** Three slices carry one: the model connection
  (ADR 0052), the reachable-provider read it enables (ADR 0053), and the shop counts the rail
  needs if the listings the shell already has cannot supply them. Each ships the OpenAPI update,
  the backend and the consumer together.
- **Standing decisions hold.** ADR 0044 refused a stored checklist and ADR 0045 removed the
  derived progress strip; ADR 0049 keeps the tours per surface; ADR 0051 asks about unsaved work
  once; ADR 0052 and ADR 0053 decide the connection and the provider. Where a slice takes a
  decision of its own — a route scheme, a confirm policy, a preference — it writes an ADR.
- **Accessible names do not move casually.** `nav[aria-label="Shop workspace"]`, the tour
  anchors and every button's name are what eleven Playwright specs reach the app by. A slice that
  renames one lists the specs it touched.

## Decisions the prototype forces

Three things in the prototype are not layout, and each is decided here so that no slice has to.

**The lab is a mode, and the routes say so.** The prototype's two rails are the product
direction's *Studio / Bench / History* navigation made concrete, and the API already scopes the
resources the same way. Slice 9 writes the ADR and moves the routes: lab surfaces leave
`/shops/:shopId/` for `/lab/…`, and the old paths redirect. Two consequences are decided with it.
First, the lab keeps a *current shop*: experiments are shop-scoped in the API and the bench
composes a scenario of one shop, so the switcher stays in the top bar in both modes as the
prototype draws it (`inShop`, :5739), and the lab's current shop is the one the switcher shows —
the remembered shop `lib/preferences.ts` already holds, chosen deliberately on the shops index
when none is remembered. Second, an experiment's own pages carry their shop in the path
(`/lab/bench/:shopId/:experimentId/…`), because a run must stay linkable after the switcher
moves, while the listings and the library carry none.

**The Setup checklist is not built, and the readiness card reads one listing.** The checklist
the prototype draws on Shop details (:2156) — products, an identity, a tone default, an FAQ, no
blocking findings, each ticked or not — is the derived progress reading ADR 0045 removed, drawn
smaller. It is refused on the same grounds and is not a slice. The overview's "Run a comparison"
card is kept in the narrower form the standing rules allow: it reads the shop's scenarios listing
and says either that a published scenario exists, naming it with a link to New experiment, or
that none does, with a link to Scenarios — which is the *empty state says why and links to the
prerequisite* rule, not a reading of progress. Its findings card is the overview's, grouped by
entry, and reads `preview.issues` exactly as the publish gate writes them.

**Two of the five proposed preferences earn a consumer; the logo waits for its own.** *Where the
app opens* has a consumer the moment `/` decides between the remembered shop, the shops index and
the lab, so it lands with the lab mode. *Timestamps, relative or absolute* has one in
`formatTimestamp`, which every listing already calls. *Confirm before anything is deleted* exists
only once Slice 21's confirm exists, and lands there or not at all. *Offer a tour on a surface I
have not opened before* needs a per-surface visited record the browser does not keep and would
make a tour start unbidden, which ADR 0049 refused; cut. *Table density* decides nothing any
list reads; cut. The shop logo — icon, background, mark colour, a contrast check — is three
columns on the shop payload and a canonical-document change; it is the last slice and is dropped
if the switcher panel and the shops index can be read without it.

## Sequencing

Slice 9 first and alone: it moves routes, and every later slice, spec and tour anchor is written
against the routes it leaves behind. Slice 10 follows it because the top bar draws the mode tabs
Slice 9 creates. Slices 12, 13 and 14 next, because they change what every index page is and what
every journey clicks through to create; they are independent of each other. Slices 11, 15, 16,
17 and 18 are then independent and can proceed in parallel. Slice 19 is the backend milestone and
runs beside Group B; Slice 20 needs it. Group C's slices 21–25 depend on nothing in Group B
except that 25 waits for 12–14, since the sticky header is on the pages they create. Slices 26 and
27 close the milestone, and 28 is optional.

## Milestone 8 — The workspace becomes the prototype

### Goal

An operator who opens the app sees the prototype: a shop fixture and an experiment lab as two
modes with their own rails, a top bar that switches shops and offers the tour, creation as a page
that lands in the editor, an overview built around the version timeline and the publish review, a
settings page whose three zones say what may be touched, and a lab-wide model connection that a
run pins. Everything the September plans delivered — hints, derived identifiers, labels, chips,
edit-in-place, the guard, pine, the field row — is still there underneath.

### Group A — Chrome and information architecture

#### Slice 9 — The lab is a mode

- [ ] Write the ADR: two modes, the route scheme above, the current-shop rule, the redirects, and
  what the shop rail loses. Written before the code, as ADR 0052 was.
- [ ] Move the routes. `/lab/bench`, `/lab/bench/:shopId/:experimentId` and its `results`,
  `timeline` and `traces` children, `/lab/history`, `/lab/agent-configurations(/:id)`,
  `/lab/judges(/:id)`, `/lab/support-identities(/:id)`, `/lab/objective-blocks(/:id)`,
  `/lab/mutation-blocks(/:id)`. Every old `/shops/:shopId/…` lab path redirects to its new one,
  carrying the shop into the remembered-shop preference on the way. Scenario snapshots stay in
  shop scope.
- [ ] A `LabWorkspace` shell beside `ShopWorkspace`: the same `AppShell`, the lab rail from a
  second section table, the current shop resolved from the preference against the shop list, and
  a bench that says which shop it composes for. With no shop remembered, the bench and the
  history's shop filter say so and link to the shops index; the library screens need none.
- [ ] The shop rail becomes the prototype's: Overview, Products, Orders, Customers, Tickets,
  Scenarios; *Shop setup*: Policies & FAQ, Support identities, Tone of voice, Shop details. The
  cross-shop section goes, the block libraries leave the Scenarios nest for the lab's Library,
  and Support identities is on both rails because the prototype draws it on both. "Home" is
  renamed "Overview" here and nowhere else in this slice — the page's composition is Slice 15's.
- [ ] `/` decides where the app opens from the *Where the app opens* preference — the remembered
  shop, the shops index, or the lab — defaulting to the remembered shop; the control for it
  arrives in Slice 18 and the default is the only path until then.
- [ ] The tours follow their surfaces: `lib/tours.ts` names each surface by route, and the
  `tour-anchors` spec holds every step to one visible element on the new path.

Frames: `Workspace.dc.html` :4753 and :4822 for the two rails; the *Chrome* section of the
README for the rail's hidden states.

Branch: `feat/lab-mode`. Checks: `App.test.tsx` for the route tree, the redirects and the landing
rule; `AppShell.test.tsx` for both rails and every collapsed destination still named; every
Playwright spec, because every one navigates and `workspace-shell`, `tour`, `tour-anchors`,
`experiment-start`, `agent-configuration` and `block-library` address lab routes by path.

Slice evidence: an operator on Northstar's Overview clicks *Experiment lab* and stands on the
bench with Northstar's published scenario offered and the rail reading Bench, History, Library;
a bookmarked `/shops/…/bench/…/results` still opens the same results. A new operator with no shop
lands on the shops index and is not offered a bench that would compose for nobody.

#### Slice 10 — The top bar

- [ ] Mode tabs — *Shop fixture* and *Experiment lab* — with the glyph, the 2px underline and the
  inactive `#a8c1b8`, present in shop and lab scope, absent on the shops index and on Settings.
- [ ] The switcher becomes a button opening the 300px panel: the current shop with a check, the
  others with their version, a divider, an "All shops" row; dismissed on outside click, on
  `Escape` and on navigation; the shop's badge is its initials on `lab-ink` until Slice 28 gives
  it a logo. It is a `menu` with roving focus, not a `<select>` — one of the eleven specs picks a
  shop by its name and changes with it.
- [ ] *Show me around* moves into the bar: one `TourLaunch` mount reading the current surface's
  tour from the route, lit only where a tour exists, with the page-header launch removed from
  every route file. The tour itself, its table and its anchors do not change (ADR 0049).
- [ ] *Settings* renders lit with a close glyph while its page is open and returns to what was
  underneath on the second click — the remembered location rather than history, so a reload does
  not strand it.
- [ ] The app title returns to the shops index and hovers `#cfe0d8`; the bar takes the README's
  56px and `#16332d`, recorded in `styles.css` as the top bar's own token if `lab-ink` is kept
  for the buttons that use it.

Frames: `Workspace.dc.html` :58–:82 and the README's *Chrome* section.

Branch: `feat/top-bar`. Checks: `AppShell.test.tsx` for the tabs' active state per route, the
panel's open, choose, dismiss and focus order, the tour control's presence per surface, and the
Settings toggle; `TourLaunch.test.tsx` moves its mount; Playwright `workspace-shell`, `tour` and
`tour-anchors`, and any spec that opened a tour from a page header.

Slice evidence: an operator switches from Northstar to Alpenglow from the bar without leaving
the page's mode, opens the tour for the screen they are on from the same bar, and closes Settings
back onto the product they were editing.

#### Slice 11 — Counts on the rail

- [ ] Each rail entry carries its listing's count, right-aligned, muted, absent while the listing
  is in flight or failed — the same rule the chip row observes. Shop rail: products, tone
  guidelines and documents from the draft in hand; orders, customers, tickets and scenarios from
  their listings. Lab rail: history's total and each library's count.
- [ ] The workspace context loads and caches those listings once per shop and hands them to both
  the rail and the index that renders them, so a count and a table cannot disagree; an index that
  changes what it lists refreshes the same cache.
- [ ] If the four shop listings prove too heavy to hold at the shell, one additive read
  (`GET /shops/{id}/counts`) replaces them — shipped with its contract and a test that its
  figures equal the listings'. Decide by measuring, and say which way in the branch.

Frames: `Workspace.dc.html` :4753, :4822; the README's *Navigation rail*.

Branch: `feat/rail-counts`. Checks: `AppShell.test.tsx` for a count per entry, its absence in
flight, and the accessible name still the label alone; one index test per listing that the rail
and the table agree; a contract test if the read is added.

Slice evidence: the rail says *Orders 12* and the orders table has twelve rows; creating an
order makes it thirteen without a reload.

### Group B — Screens the prototype recomposes

#### Slice 12 — Creating is a page, in the shop

- [ ] A `CreatePage` layout: the sticky header with its back arrow, breadcrumb ("Orders ·
  creating an order fixture"), the typed name as the title with "nothing created yet" beside it,
  Cancel, and a Create button that is dashed and disabled with the reason in `title` and inline
  until the form can submit; the body in the 790px column. The layout ships with its four
  consumers below and no others.
- [ ] New shop (`/shops/new`): Identity, Commerce, Channels, on the fields Slices 2 and 4 built.
- [ ] New order (`/shops/:id/orders/new`): Who and when, the address from the customer's book,
  lines, and the reference `nextReference` prefills.
- [ ] New customer (`/shops/:id/customers/new`), and *Attach existing* stays on the index as the
  prototype's secondary button.
- [ ] New identity (`/shops/:id/support-identities/new`) — drawn in shop scope and reached from
  both rails.
- [ ] Products: no page. "New product" appends a draft product and opens its editor, as the
  prototype does (:6931); the side card goes.
- [ ] Every one of the five indexes loses its side card, gains the primary "New …" button in the
  header, and lands in the editor of what was created. A create that fails keeps the operator on
  the page with the error under the button.
- [ ] Tickets keep their authoring inside the three-pane screen: the prototype draws no ticket
  creation, and the list panel's form is left as it is.

Frames: `Workspace.dc.html` :212, :1202, :1333, :1643; DEPRECADED frames 2c, 6b for the editors
landed in.

Branch: `feat/create-pages-shop`. Checks: `CreatePage` tests for the blocked state, the reason,
Cancel and the landing; `Shops`, `Orders`, `Customers`, `SupportIdentities` and `Products` page
tests moved from the card to the page; Playwright `shop-publication`, `order-fixture`,
`customer-publication` and `ticket-authoring` shorten by the step they used to take into the
editor and change with the form.

Slice evidence: an operator presses *New order*, is on a page called "New order" that names
Orders above it, watches the title become "NS-10483" as they type, cannot press Create while a
line is missing and can read why, and after pressing it is standing in that order's editor.

#### Slice 13 — Creating is a page, in the lab

- [ ] New configuration (`/lab/agent-configurations/new`): name and model required, the reason on
  the disabled control (README, *Interactions*).
- [ ] New judge (`/lab/judges/new`).
- [ ] New objective block and New mutation block (`/lab/objective-blocks/new`,
  `/lab/mutation-blocks/new`), on the `CreatePage` layout with the parameter form Slice 2 built.
- [ ] The four indexes lose their side card and gain the header button; each create lands in its
  editor.

Frames: `Workspace.dc.html` :3293, :3468, :3628 and the block screens; DEPRECADED frame 5.

Branch: `feat/create-pages-lab`. Checks: page tests per index; Playwright `agent-configuration`
and `block-library`.

Slice evidence: an operator creating a judge is told the rubric is missing beside the button
that will not press, and ends in the judge editor with the name they typed in its header.

#### Slice 14 — New scenario

- [ ] `/shops/:id/scenarios/new` on the `CreatePage` layout: Built on (name; ticket, whose value
  is the bare ref and whose composed label is the hint; customer and shop version derived and
  shown read-only), Hidden facts as a chip list, Objectives composed from the library with a
  binding each, Mutations with a trigger each.
- [ ] Create is refused until a name and at least one objective exist, with the reason on the
  control and inline; the ticket the scenario is built on is frozen at its current version and
  the hint says so.
- [ ] Creation writes the same draft the editor would save, and lands in the scenario editor.

Frames: `Workspace.dc.html` :2925; DEPRECADED frame 4 for the editor landed in.

Branch: `feat/new-scenario`. Checks: page tests for the refusal, the derived fields, the bare
option value, and the payload; Playwright `scenario-authoring`, which today creates from the
card.

Slice evidence: an operator names a scenario, picks T-204, reads "Maya Laurent" and "shop v3"
without typing either, composes one objective, and is standing in the editor of a draft that
already holds it.

#### Slice 15 — The shop overview

- [ ] `ShopHomePage` becomes *Overview*: the version timeline (published versions, then the
  draft with its change count and "no experiment can see it"), a two-step publish — "Review N
  changes & publish" opens the list of what becomes the next version with Publish and Keep
  editing, and a published state that links to New experiment — replacing the Publish and
  "What publishing would freeze" cards.
- [ ] "What this shop holds": four jump cards with the count and a link, replacing the three
  count cards.
- [ ] "Findings on the draft": `preview.issues` grouped by the entry that is wrong, each group
  with one Open that lands on the editor and, where the path names one, the entry in view
  (`form-decisions.md` 11.2). `IssueList` gains the path-to-route map and every gate code the
  domain raises is in its sweep test; the same list serves every editor's Publish gate card.
- [ ] "Run a comparison" in the narrow form decided above, and "Recent activity" from the
  experiments, scenarios and tickets listings the workspace already holds — three most recent,
  no store.
- [ ] The synthetic-shop note stays, as the page description.

Frames: `Workspace.dc.html` :722; DEPRECADED frame 1.

Branch: `feat/shop-overview`. Checks: `ShopHome` tests for the timeline, the two-step publish, the
grouped findings and the two states of the readiness card; `IssueList` sweep; Playwright
`shop-publication`, which publishes from this page; `tour-anchors` for the page's anchors.

Slice evidence: an operator with three changes presses *Review 3 changes & publish*, reads that
a variant and a description become v4, presses Publish, and is offered to point a scenario at
v4. One of the findings names Alpine Shell Jacket with two errors and its Open lands on that
product.

#### Slice 16 — Documents

- [ ] Policies, FAQ entries and support guidelines become one *Documents* table on Policies &
  FAQ: kind chips (Policies, Guidelines, FAQ, Required by a scenario — the last computed from the
  scenarios listing's context documents), the search field, and "New document" opening a
  document editor page (`/shops/:id/setup/documents/:kind/:docId`) with the kind as a select.
- [ ] `/setup/support` redirects to the documents table filtered to Guidelines; the rail entry
  goes (Slice 9 already draws the prototype's four).
- [ ] The three payload lists stay as they are: this is a presentation of `content.policies`,
  `content.faq` and `content.support_guidelines`, not a merge of them, so nothing in the shop's
  canonical document or its fingerprint moves.

Frames: `Workspace.dc.html` :1518, :3163.

Branch: `feat/documents-table`. Checks: page tests for the chips' counts against the three
lists, the required-by chip, and the editor's kind; `tours.test.ts` and `tour-anchors` for the
retired surface; Playwright `shop-publication` if it authors a policy.

Slice evidence: an operator searches "returns", finds the policy and the guideline that mention
it in one list, and opens the guideline in a page rather than a row.

#### Slice 17 — Tone of voice, the remainder

- [ ] A nameless guideline cannot be committed and cannot be made the default; the row says so.
- [ ] Delete is refused on the shop default with the reason, and the two-step confirm of Slice
  21 once it exists.
- [ ] Each row shows its slug and version line and "used by" — the configurations that name it as
  an override, read from the configurations listing.
- [ ] New-then-cancel removes the appended row (the prototype's own bug, encoded as a test).

Frames: `Workspace.dc.html` :1897.

Branch: `feat/tone-guidelines`. Checks: `App.test.tsx`'s tone cases for the four rules.

Slice evidence: an operator cannot leave a guideline called nothing, cannot delete the default
without first choosing another, and can read which configuration would notice.

#### Slice 18 — Settings, restructured

- [ ] `LabSettingsPage` becomes the prototype's: a centred 1024px column, "← Back to workspace"
  above the title returning to what was underneath, and three zones distinguished by surface.
- [ ] *Your preferences* on white, saved on change, with Reset to defaults: where the app opens
  (three options, feeding Slice 9's landing rule), last-visited shop with Forget, rail starts
  collapsed, timestamps relative or absolute (consumed by `formatTimestamp` everywhere). The
  other three rows are not drawn — see *Decisions the prototype forces*.
- [ ] *Runtime configuration · Read only* as a collapsed disclosure: grey `#f6f7f8` cards with a
  padlock, Run mode, Trace export (unclipped), What this build can run, each ending in a "To
  change it:" line naming the variable or the file. It keeps ADR 0044's character for what is
  still composition.
- [ ] *The fast path* in its own zone below (ADR 0047).
- [ ] The *Model provider* zone's place is drawn with a one-card placeholder that says the
  connection arrives with Slice 19 and that the environment key is what is in force — so the
  page's shape lands once.

Frames: `Workspace.dc.html` :3854.

Branch: `feat/settings-zones`. Checks: `LabSettings.test.tsx` for each preference's write and
read-back, the disclosure, the back link, and the three surfaces told apart by role and heading;
Playwright `workspace-shell` if it reads Settings.

Slice evidence: an operator sets timestamps to absolute and every listing quotes a date; chooses
to open on the lab and the next visit does; and can tell at a glance which cards they may edit.

#### Slice 19 — The model connection

The visible half of ADR 0052, in the order `docs/implementation-plan.md` set: contracts,
migration, API, then the settings zone.

- [ ] Contract and migration: `model_connections` keyed by provider id, the encrypted key under
  `AGENT_LAB_CREDENTIAL_KEY`, `key_configured` and `key_added_at` served and nothing else about
  the key, `base_url` validated and normalised at the door; `model_base_url` on runs and
  judgements.
- [ ] Composition moves to the request: the three factories take a resolved connection, run
  mode becomes a per-request answer, and an advance that would reach a different endpoint than
  the run pinned is refused with 422 naming both.
- [ ] `POST …/test` sends one throwaway completion and answers with latency and the model, or the
  refusal; nothing is stored.
- [ ] The *Model provider* zone: provider chips from `lib/modelConnections.ts` (OpenAI, Ollama,
  vLLM, OpenRouter, Together, Custom — presets for a base URL, not providers), Base URL, API key
  (typed to save, "configured on <date>" once saved, Replace; never a mask), Test connection
  with the 900ms-round-trip states and a stale result discarded on a provider change, Save
  connection and Discard shown only when dirty. No model field: ADR 0052 refuses one, and the
  "Default model" row the prototype draws is the departure recorded there.
- [ ] Run mode in the read-only zone states which of the saved connection and the environment is
  in force.

Frames: `Workspace.dc.html` :3997–:4100.

Branch: `feat/model-connection`, split into `contracts → api → web` branches if the review wants
them apart. Checks: contract tests for the resource and the refusals; migration test; runtime
tests for the pin and the refusal; `LabSettings.test.tsx` with MSW for the zone's states;
Playwright `experiment-start` if the offline qualification's copy moves.

Slice evidence: an operator points the lab at `http://localhost:11434/v1`, tests it, saves it,
and a run started afterwards records that endpoint; a run already recorded refuses to be
advanced against it.

#### Slice 20 — The provider the lab can reach

- [ ] The agent editor and the judge editor read the reachable provider ids from the connection
  resource and, beside the provider field, say that published configurations naming an
  unreachable one cannot be advanced here — as a note, never in `preview.issues`, and never in
  the pinned gate sentences of `lib/fieldRules.ts` (ADR 0053).
- [ ] Experiment setup says the same beside a disabled Start on the `PublishReasons` model.
- [ ] A test asserts the sentence is absent from the mirrored gate set.

Frames: `Workspace.dc.html` :392, :488, :2327.

Branch: `feat/reachable-provider`. Checks: `AgentConfigurations`, `JudgeConfigurations` and
`ExperimentSetup` tests with MSW for both states; `fieldRules.test.ts` for the absence.

Slice evidence: an operator authoring for a provider the lab is not pointed at can publish, and
is told on the same row that nothing here can run it yet.

### Group C — Behaviour the prototype specifies everywhere

#### Slice 21 — Removing is deliberate

- [ ] `ConfirmRemove`: the confirm takes the row's place and states the whole consequence
  (`form-decisions.md` 9.2), on every Remove that is not trivially re-added — addresses,
  background entries, hidden facts, guidance rows, escalation conditions, documents and the
  other setup entries, the ticket's trigger message, detaching a profile, a guideline.
- [ ] Removing a product option that variants still choose says how many and what happens to
  them; Delete and Duplicate on the product editor header and as a row action, Delete naming any
  order line that references one of the product's variants.
- [ ] Detaching a profile returns to Customers.
- [ ] *Confirm before anything is deleted* lands as the third preference row, with the sentence
  the prototype writes: a published version and a recorded run are never deletable whichever
  way it is set.

Frames: DEPRECADED frame 2c; `Workspace.dc.html` :1969 for the guideline's delete.

Branch: `feat/deliberate-removal`. Checks: page tests that a Remove needs two presses and the
first can be walked back, and that the preference removes the second press; product delete and
duplicate on the draft payload; Playwright `shop-publication` if it removes an entry.

Slice evidence: an operator deleting a product is told that order NS-10482 names one of its
variants before the second press, and can walk the first back.

#### Slice 22 — Refused with a reason

- [ ] A `blockedButtonClasses` variant — dashed, disabled, the reason in `title` — for every
  primary action that cannot proceed: create pages already use it; Publish, Start, Save
  connection and Compose adopt it.
- [ ] Validation messages sit under the control at 13px 600 `#9d3028`, in the control's
  accessible description, on the `Field` row.
- [ ] The rules the September plan listed and the gate still says first: fulfilment max transit
  at least min; stock zero while "in stock"; an active product with no priced variant, on the
  editor; `paid_at` and `shipped_at` prefilled from `placed_at`; scenario caps as "N of 12";
  the block parameter's default-when-optional beside its checkbox; the judge's rubric required
  with reserved terms highlighted; Start listing what is missing.

Frames: README, *The form pattern* and *Interactions*; DEPRECADED frames 2c, 4, 7.

Branch: `feat/refused-with-a-reason`. Checks: `lib/ui.test.ts` for the variant; page tests per
rule; Playwright `scenario-authoring` and `experiment-start` if they press a blocked control.

Slice evidence: an operator who types a minimum of 5 and a maximum of 3 transit days reads why
under the field; Start on the bench is dashed until it can work and says what it waits for.

#### Slice 23 — Defaults, and the experiment setup as a sequence

- [ ] One rule for versions: newest published, on arm configurations as elsewhere. One rule for
  single choices: a select with one candidate opens on it, and its hint says so in the
  prototype's words.
- [ ] Experiment setup in the prototype's order: Scenario with what it resolves against, Arm A,
  Arm B, name with a default derived from them, seed under the scenario with its meaning.
- [ ] Customers: locale defaults from the shop; "customer since" defaults to today.

Frames: `Workspace.dc.html` :2327; DEPRECADED frame 7.

Branch: `feat/sensible-defaults`. Checks: `ExperimentSetup` and `Customers` tests; Playwright
`experiment-start` with the default arm version.

Slice evidence: an operator with one published scenario and two published configurations finds
all three chosen at their newest version, a name proposed, and only Start left.

#### Slice 24 — Long-running actions report themselves

- [ ] `ActionStatus` under the bench composer and on advance, score, replay, fork and freeze: the
  arms as a queue, each row saying where it stands (`form-decisions.md` 10.2; the bench's "Arm A
  is waiting for the customer · Arm B has completed", :2396), with `aria-busy` on the affected
  card, no cancel stated as such, and a one-line description beside Replay and Fork.
- [ ] Home's publish gate shows "Checking the draft…" where `PublishReasons` renders nothing.

Frames: `Workspace.dc.html` :2396–:2560; DEPRECADED frames 8, 9.

Branch: `feat/action-status`. Checks: `Experiments.test.tsx` for the status while an arm runs
and after; Playwright `experiment-start` if it waits on a run.

Slice evidence: an operator sends a turn to two arms and watches which arm is running and when
both are done, without the page changing only a button label.

#### Slice 25 — Save stays in reach

- [ ] `PageHeader` sticks to the top of the scrolling main pane on every editor and create page,
  with the canvas background and the 1px rule the prototype draws (:207), so Save, Publish and
  Create are in view at the foot of a six-card editor; `PublishReasons` stays beside Publish.

Frames: `Workspace.dc.html` :207, :387, :483, :890, :1197, :1328, :1638, :1746.

Branch: `feat/sticky-actions`. Checks: `WorkspaceChrome.test.tsx` for the header's role and
order; Playwright `tour-anchors`, because the tour lights the page name.

Slice evidence: an operator at the bottom of the product editor's reviews card presses Save
without scrolling, and the tour's first step still finds the page name.

#### Slice 26 — Consistency sweep

- [ ] One name per thing: "Scenario" not "Recipe"; "Bench" for the list and "Live bench" for a
  run; "Results" across History, the layout and its tabs; "Freeze" for snapshots; "Never
  published" on every index; "Overview" for the shop's first page.
- [ ] History: *Clear filters*, and the *Search* button at the end of the form (:2673).
- [ ] Results: the arm summary cards with their four figures and the Replay and Fork buttons in
  the header (:2566), each version linked to its editor with the version chip.
- [ ] Tickets: the header spans the list and the customer panel, "N in this shop" under the
  title; the filter select stays, as UI-4 decided.
- [ ] A non-interactive `chipClasses` for the tool-call, attempt and fault chips on the bench and
  the timeline, which wear button classes today.
- [ ] Ticket origin products and suggested documents show titles: the context payload carries
  them — the one additive contract change in this slice, shipped with its backend.

Frames: `Workspace.dc.html` :2174, :2566, :2673; DEPRECADED frames 3, 9, 10.

Branch: `feat/naming-and-chips`, the ticket contract change on its own branch. Checks: page
tests per item; a contract test for the ticket context payload; Playwright `ticket-authoring`
and `experiment-start` where copy they assert on changes.

Slice evidence: the same word means the same thing on every surface, and a reviewer reading a
finished experiment clicks the configuration version in an arm's summary and lands on the draft
that produced it.

#### Slice 27 — Debts the pattern slices reported

The three defects `docs/decisions-and-next-step.md` lists, each behaviour a layout or copy slice
was right to leave and a plan is wrong to leave longer.

- [ ] The product editor's category offers the draft's categories, as the create form does, and
  `PRODUCT_CATEGORY_RULE` lands on the row (the test that pins the row bare is inverted).
- [ ] Shop details refuses a slug another shop already has, reading the listing the create form
  reads; the row's hint then says so.
- [ ] The three narrow widths: decide whether they are wanted — the prototype draws the quantity
  and the total narrow (:2705) and the tag box in a chip strip (:2650) — and either lift `w-full`
  off the shared surface with every consumer saying so, or remove the three overrides.
- [ ] The six chips UI-4 could not compute stay uncomputed unless a listing gains the figure for
  its own reason; this slice does not add payloads for them.

Frames: DEPRECADED frame 2c; `Workspace.dc.html` :2705, :2650.

Branch: `feat/pattern-debts`. Checks: `App.test.tsx` for the datalist and the slug refusal;
`lib/ui.test.ts` for whichever width rule is chosen.

Slice evidence: an operator correcting a category is offered the spellings the draft already
uses, and cannot save Northstar's slug onto Alpenglow.

#### Slice 28 — The shop logo (optional)

- [ ] Icon from the twenty-eight marks, background and mark colour on the shop payload, a
  contrast check in the editor, drawn on the switcher's badge and the shops index. A
  canonical-document change (ADR 0013's payload schema), so it carries its migration behaviour
  and its fingerprint consequence, and it is dropped if the badge reads well on initials.

Frames: `Workspace.dc.html` :153, :212, :4933.

Branch: `feat/shop-logo`. Checks: contract and schema tests; `Shops.test.tsx`.

### Acceptance criteria

- The lab is reached by a tab, not by a rail section inside a shop, and every lab route is
  outside shop scope while every experiment route still names its shop.
- Every create in the workspace is a page that lands in the editor of what it created, and no
  index carries a side-card form.
- The shop's first page shows its versions as a timeline, publishes in two steps, and links every
  finding to the entry that resolves it.
- Settings has three zones an operator can tell apart by surface, and a lab-wide connection that
  a run pins and a recorded run refuses to be moved off.
- No primary action is silently disabled; every refusal states its reason on the control and
  beside it.
- Every Remove asks once, and the first press can be walked back.
- Nothing about progress is stored, and the only readiness the workspace reports is what a
  listing says.
- The eleven Playwright journeys pass on the new routes without any of them having been bent to
  the app.

## Deliberately not here

- **The Setup checklist**, and any per-step reading of what the shop still lacks. ADR 0044 and
  ADR 0045 stand; the overview's readiness card reads one listing and says one sentence.
- **Auto-offered tours and table density.** Neither preference decides anything a surface reads;
  ADR 0049 refused the first outright.
- **A model on the connection, a masked key, a per-configuration endpoint.** Refused in ADR 0052
  and ADR 0053 with the reasons; the prototype's rows for them are departures already recorded.
- **Merging the three document lists in the payload.** Slice 16 is a table over three lists, not
  a new canonical shape.
- **Ticket creation as a page.** The prototype draws none.
- **The next-step sentence from `SETUP_CHAIN`**, `GuideProse` card footers, the matrix's per-cell
  evidence sentence and a copy control on `Fingerprint` — the parts of the old Slices 13 and 16
  the prototype does not draw.
- **A component library or a new UI dependency.** The `CreatePage` layout, `ConfirmRemove`,
  `ActionStatus` and the switcher panel are small components on the existing chrome.
- **Read-only version pages for configurations and scenarios.** Slice 26 links to the editor
  with the version chip; a frozen view per definition is worth its own slice in `docs/PLAN.md`
  if a review journey needs it.
