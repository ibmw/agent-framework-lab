import { describe, expect, it } from "vitest";
import { GUIDANCE_BODY_RULE, GUIDANCE_TITLE_RULE } from "./fieldRules";
import { GUIDANCE_FORM_FIELDS, guidanceEntry, guidanceRefusal } from "./guidanceNotes";

describe("the guidance form's refusal", () => {
  it("names the title before the body, for every combination, in the order the form asks", () => {
    expect(GUIDANCE_FORM_FIELDS).toEqual(["title", "body"]);
    const note = { title: "Refunds", body: "Offer a refund above 200 EUR." };
    // Only Python's whitespace, which the lab strips and JavaScript's `trim()` partly keeps.
    const blank = "\x1c \x85";
    expect(guidanceRefusal(note)).toBeNull();
    expect(guidanceRefusal({ ...note, body: blank })).toEqual({
      field: "body",
      reason: GUIDANCE_BODY_RULE,
    });
    expect(guidanceRefusal({ ...note, title: blank })).toEqual({
      field: "title",
      reason: GUIDANCE_TITLE_RULE,
    });
    expect(guidanceRefusal({ title: "", body: "" })).toEqual({
      field: "title",
      reason: GUIDANCE_TITLE_RULE,
    });
  });

  it("stores the title and the body stripped as the lab strips them", () => {
    expect(guidanceEntry("refunds", { title: "\x1fRefunds ", body: " Offer one.\x85" })).toEqual({
      id: "refunds",
      title: "Refunds",
      body: "Offer one.",
    });
  });
});
