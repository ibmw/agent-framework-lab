import type { LabSeedResponse } from "@agent-lab/contracts";
import { apiPath, read } from "./client";

/**
 * Write the demo into an empty lab (ADR 0047).
 *
 * The one call in this application that populates the lab, and it is safe for the reason the
 * command is: the route refuses unless every table the story writes is empty, so it creates or
 * it declines, and never merges or overwrites. A refusal arrives as a `LabApiError` carrying
 * the tables that stopped it and the remedy, which is a sentence for a reader rather than a
 * code to branch on.
 */
export async function seedLab(signal?: AbortSignal): Promise<LabSeedResponse> {
  return read<LabSeedResponse>(await fetch(apiPath("/lab-seed"), { method: "POST", signal }));
}
