# UX plan

Status: Milestone 12 open — 2026-10-22. Open slices only: a slice that lands is removed from this
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
`docs/history/PLAN-UX-2026-10-02.md`. Milestone 12 is open; its slices land in the order they
are numbered, because each reads the page the one before it left.

## Milestone 12 — The results say why

### Goal

An operator who has just finished an experiment opens its results and can answer, from the screen
alone: did each arm succeed, why or why not, what differed between the arms, where the evidence
is, and what to do next. Today every cell is a bare ✓ whose reason only a screen reader hears, the
arms' one difference is a chip, the state diff is seventeen near-identical lines per arm, the
conversation is on another page, and the seeded run's turn 2 — a refused proposal and a reply that
ignored the customer's question, marked *met* — cannot be seen from the verdict. The operator
asked for this milestone on 16 October 2026 and took its decisions on 22 October 2026, after an
assessment of the seeded run in Chrome at 1440, and headless at 1280 and 390:

- **The per-cell evidence line is drawn** on the results matrices, not on the bench's compact one.
- **The judge's rationale is on screen**, one line, the whole of it behind a disclosure.
- **The conversation is a read-only tab** of the results, the fourth beside General, Execution
  timeline and Traces; the prototype's *Code paths* tab is not built.
- **The rail collapses at phone width**, in this milestone, as a shell slice.
- **A refusal on a form nobody has touched is muted** until the operator touches it — an
  amendment of ADR 0063.

Every slice is frontend-only: the results layout already reads `experiment.turns`,
`experiment.agent_turns`, `experiment.comparison`, `derived_from`, `resolution_fingerprint` and
each judgement's `provider`, and no contract moves. The covered journeys are
`experiment-start.spec.ts` (the results at :640 and History's *Open results* at :818),
`tour-anchors.spec.ts`, `sticky-header.spec.ts` (:684) and `workspace-shell.spec.ts`.

### Slice 52 — A refusal on an untouched form is a hint

- [ ] ADR 0078 amends ADR 0063: a refused submit's reason is drawn muted while its form is
  untouched, and in `validationMessageClasses` (`lib/ui.ts:554`) once the operator has edited
  the form or pressed the action. The button, its `aria-disabled`, its `title` and its
  description do not change.
- [ ] Every `RefusalLine` adopts it in this slice — Fork, tags, notes, the thread and every other
  consumer — so the rule has no exception.

Frames: `tmp/design-frames/README.md`, *The form pattern*.

Authority: ADR 0063.

Departures to record: the README's validation colour is kept for a refusal the operator has
caused, and an untouched form's reason is muted.

Branch: `feat/refusal-muted-until-touched`. Checks: Vitest — each adopter's test for muted then
red, and the submit-without-press tests ADR 0063 lists unchanged. `make check`, `pnpm build`;
`pnpm test:e2e` for `experiment-start.spec.ts`.

Slice evidence: the results page's Fork, tag and note forms at 1440, untouched then touched.

### Slice 53 — The rail collapses at phone width

- [ ] Below the narrow breakpoint the rail draws its 52px collapsed strip without writing the
  remembered preference (`shell/AppShell.tsx:451`), and the top bar and a page header's actions
  wrap rather than clip.
- [ ] The results' matrix arm heads are not squeezed at 390 (`ObjectiveEvidence.tsx:56`).
- [ ] ADR 0079 records the breakpoint and that the width, not the operator, collapsed it.

Frames: the prototype draws no phone width; `docs/design-direction.md`, *Desktop first, usable
narrower*.

Authority: ADR 0054, ADR 0055.

Departures to record: none; the narrow treatment is the lab's.

Branch: `feat/shell-narrow-rail`. Checks: Vitest — `App.test.tsx` for the collapsed strip at a
narrow width and the preference left as it was. `make check`, `pnpm build`; `pnpm test:e2e` for
`workspace-shell.spec.ts` and `sticky-header.spec.ts`.

Slice evidence: the results and the bench at 390, no text past the viewport.

### Acceptance criteria

- Every mark on the results matrices shows why in words; a judged mark shows the judge's reason
  and who the judge was, and the offline control judge says what it does not check.
- Each arm's card counts its turns from one and says when it missed a required objective.
- What the arms differed on is a card that says whether the behaviour is attributable.
- The state diff opens with a summary, reads arm beside arm, and keeps every path in a
  disclosure.
- The conversation is readable on the results without leaving them, and nothing on it writes.
- The selected tab, lens and attempt are visible; the timeline reads in two lanes, and an
  evidence line lands on its event.
- Provenance and notes are in the rail; no text clips at 1280 or 1440, and none passes the
  viewport at 390.
- An untouched form's refusal is muted, and ADR 0078 and ADR 0079 record the two decisions.

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
  `Fingerprint` — the parts of the old Slices 13 and 16 the prototype does not draw.
- **The prototype's *Code paths* tab.** The executed-code rail stays beside the timeline, and the
  fourth tab is the conversation.
- **Listing the runs derived from this one.** `derived_from` names a run's source, and nothing
  names its children; a listing narrowed by source is a backend slice in `docs/PLAN.md`.
- **What the offline control judge decides.** Its rubric marks *Tell the customer what changed*
  met when an arm answered every turn, which the seeded run's turn 2 shows is not a reading of the
  reply; the results say so beside the mark, and changing the judge is `docs/PLAN.md`'s.
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
