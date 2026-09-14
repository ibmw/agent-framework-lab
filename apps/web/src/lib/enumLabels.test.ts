import { describe, expect, it } from "vitest";
// The contract's own generated types, as text: a union is erased at runtime, so its members
// only exist to a reader that goes and looks at the source that declares them.
import generated from "../../../../packages/contracts/src/generated/v1.ts?raw";
import * as enumLabels from "./enumLabels";
import {
  DEFINITION_TYPE,
  describeValue,
  ENUM_LABELS,
  type EnumLabel,
  LABELLED_ENUMS,
  type LabelledEnum,
  labelOf,
  optionsOf,
  optionText,
  SUPPORT_PERMISSION,
} from "./enumLabels";

/**
 * The label tables, held to the contract that decides what they must spell.
 *
 * `tours.test.ts` sweeps `TOUR_IDS` to hold every tour to the same claims; this is the same
 * shape over `LABELLED_ENUMS`, with one difference that is the point of the slice. A tour's
 * table is the only authority on tours, so its sweep can only check the table against itself.
 * A label table is *not* the authority: `openapi.yaml` is. So the sweep reads the generated
 * contract and compares, which is what makes "add a member without a label" a named failure
 * rather than a value that quietly renders as itself somewhere an operator is reading.
 *
 * The typecheck catches the same mistake first — every map is a `Record` over the contract
 * union — and would fail `make check` before this file runs. Both are wanted: the typecheck
 * says the map is short, and this says which enum and which member, in a sentence.
 */

/**
 * Every string enum the generated contract declares, read out of the file itself.
 *
 * `openapi-typescript` writes each as `Name: "a" | "b";` under `components["schemas"]`,
 * wrapped across lines once it is long. A malformed read would make this whole file vacuous,
 * so the shape of the parse is asserted below before anything is compared against it.
 */
function contractEnums(): Map<string, string[]> {
  const declaration = /^ {4}(\w+):((?:\s*\|?\s*"[^"\n]*")+);$/gm;
  const enums = new Map<string, string[]>();
  for (const [, name, members] of generated.matchAll(declaration)) {
    enums.set(
      name,
      [...members.matchAll(/"([^"]*)"/g)].map(([, member]) => member),
    );
  }
  return enums;
}

const CONTRACT_ENUMS = contractEnums();

describe("the contract's own enums", () => {
  it("are readable from the generated types, or nothing below proves anything", () => {
    // A parameterized suite over a table that became empty reports as passing (ADR 0023), and
    // a regex that stopped matching the generator's output would empty this one silently.
    expect(CONTRACT_ENUMS.size).toBeGreaterThan(20);
    expect(CONTRACT_ENUMS.get("TicketStatus")).toEqual(["open", "resolved"]);
    expect(CONTRACT_ENUMS.get("SupportPermission")).toContain("issue_refund");
  });
});

describe("every enum has a name", () => {
  it("sweeps a table the workspace actually holds", () => {
    expect(LABELLED_ENUMS.length).toBeGreaterThan(15);
  });

  it.each(LABELLED_ENUMS)("%s is a union the contract publishes", (name: LabelledEnum) => {
    expect(CONTRACT_ENUMS.get(name), `${name} is not an enum in the contract`).toBeDefined();
  });

  it.each(LABELLED_ENUMS)("%s has a label for every member", (name: LabelledEnum) => {
    const members = CONTRACT_ENUMS.get(name) ?? [];
    const labelled = Object.keys(ENUM_LABELS[name]);

    for (const member of members) {
      expect(labelled, `${name}.${member} has no label in enumLabels.ts`).toContain(member);
    }
    for (const member of labelled) {
      expect(members, `${name}.${member} is labelled but is not in the contract`).toContain(member);
    }
  });

  it.each(LABELLED_ENUMS)("%s spells every member for a reader", (name: LabelledEnum) => {
    const map: Record<string, { label: string; explanation?: string }> = ENUM_LABELS[name];

    for (const [member, entry] of Object.entries(map)) {
      expect(entry.label.trim(), `${name}.${member} has an empty label`).not.toBe("");
      // The whole point of the slice: `in_stock`, `gift_card` and `bank_transfer` are wire
      // spellings, and no operator reads one. A member whose wire form is already one English
      // word ("policy", "checkout") may of course be called that, so the rule is about the
      // punctuation of the wire rather than about the words differing.
      expect(entry.label, `${name}.${member} keeps the wire's underscores`).not.toContain("_");
      if (member.includes("_")) {
        expect(entry.label, `${name}.${member} renders as its own wire value`).not.toBe(member);
      }
      expect(
        entry.explanation?.trim(),
        `${name}.${member} has an empty explanation rather than none`,
      ).not.toBe("");
    }
  });

  it.each(LABELLED_ENUMS)("%s calls two members two different things", (name: LabelledEnum) => {
    const labels = Object.values<{ label: string }>(ENUM_LABELS[name]).map((entry) => entry.label);
    expect(new Set(labels).size, `${name} spells two members the same way`).toBe(labels.length);
  });

  it("sweeps every table this module publishes, not only the ones remembered", () => {
    // A `LabelMap` exported and left out of `ENUM_LABELS` typechecks and is never swept —
    // which would make every assertion above conditional on somebody having remembered.
    // The module's own exports are read back so the registry cannot fall behind them.
    const registered = new Set<unknown>(Object.values(ENUM_LABELS));
    const published = Object.entries(enumLabels).filter(([, value]) => isLabelMap(value));

    for (const [name, map] of published) {
      expect(registered.has(map), `${name} is a label map that ENUM_LABELS does not carry`).toBe(
        true,
      );
    }
    // And the other way: a registry entry that is not one of this module's own exports.
    expect(published.length).toBe(LABELLED_ENUMS.length);
  });
});

/** A module export shaped like a label table: every value an `{ label }` record. */
function isLabelMap(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.values(value as Record<string, unknown>);
  return (
    entries.length > 0 &&
    entries.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as EnumLabel).label === "string",
    )
  );
}

describe("reading one table", () => {
  it("gives a value its name", () => {
    expect(labelOf(SUPPORT_PERMISSION, "issue_refund")).toBe("Issue refund");
  });

  it("writes an explained option the way the scenario editor writes one", () => {
    expect(optionText(SUPPORT_PERMISSION.issue_refund)).toBe(
      "Issue refund — refund an order in full or part",
    );
  });

  it("leaves a member with nothing to add as its bare label", () => {
    expect(optionText({ label: "Card" })).toBe("Card");
  });

  it("names a member read out of a field the contract types as a free string", () => {
    expect(describeValue(DEFINITION_TYPE, "customer_profile")).toBe("Customer profile");
  });

  it("renders a value outside the union as itself rather than inventing words for it", () => {
    // `ResolvedDefinitionSchema.definition_type` is a `string`, so the backend may publish a
    // member before this table has words for it. Showing the record's own value is honest;
    // dressing it up would put this application's guess where the lab's vocabulary belongs.
    expect(describeValue(DEFINITION_TYPE, "sandbox_profile")).toBe("sandbox_profile");
  });

  it("offers a select the value, the name, and the explained option together", () => {
    expect(optionsOf(ENUM_LABELS.TicketStatus)).toEqual([
      { value: "open", label: "Open", option: "Open" },
      { value: "resolved", label: "Resolved", option: "Resolved" },
    ]);
  });
});
