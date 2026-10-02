import { screen, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";

/**
 * The reads the two workspace shells make on every page they draw (ADR 0056).
 *
 * The shop's shell and the lab's shell each hold the listings their rail counts, so every
 * suite that renders a page inside one of them now sees those reads whether or not the
 * behaviour it is about has anything to do with them. These are the empty answers, declared
 * **last** in a suite's `setupServer(…)` call: the first matching handler wins, so a suite
 * that serves its own rows for one of these routes keeps serving them, and a suite that does
 * not gets an empty listing instead of an unhandled request.
 *
 * A suite asserting on a count therefore states its own rows, and this file states nothing.
 */
export function shellListings() {
  return [
    http.get("*/api/v1/shops/:shopId/orders", () => HttpResponse.json({ orders: [] })),
    http.get("*/api/v1/shops/:shopId/tickets", () => HttpResponse.json({ tickets: [] })),
    http.get("*/api/v1/shops/:shopId/scenarios", () => HttpResponse.json({ scenarios: [] })),
    // Not a rail's count: the shop's images, which every product editor's Media card reads.
    http.get("*/api/v1/shops/:shopId/media", () => HttpResponse.json({ media: [] })),
    http.get("*/api/v1/customer-profiles", () => HttpResponse.json({ profiles: [] })),
    http.get("*/api/v1/support-identities", () => HttpResponse.json({ identities: [] })),
    http.get("*/api/v1/agent-configurations", () => HttpResponse.json({ configurations: [] })),
    http.get("*/api/v1/judge-configurations", () => HttpResponse.json({ judges: [] })),
    http.get("*/api/v1/objective-blocks", () => HttpResponse.json({ blocks: [] })),
    http.get("*/api/v1/mutation-blocks", () => HttpResponse.json({ blocks: [] })),
    http.get("*/api/v1/experiments", () =>
      HttpResponse.json({
        experiments: [],
        page: 1,
        page_size: 1,
        total: 0,
        shops: [],
        scenarios: [],
        frameworks: [],
        tags: [],
      }),
    ),
  ];
}

/**
 * One entry of the rail the shell is drawing, for a suite asserting that the figure beside a
 * label and the table under it are one answer (ADR 0056).
 *
 * The entry is named by its label alone — the count is its *description* and never part of
 * its name — so this finds the row exactly as every other suite and every Playwright spec
 * finds it, and the caller reads the figure off it.
 */
export function railEntry(label: string, railName = "Shop workspace"): HTMLElement {
  return within(screen.getByRole("navigation", { name: railName })).getByRole("link", {
    name: label,
  });
}

/** How many rows a table holds, not counting the one naming its columns. */
export function bodyRows(table: HTMLElement): number {
  return within(table).getAllByRole("row").length - 1;
}
