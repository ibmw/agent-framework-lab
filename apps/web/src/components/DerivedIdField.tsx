import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { alreadyTakenMessage } from "../lib/fieldRules";
import { fieldControlClasses } from "../lib/ui";
import { type Arrangement, FieldHint } from "./FieldHint";

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
 *
 * `pending` is for the parent whose suggestion is derived from something still loading — a
 * shop's ticket or order list. A suggestion that is not known *yet* is the one case `edited`
 * cannot protect against: arriving late is indistinguishable here from a source that changed,
 * so the field writes it over whatever the operator has typed in the meantime. While `pending`
 * holds the field takes nothing, and the commit that opens it is the same one that puts the
 * suggestion in it — so there is never a moment where it is open, empty, and about to fill
 * itself in behind whoever is typing. A parent whose list moves again later — a create re-reads
 * it — says `pending` again for as long as that lasts, and the field comes back unclaimed.
 */
export function DerivedIdField({
  label,
  hint,
  value,
  suggested,
  pending = false,
  taken = [],
  takenBase,
  takenPlace = "taken",
  pattern,
  title,
  placeholder,
  required = false,
  arrangement,
  normalize,
  onChange,
}: {
  label: string;
  hint: ReactNode;
  value: string;
  suggested: string;
  /** `suggested` is not known yet, because what it is derived from is still loading. */
  pending?: boolean;
  taken?: readonly string[];
  /** The source id `suggested` stepped off, when the parent already knows it was taken. */
  takenBase?: string;
  /** Completes "{id} is already {takenPlace}." */
  takenPlace?: string;
  pattern?: string;
  title?: string;
  placeholder?: string;
  required?: boolean;
  /**
   * `FieldHint`'s, passed straight through: this field labels itself, so a card on the form
   * pattern asks it to draw itself as a row rather than wrapping it in one.
   */
  arrangement?: Arrangement;
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
  // Has the operator been in this field at all? Its sibling `edited` says whether they left
  // something in it; this says whether the field is theirs yet.
  //
  // Until it is, the field *shows* the suggestion rather than waiting for the effect below to
  // report it back through the parent. A field that paints empty and fills itself a commit
  // later throws away whatever lands in between — and an empty field is exactly what invites
  // something to land. Once the operator has touched it, emptying it is their own act and it
  // stays empty until they say otherwise.
  const [touched, setTouched] = useState(false);
  const shown = touched ? value : value || suggested;

  // A closed field is nobody's. Without this the invariant holds only on the first open: an
  // operator who *typed* the last reference leaves `touched` set, and the commit that reopens
  // the field after a create would show their empty value rather than the suggestion waiting
  // behind it. `pending` cannot turn true while the operator holds the field empty — both
  // create forms refuse an empty reference before they ever set it — so this cannot take a
  // field they have deliberately cleared.
  useEffect(() => {
    if (pending) {
      setTouched(false);
    }
  }, [pending]);
  // What React last *committed* into the input, so the effect below can tell it from what the
  // operator has since typed. Written in a layout effect rather than during render: a render
  // that a discrete event interrupts never reaches the DOM, and a ref assigned in one would
  // describe an input that does not exist.
  const renderedRef = useRef(shown);
  useLayoutEffect(() => {
    renderedRef.current = shown;
  }, [shown]);
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
  // this effect does not run. After a successful add the parent empties the value and the
  // reloaded list moves `suggested`, which is what brings the next one in; the field is
  // reconciled rather than remounted, so nothing here resets.
  useEffect(() => {
    if (editedRef.current) {
      return;
    }
    // A keystroke is in the DOM before React has been told about it: this effect can run
    // between the operator's `input` event and the render that carries it, and `edited` is
    // still false there. The input itself is the only thing that knows, so ask it.
    const input = inputRef.current;
    if (input && input.value !== renderedRef.current) {
      return;
    }
    onChangeRef.current(suggested);
  }, [suggested]);

  useEffect(() => {
    inputRef.current?.setCustomValidity(collisionMessage);
  }, [collisionMessage]);

  function change(next: string) {
    const normalized = normalize ? normalize(next) : next;
    // Emptying is a keystroke like any other: the field is the operator's from here, and the
    // suggestion is no longer shown in place of what they leave in it.
    setTouched(true);
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

  const extra = pending ? (
    `Reading what is already ${takenPlace}…`
  ) : colliding ? (
    collisionMessage
  ) : value || whyTaken ? (
    <>
      {value ? savedAsPreview(value) : null}
      {whyTaken ? ` ${whyTaken}` : null}
    </>
  ) : undefined;

  return (
    <FieldHint
      label={label}
      hint={hint}
      extra={extra}
      extraTone={colliding ? "error" : "muted"}
      arrangement={arrangement}
    >
      <input
        ref={inputRef}
        id={generatedId}
        className={fieldControlClasses}
        value={shown}
        required={required}
        pattern={pattern}
        title={title}
        placeholder={placeholder}
        // Closed until the field knows what it is going to suggest — and `shown` above means
        // the suggestion is already in it in the very commit that opens it, every time it
        // opens, so there is no moment in which this input is both open and empty.
        disabled={pending}
        aria-busy={pending || undefined}
        aria-invalid={colliding || undefined}
        onChange={(event) => change(event.target.value)}
        onBlur={restoreIfEmpty}
      />
    </FieldHint>
  );
}
