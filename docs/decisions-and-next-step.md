# Decisions, superseded scope, and next step

Status: current — 2026-09-21

## Authoritative direction

The approved product is the Simulation Studio and Experiment Lab in
`docs/product-direction.md`, accepted by ADR 0011, and `docs/architecture.md` describes the
application that implements it. Future work follows the roadmap in `docs/PLAN.md`, not the former
instruction to add Vercel AI SDK immediately.

## Accepted product decisions

- Configure realistic, synthetic e-commerce environments without building a customer-facing
  storefront in V1.
- Keep core commerce concepts typed while allowing administrator-defined typed attributes and
  versioned non-critical extensions.
- Give agents minimal interaction references directly and provide most commerce information through
  framework-neutral, versioned tools.
- Separate shop, customer, support identity, ticket, scenario, agent configuration, experiment,
  run, sandbox snapshot, and evaluation concepts.
- Author inside a shop-scoped admin workspace: orders, tickets, and scenarios belong to one shop;
  customer profiles are reusable across shops while their commerce/support history stays
  shop-scoped. Agent configurations remain shop-independent through prompt variables and tool
  bindings resolved at experiment start.
- Compose scenarios from shared, versioned objective and mutation block templates; templates are
  shop-independent while every parameter binding stays same-shop. Context documents (policies,
  support guidelines) are referenced by scenarios, readable by agents through tools, and
  document-read objectives record whether each arm actually consulted them.
- Edit agent prompts as markdown templates with inline variable chips, a grouped insert menu, and
  selectable preview context; customer/order/ticket facts are visibly non-injectable. LLM
  provider/model/runtime are explicit configuration. Tone of voice is a shop-level named guideline
  set with one default; agent configurations select the shop default or a named override.
- Give customer profiles a named address book with one default entry. Orders select an address
  from the book and store a frozen, source-labeled copy; address-book edits never rewrite existing
  orders, published scenarios, or snapshots.
- Use editable drafts and immutable published versions for authorable definitions.
- Run a maximum of two isolated arms from the same canonical starting snapshot and record operator
  input divergence.
- Make human operation the first participant driver while preserving ports for future LLM and
  scripted customer drivers.
- Evaluate deterministic objectives, anonymized versioned LLM-judge dimensions, and quantitative
  metrics separately.
- Treat turns, tokens, latency, calls, retries, and cost as contextual observations, not universal
  framework scores.
- Make experiment history, evidence, replay, and fork the primary review journey.
- Use the wrong-shipping-address incident as the first complete target vertical slice.
- Permit cohesive replacement of the POC domain and contracts; existing local POC data does not
  require backward compatibility.

## Technical principles retained from the POC

- Pragmatic clean architecture and inward dependencies.
- Framework-neutral application ports and isolated SDK adapters.
- Versioned OpenAPI and tool contracts.
- Canonical starting-state fingerprints and explicit replay context.
- Confirmed, idempotent, concurrency-safe modifying actions.
- SQLite-first portable persistence until its documented trigger is reached.
- Sanitized OpenTelemetry evidence with optional exporters.
- Deterministic test doubles and no required live-model calls in CI.

## Superseded instructions

- `docs/PLAN.md` Milestone 4 previously named Vercel AI SDK as the next task. Domain and product
  redesign now precede another framework adapter.
- ADR 0006's hard-coded generated scenario/persona model is implemented history, not the target
  authoring model.
- The POC's `RetailSupportTools` (`read_customer`, `list_products`, `list_customer_orders`) remain
  implemented POC behavior serving the persona-first conversation contracts. The target tool surface
  is the versioned read-tool set over a sandbox arm (ADR 0021).
- ADR 0010's persona library and conversation history are superseded: their frontend was removed by
  ADR 0013 in favour of the Studio shell, and their two listings — `listConversations` and
  `listGeneratedScenarios` — were removed by ADR 0034, which delivers the experiment-first
  historical record that replaces them. The remaining conversation and persona HTTP contracts
  (start, resume, message, delete, and the order-action protocol) stay published POC behavior.
- ADR 0009's order-cancellation proposal/confirmation protocol remains implemented POC behavior on
  the persona-first conversation contracts. The target modifying-tool protocol is the propose/apply
  pair over a sandbox arm, whose confirmation is the hash of the change and therefore serves as both
  the consent binding and the idempotency key (ADR 0022).
- The minimal customer/product/order canonical schema in ADR 0007 remains valid for POC replay but
  is not the target commerce schema. The target snapshot format is `sandbox-v2` (ADR 0019), the
  mutable clone an arm works in is `sandbox-state-v1` (ADR 0020), what a tool answers with is
  `tool-result-v1` (ADR 0021), and what a confirmation is the hash of is
  `address-change-proposal-v1` (ADR 0022); a further change to what any of them holds requires
  another canonical schema version.
- The M2 provider/model policy remains a historical POC policy. Target agent and judge configuration
  will be versioned authorable definitions.

## Explicitly deferred

- Customer-facing storefront.
- Autonomous LLM customer driver and broad regression runner.
- Managed image upload or object storage.
- External commerce platform integrations.
- Multi-user authentication and tenancy.
- PostgreSQL or durable workflow runtime without a documented operational trigger.
- Global framework leaderboard.

## Known application defects, found but not fixed

Six entries. The first two are backend defects, unscheduled, and each wants an ADR as its entry
says. The three workspace defects after them are scheduled: `docs/PLAN-UX.md` Slice 27 owns them.
The last is an accepted ADR's obligation that no slice carries, unscheduled.

The first two were found on 15 September 2026 while making the Playwright suite trustworthy in parallel
(`fix(test): give every Playwright worker its own stack`). Neither is a test defect and neither was
touched by that change: a suite must not have application code bent to suit it. Both are latent at
lab scale now that the suite no longer provokes them, and both want their own slice.

- **The SQLite engine sets neither WAL nor a busy timeout.**
  `apps/api/src/capability_lab/infrastructure/database.py` builds the engine with `pool_pre_ping`
  and `PRAGMA foreign_keys=ON` only, so pysqlite's five-second default applies and readers block on
  the writer. Any concurrent traffic against one API can answer `500` with
  `sqlite3.OperationalError: database is locked` — two browser tabs on the developer stack is
  enough. This was proved, not inferred: the suite failed about one run in seven, in three
  different assertions, each run carrying exactly one such 500. Hardening it puts `-wal` and `-shm`
  files beside `var/agent-lab.db`, which is a change to what the repository's own reset and
  migration policy has to account for, so it deserves an ADR rather than a drive-by fix.

- **An infrastructure error inside a tool call is recorded as the agent framework's failure.**
  `apps/api/src/capability_lab/application/experiment_runs.py` catches every exception from
  `runtime.answer` in one branch and records a `FRAMEWORK` failure. A tool call reaches the sandbox
  repositories, so a database fault surfaces there. Today an invalidated session turns it into a
  500 and the run visibly breaks; once the engine above is hardened, a transient lock would instead
  be written down quietly as *this framework failed* in a two-arm comparison. That is the lab
  attributing its own fault to the thing it exists to measure, which is worth more than the crash:
  the evidence a comparison rests on stops being about the frameworks. Distinguishing an
  infrastructure fault from a framework fault is the fix, and it is a change to what a run record
  means, so it belongs with ADR 0026's failure taxonomy.

Found on 19 September 2026 while putting the editors' fields on one row
(`feat(web): put every field on one row, label and rule beside the control`). Reported rather than
fixed for the same reason as the two above, one layer up: a layout slice that starts adding
behaviour stops being reviewable as a layout slice.

- **The product editor's category offers no list of the draft's categories.**
  `docs/history/PLAN-UX-2026-09-13.md` Slice 6 records "Products: category offers a datalist of categories already in
  the draft" as delivered, and half of it was: the products create card gave the create form
  `list="product-categories"` and a `<datalist>` built from the draft's own categories, while the
  editor's own category input at `apps/web/src/routes/ProductEditorPage.tsx` had neither. So the
  same field offered the draft's existing categories when a product was created and nothing when
  it was edited, which is where a category is most likely to be corrected into a second spelling
  of one that already exists — the exact fragmentation the datalist was added to prevent.
  **PLAN-UX Slice 12 removed that create card** — creating is a page now, and a product is made by
  appending an empty one to the draft and opening its editor — so the editor's Category row is the
  only surface that asks for a category at all, the half that worked is gone with the card, and
  the fix belongs there alone.
  The consequence is already visible in the copy: `PRODUCT_CATEGORY_RULE` in `lib/fieldRules.ts`
  reads "Pick one the draft already uses, or type a new one", and that row therefore ships with no
  hint at all, because a rule that promises a pick list the surface does not render is worse than
  a rule withheld. A test on the editor asserts the row has no `list` attribute and an empty
  accessible description, so whoever adds the datalist is sent to the hint in the same change.
  The fix is small — the editor already holds every product in `content` — and it is behaviour, so
  it is `docs/PLAN-UX.md` Slice 27's rather than a drive-by.

Found on 20 September 2026 while giving the shared field control the handoff's metrics
(`feat(web): give every field the handoff's own metrics and border`). Reported rather than fixed
for a reason of its own: the slice that found it moves metrics on one shared string, and
narrowing three fields that have drawn full width for as long as they have existed is a visual
change to three editors that its brief does not cover and its reviewer could not check against a
design.

- **Three fields are full width and have never been anything else.**
  `fieldSurfaceClasses` in `apps/web/src/lib/ui.ts` has carried `w-full` since before the field
  slice, and three call sites compose a narrower width onto it: `OrderEditorPage.tsx:432` (`w-20`,
  a line-item quantity), `OrderEditorPage.tsx:576` (`w-32`, a total) and
  `ExperimentResultsPage.tsx:364` (`w-48`, the tag box). None of the three has any effect.
  Tailwind emits its utilities in a fixed order rather than the order a caller writes them, and in
  the built stylesheet `.w-20` (byte 13079), `.w-32` (13155) and `.w-48` (13193) all come *before*
  `.w-full` (13326), so the shared width wins every time. The source reads as though three fields
  are narrow and the screen has always drawn them full width, which is the worst of both: nobody
  reviewing the call site sees a bug, and nobody looking at the screen sees the intent.
  The `max-w-*` sites — five in `ProductEditorPage` and one in `CustomerEditorPage` — are
  unaffected, because a maximum and a width do not compete.
  The fix is a decision rather than a deletion: either the three widths are wanted, in which case
  the shared string stops declaring `w-full` and every consumer that relies on it says so, or they
  are not, in which case they go. Both are layout changes across the editors, which is why a slice
  that only moves a metric reports this and leaves it.

Found on 20 September 2026 while writing the editor rows' hints (`feat(web): give every editor
row the rule its control obeys`). Reported rather than fixed because the fix is a refusal — a
control that stops accepting a value it accepts today — and a copy slice that starts refusing
input is no longer reviewable as a copy slice.

- **Shop details will save a slug another shop already has.**
  The create form refuses one: `ShopsPage.tsx` holds `takenSlugs` off the listing and
  `DerivedIdField` reports the collision before submit. Shop details is a plain input over
  `identity.slug`, and there is no check on the way out either — `require_slug` in
  `domain/content.py` checks the shape and the length, and no repository or service compares a
  draft's slug against the other shops'. So the one rule the create form enforces about a slug
  is lost the moment the shop exists, and two shops can carry the same one; nothing downstream
  reads the slug to resolve a shop (routes address it by UUID), so the damage is that the shops
  index lists and searches two rows that answer to the same word.
  The hint on that row deliberately says nothing about it, because a field may not describe a
  refusal the surface does not make. The fix wants the editor to read the listing the create
  form already reads, which is a fetch this page does not make today.

Found on 23 September 2026 while landing the *Model provider* zone (PLAN-UX Slice 19, unit C).
Recorded rather than built because it is a contract change and a results-surface change, and
the unit that found it is a settings zone. Slice 26 was considered and rejected: its *Results:
the arm summary cards … each version linked* item is where *endpoint not recorded* would
render, but the slice already carries its one additive contract change, the ticket context
payload, on a branch of its own, and serving `model_base_url` would be a second.

- **A run's endpoint is recorded and never shown.** ADR 0052 put `model_base_url` on
  `experiment_runs` and `experiment_judgements`, and unit B writes it: a run pins the endpoint it
  reached, and an advance against another is refused naming both. Its *Migration* section also
  says what a reader sees — "the results surface renders that as *endpoint not recorded* and
  deliberately not as *offline*, because the two are different facts and only one of them is
  known" — and nothing does. `model_base_url` is in no response schema in
  `packages/contracts/openapi/v1/openapi.yaml` and nowhere in `apps/web`, so the fact a run was
  pinned to is visible only in the refusal that fires when it is contradicted. The fix is
  additive: serve the field on the run and judgement read models, and have the results surface
  render a null as *endpoint not recorded*. It is a public contract change, so it ships with its
  backend, its consumer and its tests together.

## Figures the prototype draws that no payload carries

`docs/design-direction.md`'s *Departures from the handoff, in force* records each of these as
refused, under the rule *Lists and counts* states: a figure the payload lacks is not faked. That
table says what was decided and why; this says what the product would have to buy to decide
otherwise, because two of the three are questions it may one day reopen and the third is a
question worth not reopening in the form it was asked. None of this is `docs/PLAN-UX.md` Slice
27's work and nothing here is added to it: that slice's last bullet settles the same question for
the six chips UI-4 could not compute — they stay uncomputed unless a listing gains the figure for
a reason of its own — and these three are the same kind of figure, held to the same rule.

- **The chip *Required by a scenario* on the Documents table, and the column *Read by* beside it**
  — which is also the note card the document editor's side column would have carried.
  `ScenarioSummarySchema` carries `context_document_count` and no document, so which documents a
  shop's scenarios read is in no single read: naming the subset today costs one scenario draft
  read per row, which is the additive read ADR 0056 measured and refused. One contract field —
  the context documents a scenario names, on its summary row — would settle the chip, the column
  and the card together, and it is the only one of the three that is a plain purchase.

- **A tone guideline's *version* line.** `ToneOfVoiceSchema` is `{id, name, guidance, is_default}`
  and carries no version, because the shop carries it: the page header's version chips are where
  it is read, and a per-row copy would be the same figure written once per guideline. The
  Documents table's *Version* column is that same figure refused a slice earlier, for the same
  reason: a shop document has no version of its own either. This is the one that arguably
  should stay unbuilt: the price is a contract field and the gain is a repetition.

- **The line *Used by* on a tone guideline** — misconceived as the plan phrased it, not merely
  unbuildable. An agent configuration is shop-independent, its override is a free-typed
  `guideline_id` whose datalist is read off the *preview* shop's published version, and the
  shop a run resolves against is the one the scenario pinned (`ScenarioResolution.shop_version`).
  So "configurations that name it as an override" is not a fact about this shop's draft at all,
  and drawing it here would state one. A *string-match* figure keyed on the id — *N
  configurations carry an override reading `warm`* — is computable and would be a legitimate
  warning, because an override the target shop stops publishing fails at experiment setup,
  which the configuration editor already says on the field itself. That is a different feature
  from the one drawn, and it wants a contract field of its own:
  `AgentConfigurationSummarySchema` carries no tone selection.

The readiness verdict refused on the shop overview is **not** in this category and no payload
would license it. ADR 0044 refused a stored setup checklist and ADR 0045 removed the derived
progress reading, both on principle, and what they leave is the rule in *Navigation and chrome*:
the overview names what a comparison would run and never says that one can run, because whether
one can is a verdict over gates that page does not read. It should not be built.

## Where the work stands

Milestones 0 to 7 are delivered (ADR 0011 to ADR 0049), together with the 13 September UX plan's
Slices 1–8 (ADR 0050, ADR 0051) and the workspace refresh's eight pattern slices. The open work is
`docs/PLAN.md` Milestone 8, planned slice by slice in `docs/PLAN-UX.md`. Its first slice went alone
because every later slice is written against the routes it leaves, and it has landed with them
(ADR 0054); so have the screens its Group B recomposes (ADR 0055 to ADR 0058) and the model
connection the lab now holds and edits from `/settings` (ADR 0052). Group B has one slice left,
the provider that connection makes reachable — Slice 20, which ADR 0053 is accepted ahead of.
Group C, the behaviour the prototype specifies on every screen at once, depends
on nothing in Group B and can start now. The narrative of how each milestone was reached is
`docs/history/PLAN.md`.

Do not add another agent framework or grow the POC scenario registry before the roadmap reaches
them.
