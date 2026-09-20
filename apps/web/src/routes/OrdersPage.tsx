import type { CustomerProfileSummarySchema, OrderSummarySchema } from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { describeApiError } from "../api/client";
import { listCustomerProfiles } from "../api/customerProfiles";
import { createOrder, listOrders } from "../api/orders";
import { ButtonIcon } from "../components/ButtonIcon";
import { DerivedIdField } from "../components/DerivedIdField";
import { FieldHint } from "../components/FieldHint";
import { type FilterChipDefinition, FilterChips, filterList } from "../components/FilterChips";
import { SearchField, SearchRow } from "../components/SearchField";
import { TourLaunch } from "../components/TourLaunch";
import { Card, PageHeader, StatusPill } from "../components/WorkspaceChrome";
import { nextReference, referencePrefix, seriesPrefix } from "../lib/entryIds";
import { alreadyTakenMessage, ORDER_REFERENCE_RULE, REFERENCE_PATTERN } from "../lib/fieldRules";
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

/** Completes "{reference} is already {…}." wherever an order reference is refused. */
const ORDER_REFERENCE_TAKEN_PLACE = "used by an order in this shop";

type Filter = "all" | "open" | "unfulfilled" | "unpaid";

/**
 * The prototype's order chips (`tmp/design-frames/Workspace.dc.html`:6884–6888), less one.
 *
 * *Payment unsettled* is the prototype's wording for what this page called *Unpaid*, and the
 * change of word is a change of predicate. `PaymentStatus` has four members — `pending`,
 * `authorized`, `paid`, `refunded` — and the chip takes the two where the money has not landed
 * yet. A refund is settled, in the other direction: it is a finished movement, not an open
 * one, and counting it under a word that means "still owing" would make the chip say something
 * its own number contradicts. The old *Unpaid* label read `!== "paid"` and survived only
 * because the prototype's fixture holds no refund.
 *
 * The fifth chip the prototype draws, *Referenced by a ticket*, is not here: an order carries
 * no ticket on `OrderSummarySchema`, the link lives on a ticket's content, and reading it
 * would mean fetching every ticket's draft from an index — a payload this slice may not add.
 */
const FILTERS: FilterChipDefinition<Filter, OrderSummarySchema>[] = [
  { id: "all", label: "All", kind: "all", matches: () => true },
  {
    id: "open",
    label: "Open",
    kind: "published",
    matches: (order) => order.fulfilment_status !== "fulfilled",
  },
  {
    id: "unfulfilled",
    label: "Unfulfilled",
    kind: "unfulfilled",
    matches: (order) => order.fulfilment_status === "unfulfilled",
  },
  {
    id: "unpaid",
    label: "Payment unsettled",
    kind: "attention",
    matches: (order) => order.payment_status === "pending" || order.payment_status === "authorized",
  },
];

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
  const [query, setQuery] = useState("");
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
  // A create in flight is about to change the listing, so which reference is free is unknown
  // again until the reload it triggers lands — the same state the page opens in, down to the
  // field being nobody's, and closed the same way. `busy` spans the create *and* the reload,
  // which `reload` itself does not report through `loading`.
  const settling = loading || busy;
  const suggestedReference =
    loading || loadError || busy
      ? ""
      : nextReference(
          seriesPrefix(takenReferences, referencePrefix(content.identity.name)),
          takenReferences,
        );

  // "The order needs a reference" is only true while one is still being worked out. Once the
  // listing lands the field holds one, and an alert that outlived its own reason is worse than
  // no alert at all. A create failure is set long after this has settled, so it survives.
  useEffect(() => {
    if (!loading) {
      setFormError(null);
    }
  }, [loading]);

  async function addOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Said rather than swallowed. The field's own `required` and custom validity hold both of
    // these back most of the time — but not while it is disabled, which bars it from
    // constraint validation altogether, and not in the commit where it holds a suggestion this
    // form has not been told about yet. Returning in silence there left "Create order" doing
    // nothing at all.
    if (!reference) {
      setFormError("The order needs a reference before it can be created.");
      return;
    }
    if (takenReferences.includes(reference)) {
      setFormError(alreadyTakenMessage(reference, ORDER_REFERENCE_TAKEN_PLACE));
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

  // Reference or customer, the pair the prototype's orders search reads (its `shownOrders`
  // filter) and the pair its placeholder names.
  const { chips, visible } = filterList(orders, FILTERS, filter, {
    query,
    fields: (order) => [order.reference, order.customer_display_name],
  });

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
          {/* Only once there are rows to search and count. A chip is a filter, and a row of
              zeros over "Loading…" — or over a listing that failed — filters nothing and
              answers nothing; it is the stat band this slice exists to avoid, drawn at its
              least useful moment. The search box keeps the same company: a box that can only
              narrow nothing is a control that does nothing. Both arrive with the table they
              belong to. */}
          {loading || loadError ? null : (
            <>
              <SearchRow>
                <SearchField
                  label="Search by reference or customer"
                  onChange={setQuery}
                  value={query}
                />
              </SearchRow>
              <FilterChips
                legend="Filter orders"
                chips={chips}
                selected={filter}
                onSelect={setFilter}
              />
            </>
          )}

          {loading ? (
            <p className="p-4 text-[13px] text-admin-muted">Loading orders…</p>
          ) : visible.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">
              {orders.length === 0
                ? "This shop has no order fixtures yet. Create one for a customer attached to this shop."
                : "No order matches this view."}
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
              // Only while a suggestion is on its way. A listing that *failed* leaves none to
              // wait for, and the field stays usable so an order can still be named by hand.
              pending={settling}
              taken={takenReferences}
              takenPlace={ORDER_REFERENCE_TAKEN_PLACE}
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
              <ButtonIcon verb="save" />
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
