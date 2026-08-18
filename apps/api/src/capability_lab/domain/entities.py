from __future__ import annotations

import re
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from decimal import Decimal
from enum import StrEnum
from uuid import UUID


class DomainError(ValueError):
    """Raised when a domain invariant is violated."""


class OrderActionRefusedError(DomainError):
    """Raised when policy does not permit the requested order transition."""


class StaleOrderVersionError(DomainError):
    """Raised when an order command targets an obsolete version."""


class OrderStatus(StrEnum):
    PENDING = "pending"
    PAID = "paid"
    CANCELLED = "cancelled"


MIN_SCENARIO_SEED = 0
MAX_SCENARIO_SEED = 2**32 - 1

_SCENARIO_ID_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
_VERSION_PATTERN = re.compile(r"v[1-9][0-9]*")
_SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")


def _require_utc(value: datetime, field_name: str) -> None:
    # Domain state is canonical UTC; adapters normalize external timestamps before construction.
    if value.utcoffset() != timedelta(0):
        raise DomainError(f"{field_name} must be timezone-aware UTC")


def _require_scenario_id(value: str) -> None:
    if (
        len(value) > 64
        or not any(character.isalpha() for character in value)
        or _SCENARIO_ID_PATTERN.fullmatch(value) is None
    ):
        raise DomainError(
            "scenario ID must be a lowercase kebab-case identifier of at most 64 characters"
        )


def _require_version(value: str, field_name: str) -> None:
    if len(value) > 64 or _VERSION_PATTERN.fullmatch(value) is None:
        raise DomainError(
            f"{field_name} must be a positive version such as v1 or v2 "
            "and contain at most 64 characters"
        )


def _require_scenario_seed(value: object) -> None:
    if isinstance(value, bool):
        raise DomainError("scenario seed must be an integer, not a boolean")
    if not isinstance(value, int):
        raise DomainError("scenario seed must be an integer")
    if not MIN_SCENARIO_SEED <= value <= MAX_SCENARIO_SEED:
        raise DomainError(
            f"scenario seed must be between {MIN_SCENARIO_SEED} and {MAX_SCENARIO_SEED}"
        )


def _require_email(value: str, owner: str) -> None:
    if "@" not in value:
        raise DomainError(f"{owner} email must be valid")


def _require_uuid(value: object, field_name: str) -> None:
    if not isinstance(value, UUID):
        raise DomainError(f"{field_name} must be a UUID")


def _require_order_status(value: object) -> None:
    if not isinstance(value, OrderStatus):
        raise DomainError("order status must be a supported status")


def _require_money_amount(value: object) -> None:
    if not isinstance(value, Decimal):
        raise DomainError("product price must be a decimal value")
    if not value.is_finite():
        raise DomainError("product price must be finite")
    if value < 0:
        raise DomainError("product price cannot be negative")
    decimal_tuple = value.as_tuple()
    exponent = decimal_tuple.exponent
    if not isinstance(exponent, int):
        raise DomainError("product price must be finite")
    excess_fractional_digits = max(-exponent - 2, 0)
    if excess_fractional_digits and any(
        digit != 0 for digit in decimal_tuple.digits[-excess_fractional_digits:]
    ):
        raise DomainError("product price cannot have more than two fractional digits")


def _require_positive_order_version(value: object) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise DomainError("order version must be a positive integer")


@dataclass(frozen=True, slots=True)
class ScenarioDefinition:
    scenario_id: str
    scenario_version: str
    policy_set_version: str
    canonical_schema_version: str

    def __post_init__(self) -> None:
        _require_scenario_id(self.scenario_id)
        _require_version(self.scenario_version, "scenario version")
        _require_version(self.policy_set_version, "policy-set version")
        _require_version(self.canonical_schema_version, "canonical schema version")


@dataclass(frozen=True, slots=True)
class ScenarioMetadata:
    definition: ScenarioDefinition
    seed: int
    created_at: datetime

    def __post_init__(self) -> None:
        _require_scenario_seed(self.seed)
        _require_utc(self.created_at, "scenario metadata created_at")

    @property
    def scenario_id(self) -> str:
        return self.definition.scenario_id

    @property
    def scenario_version(self) -> str:
        return self.definition.scenario_version

    @property
    def policy_set_version(self) -> str:
        return self.definition.policy_set_version

    @property
    def canonical_schema_version(self) -> str:
        return self.definition.canonical_schema_version


@dataclass(frozen=True, slots=True)
class Persona:
    id: UUID
    display_name: str
    email: str
    locale: str
    support_traits: tuple[str, ...]

    def __post_init__(self) -> None:
        _require_uuid(self.id, "persona ID")
        if not self.display_name.strip():
            raise DomainError("persona display name cannot be empty")
        _require_email(self.email, "persona")
        if not self.locale.strip():
            raise DomainError("persona locale cannot be empty")
        if any(not trait.strip() for trait in self.support_traits):
            raise DomainError("persona support traits cannot contain empty values")
        if len(set(self.support_traits)) != len(self.support_traits):
            raise DomainError("persona support traits must be unique")


@dataclass(frozen=True, slots=True)
class Customer:
    id: UUID
    email: str
    display_name: str
    created_at: datetime

    def __post_init__(self) -> None:
        _require_uuid(self.id, "customer ID")
        _require_email(self.email, "customer")
        if not self.display_name.strip():
            raise DomainError("customer display name cannot be empty")
        _require_utc(self.created_at, "customer created_at")


@dataclass(frozen=True, slots=True)
class Product:
    id: UUID
    sku: str
    name: str
    price_amount: Decimal
    currency: str

    def __post_init__(self) -> None:
        _require_uuid(self.id, "product ID")
        if not self.sku.strip():
            raise DomainError("product SKU cannot be empty")
        if not self.name.strip():
            raise DomainError("product name cannot be empty")
        _require_money_amount(self.price_amount)
        if re.fullmatch(r"[A-Z]{3}", self.currency) is None:
            raise DomainError("currency must be an uppercase ISO 4217 code")


@dataclass(frozen=True, slots=True)
class Order:
    id: UUID
    customer_id: UUID
    created_at: datetime
    status: OrderStatus = OrderStatus.PENDING
    version: int = 1

    def __post_init__(self) -> None:
        _require_uuid(self.id, "order ID")
        _require_uuid(self.customer_id, "order customer ID")
        _require_order_status(self.status)
        _require_positive_order_version(self.version)
        _require_utc(self.created_at, "order created_at")

    def cancel(self, *, expected_version: int) -> Order:
        _require_positive_order_version(expected_version)
        if self.version != expected_version:
            raise StaleOrderVersionError(
                f"order version {expected_version} is stale; current version is {self.version}"
            )
        if self.status is not OrderStatus.PAID:
            raise OrderActionRefusedError("only a paid order can be cancelled")
        return replace(self, status=OrderStatus.CANCELLED, version=self.version + 1)


@dataclass(frozen=True, slots=True)
class CanonicalInitialState:
    definition: ScenarioDefinition
    seed: int
    persona: Persona
    customer: Customer
    products: tuple[Product, ...]
    orders: tuple[Order, ...]

    def __post_init__(self) -> None:
        _require_scenario_seed(self.seed)
        if (
            self.customer.email != self.persona.email
            or self.customer.display_name != self.persona.display_name
        ):
            raise DomainError(
                "canonical customer email and display name must exactly match the persona"
            )
        if len({product.id for product in self.products}) != len(self.products):
            raise DomainError("canonical products must have unique IDs")
        if len({product.sku for product in self.products}) != len(self.products):
            raise DomainError("canonical products must have unique SKUs")
        if len({order.id for order in self.orders}) != len(self.orders):
            raise DomainError("canonical orders must have unique IDs")
        all_ids = (
            self.persona.id,
            self.customer.id,
            *(product.id for product in self.products),
            *(order.id for order in self.orders),
        )
        if len(set(all_ids)) != len(all_ids):
            raise DomainError("canonical entity IDs must be globally unique")
        if any(order.customer_id != self.customer.id for order in self.orders):
            raise DomainError("canonical orders must belong to the canonical customer")
        if any(order.created_at < self.customer.created_at for order in self.orders):
            raise DomainError("canonical orders cannot predate the canonical customer")


@dataclass(frozen=True, slots=True)
class ConversationSession:
    id: UUID
    customer_id: UUID
    seed: int
    scenario_id: str
    scenario_version: str
    framework_id: str
    initial_state_hash: str
    created_at: datetime

    def __post_init__(self) -> None:
        _require_uuid(self.id, "session ID")
        _require_uuid(self.customer_id, "session customer ID")
        _require_scenario_seed(self.seed)
        _require_scenario_id(self.scenario_id)
        _require_version(self.scenario_version, "scenario version")
        if not self.framework_id.strip() or len(self.framework_id) > 64:
            raise DomainError("framework ID must contain at most 64 non-blank characters")
        if _SHA256_PATTERN.fullmatch(self.initial_state_hash) is None:
            raise DomainError("initial state hash must be a SHA-256 hex digest")
        _require_utc(self.created_at, "session created_at")


@dataclass(frozen=True, slots=True)
class MemoryRecord:
    id: UUID
    session_id: UUID
    namespace: str
    payload: dict[str, object]
    created_at: datetime

    def __post_init__(self) -> None:
        if not self.namespace.strip():
            raise DomainError("memory namespace cannot be empty")
        _require_utc(self.created_at, "memory created_at")
