import type {
  CreateJudgeConfigurationRequest,
  JudgeConfigurationDraftResponse,
  JudgeConfigurationListResponse,
  JudgeConfigurationPayloadSchema,
  JudgeConfigurationPreviewResponse,
  JudgeConfigurationResourcesResponse,
  JudgeConfigurationVersionListResponse,
  JudgeConfigurationVersionResponse,
} from "@agent-lab/contracts";
import { apiPath, JSON_HEADERS, read } from "./client";

function judgesPath(suffix = ""): string {
  return apiPath(`/judge-configurations${suffix}`);
}

function judgePath(judgeId: string, suffix = ""): string {
  return judgesPath(`/${encodeURIComponent(judgeId)}${suffix}`);
}

export async function listJudgeConfigurations(
  signal?: AbortSignal,
): Promise<JudgeConfigurationListResponse> {
  return read<JudgeConfigurationListResponse>(await fetch(judgesPath(), { signal }));
}

/**
 * What a judge may name: the providers the lab has proven, the evidence it can be shown,
 * and the words a rubric may not contain.
 *
 * The reserved terms come from the server rather than from a copy here, because they are
 * read off what the arms actually run — an editor with its own list would stop matching the
 * gate the day the lab proves a second framework.
 */
export async function readJudgeConfigurationResources(
  signal?: AbortSignal,
): Promise<JudgeConfigurationResourcesResponse> {
  return read<JudgeConfigurationResourcesResponse>(
    await fetch(judgesPath("/resources"), { signal }),
  );
}

export async function createJudgeConfiguration(
  command: CreateJudgeConfigurationRequest,
): Promise<JudgeConfigurationDraftResponse> {
  return read<JudgeConfigurationDraftResponse>(
    await fetch(judgesPath(), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}

export async function getJudgeConfigurationDraft(
  judgeId: string,
  signal?: AbortSignal,
): Promise<JudgeConfigurationDraftResponse> {
  return read<JudgeConfigurationDraftResponse>(
    await fetch(judgePath(judgeId, "/draft"), { signal }),
  );
}

export async function replaceJudgeConfigurationDraft(
  judgeId: string,
  payload: JudgeConfigurationPayloadSchema,
): Promise<JudgeConfigurationDraftResponse> {
  return read<JudgeConfigurationDraftResponse>(
    await fetch(judgePath(judgeId, "/draft"), {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ payload }),
    }),
  );
}

export async function previewJudgeConfigurationDraft(
  judgeId: string,
  signal?: AbortSignal,
): Promise<JudgeConfigurationPreviewResponse> {
  return read<JudgeConfigurationPreviewResponse>(
    await fetch(judgePath(judgeId, "/draft/preview"), { signal }),
  );
}

export async function publishJudgeConfiguration(
  judgeId: string,
): Promise<JudgeConfigurationVersionResponse> {
  return read<JudgeConfigurationVersionResponse>(
    await fetch(judgePath(judgeId, "/versions"), { method: "POST" }),
  );
}

export async function listJudgeConfigurationVersions(
  judgeId: string,
  signal?: AbortSignal,
): Promise<JudgeConfigurationVersionListResponse> {
  return read<JudgeConfigurationVersionListResponse>(
    await fetch(judgePath(judgeId, "/versions"), { signal }),
  );
}
