import type {
  CustomerProfileContentSchema,
  OrderContentSchema,
  OrderEventKind,
  ShopOrderResponse,
  VariantSchema,
} from "@agent-lab/contracts";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { describeApiError } from "../api/client";
import { getCustomerProfileDraft } from "../api/customerProfiles";
import { deleteOrder, getOrder, replaceOrder } from "../api/orders";
import { ButtonIcon } from "../components/ButtonIcon";
import { ConfirmRemove, RemovalNotice } from "../components/ConfirmRemove";
import { Field, FieldGroup, FieldHint, FieldRows } from "../components/FieldHint";
import { EditButton, ItemFormRow, ListItem, RemoveButton } from "../components/ItemList";
import {
  Card,
  EditorSaveActions,
  Fingerprint,
  GateCard,
  IssueList,
  PageHeader,
  StatusPill,
} from "../components/WorkspaceChrome";
import { slugify, uniqueId } from "../lib/entryIds";
import {
  FULFILMENT_STATUS_RULE,
  isMoneyAmount,
  MAX_LINE_QUANTITY,
  MAX_ORDER_EVENTS,
  MIN_LINE_QUANTITY,
  MONEY_PATTERN,
  MONEY_RULE,
  ORDER_METHOD_RULE,
  PAID_AT_RULE,
  PAYMENT_STATUS_RULE,
  SHIPPED_AT_RULE,
} from "../lib/fieldRules";
import {
  formTitle,
  type ItemFormWords,
  refusedProps,
  useEditButtons,
  useFocusAfterCommit,
  useItemForm,
} from "../lib/itemForm";
import {
  EVENT_KINDS,
  EVERY_VARIANT_ORDERED,
  eventKindLabel,
  fromLocalInput,
  fulfilmentLabel,
  type LineForm,
  lineFormOf,
  lineQuantity,
  lineRefusal,
  lineTotal,
  NO_PRICED_VARIANT,
  type OrderEventFields,
  orderEventEntry,
  orderEventFields,
  orderEventRefusal,
  paymentLabel,
  previewTotals,
  toLocalInput,
  toOrderRequest,
  withFulfilmentStatus,
  withPaymentStatus,
} from "../lib/orders";
import {
  consequenceOf,
  findingClauses,
  type RemovalFinding,
  removedState,
  useRemoval,
} from "../lib/removal";
import { onlyChoiceNote, soleCandidate } from "../lib/singleChoice";
import {
  destructiveOutlineButtonClasses,
  editorColumnsClasses,
  editorMainClasses,
  editorPanelClasses,
  fieldControlClasses,
  formatFixtureTimestamp,
  readOnlyValueClasses,
  surfaceClasses,
  textAreaClasses,
  validationMessageClasses,
} from "../lib/ui";
import { useRegisterUnsavedWork } from "../lib/unsavedWork";
import { useShopWorkspace } from "../shell/useShopWorkspace";

const UNAVAILABLE = "The order service is unavailable.";

type LineSchema = OrderContentSchema["lines"][number];

interface CatalogVariant {
  sku: string;
  label: string;
  handle: string;
  title: string;
  variantSummary: string;
  price: NonNullable<VariantSchema["price"]>;
}

/** Frame 2b — the order fixture editor: typed, fully editable, selection-driven. */
export function OrderEditorPage() {
  const { orderId = "" } = useParams();
  const { shopId, content: shop, listings } = useShopWorkspace();
  const navigate = useNavigate();
  const [order, setOrder] = useState<ShopOrderResponse | null>(null);
  const [content, setContent] = useState<OrderContentSchema | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerProfileContentSchema | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  // Set the moment the order is deleted, and read by the guard rather than by a render: the
  // navigation that follows the delete happens before React has committed anything, so a flag
  // in state would still read "unsaved" and the prompt would ask about an order that is gone.
  const deleted = useRef(false);
  // Counts what has happened to the order this editor holds — a load, an edit, a save. A read
  // that returns to find the count moved on is a read for an order this editor is no longer
  // showing, and applying it would put one order's content under another's id (ADR 0051).
  const edits = useRef(0);
  const [error, setError] = useState<string | null>(null);
  // The order's own Delete (ADR 0060); its two lists hold their own removals.
  const orderRemoval = useRemoval(orderId);
  // Declared with the other hooks because this component returns early while it loads.
  const feeRuleId = useId();

  const apply = useCallback((response: ShopOrderResponse) => {
    edits.current += 1;
    setOrder(response);
    setContent(response.content);
    setAddressId(response.content.shipping_address?.source_address_id ?? null);
    setDirty(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getOrder(shopId, orderId, controller.signal)
      .then(async (response) => {
        apply(response);
        const profile = await getCustomerProfileDraft(
          response.content.customer_profile_id,
          controller.signal,
        );
        setCustomer(profile.content);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(describeApiError(cause, UNAVAILABLE));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [shopId, orderId, apply]);

  const save = useCallback(async (): Promise<string | null> => {
    if (content === null) {
      return UNAVAILABLE;
    }
    // The order the editor holds is one the lab would take, the rule `clampQuantity` follows
    // for quantities. A fee that is not an amount is not sent and silently refused elsewhere.
    if (!isMoneyAmount(content.shipping_fee.amount)) {
      const refused = `The shipping fee is not an amount. ${MONEY_RULE}`;
      setError(refused);
      return refused;
    }
    setSaving(true);
    setError(null);
    try {
      apply(
        await replaceOrder(shopId, orderId, {
          ...toOrderRequest(content),
          shipping_address_id: addressId,
        }),
      );
      // The index this editor was opened from prints the row that has just changed, and it
      // renders the shell's listing rather than reading its own (ADR 0056).
      void listings.orders.refresh();
      return null;
    } catch (cause: unknown) {
      const message = describeApiError(cause, UNAVAILABLE);
      setError(message);
      return message;
    } finally {
      setSaving(false);
    }
  }, [content, addressId, shopId, orderId, apply, listings.orders]);

  /**
   * Discard: read the order back from the lab, which is what Save would have written over.
   *
   * Nothing it read reaches an editor that has moved on. Discard-and-leave fires this and
   * navigates without waiting, and browser back or forward between two orders reuses this
   * component rather than remounting it, so a read of one order can land after another's.
   */
  const discard = useCallback(async () => {
    const sentAt = edits.current;
    setDiscarding(true);
    setError(null);
    setDirty(false);
    try {
      const read = await getOrder(shopId, orderId);
      if (edits.current === sentAt) {
        apply(read);
      }
    } catch (cause: unknown) {
      if (edits.current === sentAt) {
        setError(describeApiError(cause, UNAVAILABLE));
        setDirty(true);
      }
    } finally {
      // The control's busy state, not content: see `useDefinitionEditor.discard`.
      setDiscarding(false);
    }
  }, [shopId, orderId, apply]);

  // This editor tracks its own dirty flag rather than running on `useDefinitionEditor` — an
  // order is a fixture, not a versioned definition — so it declares its unsaved work itself.
  useRegisterUnsavedWork(
    dirty
      ? {
          label: "This order has unsaved changes.",
          // Nothing strands edits to an order the lab no longer holds.
          reaches: () => deleted.current,
          save,
          discard: () => void discard(),
        }
      : null,
  );

  if (loading) {
    return <p className="text-sm text-admin-muted">Loading order…</p>;
  }

  if (!content || !order) {
    return (
      <div role="alert" className="text-sm text-lab-error">
        {error ?? "This order could not be loaded."}
      </div>
    );
  }

  function edit(next: OrderContentSchema) {
    edits.current += 1;
    setContent(next);
    setDirty(true);
  }

  function selectAddress(next: string | null) {
    edits.current += 1;
    setAddressId(next);
    setDirty(true);
  }

  async function remove() {
    setSaving(true);
    try {
      await deleteOrder(shopId, orderId);
      deleted.current = true;
      void listings.orders.refresh();
      // This page is about to unmount, so the index it returns to says what was deleted.
      navigate(`/shops/${shopId}/orders`, {
        state: removedState(`Deleted order ${content?.reference ?? ""}.`, orderId),
      });
    } catch (cause: unknown) {
      setError(describeApiError(cause, "The order could not be deleted."));
      orderRemoval.keep();
      setSaving(false);
    }
  }

  const catalog: CatalogVariant[] = shop.products.flatMap((product) =>
    product.variants.flatMap((variant) =>
      // An unpriced draft variant cannot be ordered; the lab refuses it on save too.
      variant.price === null
        ? []
        : [
            {
              sku: variant.sku,
              handle: product.handle,
              title: product.title,
              variantSummary: variant.option_values.map((option) => option.value).join(" · "),
              price: variant.price,
              label: `${product.title} · ${variant.sku}`,
            },
          ],
    ),
  );

  const totals = previewTotals(content);
  const feeRefused = !isMoneyAmount(content.shipping_fee.amount);
  const address = content.shipping_address;
  const addressBook = customer?.addresses ?? [];
  const selection = addressBook.find((entry) => entry.id === addressId);
  const frozenIsCurrent = address !== null && address.source_address_id === addressId;
  const defaultAddress = addressBook.find((entry) => entry.is_default);

  return (
    <>
      <PageHeader
        title={content.reference}
        back={{ to: "..", label: "Orders", kind: "order fixture" }}
        chips={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="payment" label={paymentLabel(content.payment.status)} />
            <StatusPill tone="fulfilment" label={fulfilmentLabel(content.fulfilment.status)} />
            <span className="text-[11.5px] text-admin-muted">
              Placed {formatFixtureTimestamp(content.placed_at)}
            </span>
          </div>
        }
        actions={
          <>
            {/* Deleting a fixture is irreversible and the workflow invites it ("delete and
                recreate"), so unless the operator has turned the second press off, the
                destructive click is never the first one. The confirm stands under the header,
                because a header has no row for it to take the place of. */}
            {orderRemoval.isArmed("order") ? null : (
              <button
                className={destructiveOutlineButtonClasses}
                type="button"
                ref={orderRemoval.trigger("order")}
                // No notice of its own: this page unmounts, and the orders index it lands on
                // says what was deleted (`removedState` in `remove`).
                onClick={orderRemoval.ask("order", () => void remove(), null)}
                disabled={saving}
              >
                <ButtonIcon verb="delete" />
                Delete
              </button>
            )}
            <EditorSaveActions
              saveLabel="Save order"
              tone="accent"
              dirty={dirty}
              saving={saving}
              discarding={discarding}
              onSave={() => void save()}
              onDiscard={() => void discard()}
            />
          </>
        }
        reasons={
          error ? (
            <p role="alert" className="text-[13px] text-lab-error">
              {error}
            </p>
          ) : null
        }
        sticky
      />

      {orderRemoval.isArmed("order") ? (
        <div className="mb-4">
          <ConfirmRemove
            title={`Delete order ${content.reference} permanently?`}
            consequence={consequenceOf(
              "The lab deletes it at once: an order is not part of a draft, so Discard cannot bring it back.",
              findingClauses(["linked_order_missing_from_shop"]),
              "A published scenario version keeps the frozen copy it took.",
            )}
            confirmLabel="Delete permanently"
            confirmRefusal={saving ? "Deleting…" : undefined}
            onConfirm={() => void remove()}
            onKeep={orderRemoval.keep}
          />
        </div>
      ) : null}

      <div className={editorColumnsClasses}>
        <div className={editorMainClasses}>
          <Card
            title="Line items & payment"
            description="Totals derive from the line items — never edited directly."
          >
            {/* The three-across `sm:grid-cols-3` went with the pattern: the prototype gives
                each of an order's questions its own row, and the row stacks itself where
                there is no width for two columns. The lines are the run's first two rows: the
                items, then the one form that adds a line or edits the one chosen (ADR 0074). */}
            <FieldRows>
              <LineItems orderId={orderId} content={content} catalog={catalog} edit={edit} />
              <Field label="Payment status" hint={PAYMENT_STATUS_RULE}>
                <select
                  className={`${fieldControlClasses} w-full`}
                  value={content.payment.status}
                  onChange={(event) =>
                    edit(
                      withPaymentStatus(
                        content,
                        event.target.value as OrderContentSchema["payment"]["status"],
                      ),
                    )
                  }
                >
                  {order.payment_status_options.map((status) => (
                    <option key={status} value={status}>
                      {paymentLabel(status)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Payment method" hint={ORDER_METHOD_RULE}>
                <select
                  className={`${fieldControlClasses} w-full`}
                  value={content.payment.method_id ?? ""}
                  onChange={(event) =>
                    edit({
                      ...content,
                      payment: { ...content.payment, method_id: event.target.value || null },
                    })
                  }
                >
                  <option value="">Not recorded</option>
                  {shop.payment_methods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Paid at" hint={PAID_AT_RULE}>
                <input
                  className={`${fieldControlClasses} w-full`}
                  type="datetime-local"
                  value={content.payment.paid_at ? toLocalInput(content.payment.paid_at) : ""}
                  onChange={(event) =>
                    edit({
                      ...content,
                      payment: {
                        ...content.payment,
                        paid_at: event.target.value ? fromLocalInput(event.target.value) : null,
                      },
                    })
                  }
                />
              </Field>
            </FieldRows>

            <div className="grid gap-2 border-t border-admin-border pt-3 text-[13px]">
              <div className="flex justify-between">
                <span className="text-admin-muted">Subtotal</span>
                <span>
                  {totals.subtotal} {content.currency}
                </span>
              </div>
              <label className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-admin-muted">Shipping fee</span>
                <span className="flex items-center gap-1.5">
                  <input
                    className={`${fieldControlClasses} w-32`}
                    value={content.shipping_fee.amount}
                    inputMode="decimal"
                    pattern={MONEY_PATTERN}
                    title={MONEY_RULE}
                    aria-label="Shipping fee"
                    aria-describedby={feeRuleId}
                    aria-invalid={feeRefused || undefined}
                    onChange={(event) =>
                      edit({
                        ...content,
                        shipping_fee: { ...content.shipping_fee, amount: event.target.value },
                      })
                    }
                  />
                  <span className="text-admin-muted">{content.currency}</span>
                </span>
              </label>
              {/* The rule, always in the field's accessible description and visible only once
                  it has been broken — `FieldHint`'s `extra` slot in the one place a card of
                  totals has no room for a standing hint line. The element and its words stay
                  put, so an invalid fee announces once rather than on every keystroke; only
                  the `role` and the styling change.

                  Saying it at all is what keeps "abc" from reading as an accepted fee of
                  zero: the totals above have already counted it as nothing, because `cents`
                  contributes 0 for anything unparseable so a half-typed fee cannot turn every
                  row into NaN. */}
              <p
                id={feeRuleId}
                role={feeRefused ? "alert" : undefined}
                className={feeRefused ? "text-xs text-lab-error" : "sr-only"}
              >
                {MONEY_RULE}
              </p>
              <div className="flex justify-between font-semibold">
                <span>Total</span>
                <span>
                  {totals.total} {content.currency}
                </span>
              </div>
            </div>
          </Card>

          <Card title="Fulfilment & shipping">
            <FieldRows>
              <Field label="Fulfilment status" hint={FULFILMENT_STATUS_RULE}>
                <select
                  className={`${fieldControlClasses} w-full`}
                  value={content.fulfilment.status}
                  onChange={(event) =>
                    edit(
                      withFulfilmentStatus(
                        content,
                        event.target.value as OrderContentSchema["fulfilment"]["status"],
                      ),
                    )
                  }
                >
                  {order.fulfilment_status_options.map((status) => (
                    <option key={status} value={status}>
                      {fulfilmentLabel(status)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Fulfilment method" hint={ORDER_METHOD_RULE}>
                <select
                  className={`${fieldControlClasses} w-full`}
                  value={content.fulfilment.method_id ?? ""}
                  onChange={(event) =>
                    edit({
                      ...content,
                      fulfilment: {
                        ...content.fulfilment,
                        method_id: event.target.value || null,
                      },
                    })
                  }
                >
                  <option value="">Not recorded</option>
                  {shop.fulfilment_methods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Shipped at" hint={SHIPPED_AT_RULE}>
                <input
                  className={`${fieldControlClasses} w-full`}
                  type="datetime-local"
                  value={
                    content.fulfilment.shipped_at ? toLocalInput(content.fulfilment.shipped_at) : ""
                  }
                  onChange={(event) =>
                    edit({
                      ...content,
                      fulfilment: {
                        ...content.fulfilment,
                        shipped_at: event.target.value ? fromLocalInput(event.target.value) : null,
                      },
                    })
                  }
                />
              </Field>
            </FieldRows>
            <p className="text-xs text-admin-muted">
              {content.allows_address_change
                ? "Address changes stay allowed while this order is not fulfilled."
                : "This order is fulfilled; a run can no longer change its address."}
            </p>

            <FieldRows>
              {/* The sentence under this select was already a field's rule — where the
                  addresses come from and that none may be typed — so the pattern's hint slot
                  is where it belongs, and it is now in the select's accessible description
                  rather than only beside it. */}
              <Field
                label="Ship to"
                hint={
                  <>
                    Selected from{" "}
                    <Link
                      className="underline underline-offset-2"
                      to={`/shops/${shopId}/customers/${content.customer_profile_id}`}
                    >
                      the customer's address book
                    </Link>{" "}
                    — no free input.
                  </>
                }
              >
                <select
                  className={`${fieldControlClasses} w-full`}
                  value={addressId ?? ""}
                  onChange={(event) => selectAddress(event.target.value || null)}
                >
                  <option value="">No address selected</option>
                  {addressBook.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                      {entry.is_default ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </FieldRows>

            {address ? (
              <div className={`${surfaceClasses} bg-admin-canvas p-3 text-[13px]`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{address.source_label}</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-border px-2 py-0.5 text-[11px] font-semibold text-admin-ink-soft">
                    <span aria-hidden>❄</span> Frozen copy
                  </span>
                </div>
                <div className="mt-1">
                  {address.recipient} · {address.line1}
                  {address.line2 ? ` · ${address.line2}` : ""} · {address.postal_code}{" "}
                  {address.city}
                  {address.region ? ` · ${address.region}` : ""} · {address.country}
                </div>
                <p className="mt-1 text-xs text-admin-muted">
                  Selected {formatFixtureTimestamp(address.selected_at)} · address-book edits never
                  change this order.
                </p>
                {defaultAddress && defaultAddress.id !== address.source_address_id ? (
                  <p className="mt-1 text-xs text-admin-draft-ink">
                    Differs from the default “{defaultAddress.label}”.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-[13px] text-admin-muted">This order ships nowhere yet.</p>
            )}
            {!frozenIsCurrent && selection ? (
              <p className="text-xs text-admin-draft-ink">
                Saving freezes a new copy of “{selection.label}”.
              </p>
            ) : null}
          </Card>

          <Card
            title="Order events"
            description="Authored history — discoverable by agents through the order tools. Events are stored in chronological order."
          >
            <FieldRows>
              <OrderEvents orderId={orderId} content={content} edit={edit} />
            </FieldRows>
          </Card>
        </div>

        <div className={editorPanelClasses}>
          {/* Not "Publish gate": an order fixture is never published, and its findings are
              `validate_order_fixture`'s, read off the saved order, so they gate no publish. There
              is no gate to wait on either — the findings arrive with the save's own answer — so
              the card is busy while that save is in flight. */}
          <GateCard title="Findings" busy={saving} dirty={dirty} record="order">
            <IssueList issues={order.issues} />
            <p className="text-xs text-admin-muted">
              Fingerprint <Fingerprint value={order.content_fingerprint} />
            </p>
          </GateCard>

          <Card
            title="Customer"
            description="History shown here is this shop's only; the profile is reusable across shops."
          >
            {customer ? (
              <>
                <Link
                  className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                  to={`/shops/${shopId}/customers/${content.customer_profile_id}`}
                >
                  {customer.display_name}
                </Link>
                <p className="text-[13px] text-admin-muted">
                  {customer.persona.traits.join(" · ") || "No persona traits yet"}
                </p>
                <p className="text-xs text-admin-muted">
                  Default address: {defaultAddress?.label ?? "none"}
                </p>
              </>
            ) : (
              <p className="text-[13px] text-admin-muted">Loading customer…</p>
            )}
          </Card>

          <Card title="Freezing">
            <p className="text-xs text-admin-muted">
              Saving changes future scenario publications and experiments only — published scenarios
              and past runs keep the state they pinned. The customer is fixed at creation: delete
              and recreate to move this order.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * The event each payment and fulfilment state expects its history to hold, as
 * `PAYMENT_EVIDENCE` and `FULFILMENT_EVIDENCE` in `domain/order_fixture.py` declare it.
 */
const PAYMENT_EVIDENCE: Partial<Record<OrderContentSchema["payment"]["status"], string>> = {
  authorized: "payment_authorized",
  paid: "payment_captured",
  refunded: "payment_refunded",
};

const FULFILMENT_EVIDENCE: Partial<Record<OrderContentSchema["fulfilment"]["status"], string>> = {
  partially_fulfilled: "shipped",
  fulfilled: "shipped",
};

/** The findings removing one event would raise on the order, as `validate_order_fixture` does. */
function eventRemovalFindings(content: OrderContentSchema, eventId: string): RemovalFinding[] {
  const left = content.events.filter((event) => event.id !== eventId);
  if (left.length === 0) {
    return ["order_without_event"];
  }
  const findings: RemovalFinding[] = [];
  const holds = (kind: string | undefined) =>
    kind === undefined || left.some((event) => event.kind === kind);
  const paying = PAYMENT_EVIDENCE[content.payment.status];
  if (!holds(paying) && content.events.some((event) => event.kind === paying)) {
    findings.push("payment_status_without_event");
  }
  const fulfilling = FULFILMENT_EVIDENCE[content.fulfilment.status];
  if (!holds(fulfilling) && content.events.some((event) => event.kind === fulfilling)) {
    findings.push("fulfilment_status_without_event");
  }
  return findings;
}

/**
 * How an event is named on its row and on the controls that act on it: what happened, and the
 * identifier the order keys it by. Not its time, which is written in the operator's timestamp
 * preference and can be the same minute for two events; the id is stable and unique, and the
 * time is read on the row's own line.
 */
function eventLabel(entry: OrderContentSchema["events"][number]): string {
  return `${eventKindLabel(entry.kind)} · ${entry.id}`;
}

/** How the two forms and the unsaved-work prompt name what their lists hold (ADR 0074). */
const LINE_WORDS: ItemFormWords = { form: "Line items", entry: "a line", record: "order" };
const EVENT_WORDS: ItemFormWords = { form: "Order events", entry: "an event", record: "order" };

/**
 * A line's name on its item: the product and the variant it orders, as the catalog spells them.
 * A product without options has no variant summary, and the name is its title alone.
 */
function lineName(line: LineSchema): string {
  return [line.title, line.variant_summary].filter((part) => part !== "").join(" · ");
}

/**
 * The order's lines, as items under *Items*, and the one form that adds a line or edits the one
 * chosen (ADR 0074; `Workspace.dc.html` :2742–2752). A line is named by its SKU on its
 * controls, the key the lab holds it by; its variant is fixed while editing, because the lab
 * keys a line on its SKU and keeps its frozen price (`_materialize_lines` in
 * `application/order_fixtures.py`), so only its quantity is asked again.
 */
function LineItems({
  orderId,
  content,
  catalog,
  edit,
}: {
  orderId: string;
  content: OrderContentSchema;
  catalog: CatalogVariant[];
  edit: (next: OrderContentSchema) => void;
}) {
  const lines = content.lines;
  const ids = lines.map((line) => line.id);
  const lineOf = (id: string) => lines.find((line) => line.id === id);
  const skuOf = (id: string) => lineOf(id)?.sku ?? id;
  // The priced variants not yet on the order: what the form offers. One of them is not a choice
  // (ADR 0064): the blank form carries it, so the form opens on it — and again when adding a
  // line leaves one — without that counting as something the operator typed.
  const addable = catalog.filter((variant) => !lines.some((line) => line.sku === variant.sku));
  const only = soleCandidate(addable.map((variant) => variant.sku));
  const blank = useMemo<LineForm>(
    () => ({ variant: only ?? "", quantity: String(MIN_LINE_QUANTITY) }),
    [only],
  );
  const form = useItemForm<LineForm>({
    blank,
    ids,
    words: LINE_WORDS,
    nameOf: skuOf,
    formOf: (id) => lineFormOf(lineOf(id) as LineSchema),
  });
  const removal = useRemoval(orderId);
  const editButtons = useEditButtons();
  const focusAfterCommit = useFocusAfterCommit();
  const quantityInput = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  const editingLine = form.editing === null ? undefined : lineOf(form.editing);
  const nothingLeft =
    addable.length > 0 ? null : catalog.length === 0 ? NO_PRICED_VARIANT : EVERY_VARIANT_ORDERED;
  const refusal = lineRefusal(form.fields, {
    adding: form.editing === null,
    addable: addable.map((variant) => variant.sku),
    nothingLeft,
  });
  // A blank form is refused and says why, but no field of it is marked wrong until the operator
  // has put something in it.
  const marked = form.dirty ? refusal : null;

  function drop(id: string) {
    edit({ ...content, lines: lines.filter((entry) => entry.id !== id) });
  }

  function submit() {
    const quantity = lineQuantity(form.fields.quantity);
    if (refusal !== null || quantity === null) {
      return;
    }
    const editing = form.editing;
    if (editing !== null) {
      // An edit that changed nothing writes nothing, so the order stays as clean as it was.
      if (form.dirty) {
        edit({
          ...content,
          lines: lines.map((entry) =>
            entry.id === editing
              ? {
                  ...entry,
                  quantity,
                  line_total: {
                    ...entry.unit_price,
                    amount: lineTotal(entry.unit_price.amount, quantity),
                  },
                }
              : entry,
          ),
        });
      }
      focusAfterCommit(() => editButtons.get(editing));
    } else {
      const chosen = addable.find((variant) => variant.sku === form.fields.variant);
      if (chosen === undefined) {
        return;
      }
      // An optimistic copy of what the lab will freeze: the next save answers with the
      // authoritative line, and an already-frozen line is never re-priced from here.
      edit({
        ...content,
        lines: [
          ...lines,
          {
            id: chosen.sku.toLowerCase(),
            sku: chosen.sku,
            product_handle: chosen.handle,
            title: chosen.title,
            variant_summary: chosen.variantSummary,
            unit_price: chosen.price,
            quantity,
            line_total: { ...chosen.price, amount: lineTotal(chosen.price.amount, quantity) },
          } satisfies LineSchema,
        ],
      });
    }
    form.reset();
  }

  return (
    <>
      <FieldGroup
        label="Items"
        hint="A line names a variant, so a price change in the catalog never rewrites what this order charged."
      >
        <div className="grid gap-2">
          {lines.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {lines.map((line) => {
                const notice = `Removed the line ${line.sku} from the order.`;
                if (removal.isArmed(line.id)) {
                  return (
                    <ConfirmRemove
                      key={line.id}
                      as="li"
                      title={`Remove the line ${line.sku} — ${line.title}?`}
                      consequence={consequenceOf(
                        `Its frozen price of ${line.unit_price.amount} ${line.unit_price.currency} goes with it: adding the variant again prices it at the catalog's current amount, and the totals are derived again from what is left.`,
                        findingClauses([lines.length === 1 && "order_without_line"]),
                        "Nothing is written until you save the order.",
                      )}
                      onConfirm={removal.confirm(() => drop(line.id), notice)}
                      onKeep={removal.keep}
                    />
                  );
                }
                return (
                  <ListItem
                    key={line.id}
                    name={lineName(line)}
                    id={line.sku}
                    detail={`${line.quantity} × ${line.unit_price.amount} ${line.unit_price.currency} = ${lineTotal(line.unit_price.amount, line.quantity)} ${content.currency}`}
                    editing={form.editing === line.id}
                  >
                    <EditButton
                      name={line.sku}
                      buttonRef={editButtons.ref(line.id)}
                      onEdit={() => {
                        form.begin(line.id, lineFormOf(line));
                        focusAfterCommit(() => quantityInput.current);
                      }}
                    />
                    <RemoveButton
                      name={line.sku}
                      entryKey={line.id}
                      removal={removal}
                      notice={notice}
                      onRemove={() => drop(line.id)}
                    />
                  </ListItem>
                );
              })}
            </ul>
          ) : (
            // At the validation weight: an order with no line is a gate error
            // (`order_without_line`), as the methods handoff draws an empty list that is one,
            // and says why in the gate's own reason.
            <p className={validationMessageClasses}>
              No line item yet, so the order has nothing to derive its totals from.
            </p>
          )}
          <RemovalNotice removal={removal} />
        </div>
      </FieldGroup>
      <ItemFormRow
        title={formTitle(form.editing, skuOf, LINE_WORDS.entry)}
        hint="A line keeps the variant it was added with; only its quantity changes after."
        editing={form.editing !== null}
        addLabel="Add line"
        refusal={refusal}
        reasonId={reasonId}
        onSubmit={submit}
        onCancel={() => {
          const editing = form.editing;
          form.reset();
          if (editing !== null) {
            focusAfterCommit(() => editButtons.get(editing));
          }
        }}
      >
        {editingLine !== undefined ? (
          <FieldHint
            label="Variant"
            hint="Set when the line was added. The lab keys a line on its SKU and keeps its price."
          >
            <input
              className={readOnlyValueClasses}
              value={`${editingLine.title} · ${editingLine.sku}`}
              readOnly
            />
          </FieldHint>
        ) : (
          <FieldHint
            label="Variant"
            extra={
              only !== null && form.fields.variant === only
                ? onlyChoiceNote("priced variant not yet on this order")
                : undefined
            }
          >
            <select
              className={`${fieldControlClasses} w-full`}
              value={form.fields.variant}
              {...refusedProps(marked, "variant", reasonId)}
              onChange={(event) => form.update({ variant: event.target.value })}
            >
              <option value="">Select a variant</option>
              {addable.map((variant) => (
                <option key={variant.sku} value={variant.sku}>
                  {variant.label} · {variant.price.amount} {variant.price.currency}
                </option>
              ))}
            </select>
          </FieldHint>
        )}
        <FieldHint
          label="Quantity"
          hint={`Whole units, ${MIN_LINE_QUANTITY} to ${MAX_LINE_QUANTITY}.`}
        >
          <input
            ref={quantityInput}
            className={`${fieldControlClasses} w-full`}
            type="number"
            min={MIN_LINE_QUANTITY}
            max={MAX_LINE_QUANTITY}
            step={1}
            inputMode="numeric"
            value={form.fields.quantity}
            {...refusedProps(marked, "quantity", reasonId)}
            onChange={(event) => form.update({ quantity: event.target.value })}
          />
        </FieldHint>
      </ItemFormRow>
    </>
  );
}

/**
 * The order's authored history, as items, and the one form that adds an event or edits the one
 * chosen (ADR 0074). The form opens on a support contact at the moment the order was placed,
 * with the summary left to the author, since a made-up sentence would read as history nobody
 * wrote; a time left alone keeps the instant it opened on, to the second (`orderEventEntry`).
 */
function OrderEvents({
  orderId,
  content,
  edit,
}: {
  orderId: string;
  content: OrderContentSchema;
  edit: (next: OrderContentSchema) => void;
}) {
  const events = content.events;
  const ids = events.map((entry) => entry.id);
  const eventOf = (id: string) => events.find((entry) => entry.id === id);
  const labelOf = (id: string) => {
    const entry = eventOf(id);
    return entry === undefined ? id : eventLabel(entry);
  };
  const blank = useMemo<OrderEventFields>(
    () => ({ kind: "support_contact", occurredAt: toLocalInput(content.placed_at), summary: "" }),
    [content.placed_at],
  );
  const form = useItemForm<OrderEventFields>({
    blank,
    ids,
    words: EVENT_WORDS,
    nameOf: labelOf,
    formOf: (id) => orderEventFields(eventOf(id) as OrderContentSchema["events"][number]),
    typedOf: (fields) => fields.summary,
  });
  const removal = useRemoval(orderId);
  const editButtons = useEditButtons();
  const focusAfterCommit = useFocusAfterCommit();
  const kindSelect = useRef<HTMLSelectElement>(null);
  const reasonId = useId();
  const refusal = orderEventRefusal(form.fields, {
    full: form.editing === null && events.length >= MAX_ORDER_EVENTS,
  });
  const marked = form.dirty ? refusal : null;

  function drop(id: string) {
    edit({ ...content, events: events.filter((candidate) => candidate.id !== id) });
  }

  function submit() {
    if (refusal !== null) {
      return;
    }
    const editing = form.editing;
    if (editing !== null) {
      // An edit that changed nothing writes nothing, so the order stays as clean as it was.
      if (form.dirty) {
        edit({
          ...content,
          events: events.map((candidate) =>
            candidate.id === editing
              ? orderEventEntry(candidate.id, form.fields, candidate.occurred_at)
              : candidate,
          ),
        });
      }
      focusAfterCommit(() => editButtons.get(editing));
    } else {
      edit({
        ...content,
        events: [
          ...events,
          orderEventEntry(uniqueId(slugify("event"), ids), form.fields, content.placed_at),
        ],
      });
    }
    form.reset();
  }

  return (
    <>
      <FieldGroup label="History">
        <div className="grid gap-2">
          {events.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {events.map((entry) => {
                const label = eventLabel(entry);
                const notice = `Removed the ${eventKindLabel(entry.kind).toLowerCase()} event from the order.`;
                if (removal.isArmed(entry.id)) {
                  return (
                    <ConfirmRemove
                      key={entry.id}
                      as="li"
                      title={`Remove the ${eventKindLabel(entry.kind).toLowerCase()} event?`}
                      consequence={consequenceOf(
                        "It leaves the order's authored history, which the order tools hand an agent.",
                        findingClauses(eventRemovalFindings(content, entry.id)),
                        "Nothing is written until you save the order.",
                      )}
                      onConfirm={removal.confirm(() => drop(entry.id), notice)}
                      onKeep={removal.keep}
                    />
                  );
                }
                return (
                  <ListItem
                    key={entry.id}
                    name={eventKindLabel(entry.kind)}
                    id={entry.id}
                    detail={`${formatFixtureTimestamp(entry.occurred_at)} · ${entry.summary}`}
                    editing={form.editing === entry.id}
                  >
                    <EditButton
                      name={label}
                      buttonRef={editButtons.ref(entry.id)}
                      onEdit={() => {
                        form.begin(entry.id, orderEventFields(entry));
                        focusAfterCommit(() => kindSelect.current);
                      }}
                    />
                    <RemoveButton
                      name={label}
                      entryKey={entry.id}
                      removal={removal}
                      notice={notice}
                      onRemove={() => drop(entry.id)}
                    />
                  </ListItem>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-admin-muted">No authored history yet.</p>
          )}
          <RemovalNotice removal={removal} />
        </div>
      </FieldGroup>
      <ItemFormRow
        title={formTitle(form.editing, labelOf, EVENT_WORDS.entry)}
        hint="A time left alone keeps the instant it opened on, to the second."
        editing={form.editing !== null}
        addLabel="Add event"
        refusal={refusal}
        reasonId={reasonId}
        onSubmit={submit}
        onCancel={() => {
          const editing = form.editing;
          form.reset();
          if (editing !== null) {
            focusAfterCommit(() => editButtons.get(editing));
          }
        }}
      >
        <FieldHint label="Kind">
          <select
            ref={kindSelect}
            className={`${fieldControlClasses} w-full`}
            value={form.fields.kind}
            onChange={(event) => form.update({ kind: event.target.value as OrderEventKind })}
          >
            {EVENT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {eventKindLabel(kind)}
              </option>
            ))}
          </select>
        </FieldHint>
        <FieldHint label="Occurred at">
          <input
            className={`${fieldControlClasses} w-full`}
            type="datetime-local"
            value={form.fields.occurredAt}
            {...refusedProps(marked, "occurredAt", reasonId)}
            onChange={(event) => form.update({ occurredAt: event.target.value })}
          />
        </FieldHint>
        <div className="col-span-full">
          <FieldHint label="Summary">
            <textarea
              className={`${textAreaClasses} w-full`}
              value={form.fields.summary}
              placeholder="Customer asked by email to change the delivery address."
              {...refusedProps(marked, "summary", reasonId)}
              onChange={(event) => form.update({ summary: event.target.value })}
            />
          </FieldHint>
        </div>
      </ItemFormRow>
    </>
  );
}
