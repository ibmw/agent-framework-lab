import type {
  CreateShopRequest,
  ShopDraftResponse,
  ShopIdentitySchema,
  ShopListResponse,
  ShopLogoSchema,
  ShopMediaAssetSchema,
  ShopMediaListResponse,
  ShopPayloadSchema,
  ShopPreviewResponse,
  ShopVersionListResponse,
  ShopVersionResponse,
} from "@agent-lab/contracts";
import { apiPath, JSON_HEADERS, read } from "./client";

function shopsPath(suffix = ""): string {
  return apiPath(`/shops${suffix}`);
}

export async function listShops(signal?: AbortSignal): Promise<ShopListResponse> {
  return read<ShopListResponse>(await fetch(shopsPath(), { signal }));
}

export async function createShop(
  identity: ShopIdentitySchema,
  logo: ShopLogoSchema | null = null,
): Promise<ShopDraftResponse> {
  // No logo is no key: the lab reads an absent logo as none (ADR 0070).
  const command: CreateShopRequest = logo === null ? { identity } : { identity, logo };
  return read<ShopDraftResponse>(
    await fetch(shopsPath(), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}

export async function getShopDraft(
  shopId: string,
  signal?: AbortSignal,
): Promise<ShopDraftResponse> {
  return read<ShopDraftResponse>(
    await fetch(shopsPath(`/${encodeURIComponent(shopId)}/draft`), { signal }),
  );
}

export async function replaceShopDraft(
  shopId: string,
  payload: ShopPayloadSchema,
): Promise<ShopDraftResponse> {
  return read<ShopDraftResponse>(
    await fetch(shopsPath(`/${encodeURIComponent(shopId)}/draft`), {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ payload }),
    }),
  );
}

export async function previewShopDraft(
  shopId: string,
  signal?: AbortSignal,
): Promise<ShopPreviewResponse> {
  return read<ShopPreviewResponse>(
    await fetch(shopsPath(`/${encodeURIComponent(shopId)}/draft/preview`), { signal }),
  );
}

export async function publishShop(shopId: string): Promise<ShopVersionResponse> {
  return read<ShopVersionResponse>(
    await fetch(shopsPath(`/${encodeURIComponent(shopId)}/versions`), { method: "POST" }),
  );
}

export async function listShopVersions(
  shopId: string,
  signal?: AbortSignal,
): Promise<ShopVersionListResponse> {
  return read<ShopVersionListResponse>(
    await fetch(shopsPath(`/${encodeURIComponent(shopId)}/versions`), { signal }),
  );
}

export async function getShopVersion(
  shopId: string,
  version: number,
  signal?: AbortSignal,
): Promise<ShopVersionResponse> {
  return read<ShopVersionResponse>(
    await fetch(shopsPath(`/${encodeURIComponent(shopId)}/versions/${version}`), { signal }),
  );
}

/**
 * Upload one image to the shop (ADR 0076). The body is a `FormData` with the file under
 * `file`, and no `Content-Type` is set here: the browser writes the multipart boundary itself,
 * and the `Content-Length` the lab refuses an oversized upload by.
 */
export async function uploadShopMedia(shopId: string, file: File): Promise<ShopMediaAssetSchema> {
  const body = new FormData();
  body.append("file", file);
  return read<ShopMediaAssetSchema>(
    await fetch(shopsPath(`/${encodeURIComponent(shopId)}/media`), { method: "POST", body }),
  );
}

export async function listShopMedia(
  shopId: string,
  signal?: AbortSignal,
): Promise<ShopMediaListResponse> {
  return read<ShopMediaListResponse>(
    await fetch(shopsPath(`/${encodeURIComponent(shopId)}/media`), { signal }),
  );
}

/** Where an image the shop holds is served, for an `<img src>`. */
export function shopMediaUrl(shopId: string, sha256: string): string {
  return shopsPath(`/${encodeURIComponent(shopId)}/media/${encodeURIComponent(sha256)}`);
}
