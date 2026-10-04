import { useEffect, useRef, useState } from "react";
import { getAgentConfigurationVersion } from "../api/agentConfigurations";

/** One published agent-configuration version an arm pins, or would pin. */
export interface Pin {
  configurationId: string;
  version: number;
}

/** How a pin is looked up in what `usePinnedVersions` answers. */
export function pinKey(pin: Pin): string {
  return `${pin.configurationId}@${pin.version}`;
}

/** What a published version says about itself: the provider it names, and the name it was published under. */
export interface PinnedVersion {
  provider: string;
  name: string;
}

/**
 * What each pinned version says, read off the version itself (ADR 0053, ADR 0065).
 *
 * The version is what an arm runs, so its provider is the one whose reach decides whether the
 * arm can be advanced here, and its `content.name` is the one name it was published under —
 * the listing's is today's. Each version is read once however many arms or rows pin it; a
 * caller that wants nothing read passes no pins. A version that has not answered is absent: not
 * yet known. One whose read failed is `null`: known to be unknown, so a caller can say so rather
 * than wait for it. Every read in flight is aborted when the surface goes, or when the pins it
 * is asked about change, and an answer is only ever its own version's, however late it lands:
 * answers are kept by `configuration@version`, and nothing looks one up for another version.
 */
export function usePinnedVersions(pins: readonly Pin[]): ReadonlyMap<string, PinnedVersion | null> {
  const [pinned, setPinned] = useState<ReadonlyMap<string, PinnedVersion | null>>(() => new Map());
  // Every key asked for and not abandoned: answered, refused, or still in flight.
  const asked = useRef(new Set<string>());
  const keys = [...new Set(pins.map(pinKey))].sort().join(" ");

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
          setPinned((current) =>
            new Map(current).set(key, {
              provider: published.content.model.provider,
              name: published.content.name,
            }),
          );
        })
        .catch(() => {
          // Refused or unreadable: settled, as unknown. An aborted read is not settled, and is
          // asked again by whichever run of this effect still wants it.
          if (!controller.signal.aborted) {
            inFlight.delete(key);
            setPinned((current) => new Map(current).set(key, null));
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

  return pinned;
}

/**
 * The name a derived arm runs under, as the version it will run was published.
 *
 * An arm left on the version its run pinned runs what that run recorded, and the record names
 * it as that version was published (`agent_configuration_name`), so nothing is read. An arm
 * moved onto another version is named by that version's own read: `undefined` while it is
 * read — the answer for a version the arm has since left says nothing about this one — and
 * `null` once the read failed, which names nothing rather than a name the version may never
 * have had.
 */
export function publishedNameOf(
  pinned: ReadonlyMap<string, PinnedVersion | null>,
  recorded: { pin: Pin; name: string },
  target: Pin,
): string | null | undefined {
  if (pinKey(target) === pinKey(recorded.pin)) {
    return recorded.name;
  }
  const read = pinned.get(pinKey(target));
  return read === undefined ? undefined : (read?.name ?? null);
}
