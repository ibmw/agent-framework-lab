import type { DefinitionIssueSchema, ShopContentSchema } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import contentDomain from "../../../../apps/api/src/capability_lab/domain/content.py?raw";
import shopDomain from "../../../../apps/api/src/capability_lab/domain/shop.py?raw";
import openapi from "../../../../packages/contracts/openapi/v1/openapi.yaml?raw";
import { SLUG_MAX_LENGTH } from "./entryIds";
import type { DraftProduct, ShopDraft } from "./productKeys";
import {
  COPY_SUFFIX,
  draftCategories,
  duplicateProduct,
  groupIssues,
  issuesForProduct,
  ratingLabel,
  removeOption,
  removeProduct,
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
  logo: null,
};

/** The same content as the workspace holds it, each product keyed (ADR 0061). */
const keyed: ShopDraft = {
  ...content,
  products: content.products.map((product, index) => ({ ...product, key: `product-${index}` })),
};

/**
 * The properties `openapi.yaml` lets a product payload carry. `ProductSchema` is declared
 * `additionalProperties: false`, so a key that leaked into the write is a 422, not a field the
 * lab ignores.
 */
function contractProductProperties(): string[] {
  const block = openapi.match(
    /^ {4}ProductSchema:\n {6}properties:\n([\s\S]*?)^ {6}additionalProperties: false$/m,
  );
  if (block === null) {
    throw new Error("ProductSchema is not a closed object in the contract");
  }
  return [...block[1].matchAll(/^ {8}([a-z_]+):$/gm)].map(([, name]) => name);
}

describe("toPayload", () => {
  it("strips derived read-only evidence the draft write must not echo back", () => {
    const payload = toPayload(content);

    expect(payload.products[0]).not.toHaveProperty("ratings");
    expect(payload).not.toHaveProperty("default_tone_of_voice_id");
    expect(payload.products[0].variants).toHaveLength(2);
    expect(payload.identity).toEqual(content.identity);
  });

  it("carries the logo, and a shop without one as null (ADR 0070)", () => {
    const logo = { mark: "leaf", background: "plum" } as const;

    expect(toPayload({ ...content, logo }).logo).toEqual(logo);
    expect(toPayload(content).logo).toBeNull();
  });

  it("strips the key the workspace gave each product, so the write is the contract's", () => {
    // Read first, or a parse that found nothing would let any payload through (ADR 0023).
    expect(contractProductProperties()).toEqual([
      "handle",
      "title",
      "description",
      "status",
      "category",
      "options",
      "variants",
      "media",
      "attributes",
      "reviews",
    ]);

    const [product] = toPayload(keyed).products;

    expect(product).not.toHaveProperty("key");
    expect(Object.keys(product).sort()).toEqual(contractProductProperties().sort());
    expect(toPayload(keyed)).toStrictEqual(toPayload(content));
  });
});

describe("replaceProduct", () => {
  it("replaces one product by its key and leaves the rest of the draft untouched", () => {
    const next = replaceProduct(keyed, "product-0", {
      ...keyed.products[0],
      title: "Renamed",
      handle: "renamed",
    });

    expect(next.products[0].title).toBe("Renamed");
    expect(next.products[0].key).toBe("product-0");
    expect(next.identity).toBe(keyed.identity);
    expect(keyed.products[0].title).toBe("Alpine Shell Jacket");
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

describe("removeProduct", () => {
  it("takes out the product held under the key, whatever its handle, and nothing else", () => {
    const [jacket] = keyed.products;
    const renamed: ShopDraft = {
      ...keyed,
      products: [
        { ...jacket, key: "x", handle: "x-first" },
        { ...jacket, key: "alpine", handle: "alpine-shell-jacket" },
      ],
    };

    expect(removeProduct(renamed, "alpine").products.map((product) => product.key)).toEqual(["x"]);
    expect(removeProduct(renamed, "gone").products).toHaveLength(2);
    expect(renamed.products).toHaveLength(2);
  });
});

describe("draftCategories", () => {
  const [jacket] = keyed.products;
  const draftOf = (...categories: string[]): ShopDraft => ({
    ...keyed,
    products: categories.map((category, index) => ({
      ...jacket,
      key: `k${index}`,
      handle: `p-${index}`,
      category,
    })),
  });

  it("offers each spelling the other products use once, sorted", () => {
    expect(draftCategories(draftOf("Packs", "Jackets", "Base layers", "Jackets"), "none")).toEqual([
      "Base layers",
      "Jackets",
      "Packs",
    ]);
  });

  it("leaves out the product being edited", () => {
    expect(draftCategories(draftOf("Jackets", "Packs"), "k1")).toEqual(["Jackets"]);
    expect(draftCategories(draftOf("Jackets"), "k0")).toEqual([]);
  });

  it("keeps two spellings that differ by case, because the lab keeps both", () => {
    expect(draftCategories(draftOf("jackets", "Jackets"), "none")).toEqual(["jackets", "Jackets"]);
  });

  it("offers a padded spelling trimmed, as one with the spelling it pads", () => {
    expect(draftCategories(draftOf(" Jackets", "Jackets  ", "Jackets"), "none")).toEqual([
      "Jackets",
    ]);
  });

  it("offers nothing for a product with no category yet, blank or empty", () => {
    expect(draftCategories(draftOf("", "   ", "Packs"), "none")).toEqual(["Packs"]);
  });

  it("mirrors the one rule the lab holds a category to", () => {
    // `Product` checks its category with `_require_label` and nothing else, and that check is
    // non-empty, unpadded text: no vocabulary and no case folding for the list to mirror.
    const product = shopDomain.slice(shopDomain.indexOf("class Product:"));
    const body = product.slice(0, product.indexOf("\nclass "));
    expect(body.match(/self\.category/g)).toEqual(["self.category"]);
    expect(body).toContain('_require_label(self.category, "product category")');
    expect(contentDomain).toMatch(
      /def require_label\([^)]*\)[^:]*:\s*if not isinstance\(value, str\) or not value\.strip\(\) or value != value\.strip\(\):/,
    );
    expect(contentDomain).not.toMatch(/casefold|\.lower\(\)/);
  });
});

describe("duplicateProduct", () => {
  /** A minter like the workspace's: every key it gives is new. */
  function minter() {
    let count = 0;
    return () => {
      count += 1;
      return `minted-${count}`;
    };
  }

  function draftOf(...products: DraftProduct[]): ShopDraft {
    return { ...keyed, products };
  }

  const [jacket] = keyed.products;

  it("appends a draft copy under a fresh key, with everything authored and new SKUs", () => {
    const mint = minter();
    const result = duplicateProduct(keyed, "product-0", mint);

    expect(result).not.toBeNull();
    const copy = result?.copy as DraftProduct;
    expect(result?.content.products.map((product) => product.key)).toEqual([
      "product-0",
      "minted-1",
    ]);
    expect(result?.content.products[0]).toBe(jacket);
    expect(copy).toMatchObject({
      key: "minted-1",
      handle: `alpine-shell-jacket${COPY_SUFFIX}`,
      title: "Alpine Shell Jacket (copy)",
      status: "draft",
      description: jacket.description,
      category: jacket.category,
      options: jacket.options,
      media: jacket.media,
      attributes: jacket.attributes,
      reviews: jacket.reviews,
    });
    // Derived again from the copy's handle and each variant's own values, as the editor would.
    expect(copy.variants.map((variant) => variant.sku)).toEqual([
      "ALPINE-SHELL-JACKET-COPY-M",
      "ALPINE-SHELL-JACKET-COPY",
    ]);
    expect(copy.variants.map(({ sku: _sku, ...rest }) => rest)).toEqual(
      jacket.variants.map(({ sku: _sku, ...rest }) => rest),
    );
  });

  it("answers nothing for a key the draft does not hold", () => {
    expect(duplicateProduct(keyed, "gone", minter())).toBeNull();
  });

  it("steps the handle to -copy-2, and to -copy-3 past a -copy-2 already there", () => {
    const once = duplicateProduct(keyed, "product-0", minter());
    const twice = once && duplicateProduct(once.content, "product-0", minter());
    expect(twice?.copy.handle).toBe("alpine-shell-jacket-copy-2");

    const held = draftOf(
      jacket,
      { ...jacket, key: "c2", handle: "alpine-shell-jacket-copy-2", variants: [] },
      { ...jacket, key: "c1", handle: "alpine-shell-jacket-copy", variants: [] },
    );
    expect(duplicateProduct(held, "product-0", minter())?.copy.handle).toBe(
      "alpine-shell-jacket-copy-3",
    );
  });

  it("holds no SKU in the draft twice, nor one the copy has already taken", () => {
    // Another product already holds the SKU the copy's first variant would derive, and the
    // copy's two variants derive the same SKU as each other.
    const source: DraftProduct = {
      ...jacket,
      variants: [
        { ...jacket.variants[0], sku: "A", option_values: [{ key: "size", value: "M" }] },
        { ...jacket.variants[0], sku: "B", option_values: [{ key: "size", value: "m" }] },
      ],
    };
    const holder: DraftProduct = {
      ...jacket,
      key: "holder",
      handle: "holder",
      variants: [{ ...jacket.variants[0], sku: "ALPINE-SHELL-JACKET-COPY-M" }],
    };
    const result = duplicateProduct(draftOf(source, holder), "product-0", minter());

    const skus = result?.copy.variants.map((variant) => variant.sku);
    expect(skus).toEqual(["ALPINE-SHELL-JACKET-COPY-M-2", "ALPINE-SHELL-JACKET-COPY-M-3"]);
    const all = result?.content.products.flatMap((product) =>
      product.variants.map((variant) => variant.sku),
    );
    expect(new Set(all).size).toBe(all?.length);
  });

  it.each([60, 61, 62, 63, 64])(
    "keeps a copy of a %i-character handle, and its SKUs, within the cap and distinct",
    (length) => {
      const handle = "a".repeat(length);
      const source: DraftProduct = {
        ...jacket,
        handle,
        variants: [
          { ...jacket.variants[0], sku: "A", option_values: [{ key: "size", value: "M" }] },
          { ...jacket.variants[0], sku: "B", option_values: [{ key: "size", value: "L" }] },
        ],
      };
      const once = duplicateProduct(draftOf(source), "product-0", minter());
      const twice = once && duplicateProduct(once.content, "product-0", minter());

      for (const result of [once, twice]) {
        const copy = result?.copy as DraftProduct;
        expect(copy.handle.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
        expect(copy.handle).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        for (const variant of copy.variants) {
          expect(variant.sku.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
        }
      }
      // The source is cut to leave room for the suffix, rather than cut back to itself.
      expect(once?.copy.handle).toBe(`${"a".repeat(SLUG_MAX_LENGTH - COPY_SUFFIX.length)}-copy`);
      expect(twice?.copy.handle).not.toBe(once?.copy.handle);
      const all = twice?.content.products.flatMap((product) =>
        product.variants.map((variant) => variant.sku),
      );
      expect(new Set(all).size).toBe(all?.length);
    },
  );

  it("keeps two SKUs that agree only after the cut distinct", () => {
    // 64 characters of handle leave no room for the values, so both SKUs cut to the same base.
    const source: DraftProduct = {
      ...jacket,
      handle: "b".repeat(64),
      variants: [
        { ...jacket.variants[0], sku: "A", option_values: [{ key: "size", value: "M" }] },
        { ...jacket.variants[0], sku: "B", option_values: [{ key: "size", value: "L" }] },
      ],
    };
    const skus = duplicateProduct(draftOf(source), "product-0", minter())?.copy.variants.map(
      (variant) => variant.sku,
    );

    expect(skus?.[0]).not.toBe(skus?.[1]);
    expect(skus?.every((sku) => sku.length <= SLUG_MAX_LENGTH)).toBe(true);
  });
});
