import type {
  CreateCustomerProfileRequest,
  CustomerProfileContentSchema,
  CustomerProfileDraftResponse,
  CustomerProfileListResponse,
  CustomerProfilePayloadSchema,
  CustomerProfilePreviewResponse,
  CustomerProfileShopsResponse,
  CustomerProfileVersionListResponse,
  CustomerProfileVersionResponse,
} from "@agent-lab/contracts";
import { pythonStrip } from "../lib/pythonText";
import { apiPath, JSON_HEADERS, read } from "./client";

function profilesPath(suffix = ""): string {
  return apiPath(`/customer-profiles${suffix}`);
}

function profilePath(profileId: string, suffix = ""): string {
  return profilesPath(`/${encodeURIComponent(profileId)}${suffix}`);
}

/**
 * The API answers with derived read-only evidence (`display_name`, the resolved default
 * address) that a draft write must not echo back. Editing works on the returned content,
 * and this projection strips the derived fields before every save.
 */
export function toProfilePayload(
  content: CustomerProfileContentSchema,
): CustomerProfilePayloadSchema {
  const { display_name: _displayName, default_address_id: _defaultAddressId, ...payload } = content;
  // The texts the editor types in place, stripped as Python strips them: `require_label` and
  // `require_text` refuse padding. What a form below a list writes is stripped by that form.
  return {
    ...payload,
    identity: {
      ...payload.identity,
      given_name: pythonStrip(payload.identity.given_name),
      family_name: pythonStrip(payload.identity.family_name),
      email: pythonStrip(payload.identity.email),
    },
    account: { ...payload.account, notes: pythonStrip(payload.account.notes) },
    persona: { ...payload.persona, summary: pythonStrip(payload.persona.summary) },
  };
}

export async function listCustomerProfiles(
  shopId?: string,
  signal?: AbortSignal,
): Promise<CustomerProfileListResponse> {
  const query = shopId ? `?shop_id=${encodeURIComponent(shopId)}` : "";
  return read<CustomerProfileListResponse>(await fetch(profilesPath(query), { signal }));
}

export async function createCustomerProfile(
  command: CreateCustomerProfileRequest,
): Promise<CustomerProfileDraftResponse> {
  return read<CustomerProfileDraftResponse>(
    await fetch(profilesPath(), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}

export async function getCustomerProfileDraft(
  profileId: string,
  signal?: AbortSignal,
): Promise<CustomerProfileDraftResponse> {
  return read<CustomerProfileDraftResponse>(
    await fetch(profilePath(profileId, "/draft"), { signal }),
  );
}

export async function replaceCustomerProfileDraft(
  profileId: string,
  payload: CustomerProfilePayloadSchema,
): Promise<CustomerProfileDraftResponse> {
  return read<CustomerProfileDraftResponse>(
    await fetch(profilePath(profileId, "/draft"), {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ payload }),
    }),
  );
}

export async function previewCustomerProfileDraft(
  profileId: string,
  signal?: AbortSignal,
): Promise<CustomerProfilePreviewResponse> {
  return read<CustomerProfilePreviewResponse>(
    await fetch(profilePath(profileId, "/draft/preview"), { signal }),
  );
}

export async function publishCustomerProfile(
  profileId: string,
): Promise<CustomerProfileVersionResponse> {
  return read<CustomerProfileVersionResponse>(
    await fetch(profilePath(profileId, "/versions"), { method: "POST" }),
  );
}

export async function listCustomerProfileVersions(
  profileId: string,
  signal?: AbortSignal,
): Promise<CustomerProfileVersionListResponse> {
  return read<CustomerProfileVersionListResponse>(
    await fetch(profilePath(profileId, "/versions"), { signal }),
  );
}

export async function listCustomerProfileShops(
  profileId: string,
  signal?: AbortSignal,
): Promise<CustomerProfileShopsResponse> {
  return read<CustomerProfileShopsResponse>(
    await fetch(profilePath(profileId, "/shops"), { signal }),
  );
}

export async function attachCustomerProfileToShop(
  profileId: string,
  shopId: string,
): Promise<CustomerProfileShopsResponse> {
  return read<CustomerProfileShopsResponse>(
    await fetch(profilePath(profileId, "/shops"), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ shop_id: shopId }),
    }),
  );
}

export async function detachCustomerProfileFromShop(
  profileId: string,
  shopId: string,
): Promise<CustomerProfileShopsResponse> {
  return read<CustomerProfileShopsResponse>(
    await fetch(profilePath(profileId, `/shops/${encodeURIComponent(shopId)}`), {
      method: "DELETE",
    }),
  );
}
