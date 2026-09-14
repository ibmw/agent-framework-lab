import { describe, expect, it } from "vitest";
import {
  nextReference,
  referencePrefix,
  SKU_MAX_LENGTH,
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
  it("uniquifies first and clamps afterwards so a collided sku stays within 64 characters", () => {
    const handle = "x".repeat(80);
    const taken = [variantSku(handle, [])];
    const { value } = uniqueVariantSku(handle, [], taken);
    expect(value.length).toBeLessThanOrEqual(SKU_MAX_LENGTH);
    expect(value).not.toBe(taken[0]);
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
