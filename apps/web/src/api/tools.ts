import type {
  ToolCallRequest,
  ToolCallResponse,
  ToolContractListResponse,
} from "@agent-lab/contracts";
import { apiPath, JSON_HEADERS, read } from "./client";

export async function listToolContracts(signal?: AbortSignal): Promise<ToolContractListResponse> {
  return read<ToolContractListResponse>(await fetch(apiPath("/tools"), { signal }));
}

export async function callSandboxTool(
  shopId: string,
  sandboxId: string,
  command: ToolCallRequest,
  signal?: AbortSignal,
): Promise<ToolCallResponse> {
  return read<ToolCallResponse>(
    await fetch(
      apiPath(
        `/shops/${encodeURIComponent(shopId)}/sandboxes/${encodeURIComponent(sandboxId)}/tool-calls`,
      ),
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(command), signal },
    ),
  );
}
