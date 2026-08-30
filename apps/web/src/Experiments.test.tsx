import type {
  AgentConfigurationListResponse,
  AgentConfigurationVersionListResponse,
  AgentTurnSchema,
  ArmStandingSchema,
  ComparisonVariableSchema,
  ExperimentListResponse,
  ExperimentPreviewResponse,
  ExperimentResponse,
  ExperimentTimelineResponse,
  MutationEventSchema,
  ParticipantTurnSchema,
  ScenarioListResponse,
  ScenarioVersionListResponse,
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
  TimelineEntrySchema,
  ToolEventSchema,
} from "@agent-lab/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "./App";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const SCENARIO_ID = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
const ATLAS_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const BEACON_ID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const EXPERIMENT_ID = "9f8e7d6c-5b4a-4392-8817-6f5e4d3c2b1a";
const ARM_A = "0a0a0a0a-1111-4222-8333-444444444444";
const ARM_B = "0b0b0b0b-1111-4222-8333-444444444444";
const SANDBOX_FINGERPRINT = "a".repeat(64);
const RESOLUTION_FINGERPRINT = "b".repeat(64);
const STATE_FINGERPRINT = "c".repeat(64);
const ORDER_ID = "4d5e6f7a-8b9c-4d0e-8f1a-2b3c4d5e6f7a";

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

const SCENARIOS: ScenarioListResponse = {
  scenarios: [
    {
      scenario_id: SCENARIO_ID,
      name: "Wrong shipping address",
      ticket_id: "6b0f9c1e-49d1-4c9f-8b0c-1f6d1c2f9a01",
      ticket_reference: "T-204",
      ticket_subject: "Wrong address concern",
      customer_display_name: "Maya Laurent",
      context_document_count: 1,
      max_turns: 12,
      objective_count: 1,
      mutation_count: 1,
      updated_at: "2026-08-28T09:00:00+00:00",
      latest_published_version: 1,
      published_version_count: 1,
    },
  ],
};

const SCENARIO_VERSIONS: ScenarioVersionListResponse = {
  versions: [
    { version: 1, content_fingerprint: "d".repeat(64), published_at: "2026-08-28T09:05:00+00:00" },
  ],
};

function configuration(
  configurationId: string,
  name: string,
  frameworkLabel: string,
  published: number | null,
): AgentConfigurationListResponse["configurations"][number] {
  return {
    configuration_id: configurationId,
    name,
    framework_id: frameworkLabel === "Pydantic AI" ? "pydantic-ai" : "fake",
    framework_label: frameworkLabel,
    model_id: "gpt-5-mini",
    support_identity_id: "8e9f0a1b-2c3d-4e5f-8a6b-7c8d9e0f1a2b",
    tool_count: 8,
    updated_at: "2026-08-28T09:00:00+00:00",
    latest_published_version: published,
    published_version_count: published ?? 0,
  };
}

const CONFIGURATIONS: AgentConfigurationListResponse = {
  configurations: [
    configuration(ATLAS_ID, "cfg-atlas", "Pydantic AI", 4),
    configuration(BEACON_ID, "cfg-beacon", "Deterministic fake", 2),
    configuration("3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f", "cfg-unpublished", "Pydantic AI", null),
  ],
};

const CONFIGURATION_VERSIONS: AgentConfigurationVersionListResponse = {
  versions: [
    { version: 1, content_fingerprint: "e".repeat(64), published_at: "2026-08-28T08:00:00+00:00" },
  ],
};

function variable(
  dimension: ComparisonVariableSchema["dimension"],
  values: string[],
): ComparisonVariableSchema {
  return { dimension, values, differs: new Set(values).size > 1 };
}

const COMPARISON: ComparisonVariableSchema[] = [
  variable("framework", ["pydantic-ai", "fake"]),
  variable("architecture", ["single_agent", "single_agent"]),
  variable("model", ["openai/gpt-5-mini · temp 0.20 · 8 tool rounds", "fake/deterministic"]),
  variable("prompt", ["You are support.", "You are support."]),
  variable("tools", ["orders.read_order", "orders.read_order"]),
  variable("support_identity", ["frontline", "frontline"]),
  variable("tone_of_voice", ["shop_default", "shop_default"]),
];

const PREVIEW: ExperimentPreviewResponse = {
  issues: [
    {
      severity: "warning",
      code: "multiple_comparison_variables",
      message:
        "these arms differ in 2 dimensions (framework, model), so a difference in behavior " +
        "cannot be attributed to any one of them",
      path: "arms",
    },
  ],
  comparison: COMPARISON,
  arm_labels: ["Arm A", "Arm B"],
};

function turn(
  runId: string,
  ordinal: number,
  turnId: string,
  body: string,
  source: ParticipantTurnSchema["source"] = "participant",
): ParticipantTurnSchema {
  return {
    run_id: runId,
    turn_id: turnId,
    ordinal,
    source,
    driver: source === "trigger" ? null : "human",
    body,
    created_at: "2026-08-28T10:00:00+00:00",
  };
}

const TRIGGER = "My parcel is going to the wrong address — I moved last month.";

const ANSWER = "I found order NS-10482. It ships to 9 quai des Chartrons, 33000 Bordeaux.";

function agentTurn(
  runId: string,
  ordinal: number,
  attempt = 1,
  failure: AgentTurnSchema["failure"] = null,
): AgentTurnSchema {
  return {
    run_id: runId,
    ordinal,
    attempt,
    outcome: failure === null ? "answered" : "failed",
    failure,
    body: failure === null ? ANSWER : "",
    created_at: "2026-08-28T10:00:30+00:00",
  };
}

function toolEvent(
  runId: string,
  sequence: number,
  tool: string,
  moved = false,
  ordinal = 0,
  attempt = 1,
): ToolEventSchema {
  return {
    run_id: runId,
    ordinal,
    attempt,
    sequence,
    tool,
    version: "v1",
    outcome: "success",
    result: {
      canonical_schema_version: "tool-result-v1",
      tool,
      version: "v1",
      arguments: {},
      outcome: "success",
      data: {},
      refusal: null,
    },
    revision_before: moved ? 0 : 0,
    revision_after: moved ? 1 : 0,
    state_fingerprint: STATE_FINGERPRINT,
    created_at: "2026-08-28T10:00:30+00:00",
  };
}

function mutationEvent(
  runId: string,
  afterCalls: number,
  ordinal = 0,
  attempt = 1,
): MutationEventSchema {
  return {
    run_id: runId,
    mutation_id: "order-moves-under-the-arm",
    block_id: "cccccccc-1111-4222-8333-444444444444",
    block_version: 1,
    effect: "entity_mutation",
    timing: "after_first_read",
    target: `order:${ORDER_ID}`,
    ordinal,
    attempt,
    after_calls: afterCalls,
    revision_before: 0,
    revision_after: 1,
    state_fingerprint: STATE_FINGERPRINT,
    created_at: "2026-08-28T10:00:30+00:00",
  };
}

/**
 * What the backend would report this arm is waiting for, derived the way it derives it.
 *
 * Computed from the same turns the fixture hands the page rather than pinned per test: a
 * standing that disagreed with the thread beside it would let a test assert a button the
 * real bench would never draw.
 */
function standing(
  runId: string,
  turns: ParticipantTurnSchema[],
  agentTurns: AgentTurnSchema[],
): ArmStandingSchema {
  const received = turns.filter((entry) => entry.run_id === runId);
  const attempts = agentTurns.filter((entry) => entry.run_id === runId);
  const answered = new Set(
    attempts.filter((entry) => entry.outcome === "answered").map((entry) => entry.ordinal),
  );
  const ordinal = Math.max(...received.map((entry) => entry.ordinal));
  return {
    awaiting: answered.has(ordinal) ? "customer" : "agent",
    ordinal,
    attempts: attempts.filter((entry) => entry.ordinal === ordinal).length,
    unanswered: received
      .filter((entry) => entry.ordinal < ordinal && !answered.has(entry.ordinal))
      .map((entry) => entry.ordinal),
  };
}

function experiment(
  turns: ParticipantTurnSchema[],
  agentTurns: AgentTurnSchema[] = [],
  toolEvents: ToolEventSchema[] = [],
  mutationEvents: MutationEventSchema[] = [],
): ExperimentResponse {
  return {
    experiment_id: EXPERIMENT_ID,
    label: "Wrong address — framework comparison",
    scenario_id: SCENARIO_ID,
    scenario_version: 1,
    seed: 20260828,
    snapshot_id: "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a",
    sandbox_fingerprint: SANDBOX_FINGERPRINT,
    resolution_fingerprint: RESOLUTION_FINGERPRINT,
    participant_driver: "human",
    canonical_schema_version: "experiment-v1",
    created_at: "2026-08-28T09:30:00+00:00",
    sandbox_inputs: [
      {
        definition_type: "scenario",
        definition_id: SCENARIO_ID,
        version: 1,
        content_fingerprint: "d".repeat(64),
      },
    ],
    arm_inputs: [[], []],
    tool_contracts: { "orders.read_order": "v1" },
    comparison: COMPARISON,
    runs: [
      {
        run_id: ARM_A,
        position: 0,
        label: "Arm A",
        agent_configuration_id: ATLAS_ID,
        agent_configuration_version: 1,
        framework_id: "fake",
        model_id: "deterministic",
        sandbox_id: "aaaaaaaa-1111-4222-8333-444444444444",
        revision: 0,
        snapshot_fingerprint: SANDBOX_FINGERPRINT,
        state_fingerprint: STATE_FINGERPRINT,
        standing: standing(ARM_A, turns, agentTurns),
      },
      {
        run_id: ARM_B,
        position: 1,
        label: "Arm B",
        agent_configuration_id: BEACON_ID,
        agent_configuration_version: 1,
        framework_id: "fake",
        model_id: "deterministic",
        sandbox_id: "bbbbbbbb-1111-4222-8333-444444444444",
        revision: 0,
        snapshot_fingerprint: SANDBOX_FINGERPRINT,
        state_fingerprint: STATE_FINGERPRINT,
        standing: standing(ARM_B, turns, agentTurns),
      },
    ],
    turns,
    agent_turns: agentTurns,
    tool_events: toolEvents,
    mutation_events: mutationEvents,
  };
}

const OPENED: ParticipantTurnSchema[] = [
  turn(ARM_A, 0, "trigger-0", TRIGGER, "trigger"),
  turn(ARM_B, 0, "trigger-0", TRIGGER, "trigger"),
];

function timelineEntry(
  overrides: Partial<TimelineEntrySchema> & Pick<TimelineEntrySchema, "kind" | "step" | "run_ids">,
): TimelineEntrySchema {
  return {
    categories: ["customer"],
    occurred_at: "2026-08-28T10:00:00+00:00",
    composition_id: null,
    ordinal: null,
    attempt: null,
    sequence: null,
    tool: null,
    tool_version: null,
    tool_outcome: null,
    mutation: null,
    mutation_effect: null,
    turn_outcome: null,
    failure: null,
    revision_before: null,
    revision_after: null,
    source: null,
    ...overrides,
  };
}

const TIMELINE: ExperimentTimelineResponse = {
  experiment_id: EXPERIMENT_ID,
  entries: [
    timelineEntry({ kind: "trigger", step: 0, run_ids: [ARM_A, ARM_B] }),
    timelineEntry({
      kind: "tool_call",
      step: 0,
      run_ids: [ARM_A],
      categories: ["tool", "state"],
      ordinal: 0,
      attempt: 1,
      sequence: 0,
      tool: "orders.apply_address_change",
      tool_version: "v1",
      tool_outcome: "success",
      revision_before: 0,
      revision_after: 1,
      source: {
        module: "capability_lab.application.sandbox_actions",
        path: "capability_lab/application/sandbox_actions.py",
        symbol: "SandboxActionService._apply",
        line: 311,
      },
    }),
    timelineEntry({
      kind: "mutation",
      step: 0,
      run_ids: [ARM_A],
      categories: ["state"],
      ordinal: 0,
      attempt: 1,
      sequence: 1,
      mutation: "order-moves-under-the-arm",
      mutation_effect: "entity_mutation",
      revision_before: 1,
      revision_after: 2,
      source: {
        module: "capability_lab.domain.mutation",
        path: "capability_lab/domain/mutation.py",
        symbol: "advance_fulfilment",
        line: 117,
      },
    }),
    timelineEntry({
      kind: "agent_turn",
      step: 0,
      run_ids: [ARM_A],
      categories: ["model"],
      ordinal: 0,
      attempt: 1,
      turn_outcome: "answered",
      source: {
        module: "capability_lab.infrastructure.agents.fake.runtime",
        path: "capability_lab/infrastructure/agents/fake/runtime.py",
        symbol: "FakeSupportAgentRuntime.answer",
        line: 42,
      },
    }),
    timelineEntry({
      kind: "customer_turn",
      step: 1,
      run_ids: [ARM_B],
      composition_id: "composition-1",
    }),
  ],
};

let started: Record<string, unknown>[] = [];
let delivered: Record<string, unknown>[] = [];
let advanced: string[] = [];
let turns: ParticipantTurnSchema[] = OPENED;
let agentTurns: AgentTurnSchema[] = [];
let toolEvents: ToolEventSchema[] = [];
let mutationEvents: MutationEventSchema[] = [];
let startFails = false;
let runtimeUnavailable = false;

const server = setupServer(
  http.get("*/api/v1/shops", () => HttpResponse.json({ shops: [] } satisfies ShopListResponse)),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft`, () =>
    HttpResponse.json({
      shop_id: SHOP_ID,
      lifecycle_state: "draft",
      content: SHOP_CONTENT,
      created_at: "2026-08-28T09:00:00+00:00",
      updated_at: "2026-08-28T09:00:00+00:00",
    } satisfies ShopDraftResponse),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/draft/preview`, () =>
    HttpResponse.json({
      shop_id: SHOP_ID,
      publishable: true,
      issues: [],
      changes: [],
      content_fingerprint: "f".repeat(64),
      latest_published_version: 3,
      next_version: 4,
      matches_latest_published: false,
      content: SHOP_CONTENT,
    } satisfies ShopPreviewResponse),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () => HttpResponse.json(SCENARIOS)),
  http.get(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/versions`, () =>
    HttpResponse.json(SCENARIO_VERSIONS),
  ),
  http.get("*/api/v1/agent-configurations", () => HttpResponse.json(CONFIGURATIONS)),
  http.get("*/api/v1/agent-configurations/:configurationId/versions", () =>
    HttpResponse.json(CONFIGURATION_VERSIONS),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/experiments`, () =>
    HttpResponse.json({ experiments: [] } satisfies ExperimentListResponse),
  ),
  http.post(`*/api/v1/shops/${SHOP_ID}/experiments/preview`, () => HttpResponse.json(PREVIEW)),
  http.post(`*/api/v1/shops/${SHOP_ID}/experiments`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    started.push(body);
    if (startFails) {
      return HttpResponse.json(
        {
          code: "experiment_not_startable",
          message: "this experiment cannot be started",
          request_id: "req-1",
          issues: [
            {
              severity: "error",
              code: "tone_override_unknown_in_shop",
              message: "cfg-atlas writes in a tone-of-voice guideline this shop does not publish",
              path: "arms[0].tone_of_voice",
            },
          ],
        },
        { status: 422 },
      );
    }
    return HttpResponse.json(experiment(turns, agentTurns, toolEvents, mutationEvents), {
      status: 201,
    });
  }),
  http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}`, () =>
    HttpResponse.json(experiment(turns, agentTurns, toolEvents, mutationEvents)),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/timeline`, () =>
    HttpResponse.json(TIMELINE),
  ),
  http.post(
    `*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/runs/:runId/agent-turns`,
    ({ params }) => {
      const runId = String(params.runId);
      advanced.push(runId);
      if (runtimeUnavailable) {
        return HttpResponse.json(
          {
            code: "agent_runtime_unavailable",
            message: "no pydantic-ai runtime is available in this lab",
            request_id: "req-2",
          },
          { status: 422 },
        );
      }
      const ordinal = Math.max(
        ...turns.filter((entry) => entry.run_id === runId).map((entry) => entry.ordinal),
      );
      const attempt =
        agentTurns.filter((entry) => entry.run_id === runId && entry.ordinal === ordinal).length +
        1;
      const written = agentTurn(runId, ordinal, attempt);
      const events = [toolEvent(runId, 0, "interaction.read_context", false, ordinal, attempt)];
      agentTurns = [...agentTurns, written];
      toolEvents = [...toolEvents, ...events];
      return HttpResponse.json({ turn: written, tool_events: events }, { status: 201 });
    },
  ),
  http.post(
    `*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/participant-turns`,
    async ({ request }) => {
      const body = (await request.json()) as { run_ids: string[]; message: string };
      delivered.push(body);
      const written = body.run_ids.map((runId) =>
        turn(runId, 1, `composition-${delivered.length}`, body.message),
      );
      turns = [...turns, ...written];
      return HttpResponse.json({ turns: written }, { status: 201 });
    },
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  started = [];
  delivered = [];
  advanced = [];
  turns = OPENED;
  agentTurns = [];
  toolEvents = [];
  mutationEvents = [];
  startFails = false;
  runtimeUnavailable = false;
});
afterAll(() => server.close());

function renderSetup() {
  return render(
    <MemoryRouter initialEntries={[`/shops/${SHOP_ID}/bench`]}>
      <App />
    </MemoryRouter>,
  );
}

function renderTimeline() {
  return render(
    <MemoryRouter initialEntries={[`/shops/${SHOP_ID}/bench/${EXPERIMENT_ID}/timeline`]}>
      <App />
    </MemoryRouter>,
  );
}

function renderBench() {
  return render(
    <MemoryRouter initialEntries={[`/shops/${SHOP_ID}/bench/${EXPERIMENT_ID}`]}>
      <App />
    </MemoryRouter>,
  );
}

async function chooseArm(user: ReturnType<typeof userEvent.setup>, position: number, name: string) {
  const arm = screen.getByRole("group", { name: `Arm ${String.fromCharCode(65 + position)}` });
  await user.selectOptions(within(arm).getByLabelText("Agent configuration"), name);
  await user.selectOptions(within(arm).getByLabelText("Published version"), "1");
}

describe("experiment setup", () => {
  it("reads the comparison matrix dimension by dimension before anything is frozen", async () => {
    const user = userEvent.setup();
    renderSetup();

    await user.selectOptions(await screen.findByLabelText("Recipe"), "Wrong shipping address");
    await chooseArm(user, 0, "cfg-atlas");
    await user.click(screen.getByRole("button", { name: "Add a second arm" }));
    await chooseArm(user, 1, "cfg-beacon");

    const matrix = await screen.findByRole("table");
    const framework = within(matrix).getByRole("row", { name: /framework/ });
    expect(within(framework).getByText("Difference")).toBeVisible();
    const architecture = within(matrix).getByRole("row", { name: /architecture/ });
    expect(within(architecture).getByText("Same")).toBeVisible();
  });

  it("warns that arms differing in more than one dimension measure none of them", async () => {
    const user = userEvent.setup();
    renderSetup();

    await user.selectOptions(await screen.findByLabelText("Recipe"), "Wrong shipping address");
    await chooseArm(user, 0, "cfg-atlas");

    expect(await screen.findByText(/cannot be attributed to any one of them/)).toBeVisible();
  });

  it("cannot select a configuration that has never been published", async () => {
    renderSetup();

    const arm = await screen.findByRole("group", { name: "Arm A" });
    const option = await within(arm).findByRole("option", { name: /cfg-unpublished/ });

    // Offered as unavailable rather than hidden: an author looking for the configuration
    // they just wrote has to see why it cannot be pinned.
    expect(option).toBeDisabled();
  });

  it("will not start an experiment nobody can find again", async () => {
    const user = userEvent.setup();
    renderSetup();

    await user.selectOptions(await screen.findByLabelText("Recipe"), "Wrong shipping address");
    await chooseArm(user, 0, "cfg-atlas");
    await user.click(screen.getByRole("button", { name: "Start experiment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Name the experiment/);
    expect(started).toHaveLength(0);
  });

  it("starts the experiment against the exact versions chosen and opens the bench", async () => {
    const user = userEvent.setup();
    renderSetup();

    await user.selectOptions(await screen.findByLabelText("Recipe"), "Wrong shipping address");
    await chooseArm(user, 0, "cfg-atlas");
    await user.type(screen.getByLabelText("Experiment name"), "Prompt comparison");
    await user.click(screen.getByRole("button", { name: "Start experiment" }));

    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({
      label: "Prompt comparison",
      scenario_id: SCENARIO_ID,
      scenario_version: 1,
      participant_driver: "human",
      arms: [{ configuration_id: ATLAS_ID, version: 1 }],
    });
    expect(
      await screen.findByRole("heading", { name: "Wrong address — framework comparison" }),
    ).toBeVisible();
  });

  it("surfaces a refused start with the finding that explains it", async () => {
    const user = userEvent.setup();
    startFails = true;
    renderSetup();

    await user.selectOptions(await screen.findByLabelText("Recipe"), "Wrong shipping address");
    await chooseArm(user, 0, "cfg-atlas");
    await user.type(screen.getByLabelText("Experiment name"), "Prompt comparison");
    await user.click(screen.getByRole("button", { name: "Start experiment" }));

    expect(
      await screen.findByText(/tone-of-voice guideline this shop does not publish/),
    ).toBeVisible();
    // The setup is still on screen: a refusal must not discard what the operator chose.
    expect(screen.getByRole("button", { name: "Start experiment" })).toBeVisible();
  });
});

describe("live bench", () => {
  it("opens both arms with the scenario's triggering message", async () => {
    renderBench();

    const armA = await screen.findByRole("region", { name: "Arm A" });
    const armB = screen.getByRole("region", { name: "Arm B" });

    expect(within(armA).getByText(TRIGGER)).toBeVisible();
    expect(within(armB).getByText(TRIGGER)).toBeVisible();
    expect(within(armA).getByText("Trigger")).toBeVisible();
  });

  it("sends one composition to both arms by default", async () => {
    const user = userEvent.setup();
    renderBench();

    await user.type(await screen.findByLabelText("Message"), "Any update?");
    await user.click(screen.getByRole("button", { name: "Send as the customer" }));

    await waitFor(() => expect(delivered).toHaveLength(1));
    expect(delivered[0]).toEqual({ run_ids: [ARM_A, ARM_B], message: "Any update?" });
  });

  it("marks a reply only one arm received", async () => {
    const user = userEvent.setup();
    renderBench();

    await user.click(await screen.findByRole("checkbox", { name: "Arm B" }));
    await user.type(screen.getByLabelText("Message"), "Only arm A hears this.");
    await user.click(screen.getByRole("button", { name: "Send as the customer" }));

    await waitFor(() => expect(delivered).toHaveLength(1));
    expect(delivered[0]).toEqual({ run_ids: [ARM_A], message: "Only arm A hears this." });
    const armA = await screen.findByRole("region", { name: "Arm A" });
    expect(await within(armA).findByText("this arm only")).toBeVisible();
  });

  it("runs the agent of every arm the composition reached", async () => {
    const user = userEvent.setup();
    renderBench();

    await user.type(await screen.findByLabelText("Message"), "Any update?");
    await user.click(screen.getByRole("button", { name: "Send as the customer" }));

    await waitFor(() => expect(advanced).toEqual([ARM_A, ARM_B]));
    const armA = await screen.findByRole("region", { name: "Arm A" });
    expect(await within(armA).findByText(ANSWER)).toBeVisible();
  });

  it("shows what the agent called on its way to the reply", async () => {
    const user = userEvent.setup();
    renderBench();

    await user.click(await screen.findByRole("button", { name: "Run Arm A's agent" }));

    const armA = await screen.findByRole("region", { name: "Arm A" });
    expect(await within(armA).findByText(/interaction\.read_context → success/)).toBeVisible();
    // The arm beside it was not run: advancing is per arm.
    expect(advanced).toEqual([ARM_A]);
    const armB = screen.getByRole("region", { name: "Arm B" });
    expect(within(armB).queryByText(ANSWER)).toBeNull();
  });

  it("keeps a failed attempt and offers to run the arm again", async () => {
    const user = userEvent.setup();
    agentTurns = [agentTurn(ARM_A, 0, 1, "model_provider")];
    renderBench();

    const armA = await screen.findByRole("region", { name: "Arm A" });
    expect(within(armA).getByText(/model provider rejected the request/)).toBeVisible();

    await user.click(within(armA).getByRole("button", { name: "Try Arm A's agent again" }));

    await waitFor(() => expect(advanced).toEqual([ARM_A]));
    // The failure stays: it is evidence, and the retry sits beside it.
    expect(within(armA).getByText(/model provider rejected the request/)).toBeVisible();
    expect(await within(armA).findByText("attempt 2")).toBeVisible();
  });

  it("reports an arm this lab cannot run without recording a turn", async () => {
    const user = userEvent.setup();
    runtimeUnavailable = true;
    renderBench();

    await user.click(await screen.findByRole("button", { name: "Run Arm A's agent" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no pydantic-ai runtime/);
    const armA = screen.getByRole("region", { name: "Arm A" });
    expect(within(armA).queryByText(ANSWER)).toBeNull();
  });

  it("shows the scenario's fault where it fired, between the calls it landed between", async () => {
    agentTurns = [agentTurn(ARM_A, 0)];
    toolEvents = [
      toolEvent(ARM_A, 0, "orders.read_order"),
      toolEvent(ARM_A, 1, "orders.propose_address_change"),
    ];
    mutationEvents = [mutationEvent(ARM_A, 1)];
    renderBench();

    const armA = await screen.findByRole("region", { name: "Arm A" });
    // The first item is the turn itself; the rest are the strip, in the order it happened.
    const strip = within(armA).getAllByRole("listitem").slice(1);

    expect(strip.map((entry) => entry.textContent)).toEqual([
      "orders.read_order → success",
      "scenario fault · moved this arm",
      "orders.propose_address_change → success",
    ]);
  });

  it("names the fault as a writer beside the tools, so two revisions are explainable", async () => {
    agentTurns = [agentTurn(ARM_A, 0)];
    mutationEvents = [mutationEvent(ARM_A, 0)];
    renderBench();

    const changes = await screen.findByRole("region", { name: "State changes" });

    expect(
      within(changes).getByText(/order-moves-under-the-arm · scenario fault · r0 → r1/),
    ).toBeVisible();
  });

  it("reads the arm a write moved apart from the one it did not", async () => {
    agentTurns = [agentTurn(ARM_A, 0)];
    toolEvents = [toolEvent(ARM_A, 0, "orders.apply_address_change", true)];
    renderBench();

    const changes = await screen.findByRole("region", { name: "State changes" });

    expect(within(changes).getByText(/orders\.apply_address_change · r0 → r1/)).toBeVisible();
    expect(within(changes).getByText("nothing yet")).toBeVisible();
  });

  it("says what each arm is waiting for", async () => {
    agentTurns = [agentTurn(ARM_A, 0)];
    renderBench();

    const armA = await screen.findByRole("region", { name: "Arm A" });
    const armB = screen.getByRole("region", { name: "Arm B" });

    expect(within(armA).getByText(/Waiting for the customer · turn 0/)).toBeVisible();
    expect(within(armB).getByText(/Waiting for the agent · turn 0/)).toBeVisible();
    // The answered arm is offered nothing: advancing it would return the reply it has.
    expect(within(armA).queryByRole("button", { name: /Arm A's agent/ })).toBeNull();
    expect(within(armB).getByRole("button", { name: "Run Arm B's agent" })).toBeVisible();
  });

  it("says an arm whose attempt failed is waiting for a retry", async () => {
    agentTurns = [agentTurn(ARM_A, 0, 1, "model_transient")];
    renderBench();

    const armA = await screen.findByRole("region", { name: "Arm A" });

    expect(
      within(armA).getByText(/Attempt 1 produced no reply — waiting for a retry/),
    ).toBeVisible();
    expect(within(armA).getByRole("button", { name: "Try Arm A's agent again" })).toBeVisible();
  });

  it("reopens an experiment where it stood, including the question an arm never answered", async () => {
    // The record of an operator who sent a second message before running arm A's agent, and
    // then left: arm A stands on turn 1 with turn 0 behind it, unanswered.
    turns = [...OPENED, turn(ARM_A, 1, "reply-1", "Any update?")];
    agentTurns = [agentTurn(ARM_A, 1)];
    renderBench();

    const armA = await screen.findByRole("region", { name: "Arm A" });

    expect(within(armA).getByText(TRIGGER)).toBeVisible();
    expect(within(armA).getByText(/1 earlier turn was never answered/)).toBeVisible();
    expect(
      within(armA).getByText(/No reply — the customer wrote again before this arm was run/),
    ).toBeVisible();
  });

  it("reads both arms back to the one starting state they were cloned from", async () => {
    renderBench();

    const provenance = await screen.findByRole("region", { name: "Provenance" });

    expect(within(provenance).getByTitle(SANDBOX_FINGERPRINT)).toBeVisible();
    expect(within(provenance).getByTitle(RESOLUTION_FINGERPRINT)).toBeVisible();
    expect(within(provenance).getByText(/human operator/)).toBeVisible();
  });
});

describe("execution timeline", () => {
  it("reads both arms' execution as one ordered stream", async () => {
    renderTimeline();

    const stream = await screen.findByRole("region", { name: "Execution timeline" });
    const rows = within(stream).getAllByRole("listitem");

    expect(rows[0]).toHaveTextContent("Arm A · Arm B");
    expect(rows[0]).toHaveTextContent(/triggering message opened every arm/);
    expect(rows[1]).toHaveTextContent(/orders\.apply_address_change v1 → success/);
    expect(rows[1]).toHaveTextContent("moved this arm r0 → r1");
    expect(rows[3]).toHaveTextContent("The agent replied (attempt 1).");
  });

  it("reads a scenario fault as the world moving, marked as the scenario's own", async () => {
    renderTimeline();

    const stream = await screen.findByRole("region", { name: "Execution timeline" });
    const fault = within(stream).getAllByRole("listitem")[2];

    expect(fault).toHaveTextContent(/order-moves-under-the-arm fired/);
    expect(fault).toHaveTextContent(/moved the order it is bound to, out of band/);
    expect(fault).toHaveTextContent("moved this arm r1 → r2");
    expect(within(fault).getByText("scenario fault")).toBeVisible();
  });

  it("marks the composition only one arm received", async () => {
    renderTimeline();

    const stream = await screen.findByRole("region", { name: "Execution timeline" });

    const split = within(stream).getAllByRole("listitem")[4];
    expect(split).toHaveTextContent("Arm B");
    expect(within(split).getByText("this arm only")).toBeVisible();
  });

  it("names the project-owned code each event ran through", async () => {
    renderTimeline();

    const stream = await screen.findByRole("region", { name: "Execution timeline" });

    expect(
      within(stream).getByText(/capability_lab\/application\/sandbox_actions\.py:311/),
    ).toBeVisible();
    const paths = await screen.findByRole("region", { name: "Executed project code" });
    const applied = within(paths).getByText("SandboxActionService._apply").closest("li");
    expect(applied).toHaveTextContent("sandbox_actions.py:311 · 1 call");
  });

  it("narrows the stream to one lens and back", async () => {
    const user = userEvent.setup();
    renderTimeline();

    const stream = await screen.findByRole("region", { name: "Execution timeline" });
    await user.click(within(stream).getByRole("button", { name: "State" }));

    // Both writers: the agent's own and the scenario's. "What moved this arm" is one
    // question, and an answer that showed only the agent's half would be a different one.
    const moved = within(stream).getAllByRole("listitem");
    expect(moved).toHaveLength(2);
    expect(moved[0]).toHaveTextContent(/orders\.apply_address_change/);
    expect(moved[1]).toHaveTextContent(/order-moves-under-the-arm/);

    await user.click(within(stream).getByRole("button", { name: "All events" }));
    expect(within(stream).getAllByRole("listitem")).toHaveLength(5);
  });

  it("is reachable from the bench and leads back to it", async () => {
    const user = userEvent.setup();
    renderBench();

    await user.click(await screen.findByRole("link", { name: "Execution timeline" }));

    expect(await screen.findByRole("region", { name: "Execution timeline" })).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Back to the live bench" }));
    expect(await screen.findByRole("region", { name: "Customer composer" })).toBeVisible();
  });
});
