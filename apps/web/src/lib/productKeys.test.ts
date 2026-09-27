import type { ProductViewSchema, ShopContentSchema } from "@agent-lab/contracts";
import { describe, expect, it } from "vitest";
import {
  createProductKeyring,
  type DraftProduct,
  productEntryState,
  productKeyIn,
  type ShopDraft,
  sameProductEntry,
} from "./productKeys";

function product(handle: string, title: string): ProductViewSchema {
  return {
    handle,
    title,
    description: "",
    status: "active",
    category: "Jackets",
    options: [],
    variants: [],
    media: [],
    attributes: [],
    reviews: [],
    ratings: { review_count: 0, average_rating: null },
  };
}

function shop(...products: ProductViewSchema[]): ShopContentSchema {
  return {
    identity: {
      name: "Northstar Outfitters",
      slug: "northstar",
      locale: "en-GB",
      currencies: ["EUR"],
      channels: ["chat"],
    },
    products,
    faq: [],
    policies: [],
    payment_methods: [],
    fulfilment_methods: [],
    support_guidelines: [],
    tone_of_voice_guidelines: [],
    default_tone_of_voice_id: null,
    logo: null,
  };
}

/** The fixture of the reproductions note: X first, then Alpine Shell Jacket. */
const LAB = shop(
  product("x-first", "X first"),
  product("alpine-shell-jacket", "Alpine Shell Jacket"),
);

function keyOf(draft: ShopDraft, handle: string): string | undefined {
  return draft.products.find((entry) => entry.handle === handle)?.key;
}

function renamed(draft: ShopDraft, key: string, handle: string): ShopDraft {
  return {
    ...draft,
    products: draft.products.map((entry) => (entry.key === key ? { ...entry, handle } : entry)),
  };
}

function without(draft: ShopDraft, key: string): ShopDraft {
  return { ...draft, products: draft.products.filter((entry) => entry.key !== key) };
}

describe("the product keyring", () => {
  it("keys each product of a first read once, and says only its own keys were minted", () => {
    const keyring = createProductKeyring();
    const draft = keyring.keyed(LAB);
    const [first, second] = draft.products;

    expect(first.key).not.toBe(second.key);
    expect(keyring.minted(first.key)).toBe(true);
    expect(keyring.minted(keyring.mint())).toBe(true);
    // Another load's keyring — a reload, another shop — never names this one's products,
    // even for the same draft read in the same order.
    const other = createProductKeyring();
    expect(other.minted(first.key)).toBe(false);
    expect(other.keyed(LAB).products.map((entry) => entry.key)).not.toContain(first.key);
  });

  it("gives a re-read draft back the keys it was edited under, whatever the edit renamed", () => {
    const keyring = createProductKeyring();
    const draft = keyring.keyed(LAB);
    const alpine = keyOf(draft, "alpine-shell-jacket") as string;
    // A rename lives only in the draft; nothing about it reaches the keyring.
    renamed(draft, alpine, "alpine-jacket");

    const reread = keyring.keyed(LAB);

    expect(reread.products.map((entry) => entry.key)).toEqual(
      draft.products.map((entry) => entry.key),
    );
  });

  it("keys a handle vacated in the draft and retaken by another product as the saved one (R3, S1, S7, S9)", () => {
    const keyring = createProductKeyring();
    const draft = keyring.keyed(LAB);
    const xFirst = keyOf(draft, "x-first") as string;
    const alpine = keyOf(draft, "alpine-shell-jacket") as string;
    // X first leaves the draft and Alpine is renamed onto the handle it held (R3, S1, S9);
    // or a new product is titled onto it instead (S7). None of it is saved.
    const renamedOnto = renamed(without(draft, xFirst), alpine, "x-first");
    const created: DraftProduct = { ...product("x-first", "X first"), key: keyring.mint() };
    expect(keyOf(renamedOnto, "x-first")).toBe(alpine);

    // Discard: what the lab holds, read again.
    const reread = keyring.keyed(LAB);

    expect(keyOf(reread, "x-first")).toBe(xFirst);
    expect(keyOf(reread, "alpine-shell-jacket")).toBe(alpine);
    // The product that took the handle in the draft comes back under no key it ever had.
    expect(reread.products.map((entry) => entry.key)).not.toContain(created.key);
  });

  it("records a landed write from what was sent, so a later read keys the renamed handle", () => {
    const keyring = createProductKeyring();
    const draft = keyring.keyed(LAB);
    const alpine = keyOf(draft, "alpine-shell-jacket") as string;
    const sent = renamed(draft, alpine, "saved-b");

    keyring.landed(sent);
    // The lab now holds `saved-b`, and a discard reads it back — whether or not the page
    // applied the write's echo, which a keystroke during the save declines (R8).
    const reread = keyring.keyed(shop(product("x-first", "X first"), product("saved-b", "A")));

    expect(keyOf(reread, "saved-b")).toBe(alpine);
    expect(keyOf(reread, "x-first")).toBe(keyOf(draft, "x-first"));
  });

  it("records a landed write's new product and forgets a product it no longer holds", () => {
    const keyring = createProductKeyring();
    const draft = keyring.keyed(LAB);
    const xFirst = keyOf(draft, "x-first") as string;
    const created: DraftProduct = { ...product("new-product", "New"), key: keyring.mint() };
    const kept = without(draft, xFirst);
    const sent: ShopDraft = { ...kept, products: [...kept.products, created] };

    keyring.landed(sent);
    const reread = keyring.keyed(shop(...sent.products));

    expect(keyOf(reread, "new-product")).toBe(created.key);
    // The lab no longer holds X first, so a later product under its handle is a new one.
    const later = keyring.keyed(shop(product("x-first", "X first"), ...sent.products));
    expect(keyOf(later, "x-first")).not.toBe(xFirst);
  });

  it("is left alone by a write that did not land", () => {
    const keyring = createProductKeyring();
    const draft = keyring.keyed(LAB);
    const alpine = keyOf(draft, "alpine-shell-jacket") as string;
    // A refused write (R6) never calls `landed`: the lab still holds the old handle.
    renamed(draft, alpine, "refused");

    expect(keyOf(keyring.keyed(LAB), "alpine-shell-jacket")).toBe(alpine);
  });
});

describe("whether the lab holds a product", () => {
  it("is known for a product read or written, and not for one only appended to the draft", () => {
    const keyring = createProductKeyring();
    const draft = keyring.keyed(LAB);
    const created: DraftProduct = { ...product("new-product", ""), key: keyring.mint() };

    expect(keyring.saved(draft.products[0].key)).toBe(true);
    expect(keyring.saved(created.key)).toBe(false);

    keyring.landed({ ...draft, products: [...draft.products, created] });
    expect(keyring.saved(created.key)).toBe(true);
  });
});

describe("a write whose outcome is unknown", () => {
  it("keeps every product the write sent under the handle it already had", () => {
    const keyring = createProductKeyring();
    const draft = keyring.keyed(LAB);

    keyring.unsure(draft);
    const reread = keyring.keyed(LAB);

    expect(reread.products.map((entry) => entry.key)).toEqual(
      draft.products.map((entry) => entry.key),
    );
    expect(keyring.saved(draft.products[0].key)).toBe(true);
  });

  it("drops every handle the write moved, landed or not, so no read hands its key to another", () => {
    const keyring = createProductKeyring();
    const draft = keyring.keyed(LAB);
    const xFirst = keyOf(draft, "x-first") as string;
    const alpine = keyOf(draft, "alpine-shell-jacket") as string;
    // Alpine moved off its handle and X first moved onto it.
    const sent = renamed(renamed(draft, alpine, "alpine-old"), xFirst, "alpine-shell-jacket");

    keyring.unsure(sent);
    // Read back as landed, or as not: neither hands Alpine's key to X first, nor the reverse.
    const landed = keyring.keyed(shop(...sent.products));
    const createdKeys = landed.products.map((entry) => entry.key);
    expect(createdKeys).not.toContain(alpine);
    expect(createdKeys).not.toContain(xFirst);
  });
});

describe("a history entry's product key", () => {
  it("is stamped beside what the entry already carries, and read back", () => {
    const state = productEntryState("product-k-1", { removed: { text: "t", key: "a" } });

    expect(state).toEqual({ removed: { text: "t", key: "a" }, product: "product-k-1" });
    expect(productKeyIn(state)).toBe("product-k-1");
    expect(productKeyIn(null)).toBeNull();
    expect(productKeyIn({ product: 3 })).toBeNull();
  });
});

describe("two history entries naming the same product", () => {
  const editor = (handle: string, key: string | null) => ({
    pathname: `/shops/s-1/products/${handle}`,
    state: key === null ? null : productEntryState(key),
  });

  it("is only ever the product editor, on both sides, with the same key", () => {
    const alpine = editor("alpine-shell-jacket", "product-k-1");

    expect(sameProductEntry(alpine, editor("alpine-jacket", "product-k-1"))).toBe(true);
    // Another product, or an entry nobody stamped, is a navigation like any other, which the
    // unsaved-work guard asks about.
    expect(sameProductEntry(alpine, editor("alpine-jacket", "product-k-2"))).toBe(false);
    expect(sameProductEntry(alpine, editor("alpine-jacket", null))).toBe(false);
    expect(sameProductEntry(editor("alpine-jacket", null), editor("alpine-jacket", null))).toBe(
      false,
    );
  });

  it("is not a navigation off the editor that happens to carry the key", () => {
    const alpine = editor("alpine-shell-jacket", "product-k-1");
    const state = productEntryState("product-k-1");

    // `.` and `..` resolve an editor address to the catalog and to the shop.
    expect(sameProductEntry(alpine, { pathname: "/shops/s-1/products", state })).toBe(false);
    expect(sameProductEntry(alpine, { pathname: "/shops/s-1", state })).toBe(false);
    expect(sameProductEntry(alpine, { pathname: "/shops/s-1/products/a/b", state })).toBe(false);
  });
});
