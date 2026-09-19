import { type ButtonVerb, buttonIcon, iconLeadingClasses } from "../lib/ui";

/**
 * The glyph a button leads with.
 *
 * A button says what it does in words; the glyph repeats that in a drawing, so it is hidden
 * from assistive technology entirely. Nothing here may reach an accessible name: two hundred
 * unit assertions and the Playwright journeys find their controls by the name the button
 * already had, and a glyph that announced itself would rename every one of them. Hence
 * `aria-hidden`, and `focusable="false"` so the drawing is not a tab stop of its own.
 *
 * The caller names a verb, never an icon — `lib/ui.ts` holds the one table that pairs the two.
 */
export function ButtonIcon({ verb }: { verb: ButtonVerb }) {
  const Glyph = buttonIcon[verb];
  return (
    <Glyph aria-hidden="true" className={iconLeadingClasses} focusable="false" strokeWidth={1.8} />
  );
}
