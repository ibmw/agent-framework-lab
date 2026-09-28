import type {
  JudgeConfigurationDraftResponse,
  JudgeConfigurationListResponse,
  JudgeConfigurationPreviewResponse,
  JudgeConfigurationResourcesResponse,
  JudgeConfigurationVersionResponse,
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
import { renderApp } from "./test/app";
import { labConnection } from "./test/connection";
import { expectWayBack } from "./test/header";
import { mainCards, panelCards, panelFields, sidePanel } from "./test/panel";
import { expectNotRefused, expectRefused } from "./test/refused";
import { bodyRows, railEntry, shellListings } from "./test/shell";

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
  logo: null,
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

const NEW_JUDGE_ID = "2b3c4d5e-6f70-4812-9345-6a7b8c9d0e1f";

/** What the lab makes from a create request: a judge with the proven model and no rubric. */
const NEW_DRAFT: JudgeConfigurationDraftResponse["content"] = {
  name: "",
  description: "",
  rubric: "",
  evidence: ["customer_turns", "agent_replies", "tool_calls"],
  model: { provider: "openai", model_id: "gpt-5-mini", temperature: "0.00" },
};

let currentJudge: JudgeConfigurationDraftResponse["content"] = JUDGE;
let currentPreview: JudgeConfigurationPreviewResponse = preview();
let savedPayloads: Record<string, unknown>[] = [];
let created: Record<string, unknown>[] = [];
let completed: Record<string, unknown>[] = [];
let listed: JudgeConfigurationListResponse = LIST;
/**
 * How many times the listing the lab's rail counts has been read.
 *
 * The figure alone cannot say *when* it moved, and two of the cases below are about exactly
 * that: that the create re-reads the listing the moment the judge exists rather than on its
 * way out, and that a run which has been stood down reads nothing further (ADR 0056).
 */
let listingReads = 0;
/** Which answer of ADR 0052's chain the lab gives; a lab that reaches its provider by default. */
let connectionSource: ModelConnectionSource = "environment";
const connectionServed = { statuses: 0, listings: 0 };

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
  http.get("*/api/v1/judge-configurations", () => {
    listingReads += 1;
    return HttpResponse.json(listed);
  }),
  // A create makes the lab hold one judge more, which is what lets a test watch the rail's
  // figure move rather than agree with a fixture (ADR 0056).
  http.post("*/api/v1/judge-configurations", async ({ request }) => {
    const command = (await request.json()) as Record<string, unknown>;
    created.push(command);
    const content = { ...NEW_DRAFT, name: String(command.name) };
    listed = {
      judges: [
        ...listed.judges,
        {
          judge_id: NEW_JUDGE_ID,
          name: content.name,
          provider: content.model.provider,
          provider_label: "OpenAI",
          model_id: content.model.model_id,
          evidence_count: content.evidence.length,
          updated_at: "2026-09-01T09:10:00+00:00",
          latest_published_version: null,
          published_version_count: 0,
        },
      ],
    };
    return HttpResponse.json(
      {
        judge_id: NEW_JUDGE_ID,
        lifecycle_state: "draft",
        content,
        created_at: "2026-09-01T09:00:00+00:00",
        updated_at: "2026-09-01T09:00:00+00:00",
      } satisfies JudgeConfigurationDraftResponse,
      { status: 201 },
    );
  }),
  http.put(`*/api/v1/judge-configurations/${NEW_JUDGE_ID}/draft`, async ({ request }) => {
    const body = (await request.json()) as { payload: Record<string, unknown> };
    completed.push(body.payload);
    return HttpResponse.json({
      judge_id: NEW_JUDGE_ID,
      lifecycle_state: "draft",
      content: body.payload as JudgeConfigurationDraftResponse["content"],
      created_at: "2026-09-01T09:00:00+00:00",
      updated_at: "2026-09-01T09:06:00+00:00",
    } satisfies JudgeConfigurationDraftResponse);
  }),
  http.get(`*/api/v1/judge-configurations/${NEW_JUDGE_ID}/draft`, () =>
    HttpResponse.json({
      judge_id: NEW_JUDGE_ID,
      lifecycle_state: "draft",
      content: {
        ...NEW_DRAFT,
        name: String(created.at(-1)?.name ?? ""),
        rubric: String((completed.at(-1)?.rubric as string | undefined) ?? ""),
      },
      created_at: "2026-09-01T09:00:00+00:00",
      updated_at: "2026-09-01T09:06:00+00:00",
    } satisfies JudgeConfigurationDraftResponse),
  ),
  http.get(`*/api/v1/judge-configurations/${NEW_JUDGE_ID}/draft/preview`, () =>
    HttpResponse.json({ ...currentPreview, judge_id: NEW_JUDGE_ID }),
  ),
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
  ...labConnection(() => connectionSource, connectionServed),
  // The shop and lab shells read every listing their rail counts (ADR 0056). Last, so a
  // handler this suite declares for one of these routes still wins.
  ...shellListings(),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  currentJudge = JUDGE;
  currentPreview = preview();
  savedPayloads = [];
  created = [];
  completed = [];
  listed = LIST;
  listingReads = 0;
  connectionSource = "environment";
  connectionServed.statuses = 0;
  connectionServed.listings = 0;
});
afterAll(() => server.close());

function renderAt(path: string) {
  return renderApp(path);
}

/** A promise this test resolves by hand, so a write can be held open while the operator acts. */
function heldOpen() {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

/**
 * Every turn a stood-down run would need to carry on in.
 *
 * `waitFor` proves something happened; nothing proves something did not except giving the
 * continuation its turns and then looking. The run's remaining steps are all microtasks
 * after one `await`, so a macrotask boundary is past every one of them.
 */
async function everyRemainingTurn() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("judge workspace", () => {
  // The card's title says what the list is (a judge scores the objectives a scenario leaves to a judge), on the header line opposite the search.
  it("titles its card What a scenario leaves to a judge, opposite the search box", async () => {
    renderAt("/lab/judges");

    const box = await screen.findByRole("searchbox", { name: "Search judges" });
    const title = screen.getByRole("heading", {
      level: 2,
      name: "What a scenario leaves to a judge",
    });
    expect(title.parentElement).toContainElement(box);
  });

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

  it("opens the Rubric card on the lab's rule, which is still the rubric's own description", async () => {
    renderAt(`/lab/judges/${JUDGE_ID}`);

    const rubric = await screen.findByRole("textbox", { name: "How this judge scores" });
    const card = screen.getByRole("region", { name: "Rubric" });
    const rule = within(card).getByText(/What "met", "missed", and "unclear" mean/);
    // The card's first line, ahead of the fields it is about...
    expect(rule.parentElement?.firstElementChild).toBe(rule);
    expect(card).toHaveAccessibleDescription(/is the lab's rule and travels above every rubric/);
    // ...and still the field's description, by the id the field names.
    expect(rubric).toHaveAccessibleDescription(/is the lab's rule and travels above every rubric/);
  });

  it("says under the rubric what the gate will refuse it for, as it is typed, and saves it", async () => {
    const user = userEvent.setup();
    const names = (term: string) =>
      `the rubric names ${term}, and a judge is shown no such thing: the brief carries what the arm did, never what ran it`;
    const empty = "a published judge must carry the rubric it scores by";
    renderAt(`/lab/judges/${JUDGE_ID}`);

    const rubric = await screen.findByRole("textbox", { name: "How this judge scores" });
    const card = within(screen.getByRole("region", { name: "Rubric" }));
    expect(rubric).toHaveAttribute("aria-required", "true");
    await screen.findByText(/pydantic-ai/);
    expect(rubric).not.toHaveAttribute("aria-invalid");
    expect(card.queryByText(/the rubric names/)).toBeNull();

    // Required: the gate's `rubric_empty`, said once the rubric is empty and only then.
    await user.clear(rubric);
    const line = card.getByText(empty);
    expect(line).toBeVisible();
    expect(line.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
    expect(rubric).toHaveAttribute("aria-invalid", "true");
    expect(rubric).toHaveAccessibleDescription(new RegExp(empty));

    // One sentence per reserved term the rubric names, in the order the catalog serves them —
    // and a term inside a longer word, or joined by a hyphen, is not named.
    await user.type(rubric, "Prefer the deterministic FAKE arm, not a fake-friendly one.");
    expect(card.queryByText(empty)).toBeNull();
    const findings = rubric.getAttribute("aria-describedby")?.split(" ").at(-1) ?? "";
    expect(
      Array.from(document.getElementById(findings)?.children ?? [], (entry) => entry.textContent),
    ).toEqual([names("Deterministic fake"), names("fake")]);
    expect(rubric).toHaveAccessibleDescription(new RegExp(names("fake")));

    await user.clear(rubric);
    await user.type(rubric, "Score the gpt-5-mini-2 answer, and the one on gpt-5-mini.");
    expect(card.getByText(names("gpt-5-mini"))).toBeVisible();
    expect(card.queryByText(names("fake"))).toBeNull();

    await user.clear(rubric);
    await user.type(rubric, "Score the fakery on the unfaked order.");
    expect(card.queryByText(/the rubric names/)).toBeNull();
    expect(rubric).not.toHaveAttribute("aria-invalid");

    // Findings, not refusals: the draft saves with one, as the lab stores it.
    await user.clear(rubric);
    await user.type(rubric, "Prefer the openai arm.");
    expect(card.getByText(names("openai"))).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(savedPayloads).toHaveLength(1));
    expect(savedPayloads[0].rubric).toBe("Prefer the openai arm.");
  });

  it("names the terms the catalog serves, not a list of its own", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/v1/judge-configurations/resources", () =>
        HttpResponse.json({ ...RESOURCES, reserved_terms: ["zeta-agents"] }),
      ),
    );
    renderAt(`/lab/judges/${JUDGE_ID}`);

    const rubric = await screen.findByRole("textbox", { name: "How this judge scores" });
    await screen.findByText(/zeta-agents/);
    await user.clear(rubric);
    await user.type(rubric, "Prefer the pydantic-ai arm to the Zeta-Agents one.");

    const card = within(screen.getByRole("region", { name: "Rubric" }));
    // Named as the catalog spells it, whatever case the rubric typed it in, as the gate does.
    expect(card.getByText(/^the rubric names zeta-agents, and a judge/)).toBeVisible();
    expect(card.queryByText(/the rubric names pydantic-ai/)).toBeNull();
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
    expectRefused(
      screen.getByRole("button", { name: /Publish v1/ }),
      /Resolve 1 error\(s\) to publish/,
    );
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

/** Both connection reads answered, and a turn for the page to draw what they said. */
async function connectionRead() {
  await waitFor(() => {
    expect(connectionServed.statuses).toBeGreaterThanOrEqual(1);
    expect(connectionServed.listings).toBeGreaterThanOrEqual(1);
  });
  await everyRemainingTurn();
}

/**
 * The judge inherits ADR 0053 unchanged: the same note, from the same connection resource,
 * beside the same field, and never in the gate.
 */
describe("the provider the lab can reach", () => {
  const NOTE =
    "Published configurations naming OpenAI cannot be advanced here until the lab has a connection for it.";

  for (const source of ["none", "saved_unreadable"] as const) {
    it(`says beside the provider, and only there, that a lab on ${source} cannot score with it`, async () => {
      connectionSource = source;
      renderAt(`/lab/judges/${JUDGE_ID}`);

      const model = within(await screen.findByRole("region", { name: "Model" }));
      const provider = model.getByLabelText("Provider");
      await waitFor(() => expect(provider).toHaveAccessibleDescription(new RegExp(NOTE)));

      expect(screen.getAllByText(NOTE)).toHaveLength(1);
      expect(
        within(screen.getByRole("region", { name: "Publish gate" })).queryByText(NOTE),
      ).toBeNull();
      expect(screen.queryByText(/to publish\./)).toBeNull();
      expectNotRefused(screen.getByRole("button", { name: "Publish v1" }));
    });
  }

  it("keeps the note out of the gate's findings and PublishReasons while those have something to say", async () => {
    connectionSource = "none";
    currentPreview = preview({
      publishable: false,
      issues: [
        {
          severity: "error",
          code: "rubric_empty",
          message: "a published judge must carry the rubric it scores by",
          path: "rubric",
        },
      ],
    });
    renderAt(`/lab/judges/${JUDGE_ID}`);

    const gate = within(await screen.findByRole("region", { name: "Publish gate" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Provider")).toHaveAccessibleDescription(new RegExp(NOTE)),
    );
    expect(gate.getByText(/a published judge must carry the rubric/)).toBeVisible();
    expect(screen.getByText("Resolve 1 error(s) to publish.")).toBeVisible();
    expect(gate.queryByText(NOTE)).toBeNull();
    expect(screen.getAllByText(NOTE)).toHaveLength(1);
  });

  for (const source of ["saved", "environment"] as const) {
    it(`says nothing about reaching a provider the lab reaches through ${source}`, async () => {
      connectionSource = source;
      renderAt(`/lab/judges/${JUDGE_ID}`);

      const provider = await screen.findByLabelText("Provider");
      await connectionRead();
      expect(provider).not.toHaveAccessibleDescription(/cannot be advanced here/);
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
      renderAt(`/lab/judges/${JUDGE_ID}`);

      const provider = await screen.findByLabelText("Provider");
      await connectionRead();
      expect(provider).not.toHaveAccessibleDescription(/cannot be advanced here/);
      expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
    });
  }

  it("says nothing about the control judge, which reaches no provider to begin with", async () => {
    const user = userEvent.setup();
    connectionSource = "none";
    renderAt(`/lab/judges/${JUDGE_ID}`);

    const provider = await screen.findByLabelText("Provider");
    await waitFor(() => expect(provider).toHaveAccessibleDescription(new RegExp(NOTE)));
    await user.selectOptions(provider, "fake");

    expect(provider).toHaveValue("fake");
    expect(provider).not.toHaveAccessibleDescription(/cannot be advanced here/);
  });

  it("stops saying it once a connection is saved", async () => {
    connectionSource = "none";
    const { router } = renderAt(`/lab/judges/${JUDGE_ID}`);
    await waitFor(() =>
      expect(screen.getByLabelText("Provider")).toHaveAccessibleDescription(new RegExp(NOTE)),
    );

    // The operator saves a connection from the settings page and comes back.
    connectionSource = "saved";
    await act(() => router.navigate("/settings"));
    await screen.findByRole("heading", { name: "Lab settings" });
    connectionServed.statuses = 0;
    connectionServed.listings = 0;
    await act(() => router.navigate(`/lab/judges/${JUDGE_ID}`));

    const provider = await screen.findByLabelText("Provider");
    await connectionRead();
    expect(provider).not.toHaveAccessibleDescription(/cannot be advanced here/);
    expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
  });
});

/**
 * Creating is a page, and this one will not go without the rubric (PLAN-UX Slice 13).
 */
describe("the new-judge page", () => {
  it("is reached from the index's own header, which carries no create card", async () => {
    const user = userEvent.setup();
    renderAt("/lab/judges");

    await screen.findByRole("link", { name: "Resolution quality" });
    expect(screen.queryByRole("region", { name: "New judge" })).toBeNull();

    await user.click(screen.getByRole("link", { name: "New judge" }));

    expect(await screen.findByRole("heading", { level: 1, name: "New judge" })).toBeVisible();
    expect(screen.getByText(/creating a judge/)).toBeVisible();
  });

  it("tells an operator the rubric is missing, beside the button that will not press", async () => {
    const user = userEvent.setup();
    renderAt("/lab/judges/new");

    const create = await screen.findByRole("button", { name: "Create judge" });
    await user.type(screen.getByLabelText("Name"), "Tone");

    // The slice's own evidence: the reason names what is actually missing, and it is read
    // beside the control rather than only hovered.
    const reason =
      "The judge has no rubric yet, and the rubric is the whole of what a judge is: nothing can be scored until it is written.";
    expectRefused(create, reason);
    expect(create).toHaveAccessibleDescription(reason);
    expect(create).toHaveAttribute("title", reason);
    expect(screen.getByText(reason)).toBeVisible();

    await user.type(screen.getByLabelText("Criteria"), "Score whether the incident was resolved.");

    expectNotRefused(create);
    expect(screen.queryByText(reason)).toBeNull();
  });

  it("puts each field's hint in that control's accessible description", async () => {
    renderAt("/lab/judges/new");

    expect(await screen.findByLabelText("Name")).toHaveAccessibleDescription(
      /how this judge is listed.*an objective names the judge that scores it/i,
    );
    expect(screen.getByLabelText("Criteria")).toHaveAccessibleDescription(
      /what a met objective looks like.*cannot be created here/i,
    );
  });

  it("names the judge before the rubric while there is no name either", async () => {
    renderAt("/lab/judges/new");

    const create = await screen.findByRole("button", { name: "Create judge" });
    await waitFor(() =>
      expect(create).toHaveAccessibleDescription(
        "The judge needs a name before it can be created.",
      ),
    );
  });

  it("makes the judge, saves the rubric it could not carry, and lands in its editor", async () => {
    const user = userEvent.setup();
    renderAt("/lab/judges/new");

    await user.type(await screen.findByLabelText("Name"), "Tone");
    await user.type(screen.getByLabelText("Criteria"), "Score whether the tone stayed warm.");
    await user.click(screen.getByRole("button", { name: "Create judge" }));

    // The create request carries the name the contract takes; the rubric is the second
    // write, because `CreateJudgeConfigurationRequest` has nowhere to put it.
    await waitFor(() => expect(created).toEqual([{ name: "Tone" }]));
    await waitFor(() => expect(completed).toHaveLength(1));
    expect(completed[0]).toMatchObject({
      name: "Tone",
      rubric: "Score whether the tone stayed warm.",
    });

    // And the operator ends in the judge editor with the name they typed in its header.
    expect(await screen.findByRole("heading", { level: 1, name: "Tone" })).toBeVisible();
  });

  it("moves the model onto the provider the author just chose", async () => {
    const user = userEvent.setup();
    renderAt("/lab/judges/new");

    expect(await screen.findByLabelText("Model")).toHaveValue("gpt-5-mini");
    await user.selectOptions(screen.getByLabelText("Provider"), "fake");
    expect(screen.getByLabelText("Model")).toHaveValue("deterministic");
  });

  it("asks about the rubric once the judge exists and the write that carries it was refused", async () => {
    // ADR 0051 keeps a half-typed create form out of the register — nothing exists to lose.
    // It stops being true the moment the first write lands: the rubric is on screen and
    // nowhere else, so the page declares it with its own second write as the save.
    const user = userEvent.setup();
    let refuse = true;
    server.use(
      http.put(`*/api/v1/judge-configurations/${NEW_JUDGE_ID}/draft`, async ({ request }) => {
        if (refuse) {
          refuse = false;
          return HttpResponse.error();
        }
        const body = (await request.json()) as { payload: Record<string, unknown> };
        completed.push(body.payload);
        return HttpResponse.json({
          judge_id: NEW_JUDGE_ID,
          lifecycle_state: "draft",
          content: body.payload as JudgeConfigurationDraftResponse["content"],
          created_at: "2026-09-01T09:00:00+00:00",
          updated_at: "2026-09-01T09:06:00+00:00",
        } satisfies JudgeConfigurationDraftResponse);
      }),
    );
    renderAt("/lab/judges/new");

    await user.type(await screen.findByLabelText("Name"), "Tone");
    await user.type(screen.getByLabelText("Criteria"), "Score whether the tone stayed warm.");
    await user.click(screen.getByRole("button", { name: "Create judge" }));
    expect(
      await screen.findByText(/The judge was created, but its rubric could not be saved/),
    ).toBeVisible();

    const rail = within(screen.getByRole("navigation", { name: "Experiment lab workspace" }));
    await user.click(rail.getByRole("link", { name: "Judges" }));

    const prompt = within(await screen.findByRole("dialog", { name: "Unsaved changes" }));
    expect(
      prompt.getByText("Judge Tone was created without the rubric written for it."),
    ).toBeVisible();

    await user.click(prompt.getByRole("button", { name: "Save and leave" }));

    await waitFor(() => expect(completed).toHaveLength(1));
    expect(completed[0]).toMatchObject({ rubric: "Score whether the tone stayed warm." });
    expect(await screen.findByRole("heading", { level: 1, name: "Judges" })).toBeVisible();
  });

  it("re-reads the listing the moment the judge exists, refused rubric or not", async () => {
    // ADR 0056's invalidation rule is about what the surface *did*, not about whether it
    // finished: the lab holds one judge more from the `POST`, so the rail must already say
    // so while the operator is still standing here reading why the rubric did not save.
    const user = userEvent.setup();
    server.use(
      http.put(`*/api/v1/judge-configurations/${NEW_JUDGE_ID}/draft`, () => HttpResponse.error()),
    );
    renderAt("/lab/judges/new");

    const entry = railEntry("Judges", "Experiment lab workspace");
    await waitFor(() => expect(within(entry).getByText("1")).toBeVisible());

    await user.type(await screen.findByLabelText("Name"), "Tone");
    await user.type(screen.getByLabelText("Criteria"), "Score whether the tone stayed warm.");
    await user.click(screen.getByRole("button", { name: "Create judge" }));

    expect(
      await screen.findByText(/The judge was created, but its rubric could not be saved/),
    ).toBeVisible();
    // Still on the create page — and the rail has already moved, before any retry.
    expect(screen.getByText("created · its rubric is not saved yet")).toBeVisible();
    expect(within(railEntry("Judges", "Experiment lab workspace")).getByText("2")).toBeVisible();
  });

  it("sends the rubric as corrected after a refusal, not the one the first press held", async () => {
    const user = userEvent.setup();
    let refuse = true;
    server.use(
      http.put(`*/api/v1/judge-configurations/${NEW_JUDGE_ID}/draft`, async ({ request }) => {
        if (refuse) {
          refuse = false;
          return HttpResponse.error();
        }
        const body = (await request.json()) as { payload: Record<string, unknown> };
        completed.push(body.payload);
        return HttpResponse.json({
          judge_id: NEW_JUDGE_ID,
          lifecycle_state: "draft",
          content: body.payload as JudgeConfigurationDraftResponse["content"],
          created_at: "2026-09-01T09:00:00+00:00",
          updated_at: "2026-09-01T09:06:00+00:00",
        } satisfies JudgeConfigurationDraftResponse);
      }),
    );
    renderAt("/lab/judges/new");

    await user.type(await screen.findByLabelText("Name"), "Tone");
    await user.type(screen.getByLabelText("Criteria"), "Score the warmth.");
    await user.click(screen.getByRole("button", { name: "Create judge" }));
    await screen.findByText(/The judge was created, but its rubric could not be saved/);

    await user.clear(screen.getByLabelText("Criteria"));
    await user.type(screen.getByLabelText("Criteria"), "Score whether the tone stayed warm.");
    await user.click(screen.getByRole("button", { name: "Create judge" }));

    // The second write sends the form's current answers, so a rubric corrected after a
    // refusal is the one that lands — and no second judge was made.
    await waitFor(() => expect(completed).toHaveLength(1));
    expect(completed[0]).toMatchObject({ rubric: "Score whether the tone stayed warm." });
    expect(created).toHaveLength(1);
  });

  it("stands the running write down when the operator discards it and leaves", async () => {
    // `submit` is a plain async continuation and outlives this page, so every await in it is
    // a place to leave from. A run that kept going would write again and navigate somebody
    // who has gone elsewhere into an editor (ADR 0051's "Discard throws each piece away").
    // What it may still do is re-read the listing its own write changed: a captured `refresh`
    // is dropped rather than landed where the shell has moved on (ADR 0059).
    const user = userEvent.setup();
    const { held, release } = heldOpen();
    server.use(
      http.put(`*/api/v1/judge-configurations/${NEW_JUDGE_ID}/draft`, async ({ request }) => {
        const body = (await request.json()) as { payload: Record<string, unknown> };
        await held;
        completed.push(body.payload);
        return HttpResponse.json({
          judge_id: NEW_JUDGE_ID,
          lifecycle_state: "draft",
          content: body.payload as JudgeConfigurationDraftResponse["content"],
          created_at: "2026-09-01T09:00:00+00:00",
          updated_at: "2026-09-01T09:06:00+00:00",
        } satisfies JudgeConfigurationDraftResponse);
      }),
    );
    renderAt("/lab/judges/new");

    await user.type(await screen.findByLabelText("Name"), "Tone");
    await user.type(screen.getByLabelText("Criteria"), "Score whether the tone stayed warm.");
    await user.click(screen.getByRole("button", { name: "Create judge" }));

    // The `POST` has landed and the listing has been read again; the `PUT` is in the air.
    await waitFor(() => expect(created).toHaveLength(1));
    await waitFor(() => expect(listingReads).toBe(2));

    const rail = within(screen.getByRole("navigation", { name: "Experiment lab workspace" }));
    await user.click(rail.getByRole("link", { name: "Judges" }));
    const prompt = within(await screen.findByRole("dialog", { name: "Unsaved changes" }));
    await user.click(prompt.getByRole("button", { name: "Discard and leave" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Judges" })).toBeVisible();

    release();
    await waitFor(() => expect(completed).toHaveLength(1));
    await everyRemainingTurn();

    // The write that was already in the air lands, and the run that sent it reads the row it
    // changed back — the rubric is on the judge now, whether or not anybody stayed to watch
    // it land (ADR 0056: the rule is about what the surface did). What it does not do is take
    // an operator who has gone into the editor of the judge they walked away from.
    expect(listingReads).toBe(3);
    expect(screen.getByRole("heading", { level: 1, name: "Judges" })).toBeVisible();
    expect(screen.queryByRole("heading", { level: 1, name: "Tone" })).toBeNull();
  });

  it("asks nothing while the create form is only half typed", async () => {
    const user = userEvent.setup();
    renderAt("/lab/judges/new");

    await user.type(await screen.findByLabelText("Name"), "Tone");

    const rail = within(screen.getByRole("navigation", { name: "Experiment lab workspace" }));
    await user.click(rail.getByRole("link", { name: "Judges" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Judges" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).toBeNull();
  });
});

/**
 * The rail's figure and this index are one listing, read once by the shell and handed to
 * both, so they cannot come to disagree (ADR 0056).
 */
describe("the rail's figure and this index", () => {
  it("says on the rail what the table has rows", async () => {
    renderAt("/lab/judges");

    const rows = bodyRows(await screen.findByRole("table"));
    const entry = railEntry("Judges", "Experiment lab workspace");
    expect(within(entry).getByText(String(rows))).toBeVisible();
    expect(entry).toHaveAccessibleDescription(`${rows} judge${rows === 1 ? "" : "s"}`);
  });

  it("moves the figure when a judge is created, without a reload", async () => {
    // Created rather than compared: an agreement between two reads of one fixture is true by
    // construction, and what ADR 0056 asks of a create is that it re-reads the listing.
    const user = userEvent.setup();
    renderAt("/lab/judges/new");

    const entry = railEntry("Judges", "Experiment lab workspace");
    await waitFor(() => expect(within(entry).getByText("1")).toBeVisible());

    await user.type(await screen.findByLabelText("Name"), "Tone");
    await user.type(screen.getByLabelText("Criteria"), "Score whether the tone stayed warm.");
    await user.click(screen.getByRole("button", { name: "Create judge" }));

    await waitFor(() =>
      expect(within(railEntry("Judges", "Experiment lab workspace")).getByText("2")).toBeVisible(),
    );
  });
});

/**
 * The editor's side panel holds no field of the draft, so the judge's model is edited in the
 * main column, after the rubric, as the prototype draws it (`Workspace.dc.html` :503–518).
 */
describe("the judge editor's side panel", () => {
  it("goes back to Judges from the ← above its title", async () => {
    renderAt(`/lab/judges/${JUDGE_ID}`);

    await expectWayBack("Judges", "/lab/judges", "judge");
  });
  it("holds the gate and anonymity, in that order, and no field", async () => {
    renderAt(`/lab/judges/${JUDGE_ID}`);

    const panel = sidePanel(await screen.findByRole("region", { name: "Publish gate" }));

    expect(panelCards(panel)).toEqual(["Publish gate", "Anonymity"]);
    expect(panelFields(panel)).toEqual([]);
  });

  it("edits the model in the main column, after the rubric and under its own name", async () => {
    renderAt(`/lab/judges/${JUDGE_ID}`);

    const panel = sidePanel(await screen.findByRole("region", { name: "Publish gate" }));

    expect(mainCards(panel)).toEqual(["Rubric", "Model", "Evidence"]);
    const model = within(screen.getByRole("region", { name: "Model" }));
    expect(model.getByLabelText("Provider")).toBeVisible();
    expect(model.getByLabelText("Temperature")).toBeVisible();
  });
});
