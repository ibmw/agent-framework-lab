import type {
  CreateSupportIdentityRequest,
  SupportIdentityDraftResponse,
  SupportIdentityListResponse,
  SupportIdentityPayloadSchema,
  SupportIdentityPreviewResponse,
  SupportIdentityVersionListResponse,
  SupportIdentityVersionResponse,
} from "@agent-lab/contracts";
import { pythonStrip } from "../lib/pythonText";
import { apiPath, JSON_HEADERS, read } from "./client";

/**
 * What a draft write sends. An identity carries no derived evidence, so it is the content —
 * with the texts the editor types in place stripped as Python strips them: `require_label` and
 * `require_text` refuse padding, and a textarea ends on a newline as often as not. Its guidance
 * notes are stripped by the form below their list.
 */
export function toSupportIdentityPayload(
  content: SupportIdentityPayloadSchema,
): SupportIdentityPayloadSchema {
  return {
    ...content,
    role: {
      ...content.role,
      name: pythonStrip(content.role.name),
      title: pythonStrip(content.role.title),
      description: pythonStrip(content.role.description),
    },
    escalation: {
      ...content.escalation,
      escalate_to: pythonStrip(content.escalation.escalate_to),
    },
  };
}

function identitiesPath(suffix = ""): string {
  return apiPath(`/support-identities${suffix}`);
}

function identityPath(identityId: string, suffix = ""): string {
  return identitiesPath(`/${encodeURIComponent(identityId)}${suffix}`);
}

export async function listSupportIdentities(
  signal?: AbortSignal,
): Promise<SupportIdentityListResponse> {
  return read<SupportIdentityListResponse>(await fetch(identitiesPath(), { signal }));
}

export async function createSupportIdentity(
  command: CreateSupportIdentityRequest,
): Promise<SupportIdentityDraftResponse> {
  return read<SupportIdentityDraftResponse>(
    await fetch(identitiesPath(), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}

export async function getSupportIdentityDraft(
  identityId: string,
  signal?: AbortSignal,
): Promise<SupportIdentityDraftResponse> {
  return read<SupportIdentityDraftResponse>(
    await fetch(identityPath(identityId, "/draft"), { signal }),
  );
}

export async function replaceSupportIdentityDraft(
  identityId: string,
  payload: SupportIdentityPayloadSchema,
): Promise<SupportIdentityDraftResponse> {
  return read<SupportIdentityDraftResponse>(
    await fetch(identityPath(identityId, "/draft"), {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ payload }),
    }),
  );
}

export async function previewSupportIdentityDraft(
  identityId: string,
  signal?: AbortSignal,
): Promise<SupportIdentityPreviewResponse> {
  return read<SupportIdentityPreviewResponse>(
    await fetch(identityPath(identityId, "/draft/preview"), { signal }),
  );
}

export async function publishSupportIdentity(
  identityId: string,
): Promise<SupportIdentityVersionResponse> {
  return read<SupportIdentityVersionResponse>(
    await fetch(identityPath(identityId, "/versions"), { method: "POST" }),
  );
}

export async function listSupportIdentityVersions(
  identityId: string,
  signal?: AbortSignal,
): Promise<SupportIdentityVersionListResponse> {
  return read<SupportIdentityVersionListResponse>(
    await fetch(identityPath(identityId, "/versions"), { signal }),
  );
}
