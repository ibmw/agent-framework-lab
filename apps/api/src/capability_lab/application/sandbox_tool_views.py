"""What a read tool answers with: canonical projections of the state around one arm.

Every value here is a `CanonicalValue` document, so a tool result can be serialized by the
same codec as the state it was read from and hashed as evidence later without a second
rendering of the same facts.

One rule decides what these projections may contain, and it is already written down: a
`CUSTOMER_ONLY` field is "simulation-side content the support agent must never see"
(ADR 0014's field-sensitivity classification). The support agent is exactly who reads a
tool result, so **no projection here reads a `CUSTOMER_ONLY` field** — not the behavioral
persona, not the profile's hidden facts, and not a scenario's hidden facts or its mutation
bindings. `SENSITIVE` fields are a different rule: they are synthetic personal data that may
never reach a log line or a span, and serving them to the agent is the entire point of a
support simulation, so an address or a message body appears here in full.

The projections are also where the lab decides what an agent may *not* need to know: no
projection carries a definition version, a fingerprint, a shop identifier, or an arm's
revision. An arm reads the world, not the machinery that froze it.
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.domain.customer_profile import AddressEntry, CustomerProfilePayload
from capability_lab.domain.order_fixture import FrozenShippingAddress
from capability_lab.domain.sandbox import SandboxOrder, SandboxState
from capability_lab.domain.scenario import DocumentReference
from capability_lab.domain.shop import Money, Product, ShopDocumentKind, ShopPayload
from capability_lab.domain.ticket import TicketPayload

SEARCH_SNIPPET_LENGTH = 200
"""How much of a document's body a search result quotes before the agent reads it in full."""


def money(value: Money) -> dict[str, CanonicalValue]:
    """Money as an amount plus its currency, never as a binary float (ADR 0007)."""
    return {"amount": amount(value.amount), "currency": value.currency.value}


def amount(value: Decimal) -> str:
    return format(value, ".2f")


# -- the interaction --------------------------------------------------------------


def interaction_context(ticket: TicketPayload, state: SandboxState) -> dict[str, CanonicalValue]:
    """Where the customer is, how they arrived, and what has already been said.

    The origin travels as the identifiers the snapshot froze plus, for an order, the
    reference the customer would actually quote back. Resolving that here is what lets an
    arm answer "this order" with one further tool call instead of a copy of the order in
    its prompt.
    """
    origin = state.interaction.origin
    origin_order = origin.order_id
    return {
        "ticket_reference": state.interaction.ticket_reference,
        "subject": ticket.subject,
        "channel": state.interaction.channel.value,
        "status": ticket.status.value,
        "opened_at": ticket.opened_at,
        "origin": {
            "kind": origin.kind.value,
            "product_handle": origin.product_handle,
            "order_id": None if origin_order is None else str(origin_order),
            "order_reference": _order_reference(state, origin_order),
        },
        "linked_orders": [
            {"order_id": str(order_id), "order_reference": _order_reference(state, order_id)}
            for order_id in ticket.referenced_order_ids
        ],
        "thread": [
            {
                "id": message.id,
                "author": message.author.value,
                "body": message.body,
                "sent_at": message.sent_at,
            }
            for message in ticket.messages
        ],
    }


def _order_reference(state: SandboxState, order_id: UUID | None) -> str | None:
    """The quotable reference for an order this arm holds, or nothing if it holds none."""
    if order_id is None:
        return None
    order = state.order(order_id)
    return None if order is None else order.payload.reference


# -- the catalog ------------------------------------------------------------------


def product_summary(product: Product) -> dict[str, CanonicalValue]:
    prices = [variant.price for variant in product.variants if variant.price is not None]
    return {
        "handle": product.handle,
        "title": product.title,
        "category": product.category,
        "status": product.status.value,
        "price_from": None if not prices else money(min(prices, key=lambda price: price.amount)),
        "in_stock": any(variant.stock_quantity > 0 for variant in product.variants),
    }


def product_detail(product: Product) -> dict[str, CanonicalValue]:
    return {
        **product_summary(product),
        "description": product.description,
        "options": [
            {"key": option.key, "name": option.name, "values": list(option.values)}
            for option in product.options
        ],
        "variants": [
            {
                "sku": variant.sku,
                "option_values": [
                    {"key": key, "value": value} for key, value in variant.option_values
                ],
                "availability": variant.availability.value,
                "stock_quantity": variant.stock_quantity,
                "price": None if variant.price is None else money(variant.price),
            }
            for variant in product.variants
        ],
        "attributes": [
            {
                "key": attribute.key,
                "label": attribute.label,
                "type": attribute.attribute_type.value,
                "value": attribute.value,
                "unit": attribute.unit,
            }
            for attribute in product.attributes
        ],
        "media": [
            {"reference": item.reference, "alt_text": item.alt_text} for item in product.media
        ],
        "rating": _rating(product),
        "reviews": [
            {
                "id": review.id,
                "author_display_name": review.author_display_name,
                "rating": review.rating,
                "body": review.body,
            }
            for review in product.reviews
        ],
    }


# -- the customer -----------------------------------------------------------------


def customer_profile(
    customer_profile_id: UUID, profile: CustomerProfilePayload
) -> dict[str, CanonicalValue]:
    """The customer as a support agent may know them.

    The behavioral persona and the hidden facts are absent by construction: both are
    `CUSTOMER_ONLY`, which is the classification for what drives the simulated customer
    rather than what the support agent is allowed to read.
    """
    identity = profile.identity
    account = profile.account
    return {
        "customer_profile_id": str(customer_profile_id),
        "identity": {
            "given_name": identity.given_name,
            "family_name": identity.family_name,
            "email": identity.email,
            "phone": identity.phone,
            "locale": identity.locale,
        },
        "account": {
            "customer_since": account.customer_since,
            "status": account.status.value,
            "loyalty_tier": account.loyalty_tier.value,
            "marketing_opt_in": account.marketing_opt_in,
            "notes": account.notes,
        },
        "addresses": [
            {
                "id": entry.id,
                "label": entry.label,
                "recipient": entry.recipient,
                "line1": entry.line1,
                "line2": entry.line2,
                "postal_code": entry.postal_code,
                "city": entry.city,
                "region": entry.region,
                "country": entry.country,
                "is_default": entry.is_default,
            }
            for entry in profile.addresses
        ],
        "history": [
            {
                "id": entry.id,
                "kind": entry.kind.value,
                "occurred_on": entry.occurred_on,
                "note": entry.note,
            }
            for entry in profile.background
        ],
    }


# -- the orders -------------------------------------------------------------------


def order_summary(order: SandboxOrder) -> dict[str, CanonicalValue]:
    payload = order.payload
    address = payload.shipping_address
    return {
        "order_id": str(order.order_id),
        "reference": payload.reference,
        "placed_at": payload.placed_at,
        "payment_status": payload.payment.status.value,
        "fulfilment_status": payload.fulfilment.status.value,
        "total": money(payload.total),
        "item_count": payload.item_count,
        "ships_to": None if address is None else address.single_line,
    }


def order_detail(order: SandboxOrder) -> dict[str, CanonicalValue]:
    payload = order.payload
    return {
        **order_summary(order),
        "currency": payload.currency.value,
        "lines": [
            {
                "id": line.id,
                "sku": line.sku,
                "product_handle": line.product_handle,
                "title": line.title,
                "variant_summary": line.variant_summary,
                "unit_price": money(line.unit_price),
                "quantity": line.quantity,
                "line_total": money(line.line_total),
            }
            for line in payload.lines
        ],
        "subtotal": money(payload.subtotal),
        "shipping_fee": money(payload.shipping_amount),
        "payment": {
            "status": payload.payment.status.value,
            "method_id": payload.payment.method_id,
            "method_name": payload.payment.method_name,
            "paid_at": payload.payment.paid_at,
        },
        "fulfilment": {
            "status": payload.fulfilment.status.value,
            "method_id": payload.fulfilment.method_id,
            "method_name": payload.fulfilment.method_name,
            "shipped_at": payload.fulfilment.shipped_at,
        },
        "shipping_address": frozen_address(payload.shipping_address),
        "events": [
            {
                "id": event.id,
                "kind": event.kind.value,
                "occurred_at": event.occurred_at,
                "summary": event.summary,
            }
            for event in payload.events
        ],
    }


def _rating(product: Product) -> dict[str, CanonicalValue]:
    ratings = product.ratings
    average = ratings.average_rating
    return {
        "review_count": ratings.review_count,
        # Already quantized to one decimal by the domain, so it is rendered as it reads
        # rather than padded to a money-shaped ".2f".
        "average_rating": None if average is None else str(average),
    }


def frozen_address(address: FrozenShippingAddress | None) -> CanonicalValue:
    """The copy an order ships to, or nothing when it has none."""
    if address is None:
        return None
    return {
        "source_address_id": address.source_address_id,
        "source_label": address.source_label,
        "selected_at": address.selected_at,
        "recipient": address.recipient,
        "line1": address.line1,
        "line2": address.line2,
        "postal_code": address.postal_code,
        "city": address.city,
        "region": address.region,
        "country": address.country,
    }


def proposed_address(entry: AddressEntry) -> dict[str, CanonicalValue]:
    """An address-book entry rendered as the copy an order *would* ship to.

    The same keys as `frozen_address`, so a proposal is read against the current address
    field by field rather than in two shapes. `selected_at` is null because a proposal has
    selected nothing yet — which is also what keeps the document free of a clock, and so
    repeatable: proposing the same change twice against an unmoved arm answers identically.
    """
    return {
        "source_address_id": entry.id,
        "source_label": entry.label,
        "selected_at": None,
        "recipient": entry.recipient,
        "line1": entry.line1,
        "line2": entry.line2,
        "postal_code": entry.postal_code,
        "city": entry.city,
        "region": entry.region,
        "country": entry.country,
    }


# -- the support knowledge --------------------------------------------------------


def knowledge_documents(shop: ShopPayload) -> tuple[dict[str, str], ...]:
    """Every readable support document of one shop, in one shape.

    Three collections with three field names for the same two ideas — a policy has a title
    and a body, an FAQ entry has a question and an answer — become one record, so a search
    and a read do not have to know which collection they landed in. The reference grammar is
    the scenario's own (`policy:shipping`), because a read-check objective binds a document
    by exactly that string.

    Tone-of-voice guidelines are deliberately absent: they configure how an agent speaks and
    reach it through its published agent configuration, not as knowledge it looks up.
    """
    return (
        *(
            _document(ShopDocumentKind.POLICY, policy.id, policy.title, policy.body)
            for policy in shop.policies
        ),
        *(
            _document(
                ShopDocumentKind.SUPPORT_GUIDELINE, guideline.id, guideline.title, guideline.body
            )
            for guideline in shop.support_guidelines
        ),
        *(
            _document(ShopDocumentKind.FAQ_ENTRY, entry.id, entry.question, entry.answer)
            for entry in shop.faq
        ),
    )


def _document(kind: ShopDocumentKind, document_id: str, title: str, body: str) -> dict[str, str]:
    return {
        "kind": kind.value,
        "document_id": document_id,
        "reference": DocumentReference(kind=kind, document_id=document_id).value,
        "title": title,
        "body": body,
    }


def document_summary(document: dict[str, str]) -> dict[str, CanonicalValue]:
    body = document["body"]
    snippet = body[:SEARCH_SNIPPET_LENGTH]
    return {
        "kind": document["kind"],
        "document_id": document["document_id"],
        "reference": document["reference"],
        "title": document["title"],
        "snippet": snippet if snippet == body else f"{snippet.rstrip()}…",
    }


def document_detail(document: dict[str, str]) -> dict[str, CanonicalValue]:
    return {
        "kind": document["kind"],
        "document_id": document["document_id"],
        "reference": document["reference"],
        "title": document["title"],
        "body": document["body"],
    }
