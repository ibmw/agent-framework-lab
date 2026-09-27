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
import { TOURS, tourAt } from "./lib/tours";
import { renderApp } from "./test/app";
import { expectNotRefused, expectRefused, submitWithoutPressing } from "./test/refused";
import { railEntry, shellListings } from "./test/shell";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const PROFILE_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const ORDER_ID = "9f8e7d6c-5b4a-4938-8271-6a5b4c3d2e1f";
const TICKET_ID = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
const OTHER_TICKET_ID = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
/** An order the ticket still links but the shop no longer resolves. */
const MISSING_ORDER_ID = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f";
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

describe("ticket list", () => {
  // The thread's subject line is drawn in open code rather than by `Card` or `PageHeader`, so
  // it is measured against the one size the prototype draws between a page title and a card
  // title.
  it("names the page once, over the list and the ticket, with what the shop holds under it", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets`);

    const title = await screen.findByRole("heading", { level: 1, name: "Tickets" });
    const header = title.closest("header") as HTMLElement;

    // The whole listing, as the rail counts it — not the rows the filter leaves.
    expect(await within(header).findByText("2 in this shop")).toBeVisible();
    // The header is above both columns rather than inside the list, and the list no longer
    // titles itself a second time.
    const list = screen.getByRole("region", { name: "Tickets" });
    expect(header.contains(list)).toBe(false);
    expect(list.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(within(list).queryByRole("heading", { name: "Tickets" })).toBeNull();
    expect(within(list).getByLabelText("Filter tickets")).toBeVisible();
  });

  it("keeps counting the whole shop while the filter narrows the list", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets`);
    const header = (await screen.findByRole("heading", { level: 1, name: "Tickets" })).closest(
      "header",
    ) as HTMLElement;
    await within(header).findByText("2 in this shop");

    await user.selectOptions(screen.getByLabelText("Filter tickets"), "open");

    expect(within(header).getByText("2 in this shop")).toBeVisible();
  });

  it("says no count while the listing cannot be read", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "down", request_id: "req-1" },
          { status: 500 },
        ),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/tickets`);

    const header = (await screen.findByRole("heading", { level: 1, name: "Tickets" })).closest(
      "header",
    ) as HTMLElement;
    await screen.findByRole("alert");

    expect(within(header).queryByText(/in this shop/)).toBeNull();
  });

  it("draws the thread's subject in the display face at the prototype's 19px", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets`);

    const subject = await screen.findByRole("heading", {
      level: 2,
      name: /Wrong address concern/,
    });

    expect(subject.className).toContain("font-display");
    expect(subject.className).toContain("text-[19px]");
    expect(subject.className).toContain("font-bold");
    expect(subject.className).not.toMatch(/\btext-(xs|sm|base|lg|xl)\b/);
  });

  it("shows each incident with its customer, preview, and channel", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets`);

    expect(await screen.findByText("Wrong address concern")).toBeVisible();
    const rows = within(screen.getByRole("region", { name: "Tickets" })).getByRole("list");
    expect(within(rows).getAllByText("Maya Laurent")).toHaveLength(2);
    expect(within(rows).getByText(/I just noticed this is going to my old address/)).toBeVisible();
    expect(within(rows).getByText("No first message yet")).toBeVisible();
    expect(within(rows).getByText("Open")).toBeVisible();
    expect(within(rows).getByText("Resolved")).toBeVisible();
  });

  it("filters by status with the count the frame shows", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets`);
    await screen.findByText("Wrong address concern");
    const list = screen.getByRole("region", { name: "Tickets" });

    await user.selectOptions(within(list).getByLabelText("Filter tickets"), "open");

    expect(within(list).getByText("Wrong address concern")).toBeVisible();
    expect(within(list).queryByText("Sizing question")).toBeNull();
    expect(within(list).getByRole("option", { name: "Open (1)" })).toBeVisible();
  });

  it("opens on the incident touched most recently, not the first one listed", async () => {
    // Listed second and updated later, so a page that opened on the head of the list would pass
    // this by accident. What the operator wants back is the one they were last working on.
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () =>
        HttpResponse.json({
          tickets: [
            { ...TICKETS.tickets[1], updated_at: "2026-08-24T09:00:00+00:00" },
            { ...TICKETS.tickets[0], updated_at: "2026-08-25T17:30:00+00:00" },
          ],
        }),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/tickets`);

    expect(
      await screen.findByRole("heading", { name: /T-204 · Wrong address concern/ }),
    ).toBeVisible();
  });

  it("opens on an address the tour table still knows as tickets", async () => {
    // The defect this is written for shipped: the bar reads the surface's tour from the route
    // (ADR 0055), this page replaces its own address with the ticket it opens, and the table
    // named only the index — so the helpdesk lost its *Show me around* one frame after
    // loading, on every lab holding a ticket. The browser sweep catches it too; this catches
    // it with no browser and no timing, by asking the table about the address the redirect
    // actually produced.
    const { router } = renderApp(`/shops/${SHOP_ID}/tickets`);
    await screen.findByRole("heading", { name: /T-204 · Wrong address concern/ });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`),
    );

    expect(tourAt(router.state.location.pathname)).toBe("tickets");
    expect(
      screen.getByRole("button", { name: `Show me around ${TOURS.tickets.surface}` }),
    ).toBeVisible();
  });

  it("says so rather than opening something when the shop has no incidents", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () => HttpResponse.json({ tickets: [] })),
    );
    renderAt(`/shops/${SHOP_ID}/tickets`);

    expect(await screen.findByText(/No tickets yet/)).toBeVisible();
  });

  it("moves between tickets without leaving the shop", async () => {
    const user = userEvent.setup();
    server.use(...otherTicketHandlers());
    const { router } = renderApp(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("heading", { name: /T-204 · Wrong address concern/ });

    const rows = within(within(screen.getByRole("region", { name: "Tickets" })).getByRole("list"));
    await user.click(rows.getByRole("link", { name: /Sizing question/ }));

    // A relative-by-path link resolved against `/shops/…/tickets/T-204` asked for
    // `…/tickets/tickets/…`, which matches no route, and the catch-all put the operator back
    // on the shop index — out of the shop they were working in.
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/tickets/${OTHER_TICKET_ID}`),
    );
  });

  it("takes no reference until it knows which references are free", async () => {
    const user = userEvent.setup();
    let release: (() => void) | null = null;
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json(TICKETS);
      }),
    );
    renderAt(`/shops/${SHOP_ID}/tickets`);
    const list = within(await screen.findByRole("region", { name: "Tickets" }));

    // The suggestion is the next free reference, and which one that is is exactly what the
    // list still has to say. An operator who types into the field before it lands has their
    // reference written over by the suggestion arriving behind it.
    expect(list.getByLabelText("Reference")).toBeDisabled();
    expect(list.getByLabelText("Reference")).toHaveValue("");

    await user.type(list.getByLabelText("Subject"), "Late delivery");
    await list.findByRole("option", { name: "Maya Laurent" });
    await user.selectOptions(list.getByLabelText("Customer"), PROFILE_ID);
    await user.click(list.getByRole("button", { name: "Open ticket" }));

    // Nothing was opened — and the form says so rather than leaving the button to do nothing.
    expect(createdTickets).toHaveLength(0);
    expect(list.getByRole("alert")).toHaveTextContent(
      "The ticket needs a reference before it can be opened.",
    );

    (release as unknown as () => void)();
    await waitFor(() => expect(list.getByLabelText("Reference")).toBeEnabled());
    // Enabled and already holding the suggestion: never enabled and empty.
    expect(list.getByLabelText("Reference")).toHaveValue("T-205");
  });

  it("takes no reference while a create is in flight either", async () => {
    const user = userEvent.setup();
    let release: (() => void) | null = null;
    let reads = 0;
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, async () => {
        reads += 1;
        if (reads === 1) {
          return HttpResponse.json(TICKETS);
        }
        // The reload a create triggers, held open: the list that decides the next free
        // reference has not answered yet, so neither has the suggestion.
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json({
          tickets: [...TICKETS.tickets, { ...TICKETS.tickets[0], reference: "T-205" }],
        } satisfies TicketListResponse);
      }),
    );
    renderAt(`/shops/${SHOP_ID}/tickets`);
    const list = within(await screen.findByRole("region", { name: "Tickets" }));
    await list.findByRole("option", { name: "Maya Laurent" });
    await waitFor(() => expect(list.getByLabelText("Reference")).toHaveValue("T-205"));
    await user.type(list.getByLabelText("Subject"), "Late delivery");
    await user.selectOptions(list.getByLabelText("Customer"), PROFILE_ID);

    await user.click(list.getByRole("button", { name: "Open ticket" }));

    // The list panel stays on screen across the create, and the list behind the suggestion is
    // moving. Left open, the field would be back where it started: empty, editable, and about
    // to be written over — or still showing the reference that has just been used.
    await waitFor(() => expect(list.getByLabelText("Reference")).toBeDisabled());
    expect(list.getByLabelText("Reference")).toHaveValue("");

    (release as unknown as () => void)();
    await waitFor(() => expect(list.getByLabelText("Reference")).toBeEnabled());
    expect(list.getByLabelText("Reference")).toHaveValue("T-206");
  });

  it("opens a ticket for a customer attached to this shop", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets`);
    await screen.findByRole("region", { name: "Tickets" });

    // Scoped to the list panel: the page opens on the most recently updated ticket, so the
    // editor's own Subject is on screen beside this form's.
    const list = within(screen.getByRole("region", { name: "Tickets" }));
    await list.findByRole("option", { name: "Maya Laurent" });
    await waitFor(() => expect(list.getByLabelText("Reference")).toHaveValue("T-205"));
    await user.type(list.getByLabelText("Subject"), "Late delivery");
    await user.selectOptions(list.getByLabelText("Customer"), PROFILE_ID);
    await user.click(list.getByRole("button", { name: "Open ticket" }));

    await waitFor(() => expect(createdTickets).toHaveLength(1));
    expect(createdTickets[0]).toMatchObject({
      reference: "T-205",
      subject: "Late delivery",
      customer_profile_id: PROFILE_ID,
      channel: "chat",
    });
  });

  it("opens the ticket it created with one navigation, not two", async () => {
    const user = userEvent.setup();
    // A ticket created from `/tickets` is opened by the create. The page also opens the most
    // recently updated ticket when it is given none — and that effect is scheduled from the
    // render the reloaded list produces, where `ticketId` is still undefined although the
    // create's navigation is already on its way. Left alone it sent a second navigation after
    // the first, every time, on the one page in the workspace that creates and navigates in
    // the same breath. PLAN-UX Slice 10 gives that shape to eight more surfaces.
    // The shop has no incident yet, which is the journey the e2e specs walk: the page is
    // standing on `/tickets` with nothing named when the create lands.
    let listed: TicketSummarySchema[] = [];
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () =>
        HttpResponse.json({ tickets: listed } satisfies TicketListResponse),
      ),
    );
    const { router } = renderApp(`/shops/${SHOP_ID}/tickets`);
    await screen.findByText(/No tickets yet/);
    const keys = new Set<string>([router.state.location.key]);
    router.subscribe((state) => keys.add(state.location.key));
    listed = TICKETS.tickets.filter((ticket) => ticket.ticket_id === TICKET_ID);

    const list = within(screen.getByRole("region", { name: "Tickets" }));
    await list.findByRole("option", { name: "Maya Laurent" });
    await waitFor(() => expect(list.getByLabelText("Reference")).not.toHaveValue(""));
    await user.type(list.getByLabelText("Subject"), "Late delivery");
    await user.selectOptions(list.getByLabelText("Customer"), PROFILE_ID);
    await user.click(list.getByRole("button", { name: "Open ticket" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`),
    );
    // One location beyond the one it started on: the redirect did not follow the create.
    expect([...keys]).toHaveLength(2);
  });

  it("re-reads the list when the prompt saves the ticket, not only when the button does", async () => {
    const user = userEvent.setup();
    server.use(
      // The list reflects what the lab holds, so a renamed ticket shows its new subject.
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

    const details = within(await screen.findByRole("region", { name: "Ticket details" }));
    await user.clear(details.getByLabelText("Subject"));
    await user.type(details.getByLabelText("Subject"), "Address changed before dispatch");

    // Moving to the customer's other ticket happens inside this page, so nothing remounts and
    // the list stays on screen to be wrong on.
    const other = within(screen.getByRole("region", { name: "Other tickets from this customer" }));
    await user.click(other.getByRole("link", { name: "T-187" }));
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    await user.click(within(prompt).getByRole("button", { name: "Save and leave" }));

    await waitFor(() => expect(savedRequests).toHaveLength(1));
    // The save landed, and so did the read that follows every save of this draft — which the
    // page's own Save button used to be the only thing that ran.
    const list = within(screen.getByRole("region", { name: "Tickets" }));
    expect(await list.findByText("Address changed before dispatch")).toBeVisible();
    expect(list.queryByText("Wrong address concern")).toBeNull();
  });

  it("offers only the channels this shop supports", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets`);
    await screen.findByRole("region", { name: "Tickets" });

    const list = within(screen.getByRole("region", { name: "Tickets" }));
    const channel = list.getByLabelText("Channel");
    expect(
      Array.from(channel.querySelectorAll("option")).map((entry) => entry.textContent),
    ).toEqual(["Chat", "Email"]);
  });

  it("opens the new ticket on the one attached customer, and says so", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets`);

    const list = within(await screen.findByRole("region", { name: "Tickets" }));
    const customer = list.getByLabelText("Customer");
    await waitFor(() => expect(customer).toHaveValue(PROFILE_ID));
    await waitFor(() =>
      expect(customer).toHaveAccessibleDescription(
        /This one is the only customer attached to this shop, so it is already chosen\./,
      ),
    );
  });

  it("puts each new-ticket field's hint in that control's accessible description", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets`);

    const list = within(await screen.findByRole("region", { name: "Tickets" }));
    expect(list.getByLabelText("Reference")).toHaveAccessibleDescription(
      /uppercase letters, digits, and hyphens.*named in scenarios/i,
    );
    expect(list.getByLabelText("Subject")).toHaveAccessibleDescription(
      /the incident as the customer would describe it/i,
    );
    expect(list.getByLabelText("Customer")).toHaveAccessibleDescription(
      /only customers attached to this shop/i,
    );
    expect(list.getByLabelText("Channel")).toHaveAccessibleDescription(
      /the channel the incident arrived on/i,
    );
  });

  it("prefills the next free reference, resumes when emptied, and refuses a duplicate", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets`);
    const list = within(await screen.findByRole("region", { name: "Tickets" }));

    await waitFor(() => expect(list.getByLabelText("Reference")).toHaveValue("T-205"));
    await user.clear(list.getByLabelText("Reference"));
    await user.type(list.getByLabelText("Reference"), "T-900");
    await user.clear(list.getByLabelText("Reference"));
    expect(list.getByLabelText("Reference")).toHaveValue("");
    await user.tab();
    expect(list.getByLabelText("Reference")).toHaveValue("T-205");

    await user.clear(list.getByLabelText("Reference"));
    await user.type(list.getByLabelText("Reference"), "T-204");
    expect(list.getByLabelText("Reference")).toBeInvalid();
    expect(list.getByLabelText("Reference")).toHaveAccessibleDescription(
      /t-204 is already used by a ticket in this shop/i,
    );
    await user.click(list.getByRole("button", { name: "Open ticket" }));
    expect(createdTickets).toHaveLength(0);
  });

  it("does not guess a reference after the listing fails to load", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () =>
        HttpResponse.json(
          { code: "unavailable", message: "The listing could not be read.", request_id: "r" },
          { status: 503 },
        ),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/tickets`);
    const list = within(await screen.findByRole("region", { name: "Tickets" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/listing could not be read/i);
    expect(list.getByLabelText("Reference")).toHaveValue("");
  });

  it("shows a refused create beside the button that failed, not as a listing load error", async () => {
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
    renderAt(`/shops/${SHOP_ID}/tickets`);
    const list = within(await screen.findByRole("region", { name: "Tickets" }));

    await list.findByRole("option", { name: "Maya Laurent" });
    await user.type(list.getByLabelText("Subject"), "Late delivery");
    await user.selectOptions(list.getByLabelText("Customer"), PROFILE_ID);
    await user.click(list.getByRole("button", { name: "Open ticket" }));

    expect(await list.findByRole("alert")).toHaveTextContent(/reference already exists/i);
    expect(createdTickets).toHaveLength(0);
  });

  it("reports a failed listing reload as a load error, not a failed create", async () => {
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
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () => {
        if (created) {
          return HttpResponse.json(
            { code: "unavailable", message: "The listing could not be read.", request_id: "r" },
            { status: 503 },
          );
        }
        return HttpResponse.json(TICKETS);
      }),
    );
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets`);
    const list = within(await screen.findByRole("region", { name: "Tickets" }));

    await list.findByRole("option", { name: "Maya Laurent" });
    await user.type(list.getByLabelText("Subject"), "Late delivery");
    await user.selectOptions(list.getByLabelText("Customer"), PROFILE_ID);
    await user.click(list.getByRole("button", { name: "Open ticket" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/listing could not be read/i);
    const form = list.getByRole("button", { name: "Open ticket" }).closest("form");
    expect(form).not.toBeNull();
    expect(within(form as HTMLElement).queryByRole("alert")).toBeNull();
  });
});

describe("ticket thread", () => {
  it("renders prior history and badges the trigger every arm receives", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);

    const thread = await screen.findByRole("region", { name: "Ticket thread" });
    expect(within(thread).getByText(/prior support history/i)).toBeVisible();
    expect(within(thread).getByText(/Did my payment go through/)).toBeVisible();
    expect(within(thread).getByText("Past support agent")).toBeVisible();
    expect(within(thread).getByText(/Trigger — sent to every arm/i)).toBeVisible();
    expect(within(thread).getByText("first message")).toBeVisible();
  });

  it("asks before the first message leaves, saying no earlier message takes its place", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const thread = within(await screen.findByRole("region", { name: "Ticket thread" }));

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
    await screen.findByRole("heading", { name: /T-204 · Wrong address concern/ });
    const thread = () => within(screen.getByRole("region", { name: "Ticket thread" }));

    await user.click(
      thread()
        .getAllByRole("button", { name: /^Remove message from Maya Laurent/ })
        .at(-1) as HTMLElement,
    );
    expect(thread().getByRole("group", { name: /^Remove the first message/ })).toBeVisible();

    // Both fixtures key their first message `trigger`; the confirm was asked about T-204's.
    const rows = within(within(screen.getByRole("region", { name: "Tickets" })).getByRole("list"));
    await user.click(rows.getByRole("link", { name: /Sizing question/ }));
    await screen.findByRole("heading", { name: /T-187 · Sizing question/ });

    expect(thread().queryByRole("group", { name: /^Remove the first message/ })).toBeNull();
    expect(thread().getByText("first message")).toBeVisible();
  });

  it("says a live reply belongs to the bench, not to the ticket", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);

    const thread = await screen.findByRole("region", { name: "Ticket thread" });
    expect(within(thread).getByText(/Replies happen on the live bench, per run/)).toBeVisible();
    expect(within(thread).getByRole("button", { name: "as Maya Laurent" })).toBeVisible();
    expect(within(thread).getByRole("button", { name: "as past support" })).toBeVisible();
  });

  it("adds a past support reply to history rather than making it the trigger", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    const thread = await screen.findByRole("region", { name: "Ticket thread" });

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
    const thread = within(await screen.findByRole("region", { name: "Ticket thread" }));
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
    const thread = await screen.findByRole("region", { name: "Ticket thread" });

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

  it("says what is missing when a ticket has no first message", async () => {
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

    const thread = await screen.findByRole("region", { name: "Ticket thread" });
    expect(within(thread).getByText(/No first message yet/)).toBeVisible();
    expect(
      within(card("Validation")).getByText(/must carry the first message every arm receives/),
    ).toBeVisible();
  });
});

describe("ticket context panel", () => {
  it("shows the customer, the linked order, and the documents a scenario would inherit", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Ticket thread" });

    const customer = card("Customer");
    expect(within(customer).getByText(/Maya Laurent/)).toBeVisible();
    expect(within(customer).getByText("Home — Lyon")).toBeVisible();
    expect(within(customer).getByText("1 order(s) · 2 ticket(s)")).toBeVisible();

    const linked = card("Linked objects");
    expect(within(linked).getByText("NS-10482")).toBeVisible();
    // The order's two statuses read as words on a pill, not as the wire's own spelling.
    expect(within(linked).getByText("Paid")).toBeVisible();
    expect(within(linked).getByText("Unfulfilled")).toBeVisible();
    expect(within(linked).queryByText(/unfulfilled/)).toBeNull();
    expect(within(linked).getByText(/ship-to: Bordeaux — previous flat/)).toBeVisible();

    // Each document is named by its title and its kind, an FAQ entry by its question; the
    // slug is how the ticket refers to it, not how an author reads it.
    const documents = card("Suggested documents");
    expect(within(documents).getByLabelText(/^Address-change policy/)).toBeChecked();
    expect(within(documents).getByLabelText(/^Escalating a refund/)).not.toBeChecked();
    expect(within(documents).getByLabelText(/^When will my order arrive\?/)).not.toBeChecked();
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
    await screen.findByRole("region", { name: "Ticket thread" });

    expect(await screen.findByText(/from product page Alpine Shell Jacket/)).toBeVisible();
    const picker = within(card("Ticket details")).getByLabelText("Product");
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
    await screen.findByRole("region", { name: "Ticket thread" });

    const header = (await screen.findByText(/from product page/)).closest("p");
    await waitFor(() => expect(header).toHaveTextContent(/trailhead-cap \(unresolved\)/));
    const picker = within(card("Ticket details")).getByLabelText("Product");
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
    await screen.findByRole("region", { name: "Ticket thread" });
    const documents = card("Suggested documents");

    expect(await within(documents).findByText("Unresolved document")).toBeVisible();
    expect(within(documents).getByText("policy · delivery")).toBeVisible();
    expect(within(documents).getByLabelText(/^When will my order arrive\?/)).not.toBeChecked();
    await user.click(
      within(documents).getByRole("button", { name: "Remove suggested policy delivery" }),
    );

    expect(within(documents).queryByText("Unresolved document")).toBeNull();
    expect(within(documents).getByLabelText(/^Address-change policy/)).toBeChecked();
  });

  it("keeps a link the shop can no longer resolve removable", async () => {
    // A deleted order blocks publication; without a row of its own the author would have no
    // checkbox left to uncheck.
    const user = userEvent.setup();
    currentContent = { ...DRAFT_CONTENT, linked_order_ids: [ORDER_ID, MISSING_ORDER_ID] };
    currentPreview = preview({ content: currentContent });
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Ticket thread" });
    const linked = card("Linked objects");

    expect(within(linked).getByText("Unresolved order")).toBeVisible();
    await user.click(
      within(linked).getByRole("button", { name: `Unlink order ${MISSING_ORDER_ID}` }),
    );

    expect(within(linked).queryByText("Unresolved order")).toBeNull();
  });

  it("lists this customer's other tickets", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Ticket thread" });

    const other = card("Other tickets from this customer");
    expect(within(other).getByRole("link", { name: "T-187" })).toBeVisible();
    expect(within(other).getByText("Resolved")).toBeVisible();
  });

  it("only offers a resource picker the chosen origin can carry", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Ticket thread" });
    const details = card("Ticket details");

    expect(within(details).getByLabelText("Order")).toBeVisible();
    await user.selectOptions(within(details).getByLabelText("Opened from"), "product_page");

    expect(within(details).queryByLabelText("Order")).toBeNull();
    expect(within(details).getByLabelText("Product")).toHaveValue("");
  });
});

describe("the ticket's tags", () => {
  it("respells a typed tag, previews it, and refuses one the ticket already carries", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Ticket thread" });

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
    await screen.findByRole("region", { name: "Ticket thread" });

    await user.selectOptions(within(card("Ticket details")).getByLabelText("Status"), "resolved");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedRequests).toHaveLength(1));
    expect(savedRequests[0].payload.status).toBe("resolved");
    expect(savedRequests[0].payload).not.toHaveProperty("opened_at");
    expect(savedRequests[0].payload).not.toHaveProperty("customer_profile_id");
  });

  it("refuses to publish unsaved edits", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Ticket thread" });

    await user.selectOptions(within(card("Ticket details")).getByLabelText("Status"), "resolved");

    expectRefused(screen.getByRole("button", { name: "Publish v1" }), /Save the draft first/);
    expect(screen.getByText(/Save the draft first/)).toBeVisible();
  });

  it("freezes the ticket and says what a scenario built on it will pin", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Ticket thread" });

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
    await screen.findByRole("region", { name: "Ticket thread" });

    await user.click(screen.getByRole("button", { name: "Publish v1" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/has no published version to pin/);
    expect(screen.getByRole("region", { name: "Ticket thread" })).toBeVisible();
  });
});

/**
 * The rail's figure and this index are one listing, read once by the shell and handed to
 * both, so they cannot come to disagree (ADR 0056).
 */
describe("the rail's figure and this index", () => {
  it("says on the rail what the list has entries", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets`);

    const list = await screen.findByRole("region", { name: "Tickets" });
    const entries = within(list).getAllByRole("listitem").length;
    const entry = railEntry("Tickets");
    expect(within(entry).getByText(String(entries))).toBeVisible();
    expect(entry).toHaveAccessibleDescription(`${entries} ticket${entries === 1 ? "" : "s"}`);
  });
});

describe("the helpdesk layout", () => {
  it("arrives with the rail expanded, like every other section", async () => {
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Ticket thread" });

    const collapse = screen.getByRole("button", { name: "Collapse menu" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(
      within(screen.getByRole("navigation", { name: "Shop workspace" })).getByText("Tickets"),
    ).toBeVisible();
  });

  it("collapses to an icon rail on request and keeps every label reachable", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/tickets/${TICKET_ID}`);
    await screen.findByRole("region", { name: "Ticket thread" });

    await user.click(screen.getByRole("button", { name: "Collapse menu" }));

    const rail = screen.getByRole("navigation", { name: "Shop workspace" });
    expect(screen.getByRole("button", { name: "Expand menu" })).toBeVisible();
    // Collapsed is a first-class layout, not a hidden one: the names survive as link names.
    expect(within(rail).getByRole("link", { name: "Tickets" })).toBeVisible();
  });
});
