import type {
  FulfilmentStatus,
  OrderContentSchema,
  OrderEventKind,
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

export const MIN_LINE_QUANTITY = 1;
export const MAX_LINE_QUANTITY = 999;

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
