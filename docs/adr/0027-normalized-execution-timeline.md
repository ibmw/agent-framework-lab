# ADR 0027 — The normalized execution timeline, and where the lab's own code ran

Status: accepted — 2026-08-29

Implements `docs/PLAN.md` Milestone 4's fifth outcome: normalized execution timelines and
project-owned source locations where available. Records the timeline as a projection rather
than a record, the composition as the coordinate two arms share, the refusal that is not an
error, the location resolved from the tool registry rather than from a map somebody keeps,
and the rule that a timeline entry never carries a word anyone said.

## Context

ADR 0025 wrote the customer's side of both threads and ADR 0026 the agent's. Each was keyed
the way its own writer needed: a participant turn by the arm and its ordinal, an agent turn
by the customer turn it answers and the attempt, a tool event by the attempt and the sequence
inside it. Read back through `getExperiment`, they are three listings, and any client that
wanted to see *what happened* had to interleave them itself.

That is not a rendering detail. Milestone 4's fourth acceptance criterion is that a
framework-specific event never leaks into the shared evidence contract; a client stitching
three streams together is exactly where a framework's own idea of a "step" or a "round" would
be reintroduced, one consumer at a time. The interleaving has to happen once, in the lab's
words, and be published.

Everything it needs is already recorded. Nothing here adds a column, a table, or a write.

## Decision

### A timeline is a reading, not a record

`GET /shops/{shop_id}/experiments/{experiment_id}/timeline` projects its entries from the
participant turns, agent turns, and tool events `getExperiment` already serves. There is no
`experiment_timeline` table and no migration.

The reason is ADR 0026's: a second stored shape is a second chance to disagree with the
first. That ADR refused a confirmation record because the confirmation is inside the document
the proposal answered with, and refused a state-change table because the state change is the
pair of revisions the tool event carries. A stored timeline would have been the same mistake
one level up — a record of the records, drifting the first time a writer changed and the
projector did not.

`ExperimentTimelineService` therefore holds no repository. It reads one `ExperimentDetail`
and normalizes it, which is what makes "the timeline disagrees with the thread" a state the
code cannot reach.

### The composition is the coordinate two arms share

An ordinal counts *one arm's* turns, and ADR 0025 made arms independently drivable: one may
be driven twice while the other waits, so the same customer message can be turn 3 in one arm
and turn 2 in the other. Keyed on the ordinal, a timeline would show one message as two
different moments in the incident.

What both arms genuinely share is the composition — one delivery, one `turn_id`, however many
arms it reached. So every entry carries a `step`, which is the composition it belongs to,
counted from the start of the experiment, and a composition is rendered as **one** entry
naming the arms it reached rather than one per arm. A split reply is still visible as one: it
names fewer arms than the experiment has.

### The order is the records' own, and the clock decides only what they cannot

Within an arm, the ordinal, the attempt, and the call's sequence already fix the order — and
they have to, because the runner writes an attempt and every call it made from one reading of
the clock, so timestamps cannot separate them. Across the arms, each arm's ordinals order the
compositions *it* received, and the timeline merges those sequences.

Merging them rather than sorting by delivery time is not fussiness. The record listing is
grouped by arm, so a message sent to one arm alone reads back before a linked message that
was actually sent first; sorting by timestamp fixes that only as well as the clock behind it.
Two compositions that no single arm received both of are genuinely unordered by the record,
and only those fall back to the delivery time, then to listing position so the numbering
stays deterministic either way.

### An entry says what happened and never what was said

No message body, no reply, no tool arguments. The thread already serves those, and this is
the one surface built to be filtered, counted, exported, and later handed to an evaluation —
the last place synthetic customer content should reappear. An API test asserts it against the
rendered response rather than trusting review, because the contract is what a judge and an
export will actually read.

The consequence is deliberate: every row a client renders is built from structural facts. A
page that had to echo a message would have needed one in the contract.

### A refusal is not an error

An entry carries a set of categories rather than one label, because the questions an operator
asks overlap: a successful write is a tool call *and* a state change, a failed attempt is a
model event *and* an error. Filtering is membership.

`refusal` and `error` are separate members. ADR 0021 made them separate things — a tool that
declines is the world answering, and the agent can act on it; a tool that failed is the lab's
fault and the agent could not have. Collapsing them here would make every comparison that
counts errors count an agent being correctly told no.

There is deliberately no `fault` category. A scenario's mutation blocks do not fire yet, and
an enum member waiting for a producer is the mistake ADR 0024 refused with
`AgentArchitecture`.

### A source location is resolved, project-owned, and allowed to be absent

`locate()` answers where a callable is defined, and answers nothing at all in three cases:
the file is outside the `capability_lab` package, there is no source to point at, or there is
no callable — a tool this build no longer publishes names no handler.

Three rules make the answer trustworthy.

**Only the lab's own code has a location.** A framework's internals are not this project's to
explain, and a timeline pointing into an SDK would invite a reader to compare two arms on
code the lab did not write and cannot change. This is the "project-owned" in the outcome, and
it is enforced by where the resolved file is rather than by a filter list.

**It is read from the callable, never from a map somebody keeps.** The recorded event names
the tool; `TOOL_HANDLERS` names the function that answers it; `inspect` says where that
function is. To make that true of writes as well as reads, `SandboxActionService` now
dispatches through a handler table instead of a chain of name comparisons — so the map that
locates a write is the same one that ran it, and cannot name a function the service does not
actually call. An attempt resolves the same way, through the runtime registry to the adapter
that produced it: the project-owned glue code, which is the half of a framework the lab owns
and the half Milestone 6 has to document.

**It is resolved, never stored.** A path and a line number are facts about the checkout that
answered, not about the run that happened. Storing them would freeze one machine's layout
into evidence and make every later refactor look like history changing. Resolving on read
means a location is simply absent when this build no longer has the code — which is the
honest answer, and the "where available" the outcome asks for. A path is reported relative to
the import root for the same reason: an absolute path would make two checkouts disagree about
identical code.

### An arm reports the framework and model it pinned

`ExperimentRunSchema` gains `framework_id` and `model_id`, read from the configuration version
the arm pinned rather than from what this process can run today. The comparison matrix answers
"do these arms differ here", which is a question about the pair; a client labelling one arm —
frame 8's `Pydantic AI · claude-sonnet-5` line, and the adapter a timeline entry points at —
needs the answer for that arm alone.

## Deliberately not here

- **Traces.** The timeline is the normalized stream; a span tree is a different view of the
  same execution, and frame 9b is a Milestone 5 surface beside the judge and the evaluation
  evidence it sits with. `docs/observability.md` already governs what a span may carry, and
  nothing here changes it.
- **The mutation timeline.** ADR 0026 deferred firing a scenario's mutation blocks to "the
  timeline that shows when it happened". The timeline now exists and the blocks still do not
  fire: injecting a fault mid-run is a change to the *world*, with its own trigger evaluation
  and its own isolation questions, and delivering it inside a slice about reading the record
  would have made both harder to review. The category it will need is deliberately absent
  until it has a producer.
- **The code excerpt.** Frame 9c shows the executed lines beside the events that reached
  them. This slice publishes the location; rendering source text is a Milestone 5 surface and
  a question about what the running build is allowed to read off disk.
- **Usage, duration, and cost.** Named in Milestone 5, and refused here for the reason
  ADR 0026 refused them: columns waiting for a consumer.
- **A stored ordering.** The merge is recomputed on every read. It is a sort over one
  experiment's turns, and an experiment has two arms and a human typing into them.

## Verification

- Timeline tests (`test_experiment_timeline.py`) cover the trigger as one entry naming every
  arm, an arm's calls in the order it asked followed by its reply, the arm beside it
  contributing nothing until it is run, two arms at different depths sharing one
  composition's step, two linked messages counted once rather than twice, the reply only one
  arm received, the write that is a state change beside the read that is not, the refusal
  that is not an error and the broken tool that is, the failed attempt that is a model event
  and an error, the entry that carries no word anyone said, every call naming the handler
  that answered it, an attempt naming the adapter that produced it, the arm this process
  cannot run keeping its stream and losing only its location, and the experiment this shop
  does not hold.
- Source-location tests (`test_source_locations.py`) cover the project function located
  relative to the import root, the method that names its class, the code this project does
  not own, and the nothing that is answered rather than raised.
- Contract tests (`test_experiment_api.py`) cover the stream in the order it happened, every
  entry naming project-owned code, the response that carries no message body, the timeline of
  an experiment another shop holds, and the arm reporting the framework and model its
  configuration pinned.
- Frontend tests (`Experiments.test.tsx`) cover both arms read as one ordered stream, the
  composition only one arm received, the project-owned code named on the event and counted in
  the code-path listing, the lens that narrows the stream and the one that restores it, and
  the route reached from the bench and back.
- The Playwright journey (`experiment-start.spec.ts`) is extended rather than duplicated, for
  the reason ADR 0026 gave: an experiment is one story. After driving both arms, the operator
  opens the timeline and reads the incident as one stream — the shared opening, the divergent
  reply, one write per arm under the state lens, and the project's own code behind them.

## Migration

None. No table is created, no column is added, no fingerprint moves, and no published
definition is touched. `getExperiment` gains two fields on each arm; the timeline is a new
read-only route.
