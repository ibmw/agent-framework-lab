import type {
  AgentFrameworkListResponse,
  ConversationResponse,
  ErrorResponse,
  SendConversationMessageRequest,
  StartConversationRequest,
} from "@agent-lab/contracts";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class ConversationApiError extends Error {
  readonly status: number;
  readonly requestId?: string;

  constructor(message: string, status: number, requestId?: string) {
    super(message);
    this.name = "ConversationApiError";
    this.status = status;
    this.requestId = requestId;
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
