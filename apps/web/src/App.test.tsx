import type {
  ShopDraftResponse,
  ShopListResponse,
  ShopPayloadSchema,
  ShopPreviewResponse,
  ShopVersionListResponse,
  ShopVersionResponse,
} from "@agent-lab/contracts";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { isValidElement } from "react";
import type { RouteObject } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PRODUCT_TITLE_RULE,
  SHOP_NAME_RULE,
  TONE_DEFAULT_REMOVAL_RULE,
  TONE_NAME_RULE,
} from "./lib/fieldRules";
import { shopDraftIsSavableAt, toPayload } from "./lib/shop";
import { CREATE_ROUTES, tourAt } from "./lib/tours";
import { routeTree } from "./routeTree";
import { UnsavedChangesGuard } from "./shell/UnsavedChangesGuard";
import { renderApp, wholeDescription } from "./test/app";
import { bodyRows, railEntry, shellListings } from "./test/shell";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";

function precedes(earlier: HTMLElement, later: HTMLElement): boolean {
  return Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
}

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

/**
 * Every draft payload the workspace wrote, in order.
 *
 * What an edit in place has to be checked against is not what the row renders but what the
 * save carried: PLAN-UX Slice 7 asks for a test that edits one field of a saved entry and
 * asserts the payload changed only that field, because a second payload builder behind the
 * edit path would show the right row and write a different entry.
 */
type SavedShopPayload = ShopPayloadSchema;

let savedDrafts: SavedShopPayload[] = [];

function lastSaved(): SavedShopPayload {
  const payload = savedDrafts.at(-1);
  if (!payload) {
    throw new Error("The workspace saved no draft.");
  }
  return payload;
}

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
    savedDrafts.push(body.payload as SavedShopPayload);
    return HttpResponse.json(draft(currentContent));
  }),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft/preview`, () => HttpResponse.json(currentPreview)),
  http.get(`*/api/v1/shops/${SHOP_ID}/versions`, () => HttpResponse.json(versions)),
  // The overview reads this shop's experiments for its activity card; every other surface in
  // this suite renders inside the same shell and so pays for the handler rather than the read.
  http.get(`*/api/v1/shops/${SHOP_ID}/experiments`, () => HttpResponse.json({ experiments: [] })),
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
  // The shop and lab shells read every listing their rail counts (ADR 0056). Last, so a
  // handler this suite declares for one of these routes still wins.
  ...shellListings(),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  currentContent = READY_CONTENT;
  currentPreview = preview();
  versions = { versions: [] };
  savedDrafts = [];
});
afterAll(() => server.close());

function renderAt(path: string) {
  return renderApp(path);
}

describe("creating a product", () => {
  /**
   * Products are the slice's one create that is not a page (PLAN-UX Slice 12): a product is a
   * row of the shop draft, so there is nothing to POST and nothing to be refused, and the
   * prototype appends an empty one and opens its editor (`Workspace.dc.html`:6931).
   */
  it("appends an empty product to the draft and lands in its editor", async () => {
    const user = userEvent.setup();
    currentContent = EMPTY_CONTENT;
    const { router } = renderAt(`/shops/${SHOP_ID}/products`);

    await screen.findByRole("heading", { level: 1, name: "Products" });
    expect(within(railEntry("Products")).getByText("0")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "New product" }));

    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/products/new-product`);
    expect(screen.getByRole("heading", { level: 1, name: "Untitled product" })).toBeVisible();
    // The rail's product figure is the draft's own length, so it moves in the same commit
    // the draft does (ADR 0056) — no listing, no refresh, no reload.
    expect(within(railEntry("Products")).getByText("1")).toBeVisible();
  });

  it("gives an unnamed product something to be called on the catalog too", async () => {
    const user = userEvent.setup();
    currentContent = EMPTY_CONTENT;
    renderAt(`/shops/${SHOP_ID}/products`);

    await screen.findByRole("heading", { level: 1, name: "Products" });
    await user.click(screen.getByRole("button", { name: "New product" }));
    // The catalog saves the same draft, so walking back asks nothing — and a link named by
    // an empty title would have no accessible name and nothing to click.
    await user.click(screen.getByRole("link", { name: "Products" }));

    const row = within(await screen.findByRole("table"));
    expect(row.getByRole("link", { name: "Untitled product" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/products/new-product`,
    );
  });

  it("steps the handle past one the draft already holds", async () => {
    const user = userEvent.setup();
    const { router } = renderAt(`/shops/${SHOP_ID}/products`);

    await screen.findByRole("heading", { level: 1, name: "Products" });
    await user.click(screen.getByRole("button", { name: "New product" }));
    await user.click(screen.getByRole("link", { name: "Products" }));
    await user.click(await screen.findByRole("button", { name: "New product" }));

    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/products/new-product-2`);
  });
});

describe("the product editor's identity rows", () => {
  /** The editor of a product this test has just created, which is where naming one happens. */
  async function openNewProduct(user: ReturnType<typeof userEvent.setup>) {
    renderAt(`/shops/${SHOP_ID}/products`);
    await screen.findByRole("heading", { level: 1, name: "Products" });
    await user.click(screen.getByRole("button", { name: "New product" }));
    return within(await screen.findByRole("region", { name: "Details" }));
  }

  it("puts each field's hint in that control's accessible description", async () => {
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const card = within(await screen.findByRole("region", { name: "Details" }));
    // Exact, not a substring: this sentence was also the create card's Title row, and the
    // pair only means anything if the two are the same string.
    expect(card.getByLabelText("Title")).toHaveAccessibleDescription(
      wholeDescription(PRODUCT_TITLE_RULE),
    );
    expect(card.getByLabelText("Handle")).toHaveAccessibleDescription(
      /lowercase with hyphens.*tools address the product/i,
    );
    expect(precedes(card.getByLabelText("Title"), card.getByLabelText("Handle"))).toBe(true);
    // Category is deliberately bare and stays Slice 27's; the case under "the field pattern
    // on the shop editors" is what pins it.
  });

  it("derives the handle from the title, previews it, and moves the page onto it", async () => {
    const user = userEvent.setup();
    currentContent = EMPTY_CONTENT;
    const { router } = renderAt(`/shops/${SHOP_ID}/products`);
    await screen.findByRole("heading", { level: 1, name: "Products" });
    await user.click(screen.getByRole("button", { name: "New product" }));
    const card = within(await screen.findByRole("region", { name: "Details" }));

    await user.type(card.getByLabelText("Title"), "Alpine Shell Jacket");

    expect(card.getByLabelText("Handle")).toHaveValue("alpine-shell-jacket");
    expect(card.getByLabelText("Handle")).toHaveAccessibleDescription(
      /saved as alpine-shell-jacket/i,
    );
    // A product is addressed by its handle, so renaming one moves the page it is on.
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/products/alpine-shell-jacket`),
    );
    expect(screen.getByRole("heading", { level: 1, name: "Alpine Shell Jacket" })).toBeVisible();
  });

  it("stops following once the handle is edited, and follows again once emptied", async () => {
    const user = userEvent.setup();
    currentContent = EMPTY_CONTENT;
    const card = await openNewProduct(user);

    await user.type(card.getByLabelText("Title"), "Alpine Shell Jacket");
    await user.clear(card.getByLabelText("Handle"));
    await user.type(card.getByLabelText("Handle"), "alpine-jacket");
    await user.type(card.getByLabelText("Title"), " XL");
    expect(card.getByLabelText("Handle")).toHaveValue("alpine-jacket");

    await user.clear(card.getByLabelText("Handle"));
    expect(card.getByLabelText("Handle")).toHaveValue("");
    await user.type(card.getByLabelText("Title"), " Petite");
    expect(card.getByLabelText("Handle")).toHaveValue("alpine-shell-jacket-xl-petite");
  });

  it("puts the page back on a renamed product when the rename is discarded", async () => {
    const user = userEvent.setup();
    const { router } = renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    const card = within(await screen.findByRole("region", { name: "Details" }));

    await user.clear(card.getByLabelText("Handle"));
    await user.type(card.getByLabelText("Handle"), "alpine-jacket");
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/products/alpine-jacket`),
    );

    // Discard re-reads what the lab holds, which still calls the product by its old handle.
    // The page has to follow it back rather than draw "Product not found" over a product
    // that is right there.
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/products/alpine-shell-jacket`),
    );
    expect(screen.queryByRole("heading", { name: "Product not found" })).toBeNull();
    expect(
      within(screen.getByRole("region", { name: "Details" })).getByLabelText("Handle"),
    ).toHaveValue("alpine-shell-jacket");
  });

  it("offers a free handle and refuses one another product already holds", async () => {
    const user = userEvent.setup();
    const card = await openNewProduct(user);

    await user.type(card.getByLabelText("Title"), "Alpine Shell Jacket");

    expect(card.getByLabelText("Handle")).toHaveValue("alpine-shell-jacket-2");
    expect(card.getByLabelText("Handle")).toHaveAccessibleDescription(
      /alpine-shell-jacket is already in the draft/i,
    );

    await user.clear(card.getByLabelText("Handle"));
    await user.type(card.getByLabelText("Handle"), "alpine-shell-jacket");
    expect(card.getByLabelText("Handle")).toBeInvalid();
  });
});

describe("shop workspace", () => {
  it("lists shops with their published provenance", async () => {
    renderAt("/shops");

    expect(await screen.findByRole("heading", { name: "Shops" })).toBeVisible();
    expect(await screen.findByRole("link", { name: "Northstar Outfitters" })).toBeVisible();
    // Scoped to the table: "Never published" is also a filter chip's label now.
    expect(within(screen.getByRole("table")).getByText("Never published")).toBeVisible();
  });

  it("edits a variant price in the draft and saves without derived evidence", async () => {
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const price = await screen.findByLabelText("Price for NS-ASJ-OB-L");
    expect(screen.getByText("All changes saved")).toBeInTheDocument();

    await userEvent.type(price, "249.00");
    const save = screen.getByRole("button", { name: "Save draft" });
    await userEvent.click(save);

    await waitFor(() => expect(screen.getByText("All changes saved")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a typed attribute's key and the choices it is constrained to", async () => {
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const attributes = await screen.findByRole("region", { name: "Custom attributes (typed)" });
    expect(within(attributes).getByText("Waterproofing")).toBeVisible();
    expect(within(attributes).getByText("waterproofing", { selector: "code" })).toBeVisible();
    // Without the legal choices, "20k" says nothing about what else the attribute accepts.
    // They read as the chips frame 2c draws, each its own item rather than one joined string.
    expect(within(attributes).getByText("one of")).toBeVisible();
    const choices = within(attributes).getByRole("list", { name: "Choices for Waterproofing" });
    expect(
      within(choices)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["10k", "20k", "30k"]);
  });

  it("reads a saved option's values back as the chips the add form enters them as", async () => {
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const options = within(await screen.findByRole("region", { name: "Options" }));
    // Frame 2c draws pills here, one per value — not one "Ocean Blue · M · L" string.
    const colour = options.getByRole("list", { name: "Values of Color" });
    expect(
      within(colour)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Ocean Blue"]);
    const size = options.getByRole("list", { name: "Values of Size" });
    expect(
      within(size)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["M", "L"]);
  });

  it("refuses to publish while the workspace holds unsaved edits", async () => {
    currentPreview = preview({ publishable: true, issues: [] });
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    // Dirty the workspace, then move to the overview without saving.
    await userEvent.type(await screen.findByLabelText("Price for NS-ASJ-OB-L"), "9");
    await userEvent.click(screen.getByRole("link", { name: "Overview" }));

    const publish = await screen.findByRole("button", { name: "Review 1 change & publish" });
    expect(publish).toBeDisabled();
    // Scoped to the card, which is the one place the publish gate's refusal is rendered.
    expect(
      within(screen.getByRole("region", { name: "Versions of this shop" })).getByText(
        /Save the draft first — publishing freezes the saved draft/,
      ),
    ).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Review 1 change & publish" })).toBeEnabled(),
    );
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

  it("keeps the editor up when a saved option has no parsable values", async () => {
    currentContent = {
      ...READY_CONTENT,
      products: [
        {
          ...READY_CONTENT.products[0],
          options: [{ key: "fit", name: "Fit", values: [] }],
        },
      ],
    };
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    expect(await screen.findByRole("heading", { name: "Alpine Shell Jacket" })).toBeVisible();
    expect(screen.getByLabelText("New variant SKU")).toHaveValue("ALPINE-SHELL-JACKET");
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
    expect(
      precedes(within(variants).getByLabelText("Color"), within(variants).getByLabelText("Size")),
    ).toBe(true);
    expect(
      precedes(
        within(variants).getByLabelText("Size"),
        within(variants).getByLabelText("Price (optional)"),
      ),
    ).toBe(true);
    expect(
      precedes(
        within(variants).getByLabelText("Price (optional)"),
        within(variants).getByLabelText("New variant SKU"),
      ),
    ).toBe(true);
    expect(within(variants).getByLabelText("New variant SKU")).toHaveValue(
      "ALPINE-SHELL-JACKET-OCEAN-BLUE-M",
    );
    await userEvent.clear(within(variants).getByLabelText("New variant SKU"));
    await userEvent.type(within(variants).getByLabelText("New variant SKU"), "NS-ASJ-OB-S");
    await userEvent.type(within(variants).getByLabelText("Price (optional)"), "199.00");
    await userEvent.click(within(variants).getByRole("button", { name: "Add variant" }));
    expect(within(variants).getByLabelText("New variant SKU")).toHaveValue(
      "ALPINE-SHELL-JACKET-OCEAN-BLUE-M",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].products[0].variants.at(-1)?.price).toEqual({
      amount: "199.00",
      currency: "USD",
    });
  });

  it("keeps a typed variant SKU when another variant is removed", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const variants = await screen.findByRole("region", { name: "Variants" });
    await user.clear(within(variants).getByLabelText("New variant SKU"));
    await user.type(within(variants).getByLabelText("New variant SKU"), "NS-ASJ-CUSTOM");
    await user.click(within(variants).getByRole("button", { name: "Remove NS-ASJ-OB-L" }));

    expect(within(variants).getByLabelText("New variant SKU")).toHaveValue("NS-ASJ-CUSTOM");
  });

  it("shows the text of a saved tone of voice, not only its name", async () => {
    // The shop's three document collections left this page for the Documents table and its
    // editor (PLAN-UX Slice 16); tone of voice is the list that still reads on a card, and
    // the entry-card rendering is `Documents.test.tsx`'s subject on the other three.
    renderAt(`/shops/${SHOP_ID}/setup/tone`);

    expect(
      await screen.findByText("Lead with the fact, then the action, then what happens next."),
    ).toBeVisible();
    expect(screen.getByText("warm", { selector: "code" })).toBeVisible();
  });

  it("derives a payment id from the name and refuses one already in the draft", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/setup/identity`);
    const payments = within(await screen.findByRole("region", { name: "Payment methods" }));

    await user.type(payments.getByLabelText("Name"), "Visa");
    expect(payments.getByLabelText("ID")).toHaveValue("visa-2");
    expect(payments.getByLabelText("ID")).toHaveAccessibleDescription(
      /visa is already in the draft/i,
    );

    await user.clear(payments.getByLabelText("ID"));
    expect(payments.getByLabelText("ID")).toHaveValue("");
    await user.type(payments.getByLabelText("Name"), " Debit");
    expect(payments.getByLabelText("ID")).toHaveValue("visa-debit");

    await user.clear(payments.getByLabelText("ID"));
    await user.type(payments.getByLabelText("ID"), "visa");
    expect(payments.getByLabelText("ID")).toBeInvalid();
    await user.click(payments.getByRole("button", { name: "Add payment method" }));
    expect(payments.getAllByText("visa", { selector: "code" })).toHaveLength(1);
  });

  it("derives a fulfilment id from the name, and follows again once emptied", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/setup/identity`);
    const fulfilment = within(await screen.findByRole("region", { name: "Fulfilment methods" }));

    await user.type(fulfilment.getByLabelText("Name"), "Express");
    expect(fulfilment.getByLabelText("ID")).toHaveValue("express");
    await user.clear(fulfilment.getByLabelText("ID"));
    await user.type(fulfilment.getByLabelText("ID"), "overnight");
    await user.type(fulfilment.getByLabelText("Name"), " air");
    expect(fulfilment.getByLabelText("ID")).toHaveValue("overnight");
    await user.clear(fulfilment.getByLabelText("ID"));
    expect(fulfilment.getByLabelText("ID")).toHaveValue("");
    await user.type(fulfilment.getByLabelText("Name"), " freight");
    expect(fulfilment.getByLabelText("ID")).toHaveValue("express-air-freight");

    await user.type(fulfilment.getByLabelText("Carrier"), "Nordic Post");
    await user.click(fulfilment.getByRole("button", { name: "Add fulfilment method" }));
    expect(fulfilment.getByText("express-air-freight", { selector: "code" })).toBeVisible();
    await user.type(fulfilment.getByLabelText("Name"), "Express air freight");
    expect(fulfilment.getByLabelText("ID")).toHaveValue("express-air-freight-2");
    await user.clear(fulfilment.getByLabelText("ID"));
    await user.type(fulfilment.getByLabelText("ID"), "express-air-freight");
    expect(fulfilment.getByLabelText("ID")).toBeInvalid();
    await user.click(fulfilment.getByRole("button", { name: "Add fulfilment method" }));
    expect(fulfilment.getAllByText("express-air-freight", { selector: "code" })).toHaveLength(1);
  });

  it("derives a tone-of-voice id from the name", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/setup/tone`);
    const tone = within(await screen.findByRole("region", { name: "Guidelines" }));

    await user.type(tone.getByLabelText("Name"), "Warm and precise");
    expect(tone.getByLabelText("ID")).toHaveValue("warm-and-precise");
    await user.clear(tone.getByLabelText("ID"));
    expect(tone.getByLabelText("ID")).toHaveValue("");
    await user.type(tone.getByLabelText("Name"), " voice");
    expect(tone.getByLabelText("ID")).toHaveValue("warm-and-precise-voice");

    await user.clear(tone.getByLabelText("ID"));
    await user.type(tone.getByLabelText("ID"), "warm");
    expect(tone.getByLabelText("ID")).toBeInvalid();
  });

  it("derives option and attribute keys, and shows a review id only on the saved row", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const options = within(await screen.findByRole("region", { name: "Options" }));
    await user.type(options.getByLabelText("Option name"), "Fit");
    // An option with no value is refused, as it was when the values were one comma-separated
    // field: the domain requires at least one and the form never builds a draft without it.
    await user.click(options.getByRole("button", { name: "Add option" }));
    expect(options.queryByRole("button", { name: "Remove Fit" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Alpine Shell Jacket" })).toBeVisible();

    await user.type(options.getByLabelText("New value"), "Regular");
    await user.click(options.getByRole("button", { name: "Add value" }));
    expect(options.getByRole("button", { name: "Remove Regular" })).toBeVisible();
    expect(options.getByLabelText("Option key")).toHaveValue("fit");
    await user.clear(options.getByLabelText("Option key"));
    expect(options.getByLabelText("Option key")).toHaveValue("");
    await user.type(options.getByLabelText("Option name"), " profile");
    expect(options.getByLabelText("Option key")).toHaveValue("fit-profile");

    await user.clear(options.getByLabelText("Option key"));
    await user.type(options.getByLabelText("Option key"), "color");
    expect(options.getByLabelText("Option key")).toBeInvalid();
    await user.clear(options.getByLabelText("Option key"));
    await user.type(options.getByLabelText("Option key"), "fit");
    await user.click(options.getByRole("button", { name: "Add option" }));
    expect(options.getByText("fit", { selector: "code" })).toBeVisible();

    const attributes = within(screen.getByRole("region", { name: "Custom attributes (typed)" }));
    await user.type(attributes.getByLabelText("Label"), "Waterproofing");
    expect(attributes.getByLabelText("Key")).toHaveValue("waterproofing-2");
    await user.clear(attributes.getByLabelText("Key"));
    expect(attributes.getByLabelText("Key")).toHaveValue("");
    await user.type(attributes.getByLabelText("Label"), " rating");
    expect(attributes.getByLabelText("Key")).toHaveValue("waterproofing-rating");

    await user.clear(attributes.getByLabelText("Key"));
    await user.type(attributes.getByLabelText("Key"), "waterproofing");
    expect(attributes.getByLabelText("Key")).toBeInvalid();

    const reviews = within(screen.getByRole("region", { name: "Ratings and reviews" }));
    expect(reviews.queryByLabelText("Review ID")).toBeNull();
    expect(reviews.getByText("one", { selector: "code" })).toBeVisible();
    await user.type(reviews.getByLabelText("Author"), "Camille");
    await user.type(reviews.getByLabelText("Body"), "Still dry.");
    await user.click(reviews.getByRole("button", { name: "Add review" }));
    expect(reviews.getByText("camille", { selector: "code" })).toBeVisible();
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
    expect(within(identity).getByText("Chat")).toBeVisible();

    const payment = screen.getByRole("region", { name: "Payment methods" });
    // Twice: the method's own name, and the kind chip that now spells `card` for a reader.
    expect(within(payment).getAllByText("Card")).toHaveLength(2);
    expect(within(payment).getByText("visa", { selector: "code" })).toBeVisible();
  });
});

/**
 * Slice 3: nowhere in the workspace does an operator read `in_stock` or `gift_card`.
 *
 * Every assertion here selects a control by the words on it, because that is the claim —
 * a select an author reads is a select a test can find by reading.
 */
describe("typed controls on the product editor", () => {
  it("enters option values as chips, refuses a repeat, and names each remove", async () => {
    const user = userEvent.setup();
    type SavedPayload = { products: Array<{ options: Array<{ key: string; values: string[] }> }> };
    const saved: SavedPayload[] = [];
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/draft`, async ({ request }) => {
        const body = (await request.json()) as { payload: SavedPayload };
        saved.push(body.payload);
        return HttpResponse.json(draft(currentContent));
      }),
    );

    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const options = within(await screen.findByRole("region", { name: "Options" }));
    await user.type(options.getByLabelText("Option name"), "Fit");
    const values = within(options.getByRole("group", { name: "Values" }));
    await user.type(values.getByLabelText("New value"), "Regular");
    await user.click(values.getByRole("button", { name: "Add value" }));
    await user.type(values.getByLabelText("New value"), "Relaxed");
    await user.click(values.getByRole("button", { name: "Add value" }));

    // The lab's own rule: `_require_unique` over an option's values.
    await user.type(values.getByLabelText("New value"), "Regular");
    expect(values.getByLabelText("New value")).toBeInvalid();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Regular is already a value of this option.",
    );
    await user.click(values.getByRole("button", { name: "Add value" }));
    expect(values.getAllByRole("button", { name: "Remove Regular" })).toHaveLength(1);

    await user.clear(values.getByLabelText("New value"));
    await user.click(options.getByRole("button", { name: "Add option" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].products[0].options.at(-1)).toEqual({
      key: "fit",
      name: "Fit",
      values: ["Regular", "Relaxed"],
    });
  });

  it("enters attribute choices as chips, and writes them in the order entered", async () => {
    const user = userEvent.setup();
    type SavedPayload = { products: Array<{ attributes: Array<{ choices: string[] }> }> };
    const saved: SavedPayload[] = [];
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/draft`, async ({ request }) => {
        const body = (await request.json()) as { payload: SavedPayload };
        saved.push(body.payload);
        return HttpResponse.json(draft(currentContent));
      }),
    );

    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const card = await screen.findByRole("region", { name: "Custom attributes (typed)" });
    const attributes = within(card);
    await user.type(attributes.getByLabelText("Label"), "Cut");
    await user.selectOptions(attributes.getByLabelText("Type"), "choice");
    await user.type(attributes.getByLabelText("Value"), "Regular");
    const choices = within(attributes.getByRole("group", { name: "Choices" }));
    await user.type(choices.getByLabelText("New choice"), "Regular");
    await user.click(choices.getByRole("button", { name: "Add choice" }));
    await user.type(choices.getByLabelText("New choice"), "Relaxed");
    await user.click(choices.getByRole("button", { name: "Add choice" }));
    await user.click(attributes.getByRole("button", { name: "Add attribute" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].products[0].attributes.at(-1)?.choices).toEqual(["Regular", "Relaxed"]);
  });

  it("constrains a price to an amount, and says the money it is priced in", async () => {
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const variants = within(await screen.findByRole("region", { name: "Variants" }));
    const row = variants.getByLabelText("Price for NS-ASJ-OB-L");
    expect(row).toHaveAttribute("inputmode", "decimal");
    await userEvent.type(row, "abc");
    expect(row).toBeInvalid();
    await userEvent.clear(row);
    await userEvent.type(row, "249.00");
    expect(row).toBeValid();

    // The rule reaches a reader without a pointer on the row itself, not only through the
    // browser's validity bubble, which is what this branch's own convention requires.
    expect(row).toHaveAccessibleDescription(/at most two decimals/i);

    // The shop sells in one currency here, so the form's only statement of it is this line.
    const add = variants.getByLabelText("Price (optional)");
    expect(add).toHaveAccessibleDescription(/at most two decimals/i);
    expect(add).toHaveAccessibleDescription(/Priced in EUR\./);
  });

  it("rates a review as five named stars rather than as a typed digit", async () => {
    const user = userEvent.setup();
    type SavedPayload = { products: Array<{ reviews: Array<{ rating: number }> }> };
    const saved: SavedPayload[] = [];
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/draft`, async ({ request }) => {
        const body = (await request.json()) as { payload: SavedPayload };
        saved.push(body.payload);
        return HttpResponse.json(draft(currentContent));
      }),
    );

    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const reviews = within(await screen.findByRole("region", { name: "Ratings and reviews" }));
    const rating = within(reviews.getByRole("group", { name: "Rating" }));
    expect(rating.getAllByRole("radio")).toHaveLength(5);
    expect(rating.getByRole("radio", { name: "5 stars" })).toBeChecked();
    // Neither colour nor shape carries the value on its own.
    expect(reviews.getByRole("group", { name: "Rating" })).toHaveAccessibleDescription(
      /5 of 5 stars\./,
    );

    await user.click(rating.getByRole("radio", { name: "4 stars" }));
    expect(reviews.getByRole("group", { name: "Rating" })).toHaveAccessibleDescription(
      /4 of 5 stars\./,
    );

    await user.type(reviews.getByLabelText("Author"), "Camille");
    await user.type(reviews.getByLabelText("Body"), "Still dry.");
    await user.click(reviews.getByRole("button", { name: "Add review" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].products[0].reviews.at(-1)?.rating).toBe(4);
  });
});

describe("every enum has a name", () => {
  it("names a product's status in the index, with a glyph beside the word", async () => {
    renderAt(`/shops/${SHOP_ID}/products`);

    // Scoped to the table: "Active" is also a filter chip's label now.
    await screen.findByRole("table");
    const status = within(screen.getByRole("table")).getByText("Active");
    expect(status).toBeVisible();
    // Never colour alone: the mark is there, and it is decorative — the word carries it.
    // Asserted in two steps on purpose: `glyph?.textContent` on a pill with no mark at all
    // is `undefined`, which would pass every assertion this test could make about it.
    const glyph = status.parentElement?.querySelector("[aria-hidden]");
    expect(glyph).toBeInstanceOf(Element);
    expect(glyph?.textContent?.trim()).not.toBe("");
  });

  it("names a product's status in the editor without inventing a rule for it", async () => {
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const details = within(await screen.findByRole("region", { name: "Details" }));
    const status = details.getByLabelText("Status");
    expect(status).toHaveValue("active");
    // The lab attaches no behaviour to the value, so the option is the word and nothing else.
    expect(within(status).getByRole("option", { name: "Draft" })).toBeInTheDocument();
    expect(within(status).getByRole("option", { name: "Archived" })).toBeInTheDocument();
  });

  it("offers a variant's availability in words, and saves the wire value behind them", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const variants = within(await screen.findByRole("region", { name: "Variants" }));
    const availability = variants.getByLabelText("Availability for NS-ASJ-OB-L");
    expect(availability).toHaveDisplayValue("On backorder");

    await user.selectOptions(
      availability,
      within(availability).getByRole("option", { name: "Out of stock" }),
    );
    expect(availability).toHaveValue("out_of_stock");
  });

  it("names an attribute's type on the saved row and in the picker", async () => {
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const attributes = within(
      await screen.findByRole("region", { name: "Custom attributes (typed)" }),
    );
    // The saved row's kind chip, not the picker's option of the same name.
    expect(attributes.getByText("Choice", { selector: "span" })).toBeVisible();
    expect(
      within(attributes.getByLabelText("Type")).getByRole("option", { name: "Measurement" }),
    ).toBeInTheDocument();
  });

  it("names a payment kind rather than spelling the wire's underscores", async () => {
    renderAt(`/shops/${SHOP_ID}/setup/identity`);

    const card = within(await screen.findByRole("region", { name: "Payment methods" }));
    const kind = card.getByLabelText("Kind");
    expect(within(kind).getByRole("option", { name: "Bank transfer" })).toBeInTheDocument();
    expect(within(kind).getByRole("option", { name: "Gift card" })).toBeInTheDocument();
    expect(within(kind).queryByRole("option", { name: "bank_transfer" })).toBeNull();
  });

  it("names the channels a shop answers on", async () => {
    renderAt(`/shops/${SHOP_ID}/setup/identity`);

    expect(await screen.findByRole("checkbox", { name: "Chat" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Email" })).toBeInTheDocument();
  });
});

describe("the currencies a shop sells in, on Shop details", () => {
  async function currencyGroup() {
    return within(await screen.findByRole("group", { name: "Currencies" }));
  }

  it("reads as the shared field does on the create form, rule and all", async () => {
    renderAt(`/shops/${SHOP_ID}/setup/identity`);

    expect(await screen.findByRole("group", { name: "Currencies" })).toHaveAccessibleDescription(
      /variants may only be priced in these; the first is the default/i,
    );
    // Named, where this page used to show the bare code with the name only on hover.
    expect((await currencyGroup()).getByRole("checkbox", { name: "EUR — Euro" })).toBeChecked();
  });

  it("adds a second currency to the draft it saves", async () => {
    const user = userEvent.setup();
    type SavedPayload = { identity: { currencies: string[] } };
    const saved: SavedPayload[] = [];
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/draft`, async ({ request }) => {
        const body = (await request.json()) as { payload: SavedPayload };
        saved.push(body.payload);
        return HttpResponse.json(draft(currentContent));
      }),
    );
    renderAt(`/shops/${SHOP_ID}/setup/identity`);

    await user.click((await currencyGroup()).getByRole("checkbox", { name: "CHF — Swiss franc" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].identity.currencies).toEqual(["EUR", "CHF"]);
  });

  it("holds the last currency ticked rather than failing at save", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/setup/identity`);

    const only = (await currencyGroup()).getByRole("checkbox", { name: "EUR — Euro" });
    await user.click(only);

    expect(only).toBeChecked();
  });

  it("does not retick a saved shop when its locale is changed", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/setup/identity`);

    await user.clear(await screen.findByLabelText("Locale"));
    await user.type(screen.getByLabelText("Locale"), "ja-JP");

    // The create form suggests a currency because nothing has been answered yet. A saved
    // identity has been answered, and a locale correction is not a reason to reprice a shop.
    expect((await currencyGroup()).getByRole("checkbox", { name: "EUR — Euro" })).toBeChecked();
    expect(
      (await currencyGroup()).getByRole("checkbox", { name: "JPY — Japanese yen" }),
    ).not.toBeChecked();
  });
});

/**
 * The fixture as a draft write carries it, which is not the fixture: `toPayload` strips the
 * derived evidence the API answers with — a product's ratings, the resolved default tone.
 *
 * Taken from the projection the app uses rather than hand-copied, so "everything else is what
 * the unedited draft would have written" stays true when the payload's shape changes. What
 * each test asserts on top of it is a literal.
 */
function unchangedPayload(): SavedShopPayload {
  return toPayload(currentContent);
}

/**
 * PLAN-UX Slice 7. Each of these opens one saved row, changes one field, saves the row and
 * then the draft, and asserts `toStrictEqual` against the *whole* payload the save carried —
 * not against the collection that was edited. That is what catches a second payload builder
 * behind the edit path: a row that renders correctly while writing a `unit` the add form
 * would have nulled, an entry whose id followed its retitled source, a sibling collection
 * reordered, or a key that quietly became `undefined`, all pass every assertion about the
 * screen and most assertions about one list.
 */
describe("editing a saved entry in place", () => {
  it("changes one word of a policy body and leaves the rest of the draft alone", async () => {
    const user = userEvent.setup();
    // A policy opens on a page of its own now rather than in a row (PLAN-UX Slice 16). The
    // assertion is unchanged and is the point: an editor that wrote the collection back any
    // other way than in place would move the payload, and with it the fingerprint.
    renderAt(`/shops/${SHOP_ID}/setup/documents/policies/shipping-policy`);

    const body = await screen.findByLabelText("Content");
    expect(body).toHaveValue(READY_CONTENT.policies[0].body);
    await user.clear(body);
    await user.type(body, "Standard delivery is 2 to 5 working days.\n\nExpress is same day.");

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));

    expect(lastSaved()).toStrictEqual({
      ...unchangedPayload(),
      policies: [
        {
          // Set once when the document was created, and handed back: this is what makes the
          // draft report one updated policy rather than a removal and an addition.
          id: "shipping-policy",
          title: "Shipping and delivery",
          kind: "shipping",
          body: "Standard delivery is 2 to 5 working days.\n\nExpress is same day.",
        },
      ],
    });
  });

  it("renames a fulfilment method without disturbing its carrier or transit window", async () => {
    const user = userEvent.setup();
    currentContent = {
      ...READY_CONTENT,
      fulfilment_methods: [
        {
          id: "standard",
          name: "Standard",
          carrier: "Nordic Post",
          min_transit_days: 2,
          max_transit_days: 5,
        },
      ],
    };
    renderAt(`/shops/${SHOP_ID}/setup/identity`);

    const card = within(await screen.findByRole("region", { name: "Fulfilment methods" }));
    await user.click(card.getByRole("button", { name: "Edit Standard" }));
    const open = within(card.getByRole("form", { name: "Edit Standard" }));
    await user.clear(open.getByLabelText("Name"));
    await user.type(open.getByLabelText("Name"), "Standard delivery");
    await user.click(open.getByRole("button", { name: "Save Standard" }));

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));

    expect(lastSaved()).toStrictEqual({
      ...unchangedPayload(),
      fulfilment_methods: [
        {
          id: "standard",
          name: "Standard delivery",
          carrier: "Nordic Post",
          min_transit_days: 2,
          max_transit_days: 5,
        },
      ],
    });
  });

  it("keeps a payment method's enabled toggle made while the row was open", async () => {
    const user = userEvent.setup();
    currentContent = {
      ...READY_CONTENT,
      payment_methods: [{ id: "visa", name: "Card", kind: "card", enabled: true }],
    };
    renderAt(`/shops/${SHOP_ID}/setup/identity`);

    const card = within(await screen.findByRole("region", { name: "Payment methods" }));
    await user.click(card.getByRole("button", { name: "Edit Card" }));
    const open = within(card.getByRole("form", { name: "Edit Card" }));
    await user.selectOptions(open.getByLabelText("Kind"), "wallet");

    // The enabled box is on the row's chip line, outside the open form, and writes straight
    // to the draft. Save must read it from the entry as it now stands: a snapshot taken when
    // Edit was pressed would put the tick back and lose the operator's work in silence.
    await user.click(card.getByRole("checkbox", { name: "enabled" }));
    await user.click(open.getByRole("button", { name: "Save Card" }));

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));

    expect(lastSaved()).toStrictEqual({
      ...unchangedPayload(),
      payment_methods: [{ id: "visa", name: "Card", kind: "wallet", enabled: false }],
    });
  });

  it("adds a value to a saved option through the same chip field the add form uses", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const options = within(await screen.findByRole("region", { name: "Options" }));
    await user.click(options.getByRole("button", { name: "Edit Color" }));

    // The saved values are the chips, editable, each with the name the read-only row gave it.
    const open = within(options.getByRole("form", { name: "Edit Color" }));
    expect(open.getByRole("button", { name: "Remove Ocean Blue" })).toBeVisible();
    await user.type(open.getByLabelText("New value"), "Charcoal");
    await user.click(open.getByRole("button", { name: "Add value" }));
    await user.click(open.getByRole("button", { name: "Save Color" }));

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));

    const before = unchangedPayload();
    expect(lastSaved()).toStrictEqual({
      ...before,
      products: [
        {
          ...before.products[0],
          options: [
            { key: "color", name: "Color", values: ["Ocean Blue", "Charcoal"] },
            { key: "size", name: "Size", values: ["M", "L"] },
          ],
        },
      ],
    });
  });

  it("relabels a choice attribute without dropping the choices it is constrained to", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const card = within(await screen.findByRole("region", { name: "Custom attributes (typed)" }));
    await user.click(card.getByRole("button", { name: "Edit Waterproofing" }));
    const open = within(card.getByRole("form", { name: "Edit Waterproofing" }));
    await user.clear(open.getByLabelText("Label"));
    await user.type(open.getByLabelText("Label"), "Waterproof rating");
    await user.click(open.getByRole("button", { name: "Save Waterproofing" }));

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));

    const before = unchangedPayload();
    expect(lastSaved()).toStrictEqual({
      ...before,
      products: [
        {
          ...before.products[0],
          attributes: [
            {
              // The key does not follow the label the way the add form's does: it was derived
              // when the attribute was created, and the tools that read it have not moved.
              key: "waterproofing",
              label: "Waterproof rating",
              attribute_type: "choice",
              value: "20k",
              unit: null,
              choices: ["10k", "20k", "30k"],
            },
          ],
        },
      ],
    });
  });

  it("empties the choices when a choice attribute is edited into a text one", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const card = within(await screen.findByRole("region", { name: "Custom attributes (typed)" }));
    await user.click(card.getByRole("button", { name: "Edit Waterproofing" }));
    const open = within(card.getByRole("form", { name: "Edit Waterproofing" }));
    await user.selectOptions(open.getByLabelText("Type"), "text");
    await user.click(open.getByRole("button", { name: "Save Waterproofing" }));

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));

    // The builder normalises, so the edit path cannot carry choices a text attribute may not
    // hold — which is what an edit that spread `{...attribute, ...changes}` would have done.
    expect(lastSaved().products[0].attributes).toStrictEqual([
      {
        key: "waterproofing",
        label: "Waterproofing",
        attribute_type: "text",
        value: "20k",
        unit: null,
        choices: [],
      },
    ]);
  });

  it("nulls the unit when a measurement attribute is edited into a text one", async () => {
    const user = userEvent.setup();
    currentContent = {
      ...READY_CONTENT,
      products: [
        {
          ...READY_CONTENT.products[0],
          attributes: [
            {
              key: "waterproofing",
              label: "Waterproofing",
              attribute_type: "measurement",
              value: "20000",
              unit: "mm",
              choices: [],
            },
          ],
        },
      ],
    };
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const card = within(await screen.findByRole("region", { name: "Custom attributes (typed)" }));
    await user.click(card.getByRole("button", { name: "Edit Waterproofing" }));
    const open = within(card.getByRole("form", { name: "Edit Waterproofing" }));
    expect(open.getByLabelText("Unit")).toHaveValue("mm");
    await user.selectOptions(open.getByLabelText("Type"), "text");
    await user.click(open.getByRole("button", { name: "Save Waterproofing" }));

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));

    expect(lastSaved().products[0].attributes).toStrictEqual([
      {
        key: "waterproofing",
        label: "Waterproofing",
        attribute_type: "text",
        value: "20000",
        unit: null,
        choices: [],
      },
    ]);
  });

  it("corrects a review's body and keeps the id the row displays", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const card = within(await screen.findByRole("region", { name: "Ratings and reviews" }));
    await user.click(card.getByRole("button", { name: "Edit review one" }));
    const open = within(card.getByRole("form", { name: "Edit review one" }));
    await user.clear(open.getByLabelText("Body"));
    await user.type(open.getByLabelText("Body"), "Dry all day.");
    await user.click(open.getByRole("button", { name: "Save review one" }));

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));

    const before = unchangedPayload();
    expect(lastSaved()).toStrictEqual({
      ...before,
      products: [
        {
          ...before.products[0],
          reviews: [{ id: "one", author_display_name: "Camille", rating: 5, body: "Dry all day." }],
        },
      ],
    });
  });

  it("moves a variant's option value and leaves its price, stock and availability", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const variants = within(await screen.findByRole("region", { name: "Variants" }));
    await user.click(variants.getByRole("button", { name: "Edit NS-ASJ-OB-M" }));
    await user.selectOptions(variants.getByLabelText("Size for NS-ASJ-OB-M"), "L");
    await user.click(variants.getByRole("button", { name: "Save NS-ASJ-OB-M" }));

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));

    const before = unchangedPayload();
    expect(lastSaved().products[0].variants).toStrictEqual([
      {
        ...before.products[0].variants[0],
        option_values: [
          { key: "color", value: "Ocean Blue" },
          { key: "size", value: "L" },
        ],
      },
      before.products[0].variants[1],
    ]);
  });

  it("corrects only the SKU of a variant whose option order is not the product's", async () => {
    const user = userEvent.setup();
    // Authored through the API rather than through this form, so its two option values are in
    // the other order from the product's — which is only observable with both keys present.
    const stored = {
      sku: "NS-ASJ-ODD",
      option_values: [
        { key: "size", value: "M" },
        { key: "color", value: "Ocean Blue" },
      ],
      availability: "in_stock" as const,
      stock_quantity: 3,
      price: { amount: "249.00", currency: "EUR" as const },
    };
    currentContent = {
      ...READY_CONTENT,
      products: [{ ...READY_CONTENT.products[0], variants: [stored] }],
    };
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const variants = within(await screen.findByRole("region", { name: "Variants" }));
    await user.click(variants.getByRole("button", { name: "Edit NS-ASJ-ODD" }));
    const sku = variants.getByLabelText("SKU for NS-ASJ-ODD");
    await user.clear(sku);
    await user.type(sku, "NS-ASJ-OB-S");
    await user.click(variants.getByRole("button", { name: "Save NS-ASJ-ODD" }));

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));

    // Only the SKU moved, `size` before `color` as it was stored. Rebuilding from
    // `product.options` would have re-sorted it and reported an update nobody asked for.
    expect(lastSaved().products[0].variants).toStrictEqual([{ ...stored, sku: "NS-ASJ-OB-S" }]);
  });

  it("lets a variant that predates an option choose one, which the gate refuses without", async () => {
    const user = userEvent.setup();
    // No `size` at all: `validate_shop` raises `variant_missing_option` as an error, so this
    // draft cannot be published until this row answers — and this row is the only place it
    // can be answered.
    const stored = {
      sku: "NS-ASJ-OLD",
      option_values: [{ key: "color", value: "Ocean Blue" }],
      availability: "in_stock" as const,
      stock_quantity: 3,
      price: { amount: "249.00", currency: "EUR" as const },
    };
    currentContent = {
      ...READY_CONTENT,
      products: [{ ...READY_CONTENT.products[0], variants: [stored] }],
    };
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const variants = within(await screen.findByRole("region", { name: "Variants" }));
    await user.click(variants.getByRole("button", { name: "Edit NS-ASJ-OLD" }));
    await user.selectOptions(variants.getByLabelText("Size for NS-ASJ-OLD"), "L");
    await user.click(variants.getByRole("button", { name: "Save NS-ASJ-OLD" }));

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));

    // The answer the row offered is the answer the builder wrote: the carried key keeps its
    // place and the gained one is appended. A select with no write behind it would have shown
    // "L" and saved the variant unchanged.
    expect(lastSaved().products[0].variants).toStrictEqual([
      {
        ...stored,
        option_values: [
          { key: "color", value: "Ocean Blue" },
          { key: "size", value: "L" },
        ],
      },
    ]);
  });

  it("refuses a SKU another variant already holds, rather than merging two rows", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const variants = within(await screen.findByRole("region", { name: "Variants" }));
    await user.click(variants.getByRole("button", { name: "Edit NS-ASJ-OB-M" }));
    const sku = variants.getByLabelText("SKU for NS-ASJ-OB-M");
    await user.clear(sku);
    await user.type(sku, "NS-ASJ-OB-L");

    expect(sku).toBeInvalid();
    expect(variants.getByText("NS-ASJ-OB-L is already in the draft.")).toBeVisible();
    expect(variants.getByRole("button", { name: "Save NS-ASJ-OB-M" })).toBeDisabled();
    // And the rename says what it will cost before it is pressed.
    expect(sku).toHaveAccessibleDescription(/reads as a removal and an addition/);
  });

  it("refuses a SKU the contract could not carry, which no form here would have caught", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const variants = within(await screen.findByRole("region", { name: "Variants" }));
    await user.click(variants.getByRole("button", { name: "Edit NS-ASJ-OB-M" }));
    const sku = variants.getByLabelText("SKU for NS-ASJ-OB-M");
    await user.clear(sku);
    // The open row has no form around it, so `pattern` marks the box and refuses nothing;
    // the shape is checked in the save gate instead, off the same constant.
    await user.type(sku, "ns asj_1");

    expect(sku).toHaveValue("NS ASJ_1");
    // Asserted on the attribute, not only on `toBeInvalid()`: `pattern` alone would make
    // `checkValidity()` false and hide whether the box says so to a reader who has no
    // constraint validation — which is the whole reason the shape is checked in the gate.
    expect(sku).toHaveAttribute("aria-invalid", "true");
    expect(sku).toBeInvalid();
    expect(variants.getByRole("button", { name: "Save NS-ASJ-OB-M" })).toBeDisabled();
    expect(savedDrafts).toEqual([]);
  });

  it("refuses a media reference another entry holds, on both the row and the add form", async () => {
    const user = userEvent.setup();
    currentContent = {
      ...READY_CONTENT,
      products: [
        {
          ...READY_CONTENT.products[0],
          media: [
            { reference: "media/alpine-shell.jpg", alt_text: "Hood up in the rain" },
            { reference: "media/alpine-charcoal.jpg", alt_text: "Charcoal, front" },
          ],
        },
      ],
    };
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const card = within(await screen.findByRole("region", { name: "Media references" }));
    await user.click(card.getByRole("button", { name: "Edit media/alpine-shell.jpg" }));
    const open = within(card.getByRole("form", { name: "Edit media/alpine-shell.jpg" }));
    const reference = open.getByLabelText("Reference");
    await user.clear(reference);
    await user.type(reference, "media/alpine-charcoal.jpg");

    // Greying Save without saying why was the defect: the refusal is announced where it was
    // typed, on `DerivedIdField`'s collision model.
    expect(reference).toBeInvalid();
    expect(reference).toHaveAccessibleDescription(
      /media\/alpine-charcoal\.jpg is already a media reference of this product/,
    );
    expect(open.getByRole("button", { name: "Save media/alpine-shell.jpg" })).toBeDisabled();
    await user.click(open.getByRole("button", { name: "Cancel editing media/alpine-shell.jpg" }));

    // The add form refuses the same duplicate in the same words — it refused nothing at all
    // before, and two entries sharing a reference are one key in the change summary.
    await user.type(card.getByLabelText("Reference"), "media/alpine-charcoal.jpg");
    await user.type(card.getByLabelText("Alt text"), "Charcoal again");
    await user.click(card.getByRole("button", { name: "Add media" }));

    expect(card.getByLabelText("Reference")).toBeInvalid();
    expect(card.getAllByRole("listitem")).toHaveLength(2);
    expect(savedDrafts).toEqual([]);
  });

  it("says nothing in the open row reaches the draft, and Cancel proves it", async () => {
    const user = userEvent.setup();
    // Read on tone of voice since the three document collections left their rows for a page
    // of their own (PLAN-UX Slice 16). Edit in place is the same component either way.
    renderAt(`/shops/${SHOP_ID}/setup/tone`);

    const tone = within(await screen.findByRole("region", { name: "Guidelines" }));
    await user.click(tone.getByRole("button", { name: "Edit Warm and precise" }));
    const open = within(tone.getByRole("form", { name: "Edit Warm and precise" }));
    await user.clear(open.getByLabelText("Name"));
    await user.type(open.getByLabelText("Name"), "Not this");

    // The draft is untouched, so the page still reports itself as saved.
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
    await user.click(open.getByRole("button", { name: "Cancel editing Warm and precise" }));

    expect(tone.getByText("Warm and precise")).toBeVisible();
    expect(savedDrafts).toEqual([]);
  });
});

/**
 * The four rules a tone-of-voice guideline answers to (PLAN-UX Slice 17,
 * `Workspace.dc.html`:1897).
 *
 * They are all one page's, and three of the four are refusals: a guideline called nothing, a
 * default deleted out from under the gate, and a create abandoned halfway. The fourth is what
 * the row may honestly say about itself, which is less than the prototype draws.
 */
describe("a tone-of-voice guideline's own rules", () => {
  /** A second guideline, so that "the default" and "a guideline" are two different rows. */
  const BRIEF = {
    id: "brief",
    name: "Brief",
    guidance: "One paragraph, under forty words. Lead with the outcome.",
    is_default: false,
  };

  function twoGuidelines(): ShopDraftResponse["content"] {
    return {
      ...READY_CONTENT,
      tone_of_voice_guidelines: [...READY_CONTENT.tone_of_voice_guidelines, BRIEF],
    };
  }

  function guidelines() {
    return screen.findByRole("region", { name: "Guidelines" });
  }

  function shopRail() {
    return within(screen.getByLabelText("Shop workspace"));
  }

  it("refuses to add a guideline with no name, and says why beside the button", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/setup/tone`);
    const tone = within(await guidelines());

    const blocked = tone.getByRole("button", { name: "Add tone of voice" });
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveAttribute("title", TONE_NAME_RULE);
    expect(blocked).toHaveAccessibleDescription(TONE_NAME_RULE);

    // A whole form with no name is the case `required` on the Name input already refused.
    await user.type(tone.getByLabelText("ID"), "brief");
    await user.type(tone.getByLabelText("Guidance"), BRIEF.guidance);
    expect(tone.getByRole("button", { name: "Add tone of voice" })).toBeDisabled();

    // This is the door the rule actually closes. `required` is satisfied by a space, so a
    // name of nothing but spaces used to reach the draft and come back a 422 from
    // `require_label`; the button refuses it here, in the same words.
    await user.type(tone.getByLabelText("Name"), " ");
    const padded = tone.getByRole("button", { name: "Add tone of voice" });
    expect(padded).toBeDisabled();
    expect(padded).toHaveAccessibleDescription(TONE_NAME_RULE);

    await user.clear(tone.getByLabelText("Name"));
    await user.type(tone.getByLabelText("Name"), "Brief");
    const allowed = tone.getByRole("button", { name: "Add tone of voice" });
    expect(allowed).toBeEnabled();
    expect(allowed).not.toHaveAccessibleDescription(TONE_NAME_RULE);

    await user.click(allowed);
    expect(tone.getByText("brief", { selector: "code" })).toBeVisible();
  });

  it("refuses to save or to default a guideline renamed to nothing, from one line", async () => {
    const user = userEvent.setup();
    currentContent = twoGuidelines();
    renderAt(`/shops/${SHOP_ID}/setup/tone`);
    const tone = within(await guidelines());

    await user.click(tone.getByRole("button", { name: "Edit Brief" }));
    const open = within(tone.getByRole("form", { name: "Edit Brief" }));
    await user.clear(open.getByLabelText("Name"));

    const save = tone.getByRole("button", { name: "Save Brief" });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("title", TONE_NAME_RULE);
    expect(save).toHaveAccessibleDescription(TONE_NAME_RULE);

    // The same fact refusing the other thing this row can do. The radio answers for the row
    // in front of the operator, and that row is now called nothing — so it is refused here
    // rather than moving the default onto the name still saved underneath the form.
    const radio = tone.getByRole("radio", { name: "Make Brief the shop default" });
    expect(radio).toBeDisabled();
    expect(radio).toHaveAccessibleDescription(TONE_NAME_RULE);
    // Two refusals, one cause, one sentence: both controls point at the row's single line.
    expect(open.getAllByText(TONE_NAME_RULE)).toHaveLength(1);
    // The other row is not the one being renamed, so its own default radio still works.
    expect(
      tone.getByRole("radio", { name: "Make Warm and precise the shop default" }),
    ).toBeEnabled();

    await user.type(open.getByLabelText("Name"), "Brief and plain");
    expect(tone.getByRole("button", { name: "Save Brief" })).toBeEnabled();
    expect(tone.getByRole("radio", { name: "Make Brief the shop default" })).toBeEnabled();
    expect(open.queryByText(TONE_NAME_RULE)).toBeNull();
  });

  it("refuses to delete the shop default, and points at the way out", async () => {
    const user = userEvent.setup();
    currentContent = twoGuidelines();
    renderAt(`/shops/${SHOP_ID}/setup/tone`);
    const tone = within(await guidelines());

    // Where the default's Remove would stand, the row says what to do instead. Every surviving
    // Remove asks a second time (ADR 0060); this is about the one that is not offered.
    const rows = tone.getAllByRole("listitem");
    expect(within(rows[0]).queryByRole("button", { name: "Remove Warm and precise" })).toBeNull();
    expect(within(rows[0]).getByText(TONE_DEFAULT_REMOVAL_RULE)).toBeVisible();
    expect(within(rows[1]).getByRole("button", { name: "Remove Brief" })).toBeVisible();

    // Pointing the default elsewhere is the whole of the way out, and the refusal moves with
    // the pointer rather than with the row.
    await user.click(tone.getByRole("radio", { name: "Make Brief the shop default" }));

    const moved = tone.getAllByRole("listitem");
    expect(within(moved[1]).queryByRole("button", { name: "Remove Brief" })).toBeNull();
    expect(within(moved[1]).getByText(TONE_DEFAULT_REMOVAL_RULE)).toBeVisible();
    await user.click(within(moved[0]).getByRole("button", { name: "Remove Warm and precise" }));
    await user.click(tone.getByRole("button", { name: "Remove it" }));

    expect(tone.queryByText("Warm and precise")).toBeNull();
    expect(tone.getByText("Brief")).toBeVisible();
  });

  it("names a guideline by its slug, and draws no version or used-by figure", async () => {
    // The prototype's row reads `slug · v2` with "Resolved by 3 agent configurations" under
    // it. `ToneOfVoiceSchema` carries no version of its own — the shop carries the version,
    // and the page header's chips are where it is read — and `AgentConfigurationSummarySchema`
    // carries no tone selection at all, so neither figure is drawn rather than faked
    // (`docs/design-direction.md`, *Lists and counts*).
    currentContent = twoGuidelines();
    renderAt(`/shops/${SHOP_ID}/setup/tone`);
    const tone = within(await guidelines());

    const rows = tone.getAllByRole("listitem");
    expect(within(rows[0]).getByText("warm", { selector: "code" })).toBeVisible();
    expect(within(rows[1]).getByText("brief", { selector: "code" })).toBeVisible();
    expect(within(rows[1]).queryByText(/\bv\d+\b/)).toBeNull();
    expect(within(rows[1]).queryByText(/configuration/i)).toBeNull();
    // The one thing about use this page does know is which guideline a configuration with no
    // override resolves to, and the default row already carries it as a chip.
    expect(within(rows[0]).getByText("shop default")).toBeVisible();
  });

  it("never appends the guideline being typed, so abandoning one leaves no row to remove", async () => {
    // The prototype's *New guideline* appends an empty record to the list and marks the draft
    // unsaved on the press, so its Cancel has to take the row out again and put the save
    // state back — a rollback of a write that was never asked for, and one that restores the
    // save state wholesale over anything else the operator did meanwhile. Here the add form
    // holds the new guideline outside the draft until Add is pressed, so there is no appended
    // row for a cancel to remove and no save state to restore (ADR 0051).
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/setup/tone`);
    const tone = within(await guidelines());

    await user.type(tone.getByLabelText("Name"), "Brief");
    await user.type(tone.getByLabelText("Guidance"), BRIEF.guidance);

    expect(tone.queryByRole("button", { name: "Edit Brief" })).toBeNull();
    expect(within(railEntry("Tone of voice")).getByText("1")).toBeVisible();
    expect(screen.getByText("All changes saved")).toBeInTheDocument();

    // Leaving is the whole of the cancel: a half-typed create form is not unsaved work, so
    // nothing is asked and nothing is left behind.
    await user.click(shopRail().getByRole("link", { name: "Orders" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Orders" })).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(shopRail().getByRole("link", { name: "Tone of voice" }));
    const again = within(await guidelines());
    expect(again.getByLabelText("Name")).toHaveValue("");
    expect(again.queryByRole("button", { name: "Edit Brief" })).toBeNull();
    expect(within(railEntry("Tone of voice")).getByText("1")).toBeVisible();
    expect(savedDrafts).toEqual([]);
  });
});

/**
 * Every URL the tree answers and the component it answers with, in the order it declares them.
 *
 * The element matters as much as the path: "the existing route tree unchanged" is a claim about
 * what each URL renders, and a tree that kept every path while swapping two elements would be a
 * migration that broke the application and passed its own test. A pathless layout contributes no
 * URL of its own, which is how the guard sits above everything without being a route.
 *
 * The component is named rather than imported: forty imports to compare forty identities would
 * put more of this file in the maintenance of the assertion than in the assertion. The name is
 * the function's own, read from source by Vitest and never minified here.
 */
function routedElements(routes: RouteObject[], prefix = ""): [string, string][] {
  return routes.flatMap((route): [string, string][] => {
    const here =
      route.path === undefined
        ? prefix
        : route.path.startsWith("/")
          ? route.path
          : `${prefix}/${route.path}`;
    const element = isValidElement(route.element) ? route.element.type : undefined;
    const name = typeof element === "function" ? element.name : String(element);
    const self: [string, string][] =
      route.index === true
        ? [[`${prefix} [index]`, name]]
        : route.path === undefined
          ? []
          : [[here, name]];
    return [...self, ...routedElements(route.children ?? [], here)];
  });
}

describe("the tree's create pages and the tour table", () => {
  it("excludes every create route the tree declares from the tours", () => {
    // `tourAt` resolves a surface's walk from the location, so a create page the tour table
    // has never heard of can be handed the walk of the index above it and light anchors
    // that are not on the screen (PLAN-UX Slice 12, extended to the lab's four in 13). The
    // cases are the route tree's own rows rather than a list kept beside them, so a create
    // route added tomorrow fails here instead of being remembered. Slice 14 made it nine.
    const declared = routedElements(routeTree)
      .map(([path]) => path)
      .filter((path) => path.endsWith("/new"));

    // Ten with the document's, which is a create page for a row of the shop draft: the kind
    // it lands in is a question its editor cannot ask (ADR 0057).
    expect(declared).toHaveLength(10);
    expect([...declared].sort()).toEqual([...CREATE_ROUTES].sort());
    for (const path of declared) {
      expect(tourAt(path.replaceAll(/:[A-Za-z]+/g, "x")), `${path} was offered a tour`).toBeNull();
    }
  });
});

describe("the route tree under the data router", () => {
  it("is two modes and a set of redirects, with one guard above all of them", () => {
    expect(routeTree).toHaveLength(1);
    const root = routeTree[0];
    // Pathless: it matches no URL of its own, so nothing about the tree's shape moved.
    expect(root.path).toBeUndefined();
    expect(root.index).not.toBe(true);
    expect(isValidElement(root.element) ? root.element.type : null).toBe(UnsavedChangesGuard);

    expect(routedElements(routeTree)).toStrictEqual([
      ["/", "Landing"],
      ["/shops", "ShopsPage"],
      ["/shops/new", "NewShopPage"],
      ["/settings", "LabSettingsPage"],
      ["/glossary", "GlossaryPage"],
      ["/guides", "Navigate"],
      ["/guides/setup", "Navigate"],
      ["/guides/glossary", "RedirectRetiredGlossary"],
      ["/lab", "LabWorkspace"],
      ["/lab [index]", "Navigate"],
      ["/lab/bench", "ExperimentSetupPage"],
      ["/lab/bench/:shopId/:experimentId", "ExperimentBenchPage"],
      ["/lab/bench/:shopId/:experimentId/results", "ExperimentResultsLayout"],
      ["/lab/bench/:shopId/:experimentId/results [index]", "ExperimentResultsPage"],
      ["/lab/bench/:shopId/:experimentId/results/timeline", "ExperimentTimelinePage"],
      ["/lab/bench/:shopId/:experimentId/results/traces", "ExperimentTracesPage"],
      ["/lab/history", "ExperimentHistoryPage"],
      ["/lab/agent-configurations", "AgentConfigurationsPage"],
      ["/lab/agent-configurations/new", "NewAgentConfigurationPage"],
      ["/lab/agent-configurations/:configurationId", "AgentConfigurationEditorPage"],
      ["/lab/judges", "JudgeConfigurationsPage"],
      ["/lab/judges/new", "NewJudgePage"],
      ["/lab/judges/:judgeId", "JudgeConfigurationEditorPage"],
      ["/lab/support-identities", "SupportIdentitiesPage"],
      ["/lab/support-identities/new", "NewSupportIdentityPage"],
      ["/lab/support-identities/:identityId", "SupportIdentityEditorPage"],
      ["/lab/objective-blocks", "ObjectiveBlocksPage"],
      ["/lab/objective-blocks/new", "NewObjectiveBlockPage"],
      ["/lab/objective-blocks/:blockId", "ObjectiveBlockEditorPage"],
      ["/lab/mutation-blocks", "MutationBlocksPage"],
      ["/lab/mutation-blocks/new", "NewMutationBlockPage"],
      ["/lab/mutation-blocks/:blockId", "MutationBlockEditorPage"],
      // Every lab path the shop layout used to hold, kept as a redirect and nothing else.
      ["/shops/:shopId/bench", "LabRedirect"],
      ["/shops/:shopId/bench/:experimentId", "LabRedirect"],
      ["/shops/:shopId/bench/:experimentId/results", "LabRedirect"],
      ["/shops/:shopId/bench/:experimentId/results/timeline", "LabRedirect"],
      ["/shops/:shopId/bench/:experimentId/results/traces", "LabRedirect"],
      ["/shops/:shopId/history", "LabRedirect"],
      ["/shops/:shopId/agent-configurations", "LabRedirect"],
      ["/shops/:shopId/agent-configurations/:configurationId", "LabRedirect"],
      ["/shops/:shopId/judges", "LabRedirect"],
      ["/shops/:shopId/judges/:judgeId", "LabRedirect"],
      ["/shops/:shopId/support-identities", "LabRedirect"],
      ["/shops/:shopId/support-identities/:identityId", "LabRedirect"],
      ["/shops/:shopId/objective-blocks", "LabRedirect"],
      ["/shops/:shopId/objective-blocks/:blockId", "LabRedirect"],
      ["/shops/:shopId/mutation-blocks", "LabRedirect"],
      ["/shops/:shopId/mutation-blocks/:blockId", "LabRedirect"],
      ["/shops/:shopId", "ShopWorkspace"],
      ["/shops/:shopId [index]", "ShopHomePage"],
      ["/shops/:shopId/products", "ProductsPage"],
      ["/shops/:shopId/products/:handle", "ProductEditorPage"],
      ["/shops/:shopId/orders", "OrdersPage"],
      ["/shops/:shopId/orders/new", "NewOrderPage"],
      ["/shops/:shopId/orders/:orderId", "OrderEditorPage"],
      ["/shops/:shopId/customers", "CustomersPage"],
      ["/shops/:shopId/customers/new", "NewCustomerPage"],
      ["/shops/:shopId/tickets", "TicketsPage"],
      ["/shops/:shopId/tickets/:ticketId", "TicketsPage"],
      ["/shops/:shopId/customers/:profileId", "CustomerEditorRoute"],
      ["/shops/:shopId/scenarios", "ScenariosPage"],
      ["/shops/:shopId/scenarios/new", "NewScenarioPage"],
      ["/shops/:shopId/scenarios/:scenarioId", "ScenarioEditorPage"],
      ["/shops/:shopId/scenarios/:scenarioId/snapshots", "SnapshotsPage"],
      ["/shops/:shopId/setup/identity", "ShopIdentityPage"],
      ["/shops/:shopId/setup/policies", "DocumentsPage"],
      ["/shops/:shopId/setup/documents/new", "NewDocumentPage"],
      ["/shops/:shopId/setup/documents/:kind/:docId", "DocumentEditorPage"],
      ["/shops/:shopId/setup/support", "RedirectRetiredGuidelines"],
      ["/shops/:shopId/setup/tone", "ToneOfVoicePage"],
      ["/shops/:shopId/versions/:version", "ShopVersionPage"],
      ["/*", "Navigate"],
    ]);
  });
});

describe("the shop draft's reach", () => {
  /** Every shop-scoped URL the tree answers, with its parameters filled in. */
  function shopRoutes(): string[] {
    // De-duplicated: a layout route and its index answer the same URL.
    return [
      ...new Set(routedElements(routeTree).map(([pattern]) => pattern.replace(" [index]", ""))),
    ]
      .filter((pattern) => pattern.startsWith("/shops/:shopId"))
      .map((pattern) =>
        pattern
          .replace(":shopId", SHOP_ID)
          .replace(/:[A-Za-z]+/g, "x")
          .replace(/\/$/, ""),
      );
  }

  it("covers exactly the surfaces that render the shop draft's Save", () => {
    // Swept over the tree rather than compared with a list somebody keeps: a route added
    // tomorrow is classified tomorrow, and a rename that drops one out of reach fails here
    // rather than silently prompting an operator who had nothing to lose.
    const reached = shopRoutes().filter((pathname) => shopDraftIsSavableAt(SHOP_ID, pathname));
    expect(reached).toStrictEqual([
      `/shops/${SHOP_ID}`,
      `/shops/${SHOP_ID}/products`,
      `/shops/${SHOP_ID}/products/x`,
      `/shops/${SHOP_ID}/setup/identity`,
      `/shops/${SHOP_ID}/setup/policies`,
      `/shops/${SHOP_ID}/setup/documents/new`,
      `/shops/${SHOP_ID}/setup/documents/x/x`,
      `/shops/${SHOP_ID}/setup/support`,
      `/shops/${SHOP_ID}/setup/tone`,
    ]);
    // And it is a statement about this shop: another shop's catalog cannot save this draft.
    expect(shopDraftIsSavableAt(SHOP_ID, "/shops/other/products")).toBe(false);
  });
});

describe("unsaved work is protected", () => {
  function rail() {
    return within(screen.getByLabelText("Shop workspace"));
  }

  it("asks before the rail carries a product edit somewhere it cannot be saved", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const description = await screen.findByLabelText("Description");
    await user.type(description, " Taped seams.");

    await user.click(rail().getByRole("link", { name: "Orders" }));

    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(prompt).toHaveTextContent("The shop draft has unsaved changes.");
    await user.click(within(prompt).getByRole("button", { name: "Stay on this page" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Alpine Shell Jacket" })).toBeVisible();
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Three-layer waterproof shell. Taped seams.",
    );
  });

  it("says nothing when the surface being opened can save the same draft", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    await user.type(await screen.findByLabelText("Description"), " Taped seams.");
    await user.click(rail().getByRole("link", { name: "Products" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Products" })).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    // The edit went with them: the catalog's own Save is what it is still waiting for.
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  });

  it("names both a dirty draft and an open row, and drops neither on Discard", async () => {
    const user = userEvent.setup();
    // Tone of voice is where an add form and an edit-in-place row now stand side by side:
    // the three document collections moved to a table and a page (PLAN-UX Slice 16), and
    // this case is about the two kinds of unsaved work rather than about any one list.
    renderAt(`/shops/${SHOP_ID}/setup/tone`);

    // Two unsaved things at once, of the two different kinds: one the draft's flag can see,
    // one it cannot. The prompt has to list both and act on both.
    const tone = within(await screen.findByRole("region", { name: "Guidelines" }));
    await user.click(tone.getByRole("button", { name: "Edit Warm and precise" }));
    const open = within(tone.getByRole("form", { name: "Edit Warm and precise" }));
    await user.clear(open.getByLabelText("Guidance"));
    await user.type(open.getByLabelText("Guidance"), "Lead with the fact.");
    await user.click(screen.getByRole("button", { name: "Save Warm and precise" }));
    await user.click(tone.getByRole("button", { name: "Edit Warm and precise" }));
    await user.type(
      within(tone.getByRole("form", { name: "Edit Warm and precise" })).getByLabelText("Guidance"),
      " Twice.",
    );

    await user.click(rail().getByRole("link", { name: "Orders" }));

    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    const listed = within(prompt)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(listed).toStrictEqual([
      "The shop draft has unsaved changes.",
      "Warm and precise is open for editing, and nothing typed in it has reached the draft.",
    ]);
    // One of the two cannot be saved from here, so neither is saved from here.
    expect(within(prompt).getByRole("button", { name: "Save and leave" })).toBeDisabled();

    await user.click(within(prompt).getByRole("button", { name: "Discard and leave" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Orders" })).toBeVisible();
    // The draft went back to what the lab holds, so nothing of either was left behind.
    expect(savedDrafts).toHaveLength(0);
  });

  it("counts a row that is open for editing, which the draft's own flag cannot see", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/setup/tone`);

    const tone = within(await screen.findByRole("region", { name: "Guidelines" }));
    await user.click(tone.getByRole("button", { name: "Edit Warm and precise" }));
    const open = within(tone.getByRole("form", { name: "Edit Warm and precise" }));
    await user.clear(open.getByLabelText("Guidance"));
    await user.type(open.getByLabelText("Guidance"), "Lead with the fact.");
    // Nothing typed in the row has reached the draft, which is exactly why `dirty` is false.
    expect(screen.getByText("All changes saved")).toBeInTheDocument();

    // Out of the shop draft's reach, through the bar: Settings can save nothing of this shop's.
    await user.click(screen.getByRole("link", { name: "Settings" }));

    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(prompt).toHaveTextContent(
      "Warm and precise is open for editing, and nothing typed in it has reached the draft.",
    );
    // The prompt cannot save it, and says where it can be saved rather than offering to.
    const save = within(prompt).getByRole("button", { name: "Save and leave" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription(/Stay, then press the row's own Save or Cancel/);

    await user.click(within(prompt).getByRole("button", { name: "Discard and leave" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Lab settings" })).toBeVisible();
  });

  /**
   * *Save and leave* awaits the write, and the question it was asked can stop being the
   * pending one in that interval.
   *
   * A navigation that strands nothing is let through while the prompt is still saving — a
   * surface that can save the same draft, or a continuation of the page's own that reaches
   * its destination — and `@remix-run/router` resets every blocker to idle as it completes
   * that navigation. The `proceed` the prompt was drawn with then belongs to a blocker that
   * is no longer blocked: the router permits `blocked -> proceeding` and not
   * `unblocked -> proceeding`, and calling it throws that transition by name out of a promise
   * the click handler voided.
   *
   * Fails against a prompt that proceeds through the blocker it captured: an unhandled
   * `Invalid blocker state transition: unblocked -> proceeding`.
   */
  it("proceeds through no blocker the router has already reset", async () => {
    const user = userEvent.setup();
    const unhandled: unknown[] = [];
    const note = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", note);
    try {
      let release = () => {};
      let reached = () => {};
      const writing = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.put(`*/api/v1/shops/${SHOP_ID}/draft`, async ({ request }) => {
          reached();
          await held;
          const body = (await request.json()) as { payload: SavedShopPayload };
          savedDrafts.push(body.payload);
          return HttpResponse.json(draft(currentContent));
        }),
      );
      const { router } = renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
      await user.type(await screen.findByLabelText("Description"), " Taped seams.");

      // Orders cannot save this draft, so the guard asks on the way out.
      await user.click(rail().getByRole("link", { name: "Orders" }));
      const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
      await user.click(within(prompt).getByRole("button", { name: "Save and leave" }));
      await writing;

      // Products *can* save it, so going there strands nothing and the router completes the
      // navigation — resetting the blocker this prompt is still holding a `proceed` for.
      await act(async () => {
        await router.navigate(`/shops/${SHOP_ID}/products`);
      });
      expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/products`);

      release();
      await waitFor(() => expect(savedDrafts).toHaveLength(1));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      // The draft was saved, the operator is where the second navigation took them, and the
      // prompt's continuation threw nothing on its way out.
      expect(unhandled).toEqual([]);
      expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/products`);
    } finally {
      process.off("unhandledRejection", note);
    }
  });
});

/**
 * UI-2: the product editor's Details card and Shop details' identity card on the form pattern.
 *
 * The rows here carry no hint yet — the handoff writes one for each and this slice does not
 * author copy — so what they must prove is the binding, and that the one row whose control is
 * a set of boxes names itself as a group rather than with a `for` pointing at nothing.
 */
describe("the field pattern on the shop editors", () => {
  it("binds each of the product editor's detail rows to its control", async () => {
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

    const details = within(screen.getByRole("region", { name: "Details" }));
    for (const label of ["Title", "Status", "Category", "Description"] as const) {
      const control = details.getByLabelText(label);
      expect(details.getByText(label).getAttribute("for")).toBe(control.id);
    }
    expect(details.getByLabelText("Title")).toHaveValue("Alpine Shell Jacket");
  });

  it("promises no pick list on the editor's Category, which renders none", async () => {
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

    // `PRODUCT_CATEGORY_RULE` says "pick one the draft already uses", which the create form
    // backs with a `<datalist>` and this surface does not. A hint that is false where it is
    // shown is worse than a row with none, so this row carries none until the list exists.
    const details = within(screen.getByRole("region", { name: "Details" }));
    expect(details.getByLabelText("Category")).toHaveAccessibleDescription("");
    expect(details.getByLabelText("Category")).not.toHaveAttribute("list");
  });

  it("states the rest of the Details card's rules, Title in the create form's own words", async () => {
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

    const details = within(screen.getByRole("region", { name: "Details" }));
    // The whole point of moving the literal into `lib/fieldRules.ts`: the create row and the
    // editor row are one sentence read twice, so this is an equality and not a match.
    expect(details.getByLabelText("Title")).toHaveAccessibleDescription(
      wholeDescription(PRODUCT_TITLE_RULE),
    );
    // Status says what this lab does, which is not what the handoff's radio pair says: a
    // draft product here is returned by the catalog tools and is held to the same gate.
    expect(details.getByLabelText("Status")).toHaveAccessibleDescription(
      /a fact an agent reads, not a filter/i,
    );
    expect(details.getByLabelText("Status")).toHaveAccessibleDescription(
      /publish gate holds all three to the same rules/i,
    );
    // The severity is the gate's own — `product_without_description` is a warning.
    expect(details.getByLabelText("Description")).toHaveAccessibleDescription(
      /publishes with a warning, not a refusal/i,
    );
  });

  it("names the channel boxes as one group, with the rule the disabled box cannot state", async () => {
    renderAt(`/shops/${SHOP_ID}/setup/identity`);

    const channels = await screen.findByRole("group", { name: "Support channels" });
    expect(channels).toHaveAccessibleDescription(
      /a shop must answer somewhere. the last channel left on cannot be turned off/i,
    );
    expect(within(channels).getByRole("checkbox", { name: "Chat" })).toBeChecked();
    // The rule is true of the control as well as said by it.
    expect(within(channels).getByRole("checkbox", { name: "Chat" })).toBeDisabled();
  });

  it("binds Shop details' own rows and leaves the shared fields naming themselves once", async () => {
    renderAt(`/shops/${SHOP_ID}/setup/identity`);

    const identity = within(await screen.findByRole("region", { name: "Shop identity" }));
    for (const label of ["Name", "Slug"] as const) {
      expect(identity.getByText(label).getAttribute("for")).toBe(identity.getByLabelText(label).id);
    }
    // `LocaleField` and `CurrencyField` were not wrapped — a row around either would have
    // produced a second name for one control — but they are asked to draw themselves as rows,
    // so the card holds one label typography rather than two.
    expect(identity.getAllByLabelText("Locale")).toHaveLength(1);
    expect(identity.getAllByRole("group", { name: "Currencies" })).toHaveLength(1);
    expect(identity.getByText("Locale").className).toBe(identity.getByText("Name").className);
    expect(identity.getByRole("group", { name: "Currencies" }).className).toContain("flex-wrap");
    // The two rows of the card's own carry their rules, and Name is the create form's.
    expect(identity.getByLabelText("Name")).toHaveAccessibleDescription(
      wholeDescription(SHOP_NAME_RULE),
    );
    // Not `SHOP_SLUG_RULE`: this input follows nothing, so it may not say that it does.
    expect(identity.getByLabelText("Slug")).toHaveAccessibleDescription(
      /lowercase with hyphens\. the shops index searches it beside the name/i,
    );
    expect(identity.getByLabelText("Slug")).not.toHaveAccessibleDescription(/follows the name/i);
    // And neither shared field lost the rule it carries itself.
    expect(identity.getByLabelText("Locale")).toHaveAccessibleDescription(/pick a locale/i);
    expect(identity.getByRole("group", { name: "Currencies" })).toHaveAccessibleDescription(
      /variants may only be priced in these; the first is the default/i,
    );
  });
});

/**
 * The refresh moves an index's counts onto the control that produces them, so each index's
 * chips are asserted where that index's other rows are: the number is only worth anything if
 * pressing it leaves exactly the rows it claimed.
 */
describe("index filter chips", () => {
  it("counts the shops by publication and narrows the table to the pressed one", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/v1/shops", () =>
        HttpResponse.json({
          shops: [
            ...shops.shops,
            {
              shop_id: "5b1a0f6c-3d2e-4c1b-8a97-6f5e4d3c2b1a",
              name: "Harbour Lane Supply",
              slug: "harbour-lane",
              updated_at: "2026-08-20T09:00:00+00:00",
              latest_published_version: 3,
              published_version_count: 3,
            },
          ],
        } satisfies ShopListResponse),
      ),
    );
    renderAt("/shops");
    await screen.findByRole("link", { name: "Northstar Outfitters" });
    const filters = within(screen.getByRole("group", { name: "Filter shops" }));

    expect(filters.getByRole("button", { name: "All 2" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Published 1" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Never published 1" })).toBeVisible();

    await user.click(filters.getByRole("button", { name: "Published 1" }));

    expect(screen.getByRole("link", { name: "Harbour Lane Supply" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Northstar Outfitters" })).toBeNull();
  });

  it("counts the catalog by status and by finding, and filters to each", async () => {
    const user = userEvent.setup();
    currentContent = {
      ...READY_CONTENT,
      products: [
        ...READY_CONTENT.products,
        {
          handle: "trailhead-cap",
          title: "Trailhead Cap",
          description: "",
          status: "draft",
          category: "Accessories",
          options: [],
          variants: [],
          media: [],
          attributes: [],
          reviews: [],
          ratings: { review_count: 0, average_rating: null },
        },
      ],
    };
    renderAt(`/shops/${SHOP_ID}/products`);
    await screen.findByRole("link", { name: "Alpine Shell Jacket" });
    const filters = within(screen.getByRole("group", { name: "Filter products" }));

    expect(filters.getByRole("button", { name: "All 2" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Active 1" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Draft 1" })).toBeVisible();
    // The findings come from the draft preview, which flags one variant of the jacket.
    await waitFor(() =>
      expect(filters.getByRole("button", { name: "Needs attention 1" })).toBeVisible(),
    );

    await user.click(filters.getByRole("button", { name: "Draft 1" }));

    expect(screen.getByRole("link", { name: "Trailhead Cap" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Alpine Shell Jacket" })).toBeNull();

    await user.click(filters.getByRole("button", { name: "Needs attention 1" }));

    expect(screen.getByRole("link", { name: "Alpine Shell Jacket" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Trailhead Cap" })).toBeNull();
  });
});

describe("the lab is a mode", () => {
  const LAB_LISTINGS = [
    http.get("*/api/v1/agent-configurations", () => HttpResponse.json({ configurations: [] })),
    http.get("*/api/v1/judge-configurations", () => HttpResponse.json({ judges: [] })),
    http.get("*/api/v1/support-identities", () => HttpResponse.json({ identities: [] })),
    http.get("*/api/v1/objective-blocks", () => HttpResponse.json({ blocks: [] })),
    http.get("*/api/v1/mutation-blocks", () => HttpResponse.json({ blocks: [] })),
    http.get("*/api/v1/experiments", () =>
      HttpResponse.json({
        experiments: [],
        total: 0,
        page: 1,
        page_size: 20,
        shops: [],
        scenarios: [],
        frameworks: [],
        tags: [],
      }),
    ),
    http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () => HttpResponse.json({ scenarios: [] })),
    http.get(`*/api/v1/shops/${SHOP_ID}/experiments`, () => HttpResponse.json({ experiments: [] })),
    // The editors a redirect can land on read a draft each. What they render is not what is
    // being asserted here — where the address ended up is — so they are answered "gone" and
    // draw their own error, which is the honest answer for the identifiers invented above.
    ...[
      "agent-configurations",
      "judge-configurations",
      "support-identities",
      "objective-blocks",
      "mutation-blocks",
    ].map((collection) =>
      http.get(`*/api/v1/${collection}/*`, () => HttpResponse.json({}, { status: 404 })),
    ),
    http.get(`*/api/v1/shops/${SHOP_ID}/experiments/*`, () =>
      HttpResponse.json({}, { status: 404 }),
    ),
  ];

  beforeEach(() => server.use(...LAB_LISTINGS));

  /**
   * Every lab path the shop layout used to hold, and where a bookmark to it now lands.
   *
   * A table rather than a case each, because the claim is about the set: a lab address that
   * stopped redirecting would be a bookmark that fell through to the catch-all and quietly
   * reopened the shops index (ADR 0054).
   */
  const REDIRECTS: [string, string][] = [
    [`/shops/${SHOP_ID}/bench`, "/lab/bench"],
    [`/shops/${SHOP_ID}/bench/e1`, `/lab/bench/${SHOP_ID}/e1`],
    [`/shops/${SHOP_ID}/bench/e1/results`, `/lab/bench/${SHOP_ID}/e1/results`],
    [`/shops/${SHOP_ID}/bench/e1/results/timeline`, `/lab/bench/${SHOP_ID}/e1/results/timeline`],
    [`/shops/${SHOP_ID}/bench/e1/results/traces`, `/lab/bench/${SHOP_ID}/e1/results/traces`],
    [`/shops/${SHOP_ID}/history`, "/lab/history"],
    [`/shops/${SHOP_ID}/agent-configurations`, "/lab/agent-configurations"],
    [`/shops/${SHOP_ID}/agent-configurations/c1`, "/lab/agent-configurations/c1"],
    [`/shops/${SHOP_ID}/judges`, "/lab/judges"],
    [`/shops/${SHOP_ID}/judges/j1`, "/lab/judges/j1"],
    [`/shops/${SHOP_ID}/support-identities`, "/lab/support-identities"],
    [`/shops/${SHOP_ID}/support-identities/i1`, "/lab/support-identities/i1"],
    [`/shops/${SHOP_ID}/objective-blocks`, "/lab/objective-blocks"],
    [`/shops/${SHOP_ID}/objective-blocks/b1`, "/lab/objective-blocks/b1"],
    [`/shops/${SHOP_ID}/mutation-blocks`, "/lab/mutation-blocks"],
    [`/shops/${SHOP_ID}/mutation-blocks/b1`, "/lab/mutation-blocks/b1"],
  ];

  afterEach(() => window.localStorage.clear());

  it.each(REDIRECTS)("rescues %s onto %s, carrying the shop with it", async (from, to) => {
    // Every source carries a narrowing and a fragment, because a redirect that rebuilds the
    // path is exactly where they get dropped: experiment history keeps its filters in the URL
    // so a finding can be shared at the narrowing it was found in (ADR 0033).
    const { router, unmount } = renderApp(`${from}?scenario=x&q=returns#evidence`);

    await waitFor(() => expect(router.state.location.pathname).toBe(to));
    expect(router.state.location.search).toBe("?scenario=x&q=returns");
    expect(router.state.location.hash).toBe("#evidence");
    // The one thing the new address does not carry is the one thing the lab needs from the
    // old one: an operator who bookmarked this shop's bench composes for this shop.
    expect(window.localStorage.getItem("agent-lab.last-visited-shop")).toBe(SHOP_ID);
    // Replaced rather than pushed: going back returns to wherever they came from, not to a
    // URL whose only behaviour is to bounce.
    expect(router.state.historyAction).toBe("REPLACE");
    unmount();
  });

  it("opens on the remembered shop, and on the shops index when there is none", async () => {
    const none = renderApp("/");
    await waitFor(() => expect(none.router.state.location.pathname).toBe("/shops"));
    none.unmount();

    window.localStorage.setItem("agent-lab.last-visited-shop", SHOP_ID);
    const remembered = renderApp("/");
    await waitFor(() =>
      expect(remembered.router.state.location.pathname).toBe(`/shops/${SHOP_ID}`),
    );
    remembered.unmount();
  });

  it("opens on the shops index when the remembered shop is no longer there", async () => {
    // Resolved against the list rather than dereferenced: a shop removed since the last visit
    // would otherwise open the workspace's own error page (ADR 0054).
    window.localStorage.setItem(
      "agent-lab.last-visited-shop",
      "11111111-2222-4333-8444-555555555555",
    );
    const { router } = renderApp("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/shops"));
  });

  it("opens where the preference says, when it says something else", async () => {
    window.localStorage.setItem("agent-lab.app-landing", "lab");
    const { router } = renderApp("/");
    await waitFor(() => expect(router.state.location.pathname).toBe("/lab/bench"));
  });

  it("offers the lab from a shop, and the shop from the lab", async () => {
    // The assertion the shells owe the tabs: `AppShell` draws them from the mode it is given,
    // and a shell that forgot to say which mode it was would draw a rail and no way out of it.
    const shop = renderApp(`/shops/${SHOP_ID}`);
    const fromShop = within(await screen.findByRole("navigation", { name: "Workspace mode" }));
    expect(fromShop.getByRole("link", { name: "Experiment lab" })).toHaveAttribute(
      "href",
      "/lab/bench",
    );
    expect(fromShop.getByRole("link", { name: "Shop fixture" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    shop.unmount();

    window.localStorage.setItem("agent-lab.last-visited-shop", SHOP_ID);
    renderApp("/lab/bench");
    const fromLab = within(await screen.findByRole("navigation", { name: "Workspace mode" }));
    await waitFor(() =>
      expect(fromLab.getByRole("link", { name: "Shop fixture" })).toHaveAttribute(
        "href",
        `/shops/${SHOP_ID}`,
      ),
    );
    expect(fromLab.getByRole("link", { name: "Experiment lab" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("says the bench has no shop to compose for, and offers one", async () => {
    renderApp("/lab/bench");

    expect(await screen.findByText(/The lab has no current shop/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Open a shop" })).toHaveAttribute("href", "/shops");
    // And nothing that would freeze a starting state for nobody is on screen.
    expect(screen.queryByRole("button", { name: "Start experiment" })).toBeNull();
  });

  it("tells a lab with no shops what is true of it, and where a shop comes from", async () => {
    // The same condition — no current shop — with a different cause and a different way out.
    // There is no switcher in the top bar to be sent to, and no shop to open: one is made.
    server.use(http.get("*/api/v1/shops", () => HttpResponse.json({ shops: [] })));
    renderApp("/lab/bench");

    const notice = await screen.findByText(/This lab has no shops yet/);
    expect(notice).toHaveTextContent("there is no shop to compose an experiment for");
    expect(screen.getByRole("link", { name: "Create a shop" })).toHaveAttribute("href", "/shops");
    expect(screen.queryByText(/The lab has no current shop/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Switch shop/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start experiment" })).toBeNull();
  });

  it("says the shop list failed rather than asserting the lab has no shop", async () => {
    // A listing that failed answered nothing, so the bench reports the read. It still refuses
    // to compose: not knowing which shop is current is as good a reason as having none.
    server.use(http.get("*/api/v1/shops", () => HttpResponse.json({}, { status: 500 })));
    renderApp("/lab/bench");

    const notice = await screen.findByText(/The lab's shops did not load/);
    expect(notice).toHaveTextContent("there is no shop to compose an experiment for");
    expect(screen.getByRole("link", { name: "Open the shops index" })).toHaveAttribute(
      "href",
      "/shops",
    );
    expect(screen.queryByText(/The lab has no current shop/)).toBeNull();
    expect(screen.queryByText(/This lab has no shops yet/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Start experiment" })).toBeNull();
  });

  it("composes for the remembered shop, and says which one", async () => {
    window.localStorage.setItem("agent-lab.last-visited-shop", SHOP_ID);
    renderApp("/lab/bench");

    expect(await screen.findByText(/Composing for Northstar Outfitters/)).toBeVisible();
    expect(screen.queryByText(/The lab has no current shop/)).toBeNull();
  });

  it("takes the run's shop from the address, so the switcher names it", async () => {
    server.use(
      ...LAB_LISTINGS,
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/e1`, () =>
        HttpResponse.json({}, { status: 404 }),
      ),
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/e1/evaluation`, () =>
        HttpResponse.json({}, { status: 404 }),
      ),
    );
    renderApp(`/lab/bench/${SHOP_ID}/e1`);

    await waitFor(() =>
      expect(window.localStorage.getItem("agent-lab.last-visited-shop")).toBe(SHOP_ID),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Switch shop/ })).toHaveAccessibleName(
        "Switch shop, current: Northstar Outfitters",
      ),
    );
  });
});

/**
 * Three of the shop rail's figures are counted off the draft the shell already holds rather
 * than off a listing of their own, so the figure and the page that edits them are the same
 * object and cannot come to disagree (ADR 0056).
 */
describe("the rail's figures that come from the draft", () => {
  it("counts the products the index lists", async () => {
    renderAt(`/shops/${SHOP_ID}/products`);

    const rows = bodyRows(await screen.findByRole("table"));
    const entry = railEntry("Products");
    expect(within(entry).getByText(String(rows))).toBeVisible();
    expect(entry).toHaveAccessibleDescription(`${rows} product${rows === 1 ? "" : "s"}`);
  });

  /**
   * Each saved entry is an `EntryCard`, which titles itself in an `h3`. Counting those rather
   * than the list items is what makes this read the entries and not the "No policy yet." line
   * an empty list puts in a `<li>` of its own.
   */
  function entriesIn(region: HTMLElement): number {
    return within(region).getAllByRole("heading", { level: 3 }).length;
  }

  it("counts a shop's documents as the three lists the Documents table draws", async () => {
    renderAt(`/shops/${SHOP_ID}/setup/policies`);

    const table = within(await screen.findByRole("region", { name: "Documents" }));
    const documents = table.getAllByRole("row").length - 1;
    expect(documents).toBe(
      READY_CONTENT.policies.length +
        READY_CONTENT.support_guidelines.length +
        READY_CONTENT.faq.length,
    );
    // The support guidelines are in the figure because they are on the page, which is what
    // ended the departure `docs/design-direction.md` recorded (PLAN-UX Slice 16, ADR 0056).
    expect(READY_CONTENT.support_guidelines.length).toBeGreaterThan(0);
    const entry = railEntry("Policies & FAQ");
    expect(within(entry).getByText(String(documents))).toBeVisible();
    expect(entry).toHaveAccessibleDescription(`${documents} document${documents === 1 ? "" : "s"}`);
  });

  it("counts the tone guidelines the page lists", async () => {
    renderAt(`/shops/${SHOP_ID}/setup/tone`);

    const guidelines = entriesIn(await screen.findByRole("region", { name: "Guidelines" }));
    expect(guidelines).toBe(READY_CONTENT.tone_of_voice_guidelines.length);
    const entry = railEntry("Tone of voice");
    expect(within(entry).getByText(String(guidelines))).toBeVisible();
    expect(entry).toHaveAccessibleDescription(
      `${guidelines} guideline${guidelines === 1 ? "" : "s"}`,
    );
  });

  it("follows an edit to the draft without a reload", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/setup/tone`);
    await screen.findByRole("region", { name: "Guidelines" });
    expect(within(railEntry("Tone of voice")).getByText("1")).toBeVisible();

    const form = within(screen.getByRole("region", { name: "Guidelines" }));
    await user.type(form.getByLabelText("Name"), "Brief");
    await user.type(form.getByLabelText("Guidance"), "One paragraph, under forty words.");
    await user.click(form.getByRole("button", { name: "Add tone of voice" }));

    await waitFor(() => expect(within(railEntry("Tone of voice")).getByText("2")).toBeVisible());
  });
});

describe("removing is deliberate", () => {
  const CONFIRM_KEY = "agent-lab.confirm-before-delete";

  afterEach(() => window.localStorage.removeItem(CONFIRM_KEY));

  it("says how many variants choose an option before removing it, and takes their value with it", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    const options = within(await screen.findByRole("region", { name: "Options" }));

    await user.click(options.getByRole("button", { name: "Remove Size" }));
    const confirm = options.getByRole("group", { name: "Remove the option “Size”?" });
    expect(confirm).toHaveAccessibleDescription(
      /^2 variants choose a value of it and will lose it\. 2 variants would become identical — NS-ASJ-OB-M and NS-ASJ-OB-L \(Ocean Blue\) — and the shop is refused at publication until they differ again or one of them is removed\. Nothing is written until you save the draft/,
    );
    await user.click(within(confirm).getByRole("button", { name: "Remove it" }));

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));
    const [product] = lastSaved().products;
    expect(product.options.map((option) => option.key)).toEqual(["color"]);
    // A variant that kept the value would be choosing for an option the product no longer
    // declares, which no control on its row could take back out.
    expect(product.variants.map((variant) => variant.option_values)).toEqual([
      [{ key: "color", value: "Ocean Blue" }],
      [{ key: "color", value: "Ocean Blue" }],
    ]);
  });

  it("says which variants removing an option would leave identical, and that publishing is refused", async () => {
    const [jacket] = READY_CONTENT.products;
    const variant = (sku: string, color: string, size: string) => ({
      ...jacket.variants[0],
      sku,
      option_values: [
        { key: "color", value: color },
        { key: "size", value: size },
      ],
    });
    currentContent = {
      ...READY_CONTENT,
      products: [
        {
          ...jacket,
          options: [
            { key: "color", name: "Color", values: ["Ocean Blue", "Charcoal"] },
            { key: "size", name: "Size", values: ["M", "L"] },
          ],
          variants: [
            variant("NS-ASJ-OB-M", "Ocean Blue", "M"),
            variant("NS-ASJ-OB-L", "Ocean Blue", "L"),
            variant("NS-ASJ-CH-M", "Charcoal", "M"),
            variant("NS-ASJ-CH-L", "Charcoal", "L"),
          ],
        },
      ],
    };
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    const options = within(await screen.findByRole("region", { name: "Options" }));

    await user.click(options.getByRole("button", { name: "Remove Size" }));

    expect(
      options.getByRole("group", { name: "Remove the option “Size”?" }),
    ).toHaveAccessibleDescription(
      /^4 variants choose a value of it and will lose it\. 4 variants would become identical in 2 groups — NS-ASJ-OB-M and NS-ASJ-OB-L \(Ocean Blue\); NS-ASJ-CH-M and NS-ASJ-CH-L \(Charcoal\) — and the shop is refused at publication until they differ again or one of them is removed\./,
    );
    // Each group is named by the values its variants would share.
    await user.click(
      within(options.getByRole("group", { name: "Remove the option “Size”?" })).getByRole(
        "button",
        { name: "Keep it" },
      ),
    );
    await user.click(options.getByRole("button", { name: "Remove Color" }));
    expect(options.getByRole("group", { name: "Remove the option “Color”?" })).toHaveTextContent(
      "NS-ASJ-OB-M and NS-ASJ-CH-M (M); NS-ASJ-OB-L and NS-ASJ-CH-L (L)",
    );
  });

  it("drops an armed row confirm when a discard lands, and when the product is renamed", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    const options = within(await screen.findByRole("region", { name: "Options" }));
    const media = within(screen.getByRole("region", { name: "Media references" }));

    // A discard re-reads the draft under the list, so what was armed is not about it any more.
    await user.type(screen.getByLabelText("Description"), " Taped seams.");
    await user.click(options.getByRole("button", { name: "Remove Size" }));
    expect(options.getByRole("group", { name: "Remove the option “Size”?" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() =>
      expect(options.queryByRole("group", { name: /Remove the option/ })).toBeNull(),
    );
    expect(options.getByRole("button", { name: "Remove Size" })).toBeVisible();

    // The handle is the only identity this page gives a product, so a rename drops it too.
    await user.click(media.getByRole("button", { name: "Remove media/alpine-shell.jpg" }));
    expect(media.getByRole("group", { name: /Remove the media reference/ })).toBeVisible();
    await user.type(screen.getByLabelText("Title"), " Pro");
    expect(media.queryByRole("group", { name: /Remove the media reference/ })).toBeNull();
  });

  it("stops saying a variant was removed once Discard has put it back", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    const variants = within(await screen.findByRole("region", { name: "Variants" }));

    await user.click(variants.getByRole("button", { name: "Remove NS-ASJ-OB-L" }));
    await user.click(variants.getByRole("button", { name: "Remove it" }));
    expect(variants.getByText("Removed the variant NS-ASJ-OB-L from the draft.")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    await waitFor(() =>
      expect(variants.getByRole("button", { name: "Remove NS-ASJ-OB-L" })).toBeVisible(),
    );
    expect(variants.queryByText(/Removed the variant/)).toBeNull();
  });

  it("does not blame an option's removal for variants that were already identical", async () => {
    const [jacket] = READY_CONTENT.products;
    const variant = (sku: string, size: string) => ({
      ...jacket.variants[0],
      sku,
      option_values: [
        { key: "color", value: "Ocean Blue" },
        { key: "size", value: size },
      ],
    });
    currentContent = {
      ...READY_CONTENT,
      products: [
        {
          ...jacket,
          variants: [variant("NS-A", "M"), variant("NS-B", "M"), variant("NS-C", "L")],
        },
      ],
    };
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    const options = within(await screen.findByRole("region", { name: "Options" }));

    await user.click(options.getByRole("button", { name: "Remove Color" }));

    const confirm = options.getByRole("group", { name: "Remove the option “Color”?" });
    expect(confirm).toHaveTextContent(
      "NS-A and NS-B (Ocean Blue · M) are already identical, which the publish gate already refuses; removing this option does not change that.",
    );
    expect(confirm).not.toHaveTextContent("would become identical");
  });

  it("says when an option's removal adds a variant to a pair that is identical already", async () => {
    const [jacket] = READY_CONTENT.products;
    const variant = (sku: string, color: string, size: string) => ({
      ...jacket.variants[0],
      sku,
      option_values: [
        { key: "color", value: color },
        { key: "size", value: size },
      ],
    });
    currentContent = {
      ...READY_CONTENT,
      products: [
        {
          ...jacket,
          options: [
            { key: "color", name: "Color", values: ["Ocean Blue", "Charcoal"] },
            { key: "size", name: "Size", values: ["M"] },
          ],
          variants: [
            variant("NS-A", "Ocean Blue", "M"),
            variant("NS-B", "Ocean Blue", "M"),
            variant("NS-C", "Charcoal", "M"),
          ],
        },
      ],
    };
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    const options = within(await screen.findByRole("region", { name: "Options" }));

    await user.click(options.getByRole("button", { name: "Remove Color" }));

    const confirm = options.getByRole("group", { name: "Remove the option “Color”?" });
    // Named by what the pair shares today, and the removal blamed only for the variant it adds.
    expect(confirm).toHaveTextContent(
      "NS-A and NS-B (Ocean Blue · M) are already identical, which the publish gate already refuses, and removing this option makes NS-C identical to them too; all three would share M.",
    );
    expect(confirm).not.toHaveTextContent("would become identical");
  });

  it("lists three variants made identical with commas, and names both pairs two merge from", async () => {
    const [jacket] = READY_CONTENT.products;
    const variant = (sku: string, color: string, size: string) => ({
      ...jacket.variants[0],
      sku,
      option_values: [
        { key: "color", value: color },
        { key: "size", value: size },
      ],
    });
    currentContent = {
      ...READY_CONTENT,
      products: [
        {
          ...jacket,
          options: [
            { key: "color", name: "Color", values: ["Ocean Blue", "Charcoal"] },
            { key: "size", name: "Size", values: ["S", "M", "L"] },
          ],
          variants: [
            variant("NS-A", "Ocean Blue", "S"),
            variant("NS-B", "Ocean Blue", "M"),
            variant("NS-C", "Ocean Blue", "L"),
            variant("NS-D", "Charcoal", "M"),
            variant("NS-E", "Charcoal", "M"),
            variant("NS-F", "Ocean Blue", "M"),
          ],
        },
      ],
    };
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    const options = within(await screen.findByRole("region", { name: "Options" }));

    // Without Size, every Ocean Blue variant chooses the same — B and F already did.
    await user.click(options.getByRole("button", { name: "Remove Size" }));
    const size = options.getByRole("group", { name: "Remove the option “Size”?" });
    expect(size).toHaveTextContent(
      "NS-B and NS-F (Ocean Blue · M) are already identical, which the publish gate already refuses, and removing this option makes NS-A and NS-C identical to them too; all four would share Ocean Blue.",
    );
    await user.click(within(size).getByRole("button", { name: "Keep it" }));

    // Without Color, D and E (already a pair) and B and F (another) all choose M.
    await user.click(options.getByRole("button", { name: "Remove Color" }));
    expect(options.getByRole("group", { name: "Remove the option “Color”?" })).toHaveTextContent(
      "NS-B and NS-F (Ocean Blue · M); NS-D and NS-E (Charcoal · M) are each already identical, which the publish gate already refuses, and removing this option makes them identical to one another; all four would share M.",
    );
  });

  it("names a variant that joins two identical pairs, and what all of them would share", async () => {
    const [jacket] = READY_CONTENT.products;
    const variant = (sku: string, size: string) => ({
      ...jacket.variants[0],
      sku,
      option_values: [
        { key: "color", value: "Ocean Blue" },
        { key: "size", value: size },
      ],
    });
    currentContent = {
      ...READY_CONTENT,
      products: [
        {
          ...jacket,
          options: [
            { key: "color", name: "Color", values: ["Ocean Blue"] },
            { key: "size", name: "Size", values: ["S", "M", "L"] },
          ],
          variants: [
            variant("NS-A", "M"),
            variant("NS-B", "M"),
            variant("NS-C", "L"),
            variant("NS-D", "L"),
            variant("NS-E", "S"),
          ],
        },
      ],
    };
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    const options = within(await screen.findByRole("region", { name: "Options" }));

    await user.click(options.getByRole("button", { name: "Remove Size" }));

    expect(options.getByRole("group", { name: "Remove the option “Size”?" })).toHaveTextContent(
      "NS-A and NS-B (Ocean Blue · M); NS-C and NS-D (Ocean Blue · L) are each already identical, which the publish gate already refuses, and removing this option makes them and NS-E identical to one another; all five would share Ocean Blue.",
    );
  });

  it("writes an identical part with no values the way a new group with none is written", async () => {
    const [jacket] = READY_CONTENT.products;
    const variant = (sku: string, values: { key: string; value: string }[]) => ({
      ...jacket.variants[0],
      sku,
      option_values: values,
    });
    currentContent = {
      ...READY_CONTENT,
      products: [
        {
          ...jacket,
          options: [{ key: "size", name: "Size", values: ["M"] }],
          // Two variants that choose nothing yet — already identical — and one choosing M.
          variants: [
            variant("NS-A", []),
            variant("NS-B", []),
            variant("NS-C", [{ key: "size", value: "M" }]),
          ],
        },
      ],
    };
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    const options = within(await screen.findByRole("region", { name: "Options" }));

    await user.click(options.getByRole("button", { name: "Remove Size" }));

    expect(options.getByRole("group", { name: "Remove the option “Size”?" })).toHaveTextContent(
      "NS-A and NS-B (no option values) are already identical, which the publish gate already refuses, and removing this option makes NS-C identical to them too; none of them would have option values.",
    );
  });

  it("joins three variants the removal alone makes identical with commas", async () => {
    const [jacket] = READY_CONTENT.products;
    const variant = (sku: string, size: string) => ({
      ...jacket.variants[0],
      sku,
      option_values: [
        { key: "color", value: "Ocean Blue" },
        { key: "size", value: size },
      ],
    });
    currentContent = {
      ...READY_CONTENT,
      products: [
        {
          ...jacket,
          options: [
            { key: "color", name: "Color", values: ["Ocean Blue"] },
            { key: "size", name: "Size", values: ["S", "M", "L"] },
          ],
          variants: [variant("NS-A", "S"), variant("NS-B", "M"), variant("NS-C", "L")],
        },
      ],
    };
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    const options = within(await screen.findByRole("region", { name: "Options" }));

    await user.click(options.getByRole("button", { name: "Remove Size" }));

    expect(options.getByRole("group", { name: "Remove the option “Size”?" })).toHaveTextContent(
      "3 variants would become identical — NS-A, NS-B and NS-C (Ocean Blue) — and the shop is refused at publication",
    );
  });

  it("says when removing a guideline leaves the shop without one", async () => {
    currentContent = {
      ...READY_CONTENT,
      tone_of_voice_guidelines: [
        { ...READY_CONTENT.tone_of_voice_guidelines[0], is_default: false },
      ],
      default_tone_of_voice_id: null,
    };
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/setup/tone`);
    const tone = within(await screen.findByRole("region", { name: "Guidelines" }));

    await user.click(tone.getByRole("button", { name: "Remove Warm and precise" }));

    expect(
      tone.getByRole("group", { name: "Remove the guideline “Warm and precise”?" }),
    ).toHaveAccessibleDescription(
      /It is the shop's last tone-of-voice guideline, and a shop with none is refused at publication\./,
    );
  });

  it("removes on one press once the second press is turned off", async () => {
    window.localStorage.setItem(CONFIRM_KEY, "false");
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    const variants = within(await screen.findByRole("region", { name: "Variants" }));

    await user.click(variants.getByRole("button", { name: "Remove NS-ASJ-OB-L" }));
    expect(screen.queryByRole("group", { name: /Remove the variant/ })).toBeNull();
    expect(variants.queryByText("NS-ASJ-OB-L")).toBeNull();
    expect(variants.getByText("Removed the variant NS-ASJ-OB-L from the draft.")).toHaveFocus();
  });
});
