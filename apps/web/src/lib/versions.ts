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

/** What an index row knows of a definition's publication, as every listing carries it. */
export interface PublicationRecord {
  latest_published_version: number | null;
  published_version_count: number;
}

/**
 * A record's publication in the index's words: "v3 · 2 versions", or "Never published".
 *
 * The prototype's own `versionLabel` (`Workspace.dc.html` :5814, :6233, :6271, :6399), which
 * counts in the singular for one version; the indexes used to write "version(s)" whatever the
 * count. *Never published* is the one name every index gives a definition with no published
 * version (`docs/design-direction.md`, *Names*).
 */
export function publicationLabel(record: PublicationRecord): string {
  if (record.latest_published_version === null) {
    return "Never published";
  }
  const count = record.published_version_count;
  return `v${record.latest_published_version} · ${count} ${count === 1 ? "version" : "versions"}`;
}
