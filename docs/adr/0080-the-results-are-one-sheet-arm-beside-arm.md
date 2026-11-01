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
header; then the depth tabs. General is the whole sheet once the third has landed.

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

### The record: Provenance, Notes, and the header

*Provenance* replaces the rail's card. Its note is the card's old footer, "Every arm was cloned
from one snapshot, so the arms began at the same fingerprint and moved apart only when something
wrote." Its rows span the arms, because they are facts about the run: *Derived from*, where the
run has a source, the source's results as a link after "A fork of" or "A replay of", and what
the derivation changed on a line of its own, in the draft ink with "no difference from that run
can be attributed to any one of them" where it changed several things; *Starting state* and
*Inputs*, each fingerprint cut to twelve characters with the whole in its `title`, and a press
named "Copy the starting-state fingerprint" or "Copy the inputs fingerprint" that writes the
whole value to the clipboard and says "Copied the … fingerprint." in a `status` beside it, or
"This browser refused the copy."; *Participant*; *Scenario and fixtures*, the scenario once and
every other pin that is not a block, each a link to what it pinned where this build has an editor
for it (ADR 0068), and its words otherwise; *Blocks*, each by
the name its version was published under with its kind beside it, or by its kind and version
until that name is read or where it cannot be. *Each arm's versions* is the last row, in the
arms' columns: the configuration by name, then the other pins. The section carries
`data-tour="results-provenance"`. The bench's card is unchanged, and both read the pins through
one helper, `provenancePins` (`lib/provenance.ts`), with the change's words (`describeChange`).

*Notes* is the last section, `id` `notes`, carrying `data-tour="results-notes"`. It is
`SheetCard`, the section's card without the rows, because a composer and a list are not facts
per arm. Its note is the card's old footer, "What a reviewer concluded, stored beside the record
rather than in it." The composer comes first: the field labelled "Add a note", *Add note* with
its refusal (ADR 0063) as a hint until touched (ADR 0078), and a failed write said beside the
press, the box kept. Then the list "Notes on this run", each note's body over its time. The
*Notes & tags* card is gone.

The header reads, top to bottom: "Back to the live bench" above the title; *Notes · N*, Replay and
*Fork…* as the actions; then the run's facts as a list named "About this run" — the standing with
its glyph (✓ when every arm completed, · otherwise), the scenario's version as a link to the
scenario, the seed, when it started (`formatTimestamp`); then *Filed under*, a group named by those
words, holding each tag with its remove ("Remove tag {tag}") and *+ Tag*. *+ Tag* opens the tag form
in its place, focus in the field: "Add a tag", *Add tag* with its refusal as today, and *Cancel*.
*Cancel* or Escape folds it, drops what was typed and any failed tag write's alert — an add's or a
removal's — and returns focus to *+ Tag*. An accepted tag leaves the form open for the next one,
focus back in the emptied field whether Enter or *Add tag* sent it. A failed tag write is said in
the header, under *Filed under*. A tag's remove is a `BusyButton`, held while any write is out —
`aria-disabled`, its press swallowed, no hover ink — rather than disabled, which would drop a
keyboard reader's focus (ADR 0065); once its chip is gone, focus still on it moves to *+ Tag*, or to
the field where the form is open when the answer lands. `PageHeader` gains two slots for this,
`lead` above the title row and `below` under everything else, since a chip list and a form cannot
sit in its one line of description. A page with no ← holds its title and chips in one item of the
title row, `flex-[1_1_16rem]` as the ← and its title already are (ADR 0066), so a long title wraps
beside the actions rather than putting them on a line of their own. The mockup's 520px basis is
not taken: on a page whose title is short it would still push the actions under it wherever the
row is narrower than 520px and the actions together. *Notes · N* is a link to `…/results#notes` from every tab, named
"Notes · N"; the router lands it as a chip's jump. The line on Replay and Fork, the reach line, the
derivation queue and the Fork panel are unchanged, under the header. Inventory H4 for this direction
— one line, the long-action note only while one runs — is what they already draw: `ActionStatus`
draws its note only while the derivation runs.

The two writes now sit apart, so the layout sends them: `annotate` and `annotating` are handed to
the header and to Notes through the outlet's context. One goes at a time, because each answers
with the whole annotation and two in flight could answer out of order, the later answer drawing
the run without what the earlier one wrote. An answer that arrives after the operator moved to
another run is not drawn over that run, and the box it came from is left as it was.

The tour's last two steps anchor on the two sections and take their titles, *Provenance* and
*Notes*. The second says the tags are in the header.

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

### The depth tabs under the strip

The three depth tabs are drawn on the sheet, each in one column under its strip, and the *Arms*
side cards on the timeline and on Traces go: each arm's framework and model are on the summary
row, above every tab. Each card's footer becomes its section's note.

- **Conversation** is a section of the sheet named "Conversation", its rows in one table of the
  same name. Each composition is a group of rows, a `rowgroup` named *Trigger* or *Message N*.
  Its first row spans the arms on the faint ground: its label is the composition's name over
  where it came from, "Trigger" or "Customer", and its cell is the message once, held to a
  reading measure, over which arms it reached. A composition every arm received says "Reached
  both arms as one composition."; one that reached only some carries "this arm only", as the
  bench marks it, and "Reached {arm} alone.", since the mark no longer sits in one arm's column;
  a one-arm run says neither. The second row, *What each arm did*, holds each arm's attempts in
  its column: an `article` named "{arm} · turn N", headed by that arm's own turn number, then
  each attempt's calls, a line each with the glyph before the words, a fault where it fired, and
  the reply. That is `ArmAttempts` (`components/ConversationThread.tsx`), the bench's thread
  without the customer's message, with its calls drawn as lines rather than the bench's chips;
  the words are the same, and the bench's `ArmThread` is unchanged. An arm that never received
  the message says "{arm} did not receive this message." in its cell.
- **Execution timeline** is a section named "Execution timeline", its lenses in its head under
  the note, unchanged and still combining. Each turn is a group of rows named "Turn N": a row
  spanning the arms, on the faint ground, with the customer's event, then *Events, in order*,
  each arm's lane in its column, the list "{arm}, turn N". The lanes' header row goes, because
  the strip names the columns; each event keeps its arm on its first line. A followed event is
  scrolled to the middle of the pane and focused, so it lands clear of the strip, whose clearance
  also holds for every scroll into view. *Executed project code* is a `section` named by those
  words at the foot, around a closed `details` whose Georgia summary carries its count, "· N
  functions"; the old card's footer and the list as it was are inside.
- **Traces** is a section named "Traces". Under its head the attempts are a list on the left,
  the group "Traced attempts", each a press with `aria-pressed` drawn on the selected chip's
  ground, its arm over its turn and attempt and named whole, "{arm} · turn N · attempt M" with
  "· failed" where it failed. Beside it, or under it at a phone's width, is the waterfall, still
  the list "Span waterfall", each bar at its span's offset into the attempt (inventory T4, ADR
  0037), then the span's detail, still the region "Span", titled by the span, its footer under
  its terms. The strip is one line, `SheetLineStrip`: "Traces", the chosen arm's letter and name,
  then the turn, the attempt and the span, cut with an ellipsis. It is pinned at every width and
  for one arm, since it names a choice rather than columns, and it follows each press. The attempt
  keeps room for "Turn N · attempt M" and a long arm name is cut first; below a phone's width the
  label "Traces" is not drawn, because the tabs above already say it and the line needs its room.
  At a phone's width the arm and the attempt are kept and the span is the first thing the
  ellipsis cuts.

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
follows ADR 0079's column opened in place rather than a drawer, and it follows what the timeline
did before the sheet, whose lanes stacked under a line naming each arm; its lanes are now the
sheet's rows and stack as they do. The conversation stacks the same way, and Traces' attempt list
sits above its waterfall. A switch between arms was refused, because it would show half a
comparison at a time.

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
  set are unchanged. The layout sends both writes, one at a time.
- **ADR 0068.** On the results each pinned version is a link that is its row's value, not a chip,
  and opens the same address. The bench's card keeps its unlinked chips; `RunProvenance` is the
  bench's alone and loses its `linked` option.
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
- The mockup's way back reads "← Live bench". Here it reads "Back to the live bench", its
  accessible name, which specs reach it by (rule 5).
- The mockup draws Fork as a pine button opening a dialog, `aria-haspopup="dialog"`. Here it keeps
  the outline weight beside Replay and opens the panel under the header (*Fork stays the panel
  under the header*).
- The mockup names a tag's remove "Remove the tag {tag}", the tag field "New tag" and the note
  field "New note". Here they stay "Remove tag {tag}", "Add a tag" and "Add a note", the names the
  specs and the tour reach (rule 5). The note field's label is drawn, as the mockup draws it.
- The mockup's *+ Tag* draws a "+" in its text. Here the plus is the `create` glyph, hidden, so the
  press is named "Tag".
- The mockup folds the tag form on *Add tag*. Here an accepted tag leaves it open, the box
  emptied, so a second tag is typed straight after the first; *Cancel* and Escape fold it.
- The mockup draws *Notes · 2*'s count as a badge and the link's name would run the two together.
  Here the link is named "Notes · N" in an `aria-label`, its words and count the ones drawn.
- The mockup draws the copy press as a 32px glyph. Here it is the small subtle button reading
  "Copy", named for its fingerprint, since copying is no verb of the closed glyph vocabulary.
- The mockup's Provenance note is two sentences, "What this run pinned." and the card's footer;
  its Notes note adds "A note is added, never edited.". Here each is the card's footer alone, one
  sentence, as every section's note is; the rest is in the tour.
- The mockup has no *Derived from* row and draws *Each arm's versions* as "Configuration v1".
  Here a derived run's source leads the rows, and an arm's configuration is named as its summary
  row names it, by the configuration's name where it is not the arm's label. Where it is, both
  arms' cells hold a link named "configuration v1"; each cell sits under its arm's column header
  (`SheetTable`), so the link is heard with its arm, as on the summary row.
- The plan and the mockup give each form its own press. Here *Add note*, *Add tag* and each
  tag's remove share one hold, `annotating`, as the *Notes & tags* card's one writer did: each
  write answers with the whole annotation, and two in flight could answer out of order. The hold
  is the layout's, so it also holds them on the next run while the previous run's write is still
  out.
- The mockup shows nothing for a run filed under no tag. Here *Filed under* says "no tag yet".
- The mockup's tag field is 160px; the rail's was the rest of its row at a 130px floor. Here it is
  the mockup's 160px.
- The brief and the mockup draw a divergent comparison as a row per divergent turn under the
  label *Input divergence*. Here the *Input divergence* row is present in both states, a spanning
  row, so the old card's footer can be its cell's second line without entering the divergent
  rows' accessible names. Each divergent turn's row is labelled "Turn N", the old card's own item
  heading moved into the row header. The divergent verdict, "Not every turn reached both arms as
  one composition, so the comparison is not controlled.", is new and mirrors the controlled one.

- `docs/design-direction.md`'s *The execution timeline's clock* and *The arm on a timeline card*:
  the turn is a group of the sheet's rows, and the lanes have no header row; each event keeps its
  arm. *The results' fourth tab*: the message is drawn once, spanning the arms, and the calls are
  lines on the results and chips on the bench.
- The sheet mockup draws each bar's length as its duration from the track's start. Each bar
  stays at its span's offset, as ADR 0037 draws it, so the gap between two calls stays visible;
  the operator decided this on 27 October 2026 (inventory T4).
- The sheet mockup's attempts are a `listbox` of options. Here they are pressed buttons, with no
  arrow-key model to build, each named by its arm, turn and attempt.
- The sheet mockup's lens is one at a time. Here the lenses combine, as they did, so "what moved
  this arm" is answered with the agent's write and the scenario's fault together.
- The sheet mockup draws an arm's reply under "Answered" on the pine tint, and no "Agent" line.
  Here an attempt keeps the bench's "Agent" line, which carries the attempt's number after a
  retry, and the bench's reply box, so a reply reads as the one watched on the bench.
- The sheet mockup labels a conversation's row "Turn N" and its timeline's "Turn N". Here the
  conversation's row is *Trigger* or *Message N*, as the brief and the tab's own numbering say: a
  composition is not one arm's turn, and each arm's cell carries its own turn number.
- The sheet mockup's Traces note joins the *Arms* card's sentence and its own; its OpenTelemetry
  sentence sits at the foot. Here the note is the Traces card's footer whole, the OpenTelemetry
  sentence first, and the *Arms* card's sentence goes with the card.

## Consequences

- `EvidenceMatrix` and its scroller, `EvidenceCell`, the `Verdicts` list, `describeVerdict`,
  `BusinessStateComparison` and `summarizeGroups` are gone. `ObjectiveMatrix` is the bench's
  compact matrix alone and is unchanged there. `ObjectivesSection` and `BusinessStateSection`
  read the same projections, and no request was added.
- `ComparisonTable` and *Quantitative* are gone. `ConfigurationSection` and *Usage* read the same
  projections, and no request was added.
- `RunProvenance` is the bench's card alone. `provenancePins`, `pinLabel` and `describeChange`
  (`lib/provenance.ts`) group and word the pins for it and for `ProvenanceSection`. The results'
  annotation forms are `RunTags` in the header and `NotesSection`; `Annotate` (`lib/annotate.ts`)
  is the layout's writer they share.
- The summary row is now under the tabs. The tour's first two steps keep their anchors
  (`results-arms`, `nav[aria-label="Results views"]`). The first step says the figures are in
  Usage, and the provenance step says Outcome lists the input divergence.
- Measured on the seeded run at 1440×900: the strip holds at the pane's top with its columns over
  the sections' columns. At 390×844: nothing passes the viewport, and the pane is 338px of 338.

- The depth tabs read the projections they read before: the conversation the experiment and
  the timeline, the timeline its stream, Traces its traces. No request was added. The *Arms*
  cards go; `ArmTurn` keeps the bench's thread and `ArmAttempts` is shared by both.
- Measured on the seeded run's three depth tabs: at 1440×900 the arm strip holds at the pane's
  top over the conversation's and the timeline's columns, and Traces' line once the waterfall is
  scrolled; at 390×844 the pane is 338px of 338 and the document 390px of 390 on each, with
  Traces' line held at the pane's top.

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
  hooks; the last two, *Provenance* and *Notes*, likewise, the second saying the tags are in the
  header.
- `Experiments.test.tsx`, for the record: Provenance's rows in order, the run's spanning and each
  arm's versions in its column, the fingerprints, the participant, the scenario once and a fixture
  as links, each block by its name with its kind and its address, a block not read kept as its
  kind and version, each version read once across tabs; a copy writing the whole fingerprint to
  the clipboard and saying so in its `status`, and a refused copy said; a derived run's source
  first, its change on a line of its own, several changes in the draft ink, and no source for a
  run with none; every section's note one sentence. The header in order — the way back, the
  title, *Notes · N*, Replay, *Fork…*, "About this run", *Filed under* — the facts' chips with the
  scenario's link; *Notes · N*'s count and its target followed from the timeline, landing focused
  on Notes, and its count after a note is added. The tags in the header with their removes, *+
  Tag* opening the form with focus in it, *Cancel* and Escape folding it with focus back on *+
  Tag*; the refusals muted then red, again a hint after an add and after a fold; a removal leaving
  a half-typed tag alone; a failed tag write said in the header alone; a note held while a tag
  write is in flight; an answer about a run left behind not drawn over the next, waited for on
  the hold it releases; the composer before the notes, each body over its time; and the writes'
  existing guarantees. A tag's remove held and keeping focus while a tag or a note write is out,
  and focus on *+ Tag* once its chip is gone, or in the field where the form was opened while
  the removal was out; focus back in the field after *Add tag* is pressed;
  a failed tag write's alert dropped on *Cancel* and on Escape; the scenario's chip a link whose
  words are the chip's; Provenance's column headers naming the arms. On the bench, the
  unlinked chips by name: "Objective block · {name} v1" in "What this run pinned", and an arm's
  configuration as its chip names it in "What Arm A pinned".
- `WorkspaceChrome.test.tsx`: `PageHeader`'s lead above the title and its rows below everything
  else, and neither drawn when not given.
- `lib/stickyHeader.test.ts`: the strip's clearance follows its height and is given back.
- `lib/ui.test.ts`: the sheet's columns, spacing, tint token, strip and letter; a tag's remove
  inked on hover only while it can be pressed.
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
- `tests/e2e/experiment-start.spec.ts`, for the record: a tag filed from *+ Tag* in the header,
  folded to its spelling, the form folded by Escape with focus back on *+ Tag*; a note added in
  *Notes* and counted in the header's *Notes · 1*; a fork's *Derived from* row naming what it
  changed. `tests/e2e/sticky-header.spec.ts`: the taller header still scrolls away, and its
  *Notes* lands the section under the strip. `tests/e2e/tour-anchors.spec.ts`: the last two
  steps' `results-provenance` and `results-notes` each resolve to one visible element.

- `Experiments.test.tsx`, for the depth tabs: a message drawn once across the arms, said to have
  reached both, and each arm's turn number, calls and reply in its column; a split message marked
  "this arm only" and naming the arm it reached, the other arm's cell saying it never received
  it; the timeline's order kept; a refused call as a line with its glyph; the strip on
  Conversation and Execution timeline over their columns, and none for one arm or at a phone's
  width; the conversation and the timeline stacked at a phone's width under their arms' lines;
  the timeline's turn as a spanning row over the lanes in their columns, heard under the arms'
  column headers, with no lanes' header row; the executed code closed at the foot with its count,
  then open with its note and list; the attempts listed before the waterfall and the span, each
  naming its arm over its turn and attempt; each bar's `left` at its span's offset; the one-line
  strip naming the arm, attempt and span and following each press, at a phone's width too; the
  span titled by the span with its note; no *Arms* card on either tab.
- `ArmSheet.test.tsx`: a named group of rows, a spanning row on its ground, controls in a
  section's head; `SheetLineStrip` `aria-hidden`, sticky and cut, for one arm at a phone's width.
  `lib/ui.test.ts`: the line strip's pin and cut, and the chosen attempt's ground.
- `tests/e2e/experiment-start.spec.ts`: the executed code closed with its count, opened before
  its list is read. Its deciding-call journey, whose arms are now named at the seed's length,
  opens Traces at 390×844: the line's label is hidden, "Turn 1 · attempt 1" ends inside the line
  rather than under its ellipsis, its end measured against the ellipsis's own width, and nothing
  passes the viewport. `tests/e2e/sticky-header.spec.ts`: on a 1280×560 pane the strip held at
  the pane's top on Conversation and Execution timeline once the header has scrolled away; a
  followed event that the pane scrolls to lands under the strip, focused; Traces' line held at
  the top and following a span's press.

## Migration

None. No contract, route, stored key or stored value changes.
