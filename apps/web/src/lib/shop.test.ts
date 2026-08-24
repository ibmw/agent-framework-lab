import type { DefinitionIssueSchema, ShopContentSchema } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import {
  groupIssues,
  issuesForProduct,
  ratingLabel,
  replaceProduct,
  toPayload,
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
