import type { ResolvedDefinitionSchema } from "@agent-lab/contracts";
import { useEffect, useRef, useState } from "react";
import { mutationBlocks, objectiveBlocks } from "../api/blocks";

/** The pinned definitions whose published version carries a name worth reading. */
const READERS = {
  objective_block: objectiveBlocks,
  mutation_block: mutationBlocks,
} as const;

/** How a pin is looked up in what `usePinnedBlockNames` answers. */
export function blockPinKey(
  pin: Pick<ResolvedDefinitionSchema, "definition_type" | "definition_id" | "version">,
): string {
  return `${pin.definition_type}:${pin.definition_id}@${pin.version}`;
}

/**
 * Every name a version has answered with, for the life of the page.
 *
 * A published version is immutable, so its name is the same every time it is asked: going back
 * to the General tab, or opening another run that pins the same block, reads nothing again. Only
 * an answer is kept — a read that failed may succeed next time, and an aborted one said nothing.
 */
const PUBLISHED_NAMES = new Map<string, string>();

/**
 * The name each pinned block version was published under, read off the version itself.
 *
 * A run pins a scenario's blocks by identity and version only, so three objective blocks are
 * three *Objective block v1* until each is read. Each version is read once however often it is
 * pinned; a version that has not answered is absent, and one whose read failed is `null`, so a
 * caller falls back to the type it already shows rather than waiting. Every read in flight is
 * aborted when the surface goes or the pins it is asked about change, as `usePinnedVersions`
 * does, and an answer is only ever kept under its own version's key — here and in
 * `PUBLISHED_NAMES`, which a later mount reads before it asks.
 */
export function usePinnedBlockNames(
  pins: readonly ResolvedDefinitionSchema[],
): ReadonlyMap<string, string | null> {
  const [names, setNames] = useState<ReadonlyMap<string, string | null>>(
    () => new Map(PUBLISHED_NAMES),
  );
  // Every key asked for and not abandoned: answered, refused, or still in flight.
  const asked = useRef(new Set<string>());
  const wanted = pins.filter((pin) => Object.hasOwn(READERS, pin.definition_type));
  const keys = [...new Set(wanted.map(blockPinKey))].sort().join(" ");

  useEffect(() => {
    const controller = new AbortController();
    const inFlight = new Set<string>();
    for (const key of keys.split(" ")) {
      if (key === "" || asked.current.has(key)) {
        continue;
      }
      const known = PUBLISHED_NAMES.get(key);
      if (known !== undefined) {
        asked.current.add(key);
        setNames((current) =>
          current.get(key) === known ? current : new Map(current).set(key, known),
        );
        continue;
      }
      asked.current.add(key);
      inFlight.add(key);
      const colon = key.indexOf(":");
      const at = key.lastIndexOf("@");
      const reader = READERS[key.slice(0, colon) as keyof typeof READERS];
      reader
        .getVersion(key.slice(colon + 1, at), Number(key.slice(at + 1)), controller.signal)
        .then((published) => {
          inFlight.delete(key);
          PUBLISHED_NAMES.set(key, published.content.name);
          setNames((current) => new Map(current).set(key, published.content.name));
        })
        .catch(() => {
          // Refused or unreadable: settled, as unknown. An aborted read is not settled, and is
          // asked again by whichever run of this effect still wants it.
          if (!controller.signal.aborted) {
            inFlight.delete(key);
            setNames((current) => new Map(current).set(key, null));
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

  return names;
}
