# Project plan — the record of what was delivered

Status: history — closed 2026-09-20; Milestone 8 appended 2026-09-28. **Read `docs/PLAN.md` for
the delivery rules, the vocabulary and the open work.** This file holds what that document carried
before it was compressed to open work only: the narrative of the implementation state as it stood,
and Milestones 0 to 7 as they were planned and delivered, verbatim. The ADRs each milestone names
are the authoritative record of the decisions; this is the roadmap's own account of them, kept
because it says why the milestones came in this order. Nothing here is edited any more, save that
a milestone delivered since is appended after Milestone 7, verbatim as `docs/PLAN.md` carried it:
Milestone 8 on 2026-09-28, whose plan is `docs/history/PLAN-UX-2026-09-20.md`.

The last section is the walk through delivered milestones that `docs/decisions-and-next-step.md`
carried under *Recommended next steps* until the same date.

---

## Current implementation state

The current POC already proves:

- a pnpm/uv monorepo, FastAPI backend, React/Vite frontend, and generated OpenAPI types;
- clean architecture boundaries, repositories, and a framework-neutral `AgentAdapter`;
- a minimal customer, product, order, scenario, session, memory, and action domain;
- deterministic seeded personas and canonical initial-state fingerprints;
- SQLite/SQLAlchemy/Alembic persistence with migration tests;
- read-only commerce tools and one confirmed, idempotent, optimistic cancellation action;
- Pydantic AI plus deterministic fake-adapter evidence;
- durable conversations, resume, persona/conversation listings, and a basic comparison view; and
- sanitized OpenTelemetry traces with optional Phoenix export.

Milestone 1 Slice 2 replaced the persona-first frontend with the target Studio shell and delivered
the versioned shop and catalog (ADR 0013). Slice 3 added versioned customer profiles and support
identities on a shared authoring lifecycle (ADR 0014). Milestone 2 has begun with shop-scoped order
fixtures: typed status axes, derived totals, authored events, and selection-only line items and
shipping addresses (ADR 0015), followed by versioned tickets — the first shop-scoped definition,
pinning its shop and customer-profile versions at publication (ADR 0016), then the shared objective-
and mutation-block libraries a scenario composes (ADR 0017), and then the scenario recipe and its
composition editor, which binds those templates to same-shop objects and pins every version a
publication freezes (ADR 0018), and then the canonical sandbox snapshot that turns a published
recipe into starting state by pinning what is immutable and copying the order fixtures nothing
pinned (ADR 0019), and then the independently mutable clone each experiment arm works in
(ADR 0020), and then the versioned read tools an arm interrogates that clone through (ADR 0021), and
then the safe address change an arm may actually make (ADR 0022), and finally the evidence that
holds all of it: recorded fingerprints for the canonical envelopes and a conformance sweep driven by
the tool registry rather than by a list (ADR 0023), which completes the milestone. Milestone 3 has
begun with the agent configuration: the support agent published as a versioned experiment input —
framework, architecture, model, prompt template, tool bindings, memory, and the support identity it
adopts — validated against what the lab has actually proven it can run (ADR 0024), and then the
experiment that binds one published scenario version to one or two of those configurations,
clones an arm per configuration from one canonical snapshot, opens both threads on the ticket's
triggering message, and takes every later customer turn through a participant-driver port whose
first implementation is the human operator (ADR 0025) — which also completes Milestone 4's
experiment record, shared trigger, linked composer, and comparison-variable warning. Milestone 4
has since gained the other half of those threads: advancing one arm runs its published
configuration against that arm's own sandbox through a new framework-neutral runtime port, and
records what it answered, every versioned tool call it made, the confirmation and revision each
write carried, and the attempt in which it failed — with two frameworks behind that port, a
declared deterministic control policy and Pydantic AI over the published tool contracts
(ADR 0026), then the normalized execution timeline that reads all of it back as one
framework-neutral stream, each entry carrying the project-owned file and line of the code that ran
it where this build can resolve one (ADR 0027), and finally the scenario's own faults firing into a
running arm at the moment the recipe bound them to — between two of the agent's calls, against a
declared table of what this build can actually carry out, recorded once per arm (ADR 0028), and then the experiment an operator comes back to: each
arm's standing read from its own record so a bench reopened cold says what it is waiting for,
and the question an arm passed over reported rather than left to be noticed (ADR 0029), and
finally the objectives the scenario composed judged against each arm's own record, with the
scenario's turn cap ending an arm and settling what it never did (ADR 0030) — which completes
Milestone 4 and opens Milestone 5's deterministic evaluation. Milestone 5 has continued with
the versioned judge that fills the rows no rule decides: a published rubric, model, and
declared evidence scope, scoring one anonymized brief per objective per arm and recording
every verdict with the version, model, and input fingerprint that produced it (ADR 0031),
and then what a run cost: the duration and the provider usage stored because they cannot be
recovered afterwards, and the turns, calls, retries, failures, and estimated cost projected
over the record beside them (ADR 0032), and then the results screen those readings are
compared on: every objective read arm beside arm, with the counts kept per arm and no
aggregate anywhere, and the execution timeline moved onto it as a depth tab (ADR 0033), and
then the way back into any of it: the cross-shop history an experiment is found again
through, whose every row is projected from the record the bench and the results screen read
— which also removes the persona-first listings it replaces (ADR 0034) — and then what an
arm's world actually became: the difference between the bytes its two fingerprints cover,
field by field, which is the half of "verified, not claimed" a revision counter cannot say
(ADR 0035), then the first thing about a run that the run did not produce: the notes an
operator writes on it and the shelves they file it under, stored beside the experiment so
annotating one cannot move the fingerprints it pinned, and offered back as a column, a filter, and
a search over words the listing never shows (ADR 0036), then the one reading of a run that
is stored rather than projected: the span tree each advance records, because where inside an
attempt each of its calls ran is gone the moment the advance returns (ADR 0037), and then the
first operation that does not read an experiment but derives one: a replay, which starts in the
world its source started in and is driven by the compositions that source recorded, because an
immutable record leaves no other way to run an incident twice (ADR 0038), and finally the
derivation that changes something on purpose: a fork, which holds the world, the recipe, the
arm positions and the recorded script still and moves only which published configuration
version each arm runs — so the one thing it changed is the only thing that changed, and the
difference between the two records is attributable to it (ADR 0039), which completes the
milestone's traces, replay, and fork outcome, and finally the evidence that holds the
evaluation together: every way a judge can fail or be rerun swept from the port's own
declarations, the rule-decided reading of a whole experiment compared as bytes across each of
them, and the brief checked against an arm run under every framework the catalog declares —
which found and fixed a judge failure that was shadowing the verdict standing beside it
(ADR 0040), and completes Milestone 5. Milestone 6 has begun with the thing the whole
record was built to hold two of: a second framework. What the first controlled comparison
changes is the framework rather than the architecture — the lab's vocabulary, its capability
catalog and its comparison warning are all keyed by framework, while `AgentArchitecture` still
has one member and nothing implements a second — and the framework is the OpenAI Agents SDK,
chosen over a TypeScript SDK whose bridge would have become the subject of the comparison and
over a graph framework whose distinctive half is the architecture dimension this slice
deliberately leaves alone. It runs behind the same port, the same recording invoker and the same
published tool contracts as the first, on the same provider and model so a two-arm run moves one
dimension; both adapters now derive their tool schema from one rendering of the argument table,
so "both arms were offered the same tools" is a property rather than a resemblance; and what the
two leave behind is swept as one shape — the same call vocabulary, string arguments, classified
failures, neutral usage and stored record — while what they said, chose and spent stays free to
differ, which is the whole of what a comparison reads (ADR 0041). And finally the question the
whole roadmap was built to ask, asked: one wrong-address recipe, one canonical snapshot, two
arms differing in the framework and in nothing else, both driven through the reads, the redirect
under its proposal and confirmation, and the fault firing into the order while they are still
reading it — read back through every surface the lab serves and asserted to agree in all of it,
while each framework's own contribution stays separately attributable and neither arm's world
or vocabulary reaches the other. Offline that holds the two arms' *decisions* identical by
construction, so what it establishes is the evidence model rather than a difference between
frameworks; how two models
actually choose is what a credentialed run adds, and no such run has been made here. Proving it
found the defect an adapter sweep could not: one SDK was showing its model a Python repr of the
tool result where the other showed JSON, so the two arms were being asked the same question in
two notations — now rendered once, by the lab, for both (ADR 0042), which completes Milestone 6.
Milestone 7 has begun on the person operating all of that rather than on what the lab records: a
settings surface at `/settings`, outside shop scope because the first step of a guided path is
creating the shop a new operator does not have yet, reporting the frameworks this build has proven
it can run and the envelope each was proven inside, the run mode and model it is composed for, and
whether an exporter is installed. All four are reports rather than controls: a credential and a
collector URL are environment, and a field for either would mean this application storing a secret
`docs/observability.md` forbids it from so much as recording. The one additive route behind them
serves three composition facts and deliberately no fourth — no prefix, suffix, length or hash of
the key, and no endpoint. While no credential is configured the surface carries the standing limit
ADR 0042 established and ADR 0043 could only write onto one seeded run: only the deterministic
control arm can be advanced here, and a comparison whose arms decide identically by construction
establishes the evidence model rather than a difference between frameworks. The shop-scoped entry
that was also called Settings is renamed to shop details, and the rail's default state and the
last-visited shop become preferences in the operator's browser rather than rows in the database
whose every other row is evidence an experiment pins (ADR 0044). Slice 2 turns that outward onto
the chain itself: a band inside the content column of the shops index and of each shop's home,
naming the one step that unblocks the path from an empty database to a two-arm comparison and
linking to the surface where that work is done. Every step of it is read off the listings the
product already serves — a published shop version, a published customer profile attached to the
shop, an order fixture, a published ticket, a stocked objective library, a published recipe, a
support identity, two published agent configurations, a judge, and a row in the history listing —
so nothing is written when a step completes, and a database filled by hand, filled in a different
order, or filled by `make seed` all read the same. A draft edited after publication leaves its step
complete, because what an experiment would pin is still there. Where a step is blocked the words
are the publish gate's own: the band renders that shop's `preview.issues` through the same
`IssueList` and `PublishReasons` its authoring surface renders, and opens the shop-setup page the
gate's first finding names, so there is no second explanation of why a shop cannot be published to
keep in agreement with the first. Guide mode is derived the same way — on while the lab holds no
completed experiment, off once it does — and what a browser stores is only a disagreement with
that, a third preference beside the rail's default state and the last-visited shop, offered as the
same three choices on the band and on the settings page. Completed is the status's own word: a run
whose arms finished but missed something the recipe required is `failed`, so a lab that has only
ever produced those keeps the band until one comes back clean, and an operator who disagrees says
so once. The words all of it speaks now have one
home: a glossary module carrying this document's stable target vocabulary, rendered at
`/guides/glossary` and referenced by the steps rather than restated by them. The band shows no
percentage and no step count, offers no per-step dismissal, and exposes no control that populates
the lab — `make seed` is text to run in a terminal, which is where ADR 0043's refusal would have
been most tempting to relax. Slice 3 writes the chain down. The setup guide at
`/guides/setup` walks it in dependency order for somebody who has nothing to read yet — ten steps,
eight of which end in a published version, each saying what it is and what refuses until it is
satisfied — and it walks the same table the band decorates rather than a second list, so the two
cannot come to disagree about what the chain is or what order it comes in; a step added to that
table and left unexplained on the page fails to compile. The fast path is at the top and is a
command: `make seed` as text to run in a terminal, beside the three commands that start an empty
database again, and nothing on the page performs either. ADR 0043 decided the seed is a command and
never a route, and a *load demo data* button is that route returning as a convenience, so the page
is asserted to carry no button in any of its cards; every other step is a link to the surface where
the work is done, composed by the same module the band's own actions are composed by. The screens whose vocabulary is not transferable from a commerce admin — the two block
libraries, the scenario composition editor, the starting states, the bench and the results — carry
an inline note on the band the strip already uses, saying what that screen is in the lab's own
words, with each of those words hovering the definition `/guides/glossary` renders rather than
restating it. The notes read Slice 2's guide mode rather than a second one, so an operator who
turned the guide off turned these off too, and their copy is plain text carrying glossary
references, which is what lets a test read back every word a note sends a reader to look up and
fail when one of them resolves to nothing (ADR 0044), and completes Milestone 7.

Then what the guide *shows* was changed. The band and the six notes are gone, and each of the
screens they covered — plus each shop's home — carries a control that walks you around that one
screen instead, dimming it and lighting one element at a time beside a popover that says what it
is. Nothing starts unbidden, no tour crosses a screen, and the copy is the notes' own, with every
defined word still hovering the one definition the glossary renders.

ADR 0044 had refused exactly this, on three grounds: that it pins the guide to geometry still being
designed, that it goes stale silently when a control moves, and that staleness in a tour is
invisible to every test this project runs. The first was overruled. The second is true and is
conceded. The third is closed: every tour is one declarative table of surfaces, anchors and copy,
and a Playwright sweep builds the whole chain and walks that table with a case per surface,
asserting each step still resolves to exactly one visible element on its own screen. A renamed or
moved control fails naming the step, and a step declared today joins the sweep today — which is
what ADR 0023's registry-driven conformance did for the eleventh tool.

The overlay is `driver.js`, pinned, MIT and dependency-free, skinned out of the tokens this project
already fixed rather than shipped as it comes: what a coach mark actually needs is a positioning
rule, and this work is no more entitled to invent one than the glossary's hover definitions were.
Guide mode stays as the one preference, deciding whether those seven controls appear at all, and
the authoritative frame set returns to eighteen, because a tour adds a control to a slot the
frames already specify and draws nothing that survives being dismissed.

What it costs is written down rather than tidied away: the derived reading is deleted, and nothing
in the application now tells an operator returning to a half-built lab which step is still missing
— `/guides/setup` walks the ten steps without knowing which of them this lab has reached
(ADR 0045).

Then guide mode itself went. Slice 2 built it and Slice 4 kept it, and both were right about the
guide they were looking at: a mode is what you need when the guide **draws itself** on screen, and
until Slice 4 the band and the six notes did exactly that. Once every reading became a button that
does nothing until it is pressed, the mode had one remaining job — hiding that button — and it did
it worst for the reader who needed it most. Its derived default was *off once the lab holds a
completed comparison*, which is the first thing `make seed` writes, so anybody who took the setup
guide's own fast path landed in a populated lab with the guide silently switched off and the switch
that brings it back on a settings page they had to already know about. So the mode is deleted, not
re-defaulted: there is no `lib/guide.ts`, no stored `agent-lab.guide-mode`, and no guide-mode
control on `/settings`, which keeps the rail preference and the last-visited shop. The seven *Show
me around* controls are simply there. What that costs is that no operator can turn them off
lab-wide, which is recorded as a cost and accepted for what it covers: seven buttons in a header
slot that was already carrying buttons, none of which does anything until it is pressed. The stale
key is left in the browsers that hold it rather than erased, because a reader kept alive to erase a
browser preference is a migration mechanism for a browser preference (ADR 0046).

Then the written guides went. Slice 1 put them beside settings, Slice 3 wrote the setup walk,
and Slice 4 kept both as the page that still listed the ten steps after the band came off.
Once every step of that walk lived on the surface it names, and the fast path lived on
settings, the section was an index of help the reader was already standing in. The header
carries Settings only. `/guides` and `/guides/setup` redirect there; the glossary moved to
`/glossary` as a destination for a defined word rather than a section of its own. What that
costs is that nothing walks all ten steps on one page any more — the same shape of loss Slice
4 recorded when the derived strip went, now true of the walk itself (ADR 0049).

The POC's remaining conversation, persona, and order-action HTTP contracts
remain published and tested but have no UI consumer; their two history listings were removed
by ADR 0034, which is the target historical record that replaces them.

The POC does not implement the target Scenario Studio, published agent configurations, LLM judge,
experiment-first history, or target wrong-address journey. Existing persona-first contracts and data may be replaced through cohesive
tested slices.

## Milestone 0 — Direction reset

### Goal

Prevent further work from extending obsolete POC assumptions.

### Outcomes

- [x] Approve the Simulation Studio and Experiment Lab product direction.
- [x] Record ADR 0011 and its relationship to POC ADRs.
- [x] Replace the old Vercel-first roadmap.
- [x] Mark persona-first and hard-coded scenario documentation as historical where necessary.
- [x] Update contributor entry points to distinguish current code from target architecture.

### Acceptance criteria

- A fresh contributor can identify the product source of truth and next implementation slice.
- No current document names a second framework adapter as the immediate next task.
- Historical POC behavior remains documented without being presented as the target product.

## Milestone 0.5 — Design direction selection

### Goal

Select the product design direction before building any target UI, so Studio, Bench, and History
increments implement one coherent information architecture instead of extending the POC's
persona-first navigation.

### Outcomes

- [x] Produce the three concept directions defined by `docs/design-brief.md`. A first iteration may
  scope each direction to its most differentiating signature frame (the live split-view experiment)
  before investing in the full stage-one frame set.
- [x] Evaluate the directions against the brief's evaluation criteria and record strengths, risks,
  and implementation implications per direction.
- [x] Select or deliberately merge one direction and record the decision in a design-decision
  document or ADR, with pointers to the retained mockups. See `docs/design-direction.md`.
- [x] Expand the selected direction to the brief's stage-one deliverables: the four high-fidelity
  key frames, supporting workflow frames, and the navigation/information-architecture model. (The
  brief's narrow-width live-comparison treatment was deliberately dropped; desktop is the
  operating environment.) The full frame set lives on the canvas page "Shop workspace — v2 IA"
  and is exported locally to `tmp/design-frames/` (see `docs/design-direction.md`).
- [x] Update this roadmap's UI-bearing slices where the selected direction changes their scope or
  ordering (ticket model, block libraries, shop-level tone of voice, and address-book decisions
  are reflected in the vocabulary and milestone outcomes above).

### Sequencing

Milestone 1 Slice 1 is UI-free and may proceed in parallel with this milestone. No UI-bearing slice
(Milestone 1 Slice 2 onward) starts before the direction decision is recorded.

### Acceptance criteria

- A discoverable, recorded decision names the selected direction and its mockups.
- The Studio/Bench/History application shell is assigned to a concrete implementation slice.
- Subsequent UI increments can cite the frames they implement instead of inventing layout ad hoc.

## Milestone 1 — Versioned simulation definitions

### Goal

Establish the target authoring and snapshot foundations without prematurely rebuilding the entire
frontend or adding another agent framework.

### Slice 1 — Definition lifecycle and snapshot boundary

- [x] Define stable identifiers and the draft/published-version lifecycle for target definitions.
- [x] Define the canonical sandbox snapshot boundary and version axes without copying the POC's
  minimal aggregate shape.
- [x] Decide and test the supported migration/reset path from existing POC databases.
- [x] Add pure domain/application tests for immutability, version resolution, and invalid references.
- [x] Record the schema and fingerprint decisions in an ADR before publishing new contracts; the
  same ADR formalizes the model revisions in `docs/design-direction.md` (ticket, objective/mutation
  blocks, address book, shop-level tone of voice) and aligns `docs/product-direction.md`. See
  ADR 0012.

Slice evidence: no live model or server is required; pure tests demonstrate that a published version
cannot mutate and that an experiment resolution can identify every behaviorally relevant input.

### Slice 2 — Shop and extensible catalog

- [x] Add shop drafts and published versions.
- [x] Add products, option definitions, variants, prices, availability, media references, ratings,
  reviews, and a first bounded set of typed custom attributes.
- [x] Add FAQ, policy, payment-method, fulfilment, and support-guideline configuration needed by the
  first scenario.
- [x] Persist through ports and publish the contract together with a minimal Studio UI.
- [x] Introduce the selected design direction's application shell and Studio navigation with this
  first target UI instead of extending persona-first navigation (requires the Milestone 0.5
  decision).
- [x] Validate and preview a shop before publication.

Frames: 1 · Shop home (the application shell: pine top bar, shop switcher, resource sidebar,
index-table and draft/published-chip conventions) and 2c · Product editor. Shop setup surfaces
(identity, policies, FAQ, tone of voice) have no dedicated frame; they live under the sidebar's
Shop setup section and follow the same shell conventions.

Slice evidence: an author can publish a shop containing a product with size/color variants and
retrieve the same immutable version through the public contract. ADR 0013 records the
`shop-payload-v1` schema, the publish gate, the definition-document persistence shape, and the
Studio shell that replaced the POC's persona-first navigation.

### Slice 3 — Synthetic customer and support identity

- [x] Add versioned customer profiles separating fictional personal facts from behavioral persona.
- [x] Support addresses, account facts, relevant commerce/support history, and hidden simulator facts.
  Authored pre-sandbox background travels with the profile; shop-scoped order and ticket history
  stays with its shop and arrives with Milestone 2, as the design direction requires.
- [x] Add versioned support identities with role, permissions, and guidance. Tone of voice is
  shop-level under ADR 0012 and is deliberately not part of a support identity.
- [x] Clearly label synthetic data and prove sensitive fields are excluded from logs/traces.
- [x] Add Studio forms, validation, persistence, and contract tests.

Frames: 6 · Customers and 6b · Customer editor — address book. Support-identity forms have no
dedicated frame and follow the shell's resource-editor conventions. The address book authored here
is the selection source for the order editor's frozen address copies (frame 2b, Milestone 2).

Slice evidence: an author creates a synthetic customer inside a shop, authors the address book and
persona, publishes it, and the published version stays frozen while the draft moves on. ADR 0014
records the `customer-profile-payload-v1` and `support-identity-payload-v1` schemas, the
field-sensitivity classification that keeps synthetic personal data out of logs and traces, the
per-shop attachment relation, and the extraction of the shared draft/published lifecycle that
ADR 0013 anticipated.

### Milestone acceptance

- Published definitions remain immutable and historical versions resolvable.
- Core commerce concepts enforce typed invariants while configured attributes can grow safely.
- The UI and API distinguish drafts from published versions.
- Target UI increments follow the design direction selected in Milestone 0.5.
- The current POC contract is either preserved or deliberately replaced according to the accepted
  slice design; there is no accidental hybrid model.

## Milestone 2 — Scenario Studio and wrong-address sandbox

### Goal

Author and materialize the first complete target incident without editing code for each scenario
instance.

### Outcomes

- [x] Author order fixtures through the order editor: typed status transitions, derived totals,
  authored order events, and a shipping address selected from the customer's address book and
  stored as a frozen, source-labeled copy.
- [x] Define versioned tickets: channel, origin references, prior conversation, and the triggering
  first message every arm receives.
- [x] Define the shared objective/mutation block libraries: parameterized templates, draft/published
  versions, and same-shop binding validation.
- [x] Define the scenario recipe on top of a published ticket: hidden facts, context documents,
  composed objective and mutation blocks, and completion conditions.
- [x] Build a scenario editor with validation and a resolved-state preview.
- [x] Support product-page and order-page origins using minimal resource references.
- [x] Materialize the paid-order/wrong-shipping-address scenario into a canonical snapshot.
- [x] Clone a snapshot into independently mutable sandbox state.
- [x] Add versioned read tools for interaction context, catalog, customer, order, and support
  knowledge.
- [x] Add a safe address-change proposal/action with authorization, confirmation, idempotency, and
  optimistic concurrency.
- [x] Prove deterministic generation, canonical serialization, and tool behavior with unit and
  integration tests.

Frames: 2 · Orders, 2b · Order editor, 3 · Tickets — helpdesk view, 4 · Scenario editor — composed
blocks, 4a · Objective block library, and 4b · Mutation block library.

Ticket evidence (frame 3): an author opens the wrong-address incident on one shop's customer, authors
the prior support history and the triggering first message, links the stale-address order, and
publishes; the frozen version keeps what it froze while the draft moves on. ADR 0016 records the
`ticket-payload-v1` schema, the decision that a ticket **is** a definition where the order beside it
is not, the separation of prior history from the trigger, the minimal origin reference, and the
extension of the shared authoring lifecycle to shop-scoped types that pin their shop and their
references. The scenario recipe is deliberately deferred to the slice that also delivers the block
libraries and the scenario editor, because a scenario payload is mostly block bindings whose shape
those libraries fix.

Block-library evidence (frames 4a and 4b): an author publishes the `read-required-document`
objective and the `concurrent-entity-mutation` fault, and a mutation refuses to publish until it says
when it fires. ADR 0017 records the `objective-block-payload-v1` and `mutation-block-payload-v1`
schemas, the typed parameter model whose kind decides what a scenario must bind inside its own shop,
the rule that a template may never default a reference, the timing rules that separate a scheduled
mutation from a goal-based objective, and the assessment/evidence pairing. The libraries landed
**before** the scenario recipe deliberately: a scenario payload is mostly block bindings, so the
templates had to fix that shape first. ADR 0016 deferred the recipe to "the slice that also delivers
the block libraries and the scenario editor"; ADR 0017 splits that slice, delivering the libraries on
their own so each stays reviewable.

Scenario evidence (frame 4): an author composes the wrong-address recipe on the published ticket —
the context document the incident turns on, a read-check bound to that document, and a concurrent
mutation bound to the stale-address order — reads the resolved starting state beside the publish
gate, and publishes; the frozen version keeps the shop, ticket, and template versions it pinned while
every draft around it moves on. ADR 0018 records the `scenario-payload-v1` schema, the reference
grammar a binding resolves through and the rules that keep every one of them inside the scenario's
own shop and its ticket's customer, the decision that an objective's severity is the instance's
rather than a binding, the multi-target pin that freezes one version per composed template however many
times it is bound, and the resolved-state preview that travels with the publish gate because the two
answer one question together. It also extracts `ShopDocumentKind` so a ticket's suggestion, a
scenario's context entry, and a read-check's binding name the shop's document collections once.

Snapshot evidence (no frame; the page follows the shell's resource conventions): an author freezes a
published wrong-address version into canonical starting state, reads the versions it pinned beside
the order fixtures it had to copy, and freezes it again to the same snapshot — while an order edited
in between produces a new one. ADR 0019 records the `sandbox-v2` envelope, the rule that a snapshot
pins what is already immutable and copies only what no published version pinned, the decision that a
snapshot is identified by its fingerprint rather than by its inputs, the whole-customer order set a
sandbox holds, the minimal interaction reference that carries a product-page or order-page origin
into the runtime, and the publish gate re-run against the world as it is now. It also splits
`resolve_sandbox_inputs` out of the experiment resolution, because a snapshot is materialized before
any agent configuration is chosen.

Clone evidence (no frame; the arms live on the snapshot page under the shell's resource
conventions): an operator clones one frozen snapshot into two arms, reads back the one current-state
fingerprint they share, and a change applied inside one arm moves that arm alone — never the arm
beside it and never the snapshot both were taken from. ADR 0020 records the `sandbox-state-v1`
document, the rule that a clone copies the state and pins the snapshot, the two fingerprints that say
where an arm started and where it is, the write seam a run's tools mutate through and why no public
write endpoint exists until there is an actor to authorize, the optimistic-concurrency token the store
decides, and the decision that cloning is deliberately not idempotent where materializing is.

Read-tool evidence (no frame; the console follows the shell's resource conventions beside the arms
it reads): an operator selects one arm, reads the interaction the incident opened from, follows the
identifier it carries to the order that ships to the stale address, reads the shipping policy the
incident turns on — and gets a refusal, not an error, for an order reference the customer never had.
ADR 0021 records the eight published tool contracts, the `tool-result-v1` envelope, the rule that a
tool never serves a `CUSTOMER_ONLY` field while serving `SENSITIVE` ones in full, the decision that a
refusal is a value and an unknown tool name is not, the string-only argument table a framework
adapter later derives its schema from, and the entry of the tool versions into the sandbox
fingerprint — which makes a snapshot frozen after this slice a different starting state from one
frozen before it, correctly and without a migration.

Address-change evidence (no frame; the write lives in the console beside the arms it moves): an
operator reads the order that ships to the stale address, proposes redirecting it to the customer's
current entry under a support identity permitted to make that change, applies the confirmation the
proposal answered with — and the arm beside it still ships to the old address. ADR 0022 records the
two write tools and why the mutation is split into a proposal and an application, the confirmation
that names a change by its content and so serves as the consent binding and the idempotency key at
once, the actor that travels in the call envelope because an agent that could name its own actor
would be choosing its own permissions, the revision a proposal carries from the read into the write,
the decision that a stale write is a refusal rather than a 409 because the world moving under an
agent is something the agent must recover from, and the declared `effect` that keeps a read handler
structurally unable to move an arm. It also enters the write tools into the sandbox fingerprint, for
the same reason and with the same absence of a migration as ADR 0021.

Conformance evidence (no frame; this outcome is a test slice with no production code change): the
canonical serializer writes one recorded byte string and the wrong-address starting state hashes to
one recorded fingerprint, so a change to either is a deliberate answer to "is every snapshot frozen
before now a different starting state" rather than a silent one; a snapshot whose stored row is
deleted between two freezes is recomputed to the same document rather than recognized; and every
published tool — not a list of the ones somebody sampled — answers a valid call with a canonical
document, leaves the arm where it stood if it reads, refuses an argument it does not declare without
having moved the arm on the way, enforces the arguments it calls required, runs under an actor if it
writes, and serves no `CUSTOMER_ONLY` value. ADR 0023 records the goldens and the rule that a golden
owns its inputs, the difference between a fingerprint that is recomputable and one that is merely
recognizable, the sample-call table checked against the contract registry so a new tool joins every
sweep the day it is declared, the non-emptiness checks that keep a parameterized sweep from passing
vacuously, and the argument-for-argument check that the published listing is the declaration table
rendered.

Order evidence (frames 2 and 2b): an author builds the paid, unfulfilled order that ships to
the customer's stale address, and the frozen copy survives an edit to the address-book entry it came
from. ADR 0015 records the `order-fixture-v1` schema, the decision that an order is shop-scoped
authored state rather than a definition, the forward-only status graph, the selection-only write
contract, and the drift findings that replace ADR 0014's deferred address-deletion check. Freezing an
order into a published scenario version arrives with the scenario outcome above.

### Acceptance criteria

- An author can publish the scenario and reproduce the same canonical snapshot from recorded inputs.
- A product-page question can resolve “this product” from the interaction reference and tool calls,
  without embedding the full product payload in the initial prompt.
- Two sandbox clones begin with the same fingerprint and mutations remain isolated.
- Backend rules reject unsafe or stale address changes regardless of model output.

## Milestone 3 — Agent configurations and human participant driver

### Goal

Make the support agent and customer-input mechanism reusable, versioned experiment inputs.

### Slice 1 — Agent configuration definition and prompt editor

- [x] Add draft/published agent configurations covering framework, architecture, model, prompt,
  tools, memory, support identity, and runtime settings.
- [x] Validate requested configuration against proven adapter capabilities.
- [x] Keep deterministic adapter tests and optional live-model smoke tests separate.

Frames: 5 · Agent configuration — variables (markdown prompt editor with variable chips, grouped
insert menu with the non-injectable group, preview context, and the LLM/runtime configuration
card).

Slice evidence: an author publishes a shop and a support identity, composes a shop-independent
configuration on top of them, reads every `{{variable}}` in its prompt resolved against a chosen
preview shop and the identity's published version, and publishes — after the gate has refused the
two things a configuration must never carry: a fact the agent is meant to discover through tools,
and a write its identity could never be authorized to make. The frozen version keeps the
support-identity version it pinned while every draft around it moves on. ADR 0024 records the
`agent-configuration-payload-v1` schema, the closed prompt-variable table and why customer, order,
and ticket facts are declared in it but never injectable, the proven-capability catalog declared
apart from the adapters so the gate stays testable offline, the gate rules that reach outside the
payload, the permission a write tool now declares on its own contract so the runtime and the gate
read one table, and the preview resolution that travels with the gate without ever entering the
payload.

### Slice 2 — Participant driver and resolved run inputs

- [x] Evolve the agent port only for requirements proven by the target scenario. Nothing here
  proves one — no arm runs a model — so `AgentAdapter` is deliberately unchanged. (Milestone 4's
  runner does prove one, and answers it with a separate `SupportAgentRuntime` port rather than by
  bending this one: ADR 0026.)
- [x] Introduce a participant-driver port and human-operator implementation.
- [x] Persist resolved configurations and participant events without framework SDK types.

Frames: 7 · Experiment setup, and the participant half of 8 · Live bench (the two threads, the
customer composer, and the provenance strip; the agent's side of each thread arrives with the
runner that produces it).

Sequencing: this slice was delivered against the Milestone 4 runner that calls it, so it also
completes that milestone's first two outcomes. A port designed before it has a caller would be
shaped by a hypothetical one.

Slice evidence: an operator publishes a scenario and two agent configurations, reads the
comparison matrix before anything is frozen — one arm differing nowhere, two arms differing only
in their prompt — starts the experiment, and finds both arms opening on the ticket's triggering
message from one shared starting-state fingerprint; a message sent to both arms is one
composition, and the same words sent to one arm alone are a second the record keeps apart.
ADR 0025 records the `experiment-v1` envelope that pins the arms by content and the world by
fingerprint, the one-method participant port and why the trigger does not travel through it, the
composition identity that makes divergence readable rather than inferred, the setup gate that
answers the tone-of-voice check ADR 0024 deferred to experiment setup, and the comparison matrix
whose difference set enters the experiment's fingerprint.

### Acceptance criteria

- The same published agent configuration can be selected for multiple experiments.
- Human participant input flows through a port that can later support LLM/scripted implementations.
- Framework, model, prompt, tools, and architecture are explicit versioned inputs rather than hidden
  composition defaults.

## Milestone 4 — Paired experiment runner and live bench

### Goal

Run one or two agent configurations against isolated copies of the same incident and expose their
behavior side by side.

### Outcomes

- [x] Create immutable experiment records and independently progressing runs (ADR 0025, with
  Milestone 3 Slice 2).
- [x] Start both arms from one canonical snapshot and send the same trigger (ADR 0025).
- [x] Add a linked customer composer that can split into arm-specific replies (ADR 0025).
- [x] Persist operator input divergence, assistant turns, tool events, confirmations, state changes,
  and failures (ADR 0025 for operator input; ADR 0026 for everything an agent produces; ADR 0028
  for the state changes the scenario itself makes). Traces
  arrive with the timeline outcome below; completion is judged against the scenario's completion
  conditions and belongs with Milestone 5's evaluation.
- [x] Warn when framework, architecture, model, prompt, or tools introduce multiple comparison
  variables (ADR 0025).
- [x] Show normalized execution timelines and project-owned source locations where available.
  Traces (frame 9b) arrive with Milestone 5's evaluation surfaces, and the code excerpt beside a
  location (frame 9c) with them (ADR 0027).
- [x] Fire the scenario's bound mutation blocks into a running arm at their bound timing, and
  record what each one moved (ADR 0028).
- [x] Cover start, divergence, independent action, resume, and completion with focused tests and an
  essential Playwright journey. Start, divergence, and independent action are covered (ADR 0025,
  ADR 0026), resume is (ADR 0029), and completion is (ADR 0030): the scenario's turn cap ends an
  arm, which is the half of its completion conditions a runtime can decide. Whether the incident
  was actually resolved is the completion statement's, and that is Milestone 5's judge.

Frames: 7 · Experiment setup and 8 · Live bench (icon-only rail, ticket-thread chat UI, provenance
chip strip, director's notes, objectives matrix), plus 9a · Execution timeline and the source
locations of 9c · Code paths, which this milestone's fifth outcome needs and Milestone 5 completes
with the traces and the code excerpt beside them.

Runner evidence (frame 8, the agent half): an operator runs one arm's agent and watches it follow
the incident from the interaction to the order, read the customer, and redirect the order to the
address on file — every call a recorded event, the write visible as the revision it moved — while
the arm beside it stays exactly where it was; a failed attempt is kept and the retry sits beside
it. ADR 0026 records the `SupportAgentRuntime` port and why it is new rather than an evolution of
the POC's `AgentAdapter`, the recording invoker that makes a tool event a property of the call path
rather than of an adapter reporting, the advance operation that is idempotent over an answer and
not over an attempt, the attempt as the unit a failure and a retry are recorded in, the failure
classified rather than described, the confirmation and the state change that need no record of
their own because the tool result and its revisions already carry them, the resolution that reads
the versions the experiment pinned, and the two runtimes: the declared control policy that makes
tool bindings a real comparison variable offline, and Pydantic AI deriving its tool schemas from
the contract table the lab publishes.

Timeline evidence (frame 9a, and the location half of 9c): an operator who has driven both arms
reads the incident as one stream — the opening both arms share, the reply only one of them heard,
each arm's calls in the order it asked, and the one write per arm that moved a world — then
narrows it to what changed something, and reads the project's own file and line behind every
entry. ADR 0027 records the timeline as a projection rather than a record and why a second stored
shape would be ADR 0026's refused confirmation record one level up, the composition as the
coordinate two arms share where an ordinal counts only one arm's turns, the merge of each arm's
ordinals that orders the stream without trusting a clock the runner reads once per attempt, the
entry that carries no word anyone said, the refusal kept apart from the error because ADR 0021
made them different things, and the source location resolved from the tool registry rather than
from a hand-kept map — project-owned only, never stored, and allowed to be absent, which is what
"where available" means. It also turns the write dispatch into the handler table that locates it,
so the map that names a write's code is the one that ran it.

Resume evidence (frame 8): an operator who ran one arm reloads the browser, leaves the bench, and
returns to the experiment through the shop's list — finding both threads as they stood, the answered
arm's reply with its calls and the fault that fired among them, and the arm that was never run still
the one offered to run. ADR 0029 records that resume has no mechanism of its own because an
experiment is entirely in the record, the arm standing derived rather than stored for the reason
ADR 0026 refused a status, the two things an arm can wait for and the "completed" value deliberately
left to Milestone 5's evaluation, the turn an arm passed over reported rather than implied, and the
one reading the runner and the bench now share so a button never offers a run the backend would
decline.

Objective evidence (frame 8's objectives matrix): an operator watches the incident being
judged as it runs — the order the arm identified and the address it moved marked met, the
policy document it never opened pending rather than failed while the arm can still open it,
and the row a judge owns saying so instead of counting against the arm — then drives the arm
to the last turn the recipe allows, where the pending read becomes a miss, the arm is
completed, and the bench stops offering to run or message it. ADR 0030 records the five
outcomes and why three of them are not verdicts, the declared table of evidence this build
reads and the two kinds absent from it, the polarity that makes a forbidden objective the same
reading as a required one, the four readers keyed by binding kind and the rule that a refusal
is not a reading, the turn cap as the half of a scenario's completion conditions a runtime can
decide, and the evaluation projected from the record rather than stored beside it.

Fault evidence (frames 8 and 9a, the scenario's own half): an operator runs an arm and watches the
incident change under it — the order the recipe bound moves out of band at the moment it bound,
between two of the agent's calls, with the agent never told and the arm beside it untouched until
its own advance reaches the same moment. ADR 0028 records the firing that happens on the call path
rather than at a turn boundary and why the conflict ADR 0022 built needs it, the declared table of
effects and moments this build can actually carry out and the setup gate that refuses an experiment
whose fault would never fire, the moment decided from the arm's own record rather than from a clock,
the single step along the fulfilment graph that makes the world stale without making the incident
unwinnable, the once-per-arm key the store rather than the runtime enforces, and the timeline entry
that is a state change and never a tool call because no agent asked for it.

### Acceptance criteria

- An action in one arm cannot alter the other arm.
- Both arms are explainably tied to the same initial fingerprint and exact published inputs.
- Divergent human replies remain visible in later comparison.
- A framework-specific event never leaks into the shared public or stored evidence contract.

## Milestone 5 — Evaluation and experiment history

### Goal

Turn completed runs into durable, searchable comparison evidence.

### Outcomes

- [x] Evaluate deterministic state, event, tool, and completion objectives. Policy objectives
  need a registry of named versioned rules a template can bind and are deliberately deferred to
  their own slice; safety is expressed as the forbidden polarity of the same readings (ADR 0030).
- [x] Add a versioned judge configuration and anonymized structured LLM-judge execution.
- [x] Record turns, token usage, model/tool calls, duration, retries, failures, and estimated cost
  when available.
- [x] Present objective-level comparison without a global framework score.
- [x] Replace persona-first history with experiment-first filters and detail pages.
- [x] Preserve evaluator executions and per-arm state diffs. Executions are records rather than
  projections and never overwrite each other (ADR 0031); a diff is the difference between the
  bytes an arm's two fingerprints cover (ADR 0035).
- [x] Preserve the notes and tags an operator writes on a run. Split from the outcome above
  because a diff is a reading of state the lab already holds, while a note is what a person
  concluded and is stored beside the record rather than in it (ADR 0036).
- [x] Preserve traces, replay, and fork provenance. Three slices, not one, and all three
  have landed: traces are the spans the lab now records beside the record (ADR 0037), a replay
  derives a new experiment that starts in the world its source started in and is driven by the
  compositions that source recorded (ADR 0038), and a fork derives one the same way while
  moving the pinned configuration versions on purpose — which is the only thing it moves, so
  the difference between the two records is attributable to it (ADR 0039).
- [x] Test judge failure/rerun separately from deterministic outcome calculation. An
  evidence slice in ADR 0023's sense, and it found one defect: a failed execution was
  shadowing the verdict standing on its row (ADR 0040).

Frames: 9 · Experiment results — General tab, 9b · Traces tab, the code excerpt of 9c · Code paths
tab, and 10 · History; frame 9's notes-and-tags strip and frame 10's tag filter arrived with the
annotation outcome (ADR 0036), frame 9b with the traces outcome (ADR 0037), frame 9's Replay
header action and frame 10's replay quick action with the replay outcome (ADR 0038), and frame
9's `Fork…` and frame 10's fork quick action with the fork outcome (ADR 0039). 9a · Execution
timeline and 9c's source locations arrived with
Milestone 4's fifth outcome (ADR 0027) and are extended here rather than built again — frame 9's
General tab and the depth-tab shell the others will hang from arrived with the comparison outcome
(ADR 0033).
Together with the Milestone 4 frames this completes the 18-frame authoritative set. The judge
itself has no frame: it is a cross-shop resource under the shell's Experiment lab section, and it
is scored from frame 8's objectives matrix, where its rows already are.

Cost evidence (frame 8's per-arm strip; frame 9's Quantitative card, which extends the same
reading, arrived with ADR 0033): an operator runs one arm and reads what the turn cost
under its thread — the turns it has had, the tokens it spent, the tools it called, how long it
took, and what the lab's declared rates say that was worth — while the arm beside it shows no
strip at all, because a row of zeros would read as a measurement nobody took. A retry is
counted apart from the failure that caused it, the control arm's zero tokens are a reading
rather than an absence, and a framework that does not meter itself says so instead of looking
free. ADR 0032 records the two measurements stored because they cannot be recovered afterwards
and the counts projected over the record like the timeline and the evaluation before them, the
neutral usage shape a framework reports through the runtime port and why a failed attempt
reports none, the difference between "spent nothing" and "nobody said" carried end to end, the
duration taken on the clock the record is already timestamped by, and the dated price table
declared apart from the adapters whose estimate is recomputed at read time rather than stored.

Comparison evidence (frame 9's General tab, and the depth tabs it holds): an operator who has
driven an incident to its end leaves the bench for the results screen and reads the two arms
objective by objective — the read-check missed in the arm that never opened the document and
pending in the arm still holding a turn, each cell carrying the call that answered it or the call
that was never made; the judged row on its own card naming the version, model, and attempt behind
each verdict; what actually moved each arm read from its revisions rather than from what it
answered; what each arm spent, with an unmeasured column saying so instead of showing zero; and the
turn only one arm heard, which is what makes everything after it two conversations. Nowhere is
there a total: each arm's count is of the rows something decided for it, and the columns are never
added into a winner. ADR 0033 records the results screen as a presentation of readings the backend
already serves rather than a fourth reader of the record, the per-arm denominators and why a single
score would report the operator's own pacing as a difference between configurations, the split
between what a rule decided and what a judge did, divergence read from the composition rather than
from the words, the depth tabs the header stays across — which is where the execution timeline now
lives — and the parts of the frame that belong to the outcomes still open.

State-diff evidence (frame 9's business-state card): an operator reads not only that an arm moved
but what its world became — the order named by the reference the customer quotes, the stale
Bordeaux copy replaced by the address on file, the fulfilment the scenario's fault advanced in the
same difference, a field that was never there saying so rather than reading blank, and the sentence
that nothing else changed, checked against the whole document rather than asserted. The arm beside
it is still in the world both were cloned into. ADR 0035 records the diff as a difference between
the exact bytes the clone's fingerprint covers, normalized the way that fingerprint normalizes — so
it is empty precisely when the fingerprint has not moved, by the function's own doing rather than
by where it happens to be called from — the walk that has no list of fields worth watching and so
gains a field the day one is authored, the pairing of orders by identity rather than by position,
absence kept distinct from
emptiness, the region no writer can touch reported rather than dropped so the card's claim stays
falsifiable, and the projection served on the run beside the standing and the metrics rather than
through a reading a client could make differently.

Annotation evidence (frame 9's notes-and-tags strip, and frame 10's tag filter): an operator
who has read both arms concludes something no reading of the record could have produced, and
writes it down — the sentence about why one arm acted before it read, and the shelf the run is
filed under so the next comparison of that failure starts from a list rather than from memory.
Writing it moves neither fingerprint the run pinned: the run that has been written about is
still the run that was started. The tag they typed with spaces comes back as the one spelling
history narrows by, the note comes back exactly as written, and the listing finds the run by
words it never displays. ADR 0036 records the annotation as a document stored beside the
experiment rather than inside it, the append-versus-replace split between a note and a tag set
and why each is the honest operation for what it says, the fold that gives a shelf one identity
and refuses rather than mangles what it cannot fold, the reading served on its own because it
is stored rather than projected, and the row that shows tags, counts notes, and searches both.

Trace evidence (frame 9b): an operator who has followed an incident into the execution
timeline reads the same attempt again as the shape it actually had — the advance, the
framework's turn inside it, and every call the arm made, each drawn where inside the attempt
it ran rather than merely in the order it was asked. The space between two calls is the
framework thinking, which is a quantity no other reading of the run can produce: the record
timestamps an attempt and its calls from one clock reading, so it can say what a call cost and
never when it happened. A span says only that; which tool it timed and what that tool answered
are joined from the events the thread already shows, because a span with an attribute of its
own would be the one place synthetic customer content could leave the lab unnoticed. An
attempt made before the lab traced anything says so rather than showing a waterfall somebody
reconstructed, and the calls are listed in the order the agent asked them rather than in the
order of a clock that can be stepped backwards under a running process. ADR 0037 records the
trace as the one stored reading beside four projected
ones and the confirmation that earned it, the coordinate that joins a span to the call it
timed instead of describing it, the offset that draws a bar and orders nothing, the single
measurement handed to both the record and the trace, the three kinds of span this build can
honestly claim to have seen and the model call it refuses to invent, the attempt span that is
wider than the framework's turn because the lab's own resolution is not a framework's cost,
the exported allowlist that carries an arm's position rather than the name an operator gave
it, and the tracer that mints real OpenTelemetry identities after the fact so the runner
holds no SDK type.

Replay evidence (frame 9's header, and frame 10's quick actions): an operator who has read
both arms replays the run, and reads a *new* experiment that reached the same place — because
an experiment is immutable and everything about it is in the record, so reproducing one can
only mean deriving another. It starts in the world the first one started in rather than in
the world the shop is in today: the snapshot the source froze, cloned again, so the derived
arms carry the same starting-state fingerprint however far the shop's orders have moved since
— and a run whose order was deleted afterwards is still replayable, where freezing the recipe
again would be refused outright. Each arm runs the configuration version its arm ran, not the
one published since; taking a newer one is the fork this outcome still owes. Nobody is at the
composer, and nobody needs to be: the customer's own compositions are the script, delivered to
the same arms at the same depths, with each arm advanced as often as it was advanced then — so
the linked send stays one composition, the arm-only send stays one arm's, and the turn the
operator moved on from is skipped again. The derived run says a script drove it, which moves
the fingerprint that names its inputs and not the one that names its world. Nothing about the
run it replays changes, and it is in history as itself, naming what it came from. ADR 0038
records the replay as a derivation rather than a re-run and why the record's immutability
leaves no other reading, the starting state reused by fingerprint rather than frozen again and
the two cases that decide it, the recorded compositions as the script and the trigger
deliberately left out of it, the composition order reconstructed from the ordinals rather than
from a clock ADR 0027 already refused to trust, the advance count that is self-limiting
because advancing is idempotent over an answer, the one reuse it refuses — a starting state
frozen against a tool set this build no longer publishes, which is the only way a run's two
fingerprints could name two different tool sets — the scripted participant driver ADR 0025 said
would arrive with its first caller, the honest limit that a deterministic runtime replays
exactly and a model-backed one does not, and the derivation stored beside two experiments
because it is part of neither.

Fork evidence (frame 9's header, and frame 10's quick actions): an operator who has read
both arms and replayed the incident suspects one of the two prompts, and asks the question a
replay refuses to ask — the same run, with that arm moved onto a newer published version, or
onto a different configuration altogether. Everything else is held still, deliberately: the
snapshot the source froze is cloned again rather than the world re-frozen, the recipe version
and the seed are the source's, the arms keep their names and their positions, and the
customer's own compositions drive it to the same depths — because a derivation that moved the
world as well as the arms would explain nothing about either. A fork that changes no arm is
refused rather than recorded, in the sentence that says what it is instead: a replay. And what
it did change is on the derived run where it names the run it came from — one dimension reads
as provenance, and two say out loud that no difference between these two records can be
attributed to either of them, which is the setup gate's own comparison warning carried one
level out to the comparison the gate cannot see. From the listing the question is simpler and
the row asks it in one click, offering it only where there is something newer to move to.
Nothing about the run it forked changes, its verdicts and notes stay on the run they were made
about, and a fork of a replay names the replay rather than claiming the head of the chain.
ADR 0039 records what a fork may vary and why each excluded candidate is excluded, the
starting state reused through the one door that already refuses a drifted tool contract set,
the refusal of a derivation that changes nothing and why it is judged on the pins rather than
on the payloads, the derivation table generalized with a kind rather than paralleled — because
the two rows differ in one word and that word is what a reader has to be shown — the difference
set read against the source rather than only within the fork's own two arms, and the chains
each read a link at a time.

History evidence (frame 10): an operator who has driven an incident to its end leaves the shop
they ran it in and finds it again in the lab's own listing — every run this lab has made, whichever
shop it belongs to, each row naming the recipe version it pinned, the configuration version each
arm ran, and what each arm's own record decided: the arm driven to the cap counted against two
rows and the arm still holding a turn against none, which is a denominator rather than a defeat.
The row says the recipe has been published again since without pretending the run was, narrowing
to a name nothing was given empties the listing rather than the lab, and the row opens the
evidence it summarizes in the shop that produced it. ADR 0034 records the cross-shop listing and
why the bench's own remains beside it, the row as a projection of the same reading the bench and
the results screen make and the cost that choice is worth paying, the status decided by the
standing and the evaluation rather than set by anything, the filter options read from the runs
themselves rather than from the definition libraries, the pinned names a row keeps against the
renaming of what it ran, the narrowing kept in the URL, and the removal of `listConversations` and
`listGeneratedScenarios` — the persona-first history this outcome names, replaced rather than left
published beside its replacement.

Judge evidence (frame 8's objectives matrix, and the judge's own editor): an author publishes a
rubric, the model that reads it, and exactly what it is shown — after the gate has refused the
two things a judge must never carry: a rubric that says nothing, and one that names the framework,
provider, or model an arm runs. An operator then scores the row no rule can decide from the bench:
each arm is judged on an anonymized brief of its own record, the arm that resolved the incident is
met and the arm still holding a turn is not counted against, and every filled cell names the judge
version, the model, and the attempt that produced it. Scoring again keeps the previous verdict and
records the next attempt; a judge the lab cannot reach records nothing at all. ADR 0031 records the
`judge-configuration-payload-v1` schema and the `judge-brief-v1` document, the closed verdict
vocabulary and why "unclear" is one of its three values, the evidence scope as a published input
whose absence is visible in the fingerprint, the anonymity rule the publish gate enforces from the
framework catalog, the executions kept as records where the deterministic evaluation is a
projection, and the third runtime port with a declared control judge behind it.

Judge-independence evidence (no frame; it is what frames 8, 9 and 10 are checked
against): an operator scores a run, the provider is down that afternoon, and nothing about
the run moves — every row a rule decided reads byte for byte as it did before anyone tried,
the judged rows say a judge has not decided them yet rather than counting against an arm, and
the verdict recorded this morning is still the verdict, because a provider that refused said
nothing about the arm and an outage is an absence of new information rather than new
information. That last part was not true when this slice started: reading the latest attempt
meant a failure after a verdict flipped a met row back to deferred while the verdict sat
unread underneath it, which is the deterministic evaluation's own rule about the lab's limits
broken one level up. The judge is anonymous the same way the gate is: what a brief may not
name is read off the framework catalog and checked against an arm actually run under each
declared framework, so the second framework is covered the day it is proven rather than the
day someone remembers the sweep. And every verdict names the four things that make it
auditable — the model, the rubric that is its prompt, the published version that froze that
rubric, and the fingerprint of the exact bytes it read, which is shown to move when the record
moves and to hold when it does not. ADR 0040 records the failure taxonomy swept from the port's
own declarations rather than from a list and the deliberately unclassified case beside them,
the rule-decided reading compared as the canonical bytes of every field of every row so a field
authored tomorrow joins the comparison, the standing-verdict fix and why the amendment to
ADR 0031 is a narrowing rather than a reversal, the one code path by which judge state could
reach a deterministic row exercised rather than argued about, and what it deliberately leaves
out — a timeout nothing configures, an attempt history no frame asks for, and a golden for a
brief that identifies one execution rather than a starting state.

### Acceptance criteria

- Deterministic evidence remains readable and unchanged when a judge is unavailable or rerun.
- Judge inputs are framework-blind and every output is tied to a model, prompt, rubric, and input
  fingerprint.
- Efficiency metrics are displayed with outcome and configuration context.
- Historical experiments remain reproducible after newer definition versions are published.

## Milestone 6 — Second comparison implementation

### Goal

Add the second framework or a materially different agent architecture only after the target
environment, scenario, runner, and evidence model are proven.

### Outcomes

- [x] Select whether the first controlled comparison changes framework or architecture.
- [x] Implement it behind the shared target contracts and conformance suite.
- [x] Produce equivalent normalized tools, events, traces, and evaluation inputs.
- [x] Document project-owned glue code, constraints, failures, and observed behavior.
- [x] Prove the wrong-address scenario in a two-arm comparison. Proved offline, where the two
  arms' decisions are held identical by construction, so what it establishes is the evidence
  model and not a behavioral difference between frameworks; what only a credentialed run can
  show is named in ADR 0042 rather than claimed here.

Frames: none new; this milestone reuses the Milestone 3–5 surfaces (frames 5, 7–10).

Comparison evidence (frames 9 and 9b, and the bench that fills them): the lab is asked its own
question. One published wrong-address recipe, one canonical snapshot, and two arms whose
configurations agree on the identity, the model, the prompt, the tools and the architecture and
disagree on one thing — so the setup matrix shows a single difference and the gate's
comparison-variable warning stays silent. Both arms are driven through the incident: they read
where the conversation started, read the order the customer quotes, read the shipping policy,
read the address book, propose the redirect and apply the confirmation the proposal answered
with, while the scenario's fault moves the order under them between two of those calls. Then
every surface is read arm beside arm and has to agree: the same calls under the same published
names and versions, the same normalized stream in the lab's own words, the same span tree, both
objectives met from the two readings that decide them — a call that answered and a world that
moved — the same fields moving in both diffs, and a cost that is measured in both and zero in
neither. Nothing one arm did reaches the other: they claim one starting-state fingerprint,
advancing one leaves the other byte-identical at revision zero, and the confirmation each mints
authorizes only its own world. And no framework names itself anywhere in what either arm left,
swept against the whole catalog rather than the two under test — over the readings, and again
over what the API serves, where the word appears only under the fields that exist to declare it.
The limit is stated where it belongs: offline both arms follow one declared script through each
SDK's own model seam, so identical decisions are the premise rather than a finding, and two
models choosing differently is what a credentialed run adds. ADR 0042 records the split between
what the offline comparison establishes and what it cannot, the one declaration both arms are
driven from and why it imports no SDK, the shape comparison that gains a field the day one is
authored, the framework named only where the contract declares it, and the defect a two-arm run
found that an adapter sweep could not — one SDK rendering a tool result as a Python repr where
the other rendered JSON, so the arms were shown the same facts in two notations, now rendered
once by the lab for both.

The Vercel AI SDK was evaluated and rejected for this comparison: the lab's evidence guarantees
are properties of a Python call path, and re-establishing them across a Node process boundary
would have made the bridge the subject of the comparison. It returns as a candidate only when
comparing a TypeScript runtime as such is the point (ADR 0041). LangGraph is the named candidate
for the architecture dimension, which stays closed until something implements a second
`AgentArchitecture` member.

## Milestone 7 — Guided setup and lab settings

### Goal

Make the lab operable by somebody who has not read the roadmap. Every milestone before this one
was about what the lab records; this one is about the person operating it.

### Slice 1 — Lab settings and what this build can do

- [x] Add `/settings` as a top-level route outside shop scope, reached from the header, with the
  guides beside it at `/guides`.
- [x] Rename the shop-scoped "Settings" navigation entry to shop details, leaving its route
  unchanged.
- [x] Report what this build can run, its run mode and model, and whether trace export is
  configured, through one additive read-only route.
- [x] State the offline limit as a property of the build rather than only of a seeded run.
- [x] Store the navigation rail's default state and the last-visited shop as browser preferences.

Frames: none. `/settings` and `/guides` are lab-level surfaces outside the eighteen-frame
shop-workspace set, like the shops index, the four shop-setup pages and the support-identity and
judge listings already shipped; they are built from the existing chrome primitives and invent no
layout language (ADR 0044).

Slice evidence: an operator who has just cloned the repository opens the lab and reads, in one
place, which frameworks it has actually proven it can run and at which models, that it is running
offline and what that means for any comparison it produces, and that no trace exporter is
configured — with the Phoenix path when they want one. Nothing on the page edits a provider
credential or an exporter endpoint, because both are composition rather than preference, and the
route that reports them serves the run mode and the model name and never a fact about the key.
ADR 0044 records the placement decision and the naming collision it resolves, the read-outs as
reports rather than controls, the narrow status payload and why an endpoint is not in it, and the
standing offline qualification that ADR 0042 established and ADR 0043 could only write onto one run.

### Slice 2 — Guide mode and the derived next step

- [x] Add guide mode, defaulted from the record and overridden by a stored preference.
  *Superseded by Slice 5: once the guide appeared only on request the mode's derived default hid it
  from every lab `make seed` fills, so the controls are unconditional and the mode, its store and
  its settings control are gone (ADR 0046).*
- [x] Project the setup path's progress from the listings the product already serves, storing
  nothing.
- [x] Render the blocking reason from the publish gate rather than from a second explanation.
- [x] Add the glossary, sourced from one module carrying this document's stable vocabulary.

Frames: one new frame for the guide strip, designed before the slice lands. It is a cross-cutting
band across the top of frames 1, 4, 7 and 9, which were designed without one, and is the half of
this milestone that is inside the authoritative set (ADR 0044). `docs/history/design-direction.md` gains
the revision paragraph recording both halves of that split. *Superseded by Slice 4: the band and
its frame are removed and the authoritative set is eighteen again (ADR 0045).*

Slice evidence: an operator with an empty database is told to create a shop; having created one and
left its tone of voice unset, they are told what the publish gate itself says is missing, in the
gate's own words; having published it they are told what comes next. Nothing was written when any
of those steps completed, so the same reading holds for a database somebody filled with `make seed`
and for one filled in a different order by hand, and a draft edited after publication leaves its
step complete because the version an experiment would pin is still there. Guide mode is on before
anybody turned it on and off once the lab holds a completed experiment, and an operator who
disagrees with either is remembered. *Superseded by Slice 5: there is no guide mode, so nothing
about this reading is left to be on or off (ADR 0046).*

### Slice 3 — From nothing to a two-arm comparison

- [x] Write the setup guide covering the full chain in dependency order, from an empty database to
  a driven experiment.
- [x] Name `make seed` as the fast path, as a command. *Amended by ADR 0047: the fast
  path is also a button on lab settings, and the guide names both. The guide itself still
  performs nothing.*
- [x] Add the inline explainers on the surfaces whose vocabulary is not transferable from a
  commerce admin.

Frames: none new. The explainers are drawn on the band Slice 2's frame already specifies, hosted
below each page header on frames 4, 4a, 4b, 8 and 9 and on the frameless starting-states page —
which is a different list from the frames that band was drawn to carry the next-step reading on.
`docs/history/design-direction.md` records which surfaces host which, and the set stays at nineteen because
the band is one element in both readings (ADR 0044). *Superseded by Slice 4: the notes are replaced
by a tour of each of those screens (ADR 0045).*

Slice evidence: a reader who has never seen this product is walked from an empty database to a
comparison they can read — nine kinds of definition, twelve published versions, and a dependency
order in which nearly every gate refuses until the one before it is satisfied, which is the
afternoon of clicking ADR 0043 measured. The guide offers `make seed` as a command to run in a
terminal and exposes no control that performs it: ADR 0043 decided the seed is a command and never
a route, and a convenience button would be that route reintroduced. Every other step links to the
surface where the work is done, so the guide reads the chain and gains no privilege over it.

### Slice 4 — Show me around this screen

Milestone 7 closed, and then what the guide *shows* was changed. Slices 2 and 3 stay above as the
record of what they delivered; this slice replaces both of their on-screen readings and records
what that costs.

- [x] Replace the derived next-step strip and the six inline explainer bands with a stepped tour
  of one screen, launched from that screen and never spanning two.
- [x] Declare every tour in one table — surface, ordered steps, each step's anchor, title and body
  — and sweep that table in the browser so a step that has come loose from its control fails.
- [x] Carry the explainers' reviewed copy and the glossary's hover definitions into the tour
  popovers rather than writing either again.
- [x] Delete the projection the strip alone kept alive, keeping the chain the written setup guide
  walks.
- [x] Keep guide mode as the one preference, now deciding whether a surface offers its tour.
  *Superseded by Slice 5: the mode is removed and every surface with a tour offers it (ADR 0046).*

Frames: none, and one retired. The authoritative set returns to **eighteen**: the nineteenth frame
existed because the band was a shape drawn into surfaces designed without one, and a tour adds no
shape — one control in `PageHeader`'s existing actions slot, and an overlay that is above the page
rather than in it and leaves nothing behind when it is dismissed. `docs/history/design-direction.md` argues
that position and records the pattern's own rules in place of a frame (ADR 0045).

Slice evidence: an operator standing on the live bench asks to be shown around and is walked through
the two arms and the composer they drive them from, one lit element at a time, in the words those
notes already used and with every defined term still hovering the single definition
`/guides/glossary` renders. Seven screens offer it and none offers it unbidden; nothing crosses a
route, nothing is stored about where a reader got to, and no popover performs the work of the
control it is explaining. ADR 0044 refused this pattern on the grounds that a tour goes stale
silently when a control moves and that staleness was invisible to every test this project ran: the
first half is conceded and the second is closed, because every step of every tour is now swept in a
real browser off the table the tours are declared in — the sweep builds the whole chain to reach
the bench and the results screen, and a step whose anchor has come loose fails naming the surface
and the step, the shape ADR 0023 established for the tool registry. What this costs is recorded
rather than dressed up: the derived reading is deleted, so nothing in the application now tells an
operator returning to a half-built lab which step of the chain is still missing, and `/guides/setup`
walks the ten steps without knowing which of them this lab has reached.

### Slice 5 — The guide stops being a mode

Milestone 7 had closed twice. Slice 4 replaced what the guide showed; this slice removes the one
thing Slice 2 built that survived it, because the shape it was built for is gone.

- [x] Remove guide mode: the module that derived it, the three choices on `/settings`, the stored
  override and its key.
- [x] Show the *Show me around* control on every surface that declares a tour, to everybody, with
  no reading of any kind behind it.
- [x] Keep the two view preferences the settings page was also introduced for — the rail's default
  collapsed state and the last-visited shop — and the rest of the Workspace card.
- [x] Drop the one "absent when the mode is off" assertion the suite had, and take the mode out of
  the titles and handlers of the presence assertions that never had a negative half, keeping what
  each was actually protecting.

Frames: none. The control was already in `PageHeader`'s existing actions slot on every surface that
has a tour; what changes is that it is there whatever the lab holds. `docs/history/design-direction.md`'s
paragraph on the three headers that gained a control loses the clause that made it conditional.

Slice evidence: an operator runs `make seed`, opens the lab, and finds *Show me around* in the
header of each of the seven screens that has a tour — which is the case that was broken, because the
seeded lab's completed comparison derived guide mode off and hid every one of them, with the switch
that brings them back on a settings page nobody who needed it had reason to open. Nothing is read to
decide whether to draw the button: the suite that covers it registers no HTTP handlers at all, so a
build that spent a request on the decision fails rather than passing quietly. A browser still
holding `agent-lab.guide-mode` from the old build gets the control anyway, which is what makes
"left unread" a claim the tests carry rather than an assurance — and it is that unit suite, not the
browser sweep, that proves the seeded case, because the lab the sweep builds never completes an
experiment of its own. What is lost is stated rather than
tidied away: nothing can turn the controls off lab-wide any more, and that is accepted for a header
button that does nothing until it is pressed (ADR 0046).

### Slice 6 — The written guides retire

Milestone 7 had closed three times. Slice 4 replaced what the guide showed; Slice 5 removed the
mode that hid it; this slice removes the section that was left once both of those contents
lived somewhere else.

- [x] Remove the Guides header entry, the `/guides` index, and the written setup guide.
- [x] Move the glossary to `/glossary` as a destination for term links, with no header entry.
- [x] Redirect the retired `/guides` paths so a bookmark still lands somewhere useful.
- [x] Keep `SETUP_CHAIN` and `SETUP_GUIDE_STEPS` as the table each surface's tour composes
  from, and the one-definition rule the popovers already follow.

Frames: none. Settings and the glossary remain the lab-level surfaces outside the
eighteen-frame set; the index between them is gone (ADR 0049).

Slice evidence: an operator opens the lab and finds Settings in the header, not Guides. The
help they used to open as a section is on the screen they are standing on — *Show me around*
walks that one view, and *Create the demo* is on settings — and a word in a popover still
opens the same definition the glossary page renders, now at `/glossary`. A bookmark to
`/guides/setup` opens settings; a bookmark to `/guides/glossary#shop` opens the same term.
What is lost is stated: nothing lists the ten steps in one place any more, and that is
accepted because each of those steps already answers on the surface it names.

### Acceptance criteria

- No step of the guide is stored, and no surface reports progress the record does not support.
- Nothing decides whether the guide can be found. The control that offers a tour is on every
  surface that has one, and reads nothing to be there. The header does not carry a Guides
  section; the glossary is a destination for a defined word, not a second kind of help.
- The lab states its offline limit without an operator having to read an ADR to learn it.
- Nothing in the settings surface or the guide can populate, reset, or overwrite a database.
- Provider credentials and exporter endpoints stay in the environment, and no route reports a fact
  about either secret.
- Every element a tour points at is checked against the surface it describes, off the one table the
  tours are declared in, so a control that moves fails a test rather than a reader.

## Milestone 8 — The workspace becomes the prototype

Bring `apps/web` to the whole-workspace design handed over on 19 September 2026
(`tmp/design-frames/Workspace.html`), on the primitives the workspace already has and without a
new UI dependency. `docs/PLAN-UX.md` is the authority for its scope, order and checks. The
lab-as-a-mode slice wrote its ADR before its code, because it moves every lab route out of shop
scope: ADR 0054 is the route scheme every later slice is written against. Acceptance is that
plan's, plus: nothing about progress is stored (ADR 0044, ADR 0045 stand), the connection never
enters a fingerprint (ADR 0052), and the eleven Playwright journeys pass on the new routes
without the application having been bent to them.

## Historical POC milestones

The former Milestones 1–3.5 were completed and remain documented by ADRs 0005–0010, Git history,
tests, and the running code. Their outcomes are the POC baseline summarized above; they are not
unfinished target-product milestones.

---

## Recommended next steps, as `docs/decisions-and-next-step.md` listed them on 2026-09-20

1. Milestone 0.5 is complete. The design direction is selected and recorded in
   `docs/design-direction.md` (Direction A merged with named strengths of B and C), and the 18
   authoritative frames live on the design canvas page "Shop workspace — v2 IA", with a local
   export in `tmp/design-frames/` (see `docs/design-direction.md`). No further design exploration
   is required before implementation; UI slices cite those frames.
2. Milestone 1 Slice 1 is complete: ADR 0012 records the target identifiers, draft/published
   version lifecycle, `sandbox-v1` canonical boundary, and migration/reset policy, implemented as
   pure domain/application code with tests and formalizing the `docs/design-direction.md` model
   revisions in `docs/product-direction.md`.
3. Milestone 1 Slice 2 is complete: ADR 0013 records the `shop-payload-v1` payload schema, the
   split between structural invariants and the publish gate, the canonical-document persistence
   for `definition_drafts`/`definition_versions`, the `/api/v1/shops` contract, and the Studio
   application shell. The POC's persona-first frontend was removed with that shell; its HTTP
   contracts remain published and tested without a UI consumer.
4. Milestone 1 Slice 3 is complete: ADR 0014 records the `customer-profile-payload-v1` and
   `support-identity-payload-v1` schemas, the field-sensitivity classification that keeps synthetic
   personal data out of logs and traces, the per-shop attachment that scopes the Studio's customer
   list without making the profile shop-scoped, and the extraction of the shared draft/published
   authoring lifecycle that every shop-independent definition now uses. Tone of voice stays
   shop-level under ADR 0012 rather than joining the support identity.
5. Milestone 2 is complete. The order editor with frozen address copies (ADR 0015), versioned
   tickets (ADR 0016), the objective and mutation block libraries (ADR 0017), the scenario recipe
   and its composition editor (ADR 0018), the canonical sandbox snapshot a published version
   materializes into (ADR 0019), the independently mutable clone each arm works in (ADR 0020), the
   versioned read tools an arm interrogates that clone through (ADR 0021), the safe address change
   it may actually make (ADR 0022), and the evidence that holds them together (ADR 0023) are
   delivered.
6. ADR 0023 adds two standing constraints rather than behavior. The canonical serializer and the
   `sandbox-v2` and `sandbox-state-v1` envelopes now have recorded fingerprints, so changing any of
   them means deliberately answering whether every starting state frozen before that change is a
   different one — the answer is sometimes yes, and must never be silent. And the tool suites sweep
   `SANDBOX_TOOL_CONTRACTS` through a sample-call table checked against it, so a tool published
   without a call in `tool_call_factories.py` fails a test instead of quietly leaving every sweep.
7. Milestone 3 Slice 1 is delivered: the agent configuration is a versioned definition (ADR 0024).
   The framework, architecture, model, prompt template, tool bindings, memory, and support identity
   an experiment runs on are published inputs rather than composition defaults, judged against a
   declared catalog of what the lab has proven it can run. A prompt may name shop and
   support-identity facts and may never name customer, order, or ticket facts, because discovering
   those through tools is part of what an experiment compares. The permission a write tool needs is
   now declared on its contract, so the runtime and the publish gate read one table.
8. Milestone 3 Slice 2 is delivered, together with the Milestone 4 runner it was sequenced against
   (ADR 0025). An experiment binds a published scenario version to one or two published agent
   configurations, freezes one canonical snapshot, clones an arm per configuration, and opens both
   threads on the ticket's triggering message; every later customer turn arrives through a
   participant-driver port whose first implementation is the human operator. One delivery is one
   composition however many arms it reaches, so a reply sent to a single arm is divergence the
   record keeps rather than something a later comparison of the bodies would have to guess at. The
   setup gate answers the tone-of-voice check ADR 0012 placed at experiment setup and warns when
   the arms differ along more than one dimension.
9. The runner that executes an arm is delivered (ADR 0026). Advancing an arm resolves its
   published configuration against the versions the experiment pinned, renders the prompt, offers
   exactly the tools that configuration enables, and runs the framework it names against that arm's
   own sandbox — recording what it answered, every tool call it made, the confirmation and revision
   each write carried, and the attempt in which it failed. It is a new `SupportAgentRuntime` port,
   not a bent `AgentAdapter`: the POC's port hands an agent a pre-loaded support context, which is
   the opposite of the tool-first rule an arm runs under. Two frameworks sit behind it — a declared
   deterministic control policy that runs offline, and Pydantic AI deriving its tool schemas from
   the published contract table. Evidence is a property of the call path: a runtime reaches the
   world only through an invoker bound to one arm and one actor, and that invoker is what writes
   the event.
10. The normalized execution timeline is delivered (ADR 0027). One ordered, framework-neutral
   stream reads an experiment's whole execution back — the compositions both arms share, each
   arm's attempts, and every tool call with what it did to that arm — and every entry carries the
   project-owned file and line of the code that ran it, resolved from the tool registry and the
   runtime that produced the turn rather than from a map kept by hand. It is a projection, not a
   record: nothing is stored, because a second stored shape is a second chance to disagree with
   the first. It carries no message body, so the surface built to be filtered, counted, and later
   handed to an evaluation never repeats what anyone said.
11. The scenario's mutations now fire (ADR 0028). A published recipe's bound fault reaches the
   arm it was authored for at the moment it named — between two of the agent's calls, because
   that is where the world has to be able to move for the conflict ADR 0022 built to be
   reachable at all. The lab declares what it can carry out rather than trying: one effect,
   applied to a bound order, and two moments it can observe from the arm's own record, with an
   experiment refused at setup when its recipe names anything else. A firing happens once per
   arm and both arms carry the identical schedule, so the fault is not a comparison variable —
   meeting it is.
12. Resume is delivered (ADR 0029). An experiment is entirely in the record, so coming back to
   one is an ordinary read — and each arm now says what it is waiting for, derived from its own
   two streams rather than stored beside them, so the runner deciding what an advance does and
   the bench drawing the button read one rule. A question an arm passed over, which ADR 0026
   made deliberate, is reported rather than left looking like a gap.
13. Deterministic evaluation is delivered (ADR 0030), which completes Milestone 4 and opens
   Milestone 5. Each of a scenario's bound objectives is judged from one arm's own record — the
   calls it obtained answers from, and how its sandbox differs from the one it was cloned from —
   with "not yet" kept apart from "no", a judge's rows deferred rather than counted, and the
   evidence this build cannot read saying so instead of failing the arm. The scenario's turn cap
   now ends an arm and settles what it never did; the completion statement is still a judge's.
14. The judge is delivered (ADR 0031). A judge is a published definition — a rubric, a model,
   and a declared list of what it is shown — and it scores one anonymized brief per objective
   per arm: what that arm did and said, and nothing about what ran it, with a rubric naming a
   framework refused at the publish gate. Its three outcomes are the lab's, and "unclear" is
   one of them, because a judge forced to choose would guess. Every execution is recorded with
   the judge version, the model, and the fingerprint of the exact input it read; scoring again
   writes the next attempt rather than replacing the last, and a judge the lab cannot reach
   records nothing rather than counting against an arm.
15. The quantitative record (ADR 0032), the objective-level comparison on frame 9's General tab
   (ADR 0033), and experiment-first history (ADR 0034) are delivered. History is one cross-shop
   listing whose every row — each arm's standing, what it met out of what was decided for it, and
   the versions it pinned — is projected from the record the bench and the results screen read;
   it replaces the persona-first listings, which were removed with it. An experiment's status is
   read the same way and is still not a state anything sets: running while an arm can be acted
   on, failed once every arm is finished and one missed a required objective.
16. The per-arm state diff is delivered (ADR 0035). The business-state card now says what an
   arm's world became and not only that it moved: the difference between the exact bytes the
   arm's two fingerprints cover, walked over the whole canonical state document so a field
   authored tomorrow appears without a change, grouped by the order the incident names and
   paired by order identity. A field that was never there is kept apart from one that was
   emptied, and what lies outside every order is reported rather than dropped — which is what
   keeps "no other state changed" a claim that could fail.
17. Experiment notes and tags are delivered (ADR 0036). What an operator concludes about a run is
   stored beside the experiment rather than inside it, so annotating one cannot move the
   fingerprints it pinned. A note is appended and never edited, because it is what a reviewer
   thought when they read this evidence; a tag set is replaced whole, because how a run is filed
   is a current classification. A tag is folded to one lowercase kebab-case spelling — and
   refused rather than mangled when the fold cannot make a slug of it — so the shelf history
   narrows by has one identity. The listing shows the tags, counts the notes, and searches both.
18. Milestones 5, 6 and 7 are complete: traces, replay and fork provenance and the judge
   evidence (ADRs 0037–0040); the second framework and the first controlled comparison
   (ADRs 0041–0042); the settings surface, the tours and the retired guides (ADRs 0044–0049).
   The 13 September UX plan's Slices 1–8 (ADRs 0050–0051) and the handoff's eight pattern slices
   (`docs/history/workspace-refresh-pattern-slices.md`) are delivered, and ADR 0052 and ADR 0053 are accepted ahead of
   their code.
19. Next is `docs/PLAN.md` Milestone 8, planned in `docs/PLAN-UX.md`: the workspace becomes the
   19 September prototype. Slice 9 — the lab as a mode, with its ADR — goes first and alone,
   because every later slice, spec and tour anchor is written against the routes it leaves.

Do not add another agent framework or grow the POC scenario registry before the roadmap reaches
them.
