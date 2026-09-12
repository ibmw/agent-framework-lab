import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { listExperimentHistory } from "../api/experiments";
import {
  type GuideModeOverride,
  readGuideModeOverride,
  writeGuideModeOverride,
} from "./preferences";

/**
 * Guide mode: whether the surfaces that have a tour offer to show you around.
 *
 * The mode itself is derived — on while the lab holds no completed experiment, off once it
 * does — and what an operator stores is only their disagreement with that. Choosing "follow
 * the lab" therefore stores nothing at all, which is why the three choices are not three
 * stored values (ADR 0044).
 *
 * There is one mode and one store. A per-surface "don't show me this again" would be seven
 * preferences to keep in agreement with each other, and a second mode would be a second
 * default to keep in agreement with the record (ADR 0045).
 */

export type GuideModeChoice = "follow" | GuideModeOverride;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // A second tab writing the same preference is the same operator disagreeing with the same
  // default, so this window follows it rather than keeping its own answer.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

// Read on every snapshot rather than cached: the value is a stable primitive, and a cache
// would go on answering after another tab — or a test — cleared the browser's storage.
function readChoice(): GuideModeChoice {
  return readGuideModeOverride() ?? "follow";
}

function serverChoice(): GuideModeChoice {
  return "follow";
}

/**
 * The stored choice, shared by every surface that offers it, so two surfaces can never show
 * two different answers at once.
 */
export function useGuideModeChoice(): [GuideModeChoice, (next: GuideModeChoice) => void] {
  const choice = useSyncExternalStore(subscribe, readChoice, serverChoice);
  const chooseMode = useCallback((next: GuideModeChoice) => {
    writeGuideModeOverride(next === "follow" ? null : next);
    for (const listener of listeners) {
      listener();
    }
  }, []);
  return [choice, chooseMode];
}

/** Guide mode itself: the derived default, unless this browser disagreed with it. */
export function resolveGuideMode(
  choice: GuideModeChoice,
  holdsCompletedExperiment: boolean,
): boolean {
  if (choice !== "follow") {
    return choice === "on";
  }
  return !holdsCompletedExperiment;
}

/**
 * Whether this surface offers its tour.
 *
 * One fact, and a stored disagreement answers it without reading anything at all — which is
 * why an operator who has turned the guide off costs the application no request on any
 * surface. A reading that failed is not a reading that the lab holds a completed comparison:
 * the control stays away rather than appearing on a guess.
 */
export function useGuideMode(): boolean {
  const [choice] = useGuideModeChoice();
  const [on, setOn] = useState(choice === "on");

  useEffect(() => {
    if (choice !== "follow") {
      setOn(choice === "on");
      return;
    }
    const controller = new AbortController();
    listExperimentHistory({ status: "completed", page_size: 1 }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) {
          setOn(resolveGuideMode("follow", page.total > 0));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setOn(false);
        }
      });
    return () => controller.abort();
  }, [choice]);

  return on;
}
