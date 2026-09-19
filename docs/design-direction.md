# Design direction — selected

Status: selected — 2026-08-23

## Decision

The product adopts **Direction A (Studio-first workbench)** from the three-direction exploration
run against `docs/design-brief.md`, merged with three named strengths from the other candidates:

1. **Director's notes (from Direction C):** the live bench carries an operator-only card with the
   scenario's hidden facts and the customer persona guidance, styled as production notes.
2. **Objectives matrix (from Direction B):** objectives render as a structured table — one row per
   objective, one result column per arm with an explicit legend — in the live bench and in
   experiment results, instead of prose checklists.
3. **Bench zoning (from Direction C):** during a live experiment the split conversation takes the
   majority of the width. The library rails do not persist into the bench; definition and snapshot
   provenance collapse into a compact context strip plus a slim side column.

## Rationale

Direction A best serves the authoring-heavy Studio milestones (M1–M2) and keeps published-version
provenance visible, which is the product's reproducibility promise. Its weakness — chrome crowding
the live comparison — is exactly what Direction C's zoning fixes, and Direction B's objectives
matrix is the clearest rendering of per-arm deterministic evidence.

## Retained mockups

- Canvas: **Simulation Lab Design Directions** —
  https://claude.ai/code/artifact/eff44346-3154-43cd-a7da-d61226061413
- The canvas holds exactly the **18 authoritative frames** of the shop-workspace design — the only
  set to implement. UI slices cite these frames.
- A local export of the frames lives in `tmp/design-frames/` — one self-contained `.dc.html` file
  per frame, `canvas.json` for titles and layout, and a README index — so agents can read the
  frames without canvas access. `tmp/` is not under version control; if the directory is missing
  or the canvas has changed, re-export it from the artifact above.
- The exploration and merged-stage-one mockups were removed from the canvas after selection; this
  document is the record of how the direction was chosen.

> Export superseded (2026-09-19). `tmp/design-frames/` no longer holds one `.dc.html` per frame
> beside a `canvas.json` and an index: it holds `Workspace.html` and `Workspace.dc.html`, the
> whole-workspace refresh, with `README.md` now the handoff for that prototype rather than an
> index of frames, and the eighteen per-screen exports and `canvas.json` moved under
> `DEPRECADED/`. What a UI slice cites, and which of the two wins where they disagree, is the
> *workspace refresh* revision at the foot of this document. The three bullets above stay as the
> record of how the frames were exported and why `tmp/` is not under version control.

## Implications

- Primary navigation is **Studio / Bench / History**, per `docs/product-direction.md`.
- The visual language keeps the POC tokens from `apps/web/src/styles.css`: cream canvas
  `#f4f1e8`, paper `#fffdf8`, pine ink `#173c34`, muted `#65746f`, border `#aebbb5`, accent
  `#c2532d`, success `#2f7c5e`, error `#9d3028`, Georgia serif display over the system sans stack,
  soft panel radii and shadows.
- Status is never conveyed by color alone; objective and run states pair glyphs or labels with
  color, matching the brief's accessibility constraints.
- The likely implementation stack remains React, Tailwind, shadcn/ui, and assistant-ui.
- The application shell implementing this navigation lands with `docs/PLAN.md` Milestone 1
  Slice 2; UI-bearing slices cite the canvas frames they implement.

> Token changed (2026-09-19). Accent `#c2532d` is no longer the primary action. Primary moves to
> pine `#1d6241` and the warm red is reserved for destructive; every other token in the list above
> stands. The reasoning is in the *workspace refresh* revision at the foot of this document.

## Revision — shop workspace and ticket model (2026-08-23)

After reviewing the merged stage-one frames, the Studio is restructured as a **shop-scoped admin
workspace** using familiar commerce-admin ergonomics (persistent left resource navigation, index
tables with status badges, resource detail pages) so users transfer habits from tools like the
Shopify admin. We adopt the conventions, not any vendor's branding: surfaces move to a neutral
light admin language while the lab's pine/paper identity remains in the top bar, accents, and
typography.

Model changes this implies (formalized by ADR 0012):

- **Shop is the entry point.** Orders, products, customers-in-shop, tickets, and scenarios are
  administered inside one shop's workspace; a shop switcher changes scope.
- **Ticket is a first-class object** scoped to one shop and one customer: channel, origin
  references, prior message history, and the triggering first message.
- **A scenario builds on one ticket** plus its linked shop-scoped objects, adding hidden facts,
  objectives, constraints, faults, and completion conditions. History from other shops can never
  enter a scenario.
- **Customer profiles are reusable across shops**; their addresses/persona travel, but commerce
  and support history are per shop.
- **Agent configurations are shop-independent.** Prompts are templates with variables limited to
  shop- and support-identity-level facts (for example `{{shop.name}}`, `{{support_identity.tone}}`)
  plus tool bindings; commerce facts stay tool-discovered. Variables resolve at experiment start
  and the resolved configuration is pinned for reproducibility.
- **Versioning survives the admin skin.** Draft/published chips stay in the workspace chrome, and
  a ticket referenced by a published scenario version is frozen with it.

Frames: canvas page "Shop workspace — v2 IA" supersedes the merged stage-one page, which was later
removed from the canvas (see "Retained mockups" above). Experiment setup, the live bench, results,
and history are restyled into the admin shell on the same page. The live bench uses the icon-only
rail and reuses the ticket thread's chat UI — avatar bubbles with name/timestamp captions, a
collapsed prior-history divider from the
ticket, and the labeled trigger divider — so ticket authoring and bench operation read as one
continuous surface. A dedicated narrow-width treatment was considered and dropped; desktop is the
operating environment. Experiment results organize technical depth as tabs — General (evidence
overview), Execution timeline (dual-lane normalized events, runtime fault injections visible),
Traces (sanitized OpenTelemetry waterfall), and Code paths (executed project-owned locations
resolved from recorded events) — with the header and per-arm summary persistent across tabs and
evidence rows deep-linking into the tabs anchored at their event. The product editor completes the
migration: every surface now lives in the admin shell, and the product editor edits the shop draft
(publishing the shop freezes the catalog; experiments that pinned earlier versions never see draft
edits).

## Revision — composable scenario blocks and context documents (2026-08-23)

The scenario editor becomes a composition surface rather than a set of bespoke forms:

- **Context documents.** A scenario references the shop documents that matter for resolving the
  incident (policies, support guidelines, FAQ entries). Documents are readable by the agent only
  through tools; the scenario records which reads are expected.
- **Document-read objectives.** "Read the correct document X" is a deterministic, event-based
  objective (the tool-read evidence already exists). Reading a document is a means rather than the
  end, so each read-check carries a severity: `required` fails the objective when missed, while
  `expected` records a visible warning without failing the run.
- **Objective blocks.** Objectives are authored once as shared, versioned, parameterized templates
  (for example `read-required-document`, `identify-entity`, `confirm-exact-parameters`,
  `single-idempotent-mutation`, `forbidden-disclosure`). A scenario composes bound instances:
  template version + same-shop parameter bindings + severity. Multiple bindings of one template are
  normal (two documents, two read-check objectives).
- **Mutation blocks.** Fault hooks and setup mutations follow the identical pattern: shared
  templates (`concurrent-entity-mutation`, `tool-timeout`, `clock-advance`) bound to entities and
  trigger timings. Mutations are applied by the scenario runtime and are never visible to the
  support agent.
- **Cross-shop templates, same-shop bindings.** Block templates are shop-independent, like agent
  configurations; every binding a scenario makes must reference same-shop objects. Publishing a
  scenario pins the exact template versions along with the ticket version.
- **Ordering semantics.** Objective order is display and priority only — scenarios stay goal-based
  and never imply a scripted conversation. Mutation order is real: it is the run timeline of
  injected events.
- **Navigation.** The Scenarios sidebar section expands into "All scenarios", "Objective blocks",
  and "Mutation blocks"; the two libraries are marked as shared across shops.

## Revision — helpdesk-style ticket workspace (2026-08-23)

- The ticket view uses the familiar three-pane helpdesk anatomy (reference: Gorgias, Intercom —
  conventions only, no vendor branding): ticket list, conversation thread, and a context panel.
- The thread renders every fixture message as a real chat bubble — prior support history and the
  triggering first message (badged as the trigger) — even when the trigger is the only message.
- The thread composer authors **history**, not live replies: a role switch writes as the customer
  or as a past support agent. Live conversation happens on the Bench during a run.
- The context panel carries ticket details and tags, a customer summary, linked commerce objects,
  and **suggested documents** that pre-fill a scenario's context documents when one is built on
  the ticket, plus the ticket's other-tickets and scenario-usage records.
- The workspace sidebar collapses to an icon-only rail to give the context panel room; the
  collapsed state is a first-class layout, not an afterthought.

## Revision — customer address book and frozen order addresses (2026-08-23)

- Customer profiles carry a **named address book**: each entry has a free-text label ("Home",
  "Parent's house", "Office"), structured fields, and one entry is the default.
- **Orders never take a free-input address.** The order editor selects an entry from the
  customer's address book and stores a **frozen copy** labeled with its source at selection time.
  Editing or deleting an address-book entry never rewrites existing orders, published scenarios,
  or snapshots; reselecting is the only way to update an order's address.
- The behavioral persona is operator-facing (and feeds the future customer simulator); it is never
  injected into the support agent's prompt.

## Revision — prompt editor and shop-level tone of voice (2026-08-23)

The agent-configuration prompt experience follows familiar agent-platform conventions (reference:
ElevenLabs' agent configuration) adapted to the lab's template model:

- **Markdown prompt editor.** The system prompt renders as markdown. `{{variable}}` tokens are
  detected and rendered as inline code chips showing `name: resolved value`; a "Type {{ to add
  variables" affordance and an insert-variable menu expose everything available.
- **Preview context, not baked values.** Resolved values shown in chips come from a selectable
  preview context (a shop + support identity). The configuration stays a shop-independent
  template; real resolution happens at experiment start and the resolved prompt is pinned to the
  run.
- **Grouped variable menu with an explicit non-injectable group.** Insertable groups: `shop.*`
  (name, locale, currencies, tone_of_voice) and `support_identity.*` (role, guidance,
  permissions summary). Customer, order, and ticket facts appear in the menu but disabled, with
  the reason: they are tool-discovered by design — that behavior is part of what experiments
  compare.
- **LLM selection.** Provider, model, and runtime settings (temperature, tool-round limits) are a
  dedicated configuration card; all are versioned inputs to the experiment.
- **Tone of voice is shop-level.** Shops own named, versioned tone-of-voice guidelines with one
  default (Shop setup → Tone of voice). Support identity keeps role, permissions, and guidance
  only. The agent configuration selects "shop default" (recommended — resolves per shop through
  `{{shop.tone_of_voice}}`) or a named guideline override; an override missing from the target
  shop fails validation at experiment setup, and any override is reported as a configuration
  variable in comparisons. ADR 0012 formalized this decision and aligned
  `docs/product-direction.md` with it.

## Revision — lab-level surfaces and the guide strip (2026-09-12)

> Partly superseded by the revision below (2026-09-12). The band this section adds to the
> authoritative set — and the explainer reading drawn on it — was replaced by a per-surface product
> tour, and the set returned to eighteen frames. The half about `/settings`, `/guides` and the
> glossary sitting outside the set is unchanged, and the paragraphs below stay as the record of
> what the nineteenth frame was and why it was drawn.
>
> Narrowed by ADR 0049 (2026-09-13). `/guides` is gone; `/settings` and `/glossary` are the
> lab-level surfaces that remain outside the set.

Milestone 7 adds surfaces that are not scoped to a shop, and the eighteen-frame claim above has to
keep meaning what it says once they exist. ADR 0044 splits them in two.

**Lab-level surfaces sit outside the authoritative set.** `/settings`, `/guides` and the glossary
belong to the lab rather than to a shop workspace, and they are built the way the shops index, the
four shop-setup pages, and the support-identity and judge listings were already built: out of
`PageHeader`, `Card`, `IssueList`, and the chips and tokens in `components/WorkspaceChrome.tsx` and
`styles.css`, without a frame and without anyone treating it as an exception. They invent no layout
language. A lab-level page that needed one would be the signal that this reasoning has stopped
applying and that the set has to grow rather than be worked around.

> Narrowed by ADR 0049 (2026-09-13). The Guides index is gone. `/settings` and `/glossary` are
> the two lab-level surfaces this paragraph still describes.

**The guide strip is inside it.** The strip is not a surface but a band across the top of the
content column on frames 1, 4, 7 and 9, which were designed without one, and a cross-cutting
element each page invents for itself is exactly the kind that goes wrong. It therefore gets a frame
of its own, drawn before the slice that builds it: `GuideStrip.dc.html`, shown in context on frame
1 and carrying the readings the record produces — an empty lab naming the one action that unblocks
the chain, a step blocked by a publish gate showing the gate's own finding in the gate's own
vocabulary, and a chain with nothing left to unblock — together with the control that turns guide
mode off, which reads as a preference because what it stores is an operator's disagreement with the
derived default rather than the dismissal of one step. The band adds no token, no component shape
and no theme: it is the lab-note pine on cream already used for the sandbox notice, the workspace's
own chips, and `IssueList`'s reading of a publish-gate finding. It shows no completion percentage
and no step count, offers no per-step dismissal, and its action links to the surface where the work
is done instead of performing it — a band that could populate the lab would be the seed route
ADR 0043 refused, returning as a convenience.

The authoritative set is therefore nineteen frames: the eighteen shop-workspace surfaces, and one
band that crosses four of them. UI-bearing slices keep citing the frames they implement.

Where it is hosted today is narrower than where it is drawn. Milestone 7 Slice 2 mounts the band on
frame 1 and on the shops index — which is not a frame, and is where an operator with no shop is
actually standing — because those two are what the slice's evidence needs. The component is built
so that frames 4, 7 and 9 can host it without displacing their headers, and mounting it there is a
later slice's work. Outside a shop it reads the first step only: the order, ticket and scenario
steps are shop-scoped, so a surface with no shop in scope names what it can check and draws no
chain.

**The inline explainers are the same band, not a second one.** Milestone 7 Slice 3 puts a note on
the surfaces whose vocabulary is particular to this lab, and draws it on the band the strip already
established: the same lab-note pine on cream, the same left rule, the same content column. It sits
*below* the page header rather than above it, which is the one way the two readings differ in
placement — the next-step strip displaces the header because it is about what to do instead of
reading this page, while a note that says what this page is belongs under its title.

Which surfaces those are is ADR 0044's list of untransferable vocabulary, and it is not the same
list as the frames the band was drawn on. The notes land on frames 4, 4a and 4b (the scenario
editor and the two block libraries), frame 8 (the live bench), frame 9 (the results screen), and
the starting-states page, which has no frame — built, like the other frameless surfaces above, out
of the existing chrome. Frame 7, the experiment setup, carries no note today even though the
guide's last step links to it; frames 1 and 10 carry none either. The next-step reading is still
mounted only on frame 1 and the shops index, exactly as the paragraph above says.

The set therefore stays at nineteen. What hosts the band grew; the band did not become a second
element, and no frame gained a shape that is not already drawn. The note carries no control of its
own — those screens are where the work is done, and a note that offered an action would be offering
the page beneath it — only the vocabulary, each defined word hovering the one definition
`/guides/glossary` renders, and a link out to the setup guide.

## Revision — the guide becomes a tour, and the set returns to eighteen (2026-09-12)

The band is removed. Both readings drawn on it — the derived next-step strip across the top of the
content column, and the inline explainer below each page header — are replaced by a **product
tour**: a control in the page header, and, when an operator asks for it, an overlay that dims the
surface, cuts one element out of the dim, and explains that element in a popover beside it, with
*Back*, *Next* and a step count. Twenty surfaces have one, and no tour crosses a screen (ADR
0045). Seven were written as walks of the screen itself — each shop's home, the two block libraries,
the scenario editor, the starting states, the live bench and the results screen. The other eight are
the steps of the setup chain that had none, and every surface on that chain opens on where it sits in
the chain and what stays refused until the work there is done, composed from the chain table rather
than written per screen (ADR 0048).

**The authoritative set is eighteen frames again.** The nineteenth existed for one reason: the band
was a shape drawn *into* surfaces that were designed without it, displacing a header on four of
them and sitting under a header on six, and a cross-cutting shape each page invents for itself is
exactly the kind that goes wrong. The tour's overlay has none of that property: it is above the
page rather than in it, it changes no surface's composition, it moves nothing on the canvas, and
when it is dismissed the screen underneath is the screen that was designed. There is nothing there
for a frame to place.

What the tour does add to a surface is one control, in `PageHeader`'s existing actions slot — the
slot that already holds *Save draft* and *Publish* on frame 4, *Results* on frame 8, and *Replay*
and *Fork* on frame 9. On those frames nothing new is drawn. On three surfaces it is new: the two
block libraries (frames 4a and 4b) and the frameless starting-states page had no header actions at
all before this, so those three headers now carry a control their frames never drew. That is a
chip-sized addition to a slot the header component already lays out, made of the same subtle
button the workspace uses everywhere; it is named here rather than glossed over, and it is not the
kind of cross-cutting shape the band was. **The tour therefore does not get a frame, and no frame is
redrawn for it.** What would change that is a tour that left a persistent shape behind — a progress
rail, a docked panel, a badge that stays once the tour ends — and the day one of those is wanted is
the day this reasoning stops applying and the set has to grow rather than be worked around.

**The pattern's own rules**, which are what a frame would otherwise have carried:

- The tour ships no token and no component shape of its own. It is `driver.js` for the overlay
  geometry and the keyboard behaviour, skinned in `apps/web/src/styles.css` from the tokens above:
  the popover is lab paper with the admin border, its title is the Georgia display face in pine
  ink, its body is the same 12.5px admin-ink-soft the explainers used, its forward button is the
  ink button the workspace uses everywhere, and the dim is the lab's own pine rather than the
  library's black.
- The launch control is the same subtle button on every surface and says the same words — *Show me
  around* — so a reader who finds it once finds it everywhere. What differs is only its accessible
  name, which says which screen it would walk.
- Nothing starts unbidden and nothing is remembered. There is no first-run tour, no auto-start, no
  step counter that survives a dismissal, and no per-screen "don't show me this again". Nor is
  there a lab-wide mode: the control is on every surface that has a tour, always. It was gated by
  one until that gate hid the guide from any lab holding a completed comparison — which is every
  lab `make seed` fills — and a control that does nothing until it is pressed has nothing to opt
  out of (ADR 0046).
- A popover explains the control beside it and never performs its work — ADR 0043's refusal and
  ADR 0044's reading of it are unchanged — and each tour ends on the surface it started on.
- What keeps the pattern honest is not a frame but a test. Every step of every tour is declared in
  one table, and a Playwright sweep walks that table asserting each step's anchor still resolves to
  exactly one visible element on its surface. A control that is renamed or moved fails it, which is
  the objection ADR 0044 raised against coach marks, answered.

**What is lost with the band** is recorded here as a cost rather than a tidying. The strip read the
listings the product already serves and named the one step a half-built lab had not satisfied, in
the publish gate's own words, with nothing stored. No surface says that now. `/guides/setup` still
walks the chain in dependency order, but it walks it without knowing where a reader has got to.

> Narrowed by ADR 0049 (2026-09-13). That page is gone too. Each surface's tour still names its
> own place in the chain; nothing lists all ten steps in one place.

## Revision — field hints and the required-field convention (2026-09-13)

Create forms carry their own guidance. The convention is written here once — Slice 1's first
bullet names this file as that place — and applied on every create form; later surfaces adopt
the same words rather than inventing a second rule. ADR 0050 records that this section is the
decision, and does not restate it. Slices that PLAN-UX tells to record a router migration or a
confirm policy still write an ADR of their own (Slices 8 and 13).

**The minority is marked.** When most fields on a form are required, optional fields are
labeled "(optional)", as the product editor already writes on price. Required fields are not
starred. A form of only required fields therefore carries no marker.

**Placeholders.** Each free-text field on a create form carries a placeholder that is a
realistic example, not a restatement of the label.

**Guidance has one carrier per job.** Tours explain a surface. Hints explain a field.
`title=` is never the only carrier of a rule: a format or a consequence is a `FieldHint` —
one muted line under the control, tied to it by `aria-describedby` — so a reader without a
pointer has the same rule. `title=` may still feed the browser's native validity message; it
does not replace the hint.

**LocaleField.** The locale rule lives on `LocaleField` itself, so every surface that uses
the field — the shop create form, Shop details, and the customer editor — shows the same
hint. Slice 1 does not rewrite those other surfaces; they inherit the field's own rule.

## Revision — derived identifiers (2026-09-13)

Slice 2. Identifiers are derived from a human field and are never the first thing on a
form. The field follows the source until edited, restores the suggestion on blur-while-empty
or the next source change, and refuses a value already taken. The field-hint convention
above is unchanged.

**Order and ticket references.** An order continues the shop's existing `{prefix}-{n}`
series (`seriesPrefix`, then `nextReference`). A shop with no numbered orders yet takes
initials from its name. Ticket references always use `T`, independently of the shop name.

**A suggestion that is not known yet** (added 2026-09-15). Both of those are derived from a list
the page is still reading, and a field that opens before the list lands has no suggestion to offer
— only a suggestion *coming*. Such a field is closed (`DerivedIdField`'s `pending`) until it
knows, and the commit that opens it is the one that puts the suggestion in it. It closes again
when a *create* moves the list: the re-read that follows leaves the field empty and the next free
reference unknown, exactly as on first load, and the field comes back unclaimed rather than still
belonging to whoever typed the last one. A re-read that leaves a value in the field — a save
elsewhere on the page — needs none of this, because there is nothing empty for a suggestion to
land in. The follow-until-edited rule cannot stand in for this: a suggestion arriving late is
indistinguishable from a source that changed, so the field writes it over whatever the operator
typed into it in the meantime — which is the defect this clause was written for. Every field whose
suggestion is derived from something loading says so; one derived from a field on the same form
has nothing to wait for and does not.

## Revision — enum labels and the status pill (2026-09-14)

Slice 3. No value of a contract union reaches a reader in its wire spelling. The convention is
written here once; ADR 0050 records that this section is the decision and does not restate it.
The field-hint and derived-identifier sections above are unchanged.

**Where a label table lives.** A closed set the contract publishes has exactly one label table,
and a new one goes in `apps/web/src/lib/enumLabels.ts`. They are not spread across the domain
modules because these vocabularies are not domain-shaped — a permission is read by two editors,
a definition type by three surfaces — and because one registry is what makes the sweep over
them exhaustive.

This is not yet true of the whole workspace, and the section says so rather than describing an
end state as if it had arrived. Slice 3 moved in the twenty-one tables it names, including the
ones `lib/orders.ts` and `lib/tickets.ts` already held; those two modules keep publishing their
label functions and read the tables from the new module. These tables still sit outside it and
migrate as the slice that next touches their surface moves them:

- `ASSESSMENTS`, `DETERMINISTIC_EVIDENCE` and `EFFECTS` in `routes/BlockEditorPage.tsx`, and
  `EFFECTS` in `routes/ExperimentTimelinePage.tsx` — arrays and open records over contract
  unions, so a new member is silently absent rather than refused.
- `MEMORY_MODES` in `routes/AgentConfigurationEditorPage.tsx`, which carries a third field
  (`detail`) that the shared `EnumLabel` does not yet model.
- `DOCUMENT_LABELS` in `lib/scenarios.ts`, reached through `documentCollectionLabel`. It is
  the one place a contract union has two label tables at once: it spells `ShopDocumentKind`
  at length ("shop policy", "support guideline", "FAQ entry") for the scenario editor's
  context documents, where `SHOP_DOCUMENT_KIND` spells it short ("policy", "guideline",
  "FAQ") for the ticket context panel. The two lengths are deliberate, not a duplication to
  merge blindly; they collapse into one table when a slice decides which length each surface
  is owed — most likely by giving `EnumLabel` a longer form, the way `MEMORY_MODES` needs a
  third field.
- `ARCHITECTURE_LABELS` in `lib/agents.ts`, and `OUTCOMES`, `FAILURES` and `JUDGE_FAILURES` in
  `lib/evidence.ts`, which pair a label with a mark or a sentence of their own.
- `KINDS` in `routes/ExperimentTracesPage.tsx`, which is not a label table at all: it maps a
  span kind to the exporter's own span name, letter for letter, and must not be prettified.
- Hand-written `<option>` lists for `AccountStatus` and `LoyaltyTier` in
  `routes/CustomerEditorPage.tsx`.

**Keyed to the contract, not to a copy of it.** Each table is typed `Record<Union, EnumLabel>`
over the generated contract union, so a member added to `openapi.yaml` fails the typecheck here.
`lib/enumLabels.test.ts` then reads the generated types and names the enum and the member that
has no words, the sweep shape `lib/tours.test.ts` uses over `TOUR_IDS`, and it reads the
module's own exports back so a table left out of the registry fails too. A field the contract
types as a free string rather than as its union is read with `describeValue`, which returns the
value exactly as the record carries it when the table has no words for it — the vocabulary is
the backend's, and dressing an unknown member up would put this application's guess where the
lab's own word belongs.

**A label, and an explanation only where one is owed.** An entry is `{ label }`, or
`{ label, explanation }` where an operator could reasonably choose wrong — a permission grants
an ability, an evidence scope changes the question a judge is asked. Explained controls read
"Label — explanation", the scenario editor's option style: "Issue refund — refund an order in
full or part". A set whose members explain themselves ("Card", "Wallet", "Draft") carries no
second sentence, because a hint that says nothing teaches a reader to skip the ones that do.

**An explanation may only say what the lab enforces.** Every clause that states a rule is the
lab's own sentence, carried from the code that applies it, and the table says which code that
is. An explanation with no rule behind it would teach an operator a constraint the run will not
honour, which is worse than the bare label it replaced.

**Case belongs to the position.** Most labels are capitalized. The tables read mid-sentence —
ticket origin, document kind, comparison dimension — stay lowercase, because "opened from
Order page" is worse than "opened from order page". Explanations are lowercase clauses, so
that a label and its explanation compose into one line.

**Status pairs a glyph with the word.** A status column renders a `StatusPill`, whose glyph
says which axis the status is on — payment, fulfilment, product, availability — and is
`aria-hidden`. The word beside it carries the meaning, so neither colour nor shape is ever the
only carrier of a status.

## Revision — currencies on the create form, and what a group's hint says (2026-09-14)

Slice 4. A shop sells in several currencies from the form that creates it. The three sections
above are unchanged; this one adds what they did not cover — a rule that belongs to a *set* of
controls, and where a create form stops asking.

**A create form asks for what constrains the work that follows, and names where the rest
lives.** The currencies are on it because they gate everything authored next: `ShopPayload`
refuses a variant priced outside `identity.currencies`, so a shop created with one currency is
found out halfway through a catalog, by a publish gate, with a trip back to Shop details to fix
it. The support channels gate nothing — a new shop answers on chat, and nothing an operator
authors next depends on email or phone being ticked — so the form says that in its footnote and
names the page that holds them. A create form that asked for both would be Shop details with a
Create button, which is the shape this slice exists to avoid.

**A group's rule is tied to the group.** `FieldHint` ties one line to one control through its
`<label htmlFor>`, and a `<fieldset>` is not a control that a label can name. A set of
checkboxes whose rule is about the set — "the first is the default" is nonsense written under
`EUR` alone — uses `FieldGroupHint` from the same module instead: the same muted line, named by
a `<legend>` and tied to the fieldset by `aria-describedby`, so it is read once for the group
rather than once per box or not at all. The line itself is the same convention; only what it is
tied to differs.

**A hint that names something derived is paired with a line that shows it.** "The first is the
default" is a claim about the set that the boxes cannot answer: they render in the contract's
order while the answer is in the operator's ticking order, and floating the ticked ones to the
front would move a box under the pointer that ticked it. So the group carries a second muted
line — "Default: CHF — Swiss franc" — on `FieldHint`'s `extra` slot and `DerivedIdField`'s
"Saved as `…`" model: where a rule names a value the form derives, the form shows that value
where the rule is read. The same line carries the rule the disabled last box cannot state, that
a shop sells in at least one currency.

**A suggestion holds until the field is answered, and is handed back only where the control can
say it is unanswered.** The locale ticks the shop's first currency the way a name writes its
slug, and stops at the operator's first tick, on `DerivedIdField`'s terms. It has no way back:
at least one currency must stay ticked, so a checkbox group has no state that reads as "nothing
answered yet" for a suggestion to return into, and the way back is to reload the form. The
next field that suggests something reads this rather than inventing a third rule — follow until
answered always; resume on empty only where empty is expressible.

**The currency table joined the registry.** `Currency` is a union `openapi.yaml` publishes like
the others; it read as an exception only because the contracts package does not re-export it by
name and `lib/currencies.ts` spells it off `ShopContentSchema`. Held as an array of
`{ code, label }` it was exactly the shape the *Where a label table lives* section calls a
defect — a currency added to the enum would have been silently absent from the form while the
lab refused prices in it — so the words are now `CURRENCY` in `lib/enumLabels.ts`, keyed
`Record<Currency, EnumLabel>` and swept like the rest. `lib/currencies.ts` keeps the type, which
is a statement about the contract rather than a vocabulary.

**A locale echoes the place it names.** `LocaleField` reads its tag back as the language and
place beneath the field, on every surface that uses it, because `en-GB` is a string an operator
can mistype into something plausible. A tag the shortlist does not name echoes nothing: the lab
takes it and this workspace has no words for it, and repeating the tag would look like
confirmation of something nothing confirmed.

## Revision — chips, a country, and what a number field says (2026-09-14)

Slice 5. The five sections above are unchanged; this one covers what they did not — a control
that holds a *list* of short values, a suggestion list too large to be a shortlist, and what a
field that takes a number is allowed to accept.

**A list entered one value at a time is one control.** `ChipListField` is the primitive:
each stored value is a chip carrying a remove button named after the value, and the field that
takes the next one carries the list's rule as a `FieldHint`. The rule is tied to the input
rather than to the group, because what it constrains is the value being typed; `FieldGroupHint`
stays for a rule about a *set* that no one control can state, which is the currency default.
The chips and the field sit in one `<fieldset>` named by a `<legend>`, so the list has a name
to be read as a whole.

**The remove button is named after what it removes, always.** "Remove Ocean Blue", not "✕".
The glyph is `aria-hidden` and decorative, the way a `StatusPill`'s glyph is. This was true of
the ticket's tags and not of the customer's traits or the identity's escalation conditions, and
the difference was an oversight rather than a decision.

**Duplicates belong to the primitive, and are said rather than swallowed.** Each of the five
lists it serves — option values, attribute choices, persona traits, ticket tags, escalation
conditions — is `_require_unique` in the domain, so refusal is one rule of the lab's and not
five callers' preferences. It reads on `DerivedIdField`'s collision model: the second line
turns to the error treatment and is announced, the field is marked invalid, and the Add press
does nothing. A refusal that is only a no-op teaches an operator that the button is broken.

**Which lists the primitive owns.** Five: option values and attribute choices in the product
editor, persona traits in the customer editor, the ticket's tags, and an identity's escalation
conditions. PLAN-UX calls these "the two hand-rolled versions", which was a miscount — traits,
tags and conditions were all hand-rolled, and the product editor asked for comma-separated
text. A sixth exists and is deliberately left alone: the results page's **Notes & tags**
(`ExperimentResultsPage`), whose remove button is already named, whose values are an operator's
own filing facets on a finished run rather than content inside a versioned definition, and
whose add is a real `<form>` posting to the annotations endpoint rather than an edit to a
draft. It is the obvious next adopter and nothing here regresses by leaving it; a slice that
touches that card should move it.

**Respelling is a prop, because only the caller knows whether there is one.** A ticket tag is
stored as a slug; a persona trait is stored as written, and frame 6b draws "mildly anxious"
with its space. `ChipListField` therefore takes `normalize`, the same function under the same
name `DerivedIdField` takes, and where a caller passes one the field previews the result as
"Saved as `wrong-address`" — the paired line of the *currencies* section, applied to a value
the field is about to store — and compares candidates against the stored spelling, because that
is the spelling the lab holds unique.

**A respelling has to reach the shape the gate wants, not most of the way to it.** A tag's is
`slugify`, because `domain/ticket.py` holds tags to `_require_slug`; folding case and
whitespace but keeping punctuation would preview "Saved as `refund!`" and be refused at save,
which is worse than no preview. A `pattern` on the field was the alternative and is the weaker
one: `ChipListField`'s Add is a plain button with no form to submit, so constraint validation
would paint the box red and let the chip through — a pattern is not a refusal here either. For
the same reason every caller passes the contract's own `maxLength`, so the field stops where
the save would.

**Where a suggestion list is not a vocabulary.** `CountryField` is `LocaleField`: a datalist
that suggests rather than a select that refuses, holding the code and echoing the country
beneath the field. Its data is `lib/countries.ts` and deliberately *not* `lib/enumLabels.ts` —
that module's rule is one table per closed set the contract publishes, keyed to the generated
union and swept against it, and an address country is `string` with `pattern: ^[A-Z]{2}$`.
`require_country_code` says why in as many words: it checks the shape and not the register,
because "a closed country list would have to be maintained for no simulation benefit". A table
in the registry would be swept against nothing and would claim a closed set the lab does not
hold. The one way it departs from `LocaleField` is length: a locale shortlist is bounded by
the currencies the lab can price in, while a synthetic customer may live anywhere, so all 249
alpha-2 codes are there. That is ~7.6 KB minified and ~2.4 KB gzipped against a 170 KB gzipped
bundle, which is not enough to earn a split; a table that has to be fetched would be one more
thing to fail while an operator types an address.

**A number field says what it accepts, and does not accept what it cannot carry.** The rule is
the contract's, spelled once in `lib/fieldRules.ts` and used by both the `pattern` and the hint
so the two cannot drift: money is `MoneySchema.amount`, temperature is the contract's pattern
inside the range `agent_configuration.py` and `judge.py` enforce, a seed is the contract's
unsigned 32-bit bound. `inputMode="decimal"` shapes the keyboard; `pattern` marks the field
invalid.

**A pattern is not a refusal, so a value the form cannot carry does not reach a save.** The
shipping fee is where this bites: `previewTotals` reads an unparseable amount as nothing so a
half-typed fee does not turn every row into NaN, which means "abc" looks on screen exactly like
a fee of zero. The order editor therefore refuses the save and says so, the rule `clampQuantity`
already followed for quantities — the editor holds only an order the lab would take.

**A saved row shows the same chips it was entered with.** Frame 2c draws an option's values as
pills on the row, so the row renders a named, read-only `ChipList` — the pill minus the button
— rather than the `·`-joined string it carried before. Opening a saved entry's *fields* in
place is a later slice's work and this is not that: it is the frame's rendering of what is
already there.

**A rule under a table row lives once, not once per row.** A hint line beside twenty price
boxes would be twenty copies of one sentence, so the rows' inputs share one `sr-only`
description through `aria-describedby`, which may name an element anywhere on the page. The
same holds where a card has no room for a standing line at all: the order editor's shipping fee
carries the money rule in a paragraph that is always present and always in the field's
description, `sr-only` until the fee is refused and then visible and announced — `FieldHint`'s
`extra` slot, open-coded where no `FieldHint` fits. `title=` stays for the browser's own
validity bubble and is never the only carrier.

**A closed set of five is five controls, not a typed digit.** The review rating is a radio
group: one radio per star, each named ("4 stars"), arrow-key navigable, with the stars
themselves `aria-hidden`. There is no "no rating" — `ReviewSchema.rating` is required, and a
sixth state would exist only to be refused when Add was pressed. Because a filled star differs
from an empty one by colour and shape alone, the group's second line says the count in words,
which is the same rule the status pill follows.

## Revision — closed sets the lab already knows (2026-09-14)

Slice 6. The six sections above are unchanged; this one covers the two things they did not — a
field whose set is *the lab's own answer* rather than the contract's or a register's, and what
happens to a value when the question above it changes.

**Frame 5 draws both of them as controls.** The LLM card's first row is two boxes with chevrons
— "Anthropic ▾" and "claude-sonnet-5 ▾" — and only its second line ("temperature 0.2 · max 8 tool
rounds") is a read-out. So the frame settles two things this slice had to decide anyway: the
provider and the model are pickers rather than typed strings, and the provider is drawn under a
**human label**, not an ID.

**Where a set comes from decides the control.** The three previous sections settled two kinds of
list: a closed set the contract publishes is a label table and a select (*enum labels*), and a
register too large and too open to be a vocabulary is a datalist that suggests (*chips, a
country*). A third kind appears here and is neither: what the lab has *proven* it can run. Its
members are strings in `PROVEN_FRAMEWORKS` and `PROVEN_JUDGES`, not union members, so no table
in `lib/enumLabels.ts` could be keyed to them and no sweep could hold them to the contract. The
rule is instead the **gate's severity**, because that is what already decides what the lab will
accept:

- A provider is a `<select>`. `capability_issues` and `judge_capability_issues` raise an
  unproven provider as an **error** — nothing in the lab could execute it — so a control that
  could name one would be manufacturing a publish failure.
- A model is an `<input list=…>`. The same two functions raise an unexercised model only as a
  **warning**, because the lab does not publish a framework for every model of a provider it
  supports. A select there would refuse in the browser what the API would take, which is exactly
  `CountryField`'s objection.
- A tone-of-voice override is an `<input list=…>` too, and for a third reason again: an agent
  configuration is shop-independent, so an ID the *preview* shop does not publish may be the
  right one for the shop the experiment will name. Nothing on that page refuses it; what refuses
  it is experiment setup, and that is what the line beneath says.

**A select offers whatever the payload carries.** A `<select>` can only show a value it lists, so
an option missing for the draft's current provider would leave the control displaying one
provider while the payload saved another — the control lying about the draft rather than the
draft being wrong. The off-list value therefore keeps its option and is told about beneath it.
This holds in both editors: neither gate constrains the provider *string* — `capability_issues`
and `judge_capability_issues` take any — so a draft written through the API can carry one that
is off either catalog, and a select that hid it would misreport the draft it is editing.

**A provider is spelled once for the workspace, outside the enum registry.** The judge catalog
serves a label per provider (`ProvenJudge.label`) and the framework catalog serves none, which
left the agent editor and the settings page printing `openai` beside a judge editor printing
"OpenAI" — one branch, two spellings of one string. `MODEL_PROVIDER_LABELS` in `lib/agents.ts` is
now the one spelling, read by both editors, the judges index and the settings page. It is not in
`lib/enumLabels.ts` because a provider is not a union the contract publishes — it is `Slug` on
the wire and `frozenset[str]` in the catalog — so there is nothing for that module's sweep to
hold it to, and `enumLabels.test.ts` names an unregistrable table as a failure. It sits beside
`ARCHITECTURE_LABELS` instead, and an unknown provider is returned verbatim, on `describeValue`'s
rule.

It is the **fallback** spelling rather than a second authority. Where the lab serves a word for a
provider it wins, because the judge gate writes its unexercised-model sentence from exactly that
field (`judge.label`), so a select that spelled the provider from the table while the sentence
beneath it spelled the same value from the server would come apart inside one card the day a
third judge is added. So the judge editor's option text reads `judge.label` and falls back to the
table; the agent editor has no served provider label to prefer and reads the table outright —
which is safe there because the agent gate's sentence names the *framework*, not the provider, so
the two controls in that card never name the same value twice.

What remains is one field with no reader. `JudgeConfigurationSummarySchema.provider_label` is now
read by nothing in `apps/web/src` outside a test fixture: the judges index takes the table, and
the editor takes `ProvenJudgeSchema.label` from the resources it already fetches. That field is
what a later slice should remove or generalise — generalising is the better half, because giving
`ProvenFrameworkSchema` a provider label of its own would delete this table entirely and leave the
lab the only author of the word. Both are contract changes, and both are that slice's to make.

**The provider resets; the model follows the provider; nothing else is taken.** PLAN-UX offered
"resets or flags" and the answer is both, split by a rule rather than by editor:

- The **provider** resets when it leaves its proven set, because the control cannot represent an
  off-list value and the gate refuses one outright. Nothing is lost that could have been
  published.
- The **model** resets only when the provider actually moved, because a model name means nothing
  outside its provider: `deterministic` is not something OpenAI serves and `gpt-5-mini` is not
  something the offline control runs, so the old value could not have been the author's answer
  to the question they just changed. This is what makes the judge editor's mandated reset and
  the agent editor's behaviour one rule: a judge's provider change moves the provider, and an
  agent's framework change moves it only when the new framework is proven somewhere else. Two
  frameworks on `openai` leave a typed model alone.
- Everywhere else the value **stands and is flagged**, because the gate only warns and a form
  that discarded a publishable answer would be worse than the warning it replaced.

**A field may not claim a severity its gate did not give.** `FieldHint`'s second line gained a
third tone, `warning`, in `admin-draft-ink` — the ink `IssueList` gives the word "Warning" beside
a gate finding, borrowed as the workspace's warning ink rather than copied from any one
rendering; the finding's message there is `admin-ink-soft` and `PublishReasons` summarises
warnings in `admin-muted`. It is announced politely rather than as an alert, because nothing has
been refused.

**The sentence is the gate's, character for character.** `lib/fieldRules.ts` reproduces each
`issue_*` message exactly, trailing punctuation included — which is to say none, because the
gate's messages carry none — and names the Python function it copies. It is written there rather
than read off `preview.issues` because `GET /draft/preview` previews the **saved** draft and
takes no payload: a refetch after a keystroke would answer for the model that was last saved and
report the wrong value in the field being typed. Reading the gate live wants a preview that
accepts a draft payload, which is a contract change, so until there is one the duplication is
pinned from both ends — a Python test asserts the exact message and a TypeScript test asserts the
exact sentence, each naming the other. The agent gate's provider sentence and the judge gate's
are different sentences and stay two functions: the judge gate names no framework, because a
judge has none.

**A picker of what a run will resolve reads published versions.** The tone-of-voice datalist is
the preview shop's guidelines as its *published* version froze them, carried by
`PreviewShopOptionSchema.tone_of_voice_guidelines` — the slice's one additive contract change.
Draft guidelines are deliberately absent: `resolve_tone_of_voice` is handed the published
payload, so a guideline living only in a draft is precisely the override that fails at
experiment setup, and offering it would be the picker manufacturing that failure. A shop with no
published version offers nothing and says so.

**An argument is labelled and typed from the contract that declares it.** The tool console reads
three things off `ToolArgumentSchema` that it previously only half-read. The **label** is the
argument's name spelled for a reader — `order_reference` becomes "Order reference", and `_id`
becomes "ID" the way every other identifier in the workspace is written — through a function in
`lib/tools.ts` rather than a table, because an argument name is not a union member and a table
would leave a newly published tool's argument with no words. **Required** is the contract's flag
on the control and not only a word in the label, which is a real refusal here because the
arguments sit in a `<form>` with a submit button. And the **control** is the declared kind: an
enum is the closed set it says it is; everything else is a text box.

**A kind with no HTML type takes none.** `uuid` is that kind. A `pattern` was the alternative and
is wrong: the lab's own check is `UUID(value)` in `sandbox_tools.py`, which takes the hyphenless
form, braces and a `urn:uuid:` prefix as well as the canonical spelling, so any pattern short
enough to write would refuse values the tool accepts — the *chips* section's rule that a
respelling must reach the shape the gate wants, read the other way round. It gets instead the two
attributes that actually help an identifier: autofill and spellcheck off, and a mono face.
`ToolArgumentKind` is a contract union and still has no label table, for the reason `KINDS` in
`ExperimentTracesPage` has none: nothing renders it. It picks a control, and a value nobody reads
needs no spelling.

**A choice of one is not a choice.** The tool console's acting identity defaults when exactly one
support identity is published, and the "Choose…" placeholder in front of a list of one is not
offered. Two or more stays unanswered, because then it *is* a choice and the lab must not make
it: a write is authorized against whichever permissions it names.

## Revision — a saved row opens where it stands (2026-09-14)

Slice 7. The seven sections above are unchanged; this one covers the thing they did not — what
a saved entry does when it is wrong, and what an editor is allowed to change about an entry
that already exists.

**A saved row is read back, and opens where it stands.** `EntryCard` gains an edit mode: the
header line — title, chips, identifier — stays exactly where it was, and the read-only body is
replaced by the row's fields under Save and Cancel. Frame 6b draws this affordance: each
address row in the address book carries a green **Edit** beside its **Remove**, so the frame
settles that a saved row is read-only until asked and that Edit sits where Remove already sat.
Frame 2c draws no edit affordance on its media or attribute rows at all and draws a `⋮`
overflow on each variant row; nothing in the eighteen frames draws a saved entry as a row of
always-open boxes, which is what three of these lists were. The `⋮` is **deferred to Slice 9**,
not declined: a named Edit beside a named Remove is what frame 6b draws and is more reachable
than a menu, and a menu earns its place when the row's cluster outgrows the space — which is
what Slice 9 does to it, by giving every Remove a two-step confirm and the variants row a third
control. The slice that widens the cluster is the slice that should draw the overflow.

**The identifier is displayed, never asked.** An entry ID is derived once, when the entry is
created (`lib/entryIds.ts` already says so), and edit mode hands it back untouched. This is not
tidiness: `diff_keyed_collection` in `domain/definitions.py` keys every collection on that ID,
so an entry written back under a new one is reported as a **removal and an addition** rather
than as an update, and the draft's change summary — the "What publishing would freeze" card —
would say a policy was deleted and another added because a word of its body was fixed. Slice 2
made an identifier follow its source *until edited*; a saved entry is past that point, so a
retitled policy keeps `shipping-policy` and the row shows it as an `EntryId` rather than
offering a `DerivedIdField` with nothing left to derive from.

**Two entries are their own key, and say so where they are typed.** A variant has no ID beside
its SKU and a media entry none beside its reference; those two fields *are* what the diff keys
on. PLAN-UX names both as editable, so they are — a SKU that could never be corrected was the
defect this slice exists to remove — but the field carries the consequence in its hint rather
than leaving it to be discovered: "changing it reads as a removal and an addition against the
published version, and orders already placed keep their frozen copy". A SKU another variant
holds is refused on `DerivedIdField`'s collision model, and Save is disabled while it is.

**One payload builder per entry, called by both paths.** The rule that makes edit mode safe is
that the add form and the open row write through the same function: one `xEntry(id, fields)`
per list, taking the authored fields and the identifier, and one fieldset component rendering
the controls for both. Neither path can then grow a field the other does not write — the case
this guards is not hypothetical, since an attribute's `unit` is null unless it is a
measurement and its `choices` empty unless it is a choice, and an edit path that spread
`{...attribute, ...changes}` would have carried a stale unit through a type change. The page
tests assert against the payload the save carried, not against the row: PLAN-UX names that
test precisely, and it is the only one that catches two builders that agree today.

**One row open at a time, per list.** While a row is open the other rows' Edit buttons are
disabled and the list carries one line saying why, reached by `aria-describedby` — the
convention the variants table already uses for the rule its price boxes share. Two reasons,
neither aesthetic: an open row's typing is deliberately *not* in the draft, so the page's own
"Save draft" cannot carry it, and a card can say that about one open row in one sentence but
not about a set of them; and the state PLAN-UX Slice 8 has to guard is then one open row per
list rather than a set per list, which is the smaller thing to register whatever shape that
registration takes. The same line says the other half — that nothing in the open row reaches
the draft until Save is pressed — because an operator who types into a row and presses the
page's Save would otherwise be told "Saved" about work that was not.

**Cancel restores by writing nothing.** Edit mode holds its draft outside `content` and writes
once, on Save. Cancel therefore has nothing to undo and the saved entry is already what it
was; reopening the row shows the stored values rather than what Cancel discarded.

**An open row is unsaved work the `dirty` flag cannot see, and Slice 8 must register it.**
That is a consequence of the paragraph above, not a detail: `useDefinitionEditor` sets `dirty`
from the draft, an open row does not touch the draft, so an operator who opens the returns
policy, retypes three paragraphs and clicks Orders in the rail is not asked — which is exactly
what PLAN-UX's "No navigation, reload or Remove discards an edit without asking once" forbids.
A page holds several of these editors, not one: the product editor holds five — options,
variants, media, attributes, reviews — Shop details and Policies & FAQ hold two each, and
Support guidelines and Tone of voice hold one each. None is reachable from the hook where
Slice 8 puts its guard. **Slice 8 adds the registration path**, and nothing is offered here in
advance: whether a page counts its open rows into `dirty`, holds them beside it, or lifts these
editors into a context is that slice's question, and a seam shaped for one of the three — an
`onOpenChange` callback was written and removed — would answer it early and would be the wrong
shape for the third. What this slice does hold is the other half: an editor is given the ids
its list currently holds and closes an open row whose entry is gone, so Slice 8's Discard,
which refetches the draft, cannot leave a row open on stale fields or disable every sibling's
Edit behind a notice naming an entry that no longer exists.

**The open row is a named form.** It asks the same questions the add form below the list asks,
in the same words, so the group carries `aria-label="Edit {entry}"`. Without a name, "Title"
means two controls on one card and neither a reader nor a test can say which one they reached.
Edit, Save and Cancel are named after the row the same way `RemoveButton` already is: the
visible word stays short and the accessible name says which entry.

**A row that had only an accessible name gets visible words.** The customer editor's background
and hidden-fact rows, and the support identity's guidance rows, asked their questions through
`aria-label` alone — a reader with a pointer saw two unlabelled boxes and had to guess which
was the note and which the reveal condition. They now read back as text and open into the same
labelled fieldset the add form uses, which is how a row gets a visible label without printing
a form's worth of captions down a list. The guidance rows are where PLAN-UX takes edit mode
from. Converting them is a **departure** from PLAN-UX's wording, which asks only that they
"gain visible labels": the conversion is recorded here and noted at the checkbox, and it was
taken because their old write was `{ ...note, ...next }` assembled at the call site — the
drift this slice exists to remove — and because a list that corrects in place by different
means from every other list is the inconsistency the primitive replaces.

**A refusal belongs to the builder's neighbours, not to one path.** Sharing the builder is not
enough on its own: a refusal the add form gets for free from HTML is a refusal the open row has
to make itself, and a refusal the open row makes is one the add form owes too. Both cases
appeared here and both are now one rule per list. A variant's SKU sits in a `<td>` with no form
around it and a Save that is a plain button, so `pattern` marks the box and refuses nothing —
the *chips* section's rule read the other way round — and the shape is therefore checked in the
save gate off `isVariantSku`, built from the same constant the pattern is. A media reference is
the other direction: the open row refused a duplicate by greying Save and saying nothing, and
the add form did not refuse one at all, which would have put two entries under one key in both
the change summary and React's reconciliation. Both now read on `DerivedIdField`'s collision
model — the second line turns to the error treatment and is announced, the field is marked
invalid, and the press does nothing — from one function computed once per card.

**One wiring, in `lib/entryEdit.ts`.** The function that turns an editor and an entry into an
`EntryEdit` began as a copy per page with a comment pointing at the first one, and had drifted
inside a single branch before review: one copy grew a `saveable` parameter the others lacked. A
slice whose thesis is that two copies of one thing drift does not get to keep four, so it is one
exported function, and `EntryEdit` moved beside it rather than staying in `WorkspaceChrome` so
that `lib/` does not have to reach into `components/`.

**What the variants table kept.** Price, availability and stock stay live cells: they were
already correctable, they carry Slice 5's shared price rule, and a row that made three working
controls wait behind an Edit press would be a regression dressed as a convention. Edit mode
there covers only what was write-once — the SKU and the option values — and saves against the
row as it stands rather than against a copy taken when the row was opened, so a price typed
while the row is open is not put back.

## Revision — an editor says what is unsaved, and asks before it is lost (2026-09-15)

Slice 8. The eight sections above are unchanged; this one covers what an editor's header reports
and what the workspace does when work is about to be thrown away. The decisions themselves — the
data-router migration, one blocker above the route tree, the register an open row declares into,
and the one case the prompt declines to save — are recorded in **ADR 0051**, which PLAN-UX asks
for by name; this section is the visible convention and does not restate the reasoning.

**A clean editor reports a state, not an action.** The header shows **Discard changes** beside
**Save draft** while there is something to save, and the line "All changes saved" when there is
not — in a polite live region, so a save that lands is announced to a reader whose focus was on
the button that has just gone. The disabled accent button reading "Saved" is retired everywhere:
a control in the place the eye looks for an action should perform one.

**Discard undoes exactly what Save would have written.** It re-reads the draft the lab holds. It
leaves a row that is open for editing alone, because no page-level Save has ever carried one —
the same sentence the *saved row opens where it stands* section already prints under every such
list, read backwards.

**A navigation that would strand unsaved work is asked about once**, in one modal dialog naming
what would be lost, with Save and leave, Discard and leave, and Stay on this page. It asks about
the work *this* navigation strands and nothing else, so a draft the destination can still save is
neither named nor touched. Where the prompt cannot save something — an open row, whose typing has
not reached the draft — Save is disabled and carries its reason as an accessible description, on
the `PublishReasons` model rather than as a silent grey button.

## Revision — the workspace refresh, and pine takes the primary action (2026-09-19)

A high-fidelity refresh of the whole `apps/web` operator workspace arrives as one self-contained
prototype: `tmp/design-frames/Workspace.html` to open in a browser, `Workspace.dc.html` for the
markup, `README.md` as its handoff, and `form-decisions.md` as the locked form language with the
alternatives it was chosen over. It is a design reference and not production code; what it asks
for is a recreation on the existing primitives — the Tailwind theme in `styles.css`, the class
sets in `lib/ui.ts`, the chrome in `components/WorkspaceChrome.tsx` — with no new UI dependency.
`docs/implementation-plan.md` breaks it into slices in this repository's own format, and the two
architecture decisions it carries are ADR 0052 and ADR 0053. This section records what changes in
the **selected direction**; the handoff holds the measurements and is not restated here.

**What a UI slice cites now.** The workspace prototype is the authority for what crosses every
screen — navigation chrome, the form row, button language and colour, list density, the search
affordance — and it **supersedes the per-screen frames wherever the two disagree**. The eighteen
frames are not withdrawn: where the prototype does not contradict them they still describe a
surface's composition, and a slice still names them by number, as PLAN-UX's slices do for frames
2c, 4, 7, 8 and 9. So a `Frames:` line names the numbered frame for the surface and the workspace
prototype for the pattern, and where a slice follows the prototype against a frame it says so in
one sentence rather than leaving a reader to find the contradiction. The exports moved: the
per-screen `.dc.html` files and `canvas.json` are under `tmp/design-frames/DEPRECADED/`.

**Pine takes the primary action, and the warm red is reserved for destructive.** This is the one
recorded token the refresh changes. Primary actions move to `#1d6241`, hover `#14452e`; the clay
accent `#c2532d` stops being the colour of the safe, expected action, and `#9d3028` (hover
`#86271f`) becomes the colour of the one that destroys something. The reason is that the clay was
doing both jobs at once: it read as a warning while sitting on *Save draft*, *Add to draft* and
*Publish*, so the workspace had no colour left that meant "this one deletes" — the single signal a
UI should not blur. Pine also puts the primary action in the lab's own identity colour, which the
top bar and the rail already carry.

Two consequences are named so they are not discovered. The **accessibility rule stands unchanged**:
status is still never conveyed by colour alone, and a destructive control keeps its trash glyph and
its verb, with red as a second signal rather than the only one. And the change is a **token and a
class set**, not a per-page edit — `--color-lab-accent` and `accentButtonClasses` are where it
lands, in slice `ui/primary-pine`, together with the destructive variant that does not exist yet
and the hover and `focus-visible` ring that several variants are missing. Until that slice lands
the application still ships the clay accent, and this section is the decision rather than a
description of the code.

> Amended as built (2026-09-19). Primary landed as a **new** token, `--color-lab-primary` `#1d6241`
> with `--color-lab-primary-hover` `#14452e`, rather than as a redefinition of `--color-lab-accent`:
> the accent also draws the trace bars, the review star rating and a ticket's emphasis, none of
> which this refresh settles and none of which it may silently repaint. `accentButtonClasses` is
> still where the change lands. The clay keeps those three and one button — the armed seed — and
> the focus rings moved off it onto the pine. The reasoning is in `apps/web/src/lib/ui.ts`.

**The other token moves are additions, and each arrives with its first consumer.** A field border
`#c9cccf` distinct from the card border; a focus ring of `0 0 0 3px rgb(29 98 65 / 20%)` on fields
and `2px solid #1d6241` offset 2px on custom controls; the selected-chip trio (`#eaf5ed` on
`#b6d9c4` in `#1d6241`). None of them replaces an existing token, and the house rule holds: a
token no page uses is not a slice.

**One form row, on every editor.** Label and hint share a left column of `1 1 210px` capped at
36ch, the control takes the right, both top-aligned, and the row wraps to stacked at narrow
widths. This **generalises the field-hint convention** recorded above rather than replacing it:
the hint is still one muted line under the label, still in the control's accessible description,
and still the place a format rule or a consequence is written. What the refresh adds is that the
geometry is one component instead of a shape each editor reproduces. Forty-four of the
hundred-and-seven rows label a chip group or a custom widget rather than a native control, and
those carry `role="group"` with `aria-labelledby` — never a `for` pointing at nothing.

**A button's icon is part of the button, not of the page.** The refresh gives roughly seventy-five
controls a glyph on a closed vocabulary — plus for create, check for save, counter-clockwise for
discard, pencil, trash, star, play for start, replay, branch for fork, upload for publish, bars for
results, arrow-out for open. The pairing is encoded once beside the class sets so it cannot drift
per page, and the glyphs are redrawable: what is fixed is which glyph means which verb, not the
drawing.

**Counts live on the filter that produces them.** The KPI stat strip leaves all eleven index
routes, and the filter chips carry the number beside their label. It is the same figure read in
the place it can be acted on, and it removes a band that repeated on every list. Five counts have
no chip today and must gain one rather than be lost — *without a default address*, *required by a
scenario*, *referenced by a ticket*, and *not composed yet* on both block libraries.

**The navigation rail gains icons and a collapse.** One glyph per destination, a collapse control
at the foot, and a 52px strip of centred icons with the label on hover when collapsed. This is the
consumer `readNavigationCollapsed` and `writeNavigationCollapsed` in `lib/preferences.ts` were
written for; the preference already exists and stays in the browser, as ADR 0044 and ADR 0046
decided. The rail stays hidden in shops scope and on the lab-level surfaces, which keeps those
outside the frame set for the reason ADR 0044 gave.

**Settings is three zones, distinguished by surface so a reader can tell what they may touch.**
Editable per-browser preferences on white; the lab-wide model connection on white with an explicit
Save and Discard, because it is not a per-browser preference and should not save on change; and a
read-only runtime zone in grey with a padlock and a "To change it:" line naming the variable or the
file. The middle zone is the visible half of **ADR 0052**, and the third keeps the character ADR
0044 gave this page — it reports composition and never edits it — for the two things that are
still composition. The seed action sits in its own zone below, because it is an action rather than
a setting (ADR 0047).

**Two things in the prototype are proposals rather than decisions.** The five new browser
preferences — where the app opens, auto-offer the tour, confirm before delete, timestamp format,
table density — and the shop logo. Each needs a real consumer to exist, by the same rule that
refuses a primitive no page uses; the ones that do not earn one are cut rather than shipped as
switches that decide nothing.
