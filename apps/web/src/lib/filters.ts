import type { FilterChip, FilterChipDefinition, RowSearch } from "../components/FilterChips";

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
