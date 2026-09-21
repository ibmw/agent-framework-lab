import {
  type FilterChipKind,
  filterChipCountClasses,
  filterChipIcon,
  filterChipRowClasses,
  filterChipStateClasses,
  iconLeadingClasses,
} from "../lib/ui";

/**
 * One chip: the subset it selects, what to call it, which glyph says what kind of subset it
 * is, and how many rows are in it.
 *
 * `count` is a number rather than a string because the row renders it and the caller must not
 * be able to write one figure and filter by another — the whole point of this component is
 * that the number beside a label is the number that label produces.
 */
export interface FilterChip<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly kind: FilterChipKind;
  readonly count: number;
}

/**
 * The band of filter chips above a list index.
 *
 * Every chip filters. The refresh moves an index's counts out of a stat band and onto the
 * control that produces them (`docs/design-direction.md`, *Lists and counts*), and a chip
 * that showed a number without narrowing the list when pressed would be that band again in a
 * smaller typeface — so the component takes no chip it cannot act on. Where this workspace
 * holds no figure for a subset the prototype draws, the chip is left off rather than rendered
 * inert; `docs/history/workspace-refresh-pattern-slices.md` UI-4 lists which, and why.
 *
 * **The count is part of the name.** A chip whose number were visual only would announce as
 * "Unfulfilled, toggle button" and leave a reader who cannot see the row unable to tell a
 * subset with two orders in it from one with none. The name is set explicitly because content
 * alone will not carry it: an accessible name is the element's children run together, and the
 * gap between the label and the number is a flex `gap` rather than a character, so the
 * computed name is "Never published2". The `aria-label` is exactly the visible reading, label
 * then number, so it remains what a voice-control reader would say and what a spec clicks by.
 *
 * That is also why a zero chip is neither hidden nor disabled: the prototype draws all of its
 * chips unconditionally with `String(count)`, and "Never published 0" is the answer to a
 * question an operator asked, where a chip that vanished at zero would leave them to infer it.
 *
 * **Pressed, not tabs.** `aria-pressed` is what the two filter rows in this workspace already
 * use, and it says the right thing: these are toggles over one list, not a tablist whose
 * panels the arrow keys move between.
 */
export function FilterChips<Id extends string>({
  legend,
  chips,
  selected,
  onSelect,
}: {
  /** Names the group for a reader who reaches it out of context — "Filter orders". */
  legend: string;
  chips: readonly FilterChip<Id>[];
  selected: Id;
  onSelect: (id: Id) => void;
}) {
  return (
    <fieldset className={filterChipRowClasses}>
      <legend className="sr-only">{legend}</legend>
      {chips.map((chip) => {
        const on = chip.id === selected;
        const Glyph = filterChipIcon[chip.kind];
        return (
          <button
            key={chip.id}
            type="button"
            // Measured, not assumed, and kept: with the count as plain content the computed
            // name came out "Never published2", because the gap between the label and the
            // number is a flex `gap` and not a character. A whitespace text node between them
            // would also give "Never published 2" — an anonymous flex item is not laid out, so
            // it costs no width — but that leans on a rule holding identically in jsdom and in
            // every browser, where this is exact and the spec below pins it to `textContent`.
            aria-label={`${chip.label} ${chip.count}`}
            aria-pressed={on}
            onClick={() => onSelect(chip.id)}
            className={on ? filterChipStateClasses.selected : filterChipStateClasses.unselected}
          >
            {/* The prototype nests two opacities: its `filterIcon` draws the svg at 0.9, and
                an unselected chip wraps it in a span at 0.55. 90% and 50% are those two
                renderings — 0.55 × 0.9 is 0.495 — rather than the two numbers read off the
                markup separately. */}
            <Glyph
              aria-hidden="true"
              className={`${iconLeadingClasses} ${on ? "opacity-90" : "opacity-50"}`}
              focusable="false"
              strokeWidth={1.8}
            />
            {chip.label}
            <span className={filterChipCountClasses}>{chip.count}</span>
          </button>
        );
      })}
    </fieldset>
  );
}

/**
 * One subset of a list, as the page declares it: what to call it, which glyph says what kind
 * of subset it is, and the predicate that selects it.
 */
export interface FilterChipDefinition<Id extends string, RowT> {
  readonly id: Id;
  readonly label: string;
  readonly kind: FilterChipKind;
  readonly matches: (row: RowT) => boolean;
}

/**
 * What an index searches by: the word the operator typed, and the text of a row it is looked
 * for in. A page names its own fields — the prototype names them index by index, and they are
 * what that index's placeholder promises.
 */
export interface RowSearch<RowT> {
  /** Exactly what is in the box, untrimmed; this is the caller's state, not a derived one. */
  readonly query: string;
  /** The row's searchable text. Empty strings are harmless and need no filtering out. */
  readonly fields: (row: RowT) => readonly string[];
}
