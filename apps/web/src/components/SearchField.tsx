import { Search } from "lucide-react";
import { type ReactNode, useId } from "react";
import {
  searchFieldClasses,
  searchFieldIconClasses,
  searchFieldRowClasses,
  searchFieldWrapClasses,
} from "../lib/ui";

/**
 * The search box an index draws over its list.
 *
 * **One string names it and is written in it.** The prototype gives every one of its eleven
 * search boxes a placeholder and no label — `Search shops`, `Search by reference or customer`,
 * `Search the library` — which leaves a reader who cannot see the grey text with a textbox
 * called nothing, and a reader using voice control with nothing to say. So the same words are
 * also a real `<label>`, `sr-only` because the prototype's header line has no room for a
 * visible one and every pixel of that line is drawn. It is one prop rather than two so that
 * the name and the face of the control cannot drift — the rule `FilterChips` follows for the
 * count in a chip's name.
 *
 * `Search <thing>` is the convention, and the thing is the page's own word for a row: the
 * prototype writes the noun where one will do and the fields where it will not (*Search by
 * reference or customer*), and each consumer passes what that index's own search matches.
 *
 * **The magnifier is a drawing of the word beside it.** `aria-hidden` and out of the tab
 * order, as every glyph in this workspace is; the prototype paints it as a background image,
 * which is the same decision made by other means. It is `pointer-events-none` so the whole
 * field, glyph included, is one click target for the input underneath.
 *
 * **It searches as it is typed**, which is what the prototype does and what an index full of
 * rows already in the browser can afford — there is no request behind a keystroke here. The
 * one search in this workspace that does go to the server, on Experiment history, is
 * submitted rather than typed and is not this control.
 */
export function SearchField({
  label,
  value,
  onChange,
}: {
  /** What the field is called and what is written in it — "Search shops". */
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className={searchFieldWrapClasses}>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <Search
        aria-hidden="true"
        className={searchFieldIconClasses}
        focusable="false"
        strokeWidth={2}
      />
      <input
        className={searchFieldClasses}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        // A `searchbox` rather than a `textbox`: it is the role the control has, it is what a
        // reader is told they have landed in, and it is what a spec reaches for it by. The
        // prototype draws a plain text input; this is the semantic that drawing implies.
        //
        // What it brings with it is refused rather than inherited. Tailwind's preflight
        // resets `::-webkit-search-decoration` and sets no `appearance` on `[type=search]`,
        // so WebKit keeps `-webkit-appearance: searchfield`: a native clear × once there is
        // text — absent from the prototype, unreachable by keyboard, and unnamed to a reader
        // — and, on older Safari, a native box that can overrule the radius and padding
        // above. `searchFieldClasses` therefore carries `appearance-none` and drops the
        // cancel button, so what is drawn is what this file draws.
        type="search"
        value={value}
      />
    </div>
  );
}

/**
 * The row the search box sits in, at the top of the card and above the filter chips.
 *
 * The prototype puts it in the card's **header line**, right-aligned opposite the card's
 * title, with the chip row directly beneath — all eleven of them, without exception. Only one
 * index in this workspace has a title to sit opposite: the shops table, which passes its `h2`
 * in here as a child and gets the prototype's line exactly. The other nine pass the field
 * alone, and the row is then the same corner of the same card, in the same order relative to
 * the chips, ruled off from them the way a header is.
 *
 * It takes children rather than a field, so the one card with a title and the nine without
 * draw one row and not two spellings of it — the drift `ui/display-type` spent a round
 * removing from card titles.
 */
export function SearchRow({ children }: { children: ReactNode }) {
  return <div className={searchFieldRowClasses}>{children}</div>;
}
