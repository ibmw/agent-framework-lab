import type {
  CustomerProfileDraftResponse,
  CustomerProfileListResponse,
  CustomerProfilePreviewResponse,
  CustomerProfileShopsResponse,
  CustomerProfileVersionResponse,
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
} from "@agent-lab/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { toProfilePayload } from "./api/customerProfiles";
import { todayInput } from "./lib/orders";
import { renderApp } from "./test/app";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const OTHER_SHOP_ID = "8c7b6a59-4d3e-42f1-a0b9-8c7d6e5f4a3b";
const PROFILE_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const UNATTACHED_ID = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";

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
    {
      shop_id: OTHER_SHOP_ID,
      name: "Aurora Supply Co.",
      slug: "aurora",
      updated_at: "2026-08-23T12:05:00+00:00",
      latest_published_version: null,
      published_version_count: 0,
    },
  ],
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
  persona: { summary: "Direct and mildly anxious.", traits: ["direct"] },
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
  ],
  background: [],
  hidden_facts: [],
  display_name: "Maya Laurent",
  default_address_id: "home",
};

function profileDraft(
  content: CustomerProfileDraftResponse["content"],
): CustomerProfileDraftResponse {
  return {
    profile_id: PROFILE_ID,
    lifecycle_state: "draft",
    content,
    created_at: "2026-08-23T12:00:00+00:00",
    updated_at: "2026-08-23T12:05:00+00:00",
  };
}

function profilePreview(
  overrides: Partial<CustomerProfilePreviewResponse> = {},
): CustomerProfilePreviewResponse {
  return {
    profile_id: PROFILE_ID,
    publishable: false,
    issues: [
      {
        severity: "error",
        code: "address_book_without_default",
        message: "one address-book entry must be the default",
        path: "addresses",
      },
    ],
    changes: [],
    content_fingerprint: "a".repeat(64),
    latest_published_version: null,
    next_version: 1,
    matches_latest_published: false,
    content: PROFILE_CONTENT,
    ...overrides,
  };
}

const MAYA: CustomerProfileListResponse["profiles"][number] = {
  profile_id: PROFILE_ID,
  display_name: "Maya Laurent",
  email: "maya.laurent@example.org",
  persona_traits: ["frequent", "direct"],
  address_count: 3,
  default_address_label: "Home",
  updated_at: "2026-08-23T12:05:00+00:00",
  latest_published_version: 2,
  published_version_count: 2,
  attached_shop_count: 2,
};

const UNATTACHED: CustomerProfileListResponse["profiles"][number] = {
  ...MAYA,
  profile_id: UNATTACHED_ID,
  display_name: "Tomás Rivera",
  email: "tomas.rivera@example.org",
  persona_traits: [],
  address_count: 1,
  default_address_label: null,
  latest_published_version: null,
  published_version_count: 0,
  attached_shop_count: 0,
};

let currentProfile = PROFILE_CONTENT;
let currentPreview = profilePreview();
let attachedShops: CustomerProfileShopsResponse = {
  profile_id: PROFILE_ID,
  shop_ids: [SHOP_ID],
};
let savedPayloads: Array<Record<string, unknown>> = [];
let attachedProfileIds: string[] = [];

const server = setupServer(
  http.get("*/api/v1/shops", () => HttpResponse.json(shops)),
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
  // Mirrors the contract: `shop_id` scopes the list to that shop's attachments.
  http.get("*/api/v1/customer-profiles", ({ request }) => {
    const scoped = new URL(request.url).searchParams.get("shop_id") !== null;
    return HttpResponse.json({
      profiles: scoped ? [MAYA] : [MAYA, UNATTACHED],
    } satisfies CustomerProfileListResponse);
  }),
  http.get(`*/api/v1/customer-profiles/${PROFILE_ID}/draft`, () =>
    HttpResponse.json(profileDraft(currentProfile)),
  ),
  http.put(`*/api/v1/customer-profiles/${PROFILE_ID}/draft`, async ({ request }) => {
    const body = (await request.json()) as { payload: Record<string, unknown> };
    // The contract forbids echoing derived evidence back into a draft write.
    if ("display_name" in body.payload || "default_address_id" in body.payload) {
      return HttpResponse.json(
        { code: "validation_error", message: "Request validation failed", request_id: "r" },
        { status: 422 },
      );
    }
    savedPayloads.push(body.payload);
    currentProfile = { ...currentProfile, ...body.payload } as typeof currentProfile;
    return HttpResponse.json(profileDraft(currentProfile));
  }),
  http.get(`*/api/v1/customer-profiles/${PROFILE_ID}/draft/preview`, () =>
    HttpResponse.json(currentPreview),
  ),
  http.get(`*/api/v1/customer-profiles/${PROFILE_ID}/shops`, () =>
    HttpResponse.json(attachedShops),
  ),
  http.post(`*/api/v1/customer-profiles/${UNATTACHED_ID}/shops`, async ({ request }) => {
    const body = (await request.json()) as { shop_id: string };
    attachedProfileIds.push(UNATTACHED_ID);
    return HttpResponse.json({ profile_id: UNATTACHED_ID, shop_ids: [body.shop_id] });
  }),
  http.post(`*/api/v1/customer-profiles/${PROFILE_ID}/shops`, async ({ request }) => {
    const body = (await request.json()) as { shop_id: string };
    attachedShops = {
      profile_id: PROFILE_ID,
      shop_ids: [...new Set([...attachedShops.shop_ids, body.shop_id])],
    };
    return HttpResponse.json(attachedShops);
  }),
  http.post(`*/api/v1/customer-profiles/${PROFILE_ID}/versions`, () => {
    currentPreview = profilePreview({
      publishable: true,
      issues: [],
      latest_published_version: 1,
      next_version: 2,
      matches_latest_published: true,
    });
    return HttpResponse.json(
      {
        profile_id: PROFILE_ID,
        lifecycle_state: "published",
        version: 1,
        content_fingerprint: "b".repeat(64),
        published_at: "2026-08-23T12:10:00+00:00",
        content: PROFILE_CONTENT,
      } satisfies CustomerProfileVersionResponse,
      { status: 201 },
    );
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  currentProfile = PROFILE_CONTENT;
  currentPreview = profilePreview();
  attachedShops = { profile_id: PROFILE_ID, shop_ids: [SHOP_ID] };
  savedPayloads = [];
  attachedProfileIds = [];
});
afterAll(() => server.close());

function renderAt(path: string) {
  return renderApp(path);
}

describe("customer workspace", () => {
  it("lists the profiles attached to this shop with their provenance", async () => {
    renderAt(`/shops/${SHOP_ID}/customers`);

    expect(await screen.findByRole("heading", { name: "Customers" })).toBeVisible();
    expect(await screen.findByRole("link", { name: "Maya Laurent" })).toBeVisible();
    expect(screen.getByText("frequent · direct")).toBeVisible();
    expect(screen.getByText("3 · default: Home")).toBeVisible();
    expect(screen.getByText("v2 · 2 version(s)")).toBeVisible();

    // A profile that exists but is attached elsewhere is not this shop's customer.
    expect(screen.queryByRole("link", { name: "Tomás Rivera" })).toBeNull();
  });

  /**
   * The two chips this page exists to gain. *Shared* is the Shops column counted, and
   * *Without a default address* is the Addresses column counted — the profile an order
   * fixture stalls on, because an order's ship-to is chosen from the address book.
   */
  it("counts the profiles by provenance, reach and address book, and filters to each", async () => {
    const user = userEvent.setup();
    const NO_DEFAULT: CustomerProfileListResponse["profiles"][number] = {
      ...UNATTACHED,
      profile_id: "7d6c5b4a-3e2f-4a1b-9c8d-7e6f5a4b3c2e",
      display_name: "Priya Raman",
      email: "priya.raman@example.org",
      attached_shop_count: 1,
    };
    server.use(
      http.get("*/api/v1/customer-profiles", ({ request }) => {
        const scoped = new URL(request.url).searchParams.get("shop_id") !== null;
        return HttpResponse.json({
          profiles: scoped ? [MAYA, NO_DEFAULT] : [MAYA, NO_DEFAULT, UNATTACHED],
        } satisfies CustomerProfileListResponse);
      }),
    );
    renderAt(`/shops/${SHOP_ID}/customers`);
    await screen.findByRole("link", { name: "Maya Laurent" });
    const filters = within(screen.getByRole("group", { name: "Filter customers" }));

    expect(filters.getByRole("button", { name: "All 2" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Published 1" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Never published 1" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Shared 1" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Without a default address 1" })).toBeVisible();

    await user.click(filters.getByRole("button", { name: "Without a default address 1" }));

    expect(screen.getByRole("link", { name: "Priya Raman" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Maya Laurent" })).toBeNull();

    await user.click(filters.getByRole("button", { name: "Shared 1" }));

    expect(screen.getByRole("link", { name: "Maya Laurent" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Priya Raman" })).toBeNull();
  });

  it("puts each new-customer field's hint in that control's accessible description", async () => {
    renderAt(`/shops/${SHOP_ID}/customers`);

    const card = within(await screen.findByRole("region", { name: "New customer" }));
    expect(card.getByLabelText("Given name")).toHaveAccessibleDescription(
      /display name on tickets and orders/i,
    );
    expect(card.getByLabelText("Family name")).toHaveAccessibleDescription(
      /display name on tickets and orders/i,
    );
    expect(card.getByLabelText("Email")).toHaveAccessibleDescription(
      /fictional address.*reusable across shops/i,
    );
    expect(card.getByLabelText("Customer since")).toHaveAccessibleDescription(
      /the day this fictional customer first bought/i,
    );
  });

  it("shows a refused create beside the button, not above the customer list", async () => {
    server.use(
      http.post("*/api/v1/customer-profiles", () =>
        HttpResponse.json(
          {
            code: "conflict",
            message: "A profile with this email already exists.",
            request_id: "r",
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/customers`);
    const card = within(await screen.findByRole("region", { name: "New customer" }));

    await user.type(card.getByLabelText("Given name"), "Maya");
    await user.type(card.getByLabelText("Family name"), "Laurent");
    await user.type(card.getByLabelText("Email"), "maya.laurent@example.org");
    await user.click(card.getByRole("button", { name: "Create and attach" }));

    expect(await card.findByRole("alert")).toHaveTextContent(/email already exists/i);
    expect(screen.getByRole("heading", { name: "Customers" }).closest("div")).not.toBeNull();
    const listing = screen.getByRole("link", { name: "Maya Laurent" }).closest("section");
    expect(listing).not.toBeNull();
    expect(within(listing as HTMLElement).queryByRole("alert")).toBeNull();
  });

  it("reports a failed listing reload as a load error, not a failed create", async () => {
    let created = false;
    server.use(
      http.post("*/api/v1/customer-profiles", () => {
        created = true;
        return HttpResponse.json(profileDraft(PROFILE_CONTENT), { status: 201 });
      }),
      http.get("*/api/v1/customer-profiles", ({ request }) => {
        if (created) {
          return HttpResponse.json(
            { code: "unavailable", message: "The listing could not be read.", request_id: "r" },
            { status: 503 },
          );
        }
        const scoped = new URL(request.url).searchParams.get("shop_id") !== null;
        return HttpResponse.json({
          profiles: scoped ? [MAYA] : [MAYA, UNATTACHED],
        } satisfies CustomerProfileListResponse);
      }),
    );
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/customers`);
    const card = within(await screen.findByRole("region", { name: "New customer" }));

    await user.type(card.getByLabelText("Given name"), "Camille");
    await user.type(card.getByLabelText("Family name"), "Dupont");
    await user.type(card.getByLabelText("Email"), "camille.dupont@example.org");
    await user.click(card.getByRole("button", { name: "Create and attach" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/listing could not be read/i);
    expect(card.queryByRole("alert")).toBeNull();
  });

  it("clears a page-level load error when a later listing reload succeeds", async () => {
    let created = 0;
    server.use(
      http.post("*/api/v1/customer-profiles", () => {
        created += 1;
        return HttpResponse.json(profileDraft(PROFILE_CONTENT), { status: 201 });
      }),
      http.get("*/api/v1/customer-profiles", ({ request }) => {
        if (created === 1) {
          return HttpResponse.json(
            { code: "unavailable", message: "The listing could not be read.", request_id: "r" },
            { status: 503 },
          );
        }
        const scoped = new URL(request.url).searchParams.get("shop_id") !== null;
        return HttpResponse.json({
          profiles: scoped ? [MAYA] : [MAYA, UNATTACHED],
        } satisfies CustomerProfileListResponse);
      }),
    );
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/customers`);
    const card = within(await screen.findByRole("region", { name: "New customer" }));

    await user.type(card.getByLabelText("Given name"), "Camille");
    await user.type(card.getByLabelText("Family name"), "Dupont");
    await user.type(card.getByLabelText("Email"), "camille.dupont@example.org");
    await user.click(card.getByRole("button", { name: "Create and attach" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/listing could not be read/i);

    await user.type(card.getByLabelText("Given name"), "Jules");
    await user.type(card.getByLabelText("Family name"), "Martin");
    await user.type(card.getByLabelText("Email"), "jules.martin@example.org");
    await user.click(card.getByRole("button", { name: "Create and attach" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("clears an initial load error when a later listing reload succeeds", async () => {
    let listings = 0;
    server.use(
      http.get("*/api/v1/customer-profiles", ({ request }) => {
        listings += 1;
        if (listings <= 2) {
          return HttpResponse.json(
            {
              code: "unavailable",
              message: "The customer service is unavailable.",
              request_id: "r",
            },
            { status: 503 },
          );
        }
        const scoped = new URL(request.url).searchParams.get("shop_id") !== null;
        return HttpResponse.json({
          profiles: scoped ? [MAYA] : [MAYA, UNATTACHED],
        } satisfies CustomerProfileListResponse);
      }),
      http.post("*/api/v1/customer-profiles", () =>
        HttpResponse.json(profileDraft(PROFILE_CONTENT), { status: 201 }),
      ),
    );
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/customers`);
    expect(await screen.findByRole("alert")).toHaveTextContent(/customer service is unavailable/i);

    const card = within(screen.getByRole("region", { name: "New customer" }));
    await user.type(card.getByLabelText("Given name"), "Camille");
    await user.type(card.getByLabelText("Family name"), "Dupont");
    await user.type(card.getByLabelText("Email"), "camille.dupont@example.org");
    await user.click(card.getByRole("button", { name: "Create and attach" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("offers the unattached profiles to attach, and attaches one to this shop", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/customers`);

    await screen.findByRole("link", { name: "Maya Laurent" });
    const picker = await screen.findByLabelText("Profile to attach");
    // Only profiles this shop does not already use are offered.
    expect(within(picker).getByRole("option", { name: /Tomás Rivera/ })).toBeVisible();
    expect(within(picker).queryByRole("option", { name: /Maya Laurent/ })).toBeNull();

    await user.selectOptions(picker, UNATTACHED.profile_id);
    await user.click(screen.getByRole("button", { name: "Attach to this shop" }));

    await waitFor(() => expect(attachedProfileIds).toEqual([UNATTACHED.profile_id]));
  });

  it("shows the publish gate and blocks publication while the draft has errors", async () => {
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);

    expect(await screen.findByRole("heading", { name: "Maya Laurent" })).toBeVisible();
    expect(screen.getByText(/one address-book entry must be the default/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Publish v1" })).toBeDisabled();
    expect(screen.getByText("Resolve 1 error(s) to publish.")).toBeVisible();
  });

  it("refuses to publish unsaved edits, the same way the shop workspace does", async () => {
    const user = userEvent.setup();
    currentPreview = profilePreview({ publishable: true, issues: [] });
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);

    await screen.findByRole("heading", { name: "Maya Laurent" });
    expect(screen.getByRole("button", { name: "Publish v1" })).toBeEnabled();

    await user.type(screen.getByLabelText("Given name"), "h");

    // Publishing freezes what the server holds, so the button closes rather than freezing
    // a draft older than the edits on screen.
    expect(screen.getByRole("button", { name: "Publish v1" })).toBeDisabled();
    expect(screen.getByText(/Save the draft first/)).toBeVisible();
  });

  it("saves the address book without echoing derived evidence back", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);

    await screen.findByRole("heading", { name: "Maya Laurent" });
    const addForm = within(screen.getByRole("group", { name: "Add an address" }));
    await user.type(addForm.getByLabelText("Label"), "Office");
    await user.type(addForm.getByLabelText("Street"), "12 quai Perrache");
    await user.type(addForm.getByLabelText("Postal code"), "69002");
    await user.type(addForm.getByLabelText("City"), "Lyon");
    await user.click(addForm.getByRole("button", { name: "Add address" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    const payload = savedPayloads[0];
    expect(payload).not.toHaveProperty("display_name");
    expect(payload).not.toHaveProperty("default_address_id");
    const saved = payload.addresses as Array<{ label: string; line1: string; country: string }>;
    expect(saved.map((entry) => entry.label)).toEqual(["Home", "Office"]);
    // The new entry carries what the author typed, not a placeholder.
    expect(saved[1].line1).toBe("12 quai Perrache");
    expect(saved[1].country).toBe("FR");
  });

  it("moves the default address without leaving two defaults behind", async () => {
    const user = userEvent.setup();
    currentProfile = {
      ...PROFILE_CONTENT,
      addresses: [
        PROFILE_CONTENT.addresses[0],
        { ...PROFILE_CONTENT.addresses[0], id: "office", label: "Office", is_default: false },
      ],
    };
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);

    await screen.findByRole("heading", { name: "Maya Laurent" });
    await user.click(screen.getByRole("button", { name: "Make Office the default address" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    const addresses = savedPayloads[0].addresses as Array<{ id: string; is_default: boolean }>;
    expect(addresses.filter((entry) => entry.is_default).map((entry) => entry.id)).toEqual([
      "office",
    ]);
  });

  it("attaches the profile to a second shop without copying it", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);

    await screen.findByRole("heading", { name: "Maya Laurent" });
    await user.click(screen.getByRole("button", { name: "Attach to Aurora Supply Co." }));

    const card = screen.getByRole("region", { name: "Attached shops" });
    expect(await within(card).findByText("Aurora Supply Co.")).toBeVisible();
    expect(attachedShops.shop_ids).toEqual([SHOP_ID, OTHER_SHOP_ID]);
  });

  it("publishes a clean draft and reports the frozen version", async () => {
    const user = userEvent.setup();
    currentPreview = profilePreview({ publishable: true, issues: [] });
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);

    await screen.findByRole("heading", { name: "Maya Laurent" });
    await user.click(screen.getByRole("button", { name: "Publish v1" }));

    expect(await screen.findByText(/Published version 1/)).toBeVisible();
    expect(await screen.findByText(/Draft matches v1/)).toBeVisible();
  });
});

describe("typed controls on the customer editor", () => {
  it("enters a trait at a time, refuses a second copy of one, and names each remove", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);

    await screen.findByRole("heading", { name: "Maya Laurent" });
    const traits = within(screen.getByRole("group", { name: "Traits" }));
    expect(traits.getByRole("button", { name: "Remove direct" })).toBeVisible();

    // A trait is stored as it was written: frame 6b draws "mildly anxious" with its space.
    await user.type(traits.getByLabelText("New trait"), "mildly anxious");
    await user.click(traits.getByRole("button", { name: "Add trait" }));

    await user.type(traits.getByLabelText("New trait"), "direct");
    expect(traits.getByLabelText("New trait")).toBeInvalid();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "direct is already a trait of this persona.",
    );
    await user.click(traits.getByRole("button", { name: "Add trait" }));

    await user.clear(traits.getByLabelText("New trait"));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    const persona = savedPayloads[0].persona as { traits: string[] };
    expect(persona.traits).toEqual(["direct", "mildly anxious"]);
  });

  it("offers a country by name on the add form and saves the code", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);

    await screen.findByRole("heading", { name: "Maya Laurent" });
    const addForm = within(screen.getByRole("group", { name: "Add an address" }));
    await user.type(addForm.getByLabelText("Label"), "Berlin office");
    await user.type(addForm.getByLabelText("Street"), "Torstrasse 1");
    await user.type(addForm.getByLabelText("Postal code"), "10119");
    await user.type(addForm.getByLabelText("City"), "Berlin");

    const country = addForm.getByLabelText("Country");
    await user.clear(country);
    await user.type(country, "de");
    expect(country).toHaveValue("DE");
    expect(country).toHaveAccessibleDescription(/Germany/);

    await user.click(addForm.getByRole("button", { name: "Add address" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    const saved = savedPayloads[0].addresses as Array<{ label: string; country: string }>;
    expect(saved[1]).toMatchObject({ label: "Berlin office", country: "DE" });
  });

  it("reads a saved address row's country back as the country it names", async () => {
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);

    await screen.findByRole("heading", { name: "Maya Laurent" });
    const book = within(screen.getByRole("region", { name: "Address book" }));
    const [row] = book.getAllByLabelText("Country");
    expect(row).toHaveValue("FR");
    expect(row).toHaveAccessibleDescription(/France/);
  });

  it("types the identity fields as the values they carry", async () => {
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);

    await screen.findByRole("heading", { name: "Maya Laurent" });
    const identity = within(screen.getByRole("region", { name: "Identity" }));
    expect(identity.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(identity.getByLabelText("Phone")).toHaveAttribute("type", "tel");
  });

  it("opens a background entry on today rather than on a day nobody chose", async () => {
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);

    await screen.findByRole("heading", { name: "Maya Laurent" });
    const background = within(screen.getByRole("region", { name: "Background" }));
    expect(background.getByLabelText("Date")).toHaveValue(todayInput());
  });
});

describe("every enum has a name", () => {
  it("names a background kind in the picker and on the entry it saves", async () => {
    const user = userEvent.setup();
    currentProfile = {
      ...PROFILE_CONTENT,
      background: [
        {
          id: "refund-2025",
          kind: "support_contact",
          occurred_on: "2026-05-02",
          note: "Asked about a refund window.",
        },
      ],
    };
    currentPreview = profilePreview({ content: currentProfile });
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);

    const background = within(await screen.findByRole("region", { name: "Background" }));
    expect(background.getByText("2026-05-02 · Support contact")).toBeVisible();

    const kind = background.getByLabelText("Kind");
    await user.selectOptions(kind, within(kind).getByRole("option", { name: "Life event" }));
    expect(kind).toHaveValue("life_event");
  });
});

/**
 * PLAN-UX Slice 7 on the customer editor. Both lists here carried their fields as
 * `aria-label`s on always-open boxes: the row could be corrected, but only by a reader who
 * could see which box was which, and the entry it wrote was assembled at the call site rather
 * than by the function the add form used.
 */
describe("editing a saved customer entry in place", () => {
  it("corrects a background note and leaves its kind, date and id alone", async () => {
    const user = userEvent.setup();
    currentProfile = {
      ...PROFILE_CONTENT,
      background: [
        {
          id: "refund-2025",
          kind: "support_contact",
          occurred_on: "2026-05-02",
          note: "Asked about a refund window.",
        },
      ],
    };
    currentPreview = profilePreview({ content: currentProfile });
    // Captured before the save, because the PUT handler merges the payload back into
    // `currentProfile`: reading the baseline afterwards would compare the save to itself.
    const before = toProfilePayload(currentProfile);
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);

    const card = within(await screen.findByRole("region", { name: "Background" }));
    await user.click(card.getByRole("button", { name: "Edit 2026-05-02 · Support contact" }));

    const open = within(card.getByRole("form", { name: "Edit 2026-05-02 · Support contact" }));
    // The row now asks its questions in words, not only in the accessible name.
    expect(open.getByLabelText("Note")).toHaveValue("Asked about a refund window.");
    await user.clear(open.getByLabelText("Note"));
    await user.type(open.getByLabelText("Note"), "Asked about the refund window.");
    await user.click(open.getByRole("button", { name: "Save 2026-05-02 · Support contact" }));

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedPayloads).toHaveLength(1));

    // Against the whole payload, not the one list: a sibling collection moving, or a key that
    // quietly became `undefined`, is exactly what a second payload builder would do.
    expect(savedPayloads[0]).toStrictEqual({
      ...before,
      background: [
        {
          id: "refund-2025",
          kind: "support_contact",
          occurred_on: "2026-05-02",
          note: "Asked about the refund window.",
        },
      ],
    });
  });

  it("corrects a hidden fact's reveal condition without touching the fact itself", async () => {
    const user = userEvent.setup();
    currentProfile = {
      ...PROFILE_CONTENT,
      hidden_facts: [
        { id: "second-address", note: "Has a second address.", revealed_when: "Asked directly." },
      ],
    };
    currentPreview = profilePreview({ content: currentProfile });
    const before = toProfilePayload(currentProfile);
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);

    const card = within(await screen.findByRole("region", { name: "Hidden simulator facts" }));
    await user.click(card.getByRole("button", { name: "Edit Has a second address." }));

    const open = within(card.getByRole("form", { name: "Edit Has a second address." }));
    expect(open.getByLabelText("Hidden fact")).toHaveValue("Has a second address.");
    await user.clear(open.getByLabelText("Revealed when"));
    await user.type(open.getByLabelText("Revealed when"), "Asked twice.");
    await user.click(open.getByRole("button", { name: "Save Has a second address." }));

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedPayloads).toHaveLength(1));

    expect(savedPayloads[0]).toStrictEqual({
      ...before,
      hidden_facts: [
        { id: "second-address", note: "Has a second address.", revealed_when: "Asked twice." },
      ],
    });
  });
});

/**
 * UI-2: the customer editor's own cards on the form pattern.
 *
 * The claim these hold is the one the slice may not break — every control still answers to the
 * words above it, and every description a control had it still has. The row moved the label
 * out of a wrapper and onto a `for`, which is invisible here and would be very visible if it
 * had been got wrong.
 */
describe("the field pattern on the customer editor", () => {
  it("binds each identity and account row to the control it names", async () => {
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });

    const identity = within(screen.getByRole("region", { name: "Identity" }));
    for (const [label, value] of [
      ["Given name", "Maya"],
      ["Family name", "Laurent"],
      ["Email", "maya.laurent@example.org"],
    ] as const) {
      const control = identity.getByLabelText(label);
      expect(control).toHaveValue(value);
      // The binding, not the wrapper: a row labels by `for`/`id`.
      expect(identity.getByText(label).getAttribute("for")).toBe(control.id);
    }

    const account = within(screen.getByRole("region", { name: "Account" }));
    expect(account.getByLabelText("Loyalty tier")).toHaveValue("silver");
    expect(account.getByLabelText("Account notes")).toBeVisible();
  });

  it("leaves the shared locale field naming itself once", async () => {
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });

    // `LocaleField` brings its own label and its own rule. Wrapping it in a row would have
    // given it a second label, and `getAllByLabelText` is how that would show. It draws itself
    // as a row instead, so the Identity card is one label typography rather than two.
    const identity = within(screen.getByRole("region", { name: "Identity" }));
    expect(identity.getAllByLabelText("Locale")).toHaveLength(1);
    expect(identity.getByLabelText("Locale")).toHaveAccessibleDescription(
      /pick a locale from the list/i,
    );
    expect(identity.getByText("Locale").className).toBe(identity.getByText("Email").className);
  });

  it("keeps the persona's traits named by their own group, not by a row as well", async () => {
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });

    const persona = within(screen.getByRole("region", { name: "Behavioral persona" }));
    expect(persona.getByLabelText("Summary")).toBeVisible();
    expect(persona.getAllByRole("group", { name: "Traits" })).toHaveLength(1);
  });
});
