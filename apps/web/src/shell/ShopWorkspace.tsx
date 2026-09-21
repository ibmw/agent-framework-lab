import type {
  ShopContentSchema,
  ShopPayloadSchema,
  ShopPreviewResponse,
  ShopSummarySchema,
} from "@agent-lab/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { AppShell, type RailCounts } from "./AppShell";
import { type ShopListings, useShopListings } from "./listings";
import { WorkspaceContext } from "./useShopWorkspace";

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
  /**
   * The shop's four listings, read once here and handed to the rail and to the index that
   * renders each of them, so a count and a table cannot disagree (ADR 0056). An index that
   * changes what it lists calls that listing's `refresh`.
   */
  listings: ShopListings;
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

  // The listings this shop's rail counts and its indexes render, read once here (ADR 0056).
  const listings = useShopListings(shopId);

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

  // Products, the shop's documents and its tone guidelines are counted off the draft this
  // shell already holds, so they cost nothing and cannot disagree with the pages that edit
  // them; the other five are the listings above. A draft that has not arrived counts nothing
  // rather than zero (`docs/design-direction.md`, *Lists and counts*).
  const draft = editor.content;
  const counts: RailCounts = {
    products: draft === null ? null : draft.products.length,
    documents:
      draft === null
        ? null
        : draft.policies.length + draft.support_guidelines.length + draft.faq.length,
    tone: draft === null ? null : draft.tone_of_voice_guidelines.length,
    orders: listings.orders.count,
    customers: listings.customers.count,
    tickets: listings.tickets.count,
    scenarios: listings.scenarios.count,
    supportIdentities: listings.supportIdentities.count,
  };

  if (editor.loading) {
    return (
      <AppShell shops={shops} currentShopId={shopId} mode="shop" counts={counts}>
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
    <AppShell shops={shops} currentShopId={shopId} mode="shop" counts={counts}>
      <WorkspaceContext.Provider
        value={{
          shopId,
          shops,
          listings,
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
