import type {
  ErrorResponse,
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
