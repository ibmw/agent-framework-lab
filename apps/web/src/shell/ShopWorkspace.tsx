import type {
  ShopContentSchema,
  ShopPreviewResponse,
  ShopSummarySchema,
} from "@agent-lab/contracts";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Outlet, useParams } from "react-router-dom";
import {
  getShopDraft,
  listShops,
  previewShopDraft,
  publishShop,
  replaceShopDraft,
  ShopApiError,
} from "../api/shops";
import { toPayload } from "../lib/shop";
import { AppShell } from "./AppShell";

export interface ShopWorkspaceValue {
  shopId: string;
  shops: ShopSummarySchema[];
  content: ShopContentSchema;
  preview: ShopPreviewResponse | null;
  dirty: boolean;
  saving: boolean;
  publishing: boolean;
  error: string | null;
  edit: (next: ShopContentSchema) => void;
  save: () => Promise<void>;
  publish: () => Promise<number | null>;
}

const WorkspaceContext = createContext<ShopWorkspaceValue | null>(null);

export function useShopWorkspace(): ShopWorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("useShopWorkspace must be used inside the shop workspace");
  }
  return value;
}

function describe(error: unknown): string {
  if (error instanceof ShopApiError) {
    return error.message;
  }
  return "The shop service is unavailable.";
}

export function ShopWorkspace() {
  const { shopId = "" } = useParams();
  const [shops, setShops] = useState<ShopSummarySchema[]>([]);
  const [content, setContent] = useState<ShopContentSchema | null>(null);
  const [preview, setPreview] = useState<ShopPreviewResponse | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadShops = useCallback(async (signal?: AbortSignal) => {
    setShops((await listShops(signal)).shops);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      getShopDraft(shopId, controller.signal),
      previewShopDraft(shopId, controller.signal),
      reloadShops(controller.signal),
    ])
      .then(([draft, draftPreview]) => {
        setContent(draft.content);
        setPreview(draftPreview);
        setDirty(false);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(describe(cause));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [shopId, reloadShops]);

  const edit = useCallback((next: ShopContentSchema) => {
    setContent(next);
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (!content) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await replaceShopDraft(shopId, toPayload(content));
      setContent(saved.content);
      setDirty(false);
      setPreview(await previewShopDraft(shopId));
      await reloadShops();
    } catch (cause: unknown) {
      setError(describe(cause));
    } finally {
      setSaving(false);
    }
  }, [content, shopId, reloadShops]);

  const publish = useCallback(async (): Promise<number | null> => {
    // Publishing freezes what the server holds. Never let the button freeze an older
    // draft than the edits sitting in this workspace.
    if (dirty) {
      setError("Save the draft before publishing so the frozen version matches your edits.");
      return null;
    }
    setPublishing(true);
    setError(null);
    try {
      const published = await publishShop(shopId);
      setPreview(await previewShopDraft(shopId));
      await reloadShops();
      return published.version;
    } catch (cause: unknown) {
      setError(describe(cause));
      return null;
    } finally {
      setPublishing(false);
    }
  }, [shopId, reloadShops, dirty]);

  if (loading) {
    return (
      <AppShell shops={shops} currentShopId={shopId}>
        <p className="text-sm text-admin-muted">Loading shop…</p>
      </AppShell>
    );
  }

  if (!content) {
    return (
      <AppShell shops={shops}>
        <div role="alert" className="text-sm text-lab-error">
          {error ?? "This shop could not be loaded."}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell shops={shops} currentShopId={shopId}>
      <WorkspaceContext.Provider
        value={{
          shopId,
          shops,
          content,
          preview,
          dirty,
          saving,
          publishing,
          error,
          edit,
          save,
          publish,
        }}
      >
        <Outlet />
      </WorkspaceContext.Provider>
    </AppShell>
  );
}
