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
