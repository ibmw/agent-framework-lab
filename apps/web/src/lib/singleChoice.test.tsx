import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { onlyChoiceNote, soleCandidate, useSingleChoice } from "./singleChoice";

describe("a single choice", () => {
  it.each([
    [[], null],
    [["a"], "a"],
    [["a", "b"], null],
  ])("among %j is %s", (candidates, expected) => {
    expect(soleCandidate(candidates)).toBe(expected);
  });

  it("is said in the prototype's words", () => {
    expect(onlyChoiceNote("published scenario in the shop")).toBe(
      "This one is the only published scenario in the shop, so it is already chosen.",
    );
  });

  it("chooses the sole candidate into an empty value", () => {
    const choose = vi.fn();
    renderHook(() => useSingleChoice(["a"], "", choose));
    expect(choose).toHaveBeenCalledWith("a");
  });

  it("keeps a value the operator holds when a later load changes the sole candidate", () => {
    const choose = vi.fn();
    const { rerender, result } = renderHook(
      ({ candidates }) => useSingleChoice(candidates, "a", choose),
      { initialProps: { candidates: ["a"] } },
    );
    expect(result.current).toBe(true);
    rerender({ candidates: ["c"] });
    expect(choose).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });
});
