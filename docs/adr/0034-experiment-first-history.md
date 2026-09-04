# ADR 0034 — Experiment-first history, and the persona-first listings it replaces

Status: accepted — 2026-09-04

Delivers `docs/PLAN.md` Milestone 5's fifth outcome: persona-first history replaced by
experiment-first filters and detail pages. Records the cross-shop listing contract frame 10
asks for, the row as a projection of the record it lists, the filters and the options they
are offered from, and the two POC listings this removes.

## Context

Every experiment this lab has run is already fully described. The record says what was
pinned and what was frozen (ADR 0025), the standing says what each arm is waiting for
(ADR 0029), the evaluation says where each arm stands against the scenario's objectives
(ADR 0030), and the results screen compares all of it arm beside arm (ADR 0033).

What was missing is the way *in*. An experiment has been reachable only from the bench that
started it: `GET /shops/{id}/experiments` lists what has been started in one shop, and the
setup screen renders the last few in a card. That is the right thing for an operator who is
coming back to something they were driving, and the wrong thing for the question this
milestone exists to answer — "what has this lab run, and which of those runs is worth
reopening" — which is asked across shops, over months, and about runs whose names the
operator no longer remembers.

Beside it, the POC's own history is still published: `listConversations` and
`listGeneratedScenarios`, the persona-first listings ADR 0010 built. Their frontend was
removed with the Studio shell (ADR 0013) and `docs/decisions-and-next-step.md` has recorded
them since as "implemented POC behavior, not the target historical record". Until now
nothing else was, so they stayed.

## Decision

### History is one cross-shop listing, and the shop is a filter on it

`GET /api/v1/experiments` lists every experiment the lab holds, newest first, narrowed by
shop, scenario, framework, status, objective outcome, start date, and free text, and paged
by number with a total.

Not under a shop, deliberately. An operator asking what a framework did is not asking about
one shop, and the experiment lab is already the shell's cross-shop section — it is where the
agent configurations and the judges live. The shop stays a filter, so the question "what did
Northstar run" is still one selection away, and a row that belongs to another shop still
opens into that shop's bench.

`GET /shops/{id}/experiments` stays exactly as it is. The two answer different questions and
the bench's is not a special case of history's: it is the recently-started list a running
workspace needs, and narrowing a whole lab down to one shop in Python is work the index
already does in SQL.

### A row is a projection, and it is the same reading as the screen it opens

Every value on a history row — where each arm stands, what each arm met, how many of its
objectives anything decided, whether it missed a requirement, what version it pinned — is
read through the same `ExperimentService` and `ExperimentEvaluationService` the bench and
the results screen read. Nothing is stored, no column is denormalized onto `experiments`,
and no count is computed here that is not already computed there.

That is ADR 0027's rule for the timeline, ADR 0029's for the standing, ADR 0030's for the
evaluation, and ADR 0033's for the comparison, applied one level further out — and it
matters most here, because a listing is exactly where a cached summary is tempting. A row
saying "6/7" over a results page saying "5/7" is the contradiction that makes evidence stop
being evidence, and the only way to be sure it cannot happen is for both to be one reading.

The honest cost is that answering history reads every experiment *in full*. Each row goes
through `get_experiment`, which loads that experiment's participant turns, agent turns, tool
events, mutation events, and both arms' whole sandbox states, and then its judgements — for
every experiment the lab holds, including the ones a shop or scenario filter is about to
discard and the ones that fall off the requested page. The record is also read twice, once by
the listing and again inside the detail read.

Two things make that the right trade for now rather than an oversight. Filtering on status,
outcome, or framework is impossible before an experiment has been projected, so a
record-level pre-filter would only ever narrow *some* of the filters, leaving two rules for
one narrowing. And the filter options are read from every experiment by design — narrowing
the projected set would narrow the options with it, which is exactly the trap the section
below refuses.

So the pre-filter is real work rather than a switch: it needs the facets to come from a
second, cheaper pass over the record columns before it can narrow the projections. The
columns it would use (`shop_id`, `scenario_id`, `created_at`) are indexed and the listing
already orders by them, so that is the first move the day a lab is large enough to feel this.
What must not happen in the meantime is a stored summary — a slow reading can be made fast,
while a second source of truth has to be kept true.

### The status is a reading, not a state anyone sets

`ExperimentStatus` is three values decided by two readings that already exist. An experiment
is `running` while any arm still awaits its agent or the customer; once every arm has
answered the last turn its scenario allows, it is `failed` if any arm missed something the
scenario marked **required**, and `completed` otherwise.

"Failed" is the evaluation's word, not a new one: ADR 0030 already defines an arm's failure
as a missed required objective, and severity already decides what a miss costs rather than
whether it is one. So a missed *expected* objective finishes an experiment without failing
it, exactly as it leaves the arm's row a miss.

Waiting beats failing where the two compete. An experiment with one settled arm holding a
missed requirement and one arm still being driven reads as running, because the experiment
is what the pair produced and the arm beside it can still meet its own. Reporting it as
failed would be reporting a half-finished comparison as a verdict.

### The filter options are read from the runs, not from the libraries

The response carries the shops, scenarios, and frameworks that appear in the lab's
experiments, and the page fills its dropdowns from them.

A scenario nobody ran is not a way to narrow history, and a definition renamed or abandoned
since still has to name the runs it produced. Reading the options from the record also keeps
the screen one read rather than four, so the filters can never be rendered against a lab the
rows were not listed from.

They are deliberately *not* narrowed by the current filters: an operator who has selected one
shop must still be able to select another, and a facet list that collapsed to the current
selection would trap them.

### The row keeps the names it ran under, and says when the recipe moved on

The scenario name on a row is the name of the version the experiment pinned, and the
configuration name on each arm is the name that version was published under — so a recipe or
a configuration renamed afterwards never renames what a historical run says it ran. The
`ArmRuntime` reading gains that name for the same reason it already carries the framework and
the model: it is what this arm ran, read from the exact version it pinned.

The shop name is deliberately the other way round — the shop as it is called now — because
the shop is an identity here rather than a version: it is what the shop filter narrows by,
and a row filed under a shop should carry the name that shop answers to.

`scenario_superseded` says a newer version of the recipe has since been published. It is
provenance and not a warning: the experiment stays reproducible from what it pinned
(ADR 0025), and what the flag tells an operator is that running the scenario as it reads
today would be running something else. The frame's "replay uses v1" clause waits for replay,
which is Milestone 5's sixth outcome.

### A filter is read as UTC, or not read at all

`started_after` and `started_before` are normalized to UTC when they arrive without an
offset. Every timestamp this lab records is UTC, so a naive value has one sensible reading
and refusing it would only make an operator type a `Z`; and the comparison downstream is
against an aware timestamp, which Python refuses to guess at. That normalization is the one
the removed conversation listing did, kept because it was right rather than because it was
there.

The closed vocabularies are enforced at the boundary — a `status` or `outcome` the contract
does not publish is a 422 — and the client mirrors that rule by dropping an unpublished value
out of the URL instead of sending it. A shared link with a stale filter in it should narrow
nothing, not fail to load.

### The narrowing lives in the URL

Filters and page are search parameters, so a filtered history is a link. That is the rule
ADR 0033 gave the results screen's depth tabs, and it holds here for the same reason: a
finding is worth sharing at the narrowing it was found in. Narrowing returns to the first
page — page four of another filter is not a page — and the text search is applied on
submission rather than per keystroke, because a request per keystroke would read the whole
lab on the way to a word nobody has finished typing.

### The persona-first listings are removed rather than left published

`listConversations` and `listGeneratedScenarios` are gone, with their read models, their
filters, their repository queries, and their tests. The conversation and persona resources
themselves stay: starting, resuming, messaging, deleting, and the order-action protocol are
still implemented POC behavior, and this slice does not replace them.

What is replaced is the *history*, which is what the outcome names. Keeping two published
listings — one over conversations by persona, one over experiments by scenario — would be
precisely the "accidental hybrid model" Milestone 1's acceptance criteria forbid, and the
plan's rule against compatibility layers for discarded POC data applies to a listing nothing
consumes. The two cascade tests that observed their dependents *through* those listings now
observe them through the reads that remain, which is a better observation anyway: a deleted
conversation answering 404 is the fact; its absence from a page was a proxy for it.

The offset-paging bounds those listings introduced survive, because history pages the same
way and for the same reason: a page addressable by number needs a total.

## Deliberately not here

- **Notes, tags, replay, and fork.** Milestone 5's sixth outcome, together with state diffs
  and traces. The frame's tag filter and its "replay recorded versions" / "fork with newer
  versions" quick actions belong with them; `scenario_superseded` is the reading they will
  hang from, and nothing here stores anything that would block them.
- **Export.** The frame's export control is a second serialization of a listing that is
  already a public contract; nothing in the milestone's outcomes asks for one yet.
- **A sort control.** There is one order — newest first — and it is the record's own. A
  control offering one option would suggest there are others.
- **A per-experiment sequence number.** The frame numbers its rows (#18, #17); this lab
  identifies an experiment by the name the operator gave it and the shop it ran in. A
  sequence column would be a second identity to keep true.
- **Detail pages of its own.** The outcome's "detail pages" are the results screen and the
  bench, which ADR 0033 and ADR 0025 built. History is the way in, not a third rendering of
  one experiment.

## Verification

- History contract tests (`test_experiment_history.py`) cover the row and the narrowing: one
  started experiment as one row naming its shop, its recipe version, and the configuration
  version each arm pinned; an arm counted against what was decided *for it* — nothing yet
  for a fresh run, and one missed requirement after the cap settles it, which is what makes
  the experiment `failed`; a newer published recipe marking the row it did not run; two
  shops listed together and narrowed to one without the other leaving the filter; narrowing
  by scenario, framework, outcome, status, text, and start date; the filter options read from
  the runs themselves; a filter written without a timezone read as UTC rather than crashing
  the listing; paging by number over the whole matching set with every experiment on
  exactly one page; the page bounds refused; an empty lab; a configuration renamed after its
  run still named as it ran; and the two removed persona-first listings gone.
- Domain tests (`test_evaluation.py`) cover the status rule on its own: a running arm beside
  a settled failing one is running, a settled arm that missed a requirement failed, a missed
  *expectation* completes without failing, and a standing read without its own evaluation is
  refused.
- Frontend tests (`History.test.tsx`) cover the page: every run listed rather than the
  current shop's, each arm's fraction against its own denominator with no total anywhere, a
  superseded recipe marked and a current one not, a failed run and a live one distinguished,
  each row opening the evidence and the bench of the shop that ran it, narrowing by every
  filter, search applied on submission rather than per keystroke, a narrowing restored from
  the URL, a URL carrying filter values and a page the contract does not publish narrowing
  nothing rather than failing, the listing marked busy while the next narrowing is read with
  the rows it has still on screen, paging that starts over when narrowed, a lab it cannot
  read reported with the backend's own reason, and the rail's History entry now leading somewhere.
- The Playwright journey (`experiment-start.spec.ts`) ends in history: after driving both
  arms and reading the results and the timeline, the operator finds the experiment in the
  cross-shop listing with both arms' configurations, arm A's two decided rows beside arm B's
  none, narrows to a name nothing was given and gets an empty listing rather than an empty
  lab, and follows the row back into the evidence it summarizes.
