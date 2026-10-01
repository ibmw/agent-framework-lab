import type {
  AgentConfigurationPayloadSchema,
  ObjectiveBlockPayloadSchema,
  ScenarioContentSchema,
  ShopContentSchema,
  SupportIdentityPayloadSchema,
  TicketContentSchema,
} from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import { toAgentConfigurationPayload } from "../api/agentConfigurations";
import { toBlockPayload } from "../api/blocks";
import { toProfilePayload } from "../api/customerProfiles";
import { toSupportIdentityPayload } from "../api/supportIdentities";
import { LABEL_MAX_LENGTH } from "./fieldRules";
import { pythonLength } from "./pythonText";
import { toScenarioRequest } from "./scenarios";
import { copyTitle, toPayload } from "./shop";
import { toTicketRequest } from "./tickets";

/**
 * What a page sends is stripped as the lab strips it.
 *
 * `require_label` refuses a text that Python's `str.strip()` changes, and `require_text` the
 * same, so a write that trims with JavaScript's `trim()` — or not at all — is refused for padding
 * the operator cannot see. Swept from both ends: every draft write a whole-record editor makes is
 * fed its typed texts padded with what `str.strip()` removes and `trim()` keeps, and must send
 * them as it sends them unpadded; and every `trim()` left in the workspace is named below with
 * why the lab never reads what it trims.
 */

/** Kept by `trim()`, removed by `str.strip()`: NEL, a file separator, a line separator. */
const PAD = "\x85\x1c  ";

function padded<T>(value: T, paths: readonly string[]): T {
  const copy = structuredClone(value) as Record<string, unknown>;
  for (const path of paths) {
    const keys = path.split(".");
    const last = keys.pop() as string;
    let node = copy as Record<string, unknown>;
    for (const key of keys) node = node[key] as Record<string, unknown>;
    expect(typeof node[last], path).toBe("string");
    expect(node[last], path).not.toBe("");
    node[last] = `${PAD}${node[last] as string}${PAD}`;
  }
  return copy as T;
}

const SHOP = {
  identity: { name: "Northstar", slug: "northstar" },
  products: [
    { key: "k", handle: "shell", title: "Shell", description: "Dry.", category: "Jackets" },
  ],
  faq: [{ id: "returns", question: "Returns?", answer: "Within 30 days." }],
  policies: [{ id: "refunds", title: "Refunds", kind: "refund", body: "Refunds take five days." }],
  payment_methods: [],
  fulfilment_methods: [],
  support_guidelines: [{ id: "tone", title: "Tone", body: "Warm, brief." }],
  tone_of_voice_guidelines: [],
  logo: null,
} as unknown as ShopContentSchema;

const WRITES: {
  write: string;
  build: (content: never) => unknown;
  content: unknown;
  typed: readonly string[];
}[] = [
  {
    write: "the shop draft (Shop details, a product, a document)",
    build: toPayload,
    content: SHOP,
    typed: [
      "identity.name",
      "products.0.title",
      "products.0.description",
      "products.0.category",
      "faq.0.question",
      "faq.0.answer",
      "policies.0.title",
      "policies.0.body",
      "support_guidelines.0.title",
      "support_guidelines.0.body",
    ],
  },
  {
    write: "a ticket's draft",
    build: toTicketRequest,
    content: { subject: "Late delivery", history: [], tags: [] } as unknown as TicketContentSchema,
    typed: ["subject"],
  },
  {
    write: "a customer profile's draft",
    build: toProfilePayload,
    content: {
      identity: { given_name: "Maya", family_name: "Laurent", email: "maya@example.org" },
      account: { notes: "Prefers email." },
      persona: { summary: "Direct.", traits: [] },
      addresses: [],
      background: [],
      hidden_facts: [],
    },
    typed: [
      "identity.given_name",
      "identity.family_name",
      "identity.email",
      "account.notes",
      "persona.summary",
    ],
  },
  {
    write: "a scenario's draft",
    build: toScenarioRequest,
    content: {
      name: "Late parcel",
      context_documents: [],
      objectives: [],
      mutations: [],
      hidden_facts: "The parcel is in a depot.",
      completion: { statement: "The customer knows when it arrives." },
    } as unknown as ScenarioContentSchema,
    typed: ["name", "hidden_facts", "completion.statement"],
  },
  {
    write: "an agent configuration's draft",
    build: toAgentConfigurationPayload,
    content: {
      name: "Atlas",
      description: "The baseline.",
      prompt: "You are {{ shop.name }}'s agent.",
      model: { provider: "openai", model_id: "gpt-4.1" },
    } as unknown as AgentConfigurationPayloadSchema,
    typed: ["name", "description", "prompt", "model.model_id"],
  },
  {
    write: "a support identity's draft",
    build: toSupportIdentityPayload,
    content: {
      role: { name: "Ava", title: "Support lead", description: "First contact." },
      escalation: { escalate_to: "The duty manager.", conditions: [] },
      guidance: [],
    } as unknown as SupportIdentityPayloadSchema,
    typed: ["role.name", "role.title", "role.description", "escalation.escalate_to"],
  },
  {
    write: "a block template's draft",
    build: toBlockPayload,
    content: {
      name: "read-document",
      statement: "Reads the document.",
      description: "Checks the read.",
      parameters: [],
    } as unknown as ObjectiveBlockPayloadSchema,
    typed: ["statement", "description"],
  },
];

describe("a draft write", () => {
  for (const { write, build, content, typed } of WRITES) {
    it(`sends ${write} stripped as Python strips it`, () => {
      expect(build(padded(content, typed) as never)).toEqual(build(content as never));
    });
  }

  it("keeps each typed text of an unpadded draft somewhere in what it sends", () => {
    // Stripping changes padding, not content: every text it was given is still in the write.
    for (const { build, content, typed } of WRITES) {
      const sent = JSON.stringify(build(content as never));
      for (const path of typed) {
        const value = path.split(".").reduce<unknown>((node, key) => (node as never)[key], content);
        expect(sent).toContain(JSON.stringify(value).slice(1, -1));
      }
    }
  });

  it("keeps what `str.strip()` keeps, though `trim()` would take it", () => {
    const bom = "﻿";
    expect(toTicketRequest({ subject: bom } as never).payload.subject).toBe(bom);
  });
});

describe("a duplicated product's title", () => {
  it("is marked, and cut to make room for the mark at the cap, as Python counts", () => {
    expect(copyTitle("")).toBe("");
    expect(copyTitle("Shell")).toBe("Shell (copy)");
    const room = LABEL_MAX_LENGTH - " (copy)".length;
    expect(copyTitle("x".repeat(room))).toBe(`${"x".repeat(room)} (copy)`);
    const atCap = copyTitle("x".repeat(LABEL_MAX_LENGTH));
    expect(atCap).toBe(`${"x".repeat(room)} (copy)`);
    expect(pythonLength(atCap)).toBe(LABEL_MAX_LENGTH);
    // Counted in code points, as `len()` counts: an emoji is one character, not two units.
    const emoji = copyTitle("😀".repeat(LABEL_MAX_LENGTH));
    expect(pythonLength(emoji)).toBe(LABEL_MAX_LENGTH);
    expect(emoji).toBe(`${"😀".repeat(room)} (copy)`);
    // A cut that lands after a space strips it, so the title is not refused as padded.
    expect(copyTitle(`${"x".repeat(room - 1)} tail`)).toBe(`${"x".repeat(room - 1)} (copy)`);
  });
});

const sources = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../**/*.test.*", "!../test/**"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Every `trim()` left in the workspace, by file, with why the lab never reads what it trims.
 * A new one fails here until someone decides whether it should be `pythonStrip`.
 */
const TRIMS: Record<string, { count: number; why: string }> = {
  "components/ShopLogoCard.tsx": { count: 1, why: "a fallback for the name shown on the logo" },
  "lib/documents.ts": { count: 1, why: "a word count shown under the body" },
  "lib/entryIds.ts": { count: 1, why: "slug derivation, whose result is a slug" },
  "lib/experimentStart.ts": {
    count: 4,
    why: "a seed is a number; the proposed name is sent through `pythonStrip` (`setupOf`)",
  },
  "lib/filters.ts": { count: 1, why: "a search query, never sent" },
  "lib/itemForm.ts": { count: 1, why: "what the unsaved-work prompt quotes" },
  "routes/ExperimentHistoryPage.tsx": { count: 2, why: "a search query, matched not stored" },
  "routes/SnapshotsPage.tsx": { count: 3, why: "a seed, which is a number" },
  "routes/SupportIdentityEditorPage.tsx": { count: 1, why: "a fallback for the title shown" },
  "routes/TicketEditorPage.tsx": { count: 1, why: "a fallback for the title shown" },
};

describe("a trim left in the workspace", () => {
  it("is one the lab never reads", () => {
    const found = Object.fromEntries(
      Object.entries(sources)
        .map(([path, source]) => [
          path.replace(/^\.\.\//, "").replace(/^\.\//, "lib/"),
          source.match(/\.trim(Start|End)?\(\)/g)?.length ?? 0,
        ])
        .filter(([, count]) => count !== 0),
    );
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    expect(found).toEqual(
      Object.fromEntries(Object.entries(TRIMS).map(([file, { count }]) => [file, count])),
    );
  });
});
