import type {
  ShopContentSchema,
  ShopPayloadSchema,
  ShopPreviewResponse,
  ShopSummarySchema,
} from "@agent-lab/contracts";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Outlet, useParams } from "react-router-dom";
import { describeApiError } from "../api/client";
import {
  getShopDraft,
  listShops,
  previewShopDraft,
  publishShop,
  replaceShopDraft,
} from "../api/shops";
import { type DefinitionClient, useDefinitionEditor } from "../lib/definitionEditor";
import { writeLastVisitedShop } from "../lib/preferences";
import { shopDraftIsSavableAt, toPayload } from "../lib/shop";
import { AppShell } from "./AppShell";

const CLIENT: DefinitionClient<ShopContentSchema, ShopPayloadSchema, ShopPreviewResponse> = {
  getDraft: getShopDraft,
  previewDraft: previewShopDraft,
  replaceDraft: replaceShopDraft,
  publish: publishShop,
  toPayload,
  unavailable: "The shop service is unavailable.",
};

export interface ShopWorkspaceValue {
  shopId: string;
  shops: ShopSummarySchema[];
  content: ShopContentSchema;
  preview: ShopPreviewResponse | null;
  dirty: boolean;
  saving: boolean;
  discarding: boolean;
  publishing: boolean;
  error: string | null;
  edit: (next: ShopContentSchema) => void;
  save: () => Promise<string | null>;
  discard: () => Promise<void>;
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

/**
 * The shop's own workspace: the shared definition editor plus the cross-shop list the top
 * bar's switcher needs, exposed to every nested route through one context.
 */
export function ShopWorkspace() {
  const { shopId = "" } = useParams();
  const [shops, setShops] = useState<ShopSummarySchema[]>([]);
  const [shopsError, setShopsError] = useState<string | null>(null);

  const refreshShops = useCallback(async (signal?: AbortSignal) => {
    try {
      setShops((await listShops(signal)).shops);
    } catch (cause: unknown) {
      if (!signal?.aborted) {
        setShopsError(describeApiError(cause, "The lab is unavailable."));
      }
    }
  }, []);

  // This editor outlives the page editing it, so what strands its draft is leaving the reach of
  // its Save rather than leaving a route (`shopDraftIsSavableAt`). And the switcher shows each
  // shop's authored name, so the list follows any write that can change it — declared here, on
  // the editor, because the navigation prompt saves this draft too and a wrapper around the
  // page's own button would not be reached when it did.
  const guard = useMemo(
    () => ({
      label: "The shop draft has unsaved changes.",
      reaches: (pathname: string) => shopDraftIsSavableAt(shopId, pathname),
      afterSave: refreshShops,
    }),
    [shopId, refreshShops],
  );
  const editor = useDefinitionEditor(shopId, CLIENT, guard);

  useEffect(() => {
    const controller = new AbortController();
    void refreshShops(controller.signal);
    return () => controller.abort();
  }, [refreshShops]);

  // Leaving shop scope for `/settings` or `/glossary` costs the operator their place, so the
  // shop they were last standing in is what those surfaces offer a way back to. Recorded only
  // once the shop has actually loaded: a stale bookmark to a removed shop would otherwise
  // overwrite a good remembered id with one that resolves to nothing.
  const loaded = editor.content !== null;
  useEffect(() => {
    if (loaded) {
      writeLastVisitedShop(shopId);
    }
  }, [loaded, shopId]);

  const { publish: publishDraft } = editor;
  const publish = useCallback(async () => {
    const version = await publishDraft();
    await refreshShops();
    return version;
  }, [publishDraft, refreshShops]);

  if (editor.loading) {
    return (
      <AppShell shops={shops} currentShopId={shopId}>
        <p className="text-sm text-admin-muted">Loading shop…</p>
      </AppShell>
    );
  }

  if (!editor.content) {
    return (
      <AppShell shops={shops}>
        <div role="alert" className="text-sm text-lab-error">
          {editor.error ?? shopsError ?? "This shop could not be loaded."}
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
          content: editor.content,
          preview: editor.preview,
          dirty: editor.dirty,
          saving: editor.saving,
          discarding: editor.discarding,
          publishing: editor.publishing,
          error: editor.error ?? shopsError,
          edit: editor.edit,
          save: editor.save,
          discard: editor.discard,
          publish,
        }}
      >
        <Outlet />
      </WorkspaceContext.Provider>
    </AppShell>
  );
}
