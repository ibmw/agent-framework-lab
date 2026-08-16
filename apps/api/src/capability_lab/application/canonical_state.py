from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta
from hashlib import sha256

from capability_lab.domain.entities import CanonicalInitialState, Order, Product

type CanonicalValue = bool | int | str | list[CanonicalValue] | dict[str, CanonicalValue] | None


class CanonicalSerializationError(ValueError):
    """Raised when state cannot be represented by the pinned canonical schema."""


@dataclass(frozen=True, slots=True)
class CanonicalStateFingerprint:
    canonical_json: bytes
    initial_state_hash: str


def _timestamp(value: datetime) -> str:
    if value.utcoffset() != timedelta(0):
        raise CanonicalSerializationError("canonical timestamps must be timezone-aware UTC")
    return value.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


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
        "created_at": _timestamp(order.created_at),
        "customer_id": str(order.customer_id),
        "id": str(order.id),
        "status": order.status.value,
        "version": order.version,
    }


def _normalize(value: CanonicalValue) -> CanonicalValue:
    if isinstance(value, str):
        return unicodedata.normalize("NFC", value)
    if value is None or isinstance(value, bool | int):
        return value
    if isinstance(value, list):
        return [_normalize(item) for item in value]

    normalized: dict[str, CanonicalValue] = {}
    for key, item in value.items():
        normalized_key = unicodedata.normalize("NFC", key)
        if normalized_key in normalized:
            raise CanonicalSerializationError(
                "canonical object keys must be unique after NFC normalization"
            )
        normalized[normalized_key] = _normalize(item)
    return normalized


def fingerprint_initial_state(state: CanonicalInitialState) -> CanonicalStateFingerprint:
    if state.definition.canonical_schema_version != "v1":
        raise CanonicalSerializationError(
            f"canonical schema {state.definition.canonical_schema_version} is not supported"
        )

    customer: dict[str, CanonicalValue] = {
        "created_at": _timestamp(state.customer.created_at),
        "display_name": state.customer.display_name,
        "email": state.customer.email,
        "id": str(state.customer.id),
    }
    normalized_traits = sorted(
        unicodedata.normalize("NFC", trait) for trait in state.persona.support_traits
    )
    support_traits: list[CanonicalValue] = []
    support_traits.extend(normalized_traits)
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
    normalized = _normalize(payload)
    canonical_json = json.dumps(
        normalized,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
    return CanonicalStateFingerprint(
        canonical_json=canonical_json,
        initial_state_hash=sha256(canonical_json).hexdigest(),
    )
