import type {
  MaterializeSnapshotRequest,
  SandboxSnapshotListResponse,
  SandboxSnapshotResponse,
} from "@agent-lab/contracts";
import { apiPath, JSON_HEADERS, read } from "./client";

function shopPath(shopId: string, suffix: string): string {
  return apiPath(`/shops/${encodeURIComponent(shopId)}${suffix}`);
}

export async function listSandboxSnapshots(
  shopId: string,
  scenarioId: string,
  signal?: AbortSignal,
): Promise<SandboxSnapshotListResponse> {
  return read<SandboxSnapshotListResponse>(
    await fetch(shopPath(shopId, `/scenarios/${encodeURIComponent(scenarioId)}/snapshots`), {
      signal,
    }),
  );
}

export async function getSandboxSnapshot(
  shopId: string,
  snapshotId: string,
  signal?: AbortSignal,
): Promise<SandboxSnapshotResponse> {
  return read<SandboxSnapshotResponse>(
    await fetch(shopPath(shopId, `/snapshots/${encodeURIComponent(snapshotId)}`), { signal }),
  );
}

export async function materializeSandboxSnapshot(
  shopId: string,
  scenarioId: string,
  version: number,
  command: MaterializeSnapshotRequest,
): Promise<SandboxSnapshotResponse> {
  return read<SandboxSnapshotResponse>(
    await fetch(
      shopPath(
        shopId,
        `/scenarios/${encodeURIComponent(scenarioId)}/versions/${version}/snapshots`,
      ),
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(command) },
    ),
  );
}
