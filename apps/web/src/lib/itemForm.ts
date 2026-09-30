import { useEffect, useRef, useState } from "react";
import { itemFormReason, useRegisterUnsavedWork } from "./unsavedWork";

/**
 * The state behind a list edited in the form below it — Shop details' two method lists and an
 * order's lines and events (ADR 0072, ADR 0074). The drawing is `components/ItemList.tsx`.
 */

/**
 * The first rule a form breaks, and the field that breaks it — or no field, where the rule is
 * about the list rather than anything typed (an order's cap on its events).
 */
export interface ItemRefusal<FieldT extends string = string> {
  field: FieldT | null;
  reason: string;
}

/** How the form and the prompt name what the list holds. */
export interface ItemFormWords {
  /** The form as the prompt names it: "Payment methods", "Line items". */
  form: string;
  /** One entry with its article: "a method", "a line", "an event". */
  entry: string;
  /** What the form writes into: "draft", "order". */
  record: string;
}

function sameFields<FieldsT extends object>(one: FieldsT, other: FieldsT): boolean {
  return (Object.keys(one) as (keyof FieldsT)[]).every((key) => one[key] === other[key]);
}

/**
 * The card's one form: blank and adding, or holding the entry whose Edit was pressed.
 *
 * `origin` is what the form was last filled with, so the form is unsaved work exactly while it
 * holds something else — an entry typed and not added, or an edit not yet saved — and says so
 * to the workspace's guard (ADR 0051). An entry taken off the list while the form edits it — a
 * removal, a discard that lands on a record without it — empties the form, because what it
 * holds is about an entry that is no longer there and Add would otherwise write it back. A clean
 * edit follows the entry as the record now holds it — a discard can put back another version
 * under the same key — so *Save changes* never writes back what the record no longer says; a
 * dirty one keeps the operator's typing. A clean add follows `blank` the same way, so a blank
 * that carries a choice the lab can make (ADR 0064) is the form's starting point rather than a
 * change the operator is asked about.
 */
export function useItemForm<FieldsT extends object>({
  blank,
  ids,
  words,
  nameOf,
  formOf,
  typedOf,
}: {
  blank: FieldsT;
  ids: readonly string[];
  words: ItemFormWords;
  nameOf: (id: string) => string;
  /** The form the record's entry of this key fills, as the record holds it now. */
  formOf: (id: string) => FieldsT;
  /** What the prompt quotes of an entry typed and not added, where the form has such a field. */
  typedOf?: (fields: FieldsT) => string;
}) {
  const [state, setState] = useState<{ editing: string | null; fields: FieldsT; origin: FieldsT }>({
    editing: null,
    fields: blank,
    origin: blank,
  });
  const stale = state.editing !== null && !ids.includes(state.editing);
  const editing = stale ? null : state.editing;
  const dirty = !stale && !sameFields(state.fields, state.origin);
  const current = dirty ? null : editing !== null ? formOf(editing) : blank;
  const moved = current !== null && !sameFields(current, state.origin);
  const fields = stale ? blank : moved && current !== null ? current : state.fields;

  useEffect(() => {
    if (stale) {
      setState({ editing: null, fields: blank, origin: blank });
    } else if (moved && current !== null) {
      setState((now) => ({ ...now, fields: current, origin: current }));
    }
  }, [stale, blank, moved, current]);

  const reset = () => setState({ editing: null, fields: blank, origin: blank });
  const typed = typedOf?.(fields).trim() ?? "";

  useRegisterUnsavedWork(
    dirty
      ? {
          label:
            editing !== null
              ? `The ${words.form} form holds an edit to ${nameOf(editing)} that has not reached the ${words.record}.`
              : typed !== ""
                ? `The ${words.form} form holds “${typed}”, which has not been added to the ${words.record}.`
                : `The ${words.form} form holds ${words.entry} that has not been added to the ${words.record}.`,
          unsavable: itemFormReason(words.entry, words.record),
          discard: reset,
        }
      : null,
  );

  return {
    editing,
    fields,
    dirty,
    update: (patch: Partial<FieldsT>) =>
      setState((now) => ({ ...now, fields: { ...now.fields, ...patch } })),
    begin: (id: string, loaded: FieldsT) =>
      setState({ editing: id, fields: loaded, origin: loaded }),
    reset,
  };
}

/** The form row's label: "Add a line" while adding, "Edit {name}" while editing. */
export function formTitle(
  editing: string | null,
  nameOf: (id: string) => string,
  entry: string,
): string {
  return editing === null ? `Add ${entry}` : `Edit ${nameOf(editing)}`;
}

/**
 * Focus that belongs to an element the next commit draws: the field a pressed Edit opens, the
 * Edit a saved or cancelled edit returns to.
 */
export function useFocusAfterCommit() {
  const pending = useRef<(() => HTMLElement | null | undefined) | null>(null);
  useEffect(() => {
    const target = pending.current;
    if (target !== null) {
      pending.current = null;
      target()?.focus();
    }
  });
  return (target: () => HTMLElement | null | undefined) => {
    pending.current = target;
  };
}

/** Edit buttons by the entry they open, so a finished edit hands focus back to its own. */
export function useEditButtons() {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  return {
    ref: (id: string) => (element: HTMLButtonElement | null) => {
      if (element) {
        buttons.current.set(id, element);
      } else {
        buttons.current.delete(id);
      }
    },
    get: (id: string) => buttons.current.get(id),
  };
}

/** A form control's refusal wiring: invalid and described by the line after the buttons. */
export function refusedProps<FieldT extends string>(
  refusal: ItemRefusal<FieldT> | null,
  field: FieldT,
  reasonId: string,
) {
  return refusal?.field === field
    ? { "aria-invalid": true as const, "aria-describedby": reasonId }
    : {};
}
