import type { FormEvent, ReactNode } from "react";
import type { ItemRefusal } from "../lib/itemForm";
import type { Removal } from "../lib/removal";
import {
  itemClasses,
  itemEditButtonClasses,
  itemMoveButtonClasses,
  itemRemoveButtonClasses,
  outlineButtonClasses,
  readOnlyValueClasses,
} from "../lib/ui";
import { ButtonIcon } from "./ButtonIcon";
import { FieldGroup, FieldHint } from "./FieldHint";
import { PrimaryAction, RefusalLine } from "./PrimaryAction";

/**
 * A list edited in the form below it, as the methods handoff draws Shop details' *Payment
 * methods* (`tmp/design-frames/design_handoff_shop_details_methods/`, ADR 0072) and ADR 0074
 * makes the workspace's: a row listing the entries as items, and a row whose one form adds an
 * entry or edits the one chosen. The form's state is `useItemForm` in `lib/itemForm.ts`.
 */

/**
 * One entry on its list: the name at 13.5px 700, the key in monospace, one detail line, and
 * its actions. Its border and ground say it is the one the form is editing.
 *
 * `tag` stands beside the name, ahead of the key, for what the list says of one entry among
 * the others — the address book's *Default* pill (`Workspace.dc.html` :2888), an attribute's
 * type. `detail` may be nothing, where the entry has no line to give, and `multiline` keeps the
 * line breaks of a detail authored in a text area — a guidance note's body — which otherwise
 * read run-on. A detail may be drawn rather than written — an option's values as the chips
 * frame 2c draws — and stays one line of the item.
 *
 * An entry whose name *is* its key — a media reference, a template's parameter — draws the
 * name in monospace (`monospace`) and no second key beside it (`id` left out).
 *
 * `lead` stands before the name, as `EntryCard`'s does, for a control the list keeps on each
 * entry that is neither Edit nor Remove and reads first: the default guideline's radio. It is
 * the list's control, never the form's (ADR 0072), so it stays free while the form edits.
 */
export function ListItem({
  name,
  id,
  detail,
  tag,
  lead,
  multiline = false,
  monospace = false,
  editing,
  children,
}: {
  name: string;
  id?: string;
  detail: ReactNode;
  tag?: ReactNode;
  lead?: ReactNode;
  multiline?: boolean;
  monospace?: boolean;
  editing: boolean;
  children: ReactNode;
}) {
  return (
    <li className={itemClasses(editing)} aria-current={editing || undefined}>
      {lead === undefined ? null : <div className="flex flex-none items-center">{lead}</div>}
      <div className="min-w-0 flex-[1_1_180px]">
        <div className="flex flex-wrap items-baseline gap-2">
          <span
            className={`text-[13.5px] font-bold text-admin-ink${monospace ? " font-mono [overflow-wrap:anywhere]" : ""}`}
          >
            {name}
          </span>
          {tag}
          {id === undefined ? null : (
            <code className="font-mono text-[11.5px] text-[#8c9196]">{id}</code>
          )}
        </div>
        {detail === null || detail === undefined ? null : (
          <div
            className={`mt-[3px] text-[12.5px] text-[#6a7580]${multiline ? " whitespace-pre-line" : ""}`}
          >
            {detail}
          </div>
        )}
      </div>
      {/* The actions wrap as one group, so a narrow row never leaves the trash on a line of
          its own. */}
      <div className="ml-auto flex flex-none items-center gap-[11px]">{children}</div>
    </li>
  );
}

/** The 30px pencil, named "Edit {name}". */
export function EditButton({
  name,
  buttonRef,
  onEdit,
}: {
  name: string;
  buttonRef: (element: HTMLButtonElement | null) => void;
  onEdit: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={itemEditButtonClasses}
      aria-label={`Edit ${name}`}
      title={`Edit ${name}`}
      onClick={onEdit}
    >
      <ButtonIcon verb="edit" />
    </button>
  );
}

/**
 * A 30px arrow, named "Move {name} up" or "Move {name} down", for a list whose order is authored
 * — a template's parameters, which a binding follows. It stands before the pencil, and the end
 * of the list it cannot pass is a native `disabled`, as a secondary control's is (ADR 0063).
 */
export function MoveButton({
  name,
  direction,
  disabled,
  onMove,
}: {
  name: string;
  direction: "up" | "down";
  disabled: boolean;
  onMove: () => void;
}) {
  const label = `Move ${name} ${direction}`;
  return (
    <button
      type="button"
      className={itemMoveButtonClasses}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onMove}
    >
      <span aria-hidden>{direction === "up" ? "↑" : "↓"}</span>
    </button>
  );
}

/**
 * The 30px trash, named "Remove {name}", asking twice where the preference says to (ADR 0060).
 * `label` replaces that name where a list names its entries otherwise: a background entry's
 * trash is "Remove the 2026-05-02 background entry", as its confirm and its notice name it.
 */
export function RemoveButton({
  name,
  label = `Remove ${name}`,
  entryKey,
  removal,
  notice,
  held,
  describedBy,
  onRemove,
}: {
  name: string;
  label?: string;
  entryKey: string;
  removal: Removal;
  notice: string;
  /** Why this entry cannot be removed, or nothing. */
  held?: string;
  describedBy?: string;
  onRemove: () => void;
}) {
  return (
    <button
      ref={removal.trigger(entryKey)}
      type="button"
      className={itemRemoveButtonClasses}
      aria-label={label}
      title={held ?? label}
      disabled={held !== undefined}
      aria-describedby={held !== undefined ? describedBy : undefined}
      onClick={removal.ask(entryKey, onRemove, notice)}
    >
      <ButtonIcon verb="delete" />
    </button>
  );
}

/**
 * A key shown and fixed while its entry is edited: something else already names the entry by
 * it — a variant chooses an option by its key, a configuration a guideline by its ID, a scenario
 * a parameter by its name. Read-only rather than disabled, so it is still read and focusable.
 */
export function FixedKeyField({
  label,
  hint,
  value,
}: {
  label: string;
  hint: string;
  value: string;
}) {
  return (
    <FieldHint label={label} hint={hint}>
      <input className={`${readOnlyValueClasses} font-mono`} value={value} readOnly />
    </FieldHint>
  );
}

/**
 * The form row: its fields in the handoff's auto-fit grid, then the action — *Add …*, or *Save
 * changes* and *Cancel* while editing — and after it the one reason the action is refused
 * with, where the handoff draws its error (ADR 0072).
 */
export function ItemFormRow({
  title,
  hint,
  editing,
  addLabel,
  refusal,
  reasonId,
  onSubmit,
  onCancel,
  children,
}: {
  title: string;
  /** The form's rule, where it has one to state (*Guidance lives under the field*). */
  hint?: string;
  editing: boolean;
  addLabel: string;
  refusal: ItemRefusal | null;
  reasonId: string;
  onSubmit: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <FieldGroup label={title} hint={hint}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(160px,100%),1fr))] items-start gap-3">
          {children}
        </div>
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <PrimaryAction
            variant="accent"
            type="submit"
            refusal={refusal ? { id: reasonId, reason: refusal.reason } : null}
          >
            <ButtonIcon verb={editing ? "save" : "create"} />
            {editing ? "Save changes" : addLabel}
          </PrimaryAction>
          {editing ? (
            <button type="button" className={outlineButtonClasses} onClick={onCancel}>
              Cancel
            </button>
          ) : null}
          {/* Polite, and mounted while empty, so a reason that appears as the operator types
              is heard without taking them out of the field they are in. */}
          <div aria-live="polite" aria-atomic="true">
            {refusal ? <RefusalLine id={reasonId}>{refusal.reason}</RefusalLine> : null}
          </div>
        </div>
      </FieldGroup>
    </form>
  );
}
