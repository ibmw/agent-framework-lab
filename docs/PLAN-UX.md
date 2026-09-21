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
names. ADR 0052 and ADR 0053 are already accepted and precede the slices that implement them;
ADR 0054 is the route scheme every slice below is written against.

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
- **No backend change unless the slice says so.** Two slices carry one: the model connection
  (ADR 0052) and the reachable-provider read it enables (ADR 0053). Each ships the OpenAPI
  update, the backend and the consumer together.
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
- **Two of the five proposed preferences earn a consumer**, and the logo is the optional last
  slice — `docs/design-direction.md`, *Proposals, not decisions*.

The assessment that produced this plan — the prototype read screen by screen against the
application, and the verdict on each slice of the 13 September plan — is
`docs/history/PLAN-UX-2026-09-13.md`.

## Sequencing

Group B has one slice left, 18, and nothing waits on it. Slice 19 is the backend milestone
and runs beside it; Slice 20 needs it. Group C's slices 21–25 depend on nothing in Group B.
Slices 26 and 27 close the milestone, and 28 is optional.

## Milestone 8 — The workspace becomes the prototype

### Goal

An operator who opens the app sees the prototype: a shop fixture and an experiment lab as two
modes with their own rails, a top bar that switches shops and offers the tour, creation as a page
that lands in the editor, an overview built around the version timeline and the publish review, a
settings page whose three zones say what may be touched, and a lab-wide model connection that a
run pins. Everything the September plans delivered — hints, derived identifiers, labels, chips,
edit-in-place, the guard, pine, the field row — is still there underneath.

### Group B — Screens the prototype recomposes

#### Slice 18 — Settings, restructured

- [ ] `LabSettingsPage` becomes the prototype's: a centred 1024px column, "← Back to workspace"
  above the title returning to what was underneath, and three zones distinguished by surface.
- [ ] *Your preferences* on white, saved on change, with Reset to defaults: where the app opens
  (three options, written into the preference `/` already reads, ADR 0054), last-visited
  shop with Forget, rail starts
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

The visible half of ADR 0052, in the order ADR 0052 sets: contracts, migration, API, then
the settings zone.

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

- [ ] `blockedButtonClasses` — the dashed, disabled weight with the reason in `title`, minted
  in Slice 12 and worn by the nine create pages and nothing else — on **every** primary action
  that cannot proceed. Publish, Start, Save connection and Compose are the named adopters; the sweep is
  for the rest, and *Attach to this shop* on Customers is one of them, `disabled` today with
  its reason nowhere.
- [ ] Decide whether the weight is `disabled` or `aria-disabled`. Natively disabled, it leaves
  the tab order and only the inline reason carries — which is the rule as
  `docs/design-direction.md` states it, and enough, but a keyboard reader never reaches the
  control to be told. The slice that puts the weight on every blocked primary is the slice to
  settle it on all of them at once rather than on four pages ahead of the rest.
- [ ] Validation messages sit under the control at 13px 600 `#9d3028`, in the control's
  accessible description, on the `Field` row.
- [ ] The rules the September plan listed and the gate still says first: fulfilment max transit
  at least min; stock zero while "in stock"; an active product with no priced variant, on the
  editor; `paid_at` and `shipped_at` prefilled from `placed_at`; scenario caps as "N of 12";
  the block parameter's default-when-optional beside its checkbox; the judge editor's rubric
  required with reserved terms highlighted — the create page already refuses without one; Start
  listing what is missing.

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

- [ ] `PageHeader` sticks to the top of the scrolling main pane on every editor, with the canvas
  background and the 1px rule the prototype draws (:207), so Save and Publish are in view at the
  foot of a six-card editor; `PublishReasons` stays beside Publish. The create pages' own header
  already sticks — `CreatePage` draws it — so this is the editors' half of that rule.

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

- [ ] The product editor's category offers the draft's categories, and `PRODUCT_CATEGORY_RULE`
  lands on the row (the test that pins the row bare is inverted, and the rule leaves
  `fieldRules.test.ts`'s one allowed orphan).
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
- **Merging the three document lists in the payload.** The Documents table is a presentation of
  three lists and not a new canonical shape; `lib/documents.ts` writes every row back into the
  collection it came from, and a document is named by its kind and its slug (ADR 0057).
- **Ticket creation as a page.** The prototype draws none.
- **The next-step sentence from `SETUP_CHAIN`**, `GuideProse` card footers, the matrix's per-cell
  evidence sentence and a copy control on `Fingerprint` — the parts of the old Slices 13 and 16
  the prototype does not draw.
- **A component library or a new UI dependency.** The `CreatePage` layout, `ConfirmRemove` and
  `ActionStatus` are small components on the existing chrome, as the switcher's panel was.
- **Read-only version pages for configurations and scenarios.** Slice 26 links to the editor
  with the version chip; a frozen view per definition is worth its own slice in `docs/PLAN.md`
  if a review journey needs it.
