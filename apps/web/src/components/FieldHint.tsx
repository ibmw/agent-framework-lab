import { cloneElement, type ReactElement, type ReactNode, useId } from "react";
import { fieldLabelClasses } from "../lib/ui";

type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
};

/**
 * The second line's three treatments.
 *
 * `admin-draft-ink` is the colour `IssueList` gives the *word* "Warning" beside a gate
 * finding (it paints the message itself `admin-ink-soft`, and `PublishReasons` summarises
 * warnings in `admin-muted`). It is borrowed here as the workspace's warning ink, not as a
 * copy of any one of those three renderings.
 */
const EXTRA_TONES = {
  muted: "text-admin-muted",
  warning: "text-admin-draft-ink",
  error: "text-lab-error",
} as const;

/**
 * One muted line under a control, tied to it by `aria-describedby`.
 *
 * A format rule or a consequence is written here so it is read rather than hovered.
 * `title=` may still feed the browser's native validity message; it is never the only
 * carrier of the rule.
 *
 * Required-field convention (PLAN-UX Slice 1): the minority is marked. Create forms
 * have no optional fields, so they do not pass `optional`. The product editor already
 * writes "(optional)" on price and is not a create form — this flag is the primitive's
 * encoding of that convention for later consumers, not a conversion of that editor.
 */
export function FieldHint({
  label,
  hint,
  extra,
  extraTone = "muted",
  optional = false,
  children,
}: {
  label: string;
  hint: ReactNode;
  /** A second description line (for example a live "Saved as" preview), also tied by aria-describedby. */
  extra?: ReactNode;
  /**
   * Collision copy uses the create-error treatment; a preview stays muted.
   *
   * `warning` is the publish gate's third severity, in `admin-draft-ink` — the ink
   * `IssueList` uses for the word "Warning" on a gate finding. A field that echoes a gate
   * finding must not claim a severity the gate did not give it: an unexercised model is
   * a warning there, so it is a warning here, and it is announced politely rather than
   * as an alert because nothing has been refused.
   */
  extraTone?: "muted" | "warning" | "error";
  optional?: boolean;
  children: ReactElement<ControlProps>;
}) {
  const generatedId = useId();
  const controlId = children.props.id ?? generatedId;
  const hintId = `${generatedId}-hint`;
  const extraId = `${generatedId}-extra`;
  const describedBy = [children.props["aria-describedby"], hintId, extraId]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={fieldLabelClasses}>
      <label htmlFor={controlId}>
        {label}
        {optional ? " (optional)" : null}
      </label>
      {cloneElement(children, { id: controlId, "aria-describedby": describedBy })}
      <p id={hintId} className="font-normal text-admin-muted">
        {hint}
      </p>
      <p
        id={extraId}
        className={extra ? `font-normal ${EXTRA_TONES[extraTone]}` : "sr-only"}
        role={extra && extraTone === "error" ? "alert" : undefined}
        aria-live={extraTone === "error" ? undefined : "polite"}
      >
        {extra ?? null}
      </p>
    </div>
  );
}

/**
 * The same muted line, under a group of controls rather than under one.
 *
 * A checkbox group's rule belongs to the set and not to any one box — "the first is the
 * default" is nonsense written under `EUR` alone — so it is tied to the group. `FieldHint`
 * cannot carry it: its `<label htmlFor>` names a form control, and a `<fieldset>` is not one.
 * The group is named by its `<legend>`, the way the shop-detail groups already are, and
 * described by `aria-describedby` on the fieldset, so a reader arriving at the first checkbox
 * hears the rule once for the group instead of once per box or not at all.
 *
 * `extra` is `FieldHint`'s second line, for the same job it does there: where the hint names
 * something the group derives — "the first is the default" — this is where the group says
 * which one that currently is, the way `DerivedIdField` previews the id it will save.
 */
export function FieldGroupHint({
  legend,
  hint,
  extra,
  children,
}: {
  legend: string;
  hint: ReactNode;
  /** A live second description line: what the hint's rule currently resolves to. */
  extra?: ReactNode;
  children: ReactNode;
}) {
  const generatedId = useId();
  const hintId = `${generatedId}-hint`;
  const extraId = `${generatedId}-extra`;
  return (
    <fieldset className={fieldLabelClasses} aria-describedby={`${hintId} ${extraId}`}>
      <legend className="text-xs font-semibold text-admin-muted">{legend}</legend>
      {children}
      <p id={hintId} className="font-normal text-admin-muted">
        {hint}
      </p>
      <p
        id={extraId}
        className={extra ? "font-normal text-admin-muted" : "sr-only"}
        aria-live="polite"
      >
        {extra ?? null}
      </p>
    </fieldset>
  );
}
