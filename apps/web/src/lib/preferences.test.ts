import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readGuideModeOverride,
  readLastVisitedShop,
  readNavigationCollapsed,
  writeGuideModeOverride,
  writeLastVisitedShop,
  writeNavigationCollapsed,
} from "./preferences";

/**
 * These are the operator's browser, not the lab's database (ADR 0044), so what matters is what
 * is *not* written as much as what is.
 */
const GUIDE_MODE_KEY = "agent-lab.guide-mode";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("guide mode", () => {
  it("stores only a disagreement with the derived default", () => {
    expect(readGuideModeOverride()).toBeNull();
    expect(window.localStorage.getItem(GUIDE_MODE_KEY)).toBeNull();

    writeGuideModeOverride("on");
    expect(readGuideModeOverride()).toBe("on");

    // "Follow the lab" is the derived default, so choosing it removes the key rather than
    // writing a third word: a browser that never disagreed and one that changed its mind back
    // are the same browser.
    writeGuideModeOverride(null);
    expect(window.localStorage.getItem(GUIDE_MODE_KEY)).toBeNull();
    expect(readGuideModeOverride()).toBeNull();
  });

  it("reads a value it did not write as no disagreement at all", () => {
    window.localStorage.setItem(GUIDE_MODE_KEY, "follow");

    expect(readGuideModeOverride()).toBeNull();
  });

  it("answers with the derived default when the browser refuses storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });

    expect(readGuideModeOverride()).toBeNull();
    expect(() => writeGuideModeOverride(null)).not.toThrow();
  });
});

describe("the other two view preferences", () => {
  it("default to an expanded rail and no remembered shop", () => {
    expect(readNavigationCollapsed()).toBe(false);
    expect(readLastVisitedShop()).toBeNull();

    writeNavigationCollapsed(true);
    writeLastVisitedShop("3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c");

    expect(readNavigationCollapsed()).toBe(true);
    expect(readLastVisitedShop()).toBe("3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c");
  });
});
