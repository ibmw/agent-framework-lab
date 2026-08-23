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
- Page **"Shop workspace — v2 IA"** holds the 18 authoritative frames — the only set to implement.
  UI slices cite these frames.
- Pages "Exploration — first pass" and "Direction A merged — stage one" are historical records of
  the selection process; nothing on them is an implementation reference.

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

## Revision — shop workspace and ticket model (2026-08-23)

After reviewing the merged stage-one frames, the Studio is restructured as a **shop-scoped admin
workspace** using familiar commerce-admin ergonomics (persistent left resource navigation, index
tables with status badges, resource detail pages) so users transfer habits from tools like the
Shopify admin. We adopt the conventions, not any vendor's branding: surfaces move to a neutral
light admin language while the lab's pine/paper identity remains in the top bar, accents, and
typography.

Model changes this implies (to be formalized by the Slice 1 ADR):

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

Frames: canvas page "Shop workspace — v2 IA" supersedes the merged stage-one page, which is kept
as history. Experiment setup, the live bench, results, and history are restyled into the admin
shell on the same page. The live bench uses the icon-only rail and reuses the ticket thread's
chat UI — avatar bubbles with name/timestamp captions, a collapsed prior-history divider from the
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
  variable in comparisons. `docs/product-direction.md` still describes tone on the support
  identity; the Slice 1 ADR aligns the model documents with this decision.
