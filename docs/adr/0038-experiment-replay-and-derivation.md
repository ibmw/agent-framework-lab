# ADR 0038 — The replay: a new experiment, in the world the old one started in

Status: accepted — 2026-09-07

Delivers the replay third of `docs/PLAN.md` Milestone 5's eighth outcome, which that outcome
splits from traces (ADR 0037) and fork by name. Records what "replay" means against a record
nothing may change, why the starting state is reused rather than frozen again, the recorded
compositions as the script that drives a derived run, the scripted participant driver the
port has been waiting for since ADR 0025, and the honest limit of what a replay reproduces
when a model is on the other end.

## Context

The outcome names replay without defining it, and three decisions already in the codebase
define it between them.

An experiment is **immutable**: `experiments` is written once, its document is what
explains the result, and there is no update path (ADR 0025). Everything about a run is in
the record, which is why coming back to one is an ordinary read and there is no resume
operation (ADR 0029). So "replay this experiment" cannot mean running it again — there is
nothing to run again, and the arms it holds have already moved the sandboxes they were
given.

It has to mean **deriving a new experiment**, which is what the outcome's own title —
"replay, and fork provenance" — is about. And the acceptance criterion it sits under says
what that derived experiment has to be true of: "historical experiments remain reproducible
after newer definition versions are published."

That criterion is not free. `SandboxSnapshotService.materialize` **pins** what is already
an immutable published version and **copies** what is not — the shop's order fixtures, which
keep being authored after a recipe is frozen — and it re-runs the ticket and scenario publish
gates against the shop as it reads today (ADR 0019). Starting the same scenario version at
the same seed a week later is therefore honestly a *different* snapshot if an order moved,
and honestly refused if an order was deleted. A replay built on `start` as it stood would
have reproduced the recorded run only for as long as nobody edited the shop, which is exactly
the window in which nobody needs a replay.

There was also nobody to drive it. Customer turns arrive through the participant-driver port,
whose only implementation relays what an operator typed (ADR 0025), so a derived experiment
would open on the ticket's trigger and stop. ADR 0025 recorded the gap and where it would be
closed: "an experiment may record `llm` or `scripted`; nothing can then drive it… the same
shape as ADR 0024's proven-capability catalog, and it belongs with the second driver rather
than ahead of it." This is the second driver.

## Decision

### A replay derives a new experiment and never touches the old one

`POST /shops/{shop_id}/experiments/{experiment_id}/replays` answers 201 with a **different**
experiment: its own row in `experiments`, its own arms in `experiment_runs`, its own clones in
`sandboxes`, and its own turns, attempts, tool events, mutation firings, and spans. Nothing is
written into the experiment it replays, which is what makes the operation legal at all under
ADR 0025's write-once rule.

That also settles the collisions the outcome's neighbours could have caused. A fault's
once-per-arm key is keyed by the *arm* (ADR 0028) and the derived arms are new rows, so the
scenario's faults fire into them exactly as they fired into the originals rather than being
suppressed as already-fired. A judge execution is a record about the arm it scored
(ADR 0031), so the derived arms are simply unjudged until somebody scores them — a verdict is
a model's reading of one arm's brief, and copying it onto a different arm would be inventing
evidence. An annotation is what a reviewer concluded about the run they read (ADR 0036), so a
derived run starts unannotated.

Replaying is deliberately **not idempotent**, for the reason starting is not (ADR 0020,
ADR 0025): the same run replayed twice is two derived experiments. It is the honest shape
here for a second reason too — against a model-backed runtime, two replays of one run are two
different pieces of evidence about that runtime, and collapsing them would delete the second.

### The starting state is reused by identity, never frozen again

`ExperimentService.start` gains one keyword argument, `starting_state`, naming a snapshot to
**clone** instead of materializing today's world. It has exactly one caller.

This is the load-bearing decision of the slice. A snapshot is immutable and identified by its
fingerprint (ADR 0019), so cloning the recorded one is the only way a derived run can claim
the starting state the original had: both derived arms come back at the same
`sandbox_fingerprint` the source's arms did, and the reproducibility criterion is a value an
operator can read on the screen rather than a promise. The tests state the difference the
other way round, which is the honest way to state it: a replay of a run whose order has since
been *edited* still starts in the world the run started in, and a replay of a run whose order
has since been *deleted* still runs at all — where re-materializing would produce a different
snapshot in the first case and a refusal in the second.

`start` checks the snapshot's own `scenario_id`, `scenario_version`, and `seed` against the
command rather than trusting the caller, because those are the columns the experiment row will
carry: a snapshot of another recipe would produce an experiment whose provenance columns
describe starting state it is not in, and the fingerprint beside them could not be used to
tell.

It checks the **tool contract set** too, and that check exists only because of this operation.
The published tool versions are part of the sandbox fingerprint (ADR 0021) precisely so that a
build publishing a newer contract counts as different starting state — but reusing a snapshot
does not re-fingerprint anything, while the `experiment-v1` envelope beside it stamps the
versions *this* build publishes and the runtime runs this build's handlers. A lab upgraded past
the recorded contract set and then asked to replay would therefore write the one record in the
lab whose two fingerprints name two different tool sets, and whose resolution fingerprint
differs from its source in two inputs rather than the one this ADR claims. Materializing cannot
produce that pair, because it stamps both halves from one resolution; only reuse can, so only
reuse refuses it. Reading the frozen set back needed one addition:
`SandboxSnapshotDocument.tool_contracts`, decoded as strictly as the pins beside it.

The setup gate still runs. Everything it asks — the tone override against the shop the
scenario pinned, the closure that disagrees with itself, the faults this build can actually
inject, the dimensions the arms differ along — is a question about published versions and
about this process, and all of it is as true for a derived run as for the first one. What the
gate deliberately does *not* re-ask is the snapshot's own gate against today's orders, and
skipping that is not a loophole: there is no freeze to judge.

### The arms are pinned by content, at the versions the original ran

Each derived arm names the same `(agent_configuration_id, version)` its source arm did, and
carries the same label. Not the newest publication of that configuration: choosing newer
versions is what a **fork** is, the third slice of this outcome, and a replay that quietly
ran one would answer a different question under the old one's name. A history row already
says "newer versions exist" for exactly this reason, and ADR 0034 called it provenance rather
than a warning; this is the operation that makes that sentence actionable.

### The recorded compositions are the script

`replay_script` is a domain reading over the two streams one experiment recorded, in the same
family as `stand_arm` (ADR 0029) and for the same reason — the runner and the reader must not
each work it out. It answers with the compositions the source recorded, each carrying the arms
it reached, the body **each of those arms** received, and how many times that arm's agent was
run on it.

Four things about it are decisions rather than mechanics.

**The trigger is not in the script.** A start writes the pinned ticket's first message into
every arm before any driver is consulted, so that "both arms started from the same question"
is a property of the starting state (ADR 0025). A derived run is opened the same way, and a
script carrying a copy of turn zero could have opened one on words the snapshot does not
contain.

**A composition is replayed as a composition.** One call is one composition however many arms
it reaches, and two calls are two compositions even when the words match — which is the
divergence record, written at delivery because nothing later can reconstruct it. A replay that
delivered per arm would have turned every linked send in the source into two decisions in the
derived run, and no comparison of the bodies could have recovered which it was.

**The order is reconstructed from the ordinals, not from a clock.** An ordinal is a turn's
depth in one arm, so a composition is deliverable exactly when every arm it reaches stands at
the depth it recorded; the script walks the compositions in an order with that property. The
order between two compositions that reached *different* arms is not in the record and does not
need to be — arms are isolated, and what a replay reproduces is each arm's own sequence. Using
`created_at` instead was rejected for ADR 0027's reason: the runner reads a clock once per
attempt and a clock can be stepped backwards, so a second ordering authority would be a second
thing that can disagree. A record admitting no valid order is refused rather than replayed in
some order: that is a gap in one arm's turns, which is corruption rather than something a
derived run should paper over.

**How many times an arm was advanced is part of the script, and it is self-limiting.**
Advancing is idempotent over an *answer* and not over an *attempt* (ADR 0026), so replaying
three recorded attempts is three advances and not a claim that the derived arm will fail
twice: if it answers first time, the other two return that answer and call no model; if it
fails, the next advance is a real retry, which is the thing an operator would do. A turn the
operator moved on from without advancing is replayed as a turn nobody runs, so a skipped turn
survives into the derived record.

### The derived run records `scripted`, and says so in its fingerprint

The participant driver is a recorded input of an experiment because it is part of what
explains a result, and a run half typed by a person and half generated would carry one label
for two things (ADR 0025). A derived run's turns came from a script, so it records `scripted`.

The consequence is named rather than hidden: `resolution_fingerprint` covers the participant
driver, so a replay of a human-driven run has a **different** resolution fingerprint from its
source, differing in exactly that one input (for a source recorded before ADR 0042's
2026-10-27 amendment, possibly in its `comparison_variables` too; that amendment says when). Its
`sandbox_fingerprint` is identical, and that
is the fingerprint the reproducibility claim rests on. Recording `human` on a run nobody typed
would have made the two fingerprints agree by lying about the one thing that genuinely
differs.

`ScriptedParticipantDriver` is infrastructure, like the human driver beside it, and the use
case is handed a factory rather than a class — composition selects drivers
(`docs/architecture.md`), and the application never learns which one speaks the lines. It
holds the lines **per run** rather than one line per delivery, because a composition may have
reached two arms with two different sentences and a driver returning one string would have
flattened that.

### A replay runs the script, through the runner an operator uses

The operation drives the derived experiment to the end of what it read, using
`ExperimentService.deliver_turn` and `ExperimentRunner.advance` — the same two operations the
bench calls. There is deliberately no second execution path: a replay that ran arms its own
way would be a second thing to keep in agreement with what an operator does by hand, and the
evidence it produced would be about the replay rather than about the configuration.

Two costs are accepted rather than designed away. It is one long request — as many model calls
as the source made — because this is a local, single-operator lab and the durable workflow
runtime is a deferred decision the roadmap will not take to demonstrate a feature. And it runs
inside one unit of work, so a replay that breaks halfway leaves nothing rather than a
half-driven experiment nobody asked for; the alternative, keeping the partial run, was
tempting and rejected, because an experiment whose script stopped being applied for a reason
nothing records is a run whose provenance says something untrue about it.

That unit of work is asked to close **before** the response, which no other route in this
codebase asks for yet. A `yield` dependency left on the request stack commits after the
response is on the wire, so a store that refused the commit would leave the caller holding a
201 for an experiment nothing can read. This is the longest write transaction the lab opens, so
its dependency is declared `scope="function"` and the commit is part of what the status code
reports. The sibling write routes have the same shape and much shorter transactions; changing
them is a sweep this slice deliberately did not make.

### What a replay reproduces is the input

Against the declared control runtime a replay reproduces its source call for call: the tests
assert the same answers, the same tool calls in the same order, and the same
`state_fingerprint` at the end. Against a model-backed runtime it will not, and no design here
could make it.

That is a property of the runtime rather than a defect of replay, and it is the point rather
than a caveat. What the lab guarantees is that the derived run was asked the same questions,
in the same world, by the same published configurations — which is precisely what makes a
difference in the answers worth reading. A replay that forced identical output would have to
serve recorded model responses, which would measure nothing about the framework at all.

### Provenance is stored beside the experiments, not inside either of them

`experiment_replays` holds one row per derivation: the derived experiment (the primary key,
because it is derived by the one act that created it), the source, and when.

It is not a field in the `experiment-v1` envelope. That would need an `experiment-v2` and
would put a runtime identifier into fingerprinted bytes, which ADR 0012 keeps out of them —
and it would be false to the envelope's own rule that nothing a run *produces* is in it. It is
not a column on `experiments` either: those columns are read *out of* the document and exist
so a shop's runs can be listed, never as a second source of truth, and where a run came from
has no document to be read out of. The shape is ADR 0036's, one motive over: an annotation is
stored beside an experiment because it is not part of what the run was, and a derivation is
stored beside two experiments because it is not part of what either of them ran.

The reading travels **on** the experiment (`replay_of`) rather than through an operation of
its own, which is where it differs from the annotation. It is a nullable identifier and a
label rather than text nobody asked for, and a derived run that did not say what it derives
from would be missing the provenance this outcome is named for. The source's label is read
from the source row rather than copied at derivation time: an experiment is written once, so
the name it was started under cannot drift, and a copy would be a second source of truth for a
string that has one.

### It is findable and readable through the surfaces that already exist

A derived experiment is an ordinary experiment, so it appears in the bench's per-shop listing
and in the cross-shop history without either of them learning anything new (ADR 0034). Two
things were added rather than inherited. A history row carries `replay_of`, so a listing does
not show a run and its replay as two unrelated experiments that happen to share a fingerprint.
And the bench's composer is replaced, on a run whose driver is not `human`, by the sentence
saying so: the backend refuses a human delivery into a scripted experiment, and a composer
that offered one would invite a request that can only fail — the same rule ADR 0029 applied to
the advance button.

Frame 9's header carries `Replay` beside `Fork…`, and that is where the button is. The frame's
ellipsis is doing real work: fork opens a dialog because it asks which newer versions to take,
and replay does not, because everything it needs is in the record. Frame 10's quick-action
legend names "replay recorded versions", and the row carries it.

## Deliberately not here

- **Fork.** The third slice of this outcome. It derives a new experiment too, and it asks the
  operator which of the pinned versions to move forward — which is a setup screen, a different
  gate, and a different provenance kind. Nothing here forecloses it: it will need its own row
  shape (a source, plus what it changed), and generalizing `experiment_replays` into a
  derivation table with a kind is the fork slice's call to make with two cases in front of it
  rather than this slice's to guess at with one.
- **Replaying with a *different* configuration or scenario version.** That is fork under a
  friendlier name.
- **Naming a derived experiment.** It is called the source's name plus "(replay)", and the
  operation takes no body. An operator who wants another name is asking to fork, or can be
  given a label field the day one of them asks for it.
- **A partial replay, or resuming one.** A replay that fails leaves nothing, as above. If the
  cost of a long request becomes real — a scenario with a long script against a slow provider
  — the answer is the deferred durable-runtime decision rather than a half-applied script the
  record cannot explain.
- **Replaying an arm rather than an experiment.** An experiment's whole claim is the pair, and
  a derived run holding one arm of a two-arm comparison would be a different experiment
  wearing this one's provenance.
- **Showing an experiment its own replays.** A derived run names its source; a source does not
  list what has been derived from it. Neither the reading nor an index on the source column is
  here: an index for a query that does not exist is the speculative structure this codebase
  refuses ahead of its caller, and both are one small addition the day a screen wants them. The
  repository has `get` and `save` and no listing for the same reason — history reads a derived
  row's origin through the same `get_experiment` it projects every other column from.
- **Refusing to replay a run that is still being driven.** The script is what the record holds
  at the moment it is read, and a replay of a half-driven run reproduces the half. Refusing
  would need a status rule over a record that deliberately has no status (ADR 0029).
- **Re-scoring the judged rows of a derived run.** Scoring is its own operation and stays one;
  a replay that judged itself would be deciding on the operator's behalf which judge version to
  compare against.

## Verification

- Domain tests (`test_experiment_domain.py`) cover the script as a reading: the trigger kept
  out of it, one linked send replayed as one composition and an arm-only send as one that
  reaches one arm, the per-arm body a divergent composition carries, the turn nobody advanced
  scripted with no advance, a failed attempt and its retry counted as two advances, the
  compositions ordered so that every arm stands where it recorded, and the four records that
  cannot be replayed — a hole in a thread, an arm that was never opened, an attempt stream per
  arm that does not match the threads, and an experiment with no arm.
- Replay tests (`test_experiment_replays.py`) cover what is reused and what is re-run: the
  derived run cloned from the source's own snapshot after an order has been *edited* since,
  the same run replayable after that order has been *deleted* — the two cases that decide the
  reuse-versus-refreeze question — the configuration version pinned against a newer
  publication, the new arms over new sandboxes, the recorded threads reproduced turn for turn
  in both arms, the linked send that stays one composition beside the arm-only send that stays
  one arm's, the derived driver recorded as `scripted` with the resolution fingerprint moving
  and the sandbox fingerprint not, the control runtime replaying an arm call for call to the
  same state fingerprint, the arm nobody ran left unrun, the scenario's fault firing again into
  the derived arm without colliding with the source's firing, a retried turn advanced as often
  as it was advanced without claiming the derived arm will fail, a derived arm whose framework
  keeps failing recording every advance the script asked for and still owing a reply, the source
  left as it was — its record, both streams, its tool and fault events, its arms' fingerprints
  and revisions, and its recorded spans — the verdicts and annotations kept on the run they were
  made about and absent from the derived one, the provenance naming the source and a replay of a
  replay naming *its* source, one run replayed twice as two experiments, the derived run in the
  shop's listing, the experiment of another shop refused, the snapshot that does not describe the
  command it was handed to, and the snapshot frozen against a tool contract set this build no
  longer publishes.
- Contract tests (`test_experiment_api.py`) drive the operation: the 201 carrying a new
  experiment with the source's snapshot and fingerprint and the provenance object, the arm the
  source ran re-run and the arm it did not left waiting, the recorded composition reaching the
  derived thread as one composition with `scripted` on its turns, the replayed experiment
  answering byte for byte what it answered before, the derived run in both the shop listing and
  the cross-shop history with its `replay_of` beside a source whose own is null, the experiment
  of another shop answered 404, and a store that refuses the commit answering 500 with nothing
  stored rather than 201 with an identifier nothing can read.
- A migration test (`test_migrations.py`) holds the store to what the service cannot produce,
  over the engine the application actually uses so both foreign keys are live: an experiment
  derived twice, an experiment derived from itself, and either end naming an experiment this
  lab never ran.
- An envelope test (`test_sandbox_snapshot.py`) covers the tool contract set read back off a
  stored snapshot, and a drifted version refused by its path rather than dropped.
- Frontend tests (`Experiments.test.tsx`, `History.test.tsx`) cover the surfaces: the results
  header deriving a run and opening what it produced rather than staying on the old one, the
  derived screen naming and linking the run it replays, a refused replay reported without
  leaving the run being read, the bench offering no composer on a run a script drove and
  naming the run that drove it only where there is one to name — an experiment may be started
  under a driver by hand — the history row naming its source while the source's row carries no
  marker, and the row's quick action replaying and leaving the listing for the evidence it
  produced.
- The Playwright journey (`experiment-start.spec.ts`) is extended rather than duplicated, as
  every slice since ADR 0026 has been: after finding the incident again in history and opening
  its evidence, the operator replays it, and reads the derived run reaching the same place —
  the arm driven to the recipe's cap, the arm still holding the turn only it received, the
  read-check missed again — with no judge verdict on it, and follows the provenance link back
  to the run it reproduces.
- No new live-model test. A replay makes exactly the model calls an advance makes, and this
  journey runs the declared control runtime.

## Migration

`20260907_0019` adds `experiment_replays`, foreign-keyed to `experiments` at both ends, with
the distinctness check above and no index of its own. Nothing is backfilled and nothing
existing is touched: every experiment run before this slice reads back exactly as it did,
reporting no origin because it has none.
