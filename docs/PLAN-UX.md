# UX plan

Status: no milestone open — 2026-10-02. Open slices only: a slice that lands is removed from this
file. Supersedes the 13 September plan, whose delivered Slices 1–8 and reread Slices 9–16 are in
`docs/history/PLAN-UX-2026-09-13.md`; the 20 September plan, whose delivered Milestone 8's goal
and acceptance criteria are in `docs/history/PLAN-UX-2026-09-20.md`; the 28 September plan,
whose delivered Milestone 9's are in `docs/history/PLAN-UX-2026-09-28.md`; the 29 September
plan, whose delivered Milestone 10's are in `docs/history/PLAN-UX-2026-09-29.md`; and the
2 October plan, whose delivered Milestone 11's decisions, goal and acceptance criteria are in
`docs/history/PLAN-UX-2026-10-02.md`.

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

Milestones 8, 9, 10 and 11 are delivered. Their record is the commits and ADR 0052–0077; their
goals and acceptance criteria are `docs/history/PLAN-UX-2026-09-20.md`,
`docs/history/PLAN-UX-2026-09-28.md`, `docs/history/PLAN-UX-2026-09-29.md` and
`docs/history/PLAN-UX-2026-10-02.md`. No UX milestone is open: the next one is planned here,
under the rules above, when the operator asks for it.

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
