import type { FulfilmentMethodSchema, PaymentMethodSchema } from "@agent-lab/contracts";
import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ButtonIcon } from "../components/ButtonIcon";
import { ConfirmRemove, RemovalNotice } from "../components/ConfirmRemove";
import { DerivedIdField } from "../components/DerivedIdField";
import { FieldGroup, FieldHint, FieldRows } from "../components/FieldHint";
import { PrimaryAction, RefusalLine } from "../components/PrimaryAction";
import { Card } from "../components/WorkspaceChrome";
import { SLUG_MAX_LENGTH, slugify, uniqueSuggestion } from "../lib/entryIds";
import { labelOf, PAYMENT_METHOD_KIND } from "../lib/enumLabels";
import { consequenceOf, findingClauses, type Removal, useRemoval } from "../lib/removal";
import {
  BLANK_FULFILMENT,
  BLANK_PAYMENT,
  type FulfilmentForm,
  fulfilmentFormOf,
  fulfilmentMethodOf,
  fulfilmentRefusal,
  LAST_ENABLED_REMOVAL_RULE,
  LAST_ENABLED_SWITCH_RULE,
  lastEnabledPaymentId,
  MAX_TRANSIT_DAYS,
  METHOD_ID_TAKEN_PLACE,
  METHOD_LABEL_MAX_LENGTH,
  type MethodField,
  type MethodRefusal,
  type PaymentForm,
  paymentFormOf,
  paymentKindOptions,
  paymentMethodOf,
  paymentRefusal,
  transitWindow,
} from "../lib/shopMethods";
import {
  fieldControlClasses,
  focusRingClasses,
  outlineButtonClasses,
  readOnlyValueClasses,
  validationMessageClasses,
} from "../lib/ui";
import { METHOD_FORM_REASON, useRegisterUnsavedWork } from "../lib/unsavedWork";
import { useShopWorkspace } from "../shell/useShopWorkspace";

/**
 * Shop details' *Payment methods* and *Fulfilment methods*, as the methods handoff draws them
 * (`tmp/design-frames/design_handoff_shop_details_methods/`): each card a row listing the
 * methods and a row whose one form adds a method or edits the one chosen (ADR 0072).
 */

const ID_FOLLOWS_HINT =
  "Lowercase with hyphens. Follows the name until you edit it; empty it to follow again.";

/**
 * A saved method's ID is shown and never asked: an order names its method by it
 * (`payment.method_id`, `fulfilment.method_id` in `domain/order_fixture.py`), and the change
 * summary keys the list on it, so a moved ID reads as a removal and an addition.
 */
const ID_FIXED_HINT = "Set when the method was added. Orders name the method by it.";

/** One method on its list. Its border and ground say it is the one the form is editing. */
function methodItemClasses(editing: boolean): string {
  return `flex flex-wrap items-center gap-[11px] rounded-[9px] border px-3.5 py-[11px] ${
    editing ? "border-[#8fc3a5] bg-[#f1f8f3]" : "border-admin-border bg-[#fafbfb]"
  }`;
}

const iconButtonClasses = `flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border border-admin-quiet-border bg-admin-surface text-admin-muted transition ${focusRingClasses}`;
const editButtonClasses = `${iconButtonClasses} hover:bg-[#f6f7f8] hover:text-admin-ink`;
// A held Remove fades as a secondary control refused for a reason does (ADR 0063), and loses
// the hover that would promise a press.
const removeButtonClasses = `${iconButtonClasses} enabled:hover:border-[#c98676] enabled:hover:text-lab-error disabled:cursor-not-allowed disabled:opacity-55`;

function MethodItem({
  name,
  id,
  detail,
  editing,
  children,
}: {
  name: string;
  id: string;
  detail: string;
  editing: boolean;
  children: ReactNode;
}) {
  return (
    <li className={methodItemClasses(editing)} aria-current={editing || undefined}>
      <div className="min-w-0 flex-[1_1_180px]">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[13.5px] font-bold text-admin-ink">{name}</span>
          <code className="font-mono text-[11.5px] text-[#8c9196]">{id}</code>
        </div>
        <div className="mt-[3px] text-[12.5px] text-[#6a7580]">{detail}</div>
      </div>
      {/* The actions wrap as one group, so a narrow row never leaves the trash on a line of
          its own. */}
      <div className="ml-auto flex flex-none items-center gap-[11px]">{children}</div>
    </li>
  );
}

/**
 * A payment method's *enabled*, as the handoff's switch: a native checkbox with the switch
 * role, laid transparent over the track and its word as the toggle chips are, so Space
 * toggles it, it is one tab stop, and it is announced as a switch that is on or off.
 */
function EnabledSwitch({
  method,
  held,
  describedBy,
  onToggle,
}: {
  method: PaymentMethodSchema;
  /** It is the last enabled method, which stays on. */
  held: boolean;
  describedBy?: string;
  onToggle: () => void;
}) {
  const on = method.enabled;
  return (
    <label
      title={held ? LAST_ENABLED_SWITCH_RULE : on ? "Disable" : "Enable"}
      className={`relative flex flex-none items-center gap-2 rounded-md text-[12.5px] font-[650] text-admin-ink-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-lab-primary ${
        held ? "cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        role="switch"
        className="absolute inset-0 m-0 h-full w-full cursor-[inherit] appearance-none opacity-0"
        checked={on}
        // Native checkboxes carry their state; the switch role is checked by `aria-checked`.
        aria-checked={on}
        disabled={held}
        title={held ? LAST_ENABLED_SWITCH_RULE : undefined}
        aria-label={method.name}
        aria-describedby={describedBy}
        onChange={onToggle}
      />
      <span
        aria-hidden="true"
        className={`relative block h-5 w-[34px] flex-none rounded-full transition-colors ${
          on ? "bg-lab-primary" : "bg-admin-field-border"
        }`}
      >
        <span
          className={`absolute top-0.5 block h-4 w-4 rounded-full bg-admin-surface shadow-[0_1px_2px_rgb(0_0_0/25%)] transition-[left] motion-reduce:transition-none ${
            on ? "left-4" : "left-0.5"
          }`}
        />
      </span>
      {/* The state, which the switch role and its checked state carry: the switch is named by
          its method alone, so its name never contradicts this word (WCAG 2.5.3). */}
      <span aria-hidden="true">{on ? "Enabled" : "Disabled"}</span>
    </label>
  );
}

function EditButton({
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
      className={editButtonClasses}
      aria-label={`Edit ${name}`}
      title={`Edit ${name}`}
      onClick={onEdit}
    >
      <ButtonIcon verb="edit" />
    </button>
  );
}

/** The trash, asking twice where the preference says to (ADR 0060). */
function RemoveButton({
  name,
  entryKey,
  removal,
  notice,
  held,
  describedBy,
  onRemove,
}: {
  name: string;
  entryKey: string;
  removal: Removal;
  notice: string;
  /** Why this method cannot be removed, or nothing. */
  held?: string;
  describedBy?: string;
  onRemove: () => void;
}) {
  return (
    <button
      ref={removal.trigger(entryKey)}
      type="button"
      className={removeButtonClasses}
      aria-label={`Remove ${name}`}
      title={held ?? `Remove ${name}`}
      disabled={held !== undefined}
      aria-describedby={held !== undefined ? describedBy : undefined}
      onClick={removal.ask(entryKey, onRemove, notice)}
    >
      <ButtonIcon verb="delete" />
    </button>
  );
}

function sameFields<FieldsT extends object>(one: FieldsT, other: FieldsT): boolean {
  return (Object.keys(one) as (keyof FieldsT)[]).every((key) => one[key] === other[key]);
}

/**
 * The card's one form: blank and adding, or holding the method whose Edit was pressed.
 *
 * `origin` is what the form was last filled with, so the form is unsaved work exactly while it
 * holds something else — a method typed and not added, or an edit not yet saved — and says so
 * to the workspace's guard (ADR 0051). A method taken off the list while the form edits it — a
 * removal, a discard that lands on a draft without it — empties the form, because what it holds
 * is about a method that is no longer there and Add would otherwise write it back. A clean edit
 * follows the method as the draft now holds it — a discard can put back another version under
 * the same ID — so *Save changes* never writes back what the draft no longer says; a dirty one
 * keeps the operator's typing.
 */
function useMethodForm<FieldsT extends { name: string }>({
  blank,
  ids,
  cardTitle,
  nameOf,
  formOf,
}: {
  blank: FieldsT;
  ids: readonly string[];
  cardTitle: string;
  nameOf: (id: string) => string;
  /** The form the draft's method of this ID fills, as the draft holds it now. */
  formOf: (id: string) => FieldsT;
}) {
  const [state, setState] = useState<{ editing: string | null; fields: FieldsT; origin: FieldsT }>({
    editing: null,
    fields: blank,
    origin: blank,
  });
  const stale = state.editing !== null && !ids.includes(state.editing);
  const editing = stale ? null : state.editing;
  const dirty = !stale && !sameFields(state.fields, state.origin);
  const current = editing !== null && !dirty ? formOf(editing) : null;
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
  const typed = fields.name.trim();

  useRegisterUnsavedWork(
    dirty
      ? {
          label:
            editing !== null
              ? `The ${cardTitle} form holds an edit to ${nameOf(editing)} that has not reached the draft.`
              : typed !== ""
                ? `The ${cardTitle} form holds “${typed}”, which has not been added to the draft.`
                : `The ${cardTitle} form holds a method that has not been added to the draft.`,
          unsavable: METHOD_FORM_REASON,
          discard: reset,
        }
      : null,
  );

  return {
    editing,
    fields,
    dirty,
    update: (patch: Partial<FieldsT>) =>
      setState((current) => ({ ...current, fields: { ...current.fields, ...patch } })),
    begin: (id: string, loaded: FieldsT) =>
      setState({ editing: id, fields: loaded, origin: loaded }),
    reset,
  };
}

/**
 * Focus that belongs to an element the next commit draws: the Name field a pressed Edit opens,
 * the Edit a saved or cancelled edit returns to.
 */
function useFocusAfterCommit() {
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

/** Edit buttons by the method they open, so a finished edit hands focus back to its own. */
function useEditButtons() {
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
function refusedProps(refusal: MethodRefusal | null, field: MethodField, reasonId: string) {
  return refusal?.field === field
    ? { "aria-invalid": true as const, "aria-describedby": reasonId }
    : {};
}

/**
 * The form row: its fields in the handoff's auto-fit grid, then the action — *Add …*, or *Save
 * changes* and *Cancel* while editing — and after it the one reason the action is refused
 * with, where the handoff draws its error (ADR 0072).
 */
function MethodFormRow({
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
  hint: string;
  editing: boolean;
  addLabel: string;
  refusal: MethodRefusal | null;
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

/** The ID field: derived while adding, shown and fixed while editing. */
function MethodIdField({
  editing,
  value,
  name,
  taken,
  refusal,
  reasonId,
  onChange,
}: {
  editing: boolean;
  value: string;
  name: string;
  taken: readonly string[];
  refusal: MethodRefusal | null;
  reasonId: string;
  onChange: (id: string) => void;
}) {
  const suggested = uniqueSuggestion(slugify(name, ""), taken);
  if (editing) {
    return (
      <FieldHint label="ID" hint={ID_FIXED_HINT}>
        <input className={`${readOnlyValueClasses} font-mono`} value={value} readOnly />
      </FieldHint>
    );
  }
  return (
    <DerivedIdField
      label="ID"
      hint={ID_FOLLOWS_HINT}
      value={value}
      suggested={suggested.value}
      takenBase={suggested.takenBase}
      takenPlace={METHOD_ID_TAKEN_PLACE}
      preview={false}
      monospace
      maxLength={SLUG_MAX_LENGTH}
      refusedBy={refusal?.field === "id" ? reasonId : undefined}
      onChange={onChange}
    />
  );
}

function formTitle(editing: string | null, nameOf: (id: string) => string): string {
  return editing === null ? "Add a method" : `Edit ${nameOf(editing)}`;
}

export function PaymentMethodsCard() {
  const { shopId, content, edit } = useShopWorkspace();
  const methods = content.payment_methods;
  const ids = methods.map((method) => method.id);
  const nameOf = (id: string) => methods.find((method) => method.id === id)?.name ?? id;
  const form = useMethodForm<PaymentForm>({
    blank: BLANK_PAYMENT,
    ids,
    cardTitle: "Payment methods",
    nameOf,
    formOf: (id) =>
      paymentFormOf(methods.find((method) => method.id === id) as PaymentMethodSchema),
  });
  const removal = useRemoval(shopId);
  const editButtons = useEditButtons();
  const focusAfterCommit = useFocusAfterCommit();
  const nameInput = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  const lastLineId = useId();
  const lastEnabled = lastEnabledPaymentId(methods);
  const refusal = paymentRefusal(form.fields, ids, form.editing);
  // A blank form is refused and says why, but no field of it is marked wrong until the operator
  // has put something in it.
  const marked = form.dirty ? refusal : null;
  const title = formTitle(form.editing, nameOf);

  function toggle(method: PaymentMethodSchema) {
    if (method.id === lastEnabled) {
      return;
    }
    edit({
      ...content,
      payment_methods: methods.map((entry) =>
        entry.id === method.id ? { ...entry, enabled: !entry.enabled } : entry,
      ),
    });
  }

  function drop(id: string) {
    // No guard for the last enabled method: its Remove is natively disabled, and a confirm
    // armed before the others were switched off is dropped rather than drawn, so no press
    // reaches here for it.
    edit({ ...content, payment_methods: methods.filter((entry) => entry.id !== id) });
  }

  function submit() {
    if (refusal !== null) {
      return;
    }
    const editing = form.editing;
    if (editing !== null) {
      edit({
        ...content,
        payment_methods: methods.map((entry) =>
          // `enabled` is the row's switch, read as it stands now rather than when Edit was
          // pressed, so a toggle made while the form was open survives the save.
          entry.id === editing ? paymentMethodOf(form.fields, entry.enabled) : entry,
        ),
      });
      focusAfterCommit(() => editButtons.get(editing));
    } else {
      // Added enabled: nothing on the form asks, and a disabled new method would be an answer
      // the operator did not give.
      edit({ ...content, payment_methods: [...methods, paymentMethodOf(form.fields, true)] });
    }
    form.reset();
  }

  return (
    <Card title="Payment methods">
      <p className="text-[13px] text-admin-muted">
        What a customer can pay with. An order records the method it was paid by.
      </p>
      <FieldRows>
        <FieldGroup
          label="Accepted"
          hint="A disabled method stays on the orders that recorded it. At least one stays enabled: a shop with none is refused at publication."
        >
          <div className="grid gap-2">
            {methods.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {methods.map((method) => {
                  const held = method.id === lastEnabled;
                  const notice = `Removed the payment method “${method.name}” from the draft.`;
                  // Not asked about while held, so a confirm armed before the others were
                  // switched off is dropped rather than left standing over a refused removal.
                  if (!held && removal.isArmed(method.id)) {
                    return (
                      <ConfirmRemove
                        key={method.id}
                        as="li"
                        title={`Remove the payment method “${method.name}”?`}
                        consequence={consequenceOf(
                          "The shop stops offering it once the draft is saved and published.",
                          findingClauses(["payment_method_missing_from_shop"]),
                          "Nothing is written until you save the draft, and a published shop version keeps it.",
                        )}
                        onConfirm={removal.confirm(() => drop(method.id), notice)}
                        onKeep={removal.keep}
                      />
                    );
                  }
                  return (
                    <MethodItem
                      key={method.id}
                      name={method.name}
                      id={method.id}
                      detail={labelOf(PAYMENT_METHOD_KIND, method.kind)}
                      editing={form.editing === method.id}
                    >
                      <EnabledSwitch
                        method={method}
                        held={held}
                        describedBy={held ? lastLineId : undefined}
                        onToggle={() => toggle(method)}
                      />
                      <EditButton
                        name={method.name}
                        buttonRef={editButtons.ref(method.id)}
                        onEdit={() => {
                          form.begin(method.id, paymentFormOf(method));
                          focusAfterCommit(() => nameInput.current);
                        }}
                      />
                      <RemoveButton
                        name={method.name}
                        entryKey={method.id}
                        removal={removal}
                        notice={notice}
                        held={held ? LAST_ENABLED_REMOVAL_RULE : undefined}
                        describedBy={lastLineId}
                        onRemove={() => drop(method.id)}
                      />
                    </MethodItem>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-admin-muted">No payment method yet.</p>
            )}
            {lastEnabled !== null ? (
              <p id={lastLineId} className="text-[13px] text-admin-muted">
                {LAST_ENABLED_SWITCH_RULE}. {LAST_ENABLED_REMOVAL_RULE}
              </p>
            ) : null}
            <RemovalNotice removal={removal} />
          </div>
        </FieldGroup>
        <MethodFormRow
          title={title}
          hint="The name and kind can change later; the ID is fixed once the method is added."
          editing={form.editing !== null}
          addLabel="Add payment method"
          refusal={refusal}
          reasonId={reasonId}
          onSubmit={submit}
          onCancel={() => {
            const editing = form.editing;
            form.reset();
            if (editing !== null) {
              focusAfterCommit(() => editButtons.get(editing));
            }
          }}
        >
          <NameField
            inputRef={nameInput}
            value={form.fields.name}
            placeholder="Apple Pay"
            refusal={marked}
            reasonId={reasonId}
            onChange={(name) => form.update({ name })}
          />
          <MethodIdField
            editing={form.editing !== null}
            value={form.fields.id}
            name={form.fields.name}
            taken={ids}
            refusal={marked}
            reasonId={reasonId}
            onChange={(id) => form.update({ id })}
          />
          <FieldHint label="Kind">
            <select
              className={`${fieldControlClasses} w-full`}
              value={form.fields.kind}
              onChange={(event) =>
                form.update({ kind: event.target.value as PaymentMethodSchema["kind"] })
              }
            >
              {paymentKindOptions().map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FieldHint>
        </MethodFormRow>
      </FieldRows>
    </Card>
  );
}

function NameField({
  inputRef,
  value,
  placeholder,
  refusal,
  reasonId,
  onChange,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  placeholder: string;
  refusal: MethodRefusal | null;
  reasonId: string;
  onChange: (name: string) => void;
}) {
  return (
    <FieldHint label="Name">
      <input
        ref={inputRef}
        className={`${fieldControlClasses} w-full`}
        value={value}
        placeholder={placeholder}
        maxLength={METHOD_LABEL_MAX_LENGTH}
        {...refusedProps(refusal, "name", reasonId)}
        onChange={(event) => onChange(event.target.value)}
      />
    </FieldHint>
  );
}

function DaysField({
  label,
  value,
  field,
  refusal,
  reasonId,
  onChange,
}: {
  label: string;
  value: string;
  field: "min" | "max";
  refusal: MethodRefusal | null;
  reasonId: string;
  onChange: (days: string) => void;
}) {
  return (
    <FieldHint label={label}>
      <input
        type="number"
        min={0}
        max={MAX_TRANSIT_DAYS}
        step={1}
        inputMode="numeric"
        className={`${fieldControlClasses} w-full`}
        value={value}
        {...refusedProps(refusal, field, reasonId)}
        onChange={(event) => onChange(event.target.value)}
      />
    </FieldHint>
  );
}

export function FulfilmentMethodsCard() {
  const { shopId, content, edit } = useShopWorkspace();
  const methods = content.fulfilment_methods;
  const ids = methods.map((method) => method.id);
  const nameOf = (id: string) => methods.find((method) => method.id === id)?.name ?? id;
  const form = useMethodForm<FulfilmentForm>({
    blank: BLANK_FULFILMENT,
    ids,
    cardTitle: "Fulfilment methods",
    nameOf,
    formOf: (id) =>
      fulfilmentFormOf(methods.find((method) => method.id === id) as FulfilmentMethodSchema),
  });
  const removal = useRemoval(shopId);
  const editButtons = useEditButtons();
  const focusAfterCommit = useFocusAfterCommit();
  const nameInput = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  const refusal = fulfilmentRefusal(form.fields, ids, form.editing);
  const marked = form.dirty ? refusal : null;
  const title = formTitle(form.editing, nameOf);

  function drop(id: string) {
    edit({ ...content, fulfilment_methods: methods.filter((entry) => entry.id !== id) });
  }

  function submit() {
    if (refusal !== null) {
      return;
    }
    const editing = form.editing;
    const method: FulfilmentMethodSchema = fulfilmentMethodOf(form.fields);
    if (editing !== null) {
      edit({
        ...content,
        fulfilment_methods: methods.map((entry) => (entry.id === editing ? method : entry)),
      });
      focusAfterCommit(() => editButtons.get(editing));
    } else {
      edit({ ...content, fulfilment_methods: [...methods, method] });
    }
    form.reset();
  }

  return (
    <Card title="Fulfilment methods">
      <p className="text-[13px] text-admin-muted">
        How an order reaches the customer. Delivery windows are what an agent promises.
      </p>
      <FieldRows>
        <FieldGroup
          label="Offered"
          hint="An order keeps the name of the method it was placed with, even if you change it here."
        >
          <div className="grid gap-2">
            {methods.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {methods.map((method) => {
                  const notice = `Removed the fulfilment method “${method.name}” from the draft.`;
                  if (removal.isArmed(method.id)) {
                    return (
                      <ConfirmRemove
                        key={method.id}
                        as="li"
                        title={`Remove the fulfilment method “${method.name}”?`}
                        consequence={consequenceOf(
                          "The shop stops offering it once the draft is saved and published.",
                          findingClauses(["fulfilment_method_missing_from_shop"]),
                          findingClauses([
                            methods.length === 1 && "shop_without_fulfilment_method",
                          ]),
                          "Nothing is written until you save the draft, and a published shop version keeps it.",
                        )}
                        onConfirm={removal.confirm(() => drop(method.id), notice)}
                        onKeep={removal.keep}
                      />
                    );
                  }
                  return (
                    <MethodItem
                      key={method.id}
                      name={method.name}
                      id={method.id}
                      detail={`${method.carrier} · ${transitWindow(
                        method.min_transit_days,
                        method.max_transit_days,
                      )}`}
                      editing={form.editing === method.id}
                    >
                      <EditButton
                        name={method.name}
                        buttonRef={editButtons.ref(method.id)}
                        onEdit={() => {
                          form.begin(method.id, fulfilmentFormOf(method));
                          focusAfterCommit(() => nameInput.current);
                        }}
                      />
                      <RemoveButton
                        name={method.name}
                        entryKey={method.id}
                        removal={removal}
                        notice={notice}
                        onRemove={() => drop(method.id)}
                      />
                    </MethodItem>
                  );
                })}
              </ul>
            ) : (
              <p className={validationMessageClasses}>
                No method offered, so no new order can be fulfilled.
              </p>
            )}
            <RemovalNotice removal={removal} />
          </div>
        </FieldGroup>
        <MethodFormRow
          title={title}
          hint="Min and max days are the method's delivery window, in whole days."
          editing={form.editing !== null}
          addLabel="Add fulfilment method"
          refusal={refusal}
          reasonId={reasonId}
          onSubmit={submit}
          onCancel={() => {
            const editing = form.editing;
            form.reset();
            if (editing !== null) {
              focusAfterCommit(() => editButtons.get(editing));
            }
          }}
        >
          <NameField
            inputRef={nameInput}
            value={form.fields.name}
            placeholder="Click and collect"
            refusal={marked}
            reasonId={reasonId}
            onChange={(name) => form.update({ name })}
          />
          <MethodIdField
            editing={form.editing !== null}
            value={form.fields.id}
            name={form.fields.name}
            taken={ids}
            refusal={marked}
            reasonId={reasonId}
            onChange={(id) => form.update({ id })}
          />
          <FieldHint label="Carrier">
            <input
              className={`${fieldControlClasses} w-full`}
              value={form.fields.carrier}
              placeholder="Nordic Post"
              maxLength={METHOD_LABEL_MAX_LENGTH}
              {...refusedProps(marked, "carrier", reasonId)}
              onChange={(event) => form.update({ carrier: event.target.value })}
            />
          </FieldHint>
          <div className="grid grid-cols-2 items-start gap-2.5">
            <DaysField
              label="Min days"
              value={form.fields.min}
              field="min"
              refusal={marked}
              reasonId={reasonId}
              onChange={(min) => form.update({ min })}
            />
            <DaysField
              label="Max days"
              value={form.fields.max}
              field="max"
              refusal={marked}
              reasonId={reasonId}
              onChange={(max) => form.update({ max })}
            />
          </div>
        </MethodFormRow>
      </FieldRows>
    </Card>
  );
}
