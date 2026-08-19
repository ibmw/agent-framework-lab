import type {
  ActionProposalResponse,
  AgentFrameworkListResponse,
  ConversationListResponse,
  ConversationResponse,
  ConversationSummaryResponse,
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
  commandId: string,
): Promise<ConversationResponse> {
  return readResponse(
    await fetch(`${API_BASE_URL}/api/v1/conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The command id is minted once when the user starts a conversation and reused across
        // retries, so a retried start recovers the committed session instead of duplicating it.
        "Idempotency-Key": `conversation:${command.scenario_id}:${command.scenario_version}:${command.seed}:${command.framework_id}:${commandId}`,
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

export interface ConversationHistoryQuery {
  scenarioId?: string;
  scenarioVersion?: string;
  seed?: number;
  frameworkId?: string;
  activeSince?: string;
  page?: number;
  pageSize?: number;
}

const CONVERSATION_LIST_PAGE_SIZE = 100;

export async function listConversations(
  persona?: { scenario_id: string; scenario_version: string; seed: number },
  query: ConversationHistoryQuery = {},
): Promise<ConversationListResponse> {
  const params = new URLSearchParams();
  const scenarioId = persona?.scenario_id ?? query.scenarioId;
  const scenarioVersion = persona?.scenario_version ?? query.scenarioVersion;
  const seed = persona?.seed ?? query.seed;
  if (scenarioId) params.set("scenario_id", scenarioId);
  if (scenarioVersion) params.set("scenario_version", scenarioVersion);
  if (seed !== undefined) params.set("seed", String(seed));
  if (query.frameworkId) params.set("framework_id", query.frameworkId);
  if (query.activeSince) params.set("active_since", query.activeSince);
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("page_size", String(query.pageSize));
  const search = params.toString();
  return readResponse(
    await fetch(`${API_BASE_URL}/api/v1/conversations${search ? `?${search}` : ""}`),
  );
}

export async function listAllConversations(
  persona?: { scenario_id: string; scenario_version: string; seed: number },
  query: Omit<ConversationHistoryQuery, "page" | "pageSize"> = {},
): Promise<ConversationSummaryResponse[]> {
  const collected: ConversationSummaryResponse[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  while (collected.length < total) {
    const result = await listConversations(persona, {
      ...query,
      page,
      pageSize: CONVERSATION_LIST_PAGE_SIZE,
    });
    collected.push(...result.conversations);
    total = result.total;
    if (
      result.conversations.length === 0 ||
      result.conversations.length < CONVERSATION_LIST_PAGE_SIZE
    ) {
      break;
    }
    page += 1;
  }
  return collected;
}

export async function deleteConversation(sessionId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/conversations/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
  if (response.ok) {
    return;
  }
  let error: ErrorResponse | undefined;
  try {
    error = (await response.json()) as ErrorResponse;
  } catch {
    // Keep non-contract intermediary details out of the UI.
  }
  throw new ConversationApiError(
    error?.message ?? "The conversation could not be deleted.",
    response.status,
    error?.request_id,
    error?.code,
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
