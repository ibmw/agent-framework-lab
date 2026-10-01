import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_BOOLEAN_RULE,
  ATTRIBUTE_LABEL_RULE,
  ATTRIBUTE_MEASUREMENT_RULE,
  ATTRIBUTE_NEEDS_CHOICE,
  ATTRIBUTE_NUMBER_RULE,
  ATTRIBUTE_UNIT_RULE,
  ATTRIBUTE_VALUE_AMONG_CHOICES_RULE,
  ATTRIBUTE_VALUE_RULE,
  ENTRY_KEY_RULE,
  MEDIA_ALT_TEXT_RULE,
  MEDIA_NEEDS_REFERENCE,
  OPTION_NAME_RULE,
  OPTION_NEEDS_VALUE,
  REVIEW_AUTHOR_RULE,
  REVIEW_BODY_RULE,
} from "./fieldRules";
import {
  type AttributeFields,
  attributeEntry,
  attributeRefusal,
  BLANK_ATTRIBUTE,
  type MediaFields,
  mediaEntry,
  mediaRefusal,
  type OptionFields,
  optionEntry,
  optionRefusal,
  type ReviewFields,
  reviewEntry,
  reviewRefusal,
} from "./productEntries";

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

/**
 * Breaks each listed field of `valid` with what `broken` gives it, for every combination, and
 * expects the first broken field in `order` to be the one refused, with its rule.
 */
function expectFirstBrokenRefused<FieldsT extends object>(
  valid: FieldsT,
  order: readonly (keyof FieldsT & string)[],
  broken: Partial<FieldsT>,
  rules: Partial<Record<keyof FieldsT, string>>,
  refusal: (fields: FieldsT) => { field: string | null; reason: string } | null,
) {
  const cases = subsets(order);
  expect(cases).toHaveLength(2 ** order.length);
  for (const combination of cases) {
    const fields = { ...valid };
    for (const field of combination) {
      Object.assign(fields, { [field]: broken[field] });
    }
    const [first] = order.filter((field) => combination.includes(field));
    expect(refusal(fields), combination.join(", ")).toEqual(
      first === undefined ? null : { field: first, reason: rules[first] },
    );
  }
}

const OPTION: OptionFields = { name: "Fit", key: "fit", values: ["Regular"] };

describe("the option form's refusal", () => {
  it("names the first of the name, the key and the values broken while adding, for every combination", () => {
    expectFirstBrokenRefused(
      OPTION,
      ["name", "key", "values"],
      { name: " 　", key: "Not a key", values: [] },
      { name: OPTION_NAME_RULE, key: ENTRY_KEY_RULE, values: OPTION_NEEDS_VALUE },
      (fields) => optionRefusal(fields, ["color"], null),
    );
  });

  it("asks nothing of the key while editing, which is fixed", () => {
    expectFirstBrokenRefused(
      { ...OPTION, key: "Not a key" },
      ["name", "values"],
      { name: "\t", values: [] },
      { name: OPTION_NAME_RULE, values: OPTION_NEEDS_VALUE },
      (fields) => optionRefusal(fields, ["color", "fit"], "fit"),
    );
  });

  it("refuses a key another option holds, and one past the lab's cap, while adding", () => {
    expect(optionRefusal({ ...OPTION, key: "color" }, ["color"], null)).toEqual({
      field: "key",
      reason: "color is already in the draft.",
    });
    expect(optionRefusal({ ...OPTION, key: "a".repeat(65) }, [], null)?.reason).toBe(
      ENTRY_KEY_RULE,
    );
    expect(optionRefusal({ ...OPTION, key: "a".repeat(64) }, [], null)).toBeNull();
  });

  it("stores the name stripped as the lab strips it", () => {
    expect(optionEntry("fit", { ...OPTION, name: " Fit " })).toEqual({
      key: "fit",
      name: "Fit",
      values: ["Regular"],
    });
  });
});

const MEDIA: MediaFields = { reference: "media/front.jpg", altText: "Front" };

describe("the media form's refusal", () => {
  it("names the first of the reference and the alt text broken, for every combination", () => {
    expectFirstBrokenRefused(
      MEDIA,
      ["reference", "altText"],
      { reference: "  ", altText: " " },
      { reference: MEDIA_NEEDS_REFERENCE, altText: MEDIA_ALT_TEXT_RULE },
      (fields) => mediaRefusal(fields, ["media/back.jpg"], null),
    );
  });

  it("refuses a reference another entry holds, as the lab would store it, and not its own", () => {
    const taken = ["media/front.jpg", "media/back.jpg"];
    expect(mediaRefusal({ ...MEDIA, reference: " media/back.jpg " }, taken, null)).toEqual({
      field: "reference",
      reason: "media/back.jpg is already a media reference of this product.",
    });
    expect(mediaRefusal(MEDIA, taken, "media/front.jpg")).toBeNull();
    expect(
      mediaRefusal({ ...MEDIA, reference: "media/back.jpg" }, taken, "media/front.jpg"),
    ).toEqual({
      field: "reference",
      reason: "media/back.jpg is already a media reference of this product.",
    });
    // Said before the alt text, which is asked after it.
    expect(mediaRefusal({ reference: "media/back.jpg", altText: "" }, taken, null)?.field).toBe(
      "reference",
    );
  });

  it("stores both texts stripped", () => {
    expect(mediaEntry({ reference: " media/front.jpg\n", altText: " Front " })).toEqual({
      reference: "media/front.jpg",
      alt_text: "Front",
    });
  });
});

const CHOICE: AttributeFields = {
  label: "Cut",
  key: "cut",
  attributeType: "choice",
  value: "Regular",
  unit: "",
  choices: ["Regular", "Relaxed"],
};

describe("the attribute form's refusal", () => {
  it("names the first of the label, key, value and choices broken on a choice, for every combination", () => {
    expectFirstBrokenRefused(
      CHOICE,
      ["label", "key", "value", "choices"],
      { label: " ", key: "", value: "\t", choices: [] },
      {
        label: ATTRIBUTE_LABEL_RULE,
        key: ENTRY_KEY_RULE,
        value: ATTRIBUTE_VALUE_RULE,
        choices: ATTRIBUTE_NEEDS_CHOICE,
      },
      (fields) => attributeRefusal(fields, [], null),
    );
  });

  it("names the first of the label, value and unit broken on a measurement being edited", () => {
    expectFirstBrokenRefused<AttributeFields>(
      {
        ...BLANK_ATTRIBUTE,
        label: "Weight",
        key: "weight",
        attributeType: "measurement",
        value: "1.2",
        unit: "kg",
      },
      ["label", "value", "unit"],
      { label: "", value: "heavy", unit: " " },
      { label: ATTRIBUTE_LABEL_RULE, value: ATTRIBUTE_MEASUREMENT_RULE, unit: ATTRIBUTE_UNIT_RULE },
      (fields) => attributeRefusal(fields, ["weight"], "weight"),
    );
  });

  it("asks the value its type holds", () => {
    const of = (attributeType: AttributeFields["attributeType"], value: string) =>
      attributeRefusal({ ...CHOICE, attributeType, value, unit: "mm" }, [], null)?.reason ?? null;
    for (const value of ["4", "-4.5", "+.5", "1.", "2e3", " 7 "]) {
      expect(of("number", value), value).toBeNull();
      expect(of("measurement", value), value).toBeNull();
    }
    for (const value of ["four", "1,5", "NaN", "Infinity", "1e", "."]) {
      expect(of("number", value), value).toBe(ATTRIBUTE_NUMBER_RULE);
      expect(of("measurement", value), value).toBe(ATTRIBUTE_MEASUREMENT_RULE);
    }
    expect(of("boolean", "true")).toBeNull();
    expect(of("boolean", "false")).toBeNull();
    expect(of("boolean", "yes")).toBe(ATTRIBUTE_BOOLEAN_RULE);
    expect(of("boolean", "True")).toBe(ATTRIBUTE_BOOLEAN_RULE);
    expect(of("text", "anything")).toBeNull();
  });

  it("refuses a choice whose value is none of its choices, on the choices", () => {
    expect(attributeRefusal({ ...CHOICE, value: "Slim" }, [], null)).toEqual({
      field: "choices",
      reason: ATTRIBUTE_VALUE_AMONG_CHOICES_RULE,
    });
    // A choice the value would match only padded is the value as the lab stores it.
    expect(attributeRefusal({ ...CHOICE, value: " Relaxed " }, [], null)).toBeNull();
  });

  it("writes only what the type holds, every text stripped", () => {
    expect(
      attributeEntry("cut", { ...CHOICE, label: " Cut ", value: "Relaxed ", unit: "mm" }),
    ).toEqual({
      key: "cut",
      label: "Cut",
      attribute_type: "choice",
      value: "Relaxed",
      unit: null,
      choices: ["Regular", "Relaxed"],
    });
    expect(
      attributeEntry("w", { ...CHOICE, attributeType: "measurement", value: "2", unit: " kg " }),
    ).toEqual({
      key: "w",
      label: "Cut",
      attribute_type: "measurement",
      value: "2",
      unit: "kg",
      choices: [],
    });
  });
});

const REVIEW: ReviewFields = { author: "Camille", rating: 4, body: "Dry." };

describe("the review form's refusal", () => {
  it("names the first of the author and the body broken, for every combination", () => {
    expectFirstBrokenRefused(
      REVIEW,
      ["author", "body"],
      { author: " ", body: "  " },
      { author: REVIEW_AUTHOR_RULE, body: REVIEW_BODY_RULE },
      reviewRefusal,
    );
  });

  it("stores the author and the body stripped, and the rating as chosen", () => {
    expect(reviewEntry("camille", { author: " Camille", rating: 4, body: "Dry.\n" })).toEqual({
      id: "camille",
      author_display_name: "Camille",
      rating: 4,
      body: "Dry.",
    });
  });
});
