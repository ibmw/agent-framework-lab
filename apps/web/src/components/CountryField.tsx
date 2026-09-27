import { useId } from "react";
import { COUNTRIES, COUNTRY_PATTERN, countryName } from "../lib/countries";
import { COUNTRY_RULE } from "../lib/fieldRules";
import { fieldControlClasses } from "../lib/ui";
import { FieldHint } from "./FieldHint";

/**
 * The Country field, wherever an address carries one.
 *
 * Built on `LocaleField`: a `<datalist>` rather than a `<select>`, because the lab accepts
 * any two-letter code and a dropdown would refuse in the browser what the API would take.
 * Typing `fr` offers France beside its code; typing `ZZ` is still allowed to stand.
 *
 * The code is what the address stores, so the code is what the input holds and the name is
 * read back beneath it through `FieldHint`'s `extra` slot — the same pairing `LocaleField`
 * uses for `en-GB`, and for the same reason: `FR` and `FI` are one keystroke apart and a
 * field that shows only the code cannot tell an operator which one they typed.
 *
 * Typing is uppercased here rather than at each call site, because the domain stores the
 * uppercase form and the address book had two call sites doing it by hand.
 *
 * `autoComplete="off"` keeps the browser's own address autofill from covering the
 * suggestions, and the list is built per instance — `useId` rather than a constant — so the
 * address book's several rows do not share one `id`.
 */
export function CountryField({
  value,
  required = false,
  onChange,
}: {
  value: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const named = countryName(value);
  return (
    <div>
      <FieldHint label="Country" hint={COUNTRY_RULE} extra={named}>
        <input
          className={`${fieldControlClasses} w-full`}
          list={listId}
          value={value}
          required={required}
          pattern={COUNTRY_PATTERN}
          title={COUNTRY_RULE}
          placeholder="FR"
          autoComplete="off"
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
      </FieldHint>
      <datalist id={listId}>
        {COUNTRIES.map((country) => (
          <option key={country.code} value={country.code} label={country.name} />
        ))}
      </datalist>
    </div>
  );
}
