# ADR 0032 — What a run cost, measured once and projected from the record

Status: accepted — 2026-09-01

Delivers `docs/PLAN.md` Milestone 5's third outcome: turns, token usage, model and tool
calls, duration, retries, failures, and an estimated cost recorded when available. Records
the two things stored because they cannot be recovered afterwards, the neutral usage shape a
framework reports into, the declared price table the lab converts it with, the difference
between "spent nothing" and "nobody said", and the reading projected over all of it.

## Context

Almost every number the outcome names is already in the record. ADR 0025 wrote each arm's
customer turns, ADR 0026 every attempt and every tool call it made, and ADR 0029 derived an
arm's standing from those two streams rather than storing one. Turns, model and tool calls,
retries, and failures are therefore questions about rows the lab already keeps: an arm's
retries are the attempts sitting beside one ordinal, and its failures are the codes those
attempts carry from `AgentTurnFailure`'s closed table.

Two things are not. **How long an attempt took** is gone the moment it returns — the record
timestamps when a row was written, never how long the work before it ran. **What the provider
metered** is visible only inside the framework, which is the one component the lab
deliberately keeps at arm's length: an SDK counts its own tokens and requests, and nothing
outside it can.

Both are the kind of evidence `docs/architecture.md` already asks stable records to carry —
"framework, architecture/configuration version, tool/version, outcome, attempt, duration,
usage when available" — and the frame this milestone builds toward reads them as one strip
per arm: *2 turns · 3.4k tok · 3 tools · 15.1s · 1 retry* (frame 8), expanded into the
Quantitative card of frame 9.

The phrase "when available" is the whole of the difficulty. A control arm that calls no model
and a framework that cannot meter itself must not read alike, and neither may be filled in
with a number the lab invented.

## Decision

### Only the two unrecoverable measurements are stored

`experiment_agent_turns` gains `duration_ms` and the three usage columns; each tool event
gains its own `duration_ms`. Nothing else is stored, because nothing else needs to be: every
other number the outcome names is a count over rows that already exist.

This is the rule ADR 0027 gave the timeline and ADR 0030 gave the evaluation, applied to the
third reading over one record. A stored count would be a second writer of a fact the streams
already hold, free to disagree the day one of them is edited — and an arm whose thread showed
three attempts beside a metric saying two would leave an operator with no way to tell which
was lying.

### A measurement absent is absent, never zero

Every measurement column is nullable, and the absence travels all the way to the client.
`ModelUsage` is `None` for a framework that does not report usage; `duration_ms` is `None` on
a row written before this revision. `total_usage` skips what nobody reported rather than
adding a zero, and an arm in which nothing was reported has no total at all.

A zero is a claim. Backfilling one would put a number nobody measured into a total a
comparison reads, and an arm that looked free because its framework is silent is exactly the
wrong conclusion for a cost reading to invite.

### Calling no model is a measurement, and it is zeros

The deterministic control arm reports `ModelUsage.none()` — zeros with zero requests — rather
than nothing. That it calls no provider is a *fact* about it, known exactly, and a comparison
against a model-backed arm should read `0.00 USD` rather than a dash. The two absences stay
distinguishable end to end: zeros mean "it spent nothing", `null` means "the lab cannot say".

`ModelUsage` refuses the one incoherent reading — tokens spent with no request that spent
them — so a framework cannot report a meter nobody could have produced.

### Usage comes back with the answer, because only the framework can see it

`SupportAgentRuntime.answer` now returns an `AgentAnswer`: the reply, and the usage the
framework metered. It stays text plus a meter and never a structured claim about the world,
for the reason ADR 0026 gave — every fact an arm touched is already the tool event that
produced it, and asking a model to restate them would make the evidence depend on the model's
honesty about its own behavior. Usage is different in kind: it is not something the model
says, it is something the framework counted.

Only the three counts every provider bills in cross the port. Cache reads, audio tokens, and
reasoning breakdowns differ by provider and by model generation, and a comparison across two
frameworks needs the columns to line up more than it needs any one of them complete.

**A failed attempt reports no usage.** The tokens it burned before it broke are real, but
they reach the lab only through an answer the framework never produced, and a number invented
for a failure would be the one part of a cost comparison nobody could check. The attempt is
still timed: how long a failure took is the lab's own observation, not the framework's.

That makes usage *systematically* partial rather than only occasionally so — every arm that
was retried has a token count covering fewer attempts than it made — so `metered_attempts`
travels beside it exactly as `measured_attempts` does for duration, and the bench marks such
a total as the floor it is rather than as the arm's whole spend.

**A meter the value object refuses ends the attempt.** An adapter reporting tokens with no
request that spent them raises after the reply exists, and the runner's catch-all classifies
it as a `framework` failure. That is the right answer and worth stating: the lab's own
integration produced an unrecordable reading, which is a fact about this project rather than
about the model, and recording the reply beside a meter nobody can believe would put an
unexplainable number into a comparison.

### Duration is the runner's clock, and it is the clock the record already uses

The runner reads `Clock.now()` on each side of the runtime call, and the invoker reads it on
each side of every tool call. No second time source: a monotonic clock would be a second
thing to trust, a second thing to fake in every test, and the moment an attempt ended is
already needed for `created_at`.

An elapsed reading is clamped at zero, because an operational clock can be stepped backwards
under a running process and a negative duration would subtract from a total. A tool call's
measurement stops before the fault check that follows it (ADR 0028): what a fault costs is
the scenario's time, and charging it to the call would make an arm look slower for having
been interfered with.

An attempt's duration covers the model *and* the tool calls inside it, because that is what
an operator waited for; the events carry their own, so time spent asking the world is
separable without measuring either twice.

### The price table is declared, dated, and applied at read time

`MODEL_PRICES` names a listed per-million rate for each `(provider, model)` pair the lab has
proven, in the same spirit as `PROVEN_FRAMEWORKS` (ADR 0024) and `sandbox_tool_contracts`
(ADR 0021): the lab's own record of what a model was listed at, testable offline, changing
when someone edits it rather than when a provider's API answers differently. Each rate
carries the date it was read, because a price nobody can date is a number nobody can check.

A cost is **never stored**. It is recomputed from the usage that is, so correcting a rate
corrects every historical estimate at once and no row ever holds two prices for one run. It
is quantized to six fractional digits, because `Money`'s two — right for an order total —
would round most of this lab's runs to zero, and it reaches the client as a decimal string
with the rate's own date beside it: an estimate whose age is invisible is a number an
operator cannot weigh, and a client that re-parsed the string into a float would render a
different number from the one the lab priced. A model the table does not price has no
estimate; never a zero, for the reason above.

The estimate ignores caching, batching, and negotiated pricing, and the direction of that
error is knowable. A provider that reports cached reads inside its prompt token count bills
them below the listed input rate, so a cached conversation's estimate is an **upper bound** —
never an under-statement, which is the half that would matter.

The proven catalog and the price table are held to agreement by a test, so a newly proven
model arrives priced rather than producing an empty cost column nobody can explain.

### The reading is per arm, and there is no aggregate

`ArmMetrics` travels on `ExperimentDetail` beside the standing, and reaches the client on the
arm it describes. It reports turns, answered turns, attempts, retries, failures by code, tool
calls, the writes among them, usage, model requests, the two durations, how many attempts the
duration actually covers, and the estimate.

Retries are counted apart from the failures that caused them: `attempts − distinct ordinals
attempted`, so "the model failed" and "we ran it again" stay two facts. Failures are counted
*by code* rather than summed, because collapsing the closed vocabulary into one number would
throw away the difference between a provider outage and a tool budget set too small.

`measured_attempts` is the denominator of the duration, so a partial total reads as partial
instead of as a fast run.

There is deliberately no score, no winner, and no arm-versus-arm delta. The product direction
forbids collapsing evidence into one number, and an efficiency reading is interpretable only
beside the outcome — which is the evaluation's (ADR 0030), one card over.

## Deliberately not here

- **A latency percentile.** Frame 9's `p50` waits for enough attempts to have a median; with
  two or three, a percentile is noise wearing a statistic's clothes. Every attempt's own
  duration is recorded, so the reading can be added without a migration.
- **Judge cost.** A scoring pass calls a model too, and `experiment_judgements` records the
  provider and model it ran. What that cost belongs with the judge's own reading rather than
  in an arm's column: a verdict is not something the arm spent.
- **Cost as a comparison verdict.** The metrics say what each arm spent. Whether that is
  worth it is a reading over the objectives beside them, and the plan is explicit that
  efficiency compares only after outcome quality.
- **A per-request usage breakdown.** The port carries a run total. Which of five provider
  calls was expensive is a framework's own trace, and the lab's normalized evidence is the
  tool events and the attempt.
- **Backfilling the rows that predate this revision.** They have no duration and no usage
  because none was measured, and saying so is the honest reading.
- **Storing the estimate.** See above: a stored price is a price that can go stale inside a
  record nobody will re-derive.

## Verification

- Cost tests (`test_model_cost.py`) cover the usage invariants — negative counts refused,
  tokens without a request refused — the two absences kept apart, a total that skips what
  nobody reported and vanishes when nobody did, the rate applied to the tokens, a
  sub-cent run priced rather than rounded away, the control arm costing zero rather than
  being unpriced, an unpriced model and an unmetered arm both answering with no estimate,
  the table held to the proven catalog, and every rate carrying its date.
- Runner tests (`test_experiment_runs.py`) drive a real arm: an attempt timed, every tool
  call carrying its own duration, the control arm reporting zeros, a framework that does not
  meter itself recording nothing and costing nothing, a failed attempt timed but reporting
  no usage, a metered arm priced at the declared rate, the calls and writes counted, a retry
  counted apart from the failure that caused it and covering one attempt of two, and each arm
  counted on its own record while the arm beside it reports nothing. The two clock claims are
  pinned rather than asserted in prose: a clock stepped backwards costs the measurement and
  nothing else, and — because the test factory now shares one clock between the runner and
  the fault runtime, as composition does — every tool call in an attempt a fault fired into
  reads the same duration, which is what "the measurement stops before the schedule is asked"
  means when a firing costs the clock ticks of its own.
- Migration tests cover the table refusing what the value object refuses: half a usage
  reading, and tokens with no request that spent them.
- Contract tests (`test_experiment_api.py`) cover the metrics block present from the first
  read of a started arm — zero attempts, null duration, null cost — and, after one advance,
  the arm that ran reporting its calls, its write, a duration, zeros for usage and a zero
  cost, beside the arm that did not.
- Frontend tests (`Experiments.test.tsx`) cover the strip an arm that ran shows, the arm that
  never ran showing none rather than a row of zeros, and a retry counted in it.
- The Playwright journey (`experiment-start.spec.ts`) is extended rather than duplicated, as
  every slice since ADR 0026 has been: after the operator runs arm A, the strip under its
  thread reports the turn, zero tokens, the calls it made, how long it took, and a cost of
  nothing — while the arm beside it shows no strip at all.
- The metadata-comparison and upgrade/downgrade cycle tests cover the schema this revision
  leaves, as they do for every revision.

## Migration

`20260901_0016` adds `duration_ms`, `input_tokens`, `output_tokens`, and `model_requests` to
`experiment_agent_turns` and `duration_ms` to `experiment_tool_events`, all nullable, with
check constraints holding each non-negative, holding usage whole — an attempt cannot know its
input tokens and not its output tokens, because a half-filled row would total as if the
missing half were zero — and holding the rule `ModelUsage` itself refuses: tokens with no
request that spent them. That last one is in the table rather than only in the value object
because the value object raises on the way *out*: one hand-written incoherent row would make
every read of the experiment holding it fail, where the constraint refuses it on the way in,
while the mistake still belongs to whoever made it.

SQLite cannot add a check constraint to a live table, so both directions rebuild it and both
are handed the definition explicitly: SQLite reflects its own constraints well enough to
carry a rule about a column the downgrade is removing, which would leave a table whose checks
name a column it no longer has.

No fingerprint moves and no existing row changes. An experiment recorded before this revision
reads exactly as it did, with its attempts reporting no duration and no usage — which is what
they were: unmeasured.
