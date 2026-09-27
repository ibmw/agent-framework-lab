import { type ReactNode, useId } from "react";
import { type Arrangement, FieldGroupHint } from "./FieldHint";
import { GateFindingLine } from "./GateFindingLine";

/**
 * A chip is a native checkbox drawn as the prototype's toggle (`Workspace.dc.html` :2118): the
 * input is invisible inside the label and the label carries the look, as the logo card's tiles
 * do. On it is pine with a check before its name; off it is a plain bordered chip. The
 * ring is the input's own `:focus-visible`, drawn on the label that is the chip.
 */
const chipBaseClasses =
  "relative inline-flex min-h-10 items-center gap-[7px] rounded-lg border px-[13px] text-[13.5px] transition has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-lab-primary";

/**
 * The input lies over the whole chip, transparent, rather than in a one-pixel `sr-only` box: a
 * press anywhere on the chip lands on the checkbox itself, which is what a pointer, a test
 * runner's hit test and a screen reader's own click all find there.
 */
const chipInputClasses =
  "absolute inset-0 m-0 h-full w-full cursor-[inherit] appearance-none rounded-lg opacity-0";

/**
 * The chip's classes for its state. One border colour is ever emitted, so a finding's red never
 * has to win a cascade against the state's own border: a chip the gate finds against is bordered
 * in the validation ink, as a field that holds a gate error is.
 *
 * A disabled chip keeps its state's look without the hover that promises a press; one that
 * cannot be turned on is also faded, as the scenario's compose chips fade at their cap.
 */
function toggleChipClasses({
  checked,
  held,
  invalid,
}: {
  checked: boolean;
  held: boolean;
  invalid: boolean;
}): string {
  const border = invalid
    ? "border-lab-error"
    : checked
      ? "border-admin-chip-border"
      : "border-admin-field-border";
  const face = checked
    ? "bg-admin-chip font-bold text-lab-primary"
    : "bg-admin-surface font-[650] text-admin-ink-soft";
  const press = held
    ? `cursor-not-allowed${checked ? "" : " opacity-55"}`
    : `cursor-pointer ${checked ? "hover:bg-admin-chip-hover" : "hover:bg-[#f6f7f8]"}`;
  return `${chipBaseClasses} ${border} ${face} ${press}`;
}

export interface ToggleChip<T extends string> {
  value: T;
  /** What the chip shows. */
  label: string;
  /**
   * Read after the label, past a space, in the chip's accessible name, and not drawn: the
   * currency chip shows `EUR` where the prototype does and is still named "EUR — Euro". The
   * name is the input's own `aria-label`, which starts with the visible label, so a reader who
   * says what they see still reaches the chip.
   */
  spoken?: string;
  /**
   * Why this chip cannot change, where the reason is the chip's own. It is disabled, titled
   * with the sentence, and described by the line under the chips that says it.
   */
  disabledReason?: string;
  /**
   * The publish-gate errors this chip's state causes, in the gate's words (`lib/fieldRules.ts`).
   * The chip is marked `aria-invalid` and described by the line that says them, and nothing is
   * refused: the lab stores the draft and refuses it at publication (ADR 0063's amendment).
   */
  findings?: readonly string[];
}

/**
 * A small closed set of toggles, as one control: the multi-select the prototype draws for a
 * shop's currencies and channels, and the one the workspace draws every set of that shape with.
 *
 * **Native checkboxes, not pressed buttons.** A chip here is a value of a form, not an action:
 * a native checkbox is announced as checked or not, is toggled by Space, is one tab stop per
 * chip, and is what every test and journey already finds these sets by
 * (`getByRole("checkbox", { name })`). An `aria-pressed` button carries the state with none of
 * that, and stays with the filters and with chips whose press starts something — the
 * scenario's compose chips read a template before they count as pressed.
 *
 * The group is `FieldGroupHint`'s — a `<fieldset>` named by its label and described by its rule
 * and its second line, in either arrangement — so a reader arriving at the first chip hears the
 * rule once, for the set.
 *
 * `keepOne` is the lab's rule on a set that must never be empty: the last chip on stays on,
 * disabled rather than refused at save, and titled with the sentence. The group's hint says it
 * too, because a disabled control is skipped by Tab and its title is not a place to read why
 * (ADR 0063 keeps a native control `disabled`, with the reason in `title` and in a line).
 */
export function ToggleChipGroup<T extends string>({
  label,
  hint,
  extra,
  arrangement,
  options,
  value,
  keepOne,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  /** `FieldGroupHint`'s second line: what the hint's rule currently resolves to. */
  extra?: ReactNode;
  arrangement?: Arrangement;
  options: readonly ToggleChip<T>[];
  /** What is on, in the order it was turned on: a chip turned on is appended, never sorted. */
  value: readonly T[];
  /** The sentence that keeps the last chip on, where the set may not be emptied. */
  keepOne?: string;
  onChange: (next: T[]) => void;
}) {
  const id = useId();
  const reasonsId = `${id}-reasons`;
  const findingsId = `${id}-findings`;
  const reasons = options.flatMap((option) =>
    option.disabledReason ? [option.disabledReason] : [],
  );
  const findings = options.flatMap((option) => option.findings ?? []);

  function toggle(chip: T) {
    if (!value.includes(chip)) {
      onChange([...value, chip]);
      return;
    }
    if (keepOne !== undefined && value.length === 1) {
      return;
    }
    onChange(value.filter((entry) => entry !== chip));
  }

  return (
    <FieldGroupHint legend={label} hint={hint} extra={extra} arrangement={arrangement}>
      <div className="flex flex-wrap gap-[7px]">
        {options.map((option) => {
          const checked = value.includes(option.value);
          const lastOn = keepOne !== undefined && checked && value.length === 1;
          const reason = option.disabledReason ?? (lastOn ? keepOne : undefined);
          const invalid = (option.findings ?? []).length > 0;
          const describedBy = [
            option.disabledReason ? reasonsId : null,
            invalid ? findingsId : null,
          ].filter(Boolean);
          return (
            <label
              key={option.value}
              className={toggleChipClasses({ checked, held: reason !== undefined, invalid })}
              title={reason}
            >
              <input
                type="checkbox"
                className={chipInputClasses}
                checked={checked}
                disabled={reason !== undefined}
                // On the input as well as the chip: the chip's is the one a pointer hovers, and
                // the input's is its description where no line names the reason.
                title={reason}
                aria-label={option.spoken ? `${option.label} ${option.spoken}` : undefined}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy.length > 0 ? describedBy.join(" ") : undefined}
                onChange={() => toggle(option.value)}
              />
              {checked ? <span aria-hidden="true">✓</span> : null}
              {option.label}
            </label>
          );
        })}
      </div>
      {reasons.length > 0 ? (
        <p id={reasonsId} className="mt-[7px] text-[13px] text-admin-muted">
          {reasons.join(" ")}
        </p>
      ) : null}
      <GateFindingLine id={findingsId} className="mt-[7px]">
        {findings.length > 0
          ? findings.map((finding) => (
              <span key={finding} className="block">
                {finding}
              </span>
            ))
          : null}
      </GateFindingLine>
    </FieldGroupHint>
  );
}
