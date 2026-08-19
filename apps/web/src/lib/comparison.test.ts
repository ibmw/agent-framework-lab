import type { ActionProposalResponse, ConversationResponse } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import { buildComparisonDiff, comparisonSide, readToolsLabel, turnsToProposal } from "./comparison";

const capabilities = ["tool_calls", "conversation_memory", "session_resume", "structured_output"];

function conversation(frameworkId: string, tools: string[][]): ConversationResponse {
  return {
    id: `${frameworkId}-session`,
    customer_id: "00000000-0000-4000-8000-000000000001",
    scenario_id: "retail-order-cancellation",
    scenario_version: "v1",
    seed: 1,
    framework_id: frameworkId,
    initial_state_hash: "a".repeat(64),
    created_at: "2026-08-19T12:00:00Z",
    turns: tools.map((names, index) => ({
      id: `${frameworkId}-turn-${index}`,
      ordinal: index + 1,
      request_message: "cancel",
      response_message: "ok",
      structured_result: {
        summary: "summary",
        customer_id: "00000000-0000-4000-8000-000000000001",
        product_ids: [],
        order_ids: [],
      },
      tool_activity: names.map((tool_name) => ({
        tool_name,
        tool_version: "v1",
        outcome: "success",
        result: {},
      })),
      trace_id: null,
      created_at: "2026-08-19T12:01:00Z",
    })),
  };
}

const executed: ActionProposalResponse = {
  id: "proposal",
  session_id: "session",
  action_type: "cancel_order",
  tool_name: "cancel_order",
  tool_version: "v1",
  order_id: "order",
  expected_version: 1,
  summary: "Cancel",
  confirmation_token: "c".repeat(64),
  status: "executed",
  attempts: 1,
  result_order_status: "cancelled",
  result_order_version: 2,
  trace_id: null,
};

describe("comparison signals", () => {
  it("labels a fixed three-read path and an on-demand two-read path", () => {
    expect(
      readToolsLabel(["read_customer", "list_products", "list_customer_orders", "cancel_order"]),
    ).toBe("all three, fixed order");
    expect(readToolsLabel(["read_customer", "list_customer_orders"])).toBe("two, on demand");
  });

  it("counts turns until cancel_order is proposed", () => {
    const fake = conversation("fake", [
      ["read_customer", "list_products", "list_customer_orders", "cancel_order"],
    ]);
    const live = conversation("pydantic-ai", [
      ["read_customer"],
      ["list_customer_orders", "cancel_order"],
    ]);
    expect(turnsToProposal(fake)).toBe(1);
    expect(turnsToProposal(live)).toBe(2);
  });

  it("derives the same-capabilities different-path verdict and marks the split tool", () => {
    const left = comparisonSide(
      conversation("fake", [
        ["read_customer", "list_products", "list_customer_orders", "cancel_order"],
      ]),
      capabilities,
      executed,
      null,
    );
    const right = comparisonSide(
      conversation("pydantic-ai", [["read_customer"], ["list_customer_orders", "cancel_order"]]),
      capabilities,
      executed,
      "gpt-5-mini",
    );
    const diff = buildComparisonDiff(left, right);

    expect(diff.verdictTitle).toBe(
      "Both prove the same four capabilities. They do not behave the same.",
    );
    expect(diff.sameCapabilities).toBe(true);
    expect(diff.sameToolPath).toBe(false);
    expect(
      diff.divergence.some((cell) => cell.label.includes("list_products") && cell.divergent),
    ).toBe(true);
  });
});
