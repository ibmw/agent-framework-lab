import type {
  ShopDraftResponse,
  ShopListResponse,
  ShopPayloadSchema,
  ShopPreviewResponse,
  ShopVersionListResponse,
  ShopVersionResponse,
} from "@agent-lab/contracts";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { isValidElement } from "react";
import type { RouteObject } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PRODUCT_CATEGORY_RULE,
  PRODUCT_TITLE_RULE,
  productWithoutVariantRule,
  SHOP_NAME_RULE,
  SHOP_SLUG_DETAIL_RULE,
  TONE_DEFAULT_REMOVAL_RULE,
  TONE_NAME_RULE,
  TRANSIT_WINDOW_RULE,
  VARIANT_SKU_RENAME_RULE,
  variantInStockWithoutInventoryRule,
  variantWithoutPriceRule,
} from "./lib/fieldRules";
import { shopDraftIsSavableAt, toPayload } from "./lib/shop";
import { markColourFor } from "./lib/shopLogo";
import { CREATE_ROUTES, tourAt } from "./lib/tours";
import { HELD_VALUE_REASON } from "./lib/unsavedWork";
import { routeTree } from "./routeTree";
import { UnsavedChangesGuard } from "./shell/UnsavedChangesGuard";
import { renderApp, wholeDescription } from "./test/app";
import { expectNotRefused, expectRefused, submitWithoutPressing } from "./test/refused";
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
  logo: null,
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
      logo: null,
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
    // Nor the key the workspace gives each product, which is the browser's alone (ADR 0061).
    if (products.some((product) => "ratings" in product || "key" in product)) {
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

  /**
   * A title may run to 200 characters, a handle to 64 (`MAX_SLUG_LENGTH`). A handle followed
   * from a long title uncut is a draft the domain refuses whole, over a field the operator
   * never typed.
   */
  it("follows a title longer than a handle may be with a handle the draft save accepts", async () => {
    const user = userEvent.setup();
    currentContent = EMPTY_CONTENT;
    const { router } = renderAt(`/shops/${SHOP_ID}/products`);
    await screen.findByRole("heading", { level: 1, name: "Products" });
    await user.click(screen.getByRole("button", { name: "New product" }));
    const card = within(await screen.findByRole("region", { name: "Details" }));

    const title = "Alpine Shell Jacket for Long Winter Traverses Across the High Glaciers";
    // Its slug is 70 characters; cut at 64 it ends mid-word, on "gl".
    await user.click(card.getByLabelText("Title"));
    await user.paste(title);

    const expected = "alpine-shell-jacket-for-long-winter-traverses-across-the-high-gl";
    expect(card.getByLabelText("Handle")).toHaveValue(expected);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/products/${expected}`),
    );

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));
    const [saved] = lastSaved().products;
    expect(saved.title).toBe(title);
    expect(saved.handle).toBe(expected);
    expect(saved.handle.length).toBeLessThanOrEqual(64);
    expect(saved.handle).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
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

/**
 * The sequences of `docs/history/2026-09-25-product-identity-reproductions.md` that need no
 * product Delete or Duplicate, as operator steps (ADR 0061). The page follows a product by the
 * key the workspace gave it, so its address follows the product back when a discard undoes a
 * rename, and nothing on it remounts on the way.
 */
describe("a product's identity across renames, saves and discards", () => {
  /** What the lab holds after a write: the payload, with the ratings it derives from reviews. */
  function contentOf(payload: ShopPayloadSchema): ShopDraftResponse["content"] {
    return {
      ...currentContent,
      ...payload,
      products: payload.products.map((product) => ({
        ...product,
        ratings: {
          review_count: product.reviews.length,
          average_rating:
            product.reviews.length === 0
              ? null
              : (
                  product.reviews.reduce((sum, review) => sum + review.rating, 0) /
                  product.reviews.length
                ).toFixed(1),
        },
      })),
      // A logo written without its colour is answered with the one the lab derives.
      logo:
        payload.logo == null
          ? null
          : {
              ...payload.logo,
              mark_colour: payload.logo.mark_colour ?? markColourFor(payload.logo.background),
            },
    };
  }

  /**
   * A lab that keeps what it is sent, so a discard reads back the last write that landed.
   * `hold` keeps each write in the air until it is released; `afterWrite` runs once it lands.
   */
  function keepingWrites({ hold = false, afterWrite = () => {} } = {}) {
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/draft`, async ({ request }) => {
        const body = (await request.json()) as { payload: ShopPayloadSchema };
        if (hold) {
          await released;
        }
        savedDrafts.push(body.payload);
        currentContent = contentOf(body.payload);
        afterWrite();
        return HttpResponse.json(draft(currentContent));
      }),
    );
    return { release };
  }

  function address(router: ReturnType<typeof renderAt>["router"]) {
    return router.state.location.pathname;
  }

  const products = `/shops/${SHOP_ID}/products`;

  async function openAlpine() {
    const rendered = renderAt(`${products}/alpine-shell-jacket`);
    await screen.findByRole("region", { name: "Details" });
    return rendered;
  }

  async function rename(user: ReturnType<typeof userEvent.setup>, handle: string) {
    const field = screen.getByLabelText("Handle");
    await user.clear(field);
    await user.type(field, handle);
  }

  async function settledAt(router: ReturnType<typeof renderAt>["router"], handle: string) {
    await waitFor(() => expect(address(router)).toBe(`${products}/${handle}`));
    expect(screen.queryByRole("heading", { name: "Product not found" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Alpine Shell Jacket" })).toBeVisible();
    expect(screen.getByLabelText("Handle")).toHaveValue(handle);
  }

  /** Opens the Size option's row and types into it, handing back the input typed in. */
  async function typeInSizeRow(user: ReturnType<typeof userEvent.setup>) {
    const options = within(screen.getByRole("region", { name: "Options" }));
    await user.click(options.getByRole("button", { name: "Edit Size" }));
    const input = within(options.getByRole("form", { name: "Edit Size" })).getByLabelText(
      "Option name",
    );
    await user.type(input, " typed");
    return input;
  }

  /**
   * Discard, pressed without taking focus from where the operator was typing. The button itself
   * leaves the header once the draft is clean, so a press that focused it would put focus on the
   * document whatever the page did; what is asserted is that the page itself takes nothing away.
   */
  function discardFromTheKeyboardFocus() {
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  }

  async function openRowSurvived(input: HTMLElement) {
    const options = within(screen.getByRole("region", { name: "Options" }));
    const open = within(options.getByRole("form", { name: "Edit Size" }));
    // The same element, not a new one with the same value: the row was never unmounted.
    expect(open.getByLabelText("Option name")).toBe(input);
    expect(input).toHaveValue("Size typed");
    expect(input).toHaveFocus();
  }

  it("R1: lands on the handle a save recorded when a later rename is discarded", async () => {
    const user = userEvent.setup();
    keepingWrites();
    const { router } = await openAlpine();

    await rename(user, "saved-one");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(screen.getByText("All changes saved")).toBeVisible());
    await rename(user, "second-name");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    await settledAt(router, "saved-one");
  });

  it("R2: follows the product back through two rename–discards", async () => {
    const user = userEvent.setup();
    const { router } = await openAlpine();

    await rename(user, "alpine-jacket");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await settledAt(router, "alpine-shell-jacket");
    await rename(user, "other-jacket");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    await settledAt(router, "alpine-shell-jacket");
  });

  // S0 was a debugging variant of this sequence and is covered by it (ADR 0061).
  it("R5: follows the product back after it was left and reopened from the catalog", async () => {
    const user = userEvent.setup();
    const { router } = renderAt(products);
    await user.click(await screen.findByRole("link", { name: "Alpine Shell Jacket" }));
    await screen.findByRole("region", { name: "Details" });

    await rename(user, "ren");
    await user.click(
      within(screen.getByLabelText("Shop workspace")).getByRole("link", { name: "Products" }),
    );
    await user.click(await screen.findByRole("link", { name: "Alpine Shell Jacket" }));
    await waitFor(() => expect(address(router)).toBe(`${products}/ren`));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    await settledAt(router, "alpine-shell-jacket");
  });

  it("R6: follows the product back when the save was refused", async () => {
    const user = userEvent.setup();
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/draft`, () =>
        HttpResponse.json(
          { code: "validation_error", message: "Request validation failed", request_id: "r" },
          { status: 422 },
        ),
      ),
    );
    const { router } = await openAlpine();

    await rename(user, "refused-one");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    await settledAt(router, "alpine-shell-jacket");
  });

  it("R7: lands on the saved handle when the title was typed in while the save was in flight", async () => {
    const user = userEvent.setup();
    const lab = keepingWrites({ hold: true });
    const { router } = await openAlpine();

    await rename(user, "saved-seven");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await user.type(screen.getByLabelText("Title"), " Pro");
    lab.release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    await settledAt(router, "saved-seven");
  });

  it("R8: lands on the saved handle when a second rename was made while the save was in flight", async () => {
    const user = userEvent.setup();
    const lab = keepingWrites({ hold: true });
    const { router } = await openAlpine();

    await rename(user, "saved-b");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await rename(user, "third-c");
    lab.release();
    await waitFor(() => expect(savedDrafts).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled());
    // The echo was declined — the draft was edited while the write was in the air.
    expect(address(router)).toBe(`${products}/third-c`);
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    await settledAt(router, "saved-b");
  });

  it("S5: lands on the saved handle when the preview read after a landed write failed", async () => {
    const user = userEvent.setup();
    let failPreview = false;
    keepingWrites({
      afterWrite: () => {
        failPreview = true;
      },
    });
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/draft/preview`, () => {
        if (failPreview) {
          failPreview = false;
          return HttpResponse.json(
            { code: "unavailable", message: "Preview failed", request_id: "r" },
            { status: 503 },
          );
        }
        return HttpResponse.json(currentPreview);
      }),
    );
    const { router } = await openAlpine();

    await rename(user, "saved-one");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(savedDrafts).toHaveLength(1);
    await rename(user, "second");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    await settledAt(router, "saved-one");
  });

  it("S2: keeps an open row, its typing and its focus through a plain discard", async () => {
    const user = userEvent.setup();
    const { router } = await openAlpine();

    await user.type(screen.getByLabelText("Description"), " Taped seams.");
    const input = await typeInSizeRow(user);
    discardFromTheKeyboardFocus();

    await waitFor(() =>
      expect(screen.getByLabelText("Description")).toHaveValue("Three-layer waterproof shell."),
    );
    expect(address(router)).toBe(`${products}/alpine-shell-jacket`);
    await openRowSurvived(input);
  });

  it("S3: keeps an open row, its typing and its focus through a discard that undoes a rename", async () => {
    const user = userEvent.setup();
    const { router } = await openAlpine();

    await rename(user, "ren");
    const input = await typeInSizeRow(user);
    discardFromTheKeyboardFocus();

    await settledAt(router, "alpine-shell-jacket");
    await openRowSurvived(input);
  });

  it("S10: keeps an open row, its typing and its focus through a discard that undoes a retitle", async () => {
    const user = userEvent.setup();
    const { router } = await openAlpine();

    await user.type(screen.getByLabelText("Title"), " Pro");
    await waitFor(() => expect(address(router)).toBe(`${products}/alpine-shell-jacket-pro`));
    const input = await typeInSizeRow(user);
    discardFromTheKeyboardFocus();

    await settledAt(router, "alpine-shell-jacket");
    expect(screen.getByLabelText("Title")).toHaveValue("Alpine Shell Jacket");
    await openRowSurvived(input);
  });

  it("S6: goes Back to the catalog after a discard that undid a rename", async () => {
    const user = userEvent.setup();
    const { router } = renderAt(products);
    await user.click(await screen.findByRole("link", { name: "Alpine Shell Jacket" }));
    await screen.findByRole("region", { name: "Details" });

    await rename(user, "ren");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await settledAt(router, "alpine-shell-jacket");
    await act(() => router.navigate(-1));

    expect(address(router)).toBe(products);
    expect(await screen.findByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  });

  it("S8: opens a product whose handle is not its title's slug as it is, clean", async () => {
    const user = userEvent.setup();
    const [jacket] = READY_CONTENT.products;
    currentContent = { ...READY_CONTENT, products: [{ ...jacket, handle: "custom-handle" }] };
    const { router } = renderAt(`${products}/custom-handle`);
    await screen.findByRole("region", { name: "Details" });

    expect(screen.getByLabelText("Handle")).toHaveValue("custom-handle");
    expect(address(router)).toBe(`${products}/custom-handle`);
    expect(screen.getByText("All changes saved")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Discard changes" })).toBeNull();

    // Nor does a title edit move it: the handle is not the title's, so it does not follow.
    await user.type(screen.getByLabelText("Title"), " Pro");
    expect(screen.getByLabelText("Handle")).toHaveValue("custom-handle");
    expect(address(router)).toBe(`${products}/custom-handle`);
  });

  it("leaves for the catalog when a discard takes back an unsaved product, never for the product holding its handle", async () => {
    const user = userEvent.setup();
    const { router } = await openAlpine();

    // Alpine gives up its handle in the draft, and a new product is titled onto it (the
    // reproductions' S7 without a Delete): the address now names the new product.
    await rename(user, "alpine-old");
    await user.click(
      within(screen.getByLabelText("Shop workspace")).getByRole("link", { name: "Products" }),
    );
    await user.click(await screen.findByRole("button", { name: "New product" }));
    await user.type(await screen.findByLabelText("Title"), "Alpine Shell Jacket");
    await waitFor(() => expect(address(router)).toBe(`${products}/alpine-shell-jacket`));

    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    // The new product was never saved, so the discard takes it; Alpine is back at the address
    // the page is standing on, and the page does not become Alpine's editor.
    await waitFor(() => expect(address(router)).toBe(products));
    expect(await screen.findByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  });

  /** Counts the router's updates, and stops a runaway before it can hang the suite. */
  function countingNavigations(router: ReturnType<typeof renderAt>["router"]) {
    let count = 0;
    router.subscribe(() => {
      count += 1;
      if (count > 40) {
        router.dispose();
      }
    });
    return () => count;
  }

  it.each(["#b", "?b", "/b", ".", ".."])(
    "writes no address from a handle the lab would refuse, like %s, and settles",
    async (typed) => {
      const user = userEvent.setup();
      const { router } = await openAlpine();
      const navigations = countingNavigations(router);
      const field = screen.getByLabelText("Handle");

      await user.clear(field);
      await user.type(field, typed);
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

      // The field keeps what was typed and refuses it; the draft, and so the address, keep
      // the handle the product had.
      expect(navigations()).toBe(0);
      expect(field).toHaveValue(typed);
      expect(field).toBeInvalid();
      expect(address(router)).toBe(`${products}/alpine-shell-jacket`);
      expect(screen.getByRole("heading", { level: 1, name: "Alpine Shell Jacket" })).toBeVisible();
    },
  );

  it("does not leave an open row behind when a handle like . is typed", async () => {
    const user = userEvent.setup();
    const { router } = await openAlpine();
    const input = await typeInSizeRow(user);
    const field = screen.getByLabelText("Handle");

    await user.clear(field);
    await user.type(field, ".");
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(address(router)).toBe(`${products}/alpine-shell-jacket`);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("Size typed");
  });

  /** A lab that keeps each write and answers it with `answer` — nothing, or an error. */
  function keepingWritesAnswering(answer: () => Response) {
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/draft`, async ({ request }) => {
        const body = (await request.json()) as { payload: ShopPayloadSchema };
        savedDrafts.push(body.payload);
        currentContent = contentOf(body.payload);
        return answer();
      }),
    );
  }

  const UNKNOWN_OUTCOMES: [string, () => Response][] = [
    ["the answer is lost", () => HttpResponse.error()],
    [
      "the lab answers 500",
      () =>
        HttpResponse.json(
          { code: "internal_error", message: "Internal error", request_id: "r" },
          { status: 500 },
        ),
    ],
  ];

  // With nothing held in the Handle field, and with a value it refused held there as the discard
  // lands: the page leaves either way, and a value held for a product that has left the draft
  // is nobody's unsaved work.
  it.each(
    UNKNOWN_OUTCOMES.flatMap(([outcome, answer]) =>
      [null, "Bad Value"].map((held) => [outcome, held, answer] as const),
    ),
  )(
    "leaves for the catalog when a write landed and %s, never onto another product (held: %s)",
    async (_, held, answer) => {
      const user = userEvent.setup();
      const [jacket] = READY_CONTENT.products;
      currentContent = {
        ...READY_CONTENT,
        products: [
          {
            ...jacket,
            handle: "x-first",
            title: "X first",
            variants: [],
            media: [],
            attributes: [],
            reviews: [],
            options: [],
            ratings: { review_count: 0, average_rating: null },
          },
          jacket,
        ],
      };
      // The lab keeps the write, and the browser cannot tell that it did.
      keepingWritesAnswering(answer);
      const rail = () => within(screen.getByLabelText("Shop workspace"));
      const { router } = renderAt(products);

      await user.click(await screen.findByRole("link", { name: "Alpine Shell Jacket" }));
      await screen.findByRole("region", { name: "Details" });
      await rename(user, "alpine-old");
      await user.click(rail().getByRole("link", { name: "Products" }));
      await user.click(await screen.findByRole("link", { name: "X first" }));
      await screen.findByRole("heading", { level: 1, name: "X first" });
      await rename(user, "alpine-shell-jacket");
      await user.click(rail().getByRole("link", { name: "Products" }));
      await user.click(await screen.findByRole("link", { name: "Alpine Shell Jacket" }));
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });
      await user.click(screen.getByRole("button", { name: "Save draft" }));
      expect(await screen.findByRole("alert")).toBeVisible();
      expect(savedDrafts).toHaveLength(1);
      if (held !== null) {
        await rename(user, held);
      }
      await user.click(screen.getByRole("button", { name: "Discard changes" }));

      // Whether the write landed is unknown, and the write moved both handles: no saved handle
      // is known to name its key, the page cannot tell which product is Alpine, and it leaves
      // rather than guess.
      await waitFor(() => expect(address(router)).toBe(products));
      expect(await screen.findByRole("heading", { level: 1, name: "Products" })).toBeVisible();
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it.each(UNKNOWN_OUTCOMES)(
    "stays on the product when a write that renamed nothing landed and %s",
    async (_, answer) => {
      const user = userEvent.setup();
      keepingWritesAnswering(answer);
      const { router } = await openAlpine();

      await user.type(screen.getByLabelText("Description"), " Taped seams.");
      await user.click(screen.getByRole("button", { name: "Save draft" }));
      expect(await screen.findByRole("alert")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Discard changes" }));

      // Landed or not, the lab holds Alpine under the handle it was sent under.
      await waitFor(() =>
        expect(screen.getByLabelText("Description")).toHaveValue(
          "Three-layer waterproof shell. Taped seams.",
        ),
      );
      await settledAt(router, "alpine-shell-jacket");
    },
  );

  it("keeps a handle that is not the title's through a cleared title after a write whose answer was lost", async () => {
    const user = userEvent.setup();
    const [jacket] = READY_CONTENT.products;
    currentContent = { ...READY_CONTENT, products: [{ ...jacket, handle: "custom-handle" }] };
    keepingWritesAnswering(() => HttpResponse.error());
    const { router } = renderAt(`${products}/custom-handle`);
    await screen.findByRole("region", { name: "Details" });

    await user.type(screen.getByLabelText("Description"), " Taped seams.");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Summit Parka");

    expect(screen.getByLabelText("Handle")).toHaveValue("custom-handle");
    expect(address(router)).toBe(`${products}/custom-handle`);
  });

  describe("a handle the field holds and the draft does not", () => {
    it.each(["Bad Value", "alpine-shell-jacket"])(
      "is nobody's unsaved work once a discard takes back the new product holding %s",
      async (typed) => {
        const user = userEvent.setup();
        const { router } = renderAt(products);
        await user.click(await screen.findByRole("button", { name: "New product" }));
        await screen.findByRole("region", { name: "Details" });

        await rename(user, typed);
        await user.click(screen.getByRole("button", { name: "Discard changes" }));

        await waitFor(() => expect(address(router)).toBe(products));
        expect(await screen.findByRole("heading", { level: 1, name: "Products" })).toBeVisible();
        expect(screen.queryByRole("dialog")).toBeNull();
      },
    );

    it.each([
      ["Summit Parka", /Summit Parka cannot be a handle/],
      ["-summit", /-summit cannot be a handle/],
      ["x".repeat(65), /cannot be a handle/],
    ])("refuses %s on the field, says why, and never says it is saved", async (typed, why) => {
      const user = userEvent.setup();
      await openAlpine();
      const field = screen.getByLabelText("Handle");

      await user.clear(field);
      await user.type(field, typed);

      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveAccessibleDescription(why);
      expect(field).not.toHaveAccessibleDescription(/Saved as/);
    });

    it("says a handle another product holds is taken, on the field", async () => {
      const user = userEvent.setup();
      const [jacket] = READY_CONTENT.products;
      currentContent = {
        ...READY_CONTENT,
        products: [
          jacket,
          { ...jacket, handle: "summit-parka", title: "Summit Parka", variants: [] },
        ],
      };
      await openAlpine();
      const field = screen.getByLabelText("Handle");

      await user.clear(field);
      await user.type(field, "summit-parka");

      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveAccessibleDescription(/summit-parka is already in the draft/);
      expect(field).not.toHaveAccessibleDescription(/Saved as/);
    });

    /** Alpine beside a second product, so one handle the field could hold is taken. */
    function besideSummitParka() {
      const [jacket] = READY_CONTENT.products;
      currentContent = {
        ...READY_CONTENT,
        products: [
          jacket,
          { ...jacket, handle: "summit-parka", title: "Summit Parka", variants: [] },
        ],
      };
    }

    const HELD = ["Summit Parka", "summit-parka"];

    it.each(HELD)("does not report the draft saved while the field holds %s", async (typed) => {
      const user = userEvent.setup();
      besideSummitParka();
      // A lab that answers the write with what it was sent, as the real one does.
      keepingWrites();
      await openAlpine();
      const field = screen.getByLabelText("Handle");

      await user.clear(field);
      await user.type(field, typed);

      expect(screen.queryByText("All changes saved")).toBeNull();
      await user.click(screen.getByRole("button", { name: "Save draft" }));
      await waitFor(() => expect(savedDrafts).toHaveLength(1));
      // What was written is the last handle the draft could take — whatever the keystrokes
      // before the refused one made of it — and the field still holds another.
      expect(lastSaved().products[0].handle).not.toBe(typed);
      expect(screen.queryByText("All changes saved")).toBeNull();
      expect(field).toHaveValue(typed);
    });

    it.each(HELD)("asks before leaving while the field holds %s", async (typed) => {
      const user = userEvent.setup();
      besideSummitParka();
      await openAlpine();
      const field = screen.getByLabelText("Handle");

      await user.clear(field);
      await user.type(field, typed);
      await user.click(
        within(screen.getByLabelText("Shop workspace")).getByRole("link", { name: "Orders" }),
      );

      const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
      expect(prompt).toHaveTextContent(typed);
    });
  });

  describe("a title that derives no handle", () => {
    function customHandle() {
      const [jacket] = READY_CONTENT.products;
      currentContent = { ...READY_CONTENT, products: [{ ...jacket, handle: "custom-handle" }] };
    }

    it("does not make a handle that is not the title's follow the next title", async () => {
      const user = userEvent.setup();
      customHandle();
      const { router } = renderAt(`${products}/custom-handle`);
      await screen.findByRole("region", { name: "Details" });

      await user.clear(screen.getByLabelText("Title"));
      await user.type(screen.getByLabelText("Title"), "Summit Parka");

      expect(screen.getByLabelText("Handle")).toHaveValue("custom-handle");
      expect(address(router)).toBe(`${products}/custom-handle`);
    });

    it("does not either through a title of punctuation alone", async () => {
      const user = userEvent.setup();
      customHandle();
      const { router } = renderAt(`${products}/custom-handle`);
      await screen.findByRole("region", { name: "Details" });

      await user.clear(screen.getByLabelText("Title"));
      await user.type(screen.getByLabelText("Title"), "!!!");
      await user.type(screen.getByLabelText("Title"), " Summit Parka");

      expect(screen.getByLabelText("Handle")).toHaveValue("custom-handle");
      expect(address(router)).toBe(`${products}/custom-handle`);
    });

    async function newProduct(user: ReturnType<typeof userEvent.setup>) {
      const rendered = renderAt(products);
      await user.click(await screen.findByRole("button", { name: "New product" }));
      await screen.findByRole("region", { name: "Details" });
      return rendered;
    }

    it("keeps a handle typed on a new product when its first title comes", async () => {
      const user = userEvent.setup();
      const { router } = await newProduct(user);

      await rename(user, "my-custom");
      await user.type(screen.getByLabelText("Title"), "Summit Parka");

      expect(screen.getByLabelText("Handle")).toHaveValue("my-custom");
      await waitFor(() => expect(address(router)).toBe(`${products}/my-custom`));
    });

    it("keeps a handle typed on a new product through a cleared and retyped title", async () => {
      const user = userEvent.setup();
      const { router } = await newProduct(user);

      await user.type(screen.getByLabelText("Title"), "Alpine");
      await rename(user, "my-custom");
      await user.clear(screen.getByLabelText("Title"));
      await user.type(screen.getByLabelText("Title"), "Summit Parka");

      expect(screen.getByLabelText("Handle")).toHaveValue("my-custom");
      await waitFor(() => expect(address(router)).toBe(`${products}/my-custom`));
    });

    it("follows a new product's title through a cleared title when the handle was the title's", async () => {
      const user = userEvent.setup();
      await newProduct(user);

      await user.type(screen.getByLabelText("Title"), "Alpine");
      await user.clear(screen.getByLabelText("Title"));
      await user.type(screen.getByLabelText("Title"), "Summit Parka");

      expect(screen.getByLabelText("Handle")).toHaveValue("summit-parka");
    });

    it("keeps the placeholder handle of a saved product whose title derives none", async () => {
      const user = userEvent.setup();
      const [jacket] = READY_CONTENT.products;
      currentContent = {
        ...READY_CONTENT,
        products: [{ ...jacket, handle: "new-product-2", title: "!!!" }],
      };
      const { router } = renderAt(`${products}/new-product-2`);
      await screen.findByRole("region", { name: "Details" });

      // The lab holds it, so the placeholder is its saved handle, not a new product's stand-in.
      await user.type(screen.getByLabelText("Title"), "Summit Parka");

      expect(screen.getByLabelText("Handle")).toHaveValue("new-product-2");
      expect(address(router)).toBe(`${products}/new-product-2`);
    });

    it("forgets what the last title edit made of the handle when a discard lands", async () => {
      const user = userEvent.setup();
      const [jacket] = READY_CONTENT.products;
      // Saved with a title that derives no handle, under a handle that is not its title's.
      currentContent = {
        ...READY_CONTENT,
        products: [{ ...jacket, handle: "summit", title: "!!!" }],
      };
      renderAt(`${products}/summit`);
      await screen.findByRole("region", { name: "Details" });
      const title = () => screen.getByLabelText("Title");

      // "Summit " makes the handle the title's, and clearing the title from there leaves the
      // page remembering `summit` as the handle that followed it.
      await user.clear(title());
      await user.type(title(), "Summit ");
      await user.clear(title());
      await user.click(screen.getByRole("button", { name: "Discard changes" }));
      await waitFor(() => expect(title()).toHaveValue("!!!"));
      await user.type(title(), "Parka");

      // The lab's `summit` was never this title's; what the page remembered was about the draft
      // the discard threw away.
      expect(screen.getByLabelText("Handle")).toHaveValue("summit");
    });

    it("still gives a new product a handle from its first title", async () => {
      const user = userEvent.setup();
      const { router } = renderAt(products);
      await user.click(await screen.findByRole("button", { name: "New product" }));

      await user.type(await screen.findByLabelText("Title"), "Summit Parka");

      expect(screen.getByLabelText("Handle")).toHaveValue("summit-parka");
      await waitFor(() => expect(address(router)).toBe(`${products}/summit-parka`));
    });
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
    expectRefused(publish, /Save the draft first — publishing freezes the saved draft/);
    // Scoped to the card, which is the one place the publish gate's refusal is rendered.
    expect(
      within(screen.getByRole("region", { name: "Versions of this shop" })).getByText(
        /Save the draft first — publishing freezes the saved draft/,
      ),
    ).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expectNotRefused(screen.getByRole("button", { name: "Review 1 change & publish" })),
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

    expectRefused(
      await screen.findByRole("button", { name: "Publish v2" }),
      /there is nothing new to freeze/,
    );
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
    // field: the domain requires at least one and the form never builds a draft without it —
    // and it says so beside the button now, rather than going quiet (ADR 0063).
    expectRefused(
      options.getByRole("button", { name: "Add option" }),
      "An option needs at least one value before a variant can choose it.",
    );
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

describe("a shop's logo, on Shop details", () => {
  function badgeOf(region: HTMLElement): HTMLElement {
    return region.querySelector("[data-shop-badge]") as HTMLElement;
  }

  it("opens on the monogram, takes a mark, a background and a colour, and saves all three", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/setup/identity`);

    const region = await screen.findByRole("region", { name: "Logo" });
    const logo = within(region);
    const marks = within(logo.getByRole("group", { name: "Mark" }));
    const backgrounds = within(logo.getByRole("group", { name: "Background" }));
    const colours = within(logo.getByRole("group", { name: "Mark colour" }));
    expect(
      marks.getByRole("radio", { name: "Monogram — the first letters of the name" }),
    ).toBeChecked();
    // No logo: nothing chosen, and the initials on the lab's own ground.
    expect(
      backgrounds.getAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked),
    ).toEqual([]);
    expect(colours.getAllByRole("radio").map((radio) => radio.closest("label")?.title)).toEqual([
      "White",
      "Ink",
    ]);
    expect(
      colours.getAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked),
    ).toEqual([]);
    expect(badgeOf(region)).toHaveTextContent(/^NO$/);

    await user.click(marks.getByRole("radio", { name: "Compass" }));
    // A mark lands on the prototype's Pine, in the colour that reads there.
    expect(backgrounds.getByRole("radio", { name: "Pine" })).toBeChecked();
    expect(colours.getByRole("radio", { name: "White" })).toBeChecked();
    expect(logo.getByRole("group", { name: "Mark colour" })).not.toHaveAccessibleDescription(
      /Hard to read/,
    );

    await user.click(backgrounds.getByRole("radio", { name: "Stone" }));
    // The colour stays what it was; white on Stone is 1.16:1, so the group says so.
    expect(colours.getByRole("radio", { name: "White" })).toBeChecked();
    expect(logo.getByRole("group", { name: "Mark colour" })).toHaveAccessibleDescription(
      "What the icon or the letters are drawn in. Hard to read against that background. Try the other one.",
    );
    expect(badgeOf(region)).toHaveStyle({ backgroundColor: "#eceef0", color: "#ffffff" });

    await user.click(colours.getByRole("radio", { name: "Ink" }));
    expect(logo.queryByText("Hard to read against that background. Try the other one.")).toBeNull();
    expect(badgeOf(region)).toHaveStyle({ backgroundColor: "#eceef0", color: "#16332d" });
    await user.click(colours.getByRole("radio", { name: "White" }));
    expect(
      logo.getByText("Hard to read against that background. Try the other one."),
    ).toBeVisible();

    // A warning, not a refusal: the draft saves the pair as chosen.
    const save = screen.getByRole("button", { name: "Save draft" });
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(savedDrafts).toHaveLength(1));
    expect(lastSaved().logo).toEqual({
      mark: "compass",
      background: "stone",
      mark_colour: "white",
    });
  });

  it("colours the monogram, on Brick, as the prototype draws it", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/setup/identity`);

    const region = await screen.findByRole("region", { name: "Logo" });
    const logo = within(region);
    await user.click(logo.getByRole("radio", { name: "Brick" }));

    expect(
      logo.getByRole("radio", { name: "Monogram — the first letters of the name" }),
    ).toBeChecked();
    expect(logo.getByRole("radio", { name: "White" })).toBeChecked();
    expect(badgeOf(region)).toHaveTextContent(/^NO$/);
    expect(badgeOf(region)).toHaveStyle({ backgroundColor: "#9d3028", color: "#ffffff" });

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));
    expect(lastSaved().logo).toEqual({ mark: null, background: "brick", mark_colour: "white" });
  });

  it("sends a v2 logo back exactly as answered when Products saves, so the lab keeps it", async () => {
    // The lab keeps a v2 logo whose derived colour comes back unchanged (ADR 0070); the
    // workspace's part is to send back what it was answered, and nothing else for the logo.
    const answered = { mark: "compass", background: "ochre", mark_colour: "ink" } as const;
    currentContent = { ...currentContent, logo: answered };
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products`);
    await screen.findByRole("heading", { level: 1, name: "Products" });
    await user.click(screen.getByRole("button", { name: "New product" }));
    const card = within(await screen.findByRole("region", { name: "Details" }));
    await user.click(card.getByLabelText("Title"));
    await user.paste("Trail Flask");

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));
    expect(lastSaved().logo).toEqual(answered);
    expect(lastSaved().products.map((product) => product.title)).toContain("Trail Flask");
  });

  it("opens a logo stored before the colour was chosen on the colour the lab derived", async () => {
    // A v2 logo on Ochre is answered with the derived ink, and the card shows exactly that.
    currentContent = {
      ...currentContent,
      logo: { mark: "anchor", background: "ochre", mark_colour: "ink" },
    };
    renderAt(`/shops/${SHOP_ID}/setup/identity`);

    const region = await screen.findByRole("region", { name: "Logo" });
    const logo = within(region);
    expect(logo.getByRole("radio", { name: "Anchor" })).toBeChecked();
    expect(logo.getByRole("radio", { name: "Ochre" })).toBeChecked();
    expect(logo.getByRole("radio", { name: "Ink" })).toBeChecked();
    expect(logo.getByRole("radio", { name: "White" })).not.toBeChecked();
    expect(badgeOf(region)).toHaveStyle({ backgroundColor: "#a8802a", color: "#16332d" });
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
    const save = variants.getByRole("button", { name: "Save NS-ASJ-OB-M" });
    expectRefused(save, "NS-ASJ-OB-L is already in the draft.");
    // Reachable, and a press that does nothing: the row stays open on what was typed.
    await user.click(save);
    expect(variants.getByLabelText("SKU for NS-ASJ-OB-M")).toHaveValue("NS-ASJ-OB-L");
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
    expectRefused(
      variants.getByRole("button", { name: "Save NS-ASJ-OB-M" }),
      VARIANT_SKU_RENAME_RULE,
    );
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
    // Save is refused by that same line, not by a second copy of it.
    expectRefused(
      open.getByRole("button", { name: "Save media/alpine-shell.jpg" }),
      /media\/alpine-charcoal\.jpg is already a media reference of this product/,
    );
    expect(
      open.getAllByText(/media\/alpine-charcoal\.jpg is already a media reference/),
    ).toHaveLength(1);
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

  it("refuses a media row with no reference, and an option row with no value, saying why", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    const options = within(await screen.findByRole("region", { name: "Options" }));
    await user.click(options.getByRole("button", { name: "Edit Size" }));
    const openOption = within(options.getByRole("form", { name: "Edit Size" }));
    const values = openOption
      .getAllByRole("button", { name: /^Remove / })
      .map((button) => button.getAttribute("aria-label") ?? button.textContent ?? "");
    for (const name of values) {
      await user.click(openOption.getByRole("button", { name }));
      const confirm = openOption.queryByRole("button", { name: "Remove it" });
      if (confirm) {
        await user.click(confirm);
      }
    }
    expectRefused(
      options.getByRole("button", { name: "Save Size" }),
      "An option needs at least one value before a variant can choose it.",
    );
    await user.click(options.getByRole("button", { name: "Cancel editing Size" }));

    const media = within(screen.getByRole("region", { name: "Media references" }));
    const [edit] = media.getAllByRole("button", { name: /^Edit / });
    const entry = (edit.getAttribute("aria-label") ?? "").replace(/^Edit /, "");
    await user.click(edit);
    const open = within(media.getByRole("form", { name: `Edit ${entry}` }));
    await user.clear(open.getByLabelText("Reference"));
    const save = open.getByRole("button", { name: `Save ${entry}` });
    expectRefused(save, "A media entry needs a reference.");
    await user.click(save);
    expect(open.getByLabelText("Reference")).toHaveValue("");
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
    expectRefused(blocked, TONE_NAME_RULE);
    expect(blocked).toHaveAttribute("title", TONE_NAME_RULE);
    expect(blocked).toHaveAccessibleDescription(TONE_NAME_RULE);

    // A whole form with no name is the case `required` on the Name input already refused.
    await user.type(tone.getByLabelText("ID"), "brief");
    await user.type(tone.getByLabelText("Guidance"), BRIEF.guidance);
    expectRefused(tone.getByRole("button", { name: "Add tone of voice" }), TONE_NAME_RULE);

    // This is the door the rule actually closes. `required` is satisfied by a space, so a
    // name of nothing but spaces used to reach the draft and come back a 422 from
    // `require_label`; the button refuses it here, in the same words.
    await user.type(tone.getByLabelText("Name"), " ");
    const padded = tone.getByRole("button", { name: "Add tone of voice" });
    expectRefused(padded, TONE_NAME_RULE);
    // Pressed anyway, it adds nothing: the draft is as it was.
    await user.click(padded);
    expect(screen.getByText("All changes saved")).toBeInTheDocument();

    await user.clear(tone.getByLabelText("Name"));
    await user.type(tone.getByLabelText("Name"), "Brief");
    const allowed = tone.getByRole("button", { name: "Add tone of voice" });
    expectNotRefused(allowed);
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
    expectRefused(save, TONE_NAME_RULE);
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
    expectNotRefused(tone.getByRole("button", { name: "Save Brief" }));
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

/**
 * The shop draft's refusals. Each rule is the lab's own, said under the control that breaks it, at the
 * validation weight, in that control's description, with the control marked invalid. The
 * transit window is a write the lab refuses, so the actions that would write it are refused
 * too; the two variant findings are the publish gate's, which stores the draft, so they are
 * said and refuse nothing.
 */
describe("the shop draft's refusals, said under their controls", () => {
  const STANDARD = {
    id: "standard",
    name: "Standard",
    carrier: "Nordic Post",
    min_transit_days: 2,
    max_transit_days: 5,
  };

  it("says why a maximum of 3 after a minimum of 5 is refused, and Add says it too", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/setup/identity`);
    const fulfilment = within(await screen.findByRole("region", { name: "Fulfilment methods" }));

    await user.type(fulfilment.getByLabelText("Name"), "Express");
    await user.type(fulfilment.getByLabelText("Carrier"), "Nordic Post");
    await user.clear(fulfilment.getByLabelText("Min days"));
    await user.type(fulfilment.getByLabelText("Min days"), "5");
    await user.clear(fulfilment.getByLabelText("Max days"));
    await user.type(fulfilment.getByLabelText("Max days"), "3");

    // The reason, under Max days, in its description, the control marked invalid.
    const max = fulfilment.getByLabelText("Max days");
    expect(max).toHaveAccessibleDescription(TRANSIT_WINDOW_RULE);
    expect(max).toHaveAttribute("aria-invalid", "true");
    const line = fulfilment.getByText(TRANSIT_WINDOW_RULE);
    expect(line).toBeVisible();
    expect(line).toHaveClass("text-[13px]", "font-semibold", "text-lab-error");
    expect(precedes(max, line)).toBe(true);
    expect(fulfilment.getByLabelText("Min days")).not.toHaveAttribute("aria-invalid");
    // The sentence wraps in Max days' narrow cell; the form's grid aligns its cells to the
    // start, so that line never stretches the row and grows the controls beside it.
    const addGrid = max.parentElement?.parentElement;
    expect(addGrid?.tagName).toBe("FORM");
    expect(addGrid).toHaveClass("grid", "items-start");

    // Add is refused for that reason, names that one line, and writes nothing when pressed,
    // nor when its form is submitted without the press.
    const add = fulfilment.getByRole("button", { name: "Add fulfilment method" });
    expectRefused(add, TRANSIT_WINDOW_RULE);
    expect(add.getAttribute("aria-describedby")?.split(" ")[0]).toBe(line.id);
    await user.click(add);
    await submitWithoutPressing(add);
    expect(fulfilment.queryByText(/Nordic Post ·/)).toBeNull();
    expect(fulfilment.getByText("No fulfilment method yet.")).toBeVisible();

    // A window of one day each way is the lab's, so equal bounds are not refused.
    await user.clear(fulfilment.getByLabelText("Max days"));
    await user.type(fulfilment.getByLabelText("Max days"), "5");
    expect(fulfilment.getByLabelText("Max days")).not.toHaveAttribute("aria-invalid");
    expect(fulfilment.queryByText(TRANSIT_WINDOW_RULE)).toBeNull();
    expectNotRefused(add);
    await user.click(add);
    expect(fulfilment.getByText("Nordic Post · 5–5 days")).toBeVisible();
    expect(fulfilment.queryByText("No fulfilment method yet.")).toBeNull();
  });

  it("refuses an open row's Save while its window is inverted, and saves it once it is not", async () => {
    const user = userEvent.setup();
    currentContent = { ...READY_CONTENT, fulfilment_methods: [STANDARD] };
    renderAt(`/shops/${SHOP_ID}/setup/identity`);

    const card = within(await screen.findByRole("region", { name: "Fulfilment methods" }));
    await user.click(card.getByRole("button", { name: "Edit Standard" }));
    const open = within(card.getByRole("form", { name: "Edit Standard" }));
    await user.clear(open.getByLabelText("Min days"));
    await user.type(open.getByLabelText("Min days"), "6");

    // The row keeps its stacked fields; the line is under Max days, which it describes.
    const max = open.getByLabelText("Max days");
    expect(max).toHaveAccessibleDescription(TRANSIT_WINDOW_RULE);
    // The row's grid holds Name and the fieldset's four cells, aligned to the start as the
    // add form's are, so the line under Max days grows none of its neighbours.
    const rowGrid = max.parentElement?.parentElement;
    expect(rowGrid).toContainElement(open.getByLabelText("Name"));
    expect(rowGrid).toHaveClass("grid", "items-start");
    expect(max).toHaveAttribute("aria-invalid", "true");
    const save = open.getByRole("button", { name: "Save Standard" });
    expectRefused(save, TRANSIT_WINDOW_RULE);
    expect(save.getAttribute("aria-describedby")?.split(" ")[0]).toBe(
      open.getByText(TRANSIT_WINDOW_RULE).id,
    );
    await user.click(save);
    await submitWithoutPressing(save);
    // Still open, and nothing reached the draft.
    expect(card.getByRole("form", { name: "Edit Standard" })).toBeVisible();
    expect(screen.getByText("All changes saved")).toBeVisible();

    await user.clear(open.getByLabelText("Max days"));
    await user.type(open.getByLabelText("Max days"), "8");
    expectNotRefused(open.getByRole("button", { name: "Save Standard" }));
    await user.click(open.getByRole("button", { name: "Save Standard" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));
    expect(lastSaved().fulfilment_methods).toStrictEqual([
      { ...STANDARD, min_transit_days: 6, max_transit_days: 8 },
    ]);
  });

  it("says an empty in-stock variant on its row, and still saves it", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    const variants = within(await screen.findByRole("region", { name: "Variants" }));
    const sentence = variantInStockWithoutInventoryRule("NS-ASJ-OB-M");
    const stock = variants.getByLabelText("Stock for NS-ASJ-OB-M");
    const availability = variants.getByLabelText("Availability for NS-ASJ-OB-M");
    expect(stock).not.toHaveAttribute("aria-invalid");
    expect(variants.queryByText(sentence)).toBeNull();

    await user.clear(stock);
    await user.type(stock, "0");

    // On the variant's own row, under its stock, at the validation weight.
    const line = variants.getByText(sentence);
    expect(line).toBeVisible();
    expect(line).toHaveClass("text-[13px]", "font-semibold", "text-lab-error");
    // Polite, not an alert: the lab refuses nothing here.
    expect(line).toHaveAttribute("aria-live", "polite");
    expect(line).not.toHaveAttribute("role");
    expect(line.closest("tr")).toBe(stock.closest("tr"));
    expect(line.closest("td")).toBe(stock.closest("td"));
    expect(stock).toHaveAttribute("aria-invalid", "true");
    expect(stock).toHaveAccessibleDescription(sentence);
    // Either control fixes it, so the availability select is described by the same line.
    expect(availability).toHaveAccessibleDescription(sentence);
    // The table keeps its six columns; the line is inside the Stock cell, not a row of its own.
    expect(within(line.closest("tr") as HTMLElement).getAllByRole("cell")).toHaveLength(6);

    // The gate stores it and refuses it at publication, so nothing here refuses the write.
    await user.click(variants.getByRole("button", { name: "Edit NS-ASJ-OB-M" }));
    expectNotRefused(variants.getByRole("button", { name: "Save NS-ASJ-OB-M" }));
    await user.click(variants.getByRole("button", { name: "Save NS-ASJ-OB-M" }));
    expectNotRefused(screen.getByRole("button", { name: "Save draft" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));
    expect(lastSaved().products[0].variants[0]).toMatchObject({
      sku: "NS-ASJ-OB-M",
      availability: "in_stock",
      stock_quantity: 0,
    });

    // Not in stock, an empty stock is what the variant says of itself.
    await user.selectOptions(availability, "backorder");
    expect(variants.queryByText(sentence)).toBeNull();
    expect(stock).not.toHaveAttribute("aria-invalid");
    // The same live region stays mounted while it has nothing to say, so the next time the
    // row breaks the rule it is a region a reader is already listening to.
    const quiet = document.getElementById(line.id);
    expect(quiet).toBe(line);
    expect(quiet).toBeEmptyDOMElement();
    expect(quiet).toHaveClass("sr-only");
    expect(quiet).toHaveAttribute("aria-live", "polite");
  });

  it("says a stock of zero only while in stock, for every availability", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    const variants = within(await screen.findByRole("region", { name: "Variants" }));
    const sentence = variantInStockWithoutInventoryRule("NS-ASJ-OB-M");
    const availability = variants.getByLabelText("Availability for NS-ASJ-OB-M");
    const stock = variants.getByLabelText("Stock for NS-ASJ-OB-M");
    for (const option of within(availability).getAllByRole("option") as HTMLOptionElement[]) {
      await user.selectOptions(availability, option.value);
      for (const quantity of ["0", "1"]) {
        await user.clear(stock);
        await user.type(stock, quantity);
        const expected = quantity === "0" && option.value === "in_stock";
        expect(variants.queryByText(sentence) !== null, `${option.value} × ${quantity}`).toBe(
          expected,
        );
        expect(stock.getAttribute("aria-invalid") === "true").toBe(expected);
      }
    }
  });

  it("says each unpriced variant under its price, whatever the product's status", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    const variants = within(await screen.findByRole("region", { name: "Variants" }));
    const status = screen.getByLabelText("Status");
    const unpriced = variants.getByLabelText("Price for NS-ASJ-OB-L");
    const priced = variants.getByLabelText("Price for NS-ASJ-OB-M");

    for (const option of within(status).getAllByRole("option") as HTMLOptionElement[]) {
      await user.selectOptions(status, option.value);
      // Per variant, as the gate raises it: the priced sibling does not excuse this one.
      const line = variants.getByText(variantWithoutPriceRule("NS-ASJ-OB-L"));
      expect(line, option.value).toBeVisible();
      expect(line).toHaveClass("text-[13px]", "font-semibold", "text-lab-error");
      expect(line.closest("td")).toBe(unpriced.closest("td"));
      expect(unpriced).toHaveAttribute("aria-invalid", "true");
      expect(unpriced).toHaveAccessibleDescription(
        new RegExp(`${variantWithoutPriceRule("NS-ASJ-OB-L")}$`),
      );
      expect(priced).not.toHaveAttribute("aria-invalid");
      expect(variants.queryByText(variantWithoutPriceRule("NS-ASJ-OB-M"))).toBeNull();
    }

    // Priced, it says nothing; emptied again, it says it again. Neither refuses the save.
    await user.type(unpriced, "249.00");
    expect(variants.queryByText(variantWithoutPriceRule("NS-ASJ-OB-L"))).toBeNull();
    expect(unpriced).not.toHaveAttribute("aria-invalid");
    await user.clear(priced);
    expect(variants.getByText(variantWithoutPriceRule("NS-ASJ-OB-M"))).toBeVisible();
    expectNotRefused(screen.getByRole("button", { name: "Save draft" }));
  });

  it("says a product with no variant on the Variants card, whatever its status", async () => {
    const user = userEvent.setup();
    currentContent = {
      ...READY_CONTENT,
      products: [{ ...READY_CONTENT.products[0], variants: [] }],
    };
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    const variants = within(await screen.findByRole("region", { name: "Variants" }));
    const status = screen.getByLabelText("Status");

    for (const option of within(status).getAllByRole("option") as HTMLOptionElement[]) {
      await user.selectOptions(status, option.value);
      const line = variants.getByText(productWithoutVariantRule("Alpine Shell Jacket"));
      expect(line, option.value).toBeVisible();
      expect(line).toHaveClass("text-[13px]", "font-semibold", "text-lab-error");
    }

    await user.click(variants.getByRole("button", { name: "Add variant" }));
    expect(variants.queryByText(productWithoutVariantRule("Alpine Shell Jacket"))).toBeNull();
    // The new variant has no price, so the row says that instead — the gate's next finding.
    expect(variants.getByText(/^variant .* is missing a price$/)).toBeVisible();
  });
});

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
      ["/lab/bench/:shopId/:experimentId", "ExperimentBenchRoute"],
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
      ["/shops/:shopId/products/:handle", "ProductEditorRoute"],
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

  it("gives a handle held on its field its own reason, not an open row's", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);

    // Never a handle the lab would store, so nothing of it reaches the draft.
    const handle = await screen.findByLabelText("Handle");
    await user.clear(handle);
    await user.type(handle, "Bad Value");
    await user.click(rail().getByRole("link", { name: "Orders" }));

    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(prompt).toHaveTextContent("The Handle field holds “Bad Value”");
    expect(prompt).toHaveTextContent(HELD_VALUE_REASON);
    expect(prompt).not.toHaveTextContent(/open for editing|row's own Save/);
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
    expectRefused(
      within(prompt).getByRole("button", { name: "Save and leave" }),
      /Stay, then press the row's own Save or Cancel/,
    );

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
    expectRefused(save, /Stay, then press the row's own Save or Cancel/);
    expect(save).toHaveAccessibleDescription(/Stay, then press the row's own Save or Cancel/);

    await user.click(within(prompt).getByRole("button", { name: "Discard and leave" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Lab settings" })).toBeVisible();
  });

  it("does nothing when the refused Save and leave is pressed: the page stays, and so does the row", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/setup/tone`);

    const tone = within(await screen.findByRole("region", { name: "Guidelines" }));
    await user.click(tone.getByRole("button", { name: "Edit Warm and precise" }));
    const open = within(tone.getByRole("form", { name: "Edit Warm and precise" }));
    await user.clear(open.getByLabelText("Guidance"));
    await user.type(open.getByLabelText("Guidance"), "Lead with the fact.");
    await user.click(screen.getByRole("link", { name: "Settings" }));

    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    const save = within(prompt).getByRole("button", { name: "Save and leave" });
    await user.click(save);
    save.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    // Nothing left: the navigation is still the one the prompt is asking about.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
    expect(screen.queryByRole("heading", { level: 1, name: "Lab settings" })).toBeNull();

    await user.click(within(prompt).getByRole("button", { name: "Stay on this page" }));
    expect(
      within(tone.getByRole("form", { name: "Edit Warm and precise" })).getByLabelText("Guidance"),
    ).toHaveValue("Lead with the fact.");
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

  it("offers the spellings the draft already uses on the editor's Category, and says so", async () => {
    const user = userEvent.setup();
    const [jacket] = READY_CONTENT.products;
    // The jacket was filed under a second spelling of a category the catalog already uses,
    // which is the correction this list exists for.
    currentContent = {
      ...READY_CONTENT,
      products: [
        { ...jacket, category: "jackets" },
        { ...jacket, handle: "storm-parka", title: "Storm Parka", category: "Jackets" },
        { ...jacket, handle: "day-pack", title: "Day Pack", category: "Packs" },
        { ...jacket, handle: "summit-pack", title: "Summit Pack", category: "Packs" },
      ],
    };
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

    const details = within(screen.getByRole("region", { name: "Details" }));
    const category = details.getByLabelText("Category");
    const offered = () =>
      [
        ...document.querySelectorAll(`#${CSS.escape(category.getAttribute("list") ?? "")} option`),
      ].map((option) => option.getAttribute("value"));
    // The other products' spellings, once each; the jacket's own is already in its field.
    expect(offered()).toEqual(["Jackets", "Packs"]);
    expect(category).toHaveAccessibleDescription(wholeDescription(PRODUCT_CATEGORY_RULE));

    await user.clear(category);
    await user.type(category, "Jackets");
    expect(category).toHaveValue("Jackets");
    // A list suggests and never refuses: a spelling nobody uses yet is still a category.
    await user.clear(category);
    await user.type(category, "Trousers");
    expect(category).toHaveValue("Trousers");
    expect(category).toBeValid();
    expect(offered()).toEqual(["Jackets", "Packs"]);
  });

  it("offers no category when no other product has one", async () => {
    renderAt(`/shops/${SHOP_ID}/products/alpine-shell-jacket`);
    await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

    // The draft's only product is the one being edited: there is nothing else to offer, and
    // the row still says what a category is for.
    const category = within(screen.getByRole("region", { name: "Details" })).getByLabelText(
      "Category",
    );
    expect(
      document.querySelectorAll(`#${CSS.escape(category.getAttribute("list") ?? "")} option`),
    ).toHaveLength(0);
    expect(category).toHaveAccessibleDescription(wholeDescription(PRODUCT_CATEGORY_RULE));
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
      wholeDescription(SHOP_SLUG_DETAIL_RULE),
    );
    // And it says the refusal the field makes, now that the field makes one.
    expect(identity.getByLabelText("Slug")).toHaveAccessibleDescription(
      /not one another shop already uses/i,
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
 * Shop details refuses a slug another shop already uses, off the listing the create page reads
 * (ADR 0069). The lab would take it — ADR 0013 leaves the slug unconstrained across shops — so
 * this is the create page's rule kept once the shop exists, and what has to be proven is that
 * the taken slug never reaches a write.
 */
describe("a shop's slug on Shop details", () => {
  const NORTHSTAR_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
  const alpenglow: ShopDraftResponse["content"] = {
    ...READY_CONTENT,
    identity: { ...READY_CONTENT.identity, name: "Alpenglow Gear", slug: "alpenglow" },
  };
  const bothShops: ShopListResponse = {
    shops: [
      { ...shops.shops[0], name: "Alpenglow Gear", slug: "alpenglow" },
      { ...shops.shops[0], shop_id: NORTHSTAR_ID, name: "Northstar Outfitters", slug: "northstar" },
    ],
  };

  async function openAlpenglowDetails() {
    currentContent = alpenglow;
    server.use(http.get("*/api/v1/shops", () => HttpResponse.json(bothShops)));
    renderAt(`/shops/${SHOP_ID}/setup/identity`);
    const identity = within(await screen.findByRole("region", { name: "Shop identity" }));
    const slug = identity.getByLabelText("Slug");
    await waitFor(() => expect(slug).toBeEnabled());
    return slug;
  }

  it("cannot save Northstar's slug onto Alpenglow, and says why on the field and on Save", async () => {
    const user = userEvent.setup();
    const slug = await openAlpenglowDetails();
    // Its own slug is not taken from it: the listing names this shop too, by its id.
    expect(slug).toHaveValue("alpenglow");
    expect(slug).not.toHaveAttribute("aria-invalid");

    await user.clear(slug);
    await user.type(slug, "northstar");

    const reason = "northstar is already used by another shop.";
    expect(slug).toHaveValue("northstar");
    expect(slug).toHaveAttribute("aria-invalid", "true");
    expect(slug).toHaveAccessibleDescription(new RegExp(reason.replaceAll(".", "\\.")));
    const save = screen.getByRole("button", { name: "Save draft" });
    expectRefused(save, reason);
    await user.click(save);
    expect(savedDrafts).toEqual([]);

    // A free slug is taken as it is typed, and Save writes it.
    await user.type(slug, "-alps");
    expect(slug).not.toHaveAttribute("aria-invalid");
    expectNotRefused(screen.getByRole("button", { name: "Save draft" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));
    expect(lastSaved().identity.slug).toBe("northstar-alps");
  });

  it("keeps a taken slug out of the draft, so no other page's Save can write it", async () => {
    const user = userEvent.setup();
    const slug = await openAlpenglowDetails();

    // Pasted, so no prefix of it — each free, and each written as it is typed — reaches the
    // draft on the way: the draft's slug is Alpenglow's until the end.
    await user.clear(slug);
    await user.paste("northstar");
    // Held on the field and not written. The draft is exactly as it was loaded, and the page
    // still counts the field as unsaved work: Save is there to be refused, and leaving asks.
    expectRefused(screen.getByRole("button", { name: "Save draft" }), "northstar is already");
    await user.click(
      within(screen.getByLabelText("Shop workspace")).getByRole("link", { name: "Orders" }),
    );
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(prompt).toHaveTextContent(
      "The Slug field holds “northstar”, which another shop already uses; this shop is still alpenglow.",
    );
    // The held value's own reason, not an open row's: there is no row here to Save or Cancel.
    expect(prompt).toHaveTextContent(HELD_VALUE_REASON);
    expect(prompt).not.toHaveTextContent(/open for editing|row's own Save/);
    expectRefused(
      within(prompt).getByRole("button", { name: "Save and leave" }),
      HELD_VALUE_REASON,
    );
    await user.click(within(prompt).getByRole("button", { name: "Stay on this page" }));

    // The name, edited beside it, is what a save from anywhere in the workspace would carry.
    const identity = within(screen.getByRole("region", { name: "Shop identity" }));
    await user.type(identity.getByLabelText("Name"), " Co");
    expectRefused(screen.getByRole("button", { name: "Save draft" }), "northstar is already");

    // Emptying and leaving hands back the slug the shop has.
    await user.clear(slug);
    await user.tab();
    expect(slug).toHaveValue("alpenglow");
    expectNotRefused(screen.getByRole("button", { name: "Save draft" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));
    expect(lastSaved().identity).toMatchObject({ name: "Alpenglow Gear Co", slug: "alpenglow" });
  });

  it("stores nothing the operator never meant when a taken slug is typed key by key", async () => {
    const user = userEvent.setup();
    const slug = await openAlpenglowDetails();
    const rail = within(screen.getByLabelText("Shop workspace"));

    // Every prefix of `northstar` is free and is written as it is typed; the last key makes it
    // Northstar's, and the draft goes back to the slug it had before the typing began.
    await user.clear(slug);
    await user.type(slug, "northstar");
    expect(slug).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeVisible();

    // The catalog can save the shop draft, so only the held slug is stranded by going there.
    await user.click(rail.getByRole("link", { name: "Products" }));
    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(prompt).toHaveTextContent("this shop is still alpenglow.");
    await user.click(within(prompt).getByRole("button", { name: "Discard and leave" }));
    await screen.findByRole("heading", { level: 1, name: "Products" });

    // Save from there writes the slug the shop had, never `northsta`.
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));
    expect(lastSaved().identity.slug).toBe("alpenglow");
  });

  it("hands back the slug the typing began from when the field is emptied, not the last prefix", async () => {
    const user = userEvent.setup();
    const slug = await openAlpenglowDetails();

    await user.clear(slug);
    await user.type(slug, "nor");
    await user.clear(slug);
    await user.tab();

    expect(slug).toHaveValue("alpenglow");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));
    expect(lastSaved().identity.slug).toBe("alpenglow");
  });

  it("keeps a slug typed and left as meant, and goes back only to it", async () => {
    const user = userEvent.setup();
    const slug = await openAlpenglowDetails();

    // A free slug typed and left is the operator's: the next run of typing starts from it.
    await user.clear(slug);
    await user.type(slug, "outdoor");
    await user.tab();
    await user.clear(slug);
    await user.type(slug, "northstar");
    expect(slug).toHaveAttribute("aria-invalid", "true");
    await user.clear(slug);
    await user.tab();

    expect(slug).toHaveValue("outdoor");
  });

  it("puts back the shop's slug when the header's Discard lands over a held one", async () => {
    const user = userEvent.setup();
    const slug = await openAlpenglowDetails();

    await user.clear(slug);
    await user.paste("northstar");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    await waitFor(() => expect(slug).toHaveValue("alpenglow"));
    expect(slug).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  });

  it("saves a shop that already shares its slug, since the rule refuses only a change to one", async () => {
    const user = userEvent.setup();
    // Written before this rule, or by a direct write: the lab holds it, and this page is not a
    // second, stricter gate over the Name edited beside it.
    currentContent = {
      ...alpenglow,
      identity: { ...alpenglow.identity, slug: "northstar" },
    };
    server.use(
      http.get("*/api/v1/shops", () =>
        HttpResponse.json({
          shops: [{ ...bothShops.shops[0], slug: "northstar" }, bothShops.shops[1]],
        }),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/setup/identity`);
    const identity = within(await screen.findByRole("region", { name: "Shop identity" }));
    const slug = identity.getByLabelText("Slug");
    await waitFor(() => expect(slug).toBeEnabled());
    expect(slug).not.toHaveAttribute("aria-invalid");

    await user.type(identity.getByLabelText("Name"), " Co");
    const save = screen.getByRole("button", { name: "Save draft" });
    expectNotRefused(save);
    await user.click(save);
    await waitFor(() => expect(savedDrafts).toHaveLength(1));
    expect(lastSaved().identity).toMatchObject({ name: "Alpenglow Gear Co", slug: "northstar" });
  });

  /**
   * A shop that shares `northstar` with Northstar, against a lab that keeps what is saved: the
   * draft write stores the payload, and the listing reports this shop's saved slug, as
   * `GET /shops` reads it off the saved draft.
   */
  async function openSharedShopDetails() {
    currentContent = { ...alpenglow, identity: { ...alpenglow.identity, slug: "northstar" } };
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/draft`, async ({ request }) => {
        const body = (await request.json()) as { payload: ShopPayloadSchema };
        savedDrafts.push(body.payload);
        currentContent = { ...currentContent, identity: body.payload.identity };
        return HttpResponse.json(draft(currentContent));
      }),
      http.get("*/api/v1/shops", () =>
        HttpResponse.json({
          shops: [
            { ...bothShops.shops[0], slug: currentContent.identity.slug },
            bothShops.shops[1],
          ],
        }),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/setup/identity`);
    const identity = within(await screen.findByRole("region", { name: "Shop identity" }));
    const slug = identity.getByLabelText("Slug");
    await waitFor(() => expect(slug).toBeEnabled());
    return slug;
  }

  it("refuses the shared slug back once the shop has saved its way off it", async () => {
    const user = userEvent.setup();
    const slug = await openSharedShopDetails();

    await user.clear(slug);
    await user.paste("outdoor");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedDrafts).toHaveLength(1));
    expect(lastSaved().identity.slug).toBe("outdoor");

    // The lab now holds `outdoor` for this shop, so `northstar` is a change to Northstar's.
    await user.clear(slug);
    await user.paste("northstar");
    await waitFor(() => expect(slug).toHaveAttribute("aria-invalid", "true"));
    expectRefused(screen.getByRole("button", { name: "Save draft" }), "northstar is already");
  });

  it("takes the shared slug back while the lab still holds it, whatever the page last read", async () => {
    const user = userEvent.setup();
    const slug = await openSharedShopDetails();
    const rail = within(screen.getByLabelText("Shop workspace"));

    // Typed, left, and not saved: the draft holds `outdoor`, the lab still `northstar`.
    await user.clear(slug);
    await user.type(slug, "outdoor");
    await user.tab();
    await user.click(rail.getByRole("link", { name: "Products" }));
    await screen.findByRole("heading", { level: 1, name: "Products" });
    await user.click(rail.getByRole("link", { name: "Shop details" }));
    const back = within(
      await screen.findByRole("region", { name: "Shop identity" }),
    ).getByLabelText("Slug");
    expect(back).toHaveValue("outdoor");

    await user.clear(back);
    await user.paste("northstar");
    expect(back).not.toHaveAttribute("aria-invalid");
    expectNotRefused(screen.getByRole("button", { name: "Save draft" }));
  });

  it("takes nothing while the listing is still being read, and says what it is waiting for", async () => {
    currentContent = alpenglow;
    server.use(http.get("*/api/v1/shops", () => new Promise<never>(() => {})));
    renderAt(`/shops/${SHOP_ID}/setup/identity`);
    const identity = within(await screen.findByRole("region", { name: "Shop identity" }));

    const slug = identity.getByLabelText("Slug");
    expect(slug).toBeDisabled();
    expect(slug).toHaveAccessibleDescription(/reading what is already used by another shop/i);
  });

  it("takes any slug when the listing failed, as the create page does, and says the read failed", async () => {
    const user = userEvent.setup();
    currentContent = alpenglow;
    server.use(
      http.get("*/api/v1/shops", () =>
        HttpResponse.json(
          { code: "internal_error", message: "The shop list is unavailable.", request_id: "r" },
          { status: 500 },
        ),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/setup/identity`);
    const identity = within(await screen.findByRole("region", { name: "Shop identity" }));
    const slug = identity.getByLabelText("Slug");
    await waitFor(() => expect(slug).toBeEnabled());

    await user.clear(slug);
    await user.type(slug, "northstar");
    expect(slug).not.toHaveAttribute("aria-invalid");
    expect(await screen.findByRole("alert")).toHaveTextContent("The shop list is unavailable.");
    expectNotRefused(screen.getByRole("button", { name: "Save draft" }));
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
              logo: null,
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

  it("drops an armed row confirm when a discard lands, and keeps it through a rename", async () => {
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

    // A rename is the same product, held by the same key (ADR 0061), so the confirm stays on
    // the row it was asked about.
    await user.click(media.getByRole("button", { name: "Remove media/alpine-shell.jpg" }));
    expect(media.getByRole("group", { name: /Remove the media reference/ })).toBeVisible();
    await user.type(screen.getByLabelText("Title"), " Pro");
    expect(screen.getByLabelText("Handle")).toHaveValue("alpine-shell-jacket-pro");
    expect(media.getByRole("group", { name: /Remove the media reference/ })).toBeVisible();
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

/**
 * A product's own Delete and Duplicate (ADR 0062), built on the key ADR 0061 gives a product.
 * The acceptance list is `docs/history/2026-09-25-product-identity-reproductions.md`: the
 * sequences its reviews found that need a Delete or a Duplicate — R3, R4, R9, S1, S4, S7, S9 —
 * as operator steps, and what the set-aside Delete and Duplicate tests asserted.
 */
describe("deleting and duplicating a product", () => {
  const CONFIRM_KEY = "agent-lab.confirm-before-delete";
  const ORDER_NAMING = "7d6c5b4a-3e2f-4a1b-9c8d-7e6f5a4b3c2d";
  const ORDER_ELSEWHERE = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
  const products = `/shops/${SHOP_ID}/products`;
  const CHECKING = "Checking which orders name one of its variants…";

  afterEach(() => window.localStorage.removeItem(CONFIRM_KEY));

  /** An order summary row and the order behind it, with one line per SKU given. */
  function order(orderId: string, reference: string, skus: string[]) {
    return {
      summary: {
        order_id: orderId,
        reference,
        customer_profile_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
        customer_display_name: "Maya Laurent",
        placed_at: "2026-08-21T09:30:00+00:00",
        payment_status: "paid",
        fulfilment_status: "unfulfilled",
        line_count: skus.length,
        total: { amount: "249.00", currency: "EUR" },
        updated_at: "2026-08-23T12:05:00+00:00",
      },
      detail: {
        order_id: orderId,
        shop_id: SHOP_ID,
        content: {
          reference,
          lines: skus.map((sku, index) => ({
            id: `line-${index}`,
            sku,
            product_handle: "some-product",
            title: "A product",
            variant_summary: "",
            unit_price: { amount: "249.00", currency: "EUR" },
            quantity: 1,
            line_total: { amount: "249.00", currency: "EUR" },
          })),
        },
        issues: [],
      },
    };
  }

  const naming = order(ORDER_NAMING, "NS-10482", ["NS-ASJ-OB-M"]);
  const elsewhere = order(ORDER_ELSEWHERE, "NS-10483", ["NS-TRAIL-SOCK-M"]);

  /**
   * NS-10482 names Alpine's `NS-ASJ-OB-M`; NS-10483 names another product's SKU. `hold` keeps
   * every order read in the air until it is released; `reads` counts them.
   */
  function serveOrders({ hold = false, naming: namingStatus = 200 } = {}) {
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reads: string[] = [];
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/orders`, () =>
        HttpResponse.json({ orders: [naming.summary, elsewhere.summary] }),
      ),
      http.get(`*/api/v1/shops/${SHOP_ID}/orders/:orderId`, async ({ params }) => {
        reads.push(String(params.orderId));
        if (hold) {
          await released;
        }
        if (params.orderId === ORDER_NAMING) {
          return namingStatus === 200
            ? HttpResponse.json(naming.detail)
            : HttpResponse.json(
                { code: "not_found", message: "No such order", request_id: "r" },
                { status: namingStatus },
              );
        }
        return HttpResponse.json(elsewhere.detail);
      }),
    );
    return { release, reads };
  }

  /** X first, then Alpine Shell Jacket — the reproductions' fixture. */
  function xFirstThenAlpine() {
    const [jacket] = READY_CONTENT.products;
    currentContent = {
      ...READY_CONTENT,
      products: [{ ...jacket, handle: "x-first", title: "X first", variants: [] }, jacket],
    };
  }

  function address(router: ReturnType<typeof renderAt>["router"]) {
    return router.state.location.pathname;
  }

  async function rename(user: ReturnType<typeof userEvent.setup>, handle: string) {
    const field = await screen.findByLabelText("Handle");
    await user.clear(field);
    await user.type(field, handle);
  }

  async function settledOn(
    router: ReturnType<typeof renderAt>["router"],
    handle: string,
    title: string,
  ) {
    await waitFor(() => expect(address(router)).toBe(`${products}/${handle}`));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(address(router)).toBe(`${products}/${handle}`);
    expect(screen.queryByRole("heading", { name: "Product not found" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeVisible();
    expect(screen.getByLabelText("Handle")).toHaveValue(handle);
  }

  function rail() {
    return within(screen.getByLabelText("Shop workspace"));
  }

  /** The reproductions' step 1: X first deleted on the catalog, on one press. */
  async function deleteXFirstOnTheCatalog(user: ReturnType<typeof userEvent.setup>) {
    window.localStorage.setItem(CONFIRM_KEY, "false");
    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: "Delete X first" }));
    expect(within(table).queryByRole("link", { name: "X first" })).toBeNull();
  }

  describe("Delete names the orders it would leave naming a gone variant", () => {
    it("names order NS-10482 and its variant before the second press, and the first can be walked back", async () => {
      // The slice's evidence.
      serveOrders();
      const user = userEvent.setup();
      const { router } = renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

      await user.click(screen.getByRole("button", { name: "Delete" }));

      const confirm = screen.getByRole("group", { name: "Delete “Alpine Shell Jacket”?" });
      expect(confirm).toHaveFocus();
      await waitFor(() =>
        expect(confirm).toHaveAccessibleDescription(
          /Order NS-10482 names one of its variants, NS-ASJ-OB-M\. That order keeps its line as frozen, and once the draft is saved is reported as unable to seed a sandbox, because the line names a SKU the catalog no longer has\./,
        ),
      );
      expect(confirm).toHaveAccessibleDescription(/^It leaves the catalog with its 2 variants/);
      expect(confirm).not.toHaveTextContent("NS-10483");

      await user.click(within(confirm).getByRole("button", { name: "Keep it" }));

      expect(screen.queryByRole("group", { name: /Delete “/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
      expect(address(router)).toBe(`${products}/alpine-shell-jacket`);
      // Walking back wrote nothing, so there is nothing to save.
      expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
      expect(screen.getByText("All changes saved")).toBeVisible();
    });

    it("walks the confirm back on Escape too", async () => {
      serveOrders();
      const user = userEvent.setup();
      renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

      await user.click(screen.getByRole("button", { name: "Delete" }));
      await user.keyboard("{Escape}");

      expect(screen.queryByRole("group", { name: /Delete “/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
    });

    it("withholds Delete it, and says why, until the orders are read", async () => {
      const lab = serveOrders({ hold: true });
      const user = userEvent.setup();
      renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

      await user.click(screen.getByRole("button", { name: "Delete" }));

      const deleteIt = screen.getByRole("button", { name: "Delete it" });
      expect(deleteIt).toBeDisabled();
      expect(deleteIt).toHaveAccessibleDescription(CHECKING);
      expect(screen.getByRole("group", { name: /Delete “/ })).toHaveTextContent(CHECKING);

      lab.release();

      await waitFor(() => expect(deleteIt).toBeEnabled());
      expect(screen.getByRole("group", { name: /Delete “/ })).toHaveTextContent(
        "Order NS-10482 names one of its variants",
      );
    });

    it("reads the orders once, at the first press, and not while the page renders", async () => {
      const lab = serveOrders();
      const user = userEvent.setup();
      renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });
      await user.type(screen.getByLabelText("Description"), " Taped.");
      expect(lab.reads).toEqual([]);

      await user.click(screen.getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Delete it" })).toBeEnabled());
      // Typing while the confirm stands re-renders it; it does not read again.
      await user.type(screen.getByLabelText("Description"), " Seams.");

      expect([...lab.reads].sort()).toEqual([ORDER_ELSEWHERE, ORDER_NAMING].sort());
    });

    it("lets the delete through when the orders cannot be read, and says so", async () => {
      serveOrders({ naming: 503 });
      const user = userEvent.setup();
      const { router } = renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

      await user.click(screen.getByRole("button", { name: "Delete" }));

      const confirm = screen.getByRole("group", { name: /Delete “/ });
      await waitFor(() =>
        expect(confirm).toHaveTextContent(
          "Whether an order names one of its variants could not be read",
        ),
      );
      const deleteIt = within(confirm).getByRole("button", { name: "Delete it" });
      expect(deleteIt).toBeEnabled();
      await user.click(deleteIt);
      await waitFor(() => expect(address(router)).toBe(products));
    });

    it("asks for no further order once one read has failed", async () => {
      // Eight orders: the first read fails at once, the five beside it are held in the air.
      const eight = Array.from({ length: 8 }, (_, index) =>
        order(`00000000-0000-4000-8000-00000000000${index}`, `NS-2000${index}`, ["NS-OTHER"]),
      );
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const reads: string[] = [];
      server.use(
        http.get(`*/api/v1/shops/${SHOP_ID}/orders`, () =>
          HttpResponse.json({ orders: eight.map((entry) => entry.summary) }),
        ),
        http.get(`*/api/v1/shops/${SHOP_ID}/orders/:orderId`, async ({ params }) => {
          reads.push(String(params.orderId));
          const found = eight.find((entry) => entry.summary.order_id === params.orderId);
          if (found === eight[0]) {
            return HttpResponse.json(
              { code: "unavailable", message: "Order service down", request_id: "r" },
              { status: 500 },
            );
          }
          await released;
          return HttpResponse.json(found?.detail);
        }),
      );
      const user = userEvent.setup();
      renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

      await user.click(screen.getByRole("button", { name: "Delete" }));
      await waitFor(() =>
        expect(screen.getByRole("group", { name: /Delete “/ })).toHaveTextContent(
          "could not be read",
        ),
      );
      release();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The six reads already in flight when the first failed, and none after them.
      expect(reads).toHaveLength(6);
    });

    it("skips an order the lab no longer has", async () => {
      serveOrders({ naming: 404 });
      const user = userEvent.setup();
      renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

      await user.click(screen.getByRole("button", { name: "Delete" }));

      const confirm = screen.getByRole("group", { name: /Delete “/ });
      await waitFor(() =>
        expect(confirm).toHaveTextContent("No order in this shop names one of its variants."),
      );
      expect(within(confirm).getByRole("button", { name: "Delete it" })).toBeEnabled();
    });

    it("says the product is the shop's last, and what names it is refused", async () => {
      serveOrders();
      const user = userEvent.setup();
      renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(screen.getByRole("group", { name: /Delete “/ })).toHaveAccessibleDescription(
        /with its 2 variants, and agents can no longer find it once the draft is published\. It is the shop's last product, and a shop that sells nothing is refused at publication\. A ticket opened from it is refused at publication once the draft is saved, because it names a product the catalog no longer has\. A scenario with a block bound to it is refused at publication once the draft is saved, because it names a product the catalog no longer has\. Nothing is written until you save the draft, and a published shop version keeps it\./,
      );
    });

    it("does not call a product the shop's last while another is left", async () => {
      serveOrders();
      xFirstThenAlpine();
      const user = userEvent.setup();
      renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

      await user.click(screen.getByRole("button", { name: "Delete" }));

      const confirm = screen.getByRole("group", { name: /Delete “/ });
      expect(confirm).not.toHaveAccessibleDescription(/shop's last product/);
      expect(confirm).toHaveAccessibleDescription(/A ticket opened from it is refused/);
    });
  });

  describe("Delete it", () => {
    it("takes the product out of the draft and lands on the catalog, saying so with focus there", async () => {
      serveOrders();
      const user = userEvent.setup();
      const { router } = renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

      await user.click(screen.getByRole("button", { name: "Delete" }));
      const deleteIt = screen.getByRole("button", { name: "Delete it" });
      await waitFor(() => expect(deleteIt).toBeEnabled());
      await user.click(deleteIt);

      // No unsaved-work prompt: the catalog saves the same draft (ADR 0051).
      await waitFor(() => expect(address(router)).toBe(products));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(await screen.findByRole("heading", { level: 1, name: "Products" })).toBeVisible();
      expect(screen.getByText(/This shop sells nothing yet/)).toBeVisible();
      const said = screen.getByText("Deleted “Alpine Shell Jacket” from the draft.");
      await waitFor(() => expect(said).toHaveFocus());

      await user.click(screen.getByRole("button", { name: "Save draft" }));
      await waitFor(() => expect(savedDrafts).toHaveLength(1));
      expect(lastSaved().products).toEqual([]);
    });

    it("takes an open row of the product with it, without asking about the row", async () => {
      window.localStorage.setItem(CONFIRM_KEY, "false");
      const user = userEvent.setup();
      const { router } = renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });
      const options = within(screen.getByRole("region", { name: "Options" }));
      await user.click(options.getByRole("button", { name: "Edit Size" }));

      await user.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => expect(address(router)).toBe(products));
      expect(screen.queryByRole("dialog")).toBeNull();
      await waitFor(() =>
        expect(screen.getByText("Deleted “Alpine Shell Jacket” from the draft.")).toHaveFocus(),
      );
    });

    it("does not say it again on a Back and a Forward", async () => {
      serveOrders();
      const user = userEvent.setup();
      const { router } = renderAt(`/shops/${SHOP_ID}`);
      await screen.findByRole("heading", { level: 1, name: "Overview" });
      await act(() => router.navigate(`${products}/alpine-shell-jacket`));
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

      await user.click(screen.getByRole("button", { name: "Delete" }));
      const deleteIt = screen.getByRole("button", { name: "Delete it" });
      await waitFor(() => expect(deleteIt).toBeEnabled());
      await user.click(deleteIt);
      await screen.findByText("Deleted “Alpine Shell Jacket” from the draft.");

      await act(() => router.navigate(-1));
      await screen.findByRole("heading", { level: 1, name: "Overview" });
      await act(() => router.navigate(1));
      expect(await screen.findByRole("heading", { level: 1, name: "Products" })).toBeVisible();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.queryByText(/Deleted “Alpine Shell Jacket”/)).toBeNull();
    });

    it("deletes on one press, and lands on the catalog, once the second press is turned off", async () => {
      const lab = serveOrders();
      window.localStorage.setItem(CONFIRM_KEY, "false");
      const user = userEvent.setup();
      const { router } = renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(screen.queryByRole("group", { name: /Delete “/ })).toBeNull();
      await waitFor(() => expect(address(router)).toBe(products));
      await waitFor(() =>
        expect(screen.getByText("Deleted “Alpine Shell Jacket” from the draft.")).toHaveFocus(),
      );
      // Nothing was asked first, so nothing was read to ask it.
      expect(lab.reads).toEqual([]);
    });
  });

  describe("the catalog's row actions", () => {
    it("replaces the row with the same confirm, and walks it back to the row's Delete", async () => {
      serveOrders();
      const user = userEvent.setup();
      renderAt(products);
      const table = await screen.findByRole("table");

      await user.click(within(table).getByRole("button", { name: "Delete Alpine Shell Jacket" }));

      const confirm = within(table).getByRole("group", { name: "Delete “Alpine Shell Jacket”?" });
      expect(within(table).queryByRole("link", { name: "Alpine Shell Jacket" })).toBeNull();
      expect(confirm).toHaveFocus();
      await waitFor(() =>
        expect(confirm).toHaveTextContent("Order NS-10482 names one of its variants, NS-ASJ-OB-M."),
      );
      expect(confirm).not.toHaveTextContent("NS-10483");

      await user.click(within(confirm).getByRole("button", { name: "Keep it" }));

      expect(within(table).getByRole("link", { name: "Alpine Shell Jacket" })).toBeVisible();
      expect(
        within(table).getByRole("button", { name: "Delete Alpine Shell Jacket" }),
      ).toHaveFocus();
      expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    });

    it("deletes on the second press and says so under the table, with focus there", async () => {
      serveOrders();
      xFirstThenAlpine();
      const user = userEvent.setup();
      renderAt(products);
      const table = await screen.findByRole("table");

      await user.click(within(table).getByRole("button", { name: "Delete Alpine Shell Jacket" }));
      const deleteIt = within(table).getByRole("button", { name: "Delete it" });
      await waitFor(() => expect(deleteIt).toBeEnabled());
      await user.click(deleteIt);

      expect(within(table).queryByRole("link", { name: "Alpine Shell Jacket" })).toBeNull();
      expect(screen.getByText("Deleted “Alpine Shell Jacket” from the draft.")).toHaveFocus();
      await user.click(screen.getByRole("button", { name: "Save draft" }));
      await waitFor(() => expect(savedDrafts).toHaveLength(1));
      expect(lastSaved().products.map((product) => product.handle)).toEqual(["x-first"]);
    });

    it("keeps saying a row's delete through a discard that does not bring the product back", async () => {
      // The delete is saved, but the answer is lost: the lab holds the draft without Alpine
      // while the page still counts it unsaved, so Discard re-reads a draft that lacks it.
      xFirstThenAlpine();
      window.localStorage.setItem(CONFIRM_KEY, "false");
      server.use(
        http.put(`*/api/v1/shops/${SHOP_ID}/draft`, async ({ request }) => {
          const body = (await request.json()) as { payload: ShopPayloadSchema };
          savedDrafts.push(body.payload);
          currentContent = {
            ...currentContent,
            products: currentContent.products.filter((product) =>
              body.payload.products.some((sent) => sent.handle === product.handle),
            ),
          };
          return HttpResponse.error();
        }),
      );
      const user = userEvent.setup();
      renderAt(products);
      const table = await screen.findByRole("table");

      await user.click(within(table).getByRole("button", { name: "Delete Alpine Shell Jacket" }));
      await user.click(screen.getByRole("button", { name: "Save draft" }));
      expect(await screen.findByRole("alert")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Discard changes" }));

      await waitFor(() => expect(screen.getByText("All changes saved")).toBeVisible());
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(within(table).queryByRole("link", { name: "Alpine Shell Jacket" })).toBeNull();
      expect(screen.getByText("Deleted “Alpine Shell Jacket” from the draft.")).toBeVisible();
    });

    it("duplicates from the row into the copy's editor", async () => {
      const user = userEvent.setup();
      const { router } = renderAt(products);
      const table = await screen.findByRole("table");

      await user.click(
        within(table).getByRole("button", { name: "Duplicate Alpine Shell Jacket" }),
      );

      await waitFor(() => expect(address(router)).toBe(`${products}/alpine-shell-jacket-copy`));
      expect(
        await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket (copy)" }),
      ).toBeVisible();
    });

    it("drops an armed row when a discard lands, though its product is back under its key", async () => {
      serveOrders();
      const user = userEvent.setup();
      renderAt(products);
      // Something to discard: a new product, left unnamed on the catalog.
      await user.click(await screen.findByRole("button", { name: "New product" }));
      await user.click(rail().getByRole("link", { name: "Products" }));
      const table = await screen.findByRole("table");

      await user.click(within(table).getByRole("button", { name: "Delete Alpine Shell Jacket" }));
      expect(within(table).getByRole("group", { name: /Delete “/ })).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Discard changes" }));

      await waitFor(() =>
        expect(within(table).queryByRole("group", { name: /Delete “/ })).toBeNull(),
      );
      expect(within(table).getByRole("link", { name: "Alpine Shell Jacket" })).toBeVisible();
      expect(within(table).queryByRole("link", { name: "Untitled product" })).toBeNull();
    });
  });

  describe("Duplicate copies everything authored, under names nothing holds, as a draft", () => {
    it("opens a draft copy with free handle and SKUs, and leaves the source as it was", async () => {
      const user = userEvent.setup();
      const { router } = renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

      await user.click(screen.getByRole("button", { name: "Duplicate" }));

      await waitFor(() => expect(address(router)).toBe(`${products}/alpine-shell-jacket-copy`));
      expect(
        await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket (copy)" }),
      ).toBeVisible();
      expect(screen.getByLabelText("Status")).toHaveValue("draft");

      await user.click(screen.getByRole("button", { name: "Save draft" }));
      await waitFor(() => expect(savedDrafts).toHaveLength(1));
      const [source, copy] = lastSaved().products;
      expect(source).toEqual(toPayload(READY_CONTENT).products[0]);
      expect(copy).toMatchObject({
        handle: "alpine-shell-jacket-copy",
        title: "Alpine Shell Jacket (copy)",
        status: "draft",
        description: source.description,
        category: source.category,
        options: source.options,
        media: source.media,
        attributes: source.attributes,
        reviews: source.reviews,
      });
      expect(copy.variants.map((variant) => variant.sku)).toEqual([
        "ALPINE-SHELL-JACKET-COPY-OCEAN-BLUE-M",
        "ALPINE-SHELL-JACKET-COPY-OCEAN-BLUE-L",
      ]);
      expect(copy.variants.map(({ sku: _sku, ...rest }) => rest)).toEqual(
        source.variants.map(({ sku: _sku, ...rest }) => rest),
      );
    });

    it("steps a second copy's handle and holds no SKU in the draft twice", async () => {
      const user = userEvent.setup();
      const { router } = renderAt(products);
      const table = await screen.findByRole("table");

      await user.click(
        within(table).getByRole("button", { name: "Duplicate Alpine Shell Jacket" }),
      );
      await waitFor(() => expect(address(router)).toBe(`${products}/alpine-shell-jacket-copy`));
      await user.click(rail().getByRole("link", { name: "Products" }));
      await user.click(
        within(await screen.findByRole("table")).getByRole("button", {
          name: "Duplicate Alpine Shell Jacket",
        }),
      );
      await waitFor(() => expect(address(router)).toBe(`${products}/alpine-shell-jacket-copy-2`));

      await user.click(screen.getByRole("button", { name: "Save draft" }));
      await waitFor(() => expect(savedDrafts).toHaveLength(1));
      const skus = lastSaved().products.flatMap((product) =>
        product.variants.map((variant) => variant.sku),
      );
      expect(new Set(skus).size).toBe(skus.length);
      expect(lastSaved().products.map((product) => product.handle)).toEqual([
        "alpine-shell-jacket",
        "alpine-shell-jacket-copy",
        "alpine-shell-jacket-copy-2",
      ]);
    });

    it("makes one copy of a double-click whose second click lands on the copy's own Duplicate", async () => {
      // In a browser the second click of a double-click lands on whatever is under the pointer
      // once the first has been answered — the copy's Duplicate, in the same place. jsdom sends
      // a double-click's second click to the element the first was on, which has gone, so the
      // second click is sent where a browser sends it, with the click count it carries.
      const user = userEvent.setup();
      const { router } = renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

      fireEvent.click(screen.getByRole("button", { name: "Duplicate" }), { detail: 1 });
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket (copy)" });
      fireEvent.click(screen.getByRole("button", { name: "Duplicate" }), { detail: 2 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(address(router)).toBe(`${products}/alpine-shell-jacket-copy`);
      await user.click(screen.getByRole("button", { name: "Save draft" }));
      await waitFor(() => expect(savedDrafts).toHaveLength(1));
      expect(lastSaved().products.map((product) => product.handle)).toEqual([
        "alpine-shell-jacket",
        "alpine-shell-jacket-copy",
      ]);
    });

    it("makes one copy of a row's double-click, whose second click lands on the copy's editor", async () => {
      const user = userEvent.setup();
      renderAt(products);
      const table = await screen.findByRole("table");

      fireEvent.click(
        within(table).getByRole("button", { name: "Duplicate Alpine Shell Jacket" }),
        {
          detail: 1,
        },
      );
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket (copy)" });
      fireEvent.click(screen.getByRole("button", { name: "Duplicate" }), { detail: 2 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      await user.click(screen.getByRole("button", { name: "Save draft" }));
      await waitFor(() => expect(savedDrafts).toHaveLength(1));
      expect(lastSaved().products).toHaveLength(2);
    });

    it("makes no second copy on a press after the unsaved-work prompt kept the operator on the source", async () => {
      const user = userEvent.setup();
      const { router } = renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });
      // An open row is work no other page can save, so leaving for the copy asks (ADR 0051).
      const options = within(screen.getByRole("region", { name: "Options" }));
      await user.click(options.getByRole("button", { name: "Edit Size" }));

      await user.click(screen.getByRole("button", { name: "Duplicate" }));
      await user.click(await screen.findByRole("button", { name: "Stay on this page" }));
      await user.click(screen.getByRole("button", { name: "Duplicate" }));
      // The press goes to the copy it already made, and asks again on the way.
      await user.click(await screen.findByRole("button", { name: "Stay on this page" }));

      expect(address(router)).toBe(`${products}/alpine-shell-jacket`);
      await user.click(screen.getByRole("button", { name: "Save draft" }));
      await waitFor(() => expect(savedDrafts).toHaveLength(1));
      expect(lastSaved().products.map((product) => product.handle)).toEqual([
        "alpine-shell-jacket",
        "alpine-shell-jacket-copy",
      ]);
    });

    it("carries no armed confirm onto the copy, nor back to the product it was on", async () => {
      serveOrders();
      const user = userEvent.setup();
      const { router } = renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

      // An option's confirm, then Duplicate: the copy opens with nothing asked about.
      const options = () => within(screen.getByRole("region", { name: "Options" }));
      await user.click(options().getByRole("button", { name: "Remove Size" }));
      await user.click(screen.getByRole("button", { name: "Duplicate" }));
      expect(
        await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket (copy)" }),
      ).toBeVisible();
      expect(screen.queryByRole("group", { name: /Remove the option/ })).toBeNull();
      expect(options().getByRole("button", { name: "Remove Size" })).toBeVisible();

      // The header's confirm, then Duplicate and back: neither is asked about.
      await act(() => router.navigate(-1));
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });
      await user.click(screen.getByRole("button", { name: "Delete" }));
      expect(screen.getByRole("group", { name: /Delete “Alpine Shell Jacket”/ })).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Duplicate" }));
      await screen.findByRole("heading", { level: 1, name: /\(copy\)/ });
      expect(screen.queryByRole("group", { name: /Delete “/ })).toBeNull();
      await act(() => router.navigate(-1));
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });
      expect(screen.queryByRole("group", { name: /Delete “/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Delete" })).not.toHaveFocus();
    });

    it("lands no late order read on the copy the operator went on to", async () => {
      const lab = serveOrders({ hold: true });
      const user = userEvent.setup();
      renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

      // Alpine's read is in the air when the operator goes on to its copy and asks there.
      await user.click(screen.getByRole("button", { name: "Delete" }));
      await user.click(screen.getByRole("button", { name: "Duplicate" }));
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket (copy)" });
      await user.click(screen.getByRole("button", { name: "Delete" }));
      const confirm = screen.getByRole("group", { name: "Delete “Alpine Shell Jacket (copy)”?" });
      lab.release();

      await waitFor(() =>
        expect(confirm).toHaveTextContent("No order in this shop names one of its variants."),
      );
      expect(confirm).not.toHaveTextContent("NS-10482");
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("the reproductions", () => {
    it("R3: a rename onto a deleted product's handle, then Discard, stays on the renamed product", async () => {
      xFirstThenAlpine();
      const user = userEvent.setup();
      const { router } = renderAt(products);
      await deleteXFirstOnTheCatalog(user);
      await user.click(screen.getByRole("link", { name: "Alpine Shell Jacket" }));
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

      await rename(user, "x-first");
      await waitFor(() => expect(address(router)).toBe(`${products}/x-first`));
      await user.click(screen.getByRole("button", { name: "Discard changes" }));

      await settledOn(router, "alpine-shell-jacket", "Alpine Shell Jacket");
    });

    it("R4: a Delete armed before the Discard is dropped by it", async () => {
      serveOrders();
      xFirstThenAlpine();
      const user = userEvent.setup();
      const { router } = renderAt(products);
      await deleteXFirstOnTheCatalog(user);
      await user.click(screen.getByRole("link", { name: "Alpine Shell Jacket" }));
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });
      await rename(user, "x-first");
      await waitFor(() => expect(address(router)).toBe(`${products}/x-first`));

      window.localStorage.setItem(CONFIRM_KEY, "true");
      await user.click(screen.getByRole("button", { name: "Delete" }));
      expect(screen.getByRole("group", { name: "Delete “Alpine Shell Jacket”?" })).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Discard changes" }));

      await settledOn(router, "alpine-shell-jacket", "Alpine Shell Jacket");
      expect(screen.queryByRole("group", { name: /Delete “/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Delete" })).toBeVisible();
    });

    it("S7: a new product titled onto a deleted one's handle, Delete armed, Discard: nothing is deleted", async () => {
      serveOrders();
      xFirstThenAlpine();
      const user = userEvent.setup();
      const { router } = renderAt(products);
      await deleteXFirstOnTheCatalog(user);
      await user.click(screen.getByRole("button", { name: "New product" }));
      await user.type(await screen.findByLabelText("Title"), "X first");
      await waitFor(() => expect(address(router)).toBe(`${products}/x-first`));

      window.localStorage.setItem(CONFIRM_KEY, "true");
      await user.click(screen.getByRole("button", { name: "Delete" }));
      expect(screen.getByRole("group", { name: "Delete “X first”?" })).toHaveAccessibleDescription(
        /^It leaves the catalog, and agents/,
      );
      await user.click(screen.getByRole("button", { name: "Discard changes" }));

      // The new product was never saved: its page leaves for the catalog, and its confirm goes
      // with it. X first is back, and there is no Delete it to press.
      await waitFor(() => expect(address(router)).toBe(products));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.queryByRole("group", { name: /Delete “/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Delete it" })).toBeNull();
      expect(screen.queryByText(/Deleted “/)).toBeNull();
      const table = screen.getByRole("table");
      expect(within(table).getByRole("link", { name: "X first" })).toBeVisible();
      expect(within(table).getByRole("link", { name: "Alpine Shell Jacket" })).toBeVisible();
      expect(screen.getByText("All changes saved")).toBeVisible();
    });

    it("S1: Alpine renamed onto a deleted product's handle and reopened, Delete armed, Discard: back on Alpine, nothing armed", async () => {
      serveOrders();
      xFirstThenAlpine();
      const user = userEvent.setup();
      const { router } = renderAt(products);
      await deleteXFirstOnTheCatalog(user);
      await user.click(screen.getByRole("link", { name: "Alpine Shell Jacket" }));
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });
      await rename(user, "x-first");
      await waitFor(() => expect(address(router)).toBe(`${products}/x-first`));
      await user.click(rail().getByRole("link", { name: "Products" }));
      await user.click(
        within(await screen.findByRole("table")).getByRole("link", { name: "Alpine Shell Jacket" }),
      );
      // Reopening derives nothing (S8): the page stays on the handle it was given.
      await settledOn(router, "x-first", "Alpine Shell Jacket");

      window.localStorage.setItem(CONFIRM_KEY, "true");
      await user.click(screen.getByRole("button", { name: "Delete" }));
      expect(screen.getByRole("group", { name: "Delete “Alpine Shell Jacket”?" })).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Discard changes" }));

      await settledOn(router, "alpine-shell-jacket", "Alpine Shell Jacket");
      expect(screen.queryByRole("group", { name: /Delete “/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Delete it" })).toBeNull();
    });

    it("R9: the catalog's Deleted notice clears once a Discard puts the product back", async () => {
      window.localStorage.setItem(CONFIRM_KEY, "false");
      const user = userEvent.setup();
      const { router } = renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });
      await user.type(screen.getByLabelText("Title"), " Pro");
      await waitFor(() => expect(address(router)).toBe(`${products}/alpine-shell-jacket-pro`));

      await user.click(screen.getByRole("button", { name: "Delete" }));
      await screen.findByRole("heading", { level: 1, name: "Products" });
      expect(
        await screen.findByText("Deleted “Alpine Shell Jacket Pro” from the draft."),
      ).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Discard changes" }));

      expect(await screen.findByRole("link", { name: "Alpine Shell Jacket" })).toBeVisible();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.queryByText(/Deleted “Alpine Shell Jacket/)).toBeNull();
    });

    it("R9, searched away: the notice clears for a product back in the draft that the view does not show", async () => {
      window.localStorage.setItem(CONFIRM_KEY, "false");
      const user = userEvent.setup();
      renderAt(products);
      const table = await screen.findByRole("table");
      await user.click(within(table).getByRole("button", { name: "Delete Alpine Shell Jacket" }));
      expect(screen.getByText("Deleted “Alpine Shell Jacket” from the draft.")).toBeVisible();

      await user.type(screen.getByRole("searchbox", { name: "Search products" }), "parka");
      await user.click(screen.getByRole("button", { name: "Discard changes" }));

      expect(await screen.findByText("No product matches this view.")).toBeVisible();
      await waitFor(() => expect(screen.queryByText(/Deleted “Alpine Shell Jacket”/)).toBeNull());
    });

    it("S4: Duplicate, then Discard, goes to the catalog rather than to a product not found", async () => {
      const user = userEvent.setup();
      const { router } = renderAt(`${products}/alpine-shell-jacket`);
      await screen.findByRole("heading", { level: 1, name: "Alpine Shell Jacket" });

      await user.click(screen.getByRole("button", { name: "Duplicate" }));
      await waitFor(() => expect(address(router)).toBe(`${products}/alpine-shell-jacket-copy`));
      await user.click(screen.getByRole("button", { name: "Discard changes" }));

      await waitFor(() => expect(address(router)).toBe(products));
      expect(await screen.findByRole("heading", { level: 1, name: "Products" })).toBeVisible();
      expect(screen.queryByRole("heading", { name: "Product not found" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Alpine Shell Jacket (copy)" })).toBeNull();
    });

    it("S9: jk renamed onto a deleted product's handle, reopened, renamed again, Discard: back on jk", async () => {
      const [jacket] = READY_CONTENT.products;
      currentContent = {
        ...READY_CONTENT,
        products: [
          { ...jacket, handle: "x-first", title: "X first", variants: [] },
          { ...jacket, handle: "jk", title: "jk", variants: [] },
        ],
      };
      const user = userEvent.setup();
      const { router } = renderAt(products);
      await deleteXFirstOnTheCatalog(user);
      await user.click(screen.getByRole("link", { name: "jk" }));
      await screen.findByRole("heading", { level: 1, name: "jk" });
      await rename(user, "x-first");
      await waitFor(() => expect(address(router)).toBe(`${products}/x-first`));
      await user.click(rail().getByRole("link", { name: "Products" }));
      await user.click(within(await screen.findByRole("table")).getByRole("link", { name: "jk" }));
      await settledOn(router, "x-first", "jk");

      await rename(user, "jk-two");
      await waitFor(() => expect(address(router)).toBe(`${products}/jk-two`));
      await user.click(screen.getByRole("button", { name: "Discard changes" }));

      await settledOn(router, "jk", "jk");
    });
  });
});
