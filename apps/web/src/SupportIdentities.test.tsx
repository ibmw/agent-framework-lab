import type {
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
  SupportIdentityDraftResponse,
  SupportIdentityListResponse,
  SupportIdentityPreviewResponse,
  SupportIdentityVersionResponse,
} from "@agent-lab/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "./App";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const IDENTITY_ID = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";

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

const IDENTITY_CONTENT: SupportIdentityDraftResponse["content"] = {
  role: {
    name: "Northstar tier 1",
    title: "Customer support representative",
    description: "Handles order and delivery questions.",
  },
  permissions: ["read_policies", "change_shipping_address"],
  guidance: [],
  escalation: { escalate_to: "", conditions: [] },
};

function identityPreview(
  overrides: Partial<SupportIdentityPreviewResponse> = {},
): SupportIdentityPreviewResponse {
  return {
    identity_id: IDENTITY_ID,
    publishable: false,
    issues: [
      {
        severity: "error",
        code: "order_mutation_without_read_orders",
        message: "change_shipping_address acts on an order the identity is not allowed to read",
        path: "permissions",
      },
    ],
    changes: [
      { kind: "added", path: "permissions.read_orders", description: "Granted read_orders" },
    ],
    content_fingerprint: "a".repeat(64),
    latest_published_version: null,
    next_version: 1,
    matches_latest_published: false,
    content: IDENTITY_CONTENT,
    ...overrides,
  };
}

const identities: SupportIdentityListResponse = {
  identities: [
    {
      identity_id: IDENTITY_ID,
      name: "Northstar tier 1",
      title: "Customer support representative",
      permission_count: 2,
      guidance_count: 0,
      updated_at: "2026-08-23T12:05:00+00:00",
      latest_published_version: null,
      published_version_count: 0,
    },
  ],
};

let currentIdentity = IDENTITY_CONTENT;
let currentPreview = identityPreview();
let savedPayloads: Array<Record<string, unknown>> = [];

const server = setupServer(
  http.get("*/api/v1/shops", () => HttpResponse.json({ shops: [] } satisfies ShopListResponse)),
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
  http.get("*/api/v1/support-identities", () => HttpResponse.json(identities)),
  http.get(`*/api/v1/support-identities/${IDENTITY_ID}/draft`, () =>
    HttpResponse.json({
      identity_id: IDENTITY_ID,
      lifecycle_state: "draft",
      content: currentIdentity,
      created_at: "2026-08-23T12:00:00+00:00",
      updated_at: "2026-08-23T12:05:00+00:00",
    } satisfies SupportIdentityDraftResponse),
  ),
  http.put(`*/api/v1/support-identities/${IDENTITY_ID}/draft`, async ({ request }) => {
    const body = (await request.json()) as { payload: Record<string, unknown> };
    savedPayloads.push(body.payload);
    currentIdentity = body.payload as typeof currentIdentity;
    return HttpResponse.json({
      identity_id: IDENTITY_ID,
      lifecycle_state: "draft",
      content: currentIdentity,
      created_at: "2026-08-23T12:00:00+00:00",
      updated_at: "2026-08-23T12:06:00+00:00",
    } satisfies SupportIdentityDraftResponse);
  }),
  http.get(`*/api/v1/support-identities/${IDENTITY_ID}/draft/preview`, () =>
    HttpResponse.json(currentPreview),
  ),
  http.post(`*/api/v1/support-identities/${IDENTITY_ID}/versions`, () => {
    currentPreview = identityPreview({
      publishable: true,
      issues: [],
      changes: [],
      latest_published_version: 1,
      next_version: 2,
      matches_latest_published: true,
    });
    return HttpResponse.json(
      {
        identity_id: IDENTITY_ID,
        lifecycle_state: "published",
        version: 1,
        content_fingerprint: "b".repeat(64),
        published_at: "2026-08-23T12:10:00+00:00",
        content: IDENTITY_CONTENT,
      } satisfies SupportIdentityVersionResponse,
      { status: 201 },
    );
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  currentIdentity = IDENTITY_CONTENT;
  currentPreview = identityPreview();
  savedPayloads = [];
});
afterAll(() => server.close());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("support identity workspace", () => {
  it("lists identities with their permission and publication state", async () => {
    renderAt(`/shops/${SHOP_ID}/support-identities`);

    expect(await screen.findByRole("heading", { name: "Support identities" })).toBeVisible();
    expect(await screen.findByRole("link", { name: "Northstar tier 1" })).toBeVisible();
    expect(screen.getByText("Never published")).toBeVisible();
  });

  it("puts each field's hint in that control's accessible description", async () => {
    renderAt(`/shops/${SHOP_ID}/support-identities`);

    const card = within(await screen.findByRole("region", { name: "New support identity" }));
    expect(card.getByLabelText("Name")).toHaveAccessibleDescription(
      /how the identity is listed.*adopt a published identity/i,
    );
    expect(card.getByLabelText("Role title")).toHaveAccessibleDescription(
      /the role the support agent presents as/i,
    );
  });

  it("shows why an order mutation without read access blocks publication", async () => {
    renderAt(`/shops/${SHOP_ID}/support-identities/${IDENTITY_ID}`);

    expect(await screen.findByRole("heading", { name: "Northstar tier 1" })).toBeVisible();
    expect(screen.getByText(/acts on an order the identity is not allowed to read/)).toBeVisible();
    expect(screen.getByLabelText("change shipping address")).toBeChecked();
    expect(screen.getByLabelText("read orders")).not.toBeChecked();
  });

  it("grants a permission and saves the whole payload", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/support-identities/${IDENTITY_ID}`);

    await screen.findByRole("heading", { name: "Northstar tier 1" });
    await user.click(screen.getByLabelText("read orders"));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect(savedPayloads[0].permissions).toEqual([
      "read_policies",
      "change_shipping_address",
      "read_orders",
    ]);
  });

  it("names what publishing would freeze", async () => {
    renderAt(`/shops/${SHOP_ID}/support-identities/${IDENTITY_ID}`);

    expect(await screen.findByText("Granted read_orders")).toBeVisible();
  });

  it("blocks publication while the permission gate is unmet", async () => {
    renderAt(`/shops/${SHOP_ID}/support-identities/${IDENTITY_ID}`);

    await screen.findByRole("heading", { name: "Northstar tier 1" });

    expect(screen.getByRole("button", { name: "Publish v1" })).toBeDisabled();
    expect(screen.getByText("Resolve 1 error(s) to publish.")).toBeVisible();
  });

  it("publishes a clean draft and reports the frozen version", async () => {
    const user = userEvent.setup();
    currentPreview = identityPreview({ publishable: true, issues: [] });
    renderAt(`/shops/${SHOP_ID}/support-identities/${IDENTITY_ID}`);

    await screen.findByRole("heading", { name: "Northstar tier 1" });
    await user.click(screen.getByRole("button", { name: "Publish v1" }));

    expect(await screen.findByText(/Published version 1/)).toBeVisible();
    expect(await screen.findByText(/Draft matches v1/)).toBeVisible();
  });
});
