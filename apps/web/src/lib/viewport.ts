import { useSyncExternalStore } from "react";

/**
 * Below this width the viewport is narrow, and the rail draws its strip whatever the remembered
 * preference says (ADR 0079).
 *
 * Tailwind's `md` breakpoint, 48rem, written as the media query its `max-md:` variant compiles
 * to. It is also the point at which the timeline's lanes already stack (`md:` in
 * `ExperimentTimelinePage.tsx`), so the workspace has one answer to "is this a phone".
 *
 * The stylesheet declares the same string as the `narrow:` variant (`styles.css`, the
 * `@custom-variant narrow` line), so a class that wraps the top bar and the hook that collapses
 * the rail switch at the same pixel. `viewport.test.ts` reads the stylesheet as text and fails
 * if the two strings ever differ.
 */
export const NARROW_VIEWPORT_QUERY = "(width < 48rem)";

function narrowList(): MediaQueryList | null {
  // jsdom has no `matchMedia`, and neither does a browser old enough to lack it: both are read
  // as wide, which is the layout the workspace was drawn for.
  return typeof window.matchMedia === "function" ? window.matchMedia(NARROW_VIEWPORT_QUERY) : null;
}

function subscribe(onChange: () => void): () => void {
  const list = narrowList();
  if (list === null) {
    return () => {};
  }
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

function isNarrow(): boolean {
  return narrowList()?.matches ?? false;
}

/** Whether the viewport is below the narrow breakpoint now, and again whenever it crosses it. */
export function useNarrowViewport(): boolean {
  return useSyncExternalStore(subscribe, isNarrow, () => false);
}
