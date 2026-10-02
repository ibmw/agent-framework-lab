import { useEffect, useState } from "react";
import { describeApiError } from "../api/client";
import { listOrders } from "../api/orders";
import { listScenarios } from "../api/scenarios";
import { getShopDraft, listShopMedia } from "../api/shops";
import { listTickets } from "../api/tickets";
import {
  COUNTING,
  holdingsSentence,
  SHOP_DELETE_KEEPS,
  type ShopHoldings,
} from "../lib/shopDeletion";
import { ConfirmRemove } from "./ConfirmRemove";

type Reading =
  | { status: "reading" }
  | { status: "read"; holdings: ShopHoldings }
  | { status: "failed"; reason: string };

/**
 * Everything the shop holds, read once, when the confirm is asked for — ADR 0062's rule: the
 * read is the confirm's mount, which is the first press, never a render of the index and never
 * per row. Five reads in parallel, the shop's own listings and its images.
 */
function useHoldings(shopId: string): Reading {
  const [reading, setReading] = useState<Reading>({ status: "reading" });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([
      getShopDraft(shopId, signal),
      listOrders(shopId, signal),
      listTickets(shopId, signal),
      listScenarios(shopId, signal),
      listShopMedia(shopId, signal),
    ]).then(
      ([draft, orders, tickets, scenarios, media]) => {
        if (!signal.aborted) {
          setReading({
            status: "read",
            holdings: {
              products: draft.content.products.length,
              orders: orders.orders.length,
              tickets: tickets.tickets.length,
              scenarios: scenarios.scenarios.length,
              images: media.media.length,
            },
          });
        }
      },
      (cause: unknown) => {
        if (!signal.aborted) {
          setReading({
            status: "failed",
            reason: describeApiError(cause, "The lab is unavailable."),
          });
        }
      },
    );
    return () => controller.abort();
  }, [shopId]);

  return reading;
}

/**
 * A shop's Delete on the shops index, asked a second time in the warm red (ADR 0075), with what
 * goes counted before the press (ADR 0077). *Delete it* waits for the count, with its reason
 * beside it; a count that cannot be read says so and lets the delete through, because what
 * the shop holds is said to inform the press, not to permit it — the lab decides that.
 */
export function ShopDeleteConfirm({
  shopId,
  name,
  columns,
  onConfirm,
  onKeep,
}: {
  shopId: string;
  name: string;
  columns: number;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  const reading = useHoldings(shopId);
  return (
    <ConfirmRemove
      as="tr"
      columns={columns}
      title={`Delete ${name} and everything it holds?`}
      consequence={
        <>
          <span className="block" role="status">
            {reading.status === "reading"
              ? COUNTING
              : reading.status === "read"
                ? holdingsSentence(reading.holdings)
                : `What it holds could not be counted: ${reading.reason}`}
          </span>
          <span className="mt-1 block">
            A deleted shop cannot be brought back. {SHOP_DELETE_KEEPS}
          </span>
        </>
      }
      confirmLabel="Delete it"
      confirmRefusal={reading.status === "reading" ? COUNTING : undefined}
      onConfirm={onConfirm}
      onKeep={onKeep}
    />
  );
}
