import { Search } from "lucide-react";
import { type ReactNode, type Ref, useId } from "react";
import {
  cardTitleClasses,
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
 * one search in this workspace that does go to the server, on Experiment history, is the same
 * control inside that page's form: `onChange` there holds the words, and the form's *Search*
 * — or Enter in the box — submits them, so a keystroke still sends nothing. `inputRef` is for
 * that page too, whose *Clear filters* hands focus back to the box it emptied.
 */
export function SearchField({
  label,
  value,
  onChange,
  inputRef,
}: {
  /** What the field is called and what is written in it — "Search shops". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The input itself, for a page that has to move focus to it. */
  inputRef?: Ref<HTMLInputElement>;
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
        ref={inputRef}
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
 * The card's header line: the index's title, and the search box opposite it.
 *
 * The prototype draws every index card this way — a Georgia title on the left, the search box
 * pushed right by its own `margin-left:auto`, the chip row directly beneath — all eleven of
 * them, without exception. So the title is a prop of the row rather than a child a page may
 * forget: every index that draws this line draws it with a title, in the one card-title
 * style (`cardTitleClasses`, the `Card` header's), and the drift `ui/display-type` spent a
 * round removing from card titles cannot come back through here.
 *
 * The title is an `h2` because the page header holds the `h1` and every card title in this
 * workspace is the level under it. It says what the list *is* rather than repeating the page
 * title — *Catalog* under Products, *Order fixtures* under Orders — and it is drawn whatever
 * the listing's state: a card is titled while it loads and when it fails, and only the search
 * box, which can narrow nothing then, waits for the rows. That is why the field is `children`
 * and may be absent, and why a consumer that also draws an action on the line (Documents'
 * *New document*) passes it here too.
 *
 * The row wraps: at a narrow width the search box drops under the title, keeping the 180px
 * floor its own classes give it.
 */
export function SearchRow({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={searchFieldRowClasses}>
      <h2 className={cardTitleClasses}>{title}</h2>
      {children}
    </div>
  );
}
