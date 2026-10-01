import { describe, expect, it } from "vitest";
import { TONE_GUIDANCE_RULE, TONE_ID_RULE, TONE_NAME_RULE } from "./fieldRules";
import { TONE_FORM_FIELDS, type ToneFields, toneEntry, toneRefusal } from "./toneGuidelines";

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

const VALID: ToneFields = { name: "Brief", id: "brief", guidance: "Lead with the outcome." };
// Only Python's whitespace, which the lab strips and JavaScript's `trim()` partly keeps.
const BLANK = "\x1c \x85";
const RULES: Record<keyof ToneFields, string> = {
  name: TONE_NAME_RULE,
  id: TONE_ID_RULE,
  guidance: TONE_GUIDANCE_RULE,
};

describe("the guideline form's refusal", () => {
  it("names the first of the name, the ID and the guidance broken while adding, for every combination", () => {
    expect(TONE_FORM_FIELDS).toEqual(["name", "id", "guidance"]);
    const broken: ToneFields = { name: BLANK, id: "Not an id", guidance: BLANK };
    const cases = subsets(TONE_FORM_FIELDS);
    expect(cases).toHaveLength(8);
    for (const combination of cases) {
      const fields = { ...VALID };
      for (const field of combination) {
        fields[field] = broken[field];
      }
      const [first] = TONE_FORM_FIELDS.filter((field) => combination.includes(field));
      expect(toneRefusal(fields, ["warm"], null), combination.join(", ")).toEqual(
        first === undefined ? null : { field: first, reason: RULES[first] },
      );
    }
  });

  it("refuses an ID another guideline holds, or one past the lab's cap, while adding", () => {
    expect(toneRefusal({ ...VALID, id: "warm" }, ["warm"], null)).toEqual({
      field: "id",
      reason: "warm is already in the draft.",
    });
    expect(toneRefusal({ ...VALID, id: "a".repeat(65) }, ["warm"], null)).toEqual({
      field: "id",
      reason: TONE_ID_RULE,
    });
    expect(toneRefusal({ ...VALID, id: "a".repeat(64) }, ["warm"], null)).toBeNull();
  });

  it("asks nothing of the ID while editing, which is fixed", () => {
    expect(toneRefusal({ ...VALID, id: "warm" }, ["warm"], "warm")).toBeNull();
    expect(toneRefusal({ ...VALID, id: "warm", name: BLANK }, ["warm"], "warm")).toEqual({
      field: "name",
      reason: TONE_NAME_RULE,
    });
    expect(toneRefusal({ ...VALID, id: "warm", guidance: "" }, ["warm"], "warm")).toEqual({
      field: "guidance",
      reason: TONE_GUIDANCE_RULE,
    });
  });

  it("stores the name and the guidance stripped as the lab strips them, with the default it is handed", () => {
    expect(
      toneEntry("brief", { name: "\x1fBrief ", id: "ignored", guidance: " Short.\x85" }, true),
    ).toEqual({ id: "brief", name: "Brief", guidance: "Short.", is_default: true });
  });
});
