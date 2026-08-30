# ADR 0029 — Coming back to an experiment, and where each arm stands

Status: accepted — 2026-08-30

Completes `docs/PLAN.md` Milestone 4's last outcome for resume: an operator who leaves an
experiment finds it exactly where it stood. Records that resume has no mechanism of its own,
the arm standing read from the record rather than stored beside it, the two things an arm can
be waiting for and the third value deliberately absent, the passed-over turn made visible,
and the single reading the runner and the bench now share.

## Context

Everything an experiment is, is already written down. ADR 0025 wrote the customer's side of
both threads, ADR 0026 the agent's attempts and every call they made, ADR 0028 the faults the
scenario fired, and ADR 0027 read all of it back as one stream. An advance is one request in
one transaction, so a process that dies mid-attempt leaves the arm where it was rather than
half-moved.

So resume is not a missing capability. What was missing is the reading that makes it usable.
Three places had each worked out for themselves what an arm was waiting for: the runner, to
decide whether an advance answers or returns; the bench, to decide whether to draw a button;
and an operator, by scanning two transcripts for a gap. Three derivations of one rule agree
until one of them is edited, and the third one — the human — was doing it worst: an arm that
had never been run and an arm that had answered looked identical apart from the presence of a
reply, and a question the arm passed over looked like a rendering bug.

Milestone 4's outcome asks for resume to be *covered*, and there was nothing to point a test
at that was not a re-derivation of the same rule inside the test.

## Decision

### Resume is a read, and nothing else

There is no resume operation, no session, no run status, and no recovery path. Reopening an
experiment is `getExperiment`, and continuing it is the advance and the delivery that were
already there. The tests are what say so: an experiment driven in one process is read back
and advanced through a second connection to the same database, and the arm answers the turn
it was left on rather than starting over.

Naming this explicitly matters because the alternative is tempting and wrong. A "resume"
endpoint, or a status column set when an operator opens a bench, would make the record depend
on someone having visited it — and an experiment nobody reopened would then be a different
experiment from one somebody did.

### An arm's standing is derived, never stored

`stand_arm` lives in the domain and takes one arm's participant turns and its agent turns. It
answers with an `ArmStanding`: what the arm is waiting for, the ordinal it stands on, how many
attempts that turn has already had, and how many earlier turns it never answered.

Derived rather than stored, for ADR 0026's reason applied one level further: "this arm has not
answered yet" is a question about the record rather than a status somebody has to remember to
set. A column would be a second writer of a fact the two streams already hold, and every path
that appends a turn would become a path that can forget to update it.

It is computed once and served, rather than left to each client. The runner reads it to decide
what an advance does and `ExperimentDetail` carries it to the bench, so a "Run the agent"
button exists exactly where the backend would run one. A client deriving it again would be
free to offer a click the backend answers by returning a reply it already had.

### An arm waits for its agent or for the customer, and for nothing else

`ArmAwaiting` has two values because the bench offers two moves: run the agent, or write the
customer's next message. A retry is not a third value — an arm waiting for its agent with
`attempts` above zero is one whose attempts all failed, and the failures themselves are in the
attempts the thread already renders. Adding a `retry` value would put the same fact in two
places and invite them to disagree.

A "completed" value is deliberately absent. Completion is judged against the scenario's
completion conditions by an evaluation this build does not have (`docs/PLAN.md` Milestone 5),
and frame 8's "Completed" chip is that judgment rendered. A status set by hand here — by an
operator's button, or by the runner guessing from a reply — would be answering the evaluation's
question with an assertion, and every later comparison would read it as evidence.

### The turn an arm passed over is reported rather than left to be noticed

ADR 0026 decided that an arm answers the last customer turn it received rather than the first
it never answered: a reply to a question the customer has already moved on from would be
answering the wrong thread, and the skipped turn stays in the history, unanswered, because
that is what happened.

Read back on a bench, that decision looked like a bug — a customer bubble with nothing under
it and no way to run the arm on it. So the standing **names** those turns and the thread labels
each one. The behavior is unchanged; what changes is that the record now says out loud what it
had only implied. This is the case an operator resuming is most likely to meet and least likely
to reconstruct, because the gap is behind the turn they are looking at.

The ordinals rather than a count of them, deliberately. A client has to label the turns
themselves, so handed only a number it would work out *which* turns those were by reading the
two streams again — the second derivation this whole type exists to remove, and one free to
disagree with the sentence printed above the same thread. How many there are is the length of
what is served. The wire cost is a short list of small integers per arm, which is not a reason
to make a client re-derive a rule.

### The experiment listing is not where this belongs

A shop's experiment listing keeps saying what it said: a label, a starting-state fingerprint,
and when it was started. Standing is not added to it, although "which of these is waiting for
me" is a fair question — answering it means reading every arm's turns for every experiment in
the shop, and the surface that asks it is frame 10's History, which Milestone 5 owns. Putting a
half version of it on the setup page now would be the surface Milestone 5 has to remove.

## Deliberately not here

- **A run status column.** See above: a second writer of a fact the streams already hold.
- **Completion.** Milestone 5 judges it against the scenario's conditions.
- **Pausing and finishing an experiment.** Frame 8's top-bar controls are lifecycle, and an
  experiment has no lifecycle in this build — it is started, and it is driven until the
  operator stops driving it. A pause that only meant "nobody is advancing this" would be a
  fact about the operator recorded as a fact about the arm.
- **Recovering an interrupted attempt.** An advance is one transaction, so there is nothing
  half-written to recover. The day a runtime streams its answer, this becomes a real question
  and gets its own slice.
- **Standing in the timeline.** The timeline is what happened; a standing is what has not
  happened yet, and an entry for it would be an entry with no event behind it.

## Verification

- Domain tests (`test_experiment_domain.py`) cover the opened arm waiting for its agent, the
  answered arm waiting for the customer, the failed attempts that leave the arm still owing an
  answer and are counted, the arm standing on the last turn it received rather than the first
  it never answered, the passed-over turn still counted after a later one is answered, an
  attempt at an older turn that is not an attempt at this one, and the arm that was never
  opened having no standing at all.
- Runner tests (`test_experiment_runs.py`) cover the standings of a freshly started
  experiment and of one arm advanced beside another, the failed attempt reported as a retry
  owed, the passed-over turn reported where an operator reads it, and — through a second
  session opened on the same database — an experiment left mid-incident picked up from the
  record alone, with the arm that was owed an answer answering the turn it was left on and a
  failed attempt retried rather than repeated.
- Contract tests (`test_experiment_api.py`) cover every arm saying what it is waiting for, the
  reopened experiment naming which arm is still owed, and the turn sent before the agent ran
  leaving the earlier one unanswered.
- Frontend tests (`Experiments.test.tsx`) cover each arm saying what it waits for and the
  answered arm being offered no button, the failed attempt offering a retry, and an experiment
  reopened where it stood with the question one arm never answered labelled in its thread —
  labelled by membership in the ordinals the standing named, so the bench keeps no copy of the
  rule.
- The Playwright journey (`experiment-start.spec.ts`) is extended rather than duplicated, for
  the reason ADR 0026 and ADR 0027 gave: an experiment is one story. Having run one arm, the
  operator reloads the browser, leaves for the bench index, returns through the shop's
  experiment list, and finds both threads as they stood — the answered arm's reply, its calls
  and the fault that fired among them, and the arm that was never run still the one the bench
  offers to run.

## Migration

None. No table is created, no column is added, no fingerprint moves, and no published
definition is touched. `getExperiment` gains one object on each arm.
