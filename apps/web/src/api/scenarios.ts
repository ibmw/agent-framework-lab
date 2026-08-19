import type {
  ErrorResponse,
  GeneratedScenarioListResponse,
  GeneratedScenarioResponse,
  GenerateScenarioRequest,
} from "@agent-lab/contracts";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export interface ScenarioReference {
  id: string;
  version: string;
}

export class ScenarioApiError extends Error {
  readonly status: number;
  readonly requestId?: string;

  constructor(message: string, status: number, requestId?: string) {
    super(message);
    this.name = "ScenarioApiError";
    this.status = status;
    this.requestId = requestId;
  }
}

function generationPath({ id, version }: ScenarioReference): string {
  return `${API_BASE_URL}/api/v1/scenarios/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/generations`;
}

async function readGeneratedScenario(response: Response): Promise<GeneratedScenarioResponse> {
  if (response.ok) {
    return (await response.json()) as GeneratedScenarioResponse;
  }

  let error: ErrorResponse | undefined;
  try {
    error = (await response.json()) as ErrorResponse;
  } catch {
    // An intermediary can return a non-contract response. Keep that detail out of the UI.
  }

  throw new ScenarioApiError(
    error?.message ?? "The scenario service could not complete the request.",
    response.status,
    error?.request_id,
  );
}

export async function generateScenario(
  scenario: ScenarioReference,
  seed: number,
): Promise<GeneratedScenarioResponse> {
  const command: GenerateScenarioRequest = { seed };
  const response = await fetch(generationPath(scenario), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `persona:${scenario.id}:${scenario.version}:${seed}`,
    },
    body: JSON.stringify(command),
  });

  return readGeneratedScenario(response);
}

export async function getGeneratedScenario(
  scenario: ScenarioReference,
  seed: number,
): Promise<GeneratedScenarioResponse> {
  const response = await fetch(`${generationPath(scenario)}/${seed}`);
  return readGeneratedScenario(response);
}

export async function deleteGeneratedScenario(
  scenario: ScenarioReference,
  seed: number,
): Promise<void> {
  const response = await fetch(`${generationPath(scenario)}/${seed}`, { method: "DELETE" });
  if (response.ok) {
    return;
  }

  let error: ErrorResponse | undefined;
  try {
    error = (await response.json()) as ErrorResponse;
  } catch {
    // Keep non-contract intermediary details out of the UI.
  }
  throw new ScenarioApiError(
    error?.message ?? "The generated persona could not be deleted.",
    response.status,
    error?.request_id,
  );
}

export interface PersonaLibraryQuery {
  scenarioId?: string;
  scenarioVersion?: string;
  frameworkId?: string;
  activeSince?: string;
  page?: number;
  pageSize?: number;
}

export async function listGeneratedScenarios(
  query: PersonaLibraryQuery = {},
): Promise<GeneratedScenarioListResponse> {
  const params = new URLSearchParams();
  if (query.scenarioId) params.set("scenario_id", query.scenarioId);
  if (query.scenarioVersion) params.set("scenario_version", query.scenarioVersion);
  if (query.frameworkId) params.set("framework_id", query.frameworkId);
  if (query.activeSince) params.set("active_since", query.activeSince);
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("page_size", String(query.pageSize));
  const search = params.toString();
  const response = await fetch(
    `${API_BASE_URL}/api/v1/scenarios/generations${search ? `?${search}` : ""}`,
  );
  if (response.ok) {
    return (await response.json()) as GeneratedScenarioListResponse;
  }

  let error: ErrorResponse | undefined;
  try {
    error = (await response.json()) as ErrorResponse;
  } catch {
    // Keep non-contract intermediary details out of the UI.
  }
  throw new ScenarioApiError(
    error?.message ?? "The scenario service could not list personas.",
    response.status,
    error?.request_id,
  );
}
