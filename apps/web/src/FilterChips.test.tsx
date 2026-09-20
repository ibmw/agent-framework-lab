import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { type FilterChipDefinition, FilterChips, filterList } from "./components/FilterChips";

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
});
