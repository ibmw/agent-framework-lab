import { useId } from "react";
import { LOCALE_RULE } from "../lib/fieldRules";
import { LOCALE_PATTERN, LOCALES } from "../lib/locales";
import { fieldControlClasses } from "../lib/ui";
import { type Arrangement, FieldHint } from "./FieldHint";

/**
 * The Locale field, wherever an identity carries one.
 *
 * A `<datalist>` rather than a `<select>`, because the lab accepts any well-shaped tag and a
 * dropdown would refuse in the browser what the API would have taken. So this suggests: typing
 * `fr` offers the French locales, and typing `is-IS` is still allowed to stand.
 *
 * `autoComplete="off"` keeps the browser's own address autofill from covering the suggestions,
 * which is the one thing that reliably hides them. The list is built per instance — `useId`
 * rather than a constant — so two of these on one page do not share an `id`.
 *
 * `arrangement` is `FieldHint`'s, passed straight through: this field labels itself, so a card
 * on the form pattern asks it to draw itself as a row rather than wrapping it in one.
 */
export function LocaleField({
  value,
  required = false,
  arrangement,
  onChange,
}: {
  value: string;
  required?: boolean;
  arrangement?: Arrangement;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  // The place the tag names, read back under the field: `en-GB` is a string an operator can
  // mistype into something plausible, and the echo is how they see that they did. Nothing is
  // echoed for a tag the shortlist does not name — the lab takes it, and this component has
  // no words for it, so saying nothing is the honest answer rather than repeating the tag.
  const named = LOCALES.find((locale) => locale.tag === value);
  return (
    <div>
      <FieldHint label="Locale" hint={LOCALE_RULE} extra={named?.label} arrangement={arrangement}>
        <input
          className={fieldControlClasses}
          list={listId}
          value={value}
          required={required}
          pattern={LOCALE_PATTERN}
          title={LOCALE_RULE}
          placeholder="en-GB"
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
      </FieldHint>
      <datalist id={listId}>
        {LOCALES.map((locale) => (
          <option key={locale.tag} value={locale.tag} label={locale.label} />
        ))}
      </datalist>
    </div>
  );
}
