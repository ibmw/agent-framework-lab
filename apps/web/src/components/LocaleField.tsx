import { useId } from "react";
import { LOCALE_PATTERN, LOCALES } from "../lib/locales";
import { fieldControlClasses, fieldLabelClasses } from "../lib/ui";

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
 */
export function LocaleField({
  value,
  required = false,
  onChange,
}: {
  value: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  return (
    <label className={fieldLabelClasses}>
      Locale
      <input
        className={fieldControlClasses}
        list={listId}
        value={value}
        required={required}
        pattern={LOCALE_PATTERN}
        title="Pick a locale from the list, or type another shaped like en or en-GB."
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {LOCALES.map((locale) => (
          <option key={locale.tag} value={locale.tag} label={locale.label} />
        ))}
      </datalist>
    </label>
  );
}
