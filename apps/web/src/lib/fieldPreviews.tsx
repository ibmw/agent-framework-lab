import type { ReactNode } from "react";

/**
 * How a derived identifier previews the value it will be saved under.
 *
 * It reads as content rather than as a component, because a field hint takes a `ReactNode` and
 * every caller hands it one: it is the `alreadyTakenMessage` of `lib/fieldRules.ts` with a
 * `<code>` in it, and lives in its own module only because that `<code>` makes it JSX.
 */
export function savedAsPreview(id: string): ReactNode {
  return (
    <>
      Saved as <code className="font-mono">{id}</code>.
    </>
  );
}
