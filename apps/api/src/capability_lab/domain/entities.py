from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from enum import StrEnum
from uuid import UUID


class DomainError(ValueError):
    """Raised when a domain invariant is violated."""


class OrderStatus(StrEnum):
    PENDING = "pending"
    PAID = "paid"
    CANCELLED = "cancelled"


MIN_SCENARIO_SEED = 0
MAX_SCENARIO_SEED = 2**32 - 1

_SCENARIO_ID_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
_VERSION_PATTERN = re.compile(r"v[1-9][0-9]*")


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


def _require_scenario_seed(value: int) -> None:
    if isinstance(value, bool):
        raise DomainError("scenario seed must be an integer, not a boolean")
    if not MIN_SCENARIO_SEED <= value <= MAX_SCENARIO_SEED:
        raise DomainError(
            f"scenario seed must be between {MIN_SCENARIO_SEED} and {MAX_SCENARIO_SEED}"
        )


def _require_email(value: str, owner: str) -> None:
    if "@" not in value:
        raise DomainError(f"{owner} email must be valid")


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
        if self.price_amount < 0:
            raise DomainError("product price cannot be negative")
        if len(self.currency) != 3:
            raise DomainError("currency must be an ISO 4217 code")


@dataclass(frozen=True, slots=True)
class Order:
    id: UUID
    customer_id: UUID
    created_at: datetime
    status: OrderStatus = OrderStatus.PENDING
    version: int = 1

    def __post_init__(self) -> None:
        if self.version < 1:
            raise DomainError("order version must be positive")
        _require_utc(self.created_at, "order created_at")


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
        if len({order.id for order in self.orders}) != len(self.orders):
            raise DomainError("canonical orders must have unique IDs")
        if any(order.customer_id != self.customer.id for order in self.orders):
            raise DomainError("canonical orders must belong to the canonical customer")


@dataclass(frozen=True, slots=True)
class ConversationSession:
    id: UUID
    customer_id: UUID
    seed: int
    scenario_version: str
    initial_state_hash: str
    created_at: datetime

    def __post_init__(self) -> None:
        _require_scenario_seed(self.seed)
        _require_version(self.scenario_version, "scenario version")
        if len(self.initial_state_hash) != 64:
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
