/**
 * Stable identifiers for the keyed entries inside a definition payload.
 *
 * Entry IDs are content, not identity: they key the change summary and, for addresses, the
 * provenance label an order's frozen copy carries. They are derived once when an entry is
 * created and never rewritten, so relabelling an entry cannot orphan an existing reference.
 */

export function slugify(value: string | null | undefined, fallback = "entry"): string {
  return (
    (value ?? "")
      .toLowerCase()
      .normalize("NFD")
      // Strip combining marks so "Écoles" and "Ecoles" produce the same slug.
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}

/**
 * Uppercase kebab from the product handle and the chosen option values, for example
 * `ALPINE-SHELL-JACKET-OCEAN-BLUE-M`. Missing option values are skipped.
 */
export function variantSku(
  handle: string,
  optionValues: readonly (string | null | undefined)[],
): string {
  const parts = [handle, ...optionValues]
    .map((part) => slugify(part, "").toUpperCase())
    .filter(Boolean);
  return parts.join("-");
}

/**
 * `MAX_SLUG_LENGTH` in `domain/content.py`: the cap `require_slug` puts on every kebab-case
 * identifier a definition stores (a handle, a slug, an entry ID) and on a SKU alike.
 */
export const SLUG_MAX_LENGTH = 64;

/** Cut to `room` characters, never leaving the trailing hyphen every slug pattern refuses. */
export function clampSlug(value: string, room: number): string {
  return value.length <= room ? value : value.slice(0, room).replace(/-+$/, "");
}

/**
 * The first free value of `base` within `max` characters. Two entries may legitimately
 * share a label; their IDs may not.
 *
 * Clamped *before* it is compared, and every suffixed candidate clamped again with room left
 * for its suffix, so the answer is both free and within the cap. Uniquifying first and
 * clamping afterwards can hand back a value that is free at 70 characters and taken at 64,
 * and a base derived from a long title or label would otherwise be refused with the whole
 * draft. A base already within the cap is answered exactly as before: itself, or `base-2`,
 * `base-3`, ... while those fit.
 */
export function uniqueId(
  base: string,
  taken: readonly string[],
  max: number = SLUG_MAX_LENGTH,
): string {
  if (!base) {
    return "";
  }
  let candidate = clampSlug(base, max);
  let suffix = 2;
  while (taken.includes(candidate)) {
    const tail = `-${suffix}`;
    candidate = `${clampSlug(base, max - tail.length)}${tail}`;
    suffix += 1;
  }
  return candidate;
}

/**
 * The free id within `max` and, when the clamped base itself was taken, that clamped base —
 * so the field can say why. `takenBase` is what the base is stored as, not the longer text
 * it was cut from.
 */
export function uniqueSuggestion(
  base: string,
  taken: readonly string[],
  max: number = SLUG_MAX_LENGTH,
): { value: string; takenBase?: string } {
  const value = uniqueId(base, taken, max);
  const clamped = clampSlug(base, max);
  if (clamped && value !== clamped) {
    return { value, takenBase: clamped };
  }
  return { value };
}

/** The derived SKU, made free within the cap. */
export function uniqueVariantSku(
  handle: string,
  optionValues: readonly (string | null | undefined)[],
  taken: readonly string[],
): { value: string; takenBase?: string } {
  return uniqueSuggestion(variantSku(handle, optionValues), taken);
}

/**
 * The next free business reference for a prefix (`NS-10483`, `T-2042`).
 *
 * Sibling of `uniqueId`: that suffixes a slug (`alpine-shell-jacket-2`); this increments the
 * numbered series a shop already quotes. References that do not match `{prefix}-{digits}`
 * are ignored, so `NS-ABC` does not steal the next `NS-n`.
 *
 * Unlike `uniqueId` it does not clamp, because cutting the prefix would break the
 * `seriesPrefix` lookup; a reference over 64 characters is refused by the backend with a 422
 * instead.
 */
export function nextReference(prefix: string, taken: readonly string[]): string {
  if (!prefix) {
    return "";
  }
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}-(\\d+)$`);
  let max = 0;
  for (const value of taken) {
    const match = pattern.exec(value);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `${prefix}-${max + 1}`;
}

/**
 * The uppercase prefix a new shop's first order takes from its name: "Harbour Lane Supply"
 * becomes `HLS`. Once a shop already quotes references, `seriesPrefix` continues that series
 * instead — Northstar's `NS-10482` stays `NS`, even though the name's initials are `NO`.
 * Ticket references use a fixed `T`.
 */
export function referencePrefix(name: string, fallback = "REF"): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return initials || fallback;
}

/**
 * The prefix of the numbered series the shop already quotes, or `fallback`.
 *
 * Chosen by how many `{prefix}-{digits}` references use that prefix (the series the
 * shop is actually in). A tie takes the prefix whose most recent occurrence is last
 * in the list. `^(.*)-(\\d+)$` is greedy, so `FOO-BAR-3` is the `FOO-BAR` series.
 */
export function seriesPrefix(taken: readonly string[], fallback: string): string {
  const series = new Map<string, { count: number; lastIndex: number }>();
  taken.forEach((value, index) => {
    const match = /^(.*)-(\d+)$/.exec(value);
    if (!match) {
      return;
    }
    const prefix = match[1];
    const previous = series.get(prefix);
    series.set(prefix, { count: (previous?.count ?? 0) + 1, lastIndex: index });
  });
  let bestPrefix = fallback;
  let bestCount = 0;
  let bestIndex = -1;
  for (const [prefix, { count, lastIndex }] of series) {
    if (count > bestCount || (count === bestCount && lastIndex > bestIndex)) {
      bestPrefix = prefix;
      bestCount = count;
      bestIndex = lastIndex;
    }
  }
  return bestPrefix;
}
