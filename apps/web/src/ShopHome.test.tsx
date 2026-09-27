import type {
  ExperimentListResponse,
  ScenarioListResponse,
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
  ShopVersionListResponse,
  ShopVersionResponse,
  TicketListResponse,
} from "@agent-lab/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { renderApp } from "./test/app";
import { expectBusy, expectNotRefused, expectRefused } from "./test/refused";
import { shellListings } from "./test/shell";

/**
 * The shop's overview (PLAN-UX Slice 15, `Workspace.dc.html`:722).
 *
 * Four things are asserted here because four things are new: the version timeline, the
 * two-step publish, findings grouped on the entry that is wrong with an Open that lands on it,
 * and the two states of the readiness card. What is deliberately *not* asserted is any reading
 * of how far this lab has walked — ADR 0044 refused the stored checklist and ADR 0045 removed
 * the derived strip, and the two cases at the end are the guard that neither came back.
 */

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const SCENARIO_ID = "aa11bb22-cc33-4d44-8e55-ff6677889900";
const TICKET_ID = "bb22cc33-dd44-4e55-8f66-001122334455";
const EXPERIMENT_ID = "cc33dd44-ee55-4f66-8071-112233445566";

const CONTENT: ShopDraftResponse["content"] = {
  identity: {
    name: "Northstar Outfitters",
    slug: "northstar",
    locale: "en-GB",
    currencies: ["EUR"],
    channels: ["chat"],
  },
  products: [
    {
      handle: "alpine-shell-jacket",
      title: "Alpine Shell Jacket",
      description: "Three-layer waterproof shell.",
      status: "active",
      category: "Jackets",
      options: [{ key: "size", name: "Size", values: ["M", "L"] }],
      variants: [
        {
          sku: "NS-ASJ-CH-XL",
          option_values: [{ key: "size", value: "L" }],
          availability: "in_stock",
          stock_quantity: 4,
          price: null,
        },
      ],
      media: [],
      attributes: [],
      reviews: [],
      ratings: { review_count: 0, average_rating: null },
    },
    {
      handle: "trail-cap",
      title: "Trail Cap",
      description: "Six-panel cap.",
      status: "active",
      category: "Headwear",
      options: [],
      variants: [
        {
          sku: "NS-TC-1",
          option_values: [],
          availability: "in_stock",
          stock_quantity: 20,
          price: { amount: "29.00", currency: "EUR" },
        },
      ],
      media: [],
      attributes: [],
      reviews: [],
      ratings: { review_count: 0, average_rating: null },
    },
  ],
  faq: [],
  policies: [],
  payment_methods: [],
  fulfilment_methods: [],
  support_guidelines: [],
  tone_of_voice_guidelines: [],
  default_tone_of_voice_id: null,
  logo: null,
};

/** Three changes standing against v3, which is the slice's own stated evidence. */
function preview(overrides: Partial<ShopPreviewResponse> = {}): ShopPreviewResponse {
  return {
    shop_id: SHOP_ID,
    publishable: true,
    issues: [
      {
        severity: "error",
        code: "variant_without_price",
        message: "variant NS-ASJ-CH-XL is missing a price",
        path: "products.alpine-shell-jacket.variants.NS-ASJ-CH-XL",
      },
      {
        severity: "error",
        code: "product_without_variant",
        message: "product Alpine Shell Jacket has no sellable variant",
        path: "products.alpine-shell-jacket",
      },
      {
        severity: "warning",
        code: "shop_without_faq",
        message: "the shop's FAQ section has no entries yet",
        path: "faq",
      },
    ],
    changes: [
      {
        kind: "added",
        path: "products.alpine-shell-jacket.variants.NS-ASJ-CH-XL",
        description: "Added variant NS-ASJ-CH-XL on Alpine Shell Jacket",
      },
      {
        kind: "updated",
        path: "products.alpine-shell-jacket.description",
        description: "Updated Alpine Shell Jacket description",
      },
      {
        kind: "added",
        path: "policies.returns",
        description: "Added policy Returns",
      },
    ],
    content_fingerprint: "a".repeat(64),
    latest_published_version: 3,
    next_version: 4,
    matches_latest_published: false,
    content: CONTENT,
    ...overrides,
  };
}

const VERSIONS: ShopVersionListResponse = {
  versions: [
    { version: 1, content_fingerprint: "1".repeat(64), published_at: "2026-08-12T09:00:00+00:00" },
    { version: 2, content_fingerprint: "2".repeat(64), published_at: "2026-08-18T09:00:00+00:00" },
    { version: 3, content_fingerprint: "3".repeat(64), published_at: "2026-08-22T09:00:00+00:00" },
  ],
};

const SHOPS: ShopListResponse = {
  shops: [
    {
      shop_id: SHOP_ID,
      name: "Northstar Outfitters",
      slug: "northstar",
      updated_at: "2026-08-23T12:05:00+00:00",
      latest_published_version: 3,
      published_version_count: 3,
      logo: null,
    },
  ],
};

function scenario(publishedVersion: number | null): ScenarioListResponse {
  return {
    scenarios: [
      {
        scenario_id: SCENARIO_ID,
        name: "Wrong shipping address",
        ticket_id: TICKET_ID,
        ticket_reference: "T-204",
        ticket_subject: "Address is wrong",
        customer_display_name: "Maya Laurent",
        objective_count: 2,
        mutation_count: 0,
        context_document_count: 1,
        max_turns: 12,
        updated_at: "2026-08-22T10:00:00+00:00",
        latest_published_version: publishedVersion,
        published_version_count: publishedVersion === null ? 0 : publishedVersion,
      },
    ],
  };
}

const TICKETS: TicketListResponse = {
  tickets: [
    {
      ticket_id: TICKET_ID,
      reference: "T-204",
      subject: "Address is wrong",
      customer_profile_id: "dd44ee55-ff66-4071-8283-223344556677",
      customer_display_name: "Maya Laurent",
      channel: "chat",
      status: "open",
      origin_kind: "order_page",
      preview: "My parcel is going to the old flat.",
      opened_at: "2026-08-21T08:00:00+00:00",
      message_count: 2,
      tags: [],
      updated_at: "2026-08-21T08:30:00+00:00",
      latest_published_version: 1,
      published_version_count: 1,
    },
  ],
};

const EXPERIMENTS: ExperimentListResponse = {
  experiments: [
    {
      experiment_id: EXPERIMENT_ID,
      label: "Pydantic AI vs control",
      scenario_id: SCENARIO_ID,
      scenario_version: 1,
      seed: 7,
      snapshot_id: "ee55ff66-0718-4293-8405-334455667788",
      sandbox_fingerprint: "s".repeat(64),
      resolution_fingerprint: "r".repeat(64),
      participant_driver: "scripted",
      canonical_schema_version: "1",
      created_at: "2026-08-23T14:02:00+00:00",
    },
  ],
};

let currentPreview = preview();
let currentVersions = VERSIONS;
let currentScenarios = scenario(1);

const server = setupServer(
  http.get("*/api/v1/shops", () => HttpResponse.json(SHOPS)),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft`, () =>
    HttpResponse.json({
      shop_id: SHOP_ID,
      lifecycle_state: "draft",
      content: CONTENT,
      created_at: "2026-08-23T12:00:00+00:00",
      updated_at: "2026-08-23T12:05:00+00:00",
    } satisfies ShopDraftResponse),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft/preview`, () => HttpResponse.json(currentPreview)),
  http.get(`*/api/v1/shops/${SHOP_ID}/versions`, () => HttpResponse.json(currentVersions)),
  http.post(`*/api/v1/shops/${SHOP_ID}/versions`, () => {
    const published: ShopVersionResponse = {
      shop_id: SHOP_ID,
      lifecycle_state: "published",
      version: 4,
      content_fingerprint: "4".repeat(64),
      published_at: "2026-08-23T15:00:00+00:00",
      content: CONTENT,
    };
    currentVersions = {
      versions: [
        ...VERSIONS.versions,
        {
          version: 4,
          content_fingerprint: "4".repeat(64),
          published_at: "2026-08-23T15:00:00+00:00",
        },
      ],
    };
    currentPreview = preview({
      issues: [],
      changes: [],
      latest_published_version: 4,
      next_version: 5,
      matches_latest_published: true,
    });
    return HttpResponse.json(published, { status: 201 });
  }),
  http.get(`*/api/v1/shops/${SHOP_ID}/experiments`, () => HttpResponse.json(EXPERIMENTS)),
  http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () => HttpResponse.json(currentScenarios)),
  http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () => HttpResponse.json(TICKETS)),
  ...shellListings(),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  currentPreview = preview();
  currentVersions = VERSIONS;
  currentScenarios = scenario(1);
});
afterAll(() => server.close());

function card(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

async function openOverview() {
  renderApp(`/shops/${SHOP_ID}`);
  expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
}

describe("the version timeline", () => {
  it("draws every published version, then the draft and what it holds", async () => {
    await openOverview();

    const timeline = within(card("Versions of this shop")).getByRole("list");
    const stops = await waitFor(() => {
      const found = within(timeline).getAllByRole("listitem");
      expect(found).toHaveLength(4);
      return found;
    });
    expect(stops.map((stop) => stop.textContent)).toEqual([
      expect.stringContaining("v1"),
      expect.stringContaining("v2"),
      expect.stringContaining("v3 · in use"),
      expect.stringContaining("Draft v4"),
    ]);
    // The draft's own stop says what stands on it and that nothing can read it.
    expect(stops[3]).toHaveTextContent("3 changes · no experiment can see it");
    // Each published stop opens the frozen version it names.
    expect(within(timeline).getByRole("link", { name: "v3" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/versions/3`,
    );
  });

  it("says a shop with nothing published has only a draft", async () => {
    currentVersions = { versions: [] };
    currentPreview = preview({
      changes: [
        { kind: "added", path: "", description: "First published version of Northstar Outfitters" },
      ],
      latest_published_version: null,
      next_version: 1,
    });
    await openOverview();

    const timeline = within(card("Versions of this shop")).getByRole("list");
    const stops = within(timeline).getAllByRole("listitem");
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveTextContent("Draft v1");
    expect(stops[0]).toHaveTextContent("1 change · no experiment can see it");
  });

  it("says why the timeline is missing rather than reading as never published", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/versions`, () =>
        HttpResponse.json(
          { code: "unavailable", message: "Published versions are unavailable.", request_id: "r" },
          { status: 503 },
        ),
      ),
    );
    await openOverview();

    expect(await within(card("Versions of this shop")).findByRole("alert")).toHaveTextContent(
      "Published versions are unavailable.",
    );
  });
});

describe("publishing in two steps", () => {
  it("reviews what becomes the next version before anything is frozen", async () => {
    await openOverview();
    const versions = within(card("Versions of this shop"));

    await userEvent.click(
      await screen.findByRole("button", { name: "Review 3 changes & publish" }),
    );

    // The review is a reading, not a write: nothing is published until the second press.
    const becoming = versions.getByRole("list", { name: "These 3 changes become v4" });
    const listed = within(becoming).getAllByRole("listitem");
    expect(listed).toHaveLength(3);
    expect(listed[0]).toHaveTextContent("Added variant NS-ASJ-CH-XL on Alpine Shell Jacket");
    expect(listed[1]).toHaveTextContent("Updated Alpine Shell Jacket description");
    expect(listed[2]).toHaveTextContent("Added policy Returns");
    expect(versions.getByText("Scenarios stay on v3 until you repoint them.")).toBeVisible();
    expectNotRefused(versions.getByRole("button", { name: "Publish v4" }));
  });

  it("walks the review back without publishing anything", async () => {
    await openOverview();

    await userEvent.click(
      await screen.findByRole("button", { name: "Review 3 changes & publish" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    expect(screen.queryByRole("button", { name: "Publish v4" })).toBeNull();
    expect(screen.getByRole("button", { name: "Review 3 changes & publish" })).toBeInTheDocument();
  });

  it("publishes from the review and offers to point a scenario at what it froze", async () => {
    await openOverview();

    await userEvent.click(
      await screen.findByRole("button", { name: "Review 3 changes & publish" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish v4" }));

    const versions = within(card("Versions of this shop"));
    expect(await versions.findByText(/v4 is published\./)).toBeVisible();
    expect(versions.getByRole("link", { name: /Point a scenario at v4/ })).toHaveAttribute(
      "href",
      "/lab/bench",
    );
    // The timeline was read again, so the version just frozen is on it.
    await waitFor(() => expect(versions.getByRole("link", { name: "v4" })).toBeVisible());
  });

  it("does not congratulate a shop whose draft has moved on since", async () => {
    // The notice claims "your draft matches v4", and an operator who publishes and then edits
    // must not come back to it. Every state is designed for.
    await openOverview();
    await userEvent.click(
      await screen.findByRole("button", { name: "Review 3 changes & publish" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish v4" }));
    expect(await screen.findByText(/v4 is published\./)).toBeVisible();

    // An unsaved edit made anywhere in the shop, through the draft this shell holds.
    await userEvent.click(await screen.findByRole("link", { name: "Open catalog" }));
    await userEvent.click(await screen.findByRole("button", { name: "New product" }));
    await userEvent.click(screen.getByRole("link", { name: "Overview" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    expect(screen.queryByText(/v4 is published\./)).toBeNull();
    expect(
      within(card("Versions of this shop")).getByText(
        /Save the draft first — publishing freezes the saved draft/,
      ),
    ).toBeVisible();
  });

  it("keeps the keyboard on the control each press replaces", async () => {
    // Both presses unmount the control that made them, so without help focus falls to the
    // document and a reader tabs back in from the top of the rail.
    await openOverview();

    await userEvent.click(
      await screen.findByRole("button", { name: "Review 3 changes & publish" }),
    );
    expect(screen.getByRole("button", { name: "Publish v4" })).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("button", { name: "Review 3 changes & publish" })).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "Review 3 changes & publish" }));
    await userEvent.click(screen.getByRole("button", { name: "Publish v4" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Point a scenario at v4/ })).toHaveFocus(),
    );
  });

  it("says it is checking the draft while the gate has not answered for what was saved", async () => {
    // A save lands and the gate is asked again about what it wrote. Until it answers, the
    // reasons it gave were about the draft before, so Publish waits and says what for.
    let previews = 0;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/draft/preview`, async () => {
        previews += 1;
        if (previews > 1) {
          await held;
        }
        return HttpResponse.json(currentPreview);
      }),
      http.put(`*/api/v1/shops/${SHOP_ID}/draft`, async ({ request }) => {
        const body = (await request.json()) as { payload: ShopDraftResponse["content"] };
        return HttpResponse.json({
          shop_id: SHOP_ID,
          lifecycle_state: "draft",
          content: body.payload,
          created_at: "2026-08-23T12:00:00+00:00",
          updated_at: "2026-08-23T12:06:00+00:00",
        } satisfies ShopDraftResponse);
      }),
    );
    await openOverview();
    expect(within(card("Versions of this shop")).queryByText("Checking the draft…")).toBeNull();

    // An unsaved edit made elsewhere in the shop, saved from the overview's own header.
    await userEvent.click(await screen.findByRole("link", { name: "Open catalog" }));
    await userEvent.click(await screen.findByRole("button", { name: "New product" }));
    await userEvent.click(screen.getByRole("link", { name: "Overview" }));
    await userEvent.click(await screen.findByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(previews).toBe(2));
    // The overview was drawn again on the way back, so its card is read again here.
    const versions = within(card("Versions of this shop"));
    const review = await versions.findByRole("button", { name: "Review 3 changes & publish" });
    await waitFor(() => expect(versions.getByText("Checking the draft…")).toBeVisible());
    expectBusy(review);
    expect(review).toHaveAccessibleDescription("Checking the draft…");

    release();
    await waitFor(() => expect(versions.queryByText("Checking the draft…")).toBeNull());
    expectNotRefused(review);
  });

  it("refuses the review while the gate refuses, and says why", async () => {
    currentPreview = preview({ publishable: false });
    await openOverview();

    const versions = within(card("Versions of this shop"));
    expectRefused(
      versions.getByRole("button", { name: "Review 3 changes & publish" }),
      "Resolve 2 error(s) to publish.",
    );
    expect(versions.getByText("Resolve 2 error(s) to publish.")).toBeVisible();
    expect(versions.getByText("1 warning(s) do not block publication.")).toBeVisible();
  });

  it("offers nothing to review when the draft matches what is published", async () => {
    currentPreview = preview({
      issues: [],
      changes: [],
      latest_published_version: 3,
      next_version: 4,
      matches_latest_published: true,
    });
    await openOverview();

    const publish = screen.getByRole("button", { name: "Publish v4" });
    expectRefused(publish, /there is nothing new to freeze/);
    expect(screen.getByText(/there is nothing\s+new to freeze/)).toBeVisible();
  });
});

describe("findings on the draft", () => {
  it("groups them on the entry that is wrong and opens that entry", async () => {
    await openOverview();
    const findings = within(card("Findings on the draft"));

    const jacket = findings.getByText("Alpine Shell Jacket").closest("li");
    expect(jacket).not.toBeNull();
    expect(within(jacket as HTMLElement).getByText("2 errors")).toBeVisible();
    expect(within(jacket as HTMLElement).getByRole("link", { name: /Open/ })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/products/alpine-shell-jacket`,
    );
    // Both of the product's findings are under it, in the gate's own words.
    expect(jacket).toHaveTextContent("variant NS-ASJ-CH-XL is missing a price");
    expect(jacket).toHaveTextContent("product Alpine Shell Jacket has no sellable variant");
  });

  it("sends a finding about a section to the page that edits it", async () => {
    await openOverview();
    const findings = within(card("Findings on the draft"));

    expect(findings.getByRole("link", { name: "Open FAQ" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/setup/policies?kind=faq`,
    );
    expect(findings.getByText("1 warning")).toBeVisible();
  });

  it("says so when the gate is refusing nothing", async () => {
    currentPreview = preview({ issues: [] });
    await openOverview();

    expect(within(card("Findings on the draft")).getByText(/No validation findings/)).toBeVisible();
  });
});

describe("the readiness card", () => {
  it("names the published scenario a comparison would run, and the way into one", async () => {
    await openOverview();
    const run = within(card("Run a comparison"));

    expect(run.getByText(/A comparison runs/)).toBeVisible();
    expect(run.getByText("Wrong shipping address v1")).toBeVisible();
    expect(run.getByText("v3")).toBeVisible();
    expect(run.getByRole("link", { name: "New experiment" })).toHaveAttribute("href", "/lab/bench");
  });

  it("claims no readiness, because the gates a run passes are not read here", async () => {
    // A comparison also needs two arms on published agent configurations, which
    // `start_experiment` refuses without and which this page never lists. The card names what
    // a run would be *of*; it never says one can be started (ADR 0044, ADR 0045).
    await openOverview();

    const run = within(card("Run a comparison"));
    expect(run.queryByText(/Everything this needs is ready/)).toBeNull();
    // No word on this card says the lab is ready for anything.
    expect(card("Run a comparison").textContent).not.toMatch(/\bready\b/i);
  });

  it("says what is missing and links to the prerequisite when nothing is published", async () => {
    currentScenarios = scenario(null);
    await openOverview();
    const run = within(card("Run a comparison"));

    expect(run.getByText(/No scenario is published in this shop yet/)).toBeVisible();
    expect(run.getByRole("link", { name: "Open scenarios" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/scenarios`,
    );
    expect(run.queryByRole("link", { name: "New experiment" })).toBeNull();
  });

  it("reads one listing and says one sentence — no checklist, no progress", async () => {
    // ADR 0044 refused a stored checklist and ADR 0045 removed the derived strip. This card
    // is the only readiness the overview reports, and it is a fact about one listing.
    currentScenarios = scenario(null);
    await openOverview();

    const run = within(card("Run a comparison"));
    expect(run.getAllByRole("paragraph")).toHaveLength(1);
    expect(run.getAllByRole("link")).toHaveLength(1);
    // Nothing on this page ticks a step or reports a proportion of one.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

describe("what this shop holds", () => {
  it("counts four listings and opens each, judging none of them", async () => {
    await openOverview();
    const holds = within(card("What this shop holds"));
    const row = (label: string) => holds.getByText(label).closest("li") as HTMLElement;

    // The figures are the listings' own, read once they have all answered: two products off
    // the draft, no orders, one ticket, one scenario. A zero is a real count and is drawn
    // (`docs/design-direction.md`, *Lists and counts*).
    await waitFor(() => {
      expect(row("Orders")).toHaveTextContent(/^0Orders/);
      expect(row("Tickets")).toHaveTextContent(/^1Tickets/);
    });
    expect(row("Products")).toHaveTextContent(/^2Products/);
    expect(row("Products")).toHaveTextContent("2 sellable variants across them.");
    expect(row("Scenarios")).toHaveTextContent(/^1Scenarios/);

    expect(holds.getByRole("link", { name: "Open catalog" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/products`,
    );
    expect(holds.getByRole("link", { name: "Open tickets" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/tickets`,
    );
  });

  it("draws no figure for a listing that could not be read", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () =>
        HttpResponse.json(
          { code: "unavailable", message: "The ticket service is unavailable.", request_id: "r" },
          { status: 503 },
        ),
      ),
    );
    await openOverview();
    const holds = within(card("What this shop holds"));

    await waitFor(() => expect(holds.getByText("Scenarios").closest("li")).toHaveTextContent("1"));
    // A figure the payload lacks is not faked, and a failed read is not a zero.
    expect(holds.getByText("Tickets").closest("li")).not.toHaveTextContent("0");
  });
});

describe("recent activity", () => {
  it("is the three most recent things, newest first, each on its own clock", async () => {
    await openOverview();
    const activity = within(card("Recent activity"));

    const rows = await waitFor(() => {
      const found = activity.getAllByRole("listitem");
      expect(found).toHaveLength(3);
      return found;
    });
    expect(rows[0]).toHaveTextContent("Experiment Pydantic AI vs control started");
    expect(rows[1]).toHaveTextContent("Scenario Wrong shipping address updated");
    expect(rows[2]).toHaveTextContent("Ticket T-204 from Maya Laurent, updated");
    expect(within(rows[0]).getByRole("link", { name: "Pydantic AI vs control" })).toHaveAttribute(
      "href",
      `/lab/bench/${SHOP_ID}/${EXPERIMENT_ID}`,
    );
  });

  it("says nothing has happened rather than drawing an empty list", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments`, () =>
        HttpResponse.json({ experiments: [] }),
      ),
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () => HttpResponse.json({ scenarios: [] })),
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () => HttpResponse.json({ tickets: [] })),
    );
    await openOverview();

    expect(
      await within(card("Recent activity")).findByText(
        /Nothing has been authored in this shop yet/,
      ),
    ).toBeVisible();
  });
});
