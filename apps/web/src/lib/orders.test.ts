import type { FulfilmentStatus, OrderContentSchema, PaymentStatus } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import { FULFILMENT_STATUS, labelOf, membersOf, PAYMENT_STATUS } from "./enumLabels";
import { PAID_AT_RULE, SHIPPED_AT_RULE } from "./fieldRules";
import {
  clampQuantity,
  fromLocalInput,
  lineTotal,
  previewTotals,
  todayInput,
  toLocalInput,
  toOrderRequest,
  withFulfilmentStatus,
  withPaymentStatus,
} from "./orders";

const CONTENT: OrderContentSchema = {
  reference: "NS-10482",
  customer_profile_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  currency: "EUR",
  placed_at: "2026-08-20T14:55:00.000000Z",
  lines: [
    {
      id: "ns-asj-ob-m",
      sku: "NS-ASJ-OB-M",
      product_handle: "alpine-shell-jacket",
      title: "Alpine Shell Jacket",
      variant_summary: "Ocean Blue · M",
      unit_price: { amount: "249.00", currency: "EUR" },
      quantity: 2,
      line_total: { amount: "498.00", currency: "EUR" },
    },
  ],
  payment: {
    status: "paid",
    method_id: "card",
    method_name: "Card synthetic",
    paid_at: "2026-08-21T13:12:00.000000Z",
  },
  fulfilment: {
    status: "unfulfilled",
    method_id: "standard",
    method_name: "Standard",
    shipped_at: null,
  },
  shipping_fee: { amount: "4.90", currency: "EUR" },
  shipping_address: {
    source_address_id: "bordeaux-previous-flat",
    source_label: "Bordeaux previous flat",
    selected_at: "2026-08-20T14:55:00.000000Z",
    recipient: "Maya Laurent",
    line1: "42 cours de la Marne",
    line2: null,
    postal_code: "33800",
    city: "Bordeaux",
    region: null,
    country: "FR",
  },
  events: [
    {
      id: "order-created",
      kind: "placed",
      occurred_at: "2026-08-20T14:55:00.000000Z",
      summary: "Order created",
    },
  ],
  subtotal: { amount: "498.00", currency: "EUR" },
  total: { amount: "502.90", currency: "EUR" },
  item_count: 2,
  allows_address_change: true,
};

describe("order request projection", () => {
  it("sends selections and never a price", () => {
    const request = toOrderRequest(CONTENT);

    expect(request.lines).toEqual([{ sku: "NS-ASJ-OB-M", quantity: 2 }]);
    expect(request.shipping_address_id).toBe("bordeaux-previous-flat");
    expect(request.payment).toEqual({
      status: "paid",
      method_id: "card",
      paid_at: "2026-08-21T13:12:00.000000Z",
    });
    // The frozen unit price is the lab's to keep; the shipping fee is the one amount an
    // author types, so it is the only money on the wire.
    expect(JSON.stringify(request)).not.toContain("249.00");
    expect(request.shipping_fee_amount).toBe("4.90");
  });

  it("clears the address when no entry is selected", () => {
    expect(toOrderRequest({ ...CONTENT, shipping_address: null }).shipping_address_id).toBeNull();
  });
});

describe("preview totals", () => {
  it("derives the subtotal and total from the line items in exact cents", () => {
    expect(previewTotals(CONTENT)).toEqual({ subtotal: "498.00", total: "502.90" });
    expect(lineTotal("0.10", 3)).toBe("0.30");
  });

  it("ignores an unreadable shipping fee instead of rendering NaN", () => {
    // "4,90" is what a French keyboard produces first; the lab refuses it on save.
    const totals = previewTotals({ ...CONTENT, shipping_fee: { amount: "4,90", currency: "EUR" } });

    expect(totals).toEqual({ subtotal: "498.00", total: "498.00" });
  });

  it("treats an order with no line as free rather than unknown", () => {
    expect(
      previewTotals({ ...CONTENT, lines: [], shipping_fee: { amount: "0.00", currency: "EUR" } }),
    ).toEqual({ subtotal: "0.00", total: "0.00" });
  });
});

describe("instant conversion", () => {
  it("round-trips a canonical instant through a local input value", () => {
    const local = toLocalInput("2026-08-20T14:55:00.000000Z");

    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(fromLocalInput(local)).toBe("2026-08-20T14:55:00.000Z");
  });

  it("reports an unusable value instead of inventing an instant", () => {
    expect(toLocalInput("not a date")).toBe("");
    expect(fromLocalInput("")).toBeNull();
  });
});

describe("quantity clamping", () => {
  it("keeps local state inside what the contract accepts", () => {
    expect(clampQuantity("3", 1)).toBe(3);
    expect(clampQuantity("1200", 1)).toBe(999);
    expect(clampQuantity("0", 2)).toBe(1);
    // A decimal is floored rather than sent to a schema that only carries whole units.
    expect(clampQuantity("1.5", 2)).toBe(1);
  });

  it("keeps the current quantity while the field is unreadable", () => {
    expect(clampQuantity("", 4)).toBe(4);
    expect(clampQuantity("abc", 4)).toBe(4);
  });
});

describe("today's date", () => {
  it("answers a date input value in the author's own zone", () => {
    expect(todayInput()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayInput()).toBe(toLocalInput(new Date().toISOString()).slice(0, 10));
  });
});

/**
 * Every move of each status select, written out rather than derived: what a move does to the
 * timestamp beside it is the rule, so the table is the specification and the function is
 * checked against it. `P` is the placement time, `T` a time the operator typed or the lab
 * saved, and `–` an empty field. Each row gives the result for an empty field and for a filled
 * one. The page only offers the statuses reachable from the saved one, but between two saves
 * an operator can move the select back and forth among them, so every pair is a move.
 */
const P = CONTENT.placed_at;
const T = "2026-08-22T09:30:00.000Z";
type Cell = "P" | "T" | "–";
const cell = (value: string | null): Cell => (value === null ? "–" : value === P ? "P" : "T");

const PAYMENT_MOVES: ReadonlyArray<[PaymentStatus, PaymentStatus, Cell, Cell]> = [
  ["pending", "pending", "–", "–"],
  ["pending", "authorized", "–", "–"],
  ["pending", "paid", "P", "T"],
  ["pending", "refunded", "–", "T"],
  ["authorized", "pending", "–", "–"],
  ["authorized", "authorized", "–", "–"],
  ["authorized", "paid", "P", "T"],
  ["authorized", "refunded", "–", "T"],
  ["paid", "pending", "–", "–"],
  ["paid", "authorized", "–", "–"],
  ["paid", "paid", "–", "T"],
  ["paid", "refunded", "–", "T"],
  ["refunded", "pending", "–", "–"],
  ["refunded", "authorized", "–", "–"],
  ["refunded", "paid", "P", "T"],
  ["refunded", "refunded", "–", "T"],
];

const FULFILMENT_MOVES: ReadonlyArray<[FulfilmentStatus, FulfilmentStatus, Cell, Cell]> = [
  ["unfulfilled", "unfulfilled", "–", "–"],
  ["unfulfilled", "partially_fulfilled", "P", "T"],
  ["unfulfilled", "fulfilled", "P", "T"],
  ["partially_fulfilled", "unfulfilled", "–", "–"],
  ["partially_fulfilled", "partially_fulfilled", "–", "T"],
  ["partially_fulfilled", "fulfilled", "–", "T"],
  ["fulfilled", "unfulfilled", "–", "–"],
  ["fulfilled", "partially_fulfilled", "–", "T"],
  ["fulfilled", "fulfilled", "–", "T"],
];

function paying(status: PaymentStatus, paidAt: string | null): OrderContentSchema {
  return { ...CONTENT, payment: { ...CONTENT.payment, status, paid_at: paidAt } };
}

function shipping(status: FulfilmentStatus, shippedAt: string | null): OrderContentSchema {
  return { ...CONTENT, fulfilment: { ...CONTENT.fulfilment, status, shipped_at: shippedAt } };
}

describe("moving a status moves the time beside it", () => {
  it("lists every pair of payment statuses, and every pair of fulfilment statuses, once", () => {
    const payment = membersOf(PAYMENT_STATUS);
    const fulfilment = membersOf(FULFILMENT_STATUS);
    expect(PAYMENT_MOVES.map(([from, to]) => `${from}>${to}`)).toStrictEqual(
      payment.flatMap((from) => payment.map((to) => `${from}>${to}`)),
    );
    expect(FULFILMENT_MOVES.map(([from, to]) => `${from}>${to}`)).toStrictEqual(
      fulfilment.flatMap((from) => fulfilment.map((to) => `${from}>${to}`)),
    );
  });

  it.each(PAYMENT_MOVES)(
    "payment %s → %s: empty gives %s, filled gives %s",
    (from, to, empty, filled) => {
      const fromEmpty = withPaymentStatus(paying(from, null), to);
      const fromFilled = withPaymentStatus(paying(from, T), to);
      expect(fromEmpty.payment.status).toBe(to);
      expect(cell(fromEmpty.payment.paid_at)).toBe(empty);
      expect(cell(fromFilled.payment.paid_at)).toBe(filled);
      // Nothing else on the order moves with it.
      expect({ ...fromFilled, payment: CONTENT.payment }).toStrictEqual(CONTENT);
    },
  );

  it.each(FULFILMENT_MOVES)(
    "fulfilment %s → %s: empty gives %s, filled gives %s",
    (from, to, empty, filled) => {
      const fromEmpty = withFulfilmentStatus(shipping(from, null), to);
      const fromFilled = withFulfilmentStatus(shipping(from, T), to);
      expect(fromEmpty.fulfilment.status).toBe(to);
      expect(cell(fromEmpty.fulfilment.shipped_at)).toBe(empty);
      expect(cell(fromFilled.fulfilment.shipped_at)).toBe(filled);
      expect({ ...fromFilled, fulfilment: CONTENT.fulfilment }).toStrictEqual(CONTENT);
    },
  );

  it.each(["", "not a time"])("prefills nothing from a placement time of %j", (placed) => {
    const order = { ...CONTENT, placed_at: placed };
    expect(
      withPaymentStatus(
        { ...order, payment: { ...order.payment, status: "authorized", paid_at: null } },
        "paid",
      ).payment.paid_at,
    ).toBeNull();
    expect(
      withFulfilmentStatus(
        { ...order, fulfilment: { ...order.fulfilment, status: "unfulfilled", shipped_at: null } },
        "fulfilled",
      ).fulfilment.shipped_at,
    ).toBeNull();
  });
});

/**
 * The two rules say what the functions above do, held to the statuses the functions act on:
 * each rule names, by its label, every status that fills the field and every status that
 * clears it, and names no status that does neither.
 */
describe("the timestamp rules name the statuses that move them", () => {
  const named = (rule: string, label: string) => new RegExp(`\\b${label}\\b`).test(rule);

  it("names Paid, Pending and Authorized under Paid at, and not Refunded", () => {
    const acting = PAYMENT_MOVES.filter(
      ([, , empty, filled]) => empty !== "–" || filled === "–",
    ).map(([, to]) => to);
    for (const status of membersOf(PAYMENT_STATUS)) {
      expect(named(PAID_AT_RULE, labelOf(PAYMENT_STATUS, status)), status).toBe(
        acting.includes(status),
      );
    }
  });

  it("names Unfulfilled under Shipped at, and neither shipped status", () => {
    // A move *off* Unfulfilled fills the field, so the rule names the status left rather than
    // the two arrived at.
    for (const status of membersOf(FULFILMENT_STATUS)) {
      expect(named(SHIPPED_AT_RULE, labelOf(FULFILMENT_STATUS, status)), status).toBe(
        status === "unfulfilled",
      );
    }
  });
});
