import type {
  CustomerProfileListResponse,
  ReplaceTicketDraftRequest,
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
  TicketContextSchema,
  TicketDraftResponse,
  TicketListResponse,
  TicketPreviewResponse,
  TicketSummarySchema,
} from "@agent-lab/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SLUG_MAX_LENGTH } from "./lib/entryIds";
import { tooLongMessage } from "./lib/fieldRules";
import { stickyHeaderClasses } from "./lib/stickyHeader";
import { TOURS, tourAt } from "./lib/tours";
import { renderApp } from "./test/app";
import { expectWayBack } from "./test/header";
import { expectPublicationPill } from "./test/indexes";
import { mainCards, panelCards, panelFields, sidePanel } from "./test/panel";
import { expectBusy, expectNotRefused, expectRefused, submitWithoutPressing } from "./test/refused";
import { expectEditorOnRows, expectGroupRow } from "./test/rows";
import { bodyRows, railEntry, shellListings } from "./test/shell";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const PROFILE_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const ORDER_ID = "9f8e7d6c-5b4a-4938-8271-6a5b4c3d2e1f";
const TICKET_ID = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
const OTHER_TICKET_ID = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
/** An order the ticket still links but the shop no longer resolves. */
const MISSING_ORDER_ID = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f";
/** An order the shop still holds, which now belongs to another customer. */
const OTHER_CUSTOMER_ORDER_ID = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";
const HISTORY_AT = "2026-08-21T09:14:00.000000Z";
const TRIGGER_AT = "2026-08-21T13:40:00.000000Z";

const SHOP_CONTENT: ShopDraftResponse["content"] = {
  identity: {
    name: "Northstar Outfitters",
    slug: "northstar",
    locale: "en-GB",
    currencies: ["EUR"],
    channels: ["chat", "email"],
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

const DRAFT_CONTENT: TicketDraftResponse["content"] = {
  reference: "T-204",
  subject: "Wrong address concern",
  customer_profile_id: PROFILE_ID,
  channel: "chat",
  status: "open",
  origin: { kind: "order_page", product_handle: null, order_id: ORDER_ID },
  tags: ["address-change"],
  history: [
    {
      id: "payment-question",
      author: "customer",
      body: "Did my payment go through? I got an error at checkout.",
      sent_at: HISTORY_AT,
    },
    {
      id: "payment-answer",
      author: "support_agent",
      body: "Your order NS-10482 is confirmed and paid — no action needed.",
      sent_at: "2026-08-21T09:16:00.000000Z",
    },
  ],
  trigger: {
    id: "trigger",
    author: "customer",
    body: "I just noticed this is going to my old address. Can you change it before it ships?",
    sent_at: TRIGGER_AT,
  },
  linked_order_ids: [ORDER_ID],
  suggested_documents: [{ kind: "policy", document_id: "address-change" }],
  opened_at: TRIGGER_AT,
  message_count: 3,
};

const CONTEXT: TicketContextSchema = {
  customer: {
    profile_id: PROFILE_ID,
    display_name: "Maya Laurent",
    email: "maya.laurent@example.org",
    locale: "fr-FR",
    persona_traits: ["frequent", "direct"],
    default_address_label: "Home — Lyon",
    latest_published_version: 2,
    order_count: 1,
  },
  linked_orders: [
    {
      order_id: ORDER_ID,
      reference: "NS-10482",
      placed_at: "2026-08-20T14:55:00.000000Z",
      payment_status: "paid",
      fulfilment_status: "unfulfilled",
      total_amount: "249.00",
      currency: "EUR",
      shipping_label: "Bordeaux — previous flat",
    },
  ],
  other_tickets: [
    {
      ticket_id: OTHER_TICKET_ID,
      reference: "T-187",
      subject: "Sizing question",
      status: "resolved",
    },
  ],
  resources: {
    channels: ["chat", "email"],
    product_handles: ["alpine-shell-jacket"],
    products: [{ handle: "alpine-shell-jacket", title: "Alpine Shell Jacket" }],
    orders: [
      {
        order_id: ORDER_ID,
        reference: "NS-10482",
        placed_at: "2026-08-20T14:55:00.000000Z",
        payment_status: "paid",
        fulfilment_status: "unfulfilled",
        total_amount: "249.00",
        currency: "EUR",
        shipping_label: "Bordeaux — previous flat",
      },
    ],
    policy_ids: ["address-change"],
    support_guideline_ids: ["escalation"],
    faq_entry_ids: ["delivery"],
    documents: [
      { kind: "policy", document_id: "address-change", title: "Address-change policy" },
      { kind: "support_guideline", document_id: "escalation", title: "Escalating a refund" },
      { kind: "faq_entry", document_id: "delivery", title: "When will my order arrive?" },
    ],
  },
};

const TICKETS: TicketListResponse = {
  tickets: [
    {
      ticket_id: TICKET_ID,
      reference: "T-204",
      subject: "Wrong address concern",
      customer_profile_id: PROFILE_ID,
      customer_display_name: "Maya Laurent",
      channel: "chat",
      status: "open",
      origin_kind: "order_page",
      preview: "I just noticed this is going to my old address.",
      opened_at: TRIGGER_AT,
      message_count: 3,
      tags: ["address-change"],
      updated_at: "2026-08-24T12:05:00+00:00",
      latest_published_version: null,
      published_version_count: 0,
    },
    {
      ticket_id: OTHER_TICKET_ID,
      reference: "T-187",
      subject: "Sizing question",
      customer_profile_id: PROFILE_ID,
      customer_display_name: "Maya Laurent",
      channel: "email",
      status: "resolved",
      origin_kind: "product_page",
      preview: "No first message yet",
      opened_at: null,
      message_count: 0,
      tags: [],
      updated_at: "2026-08-24T12:05:00+00:00",
      latest_published_version: null,
      published_version_count: 0,
    },
  ],
};

function preview(overrides: Partial<TicketPreviewResponse> = {}): TicketPreviewResponse {
  return {
    ticket_id: TICKET_ID,
    publishable: true,
    issues: [],
    changes: [],
    content_fingerprint: "b".repeat(64),
    latest_published_version: null,
    next_version: 1,
    matches_latest_published: false,
    content: DRAFT_CONTENT,
    ...overrides,
  };
}

let currentContent = DRAFT_CONTENT;
let currentPreview = preview();
let savedRequests: ReplaceTicketDraftRequest[] = [];
let createdTickets: Record<string, unknown>[] = [];
let published = 0;
let publishFailure: { status: number; body: Record<string, unknown> } | null = null;

const server = setupServer(
  http.get("*/api/v1/shops", () =>
    HttpResponse.json({
      shops: [
        {
          shop_id: SHOP_ID,
          name: "Northstar Outfitters",
          slug: "northstar",
          updated_at: "2026-08-23T12:05:00+00:00",
          latest_published_version: 1,
          published_version_count: 1,
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
      publishable: true,
      issues: [],
      changes: [],
      content_fingerprint: "c".repeat(64),
      latest_published_version: 1,
      next_version: 2,
      matches_latest_published: true,
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
          default_address_label: "Home — Lyon",
          updated_at: "2026-08-23T12:05:00+00:00",
          latest_published_version: 2,
          published_version_count: 2,
          attached_shop_count: 1,
        },
      ],
    } satisfies CustomerProfileListResponse),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () => HttpResponse.json(TICKETS)),
  http.post(`*/api/v1/shops/${SHOP_ID}/tickets`, async ({ request }) => {
    createdTickets.push((await request.json()) as Record<string, unknown>);
    return HttpResponse.json(
      {
        ticket_id: TICKET_ID,
        shop_id: SHOP_ID,
        lifecycle_state: "draft",
        content: currentContent,
        created_at: "2026-08-24T12:00:00+00:00",
        updated_at: "2026-08-24T12:00:00+00:00",
      } satisfies TicketDraftResponse,
      { status: 201 },
    );
  }),
  http.get(`*/api/v1/shops/${SHOP_ID}/tickets/${TICKET_ID}/draft`, () =>
    HttpResponse.json({
      ticket_id: TICKET_ID,
      shop_id: SHOP_ID,
      lifecycle_state: "draft",
      content: currentContent,
      created_at: "2026-08-24T12:00:00+00:00",
      updated_at: "2026-08-24T12:05:00+00:00",
    } satisfies TicketDraftResponse),
  ),
  http.put(`*/api/v1/shops/${SHOP_ID}/tickets/${TICKET_ID}/draft`, async ({ request }) => {
    const body = (await request.json()) as ReplaceTicketDraftRequest;
    savedRequests.push(body);
    currentContent = { ...currentContent, ...body.payload };
    return HttpResponse.json({
      ticket_id: TICKET_ID,
      shop_id: SHOP_ID,
      lifecycle_state: "draft",
      content: currentContent,
      created_at: "2026-08-24T12:00:00+00:00",
      updated_at: "2026-08-24T12:06:00+00:00",
    } satisfies TicketDraftResponse);
  }),
  http.get(`*/api/v1/shops/${SHOP_ID}/tickets/${TICKET_ID}/draft/preview`, () =>
    HttpResponse.json(currentPreview),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/tickets/${TICKET_ID}/context`, () =>
    HttpResponse.json(CONTEXT),
  ),
  http.post(`*/api/v1/shops/${SHOP_ID}/tickets/${TICKET_ID}/versions`, () => {
    if (publishFailure) {
      return HttpResponse.json(publishFailure.body, { status: publishFailure.status });
    }
    published += 1;
    return HttpResponse.json({ version: 1 }, { status: 201 });
  }),
  // The shop and lab shells read every listing their rail counts (ADR 0056). Last, so a
  // handler this suite declares for one of these routes still wins.
  ...shellListings(),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  currentContent = DRAFT_CONTENT;
  currentPreview = preview();
  savedRequests = [];
  createdTickets = [];
  published = 0;
  publishFailure = null;
});
afterAll(() => server.close());

/**
 * The page's publication notice, out of the status lines the header now also carries: every
 * editor reports "All changes saved" as a status of its own (PLAN-UX Slice 8).
 */
async function publicationNotice() {
  const lines = await screen.findAllByRole("status");
  return lines.find((line) => line.textContent?.startsWith("Published version"));
}

function renderAt(path: string) {
  return renderApp(path);
}

function card(name: string) {
  return screen.getByRole("region", { name });
}

/** The customer's *other* ticket, which this fixture otherwise never opens. */
function otherTicketHandlers() {
  return [
    http.get(`*/api/v1/shops/${SHOP_ID}/tickets/${OTHER_TICKET_ID}/draft`, () =>
      HttpResponse.json({
        ticket_id: OTHER_TICKET_ID,
        shop_id: SHOP_ID,
        lifecycle_state: "draft",
        content: { ...currentContent, reference: "T-187", subject: "Sizing question" },
        created_at: "2026-08-24T12:00:00+00:00",
        updated_at: "2026-08-24T12:05:00+00:00",
      } satisfies TicketDraftResponse),
    ),
    http.get(`*/api/v1/shops/${SHOP_ID}/tickets/${OTHER_TICKET_ID}/draft/preview`, () =>
      HttpResponse.json({ ...currentPreview, ticket_id: OTHER_TICKET_ID }),
    ),
    http.get(`*/api/v1/shops/${SHOP_ID}/tickets/${OTHER_TICKET_ID}/context`, () =>
      HttpResponse.json(CONTEXT),
    ),
  ];
}

/** A second attached customer, so choosing one is a choice the operator has to make. */
const SECOND_PROFILE_ID = "2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d";

function twoCustomers() {
  return http.get("*/api/v1/customer-profiles", () =>
    HttpResponse.json({
      profiles: [
        {
          profile_id: PROFILE_ID,
          display_name: "Maya Laurent",
          email: "maya.laurent@example.org",
          persona_traits: ["frequent", "direct"],
          address_count: 2,
          default_address_label: "Home — Lyon",
          updated_at: "2026-08-23T12:05:00+00:00",
          latest_published_version: 2,
          published_version_count: 2,
          attached_shop_count: 1,
        },
        {
          profile_id: SECOND_PROFILE_ID,
          display_name: "Jonas Berg",
          email: "jonas.berg@example.org",
          persona_traits: [],
          address_count: 1,
          default_address_label: "Home — Oslo",
          updated_at: "2026-08-23T12:05:00+00:00",
          latest_published_version: 1,
          published_version_count: 1,
          attached_shop_count: 1,
        },
      ],
    } satisfies CustomerProfileListResponse),
  );
}

function listingFails(message = "The listing could not be read.") {
  return http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () =>
    HttpResponse.json({ code: "unavailable", message, request_id: "r" }, { status: 503 }),
  );
}

/** The ticket this suite creates, as the listing reads once the create has landed. */
const CREATED: TicketSummarySchema = {
  ...TICKETS.tickets[0],
  reference: "T-205",
  subject: "Late delivery",
  updated_at: "2026-08-25T12:00:00+00:00",
};

/** The index's table, once the listing has answered. */
async function ticketTable() {
  return screen.findByRole("table");
}

function createButton() {
  return screen.getByRole("button", { name: /^(Create ticket|Creating…)$/ });
}

describe("the ticket index", () => {
  it("names the page, says what a ticket is, and offers New ticket with its glyph", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets`);

    const title = await screen.findByRole("heading", { level: 1, name: "Tickets" });
    const header = title.closest("header") as HTMLElement;
    expect(within(header).getByText(/One customer's incident each/)).toBeVisible();
    // The count is the All chip's, not a line under the title.
    await ticketTable();
    expect(within(header).queryByText(/in this shop/)).toBeNull();

    const create = within(header).getByRole("link", { name: "New ticket" });
    expect(create).toHaveAttribute("href", `/shops/${SHOP_ID}/tickets/new`);
    expect(create.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    // An index scrolls its header away; only an editor or a create page pins one.
    expect(header.className).not.toContain("sticky");
  });

  it("counts the whole listing on its chips, the figure the rail draws beside it", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () =>
        HttpResponse.json({
          tickets: [
            { ...TICKETS.tickets[0], latest_published_version: 1, published_version_count: 1 },
            TICKETS.tickets[1],
          ],
        } satisfies TicketListResponse),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/tickets`);
    await ticketTable();

    const chips = screen.getByRole("group", { name: "Filter tickets" });
    expect(
      within(chips)
        .getAllByRole("button")
        .map((chip) => chip.getAttribute("aria-label")),
    ).toEqual(["All 2", "Published 1", "Never published 1", "Open 1", "Resolved 1"]);
    const entry = railEntry("Tickets");
    expect(within(entry).getByText("2")).toBeVisible();
    expect(entry).toHaveAccessibleDescription("2 tickets");
  });

  it("narrows the table to the chip pressed, and back", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets`);
    const table = await ticketTable();
    expect(bodyRows(table)).toBe(2);

    await user.click(screen.getByRole("button", { name: "Open 1" }));
    expect(screen.getByRole("button", { name: "Open 1" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("table")).getByText("Wrong address concern")).toBeVisible();
    expect(within(screen.getByRole("table")).queryByText("Sizing question")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Resolved 1" }));
    expect(within(screen.getByRole("table")).getByText("Sizing question")).toBeVisible();
    expect(within(screen.getByRole("table")).queryByText("Wrong address concern")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Never published 2" }));
    expect(bodyRows(screen.getByRole("table"))).toBe(2);
    await user.click(screen.getByRole("button", { name: "Published 0" }));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("No ticket matches this view.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "All 2" }));
    expect(bodyRows(screen.getByRole("table"))).toBe(2);
  });

  it("searches by subject, reference and customer, and leaves the counts alone", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets`);
    await ticketTable();
    const search = screen.getByRole("searchbox", {
      name: "Search by subject, reference or customer",
    });

    await user.type(search, "t-187");
    expect(within(screen.getByRole("table")).getByText("Sizing question")).toBeVisible();
    expect(bodyRows(screen.getByRole("table"))).toBe(1);
    // A chip counts the list, not the word typed.
    expect(screen.getByRole("button", { name: "All 2" })).toBeVisible();

    await user.clear(search);
    await user.type(search, "address");
    expect(within(screen.getByRole("table")).getByText("Wrong address concern")).toBeVisible();
    expect(bodyRows(screen.getByRole("table"))).toBe(1);

    await user.clear(search);
    await user.type(search, "maya");
    expect(bodyRows(screen.getByRole("table"))).toBe(2);

    await user.clear(search);
    await user.type(search, "parcel");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("No ticket matches this view.")).toBeVisible();
  });

  it("draws each incident as a row that opens its editor", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets`);
    const table = await ticketTable();

    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Ticket", "Customer", "Channel", "Status", "Published", "Draft updated"]);
    const row = within(table).getByRole("link", { name: "Wrong address concern" }).closest("tr");
    expect(within(table).getByRole("link", { name: "Wrong address concern" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/tickets/${TICKET_ID}`,
    );
    const cells = within(row as HTMLElement).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("Wrong address concernT-204");
    expect(within(cells[0]).getByText("T-204")).toHaveClass("font-mono");
    expect(cells[1]).toHaveTextContent("Maya Laurent");
    expect(cells[2]).toHaveTextContent("Chatfrom order page");
    expect(cells[3]).toHaveTextContent("Open");
    expect(cells[4]).toHaveTextContent("Never published");
  });

  it("says each ticket's publication in a pill: the version and how many, or Never published", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () =>
        HttpResponse.json({
          tickets: [
            { ...TICKETS.tickets[0], latest_published_version: 2, published_version_count: 2 },
            TICKETS.tickets[1],
          ],
        } satisfies TicketListResponse),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/tickets`);
    const table = await ticketTable();

    const rows = within(table).getAllByRole("row").slice(1);
    expectPublicationPill(rows[0], "v2 · 2 versions", "published");
    expectPublicationPill(rows[1], "Never published", "never published");
  });

  it("says why it is empty, and links to Customers when no customer is attached", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () => HttpResponse.json({ tickets: [] })),
      http.get("*/api/v1/customer-profiles", () => HttpResponse.json({ profiles: [] })),
    );
    renderAt(`/shops/${SHOP_ID}/tickets`);

    const empty = await screen.findByText(/No ticket in this shop yet/);
    expect(empty).toHaveTextContent(/raised by a customer attached to this shop, and none is/);
    expect(within(empty).getByRole("link", { name: /Customers/ })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/customers`,
    );
    // The zero is drawn, and pressable: it is the answer to a question.
    expect(screen.getByRole("button", { name: "All 0" })).toBeVisible();
  });

  it("says a ticket is raised by an attached customer, with nothing to link when one is", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () => HttpResponse.json({ tickets: [] })),
    );
    renderAt(`/shops/${SHOP_ID}/tickets`);

    const empty = await screen.findByText(/No ticket in this shop yet/);
    await waitFor(() =>
      expect(empty).toHaveTextContent(
        "No ticket in this shop yet. A ticket is raised by a customer attached to this shop.",
      ),
    );
    expect(within(empty).queryByRole("link")).toBeNull();
  });

  it("says a failed listing and nothing else", async () => {
    server.use(listingFails());
    renderAt(`/shops/${SHOP_ID}/tickets`);

    expect(await screen.findByRole("alert")).toHaveTextContent("The listing could not be read.");
    expect(screen.queryByText(/No ticket/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("group", { name: "Filter tickets" })).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    // The card still says what it lists.
    expect(screen.getByRole("heading", { level: 2, name: "Raised in this shop" })).toBeVisible();
  });

  it("stays the index: it opens no ticket on its own, and offers its tour", async () => {
    const { router } = renderApp(`/shops/${SHOP_ID}/tickets`);
    // Every address the router passes through from here, before the listing has answered: a
    // redirect scheduled off the listing's answer is a location this set records, whenever it
    // lands relative to the table.
    const visited = new Set<string>([router.state.location.pathname]);
    router.subscribe((state) => visited.add(state.location.pathname));
    await ticketTable();
    await waitFor(() => expect(railEntry("Tickets")).toHaveAccessibleDescription("2 tickets"));

    expect([...visited]).toEqual([`/shops/${SHOP_ID}/tickets`]);
    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/tickets`);
    expect(screen.queryByRole("region", { name: "Conversation" })).toBeNull();
    expect(tourAt(router.state.location.pathname)).toBe("tickets");
    expect(
      screen.getByRole("button", { name: `Show me around ${TOURS.tickets.surface}` }),
    ).toBeVisible();
  });
});

describe("the create page", () => {
  it("opens from New ticket at its own address, as a create page with no tour", async () => {
    const user = userEvent.setup();
    const { router } = renderApp(`/shops/${SHOP_ID}/tickets`);
    await ticketTable();

    await user.click(screen.getByRole("link", { name: "New ticket" }));

    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/tickets/new`);
    expect(await screen.findByRole("heading", { level: 1, name: "New ticket" })).toBeVisible();
    expect(screen.getByText("nothing created yet")).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to Tickets" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/tickets`,
    );
    expect(screen.queryByRole("button", { name: /Show me around/ })).toBeNull();
    expect(within(card("Created as a draft")).getByText(/first message every arm/)).toBeVisible();
  });

  it("refuses Create with its reason until a subject is typed and a customer chosen", async () => {
    const user = userEvent.setup();
    server.use(twoCustomers());
    renderAt(`/shops/${SHOP_ID}/tickets/new`);
    await screen.findByRole("option", { name: "Jonas Berg" });
    await waitFor(() => expect(screen.getByLabelText("Reference")).toHaveValue("T-205"));

    expectRefused(
      createButton(),
      "The ticket needs a subject: the incident as the customer would describe it.",
    );
    await user.type(screen.getByLabelText("Subject"), "Late delivery");
    expectRefused(createButton(), "Choose the customer who raised the ticket.");
    // Pressed, or submitted some other way, a refused Create writes nothing.
    await user.click(createButton());
    await submitWithoutPressing(createButton());
    expect(createdTickets).toHaveLength(0);
    // The title reads back what is being made.
    expect(screen.getByRole("heading", { level: 1, name: "Late delivery" })).toBeVisible();

    await user.selectOptions(screen.getByLabelText("Customer"), SECOND_PROFILE_ID);
    expectNotRefused(createButton());
  });

  it("chooses the one attached customer, and says so", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/new`);

    const customer = await screen.findByLabelText("Customer");
    await waitFor(() => expect(customer).toHaveValue(PROFILE_ID));
    expect(customer).toHaveAccessibleDescription(
      /This one is the only customer attached to this shop, so it is already chosen\./,
    );
  });

  it("puts each field's hint in that control's accessible description", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/new`);

    expect(await screen.findByLabelText("Reference")).toHaveAccessibleDescription(
      /uppercase letters, digits, and hyphens.*named in scenarios/i,
    );
    expect(screen.getByLabelText("Subject")).toHaveAccessibleDescription(
      /the incident as the customer would describe it/i,
    );
    expect(screen.getByLabelText("Customer")).toHaveAccessibleDescription(
      /only customers attached to this shop.*fixed at creation/i,
    );
    expect(screen.getByLabelText("Channel")).toHaveAccessibleDescription(
      /the channel the incident arrived on/i,
    );
  });

  it("offers only the channels this shop supports", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/new`);

    const channel = await screen.findByLabelText("Channel");
    expect(
      Array.from(channel.querySelectorAll("option")).map((entry) => entry.textContent),
    ).toEqual(["Chat", "Email"]);
  });

  it("derives the next free reference, resumes when emptied, and refuses a duplicate", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets/new`);
    const reference = await screen.findByLabelText("Reference");

    await waitFor(() => expect(reference).toHaveValue("T-205"));
    await user.clear(reference);
    await user.type(reference, "T-900");
    await user.clear(reference);
    expect(reference).toHaveValue("");
    await user.tab();
    expect(reference).toHaveValue("T-205");

    await user.type(screen.getByLabelText("Subject"), "Late delivery");
    await user.clear(reference);
    await user.type(reference, "T-204");
    expect(reference).toBeInvalid();
    expect(reference).toHaveAccessibleDescription(
      /t-204 is already used by a ticket in this shop/i,
    );
    expectRefused(createButton(), "T-204 is already used by a ticket in this shop.");
    await user.click(createButton());
    expect(createdTickets).toHaveLength(0);
  });

  it.each([
    {
      why: "a series as long as a reference can hold beside T",
      last: `T-${"9".repeat(61)}`,
      // Exact: read as a `Number`, it would be `T-1e+62`.
      expected: `T-1${"0".repeat(61)}`,
    },
    {
      // Past the series no reference fits, so the lowest free one is offered instead.
      why: "a series already at the cap",
      last: `T-${"9".repeat(62)}`,
      expected: "T-1",
    },
  ])(
    "suggests a reference the lab keeps after $why, and creates it",
    async ({ last, expected }) => {
      const user = userEvent.setup();
      server.use(
        twoCustomers(),
        http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () =>
          HttpResponse.json({
            tickets: [{ ...TICKETS.tickets[0], reference: last }],
          } satisfies TicketListResponse),
        ),
      );
      renderAt(`/shops/${SHOP_ID}/tickets/new`);
      await screen.findByRole("option", { name: "Jonas Berg" });
      const field = screen.getByLabelText("Reference");
      await waitFor(() => expect(field).toHaveValue(expected));
      expect(expected.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
      await user.type(screen.getByLabelText("Subject"), "Late delivery");
      await user.selectOptions(screen.getByLabelText("Customer"), SECOND_PROFILE_ID);

      expect(field).toBeValid();
      expect(field).not.toHaveAttribute("aria-invalid");
      expect(field).not.toHaveAccessibleDescription(/at most/);
      expectNotRefused(createButton());
      await user.click(createButton());
      await waitFor(() => expect(createdTickets).toHaveLength(1));
      expect(createdTickets[0]).toMatchObject({ reference: expected });
    },
  );

  it("refuses a reference an uppercased ß lengthened past the cap, on the field and on Create", async () => {
    const user = userEvent.setup();
    server.use(twoCustomers());
    renderAt(`/shops/${SHOP_ID}/tickets/new`);
    await screen.findByRole("option", { name: "Jonas Berg" });
    const field = screen.getByLabelText("Reference");
    await waitFor(() => expect(field).toHaveValue("T-205"));
    await user.type(screen.getByLabelText("Subject"), "Late delivery");
    await user.selectOptions(screen.getByLabelText("Customer"), SECOND_PROFILE_ID);

    // `maxLength` stops the next keystroke only, and "ß" is "SS": one typed into the last free
    // place ends one past the 64 `require_business_reference` keeps.
    await user.clear(field);
    await user.type(field, `${"T".repeat(SLUG_MAX_LENGTH - 1)}ß`);
    expect(field).toHaveValue(`${"T".repeat(SLUG_MAX_LENGTH - 1)}SS`);
    const refusal = tooLongMessage(SLUG_MAX_LENGTH + 1, SLUG_MAX_LENGTH);
    expect(field).toBeInvalid();
    expect(field).toHaveAccessibleDescription(new RegExp(refusal));
    expectRefused(createButton(), refusal);
    await user.click(createButton());
    await submitWithoutPressing(createButton());
    expect(createdTickets).toHaveLength(0);

    // Typed, the field stops at the cap, and the ticket can be made.
    await user.clear(field);
    await user.type(field, "X".repeat(SLUG_MAX_LENGTH + 3));
    expect(field).toHaveValue("X".repeat(SLUG_MAX_LENGTH));
    expectNotRefused(createButton());
  });

  it("takes no reference until it knows which references are free", async () => {
    let release: (() => void) | null = null;
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json(TICKETS);
      }),
    );
    renderAt(`/shops/${SHOP_ID}/tickets/new`);

    // The suggestion is the next free reference, and which one that is is exactly what the
    // listing still has to say. A reference typed before it lands would be written over.
    const reference = await screen.findByLabelText("Reference");
    expect(reference).toBeDisabled();
    expect(reference).toHaveValue("");
    expectRefused(createButton(), "Reading what this shop already holds…");

    await waitFor(() => expect(release).not.toBeNull());
    (release as unknown as () => void)();
    await waitFor(() => expect(reference).toBeEnabled());
    // Enabled and already holding the suggestion: never enabled and empty.
    expect(reference).toHaveValue("T-205");
  });

  it("does not guess a reference after the listing fails, and shows the listing's failure", async () => {
    server.use(listingFails());
    renderAt(`/shops/${SHOP_ID}/tickets/new`);

    expect(await screen.findByRole("alert")).toHaveTextContent(/listing could not be read/i);
    expect(screen.getByLabelText("Reference")).toHaveValue("");
    expect(screen.getByLabelText("Reference")).toBeEnabled();
  });

  it("closes the reference while a create is in flight, and holds the press", async () => {
    const user = userEvent.setup();
    let created = false;
    let release: (() => void) | null = null;
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, async () => {
        if (!created) {
          return HttpResponse.json(TICKETS);
        }
        // The re-read the create triggers, held open for a moment.
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json({
          tickets: [...TICKETS.tickets, CREATED],
        } satisfies TicketListResponse);
      }),
      http.post(`*/api/v1/shops/${SHOP_ID}/tickets`, async ({ request }) => {
        createdTickets.push((await request.json()) as Record<string, unknown>);
        created = true;
        return HttpResponse.json(
          {
            ticket_id: TICKET_ID,
            shop_id: SHOP_ID,
            lifecycle_state: "draft",
            content: currentContent,
            created_at: "2026-08-24T12:00:00+00:00",
            updated_at: "2026-08-24T12:00:00+00:00",
          } satisfies TicketDraftResponse,
          { status: 201 },
        );
      }),
    );
    const { router } = renderApp(`/shops/${SHOP_ID}/tickets/new`);
    const reference = await screen.findByLabelText("Reference");
    await waitFor(() => expect(reference).toHaveValue("T-205"));
    await waitFor(() => expect(screen.getByLabelText("Customer")).toHaveValue(PROFILE_ID));
    await user.type(screen.getByLabelText("Subject"), "Late delivery");

    await user.click(createButton());

    await waitFor(() => expect(createdTickets).toHaveLength(1));
    expect(createdTickets[0]).toEqual({
      reference: "T-205",
      subject: "Late delivery",
      customer_profile_id: PROFILE_ID,
      channel: "chat",
    });
    // While the listing that decides which reference is free is moving, the field is nobody's
    // and the press is in flight.
    await waitFor(() => expect(reference).toBeDisabled());
    expect(reference).toHaveValue("");
    expectBusy(createButton());
    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/tickets/new`);

    (release as unknown as () => void)();
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`),
    );
  });

  it("lands in the editor of what it made, with the listing the rail counts read again", async () => {
    const user = userEvent.setup();
    let created = false;
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () =>
        HttpResponse.json({
          tickets: created ? [...TICKETS.tickets, CREATED] : TICKETS.tickets,
        } satisfies TicketListResponse),
      ),
      http.post(`*/api/v1/shops/${SHOP_ID}/tickets`, async ({ request }) => {
        createdTickets.push((await request.json()) as Record<string, unknown>);
        created = true;
        return HttpResponse.json(
          {
            ticket_id: TICKET_ID,
            shop_id: SHOP_ID,
            lifecycle_state: "draft",
            content: currentContent,
            created_at: "2026-08-24T12:00:00+00:00",
            updated_at: "2026-08-24T12:00:00+00:00",
          } satisfies TicketDraftResponse,
          { status: 201 },
        );
      }),
    );
    const { router } = renderApp(`/shops/${SHOP_ID}/tickets/new`);
    await waitFor(() => expect(screen.getByLabelText("Reference")).toHaveValue("T-205"));
    await waitFor(() => expect(screen.getByLabelText("Customer")).toHaveValue(PROFILE_ID));
    await user.type(screen.getByLabelText("Subject"), "Late delivery");
    await waitFor(() => expect(railEntry("Tickets")).toHaveAccessibleDescription("2 tickets"));
    const keys = new Set<string>([router.state.location.key]);
    router.subscribe((state) => keys.add(state.location.key));

    await user.click(createButton());

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`),
    );
    expect(await screen.findByRole("region", { name: "Conversation" })).toBeVisible();
    // The rail reads the listing the create re-read, not the one the page opened on.
    expect(railEntry("Tickets")).toHaveAccessibleDescription("3 tickets");
    // One navigation: the create's own.
    expect([...keys]).toHaveLength(2);
  });

  it("shows a refused create under Create, and keeps the operator on the page", async () => {
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/tickets`, () =>
        HttpResponse.json(
          {
            code: "conflict",
            message: "A ticket with this reference already exists.",
            request_id: "r",
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    const { router } = renderApp(`/shops/${SHOP_ID}/tickets/new`);
    await waitFor(() => expect(screen.getByLabelText("Reference")).toHaveValue("T-205"));
    await waitFor(() => expect(screen.getByLabelText("Customer")).toHaveValue(PROFILE_ID));
    await user.type(screen.getByLabelText("Subject"), "Late delivery");

    await user.click(createButton());

    const header = screen.getByRole("heading", { level: 1 }).closest("header") as HTMLElement;
    expect(await within(header).findByRole("alert")).toHaveTextContent(/reference already exists/i);
    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/tickets/new`);
    expect(screen.getByLabelText("Subject")).toHaveValue("Late delivery");
  });

  it("opens the ticket it made even when the listing cannot be read again", async () => {
    let created = false;
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/tickets`, async ({ request }) => {
        createdTickets.push((await request.json()) as Record<string, unknown>);
        created = true;
        return HttpResponse.json(
          {
            ticket_id: TICKET_ID,
            shop_id: SHOP_ID,
            lifecycle_state: "draft",
            content: currentContent,
            created_at: "2026-08-24T12:00:00+00:00",
            updated_at: "2026-08-24T12:00:00+00:00",
          } satisfies TicketDraftResponse,
          { status: 201 },
        );
      }),
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () =>
        created
          ? HttpResponse.json(
              { code: "unavailable", message: "The listing could not be read.", request_id: "r" },
              { status: 503 },
            )
          : HttpResponse.json(TICKETS),
      ),
    );
    const user = userEvent.setup();
    const { router } = renderApp(`/shops/${SHOP_ID}/tickets/new`);
    await waitFor(() => expect(screen.getByLabelText("Reference")).toHaveValue("T-205"));
    await waitFor(() => expect(screen.getByLabelText("Customer")).toHaveValue(PROFILE_ID));
    await user.type(screen.getByLabelText("Subject"), "Late delivery");

    await user.click(createButton());

    // The ticket exists: a listing that failed to follow it is not a failed create.
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`),
    );
    expect(await screen.findByRole("region", { name: "Conversation" })).toBeVisible();
    expect(screen.queryByText(/could not be created/)).toBeNull();
  });

  it("asks nothing when a half-typed ticket is left", async () => {
    const user = userEvent.setup();
    const { router } = renderApp(`/shops/${SHOP_ID}/tickets/new`);
    await user.type(await screen.findByLabelText("Subject"), "Late delivery");

    await user.click(screen.getByRole("link", { name: "Cancel" }));

    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/tickets`);
    expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).toBeNull();
  });
});

describe("the ticket editor", () => {
  it("opens each card on what it is for, as the card's own first line", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);

    const lines: [string, RegExp][] = [
      ["Incident", /^What happened, where the customer was when they wrote/],
      ["Conversation", /^The history every arm is handed with this ticket/],
      ["Linked orders", /^The customer's orders in this shop that the incident is about/],
      ["Suggested documents", /^Pre-fills a scenario's context documents/],
    ];
    for (const [name, line] of lines) {
      const card = await screen.findByRole("region", { name });
      expect(card, name).toHaveAccessibleDescription(line);
    }
  });

  it("goes back to Tickets from the ← above the subject", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);

    await expectWayBack(
      "Tickets",
      `/shops/${SHOP_ID}/tickets`,
      "ticket",
      // The channel is the Channel row's; the origin stays on the line, where it is read.
      /^Tickets · ticket · from /,
      /draft fingerprint [0-9a-f]{12}…/,
    );
  });
  it("is its own page, under a pinned header holding the ticket and its actions", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);

    const title = await screen.findByRole("heading", { level: 1, name: "Wrong address concern" });
    const header = title.closest("header") as HTMLElement;
    for (const utility of stickyHeaderClasses.split(" ")) {
      expect(header).toHaveClass(utility);
    }
    expect(within(header).getByText("T-204")).toHaveClass("font-mono");
    expect(within(header).getByText("Open")).toBeVisible();
    expect(await within(header).findByText("Never published")).toBeVisible();
    expect(within(header).getByRole("link", { name: "Tickets" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/tickets`,
    );
    // The origin is on the header's line; the channel is the Channel row's, not restated.
    expect(within(header).getByText(/ticket · from order page/)).toBeVisible();
    expect(within(header).queryByText(/Chat/)).toBeNull();
    expect(within(header).getByText("All changes saved")).toBeVisible();
    expect(within(header).getByRole("button", { name: "Publish v1" })).toBeVisible();
    // No page is drawn around it: it is the page.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("draws its cards in order beside the panel, and no field of the draft in the panel", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Customer" });

    const panel = sidePanel(card("Publish gate"));
    expect(panelCards(panel)).toEqual(["Publish gate", "Customer", "What publishing freezes"]);
    expect(mainCards(panel)).toEqual([
      "Incident",
      "Conversation",
      "Linked orders",
      "Suggested documents",
    ]);
    expect(panelFields(panel)).toEqual([]);
  });

  it("says in the freeze card what publishing freezes, then that a scenario freezes a version", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Conversation" });

    expect(
      within(card("What publishing freezes")).getByText(
        /^Publishing freezes the whole ticket as its first version: its customer at their newest published version, incident, conversation, suggested documents, and which orders it links\. A scenario built on it freezes a published version, never the draft\.$/,
      ),
    ).toBeVisible();
  });

  it("says first what the next publish freezes of a ticket already published", async () => {
    currentPreview = preview({ latest_published_version: 2, next_version: 3 });
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Conversation" });

    expect(
      await within(card("What publishing freezes")).findByText(
        /^Publishing freezes the whole ticket as v3: its customer at their newest published version, incident, conversation, suggested documents, and which orders it links\. It is published up to v2, and a scenario that froze an earlier version does not change\.$/,
      ),
    ).toBeVisible();
  });

  it("offers no tour, as no editor does", async () => {
    const { router } = renderApp(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Conversation" });

    expect(tourAt(router.state.location.pathname)).toBeNull();
    expect(screen.queryByRole("button", { name: /Show me around/ })).toBeNull();
  });

  it("arrives with the rail expanded, and collapses it only on request", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Conversation" });

    expect(screen.getByRole("button", { name: "Collapse menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Collapse menu" }));

    const rail = screen.getByRole("navigation", { name: "Shop workspace" });
    expect(screen.getByRole("button", { name: "Expand menu" })).toBeVisible();
    // Collapsed is a first-class layout, not a hidden one: the names survive as link names.
    expect(within(rail).getByRole("link", { name: "Tickets" })).toBeVisible();
  });
});

describe("the conversation", () => {
  it("renders prior history and badges the trigger every arm receives", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);

    const thread = await screen.findByRole("region", { name: "Conversation" });
    expect(within(thread).getByText(/prior support history/i)).toBeVisible();
    expect(within(thread).getByText(/Did my payment go through/)).toBeVisible();
    expect(within(thread).getByText("Past support agent")).toBeVisible();
    expect(within(thread).getByText(/Trigger — sent to every arm/i)).toBeVisible();
    expect(within(thread).getByText("first message")).toBeVisible();
  });

  it("puts the composer below the thread, as the card's add form", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const thread = await screen.findByRole("region", { name: "Conversation" });

    const composer = within(thread).getByRole("form", { name: "Add a message to the thread" });
    expect(composer).toHaveClass("border-t");
    const trigger = within(thread).getByText("first message");
    expect(
      trigger.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(composer).getByLabelText("Add a history message")).toBeVisible();
    expect(within(composer).getByRole("button", { name: "Add to thread" })).toBeVisible();
  });

  it("asks before the first message leaves, saying no earlier message takes its place", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const thread = within(await screen.findByRole("region", { name: "Conversation" }));

    const remove = thread
      .getAllByRole("button", { name: /^Remove message from Maya Laurent/ })
      .at(-1);
    if (!remove) {
      throw new Error("The trigger carries no Remove.");
    }
    await user.click(remove);

    const confirm = thread.getByRole("group", {
      name: /^Remove the first message, from Maya Laurent/,
    });
    expect(confirm).toHaveFocus();
    expect(confirm).toHaveAccessibleDescription(
      /the message every arm receives at experiment start.*An earlier message does not take its place/,
    );
    // The bubble it stands in for is gone; walking back puts it where it was.
    expect(thread.queryByText("first message")).toBeNull();
    await user.click(within(confirm).getByRole("button", { name: "Keep it" }));
    expect(thread.getByText("first message")).toBeVisible();

    await user.click(
      thread
        .getAllByRole("button", { name: /^Remove message from Maya Laurent/ })
        .at(-1) as HTMLElement,
    );
    await user.click(
      within(thread.getByRole("group", { name: /^Remove the first message/ })).getByRole("button", {
        name: "Remove it",
      }),
    );
    expect(thread.getByText(/No first message yet/)).toBeVisible();
  });

  it("does not carry an armed confirm to another ticket whose message shares its id", async () => {
    const user = userEvent.setup();
    server.use(...otherTicketHandlers());
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Customer" });
    const thread = () => within(screen.getByRole("region", { name: "Conversation" }));

    await user.click(
      thread()
        .getAllByRole("button", { name: /^Remove message from Maya Laurent/ })
        .at(-1) as HTMLElement,
    );
    expect(thread().getByRole("group", { name: /^Remove the first message/ })).toBeVisible();

    // Both fixtures key their first message `trigger`; the confirm was asked about T-204's.
    await user.click(within(card("Customer")).getByRole("link", { name: "T-187" }));
    await screen.findByRole("heading", { level: 1, name: "Sizing question" });

    await waitFor(() =>
      expect(thread().queryByRole("group", { name: /^Remove the first message/ })).toBeNull(),
    );
    expect(thread().getByText("first message")).toBeVisible();
  });

  it("offers history as the customer or as past support, never a live reply", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);

    const thread = await screen.findByRole("region", { name: "Conversation" });
    expect(within(thread).getByText(/Replies happen on the live bench, per run/)).toBeVisible();
    expect(within(thread).getByRole("button", { name: "as Maya Laurent" })).toBeVisible();
    expect(within(thread).getByRole("button", { name: "as past support" })).toBeVisible();
  });

  it("adds a past support reply to history rather than making it the trigger", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const thread = await screen.findByRole("region", { name: "Conversation" });

    await user.click(within(thread).getByRole("button", { name: "as past support" }));
    await user.type(
      within(thread).getByLabelText("Add a history message"),
      "We can still change it.",
    );
    await user.click(within(thread).getByRole("button", { name: "Add to thread" }));

    expect(within(thread).getByText("We can still change it.")).toBeVisible();
    // The trigger is untouched: only a newer customer message can replace it.
    expect(within(thread).getByText("first message")).toBeVisible();
  });

  it("refuses to add an empty message, or one with no time, and says which", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const thread = within(await screen.findByRole("region", { name: "Conversation" }));
    const articles = thread.getAllByRole("article").length;

    const add = thread.getByRole("button", { name: "Add to thread" });
    expectRefused(add, "Write the message before adding it to the thread.");
    await user.click(add);
    await submitWithoutPressing(add);
    expect(thread.getAllByRole("article")).toHaveLength(articles);

    await user.type(thread.getByLabelText("Add a history message"), "Hello again.");
    expectNotRefused(add);
    fireEvent.change(thread.getByLabelText("Sent at"), { target: { value: "" } });
    expectRefused(add, "Give the message the time it was sent; the thread is ordered by it.");
    await user.click(add);
    // Refused by the handler, not by a throw on the way to appending a message with no time:
    // an exception in an event listener reaches the window as an `error` event.
    const thrown: ErrorEvent[] = [];
    const listen = (event: ErrorEvent) => {
      thrown.push(event);
      event.preventDefault();
    };
    window.addEventListener("error", listen);
    await submitWithoutPressing(add);
    window.removeEventListener("error", listen);
    expect(thrown.map((event) => event.message)).toEqual([]);
    expect(thread.getAllByRole("article")).toHaveLength(articles);
    expect(thread.getByLabelText("Add a history message")).toHaveValue("Hello again.");
  });

  it("refuses history that would land at or after the first message", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const thread = await screen.findByRole("region", { name: "Conversation" });

    await user.click(within(thread).getByRole("button", { name: "as past support" }));
    // A `datetime-local` value is set rather than typed: jsdom has no segmented editor.
    fireEvent.change(within(thread).getByLabelText("Sent at"), {
      target: { value: "2026-08-23T10:00" },
    });
    await user.type(within(thread).getByLabelText("Add a history message"), "Already handled.");
    await user.click(within(thread).getByRole("button", { name: "Add to thread" }));

    expect(within(thread).getByRole("alert")).toHaveTextContent(
      /must be older than the first message every arm receives/,
    );
    // No bubble was added, and the draft stays in the composer so the time can be corrected.
    expect(within(thread).getAllByRole("article")).toHaveLength(3);
    expect(within(thread).getByLabelText("Add a history message")).toHaveValue("Already handled.");
  });

  it("says what is missing when a ticket has no first message, and the gate says it too", async () => {
    currentContent = { ...DRAFT_CONTENT, trigger: null, message_count: 2, opened_at: null };
    currentPreview = preview({
      publishable: false,
      content: currentContent,
      issues: [
        {
          severity: "error",
          code: "ticket_without_trigger",
          message: "a published ticket must carry the first message every arm receives",
          path: "trigger",
        },
      ],
    });
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);

    const thread = await screen.findByRole("region", { name: "Conversation" });
    expect(within(thread).getByText(/No first message yet/)).toBeVisible();
    expect(
      await within(card("Publish gate")).findByText(
        /must carry the first message every arm receives/,
      ),
    ).toBeVisible();
  });
});

describe("what the ticket points at", () => {
  it("shows the customer, the linked order, and the documents a scenario would inherit", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Customer" });

    const customer = card("Customer");
    expect(within(customer).getByText(/Maya Laurent/)).toBeVisible();
    expect(within(customer).getByText("Home — Lyon")).toBeVisible();
    expect(within(customer).getByText("1 order(s) · 2 ticket(s)")).toBeVisible();

    const linked = card("Linked orders");
    expect(within(linked).getByLabelText("NS-10482")).toBeChecked();
    // The order's two statuses read as words on a pill, not as the wire's own spelling.
    expect(within(linked).getByText("Paid")).toBeVisible();
    expect(within(linked).getByText("Unfulfilled")).toBeVisible();
    expect(within(linked).queryByText(/unfulfilled/)).toBeNull();
    expect(within(linked).getByText(/ship-to: Bordeaux — previous flat/)).toBeVisible();

    // Each document is named by its title under its kind, an FAQ entry by its question; the
    // slug is how the ticket refers to it, not how an author reads it.
    const documents = card("Suggested documents");
    expect(
      within(documents)
        .getAllByRole("group")
        .map((group) => group.getAttribute("aria-labelledby"))
        .map((id) => document.getElementById(id ?? "")?.textContent),
    ).toEqual(["Policies", "Guidelines", "FAQ"]);
    const policies = within(documents).getByRole("group", { name: "Policies" });
    expect(within(policies).getByLabelText("Address-change policy")).toBeChecked();
    expect(
      within(within(documents).getByRole("group", { name: "Guidelines" })).getByLabelText(
        "Escalating a refund",
      ),
    ).not.toBeChecked();
    expect(within(documents).getByLabelText("When will my order arrive?")).not.toBeChecked();
    expect(within(documents).queryByText("address-change")).toBeNull();
    expect(within(documents).queryByText("Unresolved document")).toBeNull();
  });

  it("names a product-page origin by the product's title, in the header and the picker", async () => {
    currentContent = {
      ...DRAFT_CONTENT,
      origin: { kind: "product_page", product_handle: "alpine-shell-jacket", order_id: null },
    };
    currentPreview = preview({ content: currentContent });
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Conversation" });

    expect(await screen.findByText(/from product page Alpine Shell Jacket/)).toBeVisible();
    const picker = within(card("Incident")).getByLabelText("Product");
    expect(picker).toHaveValue("alpine-shell-jacket");
    expect(within(picker).getByRole("option", { selected: true })).toHaveTextContent(
      "Alpine Shell Jacket",
    );
    expect(screen.queryByText(/unresolved/i)).toBeNull();
  });

  it("says a product origin the shop no longer holds is unresolved, and keeps it selected", async () => {
    currentContent = {
      ...DRAFT_CONTENT,
      origin: { kind: "product_page", product_handle: "trailhead-cap", order_id: null },
    };
    currentPreview = preview({ content: currentContent });
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Conversation" });

    const header = (await screen.findByText(/from product page/)).closest("p");
    await waitFor(() => expect(header).toHaveTextContent(/trailhead-cap \(unresolved\)/));
    const picker = within(card("Incident")).getByLabelText("Product");
    expect(picker).toHaveValue("trailhead-cap");
    expect(within(picker).getByRole("option", { selected: true })).toHaveTextContent(
      "trailhead-cap (unresolved)",
    );
  });

  it("keeps a suggestion the shop no longer holds removable, named by its kind and slug", async () => {
    // Named by the pair: the shop holds an FAQ entry called `delivery`, and this suggestion is
    // a policy by that slug, which it does not hold.
    const user = userEvent.setup();
    currentContent = {
      ...DRAFT_CONTENT,
      suggested_documents: [
        { kind: "policy", document_id: "address-change" },
        { kind: "policy", document_id: "delivery" },
      ],
    };
    currentPreview = preview({ content: currentContent });
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const documents = await screen.findByRole("region", { name: "Suggested documents" });

    expect(await within(documents).findByText("Unresolved document")).toBeVisible();
    expect(within(documents).getByText("policy · delivery")).toBeVisible();
    expect(within(documents).getByLabelText("When will my order arrive?")).not.toBeChecked();
    await user.click(
      within(documents).getByRole("button", { name: "Remove suggested policy delivery" }),
    );

    // It asks twice, as every editor removal does (ADR 0060): no checkbox would put it back.
    const confirm = within(documents).getByRole("group", {
      name: "Remove the suggested policy delivery?",
    });
    expect(confirm).toHaveFocus();
    expect(confirm).toHaveAccessibleDescription(/no longer has it pre-filled/);
    await user.click(within(confirm).getByRole("button", { name: "Keep it" }));
    expect(within(documents).getByText("policy · delivery")).toBeVisible();
    expect(
      within(documents).getByRole("button", { name: "Remove suggested policy delivery" }),
    ).toHaveFocus();

    await user.click(
      within(documents).getByRole("button", { name: "Remove suggested policy delivery" }),
    );
    await user.click(
      within(
        within(documents).getByRole("group", { name: "Remove the suggested policy delivery?" }),
      ).getByRole("button", { name: "Remove it" }),
    );

    expect(within(documents).queryByText("Unresolved document")).toBeNull();
    expect(
      within(documents).getByText("Removed the suggested policy delivery from the draft."),
    ).toBeVisible();
    expect(within(documents).getByLabelText("Address-change policy")).toBeChecked();
  });

  it("removes a suggestion the shop no longer holds on one press once the preference is off", async () => {
    window.localStorage.setItem("agent-lab.confirm-before-delete", "false");
    try {
      const user = userEvent.setup();
      currentContent = {
        ...DRAFT_CONTENT,
        suggested_documents: [{ kind: "policy", document_id: "delivery" }],
      };
      currentPreview = preview({ content: currentContent });
      renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
      const documents = await screen.findByRole("region", { name: "Suggested documents" });

      await user.click(
        await within(documents).findByRole("button", { name: "Remove suggested policy delivery" }),
      );

      expect(within(documents).queryByRole("group", { name: /^Remove the suggested/ })).toBeNull();
      expect(within(documents).queryByText("Unresolved document")).toBeNull();
      expect(
        within(documents).getByText("Removed the suggested policy delivery from the draft."),
      ).toBeVisible();
    } finally {
      window.localStorage.removeItem("agent-lab.confirm-before-delete");
    }
  });

  it("keeps a link the shop can no longer resolve removable, and unlinks it on a second press", async () => {
    // A deleted order blocks publication; without a row of its own the author would have no
    // checkbox left to uncheck — and, with none to check, unlinking it asks twice (ADR 0060).
    const user = userEvent.setup();
    currentContent = { ...DRAFT_CONTENT, linked_order_ids: [ORDER_ID, MISSING_ORDER_ID] };
    currentPreview = preview({ content: currentContent });
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const linked = await screen.findByRole("region", { name: "Linked orders" });
    const unlink = () =>
      within(linked).getByRole("button", { name: `Unlink order ${MISSING_ORDER_ID}` });

    expect(within(linked).getByText("Unresolved order")).toBeVisible();
    expect(unlink()).toHaveTextContent("Unlink");
    await user.click(unlink());

    const confirm = within(linked).getByRole("group", {
      name: `Unlink order ${MISSING_ORDER_ID}?`,
    });
    expect(confirm).toHaveFocus();
    expect(confirm).toHaveAccessibleDescription(/no checkbox links it again/);
    // A resolved link stays beside it, so the incident still points at something.
    expect(confirm).not.toHaveAccessibleDescription(/last link/);
    expect(within(linked).queryByText("Unresolved order")).toBeNull();

    await user.click(within(confirm).getByRole("button", { name: "Keep it" }));
    expect(within(linked).getByText("Unresolved order")).toBeVisible();
    expect(within(linked).getByText(MISSING_ORDER_ID)).toBeVisible();
    expect(unlink()).toHaveFocus();

    await user.click(unlink());
    await user.click(
      within(
        within(linked).getByRole("group", { name: `Unlink order ${MISSING_ORDER_ID}?` }),
      ).getByRole("button", { name: "Unlink" }),
    );

    expect(within(linked).queryByText("Unresolved order")).toBeNull();
    const notice = within(linked).getByText(`Unlinked order ${MISSING_ORDER_ID} from the draft.`);
    expect(notice).toHaveFocus();
    // The resolved order it stood beside is still linked.
    expect(within(linked).getByRole("checkbox", { name: "NS-10482" })).toBeChecked();
  });

  it("says unlinking the last link leaves an incident whose origin names nothing warned about", async () => {
    const user = userEvent.setup();
    currentContent = {
      ...DRAFT_CONTENT,
      origin: { kind: "support_entry", product_handle: null, order_id: null },
      linked_order_ids: [MISSING_ORDER_ID],
    };
    currentPreview = preview({ content: currentContent });
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const linked = await screen.findByRole("region", { name: "Linked orders" });

    await user.click(
      await within(linked).findByRole("button", { name: `Unlink order ${MISSING_ORDER_ID}` }),
    );

    expect(
      within(linked).getByRole("group", { name: `Unlink order ${MISSING_ORDER_ID}?` }),
    ).toHaveAccessibleDescription(/last link .* the publish gate warns about/);
  });

  it("asks twice to unlink an order that moved to another customer, without saying it is gone", async () => {
    // The shop still holds the order; the editor's list holds only this customer's orders.
    const user = userEvent.setup();
    currentContent = { ...DRAFT_CONTENT, linked_order_ids: [ORDER_ID, OTHER_CUSTOMER_ORDER_ID] };
    currentPreview = preview({
      content: currentContent,
      publishable: false,
      issues: [
        {
          severity: "error",
          code: "linked_order_of_another_customer",
          message: `order ${OTHER_CUSTOMER_ORDER_ID} belongs to another customer`,
          path: "linked_order_ids",
        },
      ],
    });
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const linked = await screen.findByRole("region", { name: "Linked orders" });

    await user.click(
      await within(linked).findByRole("button", {
        name: `Unlink order ${OTHER_CUSTOMER_ORDER_ID}`,
      }),
    );

    const confirm = within(linked).getByRole("group", {
      name: `Unlink order ${OTHER_CUSTOMER_ORDER_ID}?`,
    });
    expect(confirm).toHaveAccessibleDescription(/No order of this customer's matches it/);
    expect(confirm).not.toHaveAccessibleDescription(/no longer holds/);
  });

  it.each([
    [
      "an order page naming the order",
      { kind: "order_page", product_handle: null, order_id: ORDER_ID },
    ],
    [
      "a product page naming the product",
      { kind: "product_page", product_handle: "alpine-shell-jacket", order_id: null },
    ],
  ] as const)(
    "says no last-link clause when the only link goes but the origin is %s",
    async (_, origin) => {
      const user = userEvent.setup();
      currentContent = { ...DRAFT_CONTENT, origin, linked_order_ids: [MISSING_ORDER_ID] };
      currentPreview = preview({ content: currentContent });
      renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
      const linked = await screen.findByRole("region", { name: "Linked orders" });

      await user.click(
        await within(linked).findByRole("button", { name: `Unlink order ${MISSING_ORDER_ID}` }),
      );

      const confirm = within(linked).getByRole("group", {
        name: `Unlink order ${MISSING_ORDER_ID}?`,
      });
      expect(confirm).toHaveAccessibleDescription(/no checkbox links it again/);
      expect(confirm).not.toHaveAccessibleDescription(/last link/);
    },
  );

  it("unlinks a resolved order on one press, since its checkbox links it again", async () => {
    const user = userEvent.setup();
    currentContent = { ...DRAFT_CONTENT, linked_order_ids: [ORDER_ID] };
    currentPreview = preview({ content: currentContent });
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const linked = await screen.findByRole("region", { name: "Linked orders" });
    const order = await within(linked).findByRole("checkbox", { name: "NS-10482" });

    expect(order).toBeChecked();
    await user.click(order);

    expect(order).not.toBeChecked();
    // No confirm opens: the only group left is the Linked row itself.
    expect(within(linked).getAllByRole("group")).toEqual([
      within(linked).getByRole("group", { name: "Linked" }),
    ]);
    expect(within(linked).queryByText(/^Unlinked order/)).toBeNull();
    await user.click(order);
    expect(order).toBeChecked();
  });

  it("lists this customer's other tickets inside the customer's card", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const customer = await screen.findByRole("region", { name: "Customer" });

    const other = within(customer).getByRole("region", {
      name: "Other tickets from this customer",
    });
    expect(within(other).getByRole("link", { name: "T-187" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/tickets/${OTHER_TICKET_ID}`,
    );
    expect(within(other).getByText("Resolved")).toBeVisible();
  });

  it("only offers a resource picker the chosen origin can carry", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Conversation" });
    const incident = card("Incident");

    expect(within(incident).getByLabelText("Order")).toBeVisible();
    await user.selectOptions(within(incident).getByLabelText("Opened from"), "product_page");

    expect(within(incident).queryByLabelText("Order")).toBeNull();
    expect(within(incident).getByLabelText("Product")).toHaveValue("");
  });

  it("offers only the channels the shop supports, on a row with its rule", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Customer" });

    const channel = within(card("Incident")).getByLabelText("Channel");
    expect(
      Array.from(channel.querySelectorAll("option")).map((entry) => entry.textContent),
    ).toEqual(["Chat", "Email"]);
    expect(channel).toHaveAccessibleDescription(/the channel the incident arrived on/i);
  });
});

describe("the ticket's tags", () => {
  it("respells a typed tag, previews it, and refuses one the ticket already carries", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Conversation" });

    const tags = within(screen.getByRole("group", { name: "Tags" }));
    expect(tags.getByRole("button", { name: "Remove address-change" })).toBeVisible();

    await user.type(tags.getByLabelText("New tag"), "Refund Requested");
    expect(tags.getByLabelText("New tag")).toHaveAccessibleDescription(
      /Saved as refund-requested\./,
    );
    await user.click(tags.getByRole("button", { name: "Add tag" }));
    expect(tags.getByRole("button", { name: "Remove refund-requested" })).toBeVisible();

    // The comparison is against the stored spelling, which is what the lab holds unique.
    await user.type(tags.getByLabelText("New tag"), "Address Change");
    expect(tags.getByLabelText("New tag")).toBeInvalid();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "address-change is already a tag on this ticket.",
    );
    await user.click(tags.getByRole("button", { name: "Add tag" }));

    // Punctuation the gate would refuse (`_require_slug`) is respelled, and the preview says
    // so, rather than being previewed verbatim and refused after the save.
    await user.clear(tags.getByLabelText("New tag"));
    await user.type(tags.getByLabelText("New tag"), "Refund! (urgent)");
    expect(tags.getByLabelText("New tag")).toHaveAccessibleDescription(/Saved as refund-urgent\./);
    await user.click(tags.getByRole("button", { name: "Add tag" }));
    expect(tags.getByRole("button", { name: "Remove refund-urgent" })).toBeVisible();
    expect(tags.getByLabelText("New tag")).toHaveAttribute("maxlength", "64");

    await user.clear(tags.getByLabelText("New tag"));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedRequests).toHaveLength(1));
    expect(savedRequests[0].payload.tags).toEqual([
      "address-change",
      "refund-requested",
      "refund-urgent",
    ]);
  });
});

describe("saving and publishing", () => {
  it("saves the authored content without the derived thread facts", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Conversation" });

    await user.selectOptions(within(card("Incident")).getByLabelText("Status"), "resolved");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedRequests).toHaveLength(1));
    expect(savedRequests[0].payload.status).toBe("resolved");
    expect(savedRequests[0].payload).not.toHaveProperty("opened_at");
    expect(savedRequests[0].payload).not.toHaveProperty("customer_profile_id");
  });

  it("asks before another ticket is opened over unsaved work, and re-reads the listing once saved", async () => {
    const user = userEvent.setup();
    server.use(
      // The listing reflects what the lab holds, so a renamed ticket shows its new subject.
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () =>
        HttpResponse.json({
          tickets: TICKETS.tickets.map((ticket) =>
            ticket.ticket_id === TICKET_ID
              ? { ...ticket, subject: currentContent.subject }
              : ticket,
          ),
        } satisfies TicketListResponse),
      ),
      ...otherTicketHandlers(),
    );
    renderApp(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);

    const incident = within(await screen.findByRole("region", { name: "Incident" }));
    await user.clear(incident.getByLabelText("Subject"));
    await user.type(incident.getByLabelText("Subject"), "Address changed before dispatch");
    // The header reads back what is being edited.
    expect(
      screen.getByRole("heading", { level: 1, name: "Address changed before dispatch" }),
    ).toBeVisible();

    await user.click(within(card("Customer")).getByRole("link", { name: "T-187" }));
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    await user.click(within(prompt).getByRole("button", { name: "Save and leave" }));

    await waitFor(() => expect(savedRequests).toHaveLength(1));
    await screen.findByRole("heading", { level: 1, name: "Sizing question" });
    // The save's own re-read of the listing is what the index renders: the shell reads it
    // once, and nothing else on the way back reads it again (ADR 0056).
    await user.click(
      within(screen.getByRole("heading", { level: 1 }).closest("header") as HTMLElement).getByRole(
        "link",
        { name: "Tickets" },
      ),
    );
    const table = await ticketTable();
    expect(within(table).getByText("Address changed before dispatch")).toBeVisible();
    expect(within(table).queryByText("Wrong address concern")).toBeNull();
  });

  it("asks before the header's way back to Tickets leaves unsaved work", async () => {
    const user = userEvent.setup();
    const { router } = renderApp(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const incident = within(await screen.findByRole("region", { name: "Incident" }));
    await user.selectOptions(incident.getByLabelText("Status"), "resolved");

    const header = screen.getByRole("heading", { level: 1 }).closest("header") as HTMLElement;
    await user.click(within(header).getByRole("link", { name: "Tickets" }));

    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await user.click(within(prompt).getByRole("button", { name: "Stay on this page" }));
    expect(incident.getByLabelText("Status")).toHaveValue("resolved");
    expect(savedRequests).toHaveLength(0);
  });

  it("refuses to publish unsaved edits", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Conversation" });

    await user.selectOptions(within(card("Incident")).getByLabelText("Status"), "resolved");

    expectRefused(screen.getByRole("button", { name: "Publish v1" }), /Save the draft first/);
    expect(screen.getByText(/Save the draft first/)).toBeVisible();
    // The gate card says its findings are the last save's.
    expect(
      within(card("Publish gate")).getByText(
        "Read off the saved draft. Save to check what is on screen.",
      ),
    ).toBeVisible();
  });

  it("freezes the ticket and says what a scenario built on it will pin", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Conversation" });

    await user.click(screen.getByRole("button", { name: "Publish v1" }));

    await waitFor(() => expect(published).toBe(1));
    expect(await publicationNotice()).toHaveTextContent(
      /Published version 1\. A scenario built on this ticket freezes this exact version\./,
    );
  });

  it("keeps a refused publish visible instead of clearing the editor", async () => {
    const user = userEvent.setup();
    publishFailure = {
      status: 422,
      body: {
        code: "definition_reference_unpublished",
        message: "customer_profile has no published version to pin; publish it first",
        request_id: "req-1",
      },
    };
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Conversation" });

    await user.click(screen.getByRole("button", { name: "Publish v1" }));

    const header = screen.getByRole("heading", { level: 1 }).closest("header") as HTMLElement;
    expect(await within(header).findByRole("alert")).toHaveTextContent(
      /has no published version to pin/,
    );
    expect(screen.getByRole("region", { name: "Conversation" })).toBeVisible();
  });
});

/**
 * The ticket editor's cards on the reference pages' rows: *Linked orders* as the Linked row and
 * *Suggested documents* as one row per kind, each box keeping the name the specs check it by.
 */
describe("the ticket editor's rows", () => {
  it("draws the linked orders as the Linked group row, each box keeping its order's reference", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const linked = await screen.findByRole("region", { name: "Linked orders" });

    const row = within(linked).getByRole("group", { name: "Linked" });
    expectGroupRow(row, "Linked");
    // Reached the way the specs reach it: by the reference its wrapping label gives it.
    const order = await within(row).findByRole("checkbox", { name: "NS-10482" });
    expect(within(row).getAllByRole("checkbox")).toEqual([order]);
    expect(within(row).getByText(/ship-to: Bordeaux — previous flat/)).toBeVisible();
  });

  it("keeps an unresolved link on the Linked row, its Unlink and its confirm named as before", async () => {
    const user = userEvent.setup();
    currentContent = { ...DRAFT_CONTENT, linked_order_ids: [ORDER_ID, MISSING_ORDER_ID] };
    currentPreview = preview({ content: currentContent });
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const linked = await screen.findByRole("region", { name: "Linked orders" });
    const row = within(linked).getByRole("group", { name: "Linked" });

    const unlink = await within(row).findByRole("button", {
      name: `Unlink order ${MISSING_ORDER_ID}`,
    });
    await user.click(unlink);

    // The confirm takes the entry's place inside the row, as a list item.
    const confirm = within(row).getByRole("group", { name: `Unlink order ${MISSING_ORDER_ID}?` });
    expect(confirm.closest("li")?.parentElement?.closest("fieldset")).toBe(row);
    expect(confirm).toHaveFocus();
    await user.click(within(confirm).getByRole("button", { name: "Unlink" }));
    expect(within(row).queryByText("Unresolved order")).toBeNull();
    expect(within(row).getByRole("checkbox", { name: "NS-10482" })).toBeChecked();
  });

  it("says inside the Linked row that the customer has no order in the shop", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets/${TICKET_ID}/context`, () =>
        HttpResponse.json({ ...CONTEXT, resources: { ...CONTEXT.resources, orders: [] } }),
      ),
    );
    currentContent = { ...DRAFT_CONTENT, linked_order_ids: [] };
    currentPreview = preview({ content: currentContent });
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const linked = await screen.findByRole("region", { name: "Linked orders" });

    const row = within(linked).getByRole("group", { name: "Linked" });
    expect(
      await within(row).findByText("This customer has no order in this shop yet."),
    ).toBeVisible();
    expect(within(row).queryByRole("checkbox")).toBeNull();
  });

  it("draws the suggested documents as one group row per kind, named by the kind's chip", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const documents = await screen.findByRole("region", { name: "Suggested documents" });

    for (const [kind, title] of [
      ["Policies", "Address-change policy"],
      ["Guidelines", "Escalating a refund"],
      ["FAQ", "When will my order arrive?"],
    ] as const) {
      const row = await within(documents).findByRole("group", { name: kind });
      expectGroupRow(row, kind);
      expect(within(row).getAllByRole("checkbox")).toEqual([
        within(row).getByRole("checkbox", { name: title }),
      ]);
    }
  });

  it("keeps an unresolved suggestion's Remove and confirm under the rows, named as before", async () => {
    const user = userEvent.setup();
    currentContent = {
      ...DRAFT_CONTENT,
      suggested_documents: [{ kind: "policy", document_id: "delivery" }],
    };
    currentPreview = preview({ content: currentContent });
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const documents = await screen.findByRole("region", { name: "Suggested documents" });

    await user.click(
      await within(documents).findByRole("button", { name: "Remove suggested policy delivery" }),
    );
    const confirm = within(documents).getByRole("group", {
      name: "Remove the suggested policy delivery?",
    });
    expect(confirm.closest("li")).not.toBeNull();
    // Beneath the kinds' rows rather than inside one: a kind's row is drawn only while the
    // shop holds a document of that kind, so its kind may have no row left to hold it.
    expect(confirm.parentElement?.closest("fieldset")).toBeNull();
    expect(confirm).toHaveFocus();
  });

  it("draws every field of every card in its main column on a row that names it", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const panel = sidePanel(await screen.findByRole("region", { name: "Publish gate" }));
    await within(card("Linked orders")).findByRole("checkbox", { name: "NS-10482" });
    await within(card("Suggested documents")).findByRole("checkbox", {
      name: "When will my order arrive?",
    });

    // Enumerated, so a card added to the column is swept too. The tags are a self-labelling
    // list, `ChipListField`, whose own legend stands beneath the rows by the rule; the
    // thread's composer is the form below the list.
    expect(
      expectEditorOnRows(panel, {
        Incident: (card) => [within(card).getByRole("group", { name: "Tags" })],
      }),
    ).toEqual({ Incident: 5, Conversation: 0, "Linked orders": 1, "Suggested documents": 3 });
  });
});
