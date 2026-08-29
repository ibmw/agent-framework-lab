# ADR 0026 — The agent's turn: what an arm answered, and what it did to get there

Status: accepted — 2026-08-29

Implements `docs/PLAN.md` Milestone 4's fourth outcome for everything an agent produces:
assistant turns, tool events, confirmations, state changes, and failures. Records the
`SupportAgentRuntime` port and why it is new rather than an evolution of `AgentAdapter`, the
recording invoker that makes evidence a property of the call path, the advance operation and
its two idempotency rules, the attempt as the unit a failure and a retry are recorded in, and
the two runtimes — the declared control policy and Pydantic AI over the sandbox tool set.

## Context

ADR 0025 built both arms and both threads and then stopped at the customer's side. It said
so in as many words: "no arm produces an assistant turn, no model is called, and
`AgentAdapter` is unchanged", because Milestone 3 Slice 2's first outcome is a constraint —
evolve the agent port only for requirements the target scenario proves — and starting an
experiment proved none.

Advancing one proves several at once. An arm must run a *published configuration* (ADR 0024)
rather than a framework selected by composition; it must reach the world only through the
versioned tools its configuration enables (ADR 0021, ADR 0022); it must act under the support
identity that configuration adopts; and everything it does must land in a record a comparison
can read without knowing which framework produced it. None of that is expressible through
the POC's port.

Everything else was already built and unused: the arm and its isolation (ADR 0020), the ten
tools and their canonical result envelope (ADR 0021, ADR 0022), the resolved prompt the
publish gate previews (ADR 0024), and the thread the customer writes into (ADR 0025).

## Decision

### `SupportAgentRuntime` is a new port, and `AgentAdapter` is untouched

The POC's port answers a persona-first conversation: it takes a pre-assembled
`RetailSupportContext` — the customer, the products, and the orders, already loaded — and
returns a structured support result. That is the opposite of what this milestone requires. An
arm is given a message and discovers everything else by asking, which is ADR 0011's tool-first
rule and the reason ADR 0024 declared customer, order, and ticket variables non-injectable.

Bending one port into both would have made the POC's published conversation contract and the
target runtime share a shape neither wants, which `AGENTS.md` forbids. So there are two ports
and two registries. `AgentRegistry` keeps serving the POC routes unchanged;
`SupportAgentRuntimeRegistry` answers "can this process run an arm with this framework right
now", which — like the adapter registry it sits beside — is deliberately *not* the
proven-capability catalog the publish gate reads (ADR 0024): what an author may publish must
not change with the machine the Studio runs on.

`answer` returns text, not a structured result. Every fact an arm touched is already recorded
as the tool event that produced it; asking a model to restate what it did would make the
evidence depend on the model's honesty about its own behavior.

### The invoker is the recorder, and it is the only way out

A runtime is handed a `SandboxToolInvoker` bound at construction to one arm, one acting
support identity, one tool set, and one tool budget. It cannot widen any of them, cannot
reach a repository, and cannot name the arm beside it.

Every call through it becomes a tool event. That is what makes "a framework-specific event
never leaks into the shared evidence contract" — Milestone 4's fourth acceptance criterion —
structural rather than a rule someone has to keep: an SDK's own tool-call objects have
nowhere to go, and an adapter cannot forget to report a call it made.

Three consequences follow from the binding:

- **A runtime chooses a tool, not a version.** The call names the tool; the invoker supplies
  the version the lab publishes, because the tool contract set is a pinned input of the
  experiment and enters the starting-state fingerprint (ADR 0021). An arm that could ask for
  another version would be choosing its own starting state.
- **The actor travels on every call.** It is the arm's identity rather than a per-call
  choice, so it is passed for reads too, where nothing consults it (ADR 0021). A model that
  could name it would be choosing its own permissions (ADR 0022).
- **A tool the arm was not offered is an error, not a refusal.** A runtime is handed the
  tools it may offer, so a name that reaches the invoker came from an adapter offering
  something the configuration never enabled — the lab's mistake to see, exactly as an unknown
  tool name is.

### The budget is spent per call, and it ends the attempt

`max_tool_rounds` is an authored runtime setting (ADR 0024). The invoker enforces it rather
than trusting each framework's own limit, because an SDK's usage limit would enforce it only
for the SDKs that have one. It is spent per **call**: a round that made three calls spent
three — the stricter reading, and the only one an evidence record can count, since a round is
a framework's idea of a model request while this records what the arm was asked.

Exceeding it is `tool_round_limit`, a finding about the configuration rather than a fault of
the lab or the provider: an agent that keeps looking without concluding is one of the
behaviors a comparison exists to make visible.

### Advancing is explicit, per arm, and idempotent over an answer

Delivering a customer turn records a customer turn; running an agent is a separate operation
on one arm. Three reasons, and the first alone would decide it:

- the arms progress independently — one may be advanced twice while the other waits — which
  is Milestone 4's "independently progressing runs";
- a retry is only expressible if running is an act rather than a side effect;
- a model call is slow and costly enough that it must not happen because somebody typed.

It is **idempotent over an answer and not over an attempt**. Advancing an arm whose latest
customer turn is already answered returns that answer and calls no model — an arm must never
hold two replies to one question, and a second advance must not cost a second call. Advancing
one whose last attempt *failed* makes a new attempt beside it, because a failure is evidence
to keep and retrying is a thing an operator does.

An arm answers **the last turn it received, not the first it has not answered**. An operator
may send a second message before running the agent on the first; a reply to the older one
would be a reply to a question the customer has moved on from. The earlier turn stays in the
history, unanswered, which is what actually happened.

### An attempt is the unit, and a failure is classified rather than described

`AgentTurn` is keyed by the run, the ordinal of the customer turn it answers, and the
attempt. The ordinal being the *question's* is what lets the two streams interleave without a
shared sequence nothing owns, and makes "this arm has not answered yet" a question about the
record rather than about a status somebody must remember to set.

A failed attempt carries a code from a closed table and **no body**. A provider's error text
is neither stable across models nor safe to store beside synthetic customer content, and it
would read as the reply everywhere a transcript is shown — the same discipline that keeps a
failed tool result from describing itself (ADR 0021). The five kinds mirror the taxonomy the
POC's conversation runner already answers with, so one failure means one thing across the lab.

Two answers the lab cannot record are failures rather than truncations: a model that said
nothing, and one that said more than the thread can hold. Truncating would put words in the
agent's mouth that it can then be compared on.

A framework this process cannot run at all is **not** a failed turn. It is a 422 and no
record: a missing provider key is a fact about the operator's machine, and writing it into a
run's evidence would put that machine into a comparison. Neither is an arm whose snapshot or
pins have stopped resolving: ADR 0021 already refuses to answer that as a tool result, and
recording it here would put a broken lab into a comparison as this framework's behavior.

### A tool event is the published envelope plus what it moved

The stored event holds the `tool-result-v1` document whole and authoritative; `tool`,
`version`, and `outcome` are read out of it for listing and counting, never decided again —
the same rule as an experiment's provenance columns (ADR 0025).

There is deliberately **no** separate confirmation record and **no** state-change table. The
confirmation that authorized a write is inside the document the proposal answered with
(ADR 0022), and the state change is the pair of revisions the event carries: a read leaves
them equal, the one write this milestone publishes moves the arm by one. A second record
shape for either would be a second chance to disagree with the first.

Events are buffered during the attempt and written after the turn row, so a call can never
reference an attempt that is not there — including for a failed attempt, because what the
agent did before it broke is the most informative part of a failure.

### Resolution reads the pins, never the latest

The prompt is rendered against the shop version the snapshot froze and the support-identity
version the experiment's own document froze. Reading a newer publication here would make a
historical run unexplainable the moment an author published again.

The variable table and the tone-of-voice resolution move into `agent_prompt`, shared by the
editor's preview and the runtime. ADR 0024 said "the runtime resolution has to make the same
call" about a variable that resolves to empty text; this makes that a function rather than a
promise. Rendering is total by construction: a published prompt carries only known,
injectable variables, because its own publish gate refuses the other two kinds.

Memory is resolved here too. A configuration keeping no conversation memory is shown an empty
history, because memory is a comparison dimension and two arms differing only in it must
actually differ. Failed attempts are never in the history: the agent did not say them, and a
history carrying them would ask the model to continue from words it did not write.

### Two runtimes, and what each one is for

**The deterministic control arm** is a declared policy, not a model: read the interaction
context, follow it to the order, read the customer, and — if the order does not ship to their
default address and the write tools are enabled — propose the change and apply the
confirmation the proposal answered with. Every step is skipped when the configuration does
not enable its tool or when the previous answer was a refusal, so two configurations of this
framework differing only in tool bindings genuinely behave differently. That makes the tool
dimension a real comparison variable before a single model is called, and makes the rest of
the lab falsifiable: a difference between two runs of this framework is a difference in the
world or the configuration, never in the agent.

It deliberately does not read the customer's words. A fake that appeared to understand them
would invite exactly the interpretation of a result that a fake cannot support; it acts on
the state of the world, which it can actually see.

**Pydantic AI** runs the same port. Its tool schemas are derived from the contract table
rather than authored twice, which is what that table was declared for (ADR 0021), so adding a
tool to the lab adds it to this framework without touching the adapter. Three details:

- **Its SDK name is not its contract name.** Providers accept `[A-Za-z0-9_-]` and the lab's
  names carry a domain namespace, so the dot is rewritten for the wire. Nothing maps it back:
  each tool's closure knows which contract it stands for, so the recorded event carries the
  contract name and the evidence never depends on a provider's spelling rules.
- **Tools run one at a time.** A write is guarded by the revision it was proposed against, so
  calls that raced would refuse each other for no reason the agent could act on, and the
  recorded sequence is meant to be the order the agent asked rather than which call finished
  first.
- **Its usage limit is the lab's budget.** The only limit configured is the tool allowance, so
  exceeding it is reported as `tool_round_limit` rather than as a transient provider fault.

Both were built in one slice on purpose. A port shaped by a single adapter written to fit it
would be shaped by a hypothetical — the criticism ADR 0025 made of designing a port before it
has a caller — and the configuration gate already lets an author publish a Pydantic AI arm,
so a control-only runner would have let an operator start an experiment that dead-ends at its
first turn.

## Deliberately not here

- **Completion.** An experiment and a run still have no status. Completion is judged against
  the scenario's completion conditions (ADR 0018), which is Milestone 5's evaluation work;
  adding an operator-set status before anything can judge one would be the unused-enum-member
  mistake ADR 0024 refused with `AgentArchitecture`.
- **Usage, duration, retries, and cost as metrics.** `PLAN.md` names them in Milestone 5, and
  `attempt` already records that a retry happened. A token count and a duration on every turn
  before anything reads them would be columns waiting for a consumer.
- **Traces and project-owned source locations.** Milestone 4's fifth outcome, with the
  normalized execution timeline that displays them.
- **The mutation timeline.** A scenario's mutation blocks are bound with a trigger time and
  the runtime injects them (ADR 0017). Firing them is a change to the *world* mid-run rather
  than to the agent's turn, and it belongs with the timeline that shows when it happened.
- **Concurrency.** Two advances of one arm at once would both compute the same attempt number
  and the composite key would reject the second, so the stream cannot be corrupted; the loser
  surfaces as an unmapped integrity error. The same call ADR 0025 made about a lost ordinal
  race, and for the same reason: there is no concurrent writer today.
- **Recovering an attempt that died mid-flight.** Tool events are written with the turn they
  belong to, so a process that dies after a write but before the turn is recorded leaves the
  arm moved and the evidence absent. Surviving process failure is `PLAN.md`'s durable-workflow
  trigger, and a lab with one operator and no background work has not reached it.
- **A third framework.** Milestone 6 selects whether the first controlled comparison changes
  framework or architecture.

## Verification

- Domain tests (`test_agent_turn_domain.py`) cover the reply addressed to the customer turn it
  answers, the attempt that counts from one and must be a number, the answered turn that
  carries words and names no failure, the reply longer than the thread can hold, the failed
  attempt that says where it broke and carries no reply, and the outcome the record does not
  know.
- Runner tests (`test_experiment_runs.py`) cover the arm answering the trigger it opened on,
  every call recorded in the order it was asked, the write that moves the arm and the event
  that says so, the confirmation travelling inside the recorded result, the arm that moves
  alone, the configuration whose tool bindings change what the agent does, the tool the arm
  was never offered, the budget that ends the attempt while keeping what it spent, the prompt
  rendered against the pinned versions, the memory mode that shows the agent no thread and the
  one that shows it what was said, the answered arm advanced twice, the failed attempt kept
  beside its retry, the model that says nothing, the unclassified framework error, the
  world that stopped resolving surfacing as an error rather than a failed turn, the framework
  this lab cannot run recording nothing, the arm answering the conversation as it now stands, the experiment read back with both sides of both threads, and the arm and shop
  a runner will not advance.
- Runtime tests (`test_agent_runtimes.py`) cover the control arm following the incident to the
  order and redirecting it, applying only the confirmation the proposal answered with, never
  calling a tool it was not offered, leaving an order that already ships to the default,
  stopping the step whose input was refused, and answering identically twice over one world;
  and, for Pydantic AI, the tools it offers, the contract name it records, the argument schema
  derived from the contract, both budgets, and the thread it carries.
- Contract tests (`test_experiment_api.py`) cover the advance that answers with the turn and
  its calls, the write reported as the state change it is with the arm beside it unmoved, the
  experiment read back with both sides of its threads, the second advance that returns the
  same turn, the framework this lab cannot run refused before anything is recorded, and the
  arm of another experiment.
- Frontend tests (`Experiments.test.tsx`) cover the agents run for every arm a composition
  reached, the calls shown on the way to the reply, the arm advanced on its own, the failed
  attempt kept beside its retry, the arm this lab cannot run surfacing its refusal, and the
  state change read against the arm that has none.
- The Playwright journey (`experiment-start.spec.ts`) is the slice's acceptance evidence,
  extended rather than duplicated because an experiment is one story: an operator publishes
  the whole chain, starts a two-arm experiment differing only in its prompt, runs one arm's
  agent and watches it follow the incident to the order and redirect it while the arm beside
  it stays where it was, then drives both arms and reads the divergence the record keeps.
  Both arms run the control framework, which is what makes the reply, the calls, and the
  revision assertions rather than observations.
- One new live-model test, opt-in as the existing one is: a real model asked the incident's
  own question through the derived tool schemas. It proves the only thing `TestModel` cannot —
  that a model *chooses* to use these tools.

## Migration

`20260829_0013` creates `experiment_agent_turns` and `experiment_tool_events`. Nothing
existing changes: no fingerprint moves, no snapshot becomes a different starting state, and no
published definition is touched. The tool contract set is unchanged, so a snapshot frozen
before this slice is the same starting state after it.
