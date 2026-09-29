import type {
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
} from "@agent-lab/contracts";
import { screen, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { renderApp } from "./test/app";
import { expectCreateGlyph, indexCard } from "./test/indexes";
import { shellListings } from "./test/shell";

/**
 * What every index shares, swept over every index rather than asserted once per suite: the
 * create action in the header with its glyph, and a failed listing that says its failure and
 * nothing else (PLAN-UX Milestone 9, the index template).
 */

const SHOP_ID = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";

const SHOP_CONTENT: ShopDraftResponse["content"] = {
  identity: {
    name: "Northstar Outfitters",
    slug: "northstar",
    locale: "en-GB",
    currencies: ["EUR"],
    channels: ["chat"],
  },
  products: [],
  faq: [],
  policies: [],
  payment_methods: [],
  fulfilment_methods: [],
  support_guidelines: [],
  tone_of_voice_guidelines: [],
  default_tone_of_voice_id: null,
  logo: null,
};

const server = setupServer(
  http.get("*/api/v1/shops", () =>
    HttpResponse.json({
      shops: [
        {
          shop_id: SHOP_ID,
          name: "Northstar Outfitters",
          slug: "northstar",
          updated_at: "2026-09-20T12:05:00+00:00",
          latest_published_version: null,
          published_version_count: 0,
          logo: null,
        },
      ],
    } satisfies ShopListResponse),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft`, () =>
    HttpResponse.json({
      shop_id: SHOP_ID,
      lifecycle_state: "draft",
      content: SHOP_CONTENT,
      created_at: "2026-09-20T12:00:00+00:00",
      updated_at: "2026-09-20T12:05:00+00:00",
    } satisfies ShopDraftResponse),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft/preview`, () =>
    HttpResponse.json({
      shop_id: SHOP_ID,
      publishable: false,
      issues: [],
      changes: [],
      content_fingerprint: "c".repeat(64),
      latest_published_version: null,
      next_version: 1,
      matches_latest_published: false,
      content: SHOP_CONTENT,
    } satisfies ShopPreviewResponse),
  ),
  ...shellListings(),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  window.localStorage.clear();
});
afterAll(() => server.close());

const shop = (path: string) => `/shops/${SHOP_ID}${path}`;

/** Every index and its create action, as its role and the name the specs press it by. */
const CREATE_ACTIONS: ReadonlyArray<[path: string, role: "link" | "button", name: string]> = [
  ["/shops", "link", "New shop"],
  [shop("/products"), "button", "New product"],
  [shop("/orders"), "link", "New order"],
  [shop("/customers"), "link", "New customer"],
  [shop("/tickets"), "link", "New ticket"],
  [shop("/scenarios"), "link", "New scenario"],
  [shop("/setup/policies"), "link", "New document"],
  ["/lab/support-identities", "link", "New identity"],
  ["/lab/agent-configurations", "link", "New configuration"],
  ["/lab/judges", "link", "New judge"],
  ["/lab/objective-blocks", "link", "New objective block"],
  ["/lab/mutation-blocks", "link", "New mutation block"],
  ["/lab/history", "link", "New experiment"],
];

describe("every index's create action", () => {
  it.each(CREATE_ACTIONS)(
    "on %s is %s %j in the page header, with the create glyph and no new name",
    async (path, role, name) => {
      renderApp(path);

      const control = await screen.findByRole(role, { name });
      expectCreateGlyph(control, name);
      const header = control.closest("header");
      expect(header).not.toBeNull();
      expect(within(header as HTMLElement).getByRole("heading", { level: 1 })).toBeInTheDocument();
    },
  );
});

/**
 * Every index that renders a listing, the route it reads, its card's title, and the sentence
 * it says when the listing holds nothing — which a listing that could not be read has not said.
 */
const LISTINGS: ReadonlyArray<[path: string, route: string, title: string, empty: RegExp]> = [
  ["/shops", "*/api/v1/shops", "In this lab", /No shops yet/],
  [shop("/orders"), "*/api/v1/shops/:shopId/orders", "Order fixtures", /no order fixtures yet/],
  [
    shop("/customers"),
    "*/api/v1/customer-profiles",
    "Attached to this shop",
    /No customer is attached/,
  ],
  [shop("/tickets"), "*/api/v1/shops/:shopId/tickets", "Raised in this shop", /No ticket/],
  [shop("/scenarios"), "*/api/v1/shops/:shopId/scenarios", "Built on this shop", /No scenario/],
  [
    "/lab/support-identities",
    "*/api/v1/support-identities",
    "Shared by every shop",
    /No support identity/,
  ],
  [
    "/lab/agent-configurations",
    "*/api/v1/agent-configurations",
    "Agents under test",
    /No agent configuration/,
  ],
  ["/lab/judges", "*/api/v1/judge-configurations", "What a scenario leaves to a judge", /No judge/],
  [
    "/lab/objective-blocks",
    "*/api/v1/objective-blocks",
    "What a scenario can assert",
    /No objective block/,
  ],
  [
    "/lab/mutation-blocks",
    "*/api/v1/mutation-blocks",
    "Faults a scenario can inject",
    /No mutation block/,
  ],
  ["/lab/history", "*/api/v1/experiments", "Recorded across every shop", /No experiment/],
];

describe("every index whose listing fails", () => {
  it.each(LISTINGS)(
    "on %s says the failure in its card and nothing else",
    async (path, route, title, empty) => {
      server.use(
        http.get(route, () =>
          HttpResponse.json(
            { code: "internal_error", message: "The listing could not be read.", request_id: "r" },
            { status: 500 },
          ),
        ),
      );
      renderApp(path);

      await screen.findByRole("heading", { level: 2, name: title });
      const card = indexCard(title);
      expect(await within(card).findByRole("alert")).toHaveTextContent(
        "The listing could not be read.",
      );
      // Said once on the page: no second alert above the card repeats it.
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      // Not the empty state: a listing that never arrived has not said there is nothing.
      expect(within(card).queryByText(empty)).toBeNull();
      // Nor anything a listing would have drawn: rows, chips, a box to search them.
      expect(within(card).queryByRole("table")).toBeNull();
      expect(within(card).queryByRole("group")).toBeNull();
      expect(within(card).queryByRole("searchbox")).toBeNull();
      expect(within(card).queryByText(/^Loading/)).toBeNull();
    },
  );
});
