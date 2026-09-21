/**
 * View preferences that belong to the browser and to nothing else.
 *
 * These are per-viewer conveniences — where the app opens, how the rail starts, which shop to
 * offer a way back to, where Settings returns to and how a timestamp is written — so they live
 * in `localStorage` rather than in the lab's database, whose every other row
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
const SETTINGS_RETURN_KEY = "agent-lab.settings-return";

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

function clearStored(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Same case as a write that cannot land: the caller has already dropped the value from
    // the state it renders from, and nothing here can do better than leave the key alone.
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
 * The shop the operator was last standing in, which is what `/settings` and `/glossary` link
 * back to. Leaving shop scope costs the operator their place, and this is what returns it.
 */
export function readLastVisitedShop(): string | null {
  const stored = readStored(LAST_VISITED_SHOP_KEY);
  return stored === null || stored === "" ? null : stored;
}

export function writeLastVisitedShop(shopId: string): void {
  writeStored(LAST_VISITED_SHOP_KEY, shopId);
}

/**
 * *Forget*, on the settings page's own row for it.
 *
 * It is the one preference here an operator drops rather than sets, so it has a control of its
 * own and is not part of *Reset to defaults* (ADR 0058): the shell wrote it as the operator
 * moved, and a reset that emptied it would mean "forget where I was" as well as "undo what I
 * picked". Where the app opens is left exactly as it was — `/` already falls back to the shops
 * index when nothing is remembered (ADR 0054), and a control that rewrote a choice the operator
 * made would be the application editing a preference behind them.
 */
export function forgetLastVisitedShop(): void {
  clearStored(LAST_VISITED_SHOP_KEY);
}

/**
 * What the top bar's *Settings* toggle returns to: the last location that was not `/settings`,
 * path, query and fragment together (ADR 0055).
 *
 * A location rather than `history.back()`, because a reload leaves the settings page at the top
 * of its own entry with nothing behind it — and the reader who reloads a settings page is the
 * reader most likely to have been on it a while. A preference rather than component state for
 * the same reason: it has to survive the reload it exists to answer.
 *
 * It is not resolved against anything before the move. Doing so would mean a second copy of the
 * route tree; a remembered address whose shop has since been removed is answered by the
 * application the way it answers any other dead address.
 */
export function readSettingsReturn(): string | null {
  const stored = readStored(SETTINGS_RETURN_KEY);
  return stored === null || stored === "" ? null : stored;
}

export function writeSettingsReturn(location: string): void {
  writeStored(SETTINGS_RETURN_KEY, location);
}

/**
 * Where the app opens when `/` is asked for.
 *
 * The reader shipped with ADR 0054, ahead of its control, because `/` has to resolve somewhere
 * and writing that resolution twice — once as a constant and once as a preference — is how the
 * two come to disagree. Anything unrecognised reads as the default, which is the same guard
 * every other accessor here applies to a value a person can edit by hand.
 */
export type AppLanding = "last-shop" | "shops" | "lab";

const APP_LANDING_KEY = "agent-lab.app-landing";

const APP_LANDINGS: readonly AppLanding[] = ["last-shop", "shops", "lab"];

export function readAppLanding(): AppLanding {
  const stored = readStored(APP_LANDING_KEY);
  return APP_LANDINGS.find((landing) => landing === stored) ?? "last-shop";
}

export function writeAppLanding(landing: AppLanding): void {
  writeStored(APP_LANDING_KEY, landing);
}

/**
 * How a timestamp is written, everywhere one is (ADR 0058).
 *
 * The default is the prototype's: relative, because a lab is read most often while something
 * in it is still running. Absolute is the string this workspace has always drawn, and it is
 * what an operator switches to in order to quote a date.
 *
 * `lib/ui.ts` reads this at the moment it formats rather than taking it as an argument. The
 * preference can only be changed on `/settings`, which is a route of its own and draws no
 * timestamp, so leaving that page is a mount and there is nothing for a live subscription to
 * do that a remount does not.
 */
export type TimestampFormat = "relative" | "absolute";

const TIMESTAMP_FORMAT_KEY = "agent-lab.timestamp-format";

const TIMESTAMP_FORMATS: readonly TimestampFormat[] = ["relative", "absolute"];

export function readTimestampFormat(): TimestampFormat {
  const stored = readStored(TIMESTAMP_FORMAT_KEY);
  return TIMESTAMP_FORMATS.find((format) => format === stored) ?? "relative";
}

export function writeTimestampFormat(format: TimestampFormat): void {
  writeStored(TIMESTAMP_FORMAT_KEY, format);
}

/**
 * What *Reset to defaults* puts back: the three preferences an operator chose on the settings
 * page, and nothing else (ADR 0058).
 *
 * The last-visited shop and the location Settings returns to are written by the shell as the
 * operator moves. They record where a browser has been rather than how it should behave, so
 * neither is reset here; the first has its own *Forget*.
 *
 * It writes the defaults rather than removing the keys, because a written default and an
 * absent one read the same through every accessor above and a write is what the caller can
 * observe failing in a browser that refuses storage.
 */
export function resetChosenPreferences(): void {
  writeAppLanding("last-shop");
  writeNavigationCollapsed(false);
  writeTimestampFormat("relative");
}
