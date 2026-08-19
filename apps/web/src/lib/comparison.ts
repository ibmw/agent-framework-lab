import type { ActionProposalResponse, ConversationResponse } from "@agent-lab/contracts";
import { AGENT_CAPABILITIES } from "./bench";

export const READ_TOOLS = ["read_customer", "list_products", "list_customer_orders"] as const;

const CAPABILITY_WORDS: Record<number, string> = {
  0: "zero",
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
};

export type SignalTone = "agree" | "differs" | "muted";

export interface ComparisonSide {
  frameworkId: string;
  modelId: string | null;
  capabilities: string[];
  provenCount: number;
  unproven: string[];
  toolSequence: string[];
  readToolsLabel: string;
  turnsToProposal: number | null;
  confirmation: { text: string; tone: SignalTone };
  determinism: { text: string; tone: SignalTone };
}

export interface DivergenceCell {
  label: string;
  divergent: boolean;
}

export interface ComparisonDiff {
  left: ComparisonSide;
  right: ComparisonSide;
  sameCapabilities: boolean;
  sameToolPath: boolean;
  verdictTitle: string;
  verdictBody: string;
  divergence: DivergenceCell[];
}

export function toolSequence(conversation: ConversationResponse): string[] {
  return conversation.turns.flatMap((turn) =>
    turn.tool_activity.map((activity) => activity.tool_name),
  );
}

export function readToolsLabel(tools: string[]): string {
  const reads = READ_TOOLS.filter((tool) => tools.includes(tool));
  const firstReadIndex = tools.findIndex((tool) =>
    (READ_TOOLS as readonly string[]).includes(tool),
  );
  const orderedSlice =
    firstReadIndex === -1
      ? []
      : tools
          .slice(firstReadIndex)
          .filter((tool) => (READ_TOOLS as readonly string[]).includes(tool));
  const inFixedOrder =
    reads.length === READ_TOOLS.length &&
    orderedSlice.slice(0, READ_TOOLS.length).join() === READ_TOOLS.join();
  if (inFixedOrder) {
    return "all three, fixed order";
  }
  if (reads.length === 3) {
    return "all three";
  }
  if (reads.length === 2) {
    return "two, on demand";
  }
  if (reads.length === 1) {
    return "one";
  }
  return "none";
}

export function turnsToProposal(conversation: ConversationResponse): number | null {
  const index = conversation.turns.findIndex((turn) =>
    turn.tool_activity.some((activity) => activity.tool_name === "cancel_order"),
  );
  return index === -1 ? null : index + 1;
}

export function confirmationSignal(proposal: ActionProposalResponse | undefined): {
  text: string;
  tone: SignalTone;
} {
  if (!proposal) {
    return { text: "not reached", tone: "muted" };
  }
  if (proposal.status === "executed" || proposal.status === "confirmed") {
    return {
      text: `yes · token matched, attempts ${Math.max(proposal.attempts, 1)}`,
      tone: "agree",
    };
  }
  if (proposal.status === "cancelled") {
    return { text: "cancelled · no write", tone: "muted" };
  }
  return { text: `proposed · attempts ${proposal.attempts}`, tone: "muted" };
}

export function determinismSignal(frameworkId: string): { text: string; tone: SignalTone } {
  if (frameworkId === "fake") {
    return { text: "byte-identical on replay", tone: "agree" };
  }
  return { text: "wording varies · state does not", tone: "differs" };
}

export function comparisonSide(
  conversation: ConversationResponse,
  capabilities: string[],
  proposal: ActionProposalResponse | undefined,
  modelId: string | null,
): ComparisonSide {
  const proven = AGENT_CAPABILITIES.filter((capability) => capabilities.includes(capability));
  const unproven = AGENT_CAPABILITIES.filter((capability) => !capabilities.includes(capability));
  const tools = toolSequence(conversation);
  return {
    frameworkId: conversation.framework_id,
    modelId,
    capabilities,
    provenCount: proven.length,
    unproven: [...unproven],
    toolSequence: tools,
    readToolsLabel: readToolsLabel(tools),
    turnsToProposal: turnsToProposal(conversation),
    confirmation: confirmationSignal(proposal),
    determinism: determinismSignal(conversation.framework_id),
  };
}

export function divergenceStrip(left: ComparisonSide, right: ComparisonSide): DivergenceCell[] {
  const leftTools = left.toolSequence;
  const rightTools = right.toolSequence;
  const cells: DivergenceCell[] = [];
  const seen = new Set<string>();

  function pushTool(tool: string, owner: "both" | "left" | "right") {
    if (seen.has(tool)) {
      return;
    }
    seen.add(tool);
    if (owner === "both") {
      cells.push({
        label: tool === "cancel_order" ? "propose cancel_order" : tool,
        divergent: false,
      });
      return;
    }
    const framework = owner === "left" ? left.frameworkId : right.frameworkId;
    cells.push({
      label: `${tool} — ${framework} only`,
      divergent: true,
    });
  }

  const max = Math.max(leftTools.length, rightTools.length);
  for (let index = 0; index < max; index += 1) {
    const leftTool = leftTools[index];
    const rightTool = rightTools[index];
    if (leftTool && rightTool && leftTool === rightTool) {
      pushTool(leftTool, "both");
      continue;
    }
    if (leftTool && rightTools.includes(leftTool)) {
      pushTool(leftTool, "both");
    } else if (leftTool) {
      pushTool(leftTool, "left");
    }
    if (rightTool && leftTools.includes(rightTool)) {
      pushTool(rightTool, "both");
    } else if (rightTool) {
      pushTool(rightTool, "right");
    }
  }

  const leftExecuted = left.confirmation.tone === "agree";
  const rightExecuted = right.confirmation.tone === "agree";
  if (leftExecuted || rightExecuted) {
    cells.push({
      label: "confirm → execute",
      divergent: leftExecuted !== rightExecuted,
    });
  }

  return cells;
}

export function buildComparisonDiff(left: ComparisonSide, right: ComparisonSide): ComparisonDiff {
  const sameCapabilities =
    left.provenCount === right.provenCount && left.unproven.join() === right.unproven.join();
  const sameToolPath = left.toolSequence.join() === right.toolSequence.join();
  const countWord = CAPABILITY_WORDS[left.provenCount] ?? String(left.provenCount);

  let verdictTitle: string;
  let verdictBody: string;
  if (sameCapabilities && !sameToolPath) {
    verdictTitle = `Both prove the same ${countWord} capabilities. They do not behave the same.`;
    verdictBody =
      "Identical capability sets, identical fingerprint — and still two different paths to the same cancellation. That gap is the thing worth showing.";
  } else if (!sameCapabilities) {
    verdictTitle = "The adapters do not prove the same capabilities.";
    verdictBody =
      "The capability gap is the first signal; the tool paths below show how that difference shows up in a run.";
  } else {
    verdictTitle = "Both prove the same capabilities and followed the same path.";
    verdictBody =
      "Same fingerprint, same tools, same sequence. Replay both sides if you want to confirm it holds.";
  }

  return {
    left,
    right,
    sameCapabilities,
    sameToolPath,
    verdictTitle,
    verdictBody,
    divergence: divergenceStrip(left, right),
  };
}

export function frameworkColumnLabel(side: ComparisonSide): string {
  return side.modelId ? `${side.frameworkId} · ${side.modelId}` : side.frameworkId;
}
