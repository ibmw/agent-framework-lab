import { describe, expect, it } from "vitest";
import shopDomain from "../../../../apps/api/src/capability_lab/domain/shop.py?raw";
import {
  contrastRatio,
  isLowContrast,
  MIN_MARK_CONTRAST,
  markColourFor,
  SHOP_LOGO_BACKGROUNDS,
  SHOP_MARK_COLOURS,
  SHOP_MARKS,
} from "./shopLogo";

/**
 * Every background against both mark colours: the ratio to two places, and whether the editor
 * warns. The same sixteen rows `apps/api/tests/test_shop_logo.py` asserts (ADR 0070).
 */
const EXPECTED_PAIRS = [
  ["clay", "white", 4.6, false],
  ["clay", "ink", 2.96, true],
  ["pine", "white", 7.3, false],
  ["pine", "ink", 1.86, true],
  ["indigo", "white", 8.82, false],
  ["indigo", "ink", 1.54, true],
  ["plum", "white", 7.74, false],
  ["plum", "ink", 1.76, true],
  ["forest", "white", 13.59, false],
  ["forest", "ink", 1.0, true],
  ["ochre", "white", 3.63, false],
  ["ochre", "ink", 3.74, false],
  ["brick", "white", 7.27, false],
  ["brick", "ink", 1.87, true],
  ["stone", "white", 1.16, true],
  ["stone", "ink", 11.68, false],
] as const;

/** What a background chosen before its colour starts the mark in: the higher of the two. */
const EXPECTED_DERIVED_COLOUR = {
  clay: "white",
  pine: "white",
  indigo: "white",
  plum: "white",
  forest: "white",
  ochre: "ink",
  brick: "white",
  stone: "ink",
} as const;

/** `NAME = "value"` members of one `StrEnum` in `domain/shop.py`, in declaration order. */
function domainEnum(name: string): string[] {
  const body = shopDomain.split(`class ${name}(StrEnum):`)[1]?.split("\n\n\n")[0] ?? "";
  return [...body.matchAll(/^\s+[A-Z_]+ = "([a-z_]+)"$/gm)].map((match) => match[1] as string);
}

/** A `{Enum.MEMBER: "#rrggbb"}` table of `domain/shop.py`, keyed by the member's value. */
function domainHexTable(
  table: string,
  enumName: string,
  members: string[],
): Record<string, string> {
  const body = shopDomain.split(`${table}:`)[1]?.split("}")[0] ?? "";
  return Object.fromEntries(
    [...body.matchAll(new RegExp(`${enumName}\\.([A-Z_]+): "(#[0-9a-f]{6})"`, "g"))].map(
      (match) => {
        const member = (match[1] as string).toLowerCase();
        expect(members).toContain(member);
        return [member, match[2] as string];
      },
    ),
  );
}

describe("the shop logo's palette", () => {
  it("is the lab's palette, mark for mark and hex for hex", () => {
    const backgrounds = domainEnum("ShopLogoBackground");
    expect(backgrounds).toHaveLength(8);
    expect(backgrounds).toContain("brick");
    expect(SHOP_LOGO_BACKGROUNDS.map((entry) => entry.value)).toEqual(backgrounds);
    expect(
      Object.fromEntries(SHOP_LOGO_BACKGROUNDS.map((entry) => [entry.value, entry.hex])),
    ).toEqual(domainHexTable("SHOP_LOGO_BACKGROUND_HEX", "ShopLogoBackground", backgrounds));

    const colours = domainEnum("ShopMarkColour");
    expect(SHOP_MARK_COLOURS.map((entry) => entry.value)).toEqual(colours);
    expect(Object.fromEntries(SHOP_MARK_COLOURS.map((entry) => [entry.value, entry.hex]))).toEqual(
      domainHexTable("SHOP_MARK_COLOUR_HEX", "ShopMarkColour", colours),
    );

    expect(SHOP_MARKS).toEqual(domainEnum("ShopMark"));
    expect(SHOP_MARKS).toHaveLength(28);
  });

  it("warns about exactly the pairs under 3:1, all sixteen enumerated", () => {
    const pairs = SHOP_LOGO_BACKGROUNDS.flatMap((background) =>
      SHOP_MARK_COLOURS.map((colour) => ({ background, colour })),
    );
    expect(pairs).toHaveLength(16);
    expect(pairs.map(({ background, colour }) => [background.value, colour.value])).toEqual(
      EXPECTED_PAIRS.map(([background, colour]) => [background, colour]),
    );

    for (const [index, { background, colour }] of pairs.entries()) {
      const [, , expectedRatio, expectedWarning] = EXPECTED_PAIRS[index] ?? [];
      const ratio = contrastRatio(background.hex, colour.hex);
      expect(ratio).toBeCloseTo(expectedRatio as number, 2);
      expect(isLowContrast(background.value, colour.value)).toBe(expectedWarning);
      expect(isLowContrast(background.value, colour.value)).toBe(ratio < MIN_MARK_CONTRAST);
    }
  });

  it.each(SHOP_LOGO_BACKGROUNDS)(
    "starts a mark on $name in the higher-contrast colour",
    ({ value, hex }) => {
      const derived = markColourFor(value);
      const ratios = {
        white: contrastRatio(hex, "#ffffff"),
        ink: contrastRatio(hex, "#16332d"),
      };

      expect(derived).toBe(EXPECTED_DERIVED_COLOUR[value]);
      expect(ratios[derived]).toBe(Math.max(ratios.white, ratios.ink));
    },
  );

  it("measures contrast the WCAG way", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(contrastRatio("#ffffff", "#c2532d")).toBeCloseTo(4.6, 2);
  });
});
