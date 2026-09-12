/**
 * View preferences that belong to the browser and to nothing else.
 *
 * These are per-viewer conveniences — how the rail starts, and which shop to offer a way back
 * to — so they live in `localStorage` rather than in the lab's database, whose every other row
 * is evidence an experiment pins. There is also no user to key a stored row to: tenancy is
 * deferred, so a settings table would be a singleton pretending to be a preference (ADR 0044).
 *
 * Every read and write is guarded. `localStorage` throws on access in a private window and in
 * a browser with site data blocked, and it can be cleared between two visits, so a missing or
 * unreadable value is the ordinary case and each accessor answers with the derived default
 * instead of failing the render.
 */

const NAVIGATION_COLLAPSED_KEY = "agent-lab.navigation-collapsed";
const LAST_VISITED_SHOP_KEY = "agent-lab.last-visited-shop";

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A preference that cannot be remembered is still a preference for this session; the
    // caller holds it in component state either way.
  }
}

/** Whether the navigation rail starts collapsed. Expanded until somebody says otherwise. */
export function readNavigationCollapsed(): boolean {
  return readStored(NAVIGATION_COLLAPSED_KEY) === "true";
}

export function writeNavigationCollapsed(collapsed: boolean): void {
  writeStored(NAVIGATION_COLLAPSED_KEY, collapsed ? "true" : "false");
}

/**
 * The shop the operator was last standing in, which is what `/settings` and `/guides` link
 * back to. Leaving shop scope costs the operator their place, and this is what returns it.
 */
export function readLastVisitedShop(): string | null {
  const stored = readStored(LAST_VISITED_SHOP_KEY);
  return stored === null || stored === "" ? null : stored;
}

export function writeLastVisitedShop(shopId: string): void {
  writeStored(LAST_VISITED_SHOP_KEY, shopId);
}
