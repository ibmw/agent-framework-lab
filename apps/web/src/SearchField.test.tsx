import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SearchField, SearchRow } from "./components/SearchField";
import { cardTitleClasses } from "./lib/ui";

/** The shape every index draws: the field, holding the page's own state. */
function Index({ label = "Search shops" }: { label?: string }) {
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState<string[]>([]);
  return (
    <>
      <SearchField
        label={label}
        onChange={(value) => {
          setQuery(value);
          setTyped((all) => [...all, value]);
        }}
        value={query}
      />
      <p data-testid="reported">{typed.join("|")}</p>
    </>
  );
}

describe("the search field", () => {
  /**
   * A placeholder is not a name. The prototype's own markup gives these boxes a placeholder
   * and nothing else, which leaves a reader who cannot see the grey text with a searchbox
   * called nothing. So the label is asserted as an **element**, bound by `for` to the id the
   * field generates, rather than only through the computed name — and the field is held to
   * carrying no `aria-label` papering over a missing one.
   */
  it("is named by a real label, bound to the field, and not by the words in the box", () => {
    render(<Index />);

    const box = screen.getByRole("searchbox", { name: "Search shops" });
    const label = screen.getByText("Search shops", { selector: "label" });

    expect(box.id).not.toBe("");
    expect(label).toHaveAttribute("for", box.id);
    expect(box).not.toHaveAttribute("aria-label");
  });

  /**
   * One prop writes the name and the face of the control, so a renamed field cannot keep an
   * old name — the rule `FilterChips` follows for the count in a chip's name. Read off two
   * different labels, so a component that hard-coded either could not pass both.
   */
  it.each(["Search shops", "Search by reference or customer"])(
    "writes %s both in the box and in the name",
    (label) => {
      render(<Index label={label} />);

      const box = screen.getByRole("searchbox", { name: label });

      expect(box).toHaveAttribute("placeholder", label);
      expect(screen.getByText(label, { selector: "label" })).toHaveTextContent(label);
    },
  );

  /** Visible to nobody and read by everybody: the label carries the workspace's own class. */
  it("keeps the label out of the layout the prototype has no room in", () => {
    render(<Index />);

    expect(screen.getByText("Search shops", { selector: "label" })).toHaveClass("sr-only");
  });

  /**
   * The glyph draws the word beside it, so it is hidden entirely — the rule `ButtonIcon` and
   * `FilterChips` follow, and the reason the assertions above can find the field by its words.
   */
  it("hides the magnifier from a reader and from the tab order", () => {
    const { container } = render(<Index />);

    const glyphs = container.querySelectorAll("svg");
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]).toHaveAttribute("aria-hidden", "true");
    expect(glyphs[0]).toHaveAttribute("focusable", "false");
  });

  /**
   * It narrows as it is typed rather than on a submit: every keystroke is reported, and the
   * field shows what was typed. Asserted over the whole sequence, so a field that only
   * reported on blur — or that debounced its way to one call — fails here.
   */
  it("reports every keystroke, so the list narrows as the word is typed", async () => {
    const user = userEvent.setup();
    render(<Index />);
    const box = screen.getByRole("searchbox", { name: "Search shops" });

    await user.type(box, "nort");

    expect(box).toHaveValue("nort");
    expect(screen.getByTestId("reported")).toHaveTextContent("n|no|nor|nort");
  });

  /** Nothing submits: the field stands on its own, outside any form. */
  it("is not wrapped in a form of its own", () => {
    const { container } = render(<Index />);

    expect(container.querySelector("form")).toBeNull();
  });
});

describe("the index card's header line", () => {
  /**
   * The prototype's header line: the card's title on the left and the search box opposite it,
   * in one row. Asserted as a heading one level under the page's `h1`, sharing its row with
   * the searchbox, and ahead of it in the document — so a title drawn elsewhere in the card,
   * or after the field, fails here.
   */
  it("draws the title as a heading beside the search box, before it", () => {
    render(
      <SearchRow title="Catalog">
        <Index label="Search products" />
      </SearchRow>,
    );

    const title = screen.getByRole("heading", { level: 2, name: "Catalog" });
    const box = screen.getByRole("searchbox", { name: "Search products" });
    const row = title.parentElement as HTMLElement;

    expect(row).toContainElement(box);
    expect(title.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row).toHaveClass("flex-wrap");
  });

  /**
   * Every card title in the workspace is the one `Card` spells, so the row is held to that
   * spelling rather than to a repeat of its numbers — and to no sans size beside it, which is
   * how a copy half-reverts.
   */
  it("titles the card the way every other card in the workspace is titled", () => {
    render(<SearchRow title="Order fixtures" />);

    const title = screen.getByRole("heading", { level: 2, name: "Order fixtures" });
    for (const className of cardTitleClasses.split(" ")) {
      expect(title).toHaveClass(className);
    }
    expect(title.className).not.toMatch(/\btext-(xs|sm|base|lg|xl)\b/);
  });

  /** A card is titled while its rows load: the title needs no field to stand beside. */
  it("keeps the title when there is no search box yet", () => {
    render(<SearchRow title="Built on this shop">{null}</SearchRow>);

    expect(screen.getByRole("heading", { level: 2, name: "Built on this shop" })).toBeVisible();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});
