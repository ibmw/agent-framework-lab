# Product design brief — the record of the exploration

Status: history — closed 2026-09-20. This is the assignment given to the designer on 23 August
2026 and the criteria the three directions were judged by. The direction it produced is
`docs/design-direction.md`, whose *Principles* section carries forward the parts of this brief
that still govern; everything else here — the hypotheses, the deliverables, the evaluation
criteria, the reference scenario — describes a stage that is over. Nothing here is edited any
more.

---

# Product design brief — Three concept directions

Status: exploration complete — direction selected 2026-08-23; see `docs/design-direction.md`. This
brief remains the record of the assignment and its evaluation criteria.

## Assignment

Create three meaningfully different product-design directions for the Agent Framework Capability
Lab's target Simulation Studio and Experiment Lab.

The directions must explore different information architectures, workflows, and visual hierarchies.
They must not be the same layout with different colors, typography, or decorative styles. Each
direction should make a distinct argument about how users understand and operate the product.

This is an exploration brief, not a request to produce the final design system. The outcome should
make it possible to select one direction, combine clearly identified strengths, and then develop the
complete product flow.

## Product summary

The application lets one user:

1. configure a realistic synthetic e-commerce platform;
2. create fictional customers and support identities;
3. author goal-based customer-support scenarios;
4. configure one or two support-agent implementations;
5. run both agents against isolated copies of the same starting state;
6. play the customer while conversations evolve independently; and
7. compare business outcomes, tool activity, traces, code paths, LLM-judge evidence, and efficiency
   metrics.

The product exists to make differences between agent frameworks and architectures observable. It is
not a customer-facing shop, a generic chatbot builder, or a global leaderboard.

The current application is a proof of concept. Designers should follow the target product described
here and in `docs/product-direction.md`, not copy the POC's persona-first navigation.

## Primary users

The initial product is local and single-user. One technical user may move between three roles:

- **Simulation author:** creates reusable shops, customers, support identities, scenarios, and agent
  configurations.
- **Experiment operator:** launches one or two runs and responds as the customer.
- **Reviewer:** interprets evidence, adds notes, searches history, and replays or forks experiments.

The user understands agent frameworks and software development but should not need to understand the
internal database model. The interface may use precise technical language such as tool call, trace,
token, framework, model, snapshot, and version.

## Design problem

The product combines three kinds of work that can easily become confusing:

- authoring a rich but synthetic commerce environment;
- operating a live conversational experiment; and
- reviewing technical and business evidence.

The design must help the user understand:

- whether they are editing a draft, viewing a published version, or inspecting an immutable run;
- which shop, customer, scenario, support identity, and agent configuration are in scope;
- what information was supplied directly and what the agent discovered through tools;
- which inputs are identical between experiment arms and where they diverged;
- whether an agent actually changed business state or only claimed success;
- which objectives passed, failed, or remain unevaluated;
- which evidence is deterministic, LLM-judged, or quantitative; and
- which observed differences can reasonably be attributed to framework, architecture, model, or
  human input.

## Core design principles

### Evidence before opinion

Show the conversation beside concrete evidence: tools, arguments, confirmations, state changes,
errors, traces, and objective results. Do not turn comparison into an unexplained score.

### Progressive technical depth

The main workflow should remain understandable without displaying every event at once. Let users
move from outcome to timeline to trace to project-owned source code without losing run context.

### Reproducibility is visible

Published versions, starting-state fingerprints, agent configuration, judge configuration, and
replay/fork relationships should be accessible and trustworthy without dominating every screen.

### Tool-first commerce environment

The support agent receives a customer message and minimal interaction references. Most shop,
product, variant, customer, order, review, FAQ, and policy information is obtained through tools.
The design must make tool discovery and tool-mediated actions legible.

### Honest comparison

Two arms begin from equivalent isolated snapshots. Later operator replies can diverge. The UI must
record and reveal this divergence rather than imply a perfectly controlled comparison after the
inputs differ.

### Extensible without feeling unbounded

The shop model will gain more fields over time. Editors should support optional sections, typed
custom attributes, and future capabilities without becoming one enormous form or an arbitrary JSON
editor.

## Product objects

Designs should use these meanings consistently:

- **Shop:** catalog, variants, media, reviews, payments, fulfilment, FAQ, policies, and guidelines.
- **Customer profile:** fictional personal facts, behavioral persona, addresses, account, orders,
  and support history.
- **Support identity:** role, tone, permissions, and operating guidance adopted by the agent.
- **Scenario:** setup actions, page/channel context, prior conversation, first message, hidden facts,
  objectives, constraints, faults, and completion conditions.
- **Agent configuration:** framework, architecture, model, prompt, tools, memory, support identity,
  and runtime settings.
- **Experiment:** immutable comparison record containing one or two runs.
- **Run:** one isolated conversation, sandbox state, events, metrics, and evaluations.

Authorable objects have mutable drafts and immutable published versions. Experiments reference exact
published versions.

## Reference scenario for every direction

Use the same content in all three concepts so the directions can be evaluated fairly.

### Shop

- Name: Northstar Outfitters
- Product: Alpine Shell Jacket
- Product variants: color `Ocean Blue` or `Charcoal`; size `S`, `M`, `L`, or `XL`
- Selected item: Ocean Blue, size M
- Order: `NS-10482`, paid, not yet shipped
- Policy: a shipping address can be changed before fulfilment after identity verification and
  explicit confirmation

### Customer

- Name: Maya Laurent
- Persona: frequent customer, direct, mildly anxious, wants a quick answer
- Current address: 18 rue des Écoles, Lyon
- Incorrect order address: a previous address in Bordeaux
- Prior interaction: asked whether payment succeeded and was told the order was confirmed

All details are synthetic. Interfaces should visibly reinforce that the environment contains
fictional test data.

### Trigger

The chat is initiated from the order-detail page. The first customer message is:

> I just noticed this is going to my old address. Can you change it before it ships?

The agent receives the message plus the order-page resource reference. It must use tools to retrieve
the order, customer, policy, and relevant state.

### Objectives

- Identify the correct order.
- Verify identity before revealing or changing protected information.
- Determine that the order remains eligible for an address change.
- Obtain confirmation for the exact new address.
- Change the address once, safely and idempotently.
- Explain the successful outcome clearly.

### Comparison arms

- Arm A: Agent configuration A
- Arm B: Agent configuration B
- Both begin with the same sandbox fingerprint and scenario trigger.
- Conversations may diverge after the first response.

Use realistic example differences: one agent asks a useful clarification before acting; the other
calls extra tools, uses more tokens, encounters a stale-order conflict, retries safely, and still
reaches the correct outcome.

## Three direction hypotheses

The designer may rename or challenge these hypotheses, but the final concepts must remain at least
this distinct.

### Direction A — Studio-first workbench

Treat reusable simulation definitions as the product's center of gravity. Emphasize structured
authoring, relationships, validation, version state, and confident publication. Experiments feel
like runs launched from carefully prepared assets.

Questions to explore:

- Can a dense configuration tool remain approachable as commerce data expands?
- How are related definitions and versions visible without constant navigation?
- How does the user move naturally from a published scenario into an experiment?

### Direction B — Experiment-first laboratory

Treat the controlled comparison as the center of gravity. Emphasize experiment setup, controlled
variables, split execution, event evidence, and result interpretation. Studio resources feel like
inputs selected or edited in support of a run.

Questions to explore:

- Can users understand the experiment before learning every authoring subsystem?
- How does the design expose confounding variables and input divergence?
- Can conversation, technical evidence, and business state coexist without becoming a dashboard of
  disconnected cards?

### Direction C — Scenario-first storyboard

Treat the customer incident as the organizing narrative. Emphasize a visual progression from given
state through setup actions, interaction context, conversation, objectives, and resolution. Shops,
customers, and agent configurations are reusable ingredients attached to that story.

Questions to explore:

- Can goal-based scenarios feel intuitive without implying a rigid scripted conversation?
- How are hidden facts, failures, branching conversation, and objective evidence represented?
- Does the story remain technically precise enough for framework analysis?

## Required workflows

Every direction must demonstrate the same end-to-end journey:

1. Find or create a shop draft.
2. Configure a product with size/color variants, images, price, availability, reviews, and custom
   attributes.
3. Publish the shop version.
4. Select a customer profile and support identity.
5. Author and validate the wrong-address scenario.
6. Preview the resolved initial state and interaction context.
7. Select two agent configurations and inspect controlled/different variables.
8. Start the experiment.
9. Observe the same first message reaching both agents.
10. Respond with the linked composer, then split replies after the conversations diverge.
11. Inspect tool calls, confirmations, failures, state changes, and objective progress.
12. Finish and compare deterministic, judge, and quantitative evidence.
13. Find the experiment in history and choose replay or fork.

## Required concept screens

For each direction, provide enough connected frames to understand the system rather than isolated
hero screens.

### High-fidelity key frames

1. **Shop/product editor:** product content, variants, media references, reviews, custom attributes,
   draft validation, and publication state.
2. **Scenario editor:** setup sequence, entry context, initial message/history, hidden facts,
   objectives, faults, and resolved-state preview.
3. **Live experiment:** two conversations, linked/split customer input, tool activity, confirmations,
   run status, and objective progress.
4. **Experiment results:** business-state outcome, deterministic objectives, blinded judge evidence,
   turns/tokens/latency/tool metrics, divergence, and trace/code drill-down entry points.

### Supporting frames or wireframes

- global navigation or workspace home;
- experiment setup and comparison-variable review;
- searchable experiment history; and
- a narrow-window treatment of the live comparison.

Do not design a customer-facing storefront. A small product-page or order-page preview inside the
Studio is acceptable when it explains the interaction origin.

## States that must be considered

- new/empty workspace;
- draft with validation errors;
- published immutable version and “create new draft” action;
- loading or unavailable tool;
- tool call in progress, success, refusal, validation error, retry, and conflict;
- exact-action confirmation;
- linked customer input and intentionally split input;
- one arm waiting while the other is running or finished;
- deterministic objective passed, failed, pending, or not applicable;
- LLM judge queued, running, completed, failed, and rerun;
- historical experiment viewed with newer definition versions now available; and
- unsupported agent capability.

The concept does not need a polished frame for every state, but its interaction model must explain
where and how these states appear.

## Evidence hierarchy

The results experience must keep these layers distinct:

1. **Deterministic:** final state, required/forbidden events, policy, authorization, confirmation,
   idempotency, and completion.
2. **LLM judge:** dimension-level structured evaluation and rationale, with visible judge model,
   prompt/rubric version, status, and rerun history.
3. **Quantitative:** turns, input/output tokens, model and tool calls, latency, retries, failures, and
   estimated cost when available.

Efficiency is meaningful only beside a successful outcome. Avoid visual language that declares the
lowest token count or shortest conversation the winner by default.

## Execution and code evidence

The product should let reviewers move from a visible event to:

- the resolved agent configuration;
- a normalized execution timeline;
- trace details; and
- the relevant project-owned adapter or use-case source location/excerpt.

The designer should show the entry point and navigation model for this depth. A complete code browser
or framework-internal debugger is not required in the concept phase.

## Visual and interaction constraints

- Desktop is the primary environment because live comparison needs horizontal space.
- The interface must remain usable at narrower desktop/tablet widths; define when side-by-side arms
  stack, tab, or otherwise adapt without hiding that two runs exist.
- Target WCAG 2.2 AA contrast and keyboard-accessible workflows.
- Do not rely on color alone for run, objective, or difference status.
- Dense technical information is acceptable when hierarchy and progressive disclosure remain clear.
- Avoid decorative dashboard metrics, oversized status cards, and visual scoring without evidence.
- Use realistic content and data rather than lorem ipsum.
- The likely implementation remains React, Tailwind, shadcn/ui, and assistant-ui, but concepts may
  propose interactions beyond current POC components when they materially improve the product.

## Stage-one deliverables

For each of the three directions, provide:

- a concise concept statement and design principles;
- an information-architecture/navigation diagram;
- the four high-fidelity key frames;
- supporting workflow frames sufficient to connect the end-to-end journey;
- a narrow-width treatment of the live comparison;
- the proposed evidence hierarchy and progressive-disclosure behavior;
- representative typography, color, spacing, and component language; and
- explicit strengths, risks, and implementation implications.

Also provide one comparison page explaining how the directions differ in:

- organizing metaphor and primary navigation;
- authoring workflow;
- live experiment operation;
- evidence density and technical depth;
- scalability as commerce attributes and scenario capabilities grow; and
- expected implementation complexity.

A fully clickable prototype and complete component library are not required until one direction is
selected.

## Evaluation criteria

The product team will evaluate each direction by asking:

- Can a new technical user explain the product's purpose after seeing the first screen?
- Can the user tell draft, published version, sandbox snapshot, and historical run apart?
- Can they configure rich commerce data without facing an unstructured mega-form?
- Can they understand what “this product” or “this order” refers to and what the agent learned via
  tools?
- Can they identify the controlled variable and any confounding differences before launch?
- Can they operate two diverging conversations without losing customer or run context?
- Can they verify actual business state rather than trusting the assistant's wording?
- Can they distinguish deterministic, judge, and quantitative evidence?
- Can they reach traces and code evidence when deeper framework analysis is needed?
- Can the design expand to future tools, attributes, scenarios, architectures, and a customer
  simulator without changing its basic mental model?

## Non-goals for this exploration

- Customer-facing storefront design.
- Marketing website or public landing page.
- Mobile-first live experiment operation.
- Multi-user administration, permissions, billing, or deployment management.
- Autonomous customer-simulator interface.
- Final brand identity or production-ready design system.
- A global framework score or leaderboard.

## Source material

- `docs/product-direction.md`: authoritative product scope and journey.
- `docs/architecture.md`: current POC versus target technical boundaries.
- `docs/PLAN.md`: phased implementation roadmap.
- `docs/adr/0011-simulation-studio-and-experiment-model.md`: accepted direction and consequences.
- The running application may be inspected for reusable interaction details, but its information
  architecture should not constrain the three directions.
