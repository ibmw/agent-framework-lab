import type { ReactNode } from "react";
import { validationMessageClasses } from "../lib/ui";

/**
 * A publish-gate error said under the control that holds it, at the validation weight.
 *
 * Polite rather than an alert, because nothing has been refused: the lab stores the draft and
 * refuses it at publication, which is the reason `FieldHint` gives its warning tone for
 * announcing politely. The element stays mounted while it holds nothing — `sr-only` and empty
 * — for the reason `FieldHint`'s second line does: a live region that appears at the moment it
 * has something to say is one no reader is listening to yet. The sentence is the gate's
 * (`lib/fieldRules.ts`), so it matches the validation card word for word once the draft is
 * saved rather than saying the same finding twice in two voices.
 *
 * `className` is where the line sits and how wide it runs; the weight is this component's.
 */
export function GateFindingLine({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      id={id}
      aria-live="polite"
      className={
        children
          ? className
            ? `${validationMessageClasses} ${className}`
            : validationMessageClasses
          : "sr-only"
      }
    >
      {children}
    </p>
  );
}
