import { Fragment, type ReactNode } from "react";

/**
 * The characters an identifier is read in parts at: a module, a tool, a path, a line.
 *
 * Not `_`: it joins the words of one name ("propose_address_change"), and a break after it
 * splits the name between its own words, which reads as two names.
 */
const SEPARATORS = /([./:·])/;

/**
 * An identifier that may wrap at its own joints and nowhere else.
 *
 * A dotted tool name, a snake-cased symbol or a project path is one unbroken word to a browser,
 * so a narrow column either clips it or, under `overflow-wrap: anywhere`, splits it mid-word
 * ("propose_address_chang|e"). A `<wbr>` after each separator offers the line break where a
 * reader would make it. It adds no character, so the text, and any accessible name read off
 * it, is exactly the identifier. A caller keeps `overflow-wrap: anywhere` beside it as the
 * last resort for a part with no joint that is still wider than its column — a hex id, a
 * long snake-cased name — which only applies where no `<wbr>` fits.
 */
export function breakable(text: string): ReactNode {
  const parts = text.split(SEPARATORS);
  return parts.map((part, index) =>
    SEPARATORS.test(part) ? (
      // The parts never reorder, so their position is a stable key.
      // biome-ignore lint/suspicious/noArrayIndexKey: see above
      <Fragment key={index}>
        {part}
        <wbr />
      </Fragment>
    ) : (
      part
    ),
  );
}
