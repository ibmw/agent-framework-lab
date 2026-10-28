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

### The evidence: Objectives and Business state

*Objectives* replaces the *Deterministic evidence* and *LLM judge evidence* cards. It is one
section with two labelled groups, "Decided by a rule" and "Scored by a judge". Each group has a
small-capital heading, the old card's footer as its note, and its rows in a table of its own named
by the heading (`SheetGroup`). A group with no row says "This scenario composes no objective a
rule decides." or "This scenario leaves no objective to a judge." in its place. The section's note
is "A rule decides what the record can, and a judge scores what no rule can."

A row's label is the objective's statement, then on lines of their own its slug in the mono face,
its severity as a neutral tag, and "must never happen" when it is forbidden. Each arm's cell is
paired by the objective and by the arm's run, never by position. Its first line is the outcome, the
glyph beside the word (`OUTCOMES`). The one-word outcomes are pills, as the mockup draws them:
*met* on the published green, *missed* on the error tint, *pending* neutral. The pill is one arm's
against one objective and never one arm's against another's. The outcomes that are sentences — "a
judge scores this after the run", "no evidence this lab reads decides this", and "not judged" where
an arm has no result — are the cell's first line in the soft ink and never a pill, which would wrap
them into a rounded block at two columns and at a phone's width. A rule's evidence line is drawn
whole. Where one recorded call decided it (`decided_by`), "Open the deciding event →" links into
the timeline on that event. The link is named "Open the deciding event for {statement}, {arm}",
because every decided cell draws the same words. A judged cell draws the rationale's first
sentence, the control judge's sentence where the offline control judged, and one closed *Verdict
details*. That disclosure holds the whole rationale where it is more than its first sentence,
`judgementProvenance` (the judge by its published name with its version, its model and the attempt,
or "Attempted by …; no verdict: {why}" for an execution that produced none) and the brief's
fingerprint. It is what the list of verdicts beside the judged matrix said, cell by cell. The judge
picker, *Score* or *Score again*, the scoring queue and a scoring failure sit at the section's
foot. `aria-busy` is on the judged group alone while a judge scores, so the queue at the foot is
still heard (ADR 0065).

*Business state* replaces its card. It is a row per fact with each arm's value in its column, one
fact per line. *Scenario fault* and *Agent write* draw each write's name over "Revision r0 → r1",
or "None" for an arm that made none of that kind. Each row is drawn only where some arm made a
write of its kind, and its label is plural, *Scenario faults* or *Agent writes*, where an arm made
more than one. *Order {reference}* draws "3 groups changed" over a group a line. *Changed outside
every order* draws each change in the error ink with its glyph, where any arm has one. *Fingerprint
now* draws the fingerprint over the revision, "Started from" and the snapshot's fingerprint, then
"No other state changed." or "Nothing wrote — this arm's world is the one it started in.".
*Compared* is the comparison sentence as a spanning row. The section's note is "Verified, not
claimed: read from each arm's own state rather than from what its agent said it did."

Under the rows, where the arms changed the same paths, a group headed "Where the arms differ on
{order}" draws the rows they differ on, on load. Then the disclosure "Every changed field of
{order} ({n})" holds every path. The field table is on the sheet's rows (`SheetTable`): a heading
row per group across every column (`SheetHeadingRow`), and a row per path. A row's header is the
path over the value every arm started from, with "Was" drawn before it and `aria-hidden`, since the
label column's header, "Field and what it was", says it. Each arm's value is in its column, and an
*Assessment* column that the table adds after the arms' (`extra`) ends the row. So a row is heard
as field, starting value, each arm's value, assessment, which the journey reads as
`/^shipping_address\.city Bordeaux Lyon Lyon /`. One arm draws no *Assessment* column. Where the
arms changed different paths, the table is a row per group with each arm's paths in its column,
each over what it was and what it became. The added column takes its width from the arms', so
the field table's arm columns are narrower than the strip's by the *Assessment* column. That seam
is a recorded choice: the brief orders the fourth column and the order a row is heard in.

A cell's and a label's lines sit in a `div`, so a cell may hold flow content such as *Verdict
details*. From a phone's width up the foot's judge picker is a subgrid of its word, its select and
its note, with the press in the select's row and stretched to its height, so the two are one
height with their bottoms aligned whether or not the note is drawn.

Nothing in either section scrolls inside the page. At a phone's width every table stacks as the
sheet does, the added column's cell last under a line naming it. Each table's `sr-only` header row
stacks too. Laid out as a row, the field table's four headers ran past the viewport's edge inside
their clipped box, and `pastTheViewport` found them there.

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
"Span", "Span waterfall", "Traced attempts", "Every changed field of {order} ({n})" and "Every
field of {order} each arm changed". Specs and the tour reach the page by them, which is
`docs/design-direction.md`'s *Authority* rule 5. A card that becomes a section takes the section's
name: "Outcome", "Objectives", "Business state", "Configuration", "Usage". A section is named by
its heading, which no tour anchor can select (`lib/tours.test.ts` holds anchors to an
`aria-label` or a `data-tour`), so the tour's two evidence steps anchor on
`data-tour="results-objectives"` and `data-tour="results-state"`, set on the sections
(`SheetSection`'s `tour`), and take the sections' titles.

## Amendments

- **ADR 0068.** The figures leave the arm card. The summary row keeps the arm, its configuration
  chip, its count and its standing. The figures are rows of Usage, read beside the other arm's,
  where a figure drawn on its own card was read against nothing. "Tokens, in and out" is one of
  Usage's rows. A retry above zero keeps the error ink. "Leave a figure off where nobody measured
  it" becomes "not reported" in its row, as *Quantitative* already said. `armFigures` goes with
  the card that read it.
- **ADR 0079.** The results stack at a phone's width as decided above. *The results' matrices
  keep their reading widths* is superseded: the matrices are Objectives' rows and the field
  table is on the sheet's rows, so neither has a scroller, a reading width or an `sr-only` line
  to hold in one. Its *Verification* line on the deciding-call journey is superseded too: the
  journey follows the link from a stacked cell reached by the page's own scroll. The last
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
- The mockup draws a judged cell's *Verdict details* as "Judge v1 · deterministic", "Attempt 1"
  and "Brief". Here it is `judgementProvenance`'s sentence and "Brief" with its fingerprint: the
  judge by its published name, because the lab's judges are named rubrics, and the attempt and a
  failed execution's reason in the sentence the results already said them in.
- The mockup's *Fingerprint now* is one line, "r2 · 533822bfcf99…". Here the fingerprint, the
  revision and where it started are a line each, one fact per line. The card's "Nothing wrote —
  this arm's world is the one it started in." is that cell's last line, where the mockup has no
  place for an arm that did not write.
- The mockup draws Business state's rows and the disclosure only. The rows the arms differ on
  are also drawn on load, under the rows, because a difference behind a press is one an operator
  can miss. Where the arms changed different paths, the disclosure is a row per group with each
  arm's paths in its column, which the mockup does not draw.
- The mockup's "Fulfilment" group is "Fulfillment", as Milestone 13 spells it.
- The mockup draws "Open the deciding event →" as a button. Here it is a link, since it opens an
  address in the timeline, named with its objective and its arm.
- The mockup gives Objectives one note for both groups. Here each group carries its card's old
  footer under its heading, and the section's note is new.
- A scoring failure is said at the section's foot, beside the press that failed, where the page
  said it above the sections.
- The brief and the mockup draw a divergent comparison as a row per divergent turn under the
  label *Input divergence*. Here the *Input divergence* row is present in both states, a spanning
  row, so the old card's footer can be its cell's second line without entering the divergent
  rows' accessible names. Each divergent turn's row is labelled "Turn N", the old card's own item
  heading moved into the row header. The divergent verdict, "Not every turn reached both arms as
  one composition, so the comparison is not controlled.", is new and mirrors the controlled one.

## Consequences

- `EvidenceMatrix` and its scroller, `EvidenceCell`, the `Verdicts` list, `describeVerdict`,
  `BusinessStateComparison` and `summarizeGroups` are gone. `ObjectiveMatrix` is the bench's
  compact matrix alone and is unchanged there. `ObjectivesSection` and `BusinessStateSection`
  read the same projections, and no request was added.
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
- `Experiments.test.tsx`, for the evidence: the two groups, their headings, notes and empty
  sentences, and no picker with nothing to score; a row's statement, slug, severity tag and
  forbidden line; each cell's pill with its glyph `aria-hidden`, an outcome that is a sentence drawn
  as a line and not a pill, its evidence line, and no `title` or hidden copy; the deciding link by
  its name and target, absent where no call decided, and followed into the timeline; a judged cell's
  first sentence, *Verdict details* closed then open with the whole rationale, the judge by its
  name, version, model and attempt and the brief, a failed execution as an attempt with its reason,
  a one-sentence rationale said once, and the control's sentence only for the control; the scoring
  queue at the foot with `aria-busy` on the judged group alone; the state's write rows per kind with
  their revision lines, the order's groups a line each, *Fingerprint now* with its last line, a
  change outside every order with its glyph and no `alert` on load, *Compared* as a spanning row;
  the field table's headers, group rows, every path, each row's computed accessible name read as
  field, starting value, arms, assessment, and part by part, "Was" `aria-hidden`, and one arm
  without *Assessment*; the arms' own columns where they changed different paths; at a phone's width
  the objectives and the field table stacked under their arms' lines, and no scroller on General.
  The seeded run holds no refused proposal (the control policy never makes one,
  `infrastructure/agents/fake/runtime.py`), so the evidence that a refusal is readable from its cell
  is the case reading a missed rule-decided cell: its pill with ✗ and its whole sentence.
- `ArmSheet.test.tsx`: a grouped section, a group's own table, note and empty sentence, and its
  `busy` alone; the added column's header, `col` and cell, a heading row and a spanning row across
  it, and the added cell stacked last under its header's line at a phone's width.
- `lib/tours.test.ts`: the two evidence steps titled after their sections and anchored on their
  hooks.
- `lib/stickyHeader.test.ts`: the strip's clearance follows its height and is given back.
- `lib/ui.test.ts`: the sheet's columns, spacing, tint token, strip and letter.
- `tests/e2e/experiment-start.spec.ts`: no figures on the summary, Usage's rows, the strip, the
  phone width with no strip, stacked Usage and nothing past the viewport, and the divergence in
  Outcome; and at 390×844, Chromium's accessibility tree holding the stacked Usage table's rows
  and cells (`support/accessibility.ts`). `tests/e2e/sticky-header.spec.ts`: the results' header
  is static and the strip sticky, and a chip's jump to Usage lands the section under the strip
  held at the pane's top.
  `tests/e2e/tour-anchors.spec.ts`: `results-arms` resolves where it moved, and the evidence
  steps' `results-objectives` and `results-state`.
- `tests/e2e/experiment-start.spec.ts`, for the evidence: the two groups' cells, the control's
  sentence and *Verdict details* hidden then shown; at 390×844, Chromium's accessibility tree
  holding the stacked "Decided by a rule" and field tables' rows and cells, a cell naming its
  arm, and nothing past the viewport with the field table open; the write rows, the order's
  groups, "No other state changed." and *Compared*; and the field row heard as
  `/^shipping_address\.city Bordeaux Lyon Lyon /`. Its second journey, *a deciding call followed
  from a stacked results cell…*, reaches arm B's link at 390×844 under the line naming its arm,
  with no scroller above it and inside the viewport's width, passes nothing past the viewport,
  and lands focused on that call in the timeline.

## Migration

None. No contract, route, stored key or stored value changes.
