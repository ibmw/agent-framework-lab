import type { ShopSummarySchema } from "@agent-lab/contracts";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { describeApiError } from "../api/client";
import { listShops } from "../api/shops";
import { PageHeader } from "../components/WorkspaceChrome";
import { readLastVisitedShop } from "../lib/preferences";
import { outlineButtonClasses } from "../lib/ui";
import { AppShell } from "./AppShell";

export interface LabSurfaceValue {
  shops: ShopSummarySchema[];
  /** The shop this surface was opened from, if the browser remembers one that still exists. */
  rememberedShop: ShopSummarySchema | null;
  /**
   * True until the shop list has answered. Before it does, "there is no remembered shop" is a
   * fact this surface has not established, only one it cannot yet contradict.
   */
  loading: boolean;
  error: string | null;
}

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

  useEffect(() => {
    const controller = new AbortController();
    listShops(controller.signal)
      .then((response) => setShops(response.shops))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(describeApiError(cause, "The lab could not list its shops."));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  return {
    shops,
    rememberedShop: shops.find((shop) => shop.shop_id === rememberedId) ?? null,
    loading,
    error,
  };
}

/**
 * A lab-level page: the no-rail layout the shops index already uses, plus the way back to the
 * shop the operator left. These surfaces sit outside shop scope on purpose — a new operator has
 * no shop yet, and a guide reachable only from inside one would be reachable exactly one step
 * after the step it exists to explain (ADR 0044).
 */
export function LabSurface({
  surface,
  title,
  description,
  children,
}: {
  surface: LabSurfaceValue;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  const { shops, rememberedShop, error } = surface;
  return (
    <AppShell shops={shops}>
      <PageHeader
        title={title}
        description={description}
        actions={
          rememberedShop ? (
            <Link className={outlineButtonClasses} to={`/shops/${rememberedShop.shop_id}`}>
              <span aria-hidden>←</span> Back to {rememberedShop.name}
            </Link>
          ) : null
        }
      />
      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}
      {children}
    </AppShell>
  );
}
