import type {
  DefinitionIssueSchema,
  ProductSchema,
  ProductViewSchema,
  ShopContentSchema,
  ShopPayloadSchema,
  VariantSchema,
} from "@agent-lab/contracts";

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
