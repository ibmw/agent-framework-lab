import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";
import type { Removal } from "../lib/removal";
import {
  destructiveButtonClasses,
  focusRingClasses,
  labNoteClasses,
  outlineButtonClasses,
} from "../lib/ui";
import { ButtonIcon } from "./ButtonIcon";

/**
 * The second press, standing where the row stood (`form-decisions.md` 9.2).
 *
 * It takes the row's place rather than opening beside it, so what is about to go is exactly
 * what is no longer drawn, and it is as tall as what it has to say rather than as tall as the
 * row it replaced — `form-decisions.md` asks for "a confirm state of its own height". The
 * prototype's panel (`Workspace.dc.html` :971): the question in the warm red, the whole
 * consequence under it, then the destructive press and *Keep it*.
 *
 * **It takes focus when it appears**, on the group itself rather than on either button: the
 * group is named by the question and described by the consequence, so moving focus to it is
 * what reads both out, and a focused *Remove it* would let a second Enter finish what a first
 * Enter began without anything having been read. Escape and *Keep it* walk it back, and the
 * list's `Removal` (`lib/removal.ts`) returns focus to the control that asked.
 */
export function ConfirmRemove({
  as = "div",
  columns,
  title,
  consequence,
  confirmLabel = "Remove it",
  confirmRefusal,
  destroys = true,
  onConfirm,
  onKeep,
}: {
  /** What the confirm stands in for: a list item, a table row, or a block of its own. */
  as?: "div" | "li" | "tr";
  /** A table row's column count, so the confirm spans the row it replaced. */
  columns?: number;
  title: string;
  consequence: ReactNode;
  confirmLabel?: string;
  /** Why the second press cannot be made yet — the consequence is still being read. */
  confirmRefusal?: string;
  /**
   * False where the second press takes nothing out of the lab — a detach leaves the profile
   * whole — so it carries no trash glyph, which means *delete* on every button that has one.
   */
  destroys?: boolean;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  const titleId = useId();
  const consequenceId = useId();
  const refusalId = useId();
  const group = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    group.current?.focus();
  }, []);

  function keyDown(event: KeyboardEvent<HTMLFieldSetElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onKeep();
    }
  }

  const panel = (
    // A fieldset is the native group, named by the question rather than by a legend so the
    // question can keep the panel's own type.
    <fieldset
      ref={group}
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={consequenceId}
      onKeyDown={keyDown}
      className={`m-0 grid min-w-0 gap-2.5 rounded-[10px] border border-[#eab4ae] bg-lab-error-soft px-[15px] py-[13px] ${focusRingClasses}`}
    >
      <p id={titleId} className="text-[13px] font-bold text-lab-error [overflow-wrap:anywhere]">
        {title}
      </p>
      <div id={consequenceId} className="text-[12.5px] leading-[1.55] text-admin-ink-soft">
        {consequence}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={destructiveButtonClasses}
          type="button"
          disabled={confirmRefusal !== undefined}
          title={confirmRefusal}
          aria-describedby={confirmRefusal === undefined ? undefined : refusalId}
          onClick={onConfirm}
        >
          {destroys ? <ButtonIcon verb="delete" /> : null}
          {confirmLabel}
        </button>
        <button className={outlineButtonClasses} type="button" onClick={onKeep}>
          Keep it
        </button>
        {confirmRefusal === undefined ? null : (
          <span id={refusalId} className="text-xs text-admin-muted">
            {confirmRefusal}
          </span>
        )}
      </div>
    </fieldset>
  );

  if (as === "tr") {
    return (
      <tr>
        <td className="px-2 py-2" colSpan={columns}>
          {panel}
        </td>
      </tr>
    );
  }
  if (as === "li") {
    return <li className="min-w-0">{panel}</li>;
  }
  return panel;
}

/**
 * The line a list shows after a removal: the prototype's "Removed Colour from the draft."
 * (`Workspace.dc.html` :982), without its Undo (ADR 0060).
 *
 * It is where focus is left once the row that held it has gone, and focus is what announces
 * it: it is deliberately **not** a live region, because a live region that also takes focus is
 * read twice. It clears itself once the row it speaks of is back, so it never says an entry was
 * removed while the entry is on screen again.
 */
export function RemovalNotice({ removal }: { removal: Removal }) {
  return (
    <p
      ref={removal.noticeRef}
      tabIndex={-1}
      className={
        removal.notice
          ? `${labNoteClasses} px-3.5 py-3 text-[12.5px] text-admin-ink ${focusRingClasses}`
          : "hidden"
      }
    >
      {removal.notice}
    </p>
  );
}
