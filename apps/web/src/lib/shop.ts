import type {
  DefinitionIssueSchema,
  ProductSchema,
  ProductViewSchema,
  ShopContentSchema,
  ShopPayloadSchema,
  VariantSchema,
} from "@agent-lab/contracts";
import { clampSlug, SLUG_MAX_LENGTH, slugify, uniqueId, uniqueVariantSku } from "./entryIds";
import type { DraftProduct, ShopDraft } from "./productKeys";

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
  return clampSlug(slugify(name, ""), SLUG_MAX_LENGTH);
}

/**
 * The handle a brand-new product is addressed by, before it has a title to derive one from.
 *
 * The prototype appends a record with an empty handle and lets the editor ask for one
 * (:6931); this workspace addresses a product editor *by* its handle, so a product with no
 * handle has no address and cannot be opened. The draft's own handles decide the suffix, so a
 * second unnamed product is `new-product-2` rather than a collision.
 */
export const NEW_PRODUCT_HANDLE = "new-product";

/** Whether `handle` is one *New product* gives an unnamed product: `new-product`, `-2`, … */
export function isPlaceholderHandle(handle: string): boolean {
  return new RegExp(`^${NEW_PRODUCT_HANDLE}(?:-[0-9]+)?$`).test(handle);
}

/**
 * The API answers with derived read-only evidence (ratings, the resolved default tone)
 * that a draft write must not echo back, and the workspace keys each product for itself
 * (ADR 0061). Editing therefore works on the returned content and this projection strips
 * both before every save.
 */
export function toPayload(content: ShopContentSchema | ShopDraft): ShopPayloadSchema {
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

function toProductPayload(product: ProductViewSchema | DraftProduct): ProductSchema {
  const { ratings: _ratings, ...rest } = product;
  if ("key" in rest) {
    const { key: _key, ...payload } = rest;
    return payload;
  }
  return rest;
}

/** The product the draft holds under `key`, which no rename moves (ADR 0061). */
export function findProduct(content: ShopDraft, key: string): DraftProduct | undefined {
  return content.products.find((product) => product.key === key);
}

/**
 * The product the draft addresses by `handle` — only for an address that carries no key: one
 * typed, bookmarked, or from before a reload (ADR 0061).
 */
export function findProductByHandle(content: ShopDraft, handle: string): DraftProduct | undefined {
  return content.products.find((product) => product.handle === handle);
}

export function replaceProduct(content: ShopDraft, key: string, next: DraftProduct): ShopDraft {
  return {
    ...content,
    products: content.products.map((product) => (product.key === key ? next : product)),
  };
}

/**
 * The draft without the product it holds under `key` (ADR 0062). A draft edit like every other
 * on the catalog: nothing is written until the shop draft is saved, and a published version
 * keeps the product. By key, never by handle: the handle is data, and a handle captured
 * earlier may by now name another product (ADR 0061).
 */
export function removeProduct(content: ShopDraft, key: string): ShopDraft {
  return { ...content, products: content.products.filter((product) => product.key !== key) };
}

/**
 * The category spellings the draft's *other* products use, for the product editor's list.
 *
 * What the lab stores is the whole of the rule (`require_label` in `domain/content.py`,
 * applied to `Product.category` in `domain/shop.py`): non-empty text without padding, at most
 * 200 characters, and nothing else — no vocabulary, and no case folding. So:
 *
 * - **Case is kept.** `Jackets` and `jackets` are two categories to the lab and to every tool
 *   that answers with one, and both are offered: seeing the two side by side is how an operator
 *   correcting a category finds out which spelling the catalog already settled on. Folding
 *   them would pick one silently and hide the fragmentation the list is here to prevent.
 * - **Padding is trimmed**, and spellings that differ only by it are one. The lab refuses a
 *   padded category, so a padded spelling can only be an unsaved edit, and the spelling it
 *   offers is the one that edit would have to become to be saved.
 * - **An empty or blank category offers nothing.** A new product arrives with none.
 * - **Inner whitespace is kept**, as the lab keeps it: `Base layers` is a spelling.
 *
 * Sorted, so the list reads as a vocabulary rather than as the order products were added in.
 * The product under `exceptKey` is left out: its own category is in its field already.
 */
export function draftCategories(content: ShopDraft, exceptKey: string): string[] {
  const spellings = content.products
    .filter((product) => product.key !== exceptKey)
    .map((product) => product.category.trim())
    .filter((category) => category !== "");
  return [...new Set(spellings)].sort((left, right) => left.localeCompare(right));
}

/** What a copy's handle adds to its source's (ADR 0062). */
export const COPY_SUFFIX = "-copy";

/**
 * A copy of the product the draft holds under `key`, appended to the draft (ADR 0062).
 *
 * Everything authored is copied — description, options, media, typed attributes, the synthetic
 * reviews, each variant's values, price, stock and availability — under names nothing else
 * holds. The handle is the source's cut to leave room for `-copy`, then made free among the
 * draft's handles; every SKU is derived again from that handle and the variant's own option
 * values, exactly as the editor suggests one, and made free among every SKU in the draft and
 * every SKU the copy has already taken, because SKUs are unique across the whole shop — so no
 * SKU in the draft is held twice (a SKU only a deleted product had may be taken again; ADR
 * 0062). At the 64-character cap a stepped copy reads `<…>-co-2`: `uniqueId` cuts the whole base
 * again for its own suffix. Both are
 * clamped to the 64 characters `domain/content.py` allows *before* they are made unique
 * (`uniqueId`, `uniqueVariantSku`), so two that agree only after the cut stay distinct.
 *
 * The copy is a **draft** whatever the source was, so an agent is never handed two identical
 * active products before anyone has said how they differ. It carries a key freshly minted by
 * the workspace (`mint`), never one the keyring knows as saved: it is new to the draft, and a
 * discard that takes it back must leave its page for the catalog (ADR 0061, S4).
 */
export function duplicateProduct(
  content: ShopDraft,
  key: string,
  mint: () => string,
): { content: ShopDraft; copy: DraftProduct } | null {
  const source = findProduct(content, key);
  if (!source) {
    return null;
  }
  // The source is cut to leave room for `-copy` rather than the whole being cut after it: a
  // 64-character handle would otherwise be cut straight back to itself.
  const handle = uniqueId(
    `${clampSlug(source.handle, SLUG_MAX_LENGTH - COPY_SUFFIX.length)}${COPY_SUFFIX}`,
    content.products.map((product) => product.handle),
  );
  const taken = content.products.flatMap((product) =>
    product.variants.map((variant) => variant.sku),
  );
  const variants = source.variants.map((variant) => {
    const { value: sku } = uniqueVariantSku(
      handle,
      variant.option_values.map((chosen) => chosen.value),
      taken,
    );
    taken.push(sku);
    return { ...variant, sku };
  });
  const copy: DraftProduct = {
    ...source,
    key: mint(),
    handle,
    title: source.title === "" ? "" : `${source.title} (copy)`,
    status: "draft",
    variants,
  };
  return { content: { ...content, products: [...content.products, copy] }, copy };
}

/**
 * The product without one option, and without the value every variant chose for it.
 *
 * A variant that kept the value would be choosing for an option the product no longer
 * declares — `variant_unknown_option`, an error — and no control on the variant row can take
 * a value out, so the removal takes it with it. That is what the confirm says happens to them.
 */
export function removeOption<P extends ProductViewSchema>(product: P, key: string): P {
  return {
    ...product,
    options: product.options.filter((option) => option.key !== key),
    variants: product.variants.map((variant) => ({
      ...variant,
      option_values: variant.option_values.filter((chosen) => chosen.key !== key),
    })),
  };
}

/**
 * What `validate_shop` compares two variants by: `tuple(sorted(option_values))`, so the order a
 * variant lists its values in does not matter and their spelling — case included — does.
 */
function combination(variant: VariantSchema): string {
  return JSON.stringify(
    variant.option_values
      .map((chosen) => [chosen.key, chosen.value])
      // UTF-16 order rather than Python's code-point order. The two differ only past the Basic
      // Multilingual Plane, and it does not matter here: signatures are compared only with
      // each other, so any order applied to both sides answers the same equality.
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

/** One group of variants a removal leaves identical, and which of them already were. */
export interface VariantCollision {
  skus: string[];
  /** What they would share, in the first variant's own order. */
  values: string;
  /**
   * Every part of the group that is identical *today*, each with the values it shares today —
   * none, where the removal alone makes them identical.
   */
  before: { skus: string[]; values: string }[];
}

/** What a variant's values read as in a collision: its own order, or that it has none. */
function sharedValues(variant: VariantSchema): string {
  return variant.option_values.length === 0 ? "no option values" : variantOptionLabel(variant);
}

/**
 * The variants that removing one option would leave choosing the same values, grouped.
 *
 * `validate_shop` refuses a product whose variants repeat a combination
 * (`duplicate_variant_options`, an error), so a removal that merges two variants is a removal
 * the confirm has to say will block publishing. Nothing is deleted to avoid it: which of two
 * variants to keep, or what to tell them apart by, is the operator's.
 *
 * Where parts of a group are identical already, `before` says which parts and what each shares
 * today, so the confirm does not blame the removal for a refusal the draft already carries.
 * Values are written in the variant's own order, as `variantOptionLabel` writes them.
 */
export function variantCollisions(product: ProductViewSchema, key: string): VariantCollision[] {
  const today = new Map(product.variants.map((variant) => [variant.sku, variant]));
  const groups = new Map<string, { skus: string[]; values: string }>();
  for (const variant of removeOption(product, key).variants) {
    const signature = combination(variant);
    const group = groups.get(signature) ?? {
      skus: [],
      values: sharedValues(variant),
    };
    group.skus.push(variant.sku);
    groups.set(signature, group);
  }
  return [...groups.values()]
    .filter((group) => group.skus.length > 1)
    .map((group) => {
      const shared = new Map<string, string[]>();
      for (const sku of group.skus) {
        const variant = today.get(sku);
        if (variant) {
          const signature = combination(variant);
          shared.set(signature, [...(shared.get(signature) ?? []), sku]);
        }
      }
      const before = [...shared.values()]
        .filter((skus) => skus.length > 1)
        .map((skus) => {
          const first = today.get(skus[0]);
          return { skus, values: first ? sharedValues(first) : "" };
        });
      return { ...group, before };
    });
}

/** How many of a product's variants choose a value of one option. */
export function variantsChoosing(product: ProductViewSchema, key: string): number {
  return product.variants.filter((variant) =>
    variant.option_values.some((chosen) => chosen.key === key),
  ).length;
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

/**
 * What a product is called on screen before anyone has named it.
 *
 * *New product* appends a product with no title and opens its editor (PLAN-UX Slice 12), and
 * the operator can leave it unnamed — the catalog saves the shop draft too, so nothing asks
 * on the way back. An empty string would leave the catalog with a link that has no
 * accessible name and nothing to click, and the editor with an empty `<h1>`. One stand-in
 * here so the two surfaces cannot come to disagree about what an unnamed product is called.
 */
export const UNTITLED_PRODUCT = "Untitled product";

export function productTitle(product: ProductViewSchema): string {
  return product.title === "" ? UNTITLED_PRODUCT : product.title;
}

export function ratingLabel(product: ProductViewSchema): string {
  if (product.ratings.review_count === 0) {
    return "No reviews";
  }
  const average = product.ratings.average_rating ?? "—";
  const plural = product.ratings.review_count === 1 ? "review" : "reviews";
  return `${average} · ${product.ratings.review_count} ${plural}`;
}

/**
 * The surfaces that render the shop draft's own Save, relative to `/shops/:shopId`.
 *
 * The shop draft is the workspace's one editor that outlives the page editing it: it is held by
 * `ShopWorkspace`, the layout route, so it survives every move inside the shop. That makes
 * "leaving the page" the wrong question for it and "leaving the reach of its Save" the right
 * one. Home, Products, the product editor and the four setup pages each draw the button; Orders,
 * Customers, Tickets, the bench and the rest do not, so an edit carried there is an edit with
 * nothing on screen that can write it — which is what PLAN-UX Slice 8's evidence describes when
 * an operator edits a product description and clicks Orders in the rail.
 */
export function shopDraftIsSavableAt(shopId: string, pathname: string): boolean {
  const home = `/shops/${shopId}`;
  if (pathname === home) {
    return true;
  }
  const rest = pathname.startsWith(`${home}/`) ? pathname.slice(home.length + 1) : null;
  if (rest === null) {
    return false;
  }
  const [section] = rest.split("/");
  return section === "products" || section === "setup";
}
