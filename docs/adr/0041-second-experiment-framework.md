# ADR 0041 — The second framework, and what had to be true before it could be compared

Status: accepted — 2026-09-08

Implements `docs/PLAN.md` Milestone 6's first four outcomes: the choice of what the first
controlled comparison changes, a second framework behind the shared target contracts, evidence
from it that is indistinguishable in shape from the first's, and this record of the glue code,
the constraints, and the behavior actually observed. Records why the comparison changes the
**framework** rather than the architecture, why the framework is the **OpenAI Agents SDK**, what
each rejected candidate would have cost, the JSON Schema derivation both adapters now share, the
four places the SDK's own opinions had to be overridden, and the capability the catalog
deliberately does not claim for it.

The fifth outcome — the wrong-address scenario proved in a two-arm comparison — is not here. It
is the slice that *consumes* this one, and mixing it in would have made a review of the adapter
into a review of an experiment.

## Context

`SupportAgentRuntime` has had two implementations since ADR 0026, and only one of them is a
framework: the declared control policy is the lab's own code, written to make the rest of the
lab falsifiable. So the port has never actually been asked the question it exists to answer —
whether a second SDK fits behind it without the port bending, and whether what comes out the
other side reads the same.

ADR 0026 built both of its runtimes in one slice for a stated reason: "a port shaped by a single
adapter written to fit it would be shaped by a hypothetical". That argument only half survives
contact. Two adapters written by the same person in the same afternoon against the same
requirements are still one design. The port has been vindicated exactly once by something it was
not designed alongside — which is what this slice is.

Everything that would consume a second framework is already built and, for framework
comparison, unused: the recording invoker (ADR 0026), the normalized timeline (ADR 0027), the
metrics and the neutral usage shape (ADR 0032), the objective-by-objective comparison
(ADR 0033), the anonymized judge brief (ADR 0031, ADR 0040), the span tree (ADR 0037), and the
fork that moves one arm's configuration and nothing else (ADR 0039). None of it has ever had
two frameworks to read.

## Decision

### The first controlled comparison changes the framework

Milestone 6's first outcome is a choice between a second framework and a second architecture.
It is a second framework, for three reasons that point the same way.

The lab's whole vocabulary is already built for it. `PROVEN_FRAMEWORKS` is keyed by framework,
the judge's reserved rubric terms are derived from it, the history listing filters by it, and
ADR 0025's comparison-variable warning names *framework* as a dimension an experiment moves.
`AgentArchitecture` meanwhile has one member, and ADR 0024 refused to add a second before an
implementation existed — precisely so that nobody could publish a configuration nothing can run.
Changing the architecture first would mean inventing the second member, the runtime behind it,
and the comparison, in one slice.

A framework comparison is also the smaller claim, and therefore the better first one. Two
frameworks on the same provider, the same model, the same prompt, the same tools and the same
support identity move exactly one dimension. An architecture comparison moves a dimension the
lab has never held anything else constant against, and it would be the first evidence produced
by machinery that has never been checked against a second reader of any kind.

And it is what the product direction asks for first: the lab "compares agent frameworks and
agent architectures", in that order, and V1's boundary is one complete journey run by "one or
two agent variants". A second framework is the variant the rest of the system was built around.

### The framework is the OpenAI Agents SDK

Rejections first, because the roadmap named a candidate and it is not the one chosen.

**The Vercel AI SDK is rejected, and not for being inconvenient.** It is a genuinely good
comparison subject and the roadmap named it. The problem is where the lab's guarantees live. The
backend is Python, and every structural promise this port makes is a property of the *call path*:
the invoker is bound at construction to one arm, one actor, one tool set and one budget, it is
the only way to the world, and it is what writes the tool event — which is what makes "a
framework-specific event never leaks into the shared evidence contract" structural rather than a
rule somebody keeps. Running a TypeScript framework means a Node process, a request protocol
carrying tool calls back into Python, and re-establishing every one of those properties across a
process boundary. The first arm's evidence would then differ from the second's in latency, in
failure modes, and in what an interruption leaves behind — and none of those differences would be
attributable to the framework. The lab would be comparing its own bridge. The honest condition
for reconsidering is explicit: when the lab wants to compare a *TypeScript runtime as such* and
is willing to own the bridge as the subject of the comparison rather than as an accident of it.
That is a milestone, not a slice.

**LangGraph is rejected for this slice and named as the candidate for the next dimension.** It is
Python-native and would have fit behind the port. But what is distinctive about it is the graph —
explicit state, checkpoints, interrupts — and running it as a single-agent tool loop compares the
least interesting thing about it while paying its dependency weight. It is the natural first
*architecture* comparison, and spending it as a framework comparison would waste it.

**smolagents is rejected** because a code-writing agent is an architecture change too, and one
that brings a code-execution sandbox question the lab has no reason to answer yet. **CrewAI and
AutoGen are rejected** because they are multi-agent frameworks and `AgentArchitecture` has one
member: publishing a configuration for one would be publishing something the lab cannot honestly
say it ran. **LlamaIndex is rejected** because its agent loop is secondary to a retrieval story
this lab does not have. **A hand-written provider loop was considered and rejected** as a second
control rather than a second framework — the lab already has one control arm, and its value is
that it is *declared*, not that it is thin.

The **OpenAI Agents SDK** is selected. It is Python-native and sits beside Pydantic AI without
disturbing anything. Its primary shape is the single-agent tool loop, which is the architecture
the lab has proven, so the comparison is about how two frameworks run the *same* shape. It takes
an explicit JSON Schema per tool, so ADR 0021's argument table drives it rather than a
transcription. It meters its own run in exactly the three counts ADR 0032 asks for. It ships a
deterministic model of its own (`agents.testing.ScriptedModel`), so `make check` stays offline
with no provider key. And — the decisive property — it reaches the same provider through the same
Responses API on the same model the lab has already published rates and a capability entry for,
so a two-arm run moves the framework and nothing else. A framework requiring a different provider
would have confounded the first comparison the lab ever makes.

### The JSON Schema is derived once, for both frameworks

ADR 0021 declared the argument table so an adapter would generate its schema rather than author
it. With one adapter that was a rule about provenance. With two it becomes a question about
whether both arms are asked the same thing, so `application/tool_json_schema.py` renders the
table and both runtimes hand their SDK the same document. Deriving it twice would have left "both
arms were offered the same tools" as a similarity two files happen to keep.

What stays per adapter is genuinely per-SDK: the name a provider will accept, how the schema is
attached to a tool object, and whether the SDK validates arguments against it before calling.

### Four places the SDK's opinions had to be overridden

Each of these is a real constraint met while writing the adapter, and each is a line of the
lab's own code that exists because the SDK's default was wrong for an evidence record.

**Strict function schemas are off.** The SDK's strict mode rewrites a schema so every property
appears in `required`. The lab's contracts declare optional arguments — `catalog.search_products`
takes an optional `limit`, `support.search_knowledge` an optional `kind` — and advertising them as
mandatory is the dialect editing the contract. It would also have changed what the model is asked
in one arm and not the other, which is the difference between comparing frameworks and comparing
schemas. So the contract's own `required` list is what ships, and an argument the model gets wrong
is refused by the tool with a code it can act on, which is where ADR 0021 already put argument
mistakes.

**Anything a tool raises comes back relabelled.** A tool that raises what the SDK does not
recognize surfaces as its own `UserError("Error running tool …")`, with the original on
`__cause__`. The adapter re-raises that cause untouched, whatever it is, and reports the
framework failing only for a `UserError` carrying nothing.

Two things travel that path and both are ruined by naming them here. The lab's spent tool budget
is a finding about a setting an author chose, and recorded as `framework` it reads as the lab
breaking. And `SandboxToolService` raises a `DefinitionResolutionError` when the arm, its
snapshot, or a version it pinned has gone — which the runner deliberately re-raises *without
recording anything*, because "recording it here would put a broken lab into a comparison as this
framework's behavior" (ADR 0026). An adapter that renamed it took that decision away from the one
place entitled to make it, and did so in one arm only: the same fault propagates cleanly out of
Pydantic AI, so a database that broke mid-call would have read as an infrastructure error beside
one arm and as a framework failure in the other. The same goes for an exception the lab has no
name for at all — the runner logs its type and records `framework`, once, rather than each SDK
deciding for itself and skipping the log.

Both are held by a sweep over every runtime, asserting the escaping exception is the same object
rather than the same class: an adapter that caught one and raised its own equivalent would pass a
type check while having taken the decision anyway.

**Tool calls are serialized in the SDK, and deliberately not at the provider.**
`max_function_tool_concurrency=1` makes the SDK start each call only after the previous one
returned. A write is guarded by the revision it was proposed against (ADR 0022), so racing calls
would refuse each other for no reason the agent could act on, and the recorded sequence is meant
to be the order the agent asked rather than which call returned first.

The SDK also offers `parallel_tool_calls=False`, which it forwards to the provider whenever tools
are offered, and it is **not** set. Pydantic AI's `sequential=True` is an executor setting that
emits no such flag, so sending it here would ask the two arms' model two different questions: one
arm free to emit three reads in one response, the other forbidden to and needing three model
requests for them — more requests, more cost, more duration, more budget spent, every one of it
attributed by the metrics card to "the framework". That is the same argument that turns strict
schemas off, applied to the request rather than to the tool. The SDK-side limit already gives the
lab everything it needs, and the ordering test passes through that path alone.

**The SDK's own tracing is disabled process-wide.** It exports spans carrying tool arguments and
model output to a provider endpoint by default. `docs/observability.md` says a framework's own
instrumentation is never swept into the record, because the lab cannot promise the sanitization
of an attribute it did not write. Ignoring those spans would not have been enough — they were
leaving the process — so composition switches them off at the moment it decides this framework
runs here.

### The offline model is the SDK's; the script it follows is the lab's

Pydantic AI ships a `TestModel` that drives itself: it calls every tool it is given and answers.
The Agents SDK ships a `ScriptedModel` instead — a deterministic model at the same
provider-neutral seam, driven by a script the caller supplies. So `for_test()` here is about
forty lines rather than one: a responder that emits one call per offered tool, filling each
argument from that tool's *own* `params_json_schema` so what a call carries is what actually
survived the round trip through the SDK's tool object, and then a final message.

The script is written to match `TestModel`'s behavior on purpose. It is the largest piece of
project-owned code this framework needed, it lives beside the adapter because composition
selects it when the environment is `test`, and it is the one place where the two runtimes'
offline evidence could have diverged for a reason that is about the test doubles rather than
about the frameworks. Where they still do — Pydantic AI's model fills only some optional
arguments, this one fills them all — the conformance sweep asserts the *shape* rather than the
values, because pretending two test doubles behave identically would be asserting the wrong
thing.

### The two frameworks meter themselves differently, and the record says so

Pydantic AI counts tool calls and enforces a limit; the OpenAI Agents SDK counts model requests
and enforces a turn ceiling. Ten calls emitted in one turn are one turn to it, so a configuration
allowing a single tool call finishes against an invoker that never says no.

That is exactly why ADR 0026 put the budget on the invoker rather than trusting each framework's
own limit, and it is now a fact with a test rather than a prediction. Each SDK's own limit is
still configured from the same authored setting — a tool-call allowance for one, a turn ceiling of
`max_tool_rounds + 1` for the other — and both report exceeding it as `tool_round_limit` rather
than as a provider fault, because in both cases the run used what an author allowed it.

Usage crosses the port in ADR 0032's neutral shape from both. Neither reports `None`: both SDKs
meter themselves, and both are asked only for the three counts every provider bills in. What the
Agents SDK also knows — cached input, reasoning tokens, a per-request breakdown — is dropped,
which is not lost evidence but evidence the lab does not claim to compare.

### The catalog declares less for this framework than for the others, on purpose

`PROVEN_FRAMEWORKS` now has three entries, and the new one claims `tool_calls`,
`conversation_memory` and `session_resume` — not `structured_output`.

The two existing entries claim it because they implement the POC's `AgentAdapter`, which returns
a typed support result. The new framework implements only `SupportAgentRuntime`, and that port
answers with **text**: every fact an arm touched is already the tool event that produced it, and
asking a model to restate them would make the evidence depend on the model's honesty about its
own behavior (ADR 0026). The SDK can certainly return a typed object. The lab has never asked it
to, and a catalog that said otherwise would be repeating a feature list instead of recording what
was run.

That split has a second effect worth stating: the agreement test between the catalog and the code
now checks a *union* — every declared framework has an implementation behind one port or the
other — and only the frameworks with a conversation adapter are held to that adapter's declared
capabilities. A framework can now reach the catalog through the runtime port alone, which is what
`docs/adding-agent-framework.md` has told the next author to do since it was written.

### Composition registers both model-backed frameworks together

They reach the same provider under the same credential, so they appear and disappear together: a
lab with no `AGENT_LAB_OPENAI_API_KEY` runs the control arm alone, and an arm neither can run is
refused when it is advanced rather than recorded as a failed turn. The catalog is unaffected by
any of that, for ADR 0024's reason — what an author may publish must not change with the machine
the Studio runs on.

## Deliberately not here

- **The two-arm wrong-address comparison.** Milestone 6's fifth outcome, and the slice that
  consumes this one. What it needs from here is a second framework whose evidence is readable
  beside the first's; what it adds is an experiment, its Playwright journey, and the reading of
  what the two arms actually did differently. Reviewing them together would have meant reviewing
  an adapter and an experiment as one thing.
- **A live-model run of the new framework.** The smoke tests are written, swept over both
  model-backed frameworks, and gated on `AGENT_LAB_RUN_LIVE_MODEL_TESTS` and a local credential
  exactly as the existing one was. No credential was available in this slice, so they have not
  been executed here, and this ADR claims only the offline evidence below.

  That forced a distinction ADR 0024 had left implicit and is amended for. Its catalog defined
  "proven" as having run the combination, and a new entry listing a provider and model nothing
  had called with would have quietly weakened the word for every entry. But "has anyone made a
  live call" depends on a credential, which is the machine fact the catalog was separated from
  the adapter registry to keep out — a table that answered it would refuse a publication the day
  a key expired. So the two halves of an entry now say different things: a **capability** is
  proven in the strong sense, with an implementation and a suite that keeps exercising it
  offline, while a **provider and model** is the combination the framework is published for and
  the live smoke tests are written against. Where a framework has actually been run live is
  recorded here, dated, which is this paragraph. The live sweep asserts each framework is asked
  on a combination the catalog declares for it, so the published-for claim has a test rather
  than a convention behind it.
- **A second architecture.** Still one member of `AgentArchitecture`, still for ADR 0024's
  reason. LangGraph is named above as the candidate when that dimension is opened.
- **Framework-internal source locations.** ADR 0027 resolves project-owned symbols and answers
  `None` for everything else, and this adapter is project-owned code like the other. Nothing about
  a second framework changes that, and the product direction defers visualizing SDK internals.
- **Any new public contract.** No route, schema, stored format or migration moves. The new
  framework is one more value of an existing `framework_id`, and `packages/contracts` is
  unchanged.
- **A frontend change.** The Studio reads its framework list from the resources endpoint, which
  is the catalog rendered, so the new framework appears in the picker without a UI change.

## Verification

- Capability tests (`test_agent_capabilities.py`) cover the catalog agreeing with the union of
  both ports' implementations, a framework with a conversation adapter declaring exactly what
  that adapter proves, and the runtime-only framework claiming no structured output while
  claiming tool calls and conversation memory.
- Runtime conformance (`test_agent_runtimes.py`) sweeps every framework the catalog declares —
  asserted against `PROVEN_FRAMEWORKS` rather than a literal, so a fourth either joins the sweep
  or fails it — for the answer being words and a neutral meter and nothing else, every call
  reaching the world under its contract name, every argument being a declared name carried as
  text, the lab's own budget ending the turn through the framework it is raised inside, and an
  arm with a thread behind it still being answered. A further sweep over the two model-backed
  frameworks covers every enabled tool arriving, and one test runs both over one world and
  asserts what a comparison rests on: the same recorded shape, while what they said, what they
  chose and what they spent stay free to differ.
- Failure classification is swept across both frameworks from each SDK's own error type: a 429 is
  transient and a 400 is a provider refusal, in both, so an operator comparing two arms' failure
  codes is comparing the same vocabulary.
- Framework-specific tests cover, for the OpenAI Agents SDK, calls made in the order they were
  asked, the budget surviving the wrapper the SDK puts around a tool failure, argument text that
  is not an object at all ending the attempt as an unusable answer, the turn ceiling reporting the
  configuration's allowance, an unclassified SDK fault reported as the framework failing, and the
  metering asymmetry above stated as a passing run rather than as a comment; and, for Pydantic AI,
  its own tool-call limit still mapping to the same finding.
- Runner tests (`test_experiment_runs.py`) advance a real arm per model-backed framework through
  the real invoker and assert the record rather than the adapter: an answered turn, tool events
  numbered from zero and versioned from the published table, a duration on every call, usage and
  duration on the attempt, and metrics that count what the events say. A second sweep asserts
  Milestone 4's standing criterion for the new framework — nothing the lab recorded about a call
  names the framework that made it or spells a tool the provider's way — and deliberately holds
  the *reply* to less, because an arm's words are recorded verbatim.
- Tool conformance (`test_sandbox_tool_conformance.py`) sweeps the shared derivation over the
  published contract set: properties exactly the declared arguments, every one a string, enums
  carrying their choices, and `required` listing the required arguments and only those — with a
  non-vacuity test asserting the table actually contains every argument kind and both sides of
  `required`, so the enum and optional branches are checked against real cases.
- The SDK isolation test now sweeps three packages (`pydantic_ai`, `agents`, `openai`) rather than
  one, over an allowlist of three infrastructure modules, and asserts that every declared SDK is
  actually imported by an allowed module — so a sweep that found nothing could not pass while the
  adapters were deleted.
- The judge anonymity sweep (`test_judge_independence.py`) is driven from `PROVEN_FRAMEWORKS` and
  therefore now runs a third arm, under the new framework, and reads the brief it was scored on.
  It passes unchanged; the offline registry it advances through gained the new runtime, and a
  framework declared without one would fail there rather than silently sweep two arms.
- Live smoke tests (`test_live_model_runtimes.py`, renamed from `test_live_pydantic_ai.py`) are
  swept over both model-backed frameworks, with an offline test asserting that every framework
  reaching a provider has one — so the live suite cannot quietly cover half of a comparison. They
  remain opt-in and were not run in this slice.

## Dependencies

`openai-agents` joins `apps/api`'s dependencies through `uv`, and resolves against the `openai`
client Pydantic AI already brings. It pulls fourteen transitive packages with it — `mcp` and its
`jsonschema`, `cryptography`, `sse-starlette` and `python-multipart` chain among them, none of
which this lab uses — and it pinned `websockets` back one minor version to satisfy its own bound.
Both are worth naming: the first because a framework's dependency surface is part of what a
comparison costs, and the second because it is the first time a framework the lab added moved a
dependency something else had already chosen. Nothing in the lock needs a network once installed,
and no test reaches one.

`httpx2` joins the dev dependencies. The OpenAI client carries its own HTTP client, and the
provider-status test has to build a response of the class `APIStatusError` will accept — the
`httpx` this repo already had is a different class. Declaring it is the honest form of an import a
test already makes.

## Migration

None. No table, column, canonical document, fingerprint, tool contract, published version or HTTP
contract changes. A snapshot frozen before this slice is the same starting state after it, and an
experiment recorded before it reads back identically.
