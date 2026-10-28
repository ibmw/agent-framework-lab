# UX plan

Status: Milestone 14 open — 2026-10-28. Open slices only: a slice that lands is removed from this
file. Supersedes the 13 September plan, whose delivered Slices 1–8 and reread Slices 9–16 are in
`docs/history/PLAN-UX-2026-09-13.md`; the 20 September plan, whose delivered Milestone 8's goal
and acceptance criteria are in `docs/history/PLAN-UX-2026-09-20.md`; the 28 September plan,
whose delivered Milestone 9's are in `docs/history/PLAN-UX-2026-09-28.md`; the 29 September
plan, whose delivered Milestone 10's are in `docs/history/PLAN-UX-2026-09-29.md`; the
2 October plan, whose delivered Milestone 11's decisions, goal and acceptance criteria are in
`docs/history/PLAN-UX-2026-10-02.md`; the 22 October plan, whose delivered Milestone 12's
goal, decisions and acceptance criteria are in `docs/history/PLAN-UX-2026-10-22.md`; and the
27 October plan, whose delivered Milestone 13's goal and decisions are in
`docs/history/PLAN-UX-2026-10-27.md`.

## Purpose and authority

`docs/PLAN.md` records what the lab holds; this plan records how the operator's workspace reaches
the design it was handed on 19 September 2026: the whole-workspace prototype in
`tmp/design-frames/Workspace.html`, its handoff `README.md`, and `form-decisions.md`. Read, in
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
  `components/WorkspaceChrome.tsx` and `shell/AppShell.tsx`. A drop zone and the operating
  system's file picker are the platform's own — `<input type="file">` and the drag events —
  and ADR 0076's `python-multipart` is the API's dependency, not the UI's.
- **No backend change unless the slice says so.** A slice that says so ships its contract, its
  persistence and migration, and its frontend consumer together, as `docs/PLAN.md`'s delivery
  rules require, and its *Checks* line names the backend tests, the migration test and the
  contract check beside Vitest and Playwright.
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

Milestones 8, 9, 10, 11, 12 and 13 are delivered. Their record is the commits and ADR
0052–0079; their goals and acceptance criteria are `docs/history/PLAN-UX-2026-09-20.md`,
`docs/history/PLAN-UX-2026-09-28.md`, `docs/history/PLAN-UX-2026-09-29.md`,
`docs/history/PLAN-UX-2026-10-02.md`, `docs/history/PLAN-UX-2026-10-22.md` and
`docs/history/PLAN-UX-2026-10-27.md`. Milestone 14 is open. Its slices land in the order they
are numbered, because each reads the page the one before it left: General is the whole sheet, and
the depth tabs keep their cards until Slice 62 converts them.

## Milestone 14 — The results are one sheet, arm beside arm

### Goal

An operator reads a finished experiment top to bottom in one scroll, each arm a column and every
fact a row, and each of the 27 pieces in `tmp/design-frames/results-inventory.dc.html` is still
on the page. The operator chose direction C, a comparison sheet with the arms as columns, and
approved its clickable mockup, `tmp/design-frames/results-sheet-mockup.dc.html` (the *sheet
mockup* below), on 27 October 2026. Its decisions:

- **One page scroll**, no nested scrolling region and no overlay. A slim strip pinned at the top
  of the pane names the arms over their columns on General, Conversation and Execution
  timeline; on Traces it is one line naming the chosen arm, attempt and span.
- **The header** holds the way back, the title, *Notes · N*, Replay and *Fork…*, then the run's
  facts as chips and a *Filed under* row of tags. Under it, the tabs, then one arm summary row —
  name, configuration and version, model, objectives met, standing — which scrolls with the page.
  The arm cards' figures move into *Usage*.
- **General is a sheet**: a 240px label column and a column per arm, sections in the order
  Outcome, Objectives, Business state, Configuration, Usage, Provenance, Notes, each reached from
  a chip. The rail, its *Record* and the *Notes & tags* card go: tags join the header, notes are
  the last section.
- **What differs leads, and is never a verdict.** Configuration and Usage draw the rows the arms
  differ on first, tinted, and fold the rest under "N … are the same for both arms". The tint
  says the values differ and nothing more: no ratio, no winner.
- **Spacious**: one fact per line, never "a · b · c"; rows about 18px tall in padding, line
  height 1.5, prose at most about 75ch, long material behind a disclosure.
- **The depth tabs keep their content under the strip**: the conversation draws each message once
  and each arm's calls and reply in its column; the timeline a spanning row per turn over the
  arms' lanes, its executed code folded at the foot; Traces an attempt list, the span waterfall
  as the inventory keeps it (T4), and the span's detail. The *Arms* side card goes.

The plan's decisions, where the operator's left a point open:

- **A one-arm run is one column**: no strip, no *Differs*, no "same for both arms"; every row of
  Configuration and Usage drawn; Outcome reads "One arm ran, so there is nothing to compare it
  against." and draws no Input divergence.
- **At a phone's width the rows stack** (below 48rem, ADR 0079): a row's label on a line, then
  each arm's cell under a line naming its arm. No strip there; Traces' one-line strip stays, cut
  with an ellipsis.
- **Fork stays the panel under the header** (`ExperimentResultsLayout.tsx:535–701`), not the
  sheet mockup's dialog, and offers no one-arm fork.
- **The tabs stay links** in `nav[aria-label="Results views"]`, not a `tablist`.
- **Accessible names stay** where a spec or the tour reaches them — "Arm A summary", "Back to the
  live bench", "Add a tag", "Remove tag {tag}", "Add a note", "Fork this experiment", "Span",
  "Span waterfall", "Traced attempts", "Every field of {order} each arm changed" — where the
  sheet mockup draws others. A card that becomes a section takes the section's name.

No slice touches the backend or a contract. The covered journeys are `experiment-start.spec.ts`
(the results from :650 to :849, from History's *Open results* at :928 to :1028, and the
deciding-call journey at :1036–1131), `tour-anchors.spec.ts` (the results tour,
`lib/tours.ts:316–376`) and `sticky-header.spec.ts` (:736–782).

### Slice 62 — The depth tabs under the strip

- [ ] The strip on Conversation and Execution timeline, over the tabs' own arm columns.
- [ ] **Conversation** (`ExperimentConversationPage.tsx:81–147`) on the sheet's columns: each
  composition once, spanning, as Trigger or Message N, with "this arm only" where it reached one
  arm; then *What each arm did*, each arm's attempts in its column — the calls with their glyph
  and word, a fault where it fired, then the reply — headed by that arm's own turn number
  (`ArmTurn` without its customer message, `components/ConversationThread.tsx:50–79`; the bench's
  `ArmThread` is unchanged). An arm that never received the message says so in its cell.
- [ ] **Execution timeline** (`ExperimentTimelinePage.tsx:252–337`) on the columns: per turn a
  spanning row with the customer's event, then each arm's lane in its column; the lanes' header
  row (:268–276) goes, the strip naming them; the lenses are unchanged (:173–212), and a
  followed event lands clear of the strip. *Executed project code* (:414–454) becomes a closed
  disclosure at the foot that stays the region "Executed project code" — a `section` carrying
  the name, with the `summary` and its count of functions inside — so
  `card(page, "Executed project code")` still resolves; the list inside it is as today, and the
  journey opens it before it reads the list's items (`experiment-start.spec.ts:825–831`). The
  *Arms* card (:147–166) goes.
- [ ] **Traces** (`ExperimentTracesPage.tsx:105–171`): the attempts as a list on the left,
  buttons with `aria-pressed` naming the arm, the turn and the attempt, in the group still named
  "Traced attempts" (:181–211, :193); the span waterfall as today, each bar at its offset and
  still the list "Span waterfall" (`Waterfall` :220–296, `bar` :336); the span's detail under it,
  still the region "Span" (:299–333). A one-line strip pinned at the top names the chosen arm,
  attempt and span. The *Arms* card (:150–169) goes.
- [ ] Each footer becomes its section's note: the conversation's
  (`ExperimentConversationPage.tsx:58–64`), the timeline's
  (`ExperimentTimelinePage.tsx:119–128`), the executed code's (:428–433) inside its disclosure,
  the traces' (`ExperimentTracesPage.tsx:109–116`) and the span's (:136–141).
- [ ] At a phone's width the conversation and the timeline stack as General does, and Traces'
  list sits above its spans.

Frames: sheet mockup :114–129 and :243–362, with :461–532.

Authority: ADR 0027, ADR 0037, ADR 0054, ADR 0080.

Departures to record: `docs/design-direction.md`'s rows *The execution timeline's clock*, *The arm
on a timeline card* (no lanes' header row; each card keeps its arm) and *The results' fourth tab*
(the message drawn once); the sheet mockup's bars drawn by duration alone, kept at their offset
as ADR 0037 draws them; its attempt `listbox` drawn as pressed buttons, with no arrow-key model
to build; and its single lens as today's lenses, which combine.

Branch: `feat/results-depth-tabs-sheet`. Checks: Vitest — `Experiments.test.tsx` (a message once
and each arm's calls and reply in its column, a message one arm never received, the timeline's
spanning row and lanes, the folded code and its count, a followed event landing, the traces'
list, the waterfall's bars at their offsets, the span region and the one-line strip, no *Arms*
card on either tab); `tours.test.ts`. `make check`, `pnpm build`; `pnpm test:e2e` for
`experiment-start.spec.ts` (:805–849, the executed code opened before it is read),
`sticky-header.spec.ts` (:736–782) and `tour-anchors.spec.ts`.

Slice evidence: the seeded run's three depth tabs at 1440 and 390, scrolled with the strip pinned.

### Acceptance criteria

- General reads in one scroll — Outcome, Objectives, Business state, Configuration, Usage,
  Provenance, Notes — each reached from a chip, and whether the comparison was controlled is in
  Outcome, above the evidence.
- Each of the 27 pieces in `tmp/design-frames/results-inventory.dc.html` is on the page.
- On General, Conversation and Execution timeline a pinned strip names the arms over their
  columns; on Traces it names the arm, attempt and span. Nothing scrolls inside the page, and
  nothing covers it.
- What differs is drawn first and said in words, and nothing between the arms reads as a verdict.
- A one-arm run reads as one column; at 390 every row stacks with its arm named, and nothing
  passes the viewport.
- Tags are in the header, notes are a section, the rail and the *Arms* cards are gone, and
  ADR 0080 records the composition and what it amends.

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
- **The next-step sentence from `SETUP_CHAIN`**, `GuideProse` card footers and a copy control on
  `Fingerprint` anywhere but the results' Provenance — the parts of the old Slices 13 and 16 the
  prototype does not draw.
- **The prototype's *Code paths* tab.** The executed code stays on the timeline, and the fourth
  tab is the conversation.
- **A Fork dialog, and a fork that drops an arm.** The fork panel stays under the results header;
  a fork names one arm per arm of its source (`application/experiment_derivations.py:181–188`),
  so the sheet mockup's "Leave Arm B empty" would be a backend slice of its own.
- **A switch between arms at a phone's width.** The results' rows stack with each arm named; a
  switch would show half a comparison at a time.
- **Listing the runs derived from this one.** `derived_from` names a run's source, and nothing
  names its children; a listing narrowed by source is a backend slice in `docs/PLAN.md`.
- **What the offline control judge decides.** Its rubric marks *Tell the customer what changed*
  met when an arm answered every turn. It is a declared control that scores engagement, not
  meaning (`infrastructure/judges/control.py`), and it stays one. The results say so beside the
  mark, and a published judge is the one that reads the reply.
- **Distinct accessible names for Traces' two *configuration v1* links.** Each sits inside its
  own arm's region.
- **Telling the operator when a lens hides the followed event.** The operator chose the lens.
- **A component library or a new UI dependency.** The `CreatePage` layout, `ConfirmRemove` and
  `ActionStatus` are small components on the existing chrome, as the switcher's panel was.
- **The product's variants, a scenario's composed blocks, the create pages' rows and a ticket's
  thread in the form below them.** Outside Milestone 10 as the operator scoped it; they keep
  `EntryCard` and `EntryEditButtons`, and the thread its composer (ADR 0073).
- **Read-only version pages for configurations and scenarios.** The results link a pinned
  version to its definition's editor (ADR 0068); a frozen view per definition is worth its own
  slice in `docs/PLAN.md` if a review journey needs it.
- **An uploaded shop logo.** ADR 0070 keeps the logo a drawn mark on a chosen ground; Milestone 11
  stores a product's images and nothing else.
- **Removing an image from the library, or a sweep of the ones no entry names.** A file goes with
  its shop and only then, and a published version's are kept for as long as it is.
- **Converting the written references a stored version holds, accepting them on write, or
  migrating the QA lab.** A version is immutable, so they still read; the lab is reset and
  reseeded instead (ADR 0076, `docs/development.md`).
- **SVG, GIF, resizing, cropping, generated thumbnails or pixel dimensions.** The browser scales
  the stored bytes; the file name is kept for display only.
- **Deleting a shop from anywhere but its row on the shops index.**
- **The image in what an agent, a tool result or a judge reads**, beyond the reference string
  `catalog.product` already returns.
- **Deleting a published shop, a version, a snapshot or a run.** ADR 0060 and ADR 0019 stand.
- ***Use an example shop* creating a catalog.** It fills the create form; the shop with a catalog
  and images is the seed's.
