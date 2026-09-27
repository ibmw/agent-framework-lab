import type {
  AgentConfigurationResourcesResponse,
  LabStatusResponse,
  ModelConnectionSource,
  ModelConnectionTestRequest,
  ModelConnectionTestResponse,
  ProviderConnectionListResponse,
  SaveModelConnectionRequest,
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
} from "@agent-lab/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppShell } from "./shell/AppShell";
import { renderApp, wholeDescription } from "./test/app";
import { expectBusy, expectNotRefused, expectRefused } from "./test/refused";
import { shellListings } from "./test/shell";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";

const shops: ShopListResponse = {
  shops: [
    {
      shop_id: SHOP_ID,
      name: "Northstar Outfitters",
      slug: "northstar",
      updated_at: "2026-08-23T12:05:00+00:00",
      latest_published_version: 1,
      published_version_count: 1,
      logo: null,
    },
  ],
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
  logo: null,
};

const shopDraft: ShopDraftResponse = {
  shop_id: SHOP_ID,
  lifecycle_state: "draft",
  content: CONTENT,
  created_at: "2026-08-23T12:00:00+00:00",
  updated_at: "2026-08-23T12:05:00+00:00",
};

const shopPreview: ShopPreviewResponse = {
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

const resources: AgentConfigurationResourcesResponse = {
  frameworks: [
    {
      framework_id: "pydantic-ai",
      label: "Pydantic AI",
      summary: "The lab's first support adapter.",
      architectures: ["single_agent"],
      providers: ["openai"],
      models: ["gpt-5-mini"],
      capabilities: ["tool_calls", "structured_output"],
    },
    {
      framework_id: "fake",
      label: "Deterministic fake",
      summary: "Offline adapter with no model call.",
      architectures: ["single_agent"],
      providers: ["fake"],
      models: ["deterministic"],
      capabilities: ["tool_calls"],
    },
  ],
  tools: [],
  variables: [],
  support_identities: [],
  preview_shops: [],
};

const OFFLINE: LabStatusResponse = {
  run_mode: "offline",
  // Which answer of ADR 0052's resolution chain is in force. Four members, and the read-only
  // zone draws a sentence for each.
  connection_source: "none",
  model_id: "gpt-5-mini",
  trace_export_configured: false,
};

const BROKEN = {
  code: "internal_error",
  message: "The lab could not complete the request.",
  request_id: "r",
};

let currentStatus: LabStatusResponse = OFFLINE;

/** A lab that has been pointed nowhere: the one provider that can hold a connection, holding none. */
const UNCONFIGURED: ProviderConnectionListResponse = {
  providers: [{ provider_id: "openai", connection: null }],
};

function pointedAt(
  base_url: string,
  over: { key_configured?: boolean; key_added_at?: string | null } = {},
): ProviderConnectionListResponse {
  return {
    providers: [
      {
        provider_id: "openai",
        connection: {
          provider_id: "openai",
          base_url,
          key_configured: over.key_configured ?? false,
          key_added_at: over.key_added_at ?? null,
          created_at: "2026-09-19T14:07:00+00:00",
          updated_at: "2026-09-19T14:07:00+00:00",
        },
      },
    ],
  };
}

let currentConnections: ProviderConnectionListResponse = UNCONFIGURED;

const server = setupServer(
  http.get("*/api/v1/model-connections", () => HttpResponse.json(currentConnections)),
  http.get("*/api/v1/shops", () => HttpResponse.json(shops)),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft`, () => HttpResponse.json(shopDraft)),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft/preview`, () => HttpResponse.json(shopPreview)),
  http.get(`*/api/v1/shops/${SHOP_ID}/versions`, () => HttpResponse.json({ versions: [] })),
  // The shop's overview reads its experiments for the activity card (PLAN-UX Slice 15).
  http.get(`*/api/v1/shops/${SHOP_ID}/experiments`, () => HttpResponse.json({ experiments: [] })),
  http.get("*/api/v1/lab-status", () => HttpResponse.json(currentStatus)),
  http.get("*/api/v1/agent-configurations/resources", () => HttpResponse.json(resources)),
  // The shop and lab shells read every listing their rail counts (ADR 0056). Last, so a
  // handler this suite declares for one of these routes still wins.
  ...shellListings(),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  currentStatus = OFFLINE;
  currentConnections = UNCONFIGURED;
  window.localStorage.clear();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function renderAt(path: string) {
  return renderApp(path);
}

/**
 * The read-only zone is a collapsed disclosure, so every assertion about what it reports opens
 * it first. That is the zone's own behaviour rather than a fixture: a lab's composition is the
 * thing on this page an operator least often needs and can least often act on.
 */
async function openRuntime(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /^Runtime configuration/ }));
}

describe("the settings zones", () => {
  it("tells its zones apart by role and by heading", async () => {
    renderAt("/settings");

    expect(await screen.findByRole("heading", { level: 1, name: "Lab settings" })).toBeVisible();
    for (const name of [/^Your preferences/, /^Model provider/, /^Runtime configuration/]) {
      expect(screen.getByRole("region", { name })).toBeVisible();
      expect(screen.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    // The fast path is a zone of its own because it is an action, not a setting (ADR 0047).
    expect(screen.getByRole("region", { name: "The fast path" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "The fast path" })).toBeVisible();
  });

  it("puts what cannot be edited behind a disclosure, and says where each one is changed", async () => {
    const user = userEvent.setup();
    renderAt("/settings");

    // Collapsed: the three read-outs are not on the page at all until they are asked for.
    const disclosure = await screen.findByRole("button", { name: /^Runtime configuration/ });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Run mode" })).toBeNull();

    await user.click(disclosure);

    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    for (const name of ["Run mode", "Trace export", "What this build can run"]) {
      const card = within(screen.getByRole("region", { name }));
      // A card that says it cannot be edited here without saying where it can be is a dead
      // end, so each one ends in the variable or the file that does change it (ADR 0044).
      expect(card.getByText(/^To change it:/)).toBeVisible();
    }
  });

  it("returns to what was underneath, and to the shops index when nothing was", async () => {
    const workspace = renderAt(`/shops/${SHOP_ID}/products`);
    expect(await screen.findByRole("heading", { level: 1, name: "Products" })).toBeVisible();
    workspace.unmount();

    const remembered = renderAt("/settings");
    // The same remembered location the bar's own toggle reads, not a second mechanism
    // (ADR 0055) — so the page and the chrome cannot disagree about what was underneath.
    expect(await screen.findByRole("link", { name: "Back to workspace" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/products`,
    );
    remembered.unmount();

    window.localStorage.clear();
    renderAt("/settings");
    expect(await screen.findByRole("link", { name: "Back to workspace" })).toHaveAttribute(
      "href",
      "/shops",
    );
  });
});

describe("your preferences", () => {
  it("writes where the app opens, and reads it back after a reload", async () => {
    const user = userEvent.setup();
    const first = renderAt("/settings");

    const opening = within(await screen.findByRole("group", { name: "Where the app opens" }));
    expect(opening.getByRole("radio", { name: "Last shop" })).toBeChecked();
    await user.click(opening.getByRole("radio", { name: "Experiment lab" }));
    first.unmount();

    renderAt("/settings");
    const reloaded = within(await screen.findByRole("group", { name: "Where the app opens" }));
    expect(reloaded.getByRole("radio", { name: "Experiment lab" })).toBeChecked();
  });

  it("opens the app where the preference says it should", async () => {
    const user = userEvent.setup();
    const settings = renderAt("/settings");

    const opening = within(await screen.findByRole("group", { name: "Where the app opens" }));
    await user.click(opening.getByRole("radio", { name: "Experiment lab" }));
    settings.unmount();

    // The slice's own evidence: choose to open on the lab, and the next visit does.
    renderAt("/");
    expect(await screen.findByRole("heading", { level: 1, name: "New experiment" })).toBeVisible();
  });

  it("writes the timestamp format, and reads it back after a reload", async () => {
    const user = userEvent.setup();
    const first = renderAt("/settings");

    const stamps = within(await screen.findByRole("group", { name: "Timestamps" }));
    expect(stamps.getByRole("radio", { name: "Relative" })).toBeChecked();
    await user.click(stamps.getByRole("radio", { name: "Absolute" }));
    first.unmount();

    renderAt("/settings");
    const reloaded = within(await screen.findByRole("group", { name: "Timestamps" }));
    expect(reloaded.getByRole("radio", { name: "Absolute" })).toBeChecked();
  });

  it("carries the timestamp format out to a listing it does not draw", async () => {
    const user = userEvent.setup();
    const settings = renderAt("/settings");

    const relative = renderAt("/shops");
    expect(await screen.findAllByText(/ago$/)).not.toHaveLength(0);
    relative.unmount();

    const stamps = within(
      await within(settings.container).findByRole("group", { name: "Timestamps" }),
    );
    await user.click(stamps.getByRole("radio", { name: "Absolute" }));
    settings.unmount();

    // The slice's own evidence: set timestamps to absolute and every listing quotes a date.
    renderAt("/shops");
    const table = await screen.findByRole("table");
    expect(within(table).getByText(/^\d{1,2} \w{3,4} 2026, \d{2}:\d{2}$/)).toBeVisible();
    expect(within(table).queryByText(/ago$/)).toBeNull();
  });

  it("remembers the rail preference across a reload and defaults to expanded", async () => {
    const user = userEvent.setup();
    const first = renderAt("/settings");

    const preference = await screen.findByRole("checkbox", {
      name: /Start with the navigation rail collapsed/,
    });
    expect(preference).not.toBeChecked();
    await user.click(preference);
    first.unmount();

    renderAt("/settings");
    expect(
      await screen.findByRole("checkbox", { name: /Start with the navigation rail collapsed/ }),
    ).toBeChecked();
  });

  it("asks before anything is deleted until told not to, and says what it never allows", async () => {
    const user = userEvent.setup();
    const first = renderAt("/settings");

    const preference = await screen.findByRole("checkbox", {
      name: "Confirm before anything is deleted",
    });
    expect(preference).toBeChecked();
    // The prototype's sentence, in the control's accessible description rather than beside it.
    expect(preference).toHaveAccessibleDescription(
      wholeDescription(
        "Turning this off removes the second press on deletes. A published shop version and a recorded run are never deletable, whichever way this is set.",
      ),
    );
    await user.click(preference);
    first.unmount();

    renderAt("/settings");
    expect(
      await screen.findByRole("checkbox", { name: "Confirm before anything is deleted" }),
    ).not.toBeChecked();
  });

  it("falls back to the default when the browser refuses stored preferences", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });

    renderAt("/settings");

    const preference = await screen.findByRole("checkbox", {
      name: /Start with the navigation rail collapsed/,
    });
    expect(preference).not.toBeChecked();
    // The choice still applies for this session even though nothing can be written down.
    await userEvent.click(preference);
    expect(preference).toBeChecked();
  });

  it("puts back the four an operator chose and leaves the shop they were in", async () => {
    const user = userEvent.setup();
    const workspace = renderAt(`/shops/${SHOP_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    workspace.unmount();

    renderAt("/settings");
    const opening = within(await screen.findByRole("group", { name: "Where the app opens" }));
    await user.click(opening.getByRole("radio", { name: "All shops" }));
    const stamps = within(screen.getByRole("group", { name: "Timestamps" }));
    await user.click(stamps.getByRole("radio", { name: "Absolute" }));
    await user.click(
      screen.getByRole("checkbox", { name: /Start with the navigation rail collapsed/ }),
    );
    await user.click(screen.getByRole("checkbox", { name: /Confirm before anything is deleted/ }));

    await user.click(screen.getByRole("button", { name: "Reset to defaults" }));

    expect(
      screen.getByRole("checkbox", { name: /Confirm before anything is deleted/ }),
    ).toBeChecked();

    expect(opening.getByRole("radio", { name: "Last shop" })).toBeChecked();
    expect(stamps.getByRole("radio", { name: "Relative" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Start with the navigation rail collapsed/ }),
    ).not.toBeChecked();
    // The shop the shell recorded is not a preference anybody set, and it has its own control.
    expect(await screen.findByRole("link", { name: "Northstar Outfitters" })).toBeVisible();
  });

  it("offers the shop the operator was last in, and forgets it on request", async () => {
    const user = userEvent.setup();
    const workspace = renderAt(`/shops/${SHOP_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    workspace.unmount();

    renderAt("/settings");
    const row = within(await screen.findByRole("group", { name: "Last-visited shop" }));
    expect(row.getByRole("link", { name: "Northstar Outfitters" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}`,
    );

    await user.click(row.getByRole("button", { name: "Forget Northstar Outfitters" }));

    expect(row.queryByRole("link")).toBeNull();
    expect(row.getByText(/None yet\. Open a shop/)).toBeVisible();
    // Forgetting drops the shop and rewrites no choice: `/` already falls back to the shops
    // index with nothing remembered (ADR 0054).
    expect(
      within(screen.getByRole("group", { name: "Where the app opens" })).getByRole("radio", {
        name: "Last shop",
      }),
    ).toBeChecked();
  });

  it("does not remember a shop it could not open", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/draft`, () =>
        HttpResponse.json({ ...BROKEN, code: "shop_not_found" }, { status: 404 }),
      ),
    );
    const workspace = renderAt(`/shops/${SHOP_ID}`);
    expect(await screen.findByRole("alert")).toBeVisible();
    workspace.unmount();

    server.resetHandlers();
    renderAt("/settings");
    const row = within(await screen.findByRole("group", { name: "Last-visited shop" }));
    expect(await row.findByText(/None yet\. Open a shop/)).toBeVisible();
  });

  it("does not claim there is no remembered shop before the shop list answers", async () => {
    server.use(http.get("*/api/v1/shops", () => new Promise<never>(() => {})));
    renderAt("/settings");

    const row = within(await screen.findByRole("group", { name: "Last-visited shop" }));
    expect(row.getByText("Reading…")).toBeVisible();
    expect(row.queryByText(/None yet/)).toBeNull();
  });
});

describe("the model provider zone", () => {
  function zone() {
    return within(screen.getByRole("region", { name: "Model provider" }));
  }

  async function openZone() {
    // The zone reads the provider listing, so nothing in it is assertable until that lands.
    expect(await screen.findByRole("group", { name: "Endpoint preset" })).toBeVisible();
    return zone();
  }

  it("offers the six presets and lights the one the saved endpoint belongs to", async () => {
    currentConnections = pointedAt("http://localhost:11434/v1");
    renderAt("/settings");

    const presets = within(await screen.findByRole("group", { name: "Endpoint preset" }));
    for (const label of ["OpenAI", "Ollama", "vLLM", "OpenRouter", "Together AI", "Custom"]) {
      expect(presets.getByRole("radio", { name: label })).toBeVisible();
    }
    // Derived from the endpoint in the field rather than remembered beside it, so the page
    // cannot hold two answers to where the lab is pointed.
    expect(presets.getByRole("radio", { name: "Ollama" })).toBeChecked();
    expect(zone().getByLabelText("Base URL")).toHaveValue("http://localhost:11434/v1");
  });

  it("falls back to Custom for an endpoint no preset names", async () => {
    currentConnections = pointedAt("https://gateway.internal/openai/v1");
    renderAt("/settings");

    const presets = within(await screen.findByRole("group", { name: "Endpoint preset" }));
    expect(presets.getByRole("radio", { name: "Custom" })).toBeChecked();
  });

  it("draws no model field, because the connection holds none", async () => {
    currentConnections = pointedAt("https://api.openai.com/v1");
    renderAt("/settings");
    const card = await openZone();

    // ADR 0052 refuses a model on the connection at length: the model is authored content
    // resolved from each arm's published configuration (ADR 0024). The prototype's *Default
    // model* row is a recorded departure, not an omission.
    expect(card.queryByLabelText(/model/i)).toBeNull();
    expect(card.queryByText(/Default model/i)).toBeNull();
    expect(card.queryByText(/gpt-5-mini/)).toBeNull();
  });

  it("says a key is configured and when, and never anything else about it", async () => {
    currentConnections = pointedAt("https://api.openai.com/v1", {
      key_configured: true,
      key_added_at: "2026-09-19T14:07:00+00:00",
    });
    renderAt("/settings");
    const card = await openZone();

    const row = within(card.getByRole("group", { name: "API key" }));
    expect(row.getByText(/^Configured /)).toBeVisible();
    expect(row.getByRole("button", { name: "Replace" })).toBeVisible();

    // Never a mask. The response carries `key_configured` and `key_added_at` and no other
    // fact about the key — not a prefix, a suffix, a length or a hash — so there is nothing
    // on this page a mask could have been drawn from, and nothing that resembles one.
    const written = card.getByRole("group", { name: "API key" }).textContent ?? "";
    expect(written).not.toMatch(/[•*]{2,}|·{3,}|…[A-Za-z0-9]{4}|sk-[A-Za-z0-9]/);
    expect(written).not.toMatch(/\bmask(ed)?\b|\bending\b|\blast four\b|\bcharacters long\b/i);
    // And no control that would reveal one: there is no read route for the key at all.
    expect(card.queryByRole("button", { name: /reveal|show/i })).toBeNull();
    // The configured key is a read-out, not a field: nothing here is typed into until
    // *Replace* is pressed.
    expect(row.queryByLabelText(/API key/)).toBeNull();
  });

  it("asks for a key rather than showing one when none is installed", async () => {
    currentConnections = pointedAt("http://localhost:11434/v1");
    renderAt("/settings");
    const card = await openZone();

    const typed = card.getByLabelText(/^API key/);
    expect(typed).toHaveValue("");
    expect(typed).toHaveAttribute("type", "password");
    // `off` is ignored on a password field, and a password manager would fill a login
    // password in here for the form to send to the endpoint.
    expect(typed).toHaveAttribute("autocomplete", "new-password");
    expect(card.queryByText(/^Configured /)).toBeNull();
  });

  it("opens a field when Replace is pressed, and puts the read-out back on Discard", async () => {
    const user = userEvent.setup();
    currentConnections = pointedAt("https://api.openai.com/v1", {
      key_configured: true,
      key_added_at: "2026-09-19T14:07:00+00:00",
    });
    renderAt("/settings");
    const card = await openZone();

    await user.click(card.getByRole("button", { name: "Replace" }));
    await user.type(card.getByLabelText("New API key"), "sk-typed");

    await user.click(card.getByRole("button", { name: "Discard" }));
    expect(card.getByText(/^Configured /)).toBeVisible();
    // The field is gone rather than emptied: Discard puts back what the lab holds, which is
    // a key it will not show and a row that says only that one is installed.
    expect(card.queryByPlaceholderText("sk-…")).toBeNull();
  });

  it("offers Save and Discard only once there is something to save", async () => {
    const user = userEvent.setup();
    currentConnections = pointedAt("http://localhost:11434/v1");
    renderAt("/settings");
    const card = await openZone();

    expect(card.queryByRole("button", { name: "Save connection" })).toBeNull();
    expect(card.queryByRole("button", { name: "Discard" })).toBeNull();

    await user.click(card.getByRole("radio", { name: "vLLM" }));

    expectNotRefused(card.getByRole("button", { name: "Save connection" }));
    await user.click(card.getByRole("button", { name: "Discard" }));

    expect(card.getByLabelText("Base URL")).toHaveValue("http://localhost:11434/v1");
    expect(card.queryByRole("button", { name: "Save connection" })).toBeNull();
  });

  it("refuses to save with nothing to reach, and says so where the press was refused", async () => {
    const user = userEvent.setup();
    let requests = 0;
    server.use(
      http.put("*/api/v1/model-connections/openai", () => {
        requests += 1;
        return HttpResponse.json(currentConnections.providers[0]);
      }),
    );
    currentConnections = pointedAt("http://localhost:11434/v1");
    renderAt("/settings");
    const card = await openZone();

    await user.clear(card.getByLabelText("Base URL"));

    const save = card.getByRole("button", { name: "Save connection" });
    expectRefused(save, /No base URL to reach/);
    expectRefused(card.getByRole("button", { name: "Test connection" }), /No base URL to reach/);
    // At the validation weight, which is the weight every refusal reads at (ADR 0063).
    expect(card.getByText(/No base URL to reach/)).toHaveClass(
      "text-[13px]",
      "font-semibold",
      "text-lab-error",
    );

    // Reachable, and a press sends nothing.
    await user.click(save);
    save.focus();
    await user.keyboard("{Enter}");
    expect(save).toHaveFocus();
    expect(requests).toBe(0);
  });

  it.each([
    ["a no-break and an ideographic space", "\u00a0\u3000"],
    ["a next-line control", "\x85"],
    ["the information separators", "\x1c\x1d\x1e\x1f"],
  ])("refuses a field of only whitespace as having nothing to reach: %s", async (_, blank) => {
    // The endpoint is sent as typed, so the refusal cannot rest on a trimmed copy of it, and
    // it strips what the server's "must not be empty" strips — which JavaScript's `trim()`
    // does not, for NEL and the four separators. A url field already drops ASCII whitespace
    // from its ends, so each of these is what it would keep.
    const user = userEvent.setup();
    currentConnections = pointedAt("http://localhost:11434/v1");
    renderAt("/settings");
    const card = await openZone();

    await user.clear(card.getByLabelText("Base URL"));
    await user.type(card.getByLabelText("Base URL"), blank);
    expect(card.getByLabelText("Base URL")).toHaveValue(blank);

    const save = card.getByRole("button", { name: "Save connection" });
    expectRefused(save, /No base URL to reach/);
    expectRefused(card.getByRole("button", { name: "Test connection" }), /No base URL to reach/);
  });

  it("saves what was typed, and reads back the endpoint the lab stored", async () => {
    const user = userEvent.setup();
    const sent: SaveModelConnectionRequest[] = [];
    server.use(
      http.put("*/api/v1/model-connections/openai", async ({ request }) => {
        sent.push((await request.json()) as SaveModelConnectionRequest);
        currentConnections = pointedAt("http://localhost:11434/v1", {
          key_configured: true,
          key_added_at: "2026-09-23T09:00:00+00:00",
        });
        return HttpResponse.json(currentConnections.providers[0]);
      }),
    );
    renderAt("/settings");
    const card = await openZone();

    await user.click(card.getByRole("radio", { name: "Ollama" }));
    // The trailing slash is the operator's paste; the lab stores one spelling of an endpoint
    // because a run is pinned to it, and the field shows what was stored rather than what
    // was typed.
    await user.type(card.getByLabelText("Base URL"), "/");
    await user.type(card.getByLabelText(/^API key/), "sk-typed");
    await user.click(card.getByRole("button", { name: "Save connection" }));

    await screen.findByText(/^Configured /);
    expect(sent).toEqual([{ base_url: "http://localhost:11434/v1/", api_key: "sk-typed" }]);
    expect(card.getByLabelText("Base URL")).toHaveValue("http://localhost:11434/v1");
    expect(card.queryByRole("button", { name: "Save connection" })).toBeNull();
  });

  it("leaves the key out of a save that only moved the endpoint", async () => {
    const user = userEvent.setup();
    const sent: SaveModelConnectionRequest[] = [];
    currentConnections = pointedAt("https://api.openai.com/v1", {
      key_configured: true,
      key_added_at: "2026-09-19T14:07:00+00:00",
    });
    server.use(
      http.put("*/api/v1/model-connections/openai", async ({ request }) => {
        sent.push((await request.json()) as SaveModelConnectionRequest);
        return HttpResponse.json(
          pointedAt("https://openrouter.ai/api/v1", {
            key_configured: true,
            key_added_at: "2026-09-19T14:07:00+00:00",
          }).providers[0],
        );
      }),
    );
    renderAt("/settings");
    const card = await openZone();

    await user.click(card.getByRole("radio", { name: "OpenRouter" }));
    await user.click(card.getByRole("button", { name: "Save connection" }));

    // An absent key keeps the stored one, which is what lets an operator move an endpoint
    // without retyping a credential the lab will never show them.
    await waitFor(() =>
      expect(sent).toEqual([{ base_url: "https://openrouter.ai/api/v1", api_key: null }]),
    );
  });

  it("reads back the lab's own refusal rather than refusing on its own account", async () => {
    const user = userEvent.setup();
    server.use(
      http.put("*/api/v1/model-connections/openai", () =>
        HttpResponse.json(
          {
            code: "invalid_model_connection",
            message:
              "base_url may only use http for a loopback or private host, so that a key is " +
              "never sent to a public endpoint in plaintext; use https instead",
            request_id: "r",
          },
          { status: 422 },
        ),
      ),
    );
    renderAt("/settings");
    const card = await openZone();

    // The page has no opinion about base URLs: `domain/model_connection.py` decides what may
    // be stored, and a second gate here would stop matching the one that decides.
    await user.type(card.getByLabelText("Base URL"), "http://api.example.com/v1");
    expectNotRefused(card.getByRole("button", { name: "Save connection" }));
    await user.click(card.getByRole("button", { name: "Save connection" }));

    expect(await card.findByRole("alert")).toHaveTextContent(/only use http for a loopback/);
  });

  const PROBES: readonly (readonly [ModelConnectionTestResponse, RegExp])[] = [
    [
      { outcome: "reachable", latency_ms: 312, status_class: "2xx" },
      /Answered and accepted the key · 312 ms · 2xx/,
    ],
    [
      { outcome: "refused", latency_ms: 180, status_class: "4xx" },
      /Answered and rejected the key · 180 ms · 4xx/,
    ],
    [
      { outcome: "unreachable", latency_ms: 5001, status_class: null },
      /Nothing usable answered · 5001 ms/,
    ],
  ];

  it.each(PROBES)("reports what one probe established (%o)", async (answer, written) => {
    const user = userEvent.setup();
    currentConnections = pointedAt("http://localhost:11434/v1");
    server.use(
      http.post("*/api/v1/model-connections/openai/test", () => HttpResponse.json(answer)),
    );
    renderAt("/settings");
    const card = await openZone();

    await user.click(card.getByRole("button", { name: "Test connection" }));

    expect(await card.findByText(written)).toBeVisible();
  });

  it("says it is reaching the endpoint while it waits", async () => {
    const user = userEvent.setup();
    currentConnections = pointedAt("http://localhost:11434/v1");
    let answer: (value: ModelConnectionTestResponse) => void = () => {};
    server.use(
      http.post("*/api/v1/model-connections/openai/test", async () => {
        return HttpResponse.json(
          await new Promise<ModelConnectionTestResponse>((resolve) => {
            answer = resolve;
          }),
        );
      }),
    );
    renderAt("/settings");
    const card = await openZone();

    await user.click(card.getByRole("button", { name: "Test connection" }));
    expectBusy(await card.findByRole("button", { name: "Reaching the endpoint…" }));

    answer({ outcome: "reachable", latency_ms: 900, status_class: "2xx" });
    expect(await card.findByText(/900 ms/)).toBeVisible();
  });

  it("drops an answer about an endpoint that is no longer the one on the page", async () => {
    const user = userEvent.setup();
    currentConnections = pointedAt("http://localhost:11434/v1");
    server.use(
      http.post("*/api/v1/model-connections/openai/test", () =>
        HttpResponse.json({ outcome: "reachable", latency_ms: 312, status_class: "2xx" }),
      ),
    );
    renderAt("/settings");
    const card = await openZone();

    await user.click(card.getByRole("button", { name: "Test connection" }));
    expect(await card.findByText(/312 ms/)).toBeVisible();

    // A reachability answer is true of one endpoint at one moment (ADR 0052). Pointing the
    // zone somewhere else makes it an answer about a connection that is no longer the one in
    // front of the operator, and a green tick left standing would be read as a promise about
    // the new one.
    await user.click(card.getByRole("radio", { name: "vLLM" }));
    expect(card.queryByText(/312 ms/)).toBeNull();
  });

  it("drops an answer that lands after the endpoint moved under it", async () => {
    const user = userEvent.setup();
    currentConnections = pointedAt("http://localhost:11434/v1");
    let answer: (value: ModelConnectionTestResponse) => void = () => {};
    server.use(
      http.post("*/api/v1/model-connections/openai/test", async () => {
        return HttpResponse.json(
          await new Promise<ModelConnectionTestResponse>((resolve) => {
            answer = resolve;
          }),
        );
      }),
    );
    renderAt("/settings");
    const card = await openZone();

    await user.click(card.getByRole("button", { name: "Test connection" }));
    await card.findByRole("button", { name: "Reaching the endpoint…" });

    // The case clearing the result on edit does not cover: the reply lands *after* the move,
    // so without a token the verdict about Ollama would be painted onto vLLM.
    await user.click(card.getByRole("radio", { name: "vLLM" }));
    answer({ outcome: "reachable", latency_ms: 312, status_class: "2xx" });

    await waitFor(() => expectNotRefused(card.getByRole("button", { name: "Test connection" })));
    expect(card.queryByText(/312 ms/)).toBeNull();
    expect(card.queryByText(/Answered/)).toBeNull();
  });

  /** Every body `POST …/test` was sent, in order, answering each as reachable. */
  function captureProbes(): ModelConnectionTestRequest[] {
    const sent: ModelConnectionTestRequest[] = [];
    server.use(
      http.post("*/api/v1/model-connections/openai/test", async ({ request }) => {
        sent.push((await request.json()) as ModelConnectionTestRequest);
        return HttpResponse.json({ outcome: "reachable", latency_ms: 312, status_class: "2xx" });
      }),
    );
    return sent;
  }

  it("tests under the stored key by sending none, rather than anything of its own", async () => {
    // The route falls back to the stored key when `api_key` is null (ADR 0052). Anything
    // else here would be a credential the page made up, sent to the endpoint by the server.
    const user = userEvent.setup();
    currentConnections = pointedAt("https://api.openai.com/v1", {
      key_configured: true,
      key_added_at: "2026-09-19T14:07:00+00:00",
    });
    const sent = captureProbes();
    renderAt("/settings");
    const card = await openZone();

    await user.click(card.getByRole("button", { name: "Test connection" }));

    await card.findByText(/312 ms/);
    expect(sent).toEqual([{ base_url: "https://api.openai.com/v1", api_key: null }]);
  });

  it("tests under the key being typed, trimmed, and under no key once it is cleared", async () => {
    const user = userEvent.setup();
    currentConnections = pointedAt("http://localhost:11434/v1");
    const sent = captureProbes();
    renderAt("/settings");
    const card = await openZone();

    await user.type(card.getByLabelText(/^API key/), "  sk-typed  ");
    await user.click(card.getByRole("button", { name: "Test connection" }));
    await card.findByText(/312 ms/);

    await user.clear(card.getByLabelText(/^API key/));
    await user.click(card.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(sent).toHaveLength(2));

    expect(sent).toEqual([
      { base_url: "http://localhost:11434/v1", api_key: "sk-typed" },
      { base_url: "http://localhost:11434/v1", api_key: null },
    ]);
  });

  it("does not carry a key typed for one endpoint to the next preset picked", async () => {
    // A preset pick drops a key *typed* for the last endpoint, which would otherwise be sent
    // to the new one. It does no more than that: where a key is stored, the server falls back
    // to it (ADR 0052), and the row says so — "says the installed key goes wherever…" below.
    const user = userEvent.setup();
    const sent = captureProbes();
    renderAt("/settings");
    const card = await openZone();

    await user.click(card.getByRole("radio", { name: "OpenAI" }));
    await user.type(card.getByLabelText(/^API key/), "sk-for-openai");
    await user.click(card.getByRole("radio", { name: "OpenRouter" }));

    expect(card.getByLabelText(/^API key/)).toHaveValue("");
    await user.click(card.getByRole("button", { name: "Test connection" }));
    await waitFor(() =>
      expect(sent).toEqual([{ base_url: "https://openrouter.ai/api/v1", api_key: null }]),
    );
  });

  it("keeps the key while the endpoint is only being retyped", async () => {
    // Only a preset pick drops a typed key. Typing in Base URL leaves it, and the key row says
    // where it will go once the endpoint is not the saved one.
    const user = userEvent.setup();
    const sent = captureProbes();
    renderAt("/settings");
    const card = await openZone();

    await user.click(card.getByRole("radio", { name: "OpenAI" }));
    await user.type(card.getByLabelText(/^API key/), "sk-for-openai");
    await user.type(card.getByLabelText("Base URL"), "/");
    await user.click(card.getByRole("button", { name: "Test connection" }));

    await waitFor(() =>
      expect(sent).toEqual([{ base_url: "https://api.openai.com/v1/", api_key: "sk-for-openai" }]),
    );
  });

  it("puts the stored key's read-out back when a preset is picked mid-replacement", async () => {
    const user = userEvent.setup();
    currentConnections = pointedAt("https://api.openai.com/v1", {
      key_configured: true,
      key_added_at: "2026-09-19T14:07:00+00:00",
    });
    renderAt("/settings");
    const card = await openZone();

    await user.click(card.getByRole("button", { name: "Replace" }));
    await user.type(card.getByLabelText("New API key"), "sk-for-openai");
    await user.click(card.getByRole("radio", { name: "OpenRouter" }));

    expect(card.getByText(/^Configured /)).toBeVisible();
    expect(card.queryByPlaceholderText("sk-…")).toBeNull();
  });

  it("offers the way back to the stored key once Replace is pressed", async () => {
    // Replace with nothing typed changes nothing that would be saved, so the pair is not
    // drawn — and without a way back the row would be an empty optional field reading as
    // though no key were stored, while one is, and is used.
    const user = userEvent.setup();
    currentConnections = pointedAt("https://api.openai.com/v1", {
      key_configured: true,
      key_added_at: "2026-09-19T14:07:00+00:00",
    });
    renderAt("/settings");
    const card = await openZone();

    await user.click(card.getByRole("button", { name: "Replace" }));
    const row = within(card.getByRole("group", { name: "API key" }));
    expect(row.getByText(/installed key is kept, and used/)).toBeVisible();

    await user.click(row.getByRole("button", { name: "Keep the current key" }));

    expect(card.getByText(/^Configured /)).toBeVisible();
    expect(card.queryByPlaceholderText("sk-…")).toBeNull();
    expect(card.queryByRole("button", { name: "Discard" })).toBeNull();
  });

  it("keeps an endpoint being typed when the operator keeps the stored key", async () => {
    const user = userEvent.setup();
    currentConnections = pointedAt("https://api.openai.com/v1", {
      key_configured: true,
      key_added_at: "2026-09-19T14:07:00+00:00",
    });
    renderAt("/settings");
    const card = await openZone();

    await user.type(card.getByLabelText("Base URL"), "/");
    await user.click(card.getByRole("button", { name: "Replace" }));
    await user.click(card.getByRole("button", { name: "Keep the current key" }));

    expect(card.getByLabelText("Base URL")).toHaveValue("https://api.openai.com/v1/");
  });

  it("says in the key's own row that a stored key cannot be read, and what to do", async () => {
    // `key_configured` reports presence and never readability, so the row alone would say
    // *Configured* beside a key that reaches nothing. ADR 0052's amendment: the lab "wins as
    // an offline lab, with a source that names the remedy" — named here, where it is acted on,
    // and not only inside the collapsed read-out below.
    currentStatus = { ...OFFLINE, connection_source: "saved_unreadable" };
    currentConnections = pointedAt("https://api.openai.com/v1", {
      key_configured: true,
      key_added_at: "2026-09-19T14:07:00+00:00",
    });
    renderAt("/settings");
    const card = await openZone();

    const row = within(card.getByRole("group", { name: "API key" }));
    expect(await row.findByText("Stored, but this lab cannot read it")).toBeVisible();
    // Both causes, because they have different remedies: an unset variable refuses the save
    // outright with 422, and a moved one needs the key saved again under the new one.
    expect(row.getByText(/AGENT_LAB_CREDENTIAL_KEY is unset, or is not the one/)).toBeVisible();
    expect(row.queryByText(/^Configured/)).toBeNull();
    expect(row.getByRole("button", { name: "Replace" })).toBeEnabled();
  });

  it("does not promise that an unreadable key is used once Replace is pressed", async () => {
    // The server resolves an undecryptable key to nothing at all, so leaving the field empty
    // keeps the lab offline rather than keeping a key in use.
    const user = userEvent.setup();
    currentStatus = { ...OFFLINE, connection_source: "saved_unreadable" };
    currentConnections = pointedAt("https://api.openai.com/v1", {
      key_configured: true,
      key_added_at: "2026-09-19T14:07:00+00:00",
    });
    renderAt("/settings");
    const card = await openZone();
    const row = within(card.getByRole("group", { name: "API key" }));
    await row.findByText("Stored, but this lab cannot read it");

    await user.click(row.getByRole("button", { name: "Replace" }));

    const replacing = within(card.getByRole("group", { name: "API key" }));
    expect(
      replacing.getByText(/leaving this empty keeps it and the lab stays offline/),
    ).toBeVisible();
    expect(replacing.queryByText(/kept, and used/)).toBeNull();
  });

  it("says the installed key goes wherever the endpoint has moved, and stops saying so", async () => {
    // ADR 0052: a save or a test with no key falls back to the saved one. So moving the
    // endpoint with the read-out showing sends the installed key somewhere new, and the row
    // says so rather than letting a preset pick look as though it left the key behind.
    const user = userEvent.setup();
    currentConnections = pointedAt("https://api.openai.com/v1", {
      key_configured: true,
      key_added_at: "2026-09-19T14:07:00+00:00",
    });
    renderAt("/settings");
    const card = await openZone();
    const stored = /installed key will be sent to this endpoint on Test, and kept for it on Save/;
    expect(card.queryByText(stored)).toBeNull();

    await user.click(card.getByRole("radio", { name: "OpenRouter" }));
    expect(card.getByText(stored)).toBeVisible();

    await user.clear(card.getByLabelText("Base URL"));
    await user.type(card.getByLabelText("Base URL"), "https://api.openai.com/v1/");
    // The same endpoint in another spelling is not a move.
    expect(card.queryByText(stored)).toBeNull();
  });

  it("does not say an unreadable key will be sent anywhere when the endpoint moves", async () => {
    // Test is refused with credential_key_mismatch, so no key is sent: a line promising the
    // installed key goes to the new endpoint would describe a call that is not made.
    const user = userEvent.setup();
    currentStatus = { ...OFFLINE, connection_source: "saved_unreadable" };
    currentConnections = pointedAt("https://api.openai.com/v1", {
      key_configured: true,
      key_added_at: "2026-09-19T14:07:00+00:00",
    });
    renderAt("/settings");
    const card = await openZone();
    await card.findByText("Stored, but this lab cannot read it");

    await user.click(card.getByRole("radio", { name: "OpenRouter" }));

    expect(card.getByRole("radio", { name: "OpenRouter" })).toBeChecked();
    expect(card.queryByText(/will be sent to this endpoint/)).toBeNull();
  });

  it("says a save keeps an unreadable key for the endpoint it moves to, and stops saying so", async () => {
    // Save with no key typed re-points the stored ciphertext at the new endpoint, and once the
    // right AGENT_LAB_CREDENTIAL_KEY is back that key is sent there. The row says so rather than
    // letting the move read as though it left the key behind.
    const user = userEvent.setup();
    currentStatus = { ...OFFLINE, connection_source: "saved_unreadable" };
    currentConnections = pointedAt("https://api.openai.com/v1", {
      key_configured: true,
      key_added_at: "2026-09-19T14:07:00+00:00",
    });
    renderAt("/settings");
    const card = await openZone();
    await card.findByText("Stored, but this lab cannot read it");
    const kept =
      /stored key cannot be read now, but Save keeps it for this endpoint; it will be sent here once it can be/;
    expect(card.queryByText(kept)).toBeNull();

    await user.click(card.getByRole("radio", { name: "OpenRouter" }));
    expect(within(card.getByRole("group", { name: "API key" })).getByText(kept)).toBeVisible();

    await user.click(card.getByRole("radio", { name: "OpenAI" }));
    expect(card.queryByText(kept)).toBeNull();
  });

  it("says a typed key goes to the endpoint in the field, once that is not the saved one", async () => {
    const user = userEvent.setup();
    currentConnections = pointedAt("http://localhost:11434/v1");
    renderAt("/settings");
    const card = await openZone();
    const typed = /key typed here will be sent to this endpoint on Test, and saved for it on Save/;

    await user.type(card.getByLabelText(/^API key/), "sk-typed");
    expect(card.queryByText(typed)).toBeNull();

    await user.type(card.getByLabelText("Base URL"), "/chat");
    expect(card.getByText(typed)).toBeVisible();

    await user.click(card.getByRole("button", { name: "Discard" }));
    expect(card.queryByText(typed)).toBeNull();
  });

  it("offers nothing to save for another spelling of the saved endpoint", async () => {
    const user = userEvent.setup();
    currentConnections = pointedAt("https://api.openai.com/v1");
    renderAt("/settings");
    const card = await openZone();

    for (const spelling of ["https://api.openai.com/v1/", "HTTPS://API.OPENAI.COM:443/v1"]) {
      await user.clear(card.getByLabelText("Base URL"));
      await user.type(card.getByLabelText("Base URL"), spelling);
      expect(card.queryByRole("button", { name: "Save connection" }), spelling).toBeNull();
    }
    await user.type(card.getByLabelText("Base URL"), "/chat");
    expectNotRefused(card.getByRole("button", { name: "Save connection" }));
  });

  it.each([
    ["a leading", "﻿https://api.openai.com/v1"],
    ["a trailing", "https://api.openai.com/v1﻿"],
  ])("sends the endpoint whose chip is lit, with %s byte-order mark", async (_, typed) => {
    // The server keeps a byte-order mark that JavaScript's `trim()` removes, so a page that
    // trimmed before sending lit Custom and then saved the OpenAI preset. The value goes as
    // typed, and the server alone decides what it is.
    const user = userEvent.setup();
    const probes = captureProbes();
    const saves: SaveModelConnectionRequest[] = [];
    server.use(
      http.put("*/api/v1/model-connections/openai", async ({ request }) => {
        saves.push((await request.json()) as SaveModelConnectionRequest);
        return HttpResponse.json(
          {
            code: "invalid_model_connection",
            message: "base_url must use the http or https scheme",
            request_id: "r",
          },
          { status: 422 },
        );
      }),
    );
    renderAt("/settings");
    const card = await openZone();

    await user.type(card.getByLabelText("Base URL"), typed);
    expect(card.getByRole("radio", { name: "Custom" })).toBeChecked();
    await user.click(card.getByRole("button", { name: "Test connection" }));
    await card.findByText(/312 ms/);
    await user.click(card.getByRole("button", { name: "Save connection" }));

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(probes.map((probe) => probe.base_url)).toEqual([typed]);
    expect(saves.map((save) => save.base_url)).toEqual([typed]);
    expect(card.getByRole("radio", { name: "Custom" })).toBeChecked();
  });

  it("offers to save a stored endpoint the lab would now spell another way", async () => {
    // Stored before the server's fold reached a fixed point: the chip is Ollama, but saving it
    // again stores `…/v1`, so the form is not clean. Test sends what is stored, and the server
    // probes the spelling it would now store.
    const user = userEvent.setup();
    currentConnections = pointedAt("http://localhost:11434/v1 ");
    const sent = captureProbes();
    renderAt("/settings");
    const card = await openZone();

    expect(card.getByRole("radio", { name: "Ollama" })).toBeChecked();
    expectNotRefused(card.getByRole("button", { name: "Save connection" }));
    await user.click(card.getByRole("button", { name: "Test connection" }));

    await waitFor(() =>
      expect(sent).toEqual([{ base_url: "http://localhost:11434/v1 ", api_key: null }]),
    );
  });

  it("says a readable stored key is configured, and nothing about readability", async () => {
    currentStatus = { ...OFFLINE, run_mode: "credentialed", connection_source: "saved" };
    currentConnections = pointedAt("https://api.openai.com/v1", {
      key_configured: true,
      key_added_at: "2026-09-19T14:07:00+00:00",
    });
    renderAt("/settings");
    const card = await openZone();

    // The status arrives on its own request, so wait for the page to have read it.
    await screen.findByRole("button", { name: /^Runtime configuration/ });
    const row = within(card.getByRole("group", { name: "API key" }));
    expect(row.getByText(/^Configured /)).toBeVisible();
    expect(row.queryByText(/cannot read/)).toBeNull();
  });

  it.each([
    ["environment", /runs on AGENT_LAB_OPENAI_API_KEY from the API's environment/],
    ["none", /environment holds no key, so this lab reaches no provider/],
  ] as const)("says what is in force on a lab running on %s", async (source, written) => {
    // The form opens on Custom and an empty Base URL, which reads as *pointed nowhere*
    // whether or not the environment is pointing the lab somewhere.
    currentStatus = {
      ...OFFLINE,
      run_mode: source === "environment" ? "credentialed" : "offline",
      connection_source: source,
    };
    renderAt("/settings");
    await openZone();

    expect(await zone().findByText(written)).toBeVisible();
  });

  it("says nothing above the form once a readable connection is saved", async () => {
    currentStatus = { ...OFFLINE, run_mode: "credentialed", connection_source: "saved" };
    currentConnections = pointedAt("http://localhost:11434/v1");
    renderAt("/settings");
    await openZone();

    await screen.findByRole("button", { name: /^Runtime configuration/ });
    await waitFor(() => expect(zone().queryByText(/Nothing is saved here yet/)).toBeNull());
  });

  it("writes why Test is refused from the start, where a keyboard reader can find it", async () => {
    // *A blocked primary action says why*: in `title` and inline, and the control stays
    // reachable so a keyboard reader who lands on it is told (ADR 0063).
    renderAt("/settings");
    const card = await openZone();

    const test = card.getByRole("button", { name: "Test connection" });
    expectRefused(test, /No base URL to reach/);
    expect(test).toHaveAttribute("title", expect.stringMatching(/No base URL to reach/));
    expect(test).toHaveAccessibleDescription(/No base URL to reach/);
    expect(card.getByText(/No base URL to reach/)).not.toHaveClass("sr-only");
  });

  /** A save that waits for the test to answer it, and every body it was sent. */
  function holdSave() {
    const sent: SaveModelConnectionRequest[] = [];
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.put("*/api/v1/model-connections/openai", async ({ request }) => {
        sent.push((await request.json()) as SaveModelConnectionRequest);
        await released;
        return HttpResponse.json(pointedAt("http://localhost:11434/v1").providers[0]);
      }),
    );
    return { sent, release };
  }

  it("sends one save for a press, however often Save is pressed while it is in flight", async () => {
    const user = userEvent.setup();
    const { sent, release } = holdSave();
    renderAt("/settings");
    const card = await openZone();

    await user.click(card.getByRole("radio", { name: "Ollama" }));
    await user.click(card.getByRole("button", { name: "Save connection" }));
    const saving = await card.findByRole("button", { name: "Saving…" });
    await user.click(saving);
    await user.click(saving);

    release();
    await waitFor(() => expect(card.queryByRole("button", { name: "Save connection" })).toBeNull());
    expect(sent).toHaveLength(1);
  });

  it("neither tests nor opens the key while a save is in flight", async () => {
    // Replace mid-save would open a field the read-back then closes over whatever was typed,
    // and a probe mid-save asks about a connection that is being replaced.
    const user = userEvent.setup();
    currentConnections = pointedAt("https://api.openai.com/v1", {
      key_configured: true,
      key_added_at: "2026-09-19T14:07:00+00:00",
    });
    const probes = captureProbes();
    const { release } = holdSave();
    renderAt("/settings");
    const card = await openZone();

    await user.click(card.getByRole("radio", { name: "OpenRouter" }));
    await user.click(card.getByRole("button", { name: "Save connection" }));
    await card.findByRole("button", { name: "Saving…" });

    await user.click(card.getByRole("button", { name: "Replace" }));
    await user.click(card.getByRole("button", { name: "Test connection" }));
    expect(card.queryByPlaceholderText("sk-…")).toBeNull();
    expect(probes).toEqual([]);

    release();
    await waitFor(() => expect(card.queryByRole("button", { name: "Save connection" })).toBeNull());
  });

  it("does not put the key back while a save of a new one is in flight", async () => {
    const user = userEvent.setup();
    currentConnections = pointedAt("https://api.openai.com/v1", {
      key_configured: true,
      key_added_at: "2026-09-19T14:07:00+00:00",
    });
    const { sent, release } = holdSave();
    renderAt("/settings");
    const card = await openZone();

    await user.click(card.getByRole("button", { name: "Replace" }));
    await user.type(card.getByLabelText("New API key"), "sk-new");
    await user.click(card.getByRole("button", { name: "Save connection" }));
    await card.findByRole("button", { name: "Saving…" });

    await user.click(card.getByRole("button", { name: "Keep the current key" }));
    expect(card.getByLabelText("New API key")).toHaveValue("sk-new");
    expect(sent).toEqual([{ base_url: "https://api.openai.com/v1", api_key: "sk-new" }]);

    release();
    await waitFor(() => expect(card.queryByRole("button", { name: "Save connection" })).toBeNull());
  });

  it("takes no edit while a save is in flight, so the read-back cannot overwrite one", async () => {
    // The save reads back the stored endpoint and writes it into the form. An edit made
    // while it was in flight would be silently replaced by that read-back.
    const user = userEvent.setup();
    const { release } = holdSave();
    renderAt("/settings");
    const card = await openZone();

    await user.click(card.getByRole("radio", { name: "Ollama" }));
    await user.type(card.getByLabelText(/^API key/), "sk-typed");
    await user.click(card.getByRole("button", { name: "Save connection" }));
    await card.findByRole("button", { name: "Saving…" });

    await user.type(card.getByLabelText("Base URL"), "/chat");
    await user.type(card.getByLabelText(/^API key/), "-more");
    await user.click(card.getByRole("radio", { name: "vLLM" }));
    expect(card.getByLabelText("Base URL")).toHaveValue("http://localhost:11434/v1");
    expect(card.getByLabelText(/^API key/)).toHaveValue("sk-typed");
    expect(card.getByRole("button", { name: "Discard" })).toBeDisabled();

    release();
    await waitFor(() => expect(card.queryByRole("button", { name: "Save connection" })).toBeNull());
  });

  it("stops reading rather than reading forever when the listing fails", async () => {
    server.use(
      http.get("*/api/v1/model-connections", () => HttpResponse.json(BROKEN, { status: 500 })),
    );
    renderAt("/settings");

    const provider = within(await screen.findByRole("region", { name: "Model provider" }));
    expect(await provider.findByRole("alert")).toBeVisible();
    expect(provider.queryByText("Reading…")).toBeNull();
  });
});

describe("the runtime read-out", () => {
  it("reports what this build has been proven able to run", async () => {
    const user = userEvent.setup();
    renderAt("/settings");
    await openRuntime(user);

    const build = await screen.findByRole("region", { name: "What this build can run" });
    expect(await within(build).findByText("Pydantic AI")).toBeVisible();
    const [pydantic, control] = within(build).getAllByRole("listitem");

    // The card is an `h3` under the zone's `h2`, so a framework row is an `h4`: a row that
    // announced itself as the card's sibling would say the wrong thing about what holds what.
    expect(
      within(build).getByRole("heading", { level: 3, name: "What this build can run" }),
    ).toBeVisible();
    expect(within(pydantic).getByRole("heading", { level: 4, name: "Pydantic AI" })).toBeVisible();

    expect(within(pydantic).getByText("pydantic-ai", { selector: "code" })).toBeVisible();
    expect(within(pydantic).getByText("Single agent")).toBeVisible();
    // The provider under the workspace's one spelling of it, not the wire's word.
    expect(within(pydantic).getByText("OpenAI · gpt-5-mini")).toBeVisible();
    expect(within(pydantic).getByText("structured output")).toBeVisible();

    // The envelope is per framework, so a reader learns what the control arm cannot do
    // without first being refused by the publish gate.
    expect(within(control).getByText("Deterministic fake")).toBeVisible();
    expect(within(control).getByText("Deterministic control · deterministic")).toBeVisible();
    expect(within(control).queryByText("structured output")).toBeNull();
  });

  it("does not claim the gate blocks a model the way it blocks a provider", async () => {
    const user = userEvent.setup();
    renderAt("/settings");
    await openRuntime(user);

    // An unlisted model is `model_not_exercised`, a warning; only the framework, architecture
    // and provider are errors. A page that said otherwise would be a second, stricter gate.
    const build = await screen.findByRole("region", { name: "What this build can run" });
    expect(
      within(build).getByText(/naming a model outside it is a warning that does not block/),
    ).toBeVisible();
  });

  it("states the offline limit as what this build can actually advance", async () => {
    const user = userEvent.setup();
    renderAt("/settings");
    await openRuntime(user);

    const runMode = await screen.findByRole("region", { name: "Run mode" });
    expect(await within(runMode).findByText("Offline")).toBeVisible();
    expect(within(runMode).getByText("gpt-5-mini", { selector: "code" })).toBeVisible();
    // Offline this process registers one experiment runtime, so a two-arm framework
    // comparison is refused rather than run with identical decisions. The surface that sent
    // an operator to author one would be describing `make seed`'s composition, not this one.
    expect(
      within(runMode).getByText(/only the deterministic control arm can be advanced here/),
    ).toBeVisible();
    expect(within(runMode).getByText(/refused the moment it is advanced/)).toBeVisible();
    expect(within(runMode).getByText(/establishes is the evidence model/)).toBeVisible();
    expect(
      within(runMode).getByText(/Only a credentialed run answers how two frameworks actually/),
    ).toBeVisible();
    expect(
      within(runMode).queryByText(/every framework runs against its own offline model/i),
    ).toBeNull();
  });

  it("drops the offline limit once the lab reaches an endpoint", async () => {
    const user = userEvent.setup();
    currentStatus = {
      run_mode: "credentialed",
      connection_source: "environment",
      model_id: "gpt-5-mini",
      trace_export_configured: true,
    };
    renderAt("/settings");
    await openRuntime(user);

    const runMode = await screen.findByRole("region", { name: "Run mode" });
    expect(await within(runMode).findByText("Credentialed")).toBeVisible();
    expect(within(runMode).queryByText(/only the deterministic control arm/)).toBeNull();
    expect(within(runMode).getByText(/a model-backed arm reaches the provider/)).toBeVisible();
  });

  it("relabels the model read-out as the one the POC's conversations reach for", async () => {
    const user = userEvent.setup();
    renderAt("/settings");
    await openRuntime(user);

    // ADR 0052 requires the relabelling: a row called *Configured model* beside a connection
    // an operator can edit reads as the model an experiment runs, and what an experiment ran
    // is the model its published agent configuration named (ADR 0024).
    const runMode = within(await screen.findByRole("region", { name: "Run mode" }));
    expect(await runMode.findByText(/Conversation model/)).toBeVisible();
    expect(runMode.queryByText(/Configured model/)).toBeNull();
    expect(runMode.getByText(/a connection holds none at all/)).toBeVisible();
  });

  /**
   * Four answers, not the two ADR 0052's *Decision* names: its amendment of 2026-09-22
   * narrows that sentence, because the chain has four states and two of them are the same
   * run mode. The table is written out rather than derived, so a fifth member arrives with a
   * row here or not at all; `lib/modelConnections.test.ts` holds the sentences to the
   * contract's own enum.
   */
  const SOURCES: readonly (readonly [
    ModelConnectionSource,
    LabStatusResponse["run_mode"],
    RegExp,
  ])[] = [
    ["saved", "credentialed", /The connection saved in Model provider above is in force/],
    ["saved_unreadable", "offline", /cannot read its key back/],
    [
      "environment",
      "credentialed",
      /AGENT_LAB_OPENAI_API_KEY from the API's environment is in force/,
    ],
    ["none", "offline", /No connection is saved and AGENT_LAB_OPENAI_API_KEY is not set/],
  ];

  it.each(SOURCES)("says that %s is what is in force", async (source, run_mode, written) => {
    const user = userEvent.setup();
    currentStatus = { ...OFFLINE, run_mode, connection_source: source };
    renderAt("/settings");
    await openRuntime(user);

    const runMode = within(await screen.findByRole("region", { name: "Run mode" }));
    expect(await runMode.findByText(written)).toBeVisible();
  });

  it("tells a key it cannot read from a lab that was never pointed anywhere", async () => {
    const user = userEvent.setup();
    currentStatus = { ...OFFLINE, connection_source: "saved_unreadable" };
    renderAt("/settings");
    await openRuntime(user);

    // Both are offline, and only one of them has a remedy. `key_configured` reports a key's
    // presence and never its readability, so an operator whose AGENT_LAB_CREDENTIAL_KEY has
    // moved would otherwise read *Offline* beside a key the page says is installed.
    const runMode = within(await screen.findByRole("region", { name: "Run mode" }));
    expect(await runMode.findByText("Offline")).toBeVisible();
    expect(runMode.getByText(/Save the key again in Model provider above/)).toBeVisible();
    expect(runMode.getByText(/AGENT_LAB_CREDENTIAL_KEY this API is running with/)).toBeVisible();
  });

  it("says where run mode is changed now that a connection outranks the environment", async () => {
    const user = userEvent.setup();
    renderAt("/settings");
    await openRuntime(user);

    // Composition moved from start-up to the request (ADR 0052), so the card that used to say
    // "read once at start-up; nothing on this page moves it" would now be describing a
    // different lab. The zone above moves it, and the environment is the bootstrap behind it.
    const runMode = within(await screen.findByRole("region", { name: "Run mode" }));
    const change = runMode.getByText(/^To change it:/);
    expect(change).toHaveTextContent(/save a connection in Model provider above/);
    expect(change).toHaveTextContent(/with none saved, set/);
    expect(change).not.toHaveTextContent(/Read once at start-up/);
  });

  it("re-reads run mode when a connection is saved, rather than leaving an answer behind", async () => {
    const user = userEvent.setup();
    server.use(
      http.put("*/api/v1/model-connections/openai", () => {
        currentStatus = { ...OFFLINE, run_mode: "credentialed", connection_source: "saved" };
        currentConnections = pointedAt("http://localhost:11434/v1");
        return HttpResponse.json(currentConnections.providers[0]);
      }),
    );
    renderAt("/settings");
    await openRuntime(user);
    expect(await within(screen.getByRole("region", { name: "Run mode" })).findByText("Offline"));

    const zone = within(await screen.findByRole("region", { name: "Model provider" }));
    await user.click(zone.getByRole("radio", { name: "Ollama" }));
    await user.click(zone.getByRole("button", { name: "Save connection" }));

    // Run mode is a per-request answer now: a lab can go from offline to credentialed while
    // an operator is looking at it, and the reading the page took at mount is stale the
    // moment they press Save.
    const runMode = within(screen.getByRole("region", { name: "Run mode" }));
    expect(await runMode.findByText("Credentialed")).toBeVisible();
    expect(
      runMode.getByText(/The connection saved in Model provider above is in force/),
    ).toBeVisible();
  });

  it("names the Phoenix path while nothing exports traces", async () => {
    const user = userEvent.setup();
    renderAt("/settings");
    await openRuntime(user);

    const traces = await screen.findByRole("region", { name: "Trace export" });
    expect(await within(traces).findByText(/No OTLP endpoint is configured/)).toBeVisible();
    expect(within(traces).getByText("infra/phoenix/compose.yaml")).toBeVisible();
    expect(within(traces).getByText("http://localhost:6006")).toBeVisible();
    // The whole variable, not a clipped one: it is the longest string on this page and the
    // card it sits in hides its overflow.
    expect(
      within(traces).getByText(
        "AGENT_LAB_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6006/v1/traces",
      ),
    ).toBeVisible();
  });

  it("reports an exporter without naming the endpoint or over-promising the allowlist", async () => {
    const user = userEvent.setup();
    currentStatus = { ...OFFLINE, trace_export_configured: true };
    renderAt("/settings");
    await openRuntime(user);

    const traces = await screen.findByRole("region", { name: "Trace export" });
    expect(await within(traces).findByText(/An OTLP endpoint is configured/)).toBeVisible();
    expect(within(traces).getByText(/The endpoint itself is not reported here/)).toBeVisible();
    // The allowlist covers the spans the lab opens. An SDK exporting its own is a path this
    // project does not write and cannot promise the sanitization of.
    expect(within(traces).getByText(/No free-form string of the lab's own is/)).toBeVisible();
  });

  it("keeps run mode readable when the framework listing fails", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/v1/agent-configurations/resources", () =>
        HttpResponse.json(BROKEN, { status: 500 }),
      ),
    );
    renderAt("/settings");
    await openRuntime(user);

    // Run mode needs no database and must not fall with a listing that does.
    const runMode = await screen.findByRole("region", { name: "Run mode" });
    expect(await within(runMode).findByText("Offline")).toBeVisible();

    const build = screen.getByRole("region", { name: "What this build can run" });
    expect(within(build).getByRole("alert")).toBeVisible();
    expect(within(build).queryByText("Reading…")).toBeNull();
    // One failure, one alert: the page does not repeat a message the card already carries.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("stops reading rather than reading forever when composition cannot be reported", async () => {
    const user = userEvent.setup();
    server.use(http.get("*/api/v1/lab-status", () => HttpResponse.json(BROKEN, { status: 500 })));
    renderAt("/settings");
    await openRuntime(user);

    const runMode = await screen.findByRole("region", { name: "Run mode" });
    expect(await within(runMode).findByRole("alert")).toBeVisible();
    expect(within(runMode).queryByText("Reading…")).toBeNull();
    expect(
      within(screen.getByRole("region", { name: "Trace export" })).getByRole("alert"),
    ).toBeVisible();
    // The framework table answered, so it is still readable.
    expect(
      within(screen.getByRole("region", { name: "What this build can run" })).getByText(
        "Pydantic AI",
      ),
    ).toBeVisible();
  });
});

describe("the lab's other frameless surfaces", () => {
  it("defines the words the application uses on screen", async () => {
    renderAt("/glossary");

    expect(await screen.findByRole("heading", { name: "Glossary" })).toBeVisible();
    const terms = screen.getByRole("region", { name: "Vocabulary" });
    expect(within(terms).getByText("Objective block")).toBeVisible();
    expect(
      within(terms).getByText(/shop-independent objective template/, { exact: false }),
    ).toBeVisible();
    expect(within(terms).getByText("Sandbox snapshot")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Back to guides" })).toBeNull();
  });

  it("sends the retired guides paths where their replacements live", async () => {
    const index = renderAt("/guides");
    expect(await screen.findByRole("heading", { name: "Lab settings" })).toBeVisible();
    index.unmount();

    renderAt("/guides/setup");
    expect(await screen.findByRole("heading", { name: "Lab settings" })).toBeVisible();
  });

  it("keeps a glossary bookmark working after the guides namespace closed", async () => {
    renderAt("/guides/glossary#shop");
    expect(await screen.findByRole("heading", { name: "Glossary" })).toBeVisible();
    expect(document.getElementById("shop")).toHaveTextContent("Shop");
  });
});

function renderShell(currentShopId?: string) {
  return render(
    <MemoryRouter>
      <AppShell shops={shops.shops} currentShopId={currentShopId}>
        <p>content</p>
      </AppShell>
    </MemoryRouter>,
  );
}

describe("workspace shell", () => {
  it("reaches the lab's own surfaces from the header, inside a shop and outside one", () => {
    const outside = renderShell();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("link", { name: "Guides" })).toBeNull();
    outside.unmount();

    renderShell(SHOP_ID);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("link", { name: "Guides" })).toBeNull();
  });

  it("names the shop-scoped entry after what it edits", () => {
    renderShell(SHOP_ID);

    const rail = screen.getByRole("navigation", { name: "Shop workspace" });
    expect(within(rail).getByRole("link", { name: "Shop details" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/setup/identity`,
    );
    expect(within(rail).queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("remembers the collapsed rail across a reload", async () => {
    const first = renderShell(SHOP_ID);

    await userEvent.click(screen.getByRole("button", { name: "Collapse menu" }));
    first.unmount();

    renderShell(SHOP_ID);
    expect(screen.getByRole("button", { name: "Expand menu" })).toBeVisible();
  });
});

describe("the fast path", () => {
  const SEEDED = {
    shop_id: SHOP_ID,
    customer_id: "11111111-1111-4111-8111-111111111111",
    support_identity_id: "22222222-2222-4222-8222-222222222222",
    order_id: "33333333-3333-4333-8333-333333333333",
    ticket_id: "44444444-4444-4444-8444-444444444444",
    scenario_id: "55555555-5555-4555-8555-555555555555",
    scenario_version: 1,
    snapshot_id: "66666666-6666-4666-8666-666666666666",
    judge_id: "77777777-7777-4777-8777-777777777777",
    configuration_ids: ["88888888-8888-4888-8888-888888888888"],
    experiment_id: "99999999-9999-4999-8999-999999999999",
    run_ids: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
  };

  function emptyLab() {
    server.use(http.get("*/api/v1/shops", () => HttpResponse.json({ shops: [] })));
  }

  it("declines to offer the seed to a lab that already holds a shop", async () => {
    renderAt("/settings");

    const card = within(await screen.findByRole("region", { name: "The fast path" }));

    expect(card.getByRole("button", { name: /create the demo/i })).toBeDisabled();
    expect(card.getByRole("status")).toHaveTextContent(/not empty/i);
  });

  it("creates nothing on the first press, and the demo on the second", async () => {
    const user = userEvent.setup();
    emptyLab();
    let posted = 0;
    server.use(
      http.post("*/api/v1/lab-seed", () => {
        posted += 1;
        return HttpResponse.json(SEEDED, { status: 201 });
      }),
    );
    renderAt("/settings");
    const card = within(await screen.findByRole("region", { name: "The fast path" }));

    await user.click(card.getByRole("button", { name: "Create the demo" }));

    // A button that writes a dozen published versions should not do it on a stray click.
    expect(posted).toBe(0);

    await user.click(card.getByRole("button", { name: "Press again to create it" }));

    expect(posted).toBe(1);
    expect(await card.findByRole("link", { name: "Open the results" })).toHaveAttribute(
      "href",
      `/lab/bench/${SHOP_ID}/${SEEDED.experiment_id}/results`,
    );
    // Where the run is listed, in the words the rail and the results use for it.
    expect(card.getByText("Written. Its results are listed in History.")).toBeVisible();
  });

  it("reads back the refusal rather than reporting a failure of its own", async () => {
    const user = userEvent.setup();
    emptyLab();
    server.use(
      http.post("*/api/v1/lab-seed", () =>
        HttpResponse.json(
          {
            code: "seed_refused",
            message:
              "sqlite:///var/agent-lab.db already holds seeded data: definition_drafts (3). " +
              "To start again, delete the database file this URL points at.",
            request_id: "r",
          },
          { status: 409 },
        ),
      ),
    );
    renderAt("/settings");
    const card = within(await screen.findByRole("region", { name: "The fast path" }));

    await user.click(card.getByRole("button", { name: "Create the demo" }));
    await user.click(card.getByRole("button", { name: "Press again to create it" }));

    // The tables that stopped it and the remedy, which is the whole point of the refusal.
    expect(await card.findByRole("alert")).toHaveTextContent(/definition_drafts \(3\)/);
    expect(card.getByRole("alert")).toHaveTextContent(/delete the database file/);
  });
});
