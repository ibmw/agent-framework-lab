import type {
  CreateShopRequest,
  ShopDraftResponse,
  ShopIdentitySchema,
  ShopListResponse,
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

export async function createShop(identity: ShopIdentitySchema): Promise<ShopDraftResponse> {
  const command: CreateShopRequest = { identity };
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
