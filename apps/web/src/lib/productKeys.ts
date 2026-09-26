import type { ProductViewSchema, ShopContentSchema } from "@agent-lab/contracts";
import { matchPath } from "react-router-dom";

/**
 * A product of the shop draft as this browser edits it: the contract's product and the key
 * the workspace gave it (ADR 0061).
 *
 * The key is the product's identity while it is being edited. Its handle is its address and
 * moves with a rename; the key does not. It rides inside the product so every edit that spreads
 * one keeps it, and `toPayload` strips it, so it never reaches the lab.
 */
export interface DraftProduct extends ProductViewSchema {
  key: string;
}

/** The shop draft as the workspace holds it: the contract's content with keyed products. */
export interface ShopDraft extends Omit<ShopContentSchema, "products"> {
  products: DraftProduct[];
}

/**
 * The join between the keys this load gave products and what the lab holds (ADR 0061).
 *
 * The lab stores a product as its handle, and a shop's handles are unique, so between two
 * writes a saved handle names exactly one saved product. The keyring remembers which key it
 * gave that product, which is what lets a re-read draft — a discard — hand every saved product
 * back the key it was being edited under, however the draft had renamed it.
 */
export interface ProductKeyring {
  /** A key nothing holds yet, for a product appended to the draft. */
  mint(): string;
  /** Whether this load gave out `key`. A key from another load names nothing here. */
  minted(key: string): boolean;
  /** Whether the lab is known to hold the product under `key` — it is not new in the draft. */
  saved(key: string): boolean;
  /**
   * The lab's content, keyed: a saved handle gets the key it had, a handle never seen gets a
   * new one. What it keys is what the lab holds, so it becomes the keyring's record.
   */
  keyed(content: ShopContentSchema): ShopDraft;
  /** A write of `sent` landed: each written handle now names the product it was sent with. */
  landed(sent: ShopDraft): void;
  /**
   * A write of `sent` whose outcome is unknown. Where the record and `sent` agree — the same
   * handle, the same key — the lab holds that product under that handle whether or not the
   * write landed, so the entry stays; every other entry is dropped, and the next read keys
   * those products afresh rather than hand one product's key to another.
   */
  unsure(sent: ShopDraft): void;
}

let loads = 0;

export function createProductKeyring(): ProductKeyring {
  // Unique to this keyring, so a key read back out of a history entry from before a reload,
  // or from another shop's keyring, is one this keyring never minted.
  loads += 1;
  const nonce = `${loads}${Math.random().toString(36).slice(2, 10)}`;
  let count = 0;
  const given = new Set<string>();
  let saved = new Map<string, string>();

  function mint(): string {
    count += 1;
    const key = `product-${nonce}-${count}`;
    given.add(key);
    return key;
  }

  return {
    mint,
    minted: (key) => given.has(key),
    saved: (key) => [...saved.values()].includes(key),
    keyed(content) {
      const record = new Map<string, string>();
      const products = content.products.map((product) => {
        const key = saved.get(product.handle) ?? mint();
        record.set(product.handle, key);
        return { ...product, key };
      });
      saved = record;
      return { ...content, products };
    },
    landed(sent) {
      saved = new Map(sent.products.map((product) => [product.handle, product.key]));
    },
    unsure(sent) {
      const agreed = new Map<string, string>();
      for (const product of sent.products) {
        if (saved.get(product.handle) === product.key) {
          agreed.set(product.handle, product.key);
        }
      }
      saved = agreed;
    },
  };
}

/** What a history entry for a product editor carries beside its address. */
export interface ProductEntryState {
  product: string;
}

/** The key a history entry was stamped with, if any. */
export function productKeyIn(state: unknown): string | null {
  if (typeof state !== "object" || state === null) {
    return null;
  }
  const key = (state as Partial<ProductEntryState>).product;
  return typeof key === "string" ? key : null;
}

/** The product editor's route, which is the only place a product key names a page. */
const PRODUCT_EDITOR = "/shops/:shopId/products/:handle";

interface Entry {
  pathname: string;
  state: unknown;
}

/**
 * Whether two history entries are the product editor on the same product. A navigation between
 * them — the editor moving its own address after a rename or a discard — leaves nothing: the
 * page stays mounted, and so do its open rows (ADR 0061). Both must be the editor's route: a
 * key carried to any other page names nothing there, and leaving for it is leaving.
 */
export function sameProductEntry(current: Entry, next: Entry): boolean {
  const key = productKeyIn(current.state);
  return (
    key !== null &&
    key === productKeyIn(next.state) &&
    matchPath(PRODUCT_EDITOR, current.pathname) !== null &&
    matchPath(PRODUCT_EDITOR, next.pathname) !== null
  );
}

/** `state` stamped with a product's key, keeping whatever else the entry already carries. */
export function productEntryState(key: string, state: unknown = null): ProductEntryState {
  const carried = typeof state === "object" && state !== null ? state : {};
  return { ...carried, product: key };
}
