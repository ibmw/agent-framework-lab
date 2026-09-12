import type {
  DefinitionIssueSchema,
  ProductSchema,
  ProductViewSchema,
  ShopContentSchema,
  ShopPayloadSchema,
  VariantSchema,
} from "@agent-lab/contracts";
import { slugify } from "./entryIds";

/** `MAX_SLUG_LENGTH` in `domain/content.py`, which rejects a longer one. */
const MAX_SLUG_LENGTH = 64;

/**
 * The slug a shop name suggests, in the spelling the shop identity rule accepts.
 *
 * The transliteration is `slugify`'s rather than a second one, so "Écoles" loses its accent
 * here exactly as it does in an entry ID. What differs is the two ends. The fallback is empty
 * rather than a word, because this fills a field a person is looking at: a name written in a
 * script with no ASCII to keep — where `slugify` has nothing to return — should leave the field
 * blank for them to answer, not put "entry" in it and let them publish that by not noticing.
 * And the result is cut to the length the domain accepts, then stripped again, since a cut can
 * land on a hyphen and a trailing hyphen is the one thing the pattern refuses.
 */
export function shopSlugFromName(name: string): string {
  return slugify(name, "").slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "");
}

/**
 * The API answers with derived read-only evidence (ratings, the resolved default tone)
 * that a draft write must not echo back. Editing therefore works on the returned content
 * and this projection strips the derived fields before every save.
 */
export function toPayload(content: ShopContentSchema): ShopPayloadSchema {
  return {
    identity: content.identity,
    products: content.products.map(toProductPayload),
    faq: content.faq,
    policies: content.policies,
    payment_methods: content.payment_methods,
    fulfilment_methods: content.fulfilment_methods,
    support_guidelines: content.support_guidelines,
    tone_of_voice_guidelines: content.tone_of_voice_guidelines,
  };
}

function toProductPayload(product: ProductViewSchema): ProductSchema {
  const { ratings: _ratings, ...payload } = product;
  return payload;
}

export function findProduct(
  content: ShopContentSchema,
  handle: string,
): ProductViewSchema | undefined {
  return content.products.find((product) => product.handle === handle);
}

export function replaceProduct(
  content: ShopContentSchema,
  handle: string,
  next: ProductViewSchema,
): ShopContentSchema {
  return {
    ...content,
    products: content.products.map((product) => (product.handle === handle ? next : product)),
  };
}

export function variantOptionLabel(variant: VariantSchema): string {
  return variant.option_values.map((option) => option.value).join(" · ") || "—";
}

export function variantPriceLabel(variant: VariantSchema): string {
  if (!variant.price) {
    return "missing";
  }
  return `${variant.price.amount} ${variant.price.currency}`;
}

export interface IssueGroups {
  errors: DefinitionIssueSchema[];
  warnings: DefinitionIssueSchema[];
}

export function groupIssues(issues: DefinitionIssueSchema[]): IssueGroups {
  return {
    errors: issues.filter((issue) => issue.severity === "error"),
    warnings: issues.filter((issue) => issue.severity === "warning"),
  };
}

/** Issues raised by one product, so the product editor can show its own findings. */
export function issuesForProduct(
  issues: DefinitionIssueSchema[],
  handle: string,
): DefinitionIssueSchema[] {
  const prefix = `products.${handle}`;
  return issues.filter((issue) => issue.path === prefix || issue.path.startsWith(`${prefix}.`));
}

export function ratingLabel(product: ProductViewSchema): string {
  if (product.ratings.review_count === 0) {
    return "No reviews";
  }
  const average = product.ratings.average_rating ?? "—";
  const plural = product.ratings.review_count === 1 ? "review" : "reviews";
  return `${average} · ${product.ratings.review_count} ${plural}`;
}
