import type { DefinitionIssueSchema, ErrorResponse } from "@agent-lab/contracts";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class LabApiError extends Error {
  readonly status: number;
  readonly requestId?: string;
  /**
   * The gate findings a refusal carries, where the contract sends them.
   *
   * A publish refusal is explained by the preview the editor already holds, but a
   * materialization refusal has no preview beside it: the findings exist only in the 422
   * body, so they must survive the throw.
   */
  readonly issues: DefinitionIssueSchema[];

  constructor(
    message: string,
    status: number,
    requestId?: string,
    issues: DefinitionIssueSchema[] = [],
  ) {
    super(message);
    this.name = "LabApiError";
    this.status = status;
    this.requestId = requestId;
    this.issues = issues;
  }
}

export const JSON_HEADERS = { "Content-Type": "application/json" };

export function apiPath(suffix: string): string {
  return `${API_BASE_URL}/api/v1${suffix}`;
}

export async function read<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  let error: (ErrorResponse & { issues?: DefinitionIssueSchema[] }) | undefined;
  try {
    error = (await response.json()) as ErrorResponse & { issues?: DefinitionIssueSchema[] };
  } catch {
    // An intermediary can answer with a non-contract body; keep that out of the UI.
  }

  throw new LabApiError(
    error?.message ?? "The lab could not complete the request.",
    response.status,
    error?.request_id,
    error?.issues ?? [],
  );
}

export function describeApiError(error: unknown, fallback: string): string {
  return error instanceof LabApiError ? error.message : fallback;
}
