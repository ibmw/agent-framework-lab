import type { DefinitionVersionSummarySchema } from "@agent-lab/contracts";

/**
 * The newest of a definition's published versions, or null where it has none — what every
 * version select opens on (ADR 0064).
 *
 * Computed rather than read off an end of the list: the contract does not promise an order,
 * and the server happens to send newest-first, which `at(-1)` would read as oldest.
 */
export function newestVersion(versions: readonly DefinitionVersionSummarySchema[]): number | null {
  return versions.reduce<number | null>(
    (newest, published) =>
      newest === null || published.version > newest ? published.version : newest,
    null,
  );
}

/** A version as a select offers it: the newest says so, since that is what it opens on. */
export function versionOptionLabel(version: number, newest: number | null): string {
  return version === newest ? `v${version} (newest published)` : `v${version}`;
}
