import type { LabStatusResponse } from "@agent-lab/contracts";
import { apiPath, read } from "./client";

/**
 * How the process this Studio talks to is composed: its run mode, the model it would reach
 * for, and whether traces leave it. Read-only by design — composition is environment, and the
 * settings surface reports it rather than editing it.
 */
export async function getLabStatus(signal?: AbortSignal): Promise<LabStatusResponse> {
  return read<LabStatusResponse>(await fetch(apiPath("/lab-status"), { signal }));
}
