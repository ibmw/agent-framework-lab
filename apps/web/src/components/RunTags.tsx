import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { describeApiError } from "../api/client";
import { setExperimentTags } from "../api/experiments";
import type { Annotate } from "../lib/annotate";
import { pythonStrip } from "../lib/pythonText";
import { useRefusalTouch } from "../lib/refusalTouch";
import {
  fieldControlClasses,
  sheetFootLineClasses,
  tagAddClasses,
  tagCancelClasses,
  tagChipClasses,
  tagFormClasses,
  tagRemoveClasses,
  tagRowClasses,
  tagRowEmptyClasses,
  tagRowLabelClasses,
} from "../lib/ui";
import { ButtonIcon } from "./ButtonIcon";
import { BusyButton, PrimaryAction, RefusalLine } from "./PrimaryAction";

/** Why *Add tag* is refused: there is no tag to file the run under yet. */
const TAG_EMPTY = "Type the tag to file this run under.";

/**
 * *Filed under*, in the results header (ADR 0080; sheet mockup :55–67): each tag the run is filed
 * under with its remove, then *+ Tag*, which opens the tag form in place and folds it again on
 * *Cancel* or Escape, focus returned to it.
 *
 * The tags are replaced as a set, because how a run is filed is a current classification rather
 * than a record of what happened to it (ADR 0036): every write sends the whole set, and its answer
 * — the whole annotation — replaces what is on screen. A failed write is said here, in the header
 * it was made from, and leaves what was typed in the box.
 */
export function RunTags({
  shopId,
  experimentId,
  tags,
  annotate,
  annotating,
}: {
  shopId: string;
  experimentId: string;
  tags: string[];
  annotate: Annotate;
  /** A note or a tag write is in flight. */
  annotating: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tag, setTag] = useState("");
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();
  const fieldId = useId();
  const reasonId = useId();
  const empty = pythonStrip(tag) === "";
  // The refusal is a hint until the operator types or presses Add tag, and again once an add has
  // emptied the box (ADR 0078).
  const touch = useRefusalTouch();
  const addRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  // Where focus goes once the form has drawn or folded: into the field it opened, or back to the
  // press that opened it. Only after an operator's press, so the header never takes focus on load.
  const focusNext = useRef<"field" | "add" | null>(null);
  // A render owed to a move asked for outside one: a removal changes no state of this component.
  const [, settle] = useState(0);
  // After every render rather than on `open`: the flag is what says a move is owed.
  useEffect(() => {
    const target = focusNext.current === "field" ? fieldRef.current : addRef.current;
    if (focusNext.current !== null && target !== null) {
      focusNext.current = null;
      target.focus();
    }
  });

  const fold = () => {
    setOpen(false);
    setTag("");
    touch.reset();
    // A failure said about the attempt being folded goes with it.
    setError(null);
    focusNext.current = "add";
  };

  // `clear` is the caller's, because only the caller knows whether the box was what the write
  // consumed: adding consumes what was typed, and removing a chip leaves a half-typed tag alone.
  const file = async (next: string[], clear: () => void) => {
    setError(null);
    try {
      if (await annotate(() => setExperimentTags(shopId, experimentId, { tags: next }))) {
        clear();
      }
    } catch (cause: unknown) {
      setError(describeApiError(cause, "These tags could not be saved."));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // The button refuses an empty tag itself (ADR 0063) and holds while a write is in flight
    // (ADR 0065); a submission that arrives some other way goes nowhere either.
    if (empty || annotating) {
      return;
    }
    // The whole set every time, because that is what the contract takes: the backend folds what
    // was typed, so a tag already on the run comes back as the one chip it always was.
    void file([...tags, pythonStrip(tag)], () => {
      setTag("");
      touch.reset();
      // Back into the emptied box for the next tag, whether Enter or a press on Add tag sent it.
      focusNext.current = "field";
    });
  };

  const foldOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      fold();
    }
  };

  return (
    <div className="grid gap-1.5">
      {/* biome-ignore lint/a11y/useSemanticElements: a row of chips and a form, not a fieldset. */}
      <div role="group" aria-labelledby={labelId} className={tagRowClasses}>
        <span id={labelId} className={tagRowLabelClasses}>
          Filed under
        </span>
        {tags.length === 0 && !open ? <span className={tagRowEmptyClasses}>no tag yet</span> : null}
        {tags.map((entry) => (
          <span key={entry} className={tagChipClasses}>
            {entry}
            {/* Held rather than disabled while a write is out (ADR 0065, `BusyButton`): a disabled
                button drops the focus of the keyboard reader who pressed it. */}
            <BusyButton
              type="button"
              aria-label={`Remove tag ${entry}`}
              busy={annotating}
              className={tagRemoveClasses}
              onClick={(event) => {
                const pressed = event.currentTarget;
                void file(
                  tags.filter((kept) => kept !== entry),
                  // The chip goes with its remove; where the press still holds focus when the
                  // answer is in, focus moves to the field if the form is open by then and to
                  // + Tag if it is not, rather than to the page. Read from what is drawn now, not
                  // from when the press was made: the form may have opened meanwhile. A reader
                  // who has moved on keeps their place.
                  () => {
                    if (document.activeElement === pressed) {
                      focusNext.current = fieldRef.current === null ? "add" : "field";
                      settle((count) => count + 1);
                    }
                  },
                );
              }}
            >
              <span aria-hidden>×</span>
            </BusyButton>
          </span>
        ))}
        {open ? (
          <form
            className={tagFormClasses}
            onSubmit={submit}
            onKeyDown={foldOnEscape}
            {...touch.watch}
          >
            <label className="sr-only" htmlFor={fieldId}>
              Add a tag
            </label>
            <input
              ref={fieldRef}
              id={fieldId}
              // The prototype's width for the tag input (`Workspace.dc.html`:2650), at a 160px
              // floor as the sheet mockup draws it (:63), so it sits beside Add tag.
              className={`${fieldControlClasses} w-[160px] min-w-0`}
              placeholder="read-check-gap"
              value={tag}
              onChange={(event) => setTag(event.target.value)}
            />
            <PrimaryAction
              variant="outline"
              type="submit"
              refusal={empty ? { id: reasonId, reason: TAG_EMPTY } : null}
              busy={annotating}
            >
              <ButtonIcon verb="create" />
              Add tag
            </PrimaryAction>
            <button type="button" className={tagCancelClasses} onClick={fold}>
              Cancel
            </button>
            {empty ? (
              <RefusalLine id={reasonId} touched={touch.touched} className="w-full">
                {TAG_EMPTY}
              </RefusalLine>
            ) : null}
          </form>
        ) : (
          <button
            ref={addRef}
            type="button"
            className={tagAddClasses}
            onClick={() => {
              // A new attempt. Folding reset the touch, but Cancel's own press then bubbled to the
              // form's `watch` and touched it again, so it is reset here.
              touch.reset();
              focusNext.current = "field";
              setOpen(true);
            }}
          >
            <ButtonIcon verb="create" />
            Tag
          </button>
        )}
      </div>
      {error ? (
        <p role="alert" className={sheetFootLineClasses.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
