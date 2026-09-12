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

export interface SetupStep {
  id: SetupStepId;
  /** The word the chain row shows. */
  label: string;
  complete: boolean;
  action: SetupAction;
  /** The vocabulary this step's sentences use, defined in `glossary.ts`. */
  terms: readonly GlossaryTermId[];
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
  return { id: "shop", label: "Shop", complete: false, action, terms: ["shop"] };
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
      : { href: base, linkLabel: "Open the shop's home" };
  return {
    id: "shop",
    label: "Shop",
    complete: latest !== null,
    action: {
      headline: `Publish ${shop.name} so a scenario can pin a shop version`,
      // Whether anything blocks it, and what, is the gate's to say: the strip renders the
      // gate's own components underneath this rather than a sentence of its own.
      body: "Publishing freezes the draft exactly as it stands, and an experiment pins that version rather than the draft.",
      href: surface.href,
      linkLabel: surface.linkLabel,
    },
    terms: ["shop", "definition"],
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

  const base = `/shops/${shop.shopId}`;
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
      id: "customer",
      label: "Customer",
      complete: publishedProfiles.length > 0,
      action: {
        headline:
          listings.profiles.length === 0
            ? "Attach a customer profile to this shop and publish it"
            : "Publish a customer profile so a ticket can pin a customer version",
        body: "A ticket can only name a profile attached to this shop, and pins the version it was authored against.",
        href: `${base}/customers`,
        linkLabel: "Open customers",
      },
      terms: ["customer-profile", "ticket"],
    },
    {
      id: "order",
      label: "Order",
      complete: listings.orders.length > 0,
      action: {
        headline: "Add the order the incident is about",
        body: "The recipe names the order; the copy is taken later, when a snapshot is materialized, so an order edited in between changes the next run's starting state.",
        href: `${base}/orders`,
        linkLabel: "Open orders",
      },
      terms: ["order", "sandbox-snapshot"],
    },
    {
      id: "ticket",
      label: "Ticket",
      complete: publishedTickets.length > 0,
      action: {
        headline:
          listings.tickets.length === 0
            ? "Write the ticket the incident arrives on, then publish it"
            : "Publish a ticket so a scenario can be built on it",
        body: "A scenario is built on one published ticket, and every arm of an experiment opens on the message it carries.",
        href: `${base}/tickets`,
        linkLabel: "Open tickets",
      },
      terms: ["ticket"],
    },
    {
      id: "blocks",
      label: "Blocks",
      complete: publishedObjectives.length > 0,
      action: {
        headline: "Publish an objective block for the scenario to bind",
        body: "A scenario with no objectives decides nothing, so the library needs one to bind. The mutation library beside it is optional — a recipe with no fault is one where nothing goes wrong mid-incident.",
        href: `${base}/objective-blocks`,
        linkLabel: "Open objective blocks",
      },
      terms: ["objective-block", "mutation-block", "scenario"],
    },
    {
      id: "scenario",
      label: "Scenario",
      complete: publishedScenarios.length > 0,
      action: {
        headline:
          listings.scenarios.length === 0
            ? "Compose the scenario on that ticket, then publish it"
            : "Publish a scenario so an experiment can pin a recipe",
        body: "An experiment pins one published scenario version, and through it every version that recipe froze.",
        href: `${base}/scenarios`,
        linkLabel: "Open scenarios",
      },
      terms: ["scenario", "objective-block", "mutation-block"],
    },
    {
      id: "support-identity",
      label: "Support identity",
      complete: publishedIdentities.length > 0,
      action: {
        headline: "Publish the support identity the agent will adopt",
        body: "An agent configuration adopts one published support identity, which is what authorizes the writes its tools may make.",
        href: `${base}/support-identities`,
        linkLabel: "Open support identities",
      },
      terms: ["support-identity", "shop"],
    },
    {
      id: "agent-configurations",
      label: "Agent configurations",
      complete: publishedConfigurations.length > 1,
      action: {
        headline:
          publishedConfigurations.length === 0
            ? "Publish an agent configuration for the first arm"
            : "Publish a second agent configuration so a comparison has two arms",
        body: "A comparison should move one dimension — the framework, the architecture, or the configuration — and the lab warns when an experiment's arms differ in more than one.",
        href: `${base}/agent-configurations`,
        linkLabel: "Open agent configurations",
      },
      terms: ["agent-configuration", "support-identity", "run"],
    },
    {
      id: "judge",
      label: "Judge",
      complete: publishedJudges.length > 0,
      action: {
        headline: "Publish a judge for the rows no rule decides",
        body: "Deterministic objectives do not need one; the dimensions a rule cannot decide do.",
        href: `${base}/judges`,
        linkLabel: "Open judges",
      },
      terms: ["judge-configuration", "evaluation", "objective-block"],
    },
    {
      id: "experiment",
      label: "Experiment",
      complete: listings.experimentCount > 0,
      action: {
        headline: "Start the experiment and drive both arms",
        body: "Starting one clones an arm per configuration from a single snapshot, and you play the customer. The history listing is cross-shop, so a run started in any shop satisfies this step.",
        href: `${base}/bench`,
        linkLabel: "Open the bench",
      },
      terms: ["experiment", "sandbox-snapshot", "participant-driver"],
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
