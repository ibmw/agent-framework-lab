import type { ShopListResponse } from "@agent-lab/contracts";
import { render, screen, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "./App";
import { SETUP_CHAIN } from "./lib/setupPath";

/**
 * The written setup guide: the chain in dependency order, for a reader with nothing to read yet.
 *
 * Two refusals are held here. ADR 0043 decided the seed is a command and never a route, so the
 * guide is asserted to name it and to expose nothing that performs it. And what the guide says
 * the chain is, is asserted against `lib/setupPath.ts`'s own table rather than against a second
 * list, so the page and the table it walks cannot come to disagree about it (ADR 0044).
 */

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";

const ONE_SHOP: ShopListResponse = {
  shops: [
    {
      shop_id: SHOP_ID,
      name: "Northstar Outfitters",
      slug: "northstar",
      updated_at: "2026-09-12T09:41:00+00:00",
      latest_published_version: 1,
      published_version_count: 1,
    },
  ],
};

let shops: ShopListResponse = ONE_SHOP;
let completedExperiments = 0;

const server = setupServer(
  http.get("*/api/v1/shops", () => HttpResponse.json(shops)),
  http.get("*/api/v1/experiments", ({ request }) =>
    HttpResponse.json({
      experiments: [],
      page: 1,
      page_size: 1,
      total:
        new URL(request.url).searchParams.get("status") === "completed" ? completedExperiments : 0,
      shops: [],
      scenarios: [],
      frameworks: [],
      tags: [],
    }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.events.removeAllListeners();
  server.resetHandlers();
  window.localStorage.clear();
  shops = ONE_SHOP;
  completedExperiments = 0;
});
afterAll(() => server.close());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("the setup guide", () => {
  it("hands over make seed as a command and exposes no control that performs it", async () => {
    renderAt("/guides/setup");

    const fast = await screen.findByRole("region", { name: "The fast path is a command" });
    expect(within(fast).getByText("make seed", { selector: "pre" })).toBeVisible();
    // The reset path is `docs/development.md`'s three commands, and is also text.
    expect(
      within(fast).getByText("rm -f var/agent-lab.db && make migrate && make seed", {
        selector: "pre",
      }),
    ).toBeVisible();
    // ADR 0043's refusal: there is nothing on this page that populates, resets or reseeds a
    // lab. The named query is document-wide — a control like this must not appear in the
    // chrome either — while the count is taken over the guide's own cards, which are allowed
    // to gain nothing at all and where a future header control would be a false failure.
    expect(
      screen.queryByRole("button", { name: /seed|demo data|populate|load sample|reset|wipe/i }),
    ).toBeNull();
    for (const card of screen.getAllByRole("region")) {
      expect(within(card).queryAllByRole("button")).toHaveLength(0);
    }
  });

  it("walks the chain that module holds, in the order it puts it in", async () => {
    renderAt("/guides/setup");

    const chain = await screen.findByRole("region", {
      name: `The chain · ${SETUP_CHAIN.length} steps`,
    });
    const headings = within(chain)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent ?? "");

    // Asserted against `SETUP_CHAIN` rather than a list written out here: a second list is a
    // second thing to keep in agreement with the first.
    expect(headings).toHaveLength(SETUP_CHAIN.length);
    SETUP_CHAIN.forEach((step, index) => {
      expect(headings[index]).toContain(`${index + 1}.`);
      expect(headings[index]).toContain(step.label);
    });
  });

  it("links each step to the surface where that work is done, inside a shop", async () => {
    renderAt("/guides/setup");

    const chain = await screen.findByRole("region", {
      name: `The chain · ${SETUP_CHAIN.length} steps`,
    });
    // The guide reads the chain and gains no privilege over it: every step is a link out.
    expect(within(chain).getByRole("link", { name: "Open customers" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/customers`,
    );
    expect(within(chain).getByRole("link", { name: "Open the bench" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/bench`,
    );
  });

  it("starts where the chain starts when the lab holds no shop at all", async () => {
    shops = { shops: [] };
    renderAt("/guides/setup");

    const chain = await screen.findByRole("region", {
      name: `The chain · ${SETUP_CHAIN.length} steps`,
    });
    expect(within(chain).getByRole("link", { name: "Open shops" })).toHaveAttribute(
      "href",
      "/shops",
    );
    // The other nine steps are reached at shop-scoped URLs — several of the definitions
    // behind them are shop-independent — and there is no shop to scope them to yet, so the
    // guide offers no link rather than one that lands nowhere.
    expect(within(chain).queryByRole("link", { name: "Open customers" })).toBeNull();
  });

  it("says how many steps publish by counting the ones that do", async () => {
    // The sentence and the chips are both read off `publishes`, so neither can drift from the
    // table while the other stays put.
    const publishing = SETUP_CHAIN.filter((step) => step.publishes).length;
    renderAt("/guides/setup");

    const chain = await screen.findByRole("region", {
      name: `The chain · ${SETUP_CHAIN.length} steps`,
    });
    expect(
      within(chain).getByText(
        new RegExp(`${publishing} of these ${SETUP_CHAIN.length} steps end in a published version`),
      ),
    ).toBeVisible();
    expect(within(chain).getAllByText("ends in a published version")).toHaveLength(publishing);
  });
});
