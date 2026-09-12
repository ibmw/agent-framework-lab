import type {
  DefinitionIssueSchema,
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
} from "@agent-lab/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "./App";
import { GuideStrip } from "./components/GuideStrip";
import type { PublishGate } from "./components/WorkspaceChrome";

/**
 * The guide strip reads listings and a publish gate, so it is exercised over both.
 *
 * Nothing in these tests writes a progress flag, because nothing in the application does: a
 * step is complete because a listing holds what it asks for (ADR 0044).
 */

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";

const TONE_ISSUE: DefinitionIssueSchema = {
  code: "shop_without_tone_of_voice",
  severity: "error",
  message: "a published shop must define at least one tone-of-voice guideline",
  path: "tone_of_voice_guidelines",
};

const CONTENT: ShopDraftResponse["content"] = {
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

let shops: ShopListResponse = { shops: [] };
let preview: ShopPreviewResponse = {
  shop_id: SHOP_ID,
  publishable: false,
  issues: [TONE_ISSUE],
  changes: [],
  content_fingerprint: "a".repeat(64),
  latest_published_version: null,
  next_version: 1,
  matches_latest_published: false,
  content: CONTENT,
};
let completedExperiments = 0;

function shopSummary(latestPublishedVersion: number | null) {
  return {
    shop_id: SHOP_ID,
    name: "Northstar Outfitters",
    slug: "northstar",
    updated_at: "2026-09-12T09:41:00+00:00",
    latest_published_version: latestPublishedVersion,
    published_version_count: latestPublishedVersion === null ? 0 : latestPublishedVersion,
  };
}

const server = setupServer(
  http.get("*/api/v1/shops", () => HttpResponse.json(shops)),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft`, () =>
    HttpResponse.json({
      shop_id: SHOP_ID,
      lifecycle_state: "draft",
      content: CONTENT,
      created_at: "2026-09-12T09:41:00+00:00",
      updated_at: "2026-09-12T09:41:00+00:00",
    }),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft/preview`, () => HttpResponse.json(preview)),
  http.get(`*/api/v1/shops/${SHOP_ID}/versions`, () => HttpResponse.json({ versions: [] })),
  http.get("*/api/v1/experiments", ({ request }) => {
    const status = new URL(request.url).searchParams.get("status");
    const total = status === "completed" ? completedExperiments : 0;
    return HttpResponse.json({
      experiments: [],
      page: 1,
      page_size: 1,
      total,
      shops: [],
      scenarios: [],
      frameworks: [],
      tags: [],
    });
  }),
  // `/settings` is mounted below, and a page read in its error state would assert nothing
  // about the control it is mounted for.
  http.get("*/api/v1/lab-status", () =>
    HttpResponse.json({
      run_mode: "offline",
      model_id: "gpt-5-mini",
      trace_export_configured: false,
    }),
  ),
  http.get("*/api/v1/agent-configurations/resources", () =>
    HttpResponse.json({
      frameworks: [],
      tools: [],
      variables: [],
      support_identities: [],
      preview_shops: [],
    }),
  ),
  http.get("*/api/v1/customer-profiles", () => HttpResponse.json({ profiles: [] })),
  http.get(`*/api/v1/shops/${SHOP_ID}/orders`, () => HttpResponse.json({ orders: [] })),
  http.get(`*/api/v1/shops/${SHOP_ID}/tickets`, () => HttpResponse.json({ tickets: [] })),
  http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () => HttpResponse.json({ scenarios: [] })),
  http.get("*/api/v1/objective-blocks", () => HttpResponse.json({ blocks: [] })),
  http.get("*/api/v1/support-identities", () => HttpResponse.json({ identities: [] })),
  http.get("*/api/v1/agent-configurations", () => HttpResponse.json({ configurations: [] })),
  http.get("*/api/v1/judge-configurations", () => HttpResponse.json({ judges: [] })),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.events.removeAllListeners();
  server.resetHandlers();
  window.localStorage.clear();
  shops = { shops: [] };
  completedExperiments = 0;
  preview = { ...preview, issues: [TONE_ISSUE], latest_published_version: null, next_version: 1 };
});
afterAll(() => server.close());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

function band() {
  return screen.findByRole("region", { name: "Setup path" });
}

/**
 * Resolve once the reading that decides guide mode has been answered.
 *
 * "The band is absent" is only worth asserting after the request that would have produced it
 * has come back; without this the assertion would also hold while it was still in flight.
 */
function guideModeAnswered(): Promise<void> {
  return new Promise((resolve) => {
    server.events.on("response:mocked", ({ request }) => {
      if (request.url.includes("status=completed")) {
        resolve();
      }
    });
  });
}

describe("the derived next step", () => {
  it("tells an empty lab to create a shop, and hands over the command rather than a button", async () => {
    renderAt("/shops");

    const strip = await band();
    expect(within(strip).getByText(/Create a shop/)).toBeVisible();
    expect(within(strip).getByText("make seed", { selector: "code" })).toBeVisible();
    expect(within(strip).getByRole("link", { name: "New shop" })).toHaveAttribute(
      "href",
      "#create-shop",
    );
    // ADR 0043's refusal, held here: the band exposes no control that populates the lab.
    expect(within(strip).queryAllByRole("button")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: /seed|demo data|populate|load sample/i }),
    ).toBeNull();
  });

  it("renders the publish gate's own finding rather than a second explanation", async () => {
    shops = { shops: [shopSummary(null)] };
    renderAt(`/shops/${SHOP_ID}`);

    const strip = await band();
    expect(within(strip).getByText(/Publish Northstar Outfitters/)).toBeVisible();
    // Word for word what the authoring surface renders, from the same preview.issues.
    const validation = screen.getByRole("region", { name: "Draft validation" });
    expect(within(strip).getByText(TONE_ISSUE.message)).toBeVisible();
    expect(within(validation).getByText(TONE_ISSUE.message)).toBeVisible();
    expect(within(strip).getByText("Resolve 1 error(s) to publish.")).toBeVisible();
    // And it sends the reader to the surface the finding names.
    expect(within(strip).getByRole("link", { name: "Open tone of voice" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/setup/tone`,
    );
  });

  it("advances to the next step once the shop holds a published version", async () => {
    shops = { shops: [shopSummary(1)] };
    preview = { ...preview, issues: [], latest_published_version: 1, next_version: 2 };
    renderAt(`/shops/${SHOP_ID}`);

    const strip = await band();
    expect(within(strip).getByText(/customer profile/)).toBeVisible();
    expect(within(strip).queryByText(/Publish Northstar Outfitters/)).toBeNull();
    // The chain says which steps the record satisfies, and counts nothing.
    const chain = within(strip).getByRole("list");
    expect(within(chain).getByText("Shop")).toBeVisible();
    // The step points at the one definition of its vocabulary instead of restating it.
    expect(within(strip).getByRole("link", { name: "Customer profile" })).toHaveAttribute(
      "href",
      "/guides/glossary#customer-profile",
    );
    expect(within(strip).queryByText(/%/)).toBeNull();
    expect(within(strip).queryByText(/1 of 10|1\/10/)).toBeNull();
  });

  it("carries the gate's refusal of an unsaved draft rather than a sentence of its own", async () => {
    // The band is mounted on its own here because `dirty` is set by the shop-setup editors
    // rather than by anything on the home, and what is under test is which predicate the band
    // asks: the same `canPublish` the publish button asks.
    const clean: PublishGate = {
      publishable: true,
      issues: [],
      latest_published_version: null,
      next_version: 1,
      matches_latest_published: false,
    };
    const shop = {
      shopId: SHOP_ID,
      name: "Northstar Outfitters",
      gate: clean,
      dirty: false,
      latestPublishedVersion: null,
    };

    const saved = render(
      <MemoryRouter>
        <GuideStrip shop={shop} currentPath={`/shops/${SHOP_ID}`} />
      </MemoryRouter>,
    );
    const strip = await band();
    // Nothing is wrong with the content and nothing is unsaved, so the gate refuses nothing —
    // and the band says nothing about publishing being blocked.
    expect(within(strip).queryByText(/Resolve \d+ error/)).toBeNull();
    expect(within(strip).queryByText(/Save the draft first/)).toBeNull();
    saved.unmount();

    render(
      <MemoryRouter>
        <GuideStrip shop={{ ...shop, dirty: true }} currentPath={`/shops/${SHOP_ID}`} />
      </MemoryRouter>,
    );
    // One unsaved edit and the gate refuses again, in the words the publish control uses.
    expect(
      within(await band()).getByText(
        "Save the draft first — publishing freezes the saved draft, not unsaved edits.",
      ),
    ).toBeVisible();
  });
});

describe("guide mode", () => {
  it("is on while the lab holds no completed experiment and off once it does", async () => {
    const first = renderAt("/shops");
    expect(await band()).toBeVisible();
    first.unmount();

    completedExperiments = 1;
    const answered = guideModeAnswered();
    renderAt("/shops");
    await answered;
    await waitFor(() => expect(screen.queryByRole("region", { name: "Setup path" })).toBeNull());
    expect(screen.getByRole("heading", { name: "Shops" })).toBeVisible();
  });

  it("remembers a disagreement with the default in either direction", async () => {
    const first = renderAt("/shops");
    const strip = await band();
    await userEvent.click(within(strip).getByText("Guide mode", { selector: "summary" }));
    await userEvent.click(within(strip).getByRole("radio", { name: /Always off/ }));
    expect(screen.queryByRole("region", { name: "Setup path" })).toBeNull();
    first.unmount();

    // Stored, so the empty lab it would otherwise be on for does not bring it back — and
    // nothing is read for a band nobody is going to see.
    const second = renderAt("/shops");
    expect(await screen.findByRole("heading", { name: "Shops" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Setup path" })).toBeNull();
    second.unmount();

    // And the opposite disagreement wins over a lab that has completed a comparison.
    completedExperiments = 1;
    const settings = renderAt("/settings");
    await userEvent.click(await screen.findByRole("radio", { name: /Always on/ }));
    expect(screen.getByRole("region", { name: "Run mode" })).toBeVisible();
    settings.unmount();

    const third = renderAt("/shops");
    expect(await band()).toBeVisible();
    third.unmount();
  });

  it("offers the same three choices on the settings page", async () => {
    renderAt("/settings");

    const workspace = await screen.findByRole("region", { name: "Workspace" });
    expect(within(workspace).getByRole("radio", { name: /Follow the lab/ })).toBeChecked();
    expect(within(workspace).getByRole("radio", { name: /Always on/ })).not.toBeChecked();
    expect(within(workspace).getByRole("radio", { name: /Always off/ })).not.toBeChecked();
    expect(within(workspace).getByText(/Nothing is stored/)).toBeVisible();
  });
});

describe("the glossary", () => {
  it("defines the words the application uses on screen", async () => {
    renderAt("/guides/glossary");

    expect(await screen.findByRole("heading", { name: "Glossary" })).toBeVisible();
    const terms = screen.getByRole("region", { name: "Vocabulary" });
    expect(within(terms).getByText("Objective block")).toBeVisible();
    expect(
      within(terms).getByText(/shop-independent objective template/, { exact: false }),
    ).toBeVisible();
    expect(within(terms).getByText("Sandbox snapshot")).toBeVisible();
  });

  it("is reachable from the guides page", async () => {
    renderAt("/guides");

    expect(await screen.findByRole("link", { name: "Open the glossary" })).toHaveAttribute(
      "href",
      "/guides/glossary",
    );
  });
});
