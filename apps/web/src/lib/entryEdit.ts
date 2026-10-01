import { type ReactNode, useEffect, useState } from "react";
import { useRegisterUnsavedWork } from "./unsavedWork";

/**
 * What a saved row's edit mode needs from the list that owns it.
 *
 * `fields` is the open form. It holds the entry's *authored* fields only: the identifier is
 * not among them, it stays on the header line as an `EntryId`, and Save writes it back
 * unchanged. Where an entry has no identifier of its own — a variant's SKU, a media
 * reference — the field that is the key is in `fields` and the list says what moving it
 * means.
 *
 * It lives here rather than beside `EntryCard` so that `entryEdit` below, which builds it,
 * does not have to reach from `lib/` into `components/`.
 */
export interface EntryEdit {
  /** Names Edit, Save and Cancel after the row they act on. */
  label: string;
  open: boolean;
  /**
   * The id of the line saying why, while another row holds the list's one open edit. The
   * list writes that line once and every row's Edit points at it, which is the convention
   * the variants table already follows for the rule its price boxes share.
   */
  blockedBy?: string;
  onOpen: () => void;
  onSave: () => void;
  onCancel: () => void;
  /**
   * Why Save is refused, and the id of the line in the row that says so; absent while the open
   * fields hold something the lab would take.
   *
   * A refused Save with nothing beside it is a refusal the operator has to guess at, which is
   * what `docs/design-direction.md`'s blocked-action rule is written against: the reason goes
   * in `title` and inline, and the Save stays reachable (ADR 0063). There is no bare "not
   * saveable": every refusal says why.
   */
  saveRefusal?: { id: string; reason: string };
  fields: ReactNode;
}

interface OpenRow<FieldsT> {
  id: string;
  label: string;
  fields: FieldsT;
}

/**
 * Whether two sets of fields hold the same values. Fields are plain data — strings, numbers,
 * booleans, arrays of them, and records of them, like a variant's chosen values — and a list
 * builds them afresh on every render, so identity says nothing and the comparison is by value.
 */
function sameValue(one: unknown, other: unknown): boolean {
  if (one === other) {
    return true;
  }
  if (Array.isArray(one) || Array.isArray(other)) {
    return (
      Array.isArray(one) &&
      Array.isArray(other) &&
      one.length === other.length &&
      one.every((item, index) => sameValue(item, other[index]))
    );
  }
  if (typeof one !== "object" || typeof other !== "object" || one === null || other === null) {
    return false;
  }
  const left = one as Record<string, unknown>;
  const right = other as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
  );
}

/**
 * Which saved row of one list is open for editing, and the fields it was opened with.
 *
 * **One row at a time, per list.** A second open row would be a second uncommitted payload
 * with nowhere to live: edit mode writes into the draft only when Save is pressed, so an open
 * row's typing is not in `content` and the page's own "Save draft" cannot carry it. One of
 * those is a thing a card can say in one line; a set of them is a thing no card can say.
 *
 * The fields are the *authored* fields of the entry, never its identifier: an ID is derived
 * once when an entry is created (`lib/entryIds.ts`), because the change summary is keyed on
 * it — `diff_keyed_collection` in `domain/definitions.py` reports an entry whose key moved as
 * a removal and an addition rather than as an update.
 */
export interface EntryEditor<FieldsT extends object> {
  /** The open row, or null when the list has none. */
  open: OpenRow<FieldsT> | null;
  isOpen: (id: string) => boolean;
  /** True while another row of this list holds the one open edit. */
  blocked: (id: string) => boolean;
  /** What the list calls the entry of this key, as the list holds it now. */
  labelOf: (id: string) => string;
  /** Opens the row on the entry's fields as the list holds them now. */
  begin: (id: string) => void;
  change: (fields: FieldsT) => void;
  close: () => void;
}

/**
 * The open fields moved onto what the list now holds, key by key: a top-level key the operator
 * has not touched since the row last followed takes the entry's value, and a key they typed in
 * keeps its typing. A variant's chosen values are one key, so one moved choice holds all of them.
 *
 * A list whose fields only make sense together — a template parameter's kind, requiredness and
 * default — is not edited here: it moved to the form below its list (ADR 0074), which follows
 * the entry whole while clean and keeps all it holds while dirty.
 */
function follow<FieldsT extends object>(
  fields: FieldsT,
  origin: FieldsT,
  current: FieldsT,
): FieldsT {
  const typed = fields as Record<string, unknown>;
  const was = origin as Record<string, unknown>;
  const now = current as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(now).map((key) => [key, sameValue(typed[key], was[key]) ? now[key] : typed[key]]),
  ) as FieldsT;
}

/** How a list names, keys and fills its entries, for the one row of it that is open. */
export interface EntryEditSource<EntryT, FieldsT> {
  /** An entry's key: the id its row is opened, saved and closed by. */
  keyOf: (entry: EntryT) => string;
  /** What Edit, Save, Cancel, the list's notice and the navigation prompt call the entry. */
  labelOf: (entry: EntryT) => string;
  /** The open form an entry fills, as the list holds that entry now. */
  fieldsOf: (entry: EntryT) => FieldsT;
}

/**
 * An open row is unsaved work that `useDefinitionEditor`'s `dirty` flag cannot see, because
 * edit mode holds its draft outside `content` on purpose. It is therefore declared to the
 * workspace's register of unsaved work from here — one declaration per list, made by the hook
 * every editable list already calls, so no page can hold an editable list and forget to guard
 * it (ADR 0051). It declares no `save`: nothing typed in an open row has reached the draft, so
 * no page-level Save has ever carried it and the navigation prompt does not pretend to.
 *
 * **An open row follows its entry, except where the operator has typed** (ADR 0051, amended).
 * Whatever moves the entry under it — the page's Discard re-reading the draft, a refetch, a
 * sibling control that writes the entry:
 *
 * - An open row whose entry the list no longer holds is closed. A row left open against it
 *   would render stale fields and disable every sibling's Edit behind a notice naming an entry
 *   that is gone.
 * - Every field the operator has not typed in — all of them, in a row opened and left alone, or
 *   typed back to what it opened on — takes the entry's value as the list now holds it. A field
 *   left on its old value would show what the draft no longer says, and the row's Save would
 *   write it back over the discard.
 * - A field the operator typed in keeps the typing. The page's Discard undoes what the page's
 *   Save would have written, and that has never carried an open row (ADR 0051, ADR 0061's S3
 *   and S10); the row's own Cancel, or the prompt's *Discard and leave*, throws typing away.
 * - The row's name is read off the entry on every render, so the notice and the prompt name the
 *   entry as it now stands, not as it stood when Edit was pressed.
 *
 * This is the rule `useItemForm` (`lib/itemForm.ts`) keeps for an edit in a card's form, taken
 * down to the field.
 *
 * @param entries the entries the list currently holds, in any order.
 */
export function useEntryEdit<EntryT, FieldsT extends object>(
  entries: readonly EntryT[],
  { keyOf, labelOf, fieldsOf }: EntryEditSource<EntryT, FieldsT>,
): EntryEditor<FieldsT> {
  const [state, setState] = useState<{ id: string; fields: FieldsT; origin: FieldsT } | null>(null);

  const entryOf = (id: string) => entries.find((entry) => keyOf(entry) === id);
  const held = state === null ? undefined : entryOf(state.id);
  // Derived rather than corrected in an effect, so there is never a render in which the row
  // is still open against an entry the list no longer holds, or shows a field the entry has
  // since moved off.
  const stale = state !== null && held === undefined;
  const current = state === null || held === undefined ? null : fieldsOf(held);
  const moved = state !== null && current !== null && !sameValue(current, state.origin);
  const followed =
    state !== null && moved && current !== null
      ? follow(state.fields, state.origin, current)
      : (state?.fields ?? null);
  const open: OpenRow<FieldsT> | null =
    state === null || held === undefined || followed === null
      ? null
      : { id: state.id, label: labelOf(held), fields: followed };

  useEffect(() => {
    if (stale) {
      setState(null);
    } else if (moved && current !== null) {
      setState((now) =>
        now === null
          ? now
          : { ...now, fields: follow(now.fields, now.origin, current), origin: current },
      );
    }
  }, [stale, moved, current]);

  useRegisterUnsavedWork(
    open === null
      ? null
      : {
          label: `${open.label} is open for editing, and nothing typed in it has reached the draft.`,
          discard: () => setState(null),
        },
  );

  return {
    open,
    isOpen: (id) => open?.id === id,
    blocked: (id) => open !== null && open.id !== id,
    labelOf: (id) => {
      const entry = entryOf(id);
      return entry === undefined ? id : labelOf(entry);
    },
    begin: (id) => {
      const entry = entryOf(id);
      if (entry !== undefined) {
        const fields = fieldsOf(entry);
        setState({ id, fields, origin: fields });
      }
    },
    change: (fields) => setState((now) => (now === null ? now : { ...now, fields })),
    close: () => setState(null),
  };
}

/**
 * The `EntryEdit` one saved row hands `EntryCard`, assembled from the list's editor.
 *
 * Every editable list in the workspace wires open, save and cancel the same way, so the
 * wiring is written once: the row is named and opened on the entry as the list's
 * `useEntryEdit` reads it, so a row opens on exactly what it later follows — Save hands them back to
 * the caller, Cancel drops them, and a row that is not the open one carries the reason its
 * Edit is disabled. It was four copies of this function for one branch, and the copies had
 * already drifted — which is the failure this slice exists to remove, so it is one function.
 */
export function entryEdit<FieldsT extends object>(
  editor: EntryEditor<FieldsT>,
  noticeId: string,
  id: string,
  onSave: (fields: FieldsT) => void,
  fields: (value: FieldsT, onChange: (next: FieldsT) => void) => ReactNode,
  /**
   * Whether the open fields hold something the lab would take; saveable when omitted.
   *
   * `true` saves. A `{ id, reason }` refuses *and* says why: the reason rides in the Save's
   * `title`, and the id names the line in the row that carries it where an operator can read
   * it. There is no silent refusal (ADR 0063).
   */
  saveable?: (value: FieldsT) => true | { id: string; reason: string },
): EntryEdit {
  const open = editor.isOpen(id);
  const label = editor.labelOf(id);
  const openFields = open ? editor.open : null;
  const verdict = openFields && saveable ? saveable(openFields.fields) : true;
  const refusal = verdict === true ? null : verdict;
  return {
    label,
    open,
    blockedBy: editor.blocked(id) ? noticeId : undefined,
    onOpen: () => editor.begin(id),
    onSave: () => {
      if (openFields) {
        onSave(openFields.fields);
      }
      editor.close();
    },
    onCancel: () => editor.close(),
    saveRefusal: refusal ?? undefined,
    fields: openFields ? fields(openFields.fields, editor.change) : null,
  };
}
