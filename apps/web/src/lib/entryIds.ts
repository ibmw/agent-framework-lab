/**
 * Stable identifiers for the keyed entries inside a definition payload.
 *
 * Entry IDs are content, not identity: they key the change summary and, for addresses, the
 * provenance label an order's frozen copy carries. They are derived once when an entry is
 * created and never rewritten, so relabelling an entry cannot orphan an existing reference.
 */

export function slugify(value: string, fallback = "entry"): string {
  return (
    value
      .toLowerCase()
      .normalize("NFD")
      // Strip combining marks so "Écoles" and "Ecoles" produce the same slug.
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}

/** Two entries may legitimately share a label; their IDs may not. */
export function uniqueId(base: string, taken: readonly string[]): string {
  let candidate = base;
  let suffix = 2;
  while (taken.includes(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}
