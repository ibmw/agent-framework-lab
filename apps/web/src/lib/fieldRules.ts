/**
 * Format rules that a create-form hint and its matching `title=` both carry.
 *
 * `title=` may feed the browser's native validity message; the hint is the readable
 * carrier. One constant per rule so the two cannot drift.
 */

/** Lowercase kebab-case, as shop slugs and product handles are stored. */
export const KEBAB_PATTERN = "[a-z0-9]+(-[a-z0-9]+)*";

export const SHOP_SLUG_RULE =
  "Lowercase with hyphens. Follows the name until you edit it; empty it to follow the name again.";

export const PRODUCT_HANDLE_RULE =
  "Lowercase with hyphens. Tools address the product by this handle. Follows the title until you edit it; empty it to follow the title again.";

/** Shop-detail and product-editor entry IDs that follow a name, title or question. */
export const DERIVED_KEBAB_RULE =
  "Lowercase with hyphens. Follows the field above until you edit it; empty it to follow again.";

/** Uppercase alphanumeric kebab-case, as order and ticket references are stored. */
export const REFERENCE_PATTERN = "[A-Z0-9]+(-[A-Z0-9]+)*";

export const ORDER_REFERENCE_RULE =
  "Uppercase letters, digits, and hyphens. How the order is named in tickets. Prefills the next free reference; empty it to take that suggestion again.";

export const TICKET_REFERENCE_RULE =
  "Uppercase letters, digits, and hyphens. How the ticket is named in scenarios. Prefills the next free reference; empty it to take that suggestion again.";

export const VARIANT_SKU_RULE =
  "Uppercase letters, digits, and hyphens. Follows the handle and chosen options until you edit it; empty it to follow again.";

export function alreadyTakenMessage(id: string, place: string): string {
  return `${id} is already ${place}.`;
}

/**
 * What ticking a currency decides. Both clauses are the lab's own: `ShopPayload.validate` in
 * `domain/shop.py` refuses a variant priced outside `identity.currencies`, and
 * `ShopIdentity.default_currency` is the first of them.
 */
export const CURRENCIES_RULE = "Variants may only be priced in these; the first is the default.";

export const LOCALE_RULE = "Pick a locale from the list, or type another shaped like en or en-GB.";

/** What publishing does with the identity a configuration names. */
export const SUPPORT_IDENTITY_PIN_RULE =
  "Publishing pins the support-identity version a configuration names.";

/**
 * Where a country code is asked for. The shape is the lab's — `require_country_code` in
 * `domain/content.py` takes two letters and deliberately does not check the register — so the
 * rule says what is accepted and the field suggests the register beside it.
 */
export const COUNTRY_RULE =
  "Pick a country from the list, or type another two-letter code like FR.";

/**
 * What the contract's `MoneySchema.amount` accepts: up to ten digits, and at most two after
 * the point. Both the pattern and this sentence are that rule, so a price and a shipping fee
 * are refused in the same words wherever they are typed.
 */
export const MONEY_PATTERN = "\\d{1,10}(\\.\\d{1,2})?";

export const MONEY_RULE = "An exact amount with at most two decimals, like 249.00.";

/** Whether a typed amount is one `MoneySchema` would carry. */
export function isMoneyAmount(value: string): boolean {
  return new RegExp(`^${MONEY_PATTERN}$`).test(value);
}

/**
 * What the contract's temperature accepts (`^\d(?:\.\d{1,2})?$`) inside the range
 * `agent_configuration.py` and `judge.py` both enforce (`0 <= t <= MAX_TEMPERATURE`, which is
 * 2). The pattern cannot say the upper bound on its own — it would take `9` — so the hint
 * carries the range and the domain stays the authority.
 */
export const TEMPERATURE_PATTERN = "\\d(\\.\\d{1,2})?";

export const TEMPERATURE_RULE =
  "Between 0 and 2, with at most two decimals. An exact decimal, never a binary float: it is part of what a published version is fingerprinted on.";

/** The bound the contract puts on a seed: a whole number inside one unsigned 32-bit word. */
export const MAX_SEED = 2 ** 32 - 1;

export const SEED_RULE = `A whole number between 0 and ${MAX_SEED}. The same seed over the same starting state replays the same run.`;

/** The five lists that enter their values one at a time; each is `_require_unique` in the domain. */
export const OPTION_VALUES_RULE =
  "One value per chip. Every variant chooses one of these, and each must be different.";

export const ATTRIBUTE_CHOICES_RULE =
  "One choice per chip, each different. The attribute's value must be one of them.";

export const PERSONA_TRAITS_RULE =
  "One short trait per chip, each different, written as a reader should see it.";

/**
 * What the lab stores a tag as: `_require_slug` in `domain/ticket.py`.
 *
 * The sentence names the *shape* and leaves the respelling to the live "Saved as" line beside
 * it, which is the paired-line convention doing its job. Describing the transformation in
 * words would take three clauses to be true — `slugify` folds an accent to its base letter
 * rather than to a hyphen, collapses an inner run to one hyphen rather than one each, and
 * drops edge runs entirely — and a hint that gets any of them slightly wrong is the defect
 * this slice exists to remove.
 */
export const TICKET_TAGS_RULE =
  "One tag per chip, each different. Saved as lowercase letters, digits and hyphens, like refund-urgent.";

export const ESCALATION_CONDITIONS_RULE =
  "One condition per chip, each different. Naming any needs an escalation target above.";

/** What `ReviewSchema.rating` carries: a whole number of stars between one and five. */
export const REVIEW_RATING_RULE = "A whole number of stars, from one to five.";

/**
 * What the contract caps one entry of a chip list at, so the field stops where the save would.
 *
 * A ticket tag is a slug (`openapi.yaml` `TicketPayloadSchema.tags`, 64); an option value, an
 * attribute choice, a persona trait and an escalation condition are labels (200). The two
 * numbers are the contract's, not a house style, and they are here beside the patterns for the
 * reason those are: one spelling, so a field and the gate behind it cannot disagree.
 */
export const CHIP_LABEL_MAX_LENGTH = 200;

export const TICKET_TAG_MAX_LENGTH = 64;
