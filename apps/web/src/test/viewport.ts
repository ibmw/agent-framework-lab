import { act } from "@testing-library/react";
import { vi } from "vitest";
import { NARROW_VIEWPORT_QUERY } from "../lib/viewport";

/**
 * A viewport on one side of the narrow breakpoint, which a case can move across (ADR 0079).
 *
 * jsdom lays nothing out and has no `matchMedia`, so the width is the media query's answer and
 * nothing else. The stub answers **only** `NARROW_VIEWPORT_QUERY` — every other query is false —
 * so a shell that asked a different question than the stylesheet's `narrow:` variant would read
 * wide here and fail the case. `vi.stubGlobal` is undone by `vi.unstubAllGlobals()`, which the
 * suite calls in its `afterEach`.
 */
export function stubViewport(start: "narrow" | "wide") {
  let narrow = start === "narrow";
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    get matches() {
      return query === NARROW_VIEWPORT_QUERY && narrow;
    },
    onchange: null,
    addEventListener: (_type: "change", listener: () => void) => {
      if (query === NARROW_VIEWPORT_QUERY) {
        listeners.add(listener);
      }
    },
    removeEventListener: (_type: "change", listener: () => void) => {
      listeners.delete(listener);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  return {
    /** Moves the viewport across the breakpoint, as a rotated phone or a dragged window does. */
    resize(to: "narrow" | "wide") {
      narrow = to === "narrow";
      act(() => {
        for (const listener of [...listeners]) {
          listener();
        }
      });
    },
  };
}
