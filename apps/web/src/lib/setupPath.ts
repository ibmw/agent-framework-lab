import type {
  AgentConfigurationSummarySchema,
  BlockSummarySchema,
  CustomerProfileSummarySchema,
  ExperimentHistoryEntrySchema,
  JudgeConfigurationSummarySchema,
  OrderSummarySchema,
  ScenarioSummarySchema,
  ShopSummarySchema,
  SupportIdentitySummarySchema,
  TicketSummarySchema,
} from "@agent-lab/contracts";
import type { PublishGate } from "../components/WorkspaceChrome";
import type { GlossaryTermId } from "./glossary";

/**
 * The path from an empty database to a two-arm comparison, read off the record.
 *
 * Nothing here is stored and nothing is written when a step completes. A step is complete
 * because the thing it asks for exists in a listing the product already serves, which is why
 * the same reading holds for a database filled by hand, filled in a different order, or
 * filled by `make seed` — and why deleting something afterwards uncompletes its step without
 * anything having to be reconciled (ADR 0044).
 *
 * Publication is additive, so a step stays complete once a published version exists even
 * while the draft beside it moves on: what an experiment would pin is the published version,
 * and it is still there.
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

/** Where the work is done. The strip links to it and never performs it. */
export interface SetupAction {
  /** The one action that unblocks the chain, as a sentence. */
  headline: string;
  /** What the step is for, when naming it is not enough. */
  body?: string;
  /**
   * A command to run in a terminal, where the product deliberately refuses a route. The strip
   * renders it as text: a band that could populate the lab would be the seed route ADR 0043
   * refused, returning as a convenience.
   */
  command?: string;
  href: string | null;
  linkLabel: string | null;
}

/**
 * One step of the chain, independent of any record: what it is called, where it is done, and
 * the vocabulary it speaks.
 *
 * This is the half of a step that a surface with nothing to read can still say — which is what
 * the written setup guide needs, since it is read outside shop scope and often before the
 * database holds anything at all. It is deliberately the same table `deriveSetupPath` builds
 * its readings from, so the guide and the strip cannot disagree about what the chain is or what
 * order it comes in.
 */
export interface SetupStepShape {
  id: SetupStepId;
  /** The word the chain row shows. */
  label: string;
  /** The surface the work is done on, relative to a shop. Empty for the shop's own home. */
  surface: string;
  /**
   * What a link to that surface is called. The strip overrides it for the shop step, whose
   * action follows the publish gate's first finding onto a shop-setup page instead; every
   * other reading of the chain — the strip's and the guide's — uses this one, so a reader is
   * never sent to the same place under two names.
   */
  linkLabel: string;
  /**
   * Whether the step ends in a published version. Eight of the ten do; the order fixture is
   * authored rather than published, and the experiment is a record rather than a definition.
   */
  publishes: boolean;
  /** The vocabulary this step's sentences use, defined in `glossary.ts`. */
  terms: readonly GlossaryTermId[];
}

export interface SetupStep extends SetupStepShape {
  complete: boolean;
  action: SetupAction;
}

/**
 * The chain, in dependency order: nearly every one of these refuses until the one before it is
 * satisfied.
 *
 * One list, read twice — by the strip, which decorates it with what the record satisfies, and
 * by the setup guide, which walks it for a reader who has nothing to read yet.
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
 * One composition of the path, read by the strip's actions and by the written guide's links,
 * so the two cannot send a reader to two different places for one step.
 */
export function stepHref(step: SetupStepShape, shopId: string): string {
  const base = `/shops/${shopId}`;
  return step.surface === "" ? base : `${base}/${step.surface}`;
}

/**
 * The chain's entry for one step, by identifier.
 *
 * The readings below spread it rather than restating a label, a surface or a term, so the
 * table above is the only place the chain is written down.
 */
function shape(id: SetupStepId): SetupStepShape {
  const found = SETUP_CHAIN.find((step) => step.id === id);
  if (found === undefined) {
    throw new Error(`the setup chain has no step called ${id}`);
  }
  return found;
}

export interface SetupPath {
  /**
   * Whether a shop was in scope. The order, ticket, and scenario steps are shop-scoped, so a
   * surface outside a shop can read the first step and no more — and says so rather than
   * drawing nine steps it did not check.
   */
  scoped: boolean;
  steps: SetupStep[];
  /** The first step nothing in the record satisfies. */
  nextStep: SetupStep | null;
  complete: boolean;
  /** The most recent experiment, when the record holds one. */
  latestExperiment: ExperimentHistoryEntrySchema | null;
}

/** The shop the path is read inside, and its own publish gate where the host computes one. */
export interface ScopedShop {
  shopId: string;
  name: string;
  /**
   * The gate the authoring surface renders. The strip shows its findings rather than a second
   * explanation of why a shop cannot be published, and reads the published version from it so
   * publishing advances the step without a second request.
   */
  gate: PublishGate | null;
  dirty: boolean;
  /** Used when no gate is in hand, from the shops listing. */
  latestPublishedVersion: number | null;
}

export interface SetupListings {
  shops: ShopSummarySchema[];
  shop: ScopedShop | null;
  profiles: CustomerProfileSummarySchema[];
  orders: OrderSummarySchema[];
  tickets: TicketSummarySchema[];
  objectiveBlocks: BlockSummarySchema[];
  scenarios: ScenarioSummarySchema[];
  supportIdentities: SupportIdentitySummarySchema[];
  agentConfigurations: AgentConfigurationSummarySchema[];
  judges: JudgeConfigurationSummarySchema[];
  /** The most recent page of the history listing, and how many rows it holds in total. */
  experiments: ExperimentHistoryEntrySchema[];
  experimentCount: number;
}

function published<T extends { latest_published_version: number | null }>(entries: T[]): T[] {
  return entries.filter((entry) => entry.latest_published_version !== null);
}

/**
 * The shop-setup surface a publish-gate finding is authored on.
 *
 * This maps a path to a route and nothing else: the words stay the gate's. A finding whose
 * path this does not know sends the reader to the shop's home, where the same gate is
 * rendered in full beside the publish control.
 */
function shopIssueSurface(issuePath: string, shopId: string): { href: string; linkLabel: string } {
  const root = issuePath.split(/[.[]/, 1)[0];
  const base = `/shops/${shopId}`;
  switch (root) {
    case "products":
      return { href: `${base}/products`, linkLabel: "Open products" };
    case "tone_of_voice_guidelines":
    case "default_tone_of_voice_id":
      return { href: `${base}/setup/tone`, linkLabel: "Open tone of voice" };
    case "policies":
    case "faq":
      return { href: `${base}/setup/policies`, linkLabel: "Open policies & FAQ" };
    case "support_guidelines":
      return { href: `${base}/setup/support`, linkLabel: "Open support guidelines" };
    case "payment_methods":
    case "fulfilment_methods":
    case "identity":
      return { href: `${base}/setup/identity`, linkLabel: "Open shop details" };
    default:
      return { href: base, linkLabel: "Open the shop's home" };
  }
}

/** The first step, read from a surface that has no shop in scope. */
function unscopedShopStep(shops: ShopSummarySchema[]): SetupStep {
  const action: SetupAction =
    shops.length === 0
      ? {
          headline: "Create a shop — every other definition is authored inside one",
          body: "Ten steps end in a two-arm comparison, and each one refuses until the one before it is satisfied.",
          command: "make seed",
          href: "#create-shop",
          linkLabel: "New shop",
        }
      : {
          headline: "Open a shop to continue the setup path",
          body: "The order, ticket, and scenario are authored inside one shop, so the rest of the path is read there rather than here.",
          href: null,
          linkLabel: null,
        };
  return { ...shape("shop"), complete: false, action };
}

function shopStep(shop: ScopedShop): SetupStep {
  const base = `/shops/${shop.shopId}`;
  // The gate is the fresher of the two readings where the host has one — it is what publishing
  // refreshes — so it answers rather than falls back to the listing.
  const latest =
    shop.gate === null ? shop.latestPublishedVersion : shop.gate.latest_published_version;
  const errors = shop.gate?.issues.filter((issue) => issue.severity === "error") ?? [];
  const surface =
    errors.length > 0
      ? shopIssueSurface(errors[0].path, shop.shopId)
      : { href: base, linkLabel: shape("shop").linkLabel };
  return {
    ...shape("shop"),
    complete: latest !== null,
    action: {
      headline: `Publish ${shop.name} so a scenario can pin a shop version`,
      // Whether anything blocks it, and what, is the gate's to say: the strip renders the
      // gate's own components underneath this rather than a sentence of its own.
      body: "Publishing freezes the draft exactly as it stands, and an experiment pins that version rather than the draft.",
      href: surface.href,
      linkLabel: surface.linkLabel,
    },
  };
}

/**
 * Read the whole path in dependency order.
 *
 * Every reading is a listing the product already serves, and every step is complete because
 * something the listing returned satisfies it.
 */
export function deriveSetupPath(listings: SetupListings): SetupPath {
  const { shop } = listings;
  const latestExperiment = listings.experiments[0] ?? null;
  if (shop === null) {
    const step = unscopedShopStep(listings.shops);
    return { scoped: false, steps: [], nextStep: step, complete: false, latestExperiment };
  }

  const publishedProfiles = published(listings.profiles);
  const publishedTickets = published(listings.tickets);
  const publishedObjectives = published(listings.objectiveBlocks);
  const publishedScenarios = published(listings.scenarios);
  const publishedIdentities = published(listings.supportIdentities);
  const publishedConfigurations = published(listings.agentConfigurations);
  const publishedJudges = published(listings.judges);

  const steps: SetupStep[] = [
    shopStep(shop),
    {
      ...shape("customer"),
      complete: publishedProfiles.length > 0,
      action: {
        headline:
          listings.profiles.length === 0
            ? "Attach a customer profile to this shop and publish it"
            : "Publish a customer profile so a ticket can pin a customer version",
        body: "A ticket can only name a profile attached to this shop, and pins the version it was authored against.",
        href: stepHref(shape("customer"), shop.shopId),
        linkLabel: shape("customer").linkLabel,
      },
    },
    {
      ...shape("order"),
      complete: listings.orders.length > 0,
      action: {
        headline: "Add the order the incident is about",
        body: "The recipe names the order; the copy is taken later, when a snapshot is materialized, so an order edited in between changes the next run's starting state.",
        href: stepHref(shape("order"), shop.shopId),
        linkLabel: shape("order").linkLabel,
      },
    },
    {
      ...shape("ticket"),
      complete: publishedTickets.length > 0,
      action: {
        headline:
          listings.tickets.length === 0
            ? "Write the ticket the incident arrives on, then publish it"
            : "Publish a ticket so a scenario can be built on it",
        body: "A scenario is built on one published ticket, and every arm of an experiment opens on the message it carries.",
        href: stepHref(shape("ticket"), shop.shopId),
        linkLabel: shape("ticket").linkLabel,
      },
    },
    {
      ...shape("blocks"),
      complete: publishedObjectives.length > 0,
      action: {
        headline: "Publish an objective block for the scenario to bind",
        body: "A scenario with no objectives decides nothing, so the library needs one to bind. The mutation library beside it is optional — a recipe with no fault is one where nothing goes wrong mid-incident.",
        href: stepHref(shape("blocks"), shop.shopId),
        linkLabel: shape("blocks").linkLabel,
      },
    },
    {
      ...shape("scenario"),
      complete: publishedScenarios.length > 0,
      action: {
        headline:
          listings.scenarios.length === 0
            ? "Compose the scenario on that ticket, then publish it"
            : "Publish a scenario so an experiment can pin a recipe",
        body: "An experiment pins one published scenario version, and through it every version that recipe froze.",
        href: stepHref(shape("scenario"), shop.shopId),
        linkLabel: shape("scenario").linkLabel,
      },
    },
    {
      ...shape("support-identity"),
      complete: publishedIdentities.length > 0,
      action: {
        headline: "Publish the support identity the agent will adopt",
        body: "An agent configuration adopts one published support identity, which is what authorizes the writes its tools may make.",
        href: stepHref(shape("support-identity"), shop.shopId),
        linkLabel: shape("support-identity").linkLabel,
      },
    },
    {
      ...shape("agent-configurations"),
      complete: publishedConfigurations.length > 1,
      action: {
        headline:
          publishedConfigurations.length === 0
            ? "Publish an agent configuration for the first arm"
            : "Publish a second agent configuration so a comparison has two arms",
        body: "A comparison should move one dimension — the framework, the architecture, or the configuration — and the lab warns when an experiment's arms differ in more than one.",
        href: stepHref(shape("agent-configurations"), shop.shopId),
        linkLabel: shape("agent-configurations").linkLabel,
      },
    },
    {
      ...shape("judge"),
      complete: publishedJudges.length > 0,
      action: {
        headline: "Publish a judge for the rows no rule decides",
        body: "Deterministic objectives do not need one; the dimensions a rule cannot decide do.",
        href: stepHref(shape("judge"), shop.shopId),
        linkLabel: shape("judge").linkLabel,
      },
    },
    {
      ...shape("experiment"),
      complete: listings.experimentCount > 0,
      action: {
        headline: "Start the experiment and drive both arms",
        body: "Starting one clones an arm per configuration from a single snapshot, and you play the customer. The history listing is cross-shop, so a run started in any shop satisfies this step.",
        href: stepHref(shape("experiment"), shop.shopId),
        linkLabel: shape("experiment").linkLabel,
      },
    },
  ];

  const nextStep = steps.find((step) => !step.complete) ?? null;
  return {
    scoped: true,
    steps,
    nextStep,
    complete: nextStep === null,
    latestExperiment,
  };
}
