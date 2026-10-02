/**
 * What a shop's delete says (ADR 0077): why a published one is kept, and what goes with one
 * that never published. Shared by the shops index and its confirm, and read by their tests.
 */

/** Why a published shop's trash is held (ADR 0063, ADR 0077). */
export const PUBLISHED_SHOP_KEPT =
  "A published shop is kept: its versions are what experiments are explained by.";

/** Why a shop's trash is held while its own delete is in flight. */
export const DELETING_SHOP = "Deleting this shop…";

/** What a shop holds, counted from its own listings. */
export interface ShopHoldings {
  products: number;
  orders: number;
  tickets: number;
  scenarios: number;
  images: number;
}

export const COUNTING = "Counting what it holds…";

export const SHOP_DELETE_KEEPS = "Customers, identities and blocks it used are kept.";

function counted(count: number, singular: string, plural = `${singular}s`): string {
  return count === 0 ? `no ${singular}` : `${count} ${count === 1 ? singular : plural}`;
}

/** "3 products, 2 orders, no ticket, 1 scenario and 4 images" — every kind, in one order. */
export function holdingsSentence(holdings: ShopHoldings): string {
  const parts = [
    counted(holdings.products, "product"),
    counted(holdings.orders, "order"),
    counted(holdings.tickets, "ticket"),
    counted(holdings.scenarios, "scenario"),
    counted(holdings.images, "image"),
  ];
  return `It holds ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}, and all of it goes with the shop.`;
}
