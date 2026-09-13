import type {
  AgentConfigurationDraftResponse,
  AgentConfigurationListResponse,
  AgentConfigurationPreviewResponse,
  AgentConfigurationResourcesResponse,
  AgentConfigurationVersionResponse,
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
    { shop_id: SHOP_ID, name: "Northstar Outfitters", latest_published_version: 3 },
    { shop_id: OTHER_SHOP_ID, name: "Southline Supply", latest_published_version: 1 },
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

let currentConfiguration = CONFIGURATION;
let currentPreview = preview();
let savedPayloads: Array<Record<string, unknown>> = [];
let previewShopIds: Array<string | null> = [];

const server = setupServer(
  http.get("*/api/v1/shops", () => HttpResponse.json({ shops: [] } satisfies ShopListResponse)),
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
  http.get("*/api/v1/agent-configurations", () => HttpResponse.json(configurations)),
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
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  currentConfiguration = CONFIGURATION;
  currentPreview = preview();
  savedPayloads = [];
  previewShopIds = [];
});
afterAll(() => server.close());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("agent configuration workspace", () => {
  it("lists configurations with their framework, model, and publication state", async () => {
    renderAt(`/shops/${SHOP_ID}/agent-configurations`);

    expect(await screen.findByRole("heading", { name: "Agent configurations" })).toBeVisible();
    expect(await screen.findByRole("link", { name: "Frontline single agent" })).toBeVisible();
    expect(screen.getByText("Pydantic AI")).toBeVisible();
    expect(screen.getByText("gpt-5-mini")).toBeVisible();
    expect(screen.getByText("Never published")).toBeVisible();
  });

  it("puts each field's hint in that control's accessible description", async () => {
    renderAt(`/shops/${SHOP_ID}/agent-configurations`);

    const card = within(await screen.findByRole("region", { name: "New agent configuration" }));
    expect(await card.findByLabelText("Name")).toHaveAccessibleDescription(
      /listed on the bench and in history/i,
    );
    expect(card.getByLabelText("Support identity")).toHaveAccessibleDescription(
      /publishing pins the support-identity version a configuration names/i,
    );
  });

  it("repeats the pinning sentence on the editor", async () => {
    renderAt(`/shops/${SHOP_ID}/agent-configurations/${CONFIGURATION_ID}`);
    expect(
      await screen.findByText(
        /publishing pins the support-identity version a configuration names/i,
      ),
    ).toBeVisible();
  });

  it("repeats the pinning sentence when no support identity exists yet", async () => {
    server.use(
      http.get("*/api/v1/agent-configurations/resources", () =>
        HttpResponse.json({ ...RESOURCES, support_identities: [] }),
      ),
    );
    renderAt(`/shops/${SHOP_ID}/agent-configurations`);
    expect(
      await screen.findByText(
        /publishing pins the support-identity version a configuration names/i,
      ),
    ).toBeVisible();
    expect(screen.queryByLabelText("Support identity")).toBeNull();
  });

  it("renders each prompt variable as a chip carrying its resolved value", async () => {
    renderAt(`/shops/${SHOP_ID}/agent-configurations/${CONFIGURATION_ID}`);

    const resolved = await screen.findByRole("region", { name: "Resolved prompt" });
    expect(within(resolved).getByText("shop.name: Northstar Outfitters")).toBeVisible();
    expect(
      within(resolved).getByText("support_identity.role: Customer support representative"),
    ).toBeVisible();
    expect(within(resolved).getByText("customer.name · not injectable")).toBeVisible();
  });

  it("explains why a tool-discovered fact cannot be injected into the prompt", async () => {
    renderAt(`/shops/${SHOP_ID}/agent-configurations/${CONFIGURATION_ID}`);

    expect(
      await screen.findByText(/customer, order, and ticket facts are discovered through tools/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Insert customer.name" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Insert shop.locale" })).toBeEnabled();
  });

  it("inserts a variable into the prompt at the caret", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/agent-configurations/${CONFIGURATION_ID}`);

    const prompt = await screen.findByLabelText("Prompt template");
    await user.clear(prompt);
    await user.type(prompt, "Answer for ");
    await user.click(screen.getByRole("button", { name: "Insert shop.locale" }));

    await waitFor(() => expect(prompt).toHaveValue("Answer for {{shop.locale}}"));
  });

  it("inserts a variable mid-text and leaves the caret after the chip", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/agent-configurations/${CONFIGURATION_ID}`);

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
    renderAt(`/shops/${SHOP_ID}/agent-configurations/${CONFIGURATION_ID}`);

    const binding = await screen.findByLabelText(/orders.propose_address_change/);
    expect(binding).not.toBeChecked();
    expect(screen.getByText("needs change shipping address")).toBeVisible();
  });

  it("resolves the prompt against the shop the author selects", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/agent-configurations/${CONFIGURATION_ID}`);

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
    renderAt(`/shops/${SHOP_ID}/agent-configurations/${CONFIGURATION_ID}`);

    await user.click(await screen.findByLabelText(/orders.propose_address_change/));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/must be a decimal number/);
    expect(screen.getByLabelText(/orders.propose_address_change/)).toBeChecked();
  });

  it("saves the enabled tool set and then publishes the saved draft", async () => {
    const user = userEvent.setup();
    currentPreview = preview({ publishable: true, issues: [] });
    renderAt(`/shops/${SHOP_ID}/agent-configurations/${CONFIGURATION_ID}`);

    const binding = await screen.findByLabelText(/orders.propose_address_change/);
    await user.click(binding);
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect(savedPayloads[0].tools).toEqual(["orders.read_order", "orders.propose_address_change"]);

    await user.click(screen.getByRole("button", { name: "Publish v1" }));

    expect(await screen.findByText(/Published version 1/)).toBeVisible();
  });
});
