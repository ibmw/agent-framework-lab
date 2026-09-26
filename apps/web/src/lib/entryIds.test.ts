import { describe, expect, it } from "vitest";
import {
  nextReference,
  referencePrefix,
  SLUG_MAX_LENGTH,
  seriesPrefix,
  slugify,
  uniqueId,
  uniqueSuggestion,
  uniqueVariantSku,
  variantSku,
} from "./entryIds";

describe("slugify", () => {
  it("writes lowercase kebab-case and folds accents", () => {
    expect(slugify("Alpine Shell Jacket")).toBe("alpine-shell-jacket");
    expect(slugify("Café Noël")).toBe("cafe-noel");
  });

  it("uses the fallback when nothing ASCII remains", () => {
    expect(slugify("株式会社")).toBe("entry");
    expect(slugify("株式会社", "")).toBe("");
  });

  it("tolerates a missing part rather than throwing", () => {
    expect(slugify(undefined, "")).toBe("");
    expect(slugify(null, "")).toBe("");
  });
});

describe("uniqueId", () => {
  it("keeps the base when it is free", () => {
    expect(uniqueId("alpine-shell-jacket", [])).toBe("alpine-shell-jacket");
  });

  it("suffixes from 2 when the base is taken", () => {
    expect(uniqueId("alpine-shell-jacket", ["alpine-shell-jacket"])).toBe("alpine-shell-jacket-2");
    expect(uniqueId("alpine-shell-jacket", ["alpine-shell-jacket", "alpine-shell-jacket-2"])).toBe(
      "alpine-shell-jacket-3",
    );
  });

  it("cuts to the domain's slug cap when no cap is given", () => {
    expect(uniqueId("x".repeat(80), [])).toBe("x".repeat(64));
    expect(uniqueId("x".repeat(80), ["x".repeat(64)])).toBe(`${"x".repeat(62)}-2`);
  });

  it("leaves an empty base empty rather than inventing a word", () => {
    expect(uniqueId("", [])).toBe("");
    expect(uniqueId("", [""])).toBe("");
  });
});

describe("uniqueSuggestion", () => {
  it("passes the taken base when the free id had to step off it", () => {
    expect(uniqueSuggestion("alpine-shell-jacket", [])).toEqual({
      value: "alpine-shell-jacket",
    });
    expect(uniqueSuggestion("alpine-shell-jacket", ["alpine-shell-jacket"])).toEqual({
      value: "alpine-shell-jacket-2",
      takenBase: "alpine-shell-jacket",
    });
  });
});

describe("variantSku", () => {
  it("joins the handle and chosen option values as uppercase kebab", () => {
    expect(variantSku("alpine-shell-jacket", ["Ocean Blue", "M"])).toBe(
      "ALPINE-SHELL-JACKET-OCEAN-BLUE-M",
    );
  });

  it("uses the handle alone when no option is chosen", () => {
    expect(variantSku("alpine-shell-jacket", [])).toBe("ALPINE-SHELL-JACKET");
  });

  it("skips a missing option value rather than throwing", () => {
    expect(variantSku("alpine-shell-jacket", [undefined, "M"])).toBe("ALPINE-SHELL-JACKET-M");
  });
});

describe("uniqueVariantSku", () => {
  it("clamps before it compares, so the value it answers is free at the length it is stored", () => {
    const handle = "x".repeat(80);
    // What the 80-character base is stored as: taken, so a value merely unequal to the
    // unclamped base would collide with it after the cut.
    const taken = ["X".repeat(SLUG_MAX_LENGTH)];
    const { value, takenBase } = uniqueVariantSku(handle, [], taken);
    expect(value.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(taken).not.toContain(value);
    expect(value).toBe(`${"X".repeat(SLUG_MAX_LENGTH - 2)}-2`);
    expect(takenBase).toBe(taken[0]);
  });
});

describe("uniqueId within the slug cap", () => {
  it("keeps every suffixed candidate within the cap and off a trailing hyphen", () => {
    const base = `${"a".repeat(61)}-bc`;
    const taken = [base.slice(0, 64), `${"a".repeat(61)}-2`];
    const value = uniqueId(base, taken, 64);
    expect(value).toBe(`${"a".repeat(61)}-3`);
    expect(value.length).toBeLessThanOrEqual(64);
  });
});

describe("uniqueSuggestion within the slug cap", () => {
  const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  /** A slug of exactly `length` characters, made of words so a cut can land anywhere. */
  function slugOf(length: number): string {
    return "abcdefgh-"
      .repeat(Math.ceil(length / 9) + 1)
      .slice(0, length)
      .replace(/-$/, "x");
  }

  it.each([63, 64])("leaves a %i-character source exactly as it is", (length) => {
    const source = slugOf(length);
    expect(source).toHaveLength(length);
    expect(uniqueSuggestion(source, [])).toEqual({ value: source });
  });

  it.each([65, 200])("cuts a %i-character source to the domain's cap", (length) => {
    const source = slugOf(length);
    const { value, takenBase } = uniqueSuggestion(source, []);
    expect(value.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(value).toMatch(SLUG);
    expect(source.startsWith(value)).toBe(true);
    expect(takenBase).toBeUndefined();
  });

  it("steps off a base that is only taken once it is cut, and names the cut base", () => {
    const source = "x".repeat(80);
    const stored = "x".repeat(SLUG_MAX_LENGTH);
    const { value, takenBase } = uniqueSuggestion(source, [stored]);
    expect(value).toBe(`${"x".repeat(SLUG_MAX_LENGTH - 2)}-2`);
    expect(takenBase).toBe(stored);
  });

  it("never leaves a trailing hyphen where the cut lands", () => {
    // Character 64 is a hyphen, so the plain cut would end on it.
    const source = `${"a".repeat(63)}-${"b".repeat(20)}`;
    expect(uniqueSuggestion(source, [])).toEqual({ value: "a".repeat(63) });
    // And room for a suffix moves the cut onto a hyphen too: 61 characters, then "-2".
    const tight = `${"a".repeat(61)}-${"b".repeat(20)}`;
    expect(uniqueSuggestion(tight, [`${"a".repeat(61)}-bb`])).toEqual({
      value: `${"a".repeat(61)}-2`,
      takenBase: `${"a".repeat(61)}-bb`,
    });
  });

  it("clamps to a limit other than the default when given one", () => {
    const source = "block-name-that-is-long";
    expect(uniqueSuggestion(source, [], 10)).toEqual({ value: "block-name" });
    expect(uniqueSuggestion(source, ["block-name"], 10)).toEqual({
      value: "block-na-2",
      takenBase: "block-name",
    });
  });
});

describe("nextReference", () => {
  it.each([
    { prefix: "NS", taken: [], expected: "NS-1" },
    { prefix: "NS", taken: ["NS-10482"], expected: "NS-10483" },
    { prefix: "NS", taken: ["NS-10479", "NS-10482"], expected: "NS-10483" },
    { prefix: "NS", taken: ["NS-10482", "NS-10483"], expected: "NS-10484" },
    { prefix: "T", taken: ["T-204", "T-187"], expected: "T-205" },
    { prefix: "T", taken: ["T-2041"], expected: "T-2042" },
    { prefix: "NS", taken: ["T-204", "OTHER"], expected: "NS-1" },
    { prefix: "NS", taken: ["NS-10482", "NS-ABC"], expected: "NS-10483" },
  ] as const)("nextReference($prefix, $taken) → $expected", ({ prefix, taken, expected }) => {
    expect(nextReference(prefix, taken)).toBe(expected);
  });

  it("does not invent a reference when the prefix is empty", () => {
    expect(nextReference("", ["NS-10482"])).toBe("");
  });
});

describe("referencePrefix", () => {
  it("takes the initials of the shop name", () => {
    expect(referencePrefix("Northstar Outfitters")).toBe("NO");
    expect(referencePrefix("Harbour Lane Supply")).toBe("HLS");
  });

  it("falls back when a name has no Latin initials", () => {
    expect(referencePrefix("")).toBe("REF");
    expect(referencePrefix("株式会社")).toBe("REF");
  });
});

describe("seriesPrefix", () => {
  it("continues the numbered series the shop already quotes", () => {
    expect(seriesPrefix(["NS-10479", "NS-10482"], "NO")).toBe("NS");
    expect(seriesPrefix(["T-187", "T-204"], "T")).toBe("T");
  });

  it("uses the fallback when nothing in the list is a numbered series", () => {
    expect(seriesPrefix([], "NO")).toBe("NO");
    expect(seriesPrefix(["NS-ABC"], "NO")).toBe("NO");
  });

  it.each([
    { taken: ["NS-9", "ZZ-10"], fallback: "NO", expected: "ZZ" },
    { taken: ["ZZ-10", "NS-9"], fallback: "NO", expected: "NS" },
    { taken: ["NS-1", "ZZ-10", "NS-2"], fallback: "NO", expected: "NS" },
    { taken: ["ZZ-1", "NS-9", "ZZ-2"], fallback: "NO", expected: "ZZ" },
  ] as const)("seriesPrefix($taken) → $expected", ({ taken, fallback, expected }) => {
    expect(seriesPrefix(taken, fallback)).toBe(expected);
  });

  it("keeps the greedy hyphen: FOO-BAR-3 is the FOO-BAR series", () => {
    expect(seriesPrefix(["FOO-BAR-3"], "NO")).toBe("FOO-BAR");
    expect(seriesPrefix(["NS-1", "FOO-BAR-3"], "NO")).toBe("FOO-BAR");
  });
});
