import type {
  SandboxSnapshotListResponse,
  SandboxSnapshotResponse,
  ScenarioContentSchema,
  ScenarioDraftResponse,
  ScenarioVersionListResponse,
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
} from "@agent-lab/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "./App";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const SCENARIO_ID = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
const TICKET_ID = "6b0f9c1e-49d1-4c9f-8b0c-1f6d1c2f9a01";
const ORDER_ID = "2f8c2b60-9d3d-4a77-9f31-1c7f0f3c9a42";
const PROFILE_ID = "0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac101";
const SNAPSHOT_ID = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a";
const FINGERPRINT = "a".repeat(64);

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
};

const CONTENT: ScenarioContentSchema = {
  name: "Wrong shipping address",
  ticket_id: TICKET_ID,
  context_documents: [],
  objectives: [],
  mutations: [],
  hidden_facts: "",
  completion: { statement: "The order ships to the confirmed address.", max_turns: 12 },
  objective_count: 0,
  mutation_count: 0,
};

const SNAPSHOT: SandboxSnapshotResponse = {
  snapshot_id: SNAPSHOT_ID,
  scenario_id: SCENARIO_ID,
  scenario_version: 2,
  seed: 20260825,
  sandbox_fingerprint: FINGERPRINT,
  canonical_schema_version: "sandbox-v2",
  order_count: 1,
  origin_kind: "order_page",
  ticket_reference: "T-204",
  created_at: "2026-08-25T12:20:00+00:00",
  pins: [
    {
      definition_type: "shop",
      definition_id: SHOP_ID,
      version: 3,
      content_fingerprint: "b".repeat(64),
    },
    {
      definition_type: "ticket",
      definition_id: TICKET_ID,
      version: 1,
      content_fingerprint: "c".repeat(64),
    },
  ],
  state: {
    customer_profile_id: PROFILE_ID,
    interaction: {
      origin_kind: "order_page",
      product_handle: null,
      order_id: ORDER_ID,
      channel: "chat",
      ticket_reference: "T-204",
    },
    orders: [
      {
        order_id: ORDER_ID,
        reference: "NS-10482",
        payment_status: "paid",
        fulfilment_status: "unfulfilled",
        total_amount: "249.00",
        currency: "EUR",
        item_count: 1,
        shipping_label: "Maya Laurent · 42 cours de la Marne · 33800 Bordeaux",
      },
    ],
  },
};

// Newest first, as `listScenarioVersions` really answers (the repository orders by
// `version.desc()`). Reading an end of this list is what the page must not do.
const VERSIONS: ScenarioVersionListResponse = {
  versions: [
    { version: 2, content_fingerprint: "e".repeat(64), published_at: "2026-08-25T12:00:00+00:00" },
    { version: 1, content_fingerprint: "d".repeat(64), published_at: "2026-08-25T11:00:00+00:00" },
  ],
};

let stored: SandboxSnapshotListResponse = { snapshots: [] };
let materialized: Record<string, unknown>[] = [];

const server = setupServer(
  http.get("*/api/v1/shops", () => HttpResponse.json({ shops: [] } satisfies ShopListResponse)),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft`, () =>
    HttpResponse.json({
      shop_id: SHOP_ID,
      lifecycle_state: "draft",
      content: SHOP_CONTENT,
      created_at: "2026-08-25T12:00:00+00:00",
      updated_at: "2026-08-25T12:05:00+00:00",
    } satisfies ShopDraftResponse),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft/preview`, () =>
    HttpResponse.json({
      shop_id: SHOP_ID,
      publishable: false,
      issues: [],
      changes: [],
      content_fingerprint: "c".repeat(64),
      latest_published_version: 3,
      next_version: 4,
      matches_latest_published: false,
      content: SHOP_CONTENT,
    } satisfies ShopPreviewResponse),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/draft`, () =>
    HttpResponse.json({
      scenario_id: SCENARIO_ID,
      shop_id: SHOP_ID,
      lifecycle_state: "draft",
      content: CONTENT,
      created_at: "2026-08-25T12:00:00+00:00",
      updated_at: "2026-08-25T12:05:00+00:00",
    } satisfies ScenarioDraftResponse),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/versions`, () =>
    HttpResponse.json(VERSIONS),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/snapshots`, () =>
    HttpResponse.json(stored),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/snapshots/${SNAPSHOT_ID}`, () => HttpResponse.json(SNAPSHOT)),
  http.post(
    `*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/versions/:version/snapshots`,
    async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      materialized.push({ ...body, version: params.version });
      stored = { snapshots: [SNAPSHOT] };
      return HttpResponse.json(SNAPSHOT, { status: 201 });
    },
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  stored = { snapshots: [] };
  materialized = [];
});
afterAll(() => server.close());

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/snapshots`]}>
      <App />
    </MemoryRouter>,
  );
}

describe("starting states", () => {
  it("freezes the newest published version by default", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole("heading", { name: /Wrong shipping address · starting states/ }),
    ).toBeVisible();
    // The newest version is the one an operator means without saying so — whichever end of
    // the server's list it arrives on.
    await waitFor(() => expect(screen.getByLabelText("Scenario version")).toHaveValue("2"));
    expect(
      within(screen.getByLabelText("Scenario version"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["v2", "v1"]);

    await user.click(screen.getByRole("button", { name: "Materialize snapshot" }));

    await waitFor(() => expect(materialized).toHaveLength(1));
    expect(materialized[0]).toEqual({ seed: 20260825, version: "2" });
  });

  it("separates what the snapshot pinned from what it copied", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: "Materialize snapshot" });

    await user.click(screen.getByRole("button", { name: "Materialize snapshot" }));

    const pins = await screen.findByRole("region", { name: "Pinned versions" });
    expect(within(pins).getByText("shop")).toBeVisible();
    expect(within(pins).getByText("v3")).toBeVisible();

    const orders = screen.getByRole("region", { name: "Copied orders" });
    expect(within(orders).getByText("NS-10482")).toBeVisible();
    expect(within(orders).getByText(/33800 Bordeaux/)).toBeVisible();
  });

  it("reads the interaction back as an identifier, not a resource copy", async () => {
    const user = userEvent.setup();
    stored = { snapshots: [SNAPSHOT] };
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^[a-f0-9]{12}…$/ }));

    expect(await screen.findByText(/Opened from the order page on ticket/)).toBeVisible();
    expect(screen.getByText("T-204")).toBeVisible();
  });

  it("explains a refused freeze with the findings that caused it", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(
        `*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/versions/:version/snapshots`,
        () =>
          HttpResponse.json(
            {
              code: "sandbox_not_materializable",
              message: "the scenario version cannot be materialized into starting state",
              request_id: "req-1",
              issues: [
                {
                  severity: "error",
                  code: "binding_order_missing_from_shop",
                  message: "This shop no longer holds that order.",
                  path: "scenario.mutations.order-moves-under-the-arm.bindings.entity_ref",
                },
              ],
            },
            { status: 422 },
          ),
      ),
    );
    renderPage();
    await screen.findByRole("button", { name: "Materialize snapshot" });

    await user.click(screen.getByRole("button", { name: "Materialize snapshot" }));

    expect(await screen.findByText("This shop no longer holds that order.")).toBeVisible();
    expect(
      screen.getByText("scenario.mutations.order-moves-under-the-arm.bindings.entity_ref"),
    ).toBeVisible();
  });

  it("says a scenario with no published version has nothing to freeze", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/versions`, () =>
        HttpResponse.json({ versions: [] } satisfies ScenarioVersionListResponse),
      ),
    );
    renderPage();

    expect(await screen.findByText(/This scenario has no published version yet/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Materialize snapshot" })).toBeNull();
  });

  it("refuses to freeze against a seed the author cleared", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: "Materialize snapshot" });

    await user.clear(screen.getByLabelText("Seed"));
    await user.click(screen.getByRole("button", { name: "Materialize snapshot" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Enter the seed/);
    expect(materialized).toHaveLength(0);
  });
});
