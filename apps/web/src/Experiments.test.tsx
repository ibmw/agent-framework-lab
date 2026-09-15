import type {
  AgentConfigurationListResponse,
  AgentConfigurationVersionListResponse,
  AgentTurnSchema,
  ArmMetricsSchema,
  ArmStandingSchema,
  ArmStateDiffSchema,
  ComparisonVariableSchema,
  ExperimentAnnotationsResponse,
  ExperimentEvaluationResponse,
  ExperimentListResponse,
  ExperimentPreviewResponse,
  ExperimentResponse,
  ExperimentTimelineResponse,
  ExperimentTracesResponse,
  JudgeConfigurationListResponse,
  MutationEventSchema,
  ObjectiveResultSchema,
  ParticipantTurnSchema,
  RunTraceSpanSchema,
  ScenarioListResponse,
  ScenarioVersionListResponse,
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
  TimelineEntrySchema,
  ToolEventSchema,
} from "@agent-lab/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TOURS } from "./lib/tours";
import { renderApp } from "./test/app";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const SCENARIO_ID = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
const ATLAS_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const BEACON_ID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const EXPERIMENT_ID = "9f8e7d6c-5b4a-4392-8817-6f5e4d3c2b1a";
/** The experiment a replay derives, which is a different run and never this one. */
const REPLAY_ID = "8e7d6c5b-4a39-4281-9776-5e4d3c2b1a09";
/** The experiment a fork derives: the same incident, with an arm the operator moved. */
const FORK_ID = "7d6c5b4a-3928-4170-8665-4d3c2b1a0918";
const ARM_A = "0a0a0a0a-1111-4222-8333-444444444444";
const ARM_B = "0b0b0b0b-1111-4222-8333-444444444444";
const SANDBOX_FINGERPRINT = "a".repeat(64);
const RESOLUTION_FINGERPRINT = "b".repeat(64);
const STATE_FINGERPRINT = "c".repeat(64);
const ORDER_ID = "4d5e6f7a-8b9c-4d0e-8f1a-2b3c4d5e6f7a";
const JUDGE_ID = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

const JUDGES: JudgeConfigurationListResponse = {
  judges: [
    {
      judge_id: JUDGE_ID,
      name: "Resolution quality",
      provider: "openai",
      provider_label: "OpenAI",
      model_id: "gpt-5-mini",
      evidence_count: 3,
      updated_at: "2026-09-01T09:00:00+00:00",
      latest_published_version: 2,
      published_version_count: 2,
    },
  ],
};

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
    // A second publication, because a run pinned v1: what a fork moves to has to exist.
    { version: 2, content_fingerprint: "f".repeat(64), published_at: "2026-09-01T08:00:00+00:00" },
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
    duration_ms: 2100,
    usage: failure === null ? { input_tokens: 0, output_tokens: 0, model_requests: 0 } : null,
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
    duration_ms: 300,
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
/**
 * What the backend would say this arm has spent, derived from the same record the page reads.
 *
 * Derived rather than pinned for the reason the standing is: a strip that disagreed with the
 * thread beside it would let a test assert a cost the real bench would never draw.
 */
function metrics(
  runId: string,
  turns: ParticipantTurnSchema[],
  agentTurns: AgentTurnSchema[],
  toolEvents: ToolEventSchema[],
): ArmMetricsSchema {
  const attempts = agentTurns.filter((entry) => entry.run_id === runId);
  const events = toolEvents.filter((entry) => entry.run_id === runId);
  const answered = new Set(
    attempts.filter((entry) => entry.outcome === "answered").map((entry) => entry.ordinal),
  );
  const measured = attempts.filter((entry) => entry.duration_ms !== null);
  return {
    turns: turns.filter((entry) => entry.run_id === runId).length,
    answered_turns: answered.size,
    attempts: attempts.length,
    retries: attempts.length - new Set(attempts.map((entry) => entry.ordinal)).size,
    failures: {},
    tool_calls: events.length,
    tool_writes: events.filter((entry) => entry.revision_after !== entry.revision_before).length,
    model_requests: attempts.length === 0 ? null : 0,
    usage: attempts.length === 0 ? null : { input_tokens: 0, output_tokens: 0, model_requests: 0 },
    duration_ms: measured.length === 0 ? null : 2100 * measured.length,
    tool_duration_ms: events.length === 0 ? null : 300 * events.length,
    measured_attempts: measured.length,
    metered_attempts: attempts.filter((entry) => entry.usage !== null).length,
    estimated_cost:
      attempts.length === 0
        ? null
        : { amount: "0.000000", currency: "USD", recorded_on: "2026-09-01" },
  };
}

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
    awaiting: !answered.has(ordinal) ? "agent" : ordinal >= maxTurns ? "completed" : "customer",
    ordinal,
    attempts: attempts.filter((entry) => entry.ordinal === ordinal).length,
    unanswered: received
      .filter((entry) => entry.ordinal < ordinal && !answered.has(entry.ordinal))
      .map((entry) => entry.ordinal),
  };
}

/**
 * How the backend would judge each arm, derived from the same record the page is handed.
 *
 * The read-check is met by the call that answered with the document and pending until the
 * arm settles, exactly as the deterministic rule reads it — a fixture that pinned outcomes
 * per test could show a matrix the real bench would never draw. The judge row is constant:
 * nothing this build does decides it.
 */
function evaluation(
  turns: ParticipantTurnSchema[],
  agentTurns: AgentTurnSchema[] = [],
  toolEvents: ToolEventSchema[] = [],
): ExperimentEvaluationResponse {
  return {
    experiment_id: EXPERIMENT_ID,
    arms: [ARM_A, ARM_B].map((runId) => {
      const settled = standing(runId, turns, agentTurns).awaiting === "completed";
      const read = toolEvents.some(
        (entry) =>
          entry.run_id === runId &&
          entry.tool === "support.read_document" &&
          entry.outcome === "success",
      );
      const outcome = read ? "met" : settled ? "missed" : "pending";
      return {
        run_id: runId,
        settled,
        met: outcome === "met" ? 1 : 0,
        decided: outcome === "pending" ? 0 : 1,
        failed: outcome === "missed",
        objectives: [
          {
            objective_id: "read-address-change-policy",
            block_id: "3a1f9e2c-7b64-4d51-9c0a-6f2d8e5b41c7",
            block_version: 1,
            statement: "Read the address-change policy",
            severity: "required" as const,
            assessment: "deterministic" as const,
            evidence: "event" as const,
            outcome,
            detail: read
              ? "support.read_document answered policy:address-change"
              : "support.read_document never answered policy:address-change",
          },
          {
            objective_id: "explain-the-outcome",
            block_id: "5c2e7a10-88b3-4f6d-9a21-0e4d7c93b652",
            block_version: 1,
            statement: "Explain the outcome to the customer",
            severity: "expected" as const,
            assessment: "judge" as const,
            evidence: "dimension" as const,
            ...judgeRow(),
          },
        ],
      };
    }),
  };
}

/** An arm whose world is still the one it was cloned into. */
const UNMOVED: ArmStateDiffSchema = { orders: [], other: [] };

/**
 * The redirect the wrong-address incident turns on, as the arm's own state reports it.
 *
 * The values on both sides rather than the revision that moved: "r0 → r1" is true of this
 * and of a corrected typo alike.
 */
const REDIRECTED: ArmStateDiffSchema = {
  orders: [
    {
      order_id: ORDER_ID,
      reference: "NS-10482",
      changes: [
        { path: "fulfilment.status", before: "unfulfilled", after: "partially_fulfilled" },
        { path: "shipping_address.city", before: "Bordeaux", after: "Lyon" },
        {
          path: "shipping_address.source_label",
          before: "Bordeaux — previous flat",
          after: "Home",
        },
      ],
    },
  ],
  other: [],
};

/**
 * The judge's own row, before and after a scoring pass.
 *
 * Deferred until a judge has actually scored it, which is what the row says on a bench
 * where nobody has: the verdict, its reason, and the version that produced it all arrive
 * together, because a verdict without them is a number.
 */
function judgeRow(): Pick<ObjectiveResultSchema, "outcome" | "detail" | "judgement"> {
  if (!scored) {
    return {
      outcome: "deferred",
      detail: "a judge scores this dimension; none has",
      judgement: null,
    };
  }
  if (judgeFailed) {
    // A judge the lab could not reach is recorded and leaves the row deferred: the outage is
    // the lab's, and an arm is never marked down for it (ADR 0031).
    return {
      outcome: "deferred",
      detail: "the judge could not be reached",
      judgement: {
        judge_id: JUDGE_ID,
        judge_version: 2,
        provider: "openai",
        model_id: "gpt-5-mini",
        brief_fingerprint: "e".repeat(64),
        attempt: 1,
        outcome: null,
        failure: "transient",
      },
    };
  }
  return {
    outcome: "met",
    detail: "the arm named the order and said what it changed",
    judgement: {
      judge_id: JUDGE_ID,
      judge_version: 2,
      provider: "openai",
      model_id: "gpt-5-mini",
      brief_fingerprint: "e".repeat(64),
      attempt: 1,
      outcome: "met",
      failure: null,
    },
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
    participant_driver: driver,
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
        agent_configuration_name: "Atlas",
        framework_id: "fake",
        provider: "fake",
        model_id: "deterministic",
        sandbox_id: "aaaaaaaa-1111-4222-8333-444444444444",
        revision: 0,
        snapshot_fingerprint: SANDBOX_FINGERPRINT,
        state_fingerprint: STATE_FINGERPRINT,
        standing: standing(ARM_A, turns, agentTurns),
        metrics: metrics(ARM_A, turns, agentTurns, toolEvents),
        state_diff: stateDiffs[ARM_A] ?? UNMOVED,
      },
      {
        run_id: ARM_B,
        position: 1,
        label: "Arm B",
        agent_configuration_id: BEACON_ID,
        agent_configuration_version: 1,
        agent_configuration_name: "Beacon",
        framework_id: "fake",
        provider: "fake",
        model_id: "deterministic",
        sandbox_id: "bbbbbbbb-1111-4222-8333-444444444444",
        revision: 0,
        snapshot_fingerprint: SANDBOX_FINGERPRINT,
        state_fingerprint: STATE_FINGERPRINT,
        standing: standing(ARM_B, turns, agentTurns),
        metrics: metrics(ARM_B, turns, agentTurns, toolEvents),
        state_diff: stateDiffs[ARM_B] ?? UNMOVED,
      },
    ],
    turns,
    agent_turns: agentTurns,
    tool_events: toolEvents,
    mutation_events: mutationEvents,
  };
}

/**
 * The experiment a replay produces: a different run, in the same world, that says so.
 *
 * Deliberately built from the same factory rather than hand-written, because the whole point
 * of a derived run is that it is an ordinary experiment — the only things that differ are its
 * identity, the driver that produced its turns, and the run it names as its source.
 */
function derivedExperiment(): ExperimentResponse {
  return {
    ...experiment(turns, agentTurns, toolEvents, mutationEvents),
    experiment_id: REPLAY_ID,
    label: "Wrong address — framework comparison (replay)",
    participant_driver: "scripted",
    derived_from: {
      experiment_id: EXPERIMENT_ID,
      label: "Wrong address — framework comparison",
      kind: "replay" as const,
      changed: [],
    },
  };
}

/** What a fork produces: the same run, with one arm moved and a provenance that says so. */
function forkedExperiment(): ExperimentResponse {
  return {
    ...experiment(turns, agentTurns, toolEvents, mutationEvents),
    experiment_id: FORK_ID,
    label: "Wrong address — framework comparison (fork)",
    participant_driver: "scripted",
    derived_from: {
      experiment_id: EXPERIMENT_ID,
      label: "Wrong address — framework comparison",
      kind: "fork" as const,
      changed: ["prompt"],
    },
    // The fork moved one arm's prompt, and the arms it produced now differ along two
    // dimensions rather than the one their source differed along.
    comparison: [
      variable("framework", ["fake", "fake"]),
      variable("architecture", ["single_agent", "single_agent"]),
      variable("model", ["fake/deterministic", "fake/warmer"]),
      variable("prompt", ["You are support.", "Read the policy first."]),
      variable("tools", ["orders.read_order", "orders.read_order"]),
      variable("support_identity", ["frontline", "frontline"]),
      variable("tone_of_voice", ["shop_default", "shop_default"]),
    ],
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

function span(
  overrides: Partial<RunTraceSpanSchema> & Pick<RunTraceSpanSchema, "span_id" | "kind">,
): RunTraceSpanSchema {
  return {
    parent_span_id: null,
    started_offset_ms: 0,
    duration_ms: 0,
    sequence: null,
    tool: null,
    tool_version: null,
    tool_outcome: null,
    ...overrides,
  };
}

/** One traced attempt of arm A: the advance, the framework's turn, and two calls inside it. */
const TRACES: ExperimentTracesResponse = {
  experiment_id: EXPERIMENT_ID,
  traces: [
    {
      run_id: ARM_A,
      arm_label: "Arm A",
      framework_id: "pydantic-ai",
      model_id: "claude-sonnet-5",
      ordinal: 0,
      attempt: 1,
      outcome: "answered",
      failure: null,
      duration_ms: 3310,
      trace_id: "a".repeat(32),
      spans: [
        span({ span_id: "1".repeat(16), kind: "attempt", duration_ms: 3400 }),
        span({
          span_id: "2".repeat(16),
          kind: "runtime",
          parent_span_id: "1".repeat(16),
          started_offset_ms: 90,
          duration_ms: 3310,
        }),
        span({
          span_id: "3".repeat(16),
          kind: "tool",
          parent_span_id: "2".repeat(16),
          started_offset_ms: 1700,
          duration_ms: 310,
          sequence: 0,
          tool: "orders.read_order",
          tool_version: "v1",
          tool_outcome: "success",
        }),
        span({
          span_id: "4".repeat(16),
          kind: "tool",
          parent_span_id: "2".repeat(16),
          started_offset_ms: 2600,
          duration_ms: 420,
          sequence: 1,
          tool: "orders.apply_address_change",
          tool_version: "v1",
          tool_outcome: "refused",
        }),
      ],
    },
  ],
};

let started: Record<string, unknown>[] = [];
let delivered: Record<string, unknown>[] = [];
let advanced: string[] = [];
let turns: ParticipantTurnSchema[] = OPENED;
let agentTurns: AgentTurnSchema[] = [];
let toolEvents: ToolEventSchema[] = [];
let mutationEvents: MutationEventSchema[] = [];
let stateDiffs: Record<string, ArmStateDiffSchema> = {};
let maxTurns = 12;
let startFails = false;
let runtimeUnavailable = false;
let scored = false;
let judgeFailed = false;
let scoredBy: { judge_id: string }[] = [];
let filed: string[][] = [];
let publishedJudges: JudgeConfigurationListResponse = JUDGES;
/** What an operator has written on this run, as the backend answers every write with it. */
let annotations: ExperimentAnnotationsResponse = { notes: [], tags: [] };
/** The spans the lab recorded, which are stored rather than projected from the record. */
let traced: ExperimentTracesResponse = TRACES;
/** Where this run's customer turns came from, which a derived run records as `scripted`. */
let driver: ExperimentResponse["participant_driver"] = "human";
let replayed: string[] = [];
let replayFails = false;
/** Every fork request the screen made, as the backend received it. */
let forked: { configuration_id: string; version: number }[][] = [];

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
  http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/evaluation`, () =>
    HttpResponse.json(evaluation(turns, agentTurns, toolEvents)),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/timeline`, () =>
    HttpResponse.json(TIMELINE),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/traces`, () =>
    HttpResponse.json(traced),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/annotations`, () =>
    HttpResponse.json(annotations),
  ),
  http.post(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/replays`, () => {
    replayed.push(EXPERIMENT_ID);
    if (replayFails) {
      return HttpResponse.json(
        {
          code: "support_agent_runtime_unavailable",
          message: "no runtime for this arm's framework is available here",
          request_id: "req-9",
        },
        { status: 422 },
      );
    }
    return HttpResponse.json(derivedExperiment(), { status: 201 });
  }),
  http.post(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/forks`, async ({ request }) => {
    const body = (await request.json()) as {
      arms: { configuration_id: string; version: number }[];
    };
    forked.push(body.arms);
    return HttpResponse.json(forkedExperiment(), { status: 201 });
  }),
  http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${FORK_ID}`, () =>
    HttpResponse.json(forkedExperiment()),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${FORK_ID}/evaluation`, () =>
    HttpResponse.json(evaluation(turns, agentTurns, toolEvents)),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${FORK_ID}/annotations`, () =>
    HttpResponse.json({ notes: [], tags: [] } satisfies ExperimentAnnotationsResponse),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${REPLAY_ID}`, () =>
    HttpResponse.json(derivedExperiment()),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${REPLAY_ID}/evaluation`, () =>
    HttpResponse.json(evaluation(turns, agentTurns, toolEvents)),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${REPLAY_ID}/annotations`, () =>
    HttpResponse.json({ notes: [], tags: [] } satisfies ExperimentAnnotationsResponse),
  ),
  http.post(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/notes`, async ({ request }) => {
    const body = (await request.json()) as { body: string };
    annotations = {
      ...annotations,
      notes: [
        ...annotations.notes,
        {
          note_id: `note-${annotations.notes.length + 1}`,
          body: body.body,
          created_at: "2026-09-05T18:20:00+00:00",
        },
      ],
    };
    return HttpResponse.json(annotations, { status: 201 });
  }),
  http.put(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/tags`, async ({ request }) => {
    const body = (await request.json()) as { tags: string[] };
    filed.push(body.tags);
    // Stands in for the backend's fold: lowercased, deduplicated, and in one order.
    annotations = {
      ...annotations,
      tags: [...new Set(body.tags.map((tag) => tag.trim().toLowerCase()))].sort(),
    };
    return HttpResponse.json(annotations);
  }),
  http.get("*/api/v1/judge-configurations", () => HttpResponse.json(publishedJudges)),
  http.post(
    `*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/judgements`,
    async ({ request }) => {
      scoredBy.push((await request.json()) as { judge_id: string });
      scored = true;
      return HttpResponse.json(evaluation(turns, agentTurns, toolEvents), { status: 201 });
    },
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
  stateDiffs = {};
  maxTurns = 12;
  startFails = false;
  runtimeUnavailable = false;
  scored = false;
  judgeFailed = false;
  scoredBy = [];
  publishedJudges = JUDGES;
  annotations = { notes: [], tags: [] };
  filed = [];
  traced = TRACES;
  driver = "human";
  replayed = [];
  replayFails = false;
  forked = [];
});
afterAll(() => server.close());

function renderSetup() {
  return renderApp(`/shops/${SHOP_ID}/bench`);
}

function renderTimeline() {
  return renderApp(`/shops/${SHOP_ID}/bench/${EXPERIMENT_ID}/results/timeline`);
}

function renderTraces() {
  return renderApp(`/shops/${SHOP_ID}/bench/${EXPERIMENT_ID}/results/traces`);
}

function renderResults() {
  return renderApp(`/shops/${SHOP_ID}/bench/${EXPERIMENT_ID}/results`);
}

function renderBench() {
  return renderApp(`/shops/${SHOP_ID}/bench/${EXPERIMENT_ID}`);
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

  it("says what a seed is and what it may be, under the field", async () => {
    const user = userEvent.setup();
    renderSetup();

    await user.selectOptions(await screen.findByLabelText("Recipe"), "Wrong shipping address");

    const seed = screen.getByLabelText("Seed");
    expect(seed).toHaveAttribute("step", "1");
    expect(seed).toHaveAccessibleDescription(/A whole number between 0 and 4294967295\./);
    expect(seed).toHaveAccessibleDescription(/replays the same run/);
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

  it("offers to show a reader around", async () => {
    renderBench();

    expect(
      await screen.findByRole("button", { name: `Show me around ${TOURS.bench.surface}` }),
    ).toBeVisible();
    for (const step of TOURS.bench.steps) {
      expect(document.querySelectorAll(step.anchor), step.anchor).toHaveLength(1);
    }
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
    expect(await within(armA).findByText(/interaction\.read_context → Success/)).toBeVisible();
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
      "orders.read_order → Success",
      "scenario fault · moved this arm",
      "orders.propose_address_change → Success",
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

  it("reads what an arm has spent, and shows nothing for one that never ran", async () => {
    agentTurns = [agentTurn(ARM_A, 0)];
    toolEvents = [
      toolEvent(ARM_A, 0, "orders.read_order"),
      toolEvent(ARM_A, 1, "customer.read_profile"),
    ];
    renderBench();

    const armA = await screen.findByRole("region", { name: "Arm A" });
    const armB = screen.getByRole("region", { name: "Arm B" });

    expect(within(armA).getByText("1 turn · 0 tok · 2 tools · 2.1s · 0.00 USD")).toBeVisible();
    // The arm beside it has run nothing, so there is no strip at all rather than a row of
    // zeros an operator would read as a measurement.
    expect(within(armB).queryByText(/tools/)).toBeNull();
  });

  it("counts a retry apart from the failure that caused it", async () => {
    agentTurns = [agentTurn(ARM_A, 0, 1, "model_transient"), agentTurn(ARM_A, 0, 2)];
    renderBench();

    const armA = await screen.findByRole("region", { name: "Arm A" });

    expect(within(armA).getByText(/· 1 retry/)).toBeVisible();
  });

  it("marks a token and cost total that covers only some of an arm's attempts", async () => {
    // The failed attempt reports nothing it spent, so what is shown is a floor rather than
    // the arm's whole spend — and it says so instead of reading as the complete figure.
    agentTurns = [agentTurn(ARM_A, 0, 1, "model_transient"), agentTurn(ARM_A, 0, 2)];
    renderBench();

    const armA = await screen.findByRole("region", { name: "Arm A" });

    expect(within(armA).getByText(/≥0 tok/)).toBeVisible();
    expect(within(armA).getByText(/≥0\.00 USD/)).toBeVisible();
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

  it("reads every objective the scenario composed, per arm", async () => {
    renderBench();

    const objectives = await screen.findByRole("region", { name: "Objectives" });

    expect(within(objectives).getByText("Read the address-change policy")).toBeVisible();
    expect(within(objectives).getAllByText(/read-address-change-policy pending/)).toHaveLength(2);
  });

  it("marks an objective met by the call that answered it, in that arm alone", async () => {
    toolEvents = [toolEvent(ARM_A, 1, "support.read_document")];
    renderBench();

    const objectives = await screen.findByRole("region", { name: "Objectives" });

    // The cell carries the evidence sentence, not only the mark: what a reader needs is why.
    expect(
      within(objectives).getByText(
        /read-address-change-policy met — support\.read_document answered policy:address-change/,
      ),
    ).toBeInTheDocument();
    expect(
      within(objectives).getByText(/read-address-change-policy pending — .*never answered/),
    ).toBeInTheDocument();
  });

  it("says a judge scores its own rows rather than counting them as missed", async () => {
    renderBench();

    const objectives = await screen.findByRole("region", { name: "Objectives" });

    expect(
      within(objectives).getAllByText(/explain-the-outcome a judge scores this.*none has/),
    ).toHaveLength(2);
  });

  it("scores the judge's rows with a published judge and reads what it answered", async () => {
    const user = userEvent.setup();
    renderBench();

    const objectives = await screen.findByRole("region", { name: "Objectives" });
    await user.selectOptions(
      within(objectives).getByLabelText("Judge"),
      "Resolution quality · v2 · gpt-5-mini",
    );
    await user.click(within(objectives).getByRole("button", { name: /Score 1 judged/ }));

    await waitFor(() => expect(scoredBy).toEqual([{ judge_id: JUDGE_ID }]));
    expect(
      within(objectives).getAllByText(
        /explain-the-outcome met — the arm named the order and said what it changed/,
      ),
    ).toHaveLength(2);
  });

  it("says which judge produced a verdict, at which version, on which model", async () => {
    // A verdict an operator cannot trace to a rubric version and a model is a number.
    const user = userEvent.setup();
    renderBench();

    const objectives = await screen.findByRole("region", { name: "Objectives" });
    await user.click(within(objectives).getByRole("button", { name: /Score 1 judged/ }));

    await waitFor(() =>
      expect(
        within(objectives).getAllByText(/judged by gpt-5-mini under judge version 2, attempt 1/),
      ).toHaveLength(2),
    );
  });

  it("offers no scoring when no judge has been published", async () => {
    publishedJudges = { judges: [] };
    renderBench();

    const objectives = await screen.findByRole("region", { name: "Objectives" });

    expect(within(objectives).getByText(/Publish a judge to score them/)).toBeInTheDocument();
    expect(within(objectives).queryByRole("button", { name: /Score/ })).toBeNull();
  });

  it("settles what an arm never did once it reaches the turn cap", async () => {
    // The record of an arm driven to the last turn its scenario allows, and answered there.
    maxTurns = 1;
    turns = [...OPENED, turn(ARM_A, 1, "reply-1", "Any update?")];
    agentTurns = [agentTurn(ARM_A, 1)];
    renderBench();

    const armA = await screen.findByRole("region", { name: "Arm A" });
    const objectives = screen.getByRole("region", { name: "Objectives" });
    const composer = screen.getByRole("region", { name: "Customer composer" });

    expect(within(armA).getByText(/Completed — this arm has answered every turn/)).toBeVisible();
    expect(within(objectives).getByText(/read-address-change-policy missed/)).toBeInTheDocument();
    // Nothing offers a move the backend would refuse: no advance, and no message.
    expect(within(armA).queryByRole("button", { name: /Arm A's agent/ })).toBeNull();
    expect(within(composer).getByRole("checkbox", { name: /Arm A/ })).toBeDisabled();
  });

  it("reads both arms back to the one starting state they were cloned from", async () => {
    renderBench();

    const provenance = await screen.findByRole("region", { name: "Provenance" });

    expect(within(provenance).getByTitle(SANDBOX_FINGERPRINT)).toBeVisible();
    expect(within(provenance).getByTitle(RESOLUTION_FINGERPRINT)).toBeVisible();
    expect(within(provenance).getByText(/human operator/)).toBeVisible();
  });
});

describe("experiment results", () => {
  it("reads every objective the scenario composed with one column per arm", async () => {
    toolEvents = [toolEvent(ARM_A, 0, "support.read_document")];
    renderResults();

    const evidence = await screen.findByRole("region", { name: "Deterministic evidence" });
    const row = within(evidence).getByRole("row", { name: /Read the address-change policy/ });

    // The arm that read the document and the arm that has not, side by side, each with the
    // evidence sentence that makes the cell a finding rather than a mark.
    expect(row).toHaveTextContent(
      /read-address-change-policy met — support\.read_document answered policy:address-change/,
    );
    expect(row).toHaveTextContent(
      /read-address-change-policy pending — support\.read_document never answered/,
    );
  });

  it("counts each arm against what was decided for it, and never into one score", async () => {
    toolEvents = [toolEvent(ARM_A, 0, "support.read_document")];
    renderResults();

    const armA = await screen.findByRole("region", { name: "Arm A summary" });
    const armB = screen.getByRole("region", { name: "Arm B summary" });

    // Arm A met the one row something decided; nothing has decided a row for arm B yet, so
    // its denominator is zero rather than a miss it has not made.
    expect(within(armA).getByText("1/1 decided")).toBeVisible();
    expect(within(armB).getByText("0/0 decided")).toBeVisible();
    expect(screen.getByText(/There is no aggregate score/)).toBeVisible();
  });

  it("keeps the rows a judge owns out of the deterministic evidence", async () => {
    renderResults();

    const evidence = await screen.findByRole("region", { name: "Deterministic evidence" });
    const judged = screen.getByRole("region", { name: "LLM judge evidence" });

    expect(within(evidence).queryByText("Explain the outcome to the customer")).toBeNull();
    expect(within(judged).getByText("Explain the outcome to the customer")).toBeVisible();
  });

  it("names the judge, the version, the model, and the attempt behind a verdict", async () => {
    const user = userEvent.setup();
    renderResults();

    const judged = await screen.findByRole("region", { name: "LLM judge evidence" });
    // Awaited: the published judges arrive on their own read, and the control appears with
    // them — before that the card says a judge owns these rows and offers nothing.
    await user.click(await within(judged).findByRole("button", { name: /Score 1 judged/ }));

    await waitFor(() => expect(scoredBy).toEqual([{ judge_id: JUDGE_ID }]));
    expect(within(judged).getAllByText(/judge v2 · gpt-5-mini · attempt 1/)).toHaveLength(2);
    // Scoring again is offered as what it is: the previous verdict stands and a new attempt
    // is recorded beside it.
    expect(within(judged).getByRole("button", { name: "Score again" })).toBeVisible();
  });

  it("reads what each arm spent, and says so where nobody measured", async () => {
    agentTurns = [agentTurn(ARM_A, 0)];
    toolEvents = [toolEvent(ARM_A, 0, "orders.read_order")];
    renderResults();

    const quantitative = await screen.findByRole("region", { name: "Quantitative" });
    const requests = within(quantitative).getByRole("row", { name: /Model requests/ });

    // Arm A metered itself; the arm that never ran reports nothing rather than a zero an
    // operator would read as a measurement somebody took.
    expect(requests).toHaveTextContent("0");
    expect(requests).toHaveTextContent("not reported");
    expect(within(quantitative).getByRole("row", { name: /Attempts/ })).toHaveTextContent("1");
  });

  it("marks the turn one arm alone received", async () => {
    turns = [...OPENED, turn(ARM_B, 1, "composition-1", "Yes, go ahead.")];
    renderResults();

    const divergence = await screen.findByRole("region", { name: "Input divergence" });

    expect(within(divergence).getByText("Turn 1")).toBeVisible();
    expect(within(divergence).getByText(/never received this turn/)).toBeVisible();
    expect(within(divergence).getByText(/Yes, go ahead\./)).toBeVisible();
  });

  it("reads a controlled comparison as controlled", async () => {
    renderResults();

    const divergence = await screen.findByRole("region", { name: "Input divergence" });

    expect(within(divergence).getByText(/the comparison is controlled/)).toBeVisible();
  });

  it("reports a judge the lab could not reach rather than leaving the row blank", async () => {
    // The lab's own outage is a fact about the lab. A cell that simply stayed empty would
    // read as an arm nobody thought worth judging.
    judgeFailed = true;
    const user = userEvent.setup();
    renderResults();

    const judged = await screen.findByRole("region", { name: "LLM judge evidence" });
    await user.click(await within(judged).findByRole("button", { name: /Score 1 judged/ }));

    await waitFor(() =>
      expect(
        within(judged).getAllByText(/no verdict — the provider was briefly unavailable/),
      ).toHaveLength(2),
    );
  });

  it("marks which depth tab is open", async () => {
    const user = userEvent.setup();
    renderResults();

    const tabs = await screen.findByRole("navigation", { name: "Results views" });
    expect(within(tabs).getByRole("link", { name: "General" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.click(within(tabs).getByRole("link", { name: "Execution timeline" }));
    expect(within(tabs).getByRole("link", { name: "Execution timeline" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(tabs).getByRole("link", { name: "General" })).not.toHaveAttribute("aria-current");
  });

  it("says so when the experiment behind the results cannot be read", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}`, () =>
        HttpResponse.json(
          {
            code: "internal_error",
            message: "the experiment store is unavailable",
            request_id: "req-3",
          },
          { status: 500 },
        ),
      ),
    );
    renderResults();

    // The backend's own reason, not the page's fallback: a screen that swallowed it would
    // leave an operator with nothing to act on. No tab renders behind it.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "the experiment store is unavailable",
    );
    expect(screen.queryByRole("region", { name: "Deterministic evidence" })).toBeNull();
  });

  it("reads what moved each arm from its revisions rather than from what it said", async () => {
    toolEvents = [toolEvent(ARM_A, 0, "orders.apply_address_change", true)];
    mutationEvents = [mutationEvent(ARM_B, 0)];
    renderResults();

    const state = await screen.findByRole("region", {
      name: "Business state — verified, not claimed",
    });
    const rows = within(state).getAllByRole("listitem");

    expect(rows[0]).toHaveTextContent("orders.apply_address_change · r0 → r1");
    // The scenario's own fault is a writer beside the tools: two arms at different
    // revisions is only explainable when both writers are on the page.
    expect(rows[1]).toHaveTextContent("order-moves-under-the-arm · scenario fault · r0 → r1");
  });

  it("says what each write moved the world to, field by field", async () => {
    toolEvents = [toolEvent(ARM_A, 0, "orders.apply_address_change", true)];
    stateDiffs = { [ARM_A]: REDIRECTED };
    renderResults();

    const state = await screen.findByRole("region", {
      name: "Business state — verified, not claimed",
    });
    const [moved, untouched] = within(state).getAllByRole("listitem");

    // The order the customer quotes, then the values a revision counter cannot say.
    expect(moved).toHaveTextContent("NS-10482");
    expect(moved).toHaveTextContent("shipping_address.city: Bordeaux → Lyon");
    // The scenario's own fault moved the same world, so its field is in the same diff.
    expect(moved).toHaveTextContent("fulfilment.status: unfulfilled → partially_fulfilled");
    // The claim the card makes, checked rather than assumed.
    expect(moved).toHaveTextContent("no other state changed");
    expect(untouched).toHaveTextContent(
      "Nothing wrote — this arm's world is the one it started in",
    );
  });

  it("says a field was not there rather than showing it blank", async () => {
    stateDiffs = {
      [ARM_A]: {
        orders: [
          {
            order_id: ORDER_ID,
            reference: "NS-10482",
            changes: [{ path: "shipping_address.city", before: null, after: "Lyon" }],
          },
        ],
        other: [],
      },
    };
    renderResults();

    const state = await screen.findByRole("region", {
      name: "Business state — verified, not claimed",
    });

    // An order that had no address and now has one is a different fact from one whose city
    // was blanked, and an empty cell would read as the same thing for both.
    expect(within(state).getAllByRole("listitem")[0]).toHaveTextContent(
      "shipping_address.city: not set → Lyon",
    );
  });

  it("reports a change outside every order rather than hiding it", async () => {
    stateDiffs = {
      [ARM_A]: {
        orders: [],
        other: [{ path: "interaction.ticket_reference", before: "T-204", after: "T-999" }],
      },
    };
    renderResults();

    // Nothing in this build can produce one, which is exactly why it must be visible if one
    // appears: the card's "no other state changed" is otherwise unfalsifiable.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Changed outside every order: interaction.ticket_reference: T-204 → T-999",
    );
  });

  it("offers to show a reader around the comparison", async () => {
    renderResults();

    expect(
      await screen.findByRole("button", { name: `Show me around ${TOURS.results.surface}` }),
    ).toBeVisible();
    for (const step of TOURS.results.steps) {
      expect(document.querySelectorAll(step.anchor), step.anchor).toHaveLength(1);
    }
  });
});

describe("execution timeline", () => {
  it("reads both arms' execution as one ordered stream", async () => {
    renderTimeline();

    const stream = await screen.findByRole("region", { name: "Execution timeline" });
    const rows = within(stream).getAllByRole("listitem");

    expect(rows[0]).toHaveTextContent("Arm A · Arm B");
    expect(rows[0]).toHaveTextContent(/triggering message opened every arm/);
    expect(rows[1]).toHaveTextContent(/orders\.apply_address_change v1 → Success/);
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

  it("is a depth tab of the results screen, and leads back to the bench", async () => {
    const user = userEvent.setup();
    renderBench();

    await user.click(await screen.findByRole("link", { name: "Results" }));
    await user.click(await screen.findByRole("link", { name: "Execution timeline" }));

    expect(await screen.findByRole("region", { name: "Execution timeline" })).toBeVisible();
    // The header stays across the tabs: an operator following a finding into the timeline is
    // still reading one experiment, and has never lost which one.
    expect(
      screen.getByRole("heading", { name: "Wrong address — framework comparison" }),
    ).toBeVisible();

    await user.click(screen.getByRole("link", { name: "Back to the live bench" }));
    expect(await screen.findByRole("region", { name: "Customer composer" })).toBeVisible();
  });
});

describe("traces", () => {
  it("draws one attempt as a waterfall, each call where inside the attempt it ran", async () => {
    renderTraces();

    const waterfall = await screen.findByRole("list", { name: "Span waterfall" });

    const rows = within(waterfall).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual([
      "experiment.attempt3400 ms",
      "agent.answer3310 ms",
      "agent.tool · orders.read_order310 ms",
      "agent.tool · orders.apply_address_change420 ms",
    ]);
  });

  it("reads a span's tool and outcome off the record rather than off the span", async () => {
    const user = userEvent.setup();
    renderTraces();

    const waterfall = await screen.findByRole("list", { name: "Span waterfall" });
    await user.click(
      within(waterfall).getByRole("button", { name: /orders.apply_address_change/ }),
    );

    const panel = screen.getByRole("region", { name: "Span" });
    expect(within(panel).getByText("orders.apply_address_change · v1")).toBeVisible();
    expect(within(panel).getByText("Refused")).toBeVisible();
    expect(within(panel).getByText("+2600 ms into the attempt")).toBeVisible();
    expect(within(panel).getByText("a".repeat(32))).toBeVisible();
  });

  it("offers every recorded attempt and names the arm each one belongs to", async () => {
    const user = userEvent.setup();
    traced = {
      ...TRACES,
      traces: [
        {
          ...TRACES.traces[0],
          attempt: 1,
          outcome: "failed",
          failure: "model_provider",
          trace_id: "b".repeat(32),
          spans: TRACES.traces[0].spans.slice(0, 2),
        },
        { ...TRACES.traces[0], attempt: 2 },
      ],
    };
    renderTraces();

    const picker = await screen.findByRole("group", { name: "Traced attempts" });
    expect(
      within(picker).getByRole("button", { name: "Arm A · turn 1 · attempt 1 · failed" }),
    ).toBeVisible();
    expect(
      within(picker).getByRole("button", { name: "Arm A · turn 1 · attempt 2" }),
    ).toBeVisible();

    await user.click(within(picker).getByRole("button", { name: /failed/ }));

    const waterfall = screen.getByRole("list", { name: "Span waterfall" });
    expect(within(waterfall).getAllByRole("button")).toHaveLength(2);
    expect(
      within(screen.getByRole("region", { name: "Span" })).getByText(
        /the model provider rejected the request/,
      ),
    ).toBeVisible();
  });

  it("says an attempt was never traced instead of reconstructing one", async () => {
    traced = {
      ...TRACES,
      traces: [{ ...TRACES.traces[0], trace_id: null, spans: [] }],
    };
    renderTraces();

    const card = await screen.findByRole("region", { name: "Traces" });

    expect(within(card).getByText(/recorded before the lab traced its runs/)).toBeVisible();
    expect(within(card).queryByRole("list", { name: "Span waterfall" })).toBeNull();
  });

  it("says an experiment nobody has run has nothing to trace", async () => {
    traced = { experiment_id: EXPERIMENT_ID, traces: [] };
    renderTraces();

    const card = await screen.findByRole("region", { name: "Traces" });

    expect(within(card).getByText(/nothing to trace/)).toBeVisible();
  });

  it("is a depth tab of the results screen, reached beside the timeline", async () => {
    const user = userEvent.setup();
    renderResults();

    const tabs = await screen.findByRole("navigation", { name: "Results views" });
    await user.click(within(tabs).getByRole("link", { name: "Traces" }));

    expect(within(tabs).getByRole("link", { name: "Traces" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await screen.findByRole("region", { name: "Traces" })).toBeVisible();
    // The header stays across the tabs, as it does for every other depth view.
    expect(
      screen.getByRole("heading", { name: "Wrong address — framework comparison" }),
    ).toBeVisible();
  });

  it("reports the backend's own reason when the traces cannot be read", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/traces`, () =>
        HttpResponse.json(
          {
            code: "internal_error",
            message: "the trace store is unavailable",
            request_id: "req-9",
          },
          { status: 500 },
        ),
      ),
    );
    renderTraces();

    expect(await screen.findByRole("alert")).toHaveTextContent("the trace store is unavailable");
  });
});

describe("notes and tags", () => {
  it("says a run has nothing written on it rather than showing an empty strip", async () => {
    renderResults();

    const strip = await screen.findByRole("region", { name: "Notes & tags" });

    expect(within(strip).getByText("Not filed under any tag yet.")).toBeVisible();
    expect(within(strip).queryByRole("listitem")).toBeNull();
  });

  it("keeps a note as written and answers with everything on the run", async () => {
    const user = userEvent.setup();
    renderResults();
    const strip = await screen.findByRole("region", { name: "Notes & tags" });

    await user.type(
      within(strip).getByLabelText("Add a note"),
      "Beacon acts before reading the policy.",
    );
    await user.click(within(strip).getByRole("button", { name: "Add note" }));

    expect(await within(strip).findByText("Beacon acts before reading the policy.")).toBeVisible();
    // The box empties only because the write was accepted, so nothing typed is ever lost.
    expect(within(strip).getByLabelText("Add a note")).toHaveValue("");
  });

  it("files the run by sending the whole tag set, never one tag at a time", async () => {
    const user = userEvent.setup();
    renderResults();
    const strip = await screen.findByRole("region", { name: "Notes & tags" });

    await user.type(within(strip).getByLabelText("Add a tag"), "read-check-gap");
    await user.click(within(strip).getByRole("button", { name: "Add tag" }));
    await within(strip).findByText("read-check-gap");
    await user.type(within(strip).getByLabelText("Add a tag"), "two-arm");
    await user.click(within(strip).getByRole("button", { name: "Add tag" }));
    await within(strip).findByText("two-arm");

    expect(filed).toEqual([["read-check-gap"], ["read-check-gap", "two-arm"]]);
  });

  it("removes a tag by sending the set without it", async () => {
    const user = userEvent.setup();
    annotations = { notes: [], tags: ["read-check-gap", "two-arm"] };
    renderResults();
    const strip = await screen.findByRole("region", { name: "Notes & tags" });

    await user.click(within(strip).getByRole("button", { name: "Remove tag two-arm" }));

    await waitFor(() => expect(filed).toEqual([["read-check-gap"]]));
    expect(within(strip).queryByText("two-arm")).toBeNull();
  });

  it("shows the tag as the backend folded it rather than as it was typed", async () => {
    const user = userEvent.setup();
    renderResults();
    const strip = await screen.findByRole("region", { name: "Notes & tags" });

    await user.type(within(strip).getByLabelText("Add a tag"), "Read-Check-Gap");
    await user.click(within(strip).getByRole("button", { name: "Add tag" }));

    expect(await within(strip).findByText("read-check-gap")).toBeVisible();
  });

  it("leaves a half-typed tag alone when a chip beside it is removed", async () => {
    const user = userEvent.setup();
    annotations = { notes: [], tags: ["two-arm"] };
    renderResults();
    const strip = await screen.findByRole("region", { name: "Notes & tags" });

    await user.type(within(strip).getByLabelText("Add a tag"), "read-check");
    await user.click(within(strip).getByRole("button", { name: "Remove tag two-arm" }));

    await waitFor(() => expect(filed).toEqual([[]]));
    // Removing a chip is not what consumed the box, so what was typed is still there.
    expect(within(strip).getByLabelText("Add a tag")).toHaveValue("read-check");
  });

  it("says why a note could not be saved and keeps what was typed", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/notes`, () =>
        HttpResponse.json(
          {
            code: "internal_error",
            message: "the annotation store is unavailable",
            request_id: "req-4",
          },
          { status: 500 },
        ),
      ),
    );
    renderResults();
    const strip = await screen.findByRole("region", { name: "Notes & tags" });

    await user.type(within(strip).getByLabelText("Add a note"), "Worth rerunning.");
    await user.click(within(strip).getByRole("button", { name: "Add note" }));

    expect(await within(strip).findByRole("alert")).toHaveTextContent(
      "the annotation store is unavailable",
    );
    expect(within(strip).getByLabelText("Add a note")).toHaveValue("Worth rerunning.");
  });
});

describe("replay", () => {
  it("derives a new experiment from the results screen and opens what it produced", async () => {
    const user = userEvent.setup();
    renderResults();

    await user.click(await screen.findByRole("button", { name: "Replay" }));

    expect(replayed).toEqual([EXPERIMENT_ID]);
    // A different run, not this one refreshed: leaving the operator on the old experiment
    // would hide the only thing that happened.
    expect(
      await screen.findByRole("heading", {
        name: "Wrong address — framework comparison (replay)",
      }),
    ).toBeVisible();
  });

  it("says which run a derived experiment replays, and links back to it", async () => {
    renderApp(`/shops/${SHOP_ID}/bench/${REPLAY_ID}/results`);

    const back = await screen.findByRole("link", {
      name: "Wrong address — framework comparison",
    });
    expect(back).toHaveAttribute("href", `/shops/${SHOP_ID}/bench/${EXPERIMENT_ID}/results`);
  });

  it("reports a replay the backend refuses without leaving the run being read", async () => {
    const user = userEvent.setup();
    replayFails = true;
    renderResults();

    await user.click(await screen.findByRole("button", { name: "Replay" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "no runtime for this arm's framework is available here",
    );
    expect(
      screen.getByRole("heading", { name: "Wrong address — framework comparison" }),
    ).toBeVisible();
  });

  it("forks a run onto the version an operator chose and opens what it produced", async () => {
    const user = userEvent.setup();
    renderResults();

    await user.click(await screen.findByRole("button", { name: "Fork…" }));
    const panel = await screen.findByRole("region", { name: "Fork this experiment" });
    const [, armB] = within(panel).getAllByLabelText("Published version");
    await user.selectOptions(armB, "2");
    await user.click(within(panel).getByRole("button", { name: "Fork this run" }));

    // One arm per arm of the source, in the source's order, with only the chosen one moved.
    expect(forked).toEqual([
      [
        { configuration_id: ATLAS_ID, version: 1 },
        { configuration_id: BEACON_ID, version: 2 },
      ],
    ]);
    expect(
      await screen.findByRole("heading", { name: "Wrong address — framework comparison (fork)" }),
    ).toBeVisible();
  });

  it("will not fork a run onto the versions it already ran", async () => {
    const user = userEvent.setup();
    renderResults();

    await user.click(await screen.findByRole("button", { name: "Fork…" }));
    const panel = await screen.findByRole("region", { name: "Fork this experiment" });

    // A derivation that changes nothing is a replay, and there is a button for that beside
    // this one — so the control says it is not ready rather than sending a request that can
    // only fail.
    expect(within(panel).getByRole("button", { name: "Fork this run" })).toBeDisabled();
    expect(forked).toEqual([]);
  });

  it("says which run a fork came from and what it changed", async () => {
    renderApp(`/shops/${SHOP_ID}/bench/${FORK_ID}/results`);

    const back = await screen.findByRole("link", {
      name: "Wrong address — framework comparison",
    });
    expect(back).toHaveAttribute("href", `/shops/${SHOP_ID}/bench/${EXPERIMENT_ID}/results`);
    expect(await screen.findByText(/fork of/)).toHaveTextContent("changed prompt");
  });

  it("warns on the derived screen when a fork left its own arms differing two ways", async () => {
    // Two comparisons, and both belong here. `changed` is the derivation's — what this fork
    // moved from the run it came from — and the chip strip is ADR 0025's, over the arms this
    // experiment actually holds. A fork is the operation most likely to turn a one-variable
    // source into a two-variable run, and the screen it lands on has to say so.
    renderApp(`/shops/${SHOP_ID}/bench/${FORK_ID}/results`);

    expect(
      await screen.findByText(
        /2 differences — no behavior here can be attributed to any one of them/,
      ),
    ).toBeVisible();
  });

  it("closes the fork panel once it has derived, so the next run opens clean", async () => {
    const user = userEvent.setup();
    renderResults();

    await user.click(await screen.findByRole("button", { name: "Fork…" }));
    const panel = await screen.findByRole("region", { name: "Fork this experiment" });
    await user.selectOptions(within(panel).getAllByLabelText("Published version")[1], "2");
    await user.click(within(panel).getByRole("button", { name: "Fork this run" }));
    await screen.findByRole("heading", { name: "Wrong address — framework comparison (fork)" });

    // The panel belonged to the run it was opened on. Left open it would sit over a
    // different experiment with a draft written against the previous one.
    expect(screen.queryByRole("region", { name: "Fork this experiment" })).toBeNull();
  });

  it("says the configurations could not be read rather than offering an empty picker", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/v1/agent-configurations", () =>
        HttpResponse.json(
          {
            code: "internal_error",
            message: "the configuration library is unavailable",
            request_id: "req-11",
          },
          { status: 500 },
        ),
      ),
    );
    renderResults();

    await user.click(await screen.findByRole("button", { name: "Fork…" }));
    const panel = await screen.findByRole("region", { name: "Fork this experiment" });

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "the configuration library is unavailable",
    );
  });

  it("offers no composer on a run a script drove, because a person cannot drive it", async () => {
    driver = "scripted";
    renderBench();

    const composer = await screen.findByRole("region", { name: "Customer composer" });

    expect(composer).toHaveTextContent(/records its customer turns as scripted/);
    expect(within(composer).queryByRole("button", { name: "Send as the customer" })).toBeNull();
    // An experiment may be started under a driver by hand, so a run that was not derived
    // from anything must not claim it was.
    expect(composer).not.toHaveTextContent(/derived from/);
  });

  it("names the run a derived thread was driven by, where there is one to name", async () => {
    renderApp(`/shops/${SHOP_ID}/bench/${REPLAY_ID}`);

    const composer = await screen.findByRole("region", { name: "Customer composer" });

    expect(composer).toHaveTextContent(
      /driven by the run it was derived from, Wrong address — framework comparison/,
    );
  });
});
