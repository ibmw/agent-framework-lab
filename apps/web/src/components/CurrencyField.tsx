import { useEffect, useRef, useState } from "react";
import type { Currency } from "../lib/currencies";
import { CURRENCY, labelOf, membersOf } from "../lib/enumLabels";
import { CURRENCIES_RULE } from "../lib/fieldRules";
import { FieldGroupHint } from "./FieldHint";

/**
 * The currencies a shop sells in: one checkbox per currency the lab can express, in the
 * domain's order, with the set's rule under the group.
 *
 * Taken from the Shop details group, which is where a shop's second currency had to be added
 * until now. A create form that offers one currency and a details page that offers ten is a
 * form that sends an operator to another page to finish the sentence they were writing, so
 * both surfaces render this.
 *
 * The last ticked box stays ticked rather than failing at save: a shop must sell in at least
 * one currency (`ShopIdentity.validate`), and the form saying so before the save is the
 * cheaper place to learn it.
 *
 * `value` is in the operator's own ticking order and not the table's, because the first entry
 * is the shop's default currency. A component that sorted the list would quietly decide that.
 *
 * The boxes stay in the table's order — ticked ones floated to the front would move under the
 * pointer that ticked them — so nothing on screen shows which entry is first. The group's
 * second line says it instead: the hint claims a default exists and this names it, the way
 * `DerivedIdField` previews the identifier its own hint promises.
 */
export function CurrencyField({
  value,
  suggested,
  onChange,
}: {
  value: readonly Currency[];
  /**
   * A currency to tick on the operator's behalf — the locale's — which holds on the terms
   * `DerivedIdField` holds a slug on: it follows the source until the operator answers, and
   * the answer then stands. Omitted where nothing suggests anything, as on a saved identity.
   *
   * There is no way back, because a checkbox group cannot be emptied the way a slug can: at
   * least one currency must stay ticked, so there is no state that reads as "no answer yet"
   * and would hand the suggestion back. Reloading the form is the way back.
   *
   * Passing this together with a `value` of several currencies would tick the suggestion over
   * all of them on mount; `DerivedIdField` overwrites a pre-filled value on the same terms, so
   * this is that primitive's behaviour rather than a case to special-case here.
   */
  suggested?: Currency;
  onChange: (currencies: Currency[]) => void;
}) {
  const [chosen, setChosen] = useState(false);
  const chosenRef = useRef(chosen);
  chosenRef.current = chosen;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Follow the suggestion when *it* changes, the effect `DerivedIdField` follows its source
  // with. Nothing is proposed for a locale the shortlist has no currency for, so a hand-typed
  // `is-IS` leaves the standing answer alone rather than reaching for the nearest guess.
  useEffect(() => {
    if (suggested !== undefined && !chosenRef.current) {
      onChangeRef.current([suggested]);
    }
  }, [suggested]);

  function toggle(code: Currency) {
    setChosen(true);
    if (!value.includes(code)) {
      onChange([...value, code]);
      return;
    }
    if (value.length === 1) {
      return;
    }
    onChange(value.filter((entry) => entry !== code));
  }

  // Only the derived value, on `DerivedIdField`'s shape: the rules sit in the hint above,
  // which does not change, so a polite region that re-reads on every tick would be announcing
  // sentences nobody changed.
  const [first] = value;

  return (
    <FieldGroupHint
      legend="Currencies"
      // The plan's sentence verbatim, then the rule the disabled last box cannot state. That
      // rule is the lab's — `ShopIdentity.validate` in `domain/shop.py` refuses an empty set —
      // and a checkbox that cannot be clicked is not a place to read it.
      hint={<>{CURRENCIES_RULE} A shop sells in at least one.</>}
      extra={first ? `Default: ${first} — ${labelOf(CURRENCY, first)}.` : undefined}
    >
      {/* Wrapped rather than columned: the same ten boxes sit in the 340px create card and
          across the width of Shop details, and a column rule wide enough for "AUD —
          Australian dollar" gives the narrow card ten rows and pushes Create off-screen. */}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 font-normal text-[13px] text-lab-ink">
        {membersOf(CURRENCY).map((code) => (
          <label key={code} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={value.includes(code)}
              disabled={value.length === 1 && value[0] === code}
              onChange={() => toggle(code)}
            />
            {code} — {labelOf(CURRENCY, code)}
          </label>
        ))}
      </div>
    </FieldGroupHint>
  );
}
