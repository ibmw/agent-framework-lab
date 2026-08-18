from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from hashlib import sha256
from uuid import UUID

from capability_lab.domain.entities import (
    CanonicalInitialState,
    Customer,
    DomainError,
    Order,
    OrderStatus,
    Persona,
    Product,
    ScenarioDefinition,
)

RETAIL_PROFILE_V1 = ScenarioDefinition(
    scenario_id="retail-profile",
    scenario_version="v1",
    policy_set_version="v1",
    canonical_schema_version="v1",
)

RETAIL_ORDER_CANCELLATION_V1 = ScenarioDefinition(
    scenario_id="retail-order-cancellation",
    scenario_version="v1",
    policy_set_version="v2",
    canonical_schema_version="v1",
)

_FIRST_NAMES = ("Alex", "Casey", "Jordan", "Morgan", "Riley", "Sam", "Taylor", "Yuki")
_LAST_NAMES = ("Bernard", "Garcia", "Kim", "Martin", "Nakamura", "Singh", "Smith", "Wilson")
_LOCALES = ("en-GB", "en-US", "fr-FR")
_SUPPORT_TRAITS = (
    "concise",
    "detail-oriented",
    "delivery-focused",
    "patient",
    "price-conscious",
)
_CATALOG = (
    ("LAB-CARRY-001", "Canvas carry bag", Decimal("34.50")),
    ("LAB-MUG-001", "Insulated travel mug", Decimal("19.90")),
    ("LAB-NOTE-001", "Recycled paper notebook", Decimal("8.75")),
    ("LAB-POWER-001", "Compact power bank", Decimal("42.00")),
)
_TIMELINE_START = datetime(2024, 1, 1, tzinfo=UTC)


@dataclass(frozen=True, slots=True)
class _SeedDeriver:
    context: bytes

    @classmethod
    def for_scenario(cls, definition: ScenarioDefinition, seed: int) -> _SeedDeriver:
        # Canonical separators prevent different field combinations from sharing a context.
        components = (
            definition.scenario_id,
            definition.scenario_version,
            definition.policy_set_version,
            definition.canonical_schema_version,
            str(seed),
        )
        return cls("\x1f".join(components).encode())

    def digest(self, label: str) -> bytes:
        return sha256(self.context + b"\x1e" + label.encode()).digest()

    def index(self, label: str, length: int) -> int:
        if length < 1:
            raise ValueError("seeded choice requires at least one value")
        return int.from_bytes(self.digest(label), "big") % length

    def uuid(self, label: str) -> UUID:
        value = bytearray(self.digest(label)[:16])
        # The bytes come from the versioned scenario context and seed, never OS entropy.
        value[6] = (value[6] & 0x0F) | 0x80
        value[8] = (value[8] & 0x3F) | 0x80
        return UUID(bytes=bytes(value))

    def timestamp(self, label: str, *, start: datetime, span: timedelta) -> datetime:
        span_microseconds = span // timedelta(microseconds=1)
        offset_microseconds = int.from_bytes(self.digest(label), "big") % span_microseconds
        return start + timedelta(microseconds=offset_microseconds)


def generate_retail_profile_v1(
    definition: ScenarioDefinition,
    seed: int,
) -> CanonicalInitialState:
    """Generate the immutable retail-profile v1 state from versioned inputs only."""
    if definition != RETAIL_PROFILE_V1:
        raise DomainError("retail-profile v1 generator requires its exact versioned definition")
    return _generate_retail_state(definition, seed)


def generate_retail_order_cancellation_v1(
    definition: ScenarioDefinition,
    seed: int,
) -> CanonicalInitialState:
    """Generate the paid-order state required by cancellation scenario v1."""
    if definition != RETAIL_ORDER_CANCELLATION_V1:
        raise DomainError(
            "retail-order-cancellation v1 generator requires its exact versioned definition"
        )
    return _generate_retail_state(definition, seed)


def _generate_retail_state(
    definition: ScenarioDefinition,
    seed: int,
) -> CanonicalInitialState:

    # CanonicalInitialState validates the seed. Constructing the deriver has no observable side
    # effects, so invalid input cannot consume clock or random state.
    deriver = _SeedDeriver.for_scenario(definition, seed)
    first_name = _FIRST_NAMES[deriver.index("persona-first-name", len(_FIRST_NAMES))]
    last_name = _LAST_NAMES[deriver.index("persona-last-name", len(_LAST_NAMES))]
    display_name = f"{first_name} {last_name}"
    email = f"{first_name}.{last_name}.{seed}@example.test".lower()
    traits = tuple(
        sorted(
            _SUPPORT_TRAITS,
            key=lambda trait: deriver.digest(f"support-trait:{trait}"),
        )[:2]
    )
    persona = Persona(
        id=deriver.uuid("persona"),
        display_name=display_name,
        email=email,
        locale=_LOCALES[deriver.index("persona-locale", len(_LOCALES))],
        support_traits=traits,
    )

    customer_created_at = deriver.timestamp(
        "customer-created-at",
        start=_TIMELINE_START,
        span=timedelta(days=366),
    )
    customer = Customer(
        id=deriver.uuid("customer"),
        email=persona.email,
        display_name=persona.display_name,
        created_at=customer_created_at,
    )

    selected_catalog = sorted(
        _CATALOG,
        key=lambda item: deriver.digest(f"catalog-product:{item[0]}"),
    )[:2]
    products = tuple(
        Product(
            id=deriver.uuid(f"product:{sku}"),
            sku=sku,
            name=name,
            price_amount=price,
            currency="EUR",
        )
        for sku, name, price in selected_catalog
    )

    order_created_at = deriver.timestamp(
        "order-created-at",
        start=customer_created_at + timedelta(days=7),
        span=timedelta(days=84),
    )
    order = Order(
        id=deriver.uuid("order"),
        customer_id=customer.id,
        created_at=order_created_at,
        status=OrderStatus.PAID,
    )
    return CanonicalInitialState(
        definition=definition,
        seed=seed,
        persona=persona,
        customer=customer,
        products=products,
        orders=(order,),
    )
