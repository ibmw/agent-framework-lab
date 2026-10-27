import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { savedAsPreview } from "../lib/fieldPreviews";
import { alreadyTakenMessage, tooLongMessage } from "../lib/fieldRules";
import { type RefusedBy, refusalLineOf } from "../lib/itemForm";
import { fieldControlClasses, idControlClasses } from "../lib/ui";
import { type Arrangement, FieldHint } from "./FieldHint";

/**
 * An identifier that follows a source until edited, is handed back when emptied, previews
 * as "Saved as `…`", and refuses a value already taken.
 *
 * Taken from the shop-create slug and the block library's live preview. The parent computes
 * `suggested` (usually `uniqueSuggestion(slugify(source), taken)` or `nextReference`); this
 * component is the follow / resume / refuse behaviour those pages used to each write themselves.
 *
 * Emptying does not refill between the operator and their next keystroke. The suggestion
 * returns on blur-while-empty, or on the next source change while the field is unedited — but
 * never into a field the operator has emptied, or stepped into empty, and is still in: a
 * suggestion that moves then, whether a source changed or a read answered late, waits for them
 * to leave it, so what they type next starts a value of their own rather than being appended
 * to it.
 *
 * `onChange` says who wrote the value: `"operator"` for a keystroke, a paste or an emptying,
 * `"suggestion"` where the field wrote `suggested` itself — following it, or handing it back.
 * A parent that derives its own value from `suggested` while the field follows — rather than
 * from the copy this field writes back a commit later — reads it from there (ADR 0064).
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
  follows = true,
  refusal,
  maxLength,
  preview = true,
  extraId,
  refusedBy,
  monospace = false,
  onChange,
  onLeave,
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
  /**
   * Whether this field writes `suggested` itself when it changes. A parent that derives the
   * value in its own source's change handler — the product handle, which is the address of
   * something saved and must never be rewritten by a mount, a discard or an echo landing
   * (ADR 0061) — turns it off. The suggestion is still shown, previewed and handed back on
   * blur-while-empty.
   */
  follows?: boolean;
  /**
   * Why the value in the field cannot be taken, when the parent refuses it for a reason of its
   * own — a product handle the lab would not store (ADR 0061). The field is then invalid and
   * says so, and never previews the value as what will be saved.
   */
  refusal?: string;
  /**
   * Where the lab caps the value's length, so the field stops where the lab would refuse.
   * Required: every value this field holds is sent to a rule with a cap, and a field without
   * one lets the operator type what the lab answers with a 422. `maxLength` stops typing only,
   * so a longer value the page put in the field — a suggestion — is refused on the field too.
   */
  maxLength: number;
  /**
   * Whether the second line previews the value as "Saved as `…`". An identifier is read back
   * because its shape is the point; a display name derived the same way — an experiment's —
   * is already legible in its own field, and would only be said twice.
   */
  preview?: boolean;
  /**
   * The id of the second line, for a page whose action is refused by what this field refuses
   * and names the field's line rather than writing the sentence twice (ADR 0063).
   */
  extraId?: string;
  /**
   * The line elsewhere on the form that says why the value in the field is refused — the
   * method forms' one reason line after their buttons (ADR 0072) — and whether that form is
   * touched. Once it is, the field is marked invalid and described by that line; until then
   * the line is a hint and the field is not called invalid (ADR 0078). It says nothing of its
   * own about it either way.
   */
  refusedBy?: RefusedBy;
  /** An identifier is read character by character, so it is drawn in the monospace face. */
  monospace?: boolean;
  onChange: (value: string, by: "operator" | "suggestion") => void;
  /**
   * The field was left, after an empty one has had its suggestion handed back. For a parent
   * that keeps something about the operator's current run of typing and ends it here.
   */
  onLeave?: () => void;
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
  const touchedRef = useRef(touched);
  touchedRef.current = touched;
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
  // Only a value the page wrote or normalized can be here: `maxLength` stops a keystroke or a
  // paste short, but not a suggestion, nor `normalize` lengthening what was typed ("ß" → "SS").
  const tooLong = !pending && !colliding && value.length > maxLength;
  const tooLongText = tooLong ? tooLongMessage(value.length, maxLength) : "";
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
    if (!follows || editedRef.current) {
      return;
    }
    // A keystroke is in the DOM before React has been told about it: this effect can run
    // between the operator's `input` event and the render that carries it, and `edited` is
    // still false there. The input itself is the only thing that knows, so ask it.
    const input = inputRef.current;
    if (input && input.value !== renderedRef.current) {
      return;
    }
    // Emptied by the operator, or stepped into empty, and still held: theirs, and about to be
    // typed into. A suggestion that moves now — a read answering late is the case — would be
    // written in ahead of their next keystroke. It waits for them to leave, which hands back
    // whatever is suggested then.
    if (
      input &&
      touchedRef.current &&
      renderedRef.current === "" &&
      input.ownerDocument.activeElement === input
    ) {
      return;
    }
    onChangeRef.current(suggested, "suggestion");
  }, [suggested, follows]);

  // Both refusals hold the form back natively, as a `required` field left empty does.
  const validity = collisionMessage || tooLongText;
  useEffect(() => {
    inputRef.current?.setCustomValidity(validity);
  }, [validity]);

  function change(next: string) {
    const normalized = normalize ? normalize(next) : next;
    // Emptying is a keystroke like any other: the field is the operator's from here, and the
    // suggestion is no longer shown in place of what they leave in it.
    setTouched(true);
    if (normalized === "") {
      setEdited(false);
      onChange("", "operator");
      return;
    }
    setEdited(true);
    onChange(normalized, "operator");
  }

  function restoreIfEmpty() {
    if (value === "") {
      setEdited(false);
      onChange(suggested, "suggestion");
    }
  }

  const refused = !pending && !colliding && refusal !== undefined && refusal !== "";
  const refusalLine = refusalLineOf(refusedBy);
  const extra = pending ? (
    `Reading what is already ${takenPlace}…`
  ) : colliding ? (
    collisionMessage
  ) : refused ? (
    refusal
  ) : tooLong ? (
    tooLongText
  ) : (preview && value) || whyTaken ? (
    <>
      {preview && value ? savedAsPreview(value) : null}
      {whyTaken ? ` ${whyTaken}` : null}
    </>
  ) : undefined;

  return (
    <FieldHint
      label={label}
      hint={hint}
      extra={extra}
      extraTone={colliding || refused || tooLong ? "error" : "muted"}
      extraId={extraId}
      arrangement={arrangement}
    >
      <input
        ref={inputRef}
        id={generatedId}
        className={monospace ? `${idControlClasses} w-full` : `${fieldControlClasses} w-full`}
        value={shown}
        required={required}
        pattern={pattern}
        title={title}
        placeholder={placeholder}
        maxLength={maxLength}
        // Closed until the field knows what it is going to suggest — and `shown` above means
        // the suggestion is already in it in the very commit that opens it, every time it
        // opens, so there is no moment in which this input is both open and empty.
        disabled={pending}
        aria-busy={pending || undefined}
        // Its own refusals — a collision, the parent's, a value too long — are said on its own
        // line from the first keystroke; the form's only once that line is (ADR 0078).
        aria-invalid={colliding || refused || tooLong || refusalLine !== undefined || undefined}
        aria-describedby={refusalLine}
        onChange={(event) => change(event.target.value)}
        // Stepping into a field with nothing in it is the operator's first act there, as
        // emptying one is: it is theirs from here, and a suggestion arriving now — nothing was
        // suggested yet — waits for them to leave rather than landing ahead of their typing.
        // The parent is told it holds an empty value of the operator's own.
        onFocus={() => {
          if (shown === "") {
            setTouched(true);
            onChange("", "operator");
          }
        }}
        onBlur={() => {
          restoreIfEmpty();
          onLeave?.();
        }}
      />
    </FieldHint>
  );
}
