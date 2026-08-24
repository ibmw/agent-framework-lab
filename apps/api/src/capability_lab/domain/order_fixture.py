"""Typed authored order fixtures: line items, typed status axes, and frozen provenance.

An order is **not** a versioned definition (ADR 0012 fixes the eight definition types).
It is authored fixture state owned by one shop: the Studio edits it, an experiment
snapshots it into each arm's sandbox, and a live run mutates only its own clone.

Two rules shape the model, and both exist so that editing one resource can never silently
rewrite another:

- **Nothing here is free-typed that could be selected.** The shipping address is chosen
  from the customer's address book and the line items from the shop's catalog; the service
  materializes both into frozen, source-labeled copies.
- **A frozen copy stays frozen.** Editing or removing the source address-book entry, or
  repricing the catalog variant, never rewrites an existing order. The mismatch is
  reported as a finding instead, so the author sees the drift and decides.

Statuses move along a typed graph rather than being set arbitrarily, so an authored
fixture always describes a history a real order could have had.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from functools import partial
from uuid import UUID

from capability_lab.domain.content import (
    FieldSensitivity,
    require_business_reference,
    require_country_code,
    require_instance,
    require_integer_in_range,
    require_label,
    require_slug,
    require_text,
    require_unique,
    require_utc_timestamp,
)
from capability_lab.domain.content import (
    unclassified_paths as unclassified_document_paths,
)
from capability_lab.domain.definitions import (
    DefinitionIssue,
    DefinitionValidation,
    issue_error,
    issue_warning,
    validation_of,
)
from capability_lab.domain.entities import DomainError
from capability_lab.domain.shop import Currency, Money

MAX_ORDER_LINES = 40
MAX_ORDER_EVENTS = 40
MAX_LINE_QUANTITY = 999


class OrderFixtureConfigurationError(DomainError):
    """Raised when order content violates a structural invariant."""


class OrderTransitionError(OrderFixtureConfigurationError):
    """Raised when a requested status is not reachable from the recorded one."""


_error_type = OrderFixtureConfigurationError
_require_slug = partial(require_slug, error=_error_type)
_require_label = partial(require_label, error=_error_type)
_require_text = partial(require_text, error=_error_type)
_require_unique = partial(require_unique, error=_error_type)
_require_instance = partial(require_instance, error=_error_type)
_require_integer_in_range = partial(require_integer_in_range, error=_error_type)
_require_country_code = partial(require_country_code, error=_error_type)
_require_utc_timestamp = partial(require_utc_timestamp, error=_error_type)
_require_business_reference = partial(require_business_reference, error=_error_type)


class PaymentStatus(StrEnum):
    PENDING = "pending"
    AUTHORIZED = "authorized"
    PAID = "paid"
    REFUNDED = "refunded"


class FulfilmentStatus(StrEnum):
    UNFULFILLED = "unfulfilled"
    PARTIALLY_FULFILLED = "partially_fulfilled"
    FULFILLED = "fulfilled"


# The single steps a real order takes. An author may jump several steps forward at once
# (see `reachable_statuses`) because a fixture is authored after the fact, but never
# backwards and never off the graph: a refunded order that becomes pending again would be
# a history no run could produce.
PAYMENT_TRANSITIONS: dict[PaymentStatus, frozenset[PaymentStatus]] = {
    PaymentStatus.PENDING: frozenset({PaymentStatus.AUTHORIZED}),
    PaymentStatus.AUTHORIZED: frozenset({PaymentStatus.PAID}),
    PaymentStatus.PAID: frozenset({PaymentStatus.REFUNDED}),
    PaymentStatus.REFUNDED: frozenset(),
}

FULFILMENT_TRANSITIONS: dict[FulfilmentStatus, frozenset[FulfilmentStatus]] = {
    FulfilmentStatus.UNFULFILLED: frozenset(
        {FulfilmentStatus.PARTIALLY_FULFILLED, FulfilmentStatus.FULFILLED}
    ),
    FulfilmentStatus.PARTIALLY_FULFILLED: frozenset({FulfilmentStatus.FULFILLED}),
    FulfilmentStatus.FULFILLED: frozenset(),
}

# Fulfilment states in which a shipping address may still be changed. The backend rule the
# address-change action enforces in a run starts here, on the fixture that seeds it.
ADDRESS_CHANGEABLE_STATUSES: frozenset[FulfilmentStatus] = frozenset(
    {FulfilmentStatus.UNFULFILLED, FulfilmentStatus.PARTIALLY_FULFILLED}
)


def reachable_statuses[StatusT: StrEnum](
    current: StatusT, transitions: dict[StatusT, frozenset[StatusT]]
) -> tuple[StatusT, ...]:
    """`current` plus every status reachable from it, in declaration order.

    An author records a paid order in one save rather than walking three intermediate
    states; the intermediate steps are what the authored events describe.
    """
    reached: set[StatusT] = set()
    frontier = [current]
    while frontier:
        status = frontier.pop()
        for candidate in transitions[status]:
            if candidate not in reached:
                reached.add(candidate)
                frontier.append(candidate)
    return tuple(status for status in type(current) if status is current or status in reached)


def require_reachable_status[StatusT: StrEnum](
    current: StatusT,
    requested: StatusT,
    transitions: dict[StatusT, frozenset[StatusT]],
    field_name: str,
) -> StatusT:
    if requested not in reachable_statuses(current, transitions):
        raise OrderTransitionError(
            f"{field_name} cannot move from {current.value} to {requested.value}"
        )
    return requested


class OrderEventKind(StrEnum):
    """What an authored history entry records. Agents discover these through tools."""

    PLACED = "placed"
    PAYMENT_AUTHORIZED = "payment_authorized"
    PAYMENT_CAPTURED = "payment_captured"
    PAYMENT_REFUNDED = "payment_refunded"
    SHIPPED = "shipped"
    DELIVERED = "delivered"
    ADDRESS_UPDATED = "address_updated"
    SUPPORT_CONTACT = "support_contact"


# The event kind each terminal payment/fulfilment state expects in the authored history,
# so a state the agent can read is also a state it can explain.
PAYMENT_EVIDENCE: dict[PaymentStatus, OrderEventKind] = {
    PaymentStatus.AUTHORIZED: OrderEventKind.PAYMENT_AUTHORIZED,
    PaymentStatus.PAID: OrderEventKind.PAYMENT_CAPTURED,
    PaymentStatus.REFUNDED: OrderEventKind.PAYMENT_REFUNDED,
}

FULFILMENT_EVIDENCE: dict[FulfilmentStatus, OrderEventKind] = {
    FulfilmentStatus.PARTIALLY_FULFILLED: OrderEventKind.SHIPPED,
    FulfilmentStatus.FULFILLED: OrderEventKind.SHIPPED,
}


def require_order_reference(value: object, field_name: str) -> str:
    """A shop-unique business reference such as `NS-10482`, not a UUID."""
    return _require_business_reference(value, field_name)


@dataclass(frozen=True, slots=True)
class OrderLine:
    """One purchased variant, frozen at the moment it was added to the order.

    `title`, `variant_summary`, and `unit_price` are copies of catalog content rather than
    live lookups: an order's totals must not change when the shop draft is repriced.
    """

    id: str
    sku: str
    product_handle: str
    title: str
    variant_summary: str
    unit_price: Money
    quantity: int

    def __post_init__(self) -> None:
        _require_slug(self.id, "order line ID")
        _require_label(self.sku, "order line SKU")
        _require_slug(self.product_handle, "order line product handle")
        _require_label(self.title, "order line title")
        _require_text(self.variant_summary, "order line variant summary", allow_empty=True)
        _require_instance(self.unit_price, Money, "order line unit price must be money")
        _require_integer_in_range(self.quantity, 1, MAX_LINE_QUANTITY, "order line quantity")

    @property
    def line_total(self) -> Money:
        return Money(
            amount=self.unit_price.amount * self.quantity, currency=self.unit_price.currency
        )

    @property
    def display_name(self) -> str:
        return self.title if not self.variant_summary else f"{self.title} · {self.variant_summary}"


@dataclass(frozen=True, slots=True)
class FrozenShippingAddress:
    """The address-book entry an order selected, copied and labeled with its source.

    Orders never take a free-input address (ADR 0012). Because this is a copy, editing or
    deleting `source_address_id` in the profile leaves the order exactly as it was;
    reselecting is the only way to change where an order ships.
    """

    source_address_id: str
    source_label: str
    selected_at: str
    recipient: str
    line1: str
    postal_code: str
    city: str
    country: str
    line2: str | None = None
    region: str | None = None

    def __post_init__(self) -> None:
        _require_slug(self.source_address_id, "shipping address source ID")
        _require_label(self.source_label, "shipping address source label")
        _require_utc_timestamp(self.selected_at, "shipping address selection time")
        _require_label(self.recipient, "shipping address recipient")
        _require_label(self.line1, "shipping address line 1")
        _require_label(self.postal_code, "shipping address postal code")
        _require_label(self.city, "shipping address city")
        _require_country_code(self.country, "shipping address country")
        if self.line2 is not None:
            _require_label(self.line2, "shipping address line 2")
        if self.region is not None:
            _require_label(self.region, "shipping address region")

    @property
    def single_line(self) -> str:
        parts = (self.recipient, self.line1, self.line2, f"{self.postal_code} {self.city}")
        return " · ".join(part for part in parts if part)


@dataclass(frozen=True, slots=True)
class PaymentState:
    """Where the money is, plus the shop payment method the order was placed with."""

    status: PaymentStatus
    method_id: str | None = None
    method_name: str | None = None
    paid_at: str | None = None

    def __post_init__(self) -> None:
        _require_instance(self.status, PaymentStatus, "payment status must be a supported status")
        if (self.method_id is None) != (self.method_name is None):
            raise OrderFixtureConfigurationError(
                "a payment method must carry both its identifier and its name"
            )
        if self.method_id is not None:
            _require_slug(self.method_id, "payment method ID")
        if self.method_name is not None:
            _require_label(self.method_name, "payment method name")
        if self.paid_at is not None:
            _require_utc_timestamp(self.paid_at, "payment capture time")
        if self.paid_at is not None and self.status in {
            PaymentStatus.PENDING,
            PaymentStatus.AUTHORIZED,
        }:
            raise OrderFixtureConfigurationError(
                "an order that has not been captured cannot record a capture time"
            )


@dataclass(frozen=True, slots=True)
class FulfilmentState:
    """How far the goods got, plus the shop fulfilment method carrying them."""

    status: FulfilmentStatus
    method_id: str | None = None
    method_name: str | None = None
    shipped_at: str | None = None

    def __post_init__(self) -> None:
        _require_instance(
            self.status, FulfilmentStatus, "fulfilment status must be a supported status"
        )
        if (self.method_id is None) != (self.method_name is None):
            raise OrderFixtureConfigurationError(
                "a fulfilment method must carry both its identifier and its name"
            )
        if self.method_id is not None:
            _require_slug(self.method_id, "fulfilment method ID")
        if self.method_name is not None:
            _require_label(self.method_name, "fulfilment method name")
        if self.shipped_at is not None:
            _require_utc_timestamp(self.shipped_at, "fulfilment shipping time")
        if self.shipped_at is not None and self.status is FulfilmentStatus.UNFULFILLED:
            raise OrderFixtureConfigurationError(
                "an unfulfilled order cannot record a shipping time"
            )

    @property
    def allows_address_change(self) -> bool:
        return self.status in ADDRESS_CHANGEABLE_STATUSES


@dataclass(frozen=True, slots=True)
class OrderEvent:
    """One authored history entry. This is what `get_order` history exposes to an agent."""

    id: str
    kind: OrderEventKind
    occurred_at: str
    summary: str

    def __post_init__(self) -> None:
        _require_slug(self.id, "order event ID")
        _require_instance(self.kind, OrderEventKind, "order event kind must be a supported kind")
        _require_utc_timestamp(self.occurred_at, "order event time")
        _require_text(self.summary, "order event summary")


@dataclass(frozen=True, slots=True)
class OrderFixturePayload:
    """The complete authored content of one order fixture.

    `customer_profile_id` names a profile; it pins no version. Like the shop attachment of
    ADR 0014 it is a relation, not an ADR 0012 reference: what a scenario freezes is this
    whole document, not a version pointer the author would have to keep current.
    """

    reference: str
    customer_profile_id: UUID
    currency: Currency
    placed_at: str
    lines: tuple[OrderLine, ...] = ()
    payment: PaymentState = PaymentState(status=PaymentStatus.PENDING)
    fulfilment: FulfilmentState = FulfilmentState(status=FulfilmentStatus.UNFULFILLED)
    shipping_fee: Money | None = None
    shipping_address: FrozenShippingAddress | None = None
    events: tuple[OrderEvent, ...] = ()

    def __post_init__(self) -> None:
        require_order_reference(self.reference, "order reference")
        _require_instance(self.customer_profile_id, UUID, "an order must name its customer profile")
        _require_instance(self.currency, Currency, "order currency must be a supported currency")
        _require_utc_timestamp(self.placed_at, "order placement time")
        _require_instance(self.payment, PaymentState, "an order must declare its payment state")
        _require_instance(
            self.fulfilment, FulfilmentState, "an order must declare its fulfilment state"
        )
        if len(self.lines) > MAX_ORDER_LINES:
            raise OrderFixtureConfigurationError(
                f"an order can carry at most {MAX_ORDER_LINES} line items"
            )
        if len(self.events) > MAX_ORDER_EVENTS:
            raise OrderFixtureConfigurationError(
                f"an order can carry at most {MAX_ORDER_EVENTS} events"
            )
        _require_unique(tuple(line.id for line in self.lines), "order line IDs")
        _require_unique(tuple(line.sku for line in self.lines), "order line SKUs")
        _require_unique(tuple(event.id for event in self.events), "order event IDs")
        for line in self.lines:
            if line.unit_price.currency is not self.currency:
                raise OrderFixtureConfigurationError(
                    f"order line {line.sku} is priced in {line.unit_price.currency.value} "
                    f"but the order is in {self.currency.value}"
                )
        if self.shipping_fee is not None and self.shipping_fee.currency is not self.currency:
            raise OrderFixtureConfigurationError("the shipping fee must use the order's currency")
        if self.shipping_address is not None:
            _require_instance(
                self.shipping_address,
                FrozenShippingAddress,
                "a shipping address must be a frozen copy of an address-book entry",
            )

    @property
    def subtotal(self) -> Money:
        """Derived from the line items; never authored directly."""
        total = sum((line.line_total.amount for line in self.lines), Decimal("0.00"))
        return Money(amount=total, currency=self.currency)

    @property
    def shipping_amount(self) -> Money:
        return (
            Money(amount=Decimal("0.00"), currency=self.currency)
            if self.shipping_fee is None
            else self.shipping_fee
        )

    @property
    def total(self) -> Money:
        return Money(
            amount=self.subtotal.amount + self.shipping_amount.amount, currency=self.currency
        )

    @property
    def item_count(self) -> int:
        return sum(line.quantity for line in self.lines)

    def has_event(self, kind: OrderEventKind) -> bool:
        return any(event.kind is kind for event in self.events)


# Every leaf of the `order-fixture-v1` document, so a newly authored field cannot arrive
# without a decision about whether it may reach a log line or a span. `[]` stands for a
# list index. Catalog-derived content is operational: it is shop configuration, not
# personal data. The frozen shipping address is the personal data an order holds.
FIELD_SENSITIVITY: dict[str, FieldSensitivity] = {
    "canonical_schema_version": FieldSensitivity.OPERATIONAL,
    "reference": FieldSensitivity.OPERATIONAL,
    "customer_profile_id": FieldSensitivity.OPERATIONAL,
    "currency": FieldSensitivity.OPERATIONAL,
    "placed_at": FieldSensitivity.OPERATIONAL,
    "lines[].id": FieldSensitivity.OPERATIONAL,
    "lines[].sku": FieldSensitivity.OPERATIONAL,
    "lines[].product_handle": FieldSensitivity.OPERATIONAL,
    "lines[].title": FieldSensitivity.OPERATIONAL,
    "lines[].variant_summary": FieldSensitivity.OPERATIONAL,
    "lines[].unit_amount": FieldSensitivity.OPERATIONAL,
    "lines[].quantity": FieldSensitivity.OPERATIONAL,
    "payment.status": FieldSensitivity.OPERATIONAL,
    "payment.method_id": FieldSensitivity.OPERATIONAL,
    "payment.method_name": FieldSensitivity.OPERATIONAL,
    "payment.paid_at": FieldSensitivity.OPERATIONAL,
    "fulfilment.status": FieldSensitivity.OPERATIONAL,
    "fulfilment.method_id": FieldSensitivity.OPERATIONAL,
    "fulfilment.method_name": FieldSensitivity.OPERATIONAL,
    "fulfilment.shipped_at": FieldSensitivity.OPERATIONAL,
    "shipping_fee_amount": FieldSensitivity.OPERATIONAL,
    "shipping_address.source_address_id": FieldSensitivity.OPERATIONAL,
    "shipping_address.source_label": FieldSensitivity.SENSITIVE,
    "shipping_address.selected_at": FieldSensitivity.OPERATIONAL,
    "shipping_address.recipient": FieldSensitivity.SENSITIVE,
    "shipping_address.line1": FieldSensitivity.SENSITIVE,
    "shipping_address.line2": FieldSensitivity.SENSITIVE,
    "shipping_address.postal_code": FieldSensitivity.SENSITIVE,
    "shipping_address.city": FieldSensitivity.SENSITIVE,
    "shipping_address.region": FieldSensitivity.SENSITIVE,
    "shipping_address.country": FieldSensitivity.OPERATIONAL,
    "events[].id": FieldSensitivity.OPERATIONAL,
    "events[].kind": FieldSensitivity.OPERATIONAL,
    "events[].occurred_at": FieldSensitivity.OPERATIONAL,
    # An authored history line is free text about one customer's incident.
    "events[].summary": FieldSensitivity.SENSITIVE,
}


def unclassified_paths(document: object) -> frozenset[str]:
    """Document leaves with no sensitivity decision; empty for a complete payload."""
    return unclassified_document_paths(document, FIELD_SENSITIVITY)


def restricted_values(payload: OrderFixturePayload) -> tuple[str, ...]:
    """Every authored value that must never reach a log line, span, or error message."""
    values: list[str] = [event.summary for event in payload.events]
    address = payload.shipping_address
    if address is not None:
        values.extend(
            [
                address.source_label,
                address.recipient,
                address.line1,
                address.postal_code,
                address.city,
            ]
        )
        values.extend(part for part in (address.line2, address.region) if part is not None)
    # An unset optional field has nothing to disclose, and an empty needle would match
    # every haystack in the tests that assert absence.
    return tuple(value for value in values if value)


def telemetry_attributes(payload: OrderFixturePayload) -> dict[str, str | int | bool]:
    """The only order attributes the lab may attach to a span or a log line.

    Everything here is an `OPERATIONAL` field, a count, or a derived total, so a trace can
    describe an order — including the amount a run may not alter — without disclosing who
    it ships to.
    """
    return {
        "lab.order.reference": payload.reference,
        "lab.order.currency": payload.currency.value,
        "lab.order.payment_status": payload.payment.status.value,
        "lab.order.fulfilment_status": payload.fulfilment.status.value,
        "lab.order.line_count": len(payload.lines),
        "lab.order.item_count": payload.item_count,
        "lab.order.total_amount": payload.total.canonical_amount,
        "lab.order.has_shipping_address": payload.shipping_address is not None,
        "lab.order.shipping_country": (
            "" if payload.shipping_address is None else payload.shipping_address.country
        ),
        "lab.order.event_count": len(payload.events),
    }


@dataclass(frozen=True, slots=True)
class OrderAuthoringContext:
    """What the order's shop and customer currently offer, for drift-aware validation.

    Passed in rather than looked up so the rules stay pure: the same order is complete or
    incomplete purely as a function of the content around it.
    """

    customer_attached: bool = True
    address_book_ids: frozenset[str] = frozenset()
    # SKU to its current catalog amount, or None when the variant carries no price. One map
    # rather than a set plus a map, so "which SKUs exist" and "what they cost" cannot drift
    # apart and report a present variant as missing.
    catalog_prices: dict[str, str | None] | None = None
    payment_method_ids: frozenset[str] = frozenset()
    fulfilment_method_ids: frozenset[str] = frozenset()

    @property
    def catalog(self) -> dict[str, str | None]:
        return {} if self.catalog_prices is None else self.catalog_prices


def validate_order_fixture(
    payload: OrderFixturePayload, context: OrderAuthoringContext
) -> DefinitionValidation:
    """Report every finding for one order fixture.

    Errors mark an order that cannot seed a coherent sandbox; warnings mark drift the
    author should see but that the frozen-copy rule deliberately does not repair.
    """
    issues: list[DefinitionIssue] = []

    if not context.customer_attached:
        issues.append(
            issue_error(
                "customer_not_attached_to_shop",
                "the order's customer profile is not attached to this shop, "
                "so the order's history belongs to a customer the shop does not have",
                "customer_profile_id",
            )
        )

    if not payload.lines:
        issues.append(
            issue_error(
                "order_without_line",
                "an order must carry at least one line item, because its totals are derived "
                "from them",
                "lines",
            )
        )

    for line in payload.lines:
        if line.sku not in context.catalog:
            issues.append(
                issue_error(
                    "line_sku_missing_from_catalog",
                    f"line item {line.sku} no longer names a variant in this shop's catalog",
                    "lines",
                )
            )
            continue
        catalog_amount = context.catalog[line.sku]
        if catalog_amount is None:
            # The variant is still there; only its price is gone. The order keeps what it
            # froze, so this is drift to see rather than a line that cannot be materialized.
            issues.append(
                issue_warning(
                    "line_variant_without_price",
                    f"the catalog no longer prices variant {line.sku}; the order keeps the "
                    f"{line.unit_price.canonical_amount} it froze",
                    "lines",
                )
            )
        elif catalog_amount != line.unit_price.canonical_amount:
            issues.append(
                issue_warning(
                    "line_price_differs_from_catalog",
                    f"line item {line.sku} was frozen at {line.unit_price.canonical_amount} "
                    f"and the catalog now prices it at {catalog_amount}; the order keeps "
                    "what it froze",
                    "lines",
                )
            )

    if payload.payment.method_id is None:
        issues.append(
            issue_error(
                "payment_without_method",
                "an order must record how it was paid",
                "payment.method_id",
            )
        )
    elif payload.payment.method_id not in context.payment_method_ids:
        issues.append(
            issue_warning(
                "payment_method_missing_from_shop",
                "the order's payment method is no longer configured by this shop",
                "payment.method_id",
            )
        )

    if payload.fulfilment.method_id is None:
        issues.append(
            issue_error(
                "fulfilment_without_method",
                "an order must record how it ships",
                "fulfilment.method_id",
            )
        )
    elif payload.fulfilment.method_id not in context.fulfilment_method_ids:
        issues.append(
            issue_warning(
                "fulfilment_method_missing_from_shop",
                "the order's fulfilment method is no longer configured by this shop",
                "fulfilment.method_id",
            )
        )

    if payload.payment.status is PaymentStatus.PAID and payload.payment.paid_at is None:
        issues.append(
            issue_error(
                "paid_order_without_capture_time",
                "a paid order must record when the payment was captured",
                "payment.paid_at",
            )
        )

    address = payload.shipping_address
    if address is None:
        issues.append(
            issue_error(
                "order_without_shipping_address",
                "an order must ship somewhere; select an entry from the customer's address book",
                "shipping_address",
            )
        )
    elif address.source_address_id not in context.address_book_ids:
        issues.append(
            issue_warning(
                "shipping_address_source_removed",
                "the address-book entry this order was shipped to no longer exists; the frozen "
                "copy is unchanged, but reselecting it is no longer possible",
                "shipping_address.source_address_id",
            )
        )

    for event in payload.events:
        if event.occurred_at < payload.placed_at:
            issues.append(
                issue_warning(
                    "event_precedes_placement",
                    f"event {event.id} happens before the order was placed",
                    "events",
                )
            )

    if not payload.events:
        issues.append(
            issue_warning(
                "order_without_event",
                "the order has no authored history for an agent to discover through tools",
                "events",
            )
        )
    else:
        expected_payment = PAYMENT_EVIDENCE.get(payload.payment.status)
        if expected_payment is not None and not payload.has_event(expected_payment):
            issues.append(
                issue_warning(
                    "payment_status_without_event",
                    f"the order is {payload.payment.status.value} but its history records no "
                    f"{expected_payment.value} event to explain it",
                    "events",
                )
            )
        expected_fulfilment = FULFILMENT_EVIDENCE.get(payload.fulfilment.status)
        if expected_fulfilment is not None and not payload.has_event(expected_fulfilment):
            issues.append(
                issue_warning(
                    "fulfilment_status_without_event",
                    f"the order is {payload.fulfilment.status.value} but its history records no "
                    f"{expected_fulfilment.value} event to explain it",
                    "events",
                )
            )

    return validation_of(issues)
