import { screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";

/**
 * The way back an editor's header keeps in its one slot, held to be the create page's piece:
 * the ←, named "Back to {index}", and the "Index · kind" line above the page's title, both going
 * to the same place.
 *
 * Read off the page's own header, so the rail entry that shares the index's name is never the
 * link found. Returns the line, for what a page asks of it beyond its text.
 */
export async function expectWayBack(
  label: string,
  href: string,
  kind: string,
  /**
   * What the line must also say about the record after its kind, each read as written there —
   * the facts a description under the title used to carry.
   */
  ...detail: (string | RegExp)[]
): Promise<HTMLElement> {
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
  const line = crumb.parentElement as HTMLElement;
  expect(line).toHaveTextContent(`${label} · ${kind}`);
  for (const fact of detail) {
    await waitFor(() => expect(line, "the line above the title says it").toHaveTextContent(fact));
  }
  expectOneLine(header, line);

  // Above the title, not after it.
  for (const way of [arrow, crumb]) {
    expect(
      way.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the way back comes before the title",
    ).toBeTruthy();
  }
  return line;
}

/**
 * The line above the title is the header's one line (`Workspace.dc.html` :388–392): nothing in
 * the header is a second line of text about the record — no description under the title. What
 * else the header draws as a paragraph is the actions' own: the save state, which is a live
 * region, and the report under the actions.
 */
export function expectOneLine(header: HTMLElement, line: HTMLElement): void {
  const others = [...header.querySelectorAll("p")].filter(
    (paragraph) =>
      paragraph !== line &&
      paragraph.getAttribute("role") !== "status" &&
      paragraph.closest('[aria-label="What the actions report"]') === null,
  );
  expect(
    others.map((paragraph) => paragraph.textContent),
    "the header has no line but the one above the title",
  ).toEqual([]);
}
