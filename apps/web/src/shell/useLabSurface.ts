import type { ShopSummarySchema } from "@agent-lab/contracts";
import { useCallback, useEffect, useState } from "react";
import { describeApiError } from "../api/client";
import { listShops } from "../api/shops";
import { readLastVisitedShop } from "../lib/preferences";
import type { LabSurfaceValue } from "./LabSurface";

/**
 * The shared state of a surface that belongs to the lab rather than to a shop.
 *
 * It still needs the shop list, because the header's switcher does, and it resolves the stored
 * last-visited shop against that list rather than trusting it: a remembered identifier can name
 * a shop that has since been removed, and a dead link back is worse than no link back.
 */
export function useLabSurface(): LabSurfaceValue {
  const [shops, setShops] = useState<ShopSummarySchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rememberedId] = useState(readLastVisitedShop);

  const load = useCallback((signal?: AbortSignal) => {
    listShops(signal)
      .then((response) => setShops(response.shops))
      .catch((cause: unknown) => {
        if (!signal?.aborted) {
          setError(describeApiError(cause, "The lab could not list its shops."));
        }
      })
      .finally(() => {
        if (!signal?.aborted) {
          setLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return {
    shops,
    rememberedShop: shops.find((shop) => shop.shop_id === rememberedId) ?? null,
    loading,
    error,
    refresh: () => load(),
  };
}
