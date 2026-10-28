# ADR 0080 — The results are one sheet, arm beside arm

Status: accepted — 2026-10-28

Amends ADR 0068, *An arm's card carries four figures, and two more when they say something*; ADR
0079, *The results' matrices keep their reading widths* and its last consequence, as to the
results at a phone's width; and ADR 0036, as to where the tags and the notes are drawn. Amends
`docs/design-direction.md`'s principles *Three evidence layers, kept distinct* and *Desktop first,
usable narrower*. Every other decision of the three ADRs stands: what a figure means and when it
is drawn, the narrow breakpoint and the rail, and how an annotation is stored, folded and
written.

## Context

`tmp/design-frames/results-inventory.dc.html` lists the twenty-seven pieces of information the
results page showed on 27 October 2026, read from the seeded run. The page split them across two
columns that answered different questions. The evidence was in the main column: the
deterministic rows, the business state, the judged rows, and what the arms differed on. A rail
beside it held the provenance, the notes and tags, *Quantitative* and *Input divergence*. The last
two were the facts that say whether the evidence can be compared at all. *Quantitative* sat third
in the rail, below the fold, and *Input divergence* sat fourth, at the end of the scroll. The arm
cards above the tabs drew five figures each, read against nothing beside them.

Three arrangements were drawn: A, a decision rail; B, sub-tabs; C, a comparison sheet with the
arms as columns. The operator chose C on 27 October 2026, iterated it into a clickable mockup
(`tmp/design-frames/results-sheet-mockup.dc.html`, board "C, the full experience", the *sheet
mockup* below) and approved it. During the iteration the operator asked for more free space (one
fact per line), for no double scroll (only a slim strip pinned, and on Traces one line), for
Usage and Configuration to share the "N … are the same for both arms" disclosure, and for the
record drawer to be dissolved: tags in the header, Provenance and Notes as sections. The
operator also confirmed that Traces keeps the offset waterfall (inventory T4), with each bar at
its span's start.

## Decision

### The composition, on every tab

- **The header** holds the way back, the title, *Notes · N*, Replay and *Fork…*. Under them are
  the run's facts as chips, in a list named "About this run", and a *Filed under* row of tags,
  each with its remove and *+ Tag*.
- **The tabs** come next: General, Conversation, Execution timeline, Traces.
- **The summary row** comes under the tabs and scrolls with the page. Its label cell reads
  "Compared arms" over "Columns are never added into a winner." Each arm has a column, a region
  named "{label} summary", that holds the arm's name with its position's letter, the
  configuration chip that opens its editor (ADR 0068), the model and framework, "N of M decided
  objectives met" with the count in Georgia, the missed requirement, and the standing. The row
  carries `data-tour="results-arms"`.
- **General is a sheet**: a `nav` named "Sections" with a chip per section, then the sections in
  this order: Outcome, Objectives, Business state, Configuration, Usage, Provenance, Notes. The
  rail, its *Record* and the *Notes & tags* card go. Notes is the last section, and the tags join
  the header.
- **A strip is pinned** at the top of the pane on General, Conversation and Execution timeline. It
  is one line naming each arm over its column. On Traces it is one line naming the chosen arm,
  attempt and span.
- **The depth tabs keep their content under the strip.** The conversation draws each message once,
  with each arm's calls and reply in its column. The timeline draws a spanning row per turn over
  the arms' lanes, with its executed code folded at the foot. Traces draws an attempt list, the
  span waterfall as inventory T4 keeps it, and the span's detail. The *Arms* side cards go.

The sheet's sections are built over Milestone 14's four slices, in order: the frame with Outcome,
Configuration and Usage first; then Objectives and Business state; then Provenance, Notes and the
header; then the depth tabs. Until a card is converted it stays in the one column, in the sheet's
order, and carries its section's `id`, so its chip already reaches it.

### The sheet

`components/ArmSheet.tsx` draws it, with its class sets in `lib/ui.ts`. A section is a card. It
has a Georgia title at the mockup's 19px, a one-sentence note held to about 75 characters, and
the `id` a chip jumps to. A card's footer becomes its section's note. The rows sit on a 240px
label column and one `minmax(0, 1fr)` column per arm, `sheetColumns`. A row's cells are padded
18px tall and 20px wide at line height 1.5, with one fact per line and never "a · b · c". A row
can span the arms, for a fact about the run rather than about one arm. A long value sits behind
a disclosure.

A chip is a link to its section's fragment on the results' own address. It is followed through
the router rather than as a native fragment jump: the browser's jump is a POP navigation the
router did not create, which react-router warns about while the workspace's blocker is mounted.
The unsaved-work guard has no stake in it — it blocks only a change of pathname
(`shell/UnsavedChangesGuard.tsx`). The page
lands it as the timeline lands a followed event: focus moves to the section, so the next Tab
starts there, and the section is scrolled to its top.

The rows are a native table with a header row whose column headers are the arms' labels, so a
cell is heard with its arm. That header row is `sr-only`. On screen, the summary row and the strip
name the columns, and a drawn header row would name each column a third time. The box around
the table is `relative`, so the `sr-only` row is laid out against the table and not the pane,
which it could otherwise widen at a phone's width (ADR 0079's lesson).

Every part of the table also carries its role explicitly — `table`, `rowgroup`, `row`,
`columnheader`, `rowheader`, `cell` — although the elements imply them. At a phone's width the
parts are drawn `display: block`, and WebKit has historically dropped a table's implicit
semantics when its display changes; the explicit roles are the documented remedy. Biome's
`noRedundantRoles` is suppressed for that one file, with that reason. What is verified is
Chromium's own accessibility tree, read over the DevTools protocol at 390×844: the stacked Usage
table is a table whose header row is three column headers and whose every row is a row header
and a cell per arm. Chromium keeps those semantics without the explicit roles too — removing
them does not fail the check — so the roles are verified to do no harm there and are WebKit's
guard; the suite runs no WebKit, so that guard is unverified.

### What differs leads, and is never a verdict

Configuration and Usage draw the rows the arms differ on first. Each is tinted with one token,
`admin-differs`, and says *Differs* in words in its label cell. Usage also draws those figures
larger. The rest fold under one closed disclosure, "N variables are the same for both arms" or
"N measures are the same for both arms". Inside it is one spanning row per shared value, drawn
whole. The tint says that the values differ and nothing more. There is no ratio, no winner and no
second colour, because a colour between the arms would be the verdict *Evidence before opinion*
refuses. *Differs* replaces the setup matrix's *Assessment* column. Configuration keeps that
column's words, and `comparisonRows` (`lib/comparison.ts`) still reads the comparison for the
bench's `DifferenceList` and for this section alike.

Usage holds the thirteen measures *Quantitative* drew and the arm card's "Tokens, in and out". It
keeps "not reported", "not priced" and "≥" as they were, draws an arm's failures one per line,
and draws a retry above zero in the error ink (ADR 0068). Outcome comes first. Its rows are
"Decided objectives met" and "Status" per arm. Then two spanning rows say whether the comparison
was controlled. *Input divergence* is one spanning row either way: the controlled sentence with
its ✓, or "Not every turn reached both arms as one composition, so the comparison is not
controlled.", with the divergence card's footer as the cell's second line. A divergent comparison
then draws a row per divergent turn, labelled by the turn, with what each arm heard in its own
cell. *Attribution* is `AttributionLine`. Both
sit above the evidence they govern. Outcome's note is "There is no aggregate score: each arm's
count is of the rows something actually decided for it."

The attribution sentences no longer point "above": the one-difference sentence says "the behavior
here", and the no-difference sentence says "nothing here". In Outcome they stand above the
evidence, and the bench reads the same sentences.

### One page scroll, with a strip pinned and not the header

Nothing scrolls inside the page and nothing covers it: no nested scrolling region, no overlay,
no drawer. The results header still scrolls away (ADR 0066 holds it for an editor and a create
page only). The strip is the one thing pinned. It is `sticky -top-5` on the canvas under a 1px
rule, which is where a pinned header holds. It is `aria-hidden`, because every cell's column
header already names its arm. It is a column's first child, so it holds for as long as the
sections are on screen. It sets the pane's `scroll-padding-top` to its own height plus the focus
ring's clearance, through `clearStickyStrip` (`lib/stickyHeader.ts`), as `clearStickyHeader` does.
So a focused control, a chip's jump and a tour step land clear of it (WCAG 2.2's 2.4.11). It
gives the pane back when it goes.

### A one-arm run is one column

A one-arm run draws no strip, because the summary row already names the one column. It draws no
*Differs* and no "same for both arms", because there is nothing to differ from or share with.
Every row of Configuration and Usage is drawn in the one column. Outcome reads "One arm ran, so
there is nothing to compare it against." and draws no Input divergence, because one arm cannot
hear a turn differently from itself.

### At a phone's width the rows stack

Below 48rem (ADR 0079, `useNarrowViewport`) every part of the table is a block. A row's label is
on a line, then each arm's cell is under a line naming its arm, since no column is left to name
it. A spanning row names no arm. The summary row stacks the same way. There is no strip, since
there are no columns for it to name. Traces' one-line strip stays, cut with an ellipsis. This
follows ADR 0079's column opened in place rather than a drawer, and it follows the timeline, whose
lanes already stack under a line naming each arm (`ExperimentTimelinePage.tsx:304`). A switch
between arms was refused, because it would show half a comparison at a time.

### Fork stays the panel under the header

The sheet mockup draws Fork as a dialog with "Leave Arm B empty". The panel under the header
(`ExperimentResultsLayout.tsx`, `ForkPanel`) stays. This shell has no modal, and a derivation is
read beside the run it derives from. It offers no one-arm fork either, because the backend refuses
one: a fork names one arm per arm of its source (`application/experiment_derivations.py:181–188`),
since the recorded script is written in arm positions. A fork that drops an arm would be a backend
slice of its own.

### The tabs stay links, and the accessible names stay

The tabs stay links in `nav[aria-label="Results views"]`, not the mockup's `tablist`. A tab is a
place in the experiment, and ADR 0054's routes address it, so an operator can share or reopen the
view they were in. These names stay where the sheet mockup draws others: "{label} summary",
"Back to the live bench", "Add a tag", "Remove tag {tag}", "Add a note", "Fork this experiment",
"Span", "Span waterfall", "Traced attempts" and "Every field of {order} each arm changed". Specs
and the tour reach the page by them, which is `docs/design-direction.md`'s *Authority* rule 5. A
card that becomes a section takes the section's name: "Outcome", "Configuration", "Usage".

## Amendments

- **ADR 0068.** The figures leave the arm card. The summary row keeps the arm, its configuration
  chip, its count and its standing. The figures are rows of Usage, read beside the other arm's,
  where a figure drawn on its own card was read against nothing. "Tokens, in and out" is one of
  Usage's rows. A retry above zero keeps the error ink. "Leave a figure off where nobody measured
  it" becomes "not reported" in its row, as *Quantitative* already said. `armFigures` goes with
  the card that read it.
- **ADR 0079.** The results stack at a phone's width as decided above. The results matrices'
  `tableScrollerClasses` stay until Slice 60 replaces the matrices with sheet rows. The last
  consequence's *Quantitative* table "nobody has measured at 390" is settled: it is Usage, its
  rows stack, and at 390×844 on the seeded run the pane is 338px of 338 and the document 390px of
  390.
- **ADR 0036.** The tags are drawn in the header and the notes are the last section, `id`
  `notes`, with the composer first. Storage, folding, the append-only note and the replaced tag
  set are unchanged. Until Milestone 14's third slice lands, the *Notes & tags* card stands where
  the Notes section will be.
- **`docs/design-direction.md`.** *Three evidence layers, kept distinct* now says that on the
  results the layers are labelled groups and sections of one sheet, not cards. *Desktop first,
  usable narrower* now says that the results sheet stacks below the breakpoint.

## Departures

Each is recorded in `docs/design-direction.md`, *Departures from the handoff, in force*:

- *An arm's names on its results card*: the position's letter is drawn again, `aria-hidden`, in
  one ink.
- *What the arms differed on, on the results*: a section, with *Differs* for the Assessment column
  and the shared values whole behind the disclosure.
- *The results' rail*: no rail; Input divergence is in Outcome, and Quantitative is Usage.
- The sheet mockup's tabs are links, and there is no strip for one arm or at a phone's width.
- The mockup tags Usage's differing rows *Tokens* and *Cost*. They say *Differs*, as every
  differing row does, because one word for one fact is what the tint stands beside.
- The brief and the mockup draw a divergent comparison as a row per divergent turn under the
  label *Input divergence*. Here the *Input divergence* row is present in both states, a spanning
  row, so the old card's footer can be its cell's second line without entering the divergent
  rows' accessible names. Each divergent turn's row is labelled "Turn N", the old card's own item
  heading moved into the row header. The divergent verdict, "Not every turn reached both arms as
  one composition, so the comparison is not controlled.", is new and mirrors the controlled one.

## Consequences

- `ComparisonTable` and *Quantitative* are gone. `ConfigurationSection` and *Usage* read the same
  projections, and no request was added.
- The summary row is now under the tabs. The tour's first two steps keep their anchors
  (`results-arms`, `nav[aria-label="Results views"]`). The first step says the figures are in
  Usage, and the provenance step says Outcome lists the input divergence.
- Measured on the seeded run at 1440×900: the strip holds at the pane's top with its columns over
  the sections' columns. At 390×844: nothing passes the viewport, and the pane is 338px of 338.

## Verification

- `ArmSheet.test.tsx`: the column headers named by the arms; a spanning row's one cell across
  them; a differing row's tint and word, and no mark between its cells; the disclosure closed,
  its count, singular and plural, and its rows whole; one arm as one column with no strip and
  nothing folded; the strip `aria-hidden`, sticky, on the sheet's columns, its names cut; at a
  phone's width (`test/viewport.ts`) the rows stacked, each cell under a line naming its arm and
  a spanning row naming none, and the columns back once it widens.
- `Experiments.test.tsx`: the summary row under the tabs with its regions, letters, link and
  count, on every tab, with no figure in it, and every figure in Usage; Usage's differing rows
  first and larger, its folded count, its floor, "not reported" and a retry in the error ink, open
  or folded with what both arms share;
  Outcome per arm, the divergence controlled and divergent in their columns, the attribution for
  one, two and no differences and for one arm; Configuration's order; the chips' targets in the
  sheet's order in one column; the strip's names, absent on another tab, for one arm and at a
  phone's width, and back when it widens.
- `lib/stickyHeader.test.ts`: the strip's clearance follows its height and is given back.
- `lib/ui.test.ts`: the sheet's columns, spacing, tint token, strip and letter.
- `tests/e2e/experiment-start.spec.ts`: no figures on the summary, Usage's rows, the strip, the
  phone width with no strip, stacked Usage and nothing past the viewport, and the divergence in
  Outcome; and at 390×844, Chromium's accessibility tree holding the stacked Usage table's rows
  and cells (`support/accessibility.ts`). `tests/e2e/sticky-header.spec.ts`: the results' header is static and the strip sticky,
  and a chip's jump to Usage lands the section under the strip held at the pane's top.
  `tests/e2e/tour-anchors.spec.ts`: `results-arms` resolves where it moved.

## Migration

None. No contract, route, stored key or stored value changes.
