import type {
  JudgeConfigurationDraftResponse,
  JudgeConfigurationListResponse,
  JudgeConfigurationPreviewResponse,
  JudgeConfigurationResourcesResponse,
  JudgeConfigurationVersionResponse,
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
const JUDGE_ID = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const RUBRIC = "Score whether the incident the customer opened was resolved.";

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

const JUDGE: JudgeConfigurationDraftResponse["content"] = {
  name: "Resolution quality",
  description: "Reads the incident as the customer would.",
  rubric: RUBRIC,
  evidence: ["agent_replies", "customer_turns", "tool_calls"],
  model: { provider: "openai", model_id: "gpt-5-mini", temperature: "0.00" },
};

const RESOURCES: JudgeConfigurationResourcesResponse = {
  judges: [
    {
      provider: "openai",
      label: "OpenAI",
      models: ["gpt-5-mini"],
      summary: "The lab's first judge.",
    },
    {
      provider: "fake",
      label: "Deterministic control",
      models: ["deterministic"],
      summary: "Offline judge with no model call.",
    },
  ],
  evidence: ["customer_turns", "agent_replies", "tool_calls", "state_changes"],
  reserved_terms: ["Deterministic fake", "fake", "gpt-5-mini", "openai", "pydantic-ai"],
};

const LIST: JudgeConfigurationListResponse = {
  judges: [
    {
      judge_id: JUDGE_ID,
      name: "Resolution quality",
      provider: "openai",
      provider_label: "OpenAI",
      model_id: "gpt-5-mini",
      evidence_count: 3,
      updated_at: "2026-09-01T09:00:00+00:00",
      latest_published_version: null,
      published_version_count: 0,
    },
  ],
};

function preview(
  overrides: Partial<JudgeConfigurationPreviewResponse> = {},
): JudgeConfigurationPreviewResponse {
  return {
    judge_id: JUDGE_ID,
    publishable: true,
    issues: [],
    changes: [],
    content_fingerprint: "a".repeat(64),
    latest_published_version: null,
    next_version: 1,
    matches_latest_published: false,
    content: currentJudge,
    ...overrides,
  };
}

let currentJudge: JudgeConfigurationDraftResponse["content"] = JUDGE;
let currentPreview: JudgeConfigurationPreviewResponse = preview();
let savedPayloads: Record<string, unknown>[] = [];
let created: Record<string, unknown>[] = [];

const server = setupServer(
  http.get("*/api/v1/shops", () => HttpResponse.json({ shops: [] } satisfies ShopListResponse)),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft`, () =>
    HttpResponse.json({
      shop_id: SHOP_ID,
      lifecycle_state: "draft",
      content: SHOP_CONTENT,
      created_at: "2026-09-01T09:00:00+00:00",
      updated_at: "2026-09-01T09:05:00+00:00",
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
  http.get("*/api/v1/judge-configurations/resources", () => HttpResponse.json(RESOURCES)),
  http.get("*/api/v1/judge-configurations", () => HttpResponse.json(LIST)),
  http.post("*/api/v1/judge-configurations", async ({ request }) => {
    created.push((await request.json()) as Record<string, unknown>);
    return HttpResponse.json(
      {
        judge_id: JUDGE_ID,
        lifecycle_state: "draft",
        content: { ...JUDGE, rubric: "" },
        created_at: "2026-09-01T09:00:00+00:00",
        updated_at: "2026-09-01T09:00:00+00:00",
      } satisfies JudgeConfigurationDraftResponse,
      { status: 201 },
    );
  }),
  http.get(`*/api/v1/judge-configurations/${JUDGE_ID}/draft`, () =>
    HttpResponse.json({
      judge_id: JUDGE_ID,
      lifecycle_state: "draft",
      content: currentJudge,
      created_at: "2026-09-01T09:00:00+00:00",
      updated_at: "2026-09-01T09:05:00+00:00",
    } satisfies JudgeConfigurationDraftResponse),
  ),
  http.put(`*/api/v1/judge-configurations/${JUDGE_ID}/draft`, async ({ request }) => {
    const body = (await request.json()) as { payload: Record<string, unknown> };
    savedPayloads.push(body.payload);
    currentJudge = body.payload as typeof currentJudge;
    return HttpResponse.json({
      judge_id: JUDGE_ID,
      lifecycle_state: "draft",
      content: currentJudge,
      created_at: "2026-09-01T09:00:00+00:00",
      updated_at: "2026-09-01T09:06:00+00:00",
    } satisfies JudgeConfigurationDraftResponse);
  }),
  http.get(`*/api/v1/judge-configurations/${JUDGE_ID}/draft/preview`, () =>
    HttpResponse.json(currentPreview),
  ),
  http.post(`*/api/v1/judge-configurations/${JUDGE_ID}/versions`, () => {
    currentPreview = preview({
      latest_published_version: 1,
      next_version: 2,
      matches_latest_published: true,
    });
    return HttpResponse.json(
      {
        judge_id: JUDGE_ID,
        lifecycle_state: "published",
        version: 1,
        content_fingerprint: "b".repeat(64),
        published_at: "2026-09-01T09:10:00+00:00",
        content: currentJudge,
      } satisfies JudgeConfigurationVersionResponse,
      { status: 201 },
    );
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  currentJudge = JUDGE;
  currentPreview = preview();
  savedPayloads = [];
  created = [];
});
afterAll(() => server.close());

function renderAt(path: string) {
  return renderApp(path);
}

describe("judge workspace", () => {
  it("lists judges with the model that scores and their publication state", async () => {
    renderAt("/lab/judges");

    expect(await screen.findByRole("heading", { name: "Judges" })).toBeVisible();
    expect(await screen.findByRole("link", { name: "Resolution quality" })).toBeVisible();
    const table = within(screen.getByRole("table"));
    expect(table.getByText("OpenAI")).toBeVisible();
    expect(table.getByText("Never published")).toBeVisible();
  });

  it("counts the judges a scenario could score with, and filters to them", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/v1/judge-configurations", () =>
        HttpResponse.json({
          judges: [
            ...LIST.judges,
            {
              ...LIST.judges[0],
              judge_id: "9e8d7c6b-5a49-4837-9261-0f1e2d3c4b5a",
              name: "Tone",
              latest_published_version: 1,
              published_version_count: 1,
            },
          ],
        } satisfies JudgeConfigurationListResponse),
      ),
    );
    renderAt("/lab/judges");
    await screen.findByRole("link", { name: "Resolution quality" });
    const filters = within(screen.getByRole("group", { name: "Filter judges" }));

    expect(filters.getByRole("button", { name: "All 2" })).toBeVisible();
    expect(filters.getByRole("button", { name: "Usable 1" })).toBeVisible();

    await user.click(filters.getByRole("button", { name: "Usable 1" }));

    expect(screen.getByRole("link", { name: "Tone" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Resolution quality" })).toBeNull();
  });

  it("creates a judge with no rubric, because the rubric is what an author writes", async () => {
    const user = userEvent.setup();
    renderAt("/lab/judges");

    await user.type(await screen.findByLabelText("Name"), "Tone");
    await user.click(screen.getByRole("button", { name: "Create judge" }));

    await waitFor(() => expect(created).toEqual([{ name: "Tone" }]));
  });

  it("puts the name hint in that control's accessible description", async () => {
    renderAt("/lab/judges");

    const card = within(await screen.findByRole("region", { name: "New judge" }));
    expect(card.getByLabelText("Name")).toHaveAccessibleDescription(
      /how this judge is listed.*rubric is written in the editor/i,
    );
  });

  it("constrains the judge's temperature the way the agent editor constrains its own", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/judges/${JUDGE_ID}`);

    const temperature = await screen.findByLabelText("Temperature");
    expect(temperature).toHaveAttribute("inputmode", "decimal");
    expect(temperature).toHaveAccessibleDescription(/Between 0 and 2, with at most two decimals/);

    await user.clear(temperature);
    await user.type(temperature, "3.5");
    // The pattern cannot say the upper bound; what it can say is the shape.
    expect(temperature).toBeValid();
    await user.clear(temperature);
    await user.type(temperature, "0.001");
    expect(temperature).toBeInvalid();
  });

  it("moves the model onto the provider the author just chose", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/judges/${JUDGE_ID}`);

    const model = within(await screen.findByRole("region", { name: "Model" }));
    expect(model.getByLabelText("Model")).toHaveValue("gpt-5-mini");

    await user.selectOptions(model.getByLabelText("Provider"), "fake");

    // `gpt-5-mini` is not something the offline control runs, so it is not a value the
    // author could have meant by the provider they just chose.
    expect(model.getByLabelText("Model")).toHaveValue("deterministic");
  });

  it("offers only the models the chosen provider is proven on", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/judges/${JUDGE_ID}`);

    const card = within(await screen.findByRole("region", { name: "Model" }));
    const list = card.getByLabelText("Model").getAttribute("list");
    const options = () =>
      [...document.querySelectorAll(`#${list} option`)].map((option) =>
        option.getAttribute("value"),
      );

    expect(options()).toEqual(["gpt-5-mini"]);
    await user.selectOptions(card.getByLabelText("Provider"), "fake");
    expect(options()).toEqual(["deterministic"]);
  });

  it("keeps a draft's off-list provider on the select rather than misreporting it", async () => {
    // Reachable through the API: `judge_capability_issues` takes any provider string. A select
    // that dropped the option would display `openai` while the payload held `acme`.
    currentJudge = { ...JUDGE, model: { ...JUDGE.model, provider: "acme" } };
    renderAt(`/lab/judges/${JUDGE_ID}`);

    const card = within(await screen.findByRole("region", { name: "Model" }));
    const provider = card.getByLabelText("Provider");

    expect(provider).toHaveValue("acme");
    expect(within(provider).getByRole("option", { name: "acme" })).toBeInTheDocument();
    // The judge gate's own sentence, which names no framework because a judge has none.
    expect(provider).toHaveAccessibleDescription(
      /acme is not a provider the lab has proven it can judge with/,
    );
  });

  it("spells a provider the way the rest of the workspace spells it", async () => {
    renderAt(`/lab/judges/${JUDGE_ID}`);

    const card = within(await screen.findByRole("region", { name: "Model" }));
    const provider = card.getByLabelText("Provider");
    expect(within(provider).getByRole("option", { name: "OpenAI" })).toBeInTheDocument();
    expect(
      within(provider).getByRole("option", { name: "Deterministic control" }),
    ).toBeInTheDocument();
  });

  it("warns in the field about a model the lab does not exercise", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/judges/${JUDGE_ID}`);

    const card = within(await screen.findByRole("region", { name: "Model" }));
    const model = card.getByLabelText("Model");
    // A datalist rather than a select, because the gate warns here rather than refusing:
    // the value stands, and the warning is read where it was typed.
    await user.clear(model);
    await user.type(model, "gpt-5-nano");

    expect(model).toHaveAccessibleDescription(/gpt-5-nano is not a model the lab exercises/);
    expect(model).toHaveAccessibleDescription(/OpenAI is proven on gpt-5-mini/);
  });

  it("saves the provider and the model a provider change moved together", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/judges/${JUDGE_ID}`);

    const model = within(await screen.findByRole("region", { name: "Model" }));
    await user.selectOptions(model.getByLabelText("Provider"), "fake");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect(savedPayloads[0].model).toMatchObject({
      provider: "fake",
      model_id: "deterministic",
    });
  });

  it("shows what each kind of evidence puts in front of the judge", async () => {
    renderAt(`/lab/judges/${JUDGE_ID}`);

    const evidence = await screen.findByRole("region", { name: "Evidence" });
    expect(
      within(evidence).getByText(
        /what this arm answered; without it the judge scores what the arm did, not what it said/,
      ),
    ).toBeVisible();
    expect(within(evidence).getByRole("checkbox", { name: /Agent replies/ })).toBeChecked();
    expect(within(evidence).getByRole("checkbox", { name: /State changes/ })).not.toBeChecked();
  });

  it("saves a change to what the judge is shown, because it changes the question", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/judges/${JUDGE_ID}`);

    const evidence = await screen.findByRole("region", { name: "Evidence" });
    await user.click(within(evidence).getByRole("checkbox", { name: /State changes/ }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect(savedPayloads[0].evidence).toContain("state_changes");
  });

  it("names the words a rubric may not contain, read from the server", async () => {
    renderAt(`/lab/judges/${JUDGE_ID}`);

    const anonymity = await screen.findByRole("region", { name: "Anonymity" });
    expect(within(anonymity).getByText(/pydantic-ai/)).toBeVisible();
  });

  it("refuses to publish a rubric that names what an arm runs, and says which word", async () => {
    currentPreview = preview({
      publishable: false,
      issues: [
        {
          severity: "error",
          code: "rubric_names_an_arm",
          message:
            "the rubric names pydantic-ai, and a judge is shown no such thing: the brief " +
            "carries what the arm did, never what ran it",
          path: "rubric",
        },
      ],
    });
    renderAt(`/lab/judges/${JUDGE_ID}`);

    const gate = await screen.findByRole("region", { name: "Publish gate" });
    expect(within(gate).getByText(/the rubric names pydantic-ai/)).toBeVisible();
    expect(screen.getByRole("button", { name: /Publish v1/ })).toBeDisabled();
  });

  it("publishes the judge every later verdict will name", async () => {
    const user = userEvent.setup();
    renderAt(`/lab/judges/${JUDGE_ID}`);

    await user.click(await screen.findByRole("button", { name: "Publish v1" }));

    expect(
      await screen.findByText(/Published version 1\. Every verdict records the version/),
    ).toBeVisible();
  });
});
