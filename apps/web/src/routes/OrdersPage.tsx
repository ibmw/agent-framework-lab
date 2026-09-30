import type {
  CustomerProfileContentSchema,
  OrderSummarySchema,
  ReplaceOrderRequest,
} from "@agent-lab/contracts";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { describeApiError } from "../api/client";
import { getCustomerProfileDraft } from "../api/customerProfiles";
import { createOrder, replaceOrder } from "../api/orders";
import { ButtonIcon } from "../components/ButtonIcon";
import { RemovalNotice } from "../components/ConfirmRemove";
import { CreatePage } from "../components/CreatePage";
import { DerivedIdField } from "../components/DerivedIdField";
import { Field, FieldGroup, FieldRows } from "../components/FieldHint";
import { type FilterChipDefinition, FilterChips } from "../components/FilterChips";
import { SearchField, SearchRow } from "../components/SearchField";
import { Card, PageHeader, StatusPill } from "../components/WorkspaceChrome";
import { type Created, useCreateThenComplete } from "../lib/createDefinition";
import { nextReference, referencePrefix, SLUG_MAX_LENGTH, seriesPrefix } from "../lib/entryIds";
import {
  alreadyTakenMessage,
  MAX_LINE_QUANTITY,
  MIN_LINE_QUANTITY,
  ORDER_REFERENCE_RULE,
  REFERENCE_PATTERN,
  tooLongMessage,
} from "../lib/fieldRules";
import { filterList } from "../lib/filters";
import {
  clampQuantity,
  fulfilmentLabel,
  paymentLabel,
  placedAt,
  todayInput,
  toOrderRequest,
} from "../lib/orders";
import { useArrivedRemoval, useRemoval } from "../lib/removal";
import { onlyChoiceNote, useSingleChoice } from "../lib/singleChoice";
import {
  accentButtonClasses,
  fieldControlClasses,
  focusRingClasses,
  formatFixtureTimestamp,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";
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
  const { shopId, listings } = useShopWorkspace();
  // The order editor's Delete lands here, and this is where it says what it deleted. An
  // order's delete cannot be undone, so no row is ever put back to silence it.
  const removal = useRemoval(shopId);
  useArrivedRemoval(removal);
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
        description="Orders are authored fixture state for this shop. Starting an experiment freezes them into the snapshot each arm's sandbox is cloned from — live runs mutate isolated clones, never this data."
        actions={
          <Link className={accentButtonClasses} to="new">
            <ButtonIcon verb="create" />
            New order
          </Link>
        }
      />

      <section className={`${surfaceClasses} overflow-hidden`}>
        {/* Only once there are rows to search and count. A chip is a filter, and a row of
            zeros over "Loading…" — or over a listing that failed — filters nothing and
            answers nothing; it is the stat band this slice exists to avoid, drawn at its
            least useful moment. The search box keeps the same company: a box that can only
            narrow nothing is a control that does nothing. Both arrive with the table they
            belong to; the title beside the box is the card's, drawn in every state. */}
        <SearchRow title="Order fixtures">
          {loading || loadError ? null : (
            <SearchField
              label="Search by reference or customer"
              onChange={setQuery}
              value={query}
            />
          )}
        </SearchRow>
        {loading || loadError ? null : (
          <FilterChips
            legend="Filter orders"
            chips={chips}
            selected={filter}
            onSelect={setFilter}
          />
        )}

        {loadError ? (
          // Its failure and nothing else: a listing that could not be read has not said the
          // shop holds no order.
          <p role="alert" className="p-4 text-[13px] text-lab-error">
            {loadError}
          </p>
        ) : loading ? (
          <p className="p-4 text-[13px] text-admin-muted">Loading orders…</p>
        ) : orders.length === 0 ? (
          <p className="p-4 text-[13px] text-admin-muted">
            This shop has no order fixtures yet. An order is placed by a customer attached to this
            shop —{" "}
            <Link
              className="font-semibold text-lab-ink underline-offset-2 hover:underline"
              to={`/shops/${shopId}/customers`}
            >
              attach or create one in Customers
            </Link>
            .
          </p>
        ) : visible.length === 0 ? (
          <p className="p-4 text-[13px] text-admin-muted">No order matches this view.</p>
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
        <RemovalNotice removal={removal} />
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
 *
 * This page proved that shape and no longer keeps its own copy of it: `useCreateThenComplete`
 * holds it for every create the lab has, including the unsaved work declared between the two
 * writes, the stand-down when the operator leaves, and the one second write a prompt's Save
 * joins rather than repeats (ADR 0051, ADR 0056). What is the order fixture's rather than the
 * pattern's is all still here and all still read off what the first write made: the reference
 * the lab gave it, the customer that write froze, and the listing it changed.
 */
export function NewOrderPage() {
  const { shopId, content, listings } = useShopWorkspace();
  const formId = useId();
  const orders = listings.orders.rows;
  const customers = listings.customers.rows;
  const loading = listings.orders.loading || listings.customers.loading;
  const loadError = listings.orders.error ?? listings.customers.error;
  const [reference, setReference] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [placedOn, setPlacedOn] = useState(todayInput);
  const [sku, setSku] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [book, setBook] = useState<CustomerProfileContentSchema | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  /**
   * The references this shop already holds, less the one this page has just written.
   *
   * The listing is re-read as soon as the `POST` lands, so on a retry it holds the order
   * this page made — and counting that against the operator would refuse the reference they
   * are still editing as "already used" by itself.
   *
   * A function rather than a value because the gate below is asked *during* the create hook's
   * own call, with what the first write made: the answer has to be available to that
   * question and to the field, and both read the same one row out.
   */
  function referencesTakenBesides(made: Created<ReplaceOrderRequest> | null): string[] {
    return orders.filter((order) => order.order_id !== made?.id).map((order) => order.reference);
  }

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

  // One attached customer, or one priced variant, is not a choice (ADR 0064).
  const onlyCustomer = useSingleChoice(
    customers.map((customer) => customer.profile_id),
    customerId,
    setCustomerId,
  );
  const onlyVariant = useSingleChoice(
    catalog.map((variant) => variant.sku),
    sku,
    setSku,
  );

  const creating = useCreateThenComplete<ReplaceOrderRequest>(
    {
      create: async () => {
        const made = await createOrder(shopId, {
          reference,
          customer_profile_id: customerId,
          placed_at: placedAt(placedOn),
        });
        // The request the `PUT` takes rather than the order the `GET` answers with: a line
        // the lab priced is not a line anyone sends back, and the draft this pattern
        // completes has to be the shape the second write replaces.
        return { id: made.order_id, draft: toOrderRequest(made.content) };
      },
      // The form's own answers over what the lab made, which is why a reference or a date
      // corrected after a refusal is the one that lands.
      compose: (made) => ({
        ...made,
        reference,
        placed_at: placedAt(placedOn),
        lines: [{ sku, quantity }],
        shipping_address_id: chosenAddressId,
      }),
      replace: (id, payload) => replaceOrder(shopId, id, payload),
      refresh: listings.orders.refresh,
      editorAt: (id) => `/shops/${shopId}/orders/${id}`,
      owes: (made) => `Order ${made.reference} was created without its line.`,
      standing: "created · its line is not saved yet",
      whenCreateFails: "The order could not be created.",
      whenCompleteFails: "The order was created, but its line could not be saved.",
    },
    (made) =>
      loading
        ? "Reading what this shop already holds…"
        : customers.length === 0
          ? "Attach a customer to this shop first — an order belongs to a customer the shop has."
          : customerId === ""
            ? "The order needs the customer it belongs to."
            : reference === ""
              ? "The order needs a reference before it can be created."
              : referencesTakenBesides(made).includes(reference)
                ? alreadyTakenMessage(reference, ORDER_REFERENCE_TAKEN_PLACE)
                : // Only a value the page wrote or normalized can be this long.
                  reference.length > SLUG_MAX_LENGTH
                  ? tooLongMessage(reference.length, SLUG_MAX_LENGTH)
                  : catalog.length === 0
                    ? "This shop sells no priced variant yet, so an order can hold no line."
                    : sku === ""
                      ? "An order needs at least one line. Choose the variant it is for."
                      : undefined,
  );

  const takenReferences = referencesTakenBesides(creating.made);
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
    creating.made !== null
      ? creating.made.draft.reference
      : loading || loadError
        ? ""
        : nextReference(
            seriesPrefix(takenReferences, referencePrefix(content.identity.name)),
            takenReferences,
          );

  return (
    <CreatePage
      backTo={`/shops/${shopId}/orders`}
      backLabel="Orders"
      breadcrumb="creating an order fixture"
      title={reference}
      untitled="New order"
      standing={creating.standing}
      formId={formId}
      createLabel="Create order"
      creating={creating.busy}
      creatingLabel="Creating…"
      blockedBy={creating.blockedBy}
      error={creating.error ?? loadError ?? bookError}
    >
      <form id={formId} className="grid gap-4" onSubmit={creating.submit}>
        <Card title="Who and when">
          <FieldRows>
            <Field
              label="Customer"
              hint={
                creating.made === null
                  ? `Only customers attached to this shop can hold one of its orders. Their address book is what the shipping address is chosen from.${onlyCustomer ? ` ${onlyChoiceNote("customer attached to this shop")}` : ""}`
                  : "The order belongs to this customer now. A customer is fixed at creation — the write that saves the line cannot move one, and the lab refuses a shipping address from anybody else's book — so changing it means deleting this order and making another."
              }
            >
              <select
                className={`${fieldControlClasses} w-full`}
                value={customerId}
                required
                disabled={creating.made !== null}
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
              maxLength={SLUG_MAX_LENGTH}
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
                className={`${fieldControlClasses} w-full`}
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
              hint={`A line names a variant, so a later price change in the catalog never rewrites what this order charged. Further lines are added in the editor.${onlyVariant ? ` ${onlyChoiceNote("priced variant in the catalog")}` : ""}`}
            >
              <select
                className={`${fieldControlClasses} w-full`}
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
                className={`${fieldControlClasses} w-full max-w-[140px]`}
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
