# ADR 0037 — The trace that is stored, because the record cannot answer for it

Status: accepted — 2026-09-07

Delivers the traces third of `docs/PLAN.md` Milestone 5's eighth outcome, which that outcome
splits from replay and fork provenance by name. Records why a span tree is stored where every
other reading of a run is projected, what a span carries that the execution timeline cannot
already answer, the attribute column the stored span deliberately does not have, and the
three kinds of span this build can honestly claim to have seen.

## Context

Everything this lab reads back about an experiment is a projection: the timeline (ADR 0027),
the arm standing (ADR 0029), the evaluation (ADR 0030), the metrics (ADR 0032), the state
diff (ADR 0035). Each ADR refused a stored copy in the same words — a second shape is a
second chance to disagree with the first — and ADR 0036 kept an annotation out of the record
for the mirror-image reason.

Frame 9b is a waterfall. It is the one surface in the frame set that none of those readings
can produce, and confirming that against the code was the first thing this slice had to do.

The record holds, per attempt: `created_at`, `duration_ms`, and the provider usage
(ADR 0032); and per tool call: the sequence the agent asked in, the `tool-result-v1` document,
the two revisions, and that call's own `duration_ms`. So the *bars* of a waterfall are
already there. What is not there is **where each bar goes**. ADR 0027 recorded the reason
plainly: the runner writes an attempt and every call it made from one reading of the clock,
deliberately, so that the order of a turn's calls is the sequence the agent asked in rather
than a clock's opinion of it. Every row of one attempt therefore carries the same
`created_at`, and the arrangement of the calls inside the attempt — and so the size of the
gaps between them, which is the framework's own time and the single most interesting quantity
in a comparison of two frameworks — is gone the moment the advance returns.

That is the same shape of fact as ADR 0032's two: unrecoverable, and therefore stored.

There was also nothing to store. Before this slice the lab's only spans were the POC's
`SanitizedTracingAgentAdapter` around the old conversation adapter; `ExperimentRunner`,
the recording invoker, and both `SupportAgentRuntime` implementations emitted none. So the
outcome's "recorded spans beside the record" needed the recording as well as the record.

## Decision

### The trace is stored, and it is the only reading of a run that is

`experiment_run_spans` holds one row per span, keyed by the arm and the span id. A span
carries where it sits (`parent_span_id`), when it ran (`started_offset_ms`, `duration_ms`),
what it can be joined to (`ordinal`, `attempt`, `sequence`), and the identity an exporter
would have seen (`span_id`, `trace_id`). Nothing else.

Storing it is the exception this ADR has to earn, and the test above is the whole argument:
the offset is not derivable from anything the lab keeps, and it is not derivable *because of*
a decision ADR 0027 made for good reasons and this slice does not want to reverse. Adding a
per-call timestamp to `experiment_tool_events` instead was considered and refused — it would
have put a second ordering authority next to the sequence, which is exactly the ambiguity
ADR 0027 removed.

### A span carries no attribute, and everything it is about is joined

There is no attribute map, no name column, and no status column. Which tool a span timed,
what version answered, whether it succeeded or was refused, which revisions it moved, and what
the arm eventually replied are read from the tool events and the attempt row the span's
coordinates name — the same documents `getExperiment` serves and the timeline reads.

This is the load-bearing safety decision, and it is structural rather than procedural. A
free-form attribute bag on an evidence row is precisely the back door around the
`CUSTOMER_ONLY` rule ADR 0021 enforces on tools and the anonymity rule ADR 0031 enforces on a
judge's brief: an SDK's model span routinely carries the prompt and the completion, and a
column typed `JSON` would accept them without anyone deciding to. A table whose every column
is a hex identifier, a small integer, or a value from a closed enum cannot leak, and an API
test asserts the rendered response against the words the incident actually contains rather
than trusting review.

The coordinate therefore has to mean exactly one thing, and both the value object and the
table enforce it: a `tool` span carries the sequence of the call it timed and no other kind
does, and the `attempt` span is the only root. Without that, a stored span would be a timing
attached to nothing.

It is also what the reading **orders by**. The offset decides where a bar is drawn and
nothing else: within one attempt the spans are listed by kind and then by the sequence the
agent asked in, and the store's own read order is stable rather than chronological. Sorting
by the offset would have put a second ordering authority beside the sequence — the thing
ADR 0027 removed — and it would have shown: an operational clock stepped backwards under a
running process leaves every offset clamped at zero (ADR 0032), and a trace sorted by them
would list a later call above an earlier one while the timeline beside it listed the
opposite.

### One measurement, two readers

A tool span's `duration_ms` is the number its tool event carries, and the runtime span's is
the number the attempt row carries, because the runner and the invoker measure once and hand
the same value to both. The tracer takes no clock reading at all: it is given a draft of what
was measured.

ADR 0032 established that the runner holds the clock a run is measured on, and the reason
holds one level out. Two durations for one call is worse than none — an operator with two
numbers has no way to tell which is lying — and a tracer with its own clock would have been a
second thing to trust and a second thing to fake in every test.

### The lab records only spans it opened itself

The three kinds are `attempt`, `runtime`, and `tool`: the advance, the framework's turn inside
it, and each call back into the world. Nothing else is recorded, and in particular a
framework's own instrumentation is not captured into the store even where an SDK emits it.

Two reasons, and the second is the stronger. The lab cannot promise the sanitization of an
attribute it did not write, so an SDK span swept into an evidence table would undo the
paragraph above on the day someone enables instrumentation. And a model call inside a
framework's loop is something the lab has not observed: recording one would be reporting a
measurement nobody took, which is the mistake ADR 0032 refused when it left an unmetered
attempt null rather than zero.

What lies *between* two tool spans is therefore a gap rather than a bar. It is the framework
thinking, the reader can measure it, and it is honest precisely because the lab did not give
it a name it had not earned. An exporter such as Phoenix may still receive a framework's own
spans if one is configured to emit them — it is a replaceable consumer and always has been
(ADR 0004) — and what it holds is beside the lab's record rather than inside it.

### The attempt span is wider than the attempt the record measured

`AgentTurnRecord.duration_ms` still measures exactly what ADR 0032 published: from before the
runtime was started to after it returned. The `runtime` span is that number. The `attempt`
span starts earlier, at the moment the advance began, and so also covers resolving what this
arm runs against the versions the experiment pinned and firing the faults due before the
runtime starts.

The difference between the two bars is this project's own glue code, which is the half of a
framework the lab owns and the half Milestone 6 has to document. A comparison that charged it
to a framework would be reporting the lab's own resolution cost as a difference between
configurations.

### The spans are real OpenTelemetry spans, opened after the fact

`RunTracer` is an application port taking a draft and answering with hex identifiers.
`OtelRunTracer` implements it by opening real spans with explicit start and end times taken
from the runner's measurements, ending them innermost-first, and reading the ids back off
them.

Opening them after the attempt rather than around it is what keeps the runner an application
object holding no SDK type — the rule ADR 0026 applied to framework SDK types, one port over
— and it costs the trace nothing: the parentage is explicit, the timing is the runner's, and
an exporter reads a finished span either way. It also means an attempt that breaks halfway
can never leave a span open in an evidence record.

The exported half is held to the same rule as the stored half by writing its attributes rather
than filtering them, as `SanitizedTracingAgentAdapter` already does: the lab's identifiers
pseudonymized, the arm's **position**, the turn, the framework, and the published tool name
and version. The position rather than the label, because a label is text an operator typed
and `docs/observability.md` allows no free-form content out of the process; which arm a span
belongs to is already the pseudonymized run id beside it. For the same reason a span carries
no name of its own across the port: an exported span's name is decided from its kind, and the
only other word on it is a tool name the lab publishes.

Those names are the ones the Traces tab renders, letter for letter. The trace id on the page
is the correlation an operator carries into an exporter, and a span called one thing in the
lab and another in Phoenix would break that correlation exactly when it is being used.

The root span is opened in an **empty** context rather than the ambient one. `None` would
resolve to whatever span happened to be current, and a root silently parented into an
unrelated trace would be exported under a parent the stored row says it does not have —
which is the "stored tree equals exported tree" claim this section rests on.

Because an arm now traces on every advance, `create_app` constructs telemetry unconditionally
where it used to build one only alongside the POC's agent registry. A tracer is composition's
business now, not an optional decoration of one adapter; whether anything is exported is still
the provider's and nobody else's.

### It is read on its own, and the reading joins

`GET .../traces` is its own operation, like the timeline and unlike the standing, the metrics,
and the state diff. Those travel on `ExperimentDetail` because each is a projection of
documents that read has already resolved; a trace is stored, has many rows per attempt, and
would make every bench poll carry a waterfall nobody on that path asked for — the reason
ADR 0036 kept annotations off the run.

`ExperimentTraceService` is built over the same `ExperimentService` the timeline is built
over, so the tool event a span is joined to is the one the thread shows. The response carries
one entry per **recorded attempt**, not one per trace: an attempt made before this revision
reports `trace_id: null` and no spans, which says nobody watched rather than nothing happened.

## Deliberately not here

- **A fault span.** ADR 0028 already records how many calls an attempt had made when a
  mutation fired, which is what makes the concurrency refusal readable; a wall-clock offset
  would add only precision, and getting one would mean handing the trace to the fault runtime
  so it could open a span per firing. The firing is visible on the timeline and in the gap the
  waterfall already draws. It is the cheapest kind to add — a fourth member of `SpanKind` and
  a nullable join key — the day a scenario fires enough faults for the ordering to be unclear.
- **A model span.** As above: the lab did not observe it. Capturing one would mean either
  trusting an SDK's own span, which reintroduces the attribute bag, or extending
  `SupportAgentRuntime` so every adapter reports its internal boundaries — a burden on the
  port for a bar the gap already implies.
- **A span for anything below a tool call.** The frame's `app.change_shipping_address` and
  `db.update · orders` are real, and where the lab's code ran is already answered without
  timing them: ADR 0027 resolves the project-owned source location of the handler that
  answered every call, from the registry that ran it.
- **A link into Phoenix.** The frame's "Export: Phoenix ↗" chip needs a base URL for a service
  that is optional, replaceable, and usually absent. The trace id is on the page, which is the
  correlation; a link to a host nobody configured would be a dead chip.
- **The span panel's two deep links.** The frame offers "Show in Execution timeline" and "Open
  source location in Code paths", and the canvas annotation names that chain — General to a
  timeline event to a trace span to the raising line — as the point of the depth tabs. Neither
  is here, because neither destination has an anchor to land on: the timeline tab renders one
  stream with no per-entry target, and the code excerpt of frame 9c is a separate open outcome.
  Adding anchors is one slice across both tabs and belongs with the excerpt rather than in
  front of it; a link that scrolled to the top of a tab would be worse than no link.
- **A time axis over the waterfall.** The frame rules the attempt into five labelled columns.
  Each bar carries its own duration and the root's is the scale, so the axis adds a reading
  aid rather than a fact; it waits until the tab has been used against a run long enough to
  say what the ticks should be.
- **Trace search, and traces across experiments.** A trace is read beside the run it explains.
  A cross-experiment span search is a trace backend's job, which is what the exporter is for.
- **Backfilling the attempts that predate this revision.** They have no spans because none
  were opened, and saying so is the honest reading — ADR 0032's rule, applied again.
- **Replay and fork provenance.** The rest of Milestone 5's eighth outcome. Nothing here
  constrains them: they derive new experiments from old ones, where this reads one.

## Verification

- Trace tests (`test_experiment_traces.py`) cover the reading and the rules: one attempt
  recorded as one rooted trace with a span per call, only the attempt span without a parent
  and every call hanging off the runtime span, the calls at increasing offsets with a
  measurable gap between each pair — the fact the record cannot supply — the calls listed in
  the order the agent asked even when a clock stepped backwards has flattened every offset to
  zero, each span carrying the measurement the record already holds rather than a second one,
  the attempt span wider than the framework's turn inside it, a span naming the call the
  record says it timed, a refusal kept as a refusal, no word anyone said anywhere in the
  reading, two arms driven to the same place holding two traces that share no span, the arm
  that was never run recording nothing, a failed attempt traced and its retry traced beside
  it, an attempt whose
  spans were never written reported as untraced rather than reconstructed, and the experiment
  this shop does not hold. The value object's own rules are covered too: exactly a tool span
  carries a sequence, exactly the attempt span is a root, an identifier that no exporter could
  have produced is refused, and nothing runs for a negative number of milliseconds.
- Exporter tests (same file) cover the half that leaves the machine: the three span names, the
  run identifier hashed rather than carried, the arm reported by position, the attribute set
  held to the allowlist, the stored tree equal span-for-span to the exported one, and a span
  lasting exactly as long as the runner measured.
- Contract tests (`test_experiment_api.py`) drive the operation: an advance recording the span
  tree of the attempt it made with the calls named in the order they were asked, the offsets
  and the runtime span's agreement with the attempt's own duration, the response carrying no
  message body — asserted against the rendered text, because the contract is what an export
  will read — an arm that has not run contributing no trace, and the traces of an experiment
  another shop holds.
- A migration test (`test_migrations.py`) holds the store to the two coordinate rules and to
  both non-negative measurements — a span that starts before the attempt does and one that
  lasts a negative time — for the reason ADR 0032's usage constraints are in the table: the
  value object raises on the way out, where the constraint refuses the row on the way in.
- Frontend tests (`Experiments.test.tsx`) cover the tab: one attempt drawn as a waterfall with
  each bar named and measured with the names the exporter uses, a span's tool and outcome read
  off the record rather than off the span, a failed attempt and the retry beside it both
  offered with the arm and the failure that ended one of them, an
  untraced attempt saying so instead of showing a reconstruction, an experiment nobody has run
  having nothing to trace, the tab marked as the current page with the header still naming the
  experiment, and a backend that cannot answer reported with its own reason.
- The Playwright journey (`experiment-start.spec.ts`) is extended rather than duplicated, as
  every slice since ADR 0026 has been: after reading the evidence and following the incident
  into the timeline, the operator opens the traces of the same attempt, finds the write among
  the calls, and reads the tool, the version, the outcome, and the trace id on the span.

## Migration

`20260907_0018` adds `experiment_run_spans`, foreign-keyed to `experiment_runs`, with the
coordinate and non-negativity constraints above. Nothing is backfilled and nothing existing is
touched: an experiment run before this slice reads back exactly as it did, with each of its
attempts reporting no trace rather than a missing one.
