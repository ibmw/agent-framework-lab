import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetLastVisitedShop,
  readAppLanding,
  readLastVisitedShop,
  readNavigationCollapsed,
  readSettingsReturn,
  readTimestampFormat,
  resetChosenPreferences,
  writeAppLanding,
  writeLastVisitedShop,
  writeNavigationCollapsed,
  writeSettingsReturn,
  writeTimestampFormat,
} from "./preferences";

/**
 * These are the operator's browser, not the lab's database (ADR 0044), so what matters is what
 * is *not* written as much as what is.
 *
 * Five of them now, and they divide in two: three an operator chooses on the settings page —
 * where the app opens, how the rail starts, how a timestamp is written — and two the shell
 * writes as they move, the last-visited shop and the location Settings returns to. *Reset to
 * defaults* reaches the first three and none of the last two (ADR 0058). Guide mode is gone
 * with the mode itself (ADR 0046).
 */
const NAVIGATION_COLLAPSED_KEY = "agent-lab.navigation-collapsed";
const LAST_VISITED_SHOP_KEY = "agent-lab.last-visited-shop";
const SETTINGS_RETURN_KEY = "agent-lab.settings-return";
const APP_LANDING_KEY = "agent-lab.app-landing";
const TIMESTAMP_FORMAT_KEY = "agent-lab.timestamp-format";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("the view preferences", () => {
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

  it("opens where the preference says, and on the remembered shop when it says nothing", () => {
    // The control that writes this arrives with the settings zones; the reader ships with the
    // route that needs it, and anything unrecognised is the default rather than a landing
    // nothing can render (ADR 0054).
    expect(readAppLanding()).toBe("last-shop");

    writeAppLanding("lab");
    expect(readAppLanding()).toBe("lab");

    window.localStorage.setItem("agent-lab.app-landing", "somewhere-else");
    expect(readAppLanding()).toBe("last-shop");
  });
});

describe("what Settings returns to", () => {
  it("remembers nothing until a location is recorded, and reads back what was", () => {
    // A browser that opened `/settings` from a link has recorded nothing, and the toggle has
    // the shops index to fall back on rather than a guess (ADR 0055).
    expect(readSettingsReturn()).toBeNull();
    expect(window.localStorage.getItem(SETTINGS_RETURN_KEY)).toBeNull();

    writeSettingsReturn("/shops/shop-1/products?view=draft#top");

    expect(readSettingsReturn()).toBe("/shops/shop-1/products?view=draft#top");
  });

  it("reads an empty value as none, and survives a browser that refuses storage", () => {
    window.localStorage.setItem(SETTINGS_RETURN_KEY, "");
    expect(readSettingsReturn()).toBeNull();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });

    expect(readSettingsReturn()).toBeNull();
    expect(() => writeSettingsReturn("/shops")).not.toThrow();
  });
});

describe("how a timestamp is written", () => {
  it("defaults to relative, round-trips, and refuses a value it did not write", () => {
    expect(readTimestampFormat()).toBe("relative");
    expect(window.localStorage.getItem(TIMESTAMP_FORMAT_KEY)).toBeNull();

    writeTimestampFormat("absolute");
    expect(readTimestampFormat()).toBe("absolute");

    window.localStorage.setItem(TIMESTAMP_FORMAT_KEY, "iso-8601");
    expect(readTimestampFormat()).toBe("relative");
  });

  it("answers with the default when the browser refuses storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });

    expect(readTimestampFormat()).toBe("relative");
    expect(() => writeTimestampFormat("absolute")).not.toThrow();
  });
});

describe("what a reset puts back", () => {
  it("returns the three an operator chose and leaves the two the shell wrote", () => {
    writeAppLanding("lab");
    writeNavigationCollapsed(true);
    writeTimestampFormat("absolute");
    writeLastVisitedShop(SHOP_ID);
    writeSettingsReturn("/shops/shop-1/products");

    resetChosenPreferences();

    expect(readAppLanding()).toBe("last-shop");
    expect(readNavigationCollapsed()).toBe(false);
    expect(readTimestampFormat()).toBe("relative");
    // Neither of these was chosen: the shell writes both as the operator moves, and a reset
    // that emptied them would mean "forget where I was" as well as "undo what I picked".
    expect(readLastVisitedShop()).toBe(SHOP_ID);
    expect(readSettingsReturn()).toBe("/shops/shop-1/products");
  });

  it("survives a browser that refuses storage", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });

    expect(() => resetChosenPreferences()).not.toThrow();
  });
});

describe("forgetting the last-visited shop", () => {
  it("drops the shop and touches no other preference", () => {
    writeLastVisitedShop(SHOP_ID);
    writeAppLanding("last-shop");
    writeTimestampFormat("absolute");

    forgetLastVisitedShop();

    expect(readLastVisitedShop()).toBeNull();
    expect(window.localStorage.getItem(LAST_VISITED_SHOP_KEY)).toBeNull();
    // Where the app opens stays exactly as the operator set it: `/` already falls back to the
    // shops index with nothing remembered (ADR 0054), so nothing here has to rewrite a choice.
    expect(window.localStorage.getItem(APP_LANDING_KEY)).toBe("last-shop");
    expect(readTimestampFormat()).toBe("absolute");
  });

  it("survives a browser that refuses storage", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });

    expect(() => forgetLastVisitedShop()).not.toThrow();
  });
});
