import { describe, expect, it } from "vitest";
import { pythonStrip } from "./pythonText";

describe("pythonStrip", () => {
  it("strips what Python's strip removes, and nothing JavaScript's trim adds", () => {
    expect(pythonStrip("\x85\x1c\x1f \u00a0")).toBe("");
    expect(pythonStrip("\ufeffx\ufeff")).toBe("\ufeffx\ufeff");
  });

  it("strips the ends only", () => {
    expect(pythonStrip("\x85 Returns \x1f\n")).toBe("Returns");
    expect(pythonStrip("a\x85b")).toBe("a\x85b");
  });
});
