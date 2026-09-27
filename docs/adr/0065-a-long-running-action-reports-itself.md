# ADR 0065 — A long-running action reports itself

Status: accepted — 2026-09-27

Settles `docs/PLAN-UX.md` Slice 24: `form-decisions.md` 10.2, "the arms as a queue, each row
saying where it is", on the bench composer and on advance, score, replay, fork and freeze
(`Workspace.dc.html` :2396–:2560; `DEPRECADED/BenchLive.dc.html`, frame 8, and
`DEPRECADED/ExperimentResults.dc.html`, frame 9). It also does the two things ADR 0063 handed to
this slice — the publish gate's "Checking the draft…", and the focus a press loses when it goes
busy — and the one ADR 0063 handed to whichever slice next touched the starting-states page.

Records eight decisions, and four more from review: one component reports every long-running action, as a queue of arms
and a sentence, in a polite live region; the bench reads each arm back as it ends; an action the
lab does not report per arm says every arm is running; no Cancel is drawn and the absence is
said in the prototype's sentence; `aria-busy` goes on what is about to change and never on what
holds the report; a press in flight keeps focus; the publish gate says it is checking; and one
line beside Replay and Fork says what each is. Review added four: a derivation in flight holds
every run's Replay and Fork until it answers, while the results are open; each bench is its own page; the note is heard before
the press; and the arm's card takes focus once.

## Context

Every long-running action in the workspace reported itself by its button's label and nothing
else. The operator who sent a turn to two arms saw *Send as the customer* become *Running…* and,
a minute later, both threads change at once: which arm was being run, which was waiting, and
when the first had answered were not on the page. A press went natively `disabled`, so the
browser dropped focus to the page's body for as long as the action ran (Chromium does, measured:
the focused button is blurred the moment it is disabled, and `document.activeElement` is `body`
until something else takes focus).

### The actions, where they are, and how they report

Enumerated from every call of the five API functions that run a model or freeze state
(`advanceExperimentRun`, `scoreExperiment`, `replayExperiment`, `forkExperiment`,
`materializeSandboxSnapshot`) outside `src/api` and the tests. **None polls**: each is one
request the page awaits (the bench's send is one delivery, then one request per arm in turn),
and nothing in `apps/web/src` calls `setInterval` or re-reads on a timer. Line numbers are
`main` at b03a6b8, then this change.

| Action | Where | Before | After |
| --- | --- | --- | --- |
| Send a customer turn | `routes/ExperimentBenchPage.tsx:140` → `:180` | delivered, then each reached arm advanced in turn; the button read *Running…*; the record read once, at the end | the queue under the composer; each arm's card read back as that arm ends; the reached cards `aria-busy` while queued or running |
| Advance one arm (*Run the agent*, *Try again*) | `routes/ExperimentBenchPage.tsx:182` → `:262` | the pressed button *Running…*, natively disabled; the other arm's Run still pressable, which started a second loop | the same queue, of one arm; every Run held while any bench action runs; focus to the arm's card when its Run leaves because it answered |
| Score (bench) | `routes/ExperimentBenchPage.tsx:167` → `:224` | *Scoring…*, natively disabled | a queue under the judge picker; the matrix `aria-busy` |
| Score (results) | `routes/ExperimentResultsPage.tsx:83` → `:88` | *Scoring…*, natively disabled | the same, on the judge's card; its matrix and verdicts `aria-busy` |
| Replay (results header) | `routes/ExperimentResultsLayout.tsx:100` → `:113` | *Deriving…*, natively disabled; navigates when answered | *Replaying…*, held with focus; a queue under the header; navigates when answered |
| Fork (results, *Fork this run*) | `routes/ExperimentResultsLayout.tsx:119` → `:135` | *Deriving…*, natively disabled | *Forking…*, held with focus; the same queue, each arm at the version chosen |
| Replay, fork (history row) | `routes/ExperimentHistoryPage.tsx:135`, `:165` → `:162`, `:197` | both of the row's buttons *Deriving…*; other rows' still pressable | the pressed one *Replaying…* or *Forking…*, held with focus; every other row's pair disabled; one queue above the table naming the run |
| Freeze (*Materialize snapshot*) | `routes/SnapshotsPage.tsx:105` → `:120` | *Freezing…*, natively disabled; a cleared seed refused by an alert after the press | *Freezing…*, held with focus; a sentence under the form; the snapshot list `aria-busy`; a cleared seed refused before the press |

Not in the slice and not changed beyond the primitive: Start (it freezes and clones but runs no
arm; it navigates when answered), *Clone sandbox* (refused before the press, below), and Save
and Discard in an editor's header (below).

## Decision

### One component reports every long-running action

`components/ActionStatus.tsx` draws a queue — one row per arm: its name, what it runs, where it
stands — and one sentence under it; `lib/actionStatus.ts` computes both, one function per action
(`benchReport`, `scoreReport`, `derivationReport`, `freezeReport`). The rows and the sentence are
one `role="status"` region, `aria-atomic`, **mounted whether or not anything runs**, so an
assistive technology is already watching it when a press starts. It is polite, never an alert. It
speaks when its text changes and at no other time: nothing polls, and React leaves an unchanged
text node alone, so a record read back with nothing new in it announces nothing.

**Where an arm can stand is a closed set of twelve**, each with the word its row reads and the
phrase the settled sentence uses (`ARM_PROGRESS`):

| State | Row | Sentence | Card busy |
| --- | --- | --- | --- |
| `queued` | waiting to run | is waiting to run | yes |
| `running` | running… | is running | yes |
| `scoring` | being scored… | is being scored | yes |
| `not_sent` | not sent this turn | was not sent this turn | no |
| `completed_earlier` | completed earlier | completed earlier | no |
| `could_not_run` | could not be run | could not be run | no |
| `awaiting_customer` | waiting for the customer | is waiting for the customer | no |
| `awaiting_agent` | waiting for the agent | is waiting for the agent | no |
| `awaiting_retry` | no reply — waiting for a retry | produced no reply and is waiting for a retry | no |
| `completed` | completed | has completed | no |
| `scored` | scored | has been scored | no |
| `unscored` | no verdict from the judge | has no verdict from the judge | no |

"running…" and "completed earlier" are the prototype's rows (:2540–:2541), and a settled queue
reads as its live card does: "Arm A is waiting for the customer · Arm B has completed" (:2396).
The four `awaiting_*` and `completed` are the arm's served standing (ADR 0029), never a count
kept here.

**The states each action passes through:**

- **Send** — delivering (every reached arm `queued`; "Sending the customer's message to 2
  arms."), then each reached arm `running` in turn with the rest `queued` ("1 of 2 running."),
  an ended arm at its standing or `could_not_run`, and an arm not reached `completed_earlier` or
  `not_sent`; settled, every arm at its standing (or `could_not_run`), in one sentence.
- **Advance** — the same, with one arm reached and nothing delivered.
- **Score** — every arm `scoring` ("2 of 2 being scored."); settled, each `scored` where the
  judge gave every row it owns a verdict, `unscored` where a row's judgement failed or is
  missing.
- **Replay, fork** — every derived arm `running` ("Replaying this run: 2 of 2 running."); the
  answer is a different run, which opens, so there is no settled queue on this page. A refused
  derivation clears the queue and says why in the page's alert.
- **Freeze** — no arm, so no queue: "Freezing v2 at seed 20260825.", then "Froze v2 at seed
  20260825 as 0123456789ab….".

### The bench reads each arm back as it ends

The send already advanced the arms one after another, which is what makes the queue a fact
rather than a guess: the arm being advanced is the one running. What changes is when the record
is read: after the delivery (the message is in both threads before either answers) and after each
arm, rather than once at the end. So an arm's answer is on its card while the next arm runs, and
its row says where it now stands — the page changes as each arm does, not only when the last
one has.

### An action the lab does not report per arm says every arm is running

A scoring pass, a replay and a fork are one request each, and the lab answers about every arm
at once. The queue says every arm is running until the answer, rather than inventing an order
the lab never reported. Freezing touches no arm, and draws a sentence without a queue.

### No Cancel, and the absence said

The prototype draws no Cancel and says why beside the queue: "This can take a minute and cannot
be cancelled." (:2543). That is the reading of the plan's "no cancel stated as such": the
absence is stated in words, not left to be inferred from a missing button. It is true here —
none of these routes has a cancellation, and a request the page abandoned would run to the end
anyway. The sentence is a note outside the live region, shown while the action runs and named by
the pressed button's description, so it is read by whoever reaches it rather than repeated with
every row. A replay or a fork adds "If you are still here when its arms are done, the new run opens;
History lists it either way."; freezing calls no
model and says only "This cannot be cancelled."

### `aria-busy` goes on what is about to change, never on what holds the report

An assistive technology holds back what a busy region says until it is no longer busy, so a
card holding the queue is never marked busy — that would silence the queue for exactly as long
as it has something to say. `Card` takes `busy`:

- the bench: each arm's card while its row is `queued` or `running`; never the composer;
- scoring: the matrix (the bench) or the matrix and verdicts (the results), never the card that
  holds the judge picker and its queue;
- freezing: the snapshot list the new snapshot joins;
- replay and fork: nothing — nothing on the page changes, because the answer is another run.

### A press in flight keeps focus

ADR 0063 kept native `disabled` for a press in flight and left the focus it drops to this slice.
**A press in flight is now `aria-disabled`, never `disabled`**: `PrimaryAction`'s `busy`, and
`BusyButton` for the secondary controls that run long (*Run the agent*, *Try again*, *Score*,
*Replay*, a history row's two). Both swallow the activation while busy, as a refused action
does, keep the faded weight — the button table fades `aria-disabled` exactly as it fades
`disabled` — and win over a refusal that arrives meanwhile. The reader who pressed stays on the
control while it runs and is still on it when it comes back. Every other busy primary action —
Create, Publish, Start, the connection's Save and Test — gains the same by the same component.

Where the control does not come back because the press succeeded — a Run leaves once its arm
has answered, since nothing is left to run — focus goes to that arm's card, where the answer
arrived, rather than to the page's body. A replay and a fork navigate; the new page is where the
reader is.

### A derivation in flight holds every run's Replay and Fork until it answers, while the results are open

The results layout stays mounted across a move between runs — a derived run's provenance link
leads to the run it came from — so a derivation is kept with the run it was pressed on, and a
move between runs never drops it: while it runs, Replay and Fork are held on whichever run is
read, and the queue names the run it was pressed on. On its own run the pressed control is busy.
On any other run Replay is natively disabled, as a history row's pair is while another row's
derivation runs, and *Fork this run* is busy (`aria-disabled`), as it is on its own run.

Its answer is read against where the operator is when it arrives. On the run it was pressed on,
it opens the new run or says in the page's alert why the lab refused. On any other run it takes
nobody off the page they chose: the queue says "The replay of … is ready: …." with *Open the new
run*, or "… could not be run: …", and that settled line goes with the next move.

**The hold lasts only while the results layout is mounted.** An operator who leaves the results
altogether — for the bench, History, or any other page — while a derivation runs takes the hold
with them: coming back, Replay and Fork are free, so a second derivation of the same run is
possible, as it was on `main`. The first one's answer then opens nothing and says nothing, where
`main` still navigated to it from wherever the operator had gone. The derived run is made all the
same, and History lists it. The note says as much before the press: "If you are still here when
its arms are done, the new run opens; History lists it either way."

**A history row's derivation keeps `main`'s behaviour, deliberately.** Its answer navigates to the
new run from `ExperimentHistoryPage`, and React Router 7's `navigate` still fires after that page
has unmounted — so an operator who pressed a row's Replay and then opened some results can be
taken to the new run from there, as on `main`. The history page holds nothing that outlives it
to say the answer in instead, and the note's "if you are still here" stays true where it is
conservative; aligning the two is a change for the slice that next touches History.

### Each bench is its own page

`ExperimentBenchRoute` keys the bench by its shop and experiment, as `CustomerEditorRoute` keys a
profile, so a move from one bench to another unmounts the first: a turn still running there reads
its record and reports its queue into nothing, never into the next bench.

### The note is heard before the press

The note is mounted before the action runs, `sr-only` until it does, and the control that starts
the action names it from the start — Send, every Run, Score, Replay, *Fork this run*, a history
row's pair, *Materialize snapshot* — because it is as true before the press as during it, and a
description added to a control that already has focus is not announced again.

### The arm's card takes focus once

Where a Run leaves because its arm answered, the card is given `tabindex="-1"` for the hand-off
only, and loses it when focus leaves; a card that stayed focusable would take focus from any
click inside it. The browser's own focus outline marks it while it has focus.

### The publish gate says it is checking

`useDefinitionEditor` gains `checking`: the gate on screen is not the answer for the draft the
lab holds — before its first answer, and from a save's write landing (or a discard starting) until
the gate answers for it. It is not checking while a save's write is in flight (the lab still holds
what the gate answered for), after a save the lab refused, or after a load that failed.
Meanwhile `PublishReasons` says "Checking the draft…" in place of the reasons it last gave, which
were about the draft before, and `PublishButton` is a press in flight described by that line. It
is every publish gate — the overview's two and the seven editors' — because the gate is one
component; the plan named the overview, where the state was reachable through the header's Save.

### One line beside Replay and Fork

Under the results header: "Replay runs this incident again as it was recorded; Fork runs it
again with the arms you choose." Both buttons are described by it, Replay first and then, where
it applies, by the reach line ADR 0053 put beside it — which says why this lab cannot run an arm,
while this says what the two derivations are, so the two lines never disagree. The prototype's
"Replay reproduces this exactly" is not written: a replay re-runs its arms against their models,
and a model arm does not reproduce its answer exactly.

### And the refusals ADR 0063 left to this page

*Materialize snapshot* and *Clone sandbox* move to `PrimaryAction`: a cleared seed and an empty
arm label are refused before the press, in the sentences the handlers already raised, and the
handlers keep their checks for a submission that arrives without the press.

## Deliberately not here

- **Progress from the lab.** No route reports an arm's progress during a request, and a polling
  or streaming contract is a backend change this plan rules out; the queue reports what the page
  knows.
- **A Cancel.** Nothing can be cancelled.
- **The bench index's *Live now* card.** `ExperimentSummarySchema` carries no status; the
  departure recorded for "or open the live one →" stands.
- **An editor's Save and Discard.** They keep native `disabled` while saving, and Save leaves
  the page once the draft is saved, replaced by "All changes saved"; where focus goes then is a
  question about that header, not about a long-running action.
- **Start.** It runs no arm, answers by navigating, and gains focus retention through
  `PrimaryAction` alone.

## Consequences

- `docs/design-direction.md`: *A blocked primary action says why* reads that a press in flight is
  `aria-disabled` and keeps focus, and the publish gate says "Checking the draft…"; *The form
  language* gains *A long-running action reports itself*; *Departures* records the queue's rows
  and the line beside Replay and Fork.
- `test/refused.ts` gains `expectBusy`: `aria-disabled`, no `disabled`, no `title`, and focusable.
  The assertions that read a press in flight as `toBeDisabled` are rewritten against it.
- Playwright `experiment-start` asserts the queue after each send and the scoring pass, and that
  *Send as the customer* still holds focus after a two-arm send.

## Verification

- `lib/actionStatus.test.ts`: the twelve states and their words, written out; `standingProgress`
  over every awaiting and 0–2 attempts; the bench's queue over all 256 cases two arms can be in
  (4 × 4 standings, every non-empty set of arms reached, delivering, each arm running with every
  subset of the ones before it failed, and settled with every subset failed); the slice's
  evidence as a sequence of reports; the scoring pass over seven combinations of verdicts; the
  derivation and freeze sentences.
- `ActionStatus.test.tsx`: the region is polite, atomic and present while empty; rows and
  sentence; the note outside the region, describing the press, and no Cancel; a re-render with
  the same queue mutates nothing in the region, and a moved arm does.
- `Experiments.test.tsx`, *a long-running action on the bench reports itself* — the slice's
  evidence: a turn sent to two arms, with each advance held, reads Arm A running and Arm B
  waiting, then Arm A's answer on its card and Arm B running, then both done in one sentence,
  with each card busy exactly while it is queued or running, the composer never busy, and the
  press holding focus throughout. Also the arm not reached, the arm completed earlier, a Run's
  focus handed to its arm, a refused Run brought back with focus, and scoring on the bench and
  the results. *…on the results reports itself*: the line beside Replay and Fork; a replay and a
  fork held, their queues, their notes, and a refused replay brought back with focus.
  `History.test.tsx`: a row's replay and fork, their queue above the table, the other rows held.
  `Snapshots.test.tsx`: freezing, and the two refusals before the press.
  `lib/definitionEditor.test.tsx`: every moment `checking` is true and false.
  `ShopHome.test.tsx`: "Checking the draft…" after the overview's Save, until the gate answers.
  `WorkspaceChrome.test.tsx`, `PrimaryAction.test.tsx`, `lib/ui.test.ts`: the gate's line, the
  busy press and `BusyButton`, and the fade.
- Every busy primary action a second press could reach twice — Create (the new-customer page),
  Publish (the support-identity editor), *Materialize snapshot*, *Clone sandbox*, *Attach to this
  shop*, *Add note*, *Fork this run*, *Save and leave* — is pressed again, by a click and a key,
  while its request is held, and sends one request. `Experiments.test.tsx` holds a replay across a
  move to its source run and back, a refused one answered away from its run, and an answer after
  the operator left the results; a move from one bench to another with a run held.
- A second press on a busy secondary control — a history row's Replay and its Fork, Score on the
  bench and on the results, Replay on its own run — sends nothing, and *Add note* and *Add tag*
  refuse a second write in their handlers too.
- Mutation: 48 mutations of the states, the transitions, the live region, `aria-busy`, focus and
  `checking`, each applied alone and each failing at least one test, and 12 more for the review's findings
  (a derivation dropped on a move, opened over another run, answered after leaving, Replay or
  Fork freed on another run, the bench unkeyed, the note absent before the press or named only
  while running, the card focusable before or after the hand-off, and the busy swallow removed,
  which fails the eight callers' tests), and 3 more (`BusyButton`'s swallow removed, which fails
  each of the five secondary controls' tests, and either annotation handler's guard removed); and,
  in Chromium, a busy
  press made natively disabled again fails `experiment-start` on the focus assertion.

## Migration

None. No contract, payload, route or stored value changes; accessible names are unchanged, except
the busy labels *Deriving…*, which become *Replaying…* and *Forking…*, and which no spec reached.
