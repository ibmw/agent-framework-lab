import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card, PageHeader } from "./components/WorkspaceChrome";

/**
 * The workspace's display type, measured.
 *
 * Two headings carry it and nothing in the browser can see whether they still do: a title that
 * silently returns to the sans stack renders perfectly, passes every journey, and is simply the
 * wrong typeface for however long it takes someone to notice. So the numbers are asserted here
 * against `tmp/design-frames/README.md`, *Type* — page titles Georgia 24–27px 700, card titles
 * Georgia 17–18px 700 — and against the prototype for where in each range this workspace's one
 * `PageHeader` and one `Card` land.
 *
 * The two structural facts the type must not disturb are held down in the same queries: the page
 * name is the `h1` the first step of every tour anchors on through `data-tour="page-name"`, and a
 * card's title is an `h2`. Type changes neither.
 */

describe("the page title", () => {
  it("is the level-1 heading the tour anchors on", () => {
    render(<PageHeader title="Tone of voice" />);

    const title = screen.getByRole("heading", { level: 1, name: "Tone of voice" });

    expect(title).toHaveAttribute("data-tour", "page-name");
  });

  it("is drawn in the display face at the prototype's 24px", () => {
    render(<PageHeader title="Tone of voice" />);

    const title = screen.getByRole("heading", { level: 1 });

    expect(title.className).toContain("font-display");
    expect(title.className).toContain("text-2xl");
    expect(title.className).toContain("font-bold");
    expect(title.className).toContain("tracking-[-0.015em]");
    // A size left beside the new one is the shape a half-revert takes; `text-2xl` is not one of
    // the words below, so this holds the title to exactly one size.
    expect(title.className).not.toMatch(/\btext-(xs|sm|base|lg|xl)\b/);
  });
});

describe("a card's title", () => {
  it("is a level-2 heading in the display face at the prototype's 17px", () => {
    render(<Card title="Draft validation">body</Card>);

    const title = screen.getByRole("heading", { level: 2, name: "Draft validation" });

    expect(title.className).toContain("font-display");
    expect(title.className).toContain("text-[17px]");
    expect(title.className).toContain("font-bold");
    expect(title.className).toContain("tracking-[-0.01em]");
    expect(title.className).not.toMatch(/\btext-(xs|sm|base|lg|xl)\b/);
  });
});
