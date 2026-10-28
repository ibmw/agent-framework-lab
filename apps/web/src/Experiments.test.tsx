import type {
  AgentConfigurationListResponse,
  AgentConfigurationResourcesResponse,
  AgentConfigurationVersionListResponse,
  AgentConfigurationVersionResponse,
  AgentTurnSchema,
  ArmMetricsSchema,
  ArmStandingSchema,
  ArmStateDiffSchema,
  ComparisonVariableSchema,
  CustomerProfileVersionResponse,
  ExperimentAnnotationsResponse,
  ExperimentEvaluationResponse,
  ExperimentListResponse,
  ExperimentPreviewResponse,
  ExperimentResponse,
  ExperimentTimelineResponse,
  ExperimentTracesResponse,
  JudgeConfigurationListResponse,
  LabStatusResponse,
  ModelConnectionSource,
  MutationEventSchema,
  ObjectiveResultSchema,
  ParticipantTurnSchema,
  RunTraceSpanSchema,
  ScenarioListResponse,
  ScenarioVersionListResponse,
  ScenarioVersionResponse,
  ShopDraftResponse,
  ShopListResponse,
  ShopPreviewResponse,
  TicketVersionResponse,
  TimelineEntrySchema,
  ToolEventSchema,
} from "@agent-lab/contracts";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NO_ARM,
  NO_NAME,
  NO_SCENARIO,
  NO_SCENARIO_VERSION,
  NO_SEED,
  noArmVersion,
  SEED_OUT_OF_RANGE,
} from "./lib/experimentStart";
import { TOURS } from "./lib/tours";
import { renderApp } from "./test/app";
import { labConnection } from "./test/connection";
import {
  expectBusy,
  expectNotRefused,
  expectRefusalWeight,
  expectRefused,
  refusalFacts,
  submitWithoutPressing,
} from "./test/refused";
import { shellListings } from "./test/shell";
import { stubViewport } from "./test/viewport";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const SCENARIO_ID = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
const TICKET_ID = "6b0f9c1e-49d1-4c9f-8b0c-1f6d1c2f9a01";
const PROFILE_ID = "5a1e2d3c-4b5a-4697-8a8b-9c0d1e2f3a4b";
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
  logo: null,
};

const SCENARIOS: ScenarioListResponse = {
  scenarios: [
    {
      scenario_id: SCENARIO_ID,
      name: "Wrong shipping address",
      ticket_id: TICKET_ID,
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

/**
 * One published scenario version, pinned to shop v3 and ticket v1 as the prototype's is, and
 * published under the name the listing gives it until a test renames the scenario.
 */
function scenarioVersion(
  version: number,
  name = "Wrong shipping address",
  ticket = 1,
): ScenarioVersionResponse {
  return {
    scenario_id: SCENARIO_ID,
    shop_id: SHOP_ID,
    lifecycle_state: "published",
    version,
    content_fingerprint: "d".repeat(64),
    published_at: "2026-08-28T09:05:00+00:00",
    shop_version: 3,
    ticket_version: ticket,
    templates: [],
    // The page reads the pins, the ticket and the name the version was published under.
    content: { name, ticket_id: TICKET_ID } as ScenarioVersionResponse["content"],
  };
}

/** The ticket version the scenario pinned, which pins the customer at v2. */
function ticketVersion(version: number, reference = "T-204", customer = 2): TicketVersionResponse {
  return {
    ticket_id: TICKET_ID,
    shop_id: SHOP_ID,
    lifecycle_state: "published",
    version,
    content_fingerprint: "e".repeat(64),
    published_at: "2026-08-28T09:00:00+00:00",
    shop_version: 3,
    customer_profile_version: customer,
    // The reference it was published under, and the customer it pinned.
    content: { reference, customer_profile_id: PROFILE_ID } as TicketVersionResponse["content"],
  };
}

/** The customer version a ticket version pinned, under the display name it was published with. */
function customerVersion(
  version: number,
  displayName = "Maya Laurent",
): CustomerProfileVersionResponse {
  return {
    profile_id: PROFILE_ID,
    lifecycle_state: "published",
    version,
    content_fingerprint: "f".repeat(64),
    published_at: "2026-08-27T09:00:00+00:00",
    content: { display_name: displayName } as CustomerProfileVersionResponse["content"],
  };
}

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

/** A third published configuration: with it, which two the arms run is a choice. */
const CANARY = configuration(
  "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7b",
  "cfg-canary",
  "Pydantic AI",
  1,
);

/** A second published scenario: with it, which one runs is a choice. */
const OTHER_SCENARIO: ScenarioListResponse["scenarios"][number] = {
  ...SCENARIOS.scenarios[0],
  scenario_id: "6d7e8f9a-0b1c-4d2e-8f3a-4b5c6d7e8f9a",
  name: "Damaged on arrival",
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

/** What one arm's clock and state made of the seeded run's redirect. */
interface ArmWorld {
  eventId: string;
  firedAt: string;
  changedAt: string;
  city?: string;
  sourceAddressId?: string;
}

const ARM_A_WORLD: ArmWorld = {
  eventId: "address-change-e72248418ca9",
  firedAt: "2026-08-24T09:00:55.000000Z",
  changedAt: "2026-08-24T09:01:05.000000Z",
};

const ARM_B_WORLD: ArmWorld = {
  eventId: "address-change-d1a644321b81",
  firedAt: "2026-08-24T09:01:15.000000Z",
  changedAt: "2026-08-24T09:01:25.000000Z",
};

/**
 * The seeded run's diff as the API serves it for one arm: the fault's entry, the redirect's
 * entry, the fulfilment it advanced and the address it replaced — seventeen paths, which two
 * arms that did the same thing share but for their clocks and the names they gave the events.
 */
function seededDiff(world: ArmWorld): ArmStateDiffSchema {
  return {
    orders: [
      {
        order_id: ORDER_ID,
        reference: "NS-10482",
        changes: [
          { path: "events[3].id", before: null, after: "mutation-warehouse-picks-the-order" },
          { path: "events[3].kind", before: null, after: "shipped" },
          { path: "events[3].occurred_at", before: null, after: world.firedAt },
          {
            path: "events[3].summary",
            before: null,
            after: "Order NS-10482 moved to partially fulfilled while support was handling it.",
          },
          { path: "events[4].id", before: null, after: world.eventId },
          { path: "events[4].kind", before: null, after: "address_updated" },
          { path: "events[4].occurred_at", before: null, after: world.changedAt },
          {
            path: "events[4].summary",
            before: null,
            after: "Shipping address changed to 'Home' by Northstar tier 1.",
          },
          { path: "fulfilment.shipped_at", before: null, after: world.firedAt },
          { path: "fulfilment.status", before: "unfulfilled", after: "partially_fulfilled" },
          { path: "shipping_address.city", before: "Bordeaux", after: world.city ?? "Lyon" },
          {
            path: "shipping_address.line1",
            before: "7 cours de l'Intendance",
            after: "18 rue des Écoles",
          },
          { path: "shipping_address.line2", before: null, after: "Appartement 4" },
          { path: "shipping_address.postal_code", before: "33000", after: "69005" },
          {
            path: "shipping_address.selected_at",
            before: "2026-08-24T09:00:16.000000Z",
            after: world.changedAt,
          },
          {
            path: "shipping_address.source_address_id",
            before: "bordeaux-previous-flat",
            after: world.sourceAddressId ?? "home",
          },
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
}

/** One arm's diff with each change passed through `edit`, and any `added` after them. */
function editedDiff(
  diff: ArmStateDiffSchema,
  edit: (
    change: ArmStateDiffSchema["orders"][number]["changes"][number],
  ) => ArmStateDiffSchema["orders"][number]["changes"][number],
  added: ArmStateDiffSchema["orders"][number]["changes"] = [],
): ArmStateDiffSchema {
  return {
    ...diff,
    orders: diff.orders.map((order) => ({
      ...order,
      changes: [...order.changes.map(edit), ...added],
    })),
  };
}

/** The row a table holds for one path, found by its row header. */
/** A field table's row, by the path its header names on its first line. */
function rowOf(table: HTMLElement, path: string): HTMLElement {
  const headers = within(table)
    .getAllByRole("rowheader")
    .filter((cell) => cell.querySelector(".font-mono")?.textContent === path);
  expect(headers, `rows naming ${path}`).toHaveLength(1);
  const row = headers[0]?.closest("tr");
  if (!row) {
    throw new Error(`no row holds ${path}`);
  }
  return row;
}

/** What an element says to a reader who hears it: its text without what is `aria-hidden`. */
function heard(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) {
    hidden.remove();
  }
  return (clone.textContent ?? "").trim();
}

/**
 * A field table's row as it is heard, part by part: the path, the value every arm started from,
 * each arm's value, then the assessment where there is one.
 */
function heardFieldRow(row: HTMLElement): string[] {
  const header = within(row).getByRole("rowheader");
  const path = header.querySelector(".font-mono");
  return [
    path?.textContent ?? "",
    heard(path?.nextElementSibling ?? document.createElement("span")),
    ...within(row)
      .getAllByRole("cell")
      .map((cell) => heard(cell)),
  ];
}

/** One of the Objectives section's two groups, by its heading: the table it draws its rows in. */
function objectivesGroup(name: "Decided by a rule" | "Scored by a judge"): HTMLElement {
  return within(screen.getByRole("region", { name: "Objectives" })).getByRole("table", { name });
}

/** Serves the evaluation with each arm's objectives edited, as one scenario's would be. */
function serveObjectives(edit: (rows: ObjectiveResultSchema[]) => ObjectiveResultSchema[]): void {
  server.use(
    http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/evaluation`, () => {
      const base = evaluation(turns, agentTurns, toolEvents);
      return HttpResponse.json({
        ...base,
        arms: base.arms.map((arm) => ({ ...arm, objectives: edit(arm.objectives) })),
      });
    }),
  );
}

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
      detail: "no verdict is recorded for this arm yet",
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
    detail: judgeRationale,
    judgement: {
      judge_id: JUDGE_ID,
      judge_version: 2,
      provider: judgeProvider,
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
        // Not the "cfg-atlas" the version endpoint serves for atlas@1: the two differ so a test
        // can tell a label taken from the record apart from one taken from a read.
        agent_configuration_name: "Atlas",
        framework_id: "fake",
        provider: runProviders[0],
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
        provider: runProviders[1],
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
/** What the judge wrote on a verdict, and the provider the judgement records it ran on. */
let judgeRationale = "the arm named the order and said what it changed";
let judgeProvider = "openai";
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
/** Which answer of ADR 0052's chain the lab gives; a lab that reaches its provider by default. */
let connectionSource: ModelConnectionSource = "environment";
/**
 * The provider each arm of the run under test pinned, as the record names it. The declared
 * control by default; a case about reach moves an arm onto OpenAI.
 */
let runProviders: [string, string] = ["fake", "fake"];
const connectionServed = { statuses: 0, listings: 0 };
let versionReads = 0;
/**
 * The name a configuration version was published under, by `configuration@version`, where a
 * test has the configuration renamed since: absent, a version carries the listing's name.
 */
let publishedNames: Record<string, string> = {};

/**
 * Every read setup needs to decide whether an arm is reachable has answered, and the page has
 * had its turn to draw it: an enabled Start asserted before then proves nothing.
 */
async function reachabilityRead() {
  await waitFor(() => {
    expect(connectionServed.statuses).toBeGreaterThanOrEqual(1);
    expect(connectionServed.listings).toBeGreaterThanOrEqual(1);
    expect(versionReads).toBeGreaterThanOrEqual(1);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * One frozen version of a configuration, naming the provider its framework is proven on: the
 * deterministic control for cfg-beacon, OpenAI for the rest. What the arm runs is the version,
 * so the provider setup reads is the version's.
 */
function publishedVersion(
  configurationId: string,
  version: number,
): AgentConfigurationVersionResponse {
  const control = configurationId === BEACON_ID;
  return {
    configuration_id: configurationId,
    lifecycle_state: "published",
    version,
    content_fingerprint: "e".repeat(64),
    published_at: "2026-08-28T08:00:00+00:00",
    support_identity_version: 1,
    content: {
      // Published under the name the lab lists it by, until a test renames the configuration.
      name:
        publishedNames[`${configurationId}@${version}`] ??
        [...CONFIGURATIONS.configurations, CANARY].find(
          (entry) => entry.configuration_id === configurationId,
        )?.name ??
        "cfg-atlas",
      description: "",
      framework_id: control ? "fake" : "pydantic-ai",
      architecture: "single_agent",
      support_identity_id: "8e9f0a1b-2c3d-4e5f-8a6b-7c8d9e0f1a2b",
      prompt: "You are a support agent.",
      tone_of_voice: { source: "shop_default", guideline_id: "" },
      tools: [],
      memory: "conversation",
      model: {
        provider: control ? "fake" : "openai",
        model_id: control ? "deterministic" : "gpt-5-mini",
        temperature: "0.20",
        max_tool_rounds: 8,
      },
    },
  };
}

/** The proven frameworks as the catalog serves them: the label is the catalog's, not the record's. */
const FRAMEWORK_CATALOG: AgentConfigurationResourcesResponse = {
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

const server = setupServer(
  // The lab resolves its current shop against this list rather than trusting the remembered
  // identifier, so the bench only composes for a shop the lab actually holds (ADR 0054).
  http.get("*/api/v1/shops", () =>
    HttpResponse.json({
      shops: [
        {
          shop_id: SHOP_ID,
          name: "Northstar Outfitters",
          slug: "northstar",
          updated_at: "2026-08-25T12:05:00+00:00",
          latest_published_version: 1,
          published_version_count: 1,
          logo: null,
        },
      ],
    } satisfies ShopListResponse),
  ),
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
  http.get(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/versions/:version`, ({ params }) =>
    HttpResponse.json(scenarioVersion(Number(params.version))),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/tickets/${TICKET_ID}/versions/:version`, ({ params }) =>
    HttpResponse.json(ticketVersion(Number(params.version))),
  ),
  http.get(`*/api/v1/customer-profiles/${PROFILE_ID}/versions/:version`, ({ params }) =>
    HttpResponse.json(customerVersion(Number(params.version))),
  ),
  http.get("*/api/v1/agent-configurations", () => HttpResponse.json(CONFIGURATIONS)),
  http.get("*/api/v1/agent-configurations/:configurationId/versions", () =>
    HttpResponse.json(CONFIGURATION_VERSIONS),
  ),
  http.get("*/api/v1/agent-configurations/:configurationId/versions/:version", ({ params }) => {
    versionReads += 1;
    return HttpResponse.json(
      publishedVersion(String(params.configurationId), Number(params.version)),
    );
  }),
  ...labConnection(() => connectionSource, connectionServed),
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
  // The proven-framework catalog, which the results' arm cards name a framework from.
  http.get("*/api/v1/agent-configurations/resources", () => HttpResponse.json(FRAMEWORK_CATALOG)),
  // The shop and lab shells read every listing their rail counts (ADR 0056). Last, so a
  // handler this suite declares for one of these routes still wins.
  ...shellListings(),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
// The bench composes for the lab's current shop, which is the remembered-shop preference
// resolved against the shop list (ADR 0054). Without one it says so instead, which is its own
// case below.
beforeEach(() => window.localStorage.setItem("agent-lab.last-visited-shop", SHOP_ID));
afterEach(() => {
  // A case that moved the viewport across the narrow breakpoint (`stubViewport`) leaves the
  // next one wide.
  vi.unstubAllGlobals();
  window.localStorage.clear();
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
  judgeRationale = "the arm named the order and said what it changed";
  judgeProvider = "openai";
  scoredBy = [];
  publishedJudges = JUDGES;
  annotations = { notes: [], tags: [] };
  filed = [];
  traced = TRACES;
  driver = "human";
  replayed = [];
  replayFails = false;
  forked = [];
  connectionSource = "environment";
  runProviders = ["fake", "fake"];
  connectionServed.statuses = 0;
  connectionServed.listings = 0;
  versionReads = 0;
  publishedNames = {};
});
afterAll(() => server.close());

function renderSetup() {
  return renderApp("/lab/bench");
}

/**
 * A chip on the bench or the timeline says what something is and cannot be pressed: no button
 * role, not in the tab order, and none of the hover, pointer or ring a button promises a press
 * with (`chipClasses`).
 */
function expectInertChip(chip: HTMLElement) {
  expect(chip.closest("button, a, [role='button']")).toBeNull();
  expect(chip).not.toHaveAttribute("tabindex");
  expect(chip.tabIndex).toBe(-1);
  expect(chip.className).not.toMatch(/(^|\s)(hover|focus-visible):/);
  expect(chip.className).not.toContain("cursor-pointer");
  expect(chip.className).toContain("cursor-default");
}

function renderTimeline() {
  return renderApp(`/lab/bench/${SHOP_ID}/${EXPERIMENT_ID}/results/timeline`);
}

function renderTraces() {
  return renderApp(`/lab/bench/${SHOP_ID}/${EXPERIMENT_ID}/results/traces`);
}

function renderResults() {
  return renderApp(`/lab/bench/${SHOP_ID}/${EXPERIMENT_ID}/results`);
}

function renderBench() {
  return renderApp(`/lab/bench/${SHOP_ID}/${EXPERIMENT_ID}`);
}

/**
 * A row of a results sheet section by its label — open or folded behind "the same for both
 * arms" — matched on the label itself, so "Turns" is never "Answered turns".
 */
function sheetRow(section: HTMLElement, label: string): HTMLElement {
  const rows = within(section)
    .getAllByRole("row", { hidden: true })
    .filter(
      (row) => row.querySelector("th")?.firstElementChild?.firstElementChild?.textContent === label,
    );
  expect(rows, `rows labelled ${label}`).toHaveLength(1);
  return rows[0];
}

/** A cell's lines, one fact each: the children of the grid every sheet cell holds them in. */
function lines(cell: HTMLElement | undefined): (string | null)[] {
  return Array.from(
    cell?.querySelectorAll(":scope > div > span") ?? [],
    (line) => line.textContent,
  );
}

/** A sheet row's cells after its label, read left to right: one per arm, or one spanning. */
function sheetCells(section: HTMLElement, label: string): (string | null)[] {
  return within(sheetRow(section, label))
    .getAllByRole("cell", { hidden: true })
    .map((cell) => cell.textContent);
}

/** Start's reasons, one per line of the refusal its description names — or none. */
function startReasons(start: HTMLElement): string[] {
  const [id] = (start.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  const list = id ? document.getElementById(id) : null;
  return Array.from(list?.querySelectorAll("li") ?? [], (item) => item.textContent ?? "");
}

/** The scenario the setup opened on: the fixture's only published one, chosen for the operator. */
async function scenarioChosen() {
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Scenario" })).toHaveValue(SCENARIO_ID),
  );
}

/** Types over the proposed name, as an operator naming the run themselves does. */
async function nameAs(user: ReturnType<typeof userEvent.setup>, name: string) {
  const field = screen.getByLabelText("Name");
  await user.clear(field);
  await user.type(field, name);
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

    await scenarioChosen();
    await chooseArm(user, 0, "cfg-atlas");
    await chooseArm(user, 1, "cfg-beacon");

    const matrix = await screen.findByRole("table");
    const framework = within(matrix).getByRole("row", { name: /framework/ });
    expect(within(framework).getByText("Difference")).toBeVisible();
    const architecture = within(matrix).getByRole("row", { name: /architecture/ });
    expect(within(architecture).getByText("Same")).toBeVisible();
  });

  describe("a support identity on two versions", () => {
    const identity = "8e9f0a1b-2c3d-4e5f-8a6b-7c8d9e0f1a2b";

    /** The gate's answer for arms on two versions of one identity: one id, and a difference. */
    function serveIdentityPreview() {
      server.use(
        http.post(`*/api/v1/shops/${SHOP_ID}/experiments/preview`, () =>
          HttpResponse.json({
            ...PREVIEW,
            issues: [],
            comparison: COMPARISON.map((entry) =>
              entry.dimension === "support_identity"
                ? { dimension: "support_identity", values: [identity, identity], differs: true }
                : variable(entry.dimension, [entry.values[0], entry.values[0]]),
            ),
          } satisfies ExperimentPreviewResponse),
        ),
      );
    }

    function identityCells(matrix: HTMLElement) {
      return within(within(matrix).getByRole("row", { name: /support identity/i }))
        .getAllByRole("cell")
        .slice(1)
        .map((cell) => cell.textContent);
    }

    it("names each arm's identity by the version it pinned beside the difference", async () => {
      const user = userEvent.setup();
      serveIdentityPreview();
      server.use(
        http.get("*/api/v1/agent-configurations/:configurationId/versions/:version", ({ params }) =>
          HttpResponse.json({
            ...publishedVersion(String(params.configurationId), Number(params.version)),
            support_identity_version: params.configurationId === BEACON_ID ? 2 : 1,
          }),
        ),
      );
      renderSetup();

      await scenarioChosen();
      await chooseArm(user, 0, "cfg-atlas");
      await chooseArm(user, 1, "cfg-beacon");

      const matrix = await screen.findByRole("table");
      await waitFor(() =>
        expect(identityCells(matrix)).toEqual(["v1 · 8e9f0a1b", "v2 · 8e9f0a1b", "Difference"]),
      );
      const row = within(matrix).getByRole("row", { name: /support identity/i });
      expect(within(row).getByText("v2 · 8e9f0a1b")).toHaveAttribute("title", identity);
    });

    it("reads the identity's id where an arm's version could not be read", async () => {
      const user = userEvent.setup();
      serveIdentityPreview();
      server.use(
        http.get(
          "*/api/v1/agent-configurations/:configurationId/versions/:version",
          ({ params }) =>
            params.configurationId === BEACON_ID
              ? HttpResponse.json(
                  { code: "unavailable", message: "down", request_id: "r" },
                  { status: 500 },
                )
              : HttpResponse.json(
                  publishedVersion(String(params.configurationId), Number(params.version)),
                ),
        ),
      );
      renderSetup();

      await scenarioChosen();
      await chooseArm(user, 0, "cfg-atlas");
      await chooseArm(user, 1, "cfg-beacon");

      const matrix = await screen.findByRole("table");
      await waitFor(() =>
        expect(identityCells(matrix)).toEqual(["v1 · 8e9f0a1b", identity, "Difference"]),
      );
      // The cell already reads the whole id, so no tooltip repeats it.
      const row = within(matrix).getByRole("row", { name: /support identity/i });
      expect(within(row).getByText(identity)).not.toHaveAttribute("title");
    });

    it("labels a matrix still judging the last choice with that choice's versions", async () => {
      const user = userEvent.setup();
      // Every preview after the first is held, so the matrix on screen is the last choice's.
      let holding = false;
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let newerRead = () => {};
      const newerAnswered = new Promise<void>((resolve) => {
        newerRead = resolve;
      });
      server.use(
        http.post(`*/api/v1/shops/${SHOP_ID}/experiments/preview`, async () => {
          if (holding) {
            await held;
          }
          return HttpResponse.json({
            ...PREVIEW,
            issues: [],
            comparison: COMPARISON.map((entry) =>
              entry.dimension === "support_identity"
                ? { dimension: "support_identity", values: [identity, identity], differs: true }
                : variable(entry.dimension, [entry.values[0], entry.values[0]]),
            ),
          } satisfies ExperimentPreviewResponse);
        }),
        http.get(
          "*/api/v1/agent-configurations/:configurationId/versions/:version",
          ({ params }) => {
            const beacon = params.configurationId === BEACON_ID;
            const newer = beacon && Number(params.version) === 2;
            if (newer && holding) {
              queueMicrotask(newerRead);
            }
            return HttpResponse.json({
              ...publishedVersion(String(params.configurationId), Number(params.version)),
              // Beacon v1 pins the identity at v2; Beacon v2 pins it at v7.
              support_identity_version: newer ? 7 : beacon ? 2 : 1,
            });
          },
        ),
      );
      renderSetup();

      await scenarioChosen();
      await chooseArm(user, 0, "cfg-atlas");
      await chooseArm(user, 1, "cfg-beacon");
      const matrix = await screen.findByRole("table");
      await waitFor(() =>
        expect(identityCells(matrix)).toEqual(["v1 · 8e9f0a1b", "v2 · 8e9f0a1b", "Difference"]),
      );

      holding = true;
      const armB = screen.getByRole("group", { name: "Arm B" });
      await user.selectOptions(within(armB).getByLabelText("Published version"), "2");
      await newerAnswered;

      // Beacon v2's read has answered while its judgement has not: the matrix on screen is
      // still Beacon v1's, so it never says v7. Beacon v1's own read has been replaced by the
      // newer one, so arm B reads as the identity's id until the new judgement arrives.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(identityCells(matrix)).toEqual(["v1 · 8e9f0a1b", identity, "Difference"]);
      expect(within(matrix).queryByText(/v7/)).toBeNull();

      release();
      await waitFor(() =>
        expect(identityCells(matrix)).toEqual(["v1 · 8e9f0a1b", "v7 · 8e9f0a1b", "Difference"]),
      );
    });
  });

  it("says what a seed is and what it may be, under the field", async () => {
    renderSetup();

    await scenarioChosen();

    const seed = screen.getByLabelText("Seed");
    expect(seed).toHaveAttribute("step", "1");
    expect(seed).toHaveAccessibleDescription(/A whole number between 0 and 4294967295\./);
    expect(seed).toHaveAccessibleDescription(/replays the same run/);
  });

  it("warns that arms differing in more than one dimension measure none of them", async () => {
    const user = userEvent.setup();
    renderSetup();

    await scenarioChosen();
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

    await scenarioChosen();
    await chooseArm(user, 0, "cfg-atlas");
    // The proposed name, typed over with padding: the lab trims a name and refuses what is
    // left. (Emptied, the field hands the proposal back when it is left, so an empty name is
    // never what is sent.)
    await nameAs(user, "   ");
    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expect(startReasons(start)).toEqual([NO_NAME]));
    expectRefused(start, NO_NAME);

    await user.click(start);
    start.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    await submitWithoutPressing(start);
    expect(started).toHaveLength(0);
    expect(startReasons(start)).toEqual([NO_NAME]);
    // And the field stops where the lab would refuse a longer one.
    expect(screen.getByLabelText("Name")).toHaveAttribute("maxlength", "200");
  });

  it("is dashed until it can work, and says everything it still waits for", async () => {
    const user = userEvent.setup();
    const toneError = {
      severity: "error" as const,
      code: "tone_override_unknown_in_shop",
      message:
        "cfg-beacon writes in tone-of-voice guideline 'playful', which this scenario's shop does not publish",
      path: "arms[0].tone_of_voice",
    };
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/preview`, async ({ request }) => {
        const body = (await request.json()) as { arms: { configuration_id: string }[] };
        const beacon = body.arms.some((arm) => arm.configuration_id === BEACON_ID);
        return HttpResponse.json({ ...PREVIEW, issues: beacon ? [toneError] : PREVIEW.issues });
      }),
      // Two published scenarios and three published configurations: choices the lab does not
      // make, so the setup opens with nothing chosen.
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () =>
        HttpResponse.json({ scenarios: [...SCENARIOS.scenarios, OTHER_SCENARIO] }),
      ),
      http.get("*/api/v1/agent-configurations", () =>
        HttpResponse.json({ configurations: [...CONFIGURATIONS.configurations, CANARY] }),
      ),
    );
    renderSetup();

    // Nothing chosen, and a seed the contract would refuse: every reason at once, in the
    // order the form asks for them.
    const seed = await screen.findByLabelText("Seed");
    await screen.findByRole("option", { name: "Wrong shipping address" });
    await user.clear(seed);
    await user.type(seed, "-1");
    const start = screen.getByRole("button", { name: "Start experiment" });
    expect(startReasons(start)).toEqual([NO_SCENARIO, NO_ARM, NO_NAME, SEED_OUT_OF_RANGE]);
    for (const reason of [NO_SCENARIO, NO_ARM, NO_NAME, SEED_OUT_OF_RANGE]) {
      expectRefused(start, reason);
    }

    // The scenario opens on its newest version, and names the experiment.
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Scenario" }),
      "Wrong shipping address",
    );
    await waitFor(() => expect(startReasons(start)).toEqual([NO_ARM, SEED_OUT_OF_RANGE]));

    await user.clear(seed);
    await user.type(seed, "42");
    expect(startReasons(start)).toEqual([NO_ARM]);

    // The configuration opens on its newest version, is judged, and the gate's error is what
    // is left — in its words.
    const arm = screen.getByRole("group", { name: "Arm A" });
    await user.selectOptions(within(arm).getByLabelText("Agent configuration"), "cfg-beacon");
    await waitFor(() => expect(startReasons(start)).toEqual([toneError.message]));
    expectRefused(start, toneError.message);
    await user.click(start);
    expect(started).toHaveLength(0);

    // A warning is not a refusal: the gate's warning stays in the card, and Start is free.
    await user.selectOptions(within(arm).getByLabelText("Agent configuration"), "cfg-atlas");
    await waitFor(() => expectNotRefused(start));
    expect(start).not.toHaveAttribute("title");
    expect(screen.getByText(/differ in 2 dimensions/)).toBeVisible();

    await user.click(start);
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({
      label: "Wrong shipping address — cfg-atlas v2",
      seed: 42,
      arms: [{ configuration_id: ATLAS_ID, version: 2 }],
    });
  });

  it("holds a setup to the gate's answer for it, never to the answer for the one before", async () => {
    const user = userEvent.setup();
    const toneError = {
      severity: "error" as const,
      code: "tone_override_unknown_in_shop",
      message: "cfg-beacon writes in a tone-of-voice guideline this shop does not publish",
      path: "arms[0].tone_of_voice",
    };
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/preview`, async ({ request }) => {
        const body = (await request.json()) as { arms: { version: number }[] };
        if (body.arms[0].version === 1) {
          return HttpResponse.json({ ...PREVIEW, issues: [toneError] });
        }
        await held;
        return HttpResponse.json(PREVIEW);
      }),
    );
    renderSetup();

    await scenarioChosen();
    await nameAs(user, "Tone comparison");
    await chooseArm(user, 0, "cfg-beacon");
    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expect(startReasons(start)).toEqual([toneError.message]));

    // Straight from one whole setup to the next: the gate has not answered for version 2 yet,
    // and its answer for version 1 is not this setup's, so it refuses nothing. Start is a
    // press in flight until the answer arrives.
    const arm = screen.getByRole("group", { name: "Arm A" });
    await user.selectOptions(within(arm).getByLabelText("Published version"), "2");
    expect(startReasons(start)).toEqual([]);
    expectBusy(start);
    await user.click(start);
    expect(started).toHaveLength(0);

    release();
    await waitFor(() => expectNotRefused(start));
  });

  it("judges the setup on the default seed while the typed one is refused, and refuses on it", async () => {
    const user = userEvent.setup();
    const previewed: { seed: unknown }[] = [];
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/preview`, async ({ request }) => {
        previewed.push((await request.json()) as { seed: unknown });
        return HttpResponse.json(PREVIEW);
      }),
    );
    renderSetup();

    const seed = await screen.findByLabelText("Seed");
    await user.clear(seed);
    await user.type(seed, "-1");
    await scenarioChosen();
    await nameAs(user, "Seeded");
    await chooseArm(user, 0, "cfg-atlas");

    // The gate never reads the seed, and the contract would refuse the whole preview for it.
    await waitFor(() => expect(previewed.length).toBeGreaterThan(0));
    expect(previewed.map((body) => body.seed)).toEqual(previewed.map(() => 20260828));
    // Start is held to the seed the operator typed.
    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expect(startReasons(start)).toEqual([SEED_OUT_OF_RANGE]));
  });

  it("says an emptied seed apart from one out of range", async () => {
    const user = userEvent.setup();
    renderSetup();

    const seed = await screen.findByLabelText("Seed");
    await scenarioChosen();
    await chooseArm(user, 0, "cfg-atlas");
    await nameAs(user, "Seeded");
    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expectNotRefused(start));

    await user.clear(seed);
    expect(startReasons(start)).toEqual([NO_SEED]);
    await user.type(seed, "4294967296");
    expect(startReasons(start)).toEqual([SEED_OUT_OF_RANGE]);
    await user.clear(seed);
    await user.type(seed, "4294967295");
    await waitFor(() => expectNotRefused(start));
  });

  it("says a scenario has no published version to run", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/versions`, () =>
        HttpResponse.json({ versions: [] } satisfies ScenarioVersionListResponse),
      ),
    );
    renderSetup();

    await scenarioChosen();
    await nameAs(user, "Unpublished");
    await chooseArm(user, 0, "cfg-atlas");

    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expect(startReasons(start)).toEqual([NO_SCENARIO_VERSION]));
  });

  it("says why the lab refuses to judge the setup, since it would refuse to start it too", async () => {
    const user = userEvent.setup();
    const gone = "agent configuration 1a2b3c4d has no published version 1";
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/preview`, () =>
        HttpResponse.json(
          { code: "agent_configuration_version_not_found", message: gone, request_id: "r" },
          { status: 404 },
        ),
      ),
    );
    renderSetup();

    await scenarioChosen();
    await nameAs(user, "Gone");
    await chooseArm(user, 0, "cfg-atlas");

    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expect(startReasons(start)).toEqual([gone]));
    await user.click(start);
    expect(started).toHaveLength(0);
  });

  it("says a refused preview's reason once, at Start, and not again above the form", async () => {
    const user = userEvent.setup();
    const gone = "agent configuration 1a2b3c4d has no published version 1";
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/preview`, () =>
        HttpResponse.json(
          { code: "agent_configuration_version_not_found", message: gone, request_id: "r" },
          { status: 404 },
        ),
      ),
    );
    renderSetup();

    await scenarioChosen();
    await nameAs(user, "Gone");
    await chooseArm(user, 0, "cfg-atlas");

    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expect(startReasons(start)).toEqual([gone]));
    expect(screen.getAllByText(gone)).toHaveLength(1);
    expect(screen.queryAllByRole("alert").map((alert) => alert.textContent)).not.toContain(gone);
  });

  it("says above the form that a preview failed on the lab's side, until one answers", async () => {
    const user = userEvent.setup();
    const failed = "The lab could not complete it.";
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/preview`, async ({ request }) => {
        const body = (await request.json()) as { arms: { version: number }[] };
        if (body.arms[0].version === 1) {
          return HttpResponse.json(
            { code: "internal_error", message: failed, request_id: "r" },
            { status: 500 },
          );
        }
        return HttpResponse.json(PREVIEW);
      }),
    );
    renderSetup();

    await scenarioChosen();
    await nameAs(user, "Unjudged");
    await chooseArm(user, 0, "cfg-atlas");

    await waitFor(() =>
      expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toContain(failed),
    );
    // Free once the arm's own read has answered: until then Start waits on it (ADR 0063).
    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expectNotRefused(start));

    const arm = screen.getByRole("group", { name: "Arm A" });
    await user.selectOptions(within(arm).getByLabelText("Published version"), "2");
    await waitFor(() => expect(screen.queryByText(failed)).not.toBeInTheDocument());
  });

  it.each([
    [408, "request_timeout", "The request timed out."],
    [429, "rate_limited", "Too many requests; try again shortly."],
  ])(
    "says a %i preview above the form like a lab-side failure, not as a refusal at Start",
    async (status, code, message) => {
      // A timeout and a rate limit are 4xx, but neither is the lab refusing the setup: the
      // same setup asked again may be judged.
      const user = userEvent.setup();
      server.use(
        http.post(`*/api/v1/shops/${SHOP_ID}/experiments/preview`, async ({ request }) => {
          const body = (await request.json()) as { arms: { version: number }[] };
          if (body.arms[0].version === 1) {
            return HttpResponse.json({ code, message, request_id: "r" }, { status });
          }
          return HttpResponse.json(PREVIEW);
        }),
      );
      renderSetup();

      await scenarioChosen();
      await nameAs(user, "Unjudged");
      await chooseArm(user, 0, "cfg-atlas");

      await waitFor(() =>
        expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toContain(message),
      );
      const start = screen.getByRole("button", { name: "Start experiment" });
      // Free once the arm's own read has answered: until then Start waits on it (ADR 0063).
      await waitFor(() => expectNotRefused(start));

      const arm = screen.getByRole("group", { name: "Arm A" });
      await user.selectOptions(within(arm).getByLabelText("Published version"), "2");
      await waitFor(() => expect(screen.queryByText(message)).not.toBeInTheDocument());
    },
  );

  it("refuses nothing for a preview it could not reach, and leaves the start to answer", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/preview`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "The lab could not complete it.", request_id: "r" },
          { status: 500 },
        ),
      ),
    );
    renderSetup();

    await scenarioChosen();
    await nameAs(user, "Unjudged");
    await chooseArm(user, 0, "cfg-atlas");

    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expectNotRefused(start));
    await user.click(start);
    await waitFor(() => expect(started).toHaveLength(1));
  });

  it("takes back what a refused preview said once a later preview answers", async () => {
    const user = userEvent.setup();
    const gone = "agent configuration 1a2b3c4d has no published version 1";
    let answered = 0;
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/preview`, async ({ request }) => {
        const body = (await request.json()) as { arms: { version: number }[] };
        if (body.arms[0].version === 1) {
          return HttpResponse.json(
            { code: "agent_configuration_version_not_found", message: gone, request_id: "r" },
            { status: 404 },
          );
        }
        answered += 1;
        return HttpResponse.json(PREVIEW);
      }),
    );
    renderSetup();

    await scenarioChosen();
    await nameAs(user, "Gone");
    await chooseArm(user, 0, "cfg-atlas");
    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expect(startReasons(start)).toEqual([gone]));

    const arm = screen.getByRole("group", { name: "Arm A" });
    await user.selectOptions(within(arm).getByLabelText("Published version"), "2");
    await waitFor(() => expect(answered).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByText(gone)).not.toBeInTheDocument());
    // Free once version 2's own read has answered: until then Start waits on it (ADR 0063).
    await waitFor(() => expectNotRefused(start));
  });

  it("leaves an error the preview did not raise to what raised it", async () => {
    const user = userEvent.setup();
    startFails = true;
    let answered = 0;
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/preview`, () => {
        answered += 1;
        return HttpResponse.json(PREVIEW);
      }),
    );
    renderSetup();

    await scenarioChosen();
    await chooseArm(user, 0, "cfg-atlas");
    await nameAs(user, "Prompt comparison");
    // A press while Start waits on the arm's read is swallowed, so it is pressed once free.
    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expectNotRefused(start));
    await user.click(start);
    const refused = "this experiment cannot be started";
    await waitFor(() =>
      expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toContain(refused),
    );

    const before = answered;
    const arm = screen.getByRole("group", { name: "Arm A" });
    await user.selectOptions(within(arm).getByLabelText("Published version"), "2");
    await waitFor(() => expect(answered).toBeGreaterThan(before));
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toContain(refused);
  });

  it("starts the experiment against the exact versions chosen and opens the bench", async () => {
    const user = userEvent.setup();
    renderSetup();

    await scenarioChosen();
    await chooseArm(user, 0, "cfg-atlas");
    await nameAs(user, "Prompt comparison");
    // Pressed once it can work: a press while a read is out is swallowed, as busy is.
    await reachabilityRead();
    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expectNotRefused(start));
    await user.click(start);

    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({
      label: "Prompt comparison",
      scenario_id: SCENARIO_ID,
      scenario_version: 1,
      participant_driver: "human",
      // Arm A as chosen; arm B as the setup opened it, on cfg-beacon's newest version.
      arms: [
        { configuration_id: ATLAS_ID, version: 1 },
        { configuration_id: BEACON_ID, version: 2 },
      ],
    });
    expect(
      await screen.findByRole("heading", { name: "Wrong address — framework comparison" }),
    ).toBeVisible();
  });

  it("surfaces a refused start with the finding that explains it", async () => {
    const user = userEvent.setup();
    startFails = true;
    renderSetup();

    await scenarioChosen();
    await chooseArm(user, 0, "cfg-atlas");
    await nameAs(user, "Prompt comparison");
    // Pressed once it can work: a press while a read is out is swallowed, as busy is.
    await reachabilityRead();
    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expectNotRefused(start));
    await user.click(start);

    expect(
      await screen.findByText(/tone-of-voice guideline this shop does not publish/),
    ).toBeVisible();
    // The setup is still on screen: a refusal must not discard what the operator chose.
    expect(screen.getByRole("button", { name: "Start experiment" })).toBeVisible();
  });
});

/**
 * What the setup has already chosen when it opens, and what it never chooses (ADR 0064).
 */
describe("experiment setup's defaults", () => {
  function row(name: string) {
    return screen.getByRole("group", { name });
  }

  it("opens on one published scenario and two published configurations at their newest, named, with only Start left", async () => {
    const user = userEvent.setup();
    renderSetup();

    // The scenario: the only published one, at its newest version, and what it resolves against.
    await scenarioChosen();
    const scenarioRow = row("Scenario");
    await waitFor(() =>
      expect(within(scenarioRow).getByRole("combobox", { name: "Published version" })).toHaveValue(
        "1",
      ),
    );
    await waitFor(() =>
      expect(scenarioRow).toHaveAccessibleDescription(
        /This one is the only published scenario in the shop, so it is already chosen\./,
      ),
    );
    expect(
      await within(scenarioRow).findByText(
        "Resolves against shop v3, ticket T-204 v1, customer Maya Laurent v2.",
      ),
    ).toBeVisible();

    // The two published configurations are the two arms, each at its newest version.
    const armA = row("Arm A");
    const armB = row("Arm B");
    expect(within(armA).getByRole("combobox", { name: "Agent configuration" })).toHaveValue(
      ATLAS_ID,
    );
    expect(within(armB).getByRole("combobox", { name: "Agent configuration" })).toHaveValue(
      BEACON_ID,
    );
    await waitFor(() => {
      expect(within(armA).getByRole("combobox", { name: "Published version" })).toHaveValue("2");
      expect(within(armB).getByRole("combobox", { name: "Published version" })).toHaveValue("2");
    });
    expect(within(armA).getByRole("option", { name: "v2 (newest published)" })).toBeInTheDocument();
    await waitFor(() =>
      expect(armB).toHaveAccessibleDescription(
        /These two are the only published agent configurations in the lab, so both arms are already chosen\./,
      ),
    );

    // A name proposed from them.
    expect(screen.getByLabelText("Name")).toHaveValue(
      "Wrong shipping address — cfg-atlas v2 vs cfg-beacon v2",
    );
    // A display name, not an identifier: it is not read back as "Saved as …".
    expect(screen.queryByText(/Saved as/)).toBeNull();

    // And Start is free once the gate has answered: nothing is left but pressing it.
    const start = screen.getByRole("button", { name: "Start experiment" });
    await reachabilityRead();
    await waitFor(() => expectNotRefused(start));
    expect(startReasons(start)).toEqual([]);
    await user.click(start);
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({
      label: "Wrong shipping address — cfg-atlas v2 vs cfg-beacon v2",
      scenario_id: SCENARIO_ID,
      scenario_version: 1,
      arms: [
        { configuration_id: ATLAS_ID, version: 2 },
        { configuration_id: BEACON_ID, version: 2 },
      ],
    });
  });

  it("asks in the prototype's order: scenario, arm A, arm B, name, seed", async () => {
    renderSetup();
    await scenarioChosen();

    const setup = screen.getByRole("region", { name: "Experiment setup" });
    const rows = Array.from(setup.querySelectorAll<HTMLElement>("fieldset, label"), (element) =>
      element.tagName === "FIELDSET"
        ? (element.getAttribute("aria-labelledby") ?? "")
            .split(" ")
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join("")
        : (element.textContent ?? ""),
    );
    expect(rows).toEqual(["Scenario", "Arm A", "Arm B", "Name", "Seed"]);
    // The seed with its meaning.
    expect(screen.getByLabelText("Seed")).toHaveAccessibleDescription(
      /The same seed over the same starting state replays the same run\./,
    );
  });

  it("counts only a scenario that could run as a candidate", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () =>
        HttpResponse.json({
          scenarios: [
            { ...OTHER_SCENARIO, latest_published_version: null, published_version_count: 0 },
            ...SCENARIOS.scenarios,
          ],
        }),
      ),
    );
    renderSetup();

    // An unpublished scenario is offered as unavailable, and is not a second candidate.
    await scenarioChosen();
    expect(screen.getByRole("option", { name: "Damaged on arrival (unpublished)" })).toBeDisabled();
    await waitFor(() =>
      expect(row("Scenario")).toHaveAccessibleDescription(/so it is already chosen/),
    );
  });

  it("chooses nothing where there is a choice to make", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () =>
        HttpResponse.json({ scenarios: [...SCENARIOS.scenarios, OTHER_SCENARIO] }),
      ),
      http.get("*/api/v1/agent-configurations", () =>
        HttpResponse.json({ configurations: [...CONFIGURATIONS.configurations, CANARY] }),
      ),
    );
    renderSetup();

    await screen.findAllByRole("option", { name: "cfg-canary" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByRole("combobox", { name: "Scenario" })).toHaveValue("");
    expect(row("Scenario")).not.toHaveAccessibleDescription(/already chosen/);
    for (const name of ["Arm A", "Arm B"]) {
      expect(within(row(name)).getByRole("combobox", { name: "Agent configuration" })).toHaveValue(
        "",
      );
      expect(row(name)).not.toHaveAccessibleDescription(/already chosen/);
    }
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("opens arm A on the one published configuration and leaves arm B empty", async () => {
    server.use(
      http.get("*/api/v1/agent-configurations", () =>
        HttpResponse.json({
          configurations: CONFIGURATIONS.configurations.filter(
            (entry) => entry.configuration_id !== BEACON_ID,
          ),
        }),
      ),
    );
    renderSetup();

    await scenarioChosen();
    const armA = row("Arm A");
    await waitFor(() =>
      expect(within(armA).getByRole("combobox", { name: "Published version" })).toHaveValue("2"),
    );
    expect(within(armA).getByRole("combobox", { name: "Agent configuration" })).toHaveValue(
      ATLAS_ID,
    );
    await waitFor(() =>
      expect(armA).toHaveAccessibleDescription(
        /This one is the only published agent configuration in the lab, so it is already chosen\./,
      ),
    );
    // Two arms running one configuration compare nothing, so arm B is left for the operator.
    expect(within(row("Arm B")).getByRole("combobox", { name: "Agent configuration" })).toHaveValue(
      "",
    );
    // The scenario's part is in the proposal once its version has answered with its name.
    await waitFor(() =>
      expect(screen.getByLabelText("Name")).toHaveValue("Wrong shipping address — cfg-atlas v2"),
    );
  });

  it("follows the arms with the proposed name until the operator types one", async () => {
    const user = userEvent.setup();
    renderSetup();

    await scenarioChosen();
    const name = screen.getByLabelText("Name");
    await waitFor(() =>
      expect(name).toHaveValue("Wrong shipping address — cfg-atlas v2 vs cfg-beacon v2"),
    );
    await user.selectOptions(
      within(row("Arm B")).getByRole("combobox", { name: "Agent configuration" }),
      "No second arm",
    );
    expect(name).toHaveValue("Wrong shipping address — cfg-atlas v2");

    await nameAs(user, "Mine");
    await user.selectOptions(
      within(row("Arm A")).getByRole("combobox", { name: "Published version" }),
      "1",
    );
    expect(name).toHaveValue("Mine");

    // Emptied and left, it is handed the proposal back, which it then follows again.
    await user.clear(name);
    await user.tab();
    // Each arm's name comes from its pinned version's read, so the proposal follows it there.
    await waitFor(() => expect(name).toHaveValue("Wrong shipping address — cfg-atlas v1"));
    await user.selectOptions(
      within(row("Arm A")).getByRole("combobox", { name: "Published version" }),
      "2",
    );
    await waitFor(() => expect(name).toHaveValue("Wrong shipping address — cfg-atlas v2"));
  });

  it("opens an arm on the newest version of a configuration whose versions are already read", async () => {
    const user = userEvent.setup();
    renderSetup();

    await scenarioChosen();
    const armA = row("Arm A");
    const version = within(armA).getByRole("combobox", { name: "Published version" });
    await waitFor(() => expect(version).toHaveValue("2"));
    await user.selectOptions(version, "1");
    // cfg-beacon's versions were read for arm B; arm A moved onto it opens on its newest at
    // once, rather than on an operator's choice it no longer holds or on nothing.
    await user.selectOptions(
      within(armA).getByRole("combobox", { name: "Agent configuration" }),
      "cfg-beacon",
    );
    expect(version).toHaveValue("2");
    const start = screen.getByRole("button", { name: "Start experiment" });
    await reachabilityRead();
    await waitFor(() => expectNotRefused(start));
  });

  it("asks the gate nothing again when a list answers that no arm waits on", async () => {
    const user = userEvent.setup();
    let previews = 0;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`*/api/v1/agent-configurations/${BEACON_ID}/versions`, async () => {
        await held;
        return HttpResponse.json(CONFIGURATION_VERSIONS);
      }),
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/preview`, () => {
        previews += 1;
        return HttpResponse.json(PREVIEW);
      }),
    );
    renderSetup();

    await scenarioChosen();
    // Arm B waits on cfg-beacon's list; the operator empties it before the list answers.
    await user.selectOptions(
      within(row("Arm B")).getByRole("combobox", { name: "Agent configuration" }),
      "No second arm",
    );
    const start = screen.getByRole("button", { name: "Start experiment" });
    await reachabilityRead();
    await waitFor(() => expectNotRefused(start));
    const asked = previews;

    release();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(previews).toBe(asked);
    expectNotRefused(start);
    expect(start).not.toBeDisabled();
  });

  it("says nothing about a scenario it has moved off, even when its last read fails late", async () => {
    const user = userEvent.setup();
    let ticketAsked = false;
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () =>
        HttpResponse.json({ scenarios: [...SCENARIOS.scenarios, OTHER_SCENARIO] }),
      ),
      // The first scenario's ticket read never answers; it fails when the page abandons it.
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets/${TICKET_ID}/versions/:version`, async () => {
        ticketAsked = true;
        await new Promise(() => {});
        return HttpResponse.json({});
      }),
      // And the next scenario's versions are still being read.
      http.get(
        `*/api/v1/shops/${SHOP_ID}/scenarios/${OTHER_SCENARIO.scenario_id}/versions`,
        async () => {
          await new Promise(() => {});
          return HttpResponse.json({ versions: [] });
        },
      ),
    );
    renderSetup();

    const scenario = await screen.findByRole("combobox", { name: "Scenario" });
    await screen.findByRole("option", { name: "Damaged on arrival" });
    await user.selectOptions(scenario, "Wrong shipping address");
    await waitFor(() => expect(ticketAsked).toBe(true));

    await user.selectOptions(scenario, "Damaged on arrival");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(within(row("Scenario")).queryByText(/Resolves against/)).toBeNull();
  });

  it("gives a list that answers late only to the arm still waiting on it", async () => {
    const user = userEvent.setup();
    const releases: Record<string, () => void> = {};
    const held = (configurationId: string, versions: number[]) =>
      http.get(`*/api/v1/agent-configurations/${configurationId}/versions`, async () => {
        await new Promise<void>((resolve) => {
          releases[configurationId] = resolve;
        });
        return HttpResponse.json({
          versions: versions.map((version) => ({
            version,
            content_fingerprint: "a".repeat(64),
            published_at: "2026-09-02T08:00:00+00:00",
          })),
        });
      });
    server.use(
      // Three published configurations, so the arms open empty and are chosen by hand.
      http.get("*/api/v1/agent-configurations", () =>
        HttpResponse.json({ configurations: [...CONFIGURATIONS.configurations, CANARY] }),
      ),
      held(ATLAS_ID, [1, 2, 3]),
      held(CANARY.configuration_id, [1]),
    );
    renderSetup();

    await scenarioChosen();
    const armA = row("Arm A");
    const configuration = within(armA).getByRole("combobox", { name: "Agent configuration" });
    const version = within(armA).getByRole("combobox", { name: "Published version" });
    // Arm A waits on cfg-atlas's list; the operator moves it to cfg-canary before it answers.
    await user.selectOptions(configuration, "cfg-atlas");
    await waitFor(() => expect(releases[ATLAS_ID]).toBeDefined());
    await user.selectOptions(configuration, "cfg-canary");
    await waitFor(() => expect(releases[CANARY.configuration_id]).toBeDefined());

    // cfg-atlas's list arrives now, and is nobody's answer any more.
    releases[ATLAS_ID]();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(version).toHaveValue("");
    expect(version).toHaveDisplayValue("Reading published versions…");

    // cfg-canary's is arm A's.
    releases[CANARY.configuration_id]();
    await waitFor(() => expect(version).toHaveValue("1"));
  });

  it("clears the scenario version on a switch, and opens on the new scenario's newest", async () => {
    const user = userEvent.setup();
    const previewed: { scenario_id: string; scenario_version: number }[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () =>
        HttpResponse.json({ scenarios: [...SCENARIOS.scenarios, OTHER_SCENARIO] }),
      ),
      http.get(
        `*/api/v1/shops/${SHOP_ID}/scenarios/${OTHER_SCENARIO.scenario_id}/versions`,
        async () => {
          await held;
          return HttpResponse.json({
            versions: [4, 5].map((version) => ({
              version,
              content_fingerprint: "d".repeat(64),
              published_at: "2026-09-01T09:05:00+00:00",
            })),
          } satisfies ScenarioVersionListResponse);
        },
      ),
      http.get(
        `*/api/v1/shops/${SHOP_ID}/scenarios/${OTHER_SCENARIO.scenario_id}/versions/:version`,
        () =>
          HttpResponse.json({
            ...scenarioVersion(5, OTHER_SCENARIO.name),
            scenario_id: OTHER_SCENARIO.scenario_id,
          }),
      ),
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/preview`, async ({ request }) => {
        previewed.push((await request.json()) as (typeof previewed)[number]);
        return HttpResponse.json(PREVIEW);
      }),
    );
    renderSetup();

    const scenario = await screen.findByRole("combobox", { name: "Scenario" });
    await screen.findByRole("option", { name: "Damaged on arrival" });
    await user.selectOptions(scenario, "Wrong shipping address");
    await waitFor(() =>
      expect(previewed.some((body) => body.scenario_id === SCENARIO_ID)).toBe(true),
    );
    // Both arms' reads have answered, so they are named whatever the scenario does next.
    await waitFor(() =>
      expect(screen.getByLabelText("Name")).toHaveValue(
        "Wrong shipping address — cfg-atlas v2 vs cfg-beacon v2",
      ),
    );

    await user.selectOptions(scenario, "Damaged on arrival");
    const version = within(row("Scenario")).getByRole("combobox", { name: "Published version" });
    expect(version).toHaveValue("");
    expect(version).toHaveDisplayValue("Reading published versions…");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // No (new scenario, old version) pair was ever put to the gate.
    expect(previewed.filter((body) => body.scenario_id === OTHER_SCENARIO.scenario_id)).toEqual([]);
    // Nor refused for it: the version is being read, which is a wait.
    const start = screen.getByRole("button", { name: "Start experiment" });
    expect(startReasons(start)).toEqual([]);
    expectBusy(start);

    release();
    await waitFor(() => expect(version).toHaveValue("5"));
    await waitFor(() =>
      expect(
        previewed
          .filter((body) => body.scenario_id === OTHER_SCENARIO.scenario_id)
          .map((body) => body.scenario_version),
      ).toEqual([5]),
    );
  });

  it("refuses an arm whose version could not be read, by its letter, and never runs without it", async () => {
    const previewed: { arms: unknown[] }[] = [];
    server.use(
      http.get(`*/api/v1/agent-configurations/${BEACON_ID}/versions`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "The lab could not complete it.", request_id: "r" },
          { status: 500 },
        ),
      ),
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/preview`, async ({ request }) => {
        previewed.push((await request.json()) as { arms: unknown[] });
        return HttpResponse.json(PREVIEW);
      }),
    );
    renderSetup();

    await scenarioChosen();
    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expect(startReasons(start)).toEqual([noArmVersion(1)]));
    expectRefused(start, noArmVersion(1));
    expect(
      within(row("Arm B")).getByRole("combobox", { name: "Published version" }),
    ).toHaveDisplayValue("No published version");
    // Arm A alone was never put to the gate as though it were the whole experiment.
    expect(previewed).toEqual([]);
  });
});

/**
 * *Resolves against* names every pinned version as it was published, never as the listing
 * names it today (ADR 0064's amendment): a rename after publishing moves the listing, and a
 * pinned version never had the new name.
 */
describe("what the experiment setup resolves against", () => {
  function scenarioRow() {
    return screen.getByRole("group", { name: "Scenario" });
  }

  /** A read that answers only once released, recording that it was asked. */
  function holdable() {
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const asked = { count: 0 };
    return { release, released, asked };
  }

  function nameValue(): string {
    return (screen.getByLabelText("Name") as HTMLInputElement).value;
  }

  const NOW = 30;
  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, NOW));
    });
  }

  it("names the ticket, the customer and the scenario as their pinned versions were published, after all three were renamed", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () =>
        HttpResponse.json({
          scenarios: [
            {
              ...SCENARIOS.scenarios[0],
              name: "Wrong address, reworded",
              ticket_reference: "T-999",
              ticket_subject: "Address concern, reworded",
              customer_display_name: "Maya Dupont",
            },
          ],
        } satisfies ScenarioListResponse),
      ),
    );
    renderSetup();

    await scenarioChosen();
    expect(
      await within(scenarioRow()).findByText(
        "Resolves against shop v3, ticket T-204 v1, customer Maya Laurent v2.",
      ),
    ).toBeVisible();
    expect(within(scenarioRow()).queryByText(/T-999|Maya Dupont/)).toBeNull();
    // The select names the scenario as it is today, since it picks the record; the proposal
    // names the version it runs, as that version was published.
    expect(
      within(scenarioRow()).getByRole("option", { name: "Wrong address, reworded" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Name")).toHaveValue(
        "Wrong shipping address — cfg-atlas v2 vs cfg-beacon v2",
      ),
    );
  });

  it("keeps Start waiting until the scenario version's own name has answered, even once the gate has", async () => {
    const scenarioRead = holdable();
    let judgedCount = 0;
    server.use(
      http.get(
        `*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/versions/:version`,
        async ({ params }) => {
          scenarioRead.asked.count += 1;
          await scenarioRead.released;
          return HttpResponse.json(scenarioVersion(Number(params.version)));
        },
      ),
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/preview`, () => {
        judgedCount += 1;
        return HttpResponse.json(PREVIEW);
      }),
    );
    renderSetup();

    await scenarioChosen();
    await waitFor(() => expect(scenarioRead.asked.count).toBe(1));
    await waitFor(() => expect(judgedCount).toBeGreaterThanOrEqual(1));
    await reachabilityRead();
    // Both arms are named once both arms' reads have answered, not when they were asked.
    await waitFor(() => expect(nameValue()).toBe("cfg-atlas v2 vs cfg-beacon v2"));
    await settle();
    // The gate has answered and the arms are read: only the scenario's name is outstanding,
    // and a run started now would be named without it. A wait, never a refusal (ADR 0063).
    const start = screen.getByRole("button", { name: "Start experiment" });
    expect(nameValue()).toBe("cfg-atlas v2 vs cfg-beacon v2");
    expect(startReasons(start)).toEqual([]);
    expectBusy(start);

    scenarioRead.release();
    await waitFor(() => expectNotRefused(start));
    await waitFor(() =>
      expect(nameValue()).toBe("Wrong shipping address — cfg-atlas v2 vs cfg-beacon v2"),
    );
  });

  /** Every pinned-version read the proposal is made from, held until released. */
  function holdEveryProposalRead() {
    const scenarioRead = holdable();
    const armRead = holdable();
    server.use(
      http.get(
        `*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/versions/:version`,
        async ({ params }) => {
          scenarioRead.asked.count += 1;
          await scenarioRead.released;
          return HttpResponse.json(scenarioVersion(Number(params.version)));
        },
      ),
      http.get(
        "*/api/v1/agent-configurations/:configurationId/versions/:version",
        async ({ params }) => {
          versionReads += 1;
          armRead.asked.count += 1;
          await armRead.released;
          return HttpResponse.json(
            publishedVersion(String(params.configurationId), Number(params.version)),
          );
        },
      ),
    );
    return { scenarioRead, armRead };
  }

  it("waits for the name while every read it is proposed from is out, and never refuses for it", async () => {
    const { scenarioRead, armRead } = holdEveryProposalRead();
    renderSetup();

    await scenarioChosen();
    await waitFor(() => {
      expect(scenarioRead.asked.count).toBe(1);
      expect(armRead.asked.count).toBe(2);
    });
    await settle();
    // Nothing is proposed yet, and the operator has not named the run: a wait (ADR 0063).
    expect(nameValue()).toBe("");
    const start = screen.getByRole("button", { name: "Start experiment" });
    expect(startReasons(start)).toEqual([]);
    expect(screen.queryByText(NO_NAME)).toBeNull();
    expectBusy(start);

    scenarioRead.release();
    armRead.release();
    await waitFor(() =>
      expect(nameValue()).toBe("Wrong shipping address — cfg-atlas v2 vs cfg-beacon v2"),
    );
    await reachabilityRead();
    await waitFor(() => expectNotRefused(start));
  });

  it("keeps what the operator types into the name they emptied while its proposal was still coming", async () => {
    const user = userEvent.setup();
    const { scenarioRead, armRead } = holdEveryProposalRead();
    renderSetup();

    await scenarioChosen();
    await waitFor(() => expect(armRead.asked.count).toBe(2));
    armRead.release();
    await waitFor(() => expect(nameValue()).toBe("cfg-atlas v2 vs cfg-beacon v2"));
    const field = screen.getByLabelText("Name");
    await user.clear(field);
    // The scenario's name answers while the operator is in the field they emptied.
    scenarioRead.release();
    expect(
      await within(scenarioRow()).findByText(
        "Resolves against shop v3, ticket T-204 v1, customer Maya Laurent v2.",
      ),
    ).toBeVisible();
    await settle();
    expect(nameValue()).toBe("");
    await user.type(field, "Prompt comparison");
    expect(nameValue()).toBe("Prompt comparison");

    await reachabilityRead();
    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expectNotRefused(start));
    await user.click(start);
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({ label: "Prompt comparison" });
  });

  it("keeps what the operator types into an empty name they stepped into before anything was proposed", async () => {
    const user = userEvent.setup();
    const { scenarioRead, armRead } = holdEveryProposalRead();
    renderSetup();

    await scenarioChosen();
    await waitFor(() => expect(armRead.asked.count).toBe(2));
    expect(nameValue()).toBe("");
    await user.click(screen.getByLabelText("Name"));
    scenarioRead.release();
    armRead.release();
    expect(
      await within(scenarioRow()).findByText(
        "Resolves against shop v3, ticket T-204 v1, customer Maya Laurent v2.",
      ),
    ).toBeVisible();
    await reachabilityRead();
    await settle();
    expect(nameValue()).toBe("");
    await user.type(screen.getByLabelText("Name"), "Prompt comparison");
    expect(nameValue()).toBe("Prompt comparison");
  });

  it("starts under the proposal on screen when Start is pressed the moment the last read answers", async () => {
    const scenarioRead = holdable();
    server.use(
      http.get(
        `*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/versions/:version`,
        async ({ params }) => {
          scenarioRead.asked.count += 1;
          await scenarioRead.released;
          return HttpResponse.json(scenarioVersion(Number(params.version)));
        },
      ),
    );
    renderSetup();

    await scenarioChosen();
    await waitFor(() => expect(scenarioRead.asked.count).toBe(1));
    await reachabilityRead();
    await waitFor(() => expect(nameValue()).toBe("cfg-atlas v2 vs cfg-beacon v2"));
    await settle();
    const start = screen.getByRole("button", { name: "Start experiment" });
    expectBusy(start);

    // Pressed in the very commit that frees Start — before any effect of that commit has run,
    // which is where a name copied into the field a commit late would still be the last one.
    const pressed = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (!start.hasAttribute("aria-disabled")) {
          observer.disconnect();
          start.click();
          resolve();
        }
      });
      observer.observe(start, { attributes: true, attributeFilter: ["aria-disabled"] });
    });
    scenarioRead.release();
    await waitFor(() => expect(started).toHaveLength(1));
    await pressed;
    expect(started[0]).toMatchObject({
      label: "Wrong shipping address — cfg-atlas v2 vs cfg-beacon v2",
    });
  });

  it("names each arm as its pinned version was published, after the configuration was renamed", async () => {
    server.use(
      http.get("*/api/v1/agent-configurations", () =>
        HttpResponse.json({
          configurations: CONFIGURATIONS.configurations.map((entry) =>
            entry.configuration_id === ATLAS_ID ? { ...entry, name: "cfg-atlas-renamed" } : entry,
          ),
        } satisfies AgentConfigurationListResponse),
      ),
    );
    renderSetup();

    await scenarioChosen();
    const armA = screen.getByRole("group", { name: "Arm A" });
    // The select picks the record, so it names it as the lab does today.
    await waitFor(() =>
      expect(within(armA).getByRole("combobox", { name: "Agent configuration" })).toHaveValue(
        ATLAS_ID,
      ),
    );
    expect(within(armA).getByRole("option", { name: "cfg-atlas-renamed" })).toBeInTheDocument();
    // The proposal names the version the arm runs, under the name it was published with.
    await waitFor(() =>
      expect(nameValue()).toBe("Wrong shipping address — cfg-atlas v2 vs cfg-beacon v2"),
    );
    await settle();
    expect(nameValue()).not.toMatch(/renamed/);
  });

  it("says nothing while the pinned versions are being read, and today's names never", async () => {
    const customer = holdable();
    server.use(
      http.get(`*/api/v1/customer-profiles/${PROFILE_ID}/versions/:version`, async ({ params }) => {
        customer.asked.count += 1;
        await customer.released;
        return HttpResponse.json(customerVersion(Number(params.version)));
      }),
    );
    renderSetup();

    await scenarioChosen();
    await waitFor(() => expect(customer.asked.count).toBe(1));
    await settle();
    expect(within(scenarioRow()).queryByText(/Resolves against/)).toBeNull();
    expect(within(scenarioRow()).queryByText(/T-204|Maya Laurent/)).toBeNull();

    customer.release();
    expect(
      await within(scenarioRow()).findByText(
        "Resolves against shop v3, ticket T-204 v1, customer Maya Laurent v2.",
      ),
    ).toBeVisible();
  });

  it("stops before the customer when the customer version cannot be read", async () => {
    server.use(
      http.get(`*/api/v1/customer-profiles/${PROFILE_ID}/versions/:version`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "The lab could not complete it.", request_id: "r" },
          { status: 500 },
        ),
      ),
    );
    renderSetup();

    await scenarioChosen();
    expect(
      await within(scenarioRow()).findByText("Resolves against shop v3, ticket T-204 v1."),
    ).toBeVisible();
    expect(within(scenarioRow()).queryByText(/customer/)).toBeNull();
  });

  it("says nothing when the ticket version cannot be read, and still proposes the pinned scenario's name", async () => {
    server.use(
      // Renamed since publishing, so only the pinned name can be the proposal's.
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () =>
        HttpResponse.json({
          scenarios: [{ ...SCENARIOS.scenarios[0], name: "Wrong address, reworded" }],
        } satisfies ScenarioListResponse),
      ),
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets/${TICKET_ID}/versions/:version`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "The lab could not complete it.", request_id: "r" },
          { status: 500 },
        ),
      ),
    );
    renderSetup();

    await scenarioChosen();
    await waitFor(() =>
      expect(screen.getByLabelText("Name")).toHaveValue(
        "Wrong shipping address — cfg-atlas v2 vs cfg-beacon v2",
      ),
    );
    await settle();
    expect(within(scenarioRow()).queryByText(/Resolves against/)).toBeNull();
  });

  it("leaves the scenario out of the proposal when its version cannot be read, and holds Start up no longer", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/versions/:version`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "The lab could not complete it.", request_id: "r" },
          { status: 500 },
        ),
      ),
    );
    renderSetup();

    await scenarioChosen();
    await waitFor(() =>
      expect(screen.getByLabelText("Name")).toHaveValue("cfg-atlas v2 vs cfg-beacon v2"),
    );
    await settle();
    expect(within(scenarioRow()).queryByText(/Resolves against/)).toBeNull();
    expect(nameValue()).not.toMatch(/Wrong shipping address/);

    // The failure is an answer: once the run is named, nothing is left to wait on.
    await nameAs(user, "Named by hand");
    await reachabilityRead();
    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expectNotRefused(start));
    expect(startReasons(start)).toEqual([]);
  });

  it("proposes no name when an arm's pinned version cannot be read, rather than a run with one arm fewer", async () => {
    server.use(
      http.get(`*/api/v1/agent-configurations/${ATLAS_ID}/versions/:version`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "The lab could not complete it.", request_id: "r" },
          { status: 500 },
        ),
      ),
    );
    renderSetup();

    await scenarioChosen();
    await waitFor(() =>
      expect(
        within(screen.getByRole("group", { name: "Arm B" })).getByRole("combobox", {
          name: "Published version",
        }),
      ).toHaveValue("2"),
    );
    await reachabilityRead();
    await settle();
    // Both arms run; "Wrong shipping address — cfg-beacon v2" would say one does.
    expect(nameValue()).toBe("");
    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expect(startReasons(start)).toEqual([NO_NAME]));
    expectRefused(start, NO_NAME);
  });

  it("asks for a name as soon as one arm's pinned version cannot be read, while the other's still is", async () => {
    const beacon = holdable();
    server.use(
      http.get(
        "*/api/v1/agent-configurations/:configurationId/versions/:version",
        async ({ params }) => {
          versionReads += 1;
          const configurationId = String(params.configurationId);
          if (configurationId === ATLAS_ID) {
            return HttpResponse.json(
              {
                code: "internal_error",
                message: "The lab could not complete it.",
                request_id: "r",
              },
              { status: 500 },
            );
          }
          beacon.asked.count += 1;
          await beacon.released;
          return HttpResponse.json(publishedVersion(configurationId, Number(params.version)));
        },
      ),
    );
    renderSetup();

    await scenarioChosen();
    await waitFor(() => expect(beacon.asked.count).toBe(1));
    // No proposal can come of it whatever arm B's read says: the name is missing, not coming.
    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expect(startReasons(start)).toEqual([NO_NAME]));
    expectRefused(start, NO_NAME);
    beacon.release();
  });

  it("never names an arm by the version it has moved off while the new one is read", async () => {
    const user = userEvent.setup();
    const older = holdable();
    server.use(
      // cfg-atlas v1 was published as cfg-atlas-old, and is still being read when chosen.
      http.get(
        "*/api/v1/agent-configurations/:configurationId/versions/:version",
        async ({ params }) => {
          versionReads += 1;
          const configurationId = String(params.configurationId);
          const version = Number(params.version);
          const published = publishedVersion(configurationId, version);
          if (configurationId !== ATLAS_ID || version !== 1) {
            return HttpResponse.json(published);
          }
          older.asked.count += 1;
          await older.released;
          return HttpResponse.json({
            ...published,
            content: { ...published.content, name: "cfg-atlas-old" },
          });
        },
      ),
    );
    renderSetup();

    await scenarioChosen();
    await waitFor(() =>
      expect(nameValue()).toBe("Wrong shipping address — cfg-atlas v2 vs cfg-beacon v2"),
    );

    const armA = screen.getByRole("group", { name: "Arm A" });
    await user.selectOptions(
      within(armA).getByRole("combobox", { name: "Published version" }),
      "1",
    );
    await waitFor(() => expect(older.asked.count).toBe(1));
    await settle();
    // Arm A's v2 answer says nothing about v1: the arm is being read, so it is not named.
    expect(nameValue()).not.toMatch(/cfg-atlas v1/);
    expectBusy(screen.getByRole("button", { name: "Start experiment" }));

    older.release();
    await waitFor(() =>
      expect(nameValue()).toBe("Wrong shipping address — cfg-atlas-old v1 vs cfg-beacon v2"),
    );
  });

  it("takes the names of one version down as soon as another version of the scenario is chosen", async () => {
    const user = userEvent.setup();
    const older = holdable();
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () =>
        HttpResponse.json({
          scenarios: [
            { ...SCENARIOS.scenarios[0], latest_published_version: 2, published_version_count: 2 },
          ],
        } satisfies ScenarioListResponse),
      ),
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/versions`, () =>
        HttpResponse.json({
          versions: [1, 2].map((version) => ({
            version,
            content_fingerprint: "d".repeat(64),
            published_at: "2026-08-28T09:05:00+00:00",
          })),
        } satisfies ScenarioVersionListResponse),
      ),
      // v2 was published against ticket v2, which pinned the customer at v3; v1 against v1,
      // and v1 is still being read when it is chosen.
      http.get(
        `*/api/v1/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}/versions/:version`,
        async ({ params }) => {
          if (Number(params.version) === 2) {
            return HttpResponse.json(scenarioVersion(2, "Wrong shipping address", 2));
          }
          older.asked.count += 1;
          await older.released;
          return HttpResponse.json(scenarioVersion(Number(params.version)));
        },
      ),
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets/${TICKET_ID}/versions/:version`, ({ params }) =>
        HttpResponse.json(
          Number(params.version) === 2
            ? ticketVersion(2, "T-310", 3)
            : ticketVersion(Number(params.version)),
        ),
      ),
      http.get(`*/api/v1/customer-profiles/${PROFILE_ID}/versions/:version`, ({ params }) => {
        const version = Number(params.version);
        return HttpResponse.json(
          customerVersion(version, version === 3 ? "Noor Haddad" : "Maya Laurent"),
        );
      }),
    );
    renderSetup();

    await scenarioChosen();
    expect(
      await within(scenarioRow()).findByText(
        "Resolves against shop v3, ticket T-310 v2, customer Noor Haddad v3.",
      ),
    ).toBeVisible();

    await user.selectOptions(
      within(scenarioRow()).getByRole("combobox", { name: "Published version" }),
      "1",
    );
    await waitFor(() => expect(older.asked.count).toBe(1));
    expect(within(scenarioRow()).queryByText(/Resolves against/)).toBeNull();

    older.release();
    expect(
      await within(scenarioRow()).findByText(
        "Resolves against shop v3, ticket T-204 v1, customer Maya Laurent v2.",
      ),
    ).toBeVisible();
  });

  it("never lets the names of a scenario it has moved off land, while the next one's are read", async () => {
    const user = userEvent.setup();
    const first = holdable();
    const next = holdable();
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/scenarios`, () =>
        HttpResponse.json({ scenarios: [...SCENARIOS.scenarios, OTHER_SCENARIO] }),
      ),
      // The next scenario's versions are still being read when the first one's answer comes.
      http.get(
        `*/api/v1/shops/${SHOP_ID}/scenarios/${OTHER_SCENARIO.scenario_id}/versions`,
        async () => {
          next.asked.count += 1;
          await next.released;
          return HttpResponse.json(SCENARIO_VERSIONS);
        },
      ),
      // The next scenario was published against ticket v2, which pinned the customer at v3.
      http.get(
        `*/api/v1/shops/${SHOP_ID}/scenarios/${OTHER_SCENARIO.scenario_id}/versions/:version`,
        ({ params }) =>
          HttpResponse.json({
            ...scenarioVersion(Number(params.version), "Damaged on arrival", 2),
            scenario_id: OTHER_SCENARIO.scenario_id,
          }),
      ),
      http.get(`*/api/v1/shops/${SHOP_ID}/tickets/${TICKET_ID}/versions/:version`, ({ params }) =>
        HttpResponse.json(
          Number(params.version) === 2
            ? ticketVersion(2, "T-310", 3)
            : ticketVersion(Number(params.version)),
        ),
      ),
      // The first scenario's customer read is held; the next one's answers at once.
      http.get(`*/api/v1/customer-profiles/${PROFILE_ID}/versions/:version`, async ({ params }) => {
        const version = Number(params.version);
        if (version !== 3) {
          first.asked.count += 1;
          await first.released;
        }
        return HttpResponse.json(
          customerVersion(version, version === 3 ? "Noor Haddad" : "Maya Laurent"),
        );
      }),
    );
    renderSetup();

    const scenario = await screen.findByRole("combobox", { name: "Scenario" });
    await screen.findByRole("option", { name: "Damaged on arrival" });
    await user.selectOptions(scenario, "Wrong shipping address");
    await waitFor(() => expect(first.asked.count).toBe(1));

    await user.selectOptions(scenario, "Damaged on arrival");
    await waitFor(() => expect(next.asked.count).toBe(1));
    // Moving off aborted the first scenario's held customer read, so it has already failed on
    // the page's side — the late failure an unguarded page would turn into a ticket-only line,
    // landing while the next scenario's versions are still being read. Releasing the handler
    // only lets the server's side finish; nothing reaches the page from it.
    first.release();
    await settle();
    expect(within(scenarioRow()).queryByText(/Resolves against/)).toBeNull();
    expect(nameValue()).not.toMatch(/Wrong shipping address/);

    next.release();
    expect(
      await within(scenarioRow()).findByText(
        "Resolves against shop v3, ticket T-310 v2, customer Noor Haddad v3.",
      ),
    ).toBeVisible();
    await settle();
    expect(within(scenarioRow()).queryByText(/T-204|Maya Laurent/)).toBeNull();
    expect(nameValue()).toMatch(/^Damaged on arrival — /);
  });
});

/**
 * An operator meets the lab's reach before composing a run rather than at the first advance
 * (ADR 0053): the same sentence the editors write, beside a Start it disables.
 */
describe("experiment setup and the provider the lab can reach", () => {
  const NOTE =
    "Published configurations naming OpenAI cannot be advanced here until the lab has a connection for it.";

  for (const source of ["none", "saved_unreadable"] as const) {
    it(`disables Start and says why when an arm's version names a provider a lab on ${source} cannot reach`, async () => {
      const user = userEvent.setup();
      connectionSource = source;
      renderSetup();

      await scenarioChosen();
      // Named first, so the provider is the only thing Start could still be waiting for.
      await nameAs(user, "Prompt comparison");
      await chooseArm(user, 0, "cfg-atlas");

      const start = screen.getByRole("button", { name: "Start experiment" });
      await waitFor(() => expectRefused(start, NOTE));
      // Refused with its reason (ADR 0063): in `title`, and in the line its description names.
      expect(start).toHaveAttribute("title", NOTE);
      expect(start).toHaveAccessibleDescription(NOTE);
      expect(screen.getByText(NOTE)).toBeVisible();
      // A note on this machine, not a finding of the setup gate.
      const before = within(screen.getByRole("region", { name: "Before starting" }));
      expect(before.getByText(/differ in 2 dimensions/)).toBeVisible();
      expect(screen.getAllByText(NOTE)).toHaveLength(1);

      await user.click(start);
      // Nor by the keyboard: Enter on it, Space on it, and Enter in a field of its form.
      start.focus();
      await user.keyboard("{Enter}");
      await user.keyboard(" ");
      await nameAs(user, "{Enter}");
      expect(started).toHaveLength(0);
    });
  }

  it("lists what Start waits for as a hint until the operator touches the form (ADR 0078)", async () => {
    const user = userEvent.setup();
    connectionSource = "none";
    const { unmount } = renderSetup();
    await scenarioChosen();
    let start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expect(startReasons(start).length).toBeGreaterThan(0));
    // The scenario the page chose for the operator is not an edit of theirs.
    expectRefusalWeight(start, "hint");
    const before = refusalFacts(start);

    // An edit that leaves every reason standing still makes the attempt the operator's.
    const seed = screen.getByLabelText("Seed");
    const typed = (seed as HTMLInputElement).value;
    await user.clear(seed);
    await user.type(seed, typed);
    expectRefusalWeight(start, "touched");
    expect(refusalFacts(start)).toEqual(before);
    unmount();

    renderSetup();
    await scenarioChosen();
    start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expect(startReasons(start).length).toBeGreaterThan(0));
    expectRefusalWeight(start, "hint");
    const again = refusalFacts(start);
    await user.click(start);
    expectRefusalWeight(start, "touched");
    expect(refusalFacts(start)).toEqual(again);
    expect(started).toHaveLength(0);
  });

  it("refuses a Start submitted without a press, by the form's own handler", async () => {
    const user = userEvent.setup();
    connectionSource = "none";
    renderSetup();

    await scenarioChosen();
    // Named first, so the provider is the only thing Start could still be waiting for.
    await nameAs(user, "Prompt comparison");
    await chooseArm(user, 0, "cfg-atlas");
    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expectRefused(start, NOTE));

    // `requestSubmit` fires the submit without the click `PrimaryAction` swallows.
    const form = (start as HTMLButtonElement).form as HTMLFormElement;
    await act(async () => {
      form.requestSubmit(start as HTMLButtonElement);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(started).toHaveLength(0);
  });

  it("waits for the arm's provider to be read before Start can be pressed", async () => {
    const user = userEvent.setup();
    connectionSource = "none";
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(
        "*/api/v1/agent-configurations/:configurationId/versions/:version",
        async ({ params }) => {
          versionReads += 1;
          await held;
          return HttpResponse.json(
            publishedVersion(String(params.configurationId), Number(params.version)),
          );
        },
      ),
    );
    renderSetup();

    await scenarioChosen();
    await nameAs(user, "Prompt comparison");
    await chooseArm(user, 0, "cfg-atlas");
    // The gate has answered and the lab's reach is known; only the arm's provider is not.
    await screen.findByText(/differ in 2 dimensions/);
    await waitFor(() => expect(connectionServed.statuses).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(versionReads).toBeGreaterThanOrEqual(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Not read is not reachable: a press in flight, never free.
    const start = screen.getByRole("button", { name: "Start experiment" });
    expectBusy(start);
    await user.click(start);
    expect(started).toHaveLength(0);

    release();
    await waitFor(() => expectRefused(start, NOTE));
  });

  it("waits for the lab to say which providers it reaches before Start can be pressed", async () => {
    const user = userEvent.setup();
    connectionSource = "none";
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("*/api/v1/lab-status", async () => {
        await held;
        connectionServed.statuses += 1;
        return HttpResponse.json({
          run_mode: "offline",
          connection_source: "none",
          model_id: "gpt-5-mini",
          trace_export_configured: false,
        } satisfies LabStatusResponse);
      }),
    );
    renderSetup();

    await scenarioChosen();
    await nameAs(user, "Prompt comparison");
    await chooseArm(user, 0, "cfg-atlas");
    await screen.findByText(/differ in 2 dimensions/);
    await waitFor(() => expect(versionReads).toBeGreaterThanOrEqual(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const start = screen.getByRole("button", { name: "Start experiment" });
    expectBusy(start);
    await user.click(start);
    expect(started).toHaveLength(0);

    release();
    await waitFor(() => expectRefused(start, NOTE));
  });

  it("writes one sentence for two arms that name the same unreachable provider", async () => {
    const user = userEvent.setup();
    connectionSource = "none";
    renderSetup();

    await scenarioChosen();
    // Named first, so the provider is the only thing Start could still be waiting for.
    await nameAs(user, "Prompt comparison");
    await chooseArm(user, 0, "cfg-atlas");
    await chooseArm(user, 1, "cfg-atlas");

    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expectRefused(start, NOTE));
    expect(start).toHaveAccessibleDescription(NOTE);
  });

  it("starts an arm on the declared control whatever the lab can reach", async () => {
    const user = userEvent.setup();
    connectionSource = "none";
    renderSetup();

    await scenarioChosen();
    // Named first, so the provider is the only thing Start could still be waiting for.
    await nameAs(user, "Prompt comparison");
    await chooseArm(user, 0, "cfg-beacon");
    await reachabilityRead();
    // Free once the chosen version's own read has answered, which names the provider.
    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expectNotRefused(start));
    await user.click(start);

    await waitFor(() => expect(started).toHaveLength(1));
    expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
  });

  it("releases Start when the second arm moves off the unreachable provider", async () => {
    const user = userEvent.setup();
    connectionSource = "none";
    renderSetup();

    await scenarioChosen();
    // Named first, so the provider is the only thing Start could still be waiting for.
    await nameAs(user, "Prompt comparison");
    await chooseArm(user, 0, "cfg-beacon");
    await chooseArm(user, 1, "cfg-atlas");
    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expectRefused(start, NOTE));

    await chooseArm(user, 1, "cfg-beacon");

    await waitFor(() => expectNotRefused(start));
    expect(start).not.toHaveAttribute("title");
    expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
  });

  const BROKEN_READ = {
    code: "internal_error",
    message: "The lab could not complete the request.",
    request_id: "r",
  };

  for (const route of ["lab-status", "model-connections"] as const) {
    it(`leaves Start alone when ${route} cannot be read, even on a lab that reaches nothing`, async () => {
      const user = userEvent.setup();
      connectionSource = "none";
      server.use(
        http.get(`*/api/v1/${route}`, () => {
          // Counted as served, so the wait below still knows when the page has been answered.
          if (route === "lab-status") {
            connectionServed.statuses += 1;
          } else {
            connectionServed.listings += 1;
          }
          return HttpResponse.json(BROKEN_READ, { status: 500 });
        }),
      );
      renderSetup();

      await scenarioChosen();
      // Named first, so the provider is the only thing Start could still be waiting for.
      await nameAs(user, "Prompt comparison");
      await chooseArm(user, 0, "cfg-atlas");
      await reachabilityRead();

      const start = screen.getByRole("button", { name: "Start experiment" });
      // Free once the chosen version's own read has answered, which names the provider.
      await waitFor(() => expectNotRefused(start));
      expect(start).not.toHaveAttribute("title");
      expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
    });
  }

  it("leaves Start alone when the arm's version cannot be read", async () => {
    const user = userEvent.setup();
    connectionSource = "none";
    server.use(
      http.get("*/api/v1/agent-configurations/:configurationId/versions/:version", () => {
        versionReads += 1;
        return HttpResponse.json(BROKEN_READ, { status: 500 });
      }),
    );
    renderSetup();

    await scenarioChosen();
    // Named first, so the provider is the only thing Start could still be waiting for.
    await nameAs(user, "Prompt comparison");
    await chooseArm(user, 0, "cfg-atlas");
    await reachabilityRead();

    // Free once the chosen version's read has failed: a read in flight is still a wait.
    await waitFor(() => expectNotRefused(screen.getByRole("button", { name: "Start experiment" })));
    expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
  });

  it("releases Start when a blocked arm moves to a version that cannot be read", async () => {
    const user = userEvent.setup();
    connectionSource = "none";
    server.use(
      http.get("*/api/v1/agent-configurations/:configurationId/versions/:version", ({ params }) => {
        versionReads += 1;
        return params.version === "2"
          ? HttpResponse.json(BROKEN_READ, { status: 500 })
          : HttpResponse.json(publishedVersion(String(params.configurationId), 1));
      }),
    );
    renderSetup();

    await scenarioChosen();
    // Named first, so the provider is the only thing Start could still be waiting for.
    await nameAs(user, "Prompt comparison");
    await chooseArm(user, 0, "cfg-atlas");
    const start = screen.getByRole("button", { name: "Start experiment" });
    await waitFor(() => expectRefused(start, NOTE));

    const reads = versionReads;
    const arm = screen.getByRole("group", { name: "Arm A" });
    await user.selectOptions(within(arm).getByLabelText("Published version"), "2");
    await waitFor(() => expect(versionReads).toBeGreaterThan(reads));
    // Version 1's note went with version 1: nothing refuses Start while version 2 is read.
    expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
    expect(startReasons(start)).toEqual([]);

    // What the lab knows about version 2 is nothing, so it says nothing about it — once the
    // read has failed: asked is not answered, and until then Start waits on it.
    await waitFor(() => expectNotRefused(start));
    expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
  });

  for (const source of ["saved", "environment"] as const) {
    it(`starts an OpenAI arm on a lab that reaches it through ${source}`, async () => {
      const user = userEvent.setup();
      connectionSource = source;
      renderSetup();

      await scenarioChosen();
      // Named first, so the provider is the only thing Start could still be waiting for.
      await nameAs(user, "Prompt comparison");
      await chooseArm(user, 0, "cfg-atlas");
      await reachabilityRead();
      // Free once the chosen version's own read has answered, which names the provider.
      const start = screen.getByRole("button", { name: "Start experiment" });
      await waitFor(() => expectNotRefused(start));
      expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
      await user.click(start);

      await waitFor(() => expect(started).toHaveLength(1));
    });
  }
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
    expectInertChip(within(armA).getByText("this arm only"));
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
    expectInertChip(within(armA).getByText("attempt 2"));
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

    // Each call leads with its outcome's glyph, which is hidden from a reader of its words.
    expect(strip.map((entry) => entry.textContent)).toEqual([
      "✓ orders.read_order → Success",
      "scenario fault · moved this arm",
      "✓ orders.propose_address_change → Success",
    ]);
    // The calls and the fault are chips rather than controls: nothing in the strip is pressed.
    for (const chip of strip) {
      expectInertChip(chip);
    }
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

    // Turns counted from one, as the operator counts them: the trigger is the first.
    expect(
      within(armA).getByText("Waiting for the customer — answered 1 of 1 turn so far"),
    ).toBeVisible();
    expect(within(armB).getByText("Waiting for the agent at turn 1")).toBeVisible();
    // The answered arm is offered nothing: advancing it would return the reply it has.
    expect(within(armA).queryByRole("button", { name: /Arm A's agent/ })).toBeNull();
    expect(within(armB).getByRole("button", { name: "Run Arm B's agent" })).toBeVisible();
  });

  it("counts a completed arm's turns from one, as the results card does", async () => {
    // The seeded run's shape: the trigger and one reply, both answered, at the cap.
    maxTurns = 1;
    turns = [...OPENED, turn(ARM_A, 1, "reply-1", "Any update?")];
    agentTurns = [agentTurn(ARM_A, 0), agentTurn(ARM_A, 1)];
    renderBench();

    const armA = await screen.findByRole("region", { name: "Arm A" });

    expect(within(armA).getByText("Completed — answered 2 of 2 turns")).toBeVisible();
    expect(within(armA).queryByText(/· turn \d/)).toBeNull();
  });

  it("says an arm whose attempt failed is waiting for a retry", async () => {
    agentTurns = [agentTurn(ARM_A, 0, 1, "model_transient")];
    renderBench();

    const armA = await screen.findByRole("region", { name: "Arm A" });

    expect(
      within(armA).getByText("Attempt 1 produced no reply — waiting for a retry at turn 1"),
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

  it("keeps its matrix to the marks, with no evidence line under them", async () => {
    scored = true;
    renderBench();

    const objectives = await screen.findByRole("region", { name: "Objectives" });
    await within(objectives).findAllByText(/explain-the-outcome met — /);

    // The bench's column is a running thread's neighbour: each cell is its mark, and the
    // sentence behind it is heard and hovered rather than drawn as a line of its own.
    expect(
      within(objectives).queryByText("support.read_document never answered policy:address-change"),
    ).toBeNull();
    expect(
      within(objectives).queryByRole("button", {
        name: "the arm named the order and said what it changed",
      }),
    ).toBeNull();
    expect(within(objectives).queryByText(/^read-address-change-policy · /)).toBeNull();
  });

  it("says a judge scores its own rows rather than counting them as missed", async () => {
    renderBench();

    const objectives = await screen.findByRole("region", { name: "Objectives" });

    // One cell, one statement of who scores it: the label says a judge does, and the detail
    // says what the label does not — that no verdict is on the record for this arm yet.
    const cells = within(objectives).getAllByText(/^explain-the-outcome a judge scores this/);
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "explain-the-outcome a judge scores this after the run — no verdict is recorded for this arm yet",
      "explain-the-outcome a judge scores this after the run — no verdict is recorded for this arm yet",
    ]);
  });

  it("scores the judge's rows with a published judge and reads what it answered", async () => {
    const user = userEvent.setup();
    renderBench();

    const objectives = await screen.findByRole("region", { name: "Objectives" });
    // The lab's one published judge is already the one chosen, and says so.
    await waitFor(() => expect(within(objectives).getByLabelText("Judge")).toHaveValue(JUDGE_ID));
    await waitFor(() =>
      expect(within(objectives).getByLabelText("Judge")).toHaveAccessibleDescription(
        "This one is the only published judge in the lab, so it is already chosen.",
      ),
    );
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

    // Two turns received, counted from one, and only the second answered: the trigger was
    // passed over when the customer wrote again, and the count says so rather than "every".
    expect(within(armA).getByText("Completed — answered 1 of 2 turns")).toBeVisible();
    expect(within(objectives).getByText(/read-address-change-policy missed/)).toBeInTheDocument();
    // Nothing offers a move the backend would refuse: no advance, and no message.
    expect(within(armA).queryByRole("button", { name: /Arm A's agent/ })).toBeNull();
    const armAChip = within(composer).getByRole("checkbox", { name: "Arm A" });
    expect(armAChip).toBeDisabled();
    // And says why, beside the chip and in its description, rather than only by fading.
    expect(armAChip).toHaveAccessibleDescription("Arm A has completed.");
    const described = (armAChip.getAttribute("aria-describedby") ?? "").split(" ");
    expect(described.map((id) => document.getElementById(id)?.textContent)).toContain(
      "Arm A has completed.",
    );
    expect(within(composer).getByText("Arm A has completed.")).toBeVisible();
    expect(within(composer).getByRole("group", { name: "Deliver to" })).toBeInTheDocument();
  });

  it("refuses to send once every arm has completed, and says why where the press is", async () => {
    const user = userEvent.setup();
    maxTurns = 1;
    turns = [
      ...OPENED,
      turn(ARM_A, 1, "reply-1", "Any update?"),
      turn(ARM_B, 1, "reply-1", "Any update?"),
    ];
    agentTurns = [agentTurn(ARM_A, 1), agentTurn(ARM_B, 1)];
    renderBench();

    const composer = await screen.findByRole("region", { name: "Customer composer" });
    await within(composer).findByRole("checkbox", { name: /Arm B/ });
    const send = within(composer).getByRole("button", { name: "Send as the customer" });
    const reason = "Every arm has completed, so there is no arm left to send a turn to.";
    expectRefused(send, reason);
    expect(within(composer).getByText(reason)).toBeVisible();

    await user.type(within(composer).getByLabelText("Message"), "Hello?");
    await user.click(send);
    send.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    // Without the press, the composer's own handler refuses: no arm is left to deliver to.
    await submitWithoutPressing(send);
    expect(delivered).toEqual([]);
  });

  it("says every arm has completed as a hint until the operator writes or presses Send (ADR 0078)", async () => {
    const user = userEvent.setup();
    maxTurns = 1;
    turns = [
      ...OPENED,
      turn(ARM_A, 1, "reply-1", "Any update?"),
      turn(ARM_B, 1, "reply-1", "Any update?"),
    ];
    agentTurns = [agentTurn(ARM_A, 1), agentTurn(ARM_B, 1)];
    const { unmount } = renderBench();

    let composer = await screen.findByRole("region", { name: "Customer composer" });
    await within(composer).findByRole("checkbox", { name: /Arm B/ });
    let send = within(composer).getByRole("button", { name: "Send as the customer" });
    // Nothing the operator can edit caused it, and nothing has been tried yet.
    expectRefusalWeight(send, "hint");
    const before = refusalFacts(send);
    await user.type(within(composer).getByLabelText("Message"), "Hello?");
    expectRefusalWeight(send, "touched");
    expect(refusalFacts(send)).toEqual(before);
    unmount();

    renderBench();
    composer = await screen.findByRole("region", { name: "Customer composer" });
    await within(composer).findByRole("checkbox", { name: /Arm B/ });
    send = within(composer).getByRole("button", { name: "Send as the customer" });
    expectRefusalWeight(send, "hint");
    const again = refusalFacts(send);
    await user.click(send);
    expectRefusalWeight(send, "touched");
    expect(refusalFacts(send)).toEqual(again);
    expect(delivered).toEqual([]);
  });

  it("offers the send while an arm still waits for the customer", async () => {
    renderBench();

    const composer = await screen.findByRole("region", { name: "Customer composer" });
    expectNotRefused(within(composer).getByRole("button", { name: "Send as the customer" }));
    expect(within(composer).queryByText(/Every arm has completed/)).toBeNull();
  });

  it("reads both arms back to the one starting state they were cloned from", async () => {
    renderBench();

    const provenance = await screen.findByRole("region", { name: "Provenance" });

    expect(within(provenance).getByTitle(SANDBOX_FINGERPRINT)).toBeVisible();
    expect(within(provenance).getByTitle(RESOLUTION_FINGERPRINT)).toBeVisible();
    expect(within(provenance).getByText(/human operator/)).toBeVisible();
    // The results' record, read on the bench as it runs: nothing in it is a link (ADR 0068).
    expect(within(provenance).getByText("scenario v1")).toBeVisible();
    expect(within(provenance).queryAllByRole("link")).toEqual([]);
  });

  it("names a derived run's source on the bench without linking it", async () => {
    renderApp(`/lab/bench/${SHOP_ID}/${FORK_ID}`);

    const provenance = await screen.findByRole("region", { name: "Provenance" });
    expect(
      within(provenance).getByText("A fork of", { exact: false, selector: "p" }),
    ).toHaveTextContent("A fork of Wrong address — framework comparison · changed prompt");
    expect(within(provenance).queryAllByRole("link")).toEqual([]);
  });
});

/**
 * Holds every request to one route until the test lets it go, in the order they arrived, and
 * then lets it through to the suite's own handler — which records it and answers as usual.
 */
function holdEach(path: string) {
  const arrived: string[] = [];
  const waiting: (() => void)[] = [];
  server.use(
    http.post(path, async ({ params }) => {
      arrived.push(String(params.runId ?? ""));
      await new Promise<void>((resolve) => waiting.push(resolve));
      // Returning nothing hands the request on to the next handler for the route.
    }),
  );
  return {
    arrived,
    release: () => waiting.shift()?.(),
  };
}

const AGENT_TURNS = `*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/runs/:runId/agent-turns`;
const MINUTE = "This can take a minute and cannot be cancelled.";
const DERIVING = `${MINUTE} If you are still here when its arms are done, the new run opens; History lists it either way.`;

/** The queue's rows, one string per arm: its name, what it runs, and where it stands. */
function queueRows(region: HTMLElement): string[] {
  return Array.from(region.querySelectorAll("li"), (row) =>
    Array.from(row.children, (cell) => cell.textContent).join(" | "),
  );
}

describe("a long-running action on the bench reports itself", () => {
  it("shows which arm is running and when both are done, not only a button label", async () => {
    // The slice's evidence: an operator sends a turn to two arms and watches which arm is
    // running and when both are done.
    const user = userEvent.setup();
    const agents = holdEach(AGENT_TURNS);
    renderBench();

    const armA = await screen.findByRole("region", { name: "Arm A" });
    const armB = screen.getByRole("region", { name: "Arm B" });
    const composer = screen.getByRole("region", { name: "Customer composer" });
    const queue = within(composer).getByRole("status", { name: "Where each arm stands" });
    // Present before anything runs, so it is already being watched when something does.
    expect(queue).toHaveTextContent("");

    await user.type(within(composer).getByLabelText("Message"), "Any update?");
    const send = within(composer).getByRole("button", { name: "Send as the customer" });
    // What the press will be is heard on reaching it, before it is pressed.
    expect(send).toHaveAccessibleDescription(MINUTE);
    await user.click(send);

    // Arm A is being run and arm B waits its turn; both cards are about to change.
    await waitFor(() => expect(agents.arrived).toEqual([ARM_A]));
    await waitFor(() =>
      expect(queueRows(queue)).toEqual([
        "Arm A | Atlas v1 | running…",
        "Arm B | Beacon v1 | waiting to run",
      ]),
    );
    expect(queue).toHaveTextContent("1 of 2 running.");
    expect(armA).toHaveAttribute("aria-busy", "true");
    expect(armB).toHaveAttribute("aria-busy", "true");
    // The card holding the queue is never busy: that would keep the queue from being read.
    expect(composer).not.toHaveAttribute("aria-busy");
    // The message is already in both threads, before either arm answers it.
    expect(within(armA).getByText("Any update?")).toBeVisible();
    expect(within(armB).getByText("Any update?")).toBeVisible();
    // The press is held, with focus, and says it cannot be cancelled; nothing offers to.
    expect(send).toHaveTextContent("Running…");
    expectBusy(send);
    expect(send).toHaveAccessibleDescription(MINUTE);
    expect(within(composer).getByText(MINUTE)).toBeVisible();
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
    // A second turn typed meanwhile is not sent by any route while this one runs.
    await user.type(within(composer).getByLabelText("Message"), "And another thing");
    await submitWithoutPressing(send);
    expect(delivered).toHaveLength(1);
    await user.clear(within(composer).getByLabelText("Message"));
    send.focus();

    // Arm A answers: its card shows the reply while arm B runs, and its row where it stands.
    agents.release();
    await waitFor(() => expect(agents.arrived).toEqual([ARM_A, ARM_B]));
    await waitFor(() =>
      expect(queueRows(queue)).toEqual([
        "Arm A | Atlas v1 | waiting for the customer",
        "Arm B | Beacon v1 | running…",
      ]),
    );
    expect(await within(armA).findByText(ANSWER)).toBeVisible();
    expect(armA).not.toHaveAttribute("aria-busy");
    expect(armB).toHaveAttribute("aria-busy", "true");
    expect(queue).toHaveTextContent("1 of 2 running.");

    // Both are done: the queue says where each now stands, in one sentence.
    agents.release();
    await waitFor(() =>
      expect(queue).toHaveTextContent(
        "Arm A is waiting for the customer · Arm B is waiting for the customer",
      ),
    );
    expect(queueRows(queue)).toEqual([
      "Arm A | Atlas v1 | waiting for the customer",
      "Arm B | Beacon v1 | waiting for the customer",
    ]);
    expect(within(armB).getByText(ANSWER)).toBeVisible();
    expect(armA).not.toHaveAttribute("aria-busy");
    expect(armB).not.toHaveAttribute("aria-busy");
    // Still the button's description, but drawn only while something runs.
    expect(within(composer).getByText(MINUTE)).toHaveClass("sr-only");
    // And the press came back where it was, with focus still on it.
    expect(send).toHaveTextContent("Send as the customer");
    expect(send).toHaveFocus();
    expectNotRefused(send);
  });

  it("leaves nothing of one bench on the next while its run is still held", async () => {
    const user = userEvent.setup();
    const agents = holdEach(AGENT_TURNS);
    const { router } = renderBench();

    const armA = await screen.findByRole("region", { name: "Arm A" });
    await user.click(within(armA).getByRole("button", { name: "Run Arm A's agent" }));
    await waitFor(() => expect(agents.arrived).toEqual([ARM_A]));

    // Straight to another bench, with the first one's arm still running.
    await act(async () => {
      await router.navigate(`/lab/bench/${SHOP_ID}/${REPLAY_ID}`);
    });
    const replayHeading = "Wrong address — framework comparison (replay)";
    expect(await screen.findByRole("heading", { level: 1, name: replayHeading })).toBeVisible();
    const queue = screen.getByRole("status", { name: "Where each arm stands" });
    expect(queue).toHaveTextContent("");
    expect(screen.getByRole("region", { name: "Arm A" })).not.toHaveAttribute("aria-busy");

    // The first bench's run answers: its record and its queue go nowhere.
    agents.release();
    await waitFor(() => expect(advanced).toEqual([ARM_A]));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByRole("heading", { level: 1, name: replayHeading })).toBeVisible();
    expect(screen.getByRole("status", { name: "Where each arm stands" })).toHaveTextContent("");
  });

  it("says an arm the send did not reach was not sent this turn, and one that has completed did", async () => {
    const user = userEvent.setup();
    const agents = holdEach(AGENT_TURNS);
    renderBench();

    const composer = await screen.findByRole("region", { name: "Customer composer" });
    await user.click(within(composer).getByRole("checkbox", { name: "Arm B" }));
    await user.type(within(composer).getByLabelText("Message"), "Only arm A hears this.");
    await user.click(within(composer).getByRole("button", { name: "Send as the customer" }));

    const queue = within(composer).getByRole("status", { name: "Where each arm stands" });
    await waitFor(() =>
      expect(queueRows(queue)).toEqual([
        "Arm A | Atlas v1 | running…",
        "Arm B | Beacon v1 | not sent this turn",
      ]),
    );
    expect(queue).toHaveTextContent("1 of 1 running.");
    expect(screen.getByRole("region", { name: "Arm B" })).not.toHaveAttribute("aria-busy");
    agents.release();
    await waitFor(() =>
      expect(queue).toHaveTextContent(
        "Arm A is waiting for the customer · Arm B is waiting for the agent",
      ),
    );
  });

  it("names a completed arm as completed earlier while another runs, and completed after", async () => {
    const user = userEvent.setup();
    maxTurns = 1;
    turns = [...OPENED, turn(ARM_B, 1, "reply-1", "Any update?")];
    agentTurns = [agentTurn(ARM_B, 1)];
    const agents = holdEach(AGENT_TURNS);
    renderBench();

    const armA = await screen.findByRole("region", { name: "Arm A" });
    await user.click(within(armA).getByRole("button", { name: "Run Arm A's agent" }));

    const queue = screen.getByRole("status", { name: "Where each arm stands" });
    await waitFor(() =>
      expect(queueRows(queue)).toEqual([
        "Arm A | Atlas v1 | running…",
        "Arm B | Beacon v1 | completed earlier",
      ]),
    );
    agents.release();
    await waitFor(() =>
      expect(queue).toHaveTextContent("Arm A is waiting for the customer · Arm B has completed"),
    );
  });

  it("holds a Run with focus while it runs, and hands focus to the arm once it answers", async () => {
    const user = userEvent.setup();
    const agents = holdEach(AGENT_TURNS);
    renderBench();

    const armA = await screen.findByRole("region", { name: "Arm A" });
    // Not a focus target of its own: a click inside the card leaves focus where it was.
    expect(armA).not.toHaveAttribute("tabindex");
    const run = within(armA).getByRole("button", { name: "Run Arm A's agent" });
    await user.click(run);

    await waitFor(() => expect(run).toHaveTextContent("Running…"));
    expectBusy(run);
    expect(run).toHaveAccessibleDescription(MINUTE);
    expect(armA).toHaveAttribute("aria-busy", "true");
    // The arm beside it cannot be run meanwhile, and its Run keeps its own name.
    const other = within(screen.getByRole("region", { name: "Arm B" })).getByRole("button", {
      name: "Run Arm B's agent",
    });
    expect(other).toHaveTextContent("Run the agent");
    expectBusy(other);
    await user.click(other);
    expect(agents.arrived).toEqual([ARM_A]);
    // Back on the Run that was pressed, where the reader is.
    run.focus();

    // Answered: nothing is left to run on this arm, so the control goes — and focus goes to
    // the arm whose answer arrived rather than to the page's body.
    agents.release();
    await waitFor(() =>
      expect(within(armA).queryByRole("button", { name: /Arm A's agent/ })).toBeNull(),
    );
    expect(armA).toHaveFocus();
    expect(armA).not.toHaveAttribute("aria-busy");
    // Focusable for the hand-off only: once focus moves on, the card is not a target again.
    await user.click(
      within(screen.getByRole("region", { name: "Customer composer" })).getByLabelText("Message"),
    );
    expect(armA).not.toHaveAttribute("tabindex");
    await user.click(within(armA).getByText(TRIGGER));
    expect(armA).not.toHaveFocus();
  });

  it("brings a Run the lab refused back where it was, with focus, and says it could not be run", async () => {
    const user = userEvent.setup();
    runtimeUnavailable = true;
    renderBench();

    const armA = await screen.findByRole("region", { name: "Arm A" });
    const run = within(armA).getByRole("button", { name: "Run Arm A's agent" });
    await user.click(run);

    expect(await screen.findByRole("alert")).toHaveTextContent(/no pydantic-ai runtime/);
    const queue = screen.getByRole("status", { name: "Where each arm stands" });
    await waitFor(() =>
      expect(queue).toHaveTextContent("Arm A could not be run · Arm B is waiting for the agent"),
    );
    expect(within(armA).getByRole("button", { name: "Run Arm A's agent" })).toBe(run);
    expect(run).toHaveFocus();
    expectNotRefused(run);
  });

  it("reports a scoring pass per arm, holds the Score press, and says what it answered", async () => {
    const user = userEvent.setup();
    const judging = holdEach(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/judgements`);
    renderBench();

    const objectives = await screen.findByRole("region", { name: "Objectives" });
    const score = within(objectives).getByRole("button", { name: /Score 1 judged/ });
    const queue = within(objectives).getByRole("status", {
      name: "Where each arm's scoring stands",
    });
    await user.click(score);

    await waitFor(() => expect(score).toHaveTextContent("Scoring…"));
    // A press made again meanwhile, by a click or a key, starts nothing more (ADR 0065).
    await user.click(score);
    await user.keyboard("{Enter}");
    expect(judging.arrived).toHaveLength(1);
    expectBusy(score);
    expect(score).toHaveAccessibleDescription(MINUTE);
    expect(queueRows(queue)).toEqual([
      "Arm A | Atlas v1 | being scored…",
      "Arm B | Beacon v1 | being scored…",
    ]);
    expect(queue).toHaveTextContent("2 of 2 being scored.");
    // What is about to change is the matrix; the card also holds the queue, so it is not busy.
    const matrix = within(objectives).getByRole("table").parentElement as HTMLElement;
    expect(matrix).toHaveAttribute("aria-busy", "true");
    expect(objectives).not.toHaveAttribute("aria-busy");

    judging.release();
    await waitFor(() =>
      expect(queue).toHaveTextContent("Arm A has been scored · Arm B has been scored"),
    );
    expect(matrix).not.toHaveAttribute("aria-busy");
    expect(score).toHaveFocus();
    expect(score).not.toHaveAttribute("aria-disabled");
  });

  it("says an arm the judge gave no verdict was not scored", async () => {
    const user = userEvent.setup();
    judgeFailed = true;
    renderBench();

    const objectives = await screen.findByRole("region", { name: "Objectives" });
    await user.click(within(objectives).getByRole("button", { name: /Score 1 judged/ }));

    const queue = within(objectives).getByRole("status", {
      name: "Where each arm's scoring stands",
    });
    await waitFor(() =>
      expect(queue).toHaveTextContent(
        "Arm A has no verdict from the judge · Arm B has no verdict from the judge",
      ),
    );
  });
});

describe("a long-running action on the results reports itself", () => {
  it("reports a scoring pass per arm at the foot of Objectives, busy on the judged rows alone", async () => {
    const user = userEvent.setup();
    const judging = holdEach(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/judgements`);
    renderResults();

    const section = await screen.findByRole("region", { name: "Objectives" });
    const score = await within(section).findByRole("button", { name: /Score 1 judged/ });
    await user.click(score);

    const queue = within(section).getByRole("status", { name: "Where each arm's scoring stands" });
    await waitFor(() => expect(queue).toHaveTextContent("2 of 2 being scored."));
    // A press made again meanwhile, by a click or a key, starts nothing more (ADR 0065).
    await user.click(score);
    await user.keyboard("{Enter}");
    expect(judging.arrived).toHaveLength(1);
    expectBusy(score);
    // What is about to change is the judged rows: their group is busy, and neither the rule's
    // group, nor the section, nor the foot holding the queue is, so the queue is still heard.
    const judged = objectivesGroup("Scored by a judge");
    expect(judged.closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
    expect(objectivesGroup("Decided by a rule").closest("[aria-busy]")).toBeNull();
    expect(section).not.toHaveAttribute("aria-busy");
    expect(queue.closest("[aria-busy]")).toBeNull();
    expect(score.closest("[aria-busy]")).toBeNull();
    // At the section's foot, under both groups.
    expect(judged.compareDocumentPosition(score) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    judging.release();
    await waitFor(() =>
      expect(queue).toHaveTextContent("Arm A has been scored · Arm B has been scored"),
    );
    expect(objectivesGroup("Scored by a judge").closest("[aria-busy]")).toBeNull();
    expect(score).toHaveFocus();
  });

  it("says what Replay and Fork are beside them", async () => {
    renderResults();

    const replay = await screen.findByRole("button", { name: "Replay" });
    expect(screen.getByText(DERIVATIONS_ABOUT)).toBeVisible();
    // And, before the press as while it runs, that it cannot be cancelled once pressed —
    // heard on reaching the button, where a description added after the press would not be.
    expect(replay).toHaveAccessibleDescription(`${DERIVATIONS_ABOUT} ${DERIVING}`);
    expect(screen.getByRole("status", { name: "Where each derived arm stands" })).toHaveTextContent(
      "",
    );
    expect(screen.getByText(DERIVING)).toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: "Fork…" })).toHaveAccessibleDescription(
      DERIVATIONS_ABOUT,
    );
  });

  it("reports a replay's arms while it runs, holds the press with focus, then opens the new run", async () => {
    const user = userEvent.setup();
    const replays = holdEach(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/replays`);
    renderResults();

    const replay = await screen.findByRole("button", { name: "Replay" });
    await user.click(replay);

    await waitFor(() => expect(replays.arrived).toHaveLength(1));
    const queue = screen.getByRole("status", { name: "Where each derived arm stands" });
    expect(queueRows(queue)).toEqual([
      "Arm A | Atlas v1 | running…",
      "Arm B | Beacon v1 | running…",
    ]);
    expect(queue).toHaveTextContent("Replaying this run: 2 of 2 running.");
    expect(replay).toHaveTextContent("Replaying…");
    expectBusy(replay);
    // A press made again meanwhile, by a click or a key, starts nothing more (ADR 0065).
    await user.click(replay);
    await user.keyboard("{Enter}");
    expect(replays.arrived).toHaveLength(1);
    expect(replay).toHaveAccessibleDescription(
      `${DERIVATIONS_ABOUT} ${MINUTE} If you are still here when its arms are done, the new run opens; History lists it either way.`,
    );
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();

    replays.release();
    expect(
      await screen.findByRole("heading", {
        name: "Wrong address — framework comparison (replay)",
      }),
    ).toBeVisible();
    expect(screen.getByRole("status", { name: "Where each derived arm stands" })).toHaveTextContent(
      "",
    );
  });

  it("reports a fork's arms at the versions chosen, and brings a refused one back with focus", async () => {
    const user = userEvent.setup();
    const forks = holdEach(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/forks`);
    renderResults();

    await user.click(await screen.findByRole("button", { name: "Fork…" }));
    const panel = await screen.findByRole("region", { name: "Fork this experiment" });
    const [, armB] = within(panel).getAllByLabelText("Published version");
    await user.selectOptions(armB, "2");
    const fork = within(panel).getByRole("button", { name: "Fork this run" });
    // Busy until arm B's v2 has answered with the name it was published under.
    await waitFor(() => expectNotRefused(fork));
    await user.click(fork);

    await waitFor(() => expect(forks.arrived).toHaveLength(1));
    const queue = screen.getByRole("status", { name: "Where each derived arm stands" });
    // Each arm named as the version it runs was published: arm A stays on the v1 its run
    // recorded as Atlas, though the lab lists it as cfg-atlas now; arm B by its v2's own name.
    expect(queueRows(queue)).toEqual([
      "Arm A | Atlas v1 | running…",
      "Arm B | cfg-beacon v2 | running…",
    ]);
    expect(queue).toHaveTextContent("Forking this run: 2 of 2 running.");
    expect(fork).toHaveTextContent("Forking…");
    expectBusy(fork);
    // A press made again meanwhile starts no second fork.
    await user.click(fork);
    await user.keyboard("{Enter}");
    expect(forks.arrived).toHaveLength(1);
    expect(fork).toHaveAccessibleDescription(
      `${MINUTE} If you are still here when its arms are done, the new run opens; History lists it either way.`,
    );

    forks.release();
    expect(await screen.findByRole("heading", { name: /\(fork\)$/ })).toBeVisible();
  });

  it("holds Replay and Fork on every run while a derivation runs, and never opens its answer over another run", async () => {
    // A replay pressed on a derived run, then the operator follows its provenance to the run
    // it came from while the lab is still running the first.
    const user = userEvent.setup();
    let answer: (() => void) | null = null;
    const pressed: string[] = [];
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/${REPLAY_ID}/replays`, async () => {
        pressed.push(REPLAY_ID);
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return HttpResponse.json(
          { ...forkedExperiment(), label: "Replay of the replay" },
          { status: 201 },
        );
      }),
    );
    const { router } = renderApp(`/lab/bench/${SHOP_ID}/${REPLAY_ID}/results`);
    const derivedName = "Wrong address — framework comparison (replay)";
    const sourceName = "Wrong address — framework comparison";
    await screen.findByRole("heading", { level: 1, name: derivedName });
    await user.click(screen.getByRole("button", { name: "Replay" }));
    await waitFor(() => expect(pressed).toEqual([REPLAY_ID]));

    await user.click(screen.getByRole("link", { name: sourceName }));
    expect(await screen.findByRole("heading", { level: 1, name: sourceName })).toBeVisible();
    // Still running, and said so here, naming the run it was pressed on.
    const queue = screen.getByRole("status", { name: "Where each derived arm stands" });
    expect(queue).toHaveTextContent(`Replaying ${derivedName}: 2 of 2 running.`);
    // Neither derivation is free on this run meanwhile: no second one reaches the lab.
    const replay = screen.getByRole("button", { name: "Replay" });
    expect(replay).toBeDisabled();
    await user.click(replay);
    await user.click(screen.getByRole("button", { name: "Fork…" }));
    const panel = await screen.findByRole("region", { name: "Fork this experiment" });
    const [, armB] = within(panel).getAllByLabelText("Published version");
    await user.selectOptions(armB, "2");
    const fork = within(panel).getByRole("button", { name: "Fork this run" });
    expectBusy(fork);
    await user.click(fork);
    expect(replayed).toEqual([]);
    expect(forked).toEqual([]);

    // Back on the run it was pressed on, the press is still the one in flight.
    await act(async () => {
      await router.navigate(`/lab/bench/${SHOP_ID}/${REPLAY_ID}/results`);
    });
    await screen.findByRole("heading", { level: 1, name: derivedName });
    const again = screen.getByRole("button", { name: "Replaying…" });
    expectBusy(again);
    await user.click(again);
    expect(pressed).toEqual([REPLAY_ID]);

    // And away again when the lab answers: the operator stays on the page they chose, and the
    // queue says what came back, with the way to it.
    await user.click(screen.getByRole("link", { name: sourceName }));
    await screen.findByRole("heading", { level: 1, name: sourceName });
    await act(async () => {
      answer?.();
    });
    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "Where each derived arm stands" }),
      ).toHaveTextContent(`The replay of ${derivedName} is ready: Replay of the replay.`),
    );
    expect(screen.getByRole("heading", { level: 1, name: sourceName })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open the new run" })).toHaveAttribute(
      "href",
      `/lab/bench/${SHOP_ID}/${FORK_ID}/results`,
    );
    // Answered, so this run's own derivations are free again.
    expect(screen.getByRole("button", { name: "Replay" })).toBeEnabled();
  });

  it("does not follow the operator out of the results with a derivation's answer", async () => {
    const user = userEvent.setup();
    const replays = holdEach(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/replays`);
    const { router } = renderResults();
    await user.click(await screen.findByRole("button", { name: "Replay" }));
    await waitFor(() => expect(replays.arrived).toHaveLength(1));

    // Off to the bench, which is not a results page: the answer has nowhere to be said.
    await user.click(screen.getByRole("link", { name: "Back to the live bench" }));
    await screen.findByRole("region", { name: "Customer composer" });
    replays.release();
    await waitFor(() => expect(replayed).toEqual([EXPERIMENT_ID]));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(router.state.location.pathname).toBe(`/lab/bench/${SHOP_ID}/${EXPERIMENT_ID}`);
  });

  it("says a derivation the lab refused where the operator is reading another run, not in its alert", async () => {
    const user = userEvent.setup();
    let answer: (() => void) | null = null;
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/${REPLAY_ID}/replays`, async () => {
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return HttpResponse.json(
          { code: "agent_runtime_unavailable", message: "no runtime here", request_id: "r" },
          { status: 422 },
        );
      }),
    );
    renderApp(`/lab/bench/${SHOP_ID}/${REPLAY_ID}/results`);
    const sourceName = "Wrong address — framework comparison";
    await screen.findByRole("heading", { level: 1, name: /\(replay\)$/ });
    await user.click(screen.getByRole("button", { name: "Replay" }));
    await user.click(screen.getByRole("link", { name: sourceName }));
    await screen.findByRole("heading", { level: 1, name: sourceName });
    await waitFor(() => expect(answer).not.toBeNull());

    await act(async () => {
      answer?.();
    });
    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "Where each derived arm stands" }),
      ).toHaveTextContent(/could not be run: no runtime here/),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: sourceName })).toBeVisible();
  });

  it("brings a refused replay back where it was, with focus, and clears its queue", async () => {
    const user = userEvent.setup();
    replayFails = true;
    renderResults();

    const replay = await screen.findByRole("button", { name: "Replay" });
    await user.click(replay);

    expect(await screen.findByRole("alert")).toHaveTextContent(/no runtime for this arm/);
    expect(replay).toHaveTextContent("Replay");
    expect(replay).toHaveFocus();
    expect(replay).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("status", { name: "Where each derived arm stands" })).toHaveTextContent(
      "",
    );
  });
});

/**
 * A replay and a fork name each arm, in their queue, by the version that arm will run, as it
 * was published (ADR 0065, amended 2026-10-04). The run under test recorded Atlas v1 and
 * Beacon v1; the lab lists both configurations under the names they were renamed to since.
 */
describe("a derivation's queue names each arm as its version was published", () => {
  const VERSION_ROUTE = "*/api/v1/agent-configurations/:configurationId/versions/:version";

  /** Holds the read of one configuration version until released; every other read answers. */
  function holdVersion(configurationId: string, version: number) {
    const waiting: (() => void)[] = [];
    let arrived = 0;
    server.use(
      http.get(VERSION_ROUTE, async ({ params }) => {
        if (params.configurationId === configurationId && Number(params.version) === version) {
          arrived += 1;
          await new Promise<void>((resolve) => waiting.push(resolve));
        }
        // Returning nothing hands the read on to the suite's own handler.
      }),
    );
    return { arrived: () => arrived, release: () => waiting.shift()?.() };
  }

  async function openFork(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "Fork…" }));
    return screen.findByRole("region", { name: "Fork this experiment" });
  }

  function derivedQueue() {
    return screen.getByRole("status", { name: "Where each derived arm stands" });
  }

  it("labels a replay and a fork of a renamed configuration alike, by the version each runs", async () => {
    const user = userEvent.setup();
    publishedNames = { [`${BEACON_ID}@2`]: "Beacon (second cut)" };
    const replays = holdEach(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/replays`);
    const forks = holdEach(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/forks`);
    const { router } = renderResults();

    // Replay runs the versions recorded, under the names the record gives them.
    await user.click(await screen.findByRole("button", { name: "Replay" }));
    await waitFor(() => expect(replays.arrived).toHaveLength(1));
    expect(queueRows(derivedQueue())).toEqual([
      "Arm A | Atlas v1 | running…",
      "Arm B | Beacon v1 | running…",
    ]);
    replays.release();
    await screen.findByRole("heading", { name: /\(replay\)$/ });

    // Back on the source, a fork that moves arm B alone: arm A keeps its recorded name, and
    // arm B is named by the version it moves to — not by the listing's cfg-beacon.
    await act(async () => {
      await router.navigate(`/lab/bench/${SHOP_ID}/${EXPERIMENT_ID}/results`);
    });
    const panel = await openFork(user);
    await user.selectOptions(within(panel).getAllByLabelText("Published version")[1], "2");
    const fork = within(panel).getByRole("button", { name: "Fork this run" });
    await waitFor(() => expectNotRefused(fork));
    await user.click(fork);
    await waitFor(() => expect(forks.arrived).toHaveLength(1));
    expect(queueRows(derivedQueue())).toEqual([
      "Arm A | Atlas v1 | running…",
      "Arm B | Beacon (second cut) v2 | running…",
    ]);
    forks.release();
    await screen.findByRole("heading", { name: /\(fork\)$/ });
  });

  it("holds Fork busy, never refused, while the version an arm moves to is read", async () => {
    const user = userEvent.setup();
    publishedNames = { [`${BEACON_ID}@2`]: "Beacon (second cut)" };
    const read = holdVersion(BEACON_ID, 2);
    renderResults();

    const panel = await openFork(user);
    await user.selectOptions(within(panel).getAllByLabelText("Published version")[1], "2");
    await waitFor(() => expect(read.arrived()).toBe(1));
    const fork = within(panel).getByRole("button", { name: "Fork this run" });
    // A wait (ADR 0063): busy, no reason given, and a press sends nothing.
    expectBusy(fork);
    expect(fork).toHaveTextContent("Fork this run");
    expect(within(panel).queryByText(/Change at least one arm/)).toBeNull();
    await user.click(fork);
    await user.keyboard("{Enter}");
    expect(forked).toEqual([]);

    read.release();
    await waitFor(() => expectNotRefused(fork));
    await user.click(fork);
    await waitFor(() => expect(forked).toHaveLength(1));
  });

  it("names no arm by a guess when the version it moves to cannot be read", async () => {
    const user = userEvent.setup();
    const forks = holdEach(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/forks`);
    server.use(
      http.get(VERSION_ROUTE, ({ params }) =>
        params.configurationId === BEACON_ID
          ? HttpResponse.json(
              { code: "internal_error", message: "unavailable", request_id: "r" },
              { status: 500 },
            )
          : undefined,
      ),
    );
    renderResults();

    const panel = await openFork(user);
    await user.selectOptions(within(panel).getAllByLabelText("Published version")[1], "2");
    const fork = within(panel).getByRole("button", { name: "Fork this run" });
    // The failed read holds nothing up: the fork can still run, only its name is unknown.
    await waitFor(() => expectNotRefused(fork));
    await user.click(fork);

    await waitFor(() => expect(forks.arrived).toHaveLength(1));
    expect(queueRows(derivedQueue())).toEqual([
      "Arm A | Atlas v1 | running…",
      "Arm B | v2, whose name could not be read | running…",
    ]);
    // Neither the listing's name nor the one the run recorded for another version.
    expect(derivedQueue()).not.toHaveTextContent(/cfg-beacon|Beacon v2/);
    forks.release();
    await screen.findByRole("heading", { name: /\(fork\)$/ });
  });

  it("never names an arm by a version it has since left", async () => {
    const user = userEvent.setup();
    publishedNames = {
      [`${ATLAS_ID}@4`]: "Atlas (fourth cut)",
      [`${ATLAS_ID}@2`]: "Atlas (second cut)",
    };
    const forks = holdEach(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/forks`);
    const read = holdVersion(ATLAS_ID, 2);
    renderResults();

    const panel = await openFork(user);
    // Arm B onto cfg-atlas, which opens on its newest version, v4, read at once…
    const configuration = within(panel).getAllByLabelText("Agent configuration")[1];
    await waitFor(() =>
      expect(within(configuration).getByRole("option", { name: "cfg-atlas" })).toBeEnabled(),
    );
    await user.selectOptions(configuration, "cfg-atlas");
    const fork = within(panel).getByRole("button", { name: "Fork this run" });
    await waitFor(() => expectNotRefused(fork));
    // …then straight onto v2, still being read: v4's answer says nothing about it.
    await user.selectOptions(within(panel).getAllByLabelText("Published version")[1], "2");
    await waitFor(() => expect(read.arrived()).toBe(1));
    expectBusy(fork);
    await user.click(fork);
    expect(forks.arrived).toHaveLength(0);

    read.release();
    await waitFor(() => expectNotRefused(fork));
    await user.click(fork);
    await waitFor(() => expect(forks.arrived).toHaveLength(1));
    expect(queueRows(derivedQueue())).toEqual([
      "Arm A | Atlas v1 | running…",
      "Arm B | Atlas (second cut) v2 | running…",
    ]);
    forks.release();
    await screen.findByRole("heading", { name: /\(fork\)$/ });
  });
});

describe("experiment results", () => {
  it("reads every objective the scenario composed with one column per arm", async () => {
    toolEvents = [toolEvent(ARM_A, 0, "support.read_document")];
    renderResults();

    await screen.findByRole("region", { name: "Objectives" });
    const row = within(objectivesGroup("Decided by a rule")).getByRole("row", {
      name: /Read the address-change policy/,
    });
    const [armA, armB] = within(row).getAllByRole("cell");

    // Each arm's outcome as a pill, its glyph beside its word, then the evidence sentence that
    // makes the cell a finding rather than a mark — drawn for everyone, not left to a hover.
    const met = within(armA).getByText("met");
    expect(met).toHaveClass("rounded-full", "bg-admin-published");
    expect(within(met).getByText("✓")).toHaveAttribute("aria-hidden", "true");
    expect(
      within(armA).getByText("support.read_document answered policy:address-change"),
    ).toBeVisible();
    const pending = within(armB).getByText("pending");
    expect(pending).toHaveClass("rounded-full", "bg-admin-border");
    expect(within(pending).getByText("·")).toHaveAttribute("aria-hidden", "true");
    expect(
      within(armB).getByText("support.read_document never answered policy:address-change"),
    ).toBeVisible();
    // Nothing the line says is said again where only some readers would find it.
    for (const cell of [armA, armB]) {
      expect(cell).not.toHaveAttribute("title");
      expect(cell.querySelector(".sr-only")).toBeNull();
    }
    // The objective by its statement, then its slug and its severity as a tag, a line each.
    const objective = within(row).getByRole("rowheader");
    expect(within(objective).getByText("Read the address-change policy")).toBeVisible();
    expect(within(objective).getByText("read-address-change-policy")).toHaveClass("font-mono");
    expect(within(objective).getByText("Required")).toHaveClass("rounded-full");
    expect(objective).not.toHaveTextContent("·");
    expect(within(objective).queryByText("must never happen")).toBeNull();
  });

  it("reads a missed rule-decided cell as its pill and the whole sentence that decided it", async () => {
    // The evidence the sheet mockup draws for a refused proposal, which the seeded run's control
    // policy never makes: a miss, readable from its cell without opening anything.
    const refused =
      "orders.propose_address_change was refused at turn 2: the customer had not confirmed the new address, so nothing was proposed.";
    serveObjectives((rows) =>
      rows.map((row) =>
        row.objective_id === "read-address-change-policy"
          ? { ...row, outcome: "missed" as const, detail: refused, decided_by: null }
          : row,
      ),
    );
    renderResults();

    await screen.findByRole("region", { name: "Objectives" });
    const row = within(objectivesGroup("Decided by a rule")).getByRole("row", {
      name: /Read the address-change policy/,
    });
    for (const cell of within(row).getAllByRole("cell")) {
      const missed = within(cell).getByText("missed");
      expect(missed).toHaveClass("rounded-full", "bg-lab-error-tint", "text-lab-error");
      expect(within(missed).getByText("✗")).toHaveAttribute("aria-hidden", "true");
      // Whole, every sentence of it, and not cut to its first.
      expect(within(cell).getByText(refused)).toBeVisible();
      expect(within(cell).queryByText("Verdict details")).toBeNull();
    }
  });

  it("says a forbidden objective must never happen, under its severity", async () => {
    serveObjectives((rows) =>
      rows.map((row) =>
        row.objective_id === "read-address-change-policy"
          ? { ...row, evidence: "forbidden" as const, severity: "expected" as const }
          : row,
      ),
    );
    renderResults();

    await screen.findByRole("region", { name: "Objectives" });
    const objective = within(
      within(objectivesGroup("Decided by a rule")).getByRole("row", {
        name: /Read the address-change policy/,
      }),
    ).getByRole("rowheader");
    expect(within(objective).getByText("Expected")).toHaveClass("rounded-full");
    expect(within(objective).getByText("must never happen")).toBeVisible();
  });

  it("holds every objective in one section, a rule's rows and a judge's in two labelled groups", async () => {
    renderResults();

    const section = await screen.findByRole("region", { name: "Objectives" });
    expect(
      within(section)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(["Decided by a rule", "Scored by a judge"]);
    // Each group's note is the footer of the card it was, under its heading.
    for (const [group, note] of [
      [
        "Decided by a rule",
        "Decided from each arm's own recorded calls and the state it started in and is in now.",
      ],
      [
        "Scored by a judge",
        "Each arm is judged on an anonymized record of its own run, and the judge is told nothing about what ran it.",
      ],
    ] as const) {
      const heading = within(section).getByRole("heading", { level: 3, name: group });
      expect(heading.nextElementSibling).toHaveTextContent(note);
    }
    // One section where there were two cards.
    expect(screen.queryByRole("region", { name: "Deterministic evidence" })).toBeNull();
    expect(screen.queryByRole("region", { name: "LLM judge evidence" })).toBeNull();
  });

  it("says so in a group's place when the scenario composes none of its objectives", async () => {
    serveObjectives((rows) => rows.filter((row) => row.assessment === "deterministic"));
    const { unmount } = renderResults();

    const section = await screen.findByRole("region", { name: "Objectives" });
    expect(
      within(section).getByText("This scenario leaves no objective to a judge."),
    ).toBeVisible();
    expect(within(section).queryByRole("table", { name: "Scored by a judge" })).toBeNull();
    // Nothing to score, so no judge to pick.
    expect(within(section).queryByRole("combobox", { name: "Judge" })).toBeNull();
    expect(within(section).queryByRole("button", { name: /Score/ })).toBeNull();
    unmount();

    serveObjectives((rows) => rows.filter((row) => row.assessment === "judge"));
    renderResults();

    const judgedOnly = await screen.findByRole("region", { name: "Objectives" });
    expect(
      within(judgedOnly).getByText("This scenario composes no objective a rule decides."),
    ).toBeVisible();
    expect(within(judgedOnly).queryByRole("table", { name: "Decided by a rule" })).toBeNull();
    expect(within(judgedOnly).getByRole("table", { name: "Scored by a judge" })).toBeVisible();
  });

  it("stacks the evidence at a phone's width rather than scrolling it inside the page", async () => {
    stubViewport("narrow");
    stateDiffs = { [ARM_A]: seededDiff(ARM_A_WORLD), [ARM_B]: seededDiff(ARM_B_WORLD) };
    const user = userEvent.setup();
    renderResults();

    const objectives = await screen.findByRole("region", { name: "Objectives" });
    const state = screen.getByRole("region", { name: "Business state" });
    await user.click(
      within(state).getByRole("button", { name: "Every changed field of NS-10482 (17)" }),
    );

    // Each objective's row stacks, its cells under a line naming their arm (ADR 0080).
    const row = within(objectivesGroup("Decided by a rule")).getByRole("row", {
      name: /Read the address-change policy/,
    });
    expect(row).toHaveClass("block");
    expect(
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.firstElementChild?.firstElementChild?.textContent),
    ).toEqual(["Arm A", "Arm B"]);
    // So does every field, its assessment last under a line naming its column.
    const field = rowOf(
      within(state).getByRole("table", { name: "Every field of NS-10482 each arm changed" }),
      "shipping_address.city",
    );
    expect(field).toHaveClass("block");
    expect(
      within(field)
        .getAllByRole("cell")
        .map((cell) => cell.firstElementChild?.firstElementChild?.textContent),
    ).toEqual(["Arm A", "Arm B", "Assessment"]);
    // Nothing on General scrolls inside the page: no table keeps a scroller of its own.
    const sheet = objectives.parentElement as HTMLElement;
    expect(sheet.querySelector(".overflow-x-auto, .overflow-auto, .overflow-x-scroll")).toBeNull();
  });

  it("shows a judge's first sentence, and keeps the rest and who gave it under Verdict details", async () => {
    scored = true;
    judgeRationale =
      "The arm named the order back to the customer. It then said the city had moved to Lyon.";
    const user = userEvent.setup();
    renderResults();

    await screen.findByRole("region", { name: "Objectives" });
    const row = within(objectivesGroup("Scored by a judge")).getByRole("row", {
      name: /Explain the outcome/,
    });
    const [armA] = within(row).getAllByRole("cell");

    // The pill, then one line: the rationale's first sentence.
    expect(within(armA).getByText("met")).toHaveClass("rounded-full");
    expect(within(armA).getByText("The arm named the order back to the customer.")).toBeVisible();
    // The rest of the reason, and who gave it, wait behind one disclosure, closed.
    const summary = within(armA).getByText("Verdict details");
    const details = summary.closest("details") as HTMLElement;
    expect(details).not.toHaveAttribute("open");
    expect(within(details).getByText(judgeRationale)).not.toBeVisible();

    await user.click(summary);

    expect(details).toHaveAttribute("open");
    expect(within(details).getByText(judgeRationale)).toBeVisible();
    // The judge by the name it was published under, with its version, its model and the
    // attempt, and the brief it read by its fingerprint.
    expect(
      await within(details).findByText(
        "Judged by Resolution quality, version 2, on gpt-5-mini — attempt 1.",
      ),
    ).toBeVisible();
    expect(within(details).getByText(`${"e".repeat(12)}…`)).toHaveAttribute(
      "title",
      "e".repeat(64),
    );
    // One disclosure in each judged cell, and no list of verdicts beside the rows any more.
    expect(within(row).getAllByText("Verdict details")).toHaveLength(2);
    expect(screen.queryByText(/judge v2 · /)).toBeNull();
  });

  it("says why a judge execution produced no verdict, as an attempt and never a judgement", async () => {
    scored = true;
    judgeFailed = true;
    const user = userEvent.setup();
    renderResults();

    await screen.findByRole("region", { name: "Objectives" });
    const row = within(objectivesGroup("Scored by a judge")).getByRole("row", {
      name: /Explain the outcome/,
    });
    const [armA] = within(row).getAllByRole("cell");
    // Not left blank: the row is still the judge's to score, and the line says why. A sentence,
    // so the cell's first line and not a pill it would wrap inside.
    const outcome = within(armA).getByText("a judge scores this after the run");
    expect(outcome).toBeVisible();
    expect(outcome).not.toHaveClass("rounded-full");
    expect(within(armA).getAllByText("the judge could not be reached")[0]).toBeVisible();
    await user.click(within(armA).getByText("Verdict details"));

    // The outage is the lab's: the arm was not judged, and the disclosure does not say it was.
    expect(
      await within(armA).findByText(
        "Attempted by Resolution quality, version 2, on gpt-5-mini — attempt 1; no verdict: the provider was briefly unavailable.",
      ),
    ).toBeVisible();
    expect(within(armA).queryByText(/Judged by/)).toBeNull();
  });

  it("says in words what the offline control judge does not read, beside its mark", async () => {
    scored = true;
    judgeProvider = "fake";
    judgeRationale = "the arm answered every turn it received (1 of them)";
    renderResults();

    await screen.findByRole("region", { name: "Objectives" });
    const row = within(objectivesGroup("Scored by a judge")).getByRole("row", {
      name: /Explain the outcome/,
    });

    for (const cell of within(row).getAllByRole("cell")) {
      expect(
        within(cell).getByText(
          "Offline control judge: it checks that every turn was answered, not what the reply said.",
        ),
      ).toBeVisible();
      // A one-sentence rationale is the line, said once: Verdict details does not repeat it.
      expect(within(cell).getAllByText(judgeRationale)).toHaveLength(1);
    }
  });

  it("says nothing of the control's limit on a verdict another provider's judge gave", async () => {
    scored = true;
    renderResults();

    await screen.findByRole("region", { name: "Objectives" });
    const judged = objectivesGroup("Scored by a judge");
    await within(judged).findAllByText("the arm named the order and said what it changed");

    expect(within(judged).queryByText(/Offline control judge/)).toBeNull();
  });

  it("counts each arm against what was decided for it, and never into one score", async () => {
    toolEvents = [toolEvent(ARM_A, 0, "support.read_document")];
    renderResults();

    const armA = await screen.findByRole("region", { name: "Arm A summary" });
    const armB = screen.getByRole("region", { name: "Arm B summary" });

    // Arm A met the one row something decided; nothing has decided a row for arm B yet, so
    // its denominator is zero rather than a miss it has not made.
    expect(within(armA).getByText("1 of 1")).toBeVisible();
    expect(within(armB).getByText("0 of 0")).toBeVisible();
    expect(within(armA).getByText("decided objectives met")).toBeVisible();
    expect(screen.getByText(/There is no aggregate score/)).toBeVisible();
  });

  it("counts each arm's turns from one on its card, in the bench's own words", async () => {
    // Arm A driven to the cap and answered there; arm B never run on the trigger.
    maxTurns = 1;
    turns = [...OPENED, turn(ARM_A, 1, "reply-1", "Any update?")];
    agentTurns = [agentTurn(ARM_A, 0), agentTurn(ARM_A, 1)];
    renderResults();

    const armA = await screen.findByRole("region", { name: "Arm A summary" });
    const armB = screen.getByRole("region", { name: "Arm B summary" });

    expect(within(armA).getByText("Completed — answered 2 of 2 turns")).toBeVisible();
    expect(within(armB).getByText("Waiting for the agent at turn 1")).toBeVisible();
    expect(screen.queryByText(/at turn 0|Completed at turn/)).toBeNull();
  });

  it("says on its card that an arm missed a requirement, in words and with the mark", async () => {
    // Arm A completed without ever reading the policy its required objective names.
    maxTurns = 1;
    turns = [...OPENED, turn(ARM_A, 1, "reply-1", "Any update?")];
    agentTurns = [agentTurn(ARM_A, 0), agentTurn(ARM_A, 1)];
    renderResults();

    const armA = await screen.findByRole("region", { name: "Arm A summary" });
    const armB = screen.getByRole("region", { name: "Arm B summary" });

    const missed = await within(armA).findByText("missed a requirement", { exact: false });
    expect(missed).toHaveClass("text-lab-error");
    expect(missed).toHaveTextContent(/^✗ missed a requirement$/);
    expect(missed.querySelector("[aria-hidden]")).toHaveTextContent("✗");
    // The arm still waiting has missed nothing yet, and says nothing of the kind.
    expect(within(armB).queryByText(/missed a requirement/)).toBeNull();
  });

  it("names each arm's framework by its label, as History does, and not by its id", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}`, () => {
        const record = experiment(turns, agentTurns, toolEvents, mutationEvents);
        const [first, second] = record.runs;
        return HttpResponse.json({
          ...record,
          runs: [{ ...first, framework_id: "pydantic-ai", model_id: "gpt-5-mini" }, second],
        } satisfies ExperimentResponse);
      }),
    );
    renderResults();

    const armA = await screen.findByRole("region", { name: "Arm A summary" });
    const armB = screen.getByRole("region", { name: "Arm B summary" });

    expect(await within(armA).findByText("Pydantic AI · gpt-5-mini")).toBeVisible();
    expect(within(armB).getByText("Deterministic fake · deterministic")).toBeVisible();
    expect(screen.queryByText(/^(pydantic-ai|fake) · /)).toBeNull();
  });

  it("names a framework the catalog does not hold by the id its run recorded", async () => {
    // History's own rule (`_framework_label`): a framework no longer proven keeps its id.
    server.use(
      http.get("*/api/v1/agent-configurations/resources", () =>
        HttpResponse.json({
          ...FRAMEWORK_CATALOG,
          frameworks: FRAMEWORK_CATALOG.frameworks.filter((entry) => entry.framework_id !== "fake"),
        } satisfies AgentConfigurationResourcesResponse),
      ),
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}`, () => {
        const record = experiment(turns, agentTurns, toolEvents, mutationEvents);
        const [first, second] = record.runs;
        return HttpResponse.json({
          ...record,
          runs: [{ ...first, framework_id: "pydantic-ai", model_id: "gpt-5-mini" }, second],
        } satisfies ExperimentResponse);
      }),
    );
    renderResults();

    const armA = await screen.findByRole("region", { name: "Arm A summary" });
    const armB = screen.getByRole("region", { name: "Arm B summary" });

    // Arm A's label says the catalog has answered; it holds nothing for arm B's framework.
    expect(await within(armA).findByText("Pydantic AI · gpt-5-mini")).toBeVisible();
    expect(within(armB).getByText("fake · deterministic")).toBeVisible();
  });

  it("does not name the framework again when the arm's label already ends with it", async () => {
    // The seeded demo labels its arms "Arm A — Pydantic AI" (`seed/demo.py`): History's rule.
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}`, () => {
        const record = experiment(turns, agentTurns, toolEvents, mutationEvents);
        const [first, second] = record.runs;
        return HttpResponse.json({
          ...record,
          runs: [
            {
              ...first,
              label: "Arm A — Pydantic AI",
              framework_id: "pydantic-ai",
              model_id: "gpt-5-mini",
            },
            second,
          ],
        } satisfies ExperimentResponse);
      }),
    );
    renderResults();

    const armA = await screen.findByRole("region", { name: "Arm A — Pydantic AI summary" });
    const armB = screen.getByRole("region", { name: "Arm B summary" });

    // Arm B's line says the catalog has answered; arm A's names the model alone.
    expect(await within(armB).findByText("Deterministic fake · deterministic")).toBeVisible();
    expect(within(armA).getByText("gpt-5-mini")).toBeVisible();
    expect(within(armA).queryByText(/Pydantic AI · /)).toBeNull();
  });

  it("names the model alone while the catalog is still on its way", async () => {
    // Held open: the card must not show the id now and swap it for the label later.
    server.use(
      http.get("*/api/v1/agent-configurations/resources", async () => {
        await delay("infinite");
        return HttpResponse.json(FRAMEWORK_CATALOG);
      }),
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}`, () => {
        const record = experiment(turns, agentTurns, toolEvents, mutationEvents);
        const [first, second] = record.runs;
        return HttpResponse.json({
          ...record,
          runs: [{ ...first, framework_id: "pydantic-ai", model_id: "gpt-5-mini" }, second],
        } satisfies ExperimentResponse);
      }),
    );
    renderResults();

    const armA = await screen.findByRole("region", { name: "Arm A summary" });

    expect(within(armA).getByText("gpt-5-mini")).toBeVisible();
    expect(within(armA).queryByText(/pydantic-ai · /)).toBeNull();
  });

  it("names the framework by the id its run recorded when the catalog cannot be read", async () => {
    server.use(
      http.get("*/api/v1/agent-configurations/resources", () =>
        HttpResponse.json(
          { code: "internal_error", message: "The lab could not complete the request." },
          { status: 500 },
        ),
      ),
    );
    renderResults();

    const armA = await screen.findByRole("region", { name: "Arm A summary" });

    expect(await within(armA).findByText("fake · deterministic")).toBeVisible();
  });

  it("names an arm's configuration on its chip, never the arm's own label again", async () => {
    // The seeded run labels each arm with its configuration's name.
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}`, () => {
        const record = experiment(turns, agentTurns, toolEvents, mutationEvents);
        const [first, second] = record.runs;
        return HttpResponse.json({
          ...record,
          runs: [{ ...first, label: "Atlas" }, second],
        } satisfies ExperimentResponse);
      }),
    );
    renderResults();

    const armA = await screen.findByRole("region", { name: "Atlas summary" });
    const version = within(armA).getByRole("link", { name: "configuration v1" });

    expect(version).toHaveAttribute("href", `/lab/agent-configurations/${ATLAS_ID}`);
    expect(within(armA).queryByText("Atlas v1")).toBeNull();
  });

  it("keeps the figures off the summary row and draws every one in Usage", async () => {
    turns = [...OPENED];
    agentTurns = [agentTurn(ARM_A, 0)];
    toolEvents = [
      toolEvent(ARM_A, 0, "orders.read_order"),
      toolEvent(ARM_A, 1, "support.read_document"),
    ];
    renderResults();

    const armA = await screen.findByRole("region", { name: "Arm A summary" });
    // The summary says what ran and where it stands; what it spent is read beside the other arm.
    expect(within(armA).queryByRole("list")).toBeNull();
    expect(within(armA).queryByText(/tool calls?|tokens|USD|\d\.\ds/)).toBeNull();

    const usage = screen.getByRole("region", { name: "Usage" });
    expect(sheetCells(usage, "Tool calls")).toEqual(["2", "0"]);
    expect(sheetCells(usage, "Tokens, in and out")).toEqual(["0", "not reported"]);
    expect(sheetCells(usage, "Time in attempts")).toEqual(["2.1s", "not reported"]);
    expect(sheetCells(usage, "Estimated cost")).toEqual(["0.00 USD", "not priced"]);
    expect(sheetCells(usage, "Turns")).toEqual(["1"]);
  });

  it("says in Usage what nobody measured, what is a floor, and a retry in the error ink", async () => {
    turns = [...OPENED];
    agentTurns = [agentTurn(ARM_A, 0, 1, "model_provider"), agentTurn(ARM_A, 0, 2)];
    renderResults();

    const usage = await screen.findByRole("region", { name: "Usage" });

    // The failed attempt metered nothing, so the tokens and the cost are a floor.
    expect(sheetCells(usage, "Tokens, in and out")).toEqual(["≥0", "not reported"]);
    expect(sheetCells(usage, "Estimated cost")).toEqual(["≥0.00 USD", "not priced"]);
    // Arm B has not run: no tokens, no time and no cost were measured, so none is written as 0.
    expect(sheetCells(usage, "Time in attempts")).toEqual(["4.2s", "not reported"]);
    // The retry is said in the error ink, in the arm's cell that needed it and in no other.
    const [retriedA, retriedB] = within(sheetRow(usage, "Retries")).getAllByRole("cell");
    expect(retriedA).toHaveTextContent("1");
    expect(retriedA).toHaveClass("text-lab-error");
    expect(retriedB).toHaveTextContent("0");
    expect(retriedB).not.toHaveClass("text-lab-error");
  });

  it("holds Replay and Fork in the header beside the run's name, as the frame draws them", async () => {
    renderResults();

    const title = await screen.findByRole("heading", {
      level: 1,
      name: "Wrong address — framework comparison",
    });
    const header = title.closest("header") as HTMLElement;

    expect(within(header).getByRole("button", { name: "Replay" })).toBeVisible();
    expect(within(header).getByRole("button", { name: "Fork…" })).toBeVisible();
  });

  it("keeps a retry both arms needed in the error ink, folded with what they share", async () => {
    turns = [...OPENED];
    agentTurns = [
      agentTurn(ARM_A, 0, 1, "model_provider"),
      agentTurn(ARM_A, 0, 2),
      agentTurn(ARM_B, 0, 1, "model_provider"),
      agentTurn(ARM_B, 0, 2),
    ];
    renderResults();

    const usage = await screen.findByRole("region", { name: "Usage" });
    const retries = sheetRow(usage, "Retries");

    // Shared, so folded into one spanning cell behind the disclosure — and still red.
    expect(retries.closest("details")).not.toBeNull();
    expect(sheetCells(usage, "Retries")).toEqual(["1"]);
    expect(within(retries).getByText("1")).toHaveClass("text-lab-error");
    // A shared measure that is not a retry keeps the plain ink.
    expect(within(sheetRow(usage, "Turns")).getByText("1")).not.toHaveClass("text-lab-error");
  });

  it("sums an arm's input and output tokens in Usage, and says how much of its time was timed", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}`, () => {
        const record = experiment(turns, agentTurns, toolEvents, mutationEvents);
        const [first, second] = record.runs;
        return HttpResponse.json({
          ...record,
          runs: [
            {
              ...first,
              metrics: {
                ...first.metrics,
                turns: 2,
                attempts: 3,
                retries: 1,
                measured_attempts: 2,
                metered_attempts: 3,
                duration_ms: 8400,
                usage: { input_tokens: 6200, output_tokens: 3000, model_requests: 3 },
                estimated_cost: null,
              },
            },
            second,
          ],
        } satisfies ExperimentResponse);
      }),
    );
    renderResults();

    const usage = await screen.findByRole("region", { name: "Usage" });

    // Every attempt metered, so 6.2k in and 3.0k out is a whole 9.2k; one attempt went
    // untimed, so 8.4s is what the other two took, and the row says of how many.
    expect(sheetCells(usage, "Tokens, in and out")[0]).toBe("9.2k");
    expect(sheetCells(usage, "Input tokens")[0]).toBe("6.2k");
    expect(sheetCells(usage, "Time in attempts")[0]).toBe("8.4s (2 of 3)");
  });

  it("links each arm's configuration version to the draft that published it", async () => {
    const user = userEvent.setup();
    const { router } = renderResults();

    const armA = await screen.findByRole("region", { name: "Arm A summary" });
    const version = within(armA).getByRole("link", { name: "Atlas v1" });

    expect(version).toHaveAttribute("href", `/lab/agent-configurations/${ATLAS_ID}`);
    // The editor names only the latest published version, so the link carries the one pinned.
    expect(version).toHaveAttribute("title", "Open Atlas, whose draft published v1");
    expect(
      within(screen.getByRole("region", { name: "Arm B summary" })).getByRole("link", {
        name: "Beacon v1",
      }),
    ).toHaveAttribute("href", `/lab/agent-configurations/${BEACON_ID}`);

    await user.click(version);

    expect(router.state.location.pathname).toBe(`/lab/agent-configurations/${ATLAS_ID}`);
  });

  it("links every version the run pinned to what it pinned, the shop to its own version page", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}`, () => {
        const record = experiment(turns, agentTurns, toolEvents, mutationEvents);
        return HttpResponse.json({
          ...record,
          sandbox_inputs: [
            ...record.sandbox_inputs,
            {
              definition_type: "shop",
              definition_id: SHOP_ID,
              version: 3,
              content_fingerprint: "e".repeat(64),
            },
            {
              definition_type: "ticket",
              definition_id: TICKET_ID,
              version: 2,
              content_fingerprint: "f".repeat(64),
            },
            {
              definition_type: "warehouse",
              definition_id: TICKET_ID,
              version: 1,
              content_fingerprint: "0".repeat(64),
            },
          ],
        } satisfies ExperimentResponse);
      }),
    );
    renderResults();

    const provenance = await screen.findByRole("region", { name: "Provenance" });
    const strip = within(provenance).getByRole("link", { name: "scenario v1" });

    expect(strip).toHaveAttribute("href", `/shops/${SHOP_ID}/scenarios/${SCENARIO_ID}`);
    expect(within(provenance).getByRole("link", { name: "Shop v3" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/versions/3`,
    );
    expect(within(provenance).getByRole("link", { name: "Ticket v2" })).toHaveAttribute(
      "href",
      `/shops/${SHOP_ID}/tickets/${TICKET_ID}`,
    );
    // The scenario is pinned once, however many times the record lists it.
    expect(within(provenance).getAllByText(/^scenario v1$/i)).toHaveLength(1);
    // A type this build does not know stays the chip it was rather than a link to nowhere.
    expect(within(provenance).getByText("warehouse v1")).not.toHaveAttribute("href");
    expect(within(provenance).queryByRole("link", { name: "warehouse v1" })).toBeNull();
  });

  it("keeps the rows a judge owns out of the rule's group", async () => {
    renderResults();

    await screen.findByRole("region", { name: "Objectives" });

    expect(
      within(objectivesGroup("Decided by a rule")).queryByText(
        "Explain the outcome to the customer",
      ),
    ).toBeNull();
    expect(
      within(objectivesGroup("Scored by a judge")).getByText("Explain the outcome to the customer"),
    ).toBeVisible();
  });

  it("names the judge, the version, the model, and the attempt behind a verdict", async () => {
    const user = userEvent.setup();
    renderResults();

    const section = await screen.findByRole("region", { name: "Objectives" });
    // Awaited: the published judges arrive on their own read, and the control appears with
    // them — before that the section says a judge owns these rows and offers nothing.
    await user.click(await within(section).findByRole("button", { name: /Score 1 judged/ }));

    await waitFor(() => expect(scoredBy).toEqual([{ judge_id: JUDGE_ID }]));
    // Each judged cell's own disclosure says what produced its verdict.
    expect(
      await within(objectivesGroup("Scored by a judge")).findAllByText(
        "Judged by Resolution quality, version 2, on gpt-5-mini — attempt 1.",
      ),
    ).toHaveLength(2);
    // Scoring again is offered as what it is: the previous verdict stands and a new attempt
    // is recorded beside it.
    expect(within(section).getByRole("button", { name: "Score again" })).toBeVisible();
  });

  it("reads what each arm spent, and says so where nobody measured", async () => {
    agentTurns = [agentTurn(ARM_A, 0)];
    toolEvents = [toolEvent(ARM_A, 0, "orders.read_order")];
    renderResults();

    const usage = await screen.findByRole("region", { name: "Usage" });

    // Arm A metered itself; the arm that never ran reports nothing rather than a zero an
    // operator would read as a measurement somebody took.
    expect(sheetCells(usage, "Model requests")).toEqual(["0", "not reported"]);
    expect(sheetCells(usage, "Attempts")).toEqual(["1", "0"]);
  });

  it("draws the measures the arms differ on first and larger, and folds the rest under their count", async () => {
    agentTurns = [agentTurn(ARM_A, 0)];
    toolEvents = [toolEvent(ARM_A, 0, "orders.read_order")];
    renderResults();

    const usage = await screen.findByRole("region", { name: "Usage" });
    const [drawn, folded] = within(usage).getAllByRole("table", { hidden: true });
    const labels = (table: HTMLElement) =>
      within(table)
        .getAllByRole("rowheader", { hidden: true })
        .map((header) => header.firstElementChild?.firstElementChild?.textContent);

    // Every row drawn open is one the arms differ on, says so in words, and draws its figures
    // larger; every folded row is one they share, drawn once across the arms.
    const differing = labels(drawn);
    expect(differing).toEqual([
      "Answered turns",
      "Attempts",
      "Tool calls",
      "Model requests",
      "Tokens, in and out",
      "Input tokens",
      "Output tokens",
      "Time in attempts",
      "Time in tools",
      "Estimated cost",
    ]);
    for (const row of within(drawn).getAllByRole("row").slice(1)) {
      expect(row).toHaveClass("bg-admin-differs");
      expect(within(row).getByText("Differs")).toBeVisible();
      for (const cell of within(row).getAllByRole("cell")) {
        expect(cell.querySelector(".font-bold.text-\\[16px\\]")).not.toBeNull();
      }
    }
    const shared = labels(folded);
    expect(shared).toEqual(["Turns", "Retries", "Failures", "Writes"]);
    // Fourteen measures in all: none dropped, none drawn twice.
    expect(differing.length + shared.length).toBe(14);
    const disclosure = within(usage).getByText("4 measures are the same for both arms");
    expect(disclosure.tagName).toBe("SUMMARY");
    expect(disclosure.closest("details")).not.toHaveAttribute("open");
    // One value across both arms, drawn whole.
    expect(sheetCells(usage, "Failures")).toEqual(["none"]);
  });

  it("marks in Outcome the turn one arm alone received", async () => {
    turns = [...OPENED, turn(ARM_B, 1, "composition-1", "Yes, go ahead.")];
    renderResults();

    const outcome = await screen.findByRole("region", { name: "Outcome" });

    // One spanning row says the comparison is not controlled, the old footer on the cell's side.
    const verdict = sheetRow(outcome, "Input divergence");
    expect(within(verdict).getAllByRole("cell")).toHaveLength(1);
    expect(
      within(verdict).getByText(
        "Not every turn reached both arms as one composition, so the comparison is not controlled.",
      ),
    ).toBeVisible();
    const footer = within(verdict).getByText(
      "One send is one composition however many arms it reaches.",
    );
    expect(footer.closest("td")).not.toBeNull();
    expect(within(verdict).getByRole("rowheader")).toHaveTextContent(/^Input divergence$/);
    // Then a row per divergent turn — the second, counted from one as the summary row counts
    // it — with what each arm heard in its own column.
    expect(within(outcome).queryByRole("row", { name: /^Turn 1/ })).toBeNull();
    expect(sheetCells(outcome, "Turn 2")).toEqual(["never received this turn", "“Yes, go ahead.”"]);
    expect(within(outcome).queryByText(/the comparison is controlled/)).toBeNull();
  });

  it("reads a controlled comparison as controlled, in Outcome above the evidence", async () => {
    renderResults();

    const outcome = await screen.findByRole("region", { name: "Outcome" });
    const row = within(outcome).getByRole("row", { name: /^Input divergence/ });

    expect(within(row).getByText(/the comparison is controlled/)).toBeVisible();
    expect(within(row).getByText("✓")).toHaveAttribute("aria-hidden", "true");
    // The card's footer is the row's second line.
    expect(
      within(row).getByText("One send is one composition however many arms it reaches."),
    ).toBeVisible();
    // Above the evidence it governs.
    const evidence = screen.getByRole("region", { name: "Objectives" });
    expect(outcome.compareDocumentPosition(evidence) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("reports a judge the lab could not reach rather than leaving the row blank", async () => {
    // The lab's own outage is a fact about the lab. A cell that simply stayed empty would
    // read as an arm nobody thought worth judging.
    judgeFailed = true;
    const user = userEvent.setup();
    renderResults();

    const section = await screen.findByRole("region", { name: "Objectives" });
    await user.click(await within(section).findByRole("button", { name: /Score 1 judged/ }));

    const judged = objectivesGroup("Scored by a judge");
    // Each arm's cell says, on its line, that no verdict came back; its disclosure says why.
    await waitFor(() =>
      expect(
        within(judged).getAllByText(/; no verdict: the provider was briefly unavailable\.$/),
      ).toHaveLength(2),
    );
    for (const cell of within(judged).getAllByRole("cell")) {
      expect(within(cell).getAllByText("the judge could not be reached")[0]).toBeVisible();
    }
  });

  it("says a scoring pass the lab refused at the section's foot, beside the press", async () => {
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/judgements`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "the judge store is unavailable", request_id: "r" },
          { status: 500 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderResults();

    const section = await screen.findByRole("region", { name: "Objectives" });
    const score = await within(section).findByRole("button", { name: /Score 1 judged/ });
    await user.click(score);

    const alert = await within(section).findByRole("alert");
    expect(alert).toHaveTextContent("the judge store is unavailable");
    // In the foot with the press, under both groups, rather than at the top of the page.
    expect(alert.parentElement).toContainElement(score);
    expect(
      objectivesGroup("Scored by a judge").compareDocumentPosition(alert) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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

  it("draws the open depth tab apart from the others, not only announces it", async () => {
    const user = userEvent.setup();
    renderResults();

    const tabs = await screen.findByRole("navigation", {
      name: "Results views",
    });
    await user.click(within(tabs).getByRole("link", { name: "Traces" }));

    // The prototype's mark: a clay underline under a heavier ink. Each assertion pairs the
    // painted state with the announced one, so neither can stand in for the other.
    const open = within(tabs).getByRole("link", { name: "Traces" });
    expect(open).toHaveAttribute("aria-current", "page");
    expect(open).toHaveClass("border-lab-accent", "font-bold");
    for (const name of ["General", "Conversation", "Execution timeline"]) {
      const idle = within(tabs).getByRole("link", { name });
      expect(idle).not.toHaveAttribute("aria-current");
      expect(idle).toHaveClass("border-transparent", "font-semibold");
      expect(idle).not.toHaveClass("border-lab-accent");
      expect(idle).not.toHaveClass("font-bold");
    }
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
    expect(screen.queryByRole("region", { name: "Objectives" })).toBeNull();
  });

  it("reads what moved each arm from its revisions rather than from what it said", async () => {
    toolEvents = [toolEvent(ARM_A, 0, "orders.apply_address_change", true)];
    mutationEvents = [mutationEvent(ARM_B, 0)];
    renderResults();

    const state = await screen.findByRole("region", { name: "Business state" });

    // Each write in its arm's column, its name over the revision it moved the world across. The
    // scenario's own fault is a writer beside the tools: two arms at different revisions is
    // only explainable when both writers are on the page.
    expect(sheetCells(state, "Scenario fault")).toEqual([
      "None",
      "order-moves-under-the-armRevision r0 → r1",
    ]);
    expect(sheetCells(state, "Agent write")).toEqual([
      "orders.apply_address_changeRevision r0 → r1",
      "None",
    ]);
    // One fact per line: the name and its move are two lines, never "a · b".
    const write = within(sheetRow(state, "Agent write")).getByText("orders.apply_address_change");
    expect(write.nextElementSibling).toHaveTextContent(/^Revision r0 → r1$/);
    expect(state).not.toHaveTextContent(" · ");
  });

  it("says what each write moved the world to, group by group", async () => {
    toolEvents = [toolEvent(ARM_A, 0, "orders.apply_address_change", true)];
    stateDiffs = { [ARM_A]: REDIRECTED };
    renderResults();

    const state = await screen.findByRole("region", { name: "Business state" });
    // The order the customer quotes is a row of its own, and in each arm's column what about it
    // moved: the groups counted, then one a line. The scenario's own fault moved the same world,
    // so its group is among them.
    const [moved, untouched] = within(sheetRow(state, "Order NS-10482")).getAllByRole("cell");
    expect(lines(moved)).toEqual(["2 groups changed", "shipping address", "fulfillment"]);
    expect(untouched).toHaveTextContent(/^No field of this order changed\.$/);
    // The claim the section makes, checked rather than assumed, under where each world is now.
    const [nowA, nowB] = within(sheetRow(state, "Fingerprint now")).getAllByRole("cell");
    expect(nowA).toHaveTextContent("No other state changed.");
    expect(nowB).toHaveTextContent("Nothing wrote — this arm's world is the one it started in.");
    expect(nowB).not.toHaveTextContent("No other state changed.");

    // The values a revision counter cannot say, one press away: one arm changed fields the other
    // did not, so each keeps its own column, a row per group.
    await userEvent.click(
      within(state).getByRole("button", { name: "Every changed field of NS-10482 (3)" }),
    );
    const fields = within(state).getByRole("table", {
      name: "Every field of NS-10482 each arm changed",
    });
    const [cityA, cityB] = within(sheetRow(fields, "shipping address")).getAllByRole("cell");
    expect(within(cityA).getByText("shipping_address.city").nextElementSibling).toHaveTextContent(
      "Bordeaux → Lyon",
    );
    expect(cityB).toHaveTextContent(/^Nothing in this group changed\.$/);
    expect(within(fields).getByText("fulfilment.status").nextElementSibling).toHaveTextContent(
      "unfulfilled → partially_fulfilled",
    );
  });

  it("counts each arm's groups on a line, then names one group a line", async () => {
    stateDiffs = { [ARM_A]: seededDiff(ARM_A_WORLD), [ARM_B]: seededDiff(ARM_B_WORLD) };
    renderResults();

    const state = await screen.findByRole("region", { name: "Business state" });

    // Seventeen paths read as three groups: the biggest first, the history counted by the
    // entries it gained rather than by their eight fields.
    for (const cell of within(sheetRow(state, "Order NS-10482")).getAllByRole("cell")) {
      expect(lines(cell)).toEqual([
        "3 groups changed",
        "shipping address",
        "fulfillment",
        "2 events added",
      ]);
      expect(cell).not.toHaveTextContent("shipping_address.city");
    }
    // Every path is still one press away, and nowhere else until then.
    expect(within(state).queryByRole("table", { name: /^Every field/ })).toBeNull();
    expect(within(state).queryByRole("table", { name: /^Where the arms differ/ })).toBeNull();
    expect(
      within(state).getByRole("button", { name: "Every changed field of NS-10482 (17)" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("sets the arms side by side, grouped, with every path behind the disclosure", async () => {
    const diffs = { [ARM_A]: seededDiff(ARM_A_WORLD), [ARM_B]: seededDiff(ARM_B_WORLD) };
    stateDiffs = diffs;
    renderResults();

    const state = await screen.findByRole("region", { name: "Business state" });
    await userEvent.click(
      within(state).getByRole("button", { name: "Every changed field of NS-10482 (17)" }),
    );
    const table = within(state).getByRole("table", {
      name: "Every field of NS-10482 each arm changed",
    });

    // One table on the sheet's columns, the arms under their names and the assessment the table
    // adds after them; what each field was is the column the paths are in.
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Field and what it was", "Arm A", "Arm B", "Assessment"]);
    // Grouped by the path's first segment, in the summary's order.
    expect(
      within(table)
        .getAllByRole("rowheader")
        .filter((cell) => cell.getAttribute("scope") === "rowgroup")
        .map((cell) => cell.textContent),
    ).toEqual(["shipping address", "fulfillment", "events"]);
    // Exhaustive (ADR 0035): every path the backend served is a row, and nothing else is.
    const paths = within(table)
      .getAllByRole("rowheader")
      .filter((cell) => cell.getAttribute("scope") === "row")
      .map((cell) => cell.querySelector(".font-mono")?.textContent);
    expect([...paths].sort()).toEqual(
      (diffs[ARM_A].orders[0]?.changes ?? []).map((change) => change.path).sort(),
    );
    // Heard as the journey reads it: the field, what it was with no word before it, each arm's
    // value, then the assessment — the row's own accessible name, then part by part.
    expect(
      within(table).getByRole("row", { name: /^shipping_address\.city Bordeaux Lyon Lyon Same$/ }),
    ).toBe(rowOf(table, "shipping_address.city"));
    expect(heardFieldRow(rowOf(table, "shipping_address.city"))).toEqual([
      "shipping_address.city",
      "Bordeaux",
      "Lyon",
      "Lyon",
      "Same",
    ]);
    // "Was" is drawn and not heard: the column's header says it.
    const header = within(rowOf(table, "shipping_address.city")).getByRole("rowheader");
    expect(within(header).getByText("Was")).toHaveAttribute("aria-hidden", "true");
    expect(heardFieldRow(rowOf(table, "shipping_address.line2"))[1]).toBe("not set");
  });

  it("marks a value the arms left differently, in words and with its glyph, on load", async () => {
    stateDiffs = {
      [ARM_A]: seededDiff(ARM_A_WORLD),
      [ARM_B]: seededDiff({ ...ARM_B_WORLD, city: "Paris", sourceAddressId: "work" }),
    };
    renderResults();

    const state = await screen.findByRole("region", { name: "Business state" });
    // What was set aside is counted, so "the same" never stands for more than was checked: one
    // spanning row, the order's comparison.
    expect(sheetCells(state, "Compared")).toEqual([
      "Both arms changed the same 17 fields, and differ on 2: shipping_address.city, shipping_address.source_address_id. Not compared: 4 timestamps and 1 event identifier.",
    ]);
    // The differing rows are on the page before anything is pressed, and only they are.
    const differing = within(state).getByRole("table", {
      name: "Where the arms differ on NS-10482",
    });
    expect(
      within(differing)
        .getAllByRole("rowheader")
        .filter((cell) => cell.getAttribute("scope") === "row")
        .map((cell) => cell.querySelector(".font-mono")?.textContent),
    ).toEqual(["shipping_address.city", "shipping_address.source_address_id"]);
    expect(
      within(differing).getByRole("row", {
        name: /^shipping_address\.city Bordeaux Lyon Paris Difference$/,
      }),
    ).toBe(rowOf(differing, "shipping_address.city"));
    expect(heardFieldRow(rowOf(differing, "shipping_address.city"))).toEqual([
      "shipping_address.city",
      "Bordeaux",
      "Lyon",
      "Paris",
      "Difference",
    ]);
    // The glyph is drawn beside the word and not heard instead of it.
    const assessment = within(rowOf(differing, "shipping_address.city")).getAllByRole("cell")[2];
    expect(assessment).toHaveTextContent(/^≠ Difference$/);
    expect(within(assessment as HTMLElement).getByText("≠")).toHaveAttribute("aria-hidden", "true");
    // An identifier the operator chose is a value like any other: only the lab's own name
    // for an event it wrote is set aside.
    expect(heardFieldRow(rowOf(differing, "shipping_address.source_address_id")).at(-1)).toBe(
      "Difference",
    );

    // And the full list still holds them, marked the same way.
    await userEvent.click(
      within(state).getByRole("button", { name: "Every changed field of NS-10482 (17)" }),
    );
    const table = within(state).getByRole("table", {
      name: "Every field of NS-10482 each arm changed",
    });
    expect(within(rowOf(table, "shipping_address.city")).getAllByRole("cell")[2]).toHaveTextContent(
      "≠ Difference",
    );
  });

  it("shows each arm's clock and event names without counting them as a difference", async () => {
    stateDiffs = { [ARM_A]: seededDiff(ARM_A_WORLD), [ARM_B]: seededDiff(ARM_B_WORLD) };
    renderResults();

    const state = await screen.findByRole("region", { name: "Business state" });
    // The seeded run's two arms wrote the same world at different moments, and says how much
    // it set aside to call it that.
    expect(state).toHaveTextContent(
      "Both arms changed the same 17 fields to the same values, apart from 4 timestamps and 1 event identifier, which are not compared.",
    );
    expect(within(state).queryByRole("table", { name: /^Where the arms differ/ })).toBeNull();
    await userEvent.click(
      within(state).getByRole("button", { name: "Every changed field of NS-10482 (17)" }),
    );
    const table = within(state).getByRole("table", {
      name: "Every field of NS-10482 each arm changed",
    });
    // Both values on the page, neither marked.
    expect(
      within(table).getByRole("row", {
        name: "events[4].id not set address-change-e72248418ca9 address-change-d1a644321b81 Not compared",
      }),
    ).toBe(rowOf(table, "events[4].id"));
    expect(heardFieldRow(rowOf(table, "events[4].id"))).toEqual([
      "events[4].id",
      "not set",
      "address-change-e72248418ca9",
      "address-change-d1a644321b81",
      "Not compared",
    ]);
    expect(heardFieldRow(rowOf(table, "fulfilment.shipped_at"))).toEqual([
      "fulfilment.shipped_at",
      "not set",
      "2026-08-24T09:00:55.000000Z",
      "2026-08-24T09:01:15.000000Z",
      "Not compared",
    ]);
    expect(within(table).queryByText(/Difference/)).toBeNull();
  });

  it("counts two different faults' events at one index as a difference", async () => {
    stateDiffs = {
      [ARM_A]: seededDiff(ARM_A_WORLD),
      // Same kind, same summary: only the name says these are two faults, and a fault's name is
      // the same in every arm, so a different one is a different event.
      [ARM_B]: editedDiff(seededDiff(ARM_B_WORLD), (change) =>
        change.path === "events[3].id" ? { ...change, after: "mutation-carrier-collects" } : change,
      ),
    };
    renderResults();

    const state = await screen.findByRole("region", {
      name: "Business state",
    });
    expect(state).toHaveTextContent(
      "and differ on 1: events[3].id. Not compared: 4 timestamps and 1 event identifier.",
    );
  });

  it("counts events written in a different order as a difference", async () => {
    // Arm B's redirect came before its fault: the history is sorted by moment, so the same two
    // events sit at each other's index, and each arm's entry there is a different event.
    const swapped = (path: string) =>
      path.startsWith("events[3]")
        ? path.replace("events[3]", "events[4]")
        : path.replace("events[4]", "events[3]");
    const armB = seededDiff(ARM_B_WORLD);
    const reordered = editedDiff(armB, (change) => {
      if (!change.path.startsWith("events[")) {
        return change;
      }
      const partner = armB.orders[0]?.changes.find((other) => other.path === swapped(change.path));
      return { ...change, after: partner?.after ?? null };
    });
    stateDiffs = { [ARM_A]: seededDiff(ARM_A_WORLD), [ARM_B]: reordered };
    renderResults();

    const state = await screen.findByRole("region", {
      name: "Business state",
    });
    // Six of the history's fields differ, named five at a time; the two moments are still
    // each arm's own clock.
    expect(state).toHaveTextContent(
      "and differ on 6: events[3].id, events[3].kind, events[3].summary, events[4].id, events[4].kind and 1 more. Not compared: 4 timestamps.",
    );
  });

  it("compares a timestamp the run's clock did not write", async () => {
    const promised = (world: ArmWorld, at: string) =>
      editedDiff(seededDiff(world), (change) => change, [
        { path: "fulfilment.promised_at", before: null, after: at },
      ]);
    stateDiffs = {
      [ARM_A]: promised(ARM_A_WORLD, "2026-08-27T00:00:00.000000Z"),
      [ARM_B]: promised(ARM_B_WORLD, "2026-08-29T00:00:00.000000Z"),
    };
    renderResults();

    const state = await screen.findByRole("region", {
      name: "Business state",
    });
    // A date somebody chose is a value, whatever it looks like: only the fields the run's own
    // clock writes are set aside.
    expect(state).toHaveTextContent("and differ on 1: fulfilment.promised_at.");
  });

  it("counts a moment against a field that is not set as a difference", async () => {
    stateDiffs = {
      [ARM_A]: seededDiff(ARM_A_WORLD),
      [ARM_B]: editedDiff(seededDiff(ARM_B_WORLD), (change) =>
        change.path === "fulfilment.shipped_at" ? { ...change, after: null } : change,
      ),
    };
    renderResults();

    const state = await screen.findByRole("region", {
      name: "Business state",
    });
    // Absent and present are different facts (ADR 0035), whatever shape the present one has.
    expect(state).toHaveTextContent("differ on 1: fulfilment.shipped_at.");
  });

  it("counts one field as one field", async () => {
    const moved: ArmStateDiffSchema = {
      orders: [
        {
          order_id: ORDER_ID,
          reference: "NS-10482",
          changes: [{ path: "shipping_address.city", before: "Bordeaux", after: "Lyon" }],
        },
      ],
      other: [],
    };
    stateDiffs = { [ARM_A]: moved, [ARM_B]: moved };
    renderResults();

    const state = await screen.findByRole("region", { name: "Business state" });
    expect(state).toHaveTextContent("Both arms changed the same 1 field to the same values.");
    expect(lines(within(sheetRow(state, "Order NS-10482")).getAllByRole("cell")[0])).toEqual([
      "1 group changed",
      "shipping address",
    ]);
  });

  it("reads one arm's diff without a comparison", async () => {
    stateDiffs = { [ARM_A]: seededDiff(ARM_A_WORLD) };
    const base = experiment(turns, agentTurns, toolEvents, mutationEvents);
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}`, () =>
        HttpResponse.json({ ...base, runs: [base.runs[0]], arm_inputs: [[]] }),
      ),
    );
    renderResults();

    const state = await screen.findByRole("region", { name: "Business state" });
    // Nothing to compare against: no sentence about the arms, and no Assessment column.
    await userEvent.click(
      await within(state).findByRole("button", { name: "Every changed field of NS-10482 (17)" }),
    );
    expect(state).not.toHaveTextContent(/arms changed/);
    expect(within(state).queryByRole("row", { name: /^Compared/ })).toBeNull();
    const table = within(state).getByRole("table", {
      name: "Every field of NS-10482 each arm changed",
    });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Field and what it was", "Arm A"]);
    expect(heardFieldRow(rowOf(table, "shipping_address.city"))).toEqual([
      "shipping_address.city",
      "Bordeaux",
      "Lyon",
    ]);
  });

  it("keeps each arm's column where the arms changed different fields", async () => {
    toolEvents = [toolEvent(ARM_A, 0, "orders.apply_address_change", true)];
    stateDiffs = { [ARM_A]: REDIRECTED, [ARM_B]: seededDiff(ARM_B_WORLD) };
    renderResults();

    const state = await screen.findByRole("region", { name: "Business state" });
    // What only one arm changed is named, a whole history entry folded, the rest counted.
    expect(sheetCells(state, "Compared")).toEqual([
      "The arms changed different fields, so each keeps its own column. Only Arm B changed events[3].*, events[4].*, fulfilment.shipped_at, shipping_address.line1, shipping_address.line2 and 3 more.",
    ]);
    expect(state).not.toHaveTextContent("Only Arm A");
    // Every path either arm moved, counted once, each in its own arm's column.
    await userEvent.click(
      within(state).getByRole("button", { name: "Every changed field of NS-10482 (17)" }),
    );
    const fields = within(state).getByRole("table", {
      name: "Every field of NS-10482 each arm changed",
    });
    expect(within(fields).queryByRole("columnheader", { name: "Assessment" })).toBeNull();
    const pathsOf = (index: number) =>
      within(fields)
        .getAllByRole("row")
        .slice(1)
        .flatMap((row) =>
          Array.from(
            within(row).getAllByRole("cell")[index]?.querySelectorAll(".font-mono") ?? [],
            (path) => path.textContent,
          ),
        );
    expect(pathsOf(0)).toHaveLength(3);
    expect(pathsOf(1)).toHaveLength(17);
    expect(within(fields).getByText("events[4].id").nextElementSibling).toHaveTextContent(
      "not set → address-change-d1a644321b81",
    );
  });

  it("does not fold an entry another arm also changed", async () => {
    const only = (changes: ArmStateDiffSchema["orders"][number]["changes"]) => ({
      orders: [{ order_id: ORDER_ID, reference: "NS-10482", changes }],
      other: [],
    });
    stateDiffs = {
      [ARM_A]: only([
        { path: "events[3].kind", before: "placed", after: "shipped" },
        { path: "events[3].summary", before: "Placed.", after: "Shipped." },
      ]),
      [ARM_B]: only([{ path: "events[3].id", before: "placed", after: "placed-again" }]),
    };
    renderResults();

    const state = await screen.findByRole("region", {
      name: "Business state",
    });
    // Arm B touched the same entry, so "only Arm A changed events[3].*" would be false.
    expect(state).toHaveTextContent(
      "Only Arm A changed events[3].kind, events[3].summary. Only Arm B changed events[3].id.",
    );
    expect(state).not.toHaveTextContent("events[3].*");
  });

  it("says one value set aside in the singular", async () => {
    const moved = (selectedAt: string): ArmStateDiffSchema => ({
      orders: [
        {
          order_id: ORDER_ID,
          reference: "NS-10482",
          changes: [
            { path: "shipping_address.city", before: "Bordeaux", after: "Lyon" },
            {
              path: "shipping_address.selected_at",
              before: "2026-08-24T09:00:16.000000Z",
              after: selectedAt,
            },
          ],
        },
      ],
      other: [],
    });
    stateDiffs = {
      [ARM_A]: moved("2026-08-24T09:01:05.000000Z"),
      [ARM_B]: moved("2026-08-24T09:01:25.000000Z"),
    };
    renderResults();

    const state = await screen.findByRole("region", {
      name: "Business state",
    });
    expect(state).toHaveTextContent(
      "Both arms changed the same 2 fields to the same values, apart from 1 timestamp, which is not compared.",
    );
  });

  it("names a whole group only one arm changed by the group", async () => {
    const only = (changes: ArmStateDiffSchema["orders"][number]["changes"]) => ({
      orders: [{ order_id: ORDER_ID, reference: "NS-10482", changes }],
      other: [],
    });
    stateDiffs = {
      [ARM_A]: only([
        { path: "fulfilment.shipped_at", before: null, after: "2026-08-24T09:00:55.000000Z" },
        { path: "fulfilment.status", before: "unfulfilled", after: "partially_fulfilled" },
      ]),
      [ARM_B]: only([{ path: "shipping_address.city", before: "Bordeaux", after: "Lyon" }]),
    };
    renderResults();

    const state = await screen.findByRole("region", {
      name: "Business state",
    });
    expect(state).toHaveTextContent(
      "Only Arm A changed fulfilment.*. Only Arm B changed shipping_address.city.",
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

    const state = await screen.findByRole("region", { name: "Business state" });
    await userEvent.click(
      within(state).getByRole("button", { name: "Every changed field of NS-10482 (1)" }),
    );

    // An order that had no address and now has one is a different fact from one whose city
    // was blanked, and an empty cell would read as the same thing for both.
    expect(within(state).getByText("shipping_address.city").nextElementSibling).toHaveTextContent(
      "not set → Lyon",
    );
  });

  it("reports a change outside every order rather than hiding it, without an alert", async () => {
    stateDiffs = {
      [ARM_A]: {
        orders: [],
        other: [{ path: "interaction.ticket_reference", before: "T-204", after: "T-999" }],
      },
    };
    renderResults();

    const state = await screen.findByRole("region", { name: "Business state" });
    // Nothing in this build can produce one, which is exactly why it must be visible if one
    // appears: the section's "No other state changed" is otherwise unfalsifiable. It was on the
    // record when the page loaded, so nothing announces it as if it had just happened.
    const [armA, armB] = within(sheetRow(state, "Changed outside every order")).getAllByRole(
      "cell",
    );
    expect(armA).toHaveTextContent("interaction.ticket_reference: T-204 → T-999");
    // Its glyph and its words, never the colour alone.
    expect(armA.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(armA.querySelector(".text-lab-error")).not.toBeNull();
    expect(armB).toHaveTextContent(/^Nothing$/);
    expect(screen.queryByRole("alert")).toBeNull();
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

/**
 * The seeded run's turn 2, as the operator met it: the customer asks whether anything else
 * changed, each arm's proposal is refused, and each answers with its turn-1 sentence again.
 */
const QUESTION = "Can you confirm nothing else about the order changed while you were in there?";
const REPEATED = "I have updated the shipping address on order NS-10482.";
const REPLY_B = "Only the shipping address on NS-10482 changed.";
const SPLIT = "Only arm A hears this: the flat is in my partner's name.";

function reply(runId: string, ordinal: number, body: string): AgentTurnSchema {
  return { ...agentTurn(runId, ordinal), body };
}

function callWith(
  runId: string,
  ordinal: number,
  outcome: ToolEventSchema["outcome"],
): ToolEventSchema {
  const call = toolEvent(runId, 0, "orders.propose_address_change", false, ordinal);
  return { ...call, outcome, result: { ...call.result, outcome } };
}

/**
 * The timeline's numbering of the compositions, which is what the conversation orders its rows
 * by: each composition at the step given, naming the arms it reached.
 */
function serveCompositions(...compositions: [turnId: string, runIds: string[]][]) {
  server.use(
    http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/timeline`, () =>
      HttpResponse.json({
        experiment_id: EXPERIMENT_ID,
        entries: compositions.map(([turnId, runIds], step) =>
          timelineEntry({
            kind: step === 0 ? "trigger" : "customer_turn",
            step,
            run_ids: runIds,
            composition_id: turnId,
          }),
        ),
      } satisfies ExperimentTimelineResponse),
    ),
  );
}

function secondTurnRefused() {
  turns = [...OPENED, turn(ARM_A, 1, "turn-1", QUESTION), turn(ARM_B, 1, "turn-1", QUESTION)];
  agentTurns = [
    reply(ARM_A, 0, REPEATED),
    reply(ARM_B, 0, REPEATED),
    reply(ARM_A, 1, REPEATED),
    reply(ARM_B, 1, REPLY_B),
  ];
  toolEvents = [callWith(ARM_A, 1, "refused"), callWith(ARM_B, 1, "refused")];
  serveCompositions(["trigger-0", [ARM_A, ARM_B]], ["turn-1", [ARM_A, ARM_B]]);
}

function renderConversation() {
  return renderApp(`/lab/bench/${SHOP_ID}/${EXPERIMENT_ID}/results/conversation`);
}

/** Whether `earlier` comes before `later` in the document, which is the order it reads in. */
function precedes(earlier: HTMLElement, later: HTMLElement): boolean {
  return Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** The conversation's rows, one per composition, without the chips nested inside them. */
async function conversationRows(card: HTMLElement): Promise<HTMLElement[]> {
  const items = await within(card).findAllByRole("listitem");
  return items.filter((row) => row.parentElement?.closest("li") === null);
}

describe("the conversation on the results", () => {
  it("sets both arms' answers to one message side by side, each under the message", async () => {
    secondTurnRefused();
    renderConversation();

    const card = await screen.findByRole("region", { name: "Conversation" });
    const rows = await conversationRows(card);
    expect(rows.map((row) => within(row).getByRole("heading", { level: 3 }).textContent)).toEqual([
      "Trigger",
      "Message 1",
    ]);

    // The second message is one row holding both arms, so the customer's question sits level
    // with both answers to it rather than wherever each arm's thread happened to have reached.
    const second = within(rows[1]);
    const armA = second.getByRole("article", { name: "Arm A · turn 2" });
    const armB = second.getByRole("article", { name: "Arm B · turn 2" });
    expect(precedes(within(armA).getByText(QUESTION), within(armA).getByText(REPEATED))).toBe(true);
    expect(precedes(within(armB).getByText(QUESTION), within(armB).getByText(REPLY_B))).toBe(true);
    expect(within(armA).queryByText(TRIGGER)).toBeNull();

    const first = within(rows[0]);
    for (const name of ["Arm A · turn 1", "Arm B · turn 1"]) {
      const cell = first.getByRole("article", { name });
      expect(precedes(within(cell).getByText(TRIGGER), within(cell).getByText(REPEATED))).toBe(
        true,
      );
      expect(within(cell).queryByText(QUESTION)).toBeNull();
    }
  });

  it("pairs by composition, so a message after a split reply is one row in both arms", async () => {
    // Arm A heard a reply arm B never did, so the question that follows is arm A's third turn
    // and arm B's second — one message, two ordinals (ADR 0027).
    turns = [
      ...OPENED,
      turn(ARM_A, 1, "split-1", SPLIT),
      turn(ARM_A, 2, "turn-2", QUESTION),
      turn(ARM_B, 1, "turn-2", QUESTION),
    ];
    agentTurns = [reply(ARM_A, 2, REPEATED), reply(ARM_B, 1, REPLY_B)];
    serveCompositions(
      ["trigger-0", [ARM_A, ARM_B]],
      ["split-1", [ARM_A]],
      ["turn-2", [ARM_A, ARM_B]],
    );
    renderConversation();

    const card = await screen.findByRole("region", { name: "Conversation" });
    const rows = await conversationRows(card);
    expect(rows.map((row) => within(row).getByRole("heading", { level: 3 }).textContent)).toEqual([
      "Trigger",
      "Message 1",
      "Message 2",
    ]);

    const split = within(rows[1]);
    const heard = split.getByRole("article", { name: "Arm A · turn 2" });
    expect(within(heard).getByText(SPLIT)).toBeVisible();
    expect(within(heard).getByText("this arm only")).toBeVisible();
    expect(split.getByRole("article", { name: "Arm B" })).toHaveTextContent(
      "Arm B did not receive this message.",
    );

    // Each cell is numbered as its own arm counts it, which is what each arm card's
    // "answered n of m" counts in too.
    const shared = within(rows[2]);
    const armA = shared.getByRole("article", { name: "Arm A · turn 3" });
    const armB = shared.getByRole("article", { name: "Arm B · turn 2" });
    expect(precedes(within(armA).getByText(QUESTION), within(armA).getByText(REPEATED))).toBe(true);
    expect(precedes(within(armB).getByText(QUESTION), within(armB).getByText(REPLY_B))).toBe(true);
    expect(within(armB).queryByText("this arm only")).toBeNull();
  });

  it("orders the messages as the timeline numbers them, not as the record lists them", async () => {
    // Two replies no one arm received both of: the record lists arm A's first, but the
    // timeline says arm B's was delivered first, and the conversation reads it that way.
    turns = [
      ...OPENED,
      turn(ARM_A, 1, "to-a", "For arm A alone."),
      turn(ARM_B, 1, "to-b", "For arm B alone."),
    ];
    serveCompositions(["trigger-0", [ARM_A, ARM_B]], ["to-b", [ARM_B]], ["to-a", [ARM_A]]);
    renderConversation();

    const card = await screen.findByRole("region", { name: "Conversation" });
    const rows = await conversationRows(card);
    expect(rows[1]).toHaveTextContent("For arm B alone.");
    expect(rows[2]).toHaveTextContent("For arm A alone.");
  });

  it("keeps a message the timeline does not number, after the ones it does", async () => {
    // The timeline is a projection of the same record and should name every composition; if
    // it ever named fewer, the message still reads, last, rather than vanishing.
    secondTurnRefused();
    serveCompositions(["trigger-0", [ARM_A, ARM_B]]);
    renderConversation();

    const card = await screen.findByRole("region", { name: "Conversation" });
    const rows = await conversationRows(card);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole("heading", { level: 3 })).toHaveTextContent("Trigger");
    expect(within(rows[1]).getByRole("heading", { level: 3 })).toHaveTextContent("Message 1");
    expect(within(rows[1]).getByRole("article", { name: "Arm A · turn 2" })).toHaveTextContent(
      QUESTION,
    );
  });

  it("reads a refused call as refused, in words and with its glyph", async () => {
    secondTurnRefused();
    renderConversation();

    for (const name of ["Arm A · turn 2", "Arm B · turn 2"]) {
      const cell = await screen.findByRole("article", { name });
      const chip = within(cell).getByText(/orders\.propose_address_change → Refused/);
      expect(chip.querySelector("[aria-hidden='true']")?.textContent).toBe("✗ ");
      expectInertChip(chip);
    }
  });

  it("reads a failed call as failed, with a glyph of its own", async () => {
    secondTurnRefused();
    toolEvents = [callWith(ARM_A, 1, "failed")];
    renderConversation();

    const cell = await screen.findByRole("article", { name: "Arm A · turn 2" });
    const chip = within(cell).getByText(/orders\.propose_address_change → Failed/);
    expect(chip.querySelector("[aria-hidden='true']")?.textContent).toBe("! ");
  });

  it("says so when no turn has been recorded", async () => {
    turns = [];
    serveCompositions();
    renderConversation();

    const card = await screen.findByRole("region", { name: "Conversation" });
    expect(await within(card).findByText("No turn has been recorded yet.")).toBeVisible();
    expect(within(card).queryAllByRole("article")).toEqual([]);
  });

  it("says so when the order of the messages cannot be read", async () => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/timeline`, () =>
        HttpResponse.json(
          { code: "internal_error", message: "the timeline is unavailable", request_id: "req-9" },
          { status: 500 },
        ),
      ),
    );
    renderConversation();

    const card = await screen.findByRole("region", { name: "Conversation" });
    expect(await within(card).findByRole("alert")).toHaveTextContent("the timeline is unavailable");
  });

  it("writes nothing: no composer, no send, no run and no score", async () => {
    secondTurnRefused();
    renderConversation();

    const card = await screen.findByRole("region", { name: "Conversation" });
    await within(card).findByRole("article", { name: "Arm A · turn 2" });
    expect(within(card).queryAllByRole("button")).toEqual([]);
    expect(within(card).queryAllByRole("textbox")).toEqual([]);
    expect(within(card).queryAllByRole("checkbox")).toEqual([]);
    expect(within(card).queryAllByRole("combobox")).toEqual([]);
    expect(card.querySelector("form, input, textarea, select")).toBeNull();
    expect(screen.queryByRole("region", { name: "Customer composer" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Send as the customer|Run .*agent|Score/ }),
    ).toBeNull();
    // A run still in progress is driven where it always was.
    expect(screen.getByRole("link", { name: "Back to the live bench" })).toHaveAttribute(
      "href",
      `/lab/bench/${SHOP_ID}/${EXPERIMENT_ID}`,
    );
  });

  it("is the results' second tab, between General and Execution timeline", async () => {
    const user = userEvent.setup();
    secondTurnRefused();
    renderResults();

    const tabs = await screen.findByRole("navigation", { name: "Results views" });
    expect(
      within(tabs)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["General", "Conversation", "Execution timeline", "Traces"]);

    await user.click(within(tabs).getByRole("link", { name: "Conversation" }));
    expect(within(tabs).getByRole("link", { name: "Conversation" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await screen.findByRole("article", { name: "Arm B · turn 2" })).toHaveTextContent(
      REPLY_B,
    );
  });

  it("is where the timeline sends a reader for what was said", async () => {
    const user = userEvent.setup();
    secondTurnRefused();
    renderTimeline();

    const stream = await screen.findByRole("region", { name: "Execution timeline" });
    await user.click(within(stream).getByRole("link", { name: "Conversation" }));

    expect(await screen.findByRole("region", { name: "Conversation" })).toBeVisible();
    expect(await screen.findByRole("article", { name: "Arm A · turn 2" })).toHaveTextContent(
      QUESTION,
    );
  });
});

/** Both arms' turn 2 side by side: a fault in arm A, the reply in each. */
const LANED: ExperimentTimelineResponse = {
  experiment_id: EXPERIMENT_ID,
  entries: [
    timelineEntry({ kind: "trigger", step: 0, run_ids: [ARM_A, ARM_B] }),
    timelineEntry({
      kind: "tool_call",
      step: 0,
      run_ids: [ARM_A],
      categories: ["tool"],
      ordinal: 0,
      attempt: 1,
      sequence: 0,
      tool: "support.read_document",
      tool_version: "v1",
      tool_outcome: "success",
    }),
    timelineEntry({
      kind: "agent_turn",
      step: 0,
      run_ids: [ARM_A],
      categories: ["model"],
      ordinal: 0,
      attempt: 1,
      turn_outcome: "answered",
    }),
    timelineEntry({
      kind: "agent_turn",
      step: 0,
      run_ids: [ARM_B],
      categories: ["model"],
      ordinal: 0,
      attempt: 1,
      turn_outcome: "answered",
    }),
    timelineEntry({
      kind: "customer_turn",
      step: 1,
      run_ids: [ARM_A, ARM_B],
      composition_id: "composition-1",
    }),
    timelineEntry({
      kind: "mutation",
      step: 1,
      run_ids: [ARM_A],
      categories: ["state"],
      ordinal: 1,
      attempt: 1,
      sequence: 0,
      mutation: "order-moves-under-the-arm",
      mutation_effect: "entity_mutation",
      revision_before: 0,
      revision_after: 1,
    }),
    timelineEntry({
      kind: "agent_turn",
      step: 1,
      run_ids: [ARM_A],
      categories: ["model"],
      ordinal: 1,
      attempt: 1,
      turn_outcome: "answered",
    }),
    timelineEntry({
      kind: "tool_call",
      step: 1,
      run_ids: [ARM_B],
      categories: ["tool", "refusal"],
      ordinal: 1,
      attempt: 1,
      sequence: 0,
      tool: "orders.apply_address_change",
      tool_version: "v1",
      tool_outcome: "refused",
    }),
    timelineEntry({
      kind: "agent_turn",
      step: 1,
      run_ids: [ARM_B],
      categories: ["model"],
      ordinal: 1,
      attempt: 1,
      turn_outcome: "answered",
    }),
  ],
};

/** Arm A's read-check, met by the call at turn 0, attempt 1, sequence 0; arm B's left pending. */
function decidedEvaluation(): ExperimentEvaluationResponse {
  const base = evaluation(OPENED);
  return {
    ...base,
    arms: base.arms.map((arm) =>
      arm.run_id !== ARM_A
        ? arm
        : {
            ...arm,
            met: 1,
            decided: 1,
            objectives: arm.objectives.map((row) =>
              row.objective_id !== "read-address-change-policy"
                ? row
                : {
                    ...row,
                    outcome: "met" as const,
                    detail: "support.read_document answered policy:address-change",
                    decided_by: { ordinal: 0, attempt: 1, sequence: 0 },
                  },
            ),
          },
    ),
  };
}

describe("execution timeline in lanes", () => {
  beforeEach(() => {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/timeline`, () =>
        HttpResponse.json(LANED),
      ),
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/evaluation`, () =>
        HttpResponse.json(decidedEvaluation()),
      ),
    );
  });

  it("draws each arm in its own lane, the turns as bands on one clock", async () => {
    renderTimeline();

    const stream = await screen.findByRole("region", { name: "Execution timeline" });
    const bands = within(stream).getAllByRole("region");
    expect(bands.map((band) => band.getAttribute("aria-label"))).toEqual(["Turn 1", "Turn 2"]);

    // Turn 2 holds what the customer said across its top, then both arms side by side.
    const second = within(stream).getByRole("region", { name: "Turn 2" });
    expect(within(second).getAllByRole("listitem")[0]).toHaveTextContent(
      "The customer sent a message.",
    );
    const laneA = within(second).getByRole("list", { name: "Arm A, turn 2" });
    const laneB = within(second).getByRole("list", { name: "Arm B, turn 2" });
    expect(
      within(laneA)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringMatching(/order-moves-under-the-arm fired/),
      expect.stringMatching(/The agent replied/),
    ]);
    expect(
      within(laneB)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringMatching(/orders\.apply_address_change v1 → Refused/),
      expect.stringMatching(/The agent replied/),
    ]);
    // A refusal carries its glyph beside its word, unheard: the word is what is announced.
    const [refused] = within(laneB).getAllByRole("listitem");
    const glyph = refused.querySelector('[aria-hidden="true"]');
    expect(glyph?.textContent).toBe("✗ ");
    expect(
      within(laneA).getAllByRole("listitem")[1].querySelector('[aria-hidden="true"]'),
    ).toBeNull();
    // Arm B's events never land in arm A's lane, nor in turn 1's band.
    const first = within(stream).getByRole("region", { name: "Turn 1" });
    expect(within(first).getByRole("list", { name: "Arm B, turn 1" })).not.toHaveTextContent(
      /Refused/,
    );
  });

  it("marks a scenario fault in the lane of the arm it fired into, where it fired", async () => {
    renderTimeline();

    const second = await screen.findByRole("region", { name: "Turn 2" });
    const laneA = within(second).getByRole("list", { name: "Arm A, turn 2" });
    const [fault] = within(laneA).getAllByRole("listitem");

    expect(within(fault).getByText("scenario fault")).toBeVisible();
    expect(fault).toHaveTextContent("moved this arm r0 → r1");
    expect(
      within(within(second).getByRole("list", { name: "Arm B, turn 2" })).queryByText(
        "scenario fault",
      ),
    ).toBeNull();
  });

  it("gives every event an anchor of its own", async () => {
    renderTimeline();

    const stream = await screen.findByRole("region", { name: "Execution timeline" });
    const ids = within(stream)
      .getAllByRole("listitem")
      .map((row) => row.id);

    expect(ids).toHaveLength(LANED.entries.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(`event-${ARM_A}-0-1-call-0`);
    expect(ids).toContain(`event-${ARM_B}-1-1-call-0`);
    expect(ids).toContain("event-turn-1");
  });

  it("keeps the lenses working across the lanes, with their selected state shown", async () => {
    const user = userEvent.setup();
    renderTimeline();

    const stream = await screen.findByRole("region", { name: "Execution timeline" });
    const refusals = within(stream).getByRole("button", { name: "Refusals" });
    await user.click(refusals);

    expect(refusals).toHaveAttribute("aria-pressed", "true");
    expect(refusals).toHaveClass("bg-admin-chip");
    expect(within(stream).getAllByRole("listitem")).toHaveLength(1);
    const second = within(stream).getByRole("region", { name: "Turn 2" });
    expect(within(second).getByText("Nothing under this lens.")).toBeVisible();
    expect(within(stream).queryByRole("region", { name: "Turn 1" })).toBeNull();
  });

  it("lands on the event a link names, and says so in words", async () => {
    renderApp(`/lab/bench/${SHOP_ID}/${EXPERIMENT_ID}/results/timeline#event-${ARM_A}-0-1-call-0`);

    const stream = await screen.findByRole("region", { name: "Execution timeline" });
    const landed = within(stream)
      .getAllByRole("listitem")
      .find((row) => row.id === `event-${ARM_A}-0-1-call-0`);

    await waitFor(() => expect(landed).toHaveFocus());
    expect(landed).toHaveAttribute("aria-current", "location");
    expect(within(landed as HTMLElement).getByText("the event you followed")).toBeVisible();
    expect(within(stream).getAllByText("the event you followed")).toHaveLength(1);
  });

  it("reads a hand-typed fragment it cannot decode as no landing, not as a broken page", async () => {
    renderApp(`/lab/bench/${SHOP_ID}/${EXPERIMENT_ID}/results/timeline#%`);

    const stream = await screen.findByRole("region", { name: "Execution timeline" });

    expect(within(stream).getByRole("region", { name: "Turn 2" })).toBeVisible();
    expect(within(stream).queryByText("the event you followed")).toBeNull();
  });

  it("links an arm's cell to the call that decided it, named for its objective and arm, and lands there", async () => {
    const user = userEvent.setup();
    renderResults();

    await screen.findByRole("region", { name: "Objectives" });
    const row = within(objectivesGroup("Decided by a rule")).getByRole("row", {
      name: /Read the address-change policy/,
    });
    const [armA, armB] = within(row).getAllByRole("cell");
    // Every decided cell draws the same words, so each link is named for its objective and its
    // arm: read out of context, a list of them is not a column of twins.
    const link = within(armA).getByRole("link", {
      name: "Open the deciding event for Read the address-change policy, Arm A",
    });
    expect(link).toHaveTextContent(/^Open the deciding event →$/);
    expect(link).toHaveAttribute(
      "href",
      `/lab/bench/${SHOP_ID}/${EXPERIMENT_ID}/results/timeline#event-${ARM_A}-0-1-call-0`,
    );
    // Under the pill and the evidence line it opens.
    expect(within(armA).getByText("met")).toBeVisible();
    expect(
      within(armA).getByText("support.read_document answered policy:address-change"),
    ).toBeVisible();
    // Arm B's row was decided by no call, so it draws no link rather than a guessed one.
    expect(within(armB).queryByRole("link")).toBeNull();
    expect(armB).toHaveTextContent("support.read_document never answered");

    link.focus();
    expect(link).toHaveFocus();
    await user.keyboard("{Enter}");

    const stream = await screen.findByRole("region", { name: "Execution timeline" });
    const landed = within(stream)
      .getAllByRole("listitem")
      .find((entry) => entry.id === `event-${ARM_A}-0-1-call-0`);
    await waitFor(() => expect(landed).toHaveFocus());
    expect(landed).toHaveTextContent("support.read_document v1 → Success");
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
    expectInertChip(within(fault).getByText("scenario fault"));
  });

  it("marks the composition only one arm received", async () => {
    renderTimeline();

    const stream = await screen.findByRole("region", { name: "Execution timeline" });

    const split = within(stream).getAllByRole("listitem")[4];
    expect(split).toHaveTextContent("Arm B");
    expect(within(split).getByText("this arm only")).toBeVisible();
    expectInertChip(within(split).getByText("this arm only"));
    // The arm that never heard it says so in its own lane, rather than reading as idle.
    const band = within(stream).getByRole("region", { name: "Turn 2" });
    expect(within(band).getByText("Never received this turn.")).toBeVisible();
    expect(within(band).getByText("Nothing recorded yet.")).toBeVisible();
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

  it("draws the lenses that are on on the selected chip's ground, not only as pressed", async () => {
    const user = userEvent.setup();
    renderTimeline();

    const stream = await screen.findByRole("region", {
      name: "Execution timeline",
    });
    const all = within(stream).getByRole("button", { name: "All events" });
    const state = within(stream).getByRole("button", { name: "State" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveClass("bg-admin-chip", "text-lab-primary");
    expect(state).toHaveAttribute("aria-pressed", "false");
    expect(state).not.toHaveClass("bg-admin-chip");

    await user.click(state);

    expect(state).toHaveAttribute("aria-pressed", "true");
    expect(state).toHaveClass("bg-admin-chip", "text-lab-primary");
    expect(all).toHaveAttribute("aria-pressed", "false");
    expect(all).not.toHaveClass("bg-admin-chip");
  });

  it("lets a project path wrap at its own joints, and reads it whole", async () => {
    renderTimeline();

    const stream = await screen.findByRole("region", {
      name: "Execution timeline",
    });
    const source = within(stream).getByText(/capability_lab\/application\/sandbox_actions\.py:311/);
    // The text is the identifier, character for character; the breaks are offered after its
    // separators and never inside a word.
    expect(source).toHaveTextContent(
      "capability_lab/application/sandbox_actions.py:311 · SandboxActionService._apply",
      { normalizeWhitespace: false },
    );
    expect(source.innerHTML).toContain(
      "capability_lab/<wbr>application/<wbr>sandbox_actions.<wbr>py:<wbr>311",
    );
    // `_` joins one name's words and is never a break point.
    expect(source.innerHTML).not.toContain("_<wbr>");

    const paths = await screen.findByRole("region", {
      name: "Executed project code",
    });
    const rail = within(paths).getByText(/sandbox_actions\.py:311 · 1 call/);
    expect(rail).toHaveTextContent("capability_lab/application/sandbox_actions.py:311 · 1 call");
    expect(rail.innerHTML).toContain("sandbox_actions.<wbr>py:<wbr>311");
    expect(rail.innerHTML).not.toContain("_<wbr>");
    const symbol = within(paths).getByText("SandboxActionService._apply");
    expect(symbol.innerHTML).toBe("SandboxActionService.<wbr>_apply");
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

/**
 * Both arms' attempts, arm B's first: the run began on arm B,
 * so the first attempt recorded is not the first arm's, and the last is arm B's turn 2.
 */
function twoArmTraces(): ExperimentTracesResponse {
  const base = TRACES.traces[0];
  const of = (runId: string, label: string, ordinal: number, trace: string) => ({
    ...base,
    run_id: runId,
    arm_label: label,
    ordinal,
    trace_id: trace.repeat(32),
  });
  return {
    ...TRACES,
    traces: [
      of(ARM_B, "Arm B", 0, "b"),
      // Out of order on purpose: the tab opens on the arm's first turn, not on the first of its
      // entries the response happens to list.
      of(ARM_A, "Arm A", 1, "e"),
      of(ARM_A, "Arm A", 0, "c"),
      of(ARM_B, "Arm B", 1, "f"),
    ],
  };
}

describe("traces", () => {
  it("draws one attempt as a waterfall, each call where inside the attempt it ran", async () => {
    renderTraces();

    const waterfall = await screen.findByRole("list", { name: "Span waterfall" });

    // Each row's name keeps the span's name, its call's outcome and its duration apart.
    const rows = within(waterfall).getAllByRole("button");
    const names = [
      "experiment.attempt · 3400 ms",
      "agent.answer · 3310 ms",
      "agent.tool · orders.read_order · Success · 310 ms",
      "agent.tool · orders.apply_address_change · Refused · 420 ms",
    ];
    expect(rows).toHaveLength(names.length);
    for (const [index, row] of rows.entries()) {
      expect(row).toHaveAccessibleName(names[index]);
    }
    // The words beside each track take one fixed width whatever they say, so every track is
    // the same length and the bars stay on one scale ("✗ Refused · 420 ms" beside "3400 ms").
    for (const row of rows) {
      expect(row.className).toMatch(/grid-cols-\[minmax\(0,14rem\)_minmax\(0,1fr\)_[\d.]+rem\]/);
    }
  });

  it("lets a span's name wrap at its joints, and reads it whole", async () => {
    renderTraces();

    const waterfall = await screen.findByRole("list", { name: "Span waterfall" });
    const row = within(waterfall).getByRole("button", { name: /apply_address_change/ });
    const name = within(row).getByText("agent.tool · orders.apply_address_change");
    expect(name.innerHTML).toBe("agent.<wbr>tool ·<wbr> orders.<wbr>apply_address_change");
    expect(row).toHaveAccessibleName("agent.tool · orders.apply_address_change · Refused · 420 ms");
  });

  it("marks the selected span by a rule and weight, not by its ground alone", async () => {
    const user = userEvent.setup();
    renderTraces();

    const waterfall = await screen.findByRole("list", { name: "Span waterfall" });
    const chosen = within(waterfall).getByRole("button", { name: /apply_address_change/ });
    await user.click(chosen);

    expect(chosen).toHaveAttribute("aria-pressed", "true");
    expect(chosen).toHaveClass("shadow-[inset_2px_0_0_var(--color-lab-accent)]");
    // The weight is the name's alone: the row keeps its width and the duration its weight.
    expect(chosen).not.toHaveClass("font-semibold");
    expect(within(chosen).getByText("agent.tool · orders.apply_address_change")).toHaveClass(
      "font-semibold",
    );
    expect(within(chosen).getByText(/420 ms/)).not.toHaveClass("font-semibold");
    for (const other of within(waterfall).getAllByRole("button")) {
      if (other !== chosen) {
        expect(other).toHaveAttribute("aria-pressed", "false");
        expect(other).not.toHaveClass("shadow-[inset_2px_0_0_var(--color-lab-accent)]");
        expect(other.firstElementChild).not.toHaveClass("font-semibold");
      }
    }
  });

  it("says on the row what each tool call answered, a refusal included, glyph before the word", async () => {
    renderTraces();

    const waterfall = await screen.findByRole("list", {
      name: "Span waterfall",
    });
    const refused = within(waterfall).getByRole("button", {
      name: /apply_address_change/,
    });
    const word = within(refused).getByText("Refused");
    expect(word).toBeVisible();
    const glyph = word.previousElementSibling;
    expect(glyph).toHaveTextContent("✗");
    expect(glyph).toHaveAttribute("aria-hidden", "true");

    const succeeded = within(waterfall).getByRole("button", {
      name: /read_order/,
    });
    expect(within(succeeded).getByText("Success").previousElementSibling).toHaveTextContent("✓");
    // The attempt and the framework's turn timed no call, so they say no outcome.
    expect(within(waterfall).getAllByRole("button")[0]).not.toHaveTextContent(
      /Success|Refused|Failed/,
    );
  });

  it("wraps the trace identifier instead of clipping it at the card's edge", async () => {
    renderTraces();

    const panel = await screen.findByRole("region", { name: "Span" });
    // A hex id has no joint to break at, so it alone may break anywhere.
    const traceId = within(panel).getByText("a".repeat(32));
    expect(traceId).toHaveClass("[overflow-wrap:anywhere]");
    expect(traceId.querySelector("wbr")).toBeNull();
  });

  it("reads a span's tool and outcome off the record rather than off the span", async () => {
    const user = userEvent.setup();
    renderTraces();

    const waterfall = await screen.findByRole("list", { name: "Span waterfall" });
    await user.click(
      within(waterfall).getByRole("button", { name: /orders.apply_address_change/ }),
    );

    const panel = screen.getByRole("region", { name: "Span" });
    const tool = within(panel).getByText("orders.apply_address_change · v1");
    expect(tool).toBeVisible();
    // The tool's name wraps at its joints rather than mid-word, and reads whole.
    expect(tool.innerHTML).toBe("orders.<wbr>apply_address_change ·<wbr> v1");
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

  it("opens on the first attempt of the first arm, whichever arm ran first", async () => {
    traced = twoArmTraces();
    renderTraces();

    const picker = await screen.findByRole("group", {
      name: "Traced attempts",
    });
    const first = within(picker).getByRole("button", {
      name: "Arm A · turn 1 · attempt 1",
    });
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(first).toHaveClass("bg-admin-chip", "text-lab-primary");
    for (const other of within(picker).getAllByRole("button")) {
      if (other !== first) {
        expect(other).toHaveAttribute("aria-pressed", "false");
        expect(other).not.toHaveClass("bg-admin-chip");
      }
    }
    expect(
      within(screen.getByRole("region", { name: "Span" })).getByText("c".repeat(32)),
    ).toBeVisible();
  });

  it("opens on a turn's first attempt when the same turn was retried, whatever order they arrive in", async () => {
    // Two attempts of arm A's turn 1, the retry listed first: the turn alone cannot choose
    // between them, so the attempt number breaks the tie.
    const base = TRACES.traces[0];
    traced = {
      ...TRACES,
      traces: [
        {
          ...base,
          run_id: ARM_A,
          arm_label: "Arm A",
          ordinal: 0,
          attempt: 2,
          trace_id: "d".repeat(32),
        },
        {
          ...base,
          run_id: ARM_A,
          arm_label: "Arm A",
          ordinal: 0,
          attempt: 1,
          trace_id: "c".repeat(32),
        },
      ],
    };
    renderTraces();

    const picker = await screen.findByRole("group", { name: "Traced attempts" });
    expect(
      within(picker).getByRole("button", { name: "Arm A · turn 1 · attempt 1" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(picker).getByRole("button", { name: "Arm A · turn 1 · attempt 2" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(screen.getByRole("region", { name: "Span" })).getByText("c".repeat(32)),
    ).toBeVisible();
  });

  it("opens on the first attempt recorded when the first arm has none", async () => {
    const both = twoArmTraces();
    traced = { ...both, traces: both.traces.filter((entry) => entry.run_id === ARM_B) };
    renderTraces();

    const picker = await screen.findByRole("group", { name: "Traced attempts" });
    expect(
      within(picker).getByRole("button", { name: "Arm B · turn 1 · attempt 1" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(picker).getByRole("button", { name: "Arm B · turn 2 · attempt 1" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("puts the chosen attempt in the address, replacing the entry, and reopens on it", async () => {
    const user = userEvent.setup();
    traced = twoArmTraces();
    const { router, unmount } = renderTraces();

    const picker = await screen.findByRole("group", {
      name: "Traced attempts",
    });
    await user.click(
      within(picker).getByRole("button", {
        name: "Arm B · turn 2 · attempt 1",
      }),
    );

    expect(router.state.historyAction).toBe("REPLACE");
    expect(new URLSearchParams(router.state.location.search).get("attempt")).toBe(`${ARM_B}:1:1`);

    // A reload is the same address read again from nothing.
    const address = `${router.state.location.pathname}${router.state.location.search}`;
    unmount();
    renderApp(address);

    const reopened = await screen.findByRole("group", {
      name: "Traced attempts",
    });
    const chosen = within(reopened).getByRole("button", {
      name: "Arm B · turn 2 · attempt 1",
    });
    expect(chosen).toHaveAttribute("aria-pressed", "true");
    expect(chosen).toHaveClass("bg-admin-chip");
    expect(
      within(screen.getByRole("region", { name: "Span" })).getByText("f".repeat(32)),
    ).toBeVisible();
  });

  it("opens on the first arm's first attempt when the address names no attempt it holds", async () => {
    traced = twoArmTraces();
    renderApp(`/lab/bench/${SHOP_ID}/${EXPERIMENT_ID}/results/traces?attempt=nothing:9:9`);

    const picker = await screen.findByRole("group", {
      name: "Traced attempts",
    });
    expect(
      within(picker).getByRole("button", {
        name: "Arm A · turn 1 · attempt 1",
      }),
    ).toHaveAttribute("aria-pressed", "true");
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

  it("refuses an empty tag and an empty note with a reason, and sends neither", async () => {
    const user = userEvent.setup();
    let notesPosted = 0;
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/notes`, () => {
        notesPosted += 1;
        return HttpResponse.json(annotations, { status: 201 });
      }),
    );
    renderResults();
    const strip = within(await screen.findByRole("region", { name: "Notes & tags" }));

    const addTag = strip.getByRole("button", { name: "Add tag" });
    expectRefused(addTag, "Type the tag to file this run under.");
    await user.click(addTag);
    await user.type(strip.getByLabelText("Add a tag"), "   {Enter}");
    expectRefused(addTag, "Type the tag to file this run under.");

    const addNote = strip.getByRole("button", { name: "Add note" });
    expectRefused(addNote, "Write the note before adding it.");
    await user.click(addNote);
    addNote.focus();
    await user.keyboard("{Enter}");
    // Without the press, each form's own handler refuses.
    await submitWithoutPressing(addTag);
    await submitWithoutPressing(addNote);

    expect(filed).toEqual([]);
    expect(notesPosted).toBe(0);

    await user.type(strip.getByLabelText("Add a tag"), "gap");
    expectNotRefused(addTag);
    await user.type(strip.getByLabelText("Add a note"), "Something.");
    expectNotRefused(addNote);
  });

  it("says an empty tag and an empty note as hints until their form is touched (ADR 0078)", async () => {
    const user = userEvent.setup();
    renderResults();
    const strip = within(await screen.findByRole("region", { name: "Notes & tags" }));
    const addTag = strip.getByRole("button", { name: "Add tag" });
    const addNote = strip.getByRole("button", { name: "Add note" });
    expectRefusalWeight(addTag, "hint");
    expectRefusalWeight(addNote, "hint");
    const tagBefore = refusalFacts(addTag);
    const noteBefore = refusalFacts(addNote);

    // Typed into, and still empty once stripped: the tag's line turns, the note's does not.
    await user.type(strip.getByLabelText("Add a tag"), "   ");
    expectRefusalWeight(addTag, "touched");
    expectRefusalWeight(addNote, "hint");
    expect(refusalFacts(addTag)).toEqual(tagBefore);

    // Pressed while refused: the note's line turns, and nothing is sent.
    await user.click(addNote);
    expectRefusalWeight(addNote, "touched");
    expect(refusalFacts(addNote)).toEqual(noteBefore);
    expect(filed).toEqual([]);
  });

  it("says the tag's refusal as a hint again once a tag was added and the box emptied", async () => {
    const user = userEvent.setup();
    renderResults();
    const strip = within(await screen.findByRole("region", { name: "Notes & tags" }));
    const addTag = strip.getByRole("button", { name: "Add tag" });
    await user.click(addTag);
    expectRefusalWeight(addTag, "touched");

    await user.type(strip.getByLabelText("Add a tag"), "gap{Enter}");
    await waitFor(() => expect(filed).toHaveLength(1));
    await waitFor(() => expectRefused(addTag, "Type the tag to file this run under."));
    expectRefusalWeight(addTag, "hint");
  });

  it("sends one note for a press made again while the first is in flight", async () => {
    const user = userEvent.setup();
    let notes = 0;
    let answer: () => void = () => {};
    server.use(
      http.post(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/notes`, async () => {
        notes += 1;
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
      }),
    );
    renderResults();
    const strip = await screen.findByRole("region", { name: "Notes & tags" });
    await user.type(within(strip).getByLabelText("Add a note"), "Once only.");
    const add = within(strip).getByRole("button", { name: "Add note" });
    await user.click(add);
    await waitFor(() => expect(notes).toBe(1));

    await waitFor(() => expectBusy(add));
    await user.click(add);
    await user.keyboard("{Enter}");
    await submitWithoutPressing(add);
    expect(notes).toBe(1);

    answer();
    expect(await within(strip).findByText("Once only.")).toBeVisible();
    expect(notes).toBe(1);
  });

  it("sends one tag write for a press made again while the first is in flight", async () => {
    const user = userEvent.setup();
    let writes = 0;
    let answer: () => void = () => {};
    server.use(
      http.put(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}/tags`, async () => {
        writes += 1;
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
      }),
    );
    renderResults();
    const strip = await screen.findByRole("region", { name: "Notes & tags" });
    await user.type(within(strip).getByLabelText("Add a tag"), "two-arm");
    const add = within(strip).getByRole("button", { name: "Add tag" });
    await user.click(add);
    await waitFor(() => expect(writes).toBe(1));

    await waitFor(() => expectBusy(add));
    await user.click(add);
    await user.keyboard("{Enter}");
    // And a submission that reaches the form without the press: its own handler holds too.
    await submitWithoutPressing(add);
    expect(writes).toBe(1);

    answer();
    expect(await within(strip).findByText("two-arm")).toBeVisible();
    expect(writes).toBe(1);
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

/** The one line beside Replay and Fork on the results header, which both are described by. */
const DERIVATIONS_ABOUT =
  "Replay runs this incident again as it was recorded; Fork runs it again with the arms you choose.";

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
    renderApp(`/lab/bench/${SHOP_ID}/${REPLAY_ID}/results`);

    const back = await screen.findByRole("link", {
      name: "Wrong address — framework comparison",
    });
    expect(back).toHaveAttribute("href", `/lab/bench/${SHOP_ID}/${EXPERIMENT_ID}/results`);
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
    const fork = within(panel).getByRole("button", { name: "Fork this run" });
    // Busy until arm B's v2 has answered with the name it was published under.
    await waitFor(() => expectNotRefused(fork));
    await user.click(fork);

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
    const fork = within(panel).getByRole("button", { name: "Fork this run" });
    expectRefused(fork, "Change at least one arm: a fork that changes nothing is a replay.");
    await user.click(fork);
    expect(forked).toEqual([]);
  });

  it("says a fork that moves nothing as a hint until an arm is touched or Fork pressed (ADR 0078)", async () => {
    const user = userEvent.setup();
    renderResults();

    await user.click(await screen.findByRole("button", { name: "Fork…" }));
    const panel = await screen.findByRole("region", { name: "Fork this experiment" });
    const fork = within(panel).getByRole("button", { name: "Fork this run" });
    // Opening the panel is not an attempt that failed.
    expectRefusalWeight(fork, "hint");
    const before = refusalFacts(fork);

    await user.click(fork);
    expectRefusalWeight(fork, "touched");
    expect(refusalFacts(fork)).toEqual(before);
    expect(forked).toEqual([]);
  });

  it("says a fork moved back to where it was at the refusal's weight: the arm was touched", async () => {
    const user = userEvent.setup();
    renderResults();

    await user.click(await screen.findByRole("button", { name: "Fork…" }));
    const panel = await screen.findByRole("region", { name: "Fork this experiment" });
    const fork = within(panel).getByRole("button", { name: "Fork this run" });
    expectRefusalWeight(fork, "hint");
    const before = refusalFacts(fork);
    const version = within(panel).getAllByLabelText("Published version")[1] as HTMLSelectElement;
    const pinned = version.value;
    const other = Array.from(version.options).find((option) => option.value !== pinned);
    expect(other, "the arm offers a version to move to").toBeDefined();

    await user.selectOptions(version, other?.value ?? "");
    await waitFor(() => expect(within(panel).queryByText(/Change at least one arm/)).toBeNull());
    await user.selectOptions(version, pinned);
    await waitFor(() => expectRefused(fork, "Change at least one arm"));
    expectRefusalWeight(fork, "touched");
    expect(refusalFacts(fork)).toEqual(before);
  });

  it("says which run a fork came from and what it changed", async () => {
    renderApp(`/lab/bench/${SHOP_ID}/${FORK_ID}/results`);

    const back = await screen.findByRole("link", {
      name: "Wrong address — framework comparison",
    });
    expect(back).toHaveAttribute("href", `/lab/bench/${SHOP_ID}/${EXPERIMENT_ID}/results`);
    expect(await screen.findByText(/fork of/)).toHaveTextContent("changed prompt");
  });

  it("warns on the derived screen when a fork left its own arms differing two ways", async () => {
    // Two comparisons, and both belong here. `changed` is the derivation's — what this fork
    // moved from the run it came from — and *What the arms differed on* is ADR 0025's, over
    // the arms this experiment actually holds. A fork is the operation most likely to turn a one-variable
    // source into a two-variable run, and the screen it lands on has to say so.
    renderApp(`/lab/bench/${SHOP_ID}/${FORK_ID}/results`);

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
    const fork = within(panel).getByRole("button", { name: "Fork this run" });
    await waitFor(() => expectNotRefused(fork));
    await user.click(fork);
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
    renderApp(`/lab/bench/${SHOP_ID}/${REPLAY_ID}`);

    const composer = await screen.findByRole("region", { name: "Customer composer" });

    expect(composer).toHaveTextContent(
      /driven by the run it was derived from, Wrong address — framework comparison/,
    );
  });
});

/**
 * Replay and Fork run their arms before they answer, so an arm naming a provider this lab
 * cannot reach is refused there with 422 and nothing written. The results screen says so first,
 * with the sentence setup's Start carries (ADR 0053 and its amendment).
 */
describe("replay, fork and the provider the lab can reach", () => {
  const NOTE =
    "Published configurations naming OpenAI cannot be advanced here until the lab has a connection for it.";
  const BROKEN_READ = {
    code: "internal_error",
    message: "The lab could not complete the request.",
    request_id: "r",
  };

  /**
   * Both reads that say what the lab reaches have answered, and the page has had its turn to
   * draw what they said: a control asserted enabled before then proves nothing.
   */
  async function connectionRead() {
    // Once each, which is all the results screen asks.
    await waitFor(() => {
      expect(connectionServed.statuses).toBe(1);
      expect(connectionServed.listings).toBe(1);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  /** The same, once exactly `distinct` versions the moved fork arms name have answered. */
  async function versionRead(distinct: number) {
    await connectionRead();
    await waitFor(() => expect(versionReads).toBe(distinct));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(versionReads).toBe(distinct);
  }

  function failing(route: "lab-status" | "model-connections") {
    return http.get(`*/api/v1/${route}`, () => {
      // Counted as served, so the wait still knows when the page has been answered.
      if (route === "lab-status") {
        connectionServed.statuses += 1;
      } else {
        connectionServed.listings += 1;
      }
      return HttpResponse.json(BROKEN_READ, { status: 500 });
    });
  }

  async function openFork(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "Fork…" }));
    return screen.findByRole("region", { name: "Fork this experiment" });
  }

  /** Move one fork arm onto a configuration, at the newest version the panel offers for it. */
  async function forkArmOnto(
    user: ReturnType<typeof userEvent.setup>,
    panel: HTMLElement,
    position: number,
    name: string,
  ) {
    const select = within(panel).getAllByLabelText("Agent configuration")[position];
    await waitFor(() => expect(within(select).getByRole("option", { name })).toBeEnabled());
    await user.selectOptions(select, name);
  }

  it("leaves Replay alone on a lab that reaches the provider its arms pinned", async () => {
    runProviders = ["openai", "openai"];
    renderResults();

    const replay = await screen.findByRole("button", { name: "Replay" });
    await connectionRead();

    expect(replay).toBeEnabled();
    expect(replay).not.toHaveAttribute("title");
    expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
  });

  for (const source of ["none", "saved_unreadable"] as const) {
    it(`disables Replay and says why once, when a lab on ${source} cannot reach what both arms pinned`, async () => {
      const user = userEvent.setup();
      connectionSource = source;
      runProviders = ["openai", "openai"];
      renderResults();

      const replay = await screen.findByRole("button", { name: "Replay" });
      await waitFor(() => expect(replay).toBeDisabled());
      // A secondary control, so natively disabled (ADR 0063): the reason in `title`, and in
      // one muted line the button's description names, after the line saying what Replay
      // is. Two arms on one provider are one reason.
      expect(replay).toHaveAttribute("title", NOTE);
      expect(replay).toHaveAccessibleDescription(`${DERIVATIONS_ABOUT} ${NOTE} ${DERIVING}`);
      expect(screen.getAllByText(NOTE)).toHaveLength(1);
      expect(screen.getByText(NOTE)).toBeVisible();

      await user.click(replay);
      expect(replayed).toEqual([]);
    });
  }

  it("replays a run on the declared control whatever the lab can reach", async () => {
    const user = userEvent.setup();
    connectionSource = "none";
    renderResults();

    const replay = await screen.findByRole("button", { name: "Replay" });
    await connectionRead();
    expect(replay).toBeEnabled();
    expect(screen.queryByText(/cannot be advanced here/)).toBeNull();

    await user.click(replay);
    expect(replayed).toEqual([EXPERIMENT_ID]);
  });

  for (const route of ["lab-status", "model-connections"] as const) {
    it(`leaves Replay and Fork alone when ${route} cannot be read, even on a lab that reaches nothing`, async () => {
      const user = userEvent.setup();
      connectionSource = "none";
      runProviders = ["openai", "openai"];
      server.use(failing(route));
      renderResults();

      const replay = await screen.findByRole("button", { name: "Replay" });
      const panel = await openFork(user);
      await forkArmOnto(user, panel, 1, "cfg-atlas");
      await connectionRead();

      expect(replay).toBeEnabled();
      expect(replay).not.toHaveAttribute("title");
      // Busy only while the moved arm's version is read for its name.
      await waitFor(() =>
        expectNotRefused(within(panel).getByRole("button", { name: "Fork this run" })),
      );
      expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
    });
  }

  it("leaves Fork alone on a lab that reaches the provider the chosen arms name", async () => {
    const user = userEvent.setup();
    renderResults();

    const panel = await openFork(user);
    await forkArmOnto(user, panel, 1, "cfg-atlas");
    await connectionRead();

    const fork = within(panel).getByRole("button", { name: "Fork this run" });
    // Busy only while the moved arm's version is read for its name.
    await waitFor(() => expectNotRefused(fork));
    expect(fork).not.toHaveAttribute("title");
    expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
  });

  for (const source of ["none", "saved_unreadable"] as const) {
    it(`disables Fork and says why once, when a lab on ${source} cannot reach the arms chosen`, async () => {
      const user = userEvent.setup();
      connectionSource = source;
      // Arm A stays on the version it pinned, which names OpenAI; arm B moves onto a
      // configuration whose version names it too. Two arms, one provider, one reason.
      runProviders = ["openai", "fake"];
      renderResults();

      const panel = await openFork(user);
      await forkArmOnto(user, panel, 1, "cfg-atlas");
      const fork = within(panel).getByRole("button", { name: "Fork this run" });

      await waitFor(() => expectRefused(fork, NOTE));
      expect(fork).toHaveAttribute("title", NOTE);
      expect(fork).toHaveAccessibleDescription(`${NOTE} ${DERIVING}`);
      expect(within(panel).getAllByText(NOTE)).toHaveLength(1);
      expect(within(panel).getByText(NOTE)).toBeVisible();

      await user.click(fork);
      expect(forked).toEqual([]);
    });
  }

  it("follows the arms chosen: an unreachable choice blocks Fork, a reachable one releases it", async () => {
    const user = userEvent.setup();
    connectionSource = "none";
    renderResults();

    const panel = await openFork(user);
    const fork = within(panel).getByRole("button", { name: "Fork this run" });

    // Arm B onto a configuration whose newest version names OpenAI: blocked.
    await forkArmOnto(user, panel, 1, "cfg-atlas");
    await waitFor(() => expectRefused(fork, NOTE));
    expect(fork).toHaveAccessibleDescription(`${NOTE} ${DERIVING}`);

    // Arm B onto the declared control's newest version instead: released.
    await forkArmOnto(user, panel, 1, "cfg-beacon");
    await waitFor(() => expectNotRefused(fork));
    expect(fork).not.toHaveAttribute("title");
    expect(within(panel).queryByText(/cannot be advanced here/)).toBeNull();

    // And blocked again when the choice moves back, from the version already read.
    await forkArmOnto(user, panel, 1, "cfg-atlas");
    await waitFor(() => expectRefused(fork, NOTE));

    await forkArmOnto(user, panel, 1, "cfg-beacon");
    await waitFor(() => expectNotRefused(fork));
    await user.click(fork);
    expect(forked).toEqual([
      [
        { configuration_id: ATLAS_ID, version: 1 },
        { configuration_id: BEACON_ID, version: 2 },
      ],
    ]);
  });

  it("keeps Fork blocked by an arm left on the version it pinned, whatever the moved arm names", async () => {
    const user = userEvent.setup();
    connectionSource = "none";
    // Arm A stays where it was, on a version naming OpenAI; arm B moves onto the control.
    runProviders = ["openai", "fake"];
    renderResults();

    const panel = await openFork(user);
    await forkArmOnto(user, panel, 1, "cfg-beacon");
    // The moved arm's version is read — the one version this fork moves onto.
    await versionRead(1);

    const fork = within(panel).getByRole("button", { name: "Fork this run" });
    expectRefused(fork, NOTE);
    expect(fork).toHaveAttribute("title", NOTE);
    expect(fork).toHaveAccessibleDescription(`${NOTE} ${DERIVING}`);
    await user.click(fork);
    expect(forked).toEqual([]);
  });

  it("leaves Fork alone when the version a chosen arm moves to cannot be read", async () => {
    const user = userEvent.setup();
    connectionSource = "none";
    server.use(
      http.get("*/api/v1/agent-configurations/:configurationId/versions/:version", () => {
        versionReads += 1;
        return HttpResponse.json(BROKEN_READ, { status: 500 });
      }),
    );
    renderResults();

    const panel = await openFork(user);
    await forkArmOnto(user, panel, 1, "cfg-atlas");
    await versionRead(1);

    await waitFor(() =>
      expectNotRefused(within(panel).getByRole("button", { name: "Fork this run" })),
    );
    expect(screen.queryByText(/cannot be advanced here/)).toBeNull();
  });
});

describe("what the arms differed on, in Configuration and Outcome", () => {
  /** The comparison fixture with only the named dimensions left differing. */
  function differingOnly(
    ...dimensions: ComparisonVariableSchema["dimension"][]
  ): ComparisonVariableSchema[] {
    return COMPARISON.map((entry) =>
      dimensions.includes(entry.dimension)
        ? entry
        : variable(entry.dimension, [entry.values[0], entry.values[0]]),
    );
  }

  function serveExperiment(overrides: Partial<ExperimentResponse>) {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}`, () =>
        HttpResponse.json({
          ...experiment(turns, agentTurns, toolEvents, mutationEvents),
          ...overrides,
        }),
      ),
    );
  }

  function serveComparison(comparison: ComparisonVariableSchema[]) {
    serveExperiment({ comparison });
  }

  /** The same experiment with arm A alone: one run, one value per dimension. */
  function serveOneArm() {
    const base = experiment(turns, agentTurns, toolEvents, mutationEvents);
    serveExperiment({
      runs: [base.runs[0]],
      arm_inputs: [[]],
      comparison: COMPARISON.map((entry) => variable(entry.dimension, [entry.values[0]])),
    });
  }

  async function differedOn() {
    return screen.findByRole("region", { name: "Configuration" });
  }

  /** What the differences let an operator attribute: Outcome's row, above the evidence. */
  function attribution(): HTMLElement {
    return within(screen.getByRole("region", { name: "Outcome" })).getByRole("row", {
      name: /^Attribution/,
    });
  }

  /** The arms' names over the drawn rows, as assistive technology hears them. */
  function columnHeaders(card: HTMLElement) {
    const [drawn] = within(card).getAllByRole("table", { hidden: true });
    return within(drawn)
      .getAllByRole("columnheader", { hidden: true })
      .map((head) => head.textContent);
  }

  /** A row's cells after the variable's own header, read left to right, open or folded. */
  function cellsOf(card: HTMLElement, dimension: RegExp) {
    return within(within(card).getByRole("row", { name: dimension, hidden: true }))
      .getAllByRole("cell", { hidden: true })
      .map((cell) => cell.textContent);
  }

  it("names each arm's value along the one difference and says it is attributable", async () => {
    serveComparison(differingOnly("framework"));
    renderResults();

    const card = await differedOn();
    // Each value sits in its arm's column, heard with the arm's name.
    expect(columnHeaders(card)).toEqual(["Variable", "Arm A", "Arm B"]);
    // The difference is drawn first, tinted, and said in words rather than in a column.
    const framework = within(card).getByRole("row", { name: /^Framework/ });
    expect(framework).toHaveClass("bg-admin-differs");
    expect(within(framework).getByText("Differs")).toBeVisible();
    expect(cellsOf(card, /^Framework/)).toEqual(["pydantic-ai", "fake"]);
    // An agreeing variable is one value across both arms, spelled as the lab spells it, behind
    // the disclosure that counts them.
    const same = within(card).getByText("6 variables are the same for both arms");
    expect(same.closest("details")).not.toHaveAttribute("open");
    expect(cellsOf(card, /^Architecture/)).toEqual(["Single agent"]);
    expect(cellsOf(card, /^Tone of voice/)).toEqual(["shop default"]);
    expect(same.closest("details")).toContainElement(
      within(card).getByRole("row", { name: /^Architecture/, hidden: true }),
    );
    expect(within(card).queryByText(/Difference|Assessment/)).toBeNull();
    // What that lets an operator attribute is said once, in Outcome, above the evidence.
    expect(
      within(attribution()).getByText(
        "One difference, so the behavior here is attributable to it.",
      ),
    ).toBeVisible();
    expect(within(card).queryByText(/attributable|attributed/)).toBeNull();
  });

  it("says two differences make nothing attributable, in the card and not as a chip", async () => {
    renderResults();

    const card = await differedOn();
    expect(cellsOf(card, /^Framework/)).toEqual(["pydantic-ai", "fake"]);
    expect(cellsOf(card, /^Model/)).toEqual([
      "openai/gpt-5-mini · temp 0.20 · 8 tool rounds",
      "fake/deterministic",
    ]);
    // The differences first, in the record's order, and every shared variable folded.
    const [drawn] = within(card).getAllByRole("table");
    expect(
      within(drawn)
        .getAllByRole("rowheader")
        .map((header) => header.firstElementChild?.firstElementChild?.textContent),
    ).toEqual(["Framework", "Model"]);
    expect(within(card).getByText("5 variables are the same for both arms")).toBeVisible();
    const confounded = "2 differences — no behavior here can be attributed to any one of them.";
    expect(within(attribution()).getByText(confounded)).toBeVisible();
    // The strip under the header keeps the pins and no longer says what differs.
    expect(screen.getAllByText(confounded)).toHaveLength(1);
    expect(screen.queryByText(/ differs$/)).toBeNull();
    expect(screen.getByText("scenario v1")).toBeVisible();
  });

  it("says nothing can be attributed when no dimension differs", async () => {
    serveComparison(differingOnly());
    renderResults();

    const card = await differedOn();
    expect(within(card).queryByText("Differs")).toBeNull();
    expect(
      within(card).getByText(`${COMPARISON.length} variables are the same for both arms`),
    ).toBeVisible();
    expect(
      within(attribution()).getByText(
        "No dimension differs, so nothing here can be attributed to a difference between the arms.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/attributable to it/)).toBeNull();
  });

  it("draws a differing prompt whole, for a reader who cannot hover", async () => {
    const long = (opening: string) =>
      `${opening} Read the order back before proposing anything, quote the address on file, ` +
      "and apply the change only with the confirmation the proposal answered with.";
    serveComparison(
      differingOnly().map((entry) =>
        entry.dimension === "prompt"
          ? variable("prompt", [long("You are support."), long("You are the returns desk.")])
          : entry,
      ),
    );
    renderResults();

    const card = await differedOn();
    const row = within(card).getByRole("row", { name: /^Prompt/ });
    const [armA, armB] = within(row).getAllByRole("cell");
    // The whole of each prompt is the cell's own text, and nothing in it is clamped: the
    // difference is in the text a keyboard, touch or screen reader reaches.
    expect(armA).toHaveTextContent(long("You are support."), { normalizeWhitespace: false });
    expect(armB).toHaveTextContent(long("You are the returns desk."));
    for (const cell of [armA, armB]) {
      expect(cell.querySelector("[class*='line-clamp']")).toBeNull();
      expect(cell).not.toHaveClass("line-clamp-2");
    }
  });

  it("names a support identity by the version each arm pinned and opens it", async () => {
    const frontline = "aadf1767-4c8f-4e39-965a-f67ba16edbe0";
    const escalation = "bbcf2871-4c8f-4e39-965a-f67ba16edbe1";
    const pin = (id: string, version: number) => ({
      definition_type: "support_identity",
      definition_id: id,
      version,
      content_fingerprint: "9".repeat(64),
    });
    serveExperiment({
      comparison: differingOnly().map((entry) =>
        entry.dimension === "support_identity"
          ? variable("support_identity", [frontline, escalation])
          : entry,
      ),
      arm_inputs: [[pin(frontline, 1)], [pin(escalation, 1)]],
    });
    renderResults();

    const card = await differedOn();
    const row = within(card).getByRole("row", { name: /^Support identity/ });
    expect(row).toHaveClass("bg-admin-differs");
    // Both at v1, and still told apart by their ids; each opens what that arm pinned.
    const a = within(row).getByRole("link", { name: "v1 · aadf1767" });
    expect(a).toHaveAttribute("href", `/lab/support-identities/${frontline}`);
    expect(a).toHaveAttribute("title", frontline);
    const b = within(row).getByRole("link", { name: "v1 · bbcf2871" });
    expect(b).toHaveAttribute("href", `/lab/support-identities/${escalation}`);
    expect(within(row).queryByText(frontline)).toBeNull();
  });

  it("opens the one support identity both arms pinned from the cell they share", async () => {
    const frontline = "aadf1767-4c8f-4e39-965a-f67ba16edbe0";
    const pin = {
      definition_type: "support_identity",
      definition_id: frontline,
      version: 2,
      content_fingerprint: "9".repeat(64),
    };
    serveExperiment({
      comparison: differingOnly().map((entry) =>
        entry.dimension === "support_identity"
          ? variable("support_identity", [frontline, frontline])
          : entry,
      ),
      arm_inputs: [[pin], [pin]],
    });
    renderResults();

    const card = await differedOn();
    const row = within(card).getByRole("row", { name: /^Support identity/, hidden: true });
    expect(within(row).getByRole("link", { name: "v2 · aadf1767", hidden: true })).toHaveAttribute(
      "href",
      `/lab/support-identities/${frontline}`,
    );
    expect(cellsOf(card, /^Support identity/)).toEqual(["v2 · aadf1767"]);
  });

  it("lists one support identity at v1 against v2 as the difference the server says it is", async () => {
    const frontline = "aadf1767-4c8f-4e39-965a-f67ba16edbe0";
    const pin = (version: number) => ({
      definition_type: "support_identity",
      definition_id: frontline,
      version,
      content_fingerprint: "9".repeat(64),
    });
    // The value is the identity's id in both arms; `differs` is the server's reading of the
    // id with the version each arm pinned (ADR 0042's 2026-10-27 amendment).
    serveExperiment({
      comparison: differingOnly().map((entry) =>
        entry.dimension === "support_identity"
          ? { ...variable("support_identity", [frontline, frontline]), differs: true }
          : entry,
      ),
      arm_inputs: [[pin(1)], [pin(2)]],
    });
    renderResults();

    const card = await differedOn();
    expect(cellsOf(card, /^Support identity/)).toEqual(["v1 · aadf1767", "v2 · aadf1767"]);
    const row = within(card).getByRole("row", { name: /^Support identity/ });
    expect(within(row).getByRole("link", { name: "v1 · aadf1767" })).toHaveAttribute(
      "href",
      `/lab/support-identities/${frontline}`,
    );
    expect(
      within(attribution()).getByText(
        "One difference, so the behavior here is attributable to it.",
      ),
    ).toBeVisible();
  });

  it("reads each value under the arm at its position, whatever order the runs arrive in", async () => {
    const base = experiment(turns, agentTurns, toolEvents, mutationEvents);
    serveExperiment({
      comparison: differingOnly("framework"),
      runs: [base.runs[1], base.runs[0]],
    });
    renderResults();

    const card = await differedOn();
    expect(columnHeaders(card)).toEqual(["Variable", "Arm A", "Arm B"]);
    expect(cellsOf(card, /^Framework/)).toEqual(["pydantic-ai", "fake"]);
  });

  it("says one arm has nothing to compare against rather than that it agrees", async () => {
    serveOneArm();
    renderResults();

    const card = await differedOn();
    expect(columnHeaders(card)).toEqual(["Variable", "Arm A"]);
    // One column, every variable drawn in it, nothing folded and nothing said to differ.
    expect(within(card).getAllByRole("table")).toHaveLength(1);
    expect(within(card).getAllByRole("row")).toHaveLength(COMPARISON.length + 1);
    expect(within(card).queryByText(/Differs|same for/)).toBeNull();
    expect(cellsOf(card, /^Framework/)).toEqual(["pydantic-ai"]);
    // Outcome says there is nothing to compare, and draws no divergence between one arm.
    const outcome = screen.getByRole("region", { name: "Outcome" });
    expect(
      within(attribution()).getByText("One arm ran, so there is nothing to compare it against."),
    ).toBeVisible();
    expect(within(outcome).queryByRole("row", { name: /^Input divergence/ })).toBeNull();
    expect(screen.queryByText(/No dimension differs/)).toBeNull();
  });

  it("says the same of one arm on the bench", async () => {
    serveOneArm();
    renderBench();

    const card = await screen.findByRole("region", { name: "Comparison variables" });
    expect(
      within(card).getByText("One arm ran, so there is nothing to compare it against."),
    ).toBeVisible();
    expect(within(card).queryByText(/No dimension differs/)).toBeNull();
  });

  it("reads the bench's comparison variables from the same rows and the same sentence", async () => {
    serveComparison(differingOnly("framework"));
    renderBench();

    const card = await screen.findByRole("region", { name: "Comparison variables" });
    expect(within(card).getByText("Framework")).toBeVisible();
    // Each arm's line, read whole: the arm's name, then its value.
    const lines = within(card)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(lines).toContain("Arm A: pydantic-ai");
    expect(lines).toContain("Arm B: fake");
    // Only what differs is listed on the bench.
    expect(within(card).queryByText("Architecture")).toBeNull();
    expect(
      within(card).getByText("One difference, so the behavior here is attributable to it."),
    ).toBeVisible();
  });
});

describe("the results as one sheet", () => {
  /** The same experiment with arm A alone. */
  function serveOneArm() {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}`, () => {
        const base = experiment(turns, agentTurns, toolEvents, mutationEvents);
        return HttpResponse.json({
          ...base,
          runs: [base.runs[0]],
          arm_inputs: [[]],
          comparison: COMPARISON.map((entry) => variable(entry.dimension, [entry.values[0]])),
        } satisfies ExperimentResponse);
      }),
    );
  }

  function strip(): HTMLElement | null {
    return document.querySelector("[data-sheet-strip]");
  }

  afterEach(() => vi.unstubAllGlobals());

  it("draws the tabs, then the arms in one row on the sheet's columns", async () => {
    renderResults();

    const armA = await screen.findByRole("region", { name: "Arm A summary" });
    const armB = screen.getByRole("region", { name: "Arm B summary" });
    const row = document.querySelector('[data-tour="results-arms"]') as HTMLElement;
    const tabs = screen.getByRole("navigation", { name: "Results views" });

    // One row holding both arms, under the tabs rather than above them.
    expect(row).toContainElement(armA);
    expect(row).toContainElement(armB);
    expect(tabs.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(row.style.gridTemplateColumns).toBe("240px repeat(2, minmax(0, 1fr))");
    // Its label cell says what the columns are not.
    expect(within(row).getByText("Compared arms")).toBeVisible();
    expect(within(row).getByText("Columns are never added into a winner.")).toBeVisible();
    // Each arm's position letter is drawn again for the eye and not heard twice.
    expect(within(armA).getByRole("heading", { name: "Arm A" })).toBeVisible();
    expect(within(armA).getByText("A")).toHaveAttribute("aria-hidden", "true");
    expect(within(armB).getByText("B")).toHaveAttribute("aria-hidden", "true");
    // What it ran, opening its editor, and its count in the display face, in one ink.
    expect(within(armA).getByRole("link", { name: "Atlas v1" })).toHaveAttribute(
      "title",
      "Open Atlas, whose draft published v1",
    );
    const count = within(armA).getByText("0 of 0");
    expect(count).toHaveClass("font-display", "text-admin-ink");
    expect(within(armB).getByText("0 of 0")).toHaveClass("text-admin-ink");
    expect(count.parentElement).toHaveTextContent("0 of 0 decided objectives met");
  });

  it("keeps the summary row on every tab", async () => {
    const user = userEvent.setup();
    renderResults();

    await screen.findByRole("region", { name: "Arm A summary" });
    await user.click(screen.getByRole("link", { name: "Execution timeline" }));

    expect(await screen.findByRole("region", { name: "Arm A summary" })).toBeVisible();
    expect(document.querySelectorAll('[data-tour="results-arms"]')).toHaveLength(1);
  });

  it("reaches every section of General from a chip, in the sheet's order", async () => {
    renderResults();

    const sections = await screen.findByRole("navigation", { name: "Sections" });
    const chips = within(sections).getAllByRole("link");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "Outcome",
      "Objectives",
      "Business state",
      "Configuration",
      "Usage",
      "Provenance",
      "Notes",
    ]);
    const targets = chips.map((chip) => {
      const href = chip.getAttribute("href") ?? "";
      // The fragment on the results' own address: the chip stays on the page it is on.
      expect(href.startsWith(`/lab/bench/${SHOP_ID}/${EXPERIMENT_ID}/results#`)).toBe(true);
      const id = href.split("#")[1] ?? "";
      const target = document.getElementById(id);
      expect(target, chip.textContent ?? "").not.toBeNull();
      return target as HTMLElement;
    });
    // Each chip lands on what it names, the cards not yet drawn as sections included.
    const [outcome, objectives, state, configuration, usage, provenance, notes] = targets;
    expect(outcome).toBe(screen.getByRole("region", { name: "Outcome" }));
    expect(objectives).toBe(screen.getByRole("region", { name: "Objectives" }));
    expect(state).toBe(screen.getByRole("region", { name: "Business state" }));
    expect(configuration).toBe(screen.getByRole("region", { name: "Configuration" }));
    expect(usage).toBe(screen.getByRole("region", { name: "Usage" }));
    expect(provenance).toContainElement(screen.getByRole("region", { name: "Provenance" }));
    expect(notes).toContainElement(screen.getByRole("region", { name: "Notes & tags" }));
    // One column, top to bottom in that order: no rail beside the evidence.
    for (const [before, after] of targets
      .slice(0, -1)
      .map((target, i) => [target, targets[i + 1]])) {
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(after.parentElement).toBe(outcome.parentElement);
    }
    // The chips sit under the summary row.
    const row = document.querySelector('[data-tour="results-arms"]') as HTMLElement;
    expect(row.compareDocumentPosition(sections) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("moves the reader to the section a chip names, and again on a second press", async () => {
    const user = userEvent.setup();
    const { router } = renderResults();

    const sections = await screen.findByRole("navigation", { name: "Sections" });
    await user.click(within(sections).getByRole("link", { name: "Usage" }));

    expect(router.state.location.hash).toBe("#usage");
    expect(screen.getByRole("region", { name: "Usage" })).toHaveFocus();
    // Ringed as every focus is, where the browser shows focus. jsdom draws no ring and has no
    // `:focus-visible` heuristic, so the test checks the class set that draws it.
    expect(screen.getByRole("region", { name: "Usage" })).toHaveClass(
      "focus-visible:outline-2",
      "focus-visible:outline-lab-primary",
    );
    expect(document.getElementById("notes")).toHaveClass("focus-visible:outline-2");

    // Away and back by the same chip: focus lands on it again.
    await user.click(within(sections).getByRole("link", { name: "Notes" }));
    expect(document.getElementById("notes")).toHaveFocus();
    await user.click(within(sections).getByRole("link", { name: "Usage" }));
    expect(screen.getByRole("region", { name: "Usage" })).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    await user.click(within(sections).getByRole("link", { name: "Usage" }));
    expect(screen.getByRole("region", { name: "Usage" })).toHaveFocus();
  });

  it("reads Outcome per arm: what each met and where it stands", async () => {
    toolEvents = [toolEvent(ARM_A, 0, "support.read_document")];
    renderResults();

    const outcome = await screen.findByRole("region", { name: "Outcome" });

    expect(sheetCells(outcome, "Decided objectives met")).toEqual(["1 of 1", "0 of 0"]);
    expect(sheetCells(outcome, "Status")).toEqual([
      "Waiting for the agent at turn 1",
      "Waiting for the agent at turn 1",
    ]);
    expect(
      within(outcome).getByText(
        "There is no aggregate score: each arm's count is of the rows something actually decided for it.",
      ),
    ).toBeVisible();
    // Attribution spans the arms: it is a fact about the run, not about either of them.
    const [attributed] = within(sheetRow(outcome, "Attribution")).getAllByRole("cell");
    expect(attributed).toHaveAttribute("colspan", "2");
  });

  it("names the arms over their columns in a strip pinned over General, unheard", async () => {
    renderResults();

    await screen.findByRole("region", { name: "Outcome" });
    const pinned = strip();

    expect(pinned).not.toBeNull();
    expect(pinned).toHaveAttribute("aria-hidden", "true");
    expect(pinned).toHaveClass("sticky", "-top-5", "border-b", "bg-admin-canvas");
    expect(pinned?.style.gridTemplateColumns).toBe("240px repeat(2, minmax(0, 1fr))");
    expect(Array.from(pinned?.children ?? [], (cell) => cell.textContent)).toEqual([
      "General",
      "AArm A",
      "BArm B",
    ]);
    // Pinned over the sections it names the columns of, as their column's first child.
    expect(pinned?.parentElement).toContainElement(screen.getByRole("region", { name: "Usage" }));
  });

  it("pins no strip on a tab this slice has not put on the columns", async () => {
    renderTimeline();

    await screen.findByRole("region", { name: "Arm A summary" });
    expect(strip()).toBeNull();
  });

  it("reads a one-arm run as one column, with no strip and nothing compared", async () => {
    serveOneArm();
    renderResults();

    const usage = await screen.findByRole("region", { name: "Usage" });

    expect(strip()).toBeNull();
    expect(within(usage).getAllByRole("table")).toHaveLength(1);
    // Every measure drawn in the arm's one column, none said to differ or to be shared.
    expect(within(usage).getAllByRole("row")).toHaveLength(15);
    expect(within(usage).queryByText(/Differs|same for/)).toBeNull();
    expect(sheetCells(usage, "Turns")).toEqual(["1"]);
    const row = document.querySelector('[data-tour="results-arms"]') as HTMLElement;
    expect(row.style.gridTemplateColumns).toBe("240px repeat(1, minmax(0, 1fr))");
  });

  it("stacks every row at a phone's width, each cell under a line naming its arm", async () => {
    stubViewport("narrow");
    agentTurns = [agentTurn(ARM_A, 0)];
    toolEvents = [toolEvent(ARM_A, 0, "orders.read_order")];
    renderResults();

    const usage = await screen.findByRole("region", { name: "Usage" });

    // No strip at a phone's width: each cell names its own arm.
    expect(strip()).toBeNull();
    const row = sheetRow(usage, "Tool calls");
    expect(row).not.toHaveAttribute("style");
    expect(row).toHaveClass("block");
    expect(sheetCells(usage, "Tool calls")).toEqual(["Arm A1", "Arm B0"]);
    const [armA, armB] = within(row).getAllByRole("cell");
    expect(within(armA).getByText("Arm A")).toBeVisible();
    expect(within(armB).getByText("Arm B")).toBeVisible();
    // A row spanning the arms names none: it is about the run.
    const outcome = screen.getByRole("region", { name: "Outcome" });
    expect(sheetCells(outcome, "Attribution")[0]).not.toMatch(/^Arm /);
    // The summary row stacks too.
    const summary = document.querySelector('[data-tour="results-arms"]') as HTMLElement;
    expect(summary.style.gridTemplateColumns).toBe("");
  });

  it("draws the strip again once the viewport widens past a phone's", async () => {
    const viewport = stubViewport("narrow");
    renderResults();

    await screen.findByRole("region", { name: "Usage" });
    expect(strip()).toBeNull();

    viewport.resize("wide");

    expect(strip()).not.toBeNull();
    expect(sheetCells(screen.getByRole("region", { name: "Usage" }), "Turns")).toEqual(["1"]);
  });
});

describe("the record on the General tab", () => {
  const BLOCKS = {
    "03089d7f-b0ee-47a6-88bb-050d0f11d50f": "redirect-the-order",
    "1710d64d-17db-46b8-a0cf-9edb61e82ded": "read-required-document",
    "8e53720a-4f57-4c50-8331-424e918739a5": "explain-the-change-to-the-customer",
  } as const;
  const MUTATION = "bbbdf977-073d-4acc-a3d4-85a5a098511d";
  const IDENTITY = "aadf1767-4c8f-4e39-965a-f67ba16edbe0";

  function pin(definition_type: string, definition_id: string, version = 1) {
    return { definition_type, definition_id, version, content_fingerprint: "9".repeat(64) };
  }

  /** The seeded run's shape: three objective blocks and a mutation block, all at v1. */
  function serveSeededPins(overrides: Partial<ExperimentResponse> = {}) {
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}`, () => {
        const record = experiment(turns, agentTurns, toolEvents, mutationEvents);
        return HttpResponse.json({
          ...record,
          sandbox_inputs: [
            ...record.sandbox_inputs,
            pin("mutation_block", MUTATION),
            ...Object.keys(BLOCKS).map((id) => pin("objective_block", id)),
          ],
          arm_inputs: [
            [pin("agent_configuration", ATLAS_ID), pin("support_identity", IDENTITY)],
            [pin("agent_configuration", BEACON_ID), pin("support_identity", IDENTITY)],
          ],
          ...overrides,
        } satisfies ExperimentResponse);
      }),
      http.get("*/api/v1/objective-blocks/:blockId/versions/:version", ({ params }) => {
        const name = BLOCKS[String(params.blockId) as keyof typeof BLOCKS];
        return name === undefined
          ? HttpResponse.json({ detail: "not found" }, { status: 404 })
          : HttpResponse.json(blockVersion(String(params.blockId), name));
      }),
      http.get(`*/api/v1/mutation-blocks/${MUTATION}/versions/1`, () =>
        HttpResponse.json(blockVersion(MUTATION, "concurrent-entity-mutation")),
      ),
    );
  }

  function blockVersion(blockId: string, name: string) {
    return {
      block_id: blockId,
      lifecycle_state: "published",
      version: 1,
      content_fingerprint: "9".repeat(64),
      published_at: "2026-08-28T09:00:00+00:00",
      content: { name, statement: name, description: "", parameters: [] },
    };
  }

  it("names each pinned block by its own name, beside the record's fingerprints and each arm's inputs", async () => {
    serveSeededPins();
    renderResults();

    const provenance = await screen.findByRole("region", { name: "Provenance" });
    const pinned = within(provenance).getByRole("list", { name: "What this run pinned" });
    // Three objective blocks at v1 are three blocks, each by the name its version was published
    // under, and each still opens what it pinned.
    for (const [id, name] of Object.entries(BLOCKS)) {
      expect(
        await within(pinned).findByRole("link", { name: `Objective block · ${name} v1` }),
      ).toHaveAttribute("href", `/lab/objective-blocks/${id}`);
    }
    expect(
      within(pinned).getByRole("link", { name: "Mutation block · concurrent-entity-mutation v1" }),
    ).toHaveAttribute("href", `/lab/mutation-blocks/${MUTATION}`);
    expect(within(provenance).queryByText("Objective block v1")).toBeNull();
    expect(within(pinned).getByRole("link", { name: "scenario v1" })).toBeVisible();

    // The starting state, the fingerprint of everything the run resolved, and who drove it.
    expect(within(provenance).getByTitle(SANDBOX_FINGERPRINT)).toBeVisible();
    expect(within(provenance).getByTitle(RESOLUTION_FINGERPRINT)).toBeVisible();
    expect(within(provenance).getByText("human operator")).toBeVisible();

    // Each arm's own inputs, under the arm: its configuration by name, and its identity.
    const armA = within(provenance).getByRole("list", { name: "What Arm A pinned" });
    expect(within(armA).getByRole("link", { name: "Atlas v1" })).toHaveAttribute(
      "href",
      `/lab/agent-configurations/${ATLAS_ID}`,
    );
    expect(within(armA).getByRole("link", { name: "Support identity v1" })).toHaveAttribute(
      "href",
      `/lab/support-identities/${IDENTITY}`,
    );
    const armB = within(provenance).getByRole("list", { name: "What Arm B pinned" });
    expect(within(armB).getByRole("link", { name: "Beacon v1" })).toBeVisible();

    // Its section's place on the sheet, which its chip and the tour reach.
    expect(document.getElementById("provenance")).toContainElement(provenance);
    expect(document.querySelector('[data-tour="results-provenance"]')).toContainElement(provenance);
  });

  it("keeps a block it could not read as the type and version the record carries", async () => {
    // Blocks of their own: a name another case read is kept for the page's life, which is the
    // point of the cache and no business of this case.
    const unread = [
      "c1000000-0000-4000-8000-000000000001",
      "c1000000-0000-4000-8000-000000000002",
      "c1000000-0000-4000-8000-000000000003",
    ];
    serveSeededPins({
      sandbox_inputs: [
        ...experiment([]).sandbox_inputs,
        pin("mutation_block", MUTATION),
        ...unread.map((id) => pin("objective_block", id)),
      ],
    });
    server.use(
      http.get("*/api/v1/objective-blocks/:blockId/versions/:version", () =>
        HttpResponse.json({ detail: "unavailable" }, { status: 503 }),
      ),
    );
    renderResults();

    const provenance = await screen.findByRole("region", { name: "Provenance" });
    expect(
      await within(provenance).findByRole("link", {
        name: "Mutation block · concurrent-entity-mutation v1",
      }),
    ).toBeVisible();
    await waitFor(() =>
      expect(within(provenance).getAllByRole("link", { name: "Objective block v1" })).toHaveLength(
        3,
      ),
    );
  });

  it("reads each block version once, however often it is pinned and however often the rail returns", async () => {
    const once = "d2000000-0000-4000-8000-000000000001";
    const reads: string[] = [];
    serveSeededPins({
      sandbox_inputs: [...experiment([]).sandbox_inputs, pin("objective_block", once)],
      // Pinned again by both arms: three pins of one version.
      arm_inputs: [[pin("objective_block", once)], [pin("objective_block", once)]],
    });
    server.use(
      http.get(`*/api/v1/objective-blocks/${once}/versions/1`, () => {
        reads.push(once);
        return HttpResponse.json(blockVersion(once, "read-once"));
      }),
    );
    const user = userEvent.setup();
    renderResults();

    const provenance = await screen.findByRole("region", { name: "Provenance" });
    expect(
      await within(provenance).findAllByRole("link", { name: "Objective block · read-once v1" }),
    ).toHaveLength(3);
    expect(reads).toEqual([once]);

    // Away to another tab and back: the rail mounts again, and the immutable version is not
    // asked a second time.
    await user.click(screen.getByRole("link", { name: "Execution timeline" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Provenance" })).toBeNull());
    await user.click(screen.getByRole("link", { name: "General" }));
    const again = await screen.findByRole("region", { name: "Provenance" });
    expect(
      within(again).getAllByRole("link", { name: "Objective block · read-once v1" }),
    ).toHaveLength(3);
    expect(reads).toEqual([once]);
  });

  it("links a derived run to the run it came from, in the rail and nowhere else", async () => {
    renderApp(`/lab/bench/${SHOP_ID}/${FORK_ID}/results`);

    const provenance = await screen.findByRole("region", { name: "Provenance" });
    const source = within(provenance).getByRole("link", {
      name: "Wrong address — framework comparison",
    });
    expect(source).toHaveAttribute("href", `/lab/bench/${SHOP_ID}/${EXPERIMENT_ID}/results`);
    expect(source.parentElement).toHaveTextContent(
      "A fork of Wrong address — framework comparison · changed prompt",
    );
    // Said once: the header no longer names the source beside the seed.
    expect(
      screen.getAllByRole("link", { name: "Wrong address — framework comparison" }),
    ).toHaveLength(1);
  });

  it("names no source for a run nothing was derived from", async () => {
    renderResults();

    const provenance = await screen.findByRole("region", { name: "Provenance" });
    expect(within(provenance).queryByText(/ of /)).toBeNull();
    expect(
      within(provenance)
        .queryAllByRole("link")
        .filter((link) => link.getAttribute("href")?.includes("/lab/bench/")),
    ).toEqual([]);
  });

  it("ends every card on the General tab with one sentence, the rest in the tour", async () => {
    renderResults();

    await screen.findByRole("region", { name: "Provenance" });
    for (const name of ["Provenance", "Notes & tags"]) {
      const footer = screen.getByRole("region", { name }).lastElementChild as HTMLElement;
      const text = (footer.textContent ?? "").trim();
      expect(text.match(/[.!?](\s|$)/g), `${name}: ${text}`).toHaveLength(1);
    }
    // A section of the sheet says it in one note under its title, where the card had a footer,
    // and a group of its rows in one note under its heading.
    const notes = [
      ...["Outcome", "Objectives", "Business state", "Configuration", "Usage"].map(
        (name) => screen.getByRole("region", { name }).querySelector("h2 + p") as HTMLElement,
      ),
      ...screen.getByRole("region", { name: "Objectives" }).querySelectorAll("h3 + p"),
    ];
    expect(notes).toHaveLength(7);
    for (const note of notes) {
      const text = (note?.textContent ?? "").trim();
      expect(text.match(/[.!?](\s|$)/g), text).toHaveLength(1);
    }

    // What the footers said and no longer say is still said, by the walk around this screen.
    const tour = TOURS.results.steps.flatMap((step) => step.body).join(" ");
    for (const claim of [
      "neither is a miss",
      "never overwrites a deterministic row",
      "nothing can have moved without appearing there",
      "annotating a run never moves the versions or the starting state it pinned",
      "history narrows by them",
      "the arms are answering different conversations",
    ]) {
      expect(tour).toContain(claim);
    }
  });

  it("names each arm once in the fork panel's legends", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`*/api/v1/shops/${SHOP_ID}/experiments/${EXPERIMENT_ID}`, () => {
        const record = experiment(turns, agentTurns, toolEvents, mutationEvents);
        // The seeded run's arms carry their configuration's name as their label.
        return HttpResponse.json({
          ...record,
          runs: [{ ...record.runs[0], agent_configuration_name: "Arm A" }, record.runs[1]],
        } satisfies ExperimentResponse);
      }),
    );
    renderResults();

    await user.click(await screen.findByRole("button", { name: "Fork…" }));
    const panel = await screen.findByRole("region", { name: "Fork this experiment" });
    expect(
      within(panel)
        .getAllByRole("group")
        .map((group) => group.textContent),
    ).toEqual([
      expect.stringMatching(/^Arm A · ran configuration v1/),
      expect.stringMatching(/^Arm B · ran Beacon v1/),
    ]);
    expect(within(panel).getByText("Arm A · ran configuration v1")).toBeVisible();
  });
});
