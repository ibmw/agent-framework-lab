import type { PaymentMethodSchema } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import contentPython from "../../../../apps/api/src/capability_lab/domain/content.py?raw";
import shopsPresentation from "../../../../apps/api/src/capability_lab/presentation/shops.py?raw";
import { PAYMENT_METHOD_KIND } from "./enumLabels";
import { TRANSIT_WINDOW_RULE } from "./fieldRules";
import {
  BLANK_FULFILMENT,
  type FulfilmentForm,
  fulfilmentMethodOf,
  fulfilmentRefusal,
  lastEnabledPaymentId,
  MAX_DAYS_RULE,
  MAX_TRANSIT_DAYS,
  METHOD_CARRIER_RULE,
  METHOD_ID_RULE,
  METHOD_LABEL_MAX_LENGTH,
  METHOD_NAME_RULE,
  MIN_DAYS_RULE,
  PAYMENT_KIND_ORDER,
  paymentKindOptions,
  paymentMethodOf,
  paymentRefusal,
  transitDays,
  transitWindow,
} from "./shopMethods";

describe("transitWindow", () => {
  it("reads every window of up to three days as the handoff writes it", () => {
    // Every pair with 0 <= min <= max <= 3, written out rather than derived.
    const expected: [number, number, string][] = [
      [0, 0, "0 days"],
      [0, 1, "0–1 days"],
      [0, 2, "0–2 days"],
      [0, 3, "0–3 days"],
      [1, 1, "1 day"],
      [1, 2, "1–2 days"],
      [1, 3, "1–3 days"],
      [2, 2, "2 days"],
      [2, 3, "2–3 days"],
      [3, 3, "3 days"],
    ];
    for (const [min, max, window] of expected) {
      expect(transitWindow(min, max), `${min}..${max}`).toBe(window);
    }
    // The dash is an en dash, not a hyphen.
    expect(transitWindow(2, 5)).toBe("2–5 days");
  });
});

describe("transitDays", () => {
  it("takes a whole number the contract carries and nothing else", () => {
    const cases: [string, number | null][] = [
      ["0", 0],
      ["1", 1],
      ["01", 1],
      ["365", 365],
      ["366", null],
      ["", null],
      ["-1", null],
      ["1.5", null],
      ["1e2", null],
      [" 2", null],
      ["2 ", null],
      ["two", null],
    ];
    for (const [text, days] of cases) {
      expect(transitDays(text), JSON.stringify(text)).toBe(days);
    }
  });

  it("stops where FulfilmentMethodSchema bounds a transit day", () => {
    const schema = shopsPresentation.slice(
      shopsPresentation.indexOf("class FulfilmentMethodSchema"),
      shopsPresentation.indexOf("class SupportGuidelineSchema"),
    );
    expect(schema).toContain(`min_transit_days: int = Field(ge=0, le=${MAX_TRANSIT_DAYS})`);
    expect(schema).toContain(`max_transit_days: int = Field(ge=0, le=${MAX_TRANSIT_DAYS})`);
  });
});

describe("the method forms' rules, in the handoff's order", () => {
  const TAKEN = ["standard", "express"];
  const names = { ok: "Click and collect", empty: "  " };
  const idOf = { ok: "click-and-collect", bad: "Click and collect", taken: "standard" };
  const carriers = { ok: "Nordic Post", empty: "" };
  const days = {
    ok: { min: "1", max: "3" },
    minBad: { min: "", max: "3" },
    maxBad: { min: "1", max: "366" },
    inverted: { min: "5", max: "3" },
    bothBad: { min: "-1", max: "x" },
  };

  /** What each breakage says, first to last. */
  function expectedOf(
    name: keyof typeof names,
    id: keyof typeof idOf,
    carrier: keyof typeof carriers,
    day: keyof typeof days,
  ) {
    if (name === "empty") return { field: "name", reason: METHOD_NAME_RULE };
    if (id === "bad") return { field: "id", reason: METHOD_ID_RULE };
    if (id === "taken") {
      return { field: "id", reason: "standard is already used by another method." };
    }
    if (carrier === "empty") return { field: "carrier", reason: METHOD_CARRIER_RULE };
    if (day === "minBad" || day === "bothBad") return { field: "min", reason: MIN_DAYS_RULE };
    if (day === "maxBad") return { field: "max", reason: MAX_DAYS_RULE };
    if (day === "inverted") return { field: "max", reason: TRANSIT_WINDOW_RULE };
    return null;
  }

  it("names the first rule a fulfilment form breaks, for every combination", () => {
    let count = 0;
    for (const name of Object.keys(names) as (keyof typeof names)[]) {
      for (const id of Object.keys(idOf) as (keyof typeof idOf)[]) {
        for (const carrier of Object.keys(carriers) as (keyof typeof carriers)[]) {
          for (const day of Object.keys(days) as (keyof typeof days)[]) {
            const form: FulfilmentForm = {
              name: names[name],
              id: idOf[id],
              carrier: carriers[carrier],
              ...days[day],
            };
            expect(fulfilmentRefusal(form, TAKEN, null), `${name} ${id} ${carrier} ${day}`).toEqual(
              expectedOf(name, id, carrier, day),
            );
            count += 1;
          }
        }
      }
    }
    expect(count).toBe(2 * 3 * 2 * 5);
  });

  it("names the first rule a payment form breaks, for every combination", () => {
    for (const name of Object.keys(names) as (keyof typeof names)[]) {
      for (const id of Object.keys(idOf) as (keyof typeof idOf)[]) {
        expect(
          paymentRefusal({ name: names[name], id: idOf[id], kind: "card" }, TAKEN, null),
          `${name} ${id}`,
        ).toEqual(expectedOf(name, id, "ok", "ok"));
      }
    }
  });

  it("says the lab's transit sentence character for character", () => {
    expect(
      fulfilmentRefusal(
        { ...BLANK_FULFILMENT, name: "A", id: "a", carrier: "B", min: "4", max: "2" },
        [],
        null,
      )?.reason,
    ).toBe("maximum transit days cannot be shorter than minimum transit days");
  });

  it("does not hold the method being edited to its own ID, and holds it to every other", () => {
    const form = { name: "Standard", id: "standard", kind: "card" as const };
    expect(paymentRefusal(form, TAKEN, "standard")).toBeNull();
    expect(paymentRefusal(form, TAKEN, "express")?.field).toBe("id");
    expect(paymentRefusal(form, TAKEN, null)?.field).toBe("id");
  });

  it("refuses an ID longer than the lab's slug cap", () => {
    const long = "a".repeat(65);
    expect(paymentRefusal({ name: "A", id: long, kind: "card" }, [], null)?.reason).toBe(
      METHOD_ID_RULE,
    );
    expect(paymentRefusal({ name: "A", id: "a".repeat(64), kind: "card" }, [], null)).toBeNull();
  });
});

describe("what a form writes", () => {
  it("trims the name and the carrier the lab refuses padded, and reads the days as numbers", () => {
    expect(
      fulfilmentMethodOf({
        name: " Express ",
        id: "express",
        carrier: " Nordic Post ",
        min: "1",
        max: "2",
      }),
    ).toEqual({
      id: "express",
      name: "Express",
      carrier: "Nordic Post",
      min_transit_days: 1,
      max_transit_days: 2,
    });
    expect(paymentMethodOf({ name: " Visa ", id: "visa", kind: "card" }, true)).toEqual({
      id: "visa",
      name: "Visa",
      kind: "card",
      enabled: true,
    });
  });

  it("strips and refuses as Python's str.strip() does, not as trim() does", () => {
    const fulfilment = {
      name: "Express",
      id: "express",
      carrier: "Nordic Post",
      min: "1",
      max: "2",
    };
    // Python strips NEL and the information separators, so either is an empty name.
    expect(paymentRefusal({ name: "\x85\x1c", id: "visa", kind: "card" }, [], null)?.reason).toBe(
      METHOD_NAME_RULE,
    );
    expect(fulfilmentRefusal({ ...fulfilment, carrier: "\x85" }, [], null)?.reason).toBe(
      METHOD_CARRIER_RULE,
    );
    expect(
      fulfilmentMethodOf({
        ...fulfilment,
        name: "\x85Express\x1d",
        carrier: "\x1eNordic Post\x85",
      }),
    ).toMatchObject({ name: "Express", carrier: "Nordic Post" });
    expect(paymentMethodOf({ name: "Visa\x85", id: "visa", kind: "card" }, true).name).toBe("Visa");
    // `trim()` would empty a byte-order mark; the lab keeps it, so it is a name.
    expect(paymentRefusal({ name: "\ufeff", id: "visa", kind: "card" }, [], null)).toBeNull();
    expect(paymentMethodOf({ name: "\ufeff", id: "visa", kind: "card" }, true).name).toBe("\ufeff");
  });

  it("caps a name and a carrier where require_label does", () => {
    expect(contentPython).toContain(`MAX_LABEL_LENGTH = ${METHOD_LABEL_MAX_LENGTH}`);
  });
});

describe("lastEnabledPaymentId", () => {
  it("is the one enabled method, for every pattern of three", () => {
    const ids = ["visa", "paypal", "gift-card"];
    // Each of the eight patterns, with the method it holds, written out.
    const patterns: [boolean[], string | null][] = [
      [[false, false, false], null],
      [[true, false, false], "visa"],
      [[false, true, false], "paypal"],
      [[false, false, true], "gift-card"],
      [[true, true, false], null],
      [[true, false, true], null],
      [[false, true, true], null],
      [[true, true, true], null],
    ];
    for (const [enabled, held] of patterns) {
      const methods: PaymentMethodSchema[] = ids.map((id, index) => ({
        id,
        name: id,
        kind: "card",
        enabled: enabled[index],
      }));
      expect(lastEnabledPaymentId(methods), enabled.join(",")).toBe(held);
    }
    expect(lastEnabledPaymentId([])).toBeNull();
  });
});

describe("the Kind select", () => {
  it("offers every kind the contract has, once, in the handoff's order", () => {
    expect([...PAYMENT_KIND_ORDER].sort()).toEqual(Object.keys(PAYMENT_METHOD_KIND).sort());
    expect(paymentKindOptions().map((option) => option.label)).toEqual([
      "Card",
      "Wallet",
      "Gift card",
      "Bank transfer",
    ]);
  });
});
