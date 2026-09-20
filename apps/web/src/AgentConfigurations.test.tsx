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
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { renderApp } from "./test/app";

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
  return renderApp(path);
}

describe("agent configuration workspace", () => {
  it("lists configurations with their framework, model, and publication state", async () => {
    renderAt(`/shops/${SHOP_ID}/agent-configurations`);

    expect(await screen.findByRole("heading", { name: "Agent configurations" })).toBeVisible();
    expect(await screen.findByRole("link", { name: "Frontline single agent" })).toBeVisible();
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Pydantic AI")).toBeVisible();
    expect(table.getByText("gpt-5-mini")).toBeVisible();
    // Scoped to the table: "Never published" is also a filter chip's label now.
    expect(table.getByText("Never published")).toBeVisible();
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
    renderAt(`/shops/${SHOP_ID}/agent-configurations`);
    await screen.findByRole("link", { name: "Frontline single agent" });
    const filters = within(screen.getByRole("group", { name: "Filter agent configurations" }));

    expect(filters.getByRole("button", { name: "All 2" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Adoptable 1" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Never published 1" })).toBeVisible();

    await user.click(filters.getByRole("button", { name: "Adoptable 1" }));

    expect(screen.getByRole("link", { name: "Deterministic control" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Frontline single agent" })).toBeNull();
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

  it("constrains the temperature and puts its range and its exactness under the field", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/agent-configurations/${CONFIGURATION_ID}`);

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
    expect(screen.getByText("needs Change shipping address")).toBeVisible();
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

  it("offers the providers and models the chosen framework is proven on", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/agent-configurations/${CONFIGURATION_ID}`);

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
    renderAt(`/shops/${SHOP_ID}/agent-configurations/${CONFIGURATION_ID}`);

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
    renderAt(`/shops/${SHOP_ID}/agent-configurations/${CONFIGURATION_ID}`);

    const runtime = within(await screen.findByRole("region", { name: "LLM and runtime" }));
    await user.selectOptions(screen.getByLabelText("Framework"), "fake");

    // The provider is reset because a select cannot hold a value it does not offer; the
    // model follows because a model name means nothing outside its provider.
    expect(runtime.getByLabelText("Provider")).toHaveValue("fake");
    expect(runtime.getByLabelText("Model")).toHaveValue("deterministic");
  });

  it("keeps a typed model when the framework changes but the provider does not", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/agent-configurations/${CONFIGURATION_ID}`);

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
    renderAt(`/shops/${SHOP_ID}/agent-configurations/${CONFIGURATION_ID}`);

    const runtime = within(await screen.findByRole("region", { name: "LLM and runtime" }));
    expect(runtime.getByLabelText("Model")).not.toHaveAccessibleDescription(
      /not a model the lab exercises/,
    );
  });

  it("offers the preview shop's own tone guidelines and echoes the one it resolves to", async () => {
    const user = userEvent.setup();
    renderAt(`/shops/${SHOP_ID}/agent-configurations/${CONFIGURATION_ID}`);

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
    renderAt(`/shops/${SHOP_ID}/agent-configurations/${CONFIGURATION_ID}`);

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
