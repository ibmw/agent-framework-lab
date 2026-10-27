# UX plan

Status: Milestone 14 open — 2026-10-27. Open slices only: a slice that lands is removed from this
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
are numbered, because each reads the page the one before it left: until Slice 61 the General tab
holds the sheet's sections and the cards not yet converted, in one column and in the sheet's
order.

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
- **Fork stays the panel under the header** (`ExperimentResultsLayout.tsx:443–609`), not the
  sheet mockup's dialog, and offers no one-arm fork.
- **The tabs stay links** in `nav[aria-label="Results views"]`, not a `tablist`.
- **Accessible names stay** where a spec or the tour reaches them — "Arm A summary", "Back to the
  live bench", "Add a tag", "Remove tag {tag}", "Add a note", "Fork this experiment", "Span",
  "Span waterfall", "Traced attempts", "Every field of {order} each arm changed" — where the
  sheet mockup draws others. A card that becomes a section takes the section's name.

No slice touches the backend or a contract. The covered journeys are `experiment-start.spec.ts`
(the results from :649 to :786, from History's *Open results* at :865 to :956, and the
deciding-call journey at :964–1053), `tour-anchors.spec.ts` (the results tour,
`lib/tours.ts:316–374`) and `sticky-header.spec.ts` (:686–691).

### Slice 59 — The sheet's frame: what the arms are and what they spent

The sheet primitive ships with its first sections, Outcome, Configuration and Usage — the cards
the arms' facts were split across — and the decision, ADR 0080.

- [ ] An arm-column sheet (`components/ArmSheet.tsx`, its class sets in `lib/ui.ts`): a section
  card with its Georgia title, a one-sentence note and the id a chip jumps to; rows of a 240px
  label column and one `minmax(0,1fr)` column per arm, with the spacing above; a row that spans
  the arms; a differing row, tinted (a token in `styles.css`) and marked *Differs* in words; and
  the disclosure "N {things} are the same for both arms", closed, one spanning row per shared
  value, drawn whole. The rows are `table`, `row`, `rowheader` and `cell` to assistive
  technology, each arm's column header named by the arm, so a cell is heard with its arm.
- [ ] The tabs (`ExperimentResultsLayout.tsx:418–423`) move above the arms, and the arm cards
  (:406–416, `ArmSummary` :750–827) become one summary row on the sheet's columns: the arm's
  name, the configuration chip opening its editor (ADR 0068, its `title` unchanged), the model
  and framework (:791–793), "N of M decided objectives met" in Georgia in one ink, the missed
  requirement (:806–810), and the standing (:814). Each arm's cell keeps the region name "{label}
  summary", and the row `data-tour="results-arms"` (`lib/tours.ts:326`). Its label cell reads
  "Compared arms" over "Columns are never added into a winner." (sheet mockup :92–95). The
  figures (:815–824) leave it for Usage.
- [ ] The pinned strip on General: sticky at the pane's top on the canvas under a 1px rule, one
  line naming each arm over its column, `aria-hidden` because every cell's column header already
  names its arm. It sets the pane's `scroll-padding-top` as `clearStickyHeader` does
  (`lib/stickyHeader.ts:121–153`), so a focused control, a chip's jump and a tour step land clear
  of it.
- [ ] A `nav` named "Sections" under the summary row on General, a chip per section in the
  sheet's order; a card not yet converted carries its section's id.
- [ ] General is one column (`ExperimentResultsPage.tsx:125` loses its rail grid), in the
  sheet's order; Slices 60 and 61 convert the cards they name in place.
- [ ] **Outcome** first: "Decided objectives met" and "Status" per arm, then two spanning rows —
  *Input divergence* (the card at :265–276 and `Divergence` at :666–705: the controlled sentence
  with its ✓, or a row per divergent turn with what each arm heard in its cell) and *Attribution*
  (`AttributionLine`, `components/ArmComparison.tsx:25–38`). Its note is the first sentence of
  today's (:114–117), "There is no aggregate score: each arm's count is of the rows something
  actually decided for it.", which the journey reads; "the columns are never added into a winner"
  is the summary row's label cell already. The divergence card's footer (:268–272) becomes its
  row's second line.
- [ ] **Configuration** replaces *What the arms differed on* (:224–226, `ComparisonTable`
  `components/ArmComparison.tsx:69–145`): the dimensions that differ first, each value whole; the
  others behind "N variables are the same for both arms". The bench's `DifferenceList` and
  `comparisonRows` (`lib/comparison.ts:118`) are unchanged.
- [ ] **Usage** replaces *Quantitative* (:253–263, :575–657): the thirteen measures and the arm
  card's "Tokens, in and out" (`armFigures`, `lib/evidence.ts:240`), the differing ones first and
  larger, the rest behind "N measures are the same for both arms"; "not reported", "not priced"
  and "≥" as today, and a retry above zero in the error ink (ADR 0068). The card's footer
  (:255–260) becomes the section's note.
- [ ] The one-arm run and the phone width as decided above; Usage at 390 passes nothing past the
  viewport, which settles ADR 0079's unmeasured *Quantitative* table.
- [ ] ADR 0080 records the composition the operator approved — every section and the four tabs —
  and the plan's decisions with their reasons, citing
  `application/experiment_derivations.py:181–188`, ADR 0079's column opened in place,
  `ExperimentTimelinePage.tsx:304`, ADR 0054 and `docs/design-direction.md`'s *Authority* rule 5.
  It amends `docs/design-direction.md`'s *Desktop first, usable narrower* (:32–36) for the
  stacked results, restates *Three evidence layers, kept distinct* (:18–19) as labelled groups
  and sections rather than cards, and amends ADR 0068 (the figures leave the arm card), ADR 0079
  (the results stack at a phone's width) and ADR 0036 (tags in the header, notes a section).

Frames: sheet mockup :84–121 (tabs, summary row, chips, strip), :131–191 with :414–428 and
:448–458 (Outcome, Configuration, Usage); `Workspace.dc.html:2576–2594` and :2626–2631, the
arm cards and the differences card it replaces.

Authority: ADR 0025, ADR 0033, ADR 0042, ADR 0068, ADR 0079.

Departures to record: `docs/design-direction.md`'s rows *An arm's names on its results card*
(the position's letter drawn again, `aria-hidden`, one ink), *What the arms differed on, on the
results* (a section, *Differs* for the Assessment column, the shared values whole behind the
disclosure) and *The results' rail* (no rail; Input divergence in Outcome, Quantitative as
Usage); the sheet mockup's tabs as links, and no strip for one arm or at a phone's width.

Branch: `feat/results-sheet-frame`. Checks: Vitest — a new `ArmSheet.test.tsx` (the columns and
their headers, a spanning row, a differing row's word, the disclosure's count and contents, one
arm, the stacked rows at narrow width each naming its arm through `test/viewport.ts`);
`Experiments.test.tsx` (the summary row's regions and link, no figures in it and every figure in
Usage, divergence controlled and divergent, attribution for one, two and no differences and for
one arm, Configuration's order, Usage's count, the chips' targets, the strip's names);
`tours.test.ts`; `ui.test.ts`. `make check`, `pnpm build`; `pnpm test:e2e` for
`experiment-start.spec.ts` (:651–657 the figures, :681–691 the phone width, :735–739 the
divergence), `tour-anchors.spec.ts` (`results-arms` moves) and `sticky-header.spec.ts` (:686–691:
the header still scrolls away; the strip is not the header).

Slice evidence: the seeded run's General tab at 1440 and 390, scrolled with the strip pinned, and a
one-arm run at 1440.

### Slice 60 — The evidence on the sheet: objectives and business state

- [ ] **Objectives** replaces *Deterministic evidence* and *LLM judge evidence*
  (`ExperimentResultsPage.tsx:127–149`, :162–220): one section, two labelled groups, "Decided by
  a rule" and "Scored by a judge", each with its empty sentence (:136–139, :171–174). A row per
  objective names its statement, its slug, its severity as a tag, and "must never happen" when
  forbidden (`components/ObjectiveEvidence.tsx:187–192`). Each arm's cell: the outcome as a pill,
  glyph and word (`OUTCOMES`, `lib/evidence.ts:27`); the evidence line; and, where one call
  decided it, "Open the deciding event" into the timeline (`ObjectiveEvidence.tsx:261–272`),
  named with its objective and its arm.
- [ ] A judged cell: the pill, the rationale's first sentence, the control judge's sentence
  (`ObjectiveEvidence.tsx:285–289`), and one *Verdict details* disclosure holding the whole
  rationale, the judge by its published name with its version and model (`judgementProvenance`),
  the attempt and the brief's fingerprint. The `Verdicts` list
  (`ExperimentResultsPage.tsx:518–552`) folds into it, a failed execution saying why
  (`describeVerdict`, :561–566).
- [ ] The judge picker, *Score again* and the scoring queue (:189–217) at the section's foot;
  `aria-busy` on the judged group only (ADR 0065).
- [ ] `EvidenceMatrix` and its scroller (`components/ObjectiveEvidence.tsx:147–210`) go; the
  bench's compact matrix (:78–124) is unchanged.
- [ ] **Business state** replaces its card (`ExperimentResultsPage.tsx:151–160`;
  `BusinessStateComparison`, `components/StateDiff.tsx:21–106`): a row per fact, each arm's value
  in its column, one fact per line — each scenario fault and agent write over its revision move,
  each order moved ("Order NS-10482": "3 groups changed", then a group per line), *Changed
  outside every order* with its glyph (:79–99), and "Fingerprint now" over where it started and
  "No other state changed". The comparison sentence (:135–170) is a spanning row, and "Every
  changed field of {order} ({n})" stays the disclosure (:176–252), its table on the sheet's rows
  so that it stacks at a phone's width rather than scrolling, and a column per arm inside it
  where the arms changed different paths (`ArmColumns`, :363). The disclosure keeps its name,
  "Every changed field of {order} ({n})", and the table its name, "Every field of {order} each
  arm changed" (:215).
- [ ] Each of that table's rows keeps its accessible name in today's order — field, starting
  value, each arm's value, assessment — which the journey reaches as
  `/^shipping_address\.city Bordeaux Lyon Lyon /` (`experiment-start.spec.ts:714–721`): the
  starting value is the row header's second line with no word before it ("Was" goes in the
  column headers or is `aria-hidden`), and every row ends in a cell holding its assessment word —
  *Difference*, *Same* or *Not compared* — one column more than the sheet primitive draws, which
  the table adds. The order is the desktop one: at a phone's width each stacked cell's arm line
  enters the name, and the journey reads these rows at the restored width.
- [ ] Each card's footer becomes its section's note or its group's: the deterministic card's
  (`ExperimentResultsPage.tsx:129–134`) and the judge card's (:164–169) under their groups, the
  business state's (:153–157) under its section.
- [ ] The tour's two evidence steps (`lib/tours.ts:341`, :349) anchor on the sections.

Frames: sheet mockup :139–180 with :429–447; `Workspace.dc.html:2610–2622` and `RESULT_ROWS`
(:5003).

Authority: ADR 0030, ADR 0031, ADR 0035, ADR 0040, ADR 0080.

Departures to record: `docs/design-direction.md`'s rows *A judged cell on the results*, *An
objective's secondary text on the results* (the kind is now the group the row sits in) and *The
state diff on the results*; ADR 0079's *The results' matrices keep their reading widths* and
its *Verification* line on the deciding-call journey, superseded in ADR 0080 by the stacked
rows; the sheet mockup's "Fulfilment" written "Fulfillment" (Milestone 13), and its judge named
by the published name rather than "v1 · deterministic".

Branch: `feat/results-sheet-evidence`. Checks: Vitest — `Experiments.test.tsx` (the two groups
and their empty sentences, each cell's pill, line and link with its name and target, a judged
cell's disclosure and a failed execution, the scoring queue, the state rows one fact per line,
every path behind the disclosure, no `alert` on load, the bench's matrix unchanged);
`tours.test.ts`. `make check`, `pnpm build`; `pnpm test:e2e` for `experiment-start.spec.ts`
(:660–679, :694–722, :890–896, and the deciding-call journey at :964–1053, rewritten because
the scroller it follows the link inside is gone) and `tour-anchors.spec.ts`.

Slice evidence: the seeded run's Objectives and Business state at 1440 and 390, turn 2's refused
proposal readable from its cell.

### Slice 61 — The record on the sheet: provenance, notes, and tags in the header

- [ ] **Provenance** replaces the rail's card (`ExperimentResultsPage.tsx:232–244`): spanning
  rows — *Derived from* when `derived_from` is set (the source's link, and what it changed on a
  line of its own; `components/RunProvenance.tsx:77–92`, :157–169), *Starting state* and
  *Inputs* each with a copy button named for its fingerprint that says it copied in a polite
  status, *Participant*, *Scenario and fixtures* (the scenario and every other pin that is not a
  block, each a link, ADR 0068), *Blocks* (each by its published name, `usePinnedBlockNames`,
  with its kind) — then *Each arm's versions* in the arm columns. It carries
  `data-tour="results-provenance"` (`lib/tours.ts:357`). The bench's `RunProvenance` card is
  unchanged, and both read one helper for the pin groups.
- [ ] **Notes**, the last section, id `notes`: the composer first ("Add a note", *Add note*,
  ADR 0078's touch), then each note's body over its time (`ExperimentResultsPage.tsx:467–506`).
  The *Notes & tags* card (:301–509) goes, its footer (:389–393) the section's note, as
  Provenance's footer (:235–240) is Provenance's.
- [ ] The header: the way back above the title, still "Back to the live bench"; the run's facts
  (`ExperimentResultsLayout.tsx:345–356`) as a list named "About this run" — the standing with
  its glyph, the scenario's version as a link, the seed, when it started (`formatTimestamp`);
  then *Filed under*, each tag with its remove ("Remove tag {tag}") and *+ Tag*, which opens the
  tag form in place ("Add a tag", *Add tag*, its refusal as today,
  `ExperimentResultsPage.tsx:428–464`) and folds it on *Cancel* or Escape, focus returned to
  *+ Tag*; a failed tag write is said in the header.
- [ ] *Notes · N* among the header's actions, before Replay, a link to `#notes` on General from
  every tab, named with its count.
- [ ] The line on Replay and Fork (`ExperimentResultsLayout.tsx:361–364`), the reach line
  (:366–370), the derivation queue (:372–387) and the Fork panel (:395–404) are unchanged,
  under the header. The inventory's H4 for C — one line, the long-action note only while one
  runs — is what they already draw: the line is one, and `ActionStatus` draws its note only
  while the derivation runs (`components/ActionStatus.tsx:83`).
- [ ] The tour's last two steps (`lib/tours.ts:357–372`) anchor on Provenance and Notes, and say
  that tags are in the header.

Frames: sheet mockup :41–81 and :195–239; `Workspace.dc.html:2561–2575` and :2639–2653.

Authority: ADR 0034, ADR 0036, ADR 0038, ADR 0039, ADR 0063, ADR 0065, ADR 0068, ADR 0078,
ADR 0080.

Departures to record: `docs/design-direction.md`'s row *The results' rail* (closed: provenance
and notes are sections, tags in the header); the sheet mockup's Fork dialog, "Remove the tag",
"New tag" and "New note", each kept as the codebase has it (rule 5, and the decisions above).

Branch: `feat/results-sheet-record`. Checks: Vitest — `Experiments.test.tsx` (Provenance's rows,
a derived run's source and change, a copy writing the fingerprint and saying so, the composer
before the notes, the tags in the header with *+ Tag*, *Cancel* and Escape, a removal leaving a
half-typed tag alone, a refusal muted then red, the *Notes · N* count and target from another
tab); `WorkspaceChrome.test.tsx` if `PageHeader` gains a slot; `tours.test.ts`. `make check`,
`pnpm build`; `pnpm test:e2e` for `experiment-start.spec.ts` (:725–732, :923–925),
`tour-anchors.spec.ts` and `sticky-header.spec.ts` (:686–691: the taller header still scrolls
away).

Slice evidence: the seeded run's header, Provenance and Notes at 1440 and 390, and a forked run's
*Derived from* row.

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
  journey opens it before it reads the list's items (`experiment-start.spec.ts:762–770`). The
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
`experiment-start.spec.ts` (:742–786, the executed code opened before it is read),
`sticky-header.spec.ts` (:688–691) and `tour-anchors.spec.ts`.

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
