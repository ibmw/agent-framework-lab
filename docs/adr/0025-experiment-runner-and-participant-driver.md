# ADR 0025 — The experiment: two arms, one starting state, and the customer's turn

Status: accepted — 2026-08-28

Implements `docs/PLAN.md` Milestone 3 Slice 2 — the participant-driver port, its human
implementation, and the persisted resolved configurations and participant events — together
with the first two Milestone 4 outcomes that give them a caller: immutable experiment records
with independently progressing runs, both arms started from one canonical snapshot and sent
the same trigger. Records the `experiment-v1` envelope, the participant-driver port and why
the trigger does not travel through it, the composition identity that makes divergence
readable, the setup gate that answers the tone-of-voice check ADR 0024 deferred to here, and
the comparison matrix the bench reads before anything is frozen.

## Context

Slice 2 could not be built on its own, and its own roadmap entry said so: "this slice is
delivered against the Milestone 4 runner that calls it. A port designed before it has a caller
would be shaped by a hypothetical one." ADR 0024 repeated it under "Deliberately not here."
So this slice delivers the port **and** the smallest runner that genuinely uses it.

Everything the runner needs was already built and unused. A published scenario version is a
recipe (ADR 0018); materializing it is canonical starting state (ADR 0019); cloning it is one
arm's independently mutable world (ADR 0020); ten versioned tools read and move that world
(ADR 0021, ADR 0022); a published agent configuration is what an arm runs (ADR 0024). Even the
resolution was written: ADR 0012 defined `resolve_experiment_inputs` and `ParticipantDriverType`
before anything called them. What was missing is the record that binds them and the first
customer turn that moves them.

What is deliberately still missing is the agent. This slice starts experiments and drives their
customer side; nothing here runs a model. That keeps the port honest — a runner written against
a driver that might generate, refuse, or take time does not have to change on the day an LLM
driver lands — and it keeps ADR 0011's rule intact: `AgentAdapter` moves when a requirement is
proven by the target scenario, not when a record is added that one day implies it.

## Decision

### An experiment is created started

There is no draft experiment and no separate "run" call. Resolving the versions, freezing the
starting state, and cloning the arms are one act, and an experiment that existed without them
would be a record of nothing. `POST /experiments` answers 201 with both arms cloned and both
threads already open.

Starting is **composed, never re-implemented**: `ExperimentService.start` materializes through
`SandboxSnapshotService` and clones through `SandboxService`. Both carry rules an experiment
must not be able to sidestep — the publish gate re-run against today's orders, the fingerprint
that identifies a snapshot, the per-arm row that *is* the isolation — and a second copy of any
of them would be a second chance to disagree about the same starting state.

Starting is deliberately **not idempotent**, for the reason cloning is not (ADR 0020): the same
scenario run twice is two experiments, and collapsing them would delete the second result
rather than reuse the first. Materializing inside it stays idempotent, so both experiments
share one snapshot and each still gets its own arms.

### `experiment-v1` records the arms by content and the world by reference

A snapshot fingerprints what both arms *start from* and refuses arm inputs outright: an agent
configuration is a per-arm choice, and admitting it would make two arms of one comparison two
different starting states (ADR 0019). This envelope is the other half — the arm pins, the
participant driver, the seed, the tool contract set, and the snapshot's fingerprint.

The shared pins are recorded **by fingerprint, not copied**. The snapshot already holds them
and is immutable, so restating them here would be a second source of truth for bytes that
cannot change. Decoding therefore takes the pins from the snapshot, which is the only place
they can be read from without risking a copy that disagrees.

Two fingerprints are kept because they answer different questions: `sandbox_fingerprint` says
which world this ran in, `resolution_fingerprint` says which inputs ran in it. Nothing a run
*produces* is in the envelope — a document that mixed turns with inputs would change its
fingerprint every time the operator typed a sentence.

### The trigger is the scenario's; the driver supplies every turn after it

A published ticket carries the first message every arm receives (ADR 0016), and both arms
receiving it identically is what makes a comparison a comparison. So the runner writes the
pinned ticket's trigger into each arm as turn zero, with a source of its own, before any driver
is consulted.

Routing it through the driver was considered and rejected. Every legal driver would have to
return it unchanged — a human operator must not be able to rewrite the question the arms are
being compared on, and a future simulator is bound by the same rule — and a port method that
must be the identity function is not a port method. Keeping the trigger with the runner makes
"the arms started from the same question" a property of the starting state rather than of a
driver behaving.

### The port is one method, and the driver holds what only it needs

`ParticipantDriver.next_turn(request) -> str` and nothing else. The request carries the run, the
arm's label, the recorded driver type, and the turns **this arm** has already received.

A recorded turn carries no surrounding whitespace, and a compose box collects it freely: every
raw client sends the trailing newline its input ended with. The human driver therefore trims what
it relays, because refusing that would be refusing the message rather than the padding. The
domain rule stays where it is — and reaches HTTP as a refusal like every sibling resource's, so
the next driver returning a body the domain will not build is answered rather than crashing.

Two things are deliberately not in it. **The operator's words**: composition constructs
`HumanParticipantDriver(message)` per delivery, the way it selects databases and agent
frameworks (`docs/architecture.md`), so a generating driver is constructed with a model client
where this one is constructed with a sentence and neither shape leaks into the port. **The
arm's world**: not the agent's replies, not the sandbox state, not the arm beside it. A
simulator that could read the sandbox would answer questions the customer has no way to know
the answer to, and the scenario's hidden facts exist precisely so that reaching them is the
agent's job.

The driver returns a body, not a turn: the ordinal, the composition identity, and the recorded
driver type are the runner's to assign, and a driver that could set them could renumber a run's
history. A driver whose type is not the one the experiment recorded is refused — a run half
typed by a person and half generated by a simulator would carry one label for two things.

### A composition is the divergence record

The operator writes once and chooses which arms receive it. Every turn one call writes shares a
`turn_id`; two calls are two compositions **even when the words match**. That distinction cannot
be reconstructed later from the bodies, and it is exactly the case a comparison must be able to
tell apart, so it is written at delivery.

Ordinals are per arm, not shared: one arm may have been driven twice while the other waited, and
a run that had to keep pace with its sibling would be a run the operator cannot explore. The
`(run_id, ordinal)` primary key is what makes the stream append-only — a turn cannot be
renumbered onto another position, and an arm cannot receive two turns at one depth.

### The setup gate reaches outside the payload, and it runs twice

`preview` and `start` share one rule set **and one resolution**, the way
`SandboxSnapshotService` shares the authoring gate with the publication it re-judges
(ADR 0019). Preview materializes nothing: an operator weighing two configurations must not be
freezing starting state on every keystroke, and every answer the setup screen needs is reachable
from the published versions alone.

Resolving the pins is part of the gate rather than something `start` does afterwards. Resolving
is what discovers a closure that disagrees with itself — a ticket frozen against an older shop
version than the recipe built on it — and an operator has to read that while choosing rather than
meeting it only once they commit. It also means the pins are computed once: two computations
would be two chances to disagree about what a publication froze.

Three rules live there:

- **A tone-of-voice override is resolved against the shop the scenario pinned.** This is the
  check ADR 0012 placed at experiment setup and ADR 0024 deferred to it, arriving where both
  said it would. A configuration is shop-independent, so its own publish gate could only warn;
  here the target shop is known, and an override it does not publish is an **error** — the arm
  would otherwise run in a tone that shop never authored.
- **Arms differing along more than one dimension warn.** A warning rather than a refusal,
  deliberately: an experiment with two differences is still worth running — it is often how a
  suspicion starts — but nothing it produces can be attributed to either difference, so the
  count travels with the experiment instead of being discovered months later by whoever reads
  the result.
- **A closure that pins one definition at two versions is refused**, as a finding rather than
  an exception: starting again cannot fix it, so it belongs beside everything else that refuses
  this setup.

One request shape serves both operations, so a preview judges what a start would run rather than
something adjacent to it. The experiment's **name** is the single field the two read differently
— starting requires one, previewing does not, because an operator compares two configurations
before deciding what to call the result — so that rule lives in the service that starts an
experiment instead of being half in the contract and half in the domain. Two arms may not share
a name: a comparison's whole output is "arm A did this, arm B did that".

Whether the scenario version can be frozen at all is deliberately **not** restated here. That is
the snapshot gate, re-run against today's orders, and two copies of it would be two chances to
disagree.

### The comparison matrix is a difference, not a declaration

`compare_configurations` reports every dimension — framework, architecture, model, prompt,
tools, support identity, tone of voice — with each arm's value and whether they disagree.
Agreeing dimensions are reported too: an operator needs to see that the model is the same as
much as that the framework is not, and a matrix listing only differences would make "same" and
"not checked" look alike.

Two details:

- **The runtime settings ride with the model.** Two arms on one model at two temperatures are
  not running the same model in any sense a result can be attributed to, so the cell reads
  provider, model, temperature, and tool-round limit together. A separate "runtime" dimension
  would have added an axis the roadmap does not name for a difference the model row already is.
- **The prompt is compared by content, not by version number.** A prompt is a template inside a
  published version (ADR 0024), and two versions carrying the same prompt are not a comparison
  variable however far their numbers have drifted.

The difference **set** enters the experiment fingerprint, because it is a property of exactly
this pair of arms: two experiments over one scenario whose arms differ differently are not the
same experiment.

### Persistence

Three tables. `experiments` is write-once and holds the canonical document plus the columns a
shop's list and a fingerprint lookup need — written from the document, never as a second source
of truth. `experiment_runs` is one row per arm, referencing the sandbox rather than embedding
any of it: an arm's isolation is its own row in `sandboxes`, and a copy here would give a run a
second world that could disagree with the one its tools move. `experiment_participant_turns` is
append-only per run.

There is deliberately **no** uniqueness over `resolution_fingerprint` — the same inputs run twice
are two experiments — and none over `turn_id`, because a composition delivered to two arms *is*
one identity in two rows. A `sandbox_id` is unique across runs: two runs sharing a clone would be
two arms writing into one world.

What a response reports about a stored row is read from that row. The canonical schema token in
particular comes from the document rather than from the running build's constant: the day an
`experiment-v2` exists, every experiment frozen before it must keep saying `experiment-v1`.

A turn's body is synthetic customer content. It is stored, as the order fixtures beside it are,
and it is never logged or traced (`AGENTS.md`).

### `ParticipantDriverType` moves into the domain

It was declared in `application/definition_resolution.py` by ADR 0012, before it had a caller.
A participant turn is a domain object that records which driver produced it, and the domain
cannot import the application, so the enum moves to `domain/experiment.py` and the resolution
imports it from there. `resolve_experiment_inputs` also narrows its parameter from the whole
definition repository to `PublishedVersionReader`, which is all it ever used — keeping "a
resolution never touches a draft" a signature rather than a convention.

## Deliberately not here

- **Running an agent.** No arm produces an assistant turn, no model is called, and
  `AgentAdapter` is unchanged. Slice 2's first outcome is a constraint — evolve the port only
  for requirements the target scenario proves — and nothing here proves one.
- **A declared controlled variable.** The matrix records which dimensions differ; it does not
  ask the operator to name the one they meant. Milestone 4's warning outcome and Milestone 6's
  "select whether the first controlled comparison changes framework or architecture" are where
  that declaration belongs, and inventing it now would put a field on every experiment before
  anything reads it.
- **Completion.** An experiment has no status. Adding `completed` before anything can complete
  one would be the unused-enum-member mistake ADR 0024 refused with `AgentArchitecture`.
- **The mutation timeline.** A scenario's mutation blocks are bound with a trigger time and the
  runtime injects them (ADR 0017). The runtime that would fire them is Milestone 4's.
- **Mapping a lost ordinal race to a conflict.** Two simultaneous deliveries into one run
  compute the same ordinal and the composite key rejects the second, so the stream cannot be
  corrupted; the loser currently surfaces as an unmapped integrity error. Worth a refusal code
  when the Milestone 4 runner introduces real concurrency, and not before — there is no
  concurrent writer today.
- **Refusing a participant driver the lab cannot run.** An experiment may record `llm` or
  `scripted`; nothing can then drive it, and the mismatch is reported at the first turn. The
  same shape as ADR 0024's proven-capability catalog, and it belongs with the second driver
  rather than ahead of it.
- **Resuming, forking, and history.** Milestones 4 and 5.
- **Evidence beyond participant turns.** Tool events, state diffs, and traces are the runner's
  and the evaluation milestone's.

## Verification

- Domain tests (`test_experiment_domain.py`) cover the trigger that opens a run and names no
  driver, the trigger refused at any other ordinal and refused when it claims a driver, the
  driven turn refused at ordinal zero and refused without a driver, the empty and over-long
  body, the identical arms that differ nowhere, the single arm reported dimension by dimension,
  the framework as the only difference, the temperature that makes two arms a different model,
  the tool set compared as a set rather than an authoring order, the tone selection compared by
  what it names, and the comparison with nothing to compare.
- Document tests (`test_experiment_document.py`) cover the envelope that records the arms and
  references the world, the round trip, the fingerprint moving with the arm, with the world,
  with the recorded difference set and with the participant driver, the refused schema token,
  and the corrupted identifier and tool version naming their own paths.
- Service tests (`test_experiments.py`) cover the two arms cloned from one snapshot to one
  starting fingerprint, both threads opened on one authored composition, the arm pins and their
  identities, the shared pins that stay out of the arms, the single-arm experiment, the operator
  -named arm, the same setup started twice as two experiments sharing one snapshot, the unnamed
  experiment, the third arm, the unpublished configuration version, the scenario version of
  another shop, the tone override the shop does not publish, the multi-dimension warning that
  still runs, the preview that freezes nothing, the linked turn as one composition, two
  identical replies as two compositions, arms driven to different depths, what the driver is
  shown, the empty composition, the driver the experiment did not record, the arm of another
  experiment, one arm named twice, two arms sharing one name, the padded message recorded
  without its padding, the conflicting closure read in the preview and refused by the start, the
  schema token served from the stored document, the experiment read back with its threads, the
  shop listing, and a write in one arm that moves that arm alone.
- Contract tests (`test_experiment_api.py`) cover the start that answers with both arms and both
  triggers, the response separating world pins from arm pins, the preview matrix that stores
  nothing, the tone finding, the unpublished arm version as a 404, the third arm and the unknown
  field refused by the strict contract, the linked turn, the arm-specific reply the other arm
  never received, the empty composition that leaves the run where it stood, the arm of another
  experiment, the padded message accepted and recorded trimmed, the driver mismatch reported
  under its own code, the preview that does not need the name a start requires, the schema token
  the stored document carries, the per-shop listing, and the experiment of another shop.
- Frontend tests (`Experiments.test.tsx`) cover the matrix read dimension by dimension, the
  multi-difference warning, the unpublished configuration offered as unavailable, the start that
  sends the exact versions chosen and opens the bench, the unnamed experiment refused before a
  request is made, a refused start surfacing its finding without discarding the setup, both arms opening on the trigger, the linked send, the
  arm-specific reply marked as such, and the provenance read back to one starting state.
- The Playwright journey (`experiment-start.spec.ts`) is the slice's acceptance evidence: an
  operator publishes the whole chain, reads a one-arm matrix with no differences and a two-arm
  matrix whose single difference is the prompt, starts the experiment, finds both arms opening
  on the ticket's triggering message from one shared fingerprint, sends one message to both and
  one to a single arm, and reads the arm-only marker the record keeps.
- No new live-model test. Nothing in this slice calls a model.

## Migration

`20260828_0012` creates the three tables. Nothing existing changes: no fingerprint moves, no
snapshot becomes a different starting state, and no published definition is touched.
