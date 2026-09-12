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
import { describe, expect, it } from "vitest";
import { glossaryTerm } from "./glossary";
import { deriveSetupPath, type ScopedShop, type SetupListings } from "./setupPath";

/**
 * The setup path is a reading of listings, so it is tested over listings.
 *
 * Nothing here sets a flag, and nothing in the production code writes one: the assertions
 * below are all "this is complete because that listing holds something", which is the whole
 * of what ADR 0044 decided the guide may know.
 */

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";

const SHOP: ShopSummarySchema = {
  shop_id: SHOP_ID,
  name: "Northstar Outfitters",
  slug: "northstar",
  updated_at: "2026-09-12T09:41:00+00:00",
  latest_published_version: null,
  published_version_count: 0,
};

function scoped(overrides: Partial<ScopedShop> = {}): ScopedShop {
  return {
    shopId: SHOP_ID,
    name: "Northstar Outfitters",
    gate: null,
    dirty: false,
    latestPublishedVersion: null,
    ...overrides,
  };
}

const EMPTY: SetupListings = {
  shops: [],
  shop: null,
  profiles: [],
  orders: [],
  tickets: [],
  objectiveBlocks: [],
  scenarios: [],
  supportIdentities: [],
  agentConfigurations: [],
  judges: [],
  experiments: [],
  experimentCount: 0,
};

/** Every definition listing carries the same published-version column, so one helper fills it. */
function publishedEntry<T>(entry: T): T & { latest_published_version: number } {
  return { ...entry, latest_published_version: 1, published_version_count: 1 };
}

const PROFILE = {
  profile_id: "p1",
  display_name: "Maya Lindqvist",
  email: "maya@example.test",
  persona_traits: [],
  address_count: 1,
  default_address_label: "Home",
  updated_at: "2026-09-12T09:00:00+00:00",
  latest_published_version: null,
  published_version_count: 0,
  attached_shop_count: 1,
} satisfies CustomerProfileSummarySchema;

const ORDER = {
  order_id: "o1",
  reference: "NS-10482",
  customer_profile_id: "p1",
  customer_display_name: "Maya Lindqvist",
  placed_at: "2026-09-10T09:00:00+00:00",
  payment_status: "paid",
  fulfilment_status: "unfulfilled",
  line_count: 1,
  total: { amount: "249.00", currency: "EUR" },
  updated_at: "2026-09-10T09:00:00+00:00",
} satisfies OrderSummarySchema;

const TICKET = {
  ticket_id: "t1",
  reference: "T-204",
  subject: "Wrong shipping address",
  customer_profile_id: "p1",
  customer_display_name: "Maya Lindqvist",
  channel: "chat",
  status: "open",
  origin_kind: "order_page",
  preview: "I used the wrong address",
  opened_at: "2026-09-11T09:00:00+00:00",
  message_count: 2,
  tags: [],
  updated_at: "2026-09-11T09:00:00+00:00",
  latest_published_version: null,
  published_version_count: 0,
} satisfies TicketSummarySchema;

const BLOCK = {
  block_id: "b1",
  name: "Address redirected",
  statement: "The order ships to the corrected address",
  type_label: "State assertion",
  parameter_count: 1,
  shop_bound_parameter_count: 1,
  updated_at: "2026-09-11T09:00:00+00:00",
  latest_published_version: null,
  published_version_count: 0,
} satisfies BlockSummarySchema;

const SCENARIO = {
  scenario_id: "s1",
  name: "Wrong shipping address",
  ticket_id: "t1",
  ticket_reference: "T-204",
  ticket_subject: "Wrong shipping address",
  customer_display_name: "Maya Lindqvist",
  objective_count: 3,
  mutation_count: 1,
  context_document_count: 1,
  max_turns: 2,
  updated_at: "2026-09-11T09:00:00+00:00",
  latest_published_version: null,
  published_version_count: 0,
} satisfies ScenarioSummarySchema;

const IDENTITY = {
  identity_id: "i1",
  name: "Tier 1 support",
  title: "Support specialist",
  permission_count: 2,
  guidance_count: 1,
  updated_at: "2026-09-11T09:00:00+00:00",
  latest_published_version: null,
  published_version_count: 0,
} satisfies SupportIdentitySummarySchema;

const CONFIGURATION = {
  configuration_id: "c1",
  name: "Atlas",
  framework_id: "pydantic-ai",
  framework_label: "Pydantic AI",
  model_id: "gpt-5-mini",
  support_identity_id: "i1",
  tool_count: 4,
  updated_at: "2026-09-11T09:00:00+00:00",
  latest_published_version: null,
  published_version_count: 0,
} satisfies AgentConfigurationSummarySchema;

const JUDGE = {
  judge_id: "j1",
  name: "Resolution quality",
  provider: "deterministic",
  provider_label: "Deterministic control",
  model_id: "deterministic",
  evidence_count: 2,
  updated_at: "2026-09-11T09:00:00+00:00",
  latest_published_version: null,
  published_version_count: 0,
} satisfies JudgeConfigurationSummarySchema;

const EXPERIMENT = {
  experiment_id: "e1",
  shop_id: SHOP_ID,
  shop_name: "Northstar Outfitters",
  label: "#18",
  scenario_id: "s1",
  scenario_name: "Wrong shipping address",
  scenario_version: 1,
  scenario_superseded: false,
  seed: 7,
  sandbox_fingerprint: "a".repeat(64),
  resolution_fingerprint: "b".repeat(64),
  participant_driver: "human",
  status: "completed",
  arms: [],
  tags: [],
  note_count: 0,
  created_at: "2026-09-12T09:00:00+00:00",
} satisfies ExperimentHistoryEntrySchema;

/** The state `make seed` leaves: every step's listing holds what that step asks for. */
const SEEDED: SetupListings = {
  ...EMPTY,
  shop: scoped({ latestPublishedVersion: 1 }),
  profiles: [publishedEntry(PROFILE)],
  orders: [ORDER],
  tickets: [publishedEntry(TICKET)],
  objectiveBlocks: [publishedEntry(BLOCK)],
  scenarios: [publishedEntry(SCENARIO)],
  supportIdentities: [publishedEntry(IDENTITY)],
  agentConfigurations: [
    publishedEntry(CONFIGURATION),
    publishedEntry({ ...CONFIGURATION, configuration_id: "c2", name: "Beacon" }),
  ],
  judges: [publishedEntry(JUDGE)],
  experiments: [EXPERIMENT],
  experimentCount: 1,
};

describe("the setup path", () => {
  it("tells an empty lab to create the shop every other definition is authored inside", () => {
    const path = deriveSetupPath(EMPTY);

    expect(path.nextStep?.id).toBe("shop");
    expect(path.nextStep?.action.headline).toMatch(/Create a shop/);
    expect(path.complete).toBe(false);
    // Outside a shop the chain is not drawn: nine of its ten steps were never read.
    expect(path.scoped).toBe(false);
    expect(path.steps).toHaveLength(0);
  });

  it("hands over a command where the product refuses a route", () => {
    // ADR 0043 decided the seed is a command and never a route, so the guide says the command.
    expect(deriveSetupPath(EMPTY).nextStep?.action.command).toBe("make seed");
  });

  it("sends a reader holding shops into one rather than naming a step it did not read", () => {
    const path = deriveSetupPath({ ...EMPTY, shops: [SHOP] });

    expect(path.nextStep?.action.headline).toMatch(/Open a shop/);
    expect(path.nextStep?.action.href).toBeNull();
  });

  it("names the next step and not the last one for a lab holding only a published shop", () => {
    const path = deriveSetupPath({ ...EMPTY, shop: scoped({ latestPublishedVersion: 1 }) });

    expect(path.nextStep?.id).toBe("customer");
    expect(path.steps.find((step) => step.id === "shop")?.complete).toBe(true);
    expect(path.steps.find((step) => step.id === "experiment")?.complete).toBe(false);
    expect(path.complete).toBe(false);
  });

  it("reads the state make seed leaves as complete, with nothing written to say so", () => {
    const path = deriveSetupPath(SEEDED);

    expect(path.nextStep).toBeNull();
    expect(path.complete).toBe(true);
    expect(path.steps.every((step) => step.complete)).toBe(true);
    expect(path.latestExperiment?.label).toBe("#18");
  });

  it("leaves a step complete when the draft beside the published version has moved on", () => {
    // What an experiment would pin is the published version, and it is still there. The shop
    // below has a published v1 and a draft the gate now refuses.
    const path = deriveSetupPath({
      ...SEEDED,
      shop: scoped({
        latestPublishedVersion: 1,
        dirty: true,
        gate: {
          latest_published_version: 1,
          next_version: 2,
          matches_latest_published: false,
          publishable: false,
          issues: [
            {
              code: "shop_without_product",
              severity: "error",
              message: "a published shop must sell at least one product",
              path: "products",
            },
          ],
        },
      }),
    });

    expect(path.steps.find((step) => step.id === "shop")?.complete).toBe(true);
    expect(path.complete).toBe(true);
  });

  it("counts a published profile rather than a drafted one", () => {
    const drafted: SetupListings = {
      ...EMPTY,
      shop: scoped({ latestPublishedVersion: 1 }),
      profiles: [PROFILE],
      orders: [ORDER],
      tickets: [TICKET],
    };

    // A drafted profile is not a profile a ticket can pin, so the step it belongs to is open.
    expect(deriveSetupPath(drafted).nextStep?.id).toBe("customer");
    expect(deriveSetupPath({ ...drafted, profiles: [publishedEntry(PROFILE)] }).nextStep?.id).toBe(
      "ticket",
    );
  });

  it("asks for a second agent configuration so a comparison has two arms", () => {
    const oneArm = {
      ...SEEDED,
      agentConfigurations: [publishedEntry(CONFIGURATION)],
    };

    const path = deriveSetupPath(oneArm);
    expect(path.nextStep?.id).toBe("agent-configurations");
    expect(path.nextStep?.action.headline).toMatch(/second agent configuration/);
  });

  it("sends a blocked shop step to the surface the gate's own finding names", () => {
    const path = deriveSetupPath({
      ...EMPTY,
      shop: scoped({
        gate: {
          latest_published_version: null,
          next_version: 1,
          matches_latest_published: false,
          publishable: false,
          issues: [
            {
              code: "shop_without_tone_of_voice",
              severity: "error",
              message: "a published shop must define at least one tone-of-voice guideline",
              path: "tone_of_voice_guidelines",
            },
          ],
        },
      }),
    });

    expect(path.nextStep?.action.href).toBe(`/shops/${SHOP_ID}/setup/tone`);
    expect(path.nextStep?.action.linkLabel).toBe("Open tone of voice");
  });

  it("names only vocabulary the glossary defines", () => {
    // Every step links these words to their one definition, so a term that resolved to nothing
    // would render as a link to an anchor nobody wrote.
    const referenced = deriveSetupPath(SEEDED).steps.flatMap((step) => step.terms);

    expect(referenced.length).toBeGreaterThan(0);
    for (const term of referenced) {
      expect(glossaryTerm(term)?.definition ?? "", `${term} has no definition`).not.toBe("");
    }
  });

  it("points at the definitions rather than restating them", () => {
    // `glossary.ts` exists so a term has one definition. A step body that repeated one would be
    // the second copy that module was written to prevent.
    for (const step of deriveSetupPath(SEEDED).steps) {
      for (const term of step.terms) {
        const definition = glossaryTerm(term)?.definition ?? "";
        const sentence = definition.split(". ")[0];
        expect(step.action.body ?? "", `${step.id} restates ${term}`).not.toContain(sentence);
      }
    }
  });
});
