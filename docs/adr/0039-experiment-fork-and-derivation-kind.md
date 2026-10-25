# ADR 0039 — The fork: the same run, with one thing changed on purpose

Status: accepted — 2026-09-07; amended 2026-10-25

Completes `docs/PLAN.md` Milestone 5's eighth outcome, whose other two thirds are traces
(ADR 0037) and replay (ADR 0038). Records what a fork is allowed to vary and why everything
else is held constant, the derivation table generalized with a kind — the call ADR 0038
deliberately left to this slice "with two cases in front of it" — the comparison warning
carried one level out so it is honest about what varies from the *source*, and the chains a
derivation is allowed to form.

## Context

The outcome names fork without defining it, and ADR 0038 defines it by contrast. A replay
reuses the world and the pins exactly and re-runs the script the source recorded; it refuses
to take a newer configuration version, and says why in as many words: "choosing newer
versions is what a **fork** is, the third slice of this outcome, and a replay that quietly
ran one would answer a different question under the old one's name."

So a fork is the deliberate opposite of a replay in exactly one respect, and identical to it
in every other. That is not a convenience: it is the whole of what makes a fork worth having.
A derivation that varied everything would be a new experiment, and the setup screen has
started those since ADR 0025. What a fork adds is that the thing it changed is the *only*
thing that changed, so a difference between the two records is attributable — which is the
same claim ADR 0025's comparison-variable warning exists to protect inside one experiment,
made one level out.

Two things were already in place for it. `ExperimentService.start` gained a `starting_state`
keyword in the replay slice, with exactly one caller and a guard that refuses a snapshot
frozen against a tool contract set this build no longer publishes (`0f62a1a`) — the only way
a run's two fingerprints could name two different tool sets. And `replay_script` reads a
recorded run's compositions as a script that a second driver can deliver. Neither is
replay-specific; both are about *deriving*.

## Decision

### A fork varies the arms, and nothing else

`POST /shops/{shop_id}/experiments/{experiment_id}/forks` takes one entry per arm of the
source, in the source's arm order, each naming a published `(configuration_id, version)`
pair. That is the whole request body, and the whole of what a fork may change: a newer
version of the configuration an arm ran, or a different configuration entirely.

Everything else is held constant, and each exclusion is a decision rather than an omission.

**The scenario version is not variable.** A recipe version determines the ticket that opens
every arm, the objectives an arm is judged by, the faults that fire into it, the turn cap that
ends it, and — through the snapshot — the starting state itself. A fork onto a newer recipe
could not reuse the recorded snapshot, so it would move the world as well as the arms; and the
source's recorded compositions would be delivered into an incident that may open on a
different question and cap at a different depth. There would be nothing left constant for the
derived run to be a comparison *with*. That is a new experiment, and the setup screen starts
one.

**The seed is not variable**, for the same reason one step in: it is part of what identifies
the snapshot, and `_recorded_state` checks it precisely so that an experiment's provenance
columns describe the starting state it is actually in.

**The participant script is not variable.** The customer's turns are what the two runs were
asked, and a derived run asked different questions cannot be compared with its source at all.
There is also nothing to vary it *to*: the only scripts this lab has are recorded ones, and
authoring a script is a feature nobody has asked for.

**The arm count and the arm labels are not variable.** The script is written in arm positions,
which is the only coordinate two experiments share (ADR 0038) — a fork that added an arm would
have no script for it, and one that dropped an arm would have turns with nowhere to go. The
labels stay because a comparison refers to an arm by its position ("arm A read the policy, arm
B did not"), and renaming one would only make the two records harder to read side by side. The
version each arm runs is on the row beside the name.

### The starting state is reused by identity, through the door the replay already opened

A fork clones the snapshot its source froze, exactly as a replay does, by calling the same
`start(..., starting_state=...)`. Re-materializing was considered and refused for a reason
sharper than the replay's: a replay that re-froze would be *wrong about its own claim*, while
a fork that re-froze would be **right about nothing** — it would have moved the arms and the
world in one act, and no difference in the answers could be attributed to either. ADR 0019's
copy-and-re-gate behavior means that is not hypothetical: an order edited since would silently
make the derived run a different experiment, and an order deleted since would refuse it.

Keeping one door also keeps the tool-contract drift ADR 0038 had to add a check for from
reappearing here. The check is in `_recorded_state`, which is on the reuse path rather than in
the replay use case, so a fork is refused by the same code for the same reason without a line
being written for it. A test drives that refusal from the fork side rather than trusting the
shared call, because "it comes for free" is a claim about the code that has to be checkable.

### A fork that changes nothing is refused

If every arm names the version its source ran, the operation is refused with the sentence that
says what to do instead: it is a replay. Recording it as a fork would put a word in the
provenance that tells every later reader something untrue about what an operator did.

The refusal is on the **pins**, never on the payloads. Asking for a different published
version is a real choice even where the two versions compare equal along every dimension this
lab reads — a republication may have changed only a name, or something no comparison dimension
covers — and the operator's intent is what the record is about. That is also why the kind is a
stored column rather than something derived from the comparison: a fork whose two versions
compare equal is still a fork.

### The provenance generalizes: one table, with a kind

ADR 0038 left this call to this slice. Taken: `experiment_replays` becomes
`experiment_derivations`, with a `kind` column whose closed vocabulary is `replay` and `fork`.

A sibling table was the alternative and it loses on every count. The two rows hold the same
three facts — the derived experiment, the run it came from, when — with the same key, the same
two foreign keys and the same distinctness check. They are read by the same three surfaces: the
results header (the results' Provenance card since the 2026-10-25 amendment), the history row, and the bench composer's sentence about what drove a scripted
run. With two tables every one of those readings would ask two questions and merge two nullable
objects that are never both set, and every future derivation would add a third. What actually
differs between them is one word, and that word is exactly what a reader must be shown, because
"replay of" and "fork of" are not the same sentence.

The wire field moves with it: `replay_of` becomes `derived_from` and carries the kind.
Retaining `replay_of` and adding `fork_of` beside it would have offered every consumer two
places to look for a fact that is only ever in one of them.

That is a **breaking change made in place in `v1`**, and it is worth being exact about which
rule it departs from. `docs/api-and-schema-conventions.md` says a breaking change "creates a new
major route version and a migration ADR; it never silently changes `v1`", and `AGENTS.md`'s
replace-in-a-cohesive-slice clause is not the licence: that clause is scoped to "the current
persona/scenario/conversation contracts", and the experiment contract is target-model rather
than POC. The argument is the conventions rule's own last word. What it forbids is a *silent*
change, and the precedent for a loud one is ADR 0034, which removed `listConversations` and
`listGeneratedScenarios` from `v1` in place — "replaced rather than left published beside its
replacement" — rather than minting a `v2` for a lab with one client.

This case is inside that exception on every count that matters. The field is one slice old; its
only consumer is this repository's own screens, which move with it in the same commit; the
change is complete and consistent across the OpenAPI document, the generated types, the
application, the frontend and the tests, so nothing can read the old name and silently get
nothing; and it is recorded here rather than discovered. A `v2` route for a lab whose only
client is in this repository would have been two published shapes of one fact, which is the cost
the rule exists to avoid rather than an instance of paying it. If either condition changes — a
client outside this repository, or a field that has been published long enough to be relied on —
the answer becomes a `v2` and this paragraph is the record of why it was not one here.

The service generalizes the same way. `ExperimentReplayService` becomes
`ExperimentDerivationService` with `replay` and `fork` over one private `_derive`, because every
rule in that body belongs to deriving rather than to either caller: the recorded snapshot reused,
the setup gate re-run, the compositions replayed, the driver recorded as `scripted`, the
provenance written before the script runs. All the callers decide is which arms run and what the
row is called.

### The setup gate applies unchanged, and the comparison warning is carried one level out

A fork goes through `start`, so it meets the same gate a hand-started experiment meets — the
tone override resolved against the shop the scenario pinned, the closure that disagrees with
itself, the faults this build can actually inject, and the dimensions the fork's own two arms
differ along. All of those are questions about published versions and about this process, and
all of them are as true of a derived run as of a first one. The gate is where a fork onto a
configuration whose tone override the target shop does not publish is refused, as a finding.

A fork onto a version *nobody published* is refused earlier and differently: resolving the arms
happens in `_selected` before the gate runs, and an unresolvable arm raises the configuration's
own not-found error, which the API answers **404** rather than 422 — the same status
`startExperiment` answers for an arm it cannot resolve, and for the reason ADR 0024 gave when it
refused an unknown identity with the identity's own error: a caller has to be able to tell a
stale arm from a stale experiment. The fork route's `422` description says what the gate and the
reuse refuse; the `404` says what cannot be resolved, and a contract test pins both so the two
cannot drift apart again.

What that gate cannot see is the comparison this outcome is named for. It counts the dimensions
along which an experiment's *two arms* differ — which for a fork is largely the count its
source already carried — and says nothing about what moved between the fork and the run it came
from. A fork is the operation most likely to introduce a second variable, and the second
variable it introduces is invisible to the rule written for the first.

So `derived_from` carries `changed`: the dimensions this derivation moved, read against the run
it came from. One entry is provenance and reads as such; more than one is the warning, in the
same words the gate uses — no difference between this run and its source can be attributed to
any one of them.

Four things about it are decisions rather than mechanics.

**It is a reading, not a column.** Both experiments are written once and their arms are pinned
by content, so the answer cannot drift; a copy taken at derivation time would be a second source
of truth for something the two records already say between them. It is served on the detail
beside the standing, the metrics and the state diff, for the reason ADR 0033 gave: a client
holding both records would otherwise be free to decide for itself what "changed" means.

**The pins are compared before the payloads, and only the arms that moved are resolved.** An arm
pinned to the exact version its source ran cannot have moved along any dimension, so comparing
it with itself would be work done to prove an identity — which makes the reading free for a
replay, where no arm moved at all.

**The dimensions are unioned across the arms rather than reported per arm.** Two arms both moved
to a newer prompt is *one* variable and reads as one question — does the new prompt help either
of them — while one arm moved to a newer prompt and the other to a different model is two, and
nothing the derived run produces can be attributed to either. Which arm each landed on is
readable from the arm rows beside it; what attribution needs is the set.

**It is a warning and never a refusal**, exactly as the gate's own comparison count is
(ADR 0025). An experiment with two differences is still worth running — it is often how a
suspicion starts — but nothing it produces is attributable, so the count travels with the record
instead of being discovered when someone reads the result months later.

### Faults, verdicts and annotations behave exactly as they do for a replay

A fault's once-per-arm key is the arm's (ADR 0028) and the derived arms are new rows, so the
scenario's faults fire into them again rather than being suppressed as already fired. A judge
execution is a model's reading of one arm's own brief (ADR 0031), and a fork changes the
configuration that arm runs, so copying a verdict onto it would be inventing evidence about a
configuration nobody scored. An annotation is what a reviewer concluded about the run they read
(ADR 0036), so a derived run starts unannotated. In all three cases the source keeps what it had,
and the tests assert both halves.

### Chains are supported, and each link is read against the link before it

A fork of a replay, a fork of a fork, and a replay of a fork are all ordinary derivations: the
source of a derivation is any experiment this lab ran. Nothing about the shape needed to change
for it — the row's key is the derived experiment, and it is derived once, by the act that created
it.

A derived run names its **immediate** source and no more. `changed` is read against that source
too, so a fork of a fork reports only what the second act moved and not the sum of the chain,
which is the honest reading: the run it is a comparison with is the one it came from. Following
the provenance link walks the chain a step at a time, and it terminates at a run somebody
started. An invariant falls out and is asserted: every experiment in a chain carries the same
`sandbox_fingerprint`, because every link clones the snapshot the first run froze.

### It is findable and readable through the surfaces that already exist

A forked experiment is an ordinary experiment, so the bench's per-shop listing and the cross-shop
history hold it without learning anything new (ADR 0034). Frame 9's header carries the `Fork…`
the replay slice left waiting; the ellipsis is real, because a fork asks which versions to take
and a replay asks nothing. It opens a panel below the header rather than a modal: this shell has
no modal primitive, and a derivation is read beside the run it derives from. The panel offers one
picker per arm and nothing else, because nothing else is a fork's to change, and its submit stays
disabled until something has moved — the backend refuses a fork that changes nothing, and a
control that can only fail is worse than one that says it is not ready.

Frame 10's quick-action legend says "fork with newer versions", and on a listing row that is one
decision rather than a question: every arm moves to the newest published version of the
configuration it ran. So a history row now carries `agent_configuration_latest_version` per arm,
beside the version the arm pinned and never instead of it — the same shape and the same motive as
`scenario_superseded` (ADR 0034). It is what says there is something newer to fork onto, and it
is what lets the row refuse to offer a derivation that would change nothing.

## Deliberately not here

- **Naming a derived experiment.** ADR 0038 pointed at this slice for it, and it is still not
  here. A fork is called the source's name plus "(fork)", trimmed at the label bound the same way
  a replay's is. A run is *about* an incident, and what an operator wants to say about the one
  they derived is a note (ADR 0036) — which is searchable, where a label is not. A `label` field
  on the request is one small addition the day somebody asks.
- **Varying the scenario version, the seed, the script, the arm count or the arm labels.**
  Argued above. The first two would need a second snapshot and would make the derivation a
  different world; the third would make it a different conversation.
- **A preview of a fork.** The setup screen's `previewExperiment` already judges an arbitrary
  arm set against the gate, and the fork panel could call it before submitting. It does not, and
  the honest statement of the cost is that the operator gets no warning *before* committing when
  the versions they picked would turn a one-variable source into a two-variable experiment —
  because the payloads of the versions being moved to are not on the screen, so nothing the panel
  holds can work that out on its own.

  What makes that acceptable is where the two warnings land. Both are on the screen the fork
  navigates to and neither had to be built for it: the derivation's own difference set is beside
  the run it names, and ADR 0025's comparison count over the derived run's *own* arms is in the
  provenance chip strip the results screen has drawn since ADR 0033 — so a fork that produced two
  differences says "2 differences — no behavior here can be attributed to any one of them" on
  arrival, and a test pins that. And the thing being warned about is cheap to have done: a
  derivation is a new record, the source is untouched, and the answer to a fork that moved two
  things is to fork the source again moving one. A pre-commit preview would turn every panel
  interaction into a round trip to buy a warning the operator sees a second later anyway; it is
  worth adding the day the derived run is expensive enough that arriving at it is a cost.
- **Refusing a fork that moves more than one dimension.** A warning, as the gate's own is.
- **Showing an experiment what has been derived from it.** Still nothing asks the question from
  that end, so there is still no listing and no index on the source column (ADR 0038). Both are
  one small addition the day a screen wants them.
- **A whole chain on one screen.** A derived run names one hop. Rendering the chain would need
  the reverse read above, or a recursive one, for a display nobody has asked for.
- **Forking one arm of a two-arm experiment into a one-arm run.** The comparison is the pair
  (ADR 0038), and the script has no coordinate for an arm that is not there.
- **Re-scoring or re-annotating a derived run.** Both are their own operations and stay so.

## Verification

- Domain tests (`test_experiment_domain.py`) cover the derivation reading on its own: one arm
  moved one way as one dimension, two arms moved the same way as one variable, two arms moved
  differently as two reported in the enum's own order, no arm moved as nothing, and an arm
  repinned to content that compares equal reported as having moved nothing — which is why the
  kind is stored rather than inferred from this reading.
- Fork tests (`test_experiment_forks.py`) cover what a fork changes: the chosen version run with
  the untouched arm still pinned, an arm swapped for a different configuration entirely, the one
  dimension a fork moved reported on the provenance, two dimensions reported rather than refused,
  and both arms moved the same way counted once. What it holds constant: the source's snapshot
  cloned again at the same fingerprint with the same recipe version and seed, the recorded
  compositions delivered to the same arms at the same depths with the linked send still one
  composition, the arm names kept, the arm nobody ran left unrun, and the scenario's fault firing
  again into the forked arm. What it leaves alone: the source's record, both streams, its tool and
  fault events, its arms' fingerprints and revisions, its recorded spans, and the verdict and the
  note that stay on the run they were made about. What it refuses: a fork that changes no arm, a
  fork naming the wrong number of arms, a fork onto a version nobody published, the experiment of
  another shop, and a starting state frozen against a tool contract set this build no longer
  publishes — driven from the fork side, because "it comes free from the shared path" is a claim
  that has to be checkable. And the chains, in all three directions: a fork of a replay naming the
  replay and still carrying the first run's sandbox fingerprint, a fork of a fork whose difference
  set is against its immediate source rather than the head of the chain, a replay of a fork
  reproducing the fork's *moved* arms and reporting that it moved nothing itself, one run forked
  twice as two experiments, and the derived run in the shop's listing.
- Contract tests (`test_experiment_api.py`) drive the operation: the 201 carrying a new
  experiment with the source's snapshot and fingerprint, the arm labels, the chosen versions and a
  `derived_from` naming the kind and the dimension it changed; the recorded script re-run on the
  forked arm with the other arm left where it was; the fork that changes nothing answered 422
  naming the replay; the wrong number of arms answered 422; the source unchanged with the derived
  row in history carrying `fork` beside a source whose own origin is null and whose arm reports
  the newer version there is to fork onto; the experiment of another shop answered 404; and an arm
  naming a version — or a configuration — this lab never published answered 404 with the
  configuration's own error code, which is what pins the route's two documented statuses to what
  it actually does.
- Migration tests (`test_migrations.py`) cover both halves of the generalization: a derivation
  recorded before this slice carried over as a `replay`, and the new table holding to what the
  service cannot produce — a kind outside the vocabulary, an experiment derived twice, an
  experiment derived from itself, and either end naming an experiment this lab never ran, over the
  engine the application actually uses so both foreign keys are live. And the downgrade both ways:
  refused while a fork is stored, and carrying the replays back whole once it is not.
- Frontend tests (`Experiments.test.tsx`, `History.test.tsx`) cover the surfaces: the results
  header forking onto the version an operator chose and opening what it produced, with the request
  carrying one arm per arm of the source and only the chosen one moved; the submit disabled and no
  request made where nothing has moved; the panel closed once it has derived, so the run it lands
  on does not inherit a draft written against the run before it; the configuration library
  reported as unreadable rather than offered as an empty picker; a derived run naming its source,
  the kind, and the dimension it changed, *and* warning that its own two arms now differ two ways;
  the history row forking every arm onto its newest published version and leaving the listing for
  the evidence; and the row offering no fork where every arm already runs the newest.
- The Playwright journey (`experiment-start.spec.ts`) is extended rather than duplicated, as every
  slice since ADR 0026 has been: having replayed the incident and read that it reached the same
  place, the operator suspects the prompt, opens `Fork…`, finds it refuses to derive until
  something moves, moves the arm that missed the read-check onto the configuration the other arm
  ran, and reads the derived run naming the run it came from, the one dimension it changed, and
  the same two standings the script left, with the panel closed behind it — then follows the link
  back to a source that has not moved.
- No new live-model test. A fork makes exactly the model calls an advance makes, and this journey
  runs the declared control runtime.

## Migration

`20260907_0020` builds `experiment_derivations` beside `experiment_replays`, copies every row
into it as a `replay`, and drops the old table. Built and filled rather than altered in place:
SQLite rewrites a table to add a constraint anyway, and both the table and its check constraint
are renamed here, so a batch alter would have left the old names on the new shape. The kind is
filled in rather than defaulted — the only operation that could have written one of those rows
was the replay, so the migration knows what it is looking at.

`kind` carries a CHECK for its closed vocabulary, as `participant_driver` and the span kind
already do. It is written in *this* migration rather than a later one deliberately: SQLite
rebuilds a table to add a constraint, so a table this migration is already building is the one
cheap moment to constrain it. And the constraint is not tidiness — a value outside the vocabulary
raises on the way back to a `DerivationKind`, which would take out both the derived run's own
screen and the cross-shop history that projects every experiment in the lab through the same
reading.

The downgrade **refuses** when the store holds a fork, rather than dropping the rows: the schema
it returns to has no shape for one, and the rule the generated-scenario migration set (ADR 0003)
is that a downgrade which cannot represent its data says so. ADR 0038's own downgrade simply
dropped the table it had created, which was lossless at the time because nothing had been written
through it yet; that is not the situation here, so the older precedent is the one this follows.
A replay-only store downgrades and comes back whole, and a test drives both halves.

## Amendment — 2026-10-25

On the results, the derived run's source — "A replay of …" or "A fork of …", the source's name
as a link to its results, and what the fork changed — moved from the header into the
*Provenance* card in the General tab's rail, with everything else the run froze before it
started (PLAN-UX Milestone 12). The depth tabs do not repeat it: General is the tab the results
open on, and the History row still names the source on every derivation. The live bench reads
the same card and names the source without linking it, as its pinned versions are not linked
(ADR 0068). The table, the `kind` vocabulary and the sentence's two words are unchanged.
