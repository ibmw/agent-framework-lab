import type {
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
  ShopVersionListResponse,
  ShopVersionResponse,
} from "@agent-lab/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "./App";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";

const EMPTY_CONTENT: ShopDraftResponse["content"] = {
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

const READY_CONTENT: ShopDraftResponse["content"] = {
  ...EMPTY_CONTENT,
  products: [
    {
      handle: "alpine-shell-jacket",
      title: "Alpine Shell Jacket",
      description: "Three-layer waterproof shell.",
      status: "active",
      category: "Jackets",
      options: [
        { key: "color", name: "Color", values: ["Ocean Blue"] },
        { key: "size", name: "Size", values: ["M", "L"] },
      ],
      variants: [
        {
          sku: "NS-ASJ-OB-M",
          option_values: [
            { key: "color", value: "Ocean Blue" },
            { key: "size", value: "M" },
          ],
          availability: "in_stock",
          stock_quantity: 12,
          price: { amount: "249.00", currency: "EUR" },
        },
        {
          sku: "NS-ASJ-OB-L",
          option_values: [
            { key: "color", value: "Ocean Blue" },
            { key: "size", value: "L" },
          ],
          availability: "backorder",
          stock_quantity: 0,
          price: null,
        },
      ],
      media: [{ reference: "media/alpine-shell.jpg", alt_text: "Hood up in the rain" }],
      attributes: [
        {
          key: "waterproofing",
          label: "Waterproofing",
          attribute_type: "choice",
          value: "20k",
          unit: null,
          choices: ["10k", "20k", "30k"],
        },
      ],
      reviews: [{ id: "one", author_display_name: "Camille", rating: 5, body: "Dry." }],
      ratings: { review_count: 1, average_rating: "5.0" },
    },
  ],
  payment_methods: [{ id: "visa", name: "Card", kind: "card", enabled: true }],
  policies: [
    {
      id: "shipping-policy",
      title: "Shipping and delivery",
      kind: "shipping",
      // Authored with a paragraph break, so the rendering has to keep one.
      body: "Standard delivery is 2 to 5 working days.\n\nExpress is next working day.",
    },
  ],
  faq: [
    {
      id: "delivery-times",
      question: "When will my order arrive?",
      answer: "Standard delivery arrives in 2 to 5 working days.",
    },
  ],
  support_guidelines: [
    {
      id: "escalation",
      title: "When to escalate",
      body: "Escalate to tier 2 for any refund above 200 EUR.",
    },
  ],
  tone_of_voice_guidelines: [
    {
      id: "warm",
      name: "Warm and precise",
      guidance: "Lead with the fact, then the action, then what happens next.",
      is_default: true,
    },
  ],
  default_tone_of_voice_id: "warm",
};

function draft(content: ShopDraftResponse["content"]): ShopDraftResponse {
  return {
    shop_id: SHOP_ID,
    lifecycle_state: "draft",
    content,
    created_at: "2026-08-23T12:00:00+00:00",
    updated_at: "2026-08-23T12:05:00+00:00",
  };
}

function preview(overrides: Partial<ShopPreviewResponse> = {}): ShopPreviewResponse {
  return {
    shop_id: SHOP_ID,
    publishable: false,
    issues: [
      {
        severity: "error",
        code: "variant_without_price",
        message: "variant NS-ASJ-OB-L is missing a price",
        path: "products.alpine-shell-jacket.variants.NS-ASJ-OB-L",
      },
      { severity: "warning", code: "shop_without_faq", message: "no FAQ yet", path: "faq" },
    ],
    changes: [
      { kind: "added", path: "", description: "First published version of Northstar Outfitters" },
    ],
    content_fingerprint: "a".repeat(64),
    latest_published_version: null,
    next_version: 1,
    matches_latest_published: false,
    content: READY_CONTENT,
    ...overrides,
  };
}

const shops: ShopListResponse = {
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
};

let currentContent = READY_CONTENT;
let currentPreview = preview();
let versions: ShopVersionListResponse = { versions: [] };

const server = setupServer(
  http.get("*/api/v1/shops", () => HttpResponse.json(shops)),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft`, () => HttpResponse.json(draft(currentContent))),
  http.put(`*/api/v1/shops/${SHOP_ID}/draft`, async ({ request }) => {
    const body = (await request.json()) as { payload: Record<string, unknown> };
    // The contract forbids echoing derived evidence back into a draft write.
    const products = body.payload.products as Array<Record<string, unknown>>;
    if (products.some((product) => "ratings" in product)) {
      return HttpResponse.json(
        { code: "validation_error", message: "Request validation failed", request_id: "r" },
        { status: 422 },
      );
    }
    return HttpResponse.json(draft(currentContent));
  }),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft/preview`, () => HttpResponse.json(currentPreview)),
  http.get(`*/api/v1/shops/${SHOP_ID}/versions`, () => HttpResponse.json(versions)),
  http.post(`*/api/v1/shops/${SHOP_ID}/versions`, () => {
    const published: ShopVersionResponse = {
      shop_id: SHOP_ID,
      lifecycle_state: "published",
      version: 1,
      content_fingerprint: "b".repeat(64),
      published_at: "2026-08-23T12:10:00+00:00",
      content: READY_CONTENT,
    };
    versions = {
      versions: [
        {
          version: 1,
          content_fingerprint: "b".repeat(64),
          published_at: "2026-08-23T12:10:00+00:00",
        },
      ],
    };
    currentPreview = preview({
      publishable: true,
      issues: [],
      changes: [],
      latest_published_version: 1,
      next_version: 2,
      matches_latest_published: true,
    });
    return HttpResponse.json(published, { status: 201 });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  currentContent = READY_CONTENT;
  currentPreview = preview();
  versions = { versions: [] };
});
afterAll(() => server.close());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("shop workspace", () => {
  it("lists shops with their published provenance", async () => {
    renderAt("/shops");

    expect(await screen.findByRole("heading", { name: "Shops" })).toBeVisible();
    expect(await screen.findByRole("link", { name: "Northstar Outfitters" })).toBeVisible();
    expect(screen.getByText("Never published")).toBeVisible();
  });

  it("blocks publication while the draft has errors and names the failing variant", async () => {
    renderAt(`/shops/${SHOP_ID}`);

    expect(await screen.findByRole("heading", { name: "Home" })).toBeVisible();
    expect(screen.getByText(/Draft v1 in progress/)).toBeVisible();
    expect(screen.getByText(/variant NS-ASJ-OB-L is missing a price/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Publish v1" })).toBeDisabled();
    expect(screen.getByText("Resolve 1 error(s) to publish.")).toBeVisible();
    expect(screen.getByText("1 warning(s) do not block publication.")).toBeVisible();
  });

  it("publishes a clean draft and shows the frozen version", async () => {
    currentPreview = preview({ publishable: true, issues: [] });
    renderAt(`/shops/${SHOP_ID}`);

    const publish = await screen.findByRole("button", { name: "Publish v1" });
    expect(publish).toBeEnabled();
    await userEvent.click(publish);

    expect(await screen.findByText(/Published v1\. That version is immutable/)).toBeVisible();
    expect(await screen.findByRole("link", { name: "v1" })).toBeVisible();
    await waitFor(() => expect(screen.getByText(/Draft matches v1/)).toBeVisible());
  });

  it("edits a variant price in the draft and saves without derived evidence", async () => {
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const price = await screen.findByLabelText("Price for NS-ASJ-OB-L");
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();

    await userEvent.type(price, "249.00");
    const save = screen.getByRole("button", { name: "Save draft" });
    await userEvent.click(save);

    await waitFor(() => expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a typed attribute's key and the choices it is constrained to", async () => {
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const attributes = await screen.findByRole("region", { name: "Custom attributes (typed)" });
    expect(within(attributes).getByText("Waterproofing")).toBeVisible();
    expect(within(attributes).getByText("waterproofing", { selector: "code" })).toBeVisible();
    // Without the legal choices, "20k" says nothing about what else the attribute accepts.
    expect(within(attributes).getByText("one of 10k, 20k, 30k")).toBeVisible();
  });

  it("refuses to publish while the workspace holds unsaved edits", async () => {
    currentPreview = preview({ publishable: true, issues: [] });
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    // Dirty the workspace, then move to Home without saving.
    await userEvent.type(await screen.findByLabelText("Price for NS-ASJ-OB-L"), "9");
    await userEvent.click(screen.getByRole("link", { name: "Home" }));

    const publish = await screen.findByRole("button", { name: "Publish v1" });
    expect(publish).toBeDisabled();
    // Scoped to the card, which is the one place the publish gate's refusal is rendered.
    expect(
      within(screen.getByRole("region", { name: "Publish" })).getByText(
        /Save the draft first — publishing freezes the saved draft/,
      ),
    ).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Publish v1" })).toBeEnabled());
  });

  it("does not offer to republish a draft identical to the latest version", async () => {
    currentPreview = preview({
      publishable: true,
      issues: [],
      changes: [],
      latest_published_version: 1,
      next_version: 2,
      matches_latest_published: true,
    });
    renderAt(`/shops/${SHOP_ID}`);

    expect(await screen.findByRole("button", { name: "Publish v2" })).toBeDisabled();
    expect(screen.getByText(/there is nothing\s+new to freeze/)).toBeVisible();
  });

  it("prices a new variant in the shop's own currency, not a hard-coded one", async () => {
    currentContent = {
      ...READY_CONTENT,
      identity: { ...READY_CONTENT.identity, currencies: ["USD"] },
    };
    type SavedPayload = { products: Array<{ variants: Array<{ price: unknown }> }> };
    const saved: SavedPayload[] = [];
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/draft`, async ({ request }) => {
        const body = (await request.json()) as { payload: SavedPayload };
        saved.push(body.payload);
        return HttpResponse.json(draft(currentContent));
      }),
    );

    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const variants = await screen.findByRole("region", { name: "Variants" });
    await userEvent.type(within(variants).getByLabelText("New variant SKU"), "NS-ASJ-OB-S");
    await userEvent.type(within(variants).getByLabelText("Price (optional)"), "199.00");
    await userEvent.click(within(variants).getByRole("button", { name: "Add variant" }));
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].products[0].variants.at(-1)?.price).toEqual({
      amount: "199.00",
      currency: "USD",
    });
  });

  it("shows the body of every saved policy and FAQ entry, not only its title", async () => {
    renderAt(`/shops/${SHOP_ID}/setup/policies`);

    const policies = await screen.findByRole("region", { name: "Policies" });
    expect(within(policies).getByText("Shipping and delivery")).toBeVisible();
    expect(within(policies).getByText("shipping", { selector: "span" })).toBeVisible();
    expect(within(policies).getByText("shipping-policy", { selector: "code" })).toBeVisible();
    const body = within(policies).getByText(/Standard delivery is 2 to 5 working days/);
    expect(body).toBeVisible();
    // The blank line the author typed reaches the DOM rather than being stripped, and the
    // rule that renders it as a blank line is on the element. jsdom computes no layout, so
    // the Tailwind class is the only part of that contract a unit test can see.
    expect(body.textContent).toBe(
      "Standard delivery is 2 to 5 working days.\n\nExpress is next working day.",
    );
    expect(body).toHaveClass("whitespace-pre-wrap");
    // An unbreakable token — a pasted returns-portal URL — must break inside the card
    // instead of widening the row until every entry's Remove is clipped away.
    expect(body).toHaveClass("[overflow-wrap:anywhere]");

    const faq = screen.getByRole("region", { name: "FAQ" });
    expect(within(faq).getByText("When will my order arrive?")).toBeVisible();
    expect(
      within(faq).getByText("Standard delivery arrives in 2 to 5 working days."),
    ).toBeVisible();
    expect(within(faq).getByText("delivery-times", { selector: "code" })).toBeVisible();
  });

  it("shows the body of a saved support guideline and the text of a tone of voice", async () => {
    renderAt(`/shops/${SHOP_ID}/setup/support`);

    expect(
      await screen.findByText("Escalate to tier 2 for any refund above 200 EUR."),
    ).toBeVisible();
    expect(screen.getByText("escalation", { selector: "code" })).toBeVisible();

    await userEvent.click(screen.getByRole("link", { name: "Tone of voice" }));

    expect(
      await screen.findByText("Lead with the fact, then the action, then what happens next."),
    ).toBeVisible();
    expect(screen.getByText("warm", { selector: "code" })).toBeVisible();
  });

  it("keeps adding and removing an entry working now that the body is on the row", async () => {
    renderAt(`/shops/${SHOP_ID}/setup/policies`);

    const faq = await screen.findByRole("region", { name: "FAQ" });
    await userEvent.click(
      within(faq).getByRole("button", { name: "Remove When will my order arrive?" }),
    );

    expect(within(faq).queryByText("When will my order arrive?")).toBeNull();
    expect(within(faq).queryByText("Standard delivery arrives in 2 to 5 working days.")).toBeNull();

    await userEvent.type(within(faq).getByLabelText("ID"), "sizing");
    await userEvent.type(within(faq).getByLabelText("Question"), "Does it run small?");
    await userEvent.type(within(faq).getByLabelText("Answer"), "It runs roomy over a mid-layer.");
    await userEvent.click(within(faq).getByRole("button", { name: "Add FAQ entry" }));

    expect(within(faq).getByText("Does it run small?")).toBeVisible();
    expect(within(faq).getByText("It runs roomy over a mid-layer.")).toBeVisible();
  });

  it("shows a published version as read-only frozen content", async () => {
    versions = {
      versions: [
        {
          version: 1,
          content_fingerprint: "b".repeat(64),
          published_at: "2026-08-23T12:10:00+00:00",
        },
      ],
    };
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/versions/1`, () =>
        HttpResponse.json({
          shop_id: SHOP_ID,
          lifecycle_state: "published",
          version: 1,
          content_fingerprint: "b".repeat(64),
          published_at: "2026-08-23T12:10:00+00:00",
          content: READY_CONTENT,
        } satisfies ShopVersionResponse),
      ),
    );

    renderAt(`/shops/${SHOP_ID}/versions/1`);

    const heading = await screen.findByRole("heading", {
      name: "Northstar Outfitters · v1",
    });
    expect(heading).toBeVisible();
    expect(screen.getByText("published · read only")).toBeVisible();
    const table = screen.getByRole("table");
    expect(within(table).getByText("NS-ASJ-OB-M")).toBeVisible();
    expect(within(table).getByText("249.00 EUR")).toBeVisible();

    // A frozen version has to be readable, not merely counted: the documents an agent
    // could have read at v1 are the evidence a later run is compared against.
    const policies = screen.getByRole("region", { name: "Policies" });
    const frozenBody = within(policies).getByText(/Standard delivery is 2 to 5 working days/);
    expect(frozenBody.textContent).toBe(
      "Standard delivery is 2 to 5 working days.\n\nExpress is next working day.",
    );
    expect(frozenBody).toHaveClass("whitespace-pre-wrap");
    expect(frozenBody).toHaveClass("[overflow-wrap:anywhere]");
    expect(
      within(screen.getByRole("region", { name: "FAQ" })).getByText(
        "Standard delivery arrives in 2 to 5 working days.",
      ),
    ).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Support guidelines" })).getByText(
        "Escalate to tier 2 for any refund above 200 EUR.",
      ),
    ).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Tone of voice" })).getByText(
        "Lead with the fact, then the action, then what happens next.",
      ),
    ).toBeVisible();
    // The tone the version resolves to reads as the same chip the draft shows, not as a
    // classification.
    expect(
      within(screen.getByRole("region", { name: "Tone of voice" })).getByText(/shop default/),
    ).toBeVisible();

    // The catalog a frozen version pinned is more than its variants: an agent's catalog
    // tools answer with the category, the options, the media and the reviews too.
    expect(screen.getByText("Jackets")).toBeVisible();
    expect(screen.getByText("Ocean Blue")).toBeVisible();
    expect(screen.getByText("media/alpine-shell.jpg")).toBeVisible();
    expect(screen.getByText("Hood up in the rain")).toBeVisible();
    expect(screen.getByText(/“Dry\.” — Camille/)).toBeVisible();

    // And the identity, which the draft edits field by field and the version showed only
    // as a page title.
    const identity = screen.getByRole("region", { name: "Shop identity" });
    expect(within(identity).getByText("northstar")).toBeVisible();
    expect(within(identity).getByText("en-GB")).toBeVisible();
    expect(within(identity).getByText("EUR")).toBeVisible();
    expect(within(identity).getByText("chat")).toBeVisible();

    const payment = screen.getByRole("region", { name: "Payment methods" });
    expect(within(payment).getByText("Card")).toBeVisible();
    expect(within(payment).getByText("visa", { selector: "code" })).toBeVisible();
  });
});
