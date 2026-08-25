import type {
  CloneSandboxRequest,
  SandboxListResponse,
  SandboxResponse,
} from "@agent-lab/contracts";
import { apiPath, JSON_HEADERS, read } from "./client";

function shopPath(shopId: string, suffix: string): string {
  return apiPath(`/shops/${encodeURIComponent(shopId)}${suffix}`);
}

export async function listSandboxes(
  shopId: string,
  snapshotId: string,
  signal?: AbortSignal,
): Promise<SandboxListResponse> {
  return read<SandboxListResponse>(
    await fetch(shopPath(shopId, `/snapshots/${encodeURIComponent(snapshotId)}/sandboxes`), {
      signal,
    }),
  );
}

export async function getSandbox(
  shopId: string,
  sandboxId: string,
  signal?: AbortSignal,
): Promise<SandboxResponse> {
  return read<SandboxResponse>(
    await fetch(shopPath(shopId, `/sandboxes/${encodeURIComponent(sandboxId)}`), { signal }),
  );
}

export async function cloneSandbox(
  shopId: string,
  snapshotId: string,
  command: CloneSandboxRequest,
): Promise<SandboxResponse> {
  return read<SandboxResponse>(
    await fetch(shopPath(shopId, `/snapshots/${encodeURIComponent(snapshotId)}/sandboxes`), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}
