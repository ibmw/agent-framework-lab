import type {
  FulfilmentStatus,
  OrderContentSchema,
  OrderEventKind,
  OrderEventSchema,
  PaymentStatus,
  ReplaceOrderRequest,
} from "@agent-lab/contracts";
import {
  FULFILMENT_STATUS,
  labelOf,
  membersOf,
  ORDER_EVENT_KIND,
  PAYMENT_STATUS,
} from "./enumLabels";
import {
  LINE_QUANTITY_RULE,
  LINE_VARIANT_RULE,
  MAX_LINE_QUANTITY,
  MIN_LINE_QUANTITY,
  ORDER_EVENT_SUMMARY_RULE,
  ORDER_EVENT_TIME_RULE,
  ORDER_EVENTS_CAP_RULE,
} from "./fieldRules";
import type { ItemRefusal } from "./itemForm";
import { pythonStrip } from "./pythonText";

/**
 * Status is never carried by colour alone: every pill pairs its tone with a written label,
 * matching the design brief's accessibility constraint. The words themselves live in
 * `enumLabels.ts`, where the contract's own union holds them to its members.
 */
export const EVENT_KINDS: OrderEventKind[] = membersOf(ORDER_EVENT_KIND);

export function paymentLabel(status: PaymentStatus): string {
  return labelOf(PAYMENT_STATUS, status);
}

export function fulfilmentLabel(status: FulfilmentStatus): string {
  return labelOf(FULFILMENT_STATUS, status);
}

export function eventKindLabel(kind: OrderEventKind): string {
  return labelOf(ORDER_EVENT_KIND, kind);
}

/**
 * The statuses whose time the lab refuses, and the ones that owe one.
 *
 * `PaymentState.__post_init__` in `domain/order_fixture.py` refuses a capture time on a
 * pending or authorized order, and `paid_order_without_capture_time` requires one on a paid
 * order; a refunded order may carry one or not. `FulfilmentState.__post_init__` refuses a
 * shipping time on an unfulfilled order, and nothing requires one once something shipped.
 */
export const CAPTURE_TIME_REFUSED: readonly PaymentStatus[] = ["pending", "authorized"];
export const CAPTURE_TIME_OWED: readonly PaymentStatus[] = ["paid"];
export const SHIPPING_TIME_REFUSED: readonly FulfilmentStatus[] = ["unfulfilled"];

/** The placement time, when it is one a timestamp field can carry; otherwise nothing. */
function placementTime(content: OrderContentSchema): string | null {
  const placed = content.placed_at;
  return placed && !Number.isNaN(Date.parse(placed)) ? placed : null;
}

/**
 * The order with its payment status moved, and the capture time moved with it.
 *
 * - Into a status that refuses a capture time, it is cleared: the lab would refuse the save.
 * - Into Paid from any other status, an empty capture time takes the placement time, because
 *   the gate refuses a paid order without one and the placement is the one time the order
 *   already knows. A capture time already there — typed by the operator or saved — is kept.
 * - Anything else keeps what it holds.
 *
 * A placement time that is empty or unreadable prefills nothing: the field stays empty and
 * the gate says what it owes.
 */
export function withPaymentStatus(
  content: OrderContentSchema,
  status: PaymentStatus,
): OrderContentSchema {
  const previous = content.payment.status;
  let paidAt = content.payment.paid_at;
  if (CAPTURE_TIME_REFUSED.includes(status)) {
    paidAt = null;
  } else if (
    CAPTURE_TIME_OWED.includes(status) &&
    !CAPTURE_TIME_OWED.includes(previous) &&
    paidAt === null
  ) {
    paidAt = placementTime(content);
  }
  return { ...content, payment: { ...content.payment, status, paid_at: paidAt } };
}

/**
 * The order with its fulfilment status moved, and the shipping time moved with it.
 *
 * - Back to Unfulfilled, it is cleared: the lab would refuse the save.
 * - Off Unfulfilled, an empty shipping time takes the placement time. One already there is
 *   kept, and a move between two shipped statuses touches nothing: whatever the field holds
 *   there is the operator's answer, an empty one included.
 */
export function withFulfilmentStatus(
  content: OrderContentSchema,
  status: FulfilmentStatus,
): OrderContentSchema {
  const previous = content.fulfilment.status;
  let shippedAt = content.fulfilment.shipped_at;
  if (SHIPPING_TIME_REFUSED.includes(status)) {
    shippedAt = null;
  } else if (SHIPPING_TIME_REFUSED.includes(previous) && shippedAt === null) {
    shippedAt = placementTime(content);
  }
  return { ...content, fulfilment: { ...content.fulfilment, status, shipped_at: shippedAt } };
}

/**
 * The order a client sends is a set of *selections*, never materialized commerce content:
 * line prices come from the catalog and the shipping address from the address book, both
 * resolved by the lab. This projection is where that contract is honoured.
 */
export function toOrderRequest(content: OrderContentSchema): ReplaceOrderRequest {
  return {
    reference: content.reference,
    placed_at: content.placed_at,
    lines: content.lines.map((line) => ({ sku: line.sku, quantity: line.quantity })),
    payment: {
      status: content.payment.status,
      method_id: content.payment.method_id,
      paid_at: content.payment.paid_at,
    },
    fulfilment: {
      status: content.fulfilment.status,
      method_id: content.fulfilment.method_id,
      shipped_at: content.fulfilment.shipped_at,
    },
    shipping_fee_amount: content.shipping_fee.amount,
    shipping_address_id: content.shipping_address?.source_address_id ?? null,
    events: content.events.map((event) => ({
      id: event.id,
      kind: event.kind,
      occurred_at: event.occurred_at,
      summary: event.summary,
    })),
  };
}

function cents(amount: string): number {
  const parsed = Number(amount);
  // A half-typed shipping fee contributes nothing to the preview rather than turning every
  // total into NaN; the lab refuses the value itself on save.
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function amount(value: number): string {
  return (value / 100).toFixed(2);
}

/**
 * The totals shown while editing, before the next save answers with the real ones.
 *
 * The lab derives the authoritative totals from the frozen line prices; this is the same
 * arithmetic over the numbers already on screen, so an author sees a quantity change
 * without a round trip. Every save replaces these with the server's own figures.
 */
export function previewTotals(content: OrderContentSchema): { subtotal: string; total: string } {
  const subtotal = content.lines.reduce(
    (sum, line) => sum + cents(line.unit_price.amount) * line.quantity,
    0,
  );
  return {
    subtotal: amount(subtotal),
    total: amount(subtotal + cents(content.shipping_fee.amount)),
  };
}

export function lineTotal(unitAmount: string, quantity: number): string {
  return amount(cents(unitAmount) * quantity);
}

/**
 * A quantity the contract can carry: whole units between 1 and 999.
 *
 * Local state never holds a value a save would refuse, so the totals on screen describe an
 * order the lab would accept. An unreadable entry — a cleared field, a decimal — keeps the
 * quantity the line already had rather than inventing one.
 */
export function clampQuantity(value: string, current: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return current;
  }
  return Math.min(Math.max(parsed, MIN_LINE_QUANTITY), MAX_LINE_QUANTITY);
}

/**
 * The instant a `date` input's calendar day names, at midday in the author's own zone.
 *
 * The contract wants an explicit offset and the control answers with a bare day, so the
 * browser resolves it once — at midday, so that neither end of the day crosses into another
 * one wherever the author is reading from.
 */
export function placedAt(day: string): string {
  return new Date(`${day}T12:00`).toISOString();
}

/** Today as a `date` input value, in the author's own zone rather than UTC. */
export function todayInput(): string {
  return toLocalInput(new Date().toISOString()).slice(0, 10);
}

/** A `datetime-local` input value for a canonical UTC instant, in the viewer's zone. */
export function toLocalInput(instant: string): string {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const offset = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
}

/** The contract requires an explicit offset, so a local input resolves to one here. */
export function fromLocalInput(value: string): string | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * An event's authored fields, as the form below *Order events* holds them: the kind, the instant
 * as the `datetime-local` control spells it, and the summary.
 */
export interface OrderEventFields {
  kind: OrderEventKind;
  occurredAt: string;
  summary: string;
}

export function orderEventFields(event: OrderEventSchema): OrderEventFields {
  return { kind: event.kind, occurredAt: toLocalInput(event.occurred_at), summary: event.summary };
}

/**
 * The one function that turns an event's fields into the entry the order stores, whether the
 * form adds it or saves an edit, so the two paths cannot write different payloads.
 *
 * The summary is stored trimmed: `OrderEvent` refuses a summary with surrounding whitespace
 * (`require_text` in `domain/content.py`), and a trailing newline in a text area is not
 * something an author means. Only call it once `orderEventRefusal` has nothing to say.
 *
 * `kept` is the instant the time field opened on — the entry's own, for an edit; the order's
 * placement, for an addition. The control spells an instant to the minute, so a time the
 * author left alone keeps that instant rather than losing its seconds to the round trip: on an
 * edit that would show in the change summary as a change nobody made, and on an addition it
 * would put a new event seconds before the placement it opened on (`event_precedes_placement`).
 */
export function orderEventEntry(
  id: string,
  fields: OrderEventFields,
  kept?: string,
): OrderEventSchema {
  const untouched = kept !== undefined && toLocalInput(kept) === fields.occurredAt;
  return {
    id,
    kind: fields.kind,
    occurred_at: untouched ? kept : (fromLocalInput(fields.occurredAt) ?? ""),
    summary: pythonStrip(fields.summary),
  };
}

/** The event form's fields a rule can be broken by; the kind is a select of the contract's. */
export type OrderEventField = "occurredAt" | "summary";

/**
 * The first rule the event form breaks, in the order it asks (ADR 0074): the lab's cap, when
 * adding and the order already carries `MAX_ORDER_EVENTS` — about the list, so no field is
 * marked — then the time, empty or not an instant, then the summary, empty or only spaces,
 * which `require_text` refuses. The fields are not natively `required`: every rule is said in
 * the one line after the buttons, a blank form's included (ADR 0072's placement).
 */
export function orderEventRefusal(
  fields: OrderEventFields,
  { full = false }: { full?: boolean } = {},
): ItemRefusal<OrderEventField> | null {
  if (full) {
    return { field: null, reason: ORDER_EVENTS_CAP_RULE };
  }
  if (fromLocalInput(fields.occurredAt) === null) {
    return { field: "occurredAt", reason: ORDER_EVENT_TIME_RULE };
  }
  if (pythonStrip(fields.summary) === "") {
    return { field: "summary", reason: ORDER_EVENT_SUMMARY_RULE };
  }
  return null;
}

/** Why *Add line* has nothing to offer: a line is frozen at a price, so only a priced variant can be one. */
export const NO_PRICED_VARIANT = "The catalog has no priced variant to order yet.";
export const EVERY_VARIANT_ORDERED =
  "Every priced variant in the catalog is already a line of this order.";

/**
 * A line as the form below *Items* holds it: the variant by its SKU, which is the key the lab
 * holds a line by and so is fixed once the line exists, and the quantity as typed.
 */
export interface LineForm {
  variant: string;
  quantity: string;
}

export type LineField = "variant" | "quantity";

export function lineFormOf(line: OrderContentSchema["lines"][number]): LineForm {
  return { variant: line.sku, quantity: String(line.quantity) };
}

/** A quantity the contract carries — whole units between the two bounds — or null. */
export function lineQuantity(text: string): number | null {
  if (!/^\d+$/.test(text)) {
    return null;
  }
  const quantity = Number(text);
  return quantity >= MIN_LINE_QUANTITY && quantity <= MAX_LINE_QUANTITY ? quantity : null;
}

/**
 * The first rule the line form breaks, in the order it asks (ADR 0074): nothing left to add
 * (`nothingLeft`, adding only — the catalog has no priced variant, or every one is a line
 * already), which is about the list and marks no field; no variant chosen; then a quantity
 * outside the bounds. Adding, a variant that is not among `addable` — the priced variants not
 * yet a line — is not chosen: a discard can bring back the line the form had picked, and the
 * select then shows its placeholder. Editing, the variant is the line's own and fixed, so only
 * the quantity can be wrong.
 */
export function lineRefusal(
  fields: LineForm,
  {
    adding,
    addable,
    nothingLeft,
  }: { adding: boolean; addable: readonly string[]; nothingLeft: string | null },
): ItemRefusal<LineField> | null {
  if (adding && nothingLeft !== null) {
    return { field: null, reason: nothingLeft };
  }
  if (fields.variant === "" || (adding && !addable.includes(fields.variant))) {
    return { field: "variant", reason: LINE_VARIANT_RULE };
  }
  if (lineQuantity(fields.quantity) === null) {
    return { field: "quantity", reason: LINE_QUANTITY_RULE };
  }
  return null;
}
