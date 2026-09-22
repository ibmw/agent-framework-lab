import type {
  AgentConfigurationResourcesResponse,
  LabStatusResponse,
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
} from "@agent-lab/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppShell } from "./shell/AppShell";
import { renderApp } from "./test/app";
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
  // Which of the saved connection and the environment bootstrap is in force. Served by
  // `getLabStatus` and not yet drawn; the fixture carries it because the contract requires it.
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

const server = setupServer(
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

  it("holds the model provider's place without promising what is not built", async () => {
    renderAt("/settings");

    const zone = within(await screen.findByRole("region", { name: /^Model provider/ }));
    expect(zone.getByText(/Not built yet/)).toBeVisible();
    // What is in force meanwhile, and what stays in force afterwards (ADR 0052).
    expect(zone.getByText("AGENT_LAB_OPENAI_API_KEY")).toBeVisible();
    expect(zone.getByText(/the environment is the whole of it/)).toBeVisible();
    expect(zone.getByText(/saved connection wins where there is one/)).toBeVisible();
    // No control: the zone's place is drawn, and nothing on it can be pressed or typed into.
    expect(zone.queryByRole("button")).toBeNull();
    expect(zone.queryByRole("textbox")).toBeNull();
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

  it("puts back the three an operator chose and leaves the shop they were in", async () => {
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

    await user.click(screen.getByRole("button", { name: "Reset to defaults" }));

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

  it("drops the offline limit once a credential is configured", async () => {
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
    expect(await card.findByRole("link", { name: "Read the comparison" })).toHaveAttribute(
      "href",
      `/lab/bench/${SHOP_ID}/${SEEDED.experiment_id}/results`,
    );
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
