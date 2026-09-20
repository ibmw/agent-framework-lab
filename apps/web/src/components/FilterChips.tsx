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
 * control that produces them (`docs/design-direction.md`, "the workspace refresh"), and a chip
 * that showed a number without narrowing the list when pressed would be that band again in a
 * smaller typeface — so the component takes no chip it cannot act on. Where this workspace
 * holds no figure for a subset the prototype draws, the chip is left off rather than rendered
 * inert; `docs/implementation-plan.md` UI-4 lists which, and why.
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

/**
 * The rows a search leaves, and the one definition of what "matches" means in this workspace.
 *
 * Case-insensitive on both sides and a substring rather than a prefix, which is what the
 * prototype does (`x.name.toLowerCase().includes(q)` over a trimmed, lower-cased needle) and
 * what an operator reaching for the middle of a slug expects. An empty or blank query narrows
 * nothing rather than matching nothing: a box someone cleared is a box that is not filtering.
 */
export function searchRows<RowT>(
  rows: readonly RowT[],
  search: RowSearch<RowT> | undefined,
): RowT[] {
  const needle = search?.query.trim().toLowerCase() ?? "";
  if (search === undefined || needle === "") {
    return [...rows];
  }
  return rows.filter((row) =>
    search.fields(row).some((field) => field.toLowerCase().includes(needle)),
  );
}

/**
 * The chips for a page and the rows the pressed one leaves, from one pass over one table.
 *
 * A count and the list under it are the same question asked twice, and the refresh's whole
 * claim for moving the figure onto the chip is that it is "the same figure read in the place
 * it can be acted on". So a page gets both from here rather than counting in one expression
 * and filtering in another: no index can say *Unfulfilled 3* over a list of two.
 *
 * **A chip counts the whole list; the search narrows only the rows.** This is the prototype's
 * answer, read off all eleven of its chip tables rather than assumed: `shopFilters` counts
 * `s.shopList` while the table renders the searched `shownShops`, `cusFilters` counts
 * `s.customerList`, `docFilters` counts `DOCUMENTS`, `prodFilters` is a constant, and the
 * other seven read their unsearched array the same way. So a count never moves as a word is
 * typed — it stays the answer to "how many of these are drafts?", which is a question about
 * the list and not about the word — and the search narrows what is under the chips.
 *
 * It is settled **here** and not per page for the reason the count lives on the chip at all:
 * the number and the rows come out of one call, so an index cannot say *Never published 2*
 * over a list the search has already cut to one and cannot decide the rule differently from
 * its neighbour. A page that wanted counts of the searched list would have to change this
 * function, in front of the seven tests that pin it — four in `FilterChips.test.tsx` and
 * three on a real index in `Orders.test.tsx`.
 */
export function filterList<Id extends string, RowT>(
  rows: readonly RowT[],
  definitions: readonly FilterChipDefinition<Id, RowT>[],
  selected: Id,
  search?: RowSearch<RowT>,
): { chips: FilterChip<Id>[]; visible: RowT[] } {
  const chips = definitions.map((entry) => ({
    id: entry.id,
    label: entry.label,
    kind: entry.kind,
    count: rows.filter(entry.matches).length,
  }));
  const pressed = definitions.find((entry) => entry.id === selected);
  const underChip = pressed === undefined ? rows : rows.filter(pressed.matches);
  return { chips, visible: searchRows(underChip, search) };
}
