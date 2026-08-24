# ADR 0015 — Order fixtures: shop-scoped authored state, typed transitions, and frozen selections

Status: accepted — 2026-08-24

Implements the first outcome of `docs/PLAN.md` Milestone 2 under ADR 0011, the lifecycle fixed by
ADR 0012, and the payload pattern established by ADR 0013 and generalized by ADR 0014. Records the
`order-fixture-v1` schema, the decision that an order is **not** a versioned definition, the typed
status graph, the selection-only write contract that keeps commerce data out of a client's hands,
and the drift findings that replace ADR 0014's deferred address-deletion check.

## Context

Milestone 2 needs the paid-order/wrong-shipping-address incident to be authorable rather than
hard-coded. That requires order fixtures: typed status transitions, totals derived from line items,
authored order events an agent can discover through tools, and a shipping address selected from the
customer's address book and stored as a frozen, source-labeled copy.

Two questions had to be settled before any code:

1. **Is an order a definition?** ADR 0012 enumerates eight definition types and orders are not among
   them, but the design frames are the stronger evidence: frame 2 shows no version chip and frame 2b
   has `Save`, not `Publish`. The frames call orders "authored fixture state for this shop" and say
   an experiment "snapshots them into each arm's sandbox".
2. **What freezes an order for reproducibility?** If orders stay mutable and nothing pins them, a
   published scenario would silently change when an author edits an order.

## Decision

### An order is shop-scoped authored state, not a definition

Orders have no draft/published pair and no version numbers. They live in `shop_order_fixtures`,
keyed `(shop_id, order_id)`, one canonical document per order, with `reference` and
`customer_profile_id` denormalized into columns so the shop-unique reference can be a constraint and
a shop's orders can be found for one customer. The repository writes those columns from the payload,
so they index the document rather than duplicating its authority.

`customer_profile_id` names a profile and pins no version. Like ADR 0014's shop attachment it is a
relation, not an ADR 0012 reference: what a scenario will freeze is this whole document, not a
version pointer an author would have to keep current.

**Reproducibility comes from freezing, deferred to the slice that needs it.** A published scenario
version will carry a frozen copy of each order fixture it resolves — the "scenario v1 · frozen copy"
of frame 2b — so editing an order after publication changes only future publications. This slice
provides exactly what that requires: a canonical `order-fixture-v1` document and a content
fingerprint, produced by the same serializer every definition payload uses. Nothing in this slice
consumes the fingerprint yet; it is a tested contract waiting for the ticket and scenario editors,
the same way ADR 0014 shipped `telemetry_attributes` ahead of its first caller.

### `order-fixture-v1`

`reference` (a shop-unique business identifier such as `NS-10482`, not a UUID),
`customer_profile_id`, `currency`, `placed_at`, `lines`, `payment`, `fulfilment`,
`shipping_fee_amount`, `shipping_address`, and `events`.

Instants are canonical UTC RFC 3339 with six fractional digits, matching ADR 0007. Calendar dates
stay `YYYY-MM-DD` where a date is what is meant (a customer profile's "customer since"); an order
event happens at a moment, so it carries one. The HTTP layer accepts any RFC 3339 instant **with an
explicit offset** and normalizes it; a naive value is refused rather than assumed to be UTC, because
guessing an offset would give two identical-looking fixtures two fingerprints.

Money reuses the shop's `Currency` and `Money`: an order's money *is* the shop's money, and an
author never types an amount into an order except the shipping fee, which the order guards itself.

**Derived values are never serialized.** `subtotal`, `total`, `item_count`, and each line's total
are computed from the frozen line prices. Storing them would create a second truth that could
disagree with the lines that produced it.

### Two typed status axes, forward-only

Payment moves `pending → authorized → paid → refunded`; fulfilment moves
`unfulfilled → partially_fulfilled → fulfilled`. A fixture is authored after the fact, so an author
may jump several steps forward in one save — the intermediate steps are what the authored events
describe — but never backwards and never off the graph: a refunded order that becomes pending again
is a history no run could produce. Responses carry `payment_status_options` and
`fulfilment_status_options` so the editor offers exactly what the backend would accept, and the
backend refuses an illegal move regardless (`order_transition_error`).

There is deliberately no third, order-level status. The frames show exactly these two axes, and the
index's Open/Unfulfilled/Unpaid filters derive from them.

`ADDRESS_CHANGEABLE_STATUSES` records where the address-change action of the later Milestone 2 slice
will be allowed. It starts here, on the fixture that seeds the run.

### Selection, not typed-in commerce content

The write contract carries **selections**: a line is `{sku, quantity}`, an address is an address-book
entry ID, a method is a shop method ID. The service materializes each into the order — product title,
variant naming, unit price, method name, and the full address copy — and the response returns the
materialized order. There is no field on the wire through which a client could set a price.

An unresolvable selection is a refusal (`order_selection_error`, 422), not a stored value reported
later as a finding: selection is the boundary that keeps commerce data honest, so nothing crosses it
unresolved.

### A frozen copy stays frozen

- **Re-saving with the same address selection keeps the existing frozen copy**, including its
  `selected_at` and the `source_label` as it read at selection time. Only selecting a *different*
  entry freezes a new copy. Refreshing the copy silently would be exactly the rewrite the address
  book promises never to perform.
- **A line already on the order keeps the price it was frozen at.** A new line materializes at the
  catalog's current price.
- **A method already recorded keeps its frozen name** even when the shop stops offering it.

The drift is reported instead of repaired: `line_price_differs_from_catalog`,
`line_variant_without_price`, `payment_method_missing_from_shop`,
`fulfilment_method_missing_from_shop`, and `shipping_address_source_removed` are warnings;
`line_sku_missing_from_catalog` is an error, because a line naming no variant cannot be materialized
into a sandbox at all.

The authoring context therefore carries one map from SKU to *amount or `None`* rather than a set of
SKUs beside a map of prices. A variant that exists but lost its price is real drift with its own
finding; reporting it as missing from the catalog would send the author hunting for a SKU the catalog
plainly still contains.

`shipping_address_source_removed` resolves the open item ADR 0014 left to this slice ("nothing yet
enforces that a deleted entry was not referenced by an order"). Blocking the deletion would
contradict the design direction's explicit promise that deleting an entry never rewrites an order;
the useful truth is that the order is unchanged and can no longer be reselected, which is what the
warning says.

### Findings reuse the definition vocabulary

An order has no publish gate, but it has completeness rules, so it reports the shared
`DefinitionIssue`/`DefinitionValidation` findings on every read and write rather than inventing a
second vocabulary. Errors: no line item, no shipping address, no payment or fulfilment method, a paid
order with no capture time, a line whose SKU left the catalog, and a customer no longer attached to
the shop. Warnings: the five drift findings above, no authored history at all, an event that precedes
the order, and a status the authored history does not explain (a paid order with no
`payment_captured` event). The scenario slice consumes these findings at its own publish gate — which
is why they are computed against the shop and customer as they currently stand, passed in as an
`OrderAuthoringContext` so the rules stay pure.

Validation deliberately does **not** repair anything. An author sees the drift and decides.

### The customer is fixed at creation

`create_order` takes the customer and validates that the profile is attached to the shop;
`replace_order` never changes it. The shipping address is a copy of *that* customer's address book,
so moving an order to another customer would leave frozen provenance pointing at a profile the order
no longer belongs to. Deleting and recreating is the honest path, and an order fixture is cheap.

### Data sensitivity

`FIELD_SENSITIVITY` classifies every leaf of the document, and a test asserts the classification's
key set equals the document's leaf paths, so a newly authored field fails the suite until someone
decides whether it may leave the authoring surface. Catalog-derived content (titles, SKUs, prices) is
`OPERATIONAL` — it is shop configuration, not personal data. The frozen shipping address and the
authored event summaries are `SENSITIVE`. `telemetry_attributes` emits the reference, currency, both
statuses, counts, the derived total, and the shipping country only, and a test asserts no restricted
value appears in it.

`FieldSensitivity`, `RESTRICTED_SENSITIVITIES`, and `unclassified_paths` moved from
`domain/customer_profile.py` to `domain/content.py` in this change, next to the `leaf_paths` helper
they already used. The customer profile's own classification, messages, and tests are unchanged.

### Public contract

Five operations under `/api/v1/shops/{shop_id}/orders`: list, create, read, replace, delete. The
order response schema is named `ShopOrderResponse` because the POC's scenario contract already
publishes an `OrderResponse`; two schemas of one name would make the generator rename both, and one
of them is already published.

The frame's Duplicate action and its operator-notes card are not implemented. Duplication has no
invariant to prove that creation does not, and operator notes are director's-note content whose
sensitivity class belongs with the ticket and scenario surfaces that own that idea. The frame's
ticket and "used by" cards arrive with tickets.

## Verification

- Domain tests (`test_order_domain.py`) cover derived totals, the currency invariant, the reference
  shape, canonical instants, the reachable-status graph in both directions, states that cannot record
  a moment they never reached, every finding, the completeness of the sensitivity classification, and
  the absence of every restricted value from the telemetry attributes.
- Serialization tests (`test_order_payload.py`) prove the document round-trips, is sorted and
  compact, keeps an absent address as an explicit null, never serializes a derived total, changes its
  fingerprint for every behaviourally relevant edit including line reordering, and reports the failing
  path for a drifted or foreign-schema document.
- Service and repository tests (`test_orders.py`) prove a new order starts incomplete, an order can
  only be created for an attached customer, a reference names one order per shop — at the service
  check and again at the storage boundary that backs it — lines and addresses are materialized from
  the catalog and the address book, an unresolvable selection is refused, editing the address book,
  repricing the catalog, or unpricing a variant never rewrites an existing order, reselecting a
  different entry freezes a new copy, a status cannot move backwards, events are stored
  chronologically, an order survives a new session, and orders are scoped to their shop.
- Contract tests (`test_order_api.py`) prove the response carries derived totals and the frozen
  address, a client cannot send a line price, selection and transition refusals answer their own
  codes, a naive timestamp is refused by the schema, a duplicate reference is a 409, an unknown shop
  and an unknown order answer their own 404s, and removing the source address warns without moving
  the order.
- Migration tests cover the new table on a clean and an existing database and the shop-unique
  reference constraint at the SQL level.
- Frontend tests cover the index with its two status axes and filters, order creation, the frozen
  address card with its source label and default mismatch, the status options the backend allows, the
  totals that follow a quantity before the save round trip, a quantity the contract could not carry
  never reaching the order, a save that carries selections and no prices, the reselection notice,
  findings rendered without repair, adding a line from the catalog, both paths through the delete
  confirmation, and a refused save that stays visible. `lib/orders.ts` has its own unit tests for the
  selection projection, the preview arithmetic, quantity clamping, and instant conversion.
- One Playwright journey builds the wrong-address fixture end to end and proves the frozen copy
  survives an edit to the address-book entry it came from.

## Consequences

- The ticket slice links a ticket to an order in the same shop; the scenario slice freezes the order
  document into the published scenario version and gates publication on these findings.
- The sandbox slice materializes orders into an `orders` section of the sandbox envelope under a new
  canonical schema version, as ADR 0012 requires of every materialized-state section.
- `PUT /shops/{shop_id}/orders/{order_id}` is last-write-wins, inheriting ADR 0013's decision and its
  caveat; the first slice with a real concurrent-authoring requirement should add an
  expected-`updated_at` precondition across all resources at once.
- Existing local databases keep working: the migration only adds a table. Developers running a server
  before this change must run `make migrate` for the new endpoints to work.
- The order editor computes the totals it displays while editing, from the frozen prices already on
  screen, so a quantity change is visible without a round trip. Every save replaces them with the
  lab's own figures, which stay authoritative. The editor holds only values the contract accepts —
  a quantity is clamped to 1–999 whole units and an unreadable shipping fee contributes nothing to
  the preview — so the totals on screen always describe an order the lab would take.
- Deleting an order fixture is irreversible and this ADR's "delete and recreate" is a normal
  workflow, so the editor's Delete asks for a second click. It is the Studio's first destructive
  control; a later slice that adds more should follow the same shape.
