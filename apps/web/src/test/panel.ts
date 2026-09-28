import { expect } from "vitest";
import { editorColumnsClasses, editorMainClasses, editorPanelClasses } from "../lib/ui";

/**
 * The side panel a card stands in, held to be an editor's: the second column of the reference
 * grid (`ShopSetupPages.tsx`), beside a main column at most 790px wide.
 */
export function sidePanel(card: HTMLElement): HTMLElement {
  const panel = card.parentElement as HTMLElement;
  expect(panel.className, "the card stands in the editor's side panel").toBe(editorPanelClasses);
  const grid = panel.parentElement as HTMLElement;
  expect(grid.className, "the panel is a column of the reference grid").toBe(editorColumnsClasses);
  expect(grid.children, "the grid holds the cards and the panel, in that order").toHaveLength(2);
  expect(grid.children[0].className).toBe(editorMainClasses);
  expect(grid.children[1]).toBe(panel);
  return panel;
}

/** The panel's cards, top to bottom, by the name each is reached by. */
export function panelCards(panel: HTMLElement): (string | null)[] {
  return Array.from(panel.children).map((card) => card.getAttribute("aria-label"));
}

/** The main column's cards, top to bottom, beside the panel. */
export function mainCards(panel: HTMLElement): (string | null)[] {
  const main = panel.parentElement?.children[0] as HTMLElement;
  return Array.from(main.children).map((card) => card.getAttribute("aria-label"));
}

/**
 * Every control in the panel that could hold a value of the draft. The panel holds none: its
 * cards are the gate, context read off the draft and what publishing freezes.
 *
 * Read off the elements rather than their roles, because a date, a time, a file or a colour
 * input has no role a query could name, and the order and customer editors hold dates.
 */
const FIELD_SELECTOR = [
  "input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset])",
  "select",
  "textarea",
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(", ");

export function panelFields(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FIELD_SELECTOR));
}
