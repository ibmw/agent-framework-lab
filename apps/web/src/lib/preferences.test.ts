import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readLastVisitedShop,
  readNavigationCollapsed,
  writeLastVisitedShop,
  writeNavigationCollapsed,
} from "./preferences";

/**
 * These are the operator's browser, not the lab's database (ADR 0044), so what matters is what
 * is *not* written as much as what is.
 *
 * Two of them are left, both about where a viewer was and how their window starts. The third,
 * guide mode, is gone with the mode itself (ADR 0046).
 */
const NAVIGATION_COLLAPSED_KEY = "agent-lab.navigation-collapsed";
const LAST_VISITED_SHOP_KEY = "agent-lab.last-visited-shop";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("the two view preferences", () => {
  it("default to an expanded rail and no remembered shop, having written nothing", () => {
    expect(readNavigationCollapsed()).toBe(false);
    expect(readLastVisitedShop()).toBeNull();
    expect(window.localStorage.getItem(NAVIGATION_COLLAPSED_KEY)).toBeNull();
    expect(window.localStorage.getItem(LAST_VISITED_SHOP_KEY)).toBeNull();

    writeNavigationCollapsed(true);
    writeLastVisitedShop(SHOP_ID);

    expect(readNavigationCollapsed()).toBe(true);
    expect(readLastVisitedShop()).toBe(SHOP_ID);
  });

  it("reads a value it did not write as the default rather than as a preference", () => {
    window.localStorage.setItem(NAVIGATION_COLLAPSED_KEY, "yes");
    window.localStorage.setItem(LAST_VISITED_SHOP_KEY, "");

    expect(readNavigationCollapsed()).toBe(false);
    expect(readLastVisitedShop()).toBeNull();
  });

  it("answers with the default when the browser refuses storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });

    // A private window and a browser with site data blocked are the ordinary case, not a
    // failure: every accessor answers with the derived default instead of failing the render.
    expect(readNavigationCollapsed()).toBe(false);
    expect(readLastVisitedShop()).toBeNull();
    expect(() => writeNavigationCollapsed(true)).not.toThrow();
    expect(() => writeLastVisitedShop(SHOP_ID)).not.toThrow();
  });
});
