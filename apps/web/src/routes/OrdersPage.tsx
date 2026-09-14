import type { CustomerProfileSummarySchema, OrderSummarySchema } from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { describeApiError } from "../api/client";
import { listCustomerProfiles } from "../api/customerProfiles";
import { createOrder, listOrders } from "../api/orders";
import { DerivedIdField } from "../components/DerivedIdField";
import { FieldHint } from "../components/FieldHint";
import { TourLaunch } from "../components/TourLaunch";
import { Card, PageHeader, StatusPill } from "../components/WorkspaceChrome";
import { nextReference, referencePrefix, seriesPrefix } from "../lib/entryIds";
import { ORDER_REFERENCE_RULE, REFERENCE_PATTERN } from "../lib/fieldRules";
import { fulfilmentLabel, paymentLabel, todayInput } from "../lib/orders";
import {
  accentButtonClasses,
  fieldControlClasses,
  formatTimestamp,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/ShopWorkspace";

const UNAVAILABLE = "The order service is unavailable.";

type Filter = "all" | "open" | "unfulfilled" | "unpaid";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "unfulfilled", label: "Unfulfilled" },
  { id: "unpaid", label: "Unpaid" },
];

function matches(order: OrderSummarySchema, filter: Filter): boolean {
  switch (filter) {
    case "open":
      return order.fulfilment_status !== "fulfilled";
    case "unfulfilled":
      return order.fulfilment_status === "unfulfilled";
    case "unpaid":
      return order.payment_status !== "paid";
    default:
      return true;
  }
}

/** Frame 2 — the shop's authored order fixtures. */
export function OrdersPage() {
  const { shopId, content } = useShopWorkspace();
  const [orders, setOrders] = useState<OrderSummarySchema[]>([]);
  const [customers, setCustomers] = useState<CustomerProfileSummarySchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [reference, setReference] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [placedOn, setPlacedOn] = useState(todayInput);

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const [listed, attached] = await Promise.all([
        listOrders(shopId, signal),
        listCustomerProfiles(shopId, signal),
      ]);
      setOrders(listed.orders);
      setCustomers(attached.profiles);
      setLoadError(null);
    },
    [shopId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    reload(controller.signal)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(describeApiError(cause, UNAVAILABLE));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [reload]);

  const takenReferences = orders.map((order) => order.reference);
  const suggestedReference =
    loading || loadError
      ? ""
      : nextReference(
          seriesPrefix(takenReferences, referencePrefix(content.identity.name)),
          takenReferences,
        );

  async function addOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reference || takenReferences.includes(reference)) {
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      // The date the author picks is a calendar day in their own zone; the contract wants
      // an explicit offset, so the browser resolves it once here.
      await createOrder(shopId, {
        reference,
        customer_profile_id: customerId,
        placed_at: new Date(`${placedOn}T12:00`).toISOString(),
      });
      setReference("");
    } catch (cause: unknown) {
      setFormError(describeApiError(cause, "The order could not be created."));
      setBusy(false);
      return;
    }
    try {
      await reload();
    } catch (cause: unknown) {
      setLoadError(describeApiError(cause, UNAVAILABLE));
    } finally {
      setBusy(false);
    }
  }

  const visible = orders.filter((order) => matches(order, filter));

  return (
    <>
      <PageHeader
        title="Orders"
        description="Orders are authored fixture state for this shop. Starting an experiment snapshots them into each arm's sandbox — live runs mutate isolated clones, never this data."
        actions={<TourLaunch id="orders" />}
      />

      {loadError ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {loadError}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={`${surfaceClasses} overflow-hidden`}>
          <fieldset className="flex flex-wrap items-center gap-1.5 border-b border-admin-border px-4 py-2.5">
            <legend className="sr-only">Filter orders</legend>
            {FILTERS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={filter === entry.id}
                onClick={() => setFilter(entry.id)}
                className={
                  filter === entry.id
                    ? "rounded-md bg-[#e8f0ed] px-2.5 py-1 text-xs font-semibold text-lab-ink"
                    : "rounded-md px-2.5 py-1 text-xs font-semibold text-admin-muted hover:bg-admin-canvas"
                }
              >
                {entry.label}
                <span className="ml-1.5 text-admin-muted">
                  {orders.filter((order) => matches(order, entry.id)).length}
                </span>
              </button>
            ))}
          </fieldset>

          {loading ? (
            <p className="p-4 text-[13px] text-admin-muted">Loading orders…</p>
          ) : visible.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">
              {orders.length === 0
                ? "This shop has no order fixtures yet. Create one for a customer attached to this shop."
                : "No order matches this filter."}
            </p>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={tableHeadClasses}>Order</th>
                  <th className={tableHeadClasses}>Placed</th>
                  <th className={tableHeadClasses}>Customer</th>
                  <th className={tableHeadClasses}>Payment</th>
                  <th className={tableHeadClasses}>Fulfilment</th>
                  <th className={tableHeadClasses}>Total</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((order) => (
                  <tr key={order.order_id}>
                    <td className={tableCellClasses}>
                      <Link
                        className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                        to={order.order_id}
                      >
                        {order.reference}
                      </Link>
                      <div className="text-admin-muted">
                        {order.line_count} line{order.line_count === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className={tableCellClasses}>{formatTimestamp(order.placed_at)}</td>
                    <td className={tableCellClasses}>{order.customer_display_name}</td>
                    <td className={tableCellClasses}>
                      <StatusPill tone="payment" label={paymentLabel(order.payment_status)} />
                    </td>
                    <td className={tableCellClasses}>
                      <StatusPill
                        tone="fulfilment"
                        label={fulfilmentLabel(order.fulfilment_status)}
                      />
                    </td>
                    <td className={tableCellClasses}>
                      {order.total.amount} {order.total.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <Card title="Create order">
          <form className="grid gap-3" onSubmit={addOrder}>
            <FieldHint
              label="Customer"
              hint="An order belongs to a customer attached to this shop."
            >
              <select
                className={fieldControlClasses}
                value={customerId}
                required
                onChange={(event) => setCustomerId(event.target.value)}
              >
                <option value="">Select a customer</option>
                {customers.map((customer) => (
                  <option key={customer.profile_id} value={customer.profile_id}>
                    {customer.display_name}
                  </option>
                ))}
              </select>
            </FieldHint>
            <DerivedIdField
              label="Reference"
              hint={ORDER_REFERENCE_RULE}
              value={reference}
              suggested={suggestedReference}
              taken={takenReferences}
              takenPlace="used by an order in this shop"
              pattern={REFERENCE_PATTERN}
              title={ORDER_REFERENCE_RULE}
              placeholder="NS-10483"
              required
              normalize={(value) => value.toUpperCase()}
              onChange={setReference}
            />
            <FieldHint
              label="Placed on"
              hint="The calendar day the fixture was placed, in your timezone."
            >
              <input
                className={fieldControlClasses}
                type="date"
                value={placedOn}
                required
                onChange={(event) => setPlacedOn(event.target.value)}
              />
            </FieldHint>
            {formError ? (
              <p role="alert" className="text-[13px] text-lab-error">
                {formError}
              </p>
            ) : null}
            <button
              className={accentButtonClasses}
              type="submit"
              disabled={busy || customers.length === 0}
            >
              Create order
            </button>
            <p className="text-xs text-admin-muted">
              {customers.length === 0
                ? "Attach a customer to this shop first — an order belongs to a customer the shop has."
                : "The order opens empty: add line items from the catalog and select a shipping address in the editor."}
            </p>
          </form>
        </Card>
      </div>
    </>
  );
}
