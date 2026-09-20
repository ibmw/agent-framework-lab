import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SearchField } from "./components/SearchField";

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
