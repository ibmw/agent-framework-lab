import type { ShopSummarySchema } from "@agent-lab/contracts";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Link, Outlet, useMatch } from "react-router-dom";
import { describeApiError } from "../api/client";
import { listShops } from "../api/shops";
import { readLastVisitedShop, writeLastVisitedShop } from "../lib/preferences";
import { AppShell } from "./AppShell";

export interface LabWorkspaceValue {
  /** Every shop the lab holds, for the switcher and for any surface that names one. */
  shops: ShopSummarySchema[];
  /**
   * The shop the lab composes for, resolved against the list rather than trusted: a remembered
   * identifier can name a shop that has since been removed, and composing an experiment for a
   * shop that is not there is worse than saying there is none (ADR 0054).
   */
  currentShop: ShopSummarySchema | null;
  /**
   * True until the shop list has answered. Before it does, "there is no current shop" is a fact
   * this shell has not established, only one it cannot yet contradict — so a surface that would
   * otherwise say so waits.
   */
  loading: boolean;
  error: string | null;
}

const LabContext = createContext<LabWorkspaceValue | null>(null);

export function useLabWorkspace(): LabWorkspaceValue {
  const value = useContext(LabContext);
  if (!value) {
    throw new Error("useLabWorkspace must be used inside the experiment lab");
  }
  return value;
}

/**
 * The lab saying it has no current shop, on a surface where that matters.
 *
 * The bench and the history's shop filter are the two places that carry this notice, and they
 * say the fact in the same words and offer the same way out. Only the bench *uses* a current
 * shop; history's filter never names it, and carries the notice because it is where a reader
 * of that page looks for the lab's shop and finds a control of the same name saying "All
 * shops". What follows from the fact therefore differs, and the clause each passes says which:
 * the bench has nothing to compose for, while history is only reporting it.
 *
 * Neither guesses. A bench that quietly composed for the first shop in the list would freeze a
 * starting state of a world the operator never chose, and history does not preselect its filter
 * from the current shop either: that filter is URL-backed so a finding can be shared at the
 * narrowing it was found in (ADR 0033), and seeding it from a browser preference would make two
 * operators open one link on two different lists.
 */
export function NoCurrentShop({ what }: { what: string }) {
  return (
    <p className="text-[13px] text-admin-muted">
      The lab has no current shop, so {what}.{" "}
      <Link className="text-lab-ink underline-offset-2 hover:underline" to="/shops">
        Open a shop
      </Link>{" "}
      and the lab will compose for it.
    </p>
  );
}

/**
 * The experiment lab's own workspace, beside `ShopWorkspace` and on the same `AppShell`.
 *
 * What it holds is what every lab surface shares: the shop list the switcher is drawn from, and
 * the current shop resolved out of it. The lab's routes carry no shop except the two that are
 * about one run, and those carry it in the path — so where a `:shopId` is matched it is the
 * current shop, and standing on a bench makes the switcher name the shop that bench is for.
 */
export function LabWorkspace() {
  // `useParams` in a layout route answers with the parameters that route's own path matched,
  // and `/lab` matches none — so the run's shop, which is two segments deeper, is read from
  // the pattern instead. The trailing splat is what lets one pattern cover the bench and all
  // three results tabs.
  const experiment = useMatch("/lab/bench/:shopId/:experimentId/*");
  const shopId = experiment?.params.shopId;
  const [shops, setShops] = useState<ShopSummarySchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rememberedId, setRememberedId] = useState(readLastVisitedShop);

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

  // A run's shop is in its address, and an address is a stronger statement than a preference:
  // an operator who opened a bookmarked bench is standing in that shop's lab, so that is the
  // shop the switcher names and the one the bench offers next time.
  useEffect(() => {
    if (shopId !== undefined && shopId !== "") {
      setRememberedId(shopId);
      writeLastVisitedShop(shopId);
    }
  }, [shopId]);

  const chooseShop = useCallback((next: string) => {
    setRememberedId(next);
    writeLastVisitedShop(next);
  }, []);

  const currentShop = shops.find((shop) => shop.shop_id === rememberedId) ?? null;

  return (
    <AppShell
      shops={shops}
      currentShopId={currentShop?.shop_id}
      mode="lab"
      onShopChange={chooseShop}
    >
      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}
      <LabContext.Provider value={{ shops, currentShop, loading, error }}>
        <Outlet />
      </LabContext.Provider>
    </AppShell>
  );
}
