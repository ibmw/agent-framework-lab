import type { ShopContentSchema } from "@agent-lab/contracts";

/** What `Currency` in `domain/shop.py` permits; the contract is the only authority on it. */
export type Currency = ShopContentSchema["identity"]["currencies"][number];

export interface CurrencyOption {
  code: Currency;
  /** The currency's name, for a reader who knows the money but not the three letters. */
  label: string;
}

/**
 * Every currency the lab can express, in the domain's own order — the ten most traded.
 *
 * Unlike the locale shortlist this is the permitted set and not a suggestion: the domain
 * closes the list, so a currency missing here is one the API would refuse. Adding one is a
 * change to the enum and the contract, not to this file.
 */
export const CURRENCIES: readonly CurrencyOption[] = [
  { code: "USD", label: "US dollar" },
  { code: "EUR", label: "Euro" },
  { code: "JPY", label: "Japanese yen" },
  { code: "GBP", label: "Pound sterling" },
  { code: "CNY", label: "Renminbi" },
  { code: "AUD", label: "Australian dollar" },
  { code: "CAD", label: "Canadian dollar" },
  { code: "CHF", label: "Swiss franc" },
  { code: "HKD", label: "Hong Kong dollar" },
  { code: "SGD", label: "Singapore dollar" },
];
