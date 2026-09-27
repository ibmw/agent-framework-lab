import type {
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
  SupportIdentityDraftResponse,
  SupportIdentityListResponse,
  SupportIdentityPreviewResponse,
  SupportIdentityVersionResponse,
} from "@agent-lab/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { renderApp } from "./test/app";
import { expectBusy, expectNotRefused, expectRefused } from "./test/refused";
import { bodyRows, railEntry, shellListings } from "./test/shell";

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
  // The shop and lab shells read every listing their rail counts (ADR 0056). Last, so a
  // handler this suite declares for one of these routes still wins.
  ...shellListings(),
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
  return renderApp(path);
}

describe("support identity workspace", () => {
  it("lists identities with their permission and publication state", async () => {
    renderAt("/lab/support-identities");

    expect(await screen.findByRole("heading", { name: "Support identities" })).toBeVisible();
    expect(await screen.findByRole("link", { name: "Northstar tier 1" })).toBeVisible();
    // Scoped to the table: "Never published" is also a filter chip's label now.
    expect(within(screen.getByRole("table")).getByText("Never published")).toBeVisible();
  });

  it("counts the identities a configuration could adopt, and filters to them", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/v1/support-identities", () =>
        HttpResponse.json({
          identities: [
            ...identities.identities,
            {
              ...identities.identities[0],
              identity_id: "8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d",
              name: "Northstar tier 2",
              latest_published_version: 1,
              published_version_count: 1,
            },
          ],
        } satisfies SupportIdentityListResponse),
      ),
    );
    renderAt("/lab/support-identities");
    await screen.findByRole("link", { name: "Northstar tier 1" });
    const filters = within(screen.getByRole("group", { name: "Filter support identities" }));

    expect(filters.getByRole("button", { name: "All 2" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Adoptable 1" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Never published 1" })).toBeVisible();

    await user.click(filters.getByRole("button", { name: "Adoptable 1" }));

    expect(screen.getByRole("link", { name: "Northstar tier 2" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Northstar tier 1" })).toBeNull();
  });

  it("offers a New identity button rather than a form beside the table", async () => {
    renderAt("/lab/support-identities");

    await screen.findByRole("link", { name: "Northstar tier 1" });
    // The side card is gone: creating is a page (PLAN-UX Slice 12), and the library's is the
    // lab's because the library left shop scope with ADR 0054.
    expect(screen.queryByRole("region", { name: "New support identity" })).toBeNull();
    expect(screen.getByRole("link", { name: "New identity" })).toHaveAttribute(
      "href",
      "/lab/support-identities/new",
    );
  });

  it("shows why an order mutation without read access blocks publication", async () => {
    renderAt(`/lab/support-identities/${IDENTITY_ID}`);

    expect(await screen.findByRole("heading", { name: "Northstar tier 1" })).toBeVisible();
    expect(screen.getByText(/acts on an order the identity is not allowed to read/)).toBeVisible();
    // Selected by what the checkbox says it grants, which is the whole of its label now.
    expect(
      screen.getByLabelText("Change shipping address — redirect an order that has not shipped"),
    ).toBeChecked();
    expect(screen.getByLabelText("Read orders — look up this customer's orders")).not.toBeChecked();
  });

  it("says what a permission grants on the checkbox that grants it", async () => {
    renderAt(`/lab/support-identities/${IDENTITY_ID}`);

    await screen.findByRole("heading", { name: "Northstar tier 1" });
    const permissions = within(screen.getByRole("region", { name: "Permissions" }));
    // The claim of the slice, in the words PLAN-UX wrote it in.
    expect(
      permissions.getByRole("checkbox", {
        name: "Issue refund — refund an order in full or part",
      }),
    ).toBeInTheDocument();
    // And nowhere on the card is the wire's own spelling still readable.
    expect(permissions.queryByText(/issue_refund/)).toBeNull();
  });

  it("grants a permission and saves the whole payload", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/support-identities/${IDENTITY_ID}`);

    await screen.findByRole("heading", { name: "Northstar tier 1" });
    await user.click(screen.getByLabelText("Read orders — look up this customer's orders"));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect(savedPayloads[0].permissions).toEqual([
      "read_policies",
      "change_shipping_address",
      "read_orders",
    ]);
  });

  it("names what publishing would freeze", async () => {
    renderAt(`/lab/support-identities/${IDENTITY_ID}`);

    expect(await screen.findByText("Granted read_orders")).toBeVisible();
  });

  it("blocks publication while the permission gate is unmet", async () => {
    renderAt(`/lab/support-identities/${IDENTITY_ID}`);

    await screen.findByRole("heading", { name: "Northstar tier 1" });

    expectRefused(
      screen.getByRole("button", { name: "Publish v1" }),
      /Resolve 1 error\(s\) to publish/,
    );
    expect(screen.getByText("Resolve 1 error(s) to publish.")).toBeVisible();
  });

  it("asks before an escalation condition leaves, where a trait or a value would not", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/support-identities/${IDENTITY_ID}`);

    await screen.findByRole("heading", { name: "Northstar tier 1" });
    const conditions = within(screen.getByRole("group", { name: "Conditions" }));
    await user.type(conditions.getByLabelText("New condition"), "a refund above 200 EUR");
    await user.click(conditions.getByRole("button", { name: "Add condition" }));

    await user.click(conditions.getByRole("button", { name: "Remove a refund above 200 EUR" }));
    const confirm = conditions.getByRole("group", {
      name: "Remove the escalation condition “a refund above 200 EUR”?",
    });
    expect(confirm).toHaveFocus();
    // The one condition is the last, and the gate's warning about an identity without one is
    // part of what the removal costs.
    expect(confirm).toHaveAccessibleDescription(
      /no longer escalates when it holds\. It is the identity's last escalation condition, which the publish gate warns about/,
    );

    await user.click(within(confirm).getByRole("button", { name: "Keep it" }));
    expect(conditions.getByRole("button", { name: "Remove a refund above 200 EUR" })).toHaveFocus();

    await user.click(conditions.getByRole("button", { name: "Remove a refund above 200 EUR" }));
    await user.click(
      within(
        conditions.getByRole("group", {
          name: "Remove the escalation condition “a refund above 200 EUR”?",
        }),
      ).getByRole("button", { name: "Remove it" }),
    );
    expect(conditions.getByText("No condition yet; this identity never escalates.")).toBeVisible();
    expect(
      conditions.getByText(
        "Removed the escalation condition “a refund above 200 EUR” from the draft.",
      ),
    ).toHaveFocus();
  });

  it("enters escalation conditions one at a time, refusing a repeat", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/support-identities/${IDENTITY_ID}`);

    await screen.findByRole("heading", { name: "Northstar tier 1" });
    const conditions = within(screen.getByRole("group", { name: "Conditions" }));
    expect(conditions.getByText("No condition yet; this identity never escalates.")).toBeVisible();

    await user.type(conditions.getByLabelText("New condition"), "a refund above 200 EUR");
    await user.click(conditions.getByRole("button", { name: "Add condition" }));
    expect(conditions.getByRole("button", { name: "Remove a refund above 200 EUR" })).toBeVisible();

    await user.type(conditions.getByLabelText("New condition"), "a refund above 200 EUR");
    expect(conditions.getByLabelText("New condition")).toBeInvalid();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "a refund above 200 EUR is already an escalation condition.",
    );
    await user.clear(conditions.getByLabelText("New condition"));

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect(savedPayloads[0].escalation).toMatchObject({
      conditions: ["a refund above 200 EUR"],
    });
  });

  it("sends one publish for a press made again while the first is in flight", async () => {
    const user = userEvent.setup();
    currentPreview = identityPreview({ publishable: true, issues: [] });
    let publishes = 0;
    let answer: () => void = () => {};
    server.use(
      http.post(`*/api/v1/support-identities/${IDENTITY_ID}/versions`, async () => {
        publishes += 1;
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
      }),
    );
    renderAt(`/lab/support-identities/${IDENTITY_ID}`);
    await screen.findByRole("heading", { name: "Northstar tier 1" });
    const publish = screen.getByRole("button", { name: "Publish v1" });
    await user.click(publish);
    await waitFor(() => expect(publishes).toBe(1));

    const publishing = screen.getByRole("button", { name: "Publishing…" });
    expect(publishing).toBe(publish);
    expectBusy(publishing);
    await user.click(publishing);
    await user.keyboard("{Enter}");
    expect(publishes).toBe(1);

    answer();
    expect(await screen.findByText(/Published version 1/)).toBeVisible();
    expect(publishes).toBe(1);
  });

  it("publishes a clean draft and reports the frozen version", async () => {
    const user = userEvent.setup();
    currentPreview = identityPreview({ publishable: true, issues: [] });
    renderAt(`/lab/support-identities/${IDENTITY_ID}`);

    await screen.findByRole("heading", { name: "Northstar tier 1" });
    await user.click(screen.getByRole("button", { name: "Publish v1" }));

    expect(await screen.findByText(/Published version 1/)).toBeVisible();
    expect(await screen.findByText(/Draft matches v1/)).toBeVisible();
  });
});

/**
 * PLAN-UX Slice 7's third checkbox. These rows are where the plan takes edit mode from — they
 * already corrected in place — but they asked their two questions through `aria-label` alone,
 * and assembled the note at the call site rather than through the add form's builder.
 */
describe("editing a saved guidance note in place", () => {
  it("corrects the body, keeps the id, and asks in visible words", async () => {
    const user = userEvent.setup();
    currentIdentity = {
      ...IDENTITY_CONTENT,
      guidance: [
        { id: "refunds", title: "Refunds", body: "Offer a refund above 200 EUR." },
        { id: "tone", title: "Tone", body: "Lead with the fact." },
      ],
    };
    // Captured before the save, because the PUT handler reassigns `currentIdentity` to the
    // payload: reading the baseline afterwards would compare the save to itself and the
    // assertion could not fail.
    const before = structuredClone(currentIdentity);
    renderAt(`/lab/support-identities/${IDENTITY_ID}`);

    const card = within(await screen.findByRole("region", { name: "Guidance" }));
    await user.click(card.getByRole("button", { name: "Edit Refunds" }));

    const open = within(card.getByRole("form", { name: "Edit Refunds" }));
    expect(open.getByLabelText("Guidance")).toHaveValue("Offer a refund above 200 EUR.");
    await user.clear(open.getByLabelText("Guidance"));
    await user.type(open.getByLabelText("Guidance"), "Escalate a refund above 200 EUR.");
    await user.click(open.getByRole("button", { name: "Save Refunds" }));

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedPayloads).toHaveLength(1));

    // Against the whole payload: a support identity carries no derived evidence, so the
    // content *is* the payload and every other field must come back byte-identical.
    expect(savedPayloads[0]).toStrictEqual({
      ...before,
      guidance: [
        { id: "refunds", title: "Refunds", body: "Escalate a refund above 200 EUR." },
        { id: "tone", title: "Tone", body: "Lead with the fact." },
      ],
    });
  });
});

/**
 * The rail's figure and this index are one listing, read once by the shell and handed to
 * both, so they cannot come to disagree (ADR 0056).
 */
describe("the new-identity page", () => {
  const NEW_IDENTITY_ID = "5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9";

  async function newIdentity() {
    const rendered = renderAt("/lab/support-identities/new");
    await screen.findByRole("heading", { level: 1, name: "New support identity" });
    return rendered;
  }

  it("names Support identities above it and becomes the name as it is typed", async () => {
    const user = userEvent.setup();
    await newIdentity();

    const header = screen.getByRole("heading", { level: 1 }).closest("header");
    expect(header).not.toBeNull();
    expect(
      within(header as HTMLElement).getByRole("link", { name: "Support identities" }),
    ).toHaveAttribute("href", "/lab/support-identities");
    expect(within(header as HTMLElement).getByText(/creating an identity/)).toBeVisible();

    await user.type(screen.getByLabelText("Name"), "Northstar tier 3");
    expect(screen.getByRole("heading", { level: 1, name: "Northstar tier 3" })).toBeVisible();
  });

  it("refuses Create until the role is named and titled, and says why", async () => {
    const user = userEvent.setup();
    await newIdentity();

    const create = () => screen.getByRole("button", { name: "Create identity" });
    expectRefused(create(), /needs a name/i);
    expect(create()).toHaveAccessibleDescription(/needs a name/i);
    expect(create()).toHaveAttribute("title", expect.stringMatching(/needs a name/i));

    await user.type(screen.getByLabelText("Name"), "Northstar tier 3");
    expectRefused(create(), /role title the agent presents as/i);
    expect(create()).toHaveAccessibleDescription(/role title the agent presents as/i);

    await user.type(screen.getByLabelText("Role title"), "Senior support");
    expectNotRefused(create());
  });

  it("puts each field's hint in that control's accessible description", async () => {
    await newIdentity();

    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription(
      /how the identity is listed.*adopt a published identity/i,
    );
    expect(screen.getByLabelText("Role title")).toHaveAccessibleDescription(
      /the role the support agent presents as/i,
    );
    expect(screen.getByLabelText("Remit (optional)")).toHaveAccessibleDescription(
      /what this identity is for/i,
    );
  });

  it("creates the identity, moves the rail's figure, and lands in its editor", async () => {
    const user = userEvent.setup();
    let listed = identities.identities;
    let command: Record<string, unknown> | null = null;
    server.use(
      http.get("*/api/v1/support-identities", () => HttpResponse.json({ identities: listed })),
      http.post("*/api/v1/support-identities", async ({ request }) => {
        command = (await request.json()) as Record<string, unknown>;
        listed = [
          ...listed,
          {
            ...identities.identities[0],
            identity_id: NEW_IDENTITY_ID,
            name: "Northstar tier 3",
          },
        ];
        return HttpResponse.json(
          {
            identity_id: NEW_IDENTITY_ID,
            lifecycle_state: "draft",
            content: currentIdentity,
            created_at: "2026-08-23T12:00:00+00:00",
            updated_at: "2026-08-23T12:05:00+00:00",
          } satisfies SupportIdentityDraftResponse,
          { status: 201 },
        );
      }),
      http.get(`*/api/v1/support-identities/${NEW_IDENTITY_ID}/draft`, () =>
        HttpResponse.json({
          identity_id: NEW_IDENTITY_ID,
          lifecycle_state: "draft",
          content: currentIdentity,
          created_at: "2026-08-23T12:00:00+00:00",
          updated_at: "2026-08-23T12:05:00+00:00",
        } satisfies SupportIdentityDraftResponse),
      ),
      http.get(`*/api/v1/support-identities/${NEW_IDENTITY_ID}/draft/preview`, () =>
        HttpResponse.json(currentPreview),
      ),
    );
    renderAt("/lab/support-identities");

    await screen.findByRole("link", { name: "Northstar tier 1" });
    expect(
      within(railEntry("Support identities", "Experiment lab workspace")).getByText("1"),
    ).toBeVisible();

    await user.click(screen.getByRole("link", { name: "New identity" }));
    await screen.findByRole("heading", { level: 1, name: "New support identity" });
    await user.type(screen.getByLabelText("Name"), "Northstar tier 3");
    await user.type(screen.getByLabelText("Role title"), "Senior support");
    await user.click(screen.getByRole("button", { name: "Create identity" }));

    // The create moved off the index, and the refresh moved with it (ADR 0056).
    await waitFor(() =>
      expect(
        within(railEntry("Support identities", "Experiment lab workspace")).getByText("2"),
      ).toBeVisible(),
    );
    expect(command).toMatchObject({
      role: { name: "Northstar tier 3", title: "Senior support" },
    });
  });

  it("keeps a refused create on the page, with the reason under the button", async () => {
    server.use(
      http.post("*/api/v1/support-identities", () =>
        HttpResponse.json(
          { code: "conflict", message: "An identity with this name exists.", request_id: "r" },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    const { router } = await newIdentity();

    await user.type(screen.getByLabelText("Name"), "Northstar tier 1");
    await user.type(screen.getByLabelText("Role title"), "Senior support");
    await user.click(screen.getByRole("button", { name: "Create identity" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/identity with this name exists/i);
    expect(router.state.location.pathname).toBe("/lab/support-identities/new");
    expect(screen.getByLabelText("Name")).toHaveValue("Northstar tier 1");
  });

  it("returns to the library with nothing created when Cancel is pressed", async () => {
    const user = userEvent.setup();
    const { router } = await newIdentity();
    await user.type(screen.getByLabelText("Name"), "Northstar tier 3");

    await user.click(screen.getByRole("link", { name: "Cancel" }));

    // A half-typed create form is not an edit to something that exists (ADR 0051).
    await waitFor(() => expect(router.state.location.pathname).toBe("/lab/support-identities"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the rail's figure and this index", () => {
  it("says on both rails what the table has rows", async () => {
    renderAt("/lab/support-identities");

    const rows = bodyRows(await screen.findByRole("table"));
    const entry = railEntry("Support identities", "Experiment lab workspace");
    expect(within(entry).getByText(String(rows))).toBeVisible();
    expect(entry).toHaveAccessibleDescription(`${rows} support identit${rows === 1 ? "y" : "ies"}`);
  });
});
