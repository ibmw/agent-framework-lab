import type { ErrorResponse } from "@agent-lab/contracts";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class LabApiError extends Error {
  readonly status: number;
  readonly requestId?: string;

  constructor(message: string, status: number, requestId?: string) {
    super(message);
    this.name = "LabApiError";
    this.status = status;
    this.requestId = requestId;
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

  let error: ErrorResponse | undefined;
  try {
    error = (await response.json()) as ErrorResponse;
  } catch {
    // An intermediary can answer with a non-contract body; keep that out of the UI.
  }

  throw new LabApiError(
    error?.message ?? "The lab could not complete the request.",
    response.status,
    error?.request_id,
  );
}

export function describeApiError(error: unknown, fallback: string): string {
  return error instanceof LabApiError ? error.message : fallback;
}
