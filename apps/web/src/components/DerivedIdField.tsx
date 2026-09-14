import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { alreadyTakenMessage } from "../lib/fieldRules";
import { fieldControlClasses } from "../lib/ui";
import { FieldHint } from "./FieldHint";

export function savedAsPreview(id: string): ReactNode {
  return (
    <>
      Saved as <code className="font-mono">{id}</code>.
    </>
  );
}

/**
 * An identifier that follows a source until edited, is handed back when emptied, previews
 * as "Saved as `…`", and refuses a value already taken.
 *
 * Taken from the shop-create slug and the block library's live preview. The parent computes
 * `suggested` (usually `uniqueSuggestion(slugify(source), taken)` or `nextReference`); this
 * component is the follow / resume / refuse behaviour those pages used to each write themselves.
 *
 * Emptying does not refill between the operator and their next keystroke. The suggestion
 * returns on blur-while-empty, or on the next source change while the field is unedited.
 */
export function DerivedIdField({
  label,
  hint,
  value,
  suggested,
  taken = [],
  takenBase,
  takenPlace = "taken",
  pattern,
  title,
  placeholder,
  required = false,
  normalize,
  onChange,
}: {
  label: string;
  hint: ReactNode;
  value: string;
  suggested: string;
  taken?: readonly string[];
  /** The source id `suggested` stepped off, when the parent already knows it was taken. */
  takenBase?: string;
  /** Completes "{id} is already {takenPlace}." */
  takenPlace?: string;
  pattern?: string;
  title?: string;
  placeholder?: string;
  required?: boolean;
  normalize?: (value: string) => string;
  onChange: (value: string) => void;
}) {
  const generatedId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [edited, setEdited] = useState(false);
  const editedRef = useRef(edited);
  editedRef.current = edited;
  const colliding = value !== "" && taken.includes(value);

  const collisionMessage = colliding ? alreadyTakenMessage(value, takenPlace) : "";
  const whyTaken =
    !colliding && takenBase && value === suggested
      ? alreadyTakenMessage(takenBase, takenPlace)
      : "";

  useEffect(() => {
    if (value === "") {
      setEdited(false);
    }
  }, [value]);

  // Follow the source when *it* changes. Restoring here when the operator empties the field
  // would refill between them and their next keystroke — `suggested` is unchanged then, so
  // this effect does not run. A successful add remounts the field instead.
  useEffect(() => {
    if (!editedRef.current) {
      onChangeRef.current(suggested);
    }
  }, [suggested]);

  useEffect(() => {
    inputRef.current?.setCustomValidity(collisionMessage);
  }, [collisionMessage]);

  function change(next: string) {
    const normalized = normalize ? normalize(next) : next;
    if (normalized === "") {
      setEdited(false);
      onChange("");
      return;
    }
    setEdited(true);
    onChange(normalized);
  }

  function restoreIfEmpty() {
    if (value === "") {
      setEdited(false);
      onChange(suggested);
    }
  }

  const extra = colliding ? (
    collisionMessage
  ) : value || whyTaken ? (
    <>
      {value ? savedAsPreview(value) : null}
      {whyTaken ? ` ${whyTaken}` : null}
    </>
  ) : undefined;

  return (
    <FieldHint label={label} hint={hint} extra={extra} extraTone={colliding ? "error" : "muted"}>
      <input
        ref={inputRef}
        id={generatedId}
        className={fieldControlClasses}
        value={value}
        required={required}
        pattern={pattern}
        title={title}
        placeholder={placeholder}
        aria-invalid={colliding || undefined}
        onChange={(event) => change(event.target.value)}
        onBlur={restoreIfEmpty}
      />
    </FieldHint>
  );
}
