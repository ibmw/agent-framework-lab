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
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { toProfilePayload } from "./api/customerProfiles";
import { CUSTOMER_EMAIL_RULE, CUSTOMER_NAME_RULE, CUSTOMER_SINCE_RULE } from "./lib/fieldRules";
import { todayInput } from "./lib/orders";
import { renderApp, wholeDescription } from "./test/app";
import { bodyRows, railEntry, shellListings } from "./test/shell";

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
  // The shop and lab shells read every listing their rail counts (ADR 0056). Last, so a
  // handler this suite declares for one of these routes still wins.
  ...shellListings(),
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

  it("offers a New customer button and an Attach existing beside it", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/customers`);

    await screen.findByRole("link", { name: "Maya Laurent" });
    // The side card is gone: creating is a page, and *Attach existing* stays here as the
    // prototype's secondary button (PLAN-UX Slice 12).
    expect(screen.queryByRole("region", { name: "New customer" })).toBeNull();
    expect(screen.getByRole("link", { name: "New customer" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/customers/new`,
    );

    const attach = screen.getByRole("button", { name: "Attach existing" });
    expect(attach).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Profile to attach")).toBeNull();
    await user.click(attach);
    expect(attach).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByLabelText("Profile to attach")).toBeVisible();
  });

  it("offers the unattached profiles to attach, and attaches one to this shop", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/customers`);

    await screen.findByRole("link", { name: "Maya Laurent" });
    await user.click(screen.getByRole("button", { name: "Attach existing" }));
    const picker = await screen.findByLabelText("Profile to attach");
    // Only profiles this shop does not already use are offered.
    expect(within(picker).getByRole("option", { name: /Tomás Rivera/ })).toBeVisible();
    expect(within(picker).queryByRole("option", { name: /Maya Laurent/ })).toBeNull();

    await user.selectOptions(picker, UNATTACHED.profile_id);
    await user.click(screen.getByRole("button", { name: "Attach to this shop" }));

    await waitFor(() => expect(attachedProfileIds).toEqual([UNATTACHED.profile_id]));
  });
});

describe("the new-customer page", () => {
  async function newCustomer() {
    const rendered = renderAt(`/shops/${SHOP_ID}/customers/new`);
    await screen.findByRole("heading", { level: 1, name: "New customer" });
    return rendered;
  }

  async function fillProfile(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Given name"), "Camille");
    await user.type(screen.getByLabelText("Family name"), "Dupont");
    await user.type(screen.getByLabelText("Email"), "camille.dupont@example.org");
  }

  it("names Customers above it and becomes the name as it is typed", async () => {
    const user = userEvent.setup();
    await newCustomer();

    const header = screen.getByRole("heading", { level: 1 }).closest("header");
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByRole("link", { name: "Customers" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/customers`,
    );
    expect(within(header as HTMLElement).getByText(/creating a profile/)).toBeVisible();

    await user.type(screen.getByLabelText("Given name"), "Camille");
    await user.type(screen.getByLabelText("Family name"), "Dupont");
    expect(screen.getByRole("heading", { level: 1, name: "Camille Dupont" })).toBeVisible();
  });

  it("refuses Create until the profile is named and addressed, and says why", async () => {
    const user = userEvent.setup();
    await newCustomer();

    const create = () => screen.getByRole("button", { name: "Create profile" });
    expect(create()).toBeDisabled();
    expect(create()).toHaveAccessibleDescription(/given name and a family name/i);
    expect(create()).toHaveAttribute("title", expect.stringMatching(/given name/i));

    await user.type(screen.getByLabelText("Given name"), "Camille");
    await user.type(screen.getByLabelText("Family name"), "Dupont");
    expect(create()).toBeDisabled();
    expect(create()).toHaveAccessibleDescription(/needs an email address/i);

    await user.type(screen.getByLabelText("Email"), "camille.dupont@example.org");
    expect(create()).toBeEnabled();
  });

  it("puts each field's hint in that control's accessible description", async () => {
    await newCustomer();

    // Exact, because the editor's four rows read the same three exports. A substring would
    // pass while the two surfaces drifted apart, which is what put these rules in one module.
    expect(screen.getByLabelText("Given name")).toHaveAccessibleDescription(
      wholeDescription(CUSTOMER_NAME_RULE),
    );
    expect(screen.getByLabelText("Family name")).toHaveAccessibleDescription(
      wholeDescription(CUSTOMER_NAME_RULE),
    );
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      wholeDescription(CUSTOMER_EMAIL_RULE),
    );
    expect(screen.getByLabelText("Customer since")).toHaveAccessibleDescription(
      wholeDescription(CUSTOMER_SINCE_RULE),
    );
  });

  it("creates the profile attached to this shop and lands in its editor", async () => {
    const user = userEvent.setup();
    let command: Record<string, unknown> | null = null;
    server.use(
      http.post("*/api/v1/customer-profiles", async ({ request }) => {
        command = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(profileDraft(PROFILE_CONTENT), { status: 201 });
      }),
    );
    const { router } = await newCustomer();
    await fillProfile(user);

    await user.click(screen.getByRole("button", { name: "Create profile" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`),
    );
    expect(command).toMatchObject({ shop_id: SHOP_ID });
  });

  it("moves the rail's figure with the index when a profile is created", async () => {
    const user = userEvent.setup();
    let attached = [MAYA];
    server.use(
      http.get("*/api/v1/customer-profiles", ({ request }) => {
        const scoped = new URL(request.url).searchParams.get("shop_id") !== null;
        return HttpResponse.json({
          profiles: scoped ? attached : [...attached, UNATTACHED],
        } satisfies CustomerProfileListResponse);
      }),
      http.post("*/api/v1/customer-profiles", () => {
        attached = [
          ...attached,
          { ...MAYA, profile_id: UNATTACHED.profile_id, display_name: "Camille Dupont" },
        ];
        return HttpResponse.json(profileDraft(PROFILE_CONTENT), { status: 201 });
      }),
    );
    renderAt(`/shops/${SHOP_ID}/customers`);

    await screen.findByRole("link", { name: "Maya Laurent" });
    expect(within(railEntry("Customers")).getByText("1")).toBeVisible();

    await user.click(screen.getByRole("link", { name: "New customer" }));
    await screen.findByRole("heading", { level: 1, name: "New customer" });
    await fillProfile(user);
    await user.click(screen.getByRole("button", { name: "Create profile" }));

    // The create moved off the index, and the refresh moved with it (ADR 0056).
    await waitFor(() => expect(within(railEntry("Customers")).getByText("2")).toBeVisible());
  });

  it("keeps a refused create on the page, with the reason under the button", async () => {
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
    const { router } = await newCustomer();
    await fillProfile(user);

    await user.click(screen.getByRole("button", { name: "Create profile" }));

    const refusal = await screen.findByRole("alert");
    expect(refusal).toHaveTextContent(/email already exists/i);
    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/customers/new`);
    // Nothing the operator typed is lost, and the reason is on the control they pressed.
    expect(screen.getByLabelText("Given name")).toHaveValue("Camille");
    expect(screen.getByRole("button", { name: "Create profile" })).toHaveAccessibleDescription(
      /email already exists/i,
    );
  });

  it("returns to the index with nothing created when Cancel is pressed", async () => {
    const user = userEvent.setup();
    const { router } = await newCustomer();
    await user.type(screen.getByLabelText("Given name"), "Camille");

    await user.click(screen.getByRole("link", { name: "Cancel" }));

    // A half-typed create form is not an edit to something that exists (ADR 0051).
    await waitFor(() => expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/customers`));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("customer workspace", () => {
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

  /**
   * A label may run to 200 characters and an address ID to 64 (`MAX_SLUG_LENGTH`). The ID is
   * derived from the label and never shown, so an uncut one is a draft the domain refuses over
   * a field the author cannot see.
   */
  it("derives an address ID the domain accepts from a label longer than an ID may be", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);

    await screen.findByRole("heading", { name: "Maya Laurent" });
    const addForm = within(screen.getByRole("group", { name: "Add an address" }));
    const label = "Office at the far end of the old silk quarter, second courtyard on the left";
    await user.click(addForm.getByLabelText("Label"));
    await user.paste(label);
    await user.type(addForm.getByLabelText("Street"), "12 quai Perrache");
    await user.type(addForm.getByLabelText("Postal code"), "69002");
    await user.type(addForm.getByLabelText("City"), "Lyon");
    await user.click(addForm.getByRole("button", { name: "Add address" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    const saved = savedPayloads[0].addresses as Array<{ id: string; label: string }>;
    expect(saved[1].label).toBe(label);
    expect(saved[1].id).toBe("office-at-the-far-end-of-the-old-silk-quarter-second-courtyard-o");
    expect(saved[1].id.length).toBeLessThanOrEqual(64);
    expect(saved[1].id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
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

  it("gives every identity, account and persona row the rule its control obeys", async () => {
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });

    const identity = within(screen.getByRole("region", { name: "Identity" }));
    // The three the create form also asks for, read from the same export rather than retyped.
    expect(identity.getByLabelText("Given name")).toHaveAccessibleDescription(
      wholeDescription(CUSTOMER_NAME_RULE),
    );
    expect(identity.getByLabelText("Family name")).toHaveAccessibleDescription(
      wholeDescription(CUSTOMER_NAME_RULE),
    );
    expect(identity.getByLabelText("Email")).toHaveAccessibleDescription(
      wholeDescription(CUSTOMER_EMAIL_RULE),
    );
    // Phone is the one identity fact `CustomerIdentity` lets be `None`, and `type="tel"`
    // refuses nothing, so the shape `require_phone` wants is only readable here.
    expect(identity.getByLabelText("Phone")).toHaveAccessibleDescription(
      /the only identity fact that may be left out/i,
    );
    expect(identity.getByLabelText("Phone")).toHaveAccessibleDescription(
      /a leading \+ is allowed, then a digit/i,
    );

    const account = within(screen.getByRole("region", { name: "Account" }));
    expect(account.getByLabelText("Customer since")).toHaveAccessibleDescription(
      wholeDescription(CUSTOMER_SINCE_RULE),
    );
    // Neither select gates anything in the lab, and neither claims to.
    expect(account.getByLabelText("Status")).toHaveAccessibleDescription(
      /nothing here gates on it: an order or a ticket can be authored against a closed account/i,
    );
    expect(account.getByLabelText("Loyalty tier")).toHaveAccessibleDescription(
      /read by the agent, enforced by nobody/i,
    );
    // Notes reach the agent; the card below is where a fact that must not reach it goes.
    expect(account.getByLabelText("Account notes")).toHaveAccessibleDescription(
      /returns these to the support agent.*hidden simulator facts/i,
    );
    expect(screen.getByRole("region", { name: "Hidden simulator facts" })).toBeVisible();

    const persona = within(screen.getByRole("region", { name: "Behavioral persona" }));
    expect(persona.getByLabelText("Summary")).toHaveAccessibleDescription(
      /the publish gate refuses an empty summary/i,
    );
  });

  it("keeps the persona's traits named by their own group, not by a row as well", async () => {
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });

    const persona = within(screen.getByRole("region", { name: "Behavioral persona" }));
    expect(persona.getByLabelText("Summary")).toBeVisible();
    expect(persona.getAllByRole("group", { name: "Traits" })).toHaveLength(1);
  });
});

/**
 * The rail's figure and this index are one listing, read once by the shell and handed to
 * both, so they cannot come to disagree (ADR 0056).
 */
describe("the rail's figure and this index", () => {
  it("says on the rail what the table has rows", async () => {
    renderAt(`/shops/${SHOP_ID}/customers`);

    const rows = bodyRows(await screen.findByRole("table"));
    const entry = railEntry("Customers");
    expect(within(entry).getByText(String(rows))).toBeVisible();
    expect(entry).toHaveAccessibleDescription(`${rows} customer${rows === 1 ? "" : "s"}`);
  });
});

describe("removing is deliberate", () => {
  afterEach(() => window.localStorage.removeItem("agent-lab.confirm-before-delete"));

  /** The confirm standing where a row stood, found by its question. */
  function confirmNamed(question: RegExp | string) {
    return screen.getByRole("group", { name: question });
  }

  it("asks a second time before an address leaves, and the first press can be walked back", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });

    const remove = screen.getByRole("button", { name: "Remove Home" });
    await user.click(remove);

    // The confirm takes the row's place: the row's own fields are gone, the question stands
    // there instead, and it holds focus so the question and its consequence are read out.
    const confirm = confirmNamed("Remove the address “Home”?");
    expect(screen.queryByLabelText("Label for home")).toBeNull();
    expect(confirm).toHaveFocus();
    expect(confirm).toHaveAccessibleDescription(
      /^It is the profile's last address, and a profile with none is refused at publication\. An order shipped to it keeps its frozen copy, and its findings warn that the entry can no longer be reselected\./,
    );

    // Walking back puts the row back, focus on the Remove that asked, and writes nothing.
    await user.click(within(confirm).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("group", { name: "Remove the address “Home”?" })).toBeNull();
    expect(screen.getByLabelText("Label for home")).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove Home" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();

    // Escape is the same walk back, from the keyboard.
    await user.click(screen.getByRole("button", { name: "Remove Home" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Remove Home" })).toHaveFocus();

    // Only the second press removes it.
    await user.click(screen.getByRole("button", { name: "Remove Home" }));
    await user.click(
      within(confirmNamed("Remove the address “Home”?")).getByRole("button", {
        name: "Remove it",
      }),
    );
    expect(screen.queryByLabelText("Label for home")).toBeNull();
    // The row is gone, so focus is left on the line that says so. Focus is what announces it:
    // it is not also a live region, which would read it twice.
    const said = screen.getByText("Removed the address “Home” from the draft.");
    expect(said).toHaveFocus();
    expect(said).not.toHaveAttribute("role");
    expect(said).not.toHaveAttribute("aria-live");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect(savedPayloads[0].addresses).toEqual([]);
  });

  it("removes on one press once the operator has turned the second press off", async () => {
    window.localStorage.setItem("agent-lab.confirm-before-delete", "false");
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });

    await user.click(screen.getByRole("button", { name: "Remove Home" }));

    expect(screen.queryByRole("group", { name: /Remove the address/ })).toBeNull();
    expect(screen.queryByLabelText("Label for home")).toBeNull();
    expect(screen.getByText("Removed the address “Home” from the draft.")).toHaveFocus();
  });

  it("detaches from this shop only on the second press, and returns to Customers", async () => {
    const user = userEvent.setup();
    const detached: string[] = [];
    server.use(
      http.delete(`*/api/v1/customer-profiles/${PROFILE_ID}/shops/:shopId`, ({ params }) => {
        detached.push(String(params.shopId));
        return HttpResponse.json({ profile_id: PROFILE_ID, shop_ids: [] });
      }),
      // This shop's listing answers what the lab now holds: Maya is no longer in it.
      http.get("*/api/v1/customer-profiles", ({ request }) => {
        const scoped = new URL(request.url).searchParams.get("shop_id") !== null;
        return HttpResponse.json({
          profiles: scoped && detached.length > 0 ? [] : [MAYA, UNATTACHED],
        } satisfies CustomerProfileListResponse);
      }),
    );
    const { router } = renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });

    await user.click(screen.getByRole("button", { name: "Detach from Northstar Outfitters" }));
    const confirm = confirmNamed("Detach Maya Laurent from Northstar Outfitters?");
    expect(confirm).toHaveAccessibleDescription(
      /The profile itself is kept.*Until the profile is attached again, an order of theirs in the shop they leave is reported as unable to seed a sandbox, and a ticket or a scenario bound to them is refused at publication\..*returns to Customers/,
    );
    expect(detached).toEqual([]);

    await user.click(within(confirm).getByRole("button", { name: "Detach" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/customers`));
    expect(detached).toEqual([SHOP_ID]);
    expect(await screen.findByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
    // The editor unmounted, so Customers says what was detached and focus is left there.
    const said = await screen.findByText("Detached Maya Laurent from this shop.");
    await waitFor(() => expect(said).toHaveFocus());
  });

  it("stays on the profile when it is detached from another shop", async () => {
    const user = userEvent.setup();
    attachedShops = { profile_id: PROFILE_ID, shop_ids: [SHOP_ID, OTHER_SHOP_ID] };
    server.use(
      http.delete(`*/api/v1/customer-profiles/${PROFILE_ID}/shops/${OTHER_SHOP_ID}`, () =>
        HttpResponse.json({ profile_id: PROFILE_ID, shop_ids: [SHOP_ID] }),
      ),
    );
    const { router } = renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });

    await user.click(await screen.findByRole("button", { name: "Detach from Aurora Supply Co." }));
    await user.click(
      within(confirmNamed("Detach Maya Laurent from Aurora Supply Co.?")).getByRole("button", {
        name: "Detach",
      }),
    );

    const card = screen.getByRole("region", { name: "Attached shops" });
    await waitFor(() => expect(within(card).queryByText("Aurora Supply Co.")).toBeNull());
    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    // The notice waits for the write, so it is said once the row has gone, and holds focus.
    const said = await within(card).findByText("Detached Maya Laurent from Aurora Supply Co.");
    await waitFor(() => expect(said).toHaveFocus());
  });

  it("sends one detach however fast it is pressed, and reads the list once", async () => {
    window.localStorage.setItem("agent-lab.confirm-before-delete", "false");
    const user = userEvent.setup();
    const detached: string[] = [];
    // The detach is held until both presses have landed, so the second one meets the first in
    // flight — which is when a second write would be sent.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.delete(`*/api/v1/customer-profiles/${PROFILE_ID}/shops/:shopId`, async ({ params }) => {
        detached.push(String(params.shopId));
        await held;
        return HttpResponse.json({ profile_id: PROFILE_ID, shop_ids: [] });
      }),
      http.get("*/api/v1/customer-profiles", ({ request }) => {
        const scoped = new URL(request.url).searchParams.get("shop_id") !== null;
        return HttpResponse.json({
          profiles: scoped && detached.length > 0 ? [] : [MAYA, UNATTACHED],
        } satisfies CustomerProfileListResponse);
      }),
    );
    const { router } = renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });

    await user.dblClick(screen.getByRole("button", { name: "Detach from Northstar Outfitters" }));
    release();

    await waitFor(() => expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/customers`));
    expect(detached).toEqual([SHOP_ID]);
    // A superseded refresh would have read as a failure and said so.
    expect(screen.queryByText(/could not be refreshed/)).toBeNull();
  });

  it("says nothing was detached when the detach fails, and shows why", async () => {
    const user = userEvent.setup();
    attachedShops = { profile_id: PROFILE_ID, shop_ids: [SHOP_ID, OTHER_SHOP_ID] };
    server.use(
      http.delete(`*/api/v1/customer-profiles/${PROFILE_ID}/shops/${OTHER_SHOP_ID}`, () =>
        HttpResponse.json(
          { code: "unavailable", message: "The lab could not detach it.", request_id: "r" },
          { status: 503 },
        ),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });

    await user.click(await screen.findByRole("button", { name: "Detach from Aurora Supply Co." }));
    await user.click(
      within(confirmNamed("Detach Maya Laurent from Aurora Supply Co.?")).getByRole("button", {
        name: "Detach",
      }),
    );

    const card = screen.getByRole("region", { name: "Attached shops" });
    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "The lab could not detach it.",
    );
    expect(within(card).getByText("Aurora Supply Co.")).toBeVisible();
    expect(screen.queryByText(/^Detached Maya Laurent/)).toBeNull();
    // Walked back: focus returns to the Detach that asked, drawn again on its row.
    await waitFor(() =>
      expect(
        within(card).getByRole("button", { name: "Detach from Aurora Supply Co." }),
      ).toHaveFocus(),
    );
  });

  it("stays on the profile when Customers cannot be read again after detaching from this shop", async () => {
    const user = userEvent.setup();
    let detached = false;
    server.use(
      http.delete(`*/api/v1/customer-profiles/${PROFILE_ID}/shops/${SHOP_ID}`, () => {
        detached = true;
        return HttpResponse.json({ profile_id: PROFILE_ID, shop_ids: [] });
      }),
      http.get("*/api/v1/customer-profiles", ({ request }) => {
        const scoped = new URL(request.url).searchParams.get("shop_id") !== null;
        if (scoped && detached) {
          return HttpResponse.json(
            { code: "unavailable", message: "down", request_id: "r" },
            { status: 503 },
          );
        }
        return HttpResponse.json({
          profiles: scoped ? [MAYA] : [MAYA, UNATTACHED],
        } satisfies CustomerProfileListResponse);
      }),
    );
    const { router } = renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });

    await user.click(screen.getByRole("button", { name: "Detach from Northstar Outfitters" }));
    await user.click(
      within(confirmNamed("Detach Maya Laurent from Northstar Outfitters?")).getByRole("button", {
        name: "Detach",
      }),
    );

    // Customers would still list Maya beside a notice saying she was detached, so the page
    // does not go there: it says the detach landed and the list did not.
    const card = screen.getByRole("region", { name: "Attached shops" });
    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "The customer list could not be refreshed, so this page stays on the profile.",
    );
    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    expect(
      await within(card).findByText("Detached Maya Laurent from Northstar Outfitters."),
    ).toBeVisible();
  });
});

/**
 * What a detach does when its answer arrives after the operator has moved: the customer editor
 * is mounted afresh per profile, so a late answer lands on the page that sent it — which is
 * gone — and never on the profile now on screen (ADR 0060).
 */
describe("a detach that answers late", () => {
  const CONFIRM_KEY = "agent-lab.confirm-before-delete";
  afterEach(() => window.localStorage.removeItem(CONFIRM_KEY));

  const failure = () =>
    HttpResponse.json(
      { code: "unavailable", message: "The lab could not detach it.", request_id: "r" },
      { status: 503 },
    );

  function held() {
    let release: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release: () => release() };
  }

  /** Tomás, a second profile attached to both shops, for a move away from Maya. */
  function serveTomas() {
    server.use(
      http.get(`*/api/v1/customer-profiles/${UNATTACHED_ID}/draft`, () =>
        HttpResponse.json({
          ...profileDraft({
            ...PROFILE_CONTENT,
            display_name: "Tomás Rivera",
          } as typeof PROFILE_CONTENT),
          profile_id: UNATTACHED_ID,
        }),
      ),
      http.get(`*/api/v1/customer-profiles/${UNATTACHED_ID}/draft/preview`, () =>
        HttpResponse.json({ ...profilePreview(), profile_id: UNATTACHED_ID }),
      ),
      http.get(`*/api/v1/customer-profiles/${UNATTACHED_ID}/shops`, () =>
        HttpResponse.json({ profile_id: UNATTACHED_ID, shop_ids: [SHOP_ID, OTHER_SHOP_ID] }),
      ),
    );
  }

  it("A: a failure that lands after moving to another profile says nothing to it", async () => {
    window.localStorage.setItem(CONFIRM_KEY, "false");
    const user = userEvent.setup();
    attachedShops = { profile_id: PROFILE_ID, shop_ids: [SHOP_ID, OTHER_SHOP_ID] };
    const hold = held();
    serveTomas();
    server.use(
      http.delete(`*/api/v1/customer-profiles/${PROFILE_ID}/shops/${OTHER_SHOP_ID}`, async () => {
        await hold.promise;
        return failure();
      }),
    );
    const { router } = renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });
    await user.click(await screen.findByRole("button", { name: "Detach from Aurora Supply Co." }));

    await act(() => router.navigate(`/shops/${SHOP_ID}/customers/${UNATTACHED_ID}`));
    const heading = await screen.findByRole("heading", { name: "Tomás Rivera" });
    const card = screen.getByRole("region", { name: "Attached shops" });
    const tomasDetach = await within(card).findByRole("button", {
      name: "Detach from Aurora Supply Co.",
    });
    // A fresh page: Maya's write in flight is not Tomás's.
    expect(tomasDetach).toBeEnabled();
    heading.setAttribute("tabindex", "-1");
    heading.focus();

    hold.release();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Maya's failure does not reach Tomás: no alert on his card, and focus is not moved onto
    // his Detach, where one Enter would detach the wrong customer.
    expect(within(card).queryByRole("alert")).toBeNull();
    expect(heading).toHaveFocus();
    expect(tomasDetach).toBeEnabled();
  });

  it("B: a failure while another row is armed leaves focus there, and then on its own Detach", async () => {
    const user = userEvent.setup();
    attachedShops = { profile_id: PROFILE_ID, shop_ids: [SHOP_ID, OTHER_SHOP_ID] };
    const aurora = held();
    const northstar = held();
    server.use(
      http.delete(`*/api/v1/customer-profiles/${PROFILE_ID}/shops/${OTHER_SHOP_ID}`, async () => {
        await aurora.promise;
        return failure();
      }),
      http.delete(`*/api/v1/customer-profiles/${PROFILE_ID}/shops/${SHOP_ID}`, async () => {
        await northstar.promise;
        return failure();
      }),
    );
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });
    await user.click(await screen.findByRole("button", { name: "Detach from Aurora Supply Co." }));
    await user.click(
      within(
        screen.getByRole("group", { name: "Detach Maya Laurent from Aurora Supply Co.?" }),
      ).getByRole("button", { name: "Detach" }),
    );
    await user.click(screen.getByRole("button", { name: "Detach from Northstar Outfitters" }));
    const armed = screen.getByRole("group", {
      name: "Detach Maya Laurent from Northstar Outfitters?",
    });

    aurora.release();
    await screen.findByText("The lab could not detach it.");
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The armed question keeps focus; Aurora's walk-back waits for nothing.
    expect(armed).toHaveFocus();

    await user.click(within(armed).getByRole("button", { name: "Detach" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Confirming Northstar does not deliver Aurora's walk-back.
    expect(screen.getByRole("button", { name: "Detach from Aurora Supply Co." })).not.toHaveFocus();

    northstar.release();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Detach from Northstar Outfitters" }),
      ).toHaveFocus(),
    );
  });

  it("C: coming back mid-write is a fresh page, whose own detach is its own", async () => {
    window.localStorage.setItem(CONFIRM_KEY, "false");
    const user = userEvent.setup();
    attachedShops = { profile_id: PROFILE_ID, shop_ids: [SHOP_ID, OTHER_SHOP_ID] };
    const hold = held();
    let sent = 0;
    server.use(
      http.delete(`*/api/v1/customer-profiles/${PROFILE_ID}/shops/${OTHER_SHOP_ID}`, async () => {
        sent += 1;
        await hold.promise;
        return failure();
      }),
    );
    const { router } = renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });
    await user.click(await screen.findByRole("button", { name: "Detach from Aurora Supply Co." }));
    await act(() => router.navigate(`/shops/${SHOP_ID}/customers`));
    await screen.findByRole("heading", { level: 1, name: "Customers" });
    await act(() => router.navigate(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`));
    await screen.findByRole("heading", { name: "Maya Laurent" });

    // The page that sent the first write is gone, so nothing it held carries over: Aurora is
    // listed as the lab last answered, its Detach is enabled, and pressing it sends a write.
    const again = await screen.findByRole("button", { name: "Detach from Aurora Supply Co." });
    expect(again).toBeEnabled();
    await user.click(again);
    hold.release();

    const card = screen.getByRole("region", { name: "Attached shops" });
    // Both writes fail; the old page says nothing, and this page says its own failure once.
    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "The lab could not detach it.",
    );
    expect(within(card).getAllByRole("alert")).toHaveLength(1);
    expect(sent).toBe(2);
    await waitFor(() =>
      expect(
        within(card).getByRole("button", { name: "Detach from Aurora Supply Co." }),
      ).toHaveFocus(),
    );
  });

  it("does not take the operator away when a detach from this shop lands after they moved on", async () => {
    window.localStorage.setItem(CONFIRM_KEY, "false");
    const user = userEvent.setup();
    const hold = held();
    serveTomas();
    server.use(
      http.delete(`*/api/v1/customer-profiles/${PROFILE_ID}/shops/${SHOP_ID}`, async () => {
        await hold.promise;
        return HttpResponse.json({ profile_id: PROFILE_ID, shop_ids: [] });
      }),
    );
    const { router } = renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });
    await user.click(screen.getByRole("button", { name: "Detach from Northstar Outfitters" }));

    await act(() => router.navigate(`/shops/${SHOP_ID}/customers/${UNATTACHED_ID}`));
    await screen.findByRole("heading", { name: "Tomás Rivera" });
    hold.release();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/customers/${UNATTACHED_ID}`);
    expect(screen.queryByText(/^Detached Maya Laurent/)).toBeNull();
  });

  it("reads Customers again when a detach from this shop lands after the operator went there", async () => {
    window.localStorage.setItem(CONFIRM_KEY, "false");
    const user = userEvent.setup();
    const hold = held();
    let detached = false;
    server.use(
      http.delete(`*/api/v1/customer-profiles/${PROFILE_ID}/shops/${SHOP_ID}`, async () => {
        await hold.promise;
        detached = true;
        return HttpResponse.json({ profile_id: PROFILE_ID, shop_ids: [] });
      }),
      http.get("*/api/v1/customer-profiles", ({ request }) => {
        const scoped = new URL(request.url).searchParams.get("shop_id") !== null;
        return HttpResponse.json({
          profiles: scoped && detached ? [] : [MAYA, UNATTACHED],
        } satisfies CustomerProfileListResponse);
      }),
    );
    const { router } = renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });
    await user.click(screen.getByRole("button", { name: "Detach from Northstar Outfitters" }));

    // The operator is on the index before the detach answers.
    await act(() => router.navigate(`/shops/${SHOP_ID}/customers`));
    await screen.findByRole("heading", { level: 1, name: "Customers" });
    expect(await screen.findByRole("link", { name: "Maya Laurent" })).toBeVisible();

    hold.release();

    // The page that changed the listing has gone, and it still reads it again (ADR 0056): the
    // index stops listing Maya, and the operator stays where they are.
    await waitFor(() => expect(screen.queryByRole("link", { name: "Maya Laurent" })).toBeNull());
    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/customers`);
  });

  it("still asks before leaving a profile with unsaved edits for another one", async () => {
    const user = userEvent.setup();
    serveTomas();
    const { router } = renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });
    await user.type(screen.getByLabelText("Account notes"), " Prefers email.");

    const leaving = router.navigate(`/shops/${SHOP_ID}/customers/${UNATTACHED_ID}`);

    const prompt = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(router.state.location.pathname).toBe(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await user.click(within(prompt).getByRole("button", { name: "Stay on this page" }));
    await leaving;
    expect(screen.getByLabelText("Account notes")).toHaveValue(
      `${PROFILE_CONTENT.account.notes} Prefers email.`,
    );
  });
});

describe("one write per shop on this page", () => {
  const CONFIRM_KEY = "agent-lab.confirm-before-delete";
  afterEach(() => window.localStorage.removeItem(CONFIRM_KEY));

  function heldDetach() {
    let release: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: string[] = [];
    server.use(
      http.delete(`*/api/v1/customer-profiles/${PROFILE_ID}/shops/${OTHER_SHOP_ID}`, async () => {
        sent.push(OTHER_SHOP_ID);
        await promise;
        return HttpResponse.json(
          { code: "unavailable", message: "The lab could not detach it.", request_id: "r" },
          { status: 503 },
        );
      }),
    );
    return { sent, release: () => release() };
  }

  it("sends one write for two presses in the same event tick (the pending set)", async () => {
    window.localStorage.setItem(CONFIRM_KEY, "false");
    attachedShops = { profile_id: PROFILE_ID, shop_ids: [SHOP_ID, OTHER_SHOP_ID] };
    const detach = heldDetach();
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });
    const button = await screen.findByRole("button", { name: "Detach from Aurora Supply Co." });

    // Inside one `act`, React does not re-render between the two, so the button is not yet
    // disabled for the second: only the pending set can hold it back.
    act(() => {
      button.click();
      button.click();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(detach.sent).toHaveLength(1);
    detach.release();
  });

  it("disables that shop's Detach while its write is in flight", async () => {
    window.localStorage.setItem(CONFIRM_KEY, "false");
    const user = userEvent.setup();
    attachedShops = { profile_id: PROFILE_ID, shop_ids: [SHOP_ID, OTHER_SHOP_ID] };
    const detach = heldDetach();
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });

    await user.click(await screen.findByRole("button", { name: "Detach from Aurora Supply Co." }));

    expect(screen.getByRole("button", { name: "Detach from Aurora Supply Co." })).toBeDisabled();
    detach.release();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Detach from Aurora Supply Co." })).toBeEnabled(),
    );
  });

  it("allows a later write once the first has settled", async () => {
    window.localStorage.setItem(CONFIRM_KEY, "false");
    const user = userEvent.setup();
    attachedShops = { profile_id: PROFILE_ID, shop_ids: [SHOP_ID, OTHER_SHOP_ID] };
    const detach = heldDetach();
    renderAt(`/shops/${SHOP_ID}/customers/${PROFILE_ID}`);
    await screen.findByRole("heading", { name: "Maya Laurent" });

    await user.click(await screen.findByRole("button", { name: "Detach from Aurora Supply Co." }));
    detach.release();
    await screen.findByText("The lab could not detach it.");
    await user.click(screen.getByRole("button", { name: "Detach from Aurora Supply Co." }));

    await waitFor(() => expect(detach.sent).toHaveLength(2));
  });
});
