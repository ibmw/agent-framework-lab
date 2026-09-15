import { type ReactNode, useEffect, useState } from "react";

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
  /** False while the open fields hold something the lab would refuse. */
  saveable?: boolean;
  fields: ReactNode;
}

interface OpenRow<FieldsT> {
  id: string;
  label: string;
  fields: FieldsT;
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
export interface EntryEditor<FieldsT> {
  /** The open row, or null when the list has none. */
  open: OpenRow<FieldsT> | null;
  isOpen: (id: string) => boolean;
  /** True while another row of this list holds the one open edit. */
  blocked: (id: string) => boolean;
  begin: (id: string, label: string, fields: FieldsT) => void;
  change: (fields: FieldsT) => void;
  close: () => void;
}

/**
 * An open row is also unsaved work that `useDefinitionEditor`'s `dirty` flag cannot see, so
 * PLAN-UX Slice 8's navigation guard has to learn about it. The path it registers through is
 * Slice 8's to choose — counting open rows into `dirty`, holding them beside it, or lifting
 * these editors into a context — so nothing is offered here in advance; a seam shaped for one
 * of the three would decide a question that slice is told it owns.
 *
 * @param ids the ids the list currently holds, in any order. An open row whose id is no
 *   longer among them is closed: a draft that is refetched or discarded — which Slice 8 adds
 *   — can drop the entry being edited, and a row left open against it would render stale
 *   fields and disable every sibling's Edit behind a notice naming an entry that is gone.
 */
export function useEntryEdit<FieldsT>(ids: readonly string[]): EntryEditor<FieldsT> {
  const [state, setState] = useState<OpenRow<FieldsT> | null>(null);

  // Derived rather than corrected in an effect, so there is never a render in which the row
  // is still open against an entry the list no longer holds.
  const open = state !== null && ids.includes(state.id) ? state : null;

  useEffect(() => {
    if (state !== null && open === null) {
      setState(null);
    }
  }, [state, open]);

  return {
    open,
    isOpen: (id) => open?.id === id,
    blocked: (id) => open !== null && open.id !== id,
    begin: (id, label, fields) => setState({ id, label, fields }),
    change: (fields) =>
      setState((current) => (current === null ? current : { ...current, fields })),
    close: () => setState(null),
  };
}

/**
 * The `EntryEdit` one saved row hands `EntryCard`, assembled from the list's editor.
 *
 * Every editable list in the workspace wires open, save and cancel the same way, so the
 * wiring is written once: the row opens on the entry's own fields, Save hands them back to
 * the caller, Cancel drops them, and a row that is not the open one carries the reason its
 * Edit is disabled. It was four copies of this function for one branch, and the copies had
 * already drifted — which is the failure this slice exists to remove, so it is one function.
 */
export function entryEdit<FieldsT>(
  editor: EntryEditor<FieldsT>,
  noticeId: string,
  id: string,
  label: string,
  fieldsOf: () => FieldsT,
  onSave: (fields: FieldsT) => void,
  fields: (value: FieldsT, onChange: (next: FieldsT) => void) => ReactNode,
  /** Whether the open fields hold something the lab would take; saveable when omitted. */
  saveable?: (value: FieldsT) => boolean,
): EntryEdit {
  const open = editor.isOpen(id);
  const openFields = open ? editor.open : null;
  return {
    label,
    open,
    blockedBy: editor.blocked(id) ? noticeId : undefined,
    onOpen: () => editor.begin(id, label, fieldsOf()),
    onSave: () => {
      if (openFields) {
        onSave(openFields.fields);
      }
      editor.close();
    },
    onCancel: () => editor.close(),
    saveable: openFields && saveable ? saveable(openFields.fields) : true,
    fields: openFields ? fields(openFields.fields, editor.change) : null,
  };
}
