# ADR 0028 — Firing a scenario's mutations into a running arm

Status: accepted — 2026-08-30

Implements the half of `docs/PLAN.md` Milestone 4 that ADR 0027 deferred: the scenario's
mutation blocks firing at their bound timing. Records where a fault fires from, the declared
table of what this build can actually carry out, the moment that is decided from the arm's own
record rather than from a clock, the firing that is recorded once per arm, and the timeline
entry that is a state change and never a tool call.

## Context

ADR 0017 published the mutation template — what it perturbs, and the single timing parameter
that says when. ADR 0018 let a scenario bind one to its own objects and made mutation order
the run timeline. ADR 0019 froze both into the snapshot every arm is cloned from. ADR 0026
ran the agent, and ADR 0027 read the whole execution back as one stream and deferred this
explicitly: "the timeline now exists and the blocks still do not fire."

So the fault has been fully authored, fully published, and fully inert. Every surface that
shows an experiment has been describing an incident with a piece missing, and one particular
piece: ADR 0022 built the address-change protocol around a world that moves under the agent —
"the agent proposes against a world, the fault moves that world, and the write it computed no
longer applies" — and named this scenario's `concurrent-entity-mutation` as the reason its
conflict refusal is "not an edge case here". Nothing has been able to reach that path.

## Decision

### A fault fires on the call path, between an arm's calls

`ArmMutations` is asked whether anything is due **before** the runtime is started and again
**after every call the invoker makes**. It is not a turn boundary check.

The motivating case decides this. If a fault could only arrive between turns, the control arm
would read the order, propose, and apply inside one attempt, and the fault would land after
all three — the conflict ADR 0022 built would be unreachable, and the fault would be
decoration. Firing on the call path means the world can move between a proposal and the write
that would have applied it, which is the thing the scenario is for.

It rides the invoker ADR 0026 already made the only path from a runtime to the world. A
runtime cannot see the difference: it asked a tool, and the next thing it asks answers about a
world that moved. Nothing is announced to the agent, because a mutation is never visible as a
cause (ADR 0017) — only as the world afterwards.

### The lab declares what it can carry out, and refuses to start what it cannot

`APPLIABLE_MUTATIONS` maps a `MutationEffect` to the project-owned function that performs it
and the entity kinds that function can move — the same spirit as `sandbox_tool_contracts` and
`agent_capabilities`: an effect is in the table because the lab has code that performs it and
tests that keep performing it. Today that
is exactly one — `entity_mutation`, applied to a bound order. `tool_fault` and
`service_outage` would have to make a published tool contract answer something it never
authored, and `clock_shift` needs sandbox time no snapshot carries; each is a slice of its
own. `APPLIABLE_TIMINGS` is the same declaration for moments: `after_first_read` and
`at_turn:N` are observable from the record, and `at_offset` is not, for the same reason.

Authoring stays free. A library may hold a `tool-timeout` template and a scenario may compose
it, because the block libraries are shop-independent and the design direction names templates
this build does not implement. What is refused is **starting an experiment** on one: the
experiment setup gate reports `mutation_effect_not_appliable`,
`mutation_timing_not_observable`, `mutation_entity_not_appliable`, or
`mutation_without_single_entity` as errors, and the preview shows them before anything is
frozen.

The refusal is an error rather than a warning because of what the alternative produces. An
experiment that started with an inert fault would record an arm sailing through an incident it
was never actually given, and every later reading — an operator's, a judge's, a comparison's —
would say "the fault changed nothing". That is the one conclusion this must never invite.

A template's parameters are read **by kind, not by name**: the applier needs one entity
reference and one timing, and finds them by `BlockParameterKind`. An author names the
parameters; the runtime finds what they are. A template that declares two entity references or
none is refused at setup rather than guessed at.

The same gate refuses a bound mutation whose *name* cannot carry the order-history entry its
firing appends (`mutation_id_too_long_to_record`). An order's event IDs are unique, so
truncating a long name would let two faults on one order collide — a domain error raised
mid-run rather than a finding an author can act on. Nothing is truncated anywhere; the gate is
what makes the composed name always fit.

### A moment is decided from the arm's own record

`is_due` takes the bound timing, the target, and an `ArmProgress`: which customer turn this arm
is answering, and which entities it has already read. Both are facts the lab wrote down, so the
same scenario fires identically on a fast machine and a slow one, and a fault is reproducible
in the sense ADR 0019 requires of everything before it.

`after_first_read` reads the *answer* rather than the arguments — a successful
`orders.read_order` naming that order — because an order reached by its reference and one
reached by its identifier are the same read. Listing a customer's orders is deliberately not a
read of one: a listing says an order exists, and reading it is what puts the address, the
status, and the history in front of the agent.

`at_offset` never comes due. That is honest rather than silent, because the setup gate has
already refused it where an operator can see it.

### The entity mutation moves the order one step, and never where it ships

`advance_fulfilment` moves the bound order one step along the fulfilment graph ADR 0015
published — unfulfilled becomes partially fulfilled — and appends the `shipped` event that
explains it, because an order an agent reads back has to describe a history a real order could
have had.

One step rather than a jump to the end, deliberately. The revision moves, so a proposal
computed a moment earlier is now stale — the concurrency fault the template promises — while
the redirect itself stays legal, so the incident remains winnable by an agent that notices and
re-reads. A fault that made the goal unreachable would be measuring the scenario rather than
the agent. Run twice on one order it *does* end the incident: the second step fulfils it and a
fulfilled order can no longer be redirected. That escalation belongs to the graph, not to this
function, and nothing here re-implements the address rule — `plan_address_change` refuses on
the state this leaves behind, which is what keeps one rule in one place.

The shipping address is untouched. The stale address is the incident, and a fault that quietly
corrected it would delete the thing the experiment compares.

An order the graph cannot move — already fulfilled — is left alone and **records nothing**. An
event claiming a firing that changed nothing would read, in a comparison, as a fault this arm
withstood.

### A firing is recorded once per arm, and the store is what says so

`experiment_mutation_events` is keyed `(run_id, mutation_id)`. A scenario's fault happens to a
world once, and a world it has already happened to is a different world; the primary key is
that rule rather than a check the runtime has to remember. A retry does not re-fire: a fault
that fired into an attempt that then broke stays fired, because the world moved and the
attempt breaking afterwards is a fact about the agent.

The row carries what fired (`mutation_id`, the pinned `block_id` and `block_version`, the
`effect`, the bound `timing` literal, the `target`), where it fired (`ordinal`, `attempt`,
`after_calls`), and what it did (`revision_before`, `revision_after`, `state_fingerprint`).
`after_calls` is how many calls the attempt had already made, which is what places a firing
*between* two of the agent's calls rather than merely inside the same turn.

There is no copy of the order and no description of the change. The arm's own state document
is the world afterwards and the revisions are the movement, which is ADR 0026's rule for
confirmations and state changes applied unchanged. `timing` stores the literal the scenario
bound rather than the parsed form, because what the scenario said is the evidence and the
parse is this build's reading of it.

Both arms carry the identical schedule, read from the scenario version the experiment pinned.
The fault is therefore not a comparison variable; *meeting* it is. Whether an arm had already
read the order when it moved is a property of that arm's behavior, which is exactly the
difference an experiment exists to show.

### On the timeline, a fault is a state change and never a tool call

`TimelineEntryKind.MUTATION` carries `TimelineCategory.STATE` alone. Not `TOOL`, because
nothing selected it and an operator filtering for what the agent did must not find it there.
Not `ERROR`, because the incident working as authored is not something breaking. Under the
state lens both writers appear — the agent's write and the scenario's fault — since "what
moved this arm" is one question, and an answer showing only half of it would be a different
one.

Its source location is resolved from `MUTATION_APPLIERS`, derived from the contract table that
actually runs, so what the timeline points at is what performed the write — ADR 0027's rule
that a location is read from the callable rather than from a map somebody keeps.

The entry is ordered by `after_calls` against the tool calls' sequence, losing the tie so that
a fault that fired after call *k* sorts before call *k*. Every coordinate is one the record
already carries; no timestamp is involved, exactly as before.

### An advance answers with the faults it met

`RunTurnResponse` gains `mutation_events`, and `getExperiment` gains the same listing. An
operator who advances an arm and sees a write refused as too late, with no visible cause, has
been shown a lab that looks broken. The bench renders a fault in the attempt's strip where it
fired and names it beside the tools in the state-change card.

## Deliberately not here

- **The three other effects.** `tool_fault` and `service_outage` need a fault surface inside
  the tool layer — a published contract answering something it never authored — and
  `clock_shift` needs sandbox time, which is a reproducibility decision (every arm would have
  to advance identically), not a small feature. Each is refused at setup until it has code.
- **`at_offset` timing.** Same reason: it is a question about a sandbox clock.
- **Firing on delivery of a customer turn.** A fault fires when an arm is advanced, which is
  the per-arm moment the lab controls. Firing at delivery would move a world the operator has
  not yet asked to run, and an arm sitting undriven for an hour would be faulted for it.
- **A fault an operator triggers by hand.** The scenario says when it fires. An operator's
  button would make the schedule a suggestion and two arms incomparable.
- **Reporting a fault that never became applicable.** The runtime logs it and stores nothing.
  Which faults *should* have fired is an evaluation question, and Milestone 5 owns the
  evaluation of a scenario's own conditions.
- **A canonical envelope for the firing.** The event is columns, not a document. Nothing here
  is fingerprinted or replayed from, so a schema token would be a promise with no reader.

## Verification

- Domain tests (`test_mutation_domain.py`) cover each timing arriving when it should and the
  offset that never does, the step along the fulfilment graph, the history the step records,
  the shipping address it leaves alone, the second step that ends the redirect, and the order
  the graph cannot move.
- Grammar tests (`test_block_domain.py`) cover the timing parsed into the form a runtime
  branches on, the turn it names, the value that round-trips to what was authored, and the
  literal the grammar refuses.
- Runtime tests (`test_scenario_mutations.py`) cover the wrong-address fault this build
  applies, the effect, timing, entity, template shape, and unrecordable name it refuses — the
  last one both as a finding and as a fault that never reaches the schedule — the schedule
  resolved
  against the pinned template version in the order the recipe composed, the parameter read by
  kind rather than by name, and what a call reveals — the read of an order, the refusal that
  reveals nothing, and the listing that is not a read.
- Runner tests (`test_experiment_runs.py`) cover the fault firing between the calls that made
  it due, moving the arm it fired into and no other, both arms meeting it in their own world,
  firing once however often an arm advances, the turn-bound fault firing before the agent asks
  anything, the fault that stays fired through a failed attempt and its retry, the third fault
  whose world has moved past it recording nothing, and the recipe with no fault firing none.
- Setup-gate tests (`test_experiments.py`) cover the start refused on a fault this build
  cannot carry out and the preview that reads the same refusal before anything is frozen.
- Timeline tests (`test_experiment_timeline.py`) cover the fault sitting between the calls it
  fired between, the entry that is a state change and neither a tool call nor an error, and
  the project-owned applier it names.
- Contract tests (`test_experiment_api.py`) cover the advance answering with the faults that
  fired into the arm, the experiment reading them back, the arm's two revisions, and the
  timeline ordering that places the fault among the calls.
- Frontend tests (`Experiments.test.tsx`) cover the fault rendered where it fired in the
  attempt strip, named as a writer beside the tools in the state-change card, read on the
  timeline as the world moving, and both writers surviving the state lens.
- The Playwright journey (`experiment-start.spec.ts`) is extended rather than duplicated: the
  operator runs an arm, sees the scenario's fault fire mid-attempt, reads two writers in the
  state-change card, finds the arm beside it untouched, and narrows the timeline to what moved
  a world — two faults and two writes, each in its own arm, with the lab's own code behind
  them.

## Migration

One new table, `experiment_mutation_events`, created by `20260830_0014`. No existing table,
column, canonical envelope, or fingerprint changes, and no published definition is touched.

Experiments started before this migration keep every record they had and simply hold no
firings, which is true: their arms were never faulted. Scenarios published before it are
unchanged and now actually fire, which is the point — with the exception of one composing an
effect or timing this build cannot carry out, which can no longer *start* an experiment until
the slice that implements it lands.
