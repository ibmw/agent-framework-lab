"""Authoring shop-scoped ticket definitions.

A ticket is the first shop-scoped definition, so this service is where ADR 0012's scoped half
of the lifecycle first runs for real: the shop is fixed when the ticket is created, the
customer profile is derived from the payload as a pinned reference, and publishing freezes
both the shop version and the customer-profile version alongside the content fingerprint.

What the service adds on top of the shared lifecycle is the shop's answer to "does this
resolve?" — the channels the shop offers, the products in its catalog, the orders it holds
and which of them belong to this customer, and the documents a suggestion may point at. Those
are gathered once into a `TicketAuthoringContext`, so the publish-gate rules stay pure and the
preview an author reads is the same rule set that refuses publication.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from capability_lab.application.customer_profiles import (
    CustomerProfileNotFoundError,
    customer_profile_definition_id,
)
from capability_lab.application.definition_authoring import (
    AuthoringErrors,
    DefinitionAuthoringService,
    DefinitionDraftPreview,
    DefinitionDraftRecord,
    DefinitionNotFoundError,
    DefinitionNotPublishableError,
    DefinitionRepository,
    DefinitionVersionNotFoundError,
    DefinitionVersionRecord,
    PayloadCodec,
    PublishedVersionDirectory,
    ShopScopedDefinitionRepository,
)
from capability_lab.application.definition_resolution import DefinitionResolutionError
from capability_lab.application.order_fixtures import OrderFixtureRecord, OrderFixtureRepository
from capability_lab.application.ports import Clock
from capability_lab.application.shop_documents import ShopDocumentOption, shop_document_options
from capability_lab.application.shops import ShopNotFoundError, claim_shop
from capability_lab.application.ticket_payload import (
    ticket_content_fingerprint,
    ticket_document,
    ticket_from_document,
)
from capability_lab.domain.customer_profile import CustomerProfilePayload
from capability_lab.domain.definitions import (
    DefinitionId,
    DefinitionType,
    DefinitionValidation,
    PublishedDefinitionVersion,
)
from capability_lab.domain.order_fixture import FulfilmentStatus, PaymentStatus
from capability_lab.domain.shop import Currency, ShopPayload, SupportChannel
from capability_lab.domain.ticket import (
    SuggestedDocumentKind,
    TicketAuthoringContext,
    TicketOrigin,
    TicketOriginKind,
    TicketPayload,
    TicketStatus,
    summarize_ticket_changes,
    validate_ticket,
    validate_ticket_content,
)


class TicketNotFoundError(DefinitionNotFoundError):
    """Raised when a shop has no ticket with the requested identifier."""


class TicketVersionNotFoundError(DefinitionVersionNotFoundError):
    """Raised when a published ticket version does not exist."""


class TicketNotPublishableError(DefinitionNotPublishableError):
    """Raised when a ticket draft still has publish-gate errors."""

    noun = "ticket"


class TicketReferenceExistsError(DefinitionResolutionError):
    """Raised when another ticket in the same shop already uses that reference."""


class TicketCustomerChangeError(DefinitionResolutionError):
    """Raised when a write would move a ticket to a different customer."""


class TicketCustomerNotInShopError(DefinitionResolutionError):
    """Raised when a ticket names a customer profile the shop does not use."""


def ticket_definition_id(ticket_id: UUID) -> DefinitionId:
    return DefinitionId(definition_type=DefinitionType.TICKET, id=ticket_id)


def shop_definition_id(shop_id: UUID) -> DefinitionId:
    return DefinitionId(definition_type=DefinitionType.SHOP, id=shop_id)


def ticket_references(payload: TicketPayload) -> tuple[DefinitionId, ...]:
    """A ticket references exactly one customer profile (ADR 0012)."""
    return (customer_profile_definition_id(payload.customer_profile_id),)


TICKET_CODEC: PayloadCodec[TicketPayload] = PayloadCodec(
    definition_type=DefinitionType.TICKET,
    document=ticket_document,
    from_document=ticket_from_document,
    fingerprint=ticket_content_fingerprint,
    # The shop-aware half of the gate lives on the service, which knows the shop; this is
    # what a ticket can be judged on with nothing else loaded.
    validate=validate_ticket_content,
    summarize_changes=summarize_ticket_changes,
    references=ticket_references,
)

TicketDraftRecord = DefinitionDraftRecord[TicketPayload]
TicketVersionRecord = DefinitionVersionRecord[TicketPayload]
TicketDraftPreview = DefinitionDraftPreview[TicketPayload]
TicketRepository = ShopScopedDefinitionRepository[TicketPayload]


@dataclass(frozen=True, slots=True)
class TicketSummary:
    """One row of the Studio's ticket list."""

    ticket_id: UUID
    reference: str
    subject: str
    customer_profile_id: UUID
    customer_display_name: str
    channel: SupportChannel
    status: TicketStatus
    origin_kind: TicketOriginKind
    preview: str
    opened_at: str | None
    message_count: int
    tags: tuple[str, ...]
    updated_at: datetime
    latest_published_version: int | None
    published_version_count: int


@dataclass(frozen=True, slots=True)
class TicketOrderOption:
    """One of this customer's orders, as the origin and link pickers offer it."""

    order_id: UUID
    reference: str
    placed_at: str
    payment_status: PaymentStatus
    fulfilment_status: FulfilmentStatus
    total_amount: str
    currency: Currency
    shipping_label: str | None


@dataclass(frozen=True, slots=True)
class TicketProductOption:
    """One product of the shop's catalog, as the origin picker offers it."""

    handle: str
    title: str


@dataclass(frozen=True, slots=True)
class TicketShopResources:
    """The same-shop resources a ticket may name, for the editor's pickers.

    Sent with every read so the editor offers exactly what the backend would accept, the way
    an order response carries the statuses that order may still move to. Orders are already
    filtered to this ticket's customer: a picker that offered somebody else's order would be
    offering a publish-gate error.

    Products and documents carry their titles, so the editor names what the ticket points at
    by what an author calls it. A reference the ticket holds that is missing from these lists
    is one the shop no longer resolves, which is how the editor tells it apart.
    """

    channels: tuple[SupportChannel, ...]
    products: tuple[TicketProductOption, ...]
    orders: tuple[TicketOrderOption, ...]
    documents: tuple[ShopDocumentOption, ...]


@dataclass(frozen=True, slots=True)
class TicketCustomerSummary:
    """Who the incident is about, for the context panel beside the thread."""

    profile_id: UUID
    display_name: str
    email: str
    locale: str
    persona_traits: tuple[str, ...]
    default_address_label: str | None
    latest_published_version: int | None
    order_count: int


@dataclass(frozen=True, slots=True)
class TicketReferenceSummary:
    """Another ticket of the same customer in this shop."""

    ticket_id: UUID
    reference: str
    subject: str
    status: TicketStatus


@dataclass(frozen=True, slots=True)
class TicketContext:
    """Everything around one ticket that the helpdesk workspace shows but never authors.

    Derived on every read rather than stored: the customer, the linked orders, and the
    customer's other tickets all live elsewhere and would go stale the moment they changed.
    """

    customer: TicketCustomerSummary
    linked_orders: tuple[TicketOrderOption, ...]
    other_tickets: tuple[TicketReferenceSummary, ...]
    resources: TicketShopResources


class ShopAttachmentDirectory(Protocol):
    """Whether a shop-independent definition is attached to a shop (ADR 0014)."""

    def is_attached(self, definition: DefinitionId, shop_id: UUID) -> bool: ...


def new_ticket(
    reference: str, subject: str, customer_profile_id: UUID, channel: SupportChannel
) -> TicketPayload:
    """The deliberately incomplete first draft: an incident with no first message yet."""
    return TicketPayload(
        reference=reference,
        subject=subject,
        customer_profile_id=customer_profile_id,
        channel=channel,
        status=TicketStatus.OPEN,
        origin=TicketOrigin(kind=TicketOriginKind.SUPPORT_ENTRY),
    )


class TicketService(DefinitionAuthoringService[TicketPayload]):
    """Author, validate, and publish the tickets of one shop."""

    def __init__(
        self,
        repository: TicketRepository,
        shops: DefinitionRepository[ShopPayload],
        profiles: DefinitionRepository[CustomerProfilePayload],
        orders: OrderFixtureRepository,
        attached_profiles: ShopAttachmentDirectory,
        versions: PublishedVersionDirectory,
        clock: Clock,
    ) -> None:
        super().__init__(
            repository,
            clock,
            TICKET_CODEC,
            AuthoringErrors(
                not_found=TicketNotFoundError,
                version_not_found=TicketVersionNotFoundError,
                not_publishable=TicketNotPublishableError,
            ),
            noun="ticket",
            versions=versions,
        )
        self._tickets = repository
        self._shops = shops
        self._profiles = profiles
        self._orders = orders
        self._attached = attached_profiles

    # -- the shop-aware publish gate -------------------------------------------

    def _validate(self, record: TicketDraftRecord) -> DefinitionValidation:
        """Judge the draft against the shop it belongs to, not the payload alone."""
        shop = record.draft.shop
        if shop is None:
            # A ticket is shop-scoped by construction; a draft without a scope is a
            # persistence bug, not authored content, and must not silently pass the gate.
            raise TicketNotFoundError(
                f"ticket {record.definition.id} has no owning shop and cannot be validated"
            )
        return validate_ticket(record.payload, self.authoring_context(shop.id, record.payload))

    # -- reading ---------------------------------------------------------------

    def list_tickets(self, shop_id: UUID) -> tuple[TicketSummary, ...]:
        self._require_shop(shop_id)
        names = {
            listing.definition_id: listing.payload.identity.display_name
            for listing in self._profiles.list_definitions()
        }
        return tuple(
            TicketSummary(
                ticket_id=listing.definition_id,
                reference=listing.payload.reference,
                subject=listing.payload.subject,
                customer_profile_id=listing.payload.customer_profile_id,
                customer_display_name=names.get(
                    listing.payload.customer_profile_id, "Unknown customer"
                ),
                channel=listing.payload.channel,
                status=listing.payload.status,
                origin_kind=listing.payload.origin.kind,
                preview=_preview_line(listing.payload),
                opened_at=listing.payload.opened_at,
                message_count=len(listing.payload.messages),
                tags=listing.payload.tags,
                updated_at=listing.updated_at,
                latest_published_version=listing.latest_published_version,
                published_version_count=listing.published_version_count,
            )
            for listing in self._tickets.list_in_shop(shop_id)
        )

    def get_ticket(self, shop_id: UUID, ticket_id: UUID) -> TicketDraftRecord:
        return self._require_ticket(shop_id, ticket_id)

    def preview_ticket(self, shop_id: UUID, ticket_id: UUID) -> TicketDraftPreview:
        self._require_ticket(shop_id, ticket_id)
        return self.preview_draft(ticket_id)

    def list_ticket_versions(
        self, shop_id: UUID, ticket_id: UUID
    ) -> tuple[PublishedDefinitionVersion, ...]:
        self._require_ticket(shop_id, ticket_id)
        return self.list_versions(ticket_id)

    def get_ticket_version(
        self, shop_id: UUID, ticket_id: UUID, version: int
    ) -> TicketVersionRecord:
        self._require_ticket(shop_id, ticket_id)
        return self.get_version(ticket_id, version)

    def ticket_context(self, shop_id: UUID, ticket_id: UUID) -> TicketContext:
        """Everything the helpdesk workspace shows beside the thread but never authors."""
        record = self._require_ticket(shop_id, ticket_id)
        payload = record.payload
        shop = self._require_shop(shop_id)
        profile_id = payload.customer_profile_id
        customer_orders = {
            order.order_id: _order_option(order)
            for order in self._orders.list_for_shop(shop_id)
            if order.payload.customer_profile_id == profile_id
        }
        return TicketContext(
            customer=self._customer_summary(profile_id, len(customer_orders)),
            # Only the orders that still resolve; one that does not is a publish-gate error
            # the author reads in the findings, not a half-empty card in the panel.
            linked_orders=tuple(
                customer_orders[order_id]
                for order_id in payload.referenced_order_ids
                if order_id in customer_orders
            ),
            other_tickets=tuple(
                TicketReferenceSummary(
                    ticket_id=listing.definition_id,
                    reference=listing.payload.reference,
                    subject=listing.payload.subject,
                    status=listing.payload.status,
                )
                for listing in self._tickets.list_in_shop(shop_id)
                if listing.payload.customer_profile_id == profile_id
                and listing.definition_id != ticket_id
            ),
            resources=TicketShopResources(
                channels=shop.identity.channels,
                products=tuple(
                    TicketProductOption(handle=product.handle, title=product.title)
                    for product in shop.products
                ),
                orders=tuple(customer_orders.values()),
                documents=shop_document_options(shop),
            ),
        )

    def _customer_summary(self, profile_id: UUID, order_count: int) -> TicketCustomerSummary:
        for listing in self._profiles.list_definitions():
            if listing.definition_id != profile_id:
                continue
            default_address = listing.payload.default_address
            return TicketCustomerSummary(
                profile_id=profile_id,
                display_name=listing.payload.identity.display_name,
                email=listing.payload.identity.email,
                locale=listing.payload.identity.locale,
                persona_traits=listing.payload.persona.traits,
                default_address_label=None if default_address is None else default_address.label,
                latest_published_version=listing.latest_published_version,
                order_count=order_count,
            )
        raise CustomerProfileNotFoundError(f"customer profile {profile_id} has no draft")

    def authoring_context(self, shop_id: UUID, payload: TicketPayload) -> TicketAuthoringContext:
        shop = self._require_shop(shop_id)
        orders = self._orders.list_for_shop(shop_id)
        customer = customer_profile_definition_id(payload.customer_profile_id)
        return TicketAuthoringContext(
            customer_attached=self._attached.is_attached(customer, shop_id),
            # What publishing this ticket would have to pin. Reported as findings so an
            # author never reads a clean gate and then gets a refusal on the click.
            shop_published=self._latest_published(shop_definition_id(shop_id)) is not None,
            customer_published=self._latest_published(customer) is not None,
            shop_channels=frozenset(shop.identity.channels),
            product_handles=frozenset(product.handle for product in shop.products),
            shop_order_ids=frozenset(order.order_id for order in orders),
            customer_order_ids=frozenset(
                order.order_id
                for order in orders
                if order.payload.customer_profile_id == payload.customer_profile_id
            ),
            document_ids={
                SuggestedDocumentKind.POLICY: frozenset(policy.id for policy in shop.policies),
                SuggestedDocumentKind.SUPPORT_GUIDELINE: frozenset(
                    entry.id for entry in shop.support_guidelines
                ),
                SuggestedDocumentKind.FAQ_ENTRY: frozenset(entry.id for entry in shop.faq),
            },
        )

    # -- writing ---------------------------------------------------------------

    def create_ticket(
        self,
        shop_id: UUID,
        reference: str,
        subject: str,
        customer_profile_id: UUID,
        channel: SupportChannel,
    ) -> TicketDraftRecord:
        """Create the ticket inside one shop, for one of that shop's customers."""
        self._require_shop(shop_id)
        self._require_attached_profile(shop_id, customer_profile_id)
        self._require_free_reference(shop_id, reference, ticket_id=None)
        claim_shop(self._shops, shop_id)
        return self.create(
            new_ticket(reference, subject, customer_profile_id, channel),
            shop=shop_definition_id(shop_id),
        )

    def replace_ticket(
        self, shop_id: UUID, ticket_id: UUID, payload: TicketPayload
    ) -> TicketDraftRecord:
        """Replace the whole draft, keeping the ticket's shop and customer where they are.

        The customer is fixed the way an order's is: the linked orders, the origin, and the
        prior conversation are all that customer's, so moving the ticket would leave every
        one of them pointing at somebody else's incident. Delete and recreate instead.
        """
        existing = self._require_ticket(shop_id, ticket_id)
        if payload.customer_profile_id != existing.payload.customer_profile_id:
            raise TicketCustomerChangeError(
                "a ticket's customer cannot be changed; its history and linked orders "
                "belong to the customer it was created for"
            )
        self._require_free_reference(shop_id, payload.reference, ticket_id=ticket_id)
        claim_shop(self._shops, shop_id)
        return self.replace_draft(ticket_id, payload)

    def publish_ticket(self, shop_id: UUID, ticket_id: UUID) -> TicketVersionRecord:
        """Freeze the draft, pinning the shop and customer versions it was authored on."""
        self._require_ticket(shop_id, ticket_id)
        return self.publish(ticket_id)

    # -- lookups ---------------------------------------------------------------

    def _require_ticket(self, shop_id: UUID, ticket_id: UUID) -> TicketDraftRecord:
        record = self._repository.get_draft(ticket_definition_id(ticket_id))
        # A ticket of another shop is not this shop's ticket: answering 404 keeps one shop's
        # workspace from confirming that an identifier exists elsewhere in the lab.
        if record is None or record.draft.shop != shop_definition_id(shop_id):
            self._require_shop(shop_id)
            raise TicketNotFoundError(f"shop {shop_id} has no ticket {ticket_id}")
        return record

    def _require_shop(self, shop_id: UUID) -> ShopPayload:
        record = self._shops.get_draft(shop_definition_id(shop_id))
        if record is None:
            raise ShopNotFoundError(f"shop {shop_id} has no draft")
        return record.payload

    def _require_attached_profile(self, shop_id: UUID, profile_id: UUID) -> None:
        definition = customer_profile_definition_id(profile_id)
        if self._profiles.get_draft(definition) is None:
            raise CustomerProfileNotFoundError(f"customer profile {profile_id} has no draft")
        if not self._attached.is_attached(definition, shop_id):
            raise TicketCustomerNotInShopError(
                f"customer profile {profile_id} is not attached to shop {shop_id}"
            )

    def _require_free_reference(
        self, shop_id: UUID, reference: str, *, ticket_id: UUID | None
    ) -> None:
        for listing in self._tickets.list_in_shop(shop_id):
            if listing.payload.reference == reference and listing.definition_id != ticket_id:
                raise TicketReferenceExistsError(
                    f"another ticket in this shop already uses the reference {reference}"
                )


def _order_option(record: OrderFixtureRecord) -> TicketOrderOption:
    address = record.payload.shipping_address
    return TicketOrderOption(
        order_id=record.order_id,
        reference=record.payload.reference,
        placed_at=record.payload.placed_at,
        payment_status=record.payload.payment.status,
        fulfilment_status=record.payload.fulfilment.status,
        total_amount=record.payload.total.canonical_amount,
        currency=record.payload.currency,
        shipping_label=None if address is None else address.source_label,
    )


def _preview_line(payload: TicketPayload) -> str:
    """The one-line thread preview the ticket list shows, or why there is none."""
    if payload.trigger is None:
        return "No first message yet"
    body = payload.trigger.body
    return body if len(body) <= 120 else f"{body[:119]}…"
