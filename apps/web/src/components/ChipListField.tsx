import { type KeyboardEvent, type ReactNode, useId, useState } from "react";
import { savedAsPreview } from "../lib/fieldPreviews";
import { alreadyTakenMessage } from "../lib/fieldRules";
import { pythonStrip } from "../lib/pythonText";
import { useRemoval } from "../lib/removal";
import { fieldControlClasses, itemFormTracksClasses, subtleFieldButtonClasses } from "../lib/ui";
import { ButtonIcon } from "./ButtonIcon";
import { ConfirmRemove, RemovalNotice } from "./ConfirmRemove";
import { FieldHint } from "./FieldHint";

/**
 * The pill one short value is drawn as, and the row they wrap in: frame 2c's option values,
 * frame 6b's persona traits.
 *
 * Module-private and deliberately not named for the workspace as a whole. These are the two
 * renderings this file owns — the read-only pill and the one with a remove button — and
 * whether any other chip in the workspace should be drawn from the same classes is a question
 * for the slice that looks at those chips, not one to answer from here.
 */
const pillClasses = "inline-flex items-center rounded-full border border-admin-border py-0.5";

const pillRowClasses = "flex flex-wrap items-center gap-1.5 text-[13px]";

/**
 * The same chips, read-only: a saved option's values, a saved attribute's choices.
 *
 * Frame 2c draws an option's values as pills on the saved row and nowhere draws them as one
 * `·`-joined string, which is what the row rendered before. The row stays read-only — opening
 * a saved entry's fields in place is PLAN-UX Slice 7 — so this is the pill without the button.
 */
export function ChipList({ label, values }: { label: string; values: readonly string[] }) {
  return (
    // Named, because several of these sit in one card and "list, 2 items" says which of the
    // product's options a reader has reached only if the list says so itself.
    <ul aria-label={label} className={pillRowClasses}>
      {values.map((value) => (
        <li key={value} className={`${pillClasses} [overflow-wrap:anywhere] px-2.5`}>
          {value}
        </li>
      ))}
    </ul>
  );
}

type ChipListFieldProps = {
  /** Names the group: what this list *is* ("Values", "Tags"). */
  legend: string;
  /** Names the control that takes the next one ("New tag"), for a reader; it is not drawn. */
  label: string;
  hint: ReactNode;
  /** The button that commits what is typed ("Add tag"). */
  addLabel: string;
  placeholder?: string;
  values: readonly string[];
  /** How a typed value is spelled when stored. Omitted where it is stored as written. */
  normalize?: (value: string) => string;
  /**
   * The contract's own cap on one entry of this list, so the field stops where the save would.
   * Every caller has one — 64 for a ticket tag, 200 for the other four — and passing it is what
   * keeps a 300-character trait from being typed, chipped, and then refused a save later.
   */
  maxLength: number;
  /** Completes "{value} is already {takenPlace}." */
  takenPlace?: string;
  /**
   * Where a value is not trivially typed again — an escalation condition is a sentence the
   * identity's behaviour turns on — its remove asks a second time, and the confirm takes the
   * chip's place (ADR 0060). Omitted on the lists whose values are one word re-typed in the
   * field below them, where the second press would cost more than the value.
   */
  confirmRemoval?: {
    /** What the list belongs to, so a confirm never follows the operator to another one. */
    scope: string;
    title: (value: string) => string;
    /** Given the value and the whole list, which is what says whether it is the last one. */
    consequence: (value: string, values: readonly string[]) => string;
    /** What the list's notice line says once the value has gone. */
    notice: (value: string) => string;
  };
  /**
   * The id of a line elsewhere on the form that says why the list as it stands is refused — an
   * option with no value, said after the buttons of the form below the options (ADR 0074). The
   * field that takes the next value is marked invalid and described by that line.
   */
  refusedBy?: string;
  onChange: (values: string[]) => void;
} & (
  | {
      /**
       * On its own under a card's rows, the input taking the width the *Add* button leaves it.
       * The card has no refusal line of its own — traits, tags, conditions, hidden facts — so
       * the list says when it holds nothing, in `empty`.
       */
      placement: "card";
      /** What the list says when it holds nothing. */
      empty: string;
    }
  | {
      /**
       * Across the grid of the form below a list (`ItemFormRow`): the input takes one track as
       * the fields above it do and *Add* the next. It draws no line for an empty list: the
       * form's refusal line names the missing value as soon as the rest is filled
       * (`OPTION_NEEDS_VALUE`, `ATTRIBUTE_NEEDS_CHOICE`), and a line of its own would say the
       * same rule twice.
       */
      placement: "item-form";
    }
);

/**
 * A list of short values entered one at a time: each saved value is a chip with a named
 * remove button, and a duplicate is refused where it was typed rather than dropped.
 *
 * Taken from the two lists that hand-rolled this — the ticket's tags and the customer's
 * persona traits — which differed in two ways that are settled here rather than averaged:
 *
 * - **Normalisation is a prop, not a policy.** Tags are stored as slugs and traits are stored
 *   as the operator wrote them ("mildly anxious", which frame 6b draws with its space). A
 *   component that normalised for everyone would rewrite a trait, and one that normalised for
 *   nobody would put the caller's rewriting *after* `onChange`, where this component can
 *   neither compare a candidate against what is already stored nor show what it will save.
 *   `DerivedIdField` already asks for this exact function under this exact name, so the
 *   workspace has one answer to the question and this is it.
 * - **The remove button is always named.** Tags labelled theirs and traits did not, so a
 *   reader without a pointer heard "✕" three times on the persona card. The glyph is
 *   decorative here and the name is "Remove Ocean Blue", on every list.
 *
 * **Duplicates are the component's job.** Each of the five lists this serves is
 * `_require_unique` in the domain — option values, attribute choices, persona traits, ticket
 * tags, escalation conditions — so refusal is one rule the lab applies to all of them rather
 * than five callers' preferences. It is said as it is typed, on `DerivedIdField`'s collision
 * model: the line under the field turns to the error treatment and is announced, the field is
 * marked invalid, and pressing Add does nothing. Silence would have been the fifth copy of
 * the bug this component replaces.
 *
 * **One label for one control.** The legend is the only label drawn: it names the group and
 * sits over the field that takes the next value, as "Option name" sits over its input. The
 * input's own label ("New value") is not drawn, and the input is named by the two together —
 * "Values New value", the drawn words first (WCAG 2.5.3) — so a reader still hears which
 * control of the group they are on and nobody sees two labels stacked over one input. The *Add*
 * button stands beside the input at its height, top-aligned and so level with it, and the hint
 * runs under the input alone.
 *
 * There is no `<form>` here and the Add control is a plain button: three of the five lists sit
 * *inside* another form — the product editor's add-option and add-attribute forms — and a
 * nested form is not a thing the HTML parser will build. Enter in the field adds a chip and is
 * stopped from reaching the form outside it, which is the behaviour the nesting would
 * otherwise have stolen.
 */
export function ChipListField(props: ChipListFieldProps) {
  const {
    legend,
    label,
    hint,
    addLabel,
    placeholder,
    placement,
    values,
    normalize,
    maxLength,
    takenPlace = "in the list",
    confirmRemoval,
    refusedBy,
    onChange,
  } = props;
  const empty = props.placement === "card" ? props.empty : null;
  const legendId = useId();
  const labelId = useId();
  const [typed, setTyped] = useState("");
  const removal = useRemoval(confirmRemoval?.scope);
  // Stripped as Python strips it: each chip is a `require_label` the lab refuses padded.
  const trimmed = pythonStrip(typed);
  const candidate = normalize ? normalize(trimmed) : trimmed;
  const colliding = candidate !== "" && values.includes(candidate);

  function add() {
    if (candidate === "" || colliding) {
      return;
    }
    onChange([...values, candidate]);
    setTyped("");
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }
    // This field is routinely nested in another form, whose submit button is "Add option".
    // Enter here means "add this value", never "add the option I have not finished".
    event.preventDefault();
    add();
  }

  // Either why the value cannot be added, or — where the caller respells what is typed — what
  // will be stored, on `DerivedIdField`'s "Saved as `…`" model: a hint that names something
  // the field derives is paired with a line showing what it currently is.
  const extra = colliding
    ? alreadyTakenMessage(candidate, takenPlace)
    : normalize && candidate !== "" && candidate !== trimmed
      ? savedAsPreview(candidate)
      : undefined;

  return (
    <fieldset className="grid gap-2">
      {/* The rendered legend stands outside the fieldset's grid, so it takes the label's own
          4px to the first thing under it rather than the grid's gap. */}
      <legend id={legendId} className="mb-1 text-xs font-semibold text-admin-muted">
        {legend}
      </legend>
      {values.length > 0 || empty !== null ? (
        <ul className={pillRowClasses}>
          {values.map((value) => {
            const drop = () => onChange(values.filter((entry) => entry !== value));
            return confirmRemoval && removal.isArmed(value) ? (
              <ConfirmRemove
                key={value}
                as="li"
                title={confirmRemoval.title(value)}
                consequence={confirmRemoval.consequence(value, values)}
                onConfirm={removal.confirm(drop, confirmRemoval.notice(value))}
                onKeep={removal.keep}
              />
            ) : (
              <li key={value}>
                <span className={`${pillClasses} gap-1 pr-1 pl-2.5`}>
                  <span className="[overflow-wrap:anywhere]">{value}</span>
                  <button
                    className="rounded-full px-1.5 text-admin-muted transition hover:bg-admin-canvas hover:text-lab-error"
                    type="button"
                    aria-label={`Remove ${value}`}
                    ref={confirmRemoval ? removal.trigger(value) : undefined}
                    onClick={
                      confirmRemoval ? removal.ask(value, drop, confirmRemoval.notice(value)) : drop
                    }
                  >
                    <span aria-hidden>✕</span>
                  </button>
                </span>
              </li>
            );
          })}
          {values.length === 0 && empty !== null ? (
            <li className="text-admin-muted">{empty}</li>
          ) : null}
        </ul>
      ) : null}
      {confirmRemoval ? <RemovalNotice removal={removal} /> : null}
      <div
        className={
          placement === "item-form" ? itemFormTracksClasses : "flex flex-wrap items-start gap-2"
        }
      >
        <div className={placement === "item-form" ? undefined : "min-w-48 flex-1"}>
          <FieldHint
            label={label}
            labelHidden
            labelId={labelId}
            hint={hint}
            extra={extra}
            extraTone={colliding ? "error" : "muted"}
          >
            <input
              className={`${fieldControlClasses} w-full`}
              value={typed}
              placeholder={placeholder}
              maxLength={maxLength}
              aria-labelledby={`${legendId} ${labelId}`}
              aria-invalid={colliding || refusedBy !== undefined || undefined}
              aria-describedby={refusedBy}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={keyDown}
            />
          </FieldHint>
        </div>
        {/* The input's height and top-aligned with it, which is the first thing drawn in its
            column now that its label is not: level with the input, and the hint under the
            input never moves it down. */}
        <button
          className={`${subtleFieldButtonClasses} ${placement === "item-form" ? "justify-self-start" : ""}`}
          type="button"
          onClick={add}
        >
          <ButtonIcon verb="create" />
          {addLabel}
        </button>
      </div>
    </fieldset>
  );
}
