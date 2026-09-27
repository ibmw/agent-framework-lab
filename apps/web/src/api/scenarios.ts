import type {
  CreateScenarioRequest,
  ReplaceScenarioDraftRequest,
  ScenarioDraftResponse,
  ScenarioListResponse,
  ScenarioPreviewResponse,
  ScenarioResourcesSchema,
  ScenarioVersionListResponse,
  ScenarioVersionResponse,
} from "@agent-lab/contracts";
import { apiPath, JSON_HEADERS, read } from "./client";

function scenariosPath(shopId: string, suffix = ""): string {
  return apiPath(`/shops/${encodeURIComponent(shopId)}/scenarios${suffix}`);
}

function scenarioPath(shopId: string, scenarioId: string, suffix = ""): string {
  return scenariosPath(shopId, `/${encodeURIComponent(scenarioId)}${suffix}`);
}

export async function listScenarios(
  shopId: string,
  signal?: AbortSignal,
): Promise<ScenarioListResponse> {
  return read<ScenarioListResponse>(await fetch(scenariosPath(shopId), { signal }));
}

export async function createScenario(
  shopId: string,
  command: CreateScenarioRequest,
): Promise<ScenarioDraftResponse> {
  return read<ScenarioDraftResponse>(
    await fetch(scenariosPath(shopId), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}

export async function getScenarioDraft(
  shopId: string,
  scenarioId: string,
  signal?: AbortSignal,
): Promise<ScenarioDraftResponse> {
  return read<ScenarioDraftResponse>(
    await fetch(scenarioPath(shopId, scenarioId, "/draft"), { signal }),
  );
}

export async function replaceScenarioDraft(
  shopId: string,
  scenarioId: string,
  command: ReplaceScenarioDraftRequest,
): Promise<ScenarioDraftResponse> {
  return read<ScenarioDraftResponse>(
    await fetch(scenarioPath(shopId, scenarioId, "/draft"), {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}

export async function previewScenarioDraft(
  shopId: string,
  scenarioId: string,
  signal?: AbortSignal,
): Promise<ScenarioPreviewResponse> {
  return read<ScenarioPreviewResponse>(
    await fetch(scenarioPath(shopId, scenarioId, "/draft/preview"), { signal }),
  );
}

export async function getScenarioResources(
  shopId: string,
  scenarioId: string,
  signal?: AbortSignal,
): Promise<ScenarioResourcesSchema> {
  return read<ScenarioResourcesSchema>(
    await fetch(scenarioPath(shopId, scenarioId, "/resources"), { signal }),
  );
}

export async function publishScenario(
  shopId: string,
  scenarioId: string,
): Promise<ScenarioVersionResponse> {
  return read<ScenarioVersionResponse>(
    await fetch(scenarioPath(shopId, scenarioId, "/versions"), { method: "POST" }),
  );
}

export async function listScenarioVersions(
  shopId: string,
  scenarioId: string,
  signal?: AbortSignal,
): Promise<ScenarioVersionListResponse> {
  return read<ScenarioVersionListResponse>(
    await fetch(scenarioPath(shopId, scenarioId, "/versions"), { signal }),
  );
}

export async function getScenarioVersion(
  shopId: string,
  scenarioId: string,
  version: number,
  signal?: AbortSignal,
): Promise<ScenarioVersionResponse> {
  return read<ScenarioVersionResponse>(
    await fetch(scenarioPath(shopId, scenarioId, `/versions/${version}`), { signal }),
  );
}
