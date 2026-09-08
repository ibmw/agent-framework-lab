# ADR 0042 — The wrong-address incident run by two frameworks, and what that proves

Status: accepted — 2026-09-08

Amendment: 2026-09-08 — `tests/incident_script.py` and `tests/incident_runtimes.py` are now
`infrastructure/agents/scripted/incident.py` and `infrastructure/agents/scripted/runtimes.py`,
named below at the paths they were written at. They moved out of the test tree unchanged so
that the demo seed could compose them as well (ADR 0043); nothing this record asserts about
what they do, what they prove, or what they deliberately cannot prove is affected. The one
consequence worth noting is that their two SDK imports now sit in the source tree, so the
isolation sweep names the runtime file explicitly — and the structural check that the
declaration beside it reaches for no framework reads the module it imports rather than a
sibling path.

Closes `docs/PLAN.md` Milestone 6's last outcome — "prove the wrong-address scenario in a
two-arm comparison" — and with it the milestone and the last open implementation outcome on
this roadmap. It consumes ADR 0041's second framework, ADR 0025's experiment envelope and
setup gate, ADR 0022's proposal-and-confirmation write, ADR 0028's bound faults, and every
reading the evidence model serves: the normalized timeline (ADR 0027), the deterministic
evaluation (ADR 0030), the cost and usage reading (ADR 0032), the state diff (ADR 0035), and
the recorded traces (ADR 0037).

It is an evidence slice in ADR 0023's sense — what it mostly adds is what the lab's central
claim is checked against. It is not only that, because running two frameworks over one
incident found a defect that only a two-arm run could find: the two arms' models were being
shown the same tool results in two different notations. One production change goes with it.

## Context

The lab's original question is whether two agent frameworks, given the identical incident and
the identical tools, behave differently in ways the evidence model can actually attribute.
Everything needed to ask it has been built and, until this slice, never asked. ADR 0041 put a
second framework behind `SupportAgentRuntime` and swept the two for shape agreement one
adapter at a time, against a stub invoker. What it deliberately did not do is run an
*experiment*: one snapshot, two arms, a fault, a write, and six readings taken side by side.

The distance between those two things is the whole of this slice. An adapter sweep asks
whether a framework's answer has the right shape. A comparison asks whether the lab can put
two of them beside each other and say what differed — which is a question about the runner,
the invoker, the fault schedule, five projections, one stored trace, and the public contract
that serves them, none of which had ever had two frameworks to read.

### Determinism is the problem, and it decides what can be claimed

`make check` runs offline with no provider key, and a comparison whose arms are deterministic
stand-ins proves the plumbing rather than the frameworks. That tension cannot be resolved; it
can only be split honestly, and the split is this ADR's main decision.

Neither offline model the adapters ship can do the incident. Pydantic AI's `TestModel` and the
scripted model beside it both call every offered tool once with arguments sampled from the
tool's own schema — the right double for proving a tool survives the round trip, and the wrong
one for proving an incident was resolved. A confirmation cannot be sampled: it is issued by a
proposal and has to be read back out of it (ADR 0022). An arm driven by either double never
redirects anything, so the state row is never met, the fault lands in a world nobody was
changing, and the state diff is empty in both arms — a comparison of two arms that did nothing.

## Decision

### The incident is declared once, and each SDK's own model seam is driven from it

`tests/incident_script.py` holds the wrong-address incident as a sequence of calls: read the
interaction context, read the order, read the shipping policy, read the customer, propose the
redirect to the address on file, and apply the confirmation the proposal answered with. Each
step's arguments are a function of what this turn has already been told, so the proposal names
the address the profile reported and the apply presents the confirmation the proposal issued —
and a step whose arguments cannot be filled is skipped rather than sent, which is how the
declared control policy already behaves. `tests/incident_runtimes.py` turns that one
declaration into each SDK's own offline model: a `FunctionModel` for Pydantic AI, a
`ScriptedModel` for the OpenAI Agents SDK. Everything else in both arms is the real adapter —
the schema derivation, the wire naming, the serial execution, the history mapping, the usage
accounting, the failure translation.

The declaration imports no SDK, and a test asserts it, because that is what the arrangement is
for: the two arms' **decisions** are identical by construction. That is a limit and a
guarantee at once, and it is what makes the offline half falsifiable rather than decorative.

**What it therefore proves.** Given identical decisions, everything the lab records about an
arm has to read the same. Any difference in the tool events, their versions, their outcomes,
the normalized stream, the span tree, the rule-decided rows, the field-level diff, or the shape
of the cost reading would be a difference between two *integrations*, and nothing a reviewer
could attribute to either framework. The suite asserts that none of them differ — not by
listing the fields that matter, but by comparing each reading with every leaf replaced by the
name of its type, so a field authored tomorrow joins the comparison without an edit (the
mechanism ADR 0040 used for "unchanged").

**What it cannot prove.** That two *models* choose differently, and that the evidence model
attributes such a difference correctly. No offline run can show it, and nothing in this slice
should be read as having shown it. What a live run would add is stated below.

### The scenario is the whole incident, not a fragment of it

One published recipe on the wrong-address ticket, with two objectives and one fault: a
read-check on the shipping policy (ADR 0030's event evidence) and a state check on the order's
shipping address (its state evidence), plus the concurrent entity mutation bound to fire the
first time an arm reads the order.

Two objectives rather than one because they are decided by different readings — a call that
answered, and a world that moved — and an incident proved only by what an arm *asked* would
leave the write half of the comparison untested. The fault is bound before the redirect rather
than between the proposal and the apply, so the incident stays winnable: the order goes from
unfulfilled to partially fulfilled and can still be redirected, which is what ADR 0028 built
that applier to do. The refusal path is covered anyway, and by the arms themselves — a second
customer turn drives the whole script again against a world where the redirect has already
happened, and both arms' proposals are refused, identically, because the order already ships
where they ask.

Two customer turns rather than one for a second reason: the follow-up is the only place each
adapter's own mapping of the arm's thread onto its SDK's message shape is exercised inside a
real run, and it is what gives the timeline two arms at a shared composition depth to
interleave.

### The arms differ in the framework and in nothing else, and the gate agrees

Both arms adopt the same published support identity, the same model settings, the same prompt,
the same tool bindings and the same architecture, because every one of those is a dimension
ADR 0025 counts. The comparison matrix is asserted whole — every dimension, agreeing ones
included — with exactly one differing row, and the setup gate's multiple-comparison-variable
warning is asserted **absent**, which is the gate agreeing that whatever these arms do
differently is attributable to the framework.

### The defect: two arms were shown the same facts in two notations

A tool answers with a `tool-result-v1` document, and the adapter hands it to the SDK, which
turns it into the text the provider actually receives. Each SDK has its own rule for that and
they disagree. Pydantic AI serializes a returned object as JSON, in the order the handler
happened to build it. The OpenAI Agents SDK converts anything that is not already text with
`str(output)` — Python's repr, because a `tool-result-v1` document carries no `"type"` key for
its structured-output detection to recognize. So one arm's model was reading
`{"applied":false,"confirmation":"…"}` and the other's was reading
`{'applied': False, 'confirmation': '…'}`.

The blast radius is slightly wider than the repr, and worth naming: the fix moves the *Pydantic
AI* arm too. Its rendering was already JSON, but insertion-ordered, and canonical text is
sorted — so both arms' model input changed, which is the honest way round for a fix whose whole
claim is that neither arm is shown a rendering the other is not.

This is exactly the class of confound ADR 0041 went looking for and found three of — strict
schemas rewriting `required`, `parallel_tool_calls` changing the request, an SDK relabelling
the lab's own errors — and it is the one that got past an adapter sweep, because a sweep
against a stub invoker never looks at what the model was *shown*. It would have been invisible
in a live run too, in the sense that nothing would have failed: the two arms would simply have
been asked slightly different questions, and every difference in what they did would have been
attributed by the metrics card, the timeline and the results screen to the framework.

The fix is the same shape as the one ADR 0041 made for the question. `tool_json_schema` already
existed so that "both arms were offered the same tools" is a property rather than a
resemblance; `tool_result_text` joins it so that both arms were shown the same *answers*. It is
the lab's own canonical serialization — sorted, unspaced, NFC-normalized, and already "the
single definition of what canonical serialization is" — so the text an arm was shown and the
bytes the record is fingerprinted from are the same bytes rather than two renderings of one
object. Both adapters call it and return text, which every SDK passes along untouched.

Rendering it in the lab rather than fixing the one adapter is deliberate: a rule that lives in
one adapter holds until the next SDK arrives with a third convention, and the next author is
now told to render rather than to check (`docs/adding-agent-framework.md`).

Reusing the fingerprint's own serialization has a cost that is worth writing down rather than
discovering later. It couples two things that had no reason to move together: from here on, a
revision of the canonical serializer silently changes what every arm's model is shown, and any
wish to change the model-facing rendering — dropping `canonical_schema_version` from what the
model reads, spacing it for legibility, trimming it for token economy — is a decision about the
bytes a snapshot is identified by rather than a presentation choice. The coupling is contained
in the direction that matters for a comparison, because both arms move together and neither can
drift from the other, and ADR 0023's recorded fingerprints already fail loudly if the serializer
moves at all. But an author who wants the two to differ will have to separate them deliberately,
and should read this paragraph before deciding the rendering is theirs to change.

### The record names a framework only where it declares one

"A framework-specific event never reaches the shared evidence contract" is asserted over the
stored and projected surfaces together — tool events, fault events, the timeline, the spans,
the diffs and the evaluation — swept against *every* framework `PROVEN_FRAMEWORKS` declares
rather than against the two under test, so a third is checked the day it is published.

It is asserted once more over HTTP, because "public contract" is a statement about what a
client receives, and there the rule is not that the word never appears. An arm's runtime block
and a trace both declare which framework ran, and the comparison matrix's framework row is the
setup gate saying out loud what these arms differ in. So the test collects every text leaf
whose value is a declared framework and asserts the *keys* they sit under: `framework_id` and
the matrix's `values`, and nothing else. A tool event, a span, a timeline entry or an
evaluation row that named one would fail it.

The project-owned source location ADR 0027 publishes is the interesting near-miss and is
allowed on purpose: an agent turn's location is `…/agents/pydantic_ai/runtime.py`, which names
the *adapter*, which is this project's own code and the thing frame 9c exists to point at. It
is also, as it happens, one of the three things the record leaves free to differ.

### What is free to differ is asserted to differ

A comparison that could only show two arms as identical would be worth nothing, so the suite
asserts the three places the record does tell them apart: the framework each arm's pinned
configuration declares, the project-owned adapter the timeline resolves for each arm's turns,
and what each SDK metered for itself. The last is a real difference produced by the frameworks
rather than by the script — Pydantic AI's offline model estimates its usage from the messages
and the scripted model reports a declared figure per call — and it is the column a live cost
comparison would read.

The cost reading's own distinction is asserted at the one moment it is visible: before either
arm is advanced, the metrics say `None` rather than zero, because zero is a measurement and it
is the one the control arm's reading means (ADR 0032).

### Isolation is held across frameworks, not within one

Both arms' sandboxes carry the snapshot's fingerprint and one identical starting-state
fingerprint at revision zero. Advancing the first arm redirects an order and fires a fault into
its world; the second is asserted to be byte-identical to where it started, at revision zero,
with an empty diff — and to move only when it is advanced, without disturbing the first.

The write path is comparable across the two by construction: a confirmation names the change by
its content and deliberately not by the arm (ADR 0022), so both arms mint the same string from
the same starting state, and each applies it in its own world. That the same string authorizes
nothing in the arm beside it is a property of the proposal store rather than of a framework,
and `test_sandbox_address_change.py` holds it there rather than here.

## What only a live run can show, and what it would take

Stated plainly, because the outcome cannot be fully proved without a credential and this ADR
does not claim it was.

The offline comparison establishes the evidence model: that two frameworks making the same
decisions leave evidence identical in shape and vocabulary, that what each contributed is
separately attributable, that neither arm can reach the other's world, and that no SDK's own
vocabulary reaches the public or stored contract. It establishes nothing about how the OpenAI
Agents SDK and Pydantic AI differ when a real model is choosing: which tools each arm reaches
for, in what order, whether either proposes without reading, how many provider calls each
framework's loop costs for the same work, and what that is worth at the published rates.

There is a second limit, narrower and easier to miss. Both doubles sit at each SDK's *model*
seam, which is where a framework hands over and a provider client takes on. Everything below
that seam is therefore unexercised offline: how each SDK places the instructions, what item
shapes it wraps a tool call and its result in, and every request field it sets that the two
ADR 0041 named are not. So "both arms were asked the same question" is established at the
model interface and not on the wire, and `tool_result_text` guarantees the same text is handed
*down* rather than that the same bytes leave the process. The live smoke suite is the only
place this build reaches the wire at all, and closing that gap properly would mean recording
what each framework actually sent — which is a slice, not a sentence.

What that needs is not another assertion. It is the product: publish the two configurations,
start the experiment with a credential configured, drive both arms from the bench, and read
frame 9 — which is precisely what every surface this slice exercised was built to serve. A
scripted assertion could not settle it anyway, because a model's choices are not deterministic
and the finding is a person's reading of two records, which is what `docs/PLAN.md`'s "factual
report, never a global score" has meant since Milestone 6 was written.

**No live comparison test was written here, and ADR 0041's live smoke tests were not run in
this slice.** They stay gated on `AGENT_LAB_RUN_LIVE_MODEL_TESTS` and a local credential, both
read from the *process* environment — so a value sitting in `.env` does not enable them, and
running them stays the explicit act `docs/m2-provider-and-test-policy.md` describes. Whether
either has been executed since remains what it was made to be: an operator's decision, recorded
in an ADR where it can be dated, rather than something a suite reports. Writing a
second credential-gated suite that constructs a whole experiment, and shipping it unexecuted,
would add unverified code to make an unverifiable claim look covered.

## Deliberately not here

- **A judge in the comparison.** The judged rows are ADR 0031's and their independence is
  ADR 0040's; scoring both arms would have added a second nondeterministic reader to a suite
  whose entire value is that it holds everything but the framework still.
- **A golden record of the two arms.** Tempting, and wrong for this: the recorded fingerprints
  ADR 0023 established pin a *starting state*, which is stable by construction. A run's record
  carries identifiers and durations, so a golden over it would either be mostly masked or would
  fail on every unrelated change — and the comparison the suite makes is between the two arms,
  which is the assertion that actually means something.
- **A Playwright journey.** No frame, route, schema or component moves. The Studio already
  reads its framework list from the capability catalog, and the two-arm bench, the results
  screen and the history row are covered by the journeys that landed with ADRs 0033–0039.
- **A second architecture.** Still one member of `AgentArchitecture`, still for ADR 0024's
  reason. LangGraph remains the named candidate (ADR 0041).
- **A third framework.** Every sweep this slice adds is driven from `PROVEN_FRAMEWORKS`, so one
  would join them or fail them; adding one to make the comparison wider would be a second
  variable in a slice about holding variables still.
- **Any new public contract.** No route, schema, stored format, migration or fingerprint moves.
  `packages/contracts` is unchanged.

## Verification

- `test_framework_comparison.py` runs the whole thing: one published recipe, one snapshot, two
  arms differing only in framework, both driven through the trigger and a follow-up. It asserts
  the comparison matrix has exactly one differing dimension and the setup gate raises no
  warning; both arms making the identical call sequence under published names and versions,
  succeeding through the redirect on the trigger and being refused the second proposal
  identically; both answering every turn first time; the fault firing once into each arm after
  the same call; the normalized timeline reading the same stream entry for entry in the lab's
  own vocabulary; the span trees agreeing in kind, count and joined tool while sharing no span
  identifier; both objectives met in both arms; the same fields moving in both diffs, including
  the address the arm changed and the fulfilment the fault advanced; and a cost reading that is
  measured and above zero in both — with the unmeasured case asserted separately, before either
  arm has run.
- Isolation is asserted in the same suite: one snapshot fingerprint claimed by two sandboxes,
  advancing one arm leaving the other byte-identical at revision zero with an empty diff, and
  both arms minting the same confirmation and applying it only in their own world.
- Leakage is asserted twice, once over the readings and once over HTTP, both swept from
  `PROVEN_FRAMEWORKS` rather than from the two names under test, with the served form asserting
  the *keys* a framework may appear under rather than that it never appears.
- Attribution is asserted as its own property, because a suite that only proved the arms
  identical would pass while the record had lost the ability to tell them apart.
- The sweep asserts itself against the catalog — the frameworks it runs are exactly the
  model-backed entries of `PROVEN_FRAMEWORKS` — and the incident declaration is asserted to
  import no SDK, so neither arm can acquire a decision of its own.
- `test_agent_runtimes.py` gains the fix's own test: both frameworks are run with a probe at
  their model seam and the text each was shown is asserted to be exactly `tool_result_text` of
  the document the invoker returned, and then to be identical between them. Run against the two
  adapters as they were, it fails on the Pydantic AI arm first — reporting its insertion-ordered
  JSON against the sorted text — and on the Agents arm with the repr, which is both renderings
  the fix replaced rather than only the one that motivated it. Each probe asks the SDK what it
  would put in front of the provider rather than filtering the part for text, deliberately: a
  probe that kept only strings would have seen nothing at all from an adapter returning the
  document, and the turn would have run the tool until the budget was spent — a failure that
  says nothing about a rendering.
- The full suite passes offline with no provider key. The live smoke suite was not run.

## Migration

None. No table, column, canonical document, fingerprint, tool contract, published version or
HTTP contract changes. `tool_result_text` changes what a model is *shown* during a run and
nothing about what is recorded, so an experiment recorded before this slice reads back
identically and a snapshot frozen before it is the same starting state after it.
