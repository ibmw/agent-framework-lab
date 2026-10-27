import type { DefinitionIssueSchema } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import shopDomain from "../../../../apps/api/src/capability_lab/domain/shop.py?raw";
import type { ShopDraft } from "./productKeys";
import { CHECKLIST_SHOP_CODES, setupChecklist, unsoldCurrencyFindings } from "./setupChecklist";

/**
 * The gate's codes, read out of `domain/shop.py`, split where the domain splits them: the ones
 * `validate_shop` raises about the shop as a whole, and the ones `_validate_product` raises
 * about a product or a variant. A code the domain grows lands in one of the two and fails the
 * sweep below until the checklist says where it goes.
 */
function codesIn(source: string): string[] {
  return [...source.matchAll(/_(?:error|warning)\(\s*"([a-z_]+)"/g)].map((match) => match[1]);
}

const productSource = shopDomain.slice(
  shopDomain.indexOf("def _validate_product"),
  shopDomain.indexOf("def validate_shop"),
);
const shopSource = shopDomain.slice(
  shopDomain.indexOf("def validate_shop"),
  shopDomain.indexOf("ShopChangeKind ="),
);
const SHOP_CODES = codesIn(shopSource);
const PRODUCT_CODES = codesIn(productSource);

const EMPTY: ShopDraft = {
  identity: {
    name: "Northstar Outfitters",
    slug: "northstar",
    locale: "en-GB",
    currencies: ["EUR"],
    channels: ["chat"],
  },
  products: [],
  faq: [],
  policies: [],
  payment_methods: [],
  fulfilment_methods: [],
  support_guidelines: [],
  tone_of_voice_guidelines: [],
  default_tone_of_voice_id: null,
  logo: null,
};

function issue(code: string, severity: "error" | "warning", path = code): DefinitionIssueSchema {
  return { code, severity, message: `the gate's words for ${code}`, path };
}

describe("the setup checklist's reading of the gate", () => {
  it("read both halves of the gate's vocabulary out of the domain", () => {
    // Before anything is swept: an empty read would make every assertion below vacuous.
    expect(SHOP_CODES).toEqual([
      "shop_without_product",
      "shop_without_tone_of_voice",
      "tone_of_voice_without_default",
      "shop_without_payment_method",
      "shop_without_fulfilment_method",
      "shop_without_policy",
      "shop_without_faq",
      "shop_without_support_guideline",
    ]);
    expect(PRODUCT_CODES).toEqual([
      "product_without_variant",
      "product_without_description",
      "product_without_media",
      "variant_without_price",
      "variant_currency_unsupported",
      "variant_missing_option",
      "variant_unknown_option",
      "variant_unknown_option_value",
      "variant_in_stock_without_inventory",
      "duplicate_variant_options",
    ]);
  });

  it("gives every shop-wide code a line of its own, and owns no product code", () => {
    expect([...CHECKLIST_SHOP_CODES].sort()).toEqual([...SHOP_CODES].sort());
    for (const code of PRODUCT_CODES) {
      expect(CHECKLIST_SHOP_CODES).not.toContain(code);
    }
  });

  it.each([
    ...[
      ["shop_without_product", "At least one product"],
      ["shop_without_tone_of_voice", "A tone of voice default"],
      ["tone_of_voice_without_default", "A tone of voice default"],
      ["shop_without_payment_method", "A payment method enabled"],
      ["shop_without_fulfilment_method", "A fulfillment method"],
      ["shop_without_policy", "A policy"],
      ["shop_without_faq", "An FAQ"],
      ["shop_without_support_guideline", "Support guidelines"],
    ],
    ...[
      "product_without_variant",
      "product_without_description",
      "product_without_media",
      "variant_without_price",
      "variant_currency_unsupported",
      "variant_missing_option",
      "variant_unknown_option",
      "variant_unknown_option_value",
      "variant_in_stock_without_inventory",
      "duplicate_variant_options",
      // A code the gate grows later, before anyone gives it a line.
      "a_code_nobody_has_seen",
    ].map((code) => [code, "No blocking findings"]),
  ])("puts %s, whole, under exactly one line: %s", (code, label) => {
    const finding = issue(code, "error", `products.x.${code}`);
    const { lines, rest } = setupChecklist(EMPTY, [finding]);

    const holding = [...lines, rest].filter((line) => line.findings.length > 0);
    expect(holding.map((line) => line.label)).toEqual([label]);
    expect(holding[0].findings).toEqual([finding]);
    expect(holding[0].done).toBe(false);
  });

  it("marks every line done on a draft the gate finds nothing in, with what the draft holds", () => {
    const content: ShopDraft = {
      ...EMPTY,
      payment_methods: [
        { id: "card", name: "Card", kind: "card", enabled: true },
        { id: "gift", name: "Gift", kind: "gift_card", enabled: false },
      ],
      fulfilment_methods: [
        { id: "post", name: "Post", carrier: "La Poste", min_transit_days: 1, max_transit_days: 3 },
      ],
      policies: [{ id: "p", title: "Returns", kind: "returns", body: "Thirty days." }],
      faq: [
        { id: "a", question: "Q?", answer: "A." },
        { id: "b", question: "Q2?", answer: "A2." },
      ],
      support_guidelines: [{ id: "g", title: "Escalate", body: "Escalate." }],
      tone_of_voice_guidelines: [
        { id: "warm", name: "Warm and precise", guidance: "Lead with the fact.", is_default: true },
      ],
    };

    const { lines, rest } = setupChecklist(content, []);

    expect(lines.map((line) => [line.label, line.done, line.note])).toEqual([
      ["At least one product", true, "0 products in the draft"],
      ["A payment method enabled", true, "1 method enabled"],
      ["A fulfillment method", true, "1 method offered"],
      ["A policy", true, "1 policy authored"],
      ["A tone of voice default", true, "Warm and precise"],
      ["An FAQ", true, "2 answers authored"],
      ["Support guidelines", true, "1 guideline authored"],
    ]);
    expect(rest).toMatchObject({
      label: "No blocking findings",
      done: true,
      note: "Nothing else in the draft is refused.",
      findings: [],
    });
  });

  it("keeps the last line done while what it holds is only warnings, and tallies both", () => {
    const warning = issue("product_without_media", "warning", "products.jacket");
    expect(setupChecklist(EMPTY, [warning]).rest).toMatchObject({
      done: true,
      note: "1 warning",
      findings: [warning],
    });

    const error = issue("variant_without_price", "error", "products.jacket.variants.S");
    expect(setupChecklist(EMPTY, [warning, error, error]).rest).toMatchObject({
      done: false,
      note: "2 errors · 1 warning",
    });
  });

  it("keeps a shop-wide warning a line still to do", () => {
    const faq = issue("shop_without_faq", "warning", "faq");
    const line = setupChecklist(EMPTY, [faq]).lines.find((entry) => entry.label === "An FAQ");
    expect(line).toMatchObject({ done: false, findings: [faq] });
  });
});

describe("the currencies a draft's variants are priced in and the shop does not sell", () => {
  const priced = (sku: string, currency: "EUR" | "CHF" | null) => ({
    sku,
    option_values: [],
    availability: "in_stock" as const,
    stock_quantity: 1,
    price: currency === null ? null : { amount: "1.00", currency },
  });
  const withVariants = (currencies: ("EUR" | "CHF")[]): ShopDraft => ({
    ...EMPTY,
    identity: { ...EMPTY.identity, currencies },
    products: [
      {
        key: "k",
        handle: "jacket",
        title: "Jacket",
        description: "",
        status: "active",
        category: "",
        options: [],
        variants: [priced("J-EUR-1", "EUR"), priced("J-CHF", "CHF"), priced("J-NONE", null)],
        media: [],
        attributes: [],
        reviews: [],
        ratings: { review_count: 0, average_rating: null },
      },
      {
        key: "k2",
        handle: "boot",
        title: "Boot",
        description: "",
        status: "active",
        category: "",
        options: [],
        variants: [priced("B-EUR", "EUR")],
        media: [],
        attributes: [],
        reviews: [],
        ratings: { review_count: 0, average_rating: null },
      },
    ],
  });

  it("finds nothing while every priced currency is sold", () => {
    expect(unsoldCurrencyFindings(withVariants(["EUR", "CHF"]))).toEqual({});
  });

  it("says, per currency, every variant priced in one the shop has stopped selling", () => {
    expect(unsoldCurrencyFindings(withVariants(["CHF"]))).toEqual({
      EUR: [
        "variant J-EUR-1 is priced in EUR, which the shop does not sell in",
        "variant B-EUR is priced in EUR, which the shop does not sell in",
      ],
    });
  });
});
