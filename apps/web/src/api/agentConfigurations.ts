import type {
  AgentConfigurationDraftResponse,
  AgentConfigurationListResponse,
  AgentConfigurationPayloadSchema,
  AgentConfigurationPreviewResponse,
  AgentConfigurationResourcesResponse,
  AgentConfigurationVersionListResponse,
  AgentConfigurationVersionResponse,
  CreateAgentConfigurationRequest,
} from "@agent-lab/contracts";
import { apiPath, JSON_HEADERS, read } from "./client";

function configurationsPath(suffix = ""): string {
  return apiPath(`/agent-configurations${suffix}`);
}

function configurationPath(configurationId: string, suffix = ""): string {
  return configurationsPath(`/${encodeURIComponent(configurationId)}${suffix}`);
}

export async function listAgentConfigurations(
  signal?: AbortSignal,
): Promise<AgentConfigurationListResponse> {
  return read<AgentConfigurationListResponse>(await fetch(configurationsPath(), { signal }));
}

export async function readAgentConfigurationResources(
  signal?: AbortSignal,
): Promise<AgentConfigurationResourcesResponse> {
  return read<AgentConfigurationResourcesResponse>(
    await fetch(configurationsPath("/resources"), { signal }),
  );
}

export async function createAgentConfiguration(
  command: CreateAgentConfigurationRequest,
): Promise<AgentConfigurationDraftResponse> {
  return read<AgentConfigurationDraftResponse>(
    await fetch(configurationsPath(), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}

export async function getAgentConfigurationDraft(
  configurationId: string,
  signal?: AbortSignal,
): Promise<AgentConfigurationDraftResponse> {
  return read<AgentConfigurationDraftResponse>(
    await fetch(configurationPath(configurationId, "/draft"), { signal }),
  );
}

export async function replaceAgentConfigurationDraft(
  configurationId: string,
  payload: AgentConfigurationPayloadSchema,
): Promise<AgentConfigurationDraftResponse> {
  return read<AgentConfigurationDraftResponse>(
    await fetch(configurationPath(configurationId, "/draft"), {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ payload }),
    }),
  );
}

/**
 * The publish gate and the resolved context in one read.
 *
 * `previewShopId` only changes what the variables resolve *to*; the configuration itself
 * stays shop-independent, which is why the shop is a query parameter rather than a path
 * segment.
 */
export async function previewAgentConfigurationDraft(
  configurationId: string,
  previewShopId?: string,
  signal?: AbortSignal,
): Promise<AgentConfigurationPreviewResponse> {
  const query = previewShopId ? `?preview_shop_id=${encodeURIComponent(previewShopId)}` : "";
  return read<AgentConfigurationPreviewResponse>(
    await fetch(configurationPath(configurationId, `/draft/preview${query}`), { signal }),
  );
}

export async function publishAgentConfiguration(
  configurationId: string,
): Promise<AgentConfigurationVersionResponse> {
  return read<AgentConfigurationVersionResponse>(
    await fetch(configurationPath(configurationId, "/versions"), { method: "POST" }),
  );
}

export async function listAgentConfigurationVersions(
  configurationId: string,
  signal?: AbortSignal,
): Promise<AgentConfigurationVersionListResponse> {
  return read<AgentConfigurationVersionListResponse>(
    await fetch(configurationPath(configurationId, "/versions"), { signal }),
  );
}
