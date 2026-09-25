import type { DefinitionIssueSchema, ShopContentSchema } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import {
  groupIssues,
  issuesForProduct,
  ratingLabel,
  removeOption,
  replaceProduct,
  shopSlugFromName,
  toPayload,
  variantCollisions,
  variantOptionLabel,
  variantPriceLabel,
} from "./shop";

const content: ShopContentSchema = {
  identity: {
    name: "Northstar Outfitters",
    slug: "northstar",
    locale: "en-GB",
    currencies: ["EUR"],
    channels: ["chat"],
  },
  products: [
    {
      handle: "alpine-shell-jacket",
      title: "Alpine Shell Jacket",
      description: "Three-layer waterproof shell.",
      status: "active",
      category: "Jackets",
      options: [{ key: "size", name: "Size", values: ["M", "L"] }],
      variants: [
        {
          sku: "NS-ASJ-M",
          option_values: [{ key: "size", value: "M" }],
          availability: "in_stock",
          stock_quantity: 4,
          price: { amount: "249.00", currency: "EUR" },
        },
        {
          sku: "NS-ASJ-L",
          option_values: [],
          availability: "backorder",
          stock_quantity: 0,
          price: null,
        },
      ],
      media: [],
      attributes: [],
      reviews: [
        { id: "one", author_display_name: "Camille", rating: 5, body: "Dry." },
        { id: "two", author_display_name: "Ade", rating: 4, body: "Warm." },
      ],
      ratings: { review_count: 2, average_rating: "4.5" },
    },
  ],
  faq: [],
  policies: [],
  payment_methods: [],
  fulfilment_methods: [],
  support_guidelines: [],
  tone_of_voice_guidelines: [],
  default_tone_of_voice_id: null,
};

describe("toPayload", () => {
  it("strips derived read-only evidence the draft write must not echo back", () => {
    const payload = toPayload(content);

    expect(payload.products[0]).not.toHaveProperty("ratings");
    expect(payload).not.toHaveProperty("default_tone_of_voice_id");
    expect(payload.products[0].variants).toHaveLength(2);
    expect(payload.identity).toEqual(content.identity);
  });
});

describe("replaceProduct", () => {
  it("replaces one product and leaves the rest of the draft untouched", () => {
    const next = replaceProduct(content, "alpine-shell-jacket", {
      ...content.products[0],
      title: "Renamed",
    });

    expect(next.products[0].title).toBe("Renamed");
    expect(next.identity).toBe(content.identity);
    expect(content.products[0].title).toBe("Alpine Shell Jacket");
  });
});

describe("variant labels", () => {
  it("names option values and marks an unpriced draft variant", () => {
    expect(variantOptionLabel(content.products[0].variants[0])).toBe("M");
    expect(variantOptionLabel(content.products[0].variants[1])).toBe("—");
    expect(variantPriceLabel(content.products[0].variants[0])).toBe("249.00 EUR");
    expect(variantPriceLabel(content.products[0].variants[1])).toBe("missing");
  });
});

describe("issues", () => {
  const issues: DefinitionIssueSchema[] = [
    {
      severity: "error",
      code: "variant_without_price",
      message: "variant NS-ASJ-L is missing a price",
      path: "products.alpine-shell-jacket.variants.NS-ASJ-L",
    },
    { severity: "warning", code: "shop_without_faq", message: "no FAQ yet", path: "faq" },
  ];

  it("splits errors from warnings", () => {
    expect(groupIssues(issues)).toEqual({ errors: [issues[0]], warnings: [issues[1]] });
  });

  it("keeps only the findings that belong to one product", () => {
    expect(issuesForProduct(issues, "alpine-shell-jacket")).toEqual([issues[0]]);
    expect(issuesForProduct(issues, "other-product")).toEqual([]);
  });
});

describe("ratingLabel", () => {
  it("reports derived ratings and the empty case", () => {
    expect(ratingLabel(content.products[0])).toBe("4.5 · 2 reviews");
    expect(
      ratingLabel({
        ...content.products[0],
        reviews: [],
        ratings: { review_count: 0, average_rating: null },
      }),
    ).toBe("No reviews");
  });
});

describe("the slug a shop name suggests", () => {
  it("writes the spelling the identity rule accepts", () => {
    expect(shopSlugFromName("Harbour Lane Supply")).toBe("harbour-lane-supply");
  });

  it("transliterates accents the way an entry ID does", () => {
    expect(shopSlugFromName("Café Noël")).toBe("cafe-noel");
  });

  it("collapses punctuation and spacing rather than emitting it", () => {
    expect(shopSlugFromName("  Smith & Sons, Ltd.  ")).toBe("smith-sons-ltd");
  });

  it("leaves the field empty when a name transliterates to nothing", () => {
    // Not "entry": a word nobody typed is one they can publish by not noticing it.
    expect(shopSlugFromName("株式会社")).toBe("");
  });

  it("cuts to the length the domain accepts, without ending on a hyphen", () => {
    const slug = shopSlugFromName("a".repeat(70));
    expect(slug).toHaveLength(64);

    // The cut can land where a hyphen was, and a trailing hyphen is what the pattern refuses.
    const onBoundary = shopSlugFromName(`${"a".repeat(64)} tail`);
    expect(onBoundary).toBe("a".repeat(64));
  });

  it("only ever produces something the shop identity pattern accepts", () => {
    const pattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const name of [
      "Harbour Lane Supply",
      "Café Noël",
      "  Smith & Sons, Ltd.  ",
      "--- weird ---",
      "123",
      `${"a".repeat(64)} tail`,
    ]) {
      expect(shopSlugFromName(name)).toMatch(pattern);
    }
  });
});

describe("removeOption", () => {
  it("takes the value each variant chose for it, and leaves every other value", () => {
    const product = {
      ...content.products[0],
      options: [...content.products[0].options, { key: "color", name: "Color", values: ["Red"] }],
      variants: content.products[0].variants.map((variant) => ({
        ...variant,
        option_values: [...variant.option_values, { key: "color", value: "Red" }],
      })),
    };

    const next = removeOption(product, "size");

    expect(next.options.map((option) => option.key)).toEqual(["color"]);
    expect(next.variants.map((variant) => variant.option_values)).toEqual([
      [{ key: "color", value: "Red" }],
      [{ key: "color", value: "Red" }],
    ]);
  });
});

describe("variantCollisions", () => {
  it("says nothing where every variant still differs from every other", () => {
    const product = {
      ...content.products[0],
      options: [...content.products[0].options, { key: "color", name: "Color", values: ["Red"] }],
      variants: content.products[0].variants.map((variant) => ({
        ...variant,
        option_values: [...variant.option_values, { key: "color", value: "Red" }],
      })),
    };
    // Without color, M and nothing still differ; without size, both choose Red.
    expect(variantCollisions(product, "color")).toEqual([]);
    expect(variantCollisions(product, "size")).toEqual([
      { skus: ["NS-ASJ-M", "NS-ASJ-L"], values: "Red", before: [] },
    ]);
  });
});

describe("variantCollisions compares as the gate does", () => {
  const base = content.products[0];
  function withVariants(variants: { sku: string; values: [string, string][] }[]) {
    return {
      ...base,
      options: [
        { key: "color", name: "Color", values: ["Red", "red"] },
        { key: "fit", name: "Fit", values: ["Slim"] },
        { key: "size", name: "Size", values: ["M"] },
      ],
      variants: variants.map(({ sku, values }) => ({
        ...base.variants[0],
        sku,
        option_values: values.map(([key, value]) => ({ key, value })),
      })),
    };
  }

  it("counts the same values listed in another order as the same combination", () => {
    // `tuple(sorted(option_values))`: the order a variant lists its values in is not compared.
    const product = withVariants([
      {
        sku: "A",
        values: [
          ["color", "Red"],
          ["fit", "Slim"],
          ["size", "M"],
        ],
      },
      {
        sku: "B",
        values: [
          ["fit", "Slim"],
          ["color", "Red"],
          ["size", "L"],
        ],
      },
    ]);
    const [group] = variantCollisions(product, "size");
    expect(group.skus).toEqual(["A", "B"]);
    // Written in the first variant's own order, as `variantOptionLabel` writes it.
    expect(group.values).toBe("Red · Slim");
  });

  it("tells Red from red, because the gate compares values as spelled", () => {
    const product = withVariants([
      {
        sku: "A",
        values: [
          ["color", "Red"],
          ["size", "M"],
        ],
      },
      {
        sku: "B",
        values: [
          ["color", "red"],
          ["size", "L"],
        ],
      },
    ]);
    expect(variantCollisions(product, "size")).toEqual([]);
  });
});
