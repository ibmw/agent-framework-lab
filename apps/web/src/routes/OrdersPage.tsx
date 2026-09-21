import type {
  CustomerProfileContentSchema,
  OrderSummarySchema,
  ShopOrderResponse,
} from "@agent-lab/contracts";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { describeApiError } from "../api/client";
import { getCustomerProfileDraft } from "../api/customerProfiles";
import { createOrder, replaceOrder } from "../api/orders";
import { CreatePage } from "../components/CreatePage";
import { DerivedIdField } from "../components/DerivedIdField";
import { Field, FieldGroup, FieldRows } from "../components/FieldHint";
import { type FilterChipDefinition, FilterChips } from "../components/FilterChips";
import { SearchField, SearchRow } from "../components/SearchField";
import { Card, PageHeader, StatusPill } from "../components/WorkspaceChrome";
import { nextReference, referencePrefix, seriesPrefix } from "../lib/entryIds";
import { alreadyTakenMessage, ORDER_REFERENCE_RULE, REFERENCE_PATTERN } from "../lib/fieldRules";
import { filterList } from "../lib/filters";
import {
  clampQuantity,
  fulfilmentLabel,
  MAX_LINE_QUANTITY,
  MIN_LINE_QUANTITY,
  paymentLabel,
  todayInput,
  toOrderRequest,
} from "../lib/orders";
import {
  accentButtonClasses,
  fieldControlClasses,
  focusRingClasses,
  formatFixtureTimestamp,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";
import { useRegisterUnsavedWork } from "../lib/unsavedWork";
import { useShopWorkspace } from "../shell/useShopWorkspace";

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
  // The listing this page renders is the one the rail counts, read once by the shop's shell
  // (ADR 0056). Creating is `/orders/new`, which refreshes it there.
  const { listings } = useShopWorkspace();
  const orders = listings.orders.rows;
  const loading = listings.orders.loading;
  const loadError = listings.orders.error;
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

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
        actions={
          <Link className={accentButtonClasses} to="new">
            New order
          </Link>
        }
      />

      {loadError ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {loadError}
        </p>
      ) : null}

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
                  <td className={tableCellClasses}>{formatFixtureTimestamp(order.placed_at)}</td>
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
    </>
  );
}

/**
 * `/shops/:shopId/orders/new` — the order fixture, authored on a page
 * (`Workspace.dc.html`:1202).
 *
 * Who and when, one line from the catalog, and the shipping address chosen from the
 * customer's own book. Payment and fulfilment stay in the editor this lands in: the plan's
 * bullet names three cards and the fixture's *state* is what the editor exists to author.
 *
 * **Creating an order is two writes, and that is the contract's shape rather than a choice.**
 * `CreateOrderRequest` carries a reference, a customer and an instant and nothing else — lines
 * are selections the lab prices, and they arrive through `PUT`. The slice requires that Create
 * be refused while a line is missing, so the page collects the line and then sends it: `POST`
 * makes the order, `PUT` puts the line and the address on it. If the second write is refused
 * the operator stays here with the reason under the button and the order id is kept, so
 * pressing Create again retries the `PUT` alone rather than making a second order.
 */
export function NewOrderPage() {
  const { shopId, content, listings } = useShopWorkspace();
  const navigate = useNavigate();
  const formId = useId();
  const orders = listings.orders.rows;
  const customers = listings.customers.rows;
  const loading = listings.orders.loading || listings.customers.loading;
  const loadError = listings.orders.error ?? listings.customers.error;
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reference, setReference] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [placedOn, setPlacedOn] = useState(todayInput);
  const [sku, setSku] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [book, setBook] = useState<CustomerProfileContentSchema | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  /**
   * The order the `POST` already made, when the `PUT` that follows it was refused. Kept so a
   * second press finishes what the first started instead of creating a second fixture — which
   * is what `AGENTS.md` means by keeping a write idempotent.
   */
  const [created, setCreated] = useState<ShopOrderResponse | null>(null);
  /**
   * Set the moment this page's work is finished and it is navigating into the editor.
   *
   * Read by the registration below rather than by a render: the router asks the blocker
   * before React has committed anything, so a flag in state would still say "unsaved" and
   * the prompt would ask about the order the operator is being taken to. `OrderEditorPage`'s
   * delete answers the same question the same way (ADR 0051).
   */
  const landed = useRef(false);
  /**
   * Set when this page's own run must stand down: the operator has left the work behind, or
   * somebody else has finished it.
   *
   * `submit` is a plain async continuation. It survives the component, so every one of its
   * awaits is a place the operator can leave from — Discard on the prompt, the rail, the
   * shop switcher — and on resume it would otherwise send the `PUT`, re-read a listing
   * through a closure that may belong to a shop nobody is standing in any more, and
   * navigate somebody who has gone somewhere else into an order editor. ADR 0051 says
   * *Discard and leave* "throws each piece away"; this is what makes that true of a write
   * that is already in flight, and it is what `AGENTS.md` means by keeping updates
   * concurrency-safe.
   *
   * Reset on mount as well as set on unmount, because `StrictMode` runs the pair twice.
   */
  const stopped = useRef(false);
  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);

  /**
   * The references this shop already holds, less the one this page has just written.
   *
   * The listing is re-read as soon as the `POST` lands, so on a retry it holds the order
   * this page made — and counting that against the operator would refuse the reference they
   * are still editing as "already used" by itself.
   */
  const takenReferences = orders
    .filter((order) => order.order_id !== created?.order_id)
    .map((order) => order.reference);
  /**
   * Once the order exists this is the reference the *lab* gave it, whatever the listing is
   * doing.
   *
   * First in the order of questions, before the listing's own state: the re-read that
   * follows the `POST` happens while this page is still standing, and a suggestion that
   * answered `""` because that read failed would empty a field the operator never touched
   * and block the retry on "the order needs a reference". Taking it from the created order
   * rather than from the live field also keeps `DerivedIdField`'s promise that emptying the
   * field hands the suggestion back.
   */
  const suggestedReference =
    created !== null
      ? created.content.reference
      : loading || loadError
        ? ""
        : nextReference(
            seriesPrefix(takenReferences, referencePrefix(content.identity.name)),
            takenReferences,
          );

  // The address book is the customer's, not the shop's, so it is read when one is chosen. An
  // order never takes a typed address: it selects an entry and the lab freezes a copy.
  useEffect(() => {
    if (customerId === "") {
      setBook(null);
      setBookError(null);
      return;
    }
    const controller = new AbortController();
    setBook(null);
    setBookError(null);
    getCustomerProfileDraft(customerId, controller.signal)
      .then((profile) => setBook(profile.content))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setBookError(describeApiError(cause, "That customer's address book is unavailable."));
        }
      });
    return () => controller.abort();
  }, [customerId]);

  // The default entry, until the author picks another. An order fixture that ships to the
  // default is the ordinary case; the wrong-address scenarios are the ones that pick.
  const addresses = book?.addresses ?? [];
  const chosenAddressId =
    addressId !== null && addresses.some((entry) => entry.id === addressId)
      ? addressId
      : (book?.default_address_id ?? null);

  const catalog = content.products.flatMap((product) =>
    product.variants.flatMap((variant) =>
      // An unpriced draft variant cannot be ordered; the lab refuses it on save too.
      variant.price === null
        ? []
        : [
            {
              sku: variant.sku,
              label: `${product.title} · ${variant.sku}`,
              price: variant.price,
            },
          ],
    ),
  );

  const blockedBy = loading
    ? "Reading what this shop already holds…"
    : customers.length === 0
      ? "Attach a customer to this shop first — an order belongs to a customer the shop has."
      : customerId === ""
        ? "The order needs the customer it belongs to."
        : reference === ""
          ? "The order needs a reference before it can be created."
          : takenReferences.includes(reference)
            ? alreadyTakenMessage(reference, ORDER_REFERENCE_TAKEN_PLACE)
            : catalog.length === 0
              ? "This shop sells no priced variant yet, so an order can hold no line."
              : sku === ""
                ? "An order needs at least one line. Choose the variant it is for."
                : undefined;

  /**
   * The second write: everything the create request could not carry.
   *
   * It sends the form's *current* answers rather than the ones the `POST` froze, so a
   * reference or a date corrected after a refusal is the one that lands — and the title
   * above, which is the reference, never names an order the lab does not hold.
   */
  async function putTheRest(order: ShopOrderResponse): Promise<string | null> {
    if (stopped.current) {
      return null;
    }
    try {
      await replaceOrder(shopId, order.order_id, {
        ...toOrderRequest(order.content),
        reference,
        placed_at: new Date(`${placedOn}T12:00`).toISOString(),
        lines: [{ sku, quantity }],
        shipping_address_id: chosenAddressId,
      });
    } catch (cause: unknown) {
      return describeApiError(cause, "The order was created, but its line could not be saved.");
    }
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blockedBy !== undefined) {
      return;
    }
    setCreating(true);
    setFormError(null);
    let order = created;
    if (order === null) {
      try {
        // The date the author picks is a calendar day in their own zone; the contract wants
        // an explicit offset, so the browser resolves it once here.
        order = await createOrder(shopId, {
          reference,
          customer_profile_id: customerId,
          placed_at: new Date(`${placedOn}T12:00`).toISOString(),
        });
      } catch (cause: unknown) {
        setFormError(describeApiError(cause, "The order could not be created."));
        setCreating(false);
        return;
      }
      // The order exists but the operator has gone: the lab holds a lineless fixture, which
      // is a state its own gate names the moment anyone opens it, and this run writes,
      // reads and navigates nothing further. The listing is left to the read already in
      // flight or to the next time the shop is entered — calling this run's `refresh` from
      // here is the one thing that must not happen, because the shell it belongs to may be
      // showing another shop by now.
      if (stopped.current) {
        return;
      }
      setCreated(order);
      // The listing has changed the moment the order exists, whether or not the write that
      // follows lands: ADR 0056's invalidation rule is about what the surface *did*, not
      // about whether it finished. Leaving it until the end would keep the index and the
      // rail an order short after a refusal — and would let the next create suggest a
      // reference the lab has already taken.
      await listings.orders.refresh();
      if (stopped.current) {
        return;
      }
    }
    const refused = await putTheRest(order);
    if (stopped.current) {
      return;
    }
    if (refused !== null) {
      setFormError(refused);
      setCreating(false);
      return;
    }
    // Nothing is unsaved from here: the second write landed, so the page must not stand in
    // the way of any navigation, including its own.
    landed.current = true;
    // The row's line count and total moved too, and then the operator is standing in the
    // editor of what they made.
    await listings.orders.refresh();
    if (stopped.current) {
      return;
    }
    navigate(`/shops/${shopId}/orders/${order.order_id}`);
  }

  /**
   * Once the order exists, this page holds an edit to something that exists.
   *
   * ADR 0051's "a half-typed create form is not an edit to something that exists" is what
   * keeps every other create page out of the register, and it stops being true here the
   * moment the `POST` lands and the `PUT` is refused: the line and the address are on screen
   * and nowhere else. So from that moment the page declares itself, with its own second
   * write as the save. Discarding leaves the order as the lab holds it — created, with no
   * line — which is exactly what walking away does.
   */
  useRegisterUnsavedWork(
    created === null
      ? null
      : {
          label: `Order ${created.content.reference} was created without its line.`,
          reaches: () => landed.current,
          save: async () => {
            const refused = await putTheRest(created);
            if (refused !== null) {
              return refused;
            }
            // Done, by this hand rather than by the run that started it: that run stands
            // down so it cannot write a second time or navigate somebody who is leaving.
            landed.current = true;
            stopped.current = true;
            await listings.orders.refresh();
            return null;
          },
          // Thrown away, as ADR 0051 says Discard throws every piece away. The order the
          // lab already holds stays as it is — created, with no line — and the run that
          // was making it writes nothing more.
          discard: () => {
            stopped.current = true;
          },
        },
  );

  return (
    <CreatePage
      backTo={`/shops/${shopId}/orders`}
      backLabel="Orders"
      breadcrumb="creating an order fixture"
      title={reference}
      untitled="New order"
      standing={created === null ? undefined : "created · its line is not saved yet"}
      formId={formId}
      createLabel="Create order"
      creating={creating}
      creatingLabel="Creating…"
      blockedBy={blockedBy}
      error={formError ?? loadError ?? bookError}
    >
      <form id={formId} className="grid gap-4" onSubmit={submit}>
        <Card title="Who and when">
          <FieldRows>
            <Field
              label="Customer"
              hint={
                created === null
                  ? "Only customers attached to this shop can hold one of its orders. Their address book is what the shipping address is chosen from."
                  : "The order belongs to this customer now. A customer is fixed at creation — the write that saves the line cannot move one, and the lab refuses a shipping address from anybody else's book — so changing it means deleting this order and making another."
              }
            >
              <select
                className={fieldControlClasses}
                value={customerId}
                required
                disabled={created !== null}
                onChange={(event) => setCustomerId(event.target.value)}
              >
                <option value="">Select a customer</option>
                {customers.map((customer) => (
                  <option key={customer.profile_id} value={customer.profile_id}>
                    {customer.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <DerivedIdField
              arrangement="row"
              label="Reference"
              hint={ORDER_REFERENCE_RULE}
              value={reference}
              suggested={suggestedReference}
              // Only while a suggestion is on its way. A listing that *failed* leaves none to
              // wait for, and the field stays usable so an order can still be named by hand.
              pending={loading}
              taken={takenReferences}
              takenPlace={ORDER_REFERENCE_TAKEN_PLACE}
              pattern={REFERENCE_PATTERN}
              title={ORDER_REFERENCE_RULE}
              placeholder="NS-10483"
              required
              normalize={(value) => value.toUpperCase()}
              onChange={setReference}
            />
            <Field
              label="Placed on"
              hint="The calendar day the fixture was placed, in your timezone. Returns windows and delivery promises are measured from it."
            >
              <input
                className={fieldControlClasses}
                type="date"
                value={placedOn}
                required
                onChange={(event) => setPlacedOn(event.target.value)}
              />
            </Field>
          </FieldRows>
        </Card>

        <Card title="Lines">
          <FieldRows>
            <Field
              label="Variant"
              hint="A line names a variant, so a later price change in the catalog never rewrites what this order charged. Further lines are added in the editor."
            >
              <select
                className={fieldControlClasses}
                value={sku}
                required
                onChange={(event) => setSku(event.target.value)}
              >
                <option value="">Select a variant</option>
                {catalog.map((variant) => (
                  <option key={variant.sku} value={variant.sku}>
                    {variant.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Quantity"
              hint="How many of that variant. The lab prices the line from the catalog when the order is saved."
            >
              <input
                className={`${fieldControlClasses} max-w-[140px]`}
                type="number"
                min={MIN_LINE_QUANTITY}
                max={MAX_LINE_QUANTITY}
                value={quantity}
                onChange={(event) => setQuantity(clampQuantity(event.target.value, quantity))}
              />
            </Field>
          </FieldRows>
        </Card>

        <Card title="Shipping address">
          <FieldGroup
            label="Address book"
            hint="An order never takes a typed address: it selects an entry from this customer's book and stores a frozen copy. Editing the book afterwards never rewrites this order."
            extra={
              customerId === ""
                ? "Choose a customer to see their address book."
                : addresses.length === 0
                  ? "This customer has no address yet. Entries are added in the customer editor, not here."
                  : "Entries are added in the customer editor, not here."
            }
          >
            <div className="grid gap-2">
              {addresses.map((entry) => (
                <label
                  key={entry.id}
                  className={`flex cursor-pointer gap-3 rounded-[9px] border p-3 text-[13px] ${
                    entry.id === chosenAddressId
                      ? "border-admin-chip-border bg-admin-chip text-lab-primary"
                      : "border-admin-field-border bg-admin-surface"
                  } ${focusRingClasses}`}
                >
                  <input
                    className="mt-0.5"
                    type="radio"
                    name="shipping-address"
                    value={entry.id}
                    checked={entry.id === chosenAddressId}
                    onChange={() => setAddressId(entry.id)}
                  />
                  <span>
                    <span className="block font-bold">{entry.label}</span>
                    <span className="block text-admin-ink-soft">
                      {entry.line1}, {entry.postal_code} {entry.city}, {entry.country}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </FieldGroup>
        </Card>
      </form>
    </CreatePage>
  );
}
