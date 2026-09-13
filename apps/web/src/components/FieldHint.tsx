import { cloneElement, type ReactElement, type ReactNode, useId } from "react";
import { fieldLabelClasses } from "../lib/ui";

type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
};

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
  optional = false,
  children,
}: {
  label: string;
  hint: ReactNode;
  /** A second description line (for example a live "Saved as" preview), also tied by aria-describedby. */
  extra?: ReactNode;
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
        className={extra ? "font-normal text-admin-muted" : "sr-only"}
        aria-live="polite"
      >
        {extra ?? null}
      </p>
    </div>
  );
}
