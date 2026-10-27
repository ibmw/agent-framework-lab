import type {
  AgentConfigurationDraftResponse,
  AgentConfigurationListResponse,
  AgentConfigurationPreviewResponse,
  AgentConfigurationResourcesResponse,
  AgentConfigurationVersionResponse,
  ModelConnectionSource,
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
} from "@agent-lab/contracts";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fieldRowWideControlClasses, readOnlyTextClasses } from "./lib/ui";
import { renderApp } from "./test/app";
import { labConnection } from "./test/connection";
import { expectWayBack } from "./test/header";
import { expectIndexTableScrolls, expectPublicationPill, indexCard } from "./test/indexes";
import { panelCards, panelFields, sidePanel } from "./test/panel";
import { expectNotRefused, expectRefused } from "./test/refused";
import { expectEditorOnRows, expectFieldRow, expectGroupRow } from "./test/rows";
import { bodyRows, railEntry, shellListings } from "./test/shell";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const IDENTITY_ID = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const CONFIGURATION_ID = "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9";
const OTHER_SHOP_ID = "8c7b6a59-4d3e-4f21-9807-6a5b4c3d2e1f";

const PROMPT = "You are {{support_identity.role}} for {{shop.name}}. Greet {{customer.name}}.";

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
  logo: null,
};

const CONFIGURATION: AgentConfigurationDraftResponse["content"] = {
  name: "Frontline single agent",
  description: "The lab's first published support agent.",
  framework_id: "pydantic-ai",
  architecture: "single_agent",
  support_identity_id: IDENTITY_ID,
  prompt: PROMPT,
  tone_of_voice: { source: "shop_default", guideline_id: "" },
  tools: ["orders.read_order"],
  memory: "conversation",
  model: {
    provider: "openai",
    model_id: "gpt-5-mini",
    temperature: "0.20",
    max_tool_rounds: 8,
  },
};

const RESOURCES: AgentConfigurationResourcesResponse = {
  frameworks: [
    {
      framework_id: "pydantic-ai",
      label: "Pydantic AI",
      summary: "The lab's first support adapter.",
      architectures: ["single_agent"],
      providers: ["openai"],
      models: ["gpt-5-mini", "gpt-5"],
      capabilities: ["tool_calls", "conversation_memory"],
    },
    {
      framework_id: "openai-agents",
      label: "OpenAI Agents SDK",
      summary: "The lab's second experiment framework, on the same provider as the first.",
      architectures: ["single_agent"],
      providers: ["openai"],
      models: ["gpt-5-mini"],
      capabilities: ["tool_calls", "conversation_memory"],
    },
    {
      framework_id: "fake",
      label: "Deterministic fake",
      summary: "Offline adapter with no model call.",
      architectures: ["single_agent"],
      providers: ["fake"],
      models: ["deterministic"],
      capabilities: ["tool_calls", "conversation_memory"],
    },
  ],
  tools: [
    {
      name: "orders.read_order",
      version: "v1",
      summary: "Read one order in full.",
      effect: "read",
      required_permission: null,
      arguments: [],
    },
    {
      name: "orders.propose_address_change",
      version: "v1",
      summary: "Work out what changing an order's shipping address would do.",
      effect: "write",
      required_permission: "change_shipping_address",
      arguments: [],
    },
  ],
  variables: [],
  support_identities: [
    {
      identity_id: IDENTITY_ID,
      name: "Northstar tier 1",
      title: "Customer support representative",
      permissions: ["read_orders", "read_policies"],
      latest_published_version: 1,
    },
  ],
  preview_shops: [
    {
      shop_id: SHOP_ID,
      name: "Northstar Outfitters",
      latest_published_version: 3,
      tone_of_voice_guidelines: [
        { id: "warm-precise", name: "Warm and precise" },
        { id: "brisk", name: "Brisk and factual" },
      ],
    },
    {
      shop_id: OTHER_SHOP_ID,
      name: "Southline Supply",
      latest_published_version: 1,
      tone_of_voice_guidelines: [{ id: "southline-house", name: "Southline house voice" }],
    },
  ],
};

function preview(
  overrides: Partial<AgentConfigurationPreviewResponse> = {},
): AgentConfigurationPreviewResponse {
  return {
    configuration_id: CONFIGURATION_ID,
    publishable: false,
    issues: [
      {
        severity: "error",
        code: "prompt_non_injectable_variable",
        message:
          "the prompt injects customer.name, but customer, order, and ticket facts are discovered through tools by design",
        path: "prompt",
      },
    ],
    changes: [
      { kind: "added", path: "", description: "First published version of Frontline single agent" },
    ],
    content_fingerprint: "a".repeat(64),
    latest_published_version: null,
    next_version: 1,
    matches_latest_published: false,
    content: currentConfiguration,
    resolution: {
      framework_label: "Pydantic AI",
      shop_id: SHOP_ID,
      shop_name: "Northstar Outfitters",
      shop_version: 3,
      support_identity_id: IDENTITY_ID,
      support_identity_name: "Northstar tier 1",
      support_identity_version: 1,
      tone_of_voice_label: "Warm and precise",
      tone_of_voice_resolved: true,
      variables: [
        {
          name: "shop.name",
          group: "shop",
          description: "The shop's display name.",
          injectable: true,
          used: true,
          value: "Northstar Outfitters",
        },
        {
          name: "shop.locale",
          group: "shop",
          description: "The shop's locale.",
          injectable: true,
          used: false,
          value: "en-GB",
        },
        {
          name: "support_identity.role",
          group: "support_identity",
          description: "The role title the agent adopts.",
          injectable: true,
          used: true,
          value: "Customer support representative",
        },
        {
          name: "customer.name",
          group: "interaction",
          description: "The customer's name.",
          injectable: false,
          used: true,
          value: null,
        },
      ],
      tools: [
        {
          name: "orders.read_order",
          version: "v1",
          summary: "Read one order in full.",
          effect: "read",
          required_permission: null,
          enabled: true,
          permitted: true,
        },
        {
          name: "orders.propose_address_change",
          version: "v1",
          summary: "Work out what changing an order's shipping address would do.",
          effect: "write",
          required_permission: "change_shipping_address",
          enabled: false,
          permitted: false,
        },
      ],
    },
    ...overrides,
  };
}

const configurations: AgentConfigurationListResponse = {
  configurations: [
    {
      configuration_id: CONFIGURATION_ID,
      name: "Frontline single agent",
      framework_id: "pydantic-ai",
      framework_label: "Pydantic AI",
      model_id: "gpt-5-mini",
      support_identity_id: IDENTITY_ID,
      tool_count: 1,
      updated_at: "2026-08-27T12:05:00+00:00",
      latest_published_version: null,
      published_version_count: 0,
    },
  ],
};

const NEW_CONFIGURATION_ID = "5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a";

/**
 * What the lab makes from a create request: an incomplete first draft on the framework it
 * proves first, with every read tool on and every write off (`new_agent_configuration`).
 */
const NEW_DRAFT: AgentConfigurationDraftResponse["content"] = {
  name: "",
  description: "",
  framework_id: "pydantic-ai",
  architecture: "single_agent",
  support_identity_id: IDENTITY_ID,
  prompt: "",
  tone_of_voice: { source: "shop_default", guideline_id: "" },
  tools: ["orders.read_order"],
  memory: "none",
  model: { provider: "openai", model_id: "gpt-5-mini", temperature: "0.20", max_tool_rounds: 8 },
};

let currentConfiguration = CONFIGURATION;
let currentPreview = preview();
let savedPayloads: Array<Record<string, unknown>> = [];
let createdDrafts: Array<Record<string, unknown>> = [];
let completedDrafts: Array<Record<string, unknown>> = [];
let listed: AgentConfigurationListResponse = configurations;
let previewShopIds: Array<string | null> = [];
/** Which answer of ADR 0052's chain the lab gives; a lab that reaches its provider by default. */
let connectionSource: ModelConnectionSource = "environment";
const connectionServed = { statuses: 0, listings: 0 };

/** Both connection reads answered, and a turn for the page to draw what they said. */
async function connectionRead(times = 1) {
  await waitFor(() => {
    expect(connectionServed.statuses).toBeGreaterThanOrEqual(times);
    expect(connectionServed.listings).toBeGreaterThanOrEqual(times);
  });
  await act(async () => {});
}

const SHOP_LISTING: ShopListResponse = {
  shops: [
    {
      shop_id: SHOP_ID,
      name: "Northstar Outfitters",
      slug: "northstar",
      updated_at: "2026-08-25T12:05:00+00:00",
      latest_published_version: 3,
      published_version_count: 3,
      logo: null,
    },
    {
      shop_id: OTHER_SHOP_ID,
      name: "Southline Supply",
      slug: "southline",
      updated_at: "2026-08-25T12:05:00+00:00",
      latest_published_version: 1,
      published_version_count: 1,
      logo: null,
    },
  ],
};

const server = setupServer(
  // The lab resolves its current shop against this list rather than trusting the remembered
  // identifier, so a shop the lab does not hold is not a current shop (ADR 0054).
  http.get("*/api/v1/shops", () => HttpResponse.json(SHOP_LISTING)),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft`, () =>
    HttpResponse.json({
      shop_id: SHOP_ID,
      lifecycle_state: "draft",
      content: SHOP_CONTENT,
      created_at: "2026-08-27T12:00:00+00:00",
      updated_at: "2026-08-27T12:05:00+00:00",
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
  http.get("*/api/v1/agent-configurations/resources", () => HttpResponse.json(RESOURCES)),
  http.get("*/api/v1/agent-configurations", () => HttpResponse.json(listed)),
  // A create makes the lab hold one configuration more, which is what lets a test watch the
  // rail's figure move rather than agree with a fixture (ADR 0056).
  http.post("*/api/v1/agent-configurations", async ({ request }) => {
    const command = (await request.json()) as Record<string, unknown>;
    createdDrafts.push(command);
    const content = { ...NEW_DRAFT, name: String(command.name) };
    listed = {
      configurations: [
        ...listed.configurations,
        {
          configuration_id: NEW_CONFIGURATION_ID,
          name: content.name,
          framework_id: content.framework_id,
          framework_label: "Pydantic AI",
          model_id: content.model.model_id,
          support_identity_id: IDENTITY_ID,
          tool_count: 1,
          updated_at: "2026-08-27T12:07:00+00:00",
          latest_published_version: null,
          published_version_count: 0,
        },
      ],
    };
    return HttpResponse.json(
      {
        configuration_id: NEW_CONFIGURATION_ID,
        lifecycle_state: "draft",
        content,
        created_at: "2026-08-27T12:07:00+00:00",
        updated_at: "2026-08-27T12:07:00+00:00",
      } satisfies AgentConfigurationDraftResponse,
      { status: 201 },
    );
  }),
  http.put(`*/api/v1/agent-configurations/${NEW_CONFIGURATION_ID}/draft`, async ({ request }) => {
    const body = (await request.json()) as { payload: Record<string, unknown> };
    completedDrafts.push(body.payload);
    return HttpResponse.json({
      configuration_id: NEW_CONFIGURATION_ID,
      lifecycle_state: "draft",
      content: body.payload as AgentConfigurationDraftResponse["content"],
      created_at: "2026-08-27T12:07:00+00:00",
      updated_at: "2026-08-27T12:08:00+00:00",
    } satisfies AgentConfigurationDraftResponse);
  }),
  http.get(`*/api/v1/agent-configurations/${NEW_CONFIGURATION_ID}/draft`, () =>
    HttpResponse.json({
      configuration_id: NEW_CONFIGURATION_ID,
      lifecycle_state: "draft",
      content: { ...NEW_DRAFT, name: String(createdDrafts.at(-1)?.name ?? "") },
      created_at: "2026-08-27T12:07:00+00:00",
      updated_at: "2026-08-27T12:08:00+00:00",
    } satisfies AgentConfigurationDraftResponse),
  ),
  http.get(`*/api/v1/agent-configurations/${NEW_CONFIGURATION_ID}/draft/preview`, () =>
    HttpResponse.json({
      ...currentPreview,
      configuration_id: NEW_CONFIGURATION_ID,
      content: { ...NEW_DRAFT, name: String(createdDrafts.at(-1)?.name ?? "") },
    }),
  ),
  http.get(`*/api/v1/agent-configurations/${CONFIGURATION_ID}/draft`, () =>
    HttpResponse.json({
      configuration_id: CONFIGURATION_ID,
      lifecycle_state: "draft",
      content: currentConfiguration,
      created_at: "2026-08-27T12:00:00+00:00",
      updated_at: "2026-08-27T12:05:00+00:00",
    } satisfies AgentConfigurationDraftResponse),
  ),
  http.put(`*/api/v1/agent-configurations/${CONFIGURATION_ID}/draft`, async ({ request }) => {
    const body = (await request.json()) as { payload: Record<string, unknown> };
    savedPayloads.push(body.payload);
    currentConfiguration = body.payload as typeof currentConfiguration;
    return HttpResponse.json({
      configuration_id: CONFIGURATION_ID,
      lifecycle_state: "draft",
      content: currentConfiguration,
      created_at: "2026-08-27T12:00:00+00:00",
      updated_at: "2026-08-27T12:06:00+00:00",
    } satisfies AgentConfigurationDraftResponse);
  }),
  http.get(`*/api/v1/agent-configurations/${CONFIGURATION_ID}/draft/preview`, ({ request }) => {
    const shopId = new URL(request.url).searchParams.get("preview_shop_id");
    previewShopIds.push(shopId);
    const body = { ...currentPreview, content: currentConfiguration };
    if (shopId !== OTHER_SHOP_ID) {
      return HttpResponse.json(body);
    }
    // The other shop resolves the same variables to its own values.
    return HttpResponse.json({
      ...body,
      resolution: {
        ...body.resolution,
        shop_id: OTHER_SHOP_ID,
        shop_name: "Southline Supply",
        shop_version: 1,
        variables: body.resolution.variables.map((variable) =>
          variable.name === "shop.name" ? { ...variable, value: "Southline Supply" } : variable,
        ),
      },
    });
  }),
  http.post(`*/api/v1/agent-configurations/${CONFIGURATION_ID}/versions`, () => {
    currentPreview = preview({
      publishable: true,
      issues: [],
      changes: [],
      latest_published_version: 1,
      next_version: 2,
      matches_latest_published: true,
    });
    return HttpResponse.json(
      {
        configuration_id: CONFIGURATION_ID,
        lifecycle_state: "published",
        version: 1,
        content_fingerprint: "b".repeat(64),
        published_at: "2026-08-27T12:10:00+00:00",
        support_identity_version: 1,
        content: currentConfiguration,
      } satisfies AgentConfigurationVersionResponse,
      { status: 201 },
    );
  }),
  ...labConnection(() => connectionSource, connectionServed),
  // The shop and lab shells read every listing their rail counts (ADR 0056). Last, so a
  // handler this suite declares for one of these routes still wins.
  ...shellListings(),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  window.localStorage.clear();
  server.resetHandlers();
  currentConfiguration = CONFIGURATION;
  currentPreview = preview();
  savedPayloads = [];
  createdDrafts = [];
  completedDrafts = [];
  listed = configurations;
  previewShopIds = [];
  connectionSource = "environment";
  connectionServed.statuses = 0;
  connectionServed.listings = 0;
});
afterAll(() => server.close());

function renderAt(path: string) {
  return renderApp(path);
}

describe("agent configuration workspace", () => {
  // The card's title says what the list is (each configuration is an agent an experiment can put under test), on the header line opposite the search.
  it("titles its card Agents under test, opposite the search box", async () => {
    renderAt("/lab/agent-configurations");

    const box = await screen.findByRole("searchbox", { name: "Search configurations" });
    const title = screen.getByRole("heading", { level: 2, name: "Agents under test" });
    expect(title.parentElement).toContainElement(box);
  });

  it("scrolls its table inside its card, so a phone's pane never scrolls sideways", async () => {
    renderAt("/lab/agent-configurations");
    await expectIndexTableScrolls("Agents under test");
  });

  it("lists configurations with their framework, model, and publication state", async () => {
    renderAt("/lab/agent-configurations");

    expect(await screen.findByRole("heading", { name: "Agent configs" })).toBeVisible();
    expect(await screen.findByRole("link", { name: "Frontline single agent" })).toBeVisible();
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Pydantic AI")).toBeVisible();
    expect(table.getByText("gpt-5-mini")).toBeVisible();
    // Scoped to the table: "Never published" is also a filter chip's label now.
    expect(table.getByText("Never published")).toBeVisible();
  });

  it("says each configuration's publication in a pill: the version and how many, or Never published", async () => {
    server.use(
      http.get("*/api/v1/agent-configurations", () =>
        HttpResponse.json({
          configurations: [
            ...configurations.configurations,
            {
              ...configurations.configurations[0],
              configuration_id: "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9",
              name: "Deterministic control",
              latest_published_version: 2,
              published_version_count: 2,
            },
          ],
        } satisfies AgentConfigurationListResponse),
      ),
    );
    renderAt("/lab/agent-configurations");

    const never = (await screen.findByRole("link", { name: "Frontline single agent" })).closest(
      "tr",
    ) as HTMLElement;
    const published = screen
      .getByRole("link", { name: "Deterministic control" })
      .closest("tr") as HTMLElement;
    expectPublicationPill(published, "v2 · 2 versions", "published");
    expectPublicationPill(never, "Never published", "never published");
  });

  it("says, with nothing configured, that a configuration adopts an identity, and links to them", async () => {
    server.use(
      http.get("*/api/v1/agent-configurations", () =>
        HttpResponse.json({ configurations: [] } satisfies AgentConfigurationListResponse),
      ),
    );
    renderAt("/lab/agent-configurations");

    await screen.findByText(/No agent configuration yet/);
    const card = indexCard("Agents under test");
    expect(card).toHaveTextContent(/adopts exactly one support identity/);
    expect(
      within(card).getByRole("link", { name: "author one in Support identities" }),
    ).toHaveAttribute("href", "/lab/support-identities");
  });

  it("counts the configurations an arm could adopt, and filters to them", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/v1/agent-configurations", () =>
        HttpResponse.json({
          configurations: [
            ...configurations.configurations,
            {
              ...configurations.configurations[0],
              configuration_id: "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9",
              name: "Deterministic control",
              latest_published_version: 2,
              published_version_count: 2,
            },
          ],
        } satisfies AgentConfigurationListResponse),
      ),
    );
    renderAt("/lab/agent-configurations");
    await screen.findByRole("link", { name: "Frontline single agent" });
    const filters = within(screen.getByRole("group", { name: "Filter agent configurations" }));

    expect(filters.getByRole("button", { name: "All 2" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Adoptable 1" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Never published 1" })).toBeVisible();

    await user.click(filters.getByRole("button", { name: "Adoptable 1" }));

    expect(screen.getByRole("link", { name: "Deterministic control" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Frontline single agent" })).toBeNull();
  });

  it("constrains the temperature and puts its range and its exactness under the field", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    const temperature = await screen.findByLabelText("Temperature");
    expect(temperature).toHaveAttribute("inputmode", "decimal");
    // The note used to sit at the foot of the card, three controls away from the field it is
    // about; the range the domain enforces was nowhere.
    expect(temperature).toHaveAccessibleDescription(/Between 0 and 2, with at most two decimals/);
    expect(temperature).toHaveAccessibleDescription(/never a binary float/);

    await user.clear(temperature);
    await user.type(temperature, "0.25");
    expect(temperature).toBeValid();
    await user.clear(temperature);
    await user.type(temperature, "0.256");
    expect(temperature).toBeInvalid();
  });

  it("repeats the pinning sentence on the editor", async () => {
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);
    expect(
      await screen.findByText(
        /publishing pins the support-identity version a configuration names/i,
      ),
    ).toBeVisible();
  });

  it("renders each prompt variable as a chip carrying its resolved value", async () => {
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    const resolved = await screen.findByRole("region", { name: "Resolved prompt" });
    expect(within(resolved).getByText("shop.name: Northstar Outfitters")).toBeVisible();
    expect(
      within(resolved).getByText("support_identity.role: Customer support representative"),
    ).toBeVisible();
    expect(within(resolved).getByText("customer.name · not injectable")).toBeVisible();
  });

  it("explains why a tool-discovered fact cannot be injected into the prompt", async () => {
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    expect(
      await screen.findByText(/customer, order, and ticket facts are discovered through tools/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Insert customer.name" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Insert shop.locale" })).toBeEnabled();
  });

  it("inserts a variable into the prompt at the caret", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    const prompt = await screen.findByLabelText("Prompt template");
    await user.clear(prompt);
    await user.type(prompt, "Answer for ");
    await user.click(screen.getByRole("button", { name: "Insert shop.locale" }));

    await waitFor(() => expect(prompt).toHaveValue("Answer for {{shop.locale}}"));
  });

  it("inserts a variable mid-text and leaves the caret after the chip", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    const prompt = await screen.findByLabelText("Prompt template");
    await user.clear(prompt);
    await user.type(prompt, "Answer for  today.");
    const caret = "Answer for ".length;
    (prompt as HTMLTextAreaElement).setSelectionRange(caret, caret);
    await user.click(screen.getByRole("button", { name: "Insert shop.name" }));

    await waitFor(() => expect(prompt).toHaveValue("Answer for {{shop.name}} today."));
    // A second insert lands after the first rather than back at the top.
    await waitFor(() =>
      expect((prompt as HTMLTextAreaElement).selectionStart).toBe(caret + "{{shop.name}}".length),
    );
  });

  it("marks a write tool the support identity could never be authorized to use", async () => {
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    const binding = await screen.findByLabelText(/orders.propose_address_change/);
    expect(binding).not.toBeChecked();
    expect(screen.getByText("needs Change shipping address")).toBeVisible();
  });

  it("resolves the prompt against the shop the author selects", async () => {
    const user = userEvent.setup();
    // With a *different* shop current, so that the author's pick is held against the lab's
    // preference rather than against nothing: the pick wins because it is first in the
    // precedence, not because there is no competitor (ADR 0054).
    window.localStorage.setItem("agent-lab.last-visited-shop", SHOP_ID);
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    const resolved = await screen.findByRole("region", { name: "Resolved prompt" });
    expect(await screen.findByText(/Northstar Outfitters v3 · Northstar tier 1 v1/)).toBeVisible();

    // The gate preview is read without a shop; the resolution is the read that carries one.
    await waitFor(() => expect(previewShopIds).toContain(SHOP_ID));
    expect(previewShopIds).toContain(null);

    await user.selectOptions(screen.getByLabelText("Preview context"), OTHER_SHOP_ID);

    expect(await within(resolved).findByText("shop.name: Southline Supply")).toBeVisible();
    const promptCard = screen.getByRole("region", { name: "System prompt" });
    expect(await within(promptCard).findByText(/Values:/)).toHaveTextContent("Southline Supply v1");
  });

  it("opens the preview on the lab's current shop, and on the first offered one when there is none", async () => {
    // The editor is the lab's now and no longer sits inside a shop, so the shop it resolves a
    // prompt against comes from the lab's current shop (ADR 0054). Both halves of that sentence
    // are held here: the remembered shop when the lab has one, and — because a select showing a
    // value that is not among its options is a control showing something nobody picked — the
    // first shop the resources offer when it does not.
    window.localStorage.setItem("agent-lab.last-visited-shop", OTHER_SHOP_ID);
    const remembered = renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    await waitFor(() =>
      expect(screen.getByLabelText("Preview context")).toHaveValue(OTHER_SHOP_ID),
    );
    await waitFor(() => expect(previewShopIds).toContain(OTHER_SHOP_ID));
    remembered.unmount();

    window.localStorage.clear();
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    await waitFor(() => expect(screen.getByLabelText("Preview context")).toHaveValue(SHOP_ID));
  });

  it("follows the lab's switcher while the author has chosen no shop of their own", async () => {
    // New behaviour, and the point of deriving the preview shop rather than storing it: the
    // lab's current shop can change under a page that is already open, and an editor still
    // showing the shop the lab has left would resolve the prompt against a context the
    // switcher no longer names (ADR 0054).
    const user = userEvent.setup();
    window.localStorage.setItem("agent-lab.last-visited-shop", SHOP_ID);
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    await waitFor(() => expect(screen.getByLabelText("Preview context")).toHaveValue(SHOP_ID));

    // The top bar's switcher, which in lab mode sets the current shop instead of navigating.
    await user.click(screen.getByRole("button", { name: /^Switch shop/ }));
    await user.click(screen.getByRole("menuitem", { name: /Southline Supply/ }));

    await waitFor(() =>
      expect(screen.getByLabelText("Preview context")).toHaveValue(OTHER_SHOP_ID),
    );
    await waitFor(() => expect(previewShopIds).toContain(OTHER_SHOP_ID));
  });

  it("waits for the shop list rather than settling on a shop nobody chose", async () => {
    // The resources and the lab's shops are two reads, and they answer in either order. When
    // the resources win, the fallback must not fire: drawing the picker on the first shop
    // offered and resolving the prompt against it, only to jump to the remembered shop a
    // moment later, is correct at rest and wrong to watch.
    //
    // The shop list is held open deliberately rather than delayed by a timer, so this pins the
    // order instead of racing it.
    let releaseShops: (() => void) | null = null;
    server.use(
      http.get("*/api/v1/shops", async () => {
        await new Promise<void>((release) => {
          releaseShops = release;
        });
        return HttpResponse.json(SHOP_LISTING);
      }),
    );
    window.localStorage.setItem("agent-lab.last-visited-shop", OTHER_SHOP_ID);
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    // The resources have answered: the picker has both shops, and the lab has none yet.
    const picker = await screen.findByLabelText("Preview context");
    await waitFor(() =>
      expect(within(picker).getByRole("option", { name: /Southline Supply/ })).toBeInTheDocument(),
    );
    await waitFor(() => expect(releaseShops).not.toBeNull());

    // Nothing is settled, so the control says so rather than naming the first shop offered —
    // a select whose value matches no option shows that option anyway — and nothing has been
    // resolved for a shop nobody chose.
    expect(picker).toHaveValue("");
    expect(within(picker).getByRole("option", { name: "Choosing a shop…" })).toBeInTheDocument();
    expect(previewShopIds).not.toContain(SHOP_ID);

    (releaseShops as unknown as () => void)();

    await waitFor(() => expect(picker).toHaveValue(OTHER_SHOP_ID));
    expect(previewShopIds).not.toContain(SHOP_ID);
    // And the placeholder goes with the question it was asking.
    expect(within(picker).queryByRole("option", { name: "Choosing a shop…" })).toBeNull();
  });

  it("stops asking which shop once a lab with none has answered", async () => {
    // A lab with no shops comes to rest with nothing to preview against, and both reads have
    // answered. "Choosing a shop…" is progress, so it must not survive the progress; and a
    // select holding that one option is a control that chooses nothing.
    server.use(
      http.get("*/api/v1/shops", () => HttpResponse.json({ shops: [] })),
      http.get("*/api/v1/agent-configurations/resources", () =>
        HttpResponse.json({ ...RESOURCES, preview_shops: [] }),
      ),
    );
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    expect(
      await screen.findByText(/This lab has no shops, so there is nothing to resolve the prompt/),
    ).toBeVisible();
    await waitFor(() => expect(previewShopIds).toContain(null));
    expect(screen.queryByRole("combobox", { name: "Preview context" })).toBeNull();
    expect(screen.queryByText("Choosing a shop…")).toBeNull();
    // The sentence is the row's value, stated rather than asked, on the row the picker had.
    const stated = screen.getByLabelText("Preview context");
    expect(stated.tagName).toBe("OUTPUT");
    expect(stated).toHaveTextContent(/This lab has no shops/);
    expectFieldRow(stated, "Preview context");
    // The rest of the editor is unaffected: the prompt is still a template being written.
    expect(screen.getByLabelText("Prompt template")).toBeVisible();
  });

  it("does not ask which shop for ever when the shops could not be read", async () => {
    // The other way both reads come to rest with nothing offered. A read that failed is not a
    // read still running, and only one of the two may be described as choosing.
    server.use(
      http.get("*/api/v1/agent-configurations/resources", () =>
        HttpResponse.json(
          { code: "internal_error", message: "unavailable", request_id: "r" },
          { status: 500 },
        ),
      ),
    );
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    expect(
      await screen.findByText(/The shops this prompt would resolve against could not be read/),
    ).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Preview context" })).toBeNull();
    expect(screen.queryByText("Choosing a shop…")).toBeNull();
    expect(screen.queryByText(/This lab has no shops/)).toBeNull();
    const stated = screen.getByLabelText("Preview context");
    expect(stated.tagName).toBe("OUTPUT");
    expectFieldRow(stated, "Preview context");
  });

  it("offers the providers and models the chosen framework is proven on", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    const runtime = within(await screen.findByRole("region", { name: "LLM and runtime" }));
    const provider = runtime.getByLabelText("Provider");
    // A select, not a free text box: an unproven provider is a publish error, so the field
    // refuses it rather than letting the gate do it a save later.
    expect(provider.tagName).toBe("SELECT");
    expect(within(provider).getByRole("option", { name: "OpenAI" })).toBeInTheDocument();
    expect(within(provider).queryByRole("option", { name: "Deterministic control" })).toBeNull();

    const models = runtime.getByLabelText("Model").getAttribute("list");
    expect(
      [...document.querySelectorAll(`#${models} option`)].map((option) =>
        option.getAttribute("value"),
      ),
    ).toEqual(["gpt-5-mini", "gpt-5"]);

    await user.selectOptions(screen.getByLabelText("Framework"), "fake");

    expect(
      within(provider).getByRole("option", { name: "Deterministic control" }),
    ).toBeInTheDocument();
    expect(
      [...document.querySelectorAll(`#${models} option`)].map((option) =>
        option.getAttribute("value"),
      ),
    ).toEqual(["deterministic"]);
  });

  it("keeps a draft's off-list provider on the select rather than misreporting it", async () => {
    currentConfiguration = {
      ...CONFIGURATION,
      model: { ...CONFIGURATION.model, provider: "anthropic" },
    };
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    const runtime = within(await screen.findByRole("region", { name: "LLM and runtime" }));
    const provider = runtime.getByLabelText("Provider");

    expect(provider).toHaveValue("anthropic");
    expect(within(provider).getByRole("option", { name: "anthropic" })).toBeInTheDocument();
    // An error, not a warning: nothing in the lab could execute it.
    expect(provider).toHaveAccessibleDescription(
      /Pydantic AI has not been proven against the anthropic provider/,
    );
  });

  it("moves the provider and the model onto the framework the author just chose", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    const runtime = within(await screen.findByRole("region", { name: "LLM and runtime" }));
    await user.selectOptions(screen.getByLabelText("Framework"), "fake");

    // The provider is reset because a select cannot hold a value it does not offer; the
    // model follows because a model name means nothing outside its provider.
    expect(runtime.getByLabelText("Provider")).toHaveValue("fake");
    expect(runtime.getByLabelText("Model")).toHaveValue("deterministic");
  });

  it("keeps a typed model when the framework changes but the provider does not", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    const runtime = within(await screen.findByRole("region", { name: "LLM and runtime" }));
    const model = runtime.getByLabelText("Model");
    await user.clear(model);
    await user.type(model, "gpt-5");

    // Both frameworks are proven on `openai`, so nothing the author answered has been
    // invalidated and nothing of theirs is discarded.
    await user.selectOptions(screen.getByLabelText("Framework"), "openai-agents");

    expect(runtime.getByLabelText("Provider")).toHaveValue("openai");
    expect(model).toHaveValue("gpt-5");
    // It is off the new framework's list, though, and the field says so in the gate's words.
    expect(model).toHaveAccessibleDescription(/gpt-5 is not a model the lab exercises/);
    expect(model).toHaveAccessibleDescription(/OpenAI Agents SDK is proven on gpt-5-mini/);
  });

  it("says nothing about a model that is on the proven list", async () => {
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    const runtime = within(await screen.findByRole("region", { name: "LLM and runtime" }));
    expect(runtime.getByLabelText("Model")).not.toHaveAccessibleDescription(
      /not a model the lab exercises/,
    );
  });

  it("offers the preview shop's own tone guidelines and echoes the one it resolves to", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    const tone = within(await screen.findByRole("region", { name: "Tone of voice" }));
    await user.selectOptions(tone.getByLabelText("Tone of voice source"), "override");

    const field = tone.getByLabelText("Guideline ID");
    const list = field.getAttribute("list");
    expect(
      [...document.querySelectorAll(`#${list} option`)].map((option) => [
        option.getAttribute("value"),
        option.getAttribute("label"),
      ]),
    ).toEqual([
      ["warm-precise", "Warm and precise"],
      ["brisk", "Brisk and factual"],
    ]);

    await user.type(field, "brisk");
    expect(field).toHaveAccessibleDescription(
      /Resolves to Brisk and factual in Northstar Outfitters/,
    );
  });

  it("says when an override names nothing the preview shop publishes", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    const tone = within(await screen.findByRole("region", { name: "Tone of voice" }));
    await user.selectOptions(tone.getByLabelText("Tone of voice source"), "override");
    const field = tone.getByLabelText("Guideline ID");
    await user.type(field, "southline-house");

    // Stated, not refused: the configuration is shop-independent, and this ID is the right
    // one for the shop beside it. What refuses it is experiment setup, which is what it says.
    expect(field).toHaveAccessibleDescription(
      /Northstar Outfitters v3 publishes no guideline with this ID/,
    );
    expect(field).toHaveAccessibleDescription(/fails at experiment setup/);

    await user.selectOptions(screen.getByLabelText("Preview context"), OTHER_SHOP_ID);

    expect(await screen.findByText(/Resolves to Southline house voice in Southline Supply/)) //
      .toBeVisible();
  });

  it("reports a failed save without discarding the draft", async () => {
    const user = userEvent.setup();
    server.use(
      http.put(`*/api/v1/agent-configurations/${CONFIGURATION_ID}/draft`, () =>
        HttpResponse.json(
          {
            code: "agent_configuration_error",
            message: "model temperature must be a decimal number",
            request_id: "r",
          },
          { status: 422 },
        ),
      ),
    );
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    await user.click(await screen.findByLabelText(/orders.propose_address_change/));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/must be a decimal number/);
    expect(screen.getByLabelText(/orders.propose_address_change/)).toBeChecked();
  });

  it("saves the enabled tool set and then publishes the saved draft", async () => {
    const user = userEvent.setup();
    currentPreview = preview({ publishable: true, issues: [] });
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    const binding = await screen.findByLabelText(/orders.propose_address_change/);
    await user.click(binding);
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect(savedPayloads[0].tools).toEqual(["orders.read_order", "orders.propose_address_change"]);

    await user.click(screen.getByRole("button", { name: "Publish v1" }));

    expect(await screen.findByText(/Published version 1/)).toBeVisible();
  });
});

/**
 * Whether this lab can run what is being authored is a second question, answered beside the
 * field and nowhere the gate answers (ADR 0053).
 */
describe("the provider the lab can reach", () => {
  const NOTE =
    "Published configurations naming OpenAI cannot be advanced here until the lab has a connection for it.";

  for (const source of ["none", "saved_unreadable"] as const) {
    it(`says beside the provider, and only there, that a lab on ${source} cannot advance it`, async () => {
      connectionSource = source;
      // A draft the gate would publish: the note must not make it look otherwise.
      currentPreview = preview({ publishable: true, issues: [] });
      renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

      const runtime = within(await screen.findByRole("region", { name: "LLM and runtime" }));
      const provider = runtime.getByLabelText("Provider");
      await waitFor(() => expect(provider).toHaveAccessibleDescription(new RegExp(NOTE)));

      // Written once on the page, and that once is the provider row's.
      expect(screen.getAllByText(NOTE)).toHaveLength(1);
      // Not a gate finding, not a reason not to publish: Publish stays pressable.
      expect(
        within(screen.getByRole("region", { name: "Publish gate" })).queryByText(NOTE),
      ).toBeNull();
      expect(screen.queryByText(/to publish\./)).toBeNull();
      expectNotRefused(screen.getByRole("button", { name: "Publish v1" }));
    });
  }

  it("keeps the note out of the gate's findings and PublishReasons while those have something to say", async () => {
    connectionSource = "none";
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    const gate = within(await screen.findByRole("region", { name: "Publish gate" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Provider")).toHaveAccessibleDescription(new RegExp(NOTE)),
    );
    expect(gate.getByText(/the prompt injects customer.name/)).toBeVisible();
    // PublishReasons counts the gate's one error and nothing the lab's machine added to it.
    expect(screen.getByText("Resolve 1 error(s) to publish.")).toBeVisible();
    expect(gate.queryByText(NOTE)).toBeNull();
    expect(screen.getAllByText(NOTE)).toHaveLength(1);
    // Publish is refused by the gate's count, not by the machine's note, and says so.
    const publish = screen.getByRole("button", { name: "Publish v1" });
    expectRefused(publish, "Resolve 1 error(s) to publish.");
    expect(publish).not.toHaveAccessibleDescription(new RegExp(NOTE));
  });

  for (const source of ["saved", "environment"] as const) {
    it(`says nothing about reaching a provider the lab reaches through ${source}`, async () => {
      connectionSource = source;
      renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

      const runtime = within(await screen.findByRole("region", { name: "LLM and runtime" }));
      await connectionRead();
      expect(runtime.getByLabelText("Provider")).not.toHaveAccessibleDescription(
        /cannot be advanced here/,
      );
      expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
    });
  }

  for (const route of ["lab-status", "model-connections"] as const) {
    it(`says nothing when ${route} cannot be read, even on a lab that reaches nothing`, async () => {
      connectionSource = "none";
      server.use(
        http.get(`*/api/v1/${route}`, () => {
          // Counted as served, so the wait below still knows when the page has been answered.
          if (route === "lab-status") {
            connectionServed.statuses += 1;
          } else {
            connectionServed.listings += 1;
          }
          return HttpResponse.json(
            {
              code: "internal_error",
              message: "The lab could not complete the request.",
              request_id: "r",
            },
            { status: 500 },
          );
        }),
      );
      renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

      const provider = await screen.findByLabelText("Provider");
      await connectionRead();
      expect(provider).not.toHaveAccessibleDescription(/cannot be advanced here/);
      expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
    });
  }

  it("says nothing about the declared control, which reaches no provider to begin with", async () => {
    const user = userEvent.setup();
    connectionSource = "none";
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    const provider = await screen.findByLabelText("Provider");
    await waitFor(() => expect(provider).toHaveAccessibleDescription(new RegExp(NOTE)));
    await user.selectOptions(screen.getByLabelText("Framework"), "fake");

    expect(provider).toHaveValue("fake");
    expect(provider).not.toHaveAccessibleDescription(/cannot be advanced here/);
  });

  it("stops saying it once a connection is saved", async () => {
    connectionSource = "none";
    const { router } = renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);
    await waitFor(() =>
      expect(screen.getByLabelText("Provider")).toHaveAccessibleDescription(new RegExp(NOTE)),
    );

    // The operator saves a connection from the settings page and comes back.
    connectionSource = "saved";
    await act(() => router.navigate("/settings"));
    await screen.findByRole("heading", { name: "Lab settings" });
    connectionServed.statuses = 0;
    connectionServed.listings = 0;
    await act(() => router.navigate(`/lab/agent-configurations/${CONFIGURATION_ID}`));

    const provider = await screen.findByLabelText("Provider");
    // Read again on the way back, and that answer is the one the page is drawing.
    await connectionRead();
    expect(provider).not.toHaveAccessibleDescription(/cannot be advanced here/);
    expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
  });
});

/**
 * Creating is a page, and it lands in the editor of what it made (PLAN-UX Slice 13).
 */
describe("the new-configuration page", () => {
  it("is reached from the index's own header, which carries no create card", async () => {
    const user = userEvent.setup();
    renderAt("/lab/agent-configurations");

    await screen.findByRole("link", { name: "Frontline single agent" });
    expect(screen.queryByRole("region", { name: "New agent configuration" })).toBeNull();

    await user.click(screen.getByRole("link", { name: "New configuration" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "New agent configuration" }),
    ).toBeVisible();
    expect(screen.getByText(/creating a configuration/)).toBeVisible();
  });

  it("refuses Create with the reason, and reads the typed name back as the page's title", async () => {
    const user = userEvent.setup();
    renderAt("/lab/agent-configurations/new");

    const create = await screen.findByRole("button", { name: "Create configuration" });
    await waitFor(() =>
      expectRefused(create, "The configuration needs a name before it can be created."),
    );
    // The reason is beside the control and in its accessible description, not only in
    // `title` — `docs/design-direction.md`, *The form language*.
    expect(create).toHaveAccessibleDescription(
      "The configuration needs a name before it can be created.",
    );
    expect(create).toHaveAttribute(
      "title",
      "The configuration needs a name before it can be created.",
    );

    await user.type(screen.getByLabelText("Name"), "Frontline B");

    expect(screen.getByRole("heading", { level: 1, name: "Frontline B" })).toBeVisible();
    expectNotRefused(create);
  });

  it("puts each field's hint in that control's accessible description", async () => {
    renderAt("/lab/agent-configurations/new");

    expect(await screen.findByLabelText("Name")).toHaveAccessibleDescription(
      /listed on the bench and in history/i,
    );
    expect(screen.getByLabelText("Adopted identity")).toHaveAccessibleDescription(
      /publishing pins the support-identity version a configuration names/i,
    );
  });

  it("draws the model on a row with the fields around it, its rule still its description", async () => {
    renderAt("/lab/agent-configurations/new");
    const runtime = await screen.findByRole("region", { name: "Runtime" });

    const model = within(runtime).getByLabelText("Model");
    expectFieldRow(model, "Model");
    expect(model).toHaveAccessibleDescription(/Pick a proven model/);
  });

  it("opens on the lab's one support identity, and says so", async () => {
    renderAt("/lab/agent-configurations/new");

    const identity = await screen.findByLabelText("Adopted identity");
    await waitFor(() => expect(identity).not.toHaveValue(""));
    await waitFor(() =>
      expect(identity).toHaveAccessibleDescription(
        /This one is the only support identity in the lab, so it is already chosen\./,
      ),
    );
  });

  it("says why it cannot go while the lab has no identity to adopt", async () => {
    server.use(
      http.get("*/api/v1/agent-configurations/resources", () =>
        HttpResponse.json({ ...RESOURCES, support_identities: [] }),
      ),
    );
    renderAt("/lab/agent-configurations/new");

    const create = await screen.findByRole("button", { name: "Create configuration" });
    await waitFor(() =>
      expect(create).toHaveAccessibleDescription(
        "Author a support identity first: a configuration adopts exactly one.",
      ),
    );
    // The row still says what publishing pins, because the rule is about the field and not
    // about whether the lab happens to hold one yet.
    expect(screen.getByLabelText("Adopted identity")).toHaveAccessibleDescription(
      /publishing pins the support-identity version a configuration names/i,
    );
  });

  it("moves the model onto the framework the author just chose, and names its provider", async () => {
    const user = userEvent.setup();
    renderAt("/lab/agent-configurations/new");

    expect(await screen.findByLabelText("Model")).toHaveValue("gpt-5-mini");
    // The provider row is a value the page decided rather than a control it offers, and it
    // is still named by its own label: each proven framework runs on one provider, and a
    // choice of one is not a choice.
    expect(screen.getByLabelText("Provider")).toHaveTextContent("OpenAI");
    expect(screen.queryByRole("combobox", { name: "Provider" })).toBeNull();

    await user.selectOptions(screen.getByLabelText("Framework"), "fake");

    // `gpt-5-mini` is not something the offline control runs, so it is not a value the
    // author could have meant by the framework they just chose.
    expect(screen.getByLabelText("Model")).toHaveValue("deterministic");
    expect(screen.getByLabelText("Provider")).toHaveTextContent("Deterministic control");
  });

  it("makes the configuration, saves the runtime it could not carry, and lands in the editor", async () => {
    const user = userEvent.setup();
    renderAt("/lab/agent-configurations/new");

    await user.type(await screen.findByLabelText("Name"), "Frontline B");
    await user.selectOptions(screen.getByLabelText("Framework"), "fake");
    await user.click(screen.getByRole("button", { name: "Create configuration" }));

    // The create request carries what the contract takes; the framework and the model are
    // the second write, because `CreateAgentConfigurationRequest` has nowhere to put them.
    await waitFor(() =>
      expect(createdDrafts).toEqual([{ name: "Frontline B", support_identity_id: IDENTITY_ID }]),
    );
    await waitFor(() => expect(completedDrafts).toHaveLength(1));
    expect(completedDrafts[0]).toMatchObject({
      name: "Frontline B",
      framework_id: "fake",
      model: { provider: "fake", model_id: "deterministic" },
    });

    // And the operator is standing in the editor of what they made, with the name they typed.
    expect(await screen.findByRole("heading", { level: 1, name: "Frontline B" })).toBeVisible();
    expect(screen.getByLabelText("Prompt template")).toBeVisible();
  });

  it("sends one write where the runtime the lab defaults to is the runtime asked for", async () => {
    const user = userEvent.setup();
    renderAt("/lab/agent-configurations/new");

    await user.type(await screen.findByLabelText("Name"), "Frontline B");
    await user.click(screen.getByRole("button", { name: "Create configuration" }));

    await waitFor(() => expect(createdDrafts).toHaveLength(1));
    await screen.findByLabelText("Prompt template");
    // Nothing on the page asked for anything the create could not carry, so nothing else
    // was written — and nothing was ever unsaved (ADR 0051).
    expect(completedDrafts).toEqual([]);
  });

  it("keeps the operator here when the second write is refused, and finishes it on the next press", async () => {
    const user = userEvent.setup();
    let refuse = true;
    server.use(
      http.put(
        `*/api/v1/agent-configurations/${NEW_CONFIGURATION_ID}/draft`,
        async ({ request }) => {
          if (refuse) {
            refuse = false;
            // A transport failure rather than a refusal the lab explains, so what the
            // operator reads is this page's own sentence about what did and did not land.
            return HttpResponse.error();
          }
          const body = (await request.json()) as { payload: Record<string, unknown> };
          completedDrafts.push(body.payload);
          return HttpResponse.json({
            configuration_id: NEW_CONFIGURATION_ID,
            lifecycle_state: "draft",
            content: body.payload as AgentConfigurationDraftResponse["content"],
            created_at: "2026-08-27T12:07:00+00:00",
            updated_at: "2026-08-27T12:08:00+00:00",
          } satisfies AgentConfigurationDraftResponse);
        },
      ),
    );
    renderAt("/lab/agent-configurations/new");

    await user.type(await screen.findByLabelText("Name"), "Frontline B");
    await user.selectOptions(screen.getByLabelText("Framework"), "fake");
    await user.click(screen.getByRole("button", { name: "Create configuration" }));

    expect(
      await screen.findByText(/The configuration was created, but its runtime could not be saved/),
    ).toBeVisible();
    // Still on the create page, and the chip says what the lab now holds.
    expect(screen.getByText("created · its runtime is not saved yet")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Create configuration" }));

    // A second press finishes the first one rather than making a second configuration.
    await waitFor(() => expect(completedDrafts).toHaveLength(1));
    expect(createdDrafts).toHaveLength(1);
  });
});

/**
 * The index has one name on every surface that names it — its rail entry, its page title and
 * the links back to it — and that name is short enough to sit beside its count on one line of
 * the rail (design-direction, *Names*). The record keeps its own name, "agent configuration".
 */
describe("the index's one name", () => {
  it("is Agent configs on the rail entry and the page title", async () => {
    renderAt("/lab/agent-configurations");

    expect(await screen.findByRole("heading", { level: 1, name: "Agent configs" })).toBeVisible();
    expect(railEntry("Agent configs", "Experiment lab workspace")).toHaveAttribute(
      "href",
      "/lab/agent-configurations",
    );
  });

  it("is agent configs on the index's tour", async () => {
    renderAt("/lab/agent-configurations");

    await screen.findByRole("heading", { level: 1, name: "Agent configs" });
    expect(
      await screen.findByRole("button", { name: "Show me around agent configs" }),
    ).toBeVisible();
  });

  it("is Agent configs on the create page's way back", async () => {
    renderAt("/lab/agent-configurations/new");

    await screen.findByRole("heading", { level: 1, name: "New agent configuration" });
    expect(screen.getByRole("link", { name: "Back to Agent configs" })).toHaveAttribute(
      "href",
      "/lab/agent-configurations",
    );
    expect(
      within(screen.getByRole("main")).getByRole("link", { name: "Agent configs" }),
    ).toHaveAttribute("href", "/lab/agent-configurations");
  });

  it("is Agent configs on the editor's link back to the index", async () => {
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    const main = await screen.findByRole("main");
    const back = await within(main).findByRole("link", { name: "Agent configs" });
    expect(back).toHaveAttribute("href", "/lab/agent-configurations");
  });
});

/**
 * The rail's figure and this index are one listing, read once by the shell and handed to
 * both, so they cannot come to disagree (ADR 0056).
 */
describe("the rail's figure and this index", () => {
  it("says on the rail what the table has rows", async () => {
    renderAt("/lab/agent-configurations");

    const rows = bodyRows(await screen.findByRole("table"));
    const entry = railEntry("Agent configs", "Experiment lab workspace");
    expect(within(entry).getByText(String(rows))).toBeVisible();
    expect(entry).toHaveAccessibleDescription(`${rows} configuration${rows === 1 ? "" : "s"}`);
  });

  it("moves the figure when a configuration is created, without a reload", async () => {
    // An agreement between two reads of one fixture is true by construction, so this one
    // creates: the create page re-reads the listing the rail counts, and the figure has to
    // follow (ADR 0056).
    const user = userEvent.setup();
    renderAt("/lab/agent-configurations/new");

    const entry = railEntry("Agent configs", "Experiment lab workspace");
    await waitFor(() => expect(within(entry).getByText("1")).toBeVisible());

    await user.type(await screen.findByLabelText("Name"), "Frontline B");
    await user.click(screen.getByRole("button", { name: "Create configuration" }));

    await waitFor(() =>
      expect(
        within(railEntry("Agent configs", "Experiment lab workspace")).getByText("2"),
      ).toBeVisible(),
    );
  });
});

/**
 * The editor's side panel, as every editor draws it: the gate first, the context the draft is
 * read with next, and what publishing freezes last — never a field of the draft.
 */
describe("the agent configuration editor's side panel", () => {
  it("goes back to Agent configs from the ← above its title", async () => {
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    await expectWayBack(
      "Agent configs",
      "/lab/agent-configurations",
      "configuration",
      "configuration · shop-independent",
      /draft fingerprint [0-9a-f]{12}…/,
    );
    // When variables resolve, which the header used to say, is said by the card that holds them.
    expect(screen.getByRole("region", { name: "Variables" })).toHaveAccessibleDescription(
      "Resolved at experiment start; the resolved configuration is pinned to the run.",
    );
  });
  it("holds the gate, the variables, reproducibility and what publishing freezes, in that order, and no field", async () => {
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);

    const panel = sidePanel(await screen.findByRole("region", { name: "Publish gate" }));

    expect(panelCards(panel)).toEqual([
      "Publish gate",
      "Variables",
      "Reproducibility",
      "What publishing freezes",
    ]);
    expect(panelFields(panel)).toEqual([]);
  });
});

/**
 * The editor's sections on the reference pages' rows (`ShopSetupPages.tsx`): label and rule on
 * the left, control on the right. The cards keep the codebase's grouping; only the rows change.
 */
describe("the agent configuration editor's rows", () => {
  it("draws every field of its cards on a row, found by its own label", async () => {
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);
    const identity = await screen.findByRole("region", { name: "Identity" });

    for (const label of ["Name", "Framework", "Architecture", "Support identity", "Description"]) {
      expectFieldRow(within(identity).getByLabelText(label), label);
    }
    const prompt = screen.getByRole("region", { name: "System prompt" });
    expectFieldRow(await within(prompt).findByLabelText("Preview context"), "Preview context");
    const runtime = screen.getByRole("region", { name: "LLM and runtime" });
    for (const label of ["Provider", "Model", "Temperature", "Max tool rounds"]) {
      expectFieldRow(within(runtime).getByLabelText(label), label);
    }
    // The visible label binds the select; the name a spec reaches it by stays the longer one.
    const tone = screen.getByRole("region", { name: "Tone of voice" });
    expectFieldRow(within(tone).getByLabelText("Source"), "Source");
    expect(within(tone).getByLabelText("Source")).toBe(
      within(tone).getByRole("combobox", { name: "Tone of voice source" }),
    );
  });

  it("draws every field of every card in its main column on a row that names it, with no exception", async () => {
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);
    const panel = sidePanel(await screen.findByRole("region", { name: "Publish gate" }));
    await within(screen.getByRole("region", { name: "System prompt" })).findByLabelText(
      "Preview context",
    );
    // The bindings are read off the resources, so the sweep waits for them as the judge's does.
    await within(screen.getByRole("region", { name: /Tool bindings/ })).findAllByRole("checkbox");

    // Enumerated, so a card added to the column is swept too, and each count says its fields
    // were seen rather than the card passing empty.
    expect(expectEditorOnRows(panel)).toEqual({
      Identity: 5,
      "System prompt": 3,
      "Tone of voice": 1,
      "Tool bindings · 1 enabled": 2,
      "LLM and runtime": 7,
    });
  });

  it("draws the prompt template on a row of its own width, under its visible label", async () => {
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);
    const prompt = await screen.findByRole("region", { name: "System prompt" });

    // The name the specs fill it by is the label drawn over it, and nothing else names it.
    const template = within(prompt).getByRole("textbox", { name: "Prompt template" });
    expect(template.tagName).toBe("TEXTAREA");
    expect(template).not.toHaveAttribute("aria-label");
    expectFieldRow(template, "Prompt template");
    expect(template.parentElement).toHaveClass(fieldRowWideControlClasses, { exact: true });
  });

  it("shows the resolved prompt as an output on a row of the same width, in its own region", async () => {
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);
    const prompt = await screen.findByRole("region", { name: "System prompt" });

    // The region the specs read the chips in keeps its name, and holds the row.
    const region = within(prompt).getByRole("region", { name: "Resolved prompt" });
    const shown = within(region).getByLabelText("Resolved prompt");
    expect(shown.tagName).toBe("OUTPUT");
    expectFieldRow(shown, "Resolved prompt");
    expect(shown.parentElement).toHaveClass(fieldRowWideControlClasses, { exact: true });
    expect(shown).toHaveClass(readOnlyTextClasses, { exact: true });
    expect(await within(shown).findByText("shop.name: Northstar Outfitters")).toBeVisible();
  });

  it("asks for the tool bindings as the Enabled group row, each box named by its tool and described by the rest", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);
    const bindings = await screen.findByRole("region", { name: /Tool bindings/ });

    const enabled = within(bindings).getByRole("group", { name: "Enabled" });
    expectGroupRow(enabled, "Enabled");
    // Each binding is named by its tool alone — what the specs reach it by — and its effect,
    // what the identity lacks for it and what it does are its description, in that order.
    // Swept over the resources, so every tool the editor lists is held to it.
    const boxes = await within(enabled).findAllByRole("checkbox");
    const lacks: Record<string, string> = {
      "orders.propose_address_change": "needs Change shipping address",
    };
    expect(boxes).toHaveLength(RESOURCES.tools.length);
    for (const [index, tool] of RESOURCES.tools.entries()) {
      const box = boxes[index];
      expect(box).toHaveAccessibleName(tool.name);
      expect(box).toHaveAccessibleDescription(
        [tool.effect, lacks[tool.name], tool.summary].filter(Boolean).join(" "),
      );
    }
    const [read, write] = boxes;
    expect(read).toBeChecked();
    await user.click(write);
    expect(write).toBeChecked();
    expect(bindings).toHaveAccessibleName("Tool bindings · 2 enabled");
  });

  it("asks for the memory as a group named by its row, each mode named by its label and described by what it keeps", async () => {
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);
    const runtime = await screen.findByRole("region", { name: "LLM and runtime" });

    const memory = within(runtime).getByRole("group", { name: "Memory" });
    expectGroupRow(memory, "Memory");
    const radios = within(memory).getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("value"))).toEqual([
      "none",
      "conversation",
      "durable",
    ]);
    // Each radio is named by its mode alone and the line under it is its description.
    const modes = [
      ["None", "Every turn starts from the prompt and the tools."],
      ["Conversation", "The run's own turns are replayed to the model."],
      ["Durable", "Memory the lab persists and can restore across runs."],
    ];
    for (const [index, [name, description]] of modes.entries()) {
      expect(radios[index]).toHaveAccessibleName(name);
      expect(radios[index]).toHaveAccessibleDescription(description);
    }
  });

  it("says how the tone of voice resolves under its own field, and what this context resolves it to", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);
    const tone = within(await screen.findByRole("region", { name: "Tone of voice" }));
    const source = tone.getByLabelText("Source");

    expect(source).toHaveAccessibleDescription(
      /Resolves per shop through \{\{shop\.tone_of_voice\}\}\./,
    );
    expect(source).toHaveAccessibleDescription(/An override missing from the target shop fails/);
    await waitFor(() =>
      expect(source).toHaveAccessibleDescription(/This context resolves to Warm and precise\./),
    );

    // On an override the ID's own line says what it resolves to, so this one says nothing.
    await user.selectOptions(source, "override");
    expect(source).not.toHaveAccessibleDescription(/This context resolves to/);
    expectFieldRow(tone.getByLabelText("Guideline ID"), "Guideline ID");
    expect(tone.getByLabelText("Guideline ID")).toHaveAccessibleDescription(
      /The ID of a guideline the target shop publishes/,
    );
  });

  it("puts what the preview context resolves to under the picker, answering its rule", async () => {
    renderAt(`/lab/agent-configurations/${CONFIGURATION_ID}`);
    const prompt = within(await screen.findByRole("region", { name: "System prompt" }));

    expect(await prompt.findByLabelText("Preview context")).toHaveAccessibleDescription(
      /^The shop whose published version, with the adopted identity's, fills the resolved prompt below\./,
    );

    await waitFor(() =>
      expect(prompt.getByLabelText("Preview context")).toHaveAccessibleDescription(
        /Values: Northstar Outfitters v\d+ · Northstar tier 1 v\d+/,
      ),
    );
  });
});
