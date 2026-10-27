import { describe, expect, it } from "vitest";
import stylesheet from "../styles.css?raw";
import { NARROW_VIEWPORT_QUERY } from "./viewport";

/**
 * The narrow breakpoint is written twice — once for the classes, once for the hook — because a
 * stylesheet cannot export a string and `matchMedia` cannot read a variant. This holds them to
 * one value, so the top bar never wraps at one width while the rail collapses at another.
 */
describe("the narrow breakpoint", () => {
  it("is the same media query in the stylesheet's variant and in the hook", () => {
    expect(stylesheet).toContain(`@custom-variant narrow (@media ${NARROW_VIEWPORT_QUERY});`);
    expect(stylesheet.match(/@custom-variant narrow /g)).toHaveLength(1);
  });

  it("is Tailwind's md, below which the timeline's lanes already stack", () => {
    expect(NARROW_VIEWPORT_QUERY).toBe("(width < 48rem)");
  });
});
