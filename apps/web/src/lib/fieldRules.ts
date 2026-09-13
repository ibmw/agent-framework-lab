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
  "Lowercase with hyphens. Tools address the product by this handle.";

/** Uppercase alphanumeric kebab-case, as order and ticket references are stored. */
export const REFERENCE_PATTERN = "[A-Z0-9]+(-[A-Z0-9]+)*";

export const ORDER_REFERENCE_RULE =
  "Uppercase letters, digits, and hyphens. How the order is named in tickets.";

export const TICKET_REFERENCE_RULE =
  "Uppercase letters, digits, and hyphens. How the ticket is named in scenarios.";

export const LOCALE_RULE = "Pick a locale from the list, or type another shaped like en or en-GB.";

/** What publishing does with the identity a configuration names. */
export const SUPPORT_IDENTITY_PIN_RULE =
  "Publishing pins the support-identity version a configuration names.";
