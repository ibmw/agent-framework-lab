import { screen, within } from "@testing-library/react";
import { expect } from "vitest";

/**
 * The index card a page draws, found by the title its `SearchRow` gives it — the one region
 * an index's rows, chips, empty state and failure all live in.
 */
export function indexCard(title: string): HTMLElement {
  const card = screen.getByRole("heading", { level: 2, name: title }).closest("section");
  expect(card, `the card titled ${title}`).not.toBeNull();
  return card as HTMLElement;
}

/**
 * A record's publication, drawn as the index draws it: the word in a pill, beside the dot that
 * names the axis and is hidden from a reader, on the fill of its state — never the colour
 * alone (`docs/design-direction.md`, *Principles*).
 */
export function expectPublicationPill(
  scope: HTMLElement,
  word: string,
  state: "published" | "never published",
) {
  const pill = within(scope).getByText(word);
  const glyph = pill.firstElementChild;
  expect(glyph, `the glyph beside ${word}`).not.toBeNull();
  expect(glyph).toHaveAttribute("aria-hidden");
  expect(glyph).toHaveTextContent("●");
  expect(pill).toHaveClass(state === "published" ? "bg-admin-published" : "bg-admin-border");
  expect(pill).not.toHaveClass(state === "published" ? "bg-admin-border" : "bg-admin-published");
}

/**
 * The create glyph on a *New X*: the plus `ButtonIcon verb="create"` draws, hidden from a
 * reader and from the tab order, so the control's name is still its words alone.
 */
export function expectCreateGlyph(control: HTMLElement, name: string) {
  const glyph = control.querySelector("svg");
  expect(glyph, `the glyph on ${name}`).not.toBeNull();
  expect(glyph).toHaveClass("lucide-plus");
  expect(glyph).toHaveAttribute("aria-hidden", "true");
  expect(glyph).toHaveAttribute("focusable", "false");
  expect(control).toHaveAccessibleName(name);
}
