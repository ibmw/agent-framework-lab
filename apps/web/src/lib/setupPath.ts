import type { GlossaryTermId } from "./glossary";

/**
 * The chain from an empty database to a two-arm comparison: what its steps are, and in what
 * order they refuse.
 *
 * This is the half of the path that holds without a record to read — the label, the surface the
 * work is done on, and the vocabulary the step speaks — and it is what the written setup guide
 * at `/guides/setup` walks. The derived reading that once decorated it with what a lab already
 * satisfied was removed with the guide strip; nothing in the application now projects progress
 * from the listings, and `/guides/setup` says what the ten steps are rather than which of them
 * this lab has reached (ADR 0045).
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
 * One table, so that the guide's order and the guide's words have a single home and a step
 * added here without copy on the page fails to compile.
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
 * One composition of the path, read by the written guide's links, so the guide sends a reader to
 * the surface the chain actually names.
 */
export function stepHref(step: SetupStepShape, shopId: string): string {
  const base = `/shops/${shopId}`;
  return step.surface === "" ? base : `${base}/${step.surface}`;
}
