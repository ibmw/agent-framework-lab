# ADR 0031 — The versioned judge, and the anonymized record it scores

Status: accepted — 2026-09-01

Delivers `docs/PLAN.md` Milestone 5's second outcome: a versioned judge configuration and
anonymized, structured LLM-judge execution. Records the judge as a definition, the closed
verdict vocabulary and why "unclear" is one of its three values, the evidence scope as a
published input, the anonymized brief and the fingerprint that ties a verdict to it, the
executions kept as records where the deterministic evaluation is a projection, and the two
runtimes behind a new port.

## Context

ADR 0030 judged every objective a rule can decide and left the rest sitting in a `deferred`
row: "a judge scores this dimension", with no judge. The row was honest — an objective a
judge owns is not a miss — but it was also a question the lab had asked itself and refused to
answer, in every arm of every experiment whose recipe composed one.

Everything a judge needs is already recorded. ADR 0025 wrote both threads, ADR 0026 every
attempt and every call it made, ADR 0028 the faults the scenario fired, and ADR 0020 gave
each arm a sandbox whose revisions say what moved. What was missing is who reads it, under
what rubric, and how the answer is kept.

The plan states the constraints plainly: judge evidence is *anonymized, versioned,
structured, rerunnable, and separate*, and every output is tied to a model, a prompt, a
rubric, and an input fingerprint. Each of those is a decision below.

## Decision

### A judge is a definition, and its rubric is authored rather than defaulted

`judge_configuration` joins the definition types on the shared lifecycle (ADR 0014): a
mutable draft, immutable published versions, a canonical `judge-configuration-payload-v1`
document, and a content fingerprint. It references nothing — a provider, a model, a rubric,
and a list of what it is shown are none of them definitions — which makes it the smallest
type the lifecycle has carried.

It is a definition for the reason an agent configuration is one (ADR 0024): a result
explained by "a model scored it" is not explained. A verdict has to name a rubric that cannot
have moved since, and a draft rubric moves.

A new draft carries the model and the evidence scopes the lab has proven, and deliberately no
rubric. The rubric is the whole of what a judge is; defaulting one would publish an evaluator
nobody wrote.

### The verdict vocabulary is the lab's, and "unclear" is one of three

`JudgeOutcome` is `met`, `missed`, `unclear`, closed and lab-owned. A rubric cannot add a
fourth value or rename one, because a judged row sits in one matrix beside deterministic rows
and a judge reporting in its own units would not be comparable with the rows around it.

`unclear` exists because the alternative is a guess. A judge forced to choose between met and
missed when the record does not settle the question will choose, and a recorded guess is
exactly the leaderboard scoring `docs/PLAN.md` refuses. It maps to `ObjectiveOutcome.
UNDECIDABLE` — the same value an unread kind of evidence produces — because it says the same
thing: this evidence does not decide it. It is deliberately not a miss.

The lab's framing travels above every rubric, in the runtime rather than in the payload: what
the three outcomes mean, and that `unclear` is a real answer rather than a failure, are rules
about the *scale*. An author who could restate them in a rubric could quietly turn every
uncertain row into a verdict.

### What the judge is shown is a published input, and its absence is visible

`JudgeEvidenceScope` is what a configuration declares it wants to see: the customer's turns,
the arm's replies, the tool calls, the state changes. It is part of the payload and therefore
part of the fingerprint, because a judge shown the calls and a judge shown only the words are
answering different questions — calling that a display setting would let "the same judge"
mean two things.

A scope the configuration does not declare is *absent from the brief*, not an empty list. The
brief's fingerprint therefore differs, which is correct and is what makes "what was this
verdict based on" answerable from the record.

### The brief carries what the arm did, and nothing about what ran it

`judge-brief-v1` is one canonical document per objective per arm. It holds the objective
being asked about and, per declared scope, the thread, the calls, and the writes. It holds no
framework, no model, no configuration name, no arm label, and no run identifier — a test
walks every string in the document and asserts it.

Two boundaries fall out of that.

**A call contributes its conduct, never the world's data.** The tool name, the arguments, the
outcome, and a refusal's code — never the `data` the tool answered with. The facts are
deterministic evidence already (ADR 0030); handing the order, the customer, and the policy
back to a model would have it scoring the shop's data rather than the arm's behavior, and
would put a copy of the synthetic customer record into every judge prompt. A refusal's
*message* is left out for the reason ADR 0021 gave it a code: the code is the stable part.

**A failed attempt contributes no words and keeps its calls.** The agent said nothing, so
there is nothing to score; what it read before it broke is still what it read.

The **fingerprint** is the SHA-256 of the exact bytes the model is given, and it travels on
the verdict. Two executions carrying one fingerprint were asked the same question; two
carrying different ones were not, however alike the rubrics.

### A rubric may not name what an arm runs, and the gate refuses it

The one publish-gate finding that reaches outside the payload: a rubric containing a
framework's id or label, a provider, or a model the lab runs is an error. Anonymizing the
brief and then letting the rubric say "prefer the Pydantic AI arm" would defeat every other
precaution in one sentence, and would do it invisibly — nothing downstream can tell a
rubric's words from a judge's reasoning.

The reserved terms are derived from `PROVEN_FRAMEWORKS` rather than listed, so a second
framework joins the refusal the day the lab proves it (ADR 0023's rule for the conformance
sweep, applied to a gate). The control framework's own words are in that set deliberately: a
rubric that says "the deterministic arm" is exactly the leak.

### An execution is a record, where the deterministic evaluation is a projection

ADR 0030 stored nothing, because a deterministic outcome is a function of a record that only
grows. A verdict is not that: it is a model's reading, produced once, at a cost, and not
re-derivable. So `experiment_judgements` is a table, and it is the only thing about an
evaluation that is not a function of the run.

A row is keyed by `(run, objective, attempt)` and holds the judge and its exact version, the
provider and model, the brief's fingerprint, and either an outcome with a rationale or a
classified failure — never both, which the schema enforces. Nothing is ever updated:
**scoring again writes the next attempt** and the previous verdict stays exactly as recorded,
so "the judge changed its mind when we reran it" is a readable fact rather than a lost one.
The matrix reads the latest attempt.

Two passes running at once number the same attempt, because each counts one past the highest
it read, and the second insert meets the primary key. That is the store keeping its rule, so
it is translated into a **409** rather than surfacing as a failure: the operator's move is to
read the evaluation and score again. The alternative — numbering attempts inside a lock, or
letting the later pass win — would either serialize an operation that has no reason to be
serial or lose a verdict the table exists to keep.

A **failed execution leaves the row deferred** — precisely where it stood before anyone
tried. A provider that refused said nothing about the arm, and reporting the lab's own outage
as a miss is the mistake ADR 0030 built `deferred` and `undecidable` to prevent. A provider
this process cannot reach *at all* is refused with a 422 and records nothing, for ADR 0026's
reason: a missing API key is a fact about the machine.

### The judge is chosen at scoring time, not pinned by the experiment

An experiment pins what it *ran*: the scenario, the arms, the world (ADR 0025). It does not
pin what will score it, because judging is separate from the run and rerunnable — pinning an
evaluator at start would have frozen it before anyone knew what the run produced, and would
have made rescoring with a better rubric a new experiment.

What is pinned is per pass: the judge's latest published version is resolved once, so both
arms of one pass are scored by identical rubrics, and that version is recorded on every
verdict it produced.

### One objective per execution, one arm per brief

The judge is asked about one objective at a time. A single call scoring five objectives would
let the model's reading of one row move another, and would leave one fingerprint standing for
five different questions.

Every brief is built from one arm's record alone, so a judge cannot prefer an arm by
comparing them. The comparison is the operator's, made from two independently produced
verdicts — which is the same rule the whole lab runs on: no global score, and nothing added
up across arms.

### A third port, and two runtimes behind it

`JudgeRuntime` is a new port, deliberately much smaller than `SupportAgentRuntime`: no
invoker, no sandbox, no repositories. A judge that could look something up could see what the
brief was built to hide. It answers with a `JudgeOutcome` and a rationale, or raises a
classified failure; a provider's message never becomes evidence, exactly as a failed agent
turn carries no body.

`JudgeRuntimeError` carries a default failure rather than a bare annotation, because the
recorder reads it *inside* the handler that catches it: an adapter raising the base class
would otherwise break the classification machinery from within the code that exists to
classify, and produce an unrecorded error instead of a recorded failed execution.

Its registry is keyed by **provider** rather than by framework. A judge makes no tool calls
and keeps no memory, so what could change its answer is the provider, the model, the rubric,
and what it was shown — there is no framework dimension to compare, and inventing one would
be a table with a single meaningful column. It is a third registry rather than a member of
either existing one, for the reason there are already two (ADR 0026): three unrelated ports
in one registry would only make a provider registered for one look available for the others.

The two implementations mirror the arms'. The **control judge** reads the brief by a declared
rule — shown no replies it says so, finding none it answers missed, finding a customer turn
this arm never answered it answers unclear, and otherwise met — so an offline lab can run an
evaluation end to end and a test can name the verdict. **Pydantic AI** constrains the model
to the lab's three outcomes through structured output and is handed the brief as the exact
canonical bytes the fingerprint covers; nothing parses prose for a verdict. The rationale
length is *truncated* rather than declared in the output schema: a provider's strict
structured output does not enforce `maxLength`, so a constraint the model cannot see would
turn a verbose but real verdict into an unusable answer on a row the judge actually decided.

### Scoring answers with the evaluation, not with what it produced

`POST …/judgements` returns the whole `ExperimentEvaluation` as it now reads. A pass fills
some of an arm's rows and none of the others, and a client that had to merge new verdicts
into a matrix it fetched separately would be holding two readings of one experiment — which
is what ADR 0030 refused. The service holds the evaluation and answers through it, in one
session, so a verdict is never written in one transaction and read back in another.

## Deliberately not here

- **A judge bound to a scenario or an experiment.** Which judge scores is the operator's
  decision at scoring time; a recipe that named its own evaluator would make rescoring an
  authoring change.
- **Judging the customer's words as evidence about the customer.** No reader interprets the
  participant; the brief carries the thread so the judge can read what the arm was answering.
- **A judge that reads the world.** No tools, no lookups. What the arm obtained is in the
  brief; what it did not obtain is the point.
- **Comparing the arms in one call.** Two briefs, two verdicts, and the comparison stays the
  operator's.
- **Quantitative metrics.** Turns, tokens, duration, and cost are Milestone 5's next outcome
  and are observations rather than outcomes (ADR 0030 refused to mix them into this table).
- **A rerun that replaces a verdict.** Attempts only grow. An operator who wants the old
  reading gone is asking for the record to be edited.
- **Evaluating a `policy` objective.** Unchanged from ADR 0030: it needs a registry of named,
  versioned rules, which is its own slice.

## Verification

- Domain tests (`test_judge_domain.py`) cover the publishable judge, the two things that
  refuse one (no rubric, nothing shown), the warning a judge scoring calls alone gets, the
  scope set normalized however it was ticked, the exact decimal temperature, the change
  summary a publish would freeze, and the judgement record's own rules: a verdict or a
  failure and never both, a failed execution that may not explain itself, an attempt counting
  from one, and a fingerprint that has to be one.
- Payload tests (`test_judge_payload.py`) cover the canonical round trip, the decimal
  temperature ADR 0007 requires, and the two fingerprint facts that matter: a judge shown
  different evidence is a different judge, and the order the scopes were ticked in is not.
- Authoring tests (`test_judge_configurations.py`) cover the gate — an unproven provider
  refused, an unexercised model warned, a rubric naming a framework refused, and a reserved
  term inside a longer word deliberately not a finding — plus the frozen version that keeps
  its rubric while the draft moves on, and the reserved-term list read off the framework
  catalog rather than restated.
- Brief tests (`test_judge_brief.py`) cover the anonymity sweep over every string in the
  document, a scope absent rather than empty, two judges reading different inputs, a call
  carrying its arguments and never the tool's data, a refusal carrying its code and not its
  message, a failed attempt contributing no words while keeping its calls, and the call order
  the agent asked in.
- Scoring tests (`test_judge_runs.py`) drive a real experiment: the unscored row saying a
  judge decides it, the verdict and its provenance filling it, the deterministic row beside
  it untouched, only judge-assessed objectives asked about, each arm scored on its own
  record, the control judge's declared rule over two arms, `unclear` landing as undecidable
  rather than a miss, a failed execution leaving the row deferred, an unclassified adapter
  failure recorded rather than raised, a rerun writing attempt 2 and the matrix reading it,
  the pass resolving the judge version it scored at, and the three things refused rather than
  recorded — an unpublished judge, an unreachable provider, and a judge that does not exist.
- Runtime tests (`test_judge_runtimes.py`) cover the control judge's four branches and its
  identical answer over one brief, and Pydantic AI's framing above the rubric, the canonical
  brief reaching the model, a verdict outside the vocabulary rejected, an over-long rationale
  truncated rather than refused, and each provider failure classified — including the base
  error, which names a failure so raising it cannot escape the recorder.
- Contract tests (`test_judge_api.py`, `test_experiment_api.py`) cover the judge's authoring
  surface, the resources a picker reads, the gate refusing an arm-naming rubric, and on the
  experiment side: the deferred row before scoring, the scoring call answering with the whole
  evaluation and the provenance on the judged cell, the second attempt, the unpublished
  judge's 422, and the unreachable provider that records nothing.
- Frontend tests (`JudgeConfigurations.test.tsx`, `Experiments.test.tsx`) cover the judge
  index and editor — what each evidence scope shows, a change to it saved, the reserved terms
  served rather than hard-coded, the arm-naming rubric refused at the gate, and the publish —
  and on the bench: the deferred row, scoring it with a published judge, the provenance a
  screen reader hears, and the bench that offers no scoring when no judge is published.
- The Playwright journey (`experiment-start.spec.ts`) is extended rather than duplicated, for
  the reason ADR 0026 to ADR 0030 gave: the scenario now composes a judged objective beside
  the read-check, a judge is published, and after both arms are driven the operator scores
  from the bench — the arm that answered every turn is met, the arm still holding one is not
  counted against, and every filled cell names the judge version and model that produced it.

## Migration

`20260901_0015` creates `experiment_judgements` and widens the closed `definition_type` check
on `definition_drafts` and `definition_versions` to admit `judge_configuration` — a SQLite
table rebuild, with the existing definition handed to `batch_alter_table` because SQLite does
not reflect check constraints. No published definition is touched, no fingerprint moves, and
no existing row changes: a lab with no judge reads exactly as it did, with every judged
objective deferred.

The downgrade is deliberately not tolerant of published judges: narrowing the check while
`judge_configuration` rows exist fails the rebuild rather than leaving definitions the schema
no longer admits. A downgrade past this revision is a downgrade past the judge, and dropping
an author's evaluators silently would be worse than stopping.
