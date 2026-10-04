import type {
  CustomerProfileDraftResponse,
  CustomerProfileListResponse,
  OrderListResponse,
  ReplaceOrderRequest,
  ShopDraftResponse,
  ShopListResponse,
  ShopOrderResponse,
  ShopPreviewResponse,
} from "@agent-lab/contracts";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SLUG_MAX_LENGTH } from "./lib/entryIds";
import {
  LINE_QUANTITY_RULE,
  LINE_VARIANT_RULE,
  MAX_ORDER_EVENTS,
  ORDER_EVENT_SUMMARY_RULE,
  ORDER_EVENT_TIME_RULE,
  ORDER_EVENTS_CAP_RULE,
  ORDER_METHOD_RULE,
  PAID_AT_RULE,
  SHIPPED_AT_RULE,
  tooLongMessage,
} from "./lib/fieldRules";
import { toLocalInput } from "./lib/orders";
import { formatFixtureTimestamp } from "./lib/ui";
import { itemFormReason } from "./lib/unsavedWork";
import { renderApp, wholeDescription } from "./test/app";
import { expectWayBack } from "./test/header";
import { indexCard } from "./test/indexes";
import { panelCards, panelFields, sidePanel } from "./test/panel";
import { expectNotRefused, expectRefused, submitWithoutPressing } from "./test/refused";
import { bodyRows, railEntry, shellListings } from "./test/shell";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const OTHER_SHOP_ID = "8a7b6c5d-4e3f-4a2b-9c8d-7e6f5a4b3c2d";
const PROFILE_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const ORDER_ID = "9f8e7d6c-5b4a-4938-8271-6a5b4c3d2e1f";
const PLACED_AT = "2026-08-20T14:55:00.000000Z";
const CAPTURED_AT = "2026-08-21T13:12:00.000000Z";

const SHOP_CONTENT: ShopDraftResponse["content"] = {
  identity: {
    name: "Northstar Outfitters",
    slug: "northstar",
    locale: "en-GB",
    currencies: ["EUR"],
    channels: ["chat"],
  },
  products: [
    {
      handle: "alpine-shell-jacket",
      title: "Alpine Shell Jacket",
      description: "",
      status: "active",
      category: "Outerwear",
      options: [{ key: "color", name: "Color", values: ["Ocean Blue"] }],
      variants: [
        {
          sku: "NS-ASJ-OB-M",
          option_values: [{ key: "color", value: "Ocean Blue" }],
          availability: "in_stock",
          stock_quantity: 12,
          price: { amount: "249.00", currency: "EUR" },
        },
      ],
      media: [],
      attributes: [],
      reviews: [],
      ratings: { review_count: 0, average_rating: null },
    },
  ],
  faq: [],
  policies: [],
  payment_methods: [{ id: "card", name: "Card · synthetic", kind: "card", enabled: true }],
  fulfilment_methods: [
    {
      id: "standard",
      name: "Standard · 3–5 days",
      carrier: "Nordic Post",
      min_transit_days: 3,
      max_transit_days: 5,
    },
  ],
  support_guidelines: [],
  tone_of_voice_guidelines: [],
  default_tone_of_voice_id: null,
  logo: null,
};

const PROFILE_CONTENT: CustomerProfileDraftResponse["content"] = {
  identity: {
    given_name: "Maya",
    family_name: "Laurent",
    email: "maya.laurent@example.org",
    locale: "fr-FR",
    phone: null,
  },
  account: {
    customer_since: "2024-03-14",
    status: "active",
    loyalty_tier: "silver",
    marketing_opt_in: true,
    notes: "",
  },
  persona: { summary: "Direct and mildly anxious.", traits: ["frequent", "direct"] },
  addresses: [
    {
      id: "home",
      label: "Home",
      recipient: "Maya Laurent",
      line1: "18 rue des Écoles",
      line2: null,
      postal_code: "69005",
      city: "Lyon",
      region: null,
      country: "FR",
      is_default: true,
    },
    {
      id: "bordeaux-previous-flat",
      label: "Bordeaux — previous flat",
      recipient: "Maya Laurent",
      line1: "42 cours de la Marne",
      line2: null,
      postal_code: "33800",
      city: "Bordeaux",
      region: null,
      country: "FR",
      is_default: false,
    },
  ],
  background: [],
  hidden_facts: [],
  display_name: "Maya Laurent",
  default_address_id: "home",
};

const PAID_ORDER: ShopOrderResponse = {
  order_id: ORDER_ID,
  shop_id: SHOP_ID,
  content: {
    reference: "NS-10482",
    customer_profile_id: PROFILE_ID,
    currency: "EUR",
    placed_at: PLACED_AT,
    lines: [
      {
        id: "ns-asj-ob-m",
        sku: "NS-ASJ-OB-M",
        product_handle: "alpine-shell-jacket",
        title: "Alpine Shell Jacket",
        variant_summary: "Ocean Blue · M",
        unit_price: { amount: "249.00", currency: "EUR" },
        quantity: 1,
        line_total: { amount: "249.00", currency: "EUR" },
      },
    ],
    payment: {
      status: "paid",
      method_id: "card",
      method_name: "Card · synthetic",
      paid_at: CAPTURED_AT,
    },
    fulfilment: {
      status: "unfulfilled",
      method_id: "standard",
      method_name: "Standard · 3–5 days",
      shipped_at: null,
    },
    shipping_fee: { amount: "0.00", currency: "EUR" },
    shipping_address: {
      source_address_id: "bordeaux-previous-flat",
      source_label: "Bordeaux — previous flat",
      selected_at: PLACED_AT,
      recipient: "Maya Laurent",
      line1: "42 cours de la Marne",
      line2: null,
      postal_code: "33800",
      city: "Bordeaux",
      region: "Nouvelle-Aquitaine",
      country: "FR",
    },
    events: [
      {
        id: "order-created",
        kind: "placed",
        occurred_at: PLACED_AT,
        summary: "Order created — checkout, order page",
      },
    ],
    subtotal: { amount: "249.00", currency: "EUR" },
    total: { amount: "249.00", currency: "EUR" },
    item_count: 1,
    allows_address_change: true,
  },
  content_fingerprint: "a".repeat(64),
  issues: [],
  payment_status_options: ["paid", "refunded"],
  fulfilment_status_options: ["unfulfilled", "partially_fulfilled", "fulfilled"],
  created_at: "2026-08-24T12:00:00+00:00",
  updated_at: "2026-08-24T12:05:00+00:00",
};

const ORDERS: OrderListResponse = {
  orders: [
    {
      order_id: ORDER_ID,
      reference: "NS-10482",
      customer_profile_id: PROFILE_ID,
      customer_display_name: "Maya Laurent",
      placed_at: PLACED_AT,
      payment_status: "paid",
      fulfilment_status: "unfulfilled",
      line_count: 1,
      total: { amount: "249.00", currency: "EUR" },
      updated_at: "2026-08-24T12:05:00+00:00",
    },
    {
      order_id: "2b3c4d5e-6f70-4819-a2b3-c4d5e6f70819",
      reference: "NS-10479",
      customer_profile_id: PROFILE_ID,
      customer_display_name: "Maya Laurent",
      placed_at: "2026-08-18T09:00:00.000000Z",
      payment_status: "paid",
      fulfilment_status: "fulfilled",
      line_count: 2,
      total: { amount: "89.00", currency: "EUR" },
      updated_at: "2026-08-24T12:05:00+00:00",
    },
    // A refund, because `PaymentStatus` has four members and a fixture of paid orders lets a
    // filter written as "not paid" pass while meaning something else. This order's money has
    // moved and settled; it is not one an operator is waiting on.
    {
      order_id: "3c4d5e6f-7081-492a-b3c4-d5e6f708192a",
      reference: "NS-10476",
      customer_profile_id: PROFILE_ID,
      customer_display_name: "Maya Laurent",
      placed_at: "2026-08-11T09:00:00.000000Z",
      payment_status: "refunded",
      fulfilment_status: "fulfilled",
      line_count: 1,
      total: { amount: "42.00", currency: "EUR" },
      updated_at: "2026-08-24T12:05:00+00:00",
    },
  ],
};

let currentOrder: ShopOrderResponse = PAID_ORDER;
let currentProfile = PROFILE_CONTENT;
let savedRequests: ReplaceOrderRequest[] = [];
let createdOrders: Record<string, unknown>[] = [];
let deleted: string[] = [];

const server = setupServer(
  http.get("*/api/v1/shops", () =>
    HttpResponse.json({
      shops: [
        {
          shop_id: SHOP_ID,
          name: "Northstar Outfitters",
          slug: "northstar",
          updated_at: "2026-08-23T12:05:00+00:00",
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
      created_at: "2026-08-23T12:00:00+00:00",
      updated_at: "2026-08-23T12:05:00+00:00",
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
  http.get("*/api/v1/customer-profiles", () =>
    HttpResponse.json({
      profiles: [
        {
          profile_id: PROFILE_ID,
          display_name: "Maya Laurent",
          email: "maya.laurent@example.org",
          persona_traits: ["frequent", "direct"],
          address_count: 2,
          default_address_label: "Home",
          updated_at: "2026-08-23T12:05:00+00:00",
          latest_published_version: 2,
          published_version_count: 2,
          attached_shop_count: 1,
        },
      ],
    } satisfies CustomerProfileListResponse),
  ),
  http.get(`*/api/v1/customer-profiles/${PROFILE_ID}/draft`, () =>
    HttpResponse.json({
      profile_id: PROFILE_ID,
      lifecycle_state: "draft",
      content: currentProfile,
      created_at: "2026-08-23T12:00:00+00:00",
      updated_at: "2026-08-23T12:05:00+00:00",
    } satisfies CustomerProfileDraftResponse),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/orders`, () => HttpResponse.json(ORDERS)),
  http.post(`*/api/v1/shops/${SHOP_ID}/orders`, async ({ request }) => {
    const command = (await request.json()) as Record<string, unknown>;
    createdOrders.push(command);
    // Echoing the reference it was sent, which is what the lab answers with and what the
    // page then freezes its suggestion to.
    return HttpResponse.json(
      {
        ...currentOrder,
        content: { ...currentOrder.content, reference: String(command.reference), lines: [] },
      } satisfies ShopOrderResponse,
      { status: 201 },
    );
  }),
  http.get(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, () => HttpResponse.json(currentOrder)),
  http.put(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, async ({ request }) => {
    const body = (await request.json()) as ReplaceOrderRequest;
    savedRequests.push(body);
    currentOrder = {
      ...currentOrder,
      content: {
        ...currentOrder.content,
        lines: currentOrder.content.lines.map((line) => {
          const selection = body.lines.find((entry) => entry.sku === line.sku);
          return selection ? { ...line, quantity: selection.quantity } : line;
        }),
      },
    };
    return HttpResponse.json(currentOrder);
  }),
  http.delete(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, () => {
    deleted.push(ORDER_ID);
    return new HttpResponse(null, { status: 204 });
  }),
  // The shop and lab shells read every listing their rail counts (ADR 0056). Last, so a
  // handler this suite declares for one of these routes still wins.
  ...shellListings(),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  currentOrder = PAID_ORDER;
  currentProfile = PROFILE_CONTENT;
  savedRequests = [];
  createdOrders = [];
  deleted = [];
});
afterAll(() => server.close());

function renderAt(path: string) {
  return renderApp(path);
}

function card(name: string) {
  return screen.getByRole("region", { name });
}

/**
 * A line's quantity, corrected the one way the editor offers (ADR 0074): the line's pencil
 * loads it into the form below the list, and *Save changes* writes it where it stands.
 */
async function setQuantity(user: ReturnType<typeof userEvent.setup>, sku: string, value: string) {
  const lines = card("Line items & payment");
  await user.click(within(lines).getByRole("button", { name: `Edit ${sku}` }));
  const form = within(lines).getByRole("group", { name: `Edit ${sku}` });
  await user.clear(within(form).getByLabelText("Quantity"));
  await user.type(within(form).getByLabelText("Quantity"), value);
  await user.click(within(form).getByRole("button", { name: "Save changes" }));
}

describe("order index", () => {
  // The card's title says what the list is (the fixtures it lists are authored state, not live orders), on the header line opposite the search.
  it("titles its card Order fixtures, opposite the search box", async () => {
    renderAt(`/shops/${SHOP_ID}/orders`);

    const box = await screen.findByRole("searchbox", { name: "Search by reference or customer" });
    const title = screen.getByRole("heading", { level: 2, name: "Order fixtures" });
    expect(title.parentElement).toContainElement(box);
  });

  it("lists the shop's fixtures with their two status axes", async () => {
    renderAt(`/shops/${SHOP_ID}/orders`);

    expect(await screen.findByRole("heading", { name: "Orders" })).toBeVisible();
    expect(await screen.findByRole("link", { name: "NS-10482" })).toBeVisible();
    const table = within(screen.getByRole("table"));
    expect(table.getAllByText("Maya Laurent")).toHaveLength(3);
    expect(table.getAllByText("Paid")).toHaveLength(2);
    expect(table.getByText("Refunded")).toBeVisible();
    expect(table.getByText("Unfulfilled")).toBeVisible();
    expect(table.getByText("249.00 EUR")).toBeVisible();
  });

  it("filters to the orders a scenario still has work on", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders`);
    await screen.findByRole("link", { name: "NS-10482" });

    const filters = screen.getByRole("group", { name: "Filter orders" });
    await user.click(within(filters).getByRole("button", { name: "Unfulfilled 1" }));

    expect(screen.getByRole("link", { name: "NS-10482" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "NS-10479" })).toBeNull();
  });

  /**
   * The count is on the chip, and it is the chip's own answer.
   *
   * *Payment unsettled* is the one to watch: the fixture holds two paid orders and a refunded
   * one, and a refund is settled money — so the honest count is nothing. A predicate written
   * as "not paid" would say 1 here, which is the whole reason the refund is in the fixture.
   * A zero chip is still drawn and still pressable — pressing it is how an operator confirms
   * there is nothing there, and the list says so in words.
   */
  it("counts each filter beside its name, and a refund is not money left owing", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders`);
    await screen.findByRole("link", { name: "NS-10482" });
    const filters = within(screen.getByRole("group", { name: "Filter orders" }));

    expect(filters.getByRole("button", { name: "All 3" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Open 1" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Unfulfilled 1" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Payment unsettled 0" })).toBeVisible();
    // The refunded order is in the list and in no payment chip but *All*.
    expect(screen.getByRole("link", { name: "NS-10476" })).toBeVisible();

    await user.click(filters.getByRole("button", { name: "Payment unsettled 0" }));

    expect(screen.queryByRole("link", { name: "NS-10482" })).toBeNull();
    expect(screen.queryByRole("link", { name: "NS-10476" })).toBeNull();
    expect(screen.getByText("No order matches this view.")).toBeVisible();
  });

  /**
   * The rule UI-6 settled, asserted where an operator meets it: the search narrows the rows
   * and moves no count. Every chip's whole rendered text is captured before the word is typed
   * and compared after, so a count that recomputed over the searched list fails here whatever
   * its figure happened to become — and the row assertion above it is what makes the
   * comparison mean something, because a search that narrowed nothing would also move nothing.
   */
  it("narrows the orders to the search and leaves every count where it was", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders`);
    await screen.findByRole("link", { name: "NS-10482" });
    const filters = within(screen.getByRole("group", { name: "Filter orders" }));
    const counts = filters.getAllByRole("button").map((chip) => chip.textContent);

    await user.type(
      screen.getByRole("searchbox", { name: "Search by reference or customer" }),
      "10476",
    );

    expect(screen.getByRole("link", { name: "NS-10476" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "NS-10482" })).toBeNull();
    expect(screen.queryByRole("link", { name: "NS-10479" })).toBeNull();
    expect(filters.getAllByRole("button").map((chip) => chip.textContent)).toEqual(counts);
    expect(filters.getByRole("button", { name: "All 3" })).toBeVisible();
  });

  /** The word searches what the chip left, not the table: pressing one still holds. */
  it("searches under the pressed chip rather than around it", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders`);
    await screen.findByRole("link", { name: "NS-10482" });
    const filters = within(screen.getByRole("group", { name: "Filter orders" }));

    await user.click(filters.getByRole("button", { name: "Open 1" }));
    // Every fixture order is Maya Laurent's, so the word alone would leave all three.
    await user.type(
      screen.getByRole("searchbox", { name: "Search by reference or customer" }),
      "Maya",
    );

    expect(screen.getByRole("link", { name: "NS-10482" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "NS-10479" })).toBeNull();
    expect(screen.queryByRole("link", { name: "NS-10476" })).toBeNull();
  });

  /** A search that matches nothing leaves a sentence, never a blank card. */
  it("says so when nothing in the shop matches the word", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders`);
    await screen.findByRole("link", { name: "NS-10482" });

    await user.type(
      screen.getByRole("searchbox", { name: "Search by reference or customer" }),
      "NS-90000",
    );

    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("No order matches this view.")).toBeVisible();
  });

  /**
   * A chip is a filter, so the row waits for something to filter. Before the listing lands
   * every count would be 0 and every press a no-op — the stat band this slice exists to
   * avoid, drawn at the moment it is least true.
   */
  it("withholds the chip row until there are rows to count", async () => {
    // Held open by hand rather than by a delay. The shell asks for this listing beside the
    // shop's draft rather than after it (ADR 0056), so a listing that answers in a fixed
    // number of milliseconds is racing the draft for which lands first.
    let answer = () => {};
    let reached = () => {};
    const asked = new Promise<void>((resolve) => {
      reached = resolve;
    });
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/orders`, async () => {
        reached();
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return HttpResponse.json(ORDERS);
      }),
    );
    renderAt(`/shops/${SHOP_ID}/orders`);
    await asked;

    expect(await screen.findByText("Loading orders…")).toBeVisible();
    expect(screen.queryByRole("group", { name: "Filter orders" })).toBeNull();

    answer();
    expect(await screen.findByRole("group", { name: "Filter orders" })).toBeVisible();
  });

  it("withholds it again when the listing could not be read", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/orders`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "boom", request_id: "r" },
          { status: 500 },
        ),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/orders`);

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByRole("group", { name: "Filter orders" })).toBeNull();
  });

  /**
   * And the chip that does have something to count still counts it, so the fix above is not
   * "the predicate now matches nothing". An order awaiting payment is money left owing.
   */
  it("counts an order still awaiting its payment", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/orders`, () =>
        HttpResponse.json({
          orders: [
            ...ORDERS.orders,
            {
              ...ORDERS.orders[0],
              order_id: "4d5e6f70-8192-4a3b-c4d5-e6f708192a3b",
              reference: "NS-10488",
              payment_status: "pending",
            },
          ],
        } satisfies OrderListResponse),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/orders`);
    await screen.findByRole("link", { name: "NS-10488" });
    const filters = within(screen.getByRole("group", { name: "Filter orders" }));

    expect(filters.getByRole("button", { name: "Payment unsettled 1" })).toBeVisible();

    await user.click(filters.getByRole("button", { name: "Payment unsettled 1" }));

    expect(screen.getByRole("link", { name: "NS-10488" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "NS-10476" })).toBeNull();
  });

  /**
   * The rail's figure and this table are one listing, read once by the shop's shell and
   * handed to both (ADR 0056), so they cannot come to disagree — and a create moves them
   * together without a reload.
   */
  it("says on the rail what the table has rows", async () => {
    renderAt(`/shops/${SHOP_ID}/orders`);

    const table = await screen.findByRole("table");
    const rows = bodyRows(table);
    expect(rows).toBe(ORDERS.orders.length);
    const entry = railEntry("Orders");
    expect(within(entry).getByText(String(rows))).toBeVisible();
    expect(entry).toHaveAccessibleDescription(`${rows} orders`);
  });

  it("says, with no order yet, that an order needs an attached customer, and links to Customers", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/orders`, () =>
        HttpResponse.json({ orders: [] } satisfies OrderListResponse),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/orders`);

    await screen.findByText(/This shop has no order fixtures yet/);
    const card = indexCard("Order fixtures");
    expect(card).toHaveTextContent(/An order is placed by a customer attached to this shop/);
    expect(
      within(card).getByRole("link", { name: "attach or create one in Customers" }),
    ).toHaveAttribute("href", `/shops/${SHOP_ID}/customers`);
    // Not the miss: nothing has been searched for.
    expect(within(card).queryByText("No order matches this view.")).toBeNull();
  });

  it("offers a New order button rather than a form beside the table", async () => {
    renderAt(`/shops/${SHOP_ID}/orders`);

    await screen.findByRole("heading", { level: 1, name: "Orders" });
    // The side card is gone: creating is a page (PLAN-UX Slice 12).
    expect(screen.queryByRole("region", { name: "Create order" })).toBeNull();
    expect(screen.getByRole("link", { name: "New order" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/orders/new`,
    );
  });
});

describe("the new-order page", () => {
  /** The order a create makes, which is not one the fixture listing already holds. */
  const MADE_ORDER_ID = "4d5e6f70-8192-4a3b-9c4d-5e6f708192ab";

  /** The page, whose header carries Create and whose column carries the form. */
  async function newOrder() {
    const rendered = renderAt(`/shops/${SHOP_ID}/orders/new`);
    // The breadcrumb rather than the title: the title *is* the reference, and the prefill
    // lands as soon as the listing does, so "New order" is a heading this page holds only
    // until it knows what to call itself.
    await screen.findByText(/creating an order fixture/);
    return rendered;
  }

  /** The sticky header, where the breadcrumb, Cancel and Create are. */
  function pageHeader(): HTMLElement {
    const header = screen.getByRole("heading", { level: 1 }).closest("header");
    if (!header) throw new Error("the create page has no header");
    return header;
  }

  async function fillOrder(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole("option", { name: "Maya Laurent" });
    await user.selectOptions(screen.getByLabelText("Customer"), PROFILE_ID);
    await waitFor(() => expect(screen.getByLabelText("Reference")).toHaveValue("NS-10483"));
    await user.selectOptions(screen.getByLabelText("Variant"), "NS-ASJ-OB-M");
  }

  it("names Orders above it and becomes the reference as it is typed", async () => {
    const user = userEvent.setup();
    await newOrder();

    // In the page's own header, beside the back arrow — not the rail entry of the same name.
    expect(within(pageHeader()).getByRole("link", { name: "Orders" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/orders`,
    );
    expect(within(pageHeader()).getByLabelText("Back to Orders")).toBeVisible();
    expect(within(pageHeader()).getByText(/creating an order fixture/)).toBeVisible();

    await screen.findByRole("option", { name: "Maya Laurent" });
    await user.selectOptions(screen.getByLabelText("Customer"), PROFILE_ID);

    // The prefilled reference is the page's own title from the moment it lands in the field.
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "NS-10483" })).toBeVisible(),
    );
  });

  it("refuses Create while a line is missing, and says why on the control", async () => {
    const user = userEvent.setup();
    await newOrder();

    await screen.findByRole("option", { name: "Maya Laurent" });
    await user.selectOptions(screen.getByLabelText("Customer"), PROFILE_ID);
    await waitFor(() => expect(screen.getByLabelText("Reference")).toHaveValue("NS-10483"));
    // The only priced variant is already chosen; the operator takes it back off, and the page
    // does not put it back behind them.
    await waitFor(() => expect(screen.getByLabelText("Variant")).toHaveValue("NS-ASJ-OB-M"));
    await user.selectOptions(screen.getByLabelText("Variant"), "");
    expect(screen.getByLabelText("Variant")).toHaveValue("");

    const create = screen.getByRole("button", { name: "Create order" });
    expectRefused(create, /at least one line/i);
    expect(create).toHaveAttribute("title", expect.stringMatching(/at least one line/i));
    expect(create).toHaveAccessibleDescription(/at least one line/i);
    // The reason is on screen as well as in `title`, which is never the only carrier.
    expect(screen.getByText(/An order needs at least one line/)).toBeVisible();

    await user.selectOptions(screen.getByLabelText("Variant"), "NS-ASJ-OB-M");
    expectNotRefused(screen.getByRole("button", { name: "Create order" }));
  });

  it("opens on the one attached customer and the one priced variant, and says so", async () => {
    await newOrder();

    const customer = screen.getByLabelText("Customer");
    await waitFor(() => expect(customer).toHaveValue(PROFILE_ID));
    await waitFor(() =>
      expect(customer).toHaveAccessibleDescription(
        /This one is the only customer attached to this shop, so it is already chosen\./,
      ),
    );
    const variant = screen.getByLabelText("Variant");
    expect(variant).toHaveValue("NS-ASJ-OB-M");
    await waitFor(() =>
      expect(variant).toHaveAccessibleDescription(
        /This one is the only priced variant in the catalog, so it is already chosen\./,
      ),
    );
    await waitFor(() => expect(screen.getByLabelText("Reference")).toHaveValue("NS-10483"));
    expectNotRefused(screen.getByRole("button", { name: "Create order" }));
  });

  it("asks for the customer before it will take one", async () => {
    const user = userEvent.setup();
    await newOrder();

    await screen.findByRole("option", { name: "Maya Laurent" });
    await waitFor(() => expect(screen.getByLabelText("Customer")).toHaveValue(PROFILE_ID));
    await user.selectOptions(screen.getByLabelText("Customer"), "");
    const create = screen.getByRole("button", { name: "Create order" });
    expectRefused(create, /needs the customer it belongs to/i);
    expect(create).toHaveAccessibleDescription(/needs the customer it belongs to/i);
  });

  it("creates the order with its line and lands in that order's editor", async () => {
    const user = userEvent.setup();
    const { router } = await newOrder();
    await fillOrder(user);

    await user.click(screen.getByRole("button", { name: "Create order" }));

    await waitFor(() => expect(createdOrders).toHaveLength(1));
    expect(createdOrders[0]).toMatchObject({
      reference: "NS-10483",
      customer_profile_id: PROFILE_ID,
    });
    // The contract wants an explicit offset; the browser resolves the picked day once.
    expect(String(createdOrders[0].placed_at)).toMatch(/Z$/);
    // `CreateOrderRequest` carries no lines, so the line the page refused to go without is
    // sent as a selection in the write that follows.
    expect(savedRequests).toHaveLength(1);
    expect(savedRequests[0].lines).toEqual([{ sku: "NS-ASJ-OB-M", quantity: 1 }]);
    // The customer's default entry, chosen from their book rather than typed.
    expect(savedRequests[0].shipping_address_id).toBe("home");

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/orders/${ORDER_ID}`),
    );
  });

  it("ships to the entry the operator picks from the customer's book", async () => {
    const user = userEvent.setup();
    await newOrder();
    await fillOrder(user);

    await user.click(await screen.findByRole("radio", { name: /Bordeaux/ }));
    await user.click(screen.getByRole("button", { name: "Create order" }));

    await waitFor(() => expect(savedRequests).toHaveLength(1));
    expect(savedRequests[0].shipping_address_id).toBe("bordeaux-previous-flat");
  });

  it("moves the rail's figure when an order is created from the page", async () => {
    const user = userEvent.setup();
    let listed = ORDERS.orders;
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/orders`, () => HttpResponse.json({ orders: listed })),
      http.post(`*/api/v1/shops/${SHOP_ID}/orders`, () => {
        listed = [
          ...listed,
          {
            ...ORDERS.orders[0],
            order_id: "4d5e6f70-8192-4a3b-9c4d-5e6f708192ab",
            reference: "NS-10483",
          },
        ];
        return HttpResponse.json(currentOrder, { status: 201 });
      }),
    );
    renderAt(`/shops/${SHOP_ID}/orders`);

    const table = await screen.findByRole("table");
    await waitFor(() => expect(bodyRows(table)).toBe(3));
    expect(within(railEntry("Orders")).getByText("3")).toBeVisible();

    await user.click(screen.getByRole("link", { name: "New order" }));
    await screen.findByText(/creating an order fixture/);
    await fillOrder(user);
    await user.click(screen.getByRole("button", { name: "Create order" }));

    // The create moved off the index with the form, and the refresh moved with it: the rail
    // is read again before the operator lands in the editor (ADR 0056).
    await waitFor(() => expect(within(railEntry("Orders")).getByText("4")).toBeVisible());
  });

  /**
   * A refresh is fired from a handler and has no controller to be cancelled by, so the only
   * thing that can say whether its answer is still wanted is which read started last
   * (ADR 0056). Without that, a save or a create whose refresh outlives a shop change writes
   * the shop the operator left onto the rail of the shop they are standing in — which is the
   * one thing a count on the chrome must never do.
   */
  it("drops a refresh that outlived the shop it was asked for", async () => {
    const user = userEvent.setup();
    let answer = () => {};
    let reached = () => {};
    const refreshed = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let reads = 0;
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/orders`, async () => {
        reads += 1;
        if (reads === 1) {
          return HttpResponse.json(ORDERS);
        }
        // The refresh the create below fires, held open until the operator has moved.
        reached();
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return HttpResponse.json({ orders: [...ORDERS.orders, ORDERS.orders[0]] });
      }),
      http.get(`*/api/v1/shops/${OTHER_SHOP_ID}/draft`, () =>
        HttpResponse.json({
          shop_id: OTHER_SHOP_ID,
          lifecycle_state: "draft",
          content: SHOP_CONTENT,
          created_at: "2026-08-23T12:00:00+00:00",
          updated_at: "2026-08-23T12:05:00+00:00",
        } satisfies ShopDraftResponse),
      ),
      http.get(`*/api/v1/shops/${OTHER_SHOP_ID}/draft/preview`, () =>
        HttpResponse.json({
          shop_id: OTHER_SHOP_ID,
          publishable: false,
          issues: [],
          changes: [],
          content_fingerprint: "d".repeat(64),
          latest_published_version: null,
          next_version: 1,
          matches_latest_published: false,
          content: SHOP_CONTENT,
        } satisfies ShopPreviewResponse),
      ),
    );
    const { router } = await newOrder();

    await fillOrder(user);
    await user.click(screen.getByRole("button", { name: "Create order" }));
    await refreshed;
    // The chip is what says the `POST` has landed and the page is holding an order, which is
    // the state the rest of this case is about.
    await screen.findByText("created · its line is not saved yet");

    // The same shell, a different shop. The order exists by now, so its unsaved line is an
    // edit to something that exists and the guard asks on the way out; Discard is the answer
    // that leaves the order as the lab holds it.
    // Not wrapped in `act`: a blocked navigation does not settle until the prompt is
    // answered, so awaiting it here would deadlock and not awaiting it inside `act` is the
    // interleaving React warns about. The queries below flush their own updates.
    const moved = router.navigate(`/shops/${OTHER_SHOP_ID}/orders`);
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    await user.click(within(prompt).getByRole("button", { name: "Discard and leave" }));
    await act(async () => {
      await moved;
    });

    // The listing is read again for the shop now on screen, and the other shop holds none.
    await waitFor(() => expect(within(railEntry("Orders")).getByText("0")).toBeVisible());

    answer();
    await waitFor(() => expect(reads).toBe(2));

    // The shop that was left answers four. The rail is not its rail any more.
    expect(within(railEntry("Orders")).queryByText("4")).toBeNull();
    expect(within(railEntry("Orders")).getByText("0")).toBeVisible();
  });

  it("puts each field's hint in that control's accessible description", async () => {
    await newOrder();

    expect(screen.getByLabelText("Customer")).toHaveAccessibleDescription(
      /only customers attached to this shop/i,
    );
    expect(screen.getByLabelText("Reference")).toHaveAccessibleDescription(
      /uppercase letters, digits, and hyphens.*named in tickets/i,
    );
    expect(screen.getByLabelText("Placed on")).toHaveAccessibleDescription(
      /calendar day the fixture was placed/i,
    );
    expect(screen.getByLabelText("Variant")).toHaveAccessibleDescription(/a line names a variant/i);
  });

  it("prefills the next free reference, resumes when emptied, and refuses a duplicate", async () => {
    const user = userEvent.setup();
    await newOrder();

    await screen.findByRole("option", { name: "Maya Laurent" });
    await user.selectOptions(screen.getByLabelText("Customer"), PROFILE_ID);
    await user.selectOptions(screen.getByLabelText("Variant"), "NS-ASJ-OB-M");
    await waitFor(() => expect(screen.getByLabelText("Reference")).toHaveValue("NS-10483"));
    await user.clear(screen.getByLabelText("Reference"));
    await user.type(screen.getByLabelText("Reference"), "NS-10999");
    await user.clear(screen.getByLabelText("Reference"));
    expect(screen.getByLabelText("Reference")).toHaveValue("");
    await user.tab();
    expect(screen.getByLabelText("Reference")).toHaveValue("NS-10483");

    await user.clear(screen.getByLabelText("Reference"));
    await user.type(screen.getByLabelText("Reference"), "NS-10482");
    expect(screen.getByLabelText("Reference")).toBeInvalid();
    expect(screen.getByLabelText("Reference")).toHaveAccessibleDescription(
      /ns-10482 is already used by an order in this shop/i,
    );
    // And the page will not go: a taken reference is one of the reasons Create states.
    expectRefused(
      screen.getByRole("button", { name: "Create order" }),
      /ns-10482 is already used by an order in this shop/i,
    );
    expect(screen.getByRole("button", { name: "Create order" })).toHaveAccessibleDescription(
      /ns-10482 is already used by an order in this shop/i,
    );
  });

  it.each([
    {
      why: "a series that ends at the cap",
      name: "Northstar Outfitters",
      orders: [`N${"S".repeat(60)}-99`],
      // One character too many beside the prefix whole: the prefix gives it up, not the number.
      expected: `N${"S".repeat(59)}-100`,
    },
    {
      why: "a series too long to be a number",
      name: "Northstar Outfitters",
      orders: [`NS-${"9".repeat(30)}`],
      expected: `NS-1${"0".repeat(30)}`,
    },
    {
      why: "a shop whose name has more initials than a reference holds",
      name: Array.from({ length: 70 }, (_, at) => `Word${at}`).join(" "),
      orders: [],
      expected: `${"W".repeat(SLUG_MAX_LENGTH - 2)}-1`,
    },
  ])(
    "suggests a reference the lab keeps for $why, and creates it",
    async ({ name, orders, expected }) => {
      const user = userEvent.setup();
      expect(expected.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
      const content = { ...SHOP_CONTENT, identity: { ...SHOP_CONTENT.identity, name } };
      server.use(
        http.get(`*/api/v1/shops/${SHOP_ID}/draft`, () =>
          HttpResponse.json({
            shop_id: SHOP_ID,
            lifecycle_state: "draft",
            content,
            created_at: "2026-08-23T12:00:00+00:00",
            updated_at: "2026-08-23T12:05:00+00:00",
          } satisfies ShopDraftResponse),
        ),
        http.get(`*/api/v1/shops/${SHOP_ID}/orders`, () =>
          HttpResponse.json({
            orders: orders.map((reference) => ({ ...ORDERS.orders[0], reference })),
          }),
        ),
      );
      await newOrder();

      await screen.findByRole("option", { name: "Maya Laurent" });
      await user.selectOptions(screen.getByLabelText("Customer"), PROFILE_ID);
      await user.selectOptions(screen.getByLabelText("Variant"), "NS-ASJ-OB-M");
      const field = screen.getByLabelText("Reference");
      await waitFor(() => expect(field).toHaveValue(expected));

      expect(field).toBeValid();
      expect(field).not.toHaveAttribute("aria-invalid");
      expect(field).not.toHaveAccessibleDescription(/at most/);
      const create = screen.getByRole("button", { name: "Create order" });
      expectNotRefused(create);
      await user.click(create);
      await waitFor(() => expect(createdOrders).toHaveLength(1));
      expect(createdOrders[0]).toMatchObject({ reference: expected });
    },
  );

  it("refuses a reference an uppercased ß lengthened past the cap, on the field and on Create", async () => {
    const user = userEvent.setup();
    await newOrder();

    await screen.findByRole("option", { name: "Maya Laurent" });
    await user.selectOptions(screen.getByLabelText("Customer"), PROFILE_ID);
    await user.selectOptions(screen.getByLabelText("Variant"), "NS-ASJ-OB-M");
    const field = screen.getByLabelText("Reference");
    await waitFor(() => expect(field).toHaveValue("NS-10483"));
    const create = screen.getByRole("button", { name: "Create order" });

    // Typed, a character the field uppercases into two lengthens the value past the cap, which
    // `maxLength` cannot stop: "ß" is "SS". It stops the *next* keystroke only, so 64 of them
    // end at the cap — and one typed into the last free place ends one past it.
    await user.clear(field);
    await user.type(field, "ß".repeat(SLUG_MAX_LENGTH));
    expect(field).toHaveValue("S".repeat(SLUG_MAX_LENGTH));
    await user.clear(field);
    await user.type(field, `${"S".repeat(SLUG_MAX_LENGTH - 1)}ß`);
    expect(field).toHaveValue("S".repeat(SLUG_MAX_LENGTH + 1));
    const doubled = tooLongMessage(SLUG_MAX_LENGTH + 1, SLUG_MAX_LENGTH);
    expect(field).toBeInvalid();
    expect(field).toHaveAccessibleDescription(new RegExp(doubled));
    expectRefused(create, doubled);
    await user.click(create);
    expect(createdOrders).toEqual([]);

    // Typed, the field stops at the cap, and the order can be made.
    await user.clear(field);
    await user.type(field, "X".repeat(SLUG_MAX_LENGTH + 3));
    expect(field).toHaveValue("X".repeat(SLUG_MAX_LENGTH));
    expectNotRefused(create);
  });

  it("takes no reference until it knows which references are free", async () => {
    let release: (() => void) | null = null;
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/orders`, async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json(ORDERS);
      }),
    );
    await newOrder();

    // Which reference is free is exactly what the listing still has to say. A field that is
    // open for typing before it lands writes the suggestion over whatever was typed into it.
    expect(screen.getByLabelText("Reference")).toBeDisabled();
    expect(screen.getByLabelText("Reference")).toHaveValue("");

    (release as unknown as () => void)();
    await waitFor(() => expect(screen.getByLabelText("Reference")).toBeEnabled());
    // Enabled and already holding the suggestion: never enabled and empty.
    expect(screen.getByLabelText("Reference")).toHaveValue("NS-10483");
  });

  it("does not guess a reference after the listing fails to load", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/orders`, () =>
        HttpResponse.json(
          { code: "unavailable", message: "The listing could not be read.", request_id: "r" },
          { status: 503 },
        ),
      ),
    );
    await newOrder();
    expect(await screen.findByRole("alert")).toHaveTextContent(/listing could not be read/i);
    expect(screen.getByLabelText("Reference")).toHaveValue("");
  });

  it("keeps a refused create on the page and does not make a second order on the retry", async () => {
    const user = userEvent.setup();
    let puts = 0;
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, async ({ request }) => {
        puts += 1;
        if (puts === 1) {
          return HttpResponse.json(
            { code: "invalid", message: "That line is not in the catalog.", request_id: "r" },
            { status: 422 },
          );
        }
        savedRequests.push((await request.json()) as ReplaceOrderRequest);
        return HttpResponse.json(currentOrder);
      }),
    );
    const { router } = await newOrder();
    await fillOrder(user);

    await user.click(screen.getByRole("button", { name: "Create order" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/not in the catalog/i);
    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/orders/new`);
    expect(createdOrders).toHaveLength(1);

    // Creating an order is two writes, so a retry finishes the one that failed rather than
    // making a second fixture under a second reference.
    await user.click(screen.getByRole("button", { name: "Create order" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/orders/${ORDER_ID}`),
    );
    expect(createdOrders).toHaveLength(1);
    expect(puts).toBe(2);
  });

  /**
   * The consequence a late refresh has, in the one place an operator would meet it.
   *
   * The `POST` changes the listing whether or not the `PUT` that follows it lands, and
   * ADR 0056's rule is about what the surface *did*: refreshing only on the way out leaves
   * the index and the rail an order short after a refusal, and — the part that bites — the
   * next create reads the stale rows for the next free reference and offers one the lab has
   * already taken, which the backend then refuses for an order the operator cannot see.
   *
   * Fails against a page that refreshes only after the `PUT`: the second visit suggests
   * NS-10483 again.
   */
  it("reads the listing again as soon as the order exists, refused line or not", async () => {
    const user = userEvent.setup();
    let listed = ORDERS.orders;
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/orders`, () => HttpResponse.json({ orders: listed })),
      http.post(`*/api/v1/shops/${SHOP_ID}/orders`, async ({ request }) => {
        createdOrders.push((await request.json()) as Record<string, unknown>);
        listed = [
          ...listed,
          { ...ORDERS.orders[0], order_id: MADE_ORDER_ID, reference: "NS-10483" },
        ];
        return HttpResponse.json(
          {
            ...currentOrder,
            order_id: MADE_ORDER_ID,
            content: { ...currentOrder.content, reference: "NS-10483", lines: [] },
          } satisfies ShopOrderResponse,
          { status: 201 },
        );
      }),
      http.put(`*/api/v1/shops/${SHOP_ID}/orders/${MADE_ORDER_ID}`, () =>
        HttpResponse.json(
          { code: "invalid", message: "That line is not in the catalog.", request_id: "r" },
          { status: 422 },
        ),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/orders`);

    await screen.findByRole("table");
    expect(within(railEntry("Orders")).getByText("3")).toBeVisible();

    await user.click(screen.getByRole("link", { name: "New order" }));
    await screen.findByText(/creating an order fixture/);
    await fillOrder(user);
    await user.click(screen.getByRole("button", { name: "Create order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not in the catalog/i);

    // The order exists, so the rail says so even though the page has not finished.
    await waitFor(() => expect(within(railEntry("Orders")).getByText("4")).toBeVisible());
    // And it says what is standing rather than "nothing created yet".
    expect(screen.getByText("created · its line is not saved yet")).toBeVisible();
    // The reference the operator is still editing is not refused as taken by its own order.
    expect(screen.getByLabelText("Reference")).toHaveValue("NS-10483");
    expect(screen.getByLabelText("Reference")).toBeValid();

    // Leaving strands the line and the address, which is an edit to something that exists
    // now, so the guard asks — and Discard leaves the lineless order the lab holds.
    await user.click(screen.getByRole("link", { name: "Cancel" }));
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(prompt).toHaveTextContent(/NS-10483 was created without its line/);
    await user.click(within(prompt).getByRole("button", { name: "Discard and leave" }));

    await waitFor(() => expect(bodyRows(screen.getByRole("table"))).toBe(4));

    // The next create reads the rows the lab actually holds, so it steps past the reference
    // the refused attempt already used.
    await user.click(screen.getByRole("link", { name: "New order" }));
    await screen.findByText(/creating an order fixture/);
    await waitFor(() => expect(screen.getByLabelText("Reference")).toHaveValue("NS-10484"));
  });

  it("finishes a refused create from the prompt rather than abandoning the order", async () => {
    const user = userEvent.setup();
    let puts = 0;
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, async ({ request }) => {
        puts += 1;
        if (puts === 1) {
          return HttpResponse.json(
            { code: "invalid", message: "That line is not in the catalog.", request_id: "r" },
            { status: 422 },
          );
        }
        savedRequests.push((await request.json()) as ReplaceOrderRequest);
        return HttpResponse.json(currentOrder);
      }),
    );
    const { router } = await newOrder();
    await fillOrder(user);
    await user.click(screen.getByRole("button", { name: "Create order" }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("link", { name: "Cancel" }));
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    await user.click(within(prompt).getByRole("button", { name: "Save and leave" }));

    await waitFor(() => expect(savedRequests).toHaveLength(1));
    expect(savedRequests[0].lines).toEqual([{ sku: "NS-ASJ-OB-M", quantity: 1 }]);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/orders`));
    expect(createdOrders).toHaveLength(1);
  });

  it("sends the reference the operator corrected after a refusal, not the one it froze", async () => {
    const user = userEvent.setup();
    let puts = 0;
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, async ({ request }) => {
        puts += 1;
        if (puts === 1) {
          return HttpResponse.json(
            { code: "invalid", message: "That line is not in the catalog.", request_id: "r" },
            { status: 422 },
          );
        }
        savedRequests.push((await request.json()) as ReplaceOrderRequest);
        return HttpResponse.json(currentOrder);
      }),
    );
    await newOrder();
    await fillOrder(user);
    await user.click(screen.getByRole("button", { name: "Create order" }));
    await screen.findByRole("alert");

    await user.clear(screen.getByLabelText("Reference"));
    await user.type(screen.getByLabelText("Reference"), "NS-20001");
    await user.click(screen.getByRole("button", { name: "Create order" }));

    await waitFor(() => expect(savedRequests).toHaveLength(1));
    // Retyping after a refusal is not thrown away, and the title above is not left naming
    // an order the lab does not hold.
    expect(savedRequests[0].reference).toBe("NS-20001");
    expect(createdOrders).toHaveLength(1);
  });

  it("lands in the editor even when the listing it re-reads cannot be read", async () => {
    const user = userEvent.setup();
    let reads = 0;
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/orders`, () => {
        reads += 1;
        return reads === 1
          ? HttpResponse.json(ORDERS)
          : HttpResponse.json(
              { code: "unavailable", message: "The listing could not be read.", request_id: "r" },
              { status: 503 },
            );
      }),
    );
    const { router } = await newOrder();
    await fillOrder(user);
    await user.click(screen.getByRole("button", { name: "Create order" }));

    // The refresh is how the rail keeps up, not a condition of the create: an order that
    // exists takes the operator to its editor whatever the listing then answers.
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/orders/${ORDER_ID}`),
    );
  });

  /**
   * ADR 0051: *Discard and leave* "throws each piece away … and proceeds".
   *
   * `submit` outlives the page — it is a plain async continuation — so answering the prompt
   * while its `PUT` is in flight has to stop it, not merely un-block the navigation. Left
   * running it would write, mark itself landed, re-read the listing through a closure that
   * may belong to a shop nobody is standing in, and navigate an operator who has gone
   * somewhere else into an order editor.
   *
   * Fails against a page whose continuation does not check that it has been left: the
   * router ends on the order editor and the `PUT` lands.
   */
  it("stops the running create when the prompt is answered with Discard", async () => {
    const user = userEvent.setup();
    let release = () => {};
    let reached = () => {};
    const putting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, async ({ request }) => {
        reached();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        savedRequests.push((await request.json()) as ReplaceOrderRequest);
        return HttpResponse.json(currentOrder);
      }),
    );
    const { router } = await newOrder();
    await fillOrder(user);
    await user.click(screen.getByRole("button", { name: "Create order" }));
    await putting;
    await screen.findByText("created · its line is not saved yet");

    const leaving = router.navigate(`/shops/${SHOP_ID}/orders`);
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    await user.click(within(prompt).getByRole("button", { name: "Discard and leave" }));
    await act(async () => {
      await leaving;
    });
    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/orders`);

    // The write that was in flight is let go of, and nothing that follows it happens.
    release();
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/orders`));
    expect(screen.queryByRole("heading", { level: 1, name: "NS-10483" })).toBeNull();
    // The order the lab already holds is left as it is: created, with no line.
    expect(createdOrders).toHaveLength(1);
  });

  /**
   * The same rule where it bites hardest: the continuation's `refresh` belongs to the shop
   * the page was opened in, and `listings.ts`'s counter orders reads that have already
   * started — a stale closure starting one *later* becomes the latest and lands. So a run
   * that has been left must not start one at all (ADR 0056, ADR 0051).
   */
  it("writes nothing to the shop the operator has moved on from", async () => {
    const user = userEvent.setup();
    let release = () => {};
    let reached = () => {};
    const putting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, async ({ request }) => {
        reached();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        savedRequests.push((await request.json()) as ReplaceOrderRequest);
        return HttpResponse.json(currentOrder);
      }),
      http.get(`*/api/v1/shops/${OTHER_SHOP_ID}/draft`, () =>
        HttpResponse.json({
          shop_id: OTHER_SHOP_ID,
          lifecycle_state: "draft",
          content: SHOP_CONTENT,
          created_at: "2026-08-23T12:00:00+00:00",
          updated_at: "2026-08-23T12:05:00+00:00",
        } satisfies ShopDraftResponse),
      ),
      http.get(`*/api/v1/shops/${OTHER_SHOP_ID}/draft/preview`, () =>
        HttpResponse.json({
          shop_id: OTHER_SHOP_ID,
          publishable: false,
          issues: [],
          changes: [],
          content_fingerprint: "d".repeat(64),
          latest_published_version: null,
          next_version: 1,
          matches_latest_published: false,
          content: SHOP_CONTENT,
        } satisfies ShopPreviewResponse),
      ),
    );
    const { router } = await newOrder();
    await fillOrder(user);
    await user.click(screen.getByRole("button", { name: "Create order" }));
    await putting;
    await screen.findByText("created · its line is not saved yet");

    const leaving = router.navigate(`/shops/${OTHER_SHOP_ID}/orders`);
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    await user.click(within(prompt).getByRole("button", { name: "Discard and leave" }));
    await act(async () => {
      await leaving;
    });
    await waitFor(() => expect(within(railEntry("Orders")).getByText("0")).toBeVisible());

    release();
    await act(async () => {
      await Promise.resolve();
    });

    // The shop that was left does not reach across into the one on screen — neither its
    // count, nor its order's editor.
    await waitFor(() => expect(within(railEntry("Orders")).getByText("0")).toBeVisible());
    expect(within(railEntry("Orders")).queryByText("4")).toBeNull();
    expect(router.state.location.pathname).toBe(`/shops/${OTHER_SHOP_ID}/orders`);
  });

  /**
   * The prompt's Save and the run owe the same second write, and the run's is the one already
   * on its way: it started first.
   *
   * Two writes are two continuations each deciding what happens when one lands. The run's
   * `PUT` resumes first, marks itself landed, re-reads and navigates into the editor; the
   * guard lets it through because the work now reaches its destination; the router resets
   * every blocker as it completes that navigation; and the `proceed()` the prompt captured
   * then throws `unblocked -> proceeding` out of a promise the click handler voided. What the
   * operator gets is two idempotent `PUT`s, one unhandled rejection, and the editor of what
   * they made after asking for the index.
   *
   * Fails against a `save` that writes again rather than joining: two `PUT`s.
   */
  it("joins the second write already in flight rather than sending another", async () => {
    const user = userEvent.setup();
    let puts = 0;
    let release = () => {};
    let reached = () => {};
    const putting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, async ({ request }) => {
        puts += 1;
        const body = (await request.json()) as ReplaceOrderRequest;
        // Only the run's is held. A second one is let through, so that a page sending two
        // deadlocks nothing and is caught by the count instead.
        if (puts === 1) {
          reached();
          await held;
        }
        savedRequests.push(body);
        return HttpResponse.json(currentOrder);
      }),
    );
    const { router } = await newOrder();
    await fillOrder(user);
    await user.click(screen.getByRole("button", { name: "Create order" }));
    await putting;
    await screen.findByText("created · its line is not saved yet");

    const leaving = router.navigate(`/shops/${SHOP_ID}/orders`);
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    await user.click(within(prompt).getByRole("button", { name: "Save and leave" }));

    release();
    await act(async () => {
      await leaving;
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // One write, one order, and the operator is on the index they asked for rather than in
    // the editor of what they just made.
    expect(puts).toBe(1);
    expect(savedRequests).toHaveLength(1);
    expect(savedRequests[0].lines).toEqual([{ sku: "NS-ASJ-OB-M", quantity: 1 }]);
    expect(createdOrders).toHaveLength(1);
    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/orders`);
  });

  /**
   * The window the stand-down inside the registered `save` closes, which is an ordering rather
   * than a case.
   *
   * The obvious one does not bite: with the save's own post-write re-read already settled the
   * page has unmounted and the unmount setter covers whatever is left. What the setter is for
   * is the interval while that re-read is still pending. So every listing read after the
   * `POST` is held — the run's, and then the save's — and the run's is released while the
   * save's is still held, which is the only moment the two are distinguishable.
   *
   * Fails against a `save` that does not stand the run down: the run resumes into the write
   * it was going to make, sends a second `PUT`, and takes the operator into the editor.
   */
  it("stands the run down from the prompt's Save, before the save's own re-read lands", async () => {
    const user = userEvent.setup();
    let puts = 0;
    let reads = 0;
    const holding: (() => void)[] = [];
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/orders`, async () => {
        reads += 1;
        if (reads > 1) {
          await new Promise<void>((resolve) => {
            holding.push(resolve);
          });
        }
        return HttpResponse.json(ORDERS);
      }),
      http.put(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, async ({ request }) => {
        puts += 1;
        savedRequests.push((await request.json()) as ReplaceOrderRequest);
        return HttpResponse.json(currentOrder);
      }),
    );
    const { router } = await newOrder();
    await fillOrder(user);
    await user.click(screen.getByRole("button", { name: "Create order" }));

    // The `POST` has landed and the run is inside the re-read that follows it, which is
    // where it will be waiting when the answer to the prompt arrives.
    await screen.findByText("created · its line is not saved yet");
    await waitFor(() => expect(reads).toBe(2));

    const leaving = router.navigate(`/shops/${SHOP_ID}/orders`);
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    await user.click(within(prompt).getByRole("button", { name: "Save and leave" }));

    // The save's write has landed and it is now inside a re-read of its own.
    await waitFor(() => expect(reads).toBe(3));
    expect(puts).toBe(1);

    // The run's read, while the save's is still held: the run resumes here or nowhere.
    holding[0]();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(puts).toBe(1);

    holding[1]();
    await act(async () => {
      await leaving;
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(puts).toBe(1);
    expect(createdOrders).toHaveLength(1);
    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/orders`);
  });

  /**
   * Where the number has to be burnt: before this hand's own write, not after it.
   *
   * The run that needs standing down here is not the one with a write in the air. That one is
   * joined, and `save` resumes before it either way round — the run awaits the promise
   * `complete` returns, `save` awaits the write itself — so the joined case proves nothing
   * about placement. It is the run parked in the listing read that follows its `POST`. That
   * read is a *macrotask*: it can answer while this Save's own `PUT` is still on its way, and
   * a run that found its number intact there would resume into the write it was about to make
   * and navigate on top of the hand that is leaving.
   *
   * So this case holds the save's write open and answers the run's read underneath it, which
   * is an ordering every other case here avoids by letting the write settle first.
   *
   * Fails against a `save` that burns the number after its await: a second `PUT`.
   */
  it("burns the run's number before its own write, not after it", async () => {
    const user = userEvent.setup();
    let puts = 0;
    let reads = 0;
    let releaseWrite = () => {};
    const writeHeld = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const holding: (() => void)[] = [];
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/orders`, async () => {
        reads += 1;
        if (reads > 1) {
          await new Promise<void>((resolve) => {
            holding.push(resolve);
          });
        }
        return HttpResponse.json(ORDERS);
      }),
      http.put(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, async ({ request }) => {
        puts += 1;
        const body = (await request.json()) as ReplaceOrderRequest;
        await writeHeld;
        savedRequests.push(body);
        return HttpResponse.json(currentOrder);
      }),
    );
    const { router } = await newOrder();
    await fillOrder(user);
    await user.click(screen.getByRole("button", { name: "Create order" }));

    // The run is parked in the re-read that follows its `POST`, which is before its own
    // write: there is nothing in flight for the Save below to join.
    await screen.findByText("created · its line is not saved yet");
    await waitFor(() => expect(reads).toBe(2));

    const leaving = router.navigate(`/shops/${SHOP_ID}/orders`);
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    await user.click(within(prompt).getByRole("button", { name: "Save and leave" }));

    // The Save's own write has reached the lab and is held there, unanswered.
    await waitFor(() => expect(puts).toBe(1));

    // And now the read the run is parked in answers, underneath that write. This is the
    // window, and the run has to find its number already gone.
    holding[0]();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(puts).toBe(1);

    // The rest runs out as it would: the write lands, the Save re-reads, the operator leaves.
    releaseWrite();
    await waitFor(() => expect(reads).toBe(3));
    holding[1]();
    await act(async () => {
      await leaving;
    });
    expect(puts).toBe(1);
    expect(savedRequests).toHaveLength(1);
    expect(createdOrders).toHaveLength(1);
    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/orders`);
  });

  /**
   * A refused Save and leave hands the page back. It must not hand the run back with it.
   *
   * The Save that was refused stood a run down to make its own write — a run suspended in the
   * re-read that follows the `POST`, which had not reached its write yet — and it then has to
   * restore the page, because the operator is still here with a Create to press again. A
   * single flag cannot do both: *stood down* and *free to run* are one value in it, so the
   * suspended run resumes into the write it was going to make, sends a second `PUT`, and
   * navigates somebody reading *that did not save* into the editor of what they were leaving.
   * A number can: the run holds the one it took, and a retry press takes a fresh one rather
   * than reviving anybody.
   *
   * Fails against a `save` that restores the run's licence on a refusal: two `PUT`s, and the
   * page the operator is reading goes out from under them.
   */
  it("leaves the run it stood down standing down when its own save is refused", async () => {
    const user = userEvent.setup();
    let puts = 0;
    let reads = 0;
    const holding: (() => void)[] = [];
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/orders`, async () => {
        reads += 1;
        if (reads > 1) {
          await new Promise<void>((resolve) => {
            holding.push(resolve);
          });
        }
        return HttpResponse.json(ORDERS);
      }),
      http.put(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, () => {
        puts += 1;
        return HttpResponse.json(
          { code: "invalid", message: "That line is not in the catalog.", request_id: "r" },
          { status: 422 },
        );
      }),
    );
    const { router } = await newOrder();
    await fillOrder(user);
    await user.click(screen.getByRole("button", { name: "Create order" }));

    // The `POST` has landed and the run is suspended in the re-read that follows it, which
    // is before its own write: there is nothing in flight for the Save below to join.
    await screen.findByText("created · its line is not saved yet");
    await waitFor(() => expect(reads).toBe(2));

    const leaving = router.navigate(`/shops/${SHOP_ID}/orders`);
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    await user.click(within(prompt).getByRole("button", { name: "Save and leave" }));

    // The Save wrote for itself and was refused. The navigation stays pending and the prompt
    // says so, which is the state the operator is left reading.
    await waitFor(() => expect(puts).toBe(1));
    expect(await within(prompt).findByText(/did not save/i)).toBeVisible();

    // And now the read the run is waiting on answers.
    holding[0]();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // It writes nothing and takes nobody anywhere: the operator is still on the create page,
    // still reading the refusal, with one order and one `PUT` behind them.
    expect(puts).toBe(1);
    expect(createdOrders).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/orders/new`);

    // And the retry the refusal invites is a run of its own, so the page is not left inert.
    expectNotRefused(screen.getByRole("button", { name: "Create order" }));

    // Settle the navigation this case left pending rather than leaving it to the teardown.
    await user.click(within(prompt).getByRole("button", { name: "Discard and leave" }));
    await act(async () => {
      await leaving;
    });
  });

  /**
   * The residue an abandoned create used to leave, and the reason it no longer does.
   *
   * Leaving while the `POST` is in flight registers nothing — there is no order yet to hold
   * an edit to — so the page simply goes, and the order the lab then makes is a row no
   * listing has been told about. The run may now say so: `useReading` drops a read whose
   * subject the shell has moved off, so the `refresh` a stood-down run captured is safe to
   * call and this is the one thing it still does (ADR 0056, ADR 0059).
   *
   * Fails against a run that stands down without re-reading: the index and the rail stay
   * three until the shop is entered again.
   */
  it("re-reads the listing its own create changed, after the operator has walked away", async () => {
    const user = userEvent.setup();
    let listed = ORDERS.orders;
    let release = () => {};
    let reached = () => {};
    const posting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/orders`, () => HttpResponse.json({ orders: listed })),
      http.post(`*/api/v1/shops/${SHOP_ID}/orders`, async ({ request }) => {
        createdOrders.push((await request.json()) as Record<string, unknown>);
        reached();
        await held;
        listed = [
          ...listed,
          { ...ORDERS.orders[0], order_id: MADE_ORDER_ID, reference: "NS-10483" },
        ];
        return HttpResponse.json(
          {
            ...currentOrder,
            order_id: MADE_ORDER_ID,
            content: { ...currentOrder.content, reference: "NS-10483", lines: [] },
          } satisfies ShopOrderResponse,
          { status: 201 },
        );
      }),
    );
    const { router } = await newOrder();
    await fillOrder(user);
    await user.click(screen.getByRole("button", { name: "Create order" }));
    await posting;

    // Nothing exists yet, so nothing is unsaved and Cancel asks nothing (ADR 0051).
    await user.click(screen.getByRole("link", { name: "Cancel" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/orders`));
    expect(screen.queryByRole("dialog")).toBeNull();

    release();

    // The order the lab made is a row of this shop's listing, and the index the operator is
    // standing on says so without being entered again.
    await waitFor(() => expect(bodyRows(screen.getByRole("table"))).toBe(4));
    expect(within(railEntry("Orders")).getByText("4")).toBeVisible();
  });

  /**
   * The same read, where it must not land.
   *
   * `useReading` orders reads with a counter on which the last-started wins, and a stood-down
   * run starts its read *after* the shell has already started the new shop's — so the counter
   * alone would make the shop that was left the answer. What drops it is that its `load` is
   * no longer the one this holder reads (ADR 0059).
   *
   * Fails against a holder that orders reads by when they started and nothing else: the rail
   * of the shop on screen answers with the rows of the shop that was left.
   */
  it("never lands that read on the shop the operator moved to", async () => {
    const user = userEvent.setup();
    let release = () => {};
    let reached = () => {};
    const posting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/orders`, async ({ request }) => {
        createdOrders.push((await request.json()) as Record<string, unknown>);
        reached();
        await held;
        return HttpResponse.json(currentOrder, { status: 201 });
      }),
      http.get(`*/api/v1/shops/${OTHER_SHOP_ID}/draft`, () =>
        HttpResponse.json({
          shop_id: OTHER_SHOP_ID,
          lifecycle_state: "draft",
          content: SHOP_CONTENT,
          created_at: "2026-08-23T12:00:00+00:00",
          updated_at: "2026-08-23T12:05:00+00:00",
        } satisfies ShopDraftResponse),
      ),
      http.get(`*/api/v1/shops/${OTHER_SHOP_ID}/draft/preview`, () =>
        HttpResponse.json({
          shop_id: OTHER_SHOP_ID,
          publishable: false,
          issues: [],
          changes: [],
          content_fingerprint: "d".repeat(64),
          latest_published_version: null,
          next_version: 1,
          matches_latest_published: false,
          content: SHOP_CONTENT,
        } satisfies ShopPreviewResponse),
      ),
    );
    const { router } = await newOrder();
    await fillOrder(user);
    await user.click(screen.getByRole("button", { name: "Create order" }));
    await posting;

    // The same shell, another shop — and nothing to ask about, because the `POST` has not
    // answered and this page holds no edit to anything that exists.
    await act(async () => {
      await router.navigate(`/shops/${OTHER_SHOP_ID}/orders`);
    });
    await waitFor(() => expect(within(railEntry("Orders")).getByText("0")).toBeVisible());

    release();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // The shop that was left holds three orders and one more now. Neither figure is this
    // shop's, and neither reaches its rail.
    expect(within(railEntry("Orders")).getByText("0")).toBeVisible();
    expect(within(railEntry("Orders")).queryByText("3")).toBeNull();
    expect(within(railEntry("Orders")).queryByText("4")).toBeNull();
  });

  it("keeps the reference and the retry when the listing it re-reads fails", async () => {
    const user = userEvent.setup();
    let reads = 0;
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/orders`, () => {
        reads += 1;
        return reads === 1
          ? HttpResponse.json(ORDERS)
          : HttpResponse.json(
              { code: "unavailable", message: "The listing could not be read.", request_id: "r" },
              { status: 503 },
            );
      }),
      http.put(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, () =>
        HttpResponse.json(
          { code: "invalid", message: "That line is not in the catalog.", request_id: "r" },
          { status: 422 },
        ),
      ),
    );
    await newOrder();
    await fillOrder(user);
    await user.click(screen.getByRole("button", { name: "Create order" }));
    await screen.findByText("created · its line is not saved yet");

    // The listing failing is not the operator's problem to solve: the order exists and is
    // called what the lab called it, so the field keeps it and the retry is still pressable.
    expect(screen.getByLabelText("Reference")).toHaveValue("NS-10483");
    expect(screen.getByRole("heading", { level: 1, name: "NS-10483" })).toBeVisible();
    expectNotRefused(screen.getByRole("button", { name: "Create order" }));
  });

  it("hands the order's own reference back when the field is emptied after a refusal", async () => {
    const user = userEvent.setup();
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, () =>
        HttpResponse.json(
          { code: "invalid", message: "That line is not in the catalog.", request_id: "r" },
          { status: 422 },
        ),
      ),
    );
    await newOrder();
    await fillOrder(user);
    await user.click(screen.getByRole("button", { name: "Create order" }));
    await screen.findByText("created · its line is not saved yet");

    await user.clear(screen.getByLabelText("Reference"));
    await user.tab();

    // `DerivedIdField`'s own promise: emptied, the suggestion comes back — and after a
    // create the suggestion is the reference the order actually has.
    expect(screen.getByLabelText("Reference")).toHaveValue("NS-10483");
  });

  it("fixes the customer at creation, because the second write cannot move one", async () => {
    const user = userEvent.setup();
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, () =>
        HttpResponse.json(
          { code: "invalid", message: "That line is not in the catalog.", request_id: "r" },
          { status: 422 },
        ),
      ),
    );
    await newOrder();
    await fillOrder(user);
    expect(screen.getByLabelText("Customer")).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Create order" }));
    await screen.findByText("created · its line is not saved yet");

    // `ReplaceOrderRequest` carries no customer and the lab keeps the one the order was
    // made for, so a select that stayed live would let the form name somebody the order
    // does not belong to — and send an address out of the wrong book.
    expect(screen.getByLabelText("Customer")).toBeDisabled();
    expect(screen.getByLabelText("Customer")).toHaveAccessibleDescription(
      /a customer is fixed at creation/i,
    );
  });

  it("returns to the index with nothing created when Cancel is pressed", async () => {
    const user = userEvent.setup();
    const { router } = await newOrder();

    await screen.findByRole("option", { name: "Maya Laurent" });
    await user.selectOptions(screen.getByLabelText("Customer"), PROFILE_ID);
    await user.click(screen.getByRole("link", { name: "Cancel" }));

    // A half-typed create form is not an edit to something that exists, so nothing asks
    // about it on the way out (ADR 0051).
    await waitFor(() => expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/orders`));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(createdOrders).toHaveLength(0);
  });
});

describe("order editor", () => {
  it("goes back to Orders from the ← above the reference", async () => {
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);

    await expectWayBack("Orders", `/shops/${SHOP_ID}/orders`, "order fixture");
  });
  it("shows the frozen shipping address with its source label and provenance", async () => {
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);

    expect(await screen.findByRole("heading", { name: "NS-10482" })).toBeVisible();
    const shipping = card("Fulfilment & shipping");
    // The label appears on the frozen card and as the selected address-book entry.
    expect(within(shipping).getAllByText("Bordeaux — previous flat")).toHaveLength(2);
    expect(within(shipping).getByText(/42 cours de la Marne/)).toBeVisible();
    // Every field the frozen copy kept, region included: a tool answering with this address
    // returns one the author cannot read back here otherwise.
    expect(within(shipping).getByText(/33800 Bordeaux · Nouvelle-Aquitaine · FR/)).toBeVisible();
    expect(within(shipping).getByText("Frozen copy")).toBeVisible();
    expect(within(shipping).getByText(/address-book edits never change this order/)).toBeVisible();
    // The mismatch the wrong-address scenario exploits is visible to the author.
    expect(within(shipping).getByText(/Differs from the default/)).toBeVisible();
  });

  it("offers only the statuses the backend says are reachable", async () => {
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });

    const options = within(card("Line items & payment")).getByLabelText("Payment status");
    expect(
      Array.from(options.querySelectorAll("option")).map((option) => option.textContent),
    ).toEqual(["Paid", "Refunded"]);
  });

  it("recalculates the total when an edited quantity is saved, before the save round trip", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });
    const lines = card("Line items & payment");

    // Typed and not yet saved, the quantity is the form's: the order and its totals wait.
    await user.click(within(lines).getByRole("button", { name: "Edit NS-ASJ-OB-M" }));
    await user.clear(within(lines).getByLabelText("Quantity"));
    await user.type(within(lines).getByLabelText("Quantity"), "3");
    expect(within(lines).queryByText("747.00 EUR")).toBeNull();

    await user.click(within(lines).getByRole("button", { name: "Save changes" }));

    // The line's detail, the subtotal, and the order total all follow the quantity.
    expect(within(lines).getByText("3 × 249.00 EUR = 747.00 EUR")).toBeVisible();
    expect(within(lines).getAllByText("747.00 EUR")).toHaveLength(2);
  });

  it("saves selections rather than materialized commerce content", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });

    await setQuantity(user, "NS-ASJ-OB-M", "2");
    await user.click(screen.getByRole("button", { name: "Save order" }));

    await waitFor(() => expect(savedRequests).toHaveLength(1));
    expect(savedRequests[0].lines).toEqual([{ sku: "NS-ASJ-OB-M", quantity: 2 }]);
    expect(savedRequests[0].shipping_address_id).toBe("bordeaux-previous-flat");
    expect(JSON.stringify(savedRequests[0])).not.toContain("249.00");
    expect(await screen.findByText("All changes saved")).toBeInTheDocument();
  });

  it("announces that reselecting freezes a new copy", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });
    const shipping = card("Fulfilment & shipping");

    await user.selectOptions(within(shipping).getByLabelText("Ship to"), "home");

    expect(within(shipping).getByText(/Saving freezes a new copy of “Home”/)).toBeVisible();
    // Until it is saved the order still ships to the copy it froze.
    expect(within(shipping).getByText(/42 cours de la Marne/)).toBeVisible();
  });

  it("reports the findings the lab returns without repairing them", async () => {
    currentOrder = {
      ...PAID_ORDER,
      issues: [
        {
          severity: "warning",
          code: "shipping_address_source_removed",
          message:
            "the address-book entry this order was shipped to no longer exists; the frozen copy is unchanged",
          path: "shipping_address.source_address_id",
        },
      ],
    };
    currentProfile = { ...PROFILE_CONTENT, addresses: [PROFILE_CONTENT.addresses[0]] };
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);

    expect(await screen.findByRole("heading", { name: "NS-10482" })).toBeVisible();
    const findings = card("Findings");
    expect(within(findings).getByText(/no longer exists/)).toBeVisible();
    expect(within(findings).getByText("Warning")).toBeVisible();
    expect(within(card("Fulfilment & shipping")).getByText(/42 cours de la Marne/)).toBeVisible();
  });

  /**
   * The gate rule the `order-fixture` journey used to read on a freshly created order.
   *
   * It cannot read it there any more: the create page refuses to go without a line
   * (PLAN-UX Slice 12), so no order reaches its editor lineless from that door. The rule
   * itself has not moved — `order_without_line` in `domain/order_fixture.py`, covered by
   * `test_order_domain.py` and `test_order_api.py` — and the state is still reachable in
   * this editor, which is the one surface that can take the last line off an order. So the
   * assertion moves here, where what it proves is what the deleted one proved: that an
   * order left with no line to derive a total from reports it, and that the workspace
   * prints the lab's sentence rather than one of its own. The sentence below is this
   * suite's stub speaking, so nothing here pins it to `domain/order_fixture.py`; the two
   * backend cases named above are what hold the gate to its wording.
   */
  it("shows the gate's own words when the last line is taken off an order", async () => {
    const user = userEvent.setup();
    const lineless =
      "an order must carry at least one line item, because its totals are derived from them";
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, async ({ request }) => {
        const body = (await request.json()) as ReplaceOrderRequest;
        savedRequests.push(body);
        // What the lab answers for an order with nothing to total, as the gate writes it.
        return HttpResponse.json({
          ...currentOrder,
          content: { ...currentOrder.content, lines: [] },
          issues:
            body.lines.length === 0
              ? [
                  {
                    severity: "error",
                    code: "order_without_line",
                    message: lineless,
                    path: "lines",
                  },
                ]
              : [],
        } satisfies ShopOrderResponse);
      }),
    );
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);

    await screen.findByRole("heading", { name: "NS-10482" });
    await user.click(screen.getByRole("button", { name: "Remove NS-ASJ-OB-M" }));
    await user.click(screen.getByRole("button", { name: "Remove it" }));
    expect(
      screen.getByText("No line item yet, so the order has nothing to derive its totals from."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save order" }));

    await waitFor(() => expect(savedRequests).toHaveLength(1));
    expect(savedRequests[0].lines).toEqual([]);
    expect(
      within(await screen.findByRole("region", { name: "Findings" })).getByText(lineless),
    ).toBeVisible();
  });

  it("adds a line item from the catalog rather than typed content", async () => {
    const user = userEvent.setup();
    currentOrder = {
      ...PAID_ORDER,
      content: { ...PAID_ORDER.content, lines: [], subtotal: { amount: "0.00", currency: "EUR" } },
    };
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });
    const lines = card("Line items & payment");

    await user.selectOptions(within(lines).getByLabelText("Variant"), "NS-ASJ-OB-M");
    await user.clear(within(lines).getByLabelText("Quantity"));
    await user.type(within(lines).getByLabelText("Quantity"), "2");
    await user.click(within(lines).getByRole("button", { name: "Add line" }));

    // The item reads what the catalog froze: the product and variant, the SKU, the arithmetic.
    const item = within(lines).getByText("Alpine Shell Jacket · Ocean Blue").closest("li");
    expect(item).not.toBeNull();
    expect(
      within(item as HTMLElement).getByText("NS-ASJ-OB-M", { selector: "code" }),
    ).toBeVisible();
    expect(within(item as HTMLElement).getByText("2 × 249.00 EUR = 498.00 EUR")).toBeVisible();
    // The form is blank again, and adds.
    expect(within(lines).getByRole("group", { name: "Add a line" })).toBeVisible();
  });

  it("opens Variant on the one variant the order does not hold yet, and says so", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });
    const lines = card("Line items & payment");
    const picker = within(lines).getByLabelText("Variant");
    // The catalog's one priced variant is on the order: nothing to offer, nothing chosen.
    expect(picker).toHaveValue("");
    expect(picker).not.toHaveAccessibleDescription(/already chosen/);

    // Taking the line off leaves one candidate, and the form opens on it.
    await user.click(screen.getByRole("button", { name: "Remove NS-ASJ-OB-M" }));
    await user.click(screen.getByRole("button", { name: "Remove it" }));
    await waitFor(() => expect(picker).toHaveValue("NS-ASJ-OB-M"));
    await waitFor(() =>
      expect(picker).toHaveAccessibleDescription(
        "This one is the only priced variant not yet on this order, so it is already chosen.",
      ),
    );
    // A choice the lab made is not something the operator typed: the prompt asks about the
    // removal, which is the order's, and not about the form.
    await user.click(railEntry("Orders"));
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(prompt).toHaveTextContent("This order has unsaved changes.");
    expect(prompt).not.toHaveTextContent(/Line items form/);
  });

  it("keeps a quantity the contract could not carry out of the order", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });
    const lines = card("Line items & payment");
    await user.click(within(lines).getByRole("button", { name: "Edit NS-ASJ-OB-M" }));
    const quantity = within(lines).getByLabelText("Quantity");
    const save = within(lines).getByRole("button", { name: "Save changes" });

    for (const typed of ["", "0", "1000", "1.5"]) {
      await user.clear(quantity);
      if (typed !== "") {
        await user.type(quantity, typed);
      }
      // Said after the button, on the field that breaks it; the order keeps what it had.
      expectRefused(save, LINE_QUANTITY_RULE);
      expect(quantity).toHaveAttribute("aria-invalid", "true");
      expect(quantity).toHaveAccessibleDescription(expect.stringContaining(LINE_QUANTITY_RULE));
    }
    await user.click(save);
    await submitWithoutPressing(save);
    expect(within(lines).getByRole("group", { name: "Edit NS-ASJ-OB-M" })).toBeVisible();
    expect(within(lines).getByText("1 × 249.00 EUR = 249.00 EUR")).toBeVisible();
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("refuses to save a shipping fee that is not an amount", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });

    const fee = screen.getByLabelText("Shipping fee");
    expect(fee).toHaveAttribute("inputmode", "decimal");
    // The rule is in the field's description before it is broken, not only once it is.
    expect(fee).toHaveAccessibleDescription(/at most two decimals/i);
    await user.clear(fee);
    await user.type(fee, "abc");

    expect(fee).toBeInvalid();
    await user.click(screen.getByRole("button", { name: "Save order" }));

    // Nothing was sent, and the reason is on the page rather than the fee quietly counting
    // as zero in the total beside it.
    expect(savedRequests).toHaveLength(0);
    expect(screen.getByText(/The shipping fee is not an amount/)).toBeVisible();

    await user.clear(fee);
    await user.type(fee, "4.90");
    expect(fee).toBeValid();
    await user.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() => expect(savedRequests).toHaveLength(1));
    expect(savedRequests[0].shipping_fee_amount).toBe("4.90");
  });

  it("lets an author step back from a delete", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Keep it" }));

    expect(deleted).toEqual([]);
    expect(screen.getByRole("button", { name: "Delete" })).toBeVisible();
  });

  it("deletes on one press with the second press turned off, and says it once", async () => {
    window.localStorage.setItem("agent-lab.confirm-before-delete", "false");
    try {
      const user = userEvent.setup();
      const { router } = renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
      await screen.findByRole("heading", { name: "NS-10482" });

      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(screen.queryByRole("group", { name: /Delete order/ })).toBeNull();
      await waitFor(() => expect(deleted).toEqual([ORDER_ID]));
      expect(await screen.findByRole("heading", { name: "Orders" })).toBeVisible();
      const said = await screen.findByText("Deleted order NS-10482.");
      await waitFor(() => expect(said).toHaveFocus());
      expect(screen.getAllByText("Deleted order NS-10482.")).toHaveLength(1);

      // Back to the order and forward to the index: the history entry no longer carries it.
      await act(() => router.navigate(-1));
      await screen.findByRole("heading", { name: "NS-10482" });
      await act(() => router.navigate(1));
      expect(await screen.findByRole("heading", { name: "Orders" })).toBeVisible();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.queryByText("Deleted order NS-10482.")).toBeNull();
    } finally {
      window.localStorage.removeItem("agent-lab.confirm-before-delete");
    }
  });

  it("deletes an order and returns to the index", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleted).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => expect(deleted).toEqual([ORDER_ID]));
    expect(await screen.findByRole("heading", { name: "Orders" })).toBeVisible();
    // The editor unmounted, so the index says what was deleted and focus is left there.
    const said = await screen.findByText("Deleted order NS-10482.");
    await waitFor(() => expect(said).toHaveFocus());
  });

  it("does not ask about edits to an order it has just deleted", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });

    // Unsaved work on a fixture the operator has chosen to destroy is not work to ask about.
    const fee = screen.getByLabelText("Shipping fee");
    await user.clear(fee);
    await user.type(fee, "9.90");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete permanently" }));

    expect(await screen.findByRole("heading", { name: "Orders" })).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a failed save visible instead of pretending it worked", async () => {
    const user = userEvent.setup();
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, () =>
        HttpResponse.json(
          {
            code: "order_transition_error",
            message: "payment status cannot move from paid to pending",
            request_id: "r",
          },
          { status: 422 },
        ),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });

    await setQuantity(user, "NS-ASJ-OB-M", "2");
    await user.click(screen.getByRole("button", { name: "Save order" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot move from paid to pending/);
    expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled();
  });
});

/**
 * An order's lines as the list edited in the form below it (ADR 0074): items under *Items*, one
 * form that adds a line or edits the one chosen, the variant fixed while editing because the lab
 * keys a line on its SKU, and every refusal in one line after the buttons.
 */
describe("the line items, edited in the form below them", () => {
  const SECOND_VARIANT = {
    sku: "NS-ASJ-OB-L",
    option_values: [{ key: "color", value: "Ocean Blue" }],
    availability: "in_stock" as const,
    stock_quantity: 4,
    price: { amount: "259.00", currency: "EUR" as const },
  };

  /** A catalog of two priced variants, so an empty order has a choice to make. */
  function withTwoVariants() {
    withCatalog([...SHOP_CONTENT.products[0].variants, SECOND_VARIANT]);
  }

  function withCatalog(variants: ShopDraftResponse["content"]["products"][number]["variants"]) {
    const [product] = SHOP_CONTENT.products;
    const content = { ...SHOP_CONTENT, products: [{ ...product, variants }] };
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/draft`, () =>
        HttpResponse.json({
          shop_id: SHOP_ID,
          lifecycle_state: "draft",
          content,
          created_at: "2026-08-23T12:00:00+00:00",
          updated_at: "2026-08-23T12:05:00+00:00",
        } satisfies ShopDraftResponse),
      ),
    );
  }

  function withoutLines() {
    currentOrder = { ...PAID_ORDER, content: { ...PAID_ORDER.content, lines: [] } };
  }

  const SECOND_LINE: ShopOrderResponse["content"]["lines"][number] = {
    id: "ns-asj-ob-l",
    sku: "NS-ASJ-OB-L",
    product_handle: "alpine-shell-jacket",
    title: "Alpine Shell Jacket",
    variant_summary: "Ocean Blue · L",
    unit_price: { amount: "259.00", currency: "EUR" },
    quantity: 1,
    line_total: { amount: "259.00", currency: "EUR" },
  };

  async function openLines() {
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });
    return card("Line items & payment");
  }

  it("lists each line as an item under Items, named by its SKU on its controls", async () => {
    const lines = await openLines();
    const items = within(lines).getByRole("group", { name: "Items" });

    const [item] = within(items).getAllByRole("listitem");
    expect(within(item).getByText("Alpine Shell Jacket · Ocean Blue · M")).toBeVisible();
    expect(within(item).getByText("NS-ASJ-OB-M", { selector: "code" })).toBeVisible();
    expect(within(item).getByText("1 × 249.00 EUR = 249.00 EUR")).toBeVisible();
    expect(within(item).getByRole("button", { name: "Edit NS-ASJ-OB-M" })).toBeVisible();
    expect(within(item).getByRole("button", { name: "Remove NS-ASJ-OB-M" })).toBeVisible();
    // No quantity is typed in place any more, and the form below adds.
    expect(within(lines).queryByRole("spinbutton", { name: /Quantity for/ })).toBeNull();
    expect(within(lines).getByRole("group", { name: "Add a line" })).toBeVisible();
  });

  it("loads a line with its variant fixed, and saves its quantity where it stands", async () => {
    const user = userEvent.setup();
    const lines = await openLines();
    const edit = within(lines).getByRole("button", { name: "Edit NS-ASJ-OB-M" });

    await user.click(edit);

    const form = within(lines).getByRole("group", { name: "Edit NS-ASJ-OB-M" });
    expect(edit.closest("li")).toHaveAttribute("aria-current", "true");
    // The variant is shown and cannot be changed: the lab holds the line by its SKU.
    const variant = within(form).getByLabelText("Variant");
    expect(variant).toHaveValue("Alpine Shell Jacket · NS-ASJ-OB-M");
    expect(variant).toHaveAttribute("readonly");
    expect(within(form).queryByRole("combobox", { name: "Variant" })).toBeNull();
    const quantity = within(form).getByLabelText("Quantity");
    expect(quantity).toHaveValue(1);
    expect(quantity).toHaveFocus();
    // At the form grid's full width, as the methods handoff draws every field (ADR 0074).
    expect(quantity).toHaveClass("w-full");

    await user.clear(quantity);
    await user.type(quantity, "1000");
    const save = within(form).getByRole("button", { name: "Save changes" });
    expectRefused(save, LINE_QUANTITY_RULE);
    await user.clear(quantity);
    await user.type(quantity, "2");
    expectNotRefused(save);
    await user.click(save);

    expect(within(lines).getByText("2 × 249.00 EUR = 498.00 EUR")).toBeVisible();
    expect(within(lines).getAllByText("498.00 EUR")).toHaveLength(2);
    expect(within(lines).getByRole("button", { name: "Edit NS-ASJ-OB-M" })).toHaveFocus();
    expect(within(lines).getByRole("group", { name: "Add a line" })).toBeVisible();
    expect(
      within(lines).getByRole("button", { name: "Edit NS-ASJ-OB-M" }).closest("li"),
    ).not.toHaveAttribute("aria-current");
  });

  it("keeps the price a line was frozen at when its quantity is saved", async () => {
    const user = userEvent.setup();
    // The catalog has been repriced since the line was authored at 249.00.
    const [variant] = SHOP_CONTENT.products[0].variants;
    withCatalog([{ ...variant, price: { amount: "199.00", currency: "EUR" } }]);
    const lines = await openLines();

    await setQuantity(user, "NS-ASJ-OB-M", "2");

    expect(within(lines).getByText("2 × 249.00 EUR = 498.00 EUR")).toBeVisible();
    expect(within(lines).queryByText(/199\.00/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() => expect(savedRequests).toHaveLength(1));
    // The request selects the line; it never carries a price the lab would re-freeze.
    expect(savedRequests[0].lines).toEqual([{ sku: "NS-ASJ-OB-M", quantity: 2 }]);
    expect(JSON.stringify(savedRequests[0])).not.toContain("199.00");
    expect(await within(lines).findByText("2 × 249.00 EUR = 498.00 EUR")).toBeVisible();
  });

  it("edits the second of two lines where it stands", async () => {
    const user = userEvent.setup();
    withTwoVariants();
    currentOrder = {
      ...PAID_ORDER,
      content: { ...PAID_ORDER.content, lines: [...PAID_ORDER.content.lines, SECOND_LINE] },
    };
    const lines = await openLines();

    await setQuantity(user, "NS-ASJ-OB-L", "3");

    const items = within(within(lines).getByRole("group", { name: "Items" })).getAllByRole(
      "listitem",
    );
    expect(
      items.map((entry) => within(entry).getByText(/^NS-/, { selector: "code" }).textContent),
    ).toEqual(["NS-ASJ-OB-M", "NS-ASJ-OB-L"]);
    expect(within(items[0]).getByText("1 × 249.00 EUR = 249.00 EUR")).toBeVisible();
    expect(within(items[1]).getByText("3 × 259.00 EUR = 777.00 EUR")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() => expect(savedRequests).toHaveLength(1));
    expect(savedRequests[0].lines).toEqual([
      { sku: "NS-ASJ-OB-M", quantity: 1 },
      { sku: "NS-ASJ-OB-L", quantity: 3 },
    ]);
  });

  it("leaves the order clean when an untouched line is saved", async () => {
    const user = userEvent.setup();
    const lines = await openLines();

    await user.click(within(lines).getByRole("button", { name: "Edit NS-ASJ-OB-M" }));
    await user.click(within(lines).getByRole("button", { name: "Save changes" }));

    expect(within(lines).getByRole("button", { name: "Edit NS-ASJ-OB-M" })).toHaveFocus();
    expect(within(lines).getByRole("group", { name: "Add a line" })).toBeVisible();
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("keeps a line typed in the form when the variants it could choose change under it", async () => {
    const user = userEvent.setup();
    withTwoVariants();
    const lines = await openLines();
    const variant = within(lines).getByLabelText("Variant");
    const quantity = within(lines).getByLabelText("Quantity");
    // The order holds M, so L is the one candidate and the form opens on it.
    expect(variant).toHaveValue("NS-ASJ-OB-L");

    await user.clear(quantity);
    await user.type(quantity, "4");
    await user.click(within(lines).getByRole("button", { name: "Remove NS-ASJ-OB-M" }));
    await user.click(within(lines).getByRole("button", { name: "Remove it" }));

    // Two candidates now, and no sole one to open on — but the form holds what was typed.
    expect(variant).toHaveValue("NS-ASJ-OB-L");
    expect(quantity).toHaveValue(4);
    await user.click(railEntry("Orders"));
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(prompt).toHaveTextContent(
      "The Line items form holds a line that has not been added to the order.",
    );
  });

  it("refuses Add line, rather than doing nothing, when a discard brings back the chosen variant's line", async () => {
    const user = userEvent.setup();
    withTwoVariants();
    const lines = await openLines();

    await user.click(within(lines).getByRole("button", { name: "Remove NS-ASJ-OB-M" }));
    await user.click(within(lines).getByRole("button", { name: "Remove it" }));
    const variant = within(lines).getByLabelText("Variant");
    await user.selectOptions(variant, "NS-ASJ-OB-M");
    expectNotRefused(within(lines).getByRole("button", { name: "Add line" }));

    // The discard reads the order back, M's line with it: M is no longer one to add.
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await within(lines).findByText("1 × 249.00 EUR = 249.00 EUR");

    const add = within(lines).getByRole("button", { name: "Add line" });
    expectRefused(add, LINE_VARIANT_RULE);
    expect(variant).toHaveAttribute("aria-invalid", "true");
    await user.click(add);
    await submitWithoutPressing(add);
    expect(
      within(within(lines).getByRole("group", { name: "Items" })).getAllByRole("listitem"),
    ).toHaveLength(1);
  });

  it("writes nothing on Cancel and hands focus back to the Edit", async () => {
    const user = userEvent.setup();
    const lines = await openLines();

    await user.click(within(lines).getByRole("button", { name: "Edit NS-ASJ-OB-M" }));
    await user.clear(within(lines).getByLabelText("Quantity"));
    await user.type(within(lines).getByLabelText("Quantity"), "7");
    await user.click(within(lines).getByRole("button", { name: "Cancel" }));

    expect(within(lines).getByText("1 × 249.00 EUR = 249.00 EUR")).toBeVisible();
    expect(within(lines).getByRole("button", { name: "Edit NS-ASJ-OB-M" })).toHaveFocus();
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("refuses a blank form without marking a field, then each rule in the order it asks", async () => {
    const user = userEvent.setup();
    withTwoVariants();
    withoutLines();
    const lines = await openLines();
    const form = within(lines).getByRole("group", { name: "Add a line" });
    const add = within(form).getByRole("button", { name: "Add line" });
    const variant = within(form).getByLabelText("Variant");
    const quantity = within(form).getByLabelText("Quantity");

    // Two candidates: nothing is chosen, and the form says so without marking anything yet.
    expect(variant).toHaveValue("");
    expectRefused(add, LINE_VARIANT_RULE);
    expect(variant).not.toHaveAttribute("aria-invalid");
    expect(quantity).not.toHaveAttribute("aria-invalid");
    expect(variant).not.toBeRequired();

    // The variant is asked before the quantity, so a bad quantity waits its turn.
    await user.clear(quantity);
    await user.type(quantity, "0");
    expectRefused(add, LINE_VARIANT_RULE);
    expect(variant).toHaveAttribute("aria-invalid", "true");
    expect(quantity).not.toHaveAttribute("aria-invalid");

    await user.selectOptions(variant, "NS-ASJ-OB-L");
    expectRefused(add, LINE_QUANTITY_RULE);
    expect(quantity).toHaveAttribute("aria-invalid", "true");
    expect(variant).not.toHaveAttribute("aria-invalid");
    await user.click(add);
    await submitWithoutPressing(add);
    expect(within(lines).queryAllByRole("listitem")).toHaveLength(0);

    await user.clear(quantity);
    await user.type(quantity, "3");
    expectNotRefused(add);
    await user.click(add);
    expect(within(lines).getByText("3 × 259.00 EUR = 777.00 EUR")).toBeVisible();
  });

  it("empties the form when the line it edits is removed", async () => {
    const user = userEvent.setup();
    const lines = await openLines();

    await user.click(within(lines).getByRole("button", { name: "Edit NS-ASJ-OB-M" }));
    await user.clear(within(lines).getByLabelText("Quantity"));
    await user.type(within(lines).getByLabelText("Quantity"), "5");
    await user.click(within(lines).getByRole("button", { name: "Remove NS-ASJ-OB-M" }));
    // The confirm takes the item's place, and the form still holds the edit until it is answered.
    const confirm = within(lines).getByRole("group", { name: /Remove the line NS-ASJ-OB-M/ });
    expect(confirm.closest("li")).not.toBeNull();
    expect(within(lines).getByRole("group", { name: "Edit NS-ASJ-OB-M" })).toBeVisible();
    await user.click(within(confirm).getByRole("button", { name: "Remove it" }));

    const form = within(lines).getByRole("group", { name: "Add a line" });
    expect(within(form).getByLabelText("Quantity")).toHaveValue(1);
    expect(within(lines).queryByRole("group", { name: "Edit NS-ASJ-OB-M" })).toBeNull();
    expect(within(lines).getByText("Removed the line NS-ASJ-OB-M from the order.")).toHaveFocus();
    // What it held is gone with the line, so the only unsaved work is the order's own.
    await user.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() => expect(savedRequests).toHaveLength(1));
    expect(savedRequests[0].lines).toEqual([]);
  });

  it("asks before leaving a line typed in its form, with the form's own reason", async () => {
    const user = userEvent.setup();
    withTwoVariants();
    withoutLines();
    const lines = await openLines();

    await user.selectOptions(within(lines).getByLabelText("Variant"), "NS-ASJ-OB-L");
    await user.click(railEntry("Orders"));

    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(prompt).toHaveTextContent(
      "The Line items form holds a line that has not been added to the order.",
    );
    expect(prompt).toHaveTextContent(itemFormReason("a line", "order"));
    expect(prompt).toHaveTextContent(
      "A line typed in its form cannot be saved from here: nothing in the form has reached the order yet.",
    );
    await user.click(within(prompt).getByRole("button", { name: "Discard and leave" }));
    expect(await screen.findByRole("heading", { name: "Orders" })).toBeVisible();
  });
});

/**
 * UI-2: the order editor's payment, fulfilment and shipping rows on the form pattern.
 *
 * Five of these controls were named twice — a wrapping `<label>` and an `aria-label` of the
 * same words: Payment status, Payment method, Fulfilment status, Fulfilment method and Ship
 * to. They are now named once, by the row; Paid at and Shipped at never carried the second
 * name. The assertion is that the name a reader hears did not move, and that the sentence
 * under Ship to, which was a paragraph beside the select, is in the select's description now
 * that it is the row's hint.
 */
describe("the field pattern on the order editor", () => {
  it("binds every payment and fulfilment row to its own control", async () => {
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });

    const payment = card("Line items & payment");
    for (const label of ["Payment status", "Payment method", "Paid at"] as const) {
      expect(within(payment).getByText(label).getAttribute("for")).toBe(
        within(payment).getByLabelText(label).id,
      );
    }

    const shipping = card("Fulfilment & shipping");
    for (const label of ["Fulfilment status", "Fulfilment method", "Shipped at"] as const) {
      expect(within(shipping).getByText(label).getAttribute("for")).toBe(
        within(shipping).getByLabelText(label).id,
      );
    }
  });

  it("gives each status, method and timestamp row the rule the save enforces", async () => {
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });

    const payment = within(card("Line items & payment"));
    // Both selects are built from `reachable_statuses`, so the row says what is missing
    // from them rather than leaving the operator to notice.
    expect(payment.getByLabelText("Payment status")).toHaveAccessibleDescription(
      /only the statuses reachable from the one saved/i,
    );
    expect(payment.getByLabelText("Payment status")).toHaveAccessibleDescription(/never back/i);
    expect(payment.getByLabelText("Paid at")).toHaveAccessibleDescription(
      /a pending or authorized order cannot record a capture time/i,
    );

    const shipping = within(card("Fulfilment & shipping"));
    expect(shipping.getByLabelText("Fulfilment status")).toHaveAccessibleDescription(
      /once fulfilled, a run can no longer change the address/i,
    );
    expect(shipping.getByLabelText("Shipped at")).toHaveAccessibleDescription(
      /an unfulfilled order cannot record a shipping time/i,
    );

    // One rule, both method selects: `_method_name` freezes the name for each the same way.
    for (const method of [
      payment.getByLabelText("Payment method"),
      shipping.getByLabelText("Fulfilment method"),
    ]) {
      expect(method).toHaveAccessibleDescription(wholeDescription(ORDER_METHOD_RULE));
    }
  });

  it("puts where the addresses come from in the Ship to select's description", async () => {
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });
    const shipping = card("Fulfilment & shipping");

    expect(within(shipping).getByLabelText("Ship to")).toHaveAccessibleDescription(
      /selected from the customer's address book — no free input/i,
    );
    // Still readable without a pointer, and still a link to the book it names.
    expect(
      within(shipping).getByRole("link", { name: "the customer's address book" }),
    ).toBeVisible();
  });
});

/**
 * A status move carries its timestamp with it, so a paid order is not left
 * owing `paid_order_without_capture_time`, and a move back is not refused by the lab for a
 * time the status no longer allows. `orders.test.ts` holds every pair of statuses; these hold
 * the page to the same moves, through to what the save sends.
 */
describe("a status moves the time beside it", () => {
  const AUTHORIZED_ORDER: ShopOrderResponse = {
    ...PAID_ORDER,
    content: {
      ...PAID_ORDER.content,
      payment: { ...PAID_ORDER.content.payment, status: "authorized", paid_at: null },
    },
    payment_status_options: ["authorized", "paid", "refunded"],
  };

  async function openEditor() {
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });
    return {
      payment: within(card("Line items & payment")),
      shipping: within(card("Fulfilment & shipping")),
    };
  }

  async function saved() {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() => expect(savedRequests).toHaveLength(1));
    return savedRequests[0];
  }

  it("says so under Paid at and Shipped at", async () => {
    const { payment, shipping } = await openEditor();
    expect(payment.getByLabelText("Paid at")).toHaveAccessibleDescription(
      wholeDescription(PAID_AT_RULE),
    );
    expect(shipping.getByLabelText("Shipped at")).toHaveAccessibleDescription(
      wholeDescription(SHIPPED_AT_RULE),
    );
  });

  it("fills an empty capture time with the placement time when the order is paid", async () => {
    const user = userEvent.setup();
    currentOrder = AUTHORIZED_ORDER;
    const { payment } = await openEditor();
    expect(payment.getByLabelText("Paid at")).toHaveValue("");

    await user.selectOptions(payment.getByLabelText("Payment status"), "paid");

    expect(payment.getByLabelText("Paid at")).toHaveValue(toLocalInput(PLACED_AT));
    expect((await saved()).payment).toMatchObject({ status: "paid", paid_at: PLACED_AT });
  });

  it("clears the capture time when the order moves back to authorized", async () => {
    const user = userEvent.setup();
    currentOrder = AUTHORIZED_ORDER;
    const { payment } = await openEditor();

    await user.selectOptions(payment.getByLabelText("Payment status"), "paid");
    await user.selectOptions(payment.getByLabelText("Payment status"), "authorized");

    expect(payment.getByLabelText("Paid at")).toHaveValue("");
    expect((await saved()).payment).toMatchObject({ status: "authorized", paid_at: null });
  });

  it("keeps a capture time the operator typed, and a refund keeps the one it has", async () => {
    const user = userEvent.setup();
    currentOrder = AUTHORIZED_ORDER;
    const { payment } = await openEditor();
    const typed = "2026-08-22T10:15";

    // Typed while authorized — which the lab would refuse on its own — then made paid.
    await user.type(payment.getByLabelText("Paid at"), typed);
    await user.selectOptions(payment.getByLabelText("Payment status"), "paid");
    expect(payment.getByLabelText("Paid at")).toHaveValue(typed);
    await user.selectOptions(payment.getByLabelText("Payment status"), "refunded");
    expect(payment.getByLabelText("Paid at")).toHaveValue(typed);

    expect((await saved()).payment).toMatchObject({
      status: "refunded",
      paid_at: new Date(typed).toISOString(),
    });
  });

  it("fills an empty shipping time once something ships, and clears it when nothing has", async () => {
    const user = userEvent.setup();
    const { shipping } = await openEditor();
    expect(shipping.getByLabelText("Shipped at")).toHaveValue("");

    await user.selectOptions(shipping.getByLabelText("Fulfilment status"), "partially_fulfilled");
    expect(shipping.getByLabelText("Shipped at")).toHaveValue(toLocalInput(PLACED_AT));
    // Between two shipped statuses the time is the operator's, and stays.
    await user.selectOptions(shipping.getByLabelText("Fulfilment status"), "fulfilled");
    expect(shipping.getByLabelText("Shipped at")).toHaveValue(toLocalInput(PLACED_AT));
    await user.selectOptions(shipping.getByLabelText("Fulfilment status"), "unfulfilled");
    expect(shipping.getByLabelText("Shipped at")).toHaveValue("");
    await user.selectOptions(shipping.getByLabelText("Fulfilment status"), "fulfilled");

    expect((await saved()).fulfilment).toMatchObject({
      status: "fulfilled",
      shipped_at: PLACED_AT,
    });
  });
});

/**
 * An order fixture is never published, so its gate card keeps the title "Findings" and its
 * freeze card "Freezing": the findings are `validate_order_fixture`'s and gate no publish.
 */
describe("the order editor's side panel", () => {
  it("holds the findings, the customer and freezing, in that order, and no field", async () => {
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);

    const panel = sidePanel(await screen.findByRole("region", { name: "Findings" }));

    expect(panelCards(panel)).toEqual(["Findings", "Customer", "Freezing"]);
    expect(panelFields(panel)).toEqual([]);
    expect(screen.queryByRole("region", { name: "Publish gate" })).toBeNull();
  });

  it("says its findings are the saved order's while an edit is unsaved, and is busy while the save is in flight", async () => {
    const user = userEvent.setup();
    let release: (() => void) | null = null;
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, async ({ request }) => {
        savedRequests.push((await request.json()) as ReplaceOrderRequest);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json(currentOrder);
      }),
    );
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });
    const findings = () => screen.getByRole("region", { name: "Findings" });
    const SAVED_ORDER = "Read off the saved order. Save to check what is on screen.";
    expect(within(findings()).queryByText(SAVED_ORDER)).toBeNull();
    expect(findings()).not.toHaveAttribute("aria-busy");

    await setQuantity(user, "NS-ASJ-OB-M", "2");

    expect(within(findings()).getByText(SAVED_ORDER)).toBeVisible();
    // The order has no gate to wait on: its findings come back with the save.
    expect(findings()).not.toHaveAttribute("aria-busy");

    await user.click(screen.getByRole("button", { name: "Save order" }));

    await waitFor(() => expect(findings()).toHaveAttribute("aria-busy", "true"));
    await waitFor(() => expect(release).not.toBeNull());
    (release as unknown as () => void)();
    await waitFor(() => expect(findings()).not.toHaveAttribute("aria-busy"));
    expect(within(findings()).queryByText(SAVED_ORDER)).toBeNull();
  });
});

/**
 * *Order events* is the list edited in the form below it (ADR 0074): a saved event is an item,
 * its pencil loads it into the one form, and a new one arrives through the same form — both
 * paths through `orderEventEntry`.
 */
describe("order events", () => {
  // An item's controls are named by what happened and the id the order keys it by — stable,
  // and unique where two events share a minute — while the item's detail reads the time.
  const PLACED_LABEL = "Placed · order-created";
  const CONTACT: ShopOrderResponse["content"]["events"][number] = {
    id: "support-contact",
    kind: "support_contact",
    occurred_at: CAPTURED_AT,
    summary: "Customer asked where the parcel was.",
  };
  const CONTACT_LABEL = "Support contact · support-contact";

  function withEvents(events: ShopOrderResponse["content"]["events"]) {
    currentOrder = { ...PAID_ORDER, content: { ...PAID_ORDER.content, events } };
  }

  async function openEditor() {
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });
    return card("Order events");
  }

  it("reads an event back as an item, and loads it into the form below on Edit", async () => {
    const user = userEvent.setup();
    const events = await openEditor();

    const item = within(events).getByText("Placed", { selector: "span" }).closest("li");
    expect(item).not.toBeNull();
    expect(
      within(item as HTMLElement).getByText("order-created", { selector: "code" }),
    ).toBeVisible();
    expect(
      within(item as HTMLElement).getByText(
        `${formatFixtureTimestamp(PLACED_AT)} · Order created — checkout, order page`,
      ),
    ).toBeVisible();
    expect(within(events).queryByRole("group", { name: `Edit ${PLACED_LABEL}` })).toBeNull();

    await user.click(within(events).getByRole("button", { name: `Edit ${PLACED_LABEL}` }));

    const form = within(events).getByRole("group", { name: `Edit ${PLACED_LABEL}` });
    expect(item).toHaveAttribute("aria-current", "true");
    expect(within(form).getByLabelText("Kind")).toHaveValue("placed");
    expect(within(form).getByLabelText("Kind")).toHaveFocus();
    expect(within(form).getByLabelText("Occurred at")).toHaveValue(toLocalInput(PLACED_AT));
    expect(within(form).getByLabelText("Summary")).toHaveValue(
      "Order created — checkout, order page",
    );
    // The identifier stays on the item and is never asked; the trash stays on the item too.
    expect(within(form).queryByLabelText("ID")).toBeNull();
    expect(within(events).getByRole("button", { name: `Remove ${PLACED_LABEL}` })).toBeVisible();
  });

  it("writes nothing on Cancel, and nothing typed in the form reaches the order's Save", async () => {
    const user = userEvent.setup();
    const events = await openEditor();

    // The order is dirty for another reason, so Save order is pressable while the form holds an edit.
    await user.selectOptions(
      within(card("Fulfilment & shipping")).getByLabelText("Fulfilment method"),
      "",
    );
    await user.click(within(events).getByRole("button", { name: `Edit ${PLACED_LABEL}` }));
    const form = within(events).getByRole("group", { name: `Edit ${PLACED_LABEL}` });
    await user.clear(within(form).getByLabelText("Summary"));
    await user.type(within(form).getByLabelText("Summary"), "Typed and never saved.");

    await user.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() => expect(savedRequests).toHaveLength(1));
    expect(savedRequests[0].events[0].summary).toBe("Order created — checkout, order page");

    await user.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(within(events).getByRole("button", { name: `Edit ${PLACED_LABEL}` })).toHaveFocus();
    expect(within(events).getByRole("group", { name: "Add an event" })).toBeVisible();
    expect(within(events).getByText(/Order created — checkout, order page/)).toBeVisible();
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("saves an edited event with exactly the payload the form adds for the same answers", async () => {
    const user = userEvent.setup();
    const events = await openEditor();
    const answers = { time: "2026-08-22T09:30", summary: "  Asked to reroute the parcel.  " };

    const add = within(events).getByRole("group", { name: "Add an event" });
    await user.selectOptions(within(add).getByLabelText("Kind"), "address_updated");
    await user.clear(within(add).getByLabelText("Occurred at"));
    await user.type(within(add).getByLabelText("Occurred at"), answers.time);
    await user.type(within(add).getByLabelText("Summary"), answers.summary);
    await user.click(within(add).getByRole("button", { name: "Add event" }));

    await user.click(within(events).getByRole("button", { name: `Edit ${PLACED_LABEL}` }));
    const form = within(events).getByRole("group", { name: `Edit ${PLACED_LABEL}` });
    await user.selectOptions(within(form).getByLabelText("Kind"), "address_updated");
    await user.clear(within(form).getByLabelText("Occurred at"));
    await user.type(within(form).getByLabelText("Occurred at"), answers.time);
    await user.clear(within(form).getByLabelText("Summary"));
    await user.type(within(form).getByLabelText("Summary"), answers.summary);
    await user.click(within(form).getByRole("button", { name: "Save changes" }));

    await user.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() => expect(savedRequests).toHaveLength(1));
    const [edited, added] = savedRequests[0].events;
    // The edit keeps the entry's own id; everything else is what the added one wrote.
    expect(edited.id).toBe("order-created");
    expect(added.id).toBe("event");
    expect({ ...edited, id: null }).toEqual({ ...added, id: null });
    expect(added.summary).toBe("Asked to reroute the parcel.");
  });

  it("keeps the instant an untouched time already holds", async () => {
    const user = userEvent.setup();
    withEvents([{ ...CONTACT, occurred_at: "2026-08-21T13:12:34Z" }]);
    const events = await openEditor();

    await user.click(within(events).getByRole("button", { name: `Edit ${CONTACT_LABEL}` }));
    const form = within(events).getByRole("group", { name: `Edit ${CONTACT_LABEL}` });
    await user.type(within(form).getByLabelText("Summary"), " Again.");
    await user.click(within(form).getByRole("button", { name: "Save changes" }));
    await user.click(screen.getByRole("button", { name: "Save order" }));

    await waitFor(() => expect(savedRequests).toHaveLength(1));
    expect(savedRequests[0].events[0]).toEqual({
      id: "support-contact",
      kind: "support_contact",
      occurred_at: "2026-08-21T13:12:34Z",
      summary: "Customer asked where the parcel was. Again.",
    });
  });

  it("leaves the order clean when an untouched event is saved", async () => {
    const user = userEvent.setup();
    const events = await openEditor();

    await user.click(within(events).getByRole("button", { name: `Edit ${PLACED_LABEL}` }));
    await user.click(within(events).getByRole("button", { name: "Save changes" }));

    expect(within(events).getByRole("button", { name: `Edit ${PLACED_LABEL}` })).toHaveFocus();
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("replaces what the form holds when another event's Edit is pressed", async () => {
    const user = userEvent.setup();
    withEvents([...PAID_ORDER.content.events, CONTACT]);
    const events = await openEditor();

    await user.click(within(events).getByRole("button", { name: `Edit ${PLACED_LABEL}` }));
    const other = within(events).getByRole("button", { name: `Edit ${CONTACT_LABEL}` });
    expect(other).toBeEnabled();
    await user.click(other);

    const form = within(events).getByRole("group", { name: `Edit ${CONTACT_LABEL}` });
    expect(within(form).getByLabelText("Summary")).toHaveValue(CONTACT.summary);
    expect(within(events).queryByRole("group", { name: `Edit ${PLACED_LABEL}` })).toBeNull();
    expect(other.closest("li")).toHaveAttribute("aria-current", "true");
    expect(
      within(events)
        .getByRole("button", { name: `Edit ${PLACED_LABEL}` })
        .closest("li"),
    ).not.toHaveAttribute("aria-current");
  });

  it("refuses Save changes with the reason when the summary is emptied", async () => {
    const user = userEvent.setup();
    const events = await openEditor();

    await user.click(within(events).getByRole("button", { name: `Edit ${PLACED_LABEL}` }));
    const form = within(events).getByRole("group", { name: `Edit ${PLACED_LABEL}` });
    const save = within(form).getByRole("button", { name: "Save changes" });
    const summary = within(form).getByLabelText("Summary");
    await user.clear(summary);

    // Emptied or only spaces, the summary is refused in the one line after the buttons.
    for (const typed of ["", "   "]) {
      if (typed !== "") {
        await user.type(summary, typed);
      }
      expectRefused(save, ORDER_EVENT_SUMMARY_RULE);
      expect(summary).toHaveAttribute("aria-invalid", "true");
      expect(summary).not.toBeRequired();
    }
    await user.click(save);
    await submitWithoutPressing(save);
    expect(within(events).getByRole("group", { name: `Edit ${PLACED_LABEL}` })).toBeVisible();
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("removes an event only on the second press, the confirm standing in the item's place", async () => {
    const user = userEvent.setup();
    withEvents([...PAID_ORDER.content.events, CONTACT]);
    const events = await openEditor();

    await user.click(within(events).getByRole("button", { name: `Remove ${CONTACT_LABEL}` }));

    const confirm = within(events).getByRole("group", {
      name: "Remove the support contact event?",
    });
    expect(confirm).toHaveFocus();
    expect(confirm.closest("li")).not.toBeNull();
    // Nothing has left the order yet: the item is asking, not gone.
    expect(within(events).queryByText(/Customer asked where the parcel was\./)).toBeNull();
    expect(screen.getByText("All changes saved")).toBeInTheDocument();

    await user.click(within(confirm).getByRole("button", { name: "Remove it" }));

    expect(within(events).queryByRole("group", { name: /Remove the support contact/ })).toBeNull();
    expect(
      within(events).getByText("Removed the support contact event from the order."),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() => expect(savedRequests).toHaveLength(1));
    expect(savedRequests[0].events.map((entry) => entry.id)).toEqual(["order-created"]);
  });

  it("empties the form when the event it edits is removed", async () => {
    const user = userEvent.setup();
    withEvents([...PAID_ORDER.content.events, CONTACT]);
    const events = await openEditor();

    await user.click(within(events).getByRole("button", { name: `Edit ${CONTACT_LABEL}` }));
    await user.type(within(events).getByLabelText("Summary"), " Twice.");
    await user.click(within(events).getByRole("button", { name: `Remove ${CONTACT_LABEL}` }));
    await user.click(within(events).getByRole("button", { name: "Remove it" }));

    const form = within(events).getByRole("group", { name: "Add an event" });
    expect(within(form).getByLabelText("Summary")).toHaveValue("");
    expect(within(form).getByLabelText("Kind")).toHaveValue("support_contact");
    expect(within(form).queryByRole("button", { name: "Save changes" })).toBeNull();
    // Add cannot write the removed event back: the form holds nothing of it.
    await user.click(railEntry("Orders"));
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(prompt).toHaveTextContent("This order has unsaved changes.");
    expect(prompt).not.toHaveTextContent(/Order events form/);
  });

  it("refuses a blank form without marking a field, then each rule in the order it asks", async () => {
    const user = userEvent.setup();
    const events = await openEditor();
    const form = within(events).getByRole("group", { name: "Add an event" });
    const add = within(form).getByRole("button", { name: "Add event" });
    const time = within(form).getByLabelText("Occurred at");
    const summary = within(form).getByLabelText("Summary");

    // It opens on a support contact at the moment the order was placed, and asks the summary:
    // refused and said, and nothing marked until something is typed.
    expect(within(form).getByLabelText("Kind")).toHaveValue("support_contact");
    expect(time).toHaveValue(toLocalInput(PLACED_AT));
    expectRefused(add, ORDER_EVENT_SUMMARY_RULE);
    expect(summary).not.toHaveAttribute("aria-invalid");
    expect(time).not.toHaveAttribute("aria-invalid");
    expect(summary).not.toBeRequired();
    expect(time).not.toBeRequired();

    // The time is asked before the summary, so a summary of spaces waits its turn.
    await user.clear(time);
    await user.type(summary, "   ");
    expectRefused(add, ORDER_EVENT_TIME_RULE);
    expect(time).toHaveAttribute("aria-invalid", "true");
    expect(summary).not.toHaveAttribute("aria-invalid");

    await user.type(time, "2026-08-22T09:30");
    expectRefused(add, ORDER_EVENT_SUMMARY_RULE);
    expect(summary).toHaveAttribute("aria-invalid", "true");
    expect(time).not.toHaveAttribute("aria-invalid");
    await user.click(add);
    await submitWithoutPressing(add);
    expect(within(events).getAllByRole("listitem")).toHaveLength(1);

    await user.clear(summary);
    await user.type(summary, "Customer called.");
    expectNotRefused(add);
    await user.click(add);

    expect(within(events).getAllByRole("listitem")).toHaveLength(2);
    expect(within(events).getByText(/Customer called\./)).toBeVisible();
    expect(within(events).getByLabelText("Summary")).toHaveValue("");
  });

  it("keeps the placement's own instant for a new event whose time was left alone", async () => {
    // The control spells a minute; a placement with seconds would otherwise come back as an
    // event seconds before it (`event_precedes_placement`).
    const user = userEvent.setup();
    const placedWithSeconds = "2026-08-20T14:55:42Z";
    currentOrder = {
      ...PAID_ORDER,
      content: { ...PAID_ORDER.content, placed_at: placedWithSeconds },
    };
    const events = await openEditor();
    const add = within(events).getByRole("group", { name: "Add an event" });

    await user.type(within(add).getByLabelText("Summary"), "Customer called.");
    await user.click(within(add).getByRole("button", { name: "Add event" }));
    await user.click(screen.getByRole("button", { name: "Save order" }));

    await waitFor(() => expect(savedRequests).toHaveLength(1));
    expect(savedRequests[0].events[1]).toMatchObject({
      id: "event",
      occurred_at: placedWithSeconds,
      summary: "Customer called.",
    });
  });

  it("refuses Add event at the lab's cap, in the lab's words, before any field", async () => {
    const user = userEvent.setup();
    withEvents(
      Array.from({ length: MAX_ORDER_EVENTS }, (_, index) => ({
        ...CONTACT,
        id: `contact-${index}`,
      })),
    );
    const events = await openEditor();
    const add = within(events).getByRole("group", { name: "Add an event" });
    const button = within(add).getByRole("button", { name: "Add event" });

    expectRefused(button, ORDER_EVENTS_CAP_RULE);
    // The cap is about the list, so it comes first and marks no field.
    await user.clear(within(add).getByLabelText("Occurred at"));
    expectRefused(button, ORDER_EVENTS_CAP_RULE);
    expect(within(add).getByLabelText("Occurred at")).not.toHaveAttribute("aria-invalid");

    // Editing one of the forty is not adding a forty-first.
    await user.click(
      within(events).getByRole("button", { name: "Edit Support contact · contact-0" }),
    );
    const form = within(events).getByRole("group", { name: "Edit Support contact · contact-0" });
    expectNotRefused(within(form).getByRole("button", { name: "Save changes" }));
  });

  it("asks before leaving an edited event, with the form's own reason, and not once it is cancelled", async () => {
    const user = userEvent.setup();
    const events = await openEditor();

    // Loaded and unchanged, the form holds nothing the order lacks.
    await user.click(within(events).getByRole("button", { name: `Edit ${PLACED_LABEL}` }));
    await user.type(within(events).getByLabelText("Summary"), " Again.");
    await user.click(railEntry("Orders"));

    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(prompt).toHaveTextContent(
      `The Order events form holds an edit to ${PLACED_LABEL} that has not reached the order.`,
    );
    expect(prompt).toHaveTextContent(itemFormReason("an event", "order"));
    await user.click(within(prompt).getByRole("button", { name: "Stay on this page" }));

    await user.click(within(events).getByRole("button", { name: "Cancel" }));
    await user.click(railEntry("Orders"));
    expect(await screen.findByRole("heading", { name: "Orders" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).toBeNull();
  });

  it("refuses Add line with its reason when every priced variant is already a line", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });
    const lines = card("Line items & payment");

    const add = within(lines).getByRole("button", { name: "Add line" });
    expectRefused(add, "Every priced variant in the catalog is already a line of this order.");
    // The rule is about the list, so no field is marked, typed into or not.
    await user.clear(within(lines).getByLabelText("Quantity"));
    await user.type(within(lines).getByLabelText("Quantity"), "2");
    expectRefused(add, "Every priced variant in the catalog is already a line of this order.");
    expect(within(lines).getByLabelText("Variant")).not.toHaveAttribute("aria-invalid");
    // Put back as it opened, the form is clean again and follows the list.
    await user.clear(within(lines).getByLabelText("Quantity"));
    await user.type(within(lines).getByLabelText("Quantity"), "1");

    await user.click(screen.getByRole("button", { name: "Remove NS-ASJ-OB-M" }));
    await user.click(screen.getByRole("button", { name: "Remove it" }));
    expectNotRefused(within(lines).getByRole("button", { name: "Add line" }));
  });
});
