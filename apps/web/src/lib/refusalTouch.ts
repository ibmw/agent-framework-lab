import { type MouseEvent, useCallback, useMemo, useState } from "react";

/**
 * Whether the operator has touched the form a refused action belongs to (ADR 0078).
 *
 * A refusal's line is a hint until then and the validation message after (`RefusalLine`'s
 * `touched`). Touched means the operator has done something to this attempt at the form:
 *
 * - **edited it** — a field in it changed, or a control in it was pressed (a chip, *Keep the
 *   current key*): `watch`, spread on the element that holds the form, hears both, because
 *   React's `change` and `click` bubble to it; a form whose controls sit apart from that
 *   element, or whose edits arrive through no control of its own (a draft made dirty), passes
 *   `edited`, which latches;
 * - **pressed the refused action** — the click `PrimaryAction` swallows still bubbles to
 *   `watch`, and an action outside the watched element calls `touch` from `onRefusedPress`.
 *   A press on the refused button is the one press that does nothing, and the one that most
 *   needs the reason said firmly.
 *
 * `reset` starts a new attempt: a submit that was accepted and emptied the form leaves a form
 * nobody has touched, whose reason is a hint again.
 */
export function useRefusalTouch(edited = false) {
  const [touched, setTouched] = useState(edited);
  // Latched during render rather than in an effect, so the line is never drawn muted for one
  // frame after an edit the page already knows about.
  if (edited && !touched) {
    setTouched(true);
  }
  const touch = useCallback(() => setTouched(true), []);
  const reset = useCallback(() => setTouched(false), []);
  const watch = useMemo(
    () => ({
      onChange: touch,
      onClick: (event: MouseEvent<HTMLElement>) => {
        // A press on a control, not a click into a field: placing the caret edits nothing.
        if (event.target instanceof Element && event.target.closest("button") !== null) {
          touch();
        }
      },
    }),
    [touch],
  );
  return { touched, touch, reset, watch };
}

/** A form's touch, handed to the form that draws its refusal line (`ItemFormRow`). */
export type RefusalTouch = ReturnType<typeof useRefusalTouch>;
