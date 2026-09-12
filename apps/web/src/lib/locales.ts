/** The shape `require_locale` in `domain/content.py` accepts: `en`, or `en-GB`. */
export const LOCALE_PATTERN = "[a-z]{2}(-[A-Z]{2})?";

export interface LocaleOption {
  /** The BCP 47 tag written to the identity, such as `fr-BE`. */
  tag: string;
  /** The language and place the tag names, for a reader who knows one but not the other. */
  label: string;
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
 * Region-qualified throughout, because a bare `fr` is the weaker answer here: the customer
 * editor reads the region back out to default an address country, so `fr` leaves a field empty
 * that `fr-FR` fills. Ordered by language rather than alphabetically, so the variants of a
 * language a reader has already found sit together.
 */
export const LOCALES: readonly LocaleOption[] = [
  { tag: "en-GB", label: "English (United Kingdom)" },
  { tag: "en-US", label: "English (United States)" },
  { tag: "en-CA", label: "English (Canada)" },
  { tag: "en-AU", label: "English (Australia)" },
  { tag: "en-IE", label: "English (Ireland)" },
  { tag: "fr-FR", label: "French (France)" },
  { tag: "fr-BE", label: "French (Belgium)" },
  { tag: "fr-CA", label: "French (Canada)" },
  { tag: "fr-CH", label: "French (Switzerland)" },
  { tag: "de-DE", label: "German (Germany)" },
  { tag: "de-AT", label: "German (Austria)" },
  { tag: "de-CH", label: "German (Switzerland)" },
  { tag: "nl-NL", label: "Dutch (Netherlands)" },
  { tag: "nl-BE", label: "Dutch (Belgium)" },
  { tag: "es-ES", label: "Spanish (Spain)" },
  { tag: "es-MX", label: "Spanish (Mexico)" },
  { tag: "it-IT", label: "Italian (Italy)" },
  { tag: "pt-PT", label: "Portuguese (Portugal)" },
  { tag: "pt-BR", label: "Portuguese (Brazil)" },
  { tag: "da-DK", label: "Danish (Denmark)" },
  { tag: "sv-SE", label: "Swedish (Sweden)" },
  { tag: "nb-NO", label: "Norwegian Bokmål (Norway)" },
  { tag: "fi-FI", label: "Finnish (Finland)" },
  { tag: "pl-PL", label: "Polish (Poland)" },
  { tag: "cs-CZ", label: "Czech (Czechia)" },
  { tag: "ja-JP", label: "Japanese (Japan)" },
];
