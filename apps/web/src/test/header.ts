import { screen, within } from "@testing-library/react";
import { expect } from "vitest";

/**
 * The way back an editor's header keeps in its one slot, held to be the create page's piece:
 * the ←, named "Back to {index}", and the "Index · kind" line above the page's title, both going
 * to the same place.
 *
 * Read off the page's own header, so the rail entry that shares the index's name is never the
 * link found.
 */
export async function expectWayBack(label: string, href: string, kind: string): Promise<void> {
  const title = await screen.findByRole("heading", { level: 1 });
  const header = title.closest("header");
  if (header === null) {
    throw new Error("the page's title is not in a header");
  }
  const arrow = await within(header).findByRole("link", { name: `Back to ${label}` });
  expect(arrow, "the ← goes back").toHaveAttribute("href", href);
  expect(arrow).toHaveTextContent("←");

  const crumb = within(header).getByRole("link", { name: label });
  expect(crumb, "the line above the title goes to the same place").toHaveAttribute("href", href);
  expect(crumb.parentElement).toHaveTextContent(`${label} · ${kind}`);

  // Above the title, not after it and not in the description under it.
  for (const way of [arrow, crumb]) {
    expect(
      way.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the way back comes before the title",
    ).toBeTruthy();
  }
}
