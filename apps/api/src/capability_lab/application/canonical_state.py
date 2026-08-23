from __future__ import annotations

import unicodedata
from dataclasses import dataclass

from capability_lab.application.canonical_json import (
    CanonicalSerializationError,
    CanonicalValue,
    canonical_json_bytes,
    canonical_sha256,
    canonical_timestamp,
)
from capability_lab.domain.entities import CanonicalInitialState, Order, Product

__all__ = [
    "CanonicalSerializationError",
    "CanonicalStateFingerprint",
    "CanonicalValue",
    "fingerprint_initial_state",
]


@dataclass(frozen=True, slots=True)
class CanonicalStateFingerprint:
    canonical_json: bytes
    initial_state_hash: str


def _product(product: Product) -> dict[str, CanonicalValue]:
    return {
        "currency": product.currency,
        "id": str(product.id),
        "name": product.name,
        "price_amount": format(product.price_amount, ".2f"),
        "sku": product.sku,
    }


def _order(order: Order) -> dict[str, CanonicalValue]:
    return {
        "created_at": canonical_timestamp(order.created_at),
        "customer_id": str(order.customer_id),
        "id": str(order.id),
        "status": order.status.value,
        "version": order.version,
    }


def fingerprint_initial_state(state: CanonicalInitialState) -> CanonicalStateFingerprint:
    if state.definition.canonical_schema_version != "v1":
        raise CanonicalSerializationError(
            f"canonical schema {state.definition.canonical_schema_version} is not supported"
        )

    customer: dict[str, CanonicalValue] = {
        "created_at": canonical_timestamp(state.customer.created_at),
        "display_name": state.customer.display_name,
        "email": state.customer.email,
        "id": str(state.customer.id),
    }
    # Trait order is set-like: sort by code point after NFC normalization (ADR 0007).
    support_traits: list[CanonicalValue] = []
    support_traits.extend(
        sorted(unicodedata.normalize("NFC", trait) for trait in state.persona.support_traits)
    )
    persona: dict[str, CanonicalValue] = {
        "display_name": state.persona.display_name,
        "email": state.persona.email,
        "id": str(state.persona.id),
        "locale": state.persona.locale,
        "support_traits": support_traits,
    }
    scenario: dict[str, CanonicalValue] = {
        "id": state.definition.scenario_id,
        "policy_set_version": state.definition.policy_set_version,
        "version": state.definition.scenario_version,
    }
    # UUID text is lowercase ASCII, so normalization cannot alter either collection's ordering.
    orders: list[CanonicalValue] = [
        _order(order) for order in sorted(state.orders, key=lambda candidate: str(candidate.id))
    ]
    products: list[CanonicalValue] = [
        _product(product)
        for product in sorted(state.products, key=lambda candidate: str(candidate.id))
    ]
    payload: dict[str, CanonicalValue] = {
        "canonical_schema_version": state.definition.canonical_schema_version,
        "customer": customer,
        "orders": orders,
        "persona": persona,
        "products": products,
        "scenario": scenario,
        "seed": state.seed,
    }
    canonical_json = canonical_json_bytes(payload)
    return CanonicalStateFingerprint(
        canonical_json=canonical_json,
        initial_state_hash=canonical_sha256(canonical_json),
    )
