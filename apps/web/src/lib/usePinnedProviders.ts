import { useEffect, useRef, useState } from "react";
import { getAgentConfigurationVersion } from "../api/agentConfigurations";

/** One published agent-configuration version an arm pins, or would pin. */
export interface Pin {
  configurationId: string;
  version: number;
}

/** How a pin is looked up in what `usePinnedProviders` answers. */
export function pinKey(pin: Pin): string {
  return `${pin.configurationId}@${pin.version}`;
}

/**
 * The provider each pinned version names, read off the version itself (ADR 0053).
 *
 * The version is what an arm runs, so its provider is the one whose reach decides whether the
 * arm can be advanced here. Each version is read once however many arms or rows pin it, and
 * only while `wanted` — a surface that already knows the lab reaches everything has nothing
 * to ask. A version that has not answered, or that could not be read, is simply absent: the
 * note this feeds says nothing rather than something. Every read in flight is aborted when
 * the surface goes, or when the pins it is asked about change.
 */
export function usePinnedProviders(
  pins: readonly Pin[],
  wanted: boolean,
): ReadonlyMap<string, string> {
  const [providers, setProviders] = useState<ReadonlyMap<string, string>>(() => new Map());
  // Every key asked for and not abandoned: answered, refused, or still in flight.
  const asked = useRef(new Set<string>());
  const keys = wanted ? [...new Set(pins.map(pinKey))].sort().join(" ") : "";

  useEffect(() => {
    const controller = new AbortController();
    const inFlight = new Set<string>();
    for (const key of keys.split(" ")) {
      if (key === "" || asked.current.has(key)) {
        continue;
      }
      asked.current.add(key);
      inFlight.add(key);
      const at = key.lastIndexOf("@");
      getAgentConfigurationVersion(key.slice(0, at), Number(key.slice(at + 1)), controller.signal)
        .then((published) => {
          inFlight.delete(key);
          setProviders((current) => new Map(current).set(key, published.content.model.provider));
        })
        .catch(() => {
          // Refused or unreadable: settled, and silent. An aborted read is not settled, and
          // is asked again by whichever run of this effect still wants it.
          if (!controller.signal.aborted) {
            inFlight.delete(key);
          }
        });
    }
    return () => {
      controller.abort();
      for (const key of inFlight) {
        asked.current.delete(key);
      }
    };
  }, [keys]);

  return providers;
}
