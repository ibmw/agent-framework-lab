import { render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ProductDeleteConfirm } from "./components/ProductDeleteConfirm";
import type { DraftProduct, ShopDraft } from "./lib/productKeys";
import type { ShopWorkspaceValue } from "./shell/ShopWorkspace";
import { WorkspaceContext } from "./shell/useShopWorkspace";

const SHOP_ID = "3f4a3b2c-1d0e-4f5a-8b7c-6d5e4f3a2b1c";
const ORDER_ID = "7d6c5b4a-3e2f-4a1b-9c8d-7e6f5a4b3c2d";

function product(key: string, title: string, sku: string): DraftProduct {
  return {
    key,
    handle: key,
    title,
    description: "",
    status: "active",
    category: "",
    options: [],
    variants: [
      { sku, option_values: [], availability: "in_stock", stock_quantity: 1, price: null },
    ],
    media: [],
    attributes: [],
    reviews: [],
    ratings: { review_count: 0, average_rating: null },
  };
}

const alpine = product("alpine", "Alpine", "NS-ASJ-OB-M");
const other = product("other", "Other", "NS-OTHER");

/** The workspace as far as the confirm reads it: the shop, its draft, an unread order listing. */
function workspace(products: DraftProduct[]): ShopWorkspaceValue {
  const unread = {
    rows: [],
    loading: true,
    error: null,
    count: null,
    refresh: async () => false,
  };
  return {
    shopId: SHOP_ID,
    content: { products } as unknown as ShopDraft,
    listings: {
      orders: unread,
      customers: unread,
      tickets: unread,
      scenarios: unread,
      supportIdentities: unread,
    },
  } as unknown as ShopWorkspaceValue;
}

/** Each order read the lab has been asked, held until its release is called. */
let held: (() => void)[] = [];
const server = setupServer(
  http.get(`*/api/v1/shops/${SHOP_ID}/orders`, () =>
    HttpResponse.json({ orders: [{ order_id: ORDER_ID, reference: "NS-10482" }] }),
  ),
  http.get(`*/api/v1/shops/${SHOP_ID}/orders/${ORDER_ID}`, async () => {
    await new Promise<void>((resolve) => {
      held.push(resolve);
    });
    return HttpResponse.json({
      order_id: ORDER_ID,
      shop_id: SHOP_ID,
      content: { reference: "NS-10482", lines: [{ sku: "NS-ASJ-OB-M" }] },
      issues: [],
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  held = [];
});
afterAll(() => server.close());

function Confirm({ subject }: { subject: DraftProduct }) {
  return (
    <WorkspaceContext.Provider value={workspace([alpine, other])}>
      <ProductDeleteConfirm product={subject} onConfirm={() => {}} onKeep={() => {}} />
    </WorkspaceContext.Provider>
  );
}

describe("a product's Delete confirm", () => {
  it("lands an order read only on the product it was read for", async () => {
    // One confirm, asked about Alpine and then — without remounting — about another product
    // while Alpine's read is still in the air.
    const { rerender } = render(<Confirm subject={alpine} />);
    await waitFor(() => expect(screen.getByRole("group")).toHaveAccessibleName("Delete “Alpine”?"));
    await waitFor(() => expect(held).toHaveLength(1));
    const [alpineRead] = held;

    rerender(<Confirm subject={other} />);
    expect(screen.getByRole("group")).toHaveAccessibleName("Delete “Other”?");
    await waitFor(() => expect(held).toHaveLength(2));
    alpineRead();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Alpine's answer names NS-10482; nothing of it reaches the other product's confirm.
    expect(screen.getByRole("group")).not.toHaveTextContent("NS-10482");
    expect(screen.getByRole("group")).not.toHaveTextContent("No order in this shop names");
    expect(screen.getByRole("group")).not.toHaveTextContent("could not be read");
    expect(screen.getByRole("button", { name: "Delete it" })).toBeDisabled();

    // Its own read, when it answers, is what it says.
    held[1]();
    await waitFor(() =>
      expect(screen.getByRole("group")).toHaveTextContent(
        "No order in this shop names one of its variants.",
      ),
    );
  });
});
