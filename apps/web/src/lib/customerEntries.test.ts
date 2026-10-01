import { describe, expect, it } from "vitest";
import {
  ADDRESS_FORM_FIELDS,
  type AddressField,
  type AddressFields,
  addressEntry,
  addressRefusal,
  BACKGROUND_FORM_FIELDS,
  type BackgroundFields,
  backgroundEntry,
  backgroundRefusal,
  HIDDEN_FACT_FORM_FIELDS,
  hiddenFactEntry,
  hiddenFactRefusal,
  resolvedAddress,
} from "./customerEntries";
import {
  ADDRESS_FIELDS_RULE,
  BACKGROUND_DATE_RULE,
  BACKGROUND_NOTE_RULE,
  COUNTRY_RULE,
  HIDDEN_FACT_RULE,
} from "./fieldRules";

/** Every subset of a list, in order, the empty one included. */
function subsets<T>(items: readonly T[]): T[][] {
  const all: T[][] = [[]];
  for (const item of items) {
    for (const subset of [...all]) {
      all.push([...subset, item]);
    }
  }
  return all;
}

const ADDRESS: AddressFields & { country: string } = {
  label: "Home",
  recipient: "Maya Laurent",
  line1: "18 rue des Écoles",
  line2: "",
  postalCode: "69005",
  city: "Lyon",
  region: "",
  country: "FR",
};

/** What breaks each rule-bearing field: only spaces for a text, as the lab strips it. */
const BROKEN_ADDRESS: Partial<Record<AddressField, string>> = {
  label: "  ",
  recipient: "\t",
  line1: "   ",
  postalCode: "",
  city: "　",
  country: "fr",
};

const ADDRESS_RULES: Partial<Record<AddressField, string>> = {
  label: ADDRESS_FIELDS_RULE,
  recipient: ADDRESS_FIELDS_RULE,
  line1: ADDRESS_FIELDS_RULE,
  postalCode: ADDRESS_FIELDS_RULE,
  city: ADDRESS_FIELDS_RULE,
  country: COUNTRY_RULE,
};

describe("the address form's refusal", () => {
  for (const mode of ["adding", "editing"] as const) {
    const asked = ADDRESS_FORM_FIELDS[mode].filter((field) => field in BROKEN_ADDRESS);

    it(`names the first field broken in the order the form asks while ${mode}, for every combination`, () => {
      const cases = subsets(asked);
      expect(cases).toHaveLength(2 ** asked.length);
      for (const broken of cases) {
        const fields = { ...ADDRESS };
        for (const field of broken) {
          Object.assign(fields, { [field]: BROKEN_ADDRESS[field] });
        }
        const [first] = asked.filter((field) => broken.includes(field));
        expect(addressRefusal(fields, mode), broken.join(", ")).toEqual(
          first === undefined ? null : { field: first, reason: ADDRESS_RULES[first] },
        );
      }
    });
  }

  it("asks every field the entry stores while editing, and what a new one needs while adding", () => {
    expect(ADDRESS_FORM_FIELDS.editing).toEqual([
      "label",
      "recipient",
      "line1",
      "line2",
      "postalCode",
      "city",
      "region",
      "country",
    ]);
    expect(ADDRESS_FORM_FIELDS.adding).toEqual(["label", "line1", "postalCode", "city", "country"]);
  });

  it("says an empty recipient on an entry being added, which it does not ask, with no field", () => {
    expect(addressRefusal({ ...ADDRESS, recipient: " " }, "adding")).toEqual({
      field: null,
      reason: ADDRESS_FIELDS_RULE,
    });
    // After the label, where the recipient stands in the form that asks it.
    expect(addressRefusal({ ...ADDRESS, label: "", recipient: "" }, "adding")?.field).toBe("label");
    expect(addressRefusal({ ...ADDRESS, recipient: "", city: "" }, "adding")?.field).toBeNull();
  });

  it("leaves the second street line and the region free", () => {
    expect(addressRefusal({ ...ADDRESS, line2: "  ", region: "" }, "editing")).toBeNull();
  });

  it("resolves the recipient of an entry being added to the customer, and the country to the locale's", () => {
    expect(
      resolvedAddress(
        { ...ADDRESS, recipient: "", country: null },
        {
          recipient: "Maya Laurent",
          country: "FR",
        },
      ),
    ).toEqual(ADDRESS);
    expect(resolvedAddress({ ...ADDRESS, country: "DE" }, { country: "FR" }).country).toBe("DE");
  });

  it("stores every text stripped as the lab strips it, an empty optional line as none, and the default it is given", () => {
    const entry = addressEntry(
      "home",
      { ...ADDRESS, label: " Home ", line2: "  ", region: " Rhône　" },
      false,
    );
    expect(entry).toEqual({
      id: "home",
      label: "Home",
      recipient: "Maya Laurent",
      line1: "18 rue des Écoles",
      line2: null,
      postal_code: "69005",
      city: "Lyon",
      region: "Rhône",
      country: "FR",
      is_default: false,
    });
    expect(addressEntry("home", ADDRESS, true).is_default).toBe(true);
  });
});

const BACKGROUND: BackgroundFields = {
  kind: "purchase",
  occurredOn: "2026-05-02",
  note: "Bought a jacket.",
};

describe("the background form's refusal", () => {
  it("names the day before the note, for every combination, in the order the form asks", () => {
    expect(BACKGROUND_FORM_FIELDS).toEqual(["kind", "occurredOn", "note"]);
    const broken = { occurredOn: "", note: "  " };
    const rules = { occurredOn: BACKGROUND_DATE_RULE, note: BACKGROUND_NOTE_RULE };
    const asked = BACKGROUND_FORM_FIELDS.filter(
      (field): field is "occurredOn" | "note" => field in broken,
    );
    for (const subset of subsets(asked)) {
      const fields = { ...BACKGROUND };
      for (const field of subset) {
        fields[field] = broken[field];
      }
      const [first] = asked.filter((field) => subset.includes(field));
      expect(backgroundRefusal(fields)).toEqual(
        first === undefined ? null : { field: first, reason: rules[first] },
      );
    }
  });

  it("refuses a day that is not a calendar date's shape", () => {
    expect(backgroundRefusal({ ...BACKGROUND, occurredOn: "2026-5-2" })?.field).toBe("occurredOn");
  });

  it("stores the note stripped", () => {
    expect(backgroundEntry("jacket", { ...BACKGROUND, note: " Bought a jacket.\n" })).toEqual({
      id: "jacket",
      kind: "purchase",
      occurred_on: "2026-05-02",
      note: "Bought a jacket.",
    });
  });
});

describe("the hidden-fact form's refusal", () => {
  it("names the fact, and nothing for what reveals it", () => {
    expect(HIDDEN_FACT_FORM_FIELDS).toEqual(["note", "revealedWhen"]);
    expect(hiddenFactRefusal({ note: "  ", revealedWhen: "" })).toEqual({
      field: "note",
      reason: HIDDEN_FACT_RULE,
    });
    expect(hiddenFactRefusal({ note: "Has a second flat.", revealedWhen: "" })).toBeNull();
  });

  it("stores both texts stripped", () => {
    expect(
      hiddenFactEntry("flat", { note: " Has a second flat. ", revealedWhen: "\tAsked twice.\n" }),
    ).toEqual({ id: "flat", note: "Has a second flat.", revealed_when: "Asked twice." });
  });
});
