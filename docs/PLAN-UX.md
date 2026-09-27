# UX plan — the workspace becomes the prototype

Status: proposed — 2026-09-20. Open slices only: a slice that lands is removed from this file.
Supersedes the 13 September plan, whose delivered Slices 1–8 and reread Slices 9–16 are in
`docs/history/PLAN-UX-2026-09-13.md`.

## Purpose and authority

`docs/PLAN.md` records what the lab holds; this plan records how the operator's workspace reaches
the design it was handed on 19 September 2026: the whole-workspace prototype in
`tmp/design-frames/Workspace.html`, its handoff `README.md`, and `form-decisions.md`. Read, in
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
- **The Setup checklist is not built**, and the overview's readiness card reads one listing —
  `docs/design-direction.md`, *Navigation and chrome*. Built with the overview.
- **A rail entry's count comes from the listing its index renders**, held by the workspace —
  ADR 0056, which also measured and refused the additive counts read. Landed.
- **Three of the five proposed preferences earn a consumer**, and the logo is the optional last
  slice — `docs/design-direction.md`, *Proposals, not decisions*. Two landed with the settings
  zones, and how a timestamp is written and what a reset puts back are ADR 0058;
  confirm-before-delete landed with the confirm it governs (ADR 0060).

The assessment that produced this plan — the prototype read screen by screen against the
application, and the verdict on each slice of the 13 September plan — is
`docs/history/PLAN-UX-2026-09-13.md`.

## Sequencing

Group B is delivered: every screen it recomposes is built, the connection it runs through is
saved from the settings page, and the editors and experiment setup say which providers that
connection leaves unreachable (ADR 0053). Group C's remaining slice, 28, is optional.

## Milestone 8 — The workspace becomes the prototype

### Goal

An operator who opens the app sees the prototype: a shop fixture and an experiment lab as two
modes with their own rails, a top bar that switches shops and offers the tour, creation as a page
that lands in the editor, an overview built around the version timeline and the publish review, a
settings page whose three zones say what may be touched, and a lab-wide model connection that a
run pins. Everything the September plans delivered — hints, derived identifiers, labels, chips,
edit-in-place, the guard, pine, the field row — is still there underneath.

### Group C — Behaviour the prototype specifies everywhere

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
- **Merging the three document lists in the payload.** The Documents table is a presentation of
  three lists and not a new canonical shape; `lib/documents.ts` writes every row back into the
  collection it came from, and a document is named by its kind and its slug (ADR 0057).
- **Ticket creation as a page.** The prototype draws none.
- **The next-step sentence from `SETUP_CHAIN`**, `GuideProse` card footers, the matrix's per-cell
  evidence sentence and a copy control on `Fingerprint` — the parts of the old Slices 13 and 16
  the prototype does not draw.
- **A component library or a new UI dependency.** The `CreatePage` layout, `ConfirmRemove` and
  `ActionStatus` are small components on the existing chrome, as the switcher's panel was.
- **Read-only version pages for configurations and scenarios.** The results link a pinned
  version to its definition's editor (ADR 0068); a frozen view per definition is worth its own
  slice in `docs/PLAN.md` if a review journey needs it.
