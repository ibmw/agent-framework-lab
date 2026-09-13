import type { Currency } from "./currencies";

/** The shape `require_locale` in `domain/content.py` accepts: `en`, or `en-GB`. */
export const LOCALE_PATTERN = "[a-z]{2}(-[A-Z]{2})?";

export interface LocaleOption {
  /** The BCP 47 tag written to the identity, such as `fr-BE`. */
  tag: string;
  /** The language and place the tag names, for a reader who knows one but not the other. */
  label: string;
  /** What a shop in that place is ordinarily priced in, which the form offers as the answer. */
  currency: Currency;
}

/**
 * The locales the identity fields suggest — a shortlist, deliberately not the permitted set.
 *
 * The domain validates the *shape* of a locale and not its membership of a register, and says
 * why: a closed list would have to be maintained for no simulation benefit. Suggesting rather
 * than enumerating keeps that promise. An operator who needs `is-IS` can still type it and the
 * lab will take it; what the list removes is the ordinary failure, which is not an exotic
 * locale but `en_GB`, `EN-gb` or `fr-fr` typed from memory into an empty box.
 *
 * What bounds the shortlist is the currency rather than the language: these are the places the
 * lab can actually price a shop for, so every entry names a currency the domain expresses. A
 * Danish or Brazilian shop is still possible by typing the tag, but it would have to sell in
 * someone else's money, which is not an answer to offer somebody as the obvious one.
 *
 * Region-qualified throughout, because a bare `fr` is the weaker answer here: it names no place
 * to price for, and the customer editor reads the region back out to default an address
 * country. Ordered by language rather than alphabetically, so the variants of a language a
 * reader has already found sit together.
 */
/**
 * What an empty create form starts on. A shop must declare a locale and a currency, so the form
 * has to show some pairing before anybody has answered anything, and it should be one of the
 * pairings the form itself would go on to suggest rather than a third thing.
 */
export const DEFAULT_LOCALE: LocaleOption = {
  tag: "en-GB",
  label: "English (United Kingdom)",
  currency: "GBP",
};

export const LOCALES: readonly LocaleOption[] = [
  DEFAULT_LOCALE,
  { tag: "en-US", label: "English (United States)", currency: "USD" },
  { tag: "en-CA", label: "English (Canada)", currency: "CAD" },
  { tag: "en-AU", label: "English (Australia)", currency: "AUD" },
  { tag: "en-IE", label: "English (Ireland)", currency: "EUR" },
  { tag: "en-SG", label: "English (Singapore)", currency: "SGD" },
  { tag: "fr-FR", label: "French (France)", currency: "EUR" },
  { tag: "fr-BE", label: "French (Belgium)", currency: "EUR" },
  { tag: "fr-CA", label: "French (Canada)", currency: "CAD" },
  { tag: "fr-CH", label: "French (Switzerland)", currency: "CHF" },
  { tag: "de-DE", label: "German (Germany)", currency: "EUR" },
  { tag: "de-AT", label: "German (Austria)", currency: "EUR" },
  { tag: "de-CH", label: "German (Switzerland)", currency: "CHF" },
  { tag: "nl-NL", label: "Dutch (Netherlands)", currency: "EUR" },
  { tag: "nl-BE", label: "Dutch (Belgium)", currency: "EUR" },
  { tag: "es-ES", label: "Spanish (Spain)", currency: "EUR" },
  { tag: "it-IT", label: "Italian (Italy)", currency: "EUR" },
  { tag: "pt-PT", label: "Portuguese (Portugal)", currency: "EUR" },
  { tag: "fi-FI", label: "Finnish (Finland)", currency: "EUR" },
  { tag: "ja-JP", label: "Japanese (Japan)", currency: "JPY" },
  { tag: "zh-CN", label: "Chinese (mainland China)", currency: "CNY" },
  { tag: "zh-HK", label: "Chinese (Hong Kong)", currency: "HKD" },
];

/**
 * The currency a locale implies, or `undefined` when nothing in the shortlist names it.
 *
 * Undefined is the honest answer for a tag typed by hand: `is-IS` is a locale the lab accepts
 * and Icelandic króna is not a currency it expresses, so there is no currency to propose and
 * the form leaves the operator's standing answer alone rather than guessing at one.
 */
export function currencyForLocale(tag: string): Currency | undefined {
  return LOCALES.find((locale) => locale.tag === tag)?.currency;
}
