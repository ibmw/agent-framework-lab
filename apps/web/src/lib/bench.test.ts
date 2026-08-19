import { describe, expect, it } from "vitest";
import { activeBenchStep, type BenchLocation, benchStepTarget } from "./bench";

const home: BenchLocation = { pathname: "/", hash: "", search: "" };

describe("bench step targets", () => {
  it("sends generate and library to in-page hashes", () => {
    expect(benchStepTarget(1, home)).toEqual({ to: "/#generate", enabled: true });
    expect(benchStepTarget(2, home)).toEqual({ to: "/#library", enabled: true });
  });

  it("marks library as the active step when the hash is #library", () => {
    expect(activeBenchStep({ ...home, hash: "#library" })).toBe(2);
    expect(activeBenchStep({ ...home, hash: "#generate" })).toBe(1);
  });
});
