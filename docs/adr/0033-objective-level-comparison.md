# ADR 0033 — Objective-level comparison, and the score it refuses to compute

Status: accepted — 2026-09-03

Delivers `docs/PLAN.md` Milestone 5's fourth outcome: objective-level comparison presented
without a global framework score. Records the results screen frame 9 asks for, the depth
tabs the header stays across, the readings it is built from and the one it declines to make,
and the parts of the frame that belong to later outcomes.

## Context

By the end of Milestone 4 and the three evaluation slices before this one, an experiment
already answers every question this outcome asks. The evaluation says where each arm stands
against each of the scenario's objectives (ADR 0030), a judge fills the rows no rule decides
and records what produced each verdict (ADR 0031), the metrics say what each arm spent
(ADR 0032), the tool and mutation events say what actually moved each arm's world (ADR 0026,
ADR 0028), and the participant turns carry the composition identity that makes divergence a
record rather than an inference (ADR 0025).

What was missing is the surface those readings are *compared* on. The bench (frame 8) shows
them while an operator drives the incident, one arm's thread beside the other's, with the
objectives matrix in a 320px column. That is the right shape for driving and the wrong shape
for concluding: an operator who has finished an experiment is asking a different question —
"where did these two arms actually come apart, and what does the evidence say about it" —
and the answer to that question is a page, not a sidebar.

The dangerous part of building it is the part the product direction has been explicit about
since ADR 0011: **do not collapse evidence into one global framework score.** A results
screen is exactly where that pressure appears, because a screen showing two columns invites
a number at the bottom of each.

## Decision

### The comparison is presented, not computed

This slice adds no endpoint, no stored record, and no new count. Every number on the results
screen comes from a projection the backend already serves, and the page derives nothing of
its own except which rows to put in which card.

That is the same rule ADR 0027 gave the timeline, ADR 0029 the standing, ADR 0030 the
evaluation, and ADR 0032 the metrics, applied one level further out. A results page that
counted for itself would be a fourth reader of one record, free to disagree with the bench
the operator drove the experiment on — and "the results page says 6/7 and the bench says
5/7" is precisely the kind of contradiction that makes evidence stop being evidence.

It is also why this slice is deliberately frontend-shaped. The plan's delivery rules forbid
splitting a contract from its consumer; they do not require inventing a contract for a
reading that is already published. The vertical path here runs from the three existing
documents to the screen that reads them.

### There is no aggregate, and the counts that exist are per arm

Each arm carries `met` out of `decided` — what it met, out of the rows something actually
decided *for that arm* (ADR 0030). Those two numbers are shown per arm and never combined:
no total across arms, no delta, no winner, and no efficiency-adjusted anything.

The denominators are the reason this matters rather than a scruple. Two arms driven to
different depths hold different denominators — an arm still owing a turn has pending rows
that nothing has decided — so a difference between the two fractions can be the operator's
own pacing rather than a difference between the configurations. A single score would hide
that, and it would also decide, silently and on the operator's behalf, how a missed process
check weighs against a resolved incident. That weighting is the judgement this lab exists to
hand to a person.

The page says so in a sentence, in the interface rather than only here: the columns are never
added into a winner.

### Deterministic evidence and the judge's rows are separate cards

Rows are split by `assessment`: what a rule decided in one card, what a judge decided in
another, with each verdict's judge version, model, attempt, and brief fingerprint on the
page beside it rather than only in a tooltip.

They are different kinds of evidence and the frame separates them for the same reason
ADR 0031 keeps judge executions as records where the deterministic evaluation is a
projection: one is recomputable from the record and the other is a model's reading of it. An
operator deciding how much to trust a cell needs to know which kind it is without hovering.

The judge can also be run from here, because the results screen is where an operator
concludes and a row nobody has scored is the most likely thing to be missing at that moment.
It is the same endpoint the bench calls, and the control says what it does: once a verdict
stands, the button reads "Score again", which is what ADR 0031 made it — a new attempt beside
the last, never over it.

### Business state is read from revisions, not from replies

The state card lists what actually wrote into each arm — the agent's tools and the scenario's
own faults together — with the revisions each moved, and each arm's current fingerprint
against the snapshot fingerprint both started from.

"Verified, not claimed" is the whole point of the card: an agent's reply saying it changed
the address is not evidence that the address changed. The faults appear beside the tools
because ADR 0028 made them a second writer of the same world, and a card showing only the
agent's writes would leave two arms at unexplainable revisions.

Value-level before/after diffs — the frame's "Bordeaux → Lyon" — are deliberately **not**
here. They are the state-diff half of Milestone 5's sixth outcome, which owns diffs, notes,
tags, traces, replay, and fork provenance together.

### Divergence is read from the composition, never from the words

The input-divergence card marks a turn where the arms did not hear the same composition —
either because one composition reached only some arms, or because two compositions sit at one
ordinal.

Reading it off the bodies instead would get the interesting case exactly backwards. ADR 0025
made one send one composition however many arms it reaches, and two sends two compositions
*even when the words match*, because it is the two decisions and not the text that make
everything after them an uncontrolled comparison. The record already keeps them apart; the
page reads what the record says.

### Depth is tabs on one screen, and the header belongs to the screen

The results route owns the experiment and its evaluation, renders the header, the per-arm
summary, and the provenance strip, and hands the documents to whichever tab is open. The
execution timeline (ADR 0027) moves from its own page to the second tab and reads the
experiment from that layout instead of fetching it again.

The frame's reason is that depth must never lose run context, and there is a mechanical one
beside it: two tabs fetching the same two documents are two readings of one run, free to
disagree the moment one is reloaded and the other is not. Tabs are links rather than buttons
so a finding can be reopened and shared at the depth it was found.

The bench's "Execution timeline" action becomes "Results", and the timeline is reached
through it. That is a URL change to a surface this project shipped two slices ago and has no
external consumer; there is no redirect, deliberately, because a redirect would be a
compatibility layer for a link nobody has stored.

### The vocabulary and the matrix are shared rather than copied

Two kinds of thing move out of the pages. The *words* — the outcome marks, the agent-failure
and judge-failure tables, the sentence that names the judge behind a verdict, the
token/duration/cost formatters, and the write list — become one evidence module. The
*reading* — the objective matrix, the judge picker beside it, and the read that fills the
picker with the judges this lab has actually published — becomes components and a hook the
bench and the results screen both use.

A closed vocabulary the backend publishes should be rendered one way. Two copies of a failure
table are two chances for one screen to call an outage what another calls a refusal, and the
formatters carry decisions — a cost trimmed rather than parsed, a duration rounded once —
that are wrong the moment they are re-derived slightly differently somewhere else.

The matrix matters more than the words do. What it holds is the rule that a cell is paired to
its objective *by id* rather than by position, and the evidence sentence each cell carries; a
second copy free to pair differently would show one arm two different records, which is the
failure this whole slice is built to prevent. The one thing the two callers genuinely disagree
about is width — the bench renders it in a 320px column beside a running thread, the results
screen on a page where an objective's severity has room to be read — so that is the single
flag the component takes, and everything else about it is one implementation.

## Deliberately not here

- **A quantitative reading beyond ADR 0032's.** The Quantitative card renders exactly what
  the metrics document carries, absences included; the frame's latency p50 needs enough
  attempts to have a median, and ADR 0032 already recorded why it waits.
- **Notes, tags, replay, and fork.** Milestone 5's sixth outcome, together with state diffs
  and traces. Nothing here stores anything, so none of them is blocked by this shape.
- **The Traces and Code paths tabs.** Traces (frame 9b) and the code *excerpt* of frame 9c
  belong to the same later outcome; the code *locations* are already on the timeline tab
  (ADR 0027), which is where this slice leaves them.
- **An experiment-first history page.** Milestone 5's fifth outcome. The results screen is
  reached from the bench, which is how an operator reaches it today.
- **A comparison endpoint.** Considered and refused: the pairing is by objective id against
  documents the backend already serves in one order, and a second server-side reading of the
  same rows would be the disagreement this ADR exists to prevent.

## Verification

- Results tests (`Experiments.test.tsx`) cover the reading and the refusal: every objective
  read with one column per arm and the evidence sentence in each cell, each arm counted
  against what was decided *for it* — one arm 1/1 and the arm beside it 0/0, which is a
  denominator rather than a miss — the judge's rows kept off the deterministic card, a
  verdict naming its judge version, model, and attempt with "Score again" offered afterwards,
  a judge the lab could not reach reported as "no verdict" with the reason rather than left
  blank, a metered arm's numbers beside an unmeasured arm's "not reported", the turn one arm
  alone received marked as divergence and a controlled comparison read as controlled, each
  arm's writes read from its revisions with the scenario's fault beside the agent's tool, the
  open depth tab marked as the current page, and an experiment the lab cannot read reported
  with the backend's own reason and no tab behind it.
- Timeline tests cover the move: the timeline is a depth tab of the results screen, reached
  from the bench through it, with the header still naming the experiment across the tabs.
- The Playwright journey (`experiment-start.spec.ts`) now runs through the results screen on
  its way to the timeline: after driving both arms to the turn cap and scoring the judged
  row, it reads the read-check missed in one arm and pending in the other, the judged row's
  provenance on its own card, both arms' address writes as revisions, and the turn only one
  arm heard — then follows the same incident into the timeline tab.
