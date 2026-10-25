# ADR 0030 — Judging an arm against its objectives, and the cap that ends it

Status: accepted — 2026-09-01

Opens `docs/PLAN.md` Milestone 5 with its first outcome's deterministic half, and closes
Milestone 4's completion gap. Records the outcome an objective can be in and why "not yet" is
one of them, the declared table of evidence this build reads, the polarity that decides what a
reading means and how several of them combine, the turn cap as the half of a scenario's
completion conditions a runtime can decide, and the objectives matrix the bench reads it all
back through.

## Context

A scenario has said what it wants since ADR 0017 published the objective template and
ADR 0018 let a recipe bind one to its own objects with a severity. Nothing read it. An arm
could resolve the incident or ignore it and the record said the same thing either way: here
are the calls, here is the reply, work it out.

Everything needed to work it out is already recorded. ADR 0026 made every tool call an event
of the call path, holding the `tool-result-v1` document the tool answered with and the
revisions it moved. ADR 0020 gave each arm a sandbox that starts as a copy of one frozen
snapshot, so "what changed in this arm" is a comparison of two documents the lab owns. What
was missing is the reading.

Two things pushed it to now. Milestone 4's last outcome asks for completion to be covered,
and ADR 0029 could not answer it: it left `ArmAwaiting` at two values and said plainly that a
third would be a completion claim nothing was entitled to make. And `CompletionConditions`
has carried a `max_turns` since ADR 0012 that nothing enforced — a cap authored, published,
frozen into every snapshot, and then ignored, so the guarantee that a run terminates was a
guarantee on paper.

## Decision

### An objective has five outcomes, and three of them are not verdicts

`ObjectiveOutcome` is `met`, `missed`, `pending`, `deferred`, `undecidable`.

`pending` exists because deterministic evidence is monotone. An arm that has not read the
policy document may read it on its next turn; reporting that as a miss would be reporting the
present as final. So an unmet objective is pending while the arm can still act, and becomes a
miss only when it cannot. A forbidden objective inverts exactly this and nothing else: the
moment the thing occurs it is missed, because no later turn can unmake it.

`deferred` and `undecidable` exist because the lab's own limits must not read as the agent's.
An objective a judge scores is deferred until there is a judge; one whose evidence this build
does not read says so. Counting either as a miss would put the arm on the wrong side of a
line the arm never crossed, and both are rows the operator can see, in the arm's own column.

`met` and `missed` are the only outcomes a count is over. `decided` is therefore smaller than
the objective list whenever a judge or an unread kind of evidence owns a row, and "2 of 3
met" never silently means "one of them is not a question we asked".

### The evidence kind says where to look; the polarity says what an answer means

`EVALUABLE_OBJECTIVES` declares which of `ObjectiveEvidence`'s kinds this build reads, and
with what polarity: `event` and `state` must occur, `forbidden` must not. `forbidden` shares
every reader with the other two, because it differs from them in what an answer *means*
rather than in how it is found. A second set of "never" readers would have been two
implementations of one question, free to disagree the day a tool's result shape moves.

`policy` and `dimension` are absent, in the same spirit as ADR 0028's `APPLIABLE_MUTATIONS`:
a kind is in the table because there is code that reads it and tests that keep reading it. A
policy objective is an encoded rule and this lab publishes no rule registry for a template to
name — writing one rule per scenario in Python would put the recipe back into the code the
Studio exists to replace. A dimension is a judge's, and a judge is versioned, anonymized, and
rerunnable, which is a slice of its own.

### An objective this build cannot decide is reported, never refused

ADR 0028 refuses to *start* an experiment whose fault this build cannot fire, because a fault
that never fires is invisible: the evidence would read as "the fault changed nothing", which
is the one thing it must never mean. An objective is the opposite — it has a row of its own,
in every arm's column, and that row can say "a judge scores this" or "no evidence this build
reads decides this". Refusing to start an experiment because one objective awaits the judge
slice would make the block library unusable for exactly the scenarios it was authored for.

### What a binding names is read from the record, not from the words

Four readers, one per binding kind, keyed by `BlockParameterKind`: a document is read by the
call that answered with it, an entity by the call that answered with it, a tool by any answer
it gave, and a data reference by comparing the field against the starting state the snapshot
froze. Nothing reads a message body. Whether an agent *said* it read the policy is not
evidence that it did, and the read-check's whole point (ADR 0017) is that the evidence is the
recorded event.

Two rules fall out of that. **A refusal is not a reading**: ADR 0021 made a refusal a value
rather than an error, and a refused call told the agent nothing about the world, so an
objective reads what the agent obtained. And **state is judged against the starting state,
never against an expected value**: a template that asserted a particular value would be
naming one shop's data inside a shop-independent library, which is the one thing a template
may never do.

Every binding a kind can be read from is read, and how several of them combine follows the
polarity — because "and" inverts to "or". An objective naming two documents asks for **both**,
and meeting half of it is not meeting it; an objective forbidding two documents is violated by
**either**, and reading that pair conjunctively would let an arm touch one of two things it
was told never to touch and be reported as having kept the rule. This is the one place the two
polarities are not the same code path, and the only asymmetry between them.

### The turn cap is the completion this build decides

`CompletionConditions` has two halves that answer different questions, and only one of them
is a number a runtime can count. `max_turns` now bounds the run: `stand_arm` takes it, an arm
that has answered the last turn its scenario allows is `ArmAwaiting.COMPLETED`, and
delivering another customer turn to it is refused rather than warned about — an arm allowed
one turn past the cap would be answering a longer conversation than the arm beside it, and
the two would no longer be comparable.

The completion *statement* is untouched. It is prose about whether the incident was actually
resolved, which is a judge's reading, and a runtime that scored it would be guessing.

An arm at its cap that still owes a reply is not completed: it waits for its agent, because
running out of turns does not excuse the last one. So `awaiting != agent` still implies an
answered latest turn, which is what lets the runner keep one branch.

The cap is read from the scenario version the experiment pinned, through the snapshot, like
every other resolution in the runner and the service. A cap that moved when an author
republished would change what a running arm may still do.

### The standing is still one reading

ADR 0029's rule holds: the runner and the bench read the same `stand_arm`, so a button never
offers a run the backend would decline and a composer never offers an arm the backend would
refuse. Both callers therefore resolve the cap — the alternative, giving only the read side
the cap, would have left the runner and the bench describing the same arm two ways.

### The evaluation is a projection, served apart from the record

`ExperimentEvaluationService` holds `ExperimentService` and the objective library, exactly as
ADR 0027's timeline holds the experiment service: everything it judges is what `getExperiment`
already serves, so an evaluation cannot describe an arm differently from its thread. The
templates are the one extra read, resolved at the versions the scenario's publication pinned
— an objective edited and republished afterwards must not rejudge an experiment already run.

Nothing is stored. An outcome is a function of a record that only grows, so a stored copy
would be ADR 0026's refused confirmation record one level up: a second writer of a fact the
events already hold.

## Deliberately not here

- **A judge.** `deferred` is the row it will fill. Anonymization, rubric versioning, and
  rerun semantics are Milestone 5's next outcome.
- **Quantitative metrics.** Turns, tokens, and cost are frame 9's, and are observations
  rather than outcomes; mixing them into this table would invite a total.
- **A global score.** The matrix reports objectives; it never adds them up across arms.
  `met` and `decided` are per arm and per objective, deliberately.
- **Finishing or pausing an experiment by hand.** Frame 8's top-bar controls are lifecycle,
  and ADR 0029's reasoning has not changed. The cap ends an arm because the scenario said so,
  which is a fact about the recipe rather than about the operator.
- **Evaluating a `policy` objective.** It needs a registry of named, versioned rules a
  template can bind — its own slice, and one that has to answer how a rule stays
  shop-independent.
- **Judging the customer's words.** No reader touches a message body, here or later:
  deterministic evidence is what the record holds, and what an agent said about what it did is
  a judge's material.

## Verification

- Domain tests (`test_evaluation.py`, `test_experiment_domain.py`) cover each polarity's four
  cases, the arm completed at its cap, the arm at its cap that still owes a reply, and the
  trigger counting as turn zero so a one-turn cap still allows one driven turn.
- Table sweeps (`test_evaluation.py`) assert that every evidence kind this build reads is
  deterministic and has a reader, that `policy` and `dimension` are absent, that a forbidden
  objective reads everything the others do, that every order field `DATA_FIELDS` offers is
  readable, and that every entity kind names the tool that reads it — so a field or a kind
  added to the scenario grammar joins this sweep the day it is declared (ADR 0023).
- Reader tests cover the call that answered with the document, the call that answered with
  another, the refusal that is not a reading, an entity read, a tool answer, a field compared
  against the starting state, a forbidden objective failing on the very reading a required
  one passes on, the judge row, the unread evidence kind, the field of something no arm can
  move, an instance binding nothing readable, a template bound twice needing both, and the
  forbidden template bound twice violated by either — the last asserted to fail against
  conjunctive aggregation, so the De Morgan rule above is held by a test rather than by this
  paragraph.
- Application tests drive a real experiment: the control arm's calls meet what it did and
  leave the document read pending, the arm beside it is judged on its own record, the cap
  settles what was pending into a miss, an `expected` miss does not fail the arm, a completed
  arm refuses another customer turn, and both the objective templates and the cap are read at
  the versions the experiment pinned rather than as they read now.
- Contract tests (`test_experiment_api.py`) cover the evaluation endpoint's shape, the arm
  driven past its cap settling what it never did, and the completed arm's refusal carrying its
  own code. What that refusal counts is turns *received*, and it says so: an arm holding its
  last allowed turn is closed to another one whether or not it has answered that one, and a
  message claiming it answered would be a claim about the agent.
- Frontend tests (`Experiments.test.tsx`) cover the matrix per arm, an objective met in one
  arm alone by the call that answered it, the judge's own row, and the completed arm whose
  pending row became a miss and whose composer checkbox is disabled.
- The Playwright journey (`experiment-start.spec.ts`) is extended rather than duplicated, for
  the reason ADR 0026 to ADR 0029 gave: the scenario is published with a two-turn cap, the
  matrix reads pending while the arm can still act, and after the arm answers the last turn it
  is allowed the read-check it never did is a miss, the arm is completed, and nothing offers
  to run or message it again.

## Migration

None. No table is created, no column is added, no fingerprint moves, and no published
definition is touched. `ArmAwaiting` gains a value that only ever appears for an arm at its
scenario's cap, which no experiment could previously reach because nothing enforced one.

## Amendment — 2026-10-25: a verdict names the call that decided it

The matrix said *which* call answered a row only in a sentence ("support.read_document answered
policy:address-change"), and a timeline entry carries no arguments (ADR 0027), so nothing on
screen could point at the one event a verdict rests on without guessing — two reads of the
same tool are two entries, and only one of them is the evidence. The reader already held that
call and discarded it. Milestone 12's evidence links into the timeline needed it,
and the operator chose on 2026-10-25 to serve it rather than have the client match on a tool
name.

- **An objective result carries `decided_by`**, optional and nullable in the contract
  (`DecidingCallSchema`: `ordinal`, `attempt`, `sequence`). It is the coordinate the record
  already keys a tool call by within its arm — the primary key of `experiment_tool_events`
  under the arm's `run_id`, and the coordinate the arm's `tool_call` timeline entry carries —
  so it addresses exactly one event, is stable for as long as the record is, and needs no
  identifier of its own. The arm is the `ArmEvaluation`'s `run_id`.
- **A call decides two verdicts and no others.** A requirement met is decided by the *last*
  reading that completed it (until then it was pending); a prohibition broken by the *first*
  call that broke it (nothing later could unmake the miss). A single reading names the first
  answer that matched, in the arm's own order — the one the reader stops at — and a refused
  call is never a reading, so it never decides.
- **Every other row carries `null`, never a guess.** A requirement missed or a prohibition
  kept is an absence; a pending or undecidable row is not a verdict; a judged row was decided
  by a judge reading the whole thread (ADR 0031); and a field that moved from its starting
  value is a difference between two states. The record keeps a sandbox's current state and its
  starting state but not the state at each revision, so it cannot say whether the agent's
  write or the scenario's fault moved a given field — a state row therefore names no event,
  and a forbidden row broken by both a call and a moved field names none either, because
  ordering the call against the state change would be a guess. The domain refuses a deciding
  call on any row that is not a verdict the rules reached.
- **Nothing is stored and nothing migrates.** The evaluation is still a projection read on
  every request ("The evaluation is a projection, served apart from the record" above), so
  every experiment already recorded gains the field on its next read. A client that predates
  it reads the same response it did; the field is additive.

The results matrices draw a line with a deciding call as a link to that event on the
execution timeline, which addresses each event by the same coordinate; a line without one is
text. Tests: `test_evaluation.py` (each evidence kind, a document read twice, a refused read
before an answered one, the required and forbidden pairs, a miss, pending, undecidable, judged
and state rows, the domain's refusal, and a real experiment's entity read),
`test_experiment_api.py` (the deciding call is the arm's own `tool_call` timeline entry), and
`Experiments.test.tsx` (the link, its absence, and the landing).
