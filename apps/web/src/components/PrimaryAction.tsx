import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
import { blockedButtonClasses, buttonVariantClasses, refusalLineClasses } from "../lib/ui";

/**
 * Why an action cannot proceed, and the id of the line on the page that says so.
 *
 * The shape `entryEdit`'s `saveRefusal` already had: the reason rides in the button's `title`
 * and the id names the element that carries it where an operator can read it.
 */
export interface Refusal {
  id: string;
  reason: string;
}

/** The weights a primary action wears when it can proceed. */
export type PrimaryWeight = "accent" | "ink" | "outline";

/**
 * A primary action that may be refused, and says why (ADR 0063).
 *
 * Refused, it wears the dashed blocked weight, is `aria-disabled` rather than `disabled` — so it
 * stays in the tab order and a keyboard reader who lands on it is told the reason — carries the
 * reason in `title`, and names the line that carries it in `aria-describedby`, ahead of any
 * description the caller passes.
 *
 * **It swallows its own activation.** An `aria-disabled` button is still a button, so a click,
 * Enter, Space and a form's implicit submission all reach it. One `click` listener stops all
 * four: Enter and Space on a focused button dispatch `click`; a submit button's activation —
 * including one outside its form under `form=` — is cancelled by `preventDefault()`; and a
 * browser's implicit submission from a text field is a synthetic `click` on the form's default
 * button. The caller's handler is not called.
 *
 * `busy` is a different state: a press in flight has no reason to give and ends on its own, so it
 * wears the button table's faded weight and says nothing — and it wins over a refusal that
 * arrives meanwhile, which takes over once the press has ended. It is `aria-disabled` too, never
 * natively `disabled`, because a browser drops focus from a control that becomes disabled under
 * it: the reader who pressed would be left on the page's body for as long as the action runs,
 * and put back nowhere when it ends (ADR 0065). It swallows its activation as a refusal does.
 * `disabled` itself is not a prop, so no caller can refuse an action the old way by accident.
 *
 * The line is the surface's to place — under a create header, under Start in its card, beside a
 * row's Save — and `RefusalLine` below is that line where a surface has one sentence to give.
 */
export function PrimaryAction({
  variant,
  refusal,
  busy = false,
  onRefusedPress,
  className,
  onClick,
  "aria-describedby": describedBy,
  ref,
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled" | "aria-disabled" | "title"> & {
  variant: PrimaryWeight;
  /** Why the action is refused. Absent or null when it can proceed. */
  refusal?: Refusal | null;
  /** A press is in flight: unavailable, with nothing to explain, and still holding focus. */
  busy?: boolean;
  /**
   * Called when a press is swallowed because the action is refused — not while it is busy —
   * so the form it belongs to counts as touched and its line turns to the validation weight
   * (ADR 0078). Only needed where the action sits outside the element `useRefusalTouch`'s
   * `watch` is spread on; inside it, the swallowed click bubbles there.
   */
  onRefusedPress?: () => void;
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  // Busy wins: a press in flight is the button's whole state until it ends, even if what was
  // typed meanwhile would refuse the next one — the label says it is running, the button cannot
  // be pressed again, and a reason for a press nobody can make yet would be noise.
  const refused = !busy && refusal !== undefined && refusal !== null;
  const describedByIds = [refused ? refusal.id : null, describedBy].filter(Boolean).join(" ");
  const weight = refused ? blockedButtonClasses : buttonVariantClasses[variant];
  return (
    <button
      {...rest}
      ref={ref}
      className={className ? `${weight} ${className}` : weight}
      aria-disabled={refused || busy ? true : undefined}
      title={refused ? refusal.reason : undefined}
      aria-describedby={describedByIds === "" ? undefined : describedByIds}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (refused || busy) {
          event.preventDefault();
          if (refused) {
            onRefusedPress?.();
          }
          return;
        }
        onClick?.(event);
      }}
    >
      {children}
    </button>
  );
}

/**
 * The inline half of a refusal: one sentence under or beside the action it refuses, named by
 * that action's `aria-describedby`.
 *
 * `touched` is required, so no surface can draw a reason without saying whose attempt it is:
 * while the form is untouched the sentence is a hint, and once the operator has edited the form
 * or pressed the refused action it is the validation message (ADR 0078, amending ADR 0063).
 * Only the weight moves — the words, the id, and so the button's description, `title` and
 * `aria-disabled`, are the same either way. `useRefusalTouch` is how a form knows.
 */
export function RefusalLine({
  id,
  touched,
  className,
  children,
}: {
  id: string;
  /** The operator has edited the form or pressed the refused action. */
  touched: boolean;
  className?: string;
  children: ReactNode;
}) {
  const weight = refusalLineClasses(touched);
  return (
    <p id={id} className={className ? `${weight} ${className}` : weight}>
      {children}
    </p>
  );
}

/**
 * A secondary control whose press runs long — *Run the agent*, *Score*, *Replay*, *Freeze
 * snapshot* — held in place while it runs.
 *
 * `busy` is a press in flight, and is `aria-disabled` rather than `disabled` for the reason
 * `PrimaryAction`'s is: the reader who pressed keeps focus on the control for the minute it runs
 * and is still on it when it comes back (ADR 0065). The activation is swallowed meanwhile.
 * `disabled` keeps its native meaning — a secondary control refused for a reason stays natively
 * disabled with that reason beside it (ADR 0063) — and busy wins over it, as it does over a
 * primary action's refusal, so a refusal arriving during the press cannot take focus away.
 */
export function BusyButton({
  busy,
  disabled = false,
  onClick,
  ref,
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-disabled"> & {
  /** A press is in flight. */
  busy: boolean;
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <button
      {...rest}
      ref={ref}
      disabled={!busy && disabled}
      aria-disabled={busy ? true : undefined}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (busy) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {children}
    </button>
  );
}
