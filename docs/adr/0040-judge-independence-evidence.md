# ADR 0040 — What a judge cannot do to an evaluation, proved rather than asserted

Status: accepted — 2026-09-08

Closes `docs/PLAN.md` Milestone 5's last outcome — "test judge failure/rerun separately from
deterministic outcome calculation" — and with it the two acceptance criteria that outcome
carries: deterministic evidence stays readable and unchanged when a judge is unavailable or
rerun, and judge inputs are framework-blind while every output is tied to a model, a prompt, a
rubric, and an input fingerprint. Builds on the deterministic evaluation of ADR 0030, the
versioned judge of ADR 0031, and the two evidence mechanisms of ADR 0023.

This is an evidence slice, in the sense ADR 0023 was one: what it mostly adds is what the
milestone's claims are checked *against*. It is not only that, because the evidence found a
defect — a judge *failure* was overwriting a judge *reading* — and one production change goes
with it.

## Context

Every mechanism this outcome is about already existed and was already tested, once, at the
point it was written. ADR 0031 covers a failed execution leaving a row deferred, a rerun
writing attempt 2, an unreachable provider recording nothing, a rubric that names a framework
refused at the gate, and a brief whose strings carry no framework label. ADR 0030 covers each
polarity, the cap, and the judge row it left to be filled.

What none of them covers is the *property*, which is what the outcome asks for and what the
milestone's criteria are worded as. Three gaps follow from the difference.

**A single row is not the reading.** "A deterministic row is untouched by the judge" was
asserted on one objective, in one arm, after one successful verdict. The criterion is that the
whole rule-decided reading of the whole experiment is unchanged across every state a judge can
be in — never scored, unreachable, failed in each way it can fail, scored met, scored missed,
scored unclear, rescored. Nothing swept that, so nothing would have caught a judge state
reaching a deterministic row by a path nobody thought to assert against.

**The failure modes were tested at the seam, not through it.** `test_judge_runtimes.py` proves
that a 503 is transient and an out-of-vocabulary verdict is unusable; `test_judge_runs.py`
proves that *one* of those, recorded, leaves the row deferred. Whether each of the others does
was an inference, and so was whether any of them disturbs the reading beside it.

**The anonymity check was a list of words.** ADR 0031 built the publish gate's reserved terms
out of `PROVEN_FRAMEWORKS` for exactly ADR 0023's reason, and then checked the *brief* — the
thing the gate exists to protect — against six words somebody typed: `pydantic`, `gpt-5`,
`fake`, `arm a`, `deterministic`, `framework`. The day a second framework is proven, the gate
refuses its name in a rubric and nothing checks it stays out of the input. And the document
being checked was a hand-built fixture rather than a brief made from an arm that ran.

## Decision

### A failed execution no longer unmakes the verdict standing on the row

This is the defect the sweep found, and it is a production change rather than a test.

ADR 0031 said two things that only agree while a rerun succeeds: attempts are kept and nothing
is overwritten, and **the matrix reads the latest attempt**. A judge that failed after a
verdict was recorded therefore left the record intact and the *reading* wrong — the row flipped
from `met` back to `deferred`, and the verdict an operator had paid a model to produce sat
underneath it, unread, because a provider had been briefly unavailable.

That is ADR 0030's own mistake one level up. A provider that refused said **nothing about the
arm**: it is why a failure is not a miss, and it is equally why a failure is not the erasure of
a verdict. An outage is an absence of new information, not new information.

So `latest_judgements` now stands the latest execution that actually *carries a verdict*, and a
failure stands only on a row nothing has ever scored — where it is replaced by the next failure,
so a row waiting for a judge reports the outage it is waiting on rather than the first one. The
rule is stated as a comparison in one place (`_supersedes`) rather than spread through the
readers, and the record is untouched: every attempt is still written, still keyed by
`(run, objective, attempt)`, still never updated. What changed is which of them is read.

The blast radius is one function because every consumer already goes through it. The objectives
matrix, the results screen's judged card (ADR 0033), and every history row (ADR 0034) read
`ExperimentEvaluationService`, which is the point ADR 0030 made of not storing an outcome and
ADR 0034 made of projecting a listing row from the same reading. ADR 0031 is amended at the
sentence that said otherwise rather than left to be contradicted quietly.

### The deterministic reading is compared as bytes, and the bytes are the whole row

What the sweeps assert against is `deterministic_reading`: the canonical serializer's bytes over
every rule-decided row of every arm, each row rendered from `ObjectiveResult`'s own field list
rather than from a set of fields worth watching.

Two things follow, and both are deliberate. A field added to a result joins the comparison the
day it is declared — ADR 0023's rule for a sweep, applied to a golden. And *any* judge state
reaching a deterministic row moves the comparison, including the ways nobody would think to
write an assertion about: a changed sentence, a re-ordered matrix, a verdict attached to a row
a rule decided. An equality over three named fields would have been an equality over the three
leaks somebody imagined.

The scenario it is read off has three deterministic rows rather than one, one of each shape
ADR 0030 reads: a document read the arm never made (pending), an entity read it did (met from a
call), and a field of its world that moved (met from the state difference). A property proved on
a single pending row would be a property of pending rows.

### The failure sweep is over the taxonomy, and it says what it swept

`RECORDED_FAILURES` is a table of every way an execution can end without a verdict, and the
sweep over it is held to two coverage checks in ADR 0023's spirit:

- every member of `JudgeFailure` is produced by some entry, so a code the record can carry is
  never outside these tests; and
- every classified error the port declares — `JudgeRuntimeError` and every class beneath it,
  walked recursively rather than listed — is raised through the recorder, so an adapter that
  gains a new way to break joins the sweep on the day it declares it. Recursively because the
  port's whole design is that an adapter classifies by subclassing: a refinement under
  `JudgeTransientError`, a timeout being the obvious one, is exactly the shape a future
  adapter adds, and a direct-children check would let it in unexercised. The set is resolved
  when the test runs rather than at import, so a stand-in subclass written in another module
  is a subclass this sweep is asked about.

The table also carries one entry the port does *not* declare: a bare exception an adapter never
classified. The coverage check asserts that it is there — a sweep of declared errors alone can
only ever prove the classification agrees with itself, and the case that matters is the one the
integration did not anticipate.

What is deliberately proved end to end rather than at the seam is the malformed verdict: the
real Pydantic AI judge, over a model that answered something that is not a verdict, reaching the
record as `invalid_response` with the rule-decided reading unmoved. The runtime suite proves the
classification; this proves what the classification does to an evaluation.

### The anonymity sweep is over the framework catalog, and over arms that ran

`framework_identity_terms()` is built from `PROVEN_FRAMEWORKS` — every framework's id, label,
models, providers, and architectures — and the sweep runs one arm *per declared framework*,
advances it, builds the brief the judge service would build from that arm's own record, and
reads every string in it.

That is the ADR 0023 rule applied to the half of ADR 0031 that was still a list. A framework
proven tomorrow is checked the day it is declared, on both sides: the gate refuses its name in a
rubric, and the brief is asserted not to carry it.

Two details are load-bearing. The briefs are the ones a real scoring pass produced — the arm is
scored with a judge published to see every scope there is, and the sweep reads the documents the
runtime received — rather than rebuilt beside the pass by a helper that narrows the arm itself. A
helper would be the same *type* through different code, so a change to how the pass narrows an arm
would never reach the sweep, and what the criterion is about is what a judge is actually handed.
And the sweep asserts each brief carries both halves, words and calls, because a brief with
nothing in it is anonymous for the wrong reason.

The swept arms are offered two tools rather than the full read set, and that is a compromise
worth naming: the offline model behind the Pydantic AI runtime answers by echoing every tool
result it received, so a wide tool set produces a reply longer than a turn may hold and the arm
records a failed attempt instead of words (ADR 0026). Narrowing the set is what keeps every
framework in the sweep contributing a reply as well as its calls.

### A verdict is addressed by the brief, and the row it cannot reach is checked

Two claims about where a verdict lands, made falsifiable rather than argued from the types.

The port answers with an outcome and a rationale and no row name, so a judge that decided one
objective structurally cannot name another. The test that says so scores two judged rows in one
pass with two different answers and reads each landing where its brief asked.

And a judgement carrying a *deterministic* row's objective ID — which a republished template, a
wider scoring pass, or a hand-written row could produce — is written into the store and asserted
not to reach that row: the reading is byte-identical and the row still carries no judgement.
That is the one code path by which judge state could enter a deterministic outcome, exercised
rather than reasoned about.

### Every verdict is tied to four things, and the fingerprint is shown to move

The criterion names a model, a prompt, a rubric, and an input fingerprint. On a row these are the
provider and model, the judge and its exact published version, and the brief's SHA-256 — and the
rubric *is* the prompt, so the test resolves the recorded version back out of the definition
store and asserts the rubric the runtime was handed is the one that version froze. It is asserted
over every row a pass filled rather than over one.

The fingerprint is asserted to be the digest of the bytes the runtime was *actually handed*, on
the row that was handed them — paired by arm and objective, because a length check passes on a
digest of the wrong brief and an unaddressed set comparison passes on two rows whose fingerprints
were swapped. And a fingerprint that never moved would tie a verdict to nothing, so it is shown to
move for the right reason: rescoring an arm that has not changed produces the same fingerprint at
a new attempt, and rescoring after the customer has said one more thing produces a different one.
That is the property the fingerprint exists for, stated so it can fail.

## Consequences

- A judge that is unreachable, that fails in any way this build classifies, or that is rerun
  cannot move a rule-decided row, and the sweeps say so over the whole reading rather than over a
  row somebody picked.
- A provider outage no longer deletes a verdict from the screen. An operator reading a judged row
  sees the last thing a judge actually said, and the failed attempt is in the record beside it.
- Proving a framework costs one more thing than it did: its arm must be runnable offline, because
  the anonymity sweep runs it. That is the intended price, and it is the same price ADR 0023
  attached to publishing a tool.
- The declared tables are now load-bearing in a third place. `JudgeFailure`, the port's error
  classes, and `PROVEN_FRAMEWORKS` each fail a coverage assertion when they grow, rather than
  quietly shrinking a sweep.

## Deliberately not here

- **A timeout.** Nothing in this lab configures one: a provider that hangs surfaces through
  Pydantic AI as a `ModelAPIError` and is classified as transient or provider by status, which is
  where the sweep meets it. A timeout the lab imposes would be a decision about how long a verdict
  is worth waiting for, and it belongs with whatever first needs it.
- **The failed attempt shown beside the standing verdict.** The row carries the execution that
  stands; a full attempt history per row is a reading of its own, and frame 8 does not ask for it.
  What an operator can already see is that the row is scored and at which attempt.
- **A live judge test.** ADR 0024's rule is unchanged: this suite runs the declared control judge
  and Pydantic AI's own offline model, and a live call is credential-gated and separate
  (`docs/m2-provider-and-test-policy.md`).
- **A recorded golden for the brief's bytes.** ADR 0023 pins the fingerprints of the *starting
  state*, because those are published identities that historical experiments depend on. A brief's
  fingerprint identifies one execution's input and is recorded on the row that read it; freezing a
  constant for it would make an unrelated change to an arm's record look like a serializer
  regression.
- **Proving a judge cannot reach the world.** The port has no invoker, no repository, and no
  sandbox (ADR 0031). That is a property of the type rather than of a run, and a test that passed
  a judge nothing and asserted it read nothing would be testing the test.
- **Anything about a `policy` objective.** Unchanged from ADR 0030 and ADR 0031: it needs a
  registry of named, versioned rules, and it is its own slice.

## Verification

- Failure sweeps (`test_judge_independence.py`) cover, over every way an execution ends without a
  verdict: the rule-decided reading byte-identical across two arms, the judged rows deferred, and
  the failure recorded with the code the port declares. Beside them, the provider this lab cannot
  reach — the reading unmoved, nothing recorded at all, and the row still unscored — and the real
  Pydantic AI judge over a model that answered something unreadable, which is the malformed
  verdict proved through the recorder rather than at it.
- Coverage tests (`test_judge_independence.py`) hold the sweeps to what they claim: the failure
  table covers `JudgeFailure` exactly, contains every classified error the port declares, and
  contains at least one it does not; the anonymity terms carry every declared framework's id,
  label, models and providers; and the reading being compared is read off a real experiment —
  three rows no judge owns, one of each shape ADR 0030 decides, each at the outcome it actually
  reached, with the rendering shown to tell two arms' versions of one row apart.
- Standing-verdict tests cover the defect and the cases around it: a failure after a verdict, in
  each of the five ways, leaving the verdict standing at attempt 1 with both executions kept; a
  row only ever failed on reading as unscored and reporting the *newer* outage; and a verdict
  scored after a failure that followed a verdict standing at attempt 3 — the newest verdict, not
  the newest attempt and not the first.
- Rerun tests cover a rerun that disagrees keeping both readings and reporting the newer, a rerun
  after a failure scoring the row the failure left alone, and four readings of one experiment
  across four judge states producing one set of bytes.
- Separation tests sweep the closed verdict vocabulary — every value a judge may return leaves the
  rule-decided reading unmoved — and write a judgement addressed at a deterministic row directly
  into the store to prove it does not reach it.
- Anonymity tests run one arm per proven framework, score it with a judge published to see every
  scope, and read every string of the briefs the runtime received against the catalog's own terms,
  plus the arm's label, its run identifier, and its experiment's.
- Provenance tests cover every row of a pass naming its judge, version, provider, model and
  fingerprint, with the rubric resolved back out of the published version and each fingerprint
  paired against the digest of the brief that row's runtime call actually carried; the fingerprint
  unchanged when the record is and moved when the record moves; and a pass scoring two judged rows
  landing each verdict on the row whose brief asked for it.
- Existing suites are not re-derived: the mechanisms `test_judge_runs.py`,
  `test_judge_brief.py`, `test_judge_runtimes.py` and `test_evaluation.py` already pin are read
  as given, and all of them still pass against the changed reading. Two cases here do stand
  where one of theirs does — the unreachable provider and the rerun after a failure — because
  each gains the byte comparison beside it, which is the whole of what this slice adds to a case
  that was previously asserted on one row.
- No frontend or Playwright change. The reading's shape is unchanged — a row still carries at most
  one judgement — so no consumer or journey moves. The contract's own description of what a failed
  execution does to a row is corrected in place, which is a documentation change to a published
  operation rather than a change to it.

## Migration

None. No table, column, constraint, or fingerprint changes, and no published definition is
touched. Every judgement already recorded is read exactly as it was written; what differs is
which of an arm's executions a row reports, and only for a row whose latest attempt failed after
an earlier one had scored — a state no test, screen, or journey previously exercised.
