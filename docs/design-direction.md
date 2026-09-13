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

Milestone 7 adds surfaces that are not scoped to a shop, and the eighteen-frame claim above has to
keep meaning what it says once they exist. ADR 0044 splits them in two.

**Lab-level surfaces sit outside the authoritative set.** `/settings`, `/guides` and the glossary
belong to the lab rather than to a shop workspace, and they are built the way the shops index, the
four shop-setup pages, and the support-identity and judge listings were already built: out of
`PageHeader`, `Card`, `IssueList`, and the chips and tokens in `components/WorkspaceChrome.tsx` and
`styles.css`, without a frame and without anyone treating it as an exception. They invent no layout
language. A lab-level page that needed one would be the signal that this reasoning has stopped
applying and that the set has to grow rather than be worked around.

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
