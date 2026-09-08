# ADR 0043 — The demo seed: one command, one finished example, and a refusal

Status: accepted — 2026-09-08

Records a change outside the roadmap. Every milestone in `docs/PLAN.md` is complete, and this
adds no product capability: it is a developer tool that writes, into an empty database, one
complete instance of what the roadmap built. It consumes the whole chain rather than
extending any part of it — the definition lifecycle (ADR 0012) and the shop, customer,
support identity, order, ticket, block library and scenario recipe on top of it (ADRs
0013–0018), the snapshot and its clones (ADRs 0019, 0020), agent configurations (ADR 0024),
the experiment envelope and its setup gate (ADR 0025), the runner and its tool evidence (ADR
0026), bound faults (ADR 0028), deterministic evaluation (ADR 0030), the versioned judge (ADR
0031), notes and tags (ADR 0036), and the offline two-arm comparison ADR 0042 established.

Records four decisions: that the seed writes through the application services rather than the
repositories, that it composes for itself rather than borrowing the API's composition or the
suites' factories, that it reuses the incident declaration and duplicates the demo content,
and that it refuses a database it did not find empty instead of merging with one.

## Context

The state this project is normally in on a fresh machine is a schema with nothing in it.
`make migrate` builds the tables and stops there, and every screen the product has reads a
chain that starts at a published shop and ends at a run with evidence on it. Frame 2 needs a
catalog. Frame 4 needs a block library. Frame 6 needs a published recipe and two published
agent configurations that differ in one dimension. Frames 7 through 9 need an experiment that
has actually been driven, with tool calls, a fault, decided objectives, a judge's verdict and
a measured cost. Frame 10 needs a filed, annotated run to filter.

Building that by hand is roughly an afternoon of clicking through gates in dependency order,
and it produces something slightly different every time. The accumulated result of doing it
repeatedly was a development database holding 1,316 drafts and 1,013 published versions, most
of them one-field variations authored to check a validator, alongside dead rows from the
persona-first prototype — and four migrations behind the build that was reading it. Deleting
it cost nothing that could be named, which is the clearest possible statement about what that
data was worth. What was worth something was the half-hour of clicking needed to get a single
screen to show anything again.

So the demand is narrow: one command, one coherent example, no credential, no provider, no
money, and the same story every time. And the risk is equally narrow. A seed is code that
writes the product's own data without a person in front of it, which is exactly the shape of
thing that acquires a shortcut — a repository call to skip a gate that is "obviously"
satisfied, an insert to avoid a validation that is "only" about authoring. A seed with one
shortcut in it stops being evidence that the chain works and becomes a second, weaker chain
that has to be maintained beside the real one.

## Decision

### The seed writes through the application services and touches no repository

`presentation/seed/demo.py` reads, top to bottom, as the sequence of actions an operator
performs: create the shop, replace its draft, publish it; create the customer attached to
that shop, publish her; author the order from selections; open the ticket, publish it; create
and publish each block; compose the recipe and publish it; publish two agent configurations
and a judge; start the experiment; advance each arm; deliver a turn; advance again; score;
tag; annotate. Every one of those is the application service the corresponding HTTP route
calls. Nothing in the package imports a repository except `services.py`, which exists to hand
the repositories to the services, and `runner.py`, which counts rows to decide whether to
refuse.

That is the whole safety argument. The shop's publish gate refuses a shop with no default
tone of voice whether the draft came from a person or from this file. The ticket's gate
refuses a ticket whose shop is unpublished. The scenario's gate resolves every binding
against the shop's real orders and documents. The agent configuration's gate checks the
enabled tools against the adopted identity's permissions, and the setup gate checks that the
two arms differ in one dimension. The seed does not weaken any of them, and could not
without the change being visible as a repository call in a package that otherwise has none.

The rejected alternative was to write the canonical documents directly, which is faster,
order-independent and needs no gate to be satisfiable. It was refused because the resulting
rows would be *claims* that the chain produces them rather than evidence that it does — and
because the first time a gate changed, the seed would keep producing documents nothing in the
product would now accept.

### It composes for itself, rather than borrowing the API's composition or the suites'

`presentation/seed/services.py` builds every service the story needs over one session and one
clock. That is a third composition root beside `presentation/api.py` and
`tests/workspace_factories.py`, and the duplication is deliberate.

Composition is where a process declares what it is: which database, which frameworks can run
an arm, which providers can score, which tracer, which clock (`docs/architecture.md`). Those
answers genuinely differ here. The API composes whatever the environment configured and a
real clock; the suites compose a control runtime and a per-test database; the command
composes two scripted frameworks, a control judge, a database it was pointed at, and a clock
that starts at a fixed instant. Extracting a shared builder would have to be parameterized by
all five, at which point it is the same code with a longer signature and one more place for
the three entry points to quietly disagree.

What is emphatically *not* duplicated is anything below composition. The seed and the API
construct the same `ExperimentService`, the same `ExperimentRunner`, the same
`SandboxToolService`, wired the same way — including the detail that the runner and the fault
schedule share one clock, because a fault reading a clock of its own would cost the run it
fired into nothing.

A wider refactor that lifted `api.py`'s ~350 lines of dependency closures into shared
functions was considered and rejected for this slice. It is a real improvement and it is a
change to the HTTP composition root, which is not what a seed slice should be carrying.

### The test factories are reused where they are a mechanism, and duplicated where they are copy

`tests/workspace_factories.py` is the closest thing to a seed that existed, and it is 640
lines of two different things. The decision splits along that seam.

The **incident** — what the agent decides, and how each SDK's offline model seam is told —
was reused, by moving `incident_script.py` and `incident_runtimes.py` out of the test tree
into `infrastructure/agents/scripted/`. It is a mechanism: one declaration that walks the
reads, the proposal and the confirmation, and two runtimes that drive each framework's real
adapter from it. Duplicating it would mean two incidents that have to be kept identical for
the comparison to mean anything, which is precisely the property the declaration exists to
guarantee structurally. The move is safe because the modules were already what the lab keeps
in infrastructure — deterministic doubles behind a port, selected by composition, exactly
like `agents/fake`, `participants/scripted` and the control judge — and because the two SDK
imports it brings into the source tree were admitted to the isolation sweep deliberately,
naming the runtime file rather than the directory so the declaration beside it stays
framework-free.

The **content** was not reused, and is not shared in the other direction either. A test
fixture and a demo are answering opposite questions. `publishable_shop()` publishes a shop
whose entire FAQ is "Two days." and whose escalation guideline is "Escalate above 500." —
correct, minimal, and exactly right for a suite that breaks one rule at a time and asserts
the one finding it caused. It is the wrong thing to put in front of somebody opening the
product for the first time. `presentation/seed/content.py` therefore carries its own shop,
customer, order, ticket, templates, recipe, prompt and rubric, written to be read.

Three values are quoted in both places and must stay aligned: the order reference `NS-10482`,
the shipping policy's ID `shipping`, and the customer's default address-book entry. The
incident declaration names them, so both the suites' workspace and the demo's shop have to
hold them. That coupling is documented at both ends rather than removed, because removing it
would mean the script deriving what to ask for from the world it is asking — and a script
that reads the answer is not a script.

### The demo is the wrong-address incident, run to completion under both frameworks

One shop selling three products with variants, media, typed attributes and reviews; three
policies, four FAQ entries, three support guidelines and two tones of voice. One customer
with three saved addresses, a persona, a background and hidden facts — including the Bordeaux
flat she left in June and never removed. One paid, unfulfilled order still shipping there.
One published ticket carrying the message that opens the incident, on top of a prior exchange
about the payment. Three objective templates and one fault template. One published recipe
composing them, with the fault bound to fire on the first read of the order. Two published
agent configurations differing in the framework and in nothing else. One published judge.

Then the run: the experiment started, both arms advanced on the trigger, one follow-up
delivered to both, both advanced again, scored, tagged and annotated. Twelve definition
drafts and twelve published versions, one snapshot, two sandboxes, four participant turns,
four agent turns, twenty-two tool events, two fired faults, thirty spans, two judgements,
three tags and one note.

The recipe's turn cap is **one** — the trigger, and one follow-up — and that is a decision
rather than an accident. An arm is complete when it has answered the last turn its scenario
allows (ADR 0030); at the twelve-turn default the demo would read as two arms waiting for a
customer, which is a bench to finish rather than a result to look at. The incident genuinely
fits in two turns, so the cap is set to the number the story needs.

### Both frameworks run their real adapters, against models that are doubles

The two arms declare `pydantic-ai` and `openai-agents`, and the runtimes composed for them
are the real adapters — schema derivation, wire naming, serial execution, message mapping,
usage accounting, failure translation — with a double only at each SDK's own
provider-neutral model seam. No credential is read, nothing leaves the machine, and the
record is the same one every time.

The alternative was to register the declared control policy under the two frameworks' names,
which would need nothing moved out of the test tree. It was refused as a lie the record would
carry: the timeline points at the adapter that produced each turn (ADR 0027), the framework
filter offers what the runs themselves name (ADR 0034), and a demo whose comparison screen
attributed one framework's output to another is worse than a demo with no comparison in it.

What this costs is stated plainly, in the seed and here: because both arms walk one
declaration, the demo shows two frameworks producing *the same decisions*, and nothing in it
is evidence that either chooses better. Only a live run shows that, which is ADR 0042's
distinction and this seed inherits it whole.

### The clock steps rather than ticks

`infrastructure/clock.py` gains `SteppingClock`, an adapter of the same `Clock` port
`SystemClock` implements, which starts where it is told and advances a fixed step per read.
The seed starts it three days after the customer opened the ticket.

A wall clock would make two developers running one command produce records that differ in
every timestamp, so a screenshot of the story would never match. A frozen clock was refused
for the opposite reason: duration is measured over this clock, and an arm reported as having
taken no time is a measurement rather than an absence, and a false one (ADR 0032).

### It refuses a database it did not find empty, and one that is not at the head

Two gates sit in front of the seed, and both refuse rather than repair.

The first is the migration head. The database must carry the schema and be stamped at this
build's head revision, read from the checkout's own migration tree. A database four
migrations behind — the exact state the deleted development database was in — would otherwise
be seeded into a schema the build no longer describes, and the failure would surface later as
something unrelated.

The second is emptiness, counted over the eighteen tables the story writes. If any of them
holds a row the command names them with their counts, says that it never merges, overwrites
or deletes, and tells the operator to delete the database file and migrate again. The POC's
own tables are deliberately not counted: the seed writes none of them, so prototype rows are
not something it would be overwriting.

Wiping was rejected because a command that can silently destroy an afternoon of authoring is
a command nobody should run without reading it first, and upserting was rejected because
there is no key on which a demo could sensibly be merged into somebody else's data. Refusing
is what this project already does when it cannot proceed honestly, and the operator's reset
path — delete the sqlite file, `make migrate`, `make seed` — is short enough to be the whole
remedy.

The whole story is written in one transaction, so a seed that failed halfway leaves nothing
behind and can simply be run again. Without that, the emptiness gate would turn a transient
failure into a database that must be deleted.

### It is a command, and never a route

`make seed` runs a CLI in the API package. Nothing about the seed is reachable over HTTP,
`packages/contracts` is unchanged, and no schema, route or generated type moves. A running
lab must never be one request away from being overwritten with a fixture, and a seed on the
public contract would be exactly that — including on a deployment where the operator is not
the person who wrote the data.

The package lives under `presentation` because that is where this project composes a process.
A command is a second entry point beside the HTTP app, not a fifth layer, and putting it
anywhere else would either invent an architectural tier for one file or push composition down
into a layer that must not perform it.

## Deliberately not here

- **A second experiment, a replay, or a fork.** ADR 0038 and ADR 0039 built both, and both are
  one click away from the seeded run. Seeding a derivation would make the history listing
  demonstrate a relationship instead of demonstrating a run, and the first thing an operator
  should do with a demo is drive it themselves.
- **A failing arm, a refused tool, or an unmet objective.** Every screen reads a resolved
  incident here. A demo that also carried a broken one would be twice the content and half the
  story, and the failure surfaces are covered by their own suites.
- **A second shop, or a second scenario.** The history filters would look busier with three
  rows in them. They would also stop being one coherent example, which is the thing an
  afternoon of clicking could not produce and this command can.
- **Reset, wipe, or reseed.** No flag does any of them. The reset path is deleting the file,
  which is honest about what it costs and cannot be mistaken for an ordinary operation.
- **A `--count` or any parameterization of the content.** The demo is one story. A seed with
  knobs is a fixture generator, and the project already has one of those in its test factories.
- **Any migration, contract, or fingerprint change.** The seed writes rows the product already
  writes, through the code that already writes them.
- **A live-model variant.** A `--live` flag would put a spend behind a command whose whole
  point is that it is safe to run. The live path is `test_live_model_runtimes.py`, gated on an
  opt-in variable, and it stays there.

## Verification

- `test_demo_seed.py` runs the command against a database in the state `make migrate` leaves
  and reads the result back through the services every screen reads it through, asserting
  content rather than counts: the history listing holds exactly one row, naming the shop and
  the scenario, completed, with both arms complete, neither failed, and three of three
  objectives decided and met; the filter rail offers the shop, the scenario, both frameworks
  and all three tags, none of them empty.
- The comparison is asserted as the whole matrix, with framework the only differing dimension,
  so a seed that also moved the model or the adopted identity fails here rather than shipping
  an experiment nothing can be attributed to.
- The evidence is asserted per arm: the full published call sequence at the versions the
  contracts declare, every call on the trigger succeeding, the proposal and the apply both
  present in both arms, every turn answered, the fault fired exactly once into each arm with
  the revision moving, and a state diff carrying the values — Bordeaux to Lyon, the address
  entry the redirect came from, and the fulfilment the fault advanced.
- The cost cards are asserted to be measured and above zero on both arms and to differ between
  them, which is the distinction ADR 0032 exists to keep: an unmeasured arm and a zero-cost arm
  mean different things, and a demo showing either would demonstrate the wrong one.
- The judge is asserted through the row it decided, not through the pass that ran: the
  judge-assessed objective carries a verdict in both arms, beside the two rule-decided rows.
  A demo whose objectives were all deterministic would leave the rubric, the scoring pass and
  the verdict column with nothing to show.
- The annotations are asserted as the note and the folded tag set an operator would have
  written, because frame 9's strip and frame 10's tag filter are the two surfaces that are
  empty on any run nobody has written on.
- The gates are asserted from both sides. Every definition the seed authored is asserted to
  have reached a published version, and the scenario version is read back for the objectives
  and the fault it pins. Seeding twice raises the refusal, which names the occupied tables and
  the way out — and the database is then read again to prove the first demo is still the only
  one and still has its own identifier.
- Both refusals have their own case: a database with no schema, and one stamped at a revision
  this build has moved past. The stale case is the one that motivated the check, and it is
  built so that only the stamp can catch it — the tables are present, because they were built
  from today's metadata.
- Offline is checked twice over. The seed is run with the declared default settings rather than
  the process's, so no credential reaches it: composed against the ordinary framework registry,
  neither model-backed framework would be available without one and the first advance would be
  refused, which makes completing without a key a statement about which runtimes composition
  chose. Sockets are then removed for the duration of the run.
- The command itself is covered where it is worth covering: it prints the thirteen distinct
  identifiers it wrote and exits zero, and on a second run it prints nothing to stdout, says
  why on stderr, and exits one.
- `test_agents.py` gains the offline model seam in its SDK isolation sweep, naming the runtime
  file rather than the directory, and `test_framework_comparison.py` continues to assert
  structurally that the incident declaration imports no SDK — now reading the module it
  imports rather than a sibling path.
- `make check` passes offline with no provider key. No live-model test was run.

## Migration

None. No table, column, canonical document, fingerprint, tool contract, published version or
HTTP contract changes, and `packages/contracts` is untouched. The seed writes rows the product
already writes, at migration head `20260907_0020`, and refuses to write any at all against a
database stamped anywhere else.
