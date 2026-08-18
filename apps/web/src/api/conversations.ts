import type {
  ActionProposalResponse,
  AgentFrameworkListResponse,
  ConversationResponse,
  DecideOrderActionRequest,
  ErrorResponse,
  ProposeOrderActionRequest,
  SendConversationMessageRequest,
  StartConversationRequest,
} from "@agent-lab/contracts";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class ConversationApiError extends Error {
  readonly status: number;
  readonly requestId?: string;
  readonly code?: string;

  constructor(message: string, status: number, requestId?: string, code?: string) {
    super(message);
    this.name = "ConversationApiError";
    this.status = status;
    this.requestId = requestId;
    this.code = code;
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }
  let error: ErrorResponse | undefined;
  try {
    error = (await response.json()) as ErrorResponse;
  } catch {
    // Keep non-contract intermediary details out of the UI.
  }
  throw new ConversationApiError(
    error?.message ?? "The support service could not complete the request.",
    response.status,
    error?.request_id,
    error?.code,
  );
}

export async function listAgentFrameworks(): Promise<AgentFrameworkListResponse> {
  return readResponse(await fetch(`${API_BASE_URL}/api/v1/agent-frameworks`));
}

export async function startConversation(
  command: StartConversationRequest,
): Promise<ConversationResponse> {
  return readResponse(
    await fetch(`${API_BASE_URL}/api/v1/conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `conversation:${command.scenario_id}:${command.scenario_version}:${command.seed}:${command.framework_id}`,
      },
      body: JSON.stringify(command),
    }),
  );
}

export async function getConversation(sessionId: string): Promise<ConversationResponse> {
  return readResponse(
    await fetch(`${API_BASE_URL}/api/v1/conversations/${encodeURIComponent(sessionId)}`),
  );
}

export async function sendConversationMessage(
  sessionId: string,
  message: string,
): Promise<ConversationResponse> {
  const command: SendConversationMessageRequest = { message };
  const idempotencyKey = crypto.randomUUID();
  return readResponse(
    await fetch(`${API_BASE_URL}/api/v1/conversations/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `message:${idempotencyKey}`,
      },
      body: JSON.stringify(command),
    }),
  );
}

export async function proposeOrderAction(
  sessionId: string,
  command: ProposeOrderActionRequest,
): Promise<ActionProposalResponse> {
  return readResponse(
    await fetch(
      `${API_BASE_URL}/api/v1/conversations/${encodeURIComponent(sessionId)}/actions/proposals`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `proposal:${sessionId}:${command.action_type}:${command.order_id}:${command.expected_version}`,
        },
        body: JSON.stringify(command),
      },
    ),
  );
}

export async function getOrderAction(
  sessionId: string,
  proposalId: string,
): Promise<ActionProposalResponse> {
  return readResponse(
    await fetch(
      `${API_BASE_URL}/api/v1/conversations/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(proposalId)}`,
    ),
  );
}

export async function decideOrderAction(
  sessionId: string,
  proposal: ActionProposalResponse,
  decision: DecideOrderActionRequest["decision"],
): Promise<ActionProposalResponse> {
  const command: DecideOrderActionRequest = {
    decision,
    confirmation_token: decision === "confirm" ? proposal.confirmation_token : null,
  };
  return readResponse(
    await fetch(
      `${API_BASE_URL}/api/v1/conversations/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(proposal.id)}/decision`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `decision:${proposal.id}:${decision}`,
        },
        body: JSON.stringify(command),
      },
    ),
  );
}

export async function executeOrderAction(
  sessionId: string,
  proposalId: string,
): Promise<ActionProposalResponse> {
  return readResponse(
    await fetch(
      `${API_BASE_URL}/api/v1/conversations/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(proposalId)}/execution`,
      {
        method: "POST",
        headers: { "Idempotency-Key": `execution:${proposalId}` },
      },
    ),
  );
}
