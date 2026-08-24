"""Authoring shop-scoped order fixtures.

An order is authored state, not a definition: it has no draft/published pair, so this
service owns its own small lifecycle instead of extending `definition_authoring`. What it
does share is the discipline around it — a canonical document, a content fingerprint, and
the shared finding vocabulary — because the scenario slice freezes a copy of an order and
gates its own publication on these findings.

The service is also where "select, never type" is enforced. Line items are materialized
from the shop's catalog and the shipping address from the customer's address book, and a
value once frozen is never re-resolved: repricing a variant or editing an address-book
entry leaves every existing order exactly as it was.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from decimal import Decimal
from typing import Protocol
from uuid import UUID, uuid4

from capability_lab.application.canonical_json import canonical_timestamp
from capability_lab.application.customer_profiles import (
    CustomerProfileNotFoundError,
    customer_profile_definition_id,
)
from capability_lab.application.definition_authoring import DefinitionRepository
from capability_lab.application.definition_resolution import DefinitionResolutionError
from capability_lab.application.order_fixture_payload import order_fixture_content_fingerprint
from capability_lab.application.ports import Clock
from capability_lab.application.shops import ShopNotFoundError
from capability_lab.domain.customer_profile import AddressEntry, CustomerProfilePayload
from capability_lab.domain.definitions import (
    DefinitionId,
    DefinitionType,
    DefinitionValidation,
)
from capability_lab.domain.order_fixture import (
    FULFILMENT_TRANSITIONS,
    PAYMENT_TRANSITIONS,
    FrozenShippingAddress,
    FulfilmentState,
    FulfilmentStatus,
    OrderAuthoringContext,
    OrderEvent,
    OrderEventKind,
    OrderFixturePayload,
    OrderLine,
    PaymentState,
    PaymentStatus,
    require_reachable_status,
    validate_order_fixture,
)
from capability_lab.domain.shop import Currency, Money, Product, ProductVariant, ShopPayload


class OrderFixtureNotFoundError(DefinitionResolutionError):
    """Raised when a shop has no order with the requested identifier."""


class OrderReferenceExistsError(DefinitionResolutionError):
    """Raised when another order in the same shop already uses that reference."""


class OrderSelectionError(DefinitionResolutionError):
    """Raised when an order selects catalog, method, or address content that does not exist.

    Selection is the boundary that keeps an order free of typed-in commerce data, so a
    selection that cannot be resolved is a refusal rather than a finding.
    """


@dataclass(frozen=True, slots=True)
class OrderFixtureRecord:
    """One authored order and the shop that owns it."""

    shop_id: UUID
    order_id: UUID
    payload: OrderFixturePayload
    created_at: datetime
    updated_at: datetime

    @property
    def content_fingerprint(self) -> str:
        return order_fixture_content_fingerprint(self.payload)


@dataclass(frozen=True, slots=True)
class OrderFixtureSummary:
    """One row of the Studio's order index."""

    order_id: UUID
    reference: str
    customer_profile_id: UUID
    customer_display_name: str
    placed_at: str
    payment_status: PaymentStatus
    fulfilment_status: FulfilmentStatus
    line_count: int
    total_amount: str
    currency: Currency
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class OrderLineSelection:
    """A catalog variant and how many of it. The price is never part of the request."""

    sku: str
    quantity: int


@dataclass(frozen=True, slots=True)
class OrderEventDraft:
    """An authored history entry, identified by the caller so edits stay stable."""

    id: str
    kind: str
    occurred_at: str
    summary: str


@dataclass(frozen=True, slots=True)
class OrderEdit:
    """The whole authored order, expressed as selections rather than materialized content."""

    reference: str
    placed_at: str
    lines: tuple[OrderLineSelection, ...]
    payment_status: PaymentStatus
    payment_method_id: str | None
    paid_at: str | None
    fulfilment_status: FulfilmentStatus
    fulfilment_method_id: str | None
    shipped_at: str | None
    shipping_fee_amount: str
    shipping_address_id: str | None
    events: tuple[OrderEventDraft, ...]


class OrderFixtureRepository(Protocol):
    """Persistence port for one shop's authored orders."""

    def list_for_shop(self, shop_id: UUID) -> tuple[OrderFixtureRecord, ...]: ...

    def get(self, shop_id: UUID, order_id: UUID) -> OrderFixtureRecord | None: ...

    def reference_owner(self, shop_id: UUID, reference: str) -> UUID | None:
        """The order holding this reference in this shop, if any."""
        ...

    def save(self, record: OrderFixtureRecord) -> None: ...

    def delete(self, shop_id: UUID, order_id: UUID) -> bool: ...


def _variant_summary(product: Product, variant: ProductVariant) -> str:
    """Name a variant the way the catalog orders its options: "Ocean Blue · M"."""
    values = dict(variant.option_values)
    ordered = [values.pop(option.key) for option in product.options if option.key in values]
    # A value whose option the product never declared still names the variant.
    ordered.extend(value for key, value in variant.option_values if key in values)
    return " · ".join(ordered)


@dataclass(frozen=True, slots=True)
class _CatalogVariant:
    product: Product
    variant: ProductVariant

    @property
    def price(self) -> Money | None:
        return self.variant.price


def _catalog(shop: ShopPayload) -> dict[str, _CatalogVariant]:
    return {
        variant.sku: _CatalogVariant(product=product, variant=variant)
        for product in shop.products
        for variant in product.variants
    }


class ShopAttachmentDirectory(Protocol):
    """Whether a shop-independent definition is attached to a shop (ADR 0014)."""

    def is_attached(self, definition: DefinitionId, shop_id: UUID) -> bool: ...


class OrderFixtureService:
    """Create, edit, and remove the authored orders of one shop."""

    def __init__(
        self,
        orders: OrderFixtureRepository,
        shops: DefinitionRepository[ShopPayload],
        profiles: DefinitionRepository[CustomerProfilePayload],
        attached_profiles: ShopAttachmentDirectory,
        clock: Clock,
    ) -> None:
        self._orders = orders
        self._shops = shops
        self._profiles = profiles
        self._attached = attached_profiles
        self._clock = clock

    # -- reading ---------------------------------------------------------------

    def list_orders(self, shop_id: UUID) -> tuple[OrderFixtureSummary, ...]:
        self._require_shop(shop_id)
        names = {
            listing.definition_id: listing.payload.identity.display_name
            for listing in self._profiles.list_definitions()
        }
        return tuple(
            OrderFixtureSummary(
                order_id=record.order_id,
                reference=record.payload.reference,
                customer_profile_id=record.payload.customer_profile_id,
                customer_display_name=names.get(
                    record.payload.customer_profile_id, "Unknown customer"
                ),
                placed_at=record.payload.placed_at,
                payment_status=record.payload.payment.status,
                fulfilment_status=record.payload.fulfilment.status,
                line_count=len(record.payload.lines),
                total_amount=record.payload.total.canonical_amount,
                currency=record.payload.currency,
                updated_at=record.updated_at,
            )
            for record in self._orders.list_for_shop(shop_id)
        )

    def get_order(self, shop_id: UUID, order_id: UUID) -> OrderFixtureRecord:
        record = self._orders.get(shop_id, order_id)
        if record is None:
            self._require_shop(shop_id)
            raise OrderFixtureNotFoundError(f"shop {shop_id} has no order {order_id}")
        return record

    def validate_order(self, shop_id: UUID, payload: OrderFixturePayload) -> DefinitionValidation:
        """Report the order's findings against the shop and customer as they are now."""
        shop = self._require_shop(shop_id)
        profile = self._profile(payload.customer_profile_id)
        return validate_order_fixture(
            payload,
            OrderAuthoringContext(
                customer_attached=self._attached.is_attached(
                    customer_profile_definition_id(payload.customer_profile_id), shop_id
                ),
                address_book_ids=frozenset(entry.id for entry in profile.addresses),
                catalog_prices={
                    sku: None if entry.price is None else entry.price.canonical_amount
                    for sku, entry in _catalog(shop).items()
                },
                payment_method_ids=frozenset(method.id for method in shop.payment_methods),
                fulfilment_method_ids=frozenset(method.id for method in shop.fulfilment_methods),
            ),
        )

    # -- writing ---------------------------------------------------------------

    def create_order(
        self, shop_id: UUID, reference: str, customer_profile_id: UUID, placed_at: str
    ) -> OrderFixtureRecord:
        """Create the deliberately incomplete order: a reference, a customer, and a date."""
        shop = self._require_shop(shop_id)
        self._require_attached_profile(shop_id, customer_profile_id)
        self._require_free_reference(shop_id, reference, order_id=None)
        now = self._clock.now()
        record = OrderFixtureRecord(
            shop_id=shop_id,
            order_id=uuid4(),
            payload=OrderFixturePayload(
                reference=reference,
                customer_profile_id=customer_profile_id,
                currency=shop.identity.default_currency,
                placed_at=placed_at,
            ),
            created_at=now,
            updated_at=now,
        )
        self._orders.save(record)
        return record

    def replace_order(self, shop_id: UUID, order_id: UUID, edit: OrderEdit) -> OrderFixtureRecord:
        """Replace the whole order from selections, keeping every frozen copy frozen.

        The customer is deliberately not editable: the shipping address is a copy of *that*
        customer's address book, so moving an order to another customer would leave frozen
        provenance pointing at a profile the order no longer belongs to. Delete and recreate
        instead.
        """
        existing = self.get_order(shop_id, order_id)
        shop = self._require_shop(shop_id)
        self._require_free_reference(shop_id, edit.reference, order_id=order_id)
        previous = existing.payload
        payload = OrderFixturePayload(
            reference=edit.reference,
            customer_profile_id=previous.customer_profile_id,
            currency=previous.currency,
            placed_at=edit.placed_at,
            lines=self._materialize_lines(shop, previous, edit.lines),
            payment=self._materialize_payment(shop, previous, edit),
            fulfilment=self._materialize_fulfilment(shop, previous, edit),
            shipping_fee=self._materialize_fee(previous, edit.shipping_fee_amount),
            shipping_address=self._materialize_address(previous, edit.shipping_address_id),
            events=self._materialize_events(edit.events),
        )
        record = replace(existing, payload=payload, updated_at=self._clock.now())
        self._orders.save(record)
        return record

    def delete_order(self, shop_id: UUID, order_id: UUID) -> None:
        if not self._orders.delete(shop_id, order_id):
            self._require_shop(shop_id)
            raise OrderFixtureNotFoundError(f"shop {shop_id} has no order {order_id}")

    # -- materialization -------------------------------------------------------

    def _materialize_lines(
        self,
        shop: ShopPayload,
        previous: OrderFixturePayload,
        selections: tuple[OrderLineSelection, ...],
    ) -> tuple[OrderLine, ...]:
        frozen = {line.sku: line for line in previous.lines}
        catalog = _catalog(shop)
        lines: list[OrderLine] = []
        for selection in selections:
            kept = frozen.get(selection.sku)
            if kept is not None:
                # A line already on the order keeps the price and naming it was frozen at,
                # so a catalog edit can never rewrite an order's total.
                lines.append(replace(kept, quantity=selection.quantity))
                continue
            entry = catalog.get(selection.sku)
            if entry is None:
                raise OrderSelectionError(f"variant {selection.sku} is not in this shop's catalog")
            if entry.price is None:
                raise OrderSelectionError(
                    f"variant {selection.sku} has no price and cannot be ordered"
                )
            if entry.price.currency is not previous.currency:
                raise OrderSelectionError(
                    f"variant {selection.sku} is priced in {entry.price.currency.value} "
                    f"but the order is in {previous.currency.value}"
                )
            lines.append(
                OrderLine(
                    id=selection.sku.lower(),
                    sku=selection.sku,
                    product_handle=entry.product.handle,
                    title=entry.product.title,
                    variant_summary=_variant_summary(entry.product, entry.variant),
                    unit_price=entry.price,
                    quantity=selection.quantity,
                )
            )
        return tuple(lines)

    def _materialize_payment(
        self, shop: ShopPayload, previous: OrderFixturePayload, edit: OrderEdit
    ) -> PaymentState:
        status = require_reachable_status(
            previous.payment.status, edit.payment_status, PAYMENT_TRANSITIONS, "payment status"
        )
        name = self._method_name(
            edit.payment_method_id,
            previous.payment.method_id,
            previous.payment.method_name,
            {method.id: method.name for method in shop.payment_methods},
            "payment method",
        )
        return PaymentState(
            status=status,
            method_id=edit.payment_method_id,
            method_name=name,
            paid_at=edit.paid_at,
        )

    def _materialize_fulfilment(
        self, shop: ShopPayload, previous: OrderFixturePayload, edit: OrderEdit
    ) -> FulfilmentState:
        status = require_reachable_status(
            previous.fulfilment.status,
            edit.fulfilment_status,
            FULFILMENT_TRANSITIONS,
            "fulfilment status",
        )
        name = self._method_name(
            edit.fulfilment_method_id,
            previous.fulfilment.method_id,
            previous.fulfilment.method_name,
            {method.id: method.name for method in shop.fulfilment_methods},
            "fulfilment method",
        )
        return FulfilmentState(
            status=status,
            method_id=edit.fulfilment_method_id,
            method_name=name,
            shipped_at=edit.shipped_at,
        )

    @staticmethod
    def _method_name(
        selected: str | None,
        previous_id: str | None,
        previous_name: str | None,
        available: dict[str, str],
        noun: str,
    ) -> str | None:
        """Resolve a method's display name, keeping an already frozen one frozen."""
        if selected is None:
            return None
        if selected == previous_id and previous_name is not None:
            return previous_name
        name = available.get(selected)
        if name is None:
            raise OrderSelectionError(f"{noun} {selected} is not configured by this shop")
        return name

    def _materialize_fee(self, previous: OrderFixturePayload, amount: str) -> Money:
        try:
            parsed = Decimal(amount)
        except ArithmeticError as cause:
            raise OrderSelectionError("the shipping fee must be a decimal amount") from cause
        return Money(amount=parsed, currency=previous.currency)

    def _materialize_address(
        self, previous: OrderFixturePayload, address_id: str | None
    ) -> FrozenShippingAddress | None:
        """Freeze the selected address-book entry, or keep the copy already frozen.

        Reselecting the entry an order already ships to is a no-op on purpose: the frozen
        copy, not the entry, is what the order ships to, and refreshing it silently would
        be exactly the rewrite the address book promises never to do.
        """
        frozen = previous.shipping_address
        if address_id is None:
            return None
        if frozen is not None and frozen.source_address_id == address_id:
            return frozen
        entry = self._address_entry(previous.customer_profile_id, address_id)
        return FrozenShippingAddress(
            source_address_id=entry.id,
            source_label=entry.label,
            selected_at=canonical_timestamp(self._clock.now()),
            recipient=entry.recipient,
            line1=entry.line1,
            postal_code=entry.postal_code,
            city=entry.city,
            country=entry.country,
            line2=entry.line2,
            region=entry.region,
        )

    @staticmethod
    def _materialize_events(events: tuple[OrderEventDraft, ...]) -> tuple[OrderEvent, ...]:
        """Order events chronologically: their sequence is what the history means."""
        materialized = [
            OrderEvent(
                id=event.id,
                kind=OrderEventKind(event.kind),
                occurred_at=event.occurred_at,
                summary=event.summary,
            )
            for event in events
        ]
        return tuple(sorted(materialized, key=lambda event: (event.occurred_at, event.id)))

    # -- lookups ---------------------------------------------------------------

    def _require_shop(self, shop_id: UUID) -> ShopPayload:
        record = self._shops.get_draft(
            DefinitionId(definition_type=DefinitionType.SHOP, id=shop_id)
        )
        if record is None:
            raise ShopNotFoundError(f"shop {shop_id} has no draft")
        return record.payload

    def _profile(self, profile_id: UUID) -> CustomerProfilePayload:
        record = self._profiles.get_draft(customer_profile_definition_id(profile_id))
        if record is None:
            raise CustomerProfileNotFoundError(f"customer profile {profile_id} has no draft")
        return record.payload

    def _address_entry(self, profile_id: UUID, address_id: str) -> AddressEntry:
        for entry in self._profile(profile_id).addresses:
            if entry.id == address_id:
                return entry
        raise OrderSelectionError(f"address {address_id} is not in this customer's address book")

    def _require_attached_profile(self, shop_id: UUID, profile_id: UUID) -> None:
        self._profile(profile_id)
        if not self._attached.is_attached(customer_profile_definition_id(profile_id), shop_id):
            raise OrderSelectionError(
                f"customer profile {profile_id} is not attached to shop {shop_id}"
            )

    def _require_free_reference(
        self, shop_id: UUID, reference: str, *, order_id: UUID | None
    ) -> None:
        owner = self._orders.reference_owner(shop_id, reference)
        if owner is not None and owner != order_id:
            raise OrderReferenceExistsError(
                f"another order in this shop already uses the reference {reference}"
            )
