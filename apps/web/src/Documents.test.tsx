import type {
  ScenarioListResponse,
  ShopDraftResponse,
  ShopListResponse,
  ShopPayloadSchema,
  ShopPreviewResponse,
} from "@agent-lab/contracts";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { toPayload } from "./lib/shop";
import { renderApp } from "./test/app";
import { bodyRows, railEntry, shellListings } from "./test/shell";

/**
 * The shop's documents on one table, and one document on a page (PLAN-UX Slice 16).
 *
 * What this suite is for, in the order the slice's own *Checks* line names it: the chips'
 * counts against the three lists that produce them, the chip the payload has no figure for,
 * the editor's kind, and the claim underneath all of it — that a table over three lists
 * moves nothing in the shop's canonical document. The slice's stated evidence is the last
 * case: an operator searches "returns", finds the policy and the guideline in one list, and
 * opens the guideline in a page.
 */

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const SCENARIO_ID = "aa11bb22-cc33-4d44-8e55-ff6677889900";

const CONTENT: ShopDraftResponse["content"] = {
  identity: {
    name: "Northstar Outfitters",
    slug: "northstar",
    locale: "en-GB",
    currencies: ["EUR"],
    channels: ["chat"],
  },
  products: [],
  policies: [
    { id: "returns-policy", title: "Returns policy", kind: "returns", body: "Thirty days." },
    {
      id: "shipping-policy",
      title: "Shipping and delivery",
      kind: "shipping",
      body: "Standard delivery is 2 to 5 working days.\n\nExpress is next working day.",
    },
  ],
  support_guidelines: [
    {
      id: "returns-desk",
      title: "Returns without a receipt",
      body: "Offer a credit note rather than refusing.",
    },
  ],
  faq: [
    {
      id: "delivery-times",
      question: "When will my order arrive?",
      answer: "Standard delivery arrives in 2 to 5 working days.",
    },
  ],
  payment_methods: [],
  fulfilment_methods: [],
  tone_of_voice_guidelines: [],
  default_tone_of_voice_id: null,
};

const SHOPS: ShopListResponse = {
  shops: [
    {
      shop_id: SHOP_ID,
      name: "Northstar Outfitters",
      slug: "northstar",
      updated_at: "2026-09-20T12:05:00+00:00",
      latest_published_version: 1,
      published_version_count: 1,
    },
  ],
};

/**
 * One scenario that names two of these documents as context.
 *
 * Its listing row carries `context_document_count` and no document at all, which is exactly
 * why the *Required by a scenario* chip is not drawn — the case below asserts the absence
 * against this row rather than against an empty listing, so a shop that plainly *has* the
 * documents a scenario reads still gets no faked figure.
 */
const SCENARIOS: ScenarioListResponse = {
  scenarios: [
    {
      scenario_id: SCENARIO_ID,
      name: "Wrong shipping address",
      ticket_id: "bb22cc33-dd44-4e55-8f66-001122334455",
      ticket_reference: "T-204",
      ticket_subject: "Address is wrong",
      customer_display_name: "Maya Laurent",
      objective_count: 1,
      mutation_count: 0,
      context_document_count: 2,
      max_turns: 12,
      updated_at: "2026-09-20T10:00:00+00:00",
      latest_published_version: 1,
      published_version_count: 1,
    },
  ],
};

const PREVIEW: ShopPreviewResponse = {
  shop_id: SHOP_ID,
  publishable: true,
  issues: [],
  changes: [],
  content_fingerprint: "a".repeat(64),
  latest_published_version: 1,
  next_version: 2,
  matches_latest_published: true,
  content: CONTENT,
};

let savedDrafts: ShopPayloadSchema[] = [];

const server = setupServer(
  http.get("*/api/v1/shops", () => HttpResponse.json(SHOPS)),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft`, () =>
    HttpResponse.json({
      shop_id: SHOP_ID,
      lifecycle_state: "draft",
      content: CONTENT,
      created_at: "2026-09-20T12:00:00+00:00",
      updated_at: "2026-09-20T12:05:00+00:00",
    } satisfies ShopDraftResponse),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft/preview`, () => HttpResponse.json(PREVIEW)),
  http.put(`*/api/v1/shops/${SHOP_ID}/draft`, async ({ request }) => {
    const body = (await request.json()) as { payload: ShopPayloadSchema };
    savedDrafts.push(body.payload);
    return HttpResponse.json({
      shop_id: SHOP_ID,
      lifecycle_state: "draft",
      content: CONTENT,
      created_at: "2026-09-20T12:00:00+00:00",
      updated_at: "2026-09-20T12:06:00+00:00",
    } satisfies ShopDraftResponse);
  }),
  http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () => HttpResponse.json(SCENARIOS)),
  ...shellListings(),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  savedDrafts = [];
});

function table() {
  return screen.getByRole("region", { name: "Documents" });
}

/** The table, and the router it is on — the chip this index draws lives in the address. */
async function openTable(at = `/shops/${SHOP_ID}/setup/policies`) {
  const { router } = renderApp(at);
  await screen.findByRole("region", { name: "Documents" });
  return router;
}

describe("the Documents table", () => {
  it("draws the three lists as one table, with each document's kind beside it", async () => {
    await openTable();

    const rows = within(table()).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("link").textContent)).toEqual([
      "Returns policy",
      "Shipping and delivery",
      "Returns without a receipt",
      "When will my order arrive?",
    ]);
    // A policy's own subject is a field of the policy and is drawn beside the kind; the other
    // two collections have no such field and nothing is invented for them.
    expect(within(rows[0]).getByText("Policy")).toBeVisible();
    expect(within(rows[0]).getByText("Returns")).toBeVisible();
    expect(within(rows[2]).getByText("Guideline")).toBeVisible();
    expect(within(rows[3]).getByText("FAQ")).toBeVisible();
  });

  it("counts each chip off the list it filters, and the rail counts the same three", async () => {
    await openTable();

    const chips = within(screen.getByRole("group", { name: "Filter documents" }));
    expect(chips.getByRole("button", { name: "All 4" })).toBeVisible();
    expect(chips.getByRole("button", { name: "Policies 2" })).toBeVisible();
    expect(chips.getByRole("button", { name: "Guidelines 1" })).toBeVisible();
    expect(chips.getByRole("button", { name: "FAQ 1" })).toBeVisible();

    expect(bodyRows(table())).toBe(4);
    expect(within(railEntry("Policies & FAQ")).getByText("4")).toBeVisible();
  });

  it("draws no chip for what a scenario requires, because no listing carries it", async () => {
    // `ScenarioSummarySchema` has `context_document_count` and no document, and this shop has
    // a scenario reading two of these four. A chip counting them would be one draft read per
    // scenario — the additive read ADR 0056 refused — so it is not drawn rather than faked
    // (`docs/design-direction.md`, *Lists and counts*).
    await openTable();

    const chips = within(screen.getByRole("group", { name: "Filter documents" }));
    expect(chips.getAllByRole("button")).toHaveLength(4);
    expect(chips.queryByRole("button", { name: /Required by a scenario/ })).toBeNull();
  });

  it("filters to one kind, counts the whole list, and writes the chip into the address", async () => {
    const user = userEvent.setup();
    const router = await openTable();
    expect(router.state.location.search).toBe("");

    await user.click(screen.getByRole("button", { name: "Guidelines 1" }));

    expect(bodyRows(table())).toBe(1);
    // The count is of the whole list; the chip narrows only the rows beneath it.
    expect(screen.getByRole("button", { name: "Policies 2" })).toBeVisible();
    // Read off the router rather than `window.location`, which a memory router never moves —
    // an assertion on it would pass whatever the chip did. The address carries the filter so
    // a reload or a shared link opens on the same list, and `/setup/support` can redirect to
    // one; and it **replaces** the entry rather than pushing one, so Back leaves the table
    // instead of walking the chips (`docs/design-direction.md`, *Lists and counts*).
    expect(router.state.location.search).toBe("?kind=guidelines");
    expect(router.state.historyAction).toBe("REPLACE");

    await user.click(screen.getByRole("button", { name: "All 4" }));

    expect(router.state.location.search).toBe("");
    expect(router.state.historyAction).toBe("REPLACE");
    expect(bodyRows(table())).toBe(4);
  });

  it("says so when the search matches nothing, and counts nothing out of the chips", async () => {
    const user = userEvent.setup();
    await openTable();

    await user.type(screen.getByRole("searchbox", { name: "Search documents" }), "warranty");

    expect(screen.getByText("No document matches this view.")).toBeVisible();
    expect(screen.getByRole("button", { name: "All 4" })).toBeVisible();
  });
});

describe("the retired support-guidelines page", () => {
  it("redirects to the table with the Guidelines chip pressed", async () => {
    // ADR 0054 took the entry off the rail and left the route reachable by address alone
    // until this slice; a bookmark to it is a bookmark to work that still exists.
    const router = await openTable(`/shops/${SHOP_ID}/setup/support`);

    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/setup/policies`);
    expect(router.state.location.search).toBe("?kind=guidelines");
    expect(screen.getByRole("button", { name: "Guidelines 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(bodyRows(table())).toBe(1);
    expect(within(table()).getByRole("link", { name: "Returns without a receipt" })).toBeVisible();
  });
});

describe("the document editor", () => {
  it("shows the kind and the slug as values, and never asks for either", async () => {
    renderApp(`/shops/${SHOP_ID}/setup/documents/guidelines/returns-desk`);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Returns without a receipt" }),
    ).toBeVisible();
    // A saved entry's identifier is displayed and never asked, and here it is two rows: the
    // pair is what `ContextDocumentSchema` names (ADR 0057).
    expect(screen.queryByRole("combobox", { name: "Kind" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Slug" })).toBeNull();
    // Drawn as values and still named, so a reader who cannot see the grey box is told what
    // it is: the row's label is `for`-bound to an `output`, never left dangling.
    expect(screen.getByLabelText("Slug")).toHaveTextContent("returns-desk");
    expect(screen.getByLabelText("Kind")).toHaveTextContent("Guideline");
    expect(screen.getByLabelText("Kind")).toHaveAccessibleDescription(
      /Set with the slug when the document was created/,
    );
    expect(screen.getByLabelText("Content")).toHaveValue(
      "Offer a credit note rather than refusing.",
    );
  });

  it("offers a policy its own subject", async () => {
    renderApp(`/shops/${SHOP_ID}/setup/documents/policies/returns-policy`);

    expect(await screen.findByRole("combobox", { name: "Policy kind" })).toHaveValue("returns");
  });

  it("offers the other two kinds none, because their collections have no such field", async () => {
    renderApp(`/shops/${SHOP_ID}/setup/documents/faq/delivery-times`);

    await screen.findByRole("heading", { level: 1, name: "When will my order arrive?" });
    expect(screen.queryByRole("combobox", { name: "Policy kind" })).toBeNull();
  });

  it("tells two documents apart by their kind at the same slug", async () => {
    renderApp(`/shops/${SHOP_ID}/setup/documents/faq/returns-policy`);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Document not found" }),
    ).toBeVisible();
  });

  it("writes the edited document back into its own list and leaves the payload alone", async () => {
    const user = userEvent.setup();
    renderApp(`/shops/${SHOP_ID}/setup/documents/guidelines/returns-desk`);

    await user.type(await screen.findByLabelText("Content"), " Log it on the account.");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));

    // The whole payload, not the collection that was edited: the two other lists and every
    // other key have to come back exactly as they went out, or the fingerprint has moved for
    // a reason nobody asked for (PLAN-UX Slice 16, third bullet).
    expect(savedDrafts[0]).toStrictEqual({
      ...toPayload(CONTENT),
      support_guidelines: [
        {
          id: "returns-desk",
          title: "Returns without a receipt",
          body: "Offer a credit note rather than refusing. Log it on the account.",
        },
      ],
    });
  });

  it("removes a document from its own list and lands back on the table", async () => {
    const user = userEvent.setup();
    renderApp(`/shops/${SHOP_ID}/setup/documents/faq/delivery-times`);

    await user.click(
      await screen.findByRole("button", { name: "Remove When will my order arrive?" }),
    );
    // A scenario names a document (an error); a ticket only suggests one (a warning).
    expect(
      screen.getByRole("group", { name: "Remove “When will my order arrive?” from the shop?" }),
    ).toHaveAccessibleDescription(
      /A scenario that names it is refused at publication, because it names a document this shop no longer configures\. A ticket that suggests it is warned about\./,
    );
    await user.click(screen.getByRole("button", { name: "Remove it" }));

    expect(await screen.findByRole("region", { name: "Documents" })).toBeVisible();
    // The editor unmounted, so the table says what was removed and focus is left there.
    const said = await screen.findByText("Removed “When will my order arrive?” from the draft.");
    await waitFor(() => expect(said).toHaveFocus());
    expect(bodyRows(table())).toBe(3);
    expect(screen.getByRole("button", { name: "FAQ 0" })).toBeVisible();
  });

  it("says a carried removal once, not again on a return through history", async () => {
    const user = userEvent.setup();
    const { router } = renderApp(`/shops/${SHOP_ID}/setup/documents/faq/delivery-times`);

    await user.click(
      await screen.findByRole("button", { name: "Remove When will my order arrive?" }),
    );
    await user.click(screen.getByRole("button", { name: "Remove it" }));
    await screen.findByText("Removed “When will my order arrive?” from the draft.");

    // Back to the editor of a document the draft no longer holds, and forward again: the
    // history entry no longer carries the removal, so the table does not say it twice.
    await act(() => router.navigate(-1));
    await screen.findByRole("heading", { level: 1, name: "Document not found" });
    await act(() => router.navigate(1));
    expect(await screen.findByRole("region", { name: "Documents" })).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(/Removed “When will my order arrive\?”/)).toBeNull();
  });
});

describe("creating a document", () => {
  async function openCreate() {
    renderApp(`/shops/${SHOP_ID}/setup/documents/new`);
    return await screen.findByRole("heading", { level: 1, name: "New document" });
  }

  it("asks the kind, because the editor cannot", async () => {
    const user = userEvent.setup();
    await openCreate();

    const kind = screen.getByRole("combobox", { name: "Kind" });
    expect([...kind.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "Policy",
      "Guideline",
      "FAQ",
    ]);
    expect(kind).toHaveValue("policy");
    await user.selectOptions(kind, "faq_entry");
    expect(kind).toHaveValue("faq_entry");
  });

  it("derives the slug from the title, against the ids of the chosen collection only", async () => {
    const user = userEvent.setup();
    await openCreate();

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Returns policy");
    // Taken in `policies`, so the suggestion steps past it and says why.
    expect(screen.getByLabelText("Slug")).toHaveValue("returns-policy-2");
    expect(screen.getByLabelText("Slug")).toHaveAccessibleDescription(
      /returns-policy is already in the draft/i,
    );

    // The same slug is free among the FAQ entries, and the field follows the kind.
    await user.selectOptions(screen.getByRole("combobox", { name: "Kind" }), "faq_entry");
    expect(screen.getByLabelText("Slug")).toHaveValue("returns-policy");
  });

  it("refuses with the reason on the control until the form can be submitted", async () => {
    const user = userEvent.setup();
    await openCreate();

    const create = screen.getByRole("button", { name: "Create document" });
    expect(create).toBeDisabled();
    expect(create).toHaveAccessibleDescription(/needs a title/);

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Warranty");
    expect(create).toBeEnabled();
  });

  it("appends one row to one list and lands in its editor", async () => {
    const user = userEvent.setup();
    await openCreate();

    await user.selectOptions(screen.getByRole("combobox", { name: "Kind" }), "support_guideline");
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Goodwill and exceptions");
    await user.click(screen.getByRole("button", { name: "Create document" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Goodwill and exceptions" }),
    ).toBeVisible();
    expect(screen.getByText("Guideline")).toBeVisible();
    expect(screen.getByLabelText("Content")).toHaveValue("");

    await user.type(screen.getByLabelText("Content"), "Offer a credit note.");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));
    expect(savedDrafts[0]).toStrictEqual({
      ...toPayload(CONTENT),
      support_guidelines: [
        ...CONTENT.support_guidelines,
        {
          id: "goodwill-and-exceptions",
          title: "Goodwill and exceptions",
          body: "Offer a credit note.",
        },
      ],
    });
  });
});

describe("the slice's own evidence", () => {
  it("finds the policy and the guideline that mention returns, and opens one in a page", async () => {
    const user = userEvent.setup();
    await openTable();

    await user.type(screen.getByRole("searchbox", { name: "Search documents" }), "returns");

    const rows = within(table()).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("link").textContent)).toEqual([
      "Returns policy",
      "Returns without a receipt",
    ]);
    // Two collections, one list, and the search narrows only the rows: the chips still count
    // the whole of what the three lists hold.
    expect(screen.getByRole("button", { name: "All 4" })).toBeVisible();

    await user.click(within(table()).getByRole("link", { name: "Returns without a receipt" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Returns without a receipt" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Content")).toHaveValue(
      "Offer a credit note rather than refusing.",
    );
  });
});
