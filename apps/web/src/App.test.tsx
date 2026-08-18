import type { ConversationResponse, GeneratedScenarioResponse } from "@agent-lab/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "./App";

const generationUrl = "*/api/v1/scenarios/retail-profile/versions/v1/generations";

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
    scenario: {
      id: "retail-profile",
      version: "v1",
      policy_set_version: "v1",
    },
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

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  window.localStorage.clear();
});
afterAll(() => server.close());

async function enterReplayInputs() {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole("combobox", { name: "Scenario" }), "retail-profile@v1");
  await user.type(screen.getByRole("textbox", { name: "Seed" }), "20260816");
  return user;
}

describe("human persona journey", () => {
  it("starts with scenario controls and an informative empty state", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Meet the customer before the agent." }),
    ).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Scenario" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Seed" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Your generated persona will appear here." }),
    ).toBeVisible();
  });

  it("shows scenario and seed validation before making a request", async () => {
    const user = userEvent.setup();
    render(<App />);

    const scenario = screen.getByRole("combobox", { name: "Scenario" });
    const seed = screen.getByRole("textbox", { name: "Seed" });

    await user.click(screen.getByRole("button", { name: "Generate persona" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a scenario");
    expect(scenario).toHaveAttribute("aria-invalid", "true");
    expect(scenario).toHaveAttribute("aria-describedby", "form-error");
    expect(seed).not.toHaveAttribute("aria-invalid", "true");
    expect(seed).toHaveAttribute("aria-describedby", "seed-help");

    await user.selectOptions(scenario, "retail-profile@v1");
    for (const invalidSeed of ["4.5", "0x10", "1e3"]) {
      await user.clear(seed);
      await user.type(seed, invalidSeed);
      await user.click(screen.getByRole("button", { name: "Generate persona" }));

      expect(screen.getByRole("alert")).toHaveTextContent("Use decimal digits");
      expect(seed).toHaveAttribute("aria-invalid", "true");
      expect(seed).toHaveAttribute("aria-describedby", "form-error");
      expect(scenario).not.toHaveAttribute("aria-invalid", "true");
      expect(scenario).toHaveAttribute("aria-describedby", "scenario-help");
    }
  });

  it("announces loading and renders the generated persona summary", async () => {
    let releaseRequest: (() => void) | undefined;
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    server.use(
      http.post(generationUrl, async ({ request }) => {
        expect(request.headers.get("Idempotency-Key")).toBe("persona:retail-profile:v1:20260816");
        expect(await request.json()).toEqual({ seed: 20_260_816 });
        await requestGate;
        return HttpResponse.json(generatedPersona, { status: 201 });
      }),
    );
    render(<App />);
    const user = await enterReplayInputs();

    await user.click(screen.getByRole("button", { name: "Generate persona" }));
    expect(screen.getByRole("status")).toHaveTextContent("Generating deterministic state");

    releaseRequest?.();
    expect(await screen.findByRole("heading", { name: "Maya Chen" })).toBeVisible();
    expect(screen.getByText("maya.chen@example.test")).toBeVisible();
    expect(screen.getByText("detail oriented")).toBeVisible();
    expect(screen.getByText("retail-profile@v1")).toBeVisible();
    expect(screen.getByText("20260816")).toBeVisible();
    expect(screen.getByText("a".repeat(64))).toBeVisible();
  });

  it("shows a recoverable network-error state", async () => {
    server.use(http.post(generationUrl, () => HttpResponse.error()));
    render(<App />);
    const user = await enterReplayInputs();

    await user.click(screen.getByRole("button", { name: "Generate persona" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn’t load the persona");
    expect(alert).toHaveTextContent("Could not reach the scenario API");
    expect(
      screen.queryByRole("heading", { name: "Your generated persona will appear here." }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate persona" })).toBeEnabled();
  });

  it("starts a support conversation and exposes tool and trace evidence", async () => {
    server.use(
      http.post(generationUrl, () => HttpResponse.json(generatedPersona, { status: 201 })),
      http.get("*/api/v1/agent-frameworks", () =>
        HttpResponse.json({
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
        }),
      ),
      http.post("*/api/v1/conversations", () =>
        HttpResponse.json(emptyConversation, { status: 201 }),
      ),
      http.post("*/api/v1/conversations/*/messages", async ({ request }) => {
        expect(await request.json()).toEqual({ message: "What orders are on my account?" });
        return HttpResponse.json(conversationWithTurn);
      }),
    );
    render(<App />);
    const user = await enterReplayInputs();
    await user.click(screen.getByRole("button", { name: "Generate persona" }));
    await screen.findByRole("heading", { name: "Maya Chen" });

    await user.click(screen.getByRole("button", { name: "Start support conversation" }));
    expect(
      await screen.findByRole("heading", { name: "Read-only support conversation" }),
    ).toBeVisible();
    expect(screen.getByText("pydantic-ai · unsupported locally")).toBeVisible();

    await user.type(
      screen.getByRole("textbox", { name: "Support message" }),
      "What orders are on my account?",
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("I found one paid order.")).toBeVisible();
    expect(screen.getByText("list_customer_orders@v1 · success")).toBeVisible();
    expect(screen.getByText("a".repeat(32))).toBeVisible();
  });

  it("resumes a saved support session on reload", async () => {
    window.localStorage.setItem("agent-lab-support-session", emptyConversation.id);
    server.use(
      http.get(`*/api/v1/conversations/${emptyConversation.id}`, () =>
        HttpResponse.json(conversationWithTurn),
      ),
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Read-only support conversation" }),
    ).toBeVisible();
    expect(await screen.findByText("I found one paid order.")).toBeVisible();
  });
});
