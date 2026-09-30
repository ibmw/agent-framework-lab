import type { FulfilmentMethodSchema, PaymentMethodSchema } from "@agent-lab/contracts";
import { isSlug } from "./entryIds";
import { PAYMENT_METHOD_KIND } from "./enumLabels";
import { alreadyTakenMessage, TRANSIT_WINDOW_RULE } from "./fieldRules";
import type { ItemRefusal } from "./itemForm";

/**
 * The payment and fulfilment method forms on Shop details: what each holds, the order its
 * rules are checked in, and the one reason its action is refused with (ADR 0072).
 */

/** The Kind select's order, which is the handoff's rather than the contract's. */
export const PAYMENT_KIND_ORDER = [
  "card",
  "wallet",
  "gift_card",
  "bank_transfer",
] as const satisfies readonly PaymentMethodSchema["kind"][];

/** Completes `alreadyTakenMessage` for a method ID another method of the same list holds. */
export const METHOD_ID_TAKEN_PLACE = "used by another method";

/** `MAX_LABEL_LENGTH` in `domain/content.py`, which `require_label` holds a name and a carrier to. */
export const METHOD_LABEL_MAX_LENGTH = 200;

export const METHOD_NAME_RULE = "Give the method a name.";
export const METHOD_ID_RULE = "The ID must be lowercase with hyphens.";
export const METHOD_CARRIER_RULE = "Name the carrier.";

/**
 * `FulfilmentMethodSchema` bounds each transit day at `ge=0, le=365` (`presentation/shops.py`),
 * and `require_non_negative_int` refuses anything that is not a whole number.
 */
export const MAX_TRANSIT_DAYS = 365;
export const MIN_DAYS_RULE = `Min days must be a whole number from 0 to ${MAX_TRANSIT_DAYS}.`;
export const MAX_DAYS_RULE = `Max days must be a whole number from 0 to ${MAX_TRANSIT_DAYS}.`;

/** Why the last enabled payment method's switch and Remove are held (ADR 0072). */
export const LAST_ENABLED_SWITCH_RULE = "The last enabled method stays on";
export const LAST_ENABLED_REMOVAL_RULE = "Enable another method before removing the last one.";

/** The payment form: `enabled` is the row's switch, never the form's (ADR 0072). */
export interface PaymentForm {
  name: string;
  id: string;
  kind: PaymentMethodSchema["kind"];
}

/** The fulfilment form. The days are what the number fields hold, so they are text. */
export interface FulfilmentForm {
  name: string;
  id: string;
  carrier: string;
  min: string;
  max: string;
}

export const BLANK_PAYMENT: PaymentForm = { name: "", id: "", kind: "card" };
export const BLANK_FULFILMENT: FulfilmentForm = {
  name: "",
  id: "",
  carrier: "",
  min: "1",
  max: "3",
};

export type MethodField = "name" | "id" | "carrier" | "min" | "max";

/** The first rule the form breaks, and the field that breaks it (`ItemRefusal`'s shape). */
export type MethodRefusal = ItemRefusal<MethodField>;

/**
 * A whole number of days the contract carries, or null. `Number("")` is 0 and `Number(" 2")`
 * is 2, so the text is read by pattern first.
 */
export function transitDays(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const days = Number(value);
  return days <= MAX_TRANSIT_DAYS ? days : null;
}

/**
 * The name, the ID's shape and the ID's uniqueness, in that order. `editing` is the ID of the
 * method the form was opened on, which its own ID never collides with.
 */
function identityRefusal(
  form: { name: string; id: string },
  takenIds: readonly string[],
  editing: string | null,
): MethodRefusal | null {
  if (form.name.trim() === "") {
    return { field: "name", reason: METHOD_NAME_RULE };
  }
  if (!isSlug(form.id)) {
    return { field: "id", reason: METHOD_ID_RULE };
  }
  if (form.id !== editing && takenIds.includes(form.id)) {
    return { field: "id", reason: alreadyTakenMessage(form.id, METHOD_ID_TAKEN_PLACE) };
  }
  return null;
}

export function paymentRefusal(
  form: PaymentForm,
  takenIds: readonly string[],
  editing: string | null,
): MethodRefusal | null {
  return identityRefusal(form, takenIds, editing);
}

/**
 * The handoff's order, with its last rule — `max ≥ min ≥ 0` — said as three: each bound a
 * whole number the contract carries, then the lab's own sentence for an inverted window,
 * character for character (ADR 0063's amendment).
 */
export function fulfilmentRefusal(
  form: FulfilmentForm,
  takenIds: readonly string[],
  editing: string | null,
): MethodRefusal | null {
  const identity = identityRefusal(form, takenIds, editing);
  if (identity !== null) {
    return identity;
  }
  if (form.carrier.trim() === "") {
    return { field: "carrier", reason: METHOD_CARRIER_RULE };
  }
  const min = transitDays(form.min);
  if (min === null) {
    return { field: "min", reason: MIN_DAYS_RULE };
  }
  const max = transitDays(form.max);
  if (max === null) {
    return { field: "max", reason: MAX_DAYS_RULE };
  }
  if (max < min) {
    return { field: "max", reason: TRANSIT_WINDOW_RULE };
  }
  return null;
}

/**
 * The entry a valid form writes. The name and the carrier are trimmed, because the lab refuses
 * a padded label (`require_label`); `enabled` is the caller's.
 */
export function paymentMethodOf(form: PaymentForm, enabled: boolean): PaymentMethodSchema {
  return { id: form.id, name: form.name.trim(), kind: form.kind, enabled };
}

export function fulfilmentMethodOf(form: FulfilmentForm): FulfilmentMethodSchema {
  return {
    id: form.id,
    name: form.name.trim(),
    carrier: form.carrier.trim(),
    min_transit_days: Number(form.min),
    max_transit_days: Number(form.max),
  };
}

export function paymentFormOf(method: PaymentMethodSchema): PaymentForm {
  return { name: method.name, id: method.id, kind: method.kind };
}

export function fulfilmentFormOf(method: FulfilmentMethodSchema): FulfilmentForm {
  return {
    name: method.name,
    id: method.id,
    carrier: method.carrier,
    min: String(method.min_transit_days),
    max: String(method.max_transit_days),
  };
}

/** "2–5 days" with an en dash, or "1 day" / "3 days" when the two bounds meet. */
export function transitWindow(min: number, max: number): string {
  if (min === max) {
    return `${min} ${min === 1 ? "day" : "days"}`;
  }
  return `${min}–${max} days`;
}

/**
 * The one enabled method, when exactly one is: its switch stays on and it cannot be removed.
 * With none enabled there is nothing to keep, and with two either may go.
 */
export function lastEnabledPaymentId(methods: readonly PaymentMethodSchema[]): string | null {
  const enabled = methods.filter((method) => method.enabled);
  return enabled.length === 1 ? enabled[0].id : null;
}

export function paymentKindOptions(): { value: PaymentMethodSchema["kind"]; label: string }[] {
  return PAYMENT_KIND_ORDER.map((value) => ({ value, label: PAYMENT_METHOD_KIND[value].label }));
}
