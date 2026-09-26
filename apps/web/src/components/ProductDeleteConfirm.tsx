import { useEffect, useState } from "react";
import { describeApiError, LabApiError } from "../api/client";
import { getOrder, listOrders } from "../api/orders";
import type { DraftProduct } from "../lib/productKeys";
import { consequenceOf, findingClauses, REMOVAL_FINDINGS } from "../lib/removal";
import { productTitle } from "../lib/shop";
import { useShopWorkspace } from "../shell/useShopWorkspace";
import { ConfirmRemove } from "./ConfirmRemove";

/** One order of the shop, by its reference, and the SKUs its lines name. */
interface OrderLines {
  reference: string;
  skus: string[];
}

type Reading =
  | { status: "reading" }
  | { status: "read"; orders: OrderLines[] }
  | { status: "failed"; reason: string };

const READING: Reading = { status: "reading" };

const CHECKING = "Checking which orders name one of its variants…";

/** How many order reads are in flight at once, so a large shop is not asked all at once. */
const READ_CONCURRENCY = 6;

/**
 * Each item through `read`, never more than `limit` at a time, answered in order. The first read
 * that fails fails the whole answer, so no worker starts another read after it: the reads
 * already in flight are the only ones the lab is still asked.
 */
async function inBatches<Item, Answer>(
  items: readonly Item[],
  limit: number,
  read: (item: Item) => Promise<Answer>,
): Promise<Answer[]> {
  const answers: Answer[] = new Array(items.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        answers[index] = await read(items[index]);
      } catch (cause: unknown) {
        failed = true;
        throw cause;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return answers;
}

/**
 * The lines of every order this shop holds, read once, when the confirm is asked for (ADR 0062).
 *
 * `OrderSummarySchema` carries a line count and not the lines, so this is the orders listing the
 * workspace already holds (ADR 0056) — read directly only while it has not answered — and one
 * `getOrder` behind each row, at most six at a time. An order that answers 404 was deleted since
 * the listing was read, and names nothing. Nothing here is per render or per row: the confirm
 * mounts once per first press, and the read is its mount's.
 *
 * The answer is held under the product key it was read for, and shown only for that key: a
 * read that answers after the confirm moved on to another product never lands on it.
 */
function useOrderLines(shopId: string, productKey: string): Reading {
  const { listings } = useShopWorkspace();
  // The listing as it stood when the confirm opened. One that answers afterwards is not a
  // reason to read every order again: the read already running asked the lab itself.
  const [listed] = useState(() => (listings.orders.count === null ? null : listings.orders.rows));
  const [held, setHeld] = useState<{ productKey: string; reading: Reading }>({
    productKey,
    reading: READING,
  });

  useEffect(() => {
    const controller = new AbortController();
    const answer = (reading: Reading) => {
      if (!controller.signal.aborted) {
        setHeld({ productKey, reading });
      }
    };
    (async () => {
      const orders = listed ?? (await listOrders(shopId, controller.signal)).orders;
      const details = await inBatches(orders, READ_CONCURRENCY, async (order) => {
        try {
          return await getOrder(shopId, order.order_id, controller.signal);
        } catch (cause: unknown) {
          if (cause instanceof LabApiError && cause.status === 404) {
            return null;
          }
          throw cause;
        }
      });
      return details.flatMap((order) =>
        order === null
          ? []
          : [
              {
                reference: order.content.reference,
                skus: order.content.lines.map((line) => line.sku),
              },
            ],
      );
    })().then(
      (orders) => answer({ status: "read", orders }),
      (cause: unknown) =>
        answer({
          status: "failed",
          reason: describeApiError(cause, "The orders could not be read."),
        }),
    );
    return () => controller.abort();
  }, [shopId, productKey, listed]);

  return held.productKey === productKey ? held.reading : READING;
}

/** Which of the orders name one of `skus`, matched as `line_sku_missing_from_catalog` does. */
function ordersNaming(orders: OrderLines[], skus: readonly string[]) {
  const wanted = new Set(skus);
  return orders.flatMap((order) => {
    const named = [...new Set(order.skus.filter((sku) => wanted.has(sku)))];
    return named.length === 0 ? [] : [{ reference: order.reference, skus: named }];
  });
}

function namingSentence(orders: OrderLines[]): string {
  if (orders.length === 0) {
    return "No order in this shop names one of its variants.";
  }
  const each = orders.map(
    (order) =>
      `order ${order.reference} names ${order.skus.length === 1 ? "one of its variants" : `${order.skus.length} of its variants`}, ${order.skus.join(", ")}`,
  );
  const joined = each.join("; ");
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}. ${
    orders.length === 1 ? "That order" : "Each"
  } ${REMOVAL_FINDINGS.line_sku_missing_from_catalog}.`;
}

function leavingSentence(count: number): string {
  const variants =
    count === 0 ? "" : count === 1 ? " with its one variant" : ` with its ${count} variants`;
  return `It leaves the catalog${variants}, and agents can no longer find it once the draft is published.`;
}

/**
 * A product's Delete, asked a second time with every order it would leave naming a variant the
 * catalog no longer has — on the editor's header and as a catalog row alike, so the two say the
 * same thing: order NS-10482, named before the second press (ADR 0062).
 *
 * The orders are read once, when the confirm opens; the SKUs they are matched against are the
 * product's as it stands at each render, so a variant renamed while the confirm stands is
 * matched as it now is without asking the lab again.
 */
export function ProductDeleteConfirm({
  product,
  as,
  columns,
  onConfirm,
  onKeep,
}: {
  product: DraftProduct;
  as?: "div" | "tr";
  columns?: number;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  const { shopId, content } = useShopWorkspace();
  const skus = product.variants.map((variant) => variant.sku);
  const reading = useOrderLines(shopId, product.key);
  const leaving = consequenceOf(
    leavingSentence(skus.length),
    findingClauses([
      content.products.length === 1 && "shop_without_product",
      "origin_product_missing_from_catalog",
      "binding_product_missing_from_catalog",
    ]),
    "Nothing is written until you save the draft, and a published shop version keeps it.",
  );

  return (
    <ConfirmRemove
      as={as}
      columns={columns}
      title={`Delete “${productTitle(product)}”?`}
      consequence={
        <>
          <span className="block">{leaving}</span>
          <span className="mt-1 block" role="status">
            {reading.status === "reading"
              ? CHECKING
              : reading.status === "read"
                ? namingSentence(ordersNaming(reading.orders, skus))
                : `Whether an order names one of its variants could not be read: ${reading.reason}`}
          </span>
        </>
      }
      confirmLabel="Delete it"
      confirmRefusal={reading.status === "reading" ? CHECKING : undefined}
      onConfirm={onConfirm}
      onKeep={onKeep}
    />
  );
}
