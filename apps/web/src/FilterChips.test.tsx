import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { type FilterChipDefinition, FilterChips } from "./components/FilterChips";
import { SearchField } from "./components/SearchField";
import { filterList, searchRows } from "./lib/filters";

interface Row {
  readonly name: string;
  readonly published: boolean;
}

type Filter = "all" | "published" | "draft";

const FILTERS: FilterChipDefinition<Filter, Row>[] = [
  { id: "all", label: "All", kind: "all", matches: () => true },
  { id: "published", label: "Published", kind: "published", matches: (row) => row.published },
  { id: "draft", label: "Never published", kind: "draft", matches: (row) => !row.published },
];

const ROWS: Row[] = [
  { name: "Northstar Outfitters", published: true },
  { name: "Harbour Lane Supply", published: false },
  { name: "Rivermouth Goods", published: false },
];

/** The shape every index draws: the chips above, the rows the pressed one leaves below. */
function Index({ rows = ROWS }: { rows?: Row[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const { chips, visible } = filterList(rows, FILTERS, filter);
  return (
    <>
      <FilterChips legend="Filter shops" chips={chips} selected={filter} onSelect={setFilter} />
      <ul>
        {visible.map((row) => (
          <li key={row.name}>{row.name}</li>
        ))}
      </ul>
    </>
  );
}

function chipRow() {
  return within(screen.getByRole("group", { name: "Filter shops" }));
}

describe("the filter chip row", () => {
  it("puts each chip's count in the name it is announced and clicked by", () => {
    render(<Index />);

    expect(chipRow().getByRole("button", { name: "All 3" })).toBeVisible();
    expect(chipRow().getByRole("button", { name: "Published 1" })).toBeVisible();
    expect(chipRow().getByRole("button", { name: "Never published 2" })).toBeVisible();
  });

  it("narrows the list to what the pressed chip counted", async () => {
    const user = userEvent.setup();
    render(<Index />);

    await user.click(chipRow().getByRole("button", { name: "Never published 2" }));

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Harbour Lane Supply")).toBeVisible();
    expect(screen.queryByText("Northstar Outfitters")).toBeNull();
  });

  /**
   * The whole reason the count sits on the chip rather than in a band above it: the figure a
   * reader sees is the figure pressing it produces. Read off the rendered names rather than
   * restated, so a page that counted one predicate and filtered by another would fail here.
   */
  it.each(FILTERS.map((entry) => entry.label))(
    "leaves exactly as many rows as %s claims",
    async (label) => {
      const user = userEvent.setup();
      render(<Index />);
      const chip = chipRow().getByRole("button", { name: new RegExp(`^${label} \\d+$`) });
      const claimed = Number(/\d+$/.exec(chip.textContent ?? "")?.[0]);

      await user.click(chip);

      expect(screen.queryAllByRole("listitem")).toHaveLength(claimed);
    },
  );

  it("says which chip is pressed, and moves that as the reader presses another", async () => {
    const user = userEvent.setup();
    render(<Index />);
    const all = chipRow().getByRole("button", { name: "All 3" });
    const drafts = chipRow().getByRole("button", { name: "Never published 2" });

    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(drafts).toHaveAttribute("aria-pressed", "false");

    await user.click(drafts);

    expect(all).toHaveAttribute("aria-pressed", "false");
    expect(drafts).toHaveAttribute("aria-pressed", "true");
  });

  /**
   * The prototype draws every chip unconditionally with its number, so a subset that is empty
   * says so rather than disappearing. A chip that vanished at zero would leave a reader to
   * infer the answer from an absence, and would move the row's other chips under their cursor.
   */
  it("draws a chip nothing matches, and lets it be pressed", async () => {
    const user = userEvent.setup();
    render(<Index rows={[{ name: "Harbour Lane Supply", published: false }]} />);
    const published = chipRow().getByRole("button", { name: "Published 0" });

    expect(published).toBeEnabled();
    await user.click(published);

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(published).toHaveAttribute("aria-pressed", "true");
  });

  /**
   * The glyph repeats the label in a drawing, so it is hidden entirely — the same rule
   * `ButtonIcon` follows, and the reason every assertion above can find a chip by its words.
   */
  it("hides every glyph from a reader and from the tab order", () => {
    render(<Index />);

    const glyphs = screen
      .getByRole("group", { name: "Filter shops" })
      .querySelectorAll("button svg");
    expect(glyphs).toHaveLength(FILTERS.length);
    for (const glyph of glyphs) {
      expect(glyph).toHaveAttribute("aria-hidden", "true");
      expect(glyph).toHaveAttribute("focusable", "false");
    }
  });

  /**
   * The name is set explicitly, so it has to be held to the words on the chip: a reader using
   * voice control says what they can see, and a name that had drifted from the face of the
   * control would leave them with nothing to say. Read off the rendered text rather than
   * restated, so a relabelled chip cannot keep an old name.
   */
  it("names every chip by what is written on it, glyph excluded", () => {
    render(<Index />);

    for (const chip of chipRow().getAllByRole("button")) {
      const written = chip.textContent?.trim();
      expect(written).not.toBe("");
      expect(chip.getAttribute("aria-label")).toBe(written?.replace(/(\D)(\d+)$/, "$1 $2"));
    }
  });

  /**
   * A listing that carries no figure for a subset — Experiment history's statuses, whose
   * payload is one narrowed page and a total — passes `count: null`, and the chip is its
   * label alone: no number drawn, none announced, and still a chip that filters.
   */
  it("names a chip without a count by its label alone, and draws no figure", async () => {
    const user = userEvent.setup();
    const pressed: string[] = [];
    render(
      <FilterChips
        legend="Filter by status"
        chips={[
          { id: "all", label: "All", kind: "all", count: null },
          { id: "failed", label: "Failed", kind: "attention", count: null },
        ]}
        selected="all"
        onSelect={(id) => pressed.push(id)}
      />,
    );
    const row = within(screen.getByRole("group", { name: "Filter by status" }));

    const failed = row.getByRole("button", { name: "Failed" });
    expect(failed).toHaveAttribute("aria-label", "Failed");
    expect(failed).toHaveTextContent(/^Failed$/);
    expect(failed.querySelector(".tabular-nums")).toBeNull();
    expect(row.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");

    await user.click(failed);

    expect(pressed).toEqual(["failed"]);
  });
});

/** The same index, with the search box the eleven searchable ones draw over their chips. */
function SearchableIndex({ rows = ROWS }: { rows?: Row[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const { chips, visible } = filterList(rows, FILTERS, filter, {
    query,
    fields: (row) => [row.name],
  });
  return (
    <>
      <SearchField label="Search shops" onChange={setQuery} value={query} />
      <FilterChips legend="Filter shops" chips={chips} selected={filter} onSelect={setFilter} />
      <ul>
        {visible.map((row) => (
          <li key={row.name}>{row.name}</li>
        ))}
      </ul>
      {visible.length === 0 ? <p>No shop matches this view.</p> : null}
    </>
  );
}

function searchBox() {
  return screen.getByRole("searchbox", { name: "Search shops" });
}

/**
 * The question UI-6 had to settle, settled here and once: **a chip counts the whole list and
 * the search narrows only the rows**.
 *
 * It is the prototype's own answer, censused rather than assumed — every one of its eleven
 * chip tables counts the unsearched array (`shopFilters` reads `s.shopList` while the table
 * renders the searched `shownShops`, `cusFilters` reads `s.customerList`, `docFilters` reads
 * `DOCUMENTS`, `prodFilters` is a constant, and the other seven do the same). A count that
 * moved as a word was typed would stop answering "how many of these are drafts?", which is a
 * question about the list and not about the word.
 *
 * Because `filterList` returns both from one call, a page cannot wire the two rules
 * differently: these assertions hold for every index that adopts it.
 */
describe("a search over a filtered list", () => {
  it("leaves every count exactly where it was, whatever is typed", async () => {
    const user = userEvent.setup();
    render(<SearchableIndex />);
    const before = chipRow()
      .getAllByRole("button")
      .map((chip) => chip.textContent);

    await user.type(searchBox(), "harbour");

    // The search did something — otherwise the assertion below could not fail.
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(
      chipRow()
        .getAllByRole("button")
        .map((chip) => chip.textContent),
    ).toEqual(before);
    expect(chipRow().getByRole("button", { name: "All 3" })).toBeVisible();
    expect(chipRow().getByRole("button", { name: "Never published 2" })).toBeVisible();
  });

  it("narrows what the pressed chip left, not the whole list", async () => {
    const user = userEvent.setup();
    render(<SearchableIndex />);

    await user.click(chipRow().getByRole("button", { name: "Published 1" }));
    await user.type(searchBox(), "harbour");

    // Harbour Lane Supply matches the word and is not published, so the pressed chip holds.
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("No shop matches this view.")).toBeVisible();
  });

  it("leaves the operator a sentence rather than a blank card", async () => {
    const user = userEvent.setup();
    render(<SearchableIndex />);

    await user.type(searchBox(), "no-such-shop");

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("No shop matches this view.")).toBeVisible();
  });

  it("hands the whole list back when the box is emptied", async () => {
    const user = userEvent.setup();
    render(<SearchableIndex />);
    await user.type(searchBox(), "harbour");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    await user.clear(searchBox());

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});

/**
 * What "matches" means, asserted on the function rather than through a page: one definition
 * for the whole workspace, so two indexes cannot disagree about whether a word in the middle
 * of a slug counts.
 */
describe("the search itself", () => {
  const rows = [{ name: "Northstar Outfitters", published: true }];
  const over = (query: string) => searchRows(rows, { query, fields: (row) => [row.name] });

  it("matches inside a value and ignores case on both sides", () => {
    expect(over("STAR")).toHaveLength(1);
    expect(over("outfit")).toHaveLength(1);
    expect(over("northstar outfitters")).toHaveLength(1);
  });

  it("matches nothing the word is not in", () => {
    expect(over("harbour")).toHaveLength(0);
  });

  it("narrows nothing at all for a box that is empty or holds only spaces", () => {
    expect(over("")).toHaveLength(1);
    expect(over("   ")).toHaveLength(1);
    expect(searchRows(rows, undefined)).toHaveLength(1);
  });

  it("looks in every field the index named, not only the first", () => {
    const found = searchRows(rows, {
      query: "published",
      fields: (row) => [row.name, row.published ? "published" : "draft"],
    });

    expect(found).toHaveLength(1);
  });
});
