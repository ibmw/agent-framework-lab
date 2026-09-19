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
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { renderApp } from "./test/app";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
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
    createdOrders.push((await request.json()) as Record<string, unknown>);
    return HttpResponse.json(currentOrder, { status: 201 });
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

describe("order index", () => {
  it("lists the shop's fixtures with their two status axes", async () => {
    renderAt(`/shops/${SHOP_ID}/orders`);

    expect(await screen.findByRole("heading", { name: "Orders" })).toBeVisible();
    expect(await screen.findByRole("link", { name: "NS-10482" })).toBeVisible();
    const table = within(screen.getByRole("table"));
    expect(table.getAllByText("Maya Laurent")).toHaveLength(2);
    expect(table.getAllByText("Paid")).toHaveLength(2);
    expect(table.getByText("Unfulfilled")).toBeVisible();
    expect(table.getByText("249.00 EUR")).toBeVisible();
  });

  it("filters to the orders a scenario still has work on", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders`);
    await screen.findByRole("link", { name: "NS-10482" });

    const filters = screen.getByRole("group", { name: "Filter orders" });
    await user.click(within(filters).getByRole("button", { name: /Unfulfilled/ }));

    expect(screen.getByRole("link", { name: "NS-10482" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "NS-10479" })).toBeNull();
  });

  it("creates an order for a customer attached to this shop", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders`);
    await screen.findByRole("heading", { name: "Orders" });
    const form = card("Create order");

    await within(form).findByRole("option", { name: "Maya Laurent" });
    await user.selectOptions(within(form).getByLabelText("Customer"), PROFILE_ID);
    await waitFor(() => expect(within(form).getByLabelText("Reference")).toHaveValue("NS-10483"));
    await user.click(within(form).getByRole("button", { name: "Create order" }));

    await waitFor(() => expect(createdOrders).toHaveLength(1));
    expect(createdOrders[0]).toMatchObject({
      reference: "NS-10483",
      customer_profile_id: PROFILE_ID,
    });
    // The contract wants an explicit offset; the browser resolves the picked day once.
    expect(String(createdOrders[0].placed_at)).toMatch(/Z$/);
  });

  it("puts each field's hint in that control's accessible description", async () => {
    renderAt(`/shops/${SHOP_ID}/orders`);

    const form = within(await screen.findByRole("region", { name: "Create order" }));
    expect(form.getByLabelText("Customer")).toHaveAccessibleDescription(
      /belongs to a customer attached to this shop/i,
    );
    expect(form.getByLabelText("Reference")).toHaveAccessibleDescription(
      /uppercase letters, digits, and hyphens.*named in tickets/i,
    );
    expect(form.getByLabelText("Placed on")).toHaveAccessibleDescription(
      /calendar day the fixture was placed/i,
    );
  });

  it("prefills the next free reference, resumes when emptied, and refuses a duplicate", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders`);
    const form = within(await screen.findByRole("region", { name: "Create order" }));

    await waitFor(() => expect(form.getByLabelText("Reference")).toHaveValue("NS-10483"));
    await user.clear(form.getByLabelText("Reference"));
    await user.type(form.getByLabelText("Reference"), "NS-10999");
    await user.clear(form.getByLabelText("Reference"));
    expect(form.getByLabelText("Reference")).toHaveValue("");
    await user.tab();
    expect(form.getByLabelText("Reference")).toHaveValue("NS-10483");

    await user.clear(form.getByLabelText("Reference"));
    await user.type(form.getByLabelText("Reference"), "NS-10482");
    expect(form.getByLabelText("Reference")).toBeInvalid();
    expect(form.getByLabelText("Reference")).toHaveAccessibleDescription(
      /ns-10482 is already used by an order in this shop/i,
    );
    await user.click(form.getByRole("button", { name: "Create order" }));
    expect(createdOrders).toHaveLength(0);
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
    renderAt(`/shops/${SHOP_ID}/orders`);
    const form = within(await screen.findByRole("region", { name: "Create order" }));

    // Which reference is free is exactly what the listing still has to say. A field that is
    // open for typing before it lands writes the suggestion over whatever was typed into it.
    expect(form.getByLabelText("Reference")).toBeDisabled();
    expect(form.getByLabelText("Reference")).toHaveValue("");

    (release as unknown as () => void)();
    await waitFor(() => expect(form.getByLabelText("Reference")).toBeEnabled());
    // Enabled and already holding the suggestion: never enabled and empty.
    expect(form.getByLabelText("Reference")).toHaveValue("NS-10483");
  });

  it("takes no reference while a create is in flight either", async () => {
    const user = userEvent.setup();
    let release: (() => void) | null = null;
    let reads = 0;
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/orders`, async () => {
        reads += 1;
        if (reads === 1) {
          return HttpResponse.json(ORDERS);
        }
        // The reload a create triggers, held open: the listing that decides the next free
        // reference has not answered yet, so neither has the suggestion.
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json({
          orders: [...ORDERS.orders, { ...ORDERS.orders[0], reference: "NS-10483" }],
        } satisfies OrderListResponse);
      }),
    );
    renderAt(`/shops/${SHOP_ID}/orders`);
    const form = within(await screen.findByRole("region", { name: "Create order" }));
    await form.findByRole("option", { name: "Maya Laurent" });
    await user.selectOptions(form.getByLabelText("Customer"), PROFILE_ID);
    await waitFor(() => expect(form.getByLabelText("Reference")).toHaveValue("NS-10483"));

    await user.click(form.getByRole("button", { name: "Create order" }));

    // The page stays here after a create, and the listing behind the suggestion is moving.
    // Left open, the field would be back where it started: empty, editable, and about to be
    // written over — or still showing the reference that has just been used.
    await waitFor(() => expect(form.getByLabelText("Reference")).toBeDisabled());
    expect(form.getByLabelText("Reference")).toHaveValue("");

    (release as unknown as () => void)();
    await waitFor(() => expect(form.getByLabelText("Reference")).toBeEnabled());
    expect(form.getByLabelText("Reference")).toHaveValue("NS-10484");
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
    renderAt(`/shops/${SHOP_ID}/orders`);
    expect(await screen.findByRole("alert")).toHaveTextContent(/listing could not be read/i);
    expect(
      within(screen.getByRole("region", { name: "Create order" })).getByLabelText("Reference"),
    ).toHaveValue("");
  });
});

describe("order editor", () => {
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

  it("recalculates the total when a quantity changes, before the save round trip", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });
    const lines = card("Line items & payment");

    await user.clear(within(lines).getByLabelText("Quantity for NS-ASJ-OB-M"));
    await user.type(within(lines).getByLabelText("Quantity for NS-ASJ-OB-M"), "3");

    // The line total, the subtotal, and the order total all follow the quantity.
    expect(within(lines).getAllByText("747.00 EUR")).toHaveLength(3);
  });

  it("saves selections rather than materialized commerce content", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });
    const lines = card("Line items & payment");

    await user.clear(within(lines).getByLabelText("Quantity for NS-ASJ-OB-M"));
    await user.type(within(lines).getByLabelText("Quantity for NS-ASJ-OB-M"), "2");
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

  it("adds a line item from the catalog rather than typed content", async () => {
    const user = userEvent.setup();
    currentOrder = {
      ...PAID_ORDER,
      content: { ...PAID_ORDER.content, lines: [], subtotal: { amount: "0.00", currency: "EUR" } },
    };
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });
    const lines = card("Line items & payment");

    await user.selectOptions(within(lines).getByLabelText("Add product"), "NS-ASJ-OB-M");
    await user.click(within(lines).getByRole("button", { name: "Add line" }));

    expect(within(lines).getByText("Alpine Shell Jacket")).toBeVisible();
    expect(within(lines).getByText("Ocean Blue")).toBeVisible();
  });

  it("keeps a quantity the contract could not carry out of the editor", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });
    const lines = card("Line items & payment");
    const quantity = within(lines).getByLabelText("Quantity for NS-ASJ-OB-M");

    await user.clear(quantity);

    // The field shows what was typed, while the order keeps the quantity it had: the totals
    // stay truthful and a save can only carry a quantity the contract accepts.
    expect(quantity).toHaveValue(null);
    expect(within(lines).getAllByText("249.00 EUR").length).toBeGreaterThan(0);

    await user.type(quantity, "1200");
    await user.tab();
    expect(quantity).toHaveValue(999);
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

  it("deletes an order and returns to the index", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/orders/${ORDER_ID}`);
    await screen.findByRole("heading", { name: "NS-10482" });

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleted).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => expect(deleted).toEqual([ORDER_ID]));
    expect(await screen.findByRole("heading", { name: "Orders" })).toBeVisible();
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
    const lines = card("Line items & payment");

    await user.clear(within(lines).getByLabelText("Quantity for NS-ASJ-OB-M"));
    await user.type(within(lines).getByLabelText("Quantity for NS-ASJ-OB-M"), "2");
    await user.click(screen.getByRole("button", { name: "Save order" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot move from paid to pending/);
    expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled();
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
