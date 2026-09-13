import type { GlossaryTermId } from "./glossary";

/**
 * The chain from an empty database to a two-arm comparison: what its steps are, and in what
 * order they refuse.
 *
 * This is the half of the path that holds without a record to read — the label, the surface the
 * work is done on, and the vocabulary the step speaks — and it is what each surface's *Show me
 * around* tour opens with. The derived reading that once decorated it with what a lab already
 * satisfied was removed with the guide strip; nothing in the application now projects progress
 * from the listings, and no page walks all ten steps in one place (ADR 0045, ADR 0049).
 */

export type SetupStepId =
  | "shop"
  | "customer"
  | "order"
  | "ticket"
  | "blocks"
  | "scenario"
  | "support-identity"
  | "agent-configurations"
  | "judge"
  | "experiment";

/**
 * One step of the chain: what it is called, where it is done, and the vocabulary it speaks.
 *
 * One table, so that the chain's order and the chain's words have a single home and a step
 * added here without a tour claiming it fails the sweep that reads this table.
 */
export interface SetupStepShape {
  id: SetupStepId;
  /** The word the guide's heading shows. */
  label: string;
  /** The surface the work is done on, relative to a shop. Empty for the shop's own home. */
  surface: string;
  /** What a link to that surface is called, so a reader is never sent to one place under two names. */
  linkLabel: string;
  /**
   * Whether the step ends in a published version. Eight of the ten do; the order fixture is
   * authored rather than published, and the experiment is a record rather than a definition.
   */
  publishes: boolean;
  /** The vocabulary this step's sentences use, defined in `glossary.ts`. */
  terms: readonly GlossaryTermId[];
}

/**
 * The chain, in dependency order: nearly every one of these refuses until the one before it is
 * satisfied.
 */
export const SETUP_CHAIN = [
  {
    id: "shop",
    label: "Shop",
    surface: "",
    linkLabel: "Open the shop's home",
    publishes: true,
    terms: ["shop", "definition"],
  },
  {
    id: "customer",
    label: "Customer",
    surface: "customers",
    linkLabel: "Open customers",
    publishes: true,
    terms: ["customer-profile", "ticket"],
  },
  {
    id: "order",
    label: "Order",
    surface: "orders",
    linkLabel: "Open orders",
    publishes: false,
    terms: ["order", "sandbox-snapshot"],
  },
  {
    id: "ticket",
    label: "Ticket",
    surface: "tickets",
    linkLabel: "Open tickets",
    publishes: true,
    terms: ["ticket"],
  },
  {
    id: "blocks",
    label: "Blocks",
    surface: "objective-blocks",
    linkLabel: "Open objective blocks",
    publishes: true,
    terms: ["objective-block", "mutation-block", "scenario"],
  },
  {
    id: "scenario",
    label: "Scenario",
    surface: "scenarios",
    linkLabel: "Open scenarios",
    publishes: true,
    terms: ["scenario", "objective-block", "mutation-block"],
  },
  {
    id: "support-identity",
    label: "Support identity",
    surface: "support-identities",
    linkLabel: "Open support identities",
    publishes: true,
    terms: ["support-identity", "shop"],
  },
  {
    id: "agent-configurations",
    label: "Agent configurations",
    surface: "agent-configurations",
    linkLabel: "Open agent configurations",
    publishes: true,
    terms: ["agent-configuration", "support-identity", "run"],
  },
  {
    id: "judge",
    label: "Judge",
    surface: "judges",
    linkLabel: "Open judges",
    publishes: true,
    terms: ["judge-configuration", "evaluation", "objective-block"],
  },
  {
    id: "experiment",
    label: "Experiment",
    surface: "bench",
    linkLabel: "Open the bench",
    publishes: false,
    terms: ["experiment", "sandbox-snapshot", "participant-driver"],
  },
] as const satisfies readonly SetupStepShape[];

/**
 * The route a step's work is done on, inside one shop.
 *
 * One composition of the path, so a tour that names a step and the sweep that reaches it agree
 * on the surface the chain actually names.
 */
export function stepHref(step: SetupStepShape, shopId: string): string {
  const base = `/shops/${shopId}`;
  return step.surface === "" ? base : `${base}/${step.surface}`;
}

/**
 * What each step of the chain is, and the gate standing between it and the next.
 *
 * Here rather than beside a page that listed it, because no page lists it any more (ADR 0049).
 * A tour on any one of those ten surfaces reads that step's own `gate` to say what stays
 * refused until the work there is done. One table means two popovers cannot come to disagree
 * about it.
 */
export interface StepCopy {
  /** What this link of the chain is, in `[[term-id]]` markup. */
  body: readonly string[];
  /** The gate standing between this step and the next — the reason the order is an order. */
  gate: string;
}

/**
 * Exported so the same test that reads the tours' vocabulary reads this table's, since a term
 * here resolving to nothing would render as a bare word exactly as it would there.
 */
export const SETUP_GUIDE_STEPS: Record<SetupStepId, StepCopy> = {
  shop: {
    body: [
      "A [[shop]] is the synthetic commerce platform an incident happens inside: the catalog, the policies and FAQ the agent reaches through tools, the payment and fulfilment methods an order can use, and the named tone-of-voice guidelines it answers in. Nothing else in this chain exists outside one — every later step is either authored in a shop or published against one.",
      "The shop's home lists whatever its publish gate is still refusing, and those words are the gate's own rather than a second opinion. Publishing freezes the draft as version 1; the draft stays yours to keep editing, and nothing that pinned v1 moves when you do.",
      "If you have no name in mind, the create form offers “Use an example shop”, which fills its four fields with a ready-made identity you can edit before creating. It is a convenience on the first step only: the shop it makes is the same empty draft as one you typed, and every gate below applies to it unchanged.",
    ],
    gate: "Until a shop has one published version, a ticket cannot be published against it.",
  },
  customer: {
    body: [
      "A [[customer-profile|customer profile]] is a fictional person — identity, behaviour, account state, and a named address book with one default entry. Attach one to the shop and publish it.",
      "Publication matters more here than it looks: a ticket pins the customer version it was written against, so the person who complained stays the person the record says complained, however the profile is edited afterwards.",
    ],
    gate: "A ticket can only name a profile that is attached to its shop and published.",
  },
  order: {
    body: [
      "The [[order|order fixture]] is the commerce state the incident is about: line items, payment and fulfilment status, the authored events that got it there, and a shipping address selected from the customer's address book and stored as a frozen copy labelled with where it came from.",
      "It is the only definition in this chain with no version of its own. A recipe names the order rather than freezing it, and the copy is taken later, when a [[sandbox-snapshot|snapshot]] is materialized — so an order edited after the recipe is published changes the starting state of the next run.",
    ],
    gate: "A scenario binds its objectives to this shop's own orders, and a starting state copies the one the recipe named.",
  },
  ticket: {
    body: [
      "A [[ticket]] is the incident as it arrives: the channel, the page it was opened from, whatever was said before, and the triggering first message. Every [[run|arm]] of every experiment built on this ticket opens on that message, which is what makes two agents answer the same question rather than two similar ones.",
      "Publishing it pins the shop version and the customer version it was authored against.",
    ],
    gate: "A scenario is built on one published ticket and cannot be composed without one.",
  },
  blocks: {
    body: [
      "Two libraries, shared across every shop rather than owned by this one. [[objective-block|Objective blocks]] are what an experiment asserts; [[mutation-block|mutation blocks]] are what goes wrong in the middle of it. Both are parameterized templates rather than statements about your shop — a [[scenario]] binds their parameters to its own shop's objects and pins the template version it composed.",
      "Publish at least one objective: a recipe with nothing to decide decides nothing. A fault is optional, and a recipe with none is simply an incident where nothing interrupts.",
    ],
    gate: "A scenario can only bind a template that has a published version.",
  },
  scenario: {
    body: [
      "The [[scenario]] is the experiment recipe, and it is deliberately not a conversation script. Composed on the published ticket, it adds the hidden facts only you can see, the context documents the agent may find through tools, the objective and mutation bindings, and the conditions — including a turn cap — that end a run.",
      "Publishing it freezes the recipe and pins every version it reaches: the ticket, the shop, each block template. Its starting-states page then materializes a [[sandbox-snapshot|snapshot]], which is the world both arms will begin in.",
    ],
    gate: "An experiment pins one published scenario version; a draft cannot be run.",
  },
  "support-identity": {
    body: [
      "A [[support-identity|support identity]] is the role the agent under test adopts: its seniority, what it is permitted to do, and its operating guidance. It is not the voice — that belongs to the shop, so that two agents compared in the same shop cannot accidentally differ in how they sound.",
      "Like the block libraries it is shop-independent, and like everything else it is published, because an agent configuration adopts a version of it and its permissions are what authorize the writes that agent's tools may make.",
    ],
    gate: "An agent configuration's enabled tools are checked against the identity it adopts.",
  },
  "agent-configurations": {
    body: [
      "An [[agent-configuration|agent configuration]] is one agent under test, published as a version like everything else: framework, architecture, model, prompt template, tool bindings, memory, runtime settings, and the support identity it adopts.",
      "Publish two. A comparison is only attributable if they differ in one dimension — the framework, the architecture, or the configuration — and the lab warns when an experiment's arms differ in more than one, because a run that moved two things cannot tell you which one moved the result.",
    ],
    gate: "A two-arm experiment needs two published configurations to bind.",
  },
  judge: {
    body: [
      "A [[judge-configuration|judge configuration]] is the versioned rubric, the model that reads it, and the declared list of what that model is shown. It fills the rows no rule can decide — whether the explanation was correct, clear, and actually resolved the request.",
      "It reads one arm at a time, from an anonymized brief that names no framework, provider or model, and it never overwrites the [[evaluation|deterministic evidence]] standing beside it.",
    ],
    gate: "Objectives a scenario left to a judge stay deferred until a scoring pass is run from the bench with a published judge.",
  },
  experiment: {
    body: [
      "Start the [[experiment]] from the bench. Starting one freezes a [[sandbox-snapshot|starting state]] from the recipe version and the seed it is given, clones that into one arm per configuration, opens both threads on the ticket's triggering message, and hands you the composer — you are the [[participant-driver|participant driver]], so the customer's later turns are yours.",
      "Advance each arm, answer as the customer, and let any bound fault fire. When both arms have finished, the results screen reads them objective by objective, arm beside arm, with no aggregate score anywhere.",
    ],
    gate: "The setup gate refuses an experiment whose inputs are not all published, and warns when its two arms differ in more than one dimension.",
  },
};

export interface ChainPlacement {
  /** Which link of the chain this is, counting from one. */
  position: number;
  total: number;
  /** The step's own label, so a reader is told what they arrived at and not only where. */
  label: string;
  /** The step before this one and the step after it, for orientation. Null at each end. */
  after: string | null;
  before: string | null;
  /** The gate this step closes: what stays refused until the work here is done. */
  unlocks: string;
}

/**
 * Where a surface sits in the chain, composed from the two tables that already answer it.
 *
 * Nothing here is written down a second time. The position and the labels are the chain's, the
 * gate sentence is this table's, and a tour that shows them is showing these words — so the
 * reading an operator gets standing on a surface cannot drift from the table the sweep reads.
 *
 * Only the step's *own* gate is used. `gate` is what a step unlocks rather than what the next
 * one needs, and the two are not the same sentence: the shop's gate is about publishing a
 * ticket, which is three links further down. Pairing them up would have produced a confident
 * sentence that was wrong on most of the chain.
 */
export function chainPlacement(id: SetupStepId): ChainPlacement {
  const position = SETUP_CHAIN.findIndex((step) => step.id === id);
  /* v8 ignore next 3 -- unreachable: SetupStepId is the chain's own key, so the lookup holds */
  if (position < 0) {
    throw new Error(`${id} is not a step of the setup chain`);
  }
  return {
    position: position + 1,
    total: SETUP_CHAIN.length,
    label: SETUP_CHAIN[position].label,
    after: SETUP_CHAIN[position - 1]?.label ?? null,
    before: SETUP_CHAIN[position + 1]?.label ?? null,
    unlocks: SETUP_GUIDE_STEPS[id].gate,
  };
}
