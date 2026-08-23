import type {
  CreateShopRequest,
  ErrorResponse,
  ShopDraftResponse,
  ShopIdentitySchema,
  ShopListResponse,
  ShopPayloadSchema,
  ShopPreviewResponse,
  ShopVersionListResponse,
  ShopVersionResponse,
} from "@agent-lab/contracts";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class ShopApiError extends Error {
  readonly status: number;
  readonly requestId?: string;

  constructor(message: string, status: number, requestId?: string) {
    super(message);
    this.name = "ShopApiError";
    this.status = status;
    this.requestId = requestId;
  }
}

function shopsPath(suffix = ""): string {
  return `${API_BASE_URL}/api/v1/shops${suffix}`;
}

async function read<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  let error: ErrorResponse | undefined;
  try {
    error = (await response.json()) as ErrorResponse;
  } catch {
    // An intermediary can answer with a non-contract body; keep that out of the UI.
  }

  throw new ShopApiError(
    error?.message ?? "The shop service could not complete the request.",
    response.status,
    error?.request_id,
  );
}

const JSON_HEADERS = { "Content-Type": "application/json" };

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
