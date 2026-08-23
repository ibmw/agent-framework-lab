# Product direction — Simulation Studio and Experiment Lab

Status: approved product direction — 2026-08-23

This document is the product source of truth for future work. The running application is a useful
proof of concept, but its persona-first workflow and hard-coded scenario model are not the target
product. Read this document before extending the domain, public contracts, persistence, frontend,
or agent adapters.

The model revisions recorded in `docs/design-direction.md` (2026-08-23) — first-class shop-scoped
tickets, shared versioned objective/mutation block templates, the customer address book with
frozen source-labeled order copies, and shop-level tone-of-voice guidelines — are formalized by
ADR 0012 and reflected throughout this document.

## Purpose

Build a controlled customer-support simulation lab that can:

1. configure a realistic synthetic e-commerce environment;
2. author goal-based customer-support scenarios;
3. execute one or two agent implementations against isolated copies of the same starting state;
4. expose framework behavior through conversations, tool activity, traces, code paths, and state
   changes; and
5. evaluate each run with deterministic evidence, a versioned LLM judge, and quantitative metrics.

The product compares agent frameworks and agent architectures in the same environment. It is not a
general e-commerce platform, a customer-facing storefront, or a single aggregate leaderboard.

## Users and primary workflows

One person may perform all three roles in the initial local application:

- **Simulation author:** creates shops, synthetic customers, support identities, and scenarios.
- **Experiment operator:** selects up to two agent variants, launches a scenario, and plays the
  customer during the conversation.
- **Reviewer:** compares evidence, adds notes, searches historical experiments, and replays or forks
  a previous setup.

The primary navigation should eventually reflect these workflows:

- **Studio:** shops, customers, support identities, scenarios, and agent configurations;
- **Bench:** new experiment and live split-view execution; and
- **History:** experiment search, comparison, evidence, replay, and fork.

## Core product model

The target model separates concepts that the POC currently combines:

- **Shop:** the configurable synthetic commerce platform, including catalog, policies, FAQ,
  payments, fulfilment, support content, and named tone-of-voice guidelines with one shop default.
- **Customer:** synthetic personal information, behavioral persona, account state, a named address
  book with one default entry, commerce history, and past support interactions. Orders select an
  address-book entry and store a frozen, source-labeled copy; address-book edits never rewrite
  existing orders, published scenarios, or snapshots.
- **Support identity:** the role, seniority, permissions, and operating guidance adopted by the
  support agent under test; tone of voice comes from the shop's guidelines.
- **Ticket:** the versioned support-incident record scoped to one shop and one customer: channel,
  origin references, prior message history, and the triggering first message.
- **Scenario:** the experiment recipe built on one ticket and its linked same-shop objects, adding
  hidden facts, context documents, bound objective and mutation blocks, constraints, and
  completion conditions. Objective and mutation blocks are shared, versioned, parameterized,
  shop-independent templates whose scenario bindings stay same-shop.
- **Agent configuration:** framework, model, support identity, system prompt, tools, memory,
  architecture, and runtime settings.
- **Experiment:** an immutable execution record that binds one scenario to one or two agent
  configurations and records the controlled comparison.
- **Run:** one isolated experiment arm containing its conversation, tool events, state changes,
  traces, quantitative measurements, and evaluation results.
- **Sandbox snapshot:** the complete starting state cloned for each run. Comparable arms must have
  the same canonical starting-state fingerprint while retaining independent mutable state.

These are conceptual boundaries, not a mandate to preserve or introduce specific class names. The
domain design may replace POC entities when a cohesive migration slice proves the new model.

## Drafts, published versions, and reproducibility

Shops, customer profiles, support identities, scenarios, and agent configurations have editable
drafts. Publishing creates an immutable version. An experiment references exact published versions
and stores the resolved execution configuration needed to explain and replay the run.

Every experiment must record at least:

- all referenced definition IDs and versions;
- the canonical sandbox schema version and initial-state fingerprint;
- scenario setup inputs and any seed used for synthetic generation;
- tool-contract versions;
- framework, architecture, model, prompt, and runtime configuration versions;
- participant-driver type and the operator inputs sent to each arm;
- evaluator and rubric versions; and
- trace and evaluation references.

Adding data or functionality must not make historical experiments unreadable. A replay uses the
historical definitions; a fork creates a new experiment with explicitly selected newer versions.

## Extensible e-commerce environment

V1 may expose a bounded set of fields, but the architecture must support a substantially richer
commerce model without turning every new catalog field into a redesign.

The intended product model includes:

- shop identity, locale, currencies, channels, and support configuration;
- products with title, descriptions, status, category, media, and ratings;
- option definitions such as size and color;
- sellable variants with option values, SKU, price, availability, and inventory facts;
- customer reviews and comments;
- category-specific typed attributes;
- payment methods and payment state;
- fulfilment, shipment, cancellation, return, exchange, and refund state;
- FAQ, detailed policies, and support guidelines; and
- customer accounts, addresses, orders, and support history.

Use a hybrid extensibility strategy:

- model behaviorally important concepts and invariants with typed domain objects;
- allow administrators to define typed attributes such as text, number, boolean, choice, and
  measurement; and
- reserve versioned extension blocks for non-critical metadata.

Do not represent the entire commerce domain as unvalidated JSON or use an unrestricted
entity-attribute-value model for core business rules. V1 media stores URL/reference metadata;
managed binary upload and storage are deferred.

There is no customer-facing storefront in V1. The Studio provides configuration forms and useful
previews of product and support content.

## Tool-first agent environment

The simulated commerce platform is the source of truth. Most shop, product, customer, order,
review, FAQ, and policy information reaches the support agent through framework-neutral, versioned
tool calls.

The direct agent request contains the user's message plus only the minimum interaction envelope
required to resolve references. For example, a chat opened from a product page can include the
channel, origin type, product reference, selected variant reference, locale, and sandbox/session
scope. The product title, variants, availability, reviews, and policies are retrieved through tools.

The governing rule is:

> Interaction context supplies references; tools supply commerce facts and perform commerce
> actions.

Tool families will grow with scenarios and may include:

- interaction-context and product/catalog reads;
- customer, order, payment, shipment, and support-history reads;
- FAQ and policy search;
- inventory and variant availability;
- address, cancellation, return, exchange, refund, and escalation proposals/actions; and
- fault-injection or clock controls available only to the scenario runtime, never to the support
  agent.

Tools are scoped to a run's sandbox and authorization context. An agent must not gain arbitrary
cross-customer access by supplying an identifier. Modifying actions remain confirmed, idempotent,
validated, and concurrency-safe. Critical safety and commerce rules are enforced in the backend
even when the model misunderstands a retrieved policy.

Both comparison arms receive equivalent contracts and deterministic tool responses for equivalent
starting state and requests. Tool selection, arguments, ordering, parallelism, retries, failures,
and state effects are experiment evidence.

## Scenario model

Scenarios are goal-based rather than rigid conversation scripts. A scenario version builds on one
published ticket — which carries the channel, interaction origin references (product page, order
page, checkout, FAQ, or generic support entry), prior message history, and the triggering first
message — and adds:

- setup actions that create the incident;
- hidden facts visible only to the human or future customer simulator;
- context documents (policies, support guidelines, FAQ entries) the agent can reach through tools,
  with document-read objectives recording whether each arm consulted them;
- bound objective blocks: shared versioned templates bound to same-shop objects with a severity,
  covering deterministic objectives and forbidden outcomes;
- policy and safety constraints;
- bound mutation blocks for failures, time advances, or concurrent mutations, applied by the
  scenario runtime in timeline order and never visible to the support agent; and
- completion conditions.

Publishing a scenario pins the exact ticket, block template, and shop versions it was authored
against. Objective order is display priority only; a scenario never implies a scripted
conversation.

The first complete vertical scenario is a paid order using the wrong shipping address. It should
exercise contextual product/order discovery, identity and eligibility rules, a safe address-change
action, confirmation, conflict handling, and a clear customer-facing resolution.

Future scenarios can cover order status, cancellation, damaged delivery, return/refund, exchange,
payment failure, privacy, escalation, transient dependencies, and multi-agent handoffs.

## Participant drivers and future simulation

Conversation input depends on a framework-neutral participant-driver port:

- a human operator drives the customer in V1;
- a future LLM customer driver uses the same customer persona, hidden scenario facts, and observed
  conversation; and
- a scripted driver may provide deterministic regression evidence.

The participant driver must remain separate from the support-agent framework being compared. The
initial architecture must preserve this seam even though only the human driver is delivered first.

## Controlled experiments and split-view operation

An experiment has one or two arms. Two-arm comparisons should ideally change one primary dimension:

- framework with equivalent architecture and configuration;
- architecture with the same framework and model; or
- configuration with the same framework and architecture.

The application warns about additional differences because they confound attribution, but it does
not prevent deliberate exploratory comparisons.

Each agent configuration references the support identity it adopts. A framework comparison should
normally use the same support identity and authority in both arms; changing the support identity is
itself a configuration comparison and must be reported as the primary or an additional variable.

Starting an experiment clones the same sandbox snapshot into each arm. The scenario's first message
is sent to both. The operator initially has a linked composer and can send the same customer input
to both arms. When conversations diverge, the operator can respond separately; the run records the
point and content of input divergence so later comparisons remain interpretable.

The live view exposes conversation output, tool calls, confirmations, state changes, failures, and
objective progress. Each arm can pause or finish independently.

## Evaluation and comparison

Evaluation has three separate evidence layers.

### Deterministic evidence

- final sandbox-state assertions;
- required and forbidden tool/event assertions;
- tool argument and ordering checks;
- authorization, confirmation, idempotency, and policy checks; and
- completion conditions and explicit business outcomes.

### LLM judge evidence

A configurable judge evaluates qualities that deterministic rules cannot fully capture, such as
correctness of the explanation, clarity, empathy, and whether the response meaningfully resolved
the customer's request.

Every judge execution records its model, prompt, rubric, input fingerprint, output, and timestamp.
The judge receives anonymized arms without framework labels, returns structured dimension-level
results with a rationale, is rerunnable, and never overwrites deterministic evidence.

### Quantitative evidence

Record turns, input/output tokens, model calls, tool calls, latency, retries, failures, and estimated
cost when available. Efficiency is interpreted only alongside successful outcomes. These metrics
can be influenced by the model, provider, prompt, and operator as well as the framework, so the UI
must present them as observations rather than universal framework quality scores.

Comparison is objective-by-objective and evidence-backed. Do not produce a single aggregate
framework leaderboard.

## Execution and code evidence

To explain how each framework operates, a run should eventually connect three views:

- the resolved agent configuration;
- a normalized execution timeline of model, tool, validation, retry, state, and trace events; and
- project-owned source locations or small excerpts corresponding to executed adapter and use-case
  functions.

Do not maintain manually simplified pseudo-code that can silently drift from the implementation.
Framework-internal source visualization is deferred; project-owned integration code is sufficient
for the first useful comparison.

## History

History is experiment-first rather than persona- or conversation-first. It supports filtering by
date, status, shop, scenario, customer persona, framework, agent architecture/configuration, model,
objective outcome, failed capability, one/two-arm mode, tags, and notes.

An experiment detail preserves both conversations, input divergence, configuration, fingerprints,
state diffs, tool events, traces, evaluator executions, metrics, and replay/fork actions.

## V1 product boundary

V1 proves one complete wrong-shipping-address journey:

1. configure and publish a shop with a limited but extensible catalog and support knowledge;
2. configure and publish a synthetic customer and support identity;
3. author and publish the ticket, then author, validate, preview, and publish the scenario built
   on it;
4. configure one or two agent variants;
5. run isolated arms through the human-operated split view;
6. evaluate deterministic objectives, execute an LLM judge, and collect quantitative metrics; and
7. inspect and filter the historical experiment.

V1 does not require a customer-facing storefront, autonomous customer agent, managed image upload,
external commerce integration, multi-user tenancy, global leaderboard, or every possible commerce
action.

## Relationship to the POC

The current application proves useful technical ideas: clean dependency boundaries, a common agent
port, versioned contracts, deterministic fingerprints, durable conversations, safe modifying
actions, and sanitized tracing. Preserve those principles unless a later ADR deliberately changes
them.

The current hard-coded `ScenarioDefinition`, generated persona flow, and minimal catalog/order model
are POC implementations, not target constraints; the persona-first navigation and conversation-level
comparison view were removed with the Studio shell (ADR 0013). They may be replaced through cohesive, tested slices. Existing local POC data does not
require backward compatibility; migrations must still behave safely and predictably for supported
repository states.
