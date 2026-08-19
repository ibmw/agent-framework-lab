import type {
  ActionProposalResponse,
  ConversationResponse,
  ConversationSummaryResponse,
  GeneratedScenarioResponse,
  GeneratedScenarioSummaryResponse,
} from "@agent-lab/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";

const generationUrl = "*/api/v1/scenarios/retail-profile/versions/v1/generations";
const profileRef = "retail-profile~v1~20260816";
const actionRef = "retail-order-cancellation~v1~20260816";

const generatedPersona: GeneratedScenarioResponse = {
  metadata: {
    scenario_id: "retail-profile",
    scenario_version: "v1",
    policy_set_version: "v1",
    canonical_schema_version: "v1",
    seed: 20_260_816,
    created_at: "2026-08-16T12:30:00Z",
  },
  initial_state_hash: "a".repeat(64),
  initial_state: {
    canonical_schema_version: "v1",
    scenario: { id: "retail-profile", version: "v1", policy_set_version: "v1" },
    seed: 20_260_816,
    persona: {
      id: "9c18b065-702a-8fe6-8f54-14264d47d1f8",
      display_name: "Maya Chen",
      email: "maya.chen@example.test",
      locale: "en-US",
      support_traits: ["patient", "detail_oriented"],
    },
    customer: {
      id: "0a8a3f2f-08b0-8621-9462-4b0526606da4",
      display_name: "Maya Chen",
      email: "maya.chen@example.test",
      created_at: "2025-06-03T10:00:00Z",
    },
    products: [
      {
        id: "61d52e91-8914-8b0b-b958-604c28fda509",
        sku: "TRAVEL-MUG",
        name: "Travel mug",
        price_amount: "24.00",
        currency: "USD",
      },
      {
        id: "e21a875d-da77-82a3-a83d-c702b89d80ba",
        sku: "DESK-LAMP",
        name: "Desk lamp",
        price_amount: "58.00",
        currency: "USD",
      },
    ],
    orders: [
      {
        id: "b6a83a75-09e3-8462-8c82-e38460883ea0",
        customer_id: "0a8a3f2f-08b0-8621-9462-4b0526606da4",
        created_at: "2026-01-12T09:15:00Z",
        status: "paid",
        version: 1,
      },
    ],
  },
};

const emptyConversation: ConversationResponse = {
  id: "10000000-0000-4000-8000-000000000000",
  customer_id: generatedPersona.initial_state.customer.id,
  scenario_id: "retail-profile",
  scenario_version: "v1",
  seed: 20_260_816,
  framework_id: "fake",
  initial_state_hash: generatedPersona.initial_state_hash,
  created_at: "2026-08-18T12:00:00Z",
  turns: [],
};

const conversationWithTurn: ConversationResponse = {
  ...emptyConversation,
  turns: [
    {
      id: "20000000-0000-4000-8000-000000000000",
      ordinal: 1,
      request_message: "What orders are on my account?",
      response_message: "I found one paid order.",
      structured_result: {
        summary: "Customer profile, product catalog, and order history retrieved.",
        customer_id: generatedPersona.initial_state.customer.id,
        product_ids: generatedPersona.initial_state.products.map((product) => product.id),
        order_ids: generatedPersona.initial_state.orders.map((order) => order.id),
      },
      tool_activity: [
        {
          tool_name: "list_customer_orders",
          tool_version: "v1",
          outcome: "success",
          result: { orders: [] },
        },
      ],
      trace_id: "a".repeat(32),
      created_at: "2026-08-18T12:01:00Z",
    },
  ],
};

const actionGeneratedPersona: GeneratedScenarioResponse = {
  ...generatedPersona,
  metadata: {
    ...generatedPersona.metadata,
    scenario_id: "retail-order-cancellation",
    policy_set_version: "v2",
  },
  initial_state: {
    ...generatedPersona.initial_state,
    scenario: { id: "retail-order-cancellation", version: "v1", policy_set_version: "v2" },
  },
};

const actionEmptyConversation: ConversationResponse = {
  ...emptyConversation,
  scenario_id: "retail-order-cancellation",
};

const proposedAction: ActionProposalResponse = {
  id: "30000000-0000-4000-8000-000000000000",
  session_id: emptyConversation.id,
  action_type: "cancel_order",
  tool_name: "cancel_order",
  tool_version: "v1",
  order_id: generatedPersona.initial_state.orders[0].id,
  expected_version: 1,
  summary: `Cancel paid order ${generatedPersona.initial_state.orders[0].id} at version 1.`,
  confirmation_token: "c".repeat(64),
  status: "proposed",
  attempts: 0,
  result_order_status: null,
  result_order_version: null,
  trace_id: "b".repeat(32),
};

function personaSummary(
  overrides: Partial<GeneratedScenarioSummaryResponse> = {},
): GeneratedScenarioSummaryResponse {
  return {
    scenario_id: "retail-profile",
    scenario_version: "v1",
    seed: 20_260_816,
    display_name: "Maya Chen",
    locale: "en-US",
    initial_state_hash: "a".repeat(64),
    created_at: "2026-08-16T12:30:00Z",
    last_activity_at: "2026-08-18T12:00:00Z",
    conversation_count: 1,
    ...overrides,
  };
}

function conversationSummary(
  overrides: Partial<ConversationSummaryResponse> = {},
): ConversationSummaryResponse {
  return {
    id: emptyConversation.id,
    scenario_id: "retail-profile",
    scenario_version: "v1",
    seed: 20_260_816,
    framework_id: "fake",
    created_at: "2026-08-18T12:00:00Z",
    last_activity_at: "2026-08-18T12:00:00Z",
    turn_count: 0,
    ...overrides,
  };
}

function conversationListBody(conversations: ConversationSummaryResponse[], total?: number) {
  return { conversations, page: 1, page_size: 25, total: total ?? conversations.length };
}

const frameworksResponse = {
  frameworks: [
    {
      framework_id: "fake",
      available: true,
      model_id: null,
      capabilities: ["tool_calls", "session_resume", "structured_output"],
    },
    {
      framework_id: "pydantic-ai",
      available: false,
      model_id: "gpt-5-mini",
      capabilities: [],
      unavailability_reason: "credential missing",
    },
  ],
};

function libraryBody(generations: GeneratedScenarioSummaryResponse[], total?: number) {
  return { generations, page: 1, page_size: 25, total: total ?? generations.length };
}

function emptyLibrary() {
  return http.get("*/api/v1/scenarios/generations", () => HttpResponse.json(libraryBody([])));
}

function personaResource(persona: GeneratedScenarioResponse, seed = 20_260_816) {
  return http.get(
    `*/api/v1/scenarios/${persona.metadata.scenario_id}/versions/${persona.metadata.scenario_version}/generations/${seed}`,
    () => HttpResponse.json(persona),
  );
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  // The library and persona pages both read the framework list; tests may override it.
  server.use(http.get("*/api/v1/agent-frameworks", () => HttpResponse.json(frameworksResponse)));
});
afterEach(() => {
  server.resetHandlers();
  window.localStorage.clear();
});
afterAll(() => server.close());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

async function enterReplayInputs() {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole("combobox", { name: "Scenario" }), "retail-profile@v1");
  await user.type(screen.getByRole("textbox", { name: "Seed" }), "20260816");
  return user;
}

function conversationGoalCard() {
  const heading = screen.getByRole("heading", { name: "Your goal as the customer" });
  const card = heading.closest("aside");
  if (!(card instanceof HTMLElement)) {
    throw new Error("Expected the customer goal card to be present.");
  }
  return within(card);
}

describe("persona library", () => {
  it("renders the hero, generator, and an empty persona library", async () => {
    server.use(emptyLibrary());
    renderAt("/");

    expect(
      screen.getByRole("heading", { name: "Meet the customer before the agent." }),
    ).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Scenario" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Seed" })).toBeVisible();
    expect(await screen.findByText(/No personas yet/)).toBeVisible();
  });

  it("validates scenario and seed before making a request", async () => {
    server.use(emptyLibrary());
    const user = userEvent.setup();
    renderAt("/");

    const scenario = screen.getByRole("combobox", { name: "Scenario" });
    const seed = screen.getByRole("textbox", { name: "Seed" });

    await user.click(screen.getByRole("button", { name: "Generate persona" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a scenario");
    expect(scenario).toHaveAttribute("aria-invalid", "true");

    await user.selectOptions(scenario, "retail-profile@v1");
    await user.type(seed, "0x10");
    await user.click(screen.getByRole("button", { name: "Generate persona" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Use decimal digits");
    expect(seed).toHaveAttribute("aria-invalid", "true");
  });

  it("explains the selected scenario and randomizes the seed", async () => {
    server.use(emptyLibrary());
    const user = userEvent.setup();
    renderAt("/");

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Scenario" }),
      "retail-profile@v1",
    );
    expect(
      screen.getByText("A fictional customer, two products, and one paid order."),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Randomize" }));
    const seed = screen.getByRole("textbox", { name: "Seed" });
    expect(seed).toBeInstanceOf(HTMLInputElement);
    expect((seed as HTMLInputElement).value).toMatch(/^\d+$/);
  });

  it("lists past personas and opens one", async () => {
    server.use(
      http.get("*/api/v1/scenarios/generations", () =>
        HttpResponse.json(libraryBody([personaSummary()])),
      ),
      personaResource(generatedPersona),
      http.get("*/api/v1/conversations", () => HttpResponse.json(conversationListBody([]))),
      http.get("*/api/v1/agent-frameworks", () => HttpResponse.json(frameworksResponse)),
    );
    const user = userEvent.setup();
    renderAt("/");

    await user.click(await screen.findByRole("button", { name: /^Maya Chen/ }));

    expect(await screen.findByRole("heading", { name: "Maya Chen" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Conversations" })).toBeVisible();
    expect(await screen.findByText(/No conversations match these filters yet/)).toBeVisible();
  });

  it("pages the persona library by number", async () => {
    server.use(
      http.get("*/api/v1/scenarios/generations", ({ request }) => {
        const requestedPage = Number(new URL(request.url).searchParams.get("page") ?? "1");
        return HttpResponse.json({
          generations: [
            personaSummary({
              display_name: requestedPage === 1 ? "First persona" : "Second persona",
              seed: requestedPage,
              initial_state_hash: String(requestedPage).repeat(64).slice(0, 64),
            }),
          ],
          page: requestedPage,
          page_size: 25,
          total: 26, // two pages at the default page size of 25
        });
      }),
    );
    const user = userEvent.setup();
    renderAt("/");

    expect(await screen.findByText("First persona")).toBeVisible();
    expect(screen.getByText(/Page 1 of 2/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Second persona")).toBeVisible();
    expect(screen.getByText(/Page 2 of 2/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Page 1" }));
    expect(await screen.findByText("First persona")).toBeVisible();
  });

  it("filters the library by scenario, framework, activity window, and page size", async () => {
    const requests: URLSearchParams[] = [];
    server.use(
      http.get("*/api/v1/scenarios/generations", ({ request }) => {
        const params = new URL(request.url).searchParams;
        requests.push(params);
        return HttpResponse.json(libraryBody([personaSummary()]));
      }),
    );
    const user = userEvent.setup();
    renderAt("/");

    await screen.findByText("Maya Chen");
    expect(requests.at(-1)?.get("page_size")).toBe("25");

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter by scenario" }),
      "retail-order-cancellation@v1",
    );
    await waitFor(() =>
      expect(requests.at(-1)?.get("scenario_id")).toBe("retail-order-cancellation"),
    );
    expect(requests.at(-1)?.get("scenario_version")).toBe("v1");

    await screen.findByRole("option", { name: "fake" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by framework" }), "fake");
    await waitFor(() => expect(requests.at(-1)?.get("framework_id")).toBe("fake"));

    await user.selectOptions(screen.getByRole("combobox", { name: "Active within" }), "24h");
    await waitFor(() => expect(requests.at(-1)?.get("active_since")).not.toBeNull());

    await user.selectOptions(screen.getByRole("combobox", { name: "Per page" }), "50");
    await waitFor(() => expect(requests.at(-1)?.get("page_size")).toBe("50"));
  });

  it("deletes a persona and clears its saved conversation shortcut", async () => {
    let deleted = false;
    server.use(
      http.get("*/api/v1/scenarios/generations", () =>
        HttpResponse.json(libraryBody(deleted ? [] : [personaSummary()])),
      ),
      http.delete("*/api/v1/scenarios/retail-profile/versions/v1/generations/20260816", () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    window.localStorage.setItem(
      "agent-lab:last-conversation",
      `/personas/${profileRef}/conversations/${emptyConversation.id}`,
    );
    const user = userEvent.setup();
    renderAt("/");

    expect(screen.getByRole("link", { name: "Resume your last conversation" })).toBeVisible();
    await user.click(await screen.findByRole("button", { name: "Delete persona Maya Chen" }));
    expect(screen.getByText(/Delete Maya Chen and 1 conversation/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Confirm persona delete" }));

    await waitFor(() => expect(screen.queryByText("Maya Chen")).not.toBeInTheDocument());
    expect(deleted).toBe(true);
    expect(window.localStorage.getItem("agent-lab:last-conversation")).toBeNull();
    expect(screen.queryByRole("link", { name: "Resume your last conversation" })).toBeNull();
  });
});

describe("generating a persona", () => {
  it("generates and navigates to the persona page", async () => {
    server.use(
      emptyLibrary(),
      http.post(generationUrl, () => HttpResponse.json(generatedPersona, { status: 201 })),
      personaResource(generatedPersona),
      http.get("*/api/v1/conversations", () => HttpResponse.json(conversationListBody([]))),
      http.get("*/api/v1/agent-frameworks", () => HttpResponse.json(frameworksResponse)),
    );
    renderAt("/");
    const user = await enterReplayInputs();

    await user.click(screen.getByRole("button", { name: "Generate persona" }));

    expect(await screen.findByRole("heading", { name: "Maya Chen" })).toBeVisible();
    expect(screen.getByText("maya.chen@example.test")).toBeVisible();
    expect(screen.getByText("detail oriented")).toBeVisible();
  });

  it("shows a recoverable network-error state and stays on the library", async () => {
    server.use(
      emptyLibrary(),
      http.post(generationUrl, () => HttpResponse.error()),
    );
    renderAt("/");
    const user = await enterReplayInputs();

    await user.click(screen.getByRole("button", { name: "Generate persona" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn’t load the persona");
    expect(screen.getByRole("button", { name: "Generate persona" })).toBeEnabled();
  });
});

describe("conversations", () => {
  it("starts a new conversation with a command-id idempotency key", async () => {
    let startKey: string | null = null;
    server.use(
      personaResource(generatedPersona),
      http.get("*/api/v1/conversations", () => HttpResponse.json(conversationListBody([]))),
      http.get("*/api/v1/agent-frameworks", () => HttpResponse.json(frameworksResponse)),
      http.post("*/api/v1/conversations", async ({ request }) => {
        startKey = request.headers.get("Idempotency-Key");
        expect(await request.json()).toMatchObject({ framework_id: "fake" });
        return HttpResponse.json(emptyConversation, { status: 201 });
      }),
      http.get(`*/api/v1/conversations/${emptyConversation.id}`, () =>
        HttpResponse.json(emptyConversation),
      ),
    );
    renderAt(`/personas/${profileRef}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Start new conversation" }));

    expect(await screen.findByRole("heading", { name: "Support conversation" })).toBeVisible();
    expect(startKey).toMatch(/^conversation:retail-profile:v1:20260816:fake:.+/);
  });

  it("resumes an existing conversation from the persona history", async () => {
    server.use(
      personaResource(generatedPersona),
      http.get("*/api/v1/conversations", () =>
        HttpResponse.json(conversationListBody([conversationSummary({ turn_count: 1 })])),
      ),
      http.get("*/api/v1/agent-frameworks", () => HttpResponse.json(frameworksResponse)),
      http.get(`*/api/v1/conversations/${emptyConversation.id}`, () =>
        HttpResponse.json(conversationWithTurn),
      ),
    );
    renderAt(`/personas/${profileRef}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("link", { name: /Resume/ }));

    expect(await screen.findByRole("heading", { name: "Support conversation" })).toBeVisible();
    expect(await screen.findByText("I found one paid order.")).toBeVisible();
  });

  it("resumes a conversation directly from its URL and exposes evidence", async () => {
    server.use(
      personaResource(generatedPersona),
      http.get(`*/api/v1/conversations/${emptyConversation.id}`, () =>
        HttpResponse.json(conversationWithTurn),
      ),
    );
    renderAt(`/personas/${profileRef}/conversations/${emptyConversation.id}`);

    expect(await screen.findByRole("heading", { name: "Support conversation" })).toBeVisible();
    expect(await screen.findByText("I found one paid order.")).toBeVisible();
    expect(screen.getByText("list_customer_orders@v1 · success")).toBeVisible();
    expect(conversationGoalCard().getByText(/a clear picture of your account/i)).toBeVisible();
  });

  it("rejects a conversation URL whose persona reference does not match", async () => {
    const path = `/personas/${profileRef}/conversations/${emptyConversation.id}`;
    window.localStorage.setItem("agent-lab:last-conversation", path);
    server.use(
      personaResource(generatedPersona),
      http.get(`*/api/v1/conversations/${emptyConversation.id}`, () =>
        HttpResponse.json(actionEmptyConversation),
      ),
    );

    renderAt(path);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This conversation could not be loaded",
    );
    expect(screen.queryByRole("heading", { name: "Support conversation" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("agent-lab:last-conversation")).toBeNull();
  });

  it("clears a saved conversation shortcut when the conversation is gone", async () => {
    const path = `/personas/${profileRef}/conversations/${emptyConversation.id}`;
    window.localStorage.setItem("agent-lab:last-conversation", path);
    server.use(
      personaResource(generatedPersona),
      http.get(`*/api/v1/conversations/${emptyConversation.id}`, () =>
        HttpResponse.json(
          {
            code: "conversation_not_found",
            message: "The conversation was not found",
            request_id: "request-missing",
          },
          { status: 404 },
        ),
      ),
    );

    renderAt(path);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This conversation could not be loaded",
    );
    expect(window.localStorage.getItem("agent-lab:last-conversation")).toBeNull();
  });

  it("sends a message and appends the assistant turn", async () => {
    server.use(
      personaResource(generatedPersona),
      http.get(`*/api/v1/conversations/${emptyConversation.id}`, () =>
        HttpResponse.json(emptyConversation),
      ),
      http.post("*/api/v1/conversations/*/messages", async ({ request }) => {
        expect(await request.json()).toEqual({ message: "What orders are on my account?" });
        return HttpResponse.json(conversationWithTurn);
      }),
    );
    renderAt(`/personas/${profileRef}/conversations/${emptyConversation.id}`);

    const composer = await screen.findByRole("textbox", { name: "Support message" });
    const user = userEvent.setup();
    await user.type(composer, "What orders are on my account?");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("I found one paid order.")).toBeVisible();
    expect(screen.getByText("a".repeat(32))).toBeVisible();
  });

  it("filters the conversation history by framework, activity, and page size", async () => {
    const requests: URLSearchParams[] = [];
    server.use(
      personaResource(generatedPersona),
      http.get("*/api/v1/conversations", ({ request }) => {
        requests.push(new URL(request.url).searchParams);
        return HttpResponse.json(conversationListBody([conversationSummary({ turn_count: 1 })]));
      }),
    );
    const user = userEvent.setup();
    renderAt(`/personas/${profileRef}`);

    await screen.findByText(/1 turn\b/);
    expect(requests.at(-1)?.get("scenario_id")).toBe("retail-profile");
    expect(requests.at(-1)?.get("seed")).toBe("20260816");
    expect(requests.at(-1)?.get("page_size")).toBe("25");

    const frameworkFilter = screen.getByRole("combobox", { name: "Framework" });
    await waitFor(() =>
      expect(within(frameworkFilter).getByRole("option", { name: "fake" })).toBeInTheDocument(),
    );
    await user.selectOptions(frameworkFilter, "fake");
    await waitFor(() => expect(requests.at(-1)?.get("framework_id")).toBe("fake"));

    await user.selectOptions(screen.getByRole("combobox", { name: "Active within" }), "24h");
    await waitFor(() => expect(requests.at(-1)?.get("active_since")).not.toBeNull());

    await user.selectOptions(screen.getByRole("combobox", { name: "Per page" }), "50");
    await waitFor(() => expect(requests.at(-1)?.get("page_size")).toBe("50"));
  });

  it("deletes a conversation from the persona history", async () => {
    const target = conversationSummary({
      id: "40000000-0000-4000-8000-000000000000",
      turn_count: 1,
    });
    const kept = conversationSummary({
      id: "50000000-0000-4000-8000-000000000000",
      turn_count: 2,
    });
    let deleted = false;
    server.use(
      personaResource(generatedPersona),
      http.get("*/api/v1/conversations", () =>
        HttpResponse.json(conversationListBody(deleted ? [kept] : [target, kept])),
      ),
      http.delete(`*/api/v1/conversations/${target.id}`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    window.localStorage.setItem(
      "agent-lab:last-conversation",
      `/personas/${profileRef}/conversations/${target.id}`,
    );
    const user = userEvent.setup();
    renderAt(`/personas/${profileRef}`);

    const targetMeta = await screen.findByText(/1 turn\b/);
    const targetRow = targetMeta.closest("li");
    if (!(targetRow instanceof HTMLElement)) {
      throw new Error("Expected the conversation row to be present.");
    }
    await user.click(within(targetRow).getByRole("button", { name: "Delete conversation" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(screen.queryByText(/1 turn\b/)).not.toBeInTheDocument());
    expect(screen.getByText(/2 turns\b/)).toBeVisible();
    expect(deleted).toBe(true);
    expect(window.localStorage.getItem("agent-lab:last-conversation")).toBeNull();
  });
});

describe("safe order actions", () => {
  it("shows proposal, exact confirmation, and executed action states", async () => {
    server.use(
      personaResource(actionGeneratedPersona),
      http.get(`*/api/v1/conversations/${emptyConversation.id}`, () =>
        HttpResponse.json(actionEmptyConversation),
      ),
      http.post("*/actions/proposals", async ({ request }) => {
        expect(await request.json()).toEqual({
          action_type: "cancel_order",
          order_id: proposedAction.order_id,
          expected_version: 1,
        });
        return HttpResponse.json(proposedAction, { status: 201 });
      }),
      http.post("*/actions/*/decision", async ({ request }) => {
        expect(await request.json()).toEqual({
          decision: "confirm",
          confirmation_token: proposedAction.confirmation_token,
        });
        return HttpResponse.json({ ...proposedAction, status: "confirmed" });
      }),
      http.post("*/actions/*/execution", () =>
        HttpResponse.json({
          ...proposedAction,
          status: "executed",
          attempts: 1,
          result_order_status: "cancelled",
          result_order_version: 2,
        }),
      ),
    );
    renderAt(`/personas/${actionRef}/conversations/${emptyConversation.id}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Propose order cancellation" }));
    expect(await screen.findByText("Proposal ready")).toBeVisible();
    expect(conversationGoalCard().getByText(/cancel your paid order/i)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Confirm exact action" }));
    expect(await screen.findByText("Confirmed")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Execute cancellation" }));
    expect(await screen.findByText("Executed")).toBeVisible();
    expect(screen.getByText(/Order is cancelled at version 2. Attempts: 1/)).toBeVisible();
  });

  it("restores a persisted action state on reload", async () => {
    window.localStorage.setItem(
      `agent-lab:action-proposal:${actionEmptyConversation.id}`,
      proposedAction.id,
    );
    server.use(
      personaResource(actionGeneratedPersona),
      http.get(`*/api/v1/conversations/${actionEmptyConversation.id}`, () =>
        HttpResponse.json(actionEmptyConversation),
      ),
      http.get(`*/actions/${proposedAction.id}`, () =>
        HttpResponse.json({
          ...proposedAction,
          status: "executed",
          attempts: 1,
          result_order_status: "cancelled",
          result_order_version: 2,
        }),
      ),
    );
    renderAt(`/personas/${actionRef}/conversations/${actionEmptyConversation.id}`);

    expect(await screen.findByText("Executed")).toBeVisible();
    expect(screen.getByText(/Order is cancelled at version 2. Attempts: 1/)).toBeVisible();
  });

  it("offers an idempotent retry after a transient execution failure", async () => {
    let executions = 0;
    server.use(
      personaResource(actionGeneratedPersona),
      http.get(`*/api/v1/conversations/${emptyConversation.id}`, () =>
        HttpResponse.json(actionEmptyConversation),
      ),
      http.post("*/actions/proposals", () => HttpResponse.json(proposedAction, { status: 201 })),
      http.post("*/actions/*/decision", () =>
        HttpResponse.json({ ...proposedAction, status: "confirmed" }),
      ),
      http.post("*/actions/*/execution", () => {
        executions += 1;
        if (executions === 1) {
          return HttpResponse.json(
            {
              code: "action_transient_error",
              message: "The action could not complete after safe retry attempts",
              request_id: "request-retry",
            },
            { status: 503 },
          );
        }
        return HttpResponse.json({
          ...proposedAction,
          status: "executed",
          attempts: 1,
          result_order_status: "cancelled",
          result_order_version: 2,
        });
      }),
    );
    renderAt(`/personas/${actionRef}/conversations/${emptyConversation.id}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Propose order cancellation" }));
    await user.click(await screen.findByRole("button", { name: "Confirm exact action" }));
    await user.click(await screen.findByRole("button", { name: "Execute cancellation" }));

    expect(await screen.findByText("Retry available")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry execution safely" }));
    expect(await screen.findByText("Executed")).toBeVisible();
    expect(executions).toBe(2);
  });
});
