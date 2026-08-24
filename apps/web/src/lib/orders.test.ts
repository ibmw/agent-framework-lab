import type { OrderContentSchema } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import {
  clampQuantity,
  fromLocalInput,
  lineTotal,
  previewTotals,
  todayInput,
  toLocalInput,
  toOrderRequest,
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
