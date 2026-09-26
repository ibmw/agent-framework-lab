import type { ShopPreviewResponse, ShopSummarySchema } from "@agent-lab/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useParams } from "react-router-dom";
import { describeApiError, LabApiError } from "../api/client";
import {
  getShopDraft,
  listShops,
  previewShopDraft,
  publishShop,
  replaceShopDraft,
} from "../api/shops";
import { type DefinitionClient, useDefinitionEditor } from "../lib/definitionEditor";
import { writeLastVisitedShop } from "../lib/preferences";
import { createProductKeyring, type ShopDraft } from "../lib/productKeys";
import { shopDraftIsSavableAt, toPayload } from "../lib/shop";
import { AppShell, type RailCounts } from "./AppShell";
import { type ShopListings, useShopListings } from "./listings";
import { WorkspaceContext } from "./useShopWorkspace";

export interface ShopWorkspaceValue {
  shopId: string;
  shops: ShopSummarySchema[];
  /**
   * The shop's four listings, read once here and handed to the rail and to the index that
   * renders each of them, so a count and a table cannot disagree (ADR 0056). An index that
   * changes what it lists calls that listing's `refresh`.
   */
  listings: ShopListings;
  content: ShopDraft;
  preview: ShopPreviewResponse | null;
  dirty: boolean;
  saving: boolean;
  discarding: boolean;
  publishing: boolean;
  error: string | null;
  edit: (next: ShopDraft) => void;
  /** A key for a product about to be appended to the draft (ADR 0061). */
  mintProductKey: () => string;
  /** Whether this workspace gave out `key`; a key from another load or shop names nothing. */
  productKeyMinted: (key: string) => boolean;
  /** Whether the lab is known to hold the product under `key`, rather than it being new. */
  productSaved: (key: string) => boolean;
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
  // The keys the draft's products are edited under, one keyring per shop (ADR 0061). Every
  // draft the lab answers with is keyed through it, and every write that lands rewrites it from
  // the products that were *sent* — the moment the write answers, before the preview is read and
  // whether or not the echo is applied, so a rename that landed is recorded even when a later
  // keystroke means the echo is not. The client is rebuilt only with the shop, which is what the
  // editor's load effect already reloads on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new shop is a new keyring
  const keyring = useMemo(() => createProductKeyring(), [shopId]);
  const client = useMemo<DefinitionClient<ShopDraft, ShopDraft, ShopPreviewResponse>>(
    () => ({
      getDraft: async (id, signal) => {
        const draft = await getShopDraft(id, signal);
        return { content: keyring.keyed(draft.content) };
      },
      previewDraft: previewShopDraft,
      replaceDraft: async (id, sent) => {
        let saved: Awaited<ReturnType<typeof replaceShopDraft>>;
        try {
          saved = await replaceShopDraft(id, toPayload(sent));
        } catch (cause: unknown) {
          // A refusal the lab answered — a 4xx — wrote nothing, and the keyring still says
          // what the lab holds. Anything else — a lost answer, a 5xx, a network error — may
          // have landed or not, and a keyring that guessed either way could hand one product's
          // key to another: it keeps only what is true both ways (ADR 0061).
          if (!(cause instanceof LabApiError && cause.status >= 400 && cause.status < 500)) {
            keyring.unsure(sent);
          }
          throw cause;
        }
        keyring.landed(sent);
        return { content: keyring.keyed(saved.content) };
      },
      publish: publishShop,
      // The draft is sent keyed so the write can record which key each handle now names;
      // `replaceDraft` strips the keys, with the derived evidence, on the way out.
      toPayload: (content) => content,
      unavailable: "The shop service is unavailable.",
    }),
    [keyring],
  );
  const editor = useDefinitionEditor(shopId, client, guard);

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
          mintProductKey: keyring.mint,
          productKeyMinted: keyring.minted,
          productSaved: keyring.saved,
        }}
      >
        <Outlet />
      </WorkspaceContext.Provider>
    </AppShell>
  );
}
