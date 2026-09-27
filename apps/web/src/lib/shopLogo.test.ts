import { describe, expect, it } from "vitest";
import shopDomain from "../../../../apps/api/src/capability_lab/domain/shop.py?raw";
import {
  contrastRatio,
  MARK_COLOURS,
  MIN_MARK_CONTRAST,
  markColourFor,
  SHOP_LOGO_BACKGROUNDS,
  SHOP_MARKS,
} from "./shopLogo";

/** The same table `apps/api/tests/test_shop_logo.py` asserts; the two must agree (ADR 0070). */
const EXPECTED_MARK_COLOUR = {
  clay: "white",
  pine: "white",
  indigo: "white",
  plum: "white",
  forest: "white",
  ochre: "ink",
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
    expect(backgrounds).toHaveLength(7);
    expect(SHOP_LOGO_BACKGROUNDS.map((entry) => entry.value)).toEqual(backgrounds);
    expect(
      Object.fromEntries(SHOP_LOGO_BACKGROUNDS.map((entry) => [entry.value, entry.hex])),
    ).toEqual(domainHexTable("SHOP_LOGO_BACKGROUND_HEX", "ShopLogoBackground", backgrounds));
    expect(
      Object.fromEntries(Object.entries(MARK_COLOURS).map(([key, value]) => [key, value.hex])),
    ).toEqual(
      domainHexTable("SHOP_MARK_COLOUR_HEX", "ShopMarkColour", domainEnum("ShopMarkColour")),
    );

    expect(SHOP_MARKS).toEqual(domainEnum("ShopMark"));
    expect(SHOP_MARKS).toHaveLength(28);
  });

  it.each(SHOP_LOGO_BACKGROUNDS)(
    "draws the mark on $name in the higher-contrast colour, at 3:1 or more",
    ({ value, hex }) => {
      const derived = markColourFor(value);
      const ratios = {
        white: contrastRatio(hex, MARK_COLOURS.white.hex),
        ink: contrastRatio(hex, MARK_COLOURS.ink.hex),
      };

      expect(derived).toBe(EXPECTED_MARK_COLOUR[value]);
      expect(ratios[derived]).toBe(Math.max(ratios.white, ratios.ink));
      expect(ratios[derived]).toBeGreaterThanOrEqual(MIN_MARK_CONTRAST);
    },
  );

  it("measures contrast the WCAG way", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(contrastRatio("#ffffff", "#c2532d")).toBeCloseTo(4.6, 2);
  });
});
