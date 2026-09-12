import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { listAgentConfigurations } from "../api/agentConfigurations";
import { objectiveBlocks } from "../api/blocks";
import { listCustomerProfiles } from "../api/customerProfiles";
import { listExperimentHistory } from "../api/experiments";
import { listJudgeConfigurations } from "../api/judgeConfigurations";
import { listOrders } from "../api/orders";
import { listScenarios } from "../api/scenarios";
import { listShops } from "../api/shops";
import { listSupportIdentities } from "../api/supportIdentities";
import { listTickets } from "../api/tickets";
import {
  type GuideModeOverride,
  readGuideModeOverride,
  writeGuideModeOverride,
} from "./preferences";
import type { SetupListings } from "./setupPath";

/**
 * Guide mode and the listings the setup path is read from.
 *
 * The mode itself is derived — on while the lab holds no completed experiment, off once it
 * does — and what an operator stores is only their disagreement with that. Choosing "follow
 * the lab" therefore stores nothing at all, which is why the three choices are not three
 * stored values (ADR 0044).
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
 * The stored choice, shared by every surface that offers it, so the strip's own control and
 * the settings page can never show two different answers at once.
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

/** Everything the path is derived from, minus the shop the host surface supplies. */
export type GuideListings = Omit<SetupListings, "shop">;

const EMPTY_LISTINGS: GuideListings = {
  shops: [],
  profiles: [],
  orders: [],
  tickets: [],
  objectiveBlocks: [],
  scenarios: [],
  supportIdentities: [],
  agentConfigurations: [],
  judges: [],
  experiments: [],
  experimentCount: 0,
};

async function readListings(shopId: string | null, signal: AbortSignal): Promise<GuideListings> {
  if (shopId === null) {
    // Outside a shop only the first step is readable, so only the first step's listing is read.
    const shops = await listShops(signal);
    return { ...EMPTY_LISTINGS, shops: shops.shops };
  }
  const [
    history,
    profiles,
    orders,
    tickets,
    objectives,
    scenarios,
    supportIdentities,
    agentConfigurations,
    judges,
  ] = await Promise.all([
    listExperimentHistory({ page_size: 1 }, signal),
    listCustomerProfiles(shopId, signal),
    listOrders(shopId, signal),
    listTickets(shopId, signal),
    objectiveBlocks.list(signal),
    listScenarios(shopId, signal),
    listSupportIdentities(signal),
    listAgentConfigurations(signal),
    listJudgeConfigurations(signal),
  ]);
  return {
    shops: [],
    profiles: profiles.profiles,
    orders: orders.orders,
    tickets: tickets.tickets,
    objectiveBlocks: objectives.blocks,
    scenarios: scenarios.scenarios,
    supportIdentities: supportIdentities.identities,
    agentConfigurations: agentConfigurations.configurations,
    judges: judges.judges,
    experiments: history.experiments,
    experimentCount: history.total,
  };
}

export interface GuideReading {
  /** Whether guide mode is on, once the record has answered. */
  on: boolean;
  listings: GuideListings | null;
  /** What the derived default reads, reported so a surface can say why the mode is what it is. */
  holdsCompletedExperiment: boolean;
}

const HIDDEN: GuideReading = { on: false, listings: null, holdsCompletedExperiment: false };

/**
 * Read guide mode and, when it is on, the listings the setup path is derived from.
 *
 * Nothing is read while an operator has turned guide mode off: a band nobody is going to see
 * is not worth a request. Otherwise the completed-experiment reading comes first, because it
 * is what decides whether the rest is worth reading at all.
 *
 * A listing that fails leaves the strip unrendered rather than showing a step it could not
 * check. The surface underneath reports its own failures; a guide that guessed at a next step
 * from half a reading would be worse than one that says nothing.
 */
export function useGuideReading(shopId: string | null): GuideReading {
  const [choice] = useGuideModeChoice();
  const [reading, setReading] = useState<GuideReading>(HIDDEN);

  useEffect(() => {
    if (choice === "off") {
      setReading(HIDDEN);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const completed = await listExperimentHistory(
          { status: "completed", page_size: 1 },
          controller.signal,
        );
        const holdsCompletedExperiment = completed.total > 0;
        if (!resolveGuideMode(choice, holdsCompletedExperiment)) {
          if (!controller.signal.aborted) {
            setReading({ ...HIDDEN, holdsCompletedExperiment });
          }
          return;
        }
        const listings = await readListings(shopId, controller.signal);
        if (!controller.signal.aborted) {
          setReading({ on: true, listings, holdsCompletedExperiment });
        }
      } catch {
        if (!controller.signal.aborted) {
          setReading(HIDDEN);
        }
      }
    })();
    return () => controller.abort();
  }, [choice, shopId]);

  return reading;
}
