from dataclasses import FrozenInstanceError, replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import cast
from uuid import UUID

import pytest

from capability_lab.application.scenario_registry import (
    DuplicateScenarioDefinitionError,
    ScenarioNotFoundError,
    ScenarioRegistry,
)
from capability_lab.domain.entities import (
    MAX_SCENARIO_SEED,
    CanonicalInitialState,
    ConversationSession,
    Customer,
    DomainError,
    Order,
    Persona,
    Product,
    ScenarioDefinition,
    ScenarioMetadata,
)

CREATED_AT = datetime(2026, 8, 16, 12, 30, tzinfo=UTC)


def scenario_definition(version: str = "v1") -> ScenarioDefinition:
    return ScenarioDefinition(
        scenario_id="retail-profile",
        scenario_version=version,
        policy_set_version="v1",
        canonical_schema_version="v1",
    )


def scenario_metadata(seed: int) -> ScenarioMetadata:
    return ScenarioMetadata(
        definition=scenario_definition(),
        seed=seed,
        created_at=CREATED_AT,
    )


def persona(
    display_name: str = "Morgan Martin",
    email: str = "morgan.martin@example.test",
    locale: str = "en-US",
    support_traits: tuple[str, ...] = ("concise",),
) -> Persona:
    return Persona(
        id=UUID("d204905e-4bd0-4e5a-9642-e232334a3c32"),
        display_name=display_name,
        email=email,
        locale=locale,
        support_traits=support_traits,
    )


def canonical_state() -> CanonicalInitialState:
    generated_persona = persona()
    customer = Customer(
        id=UUID("1f5ab725-e20c-4a40-aa45-75ec7842fab5"),
        email=generated_persona.email,
        display_name=generated_persona.display_name,
        created_at=CREATED_AT,
    )
    product = Product(
        id=UUID("c30d6b41-c352-477b-b9f0-5f30b8865db5"),
        sku="LAB-001",
        name="Travel mug",
        price_amount=Decimal("19.90"),
        currency="EUR",
    )
    order = Order(
        id=UUID("4d00aa94-18b7-4b0f-89ff-008657dd71c5"),
        customer_id=customer.id,
        created_at=CREATED_AT + timedelta(days=1),
    )
    return CanonicalInitialState(
        definition=scenario_definition(),
        seed=42,
        persona=generated_persona,
        customer=customer,
        products=(product,),
        orders=(order,),
    )


def assign_attribute(instance: object, name: str, value: object) -> None:
    setattr(instance, name, value)


@pytest.mark.parametrize("seed", [0, MAX_SCENARIO_SEED])
def test_scenario_metadata_accepts_inclusive_seed_bounds(seed: int) -> None:
    metadata = scenario_metadata(seed)

    assert metadata.seed == seed
    assert metadata.created_at == CREATED_AT
    assert metadata.scenario_id == "retail-profile"
    assert metadata.scenario_version == "v1"
    assert metadata.policy_set_version == "v1"
    assert metadata.canonical_schema_version == "v1"


@pytest.mark.parametrize(
    ("seed", "message"),
    [
        (-1, "scenario seed must be between"),
        (MAX_SCENARIO_SEED + 1, "scenario seed must be between"),
        (True, "not a boolean"),
        (cast(int, 1.5), "must be an integer"),
    ],
)
def test_scenario_metadata_rejects_invalid_seed(seed: int, message: str) -> None:
    with pytest.raises(DomainError, match=message):
        scenario_metadata(seed)


@pytest.mark.parametrize(
    ("scenario_id", "scenario_version", "policy_version", "schema_version", "message"),
    [
        ("Retail Profile", "v1", "v1", "v1", "kebab-case"),
        ("123", "v1", "v1", "v1", "kebab-case"),
        ("r" * 65, "v1", "v1", "v1", "at most 64"),
        ("retail-profile", "1", "v1", "v1", "scenario version"),
        ("retail-profile", "v" + "1" * 64, "v1", "v1", "at most 64"),
        ("retail-profile", "v1", "latest", "v1", "policy-set version"),
        ("retail-profile", "v1", "v1", "v0", "canonical schema version"),
    ],
)
def test_scenario_definition_rejects_invalid_versioned_metadata(
    scenario_id: str,
    scenario_version: str,
    policy_version: str,
    schema_version: str,
    message: str,
) -> None:
    with pytest.raises(DomainError, match=message):
        ScenarioDefinition(
            scenario_id=scenario_id,
            scenario_version=scenario_version,
            policy_set_version=policy_version,
            canonical_schema_version=schema_version,
        )


def test_scenario_metadata_requires_operational_creation_time_in_utc() -> None:
    with pytest.raises(DomainError, match="timezone-aware UTC"):
        ScenarioMetadata(
            definition=scenario_definition(),
            seed=42,
            created_at=datetime(2026, 8, 16, 12, 30),
        )


@pytest.mark.parametrize(
    ("display_name", "email", "locale", "message"),
    [
        (" ", "morgan.martin@example.test", "en-US", "display name"),
        ("Morgan Martin", "invalid", "en-US", "email"),
        ("Morgan Martin", "morgan.martin@example.test", " ", "locale"),
    ],
)
def test_persona_requires_scenario_relevant_identity_fields(
    display_name: str,
    email: str,
    locale: str,
    message: str,
) -> None:
    with pytest.raises(DomainError, match=message):
        persona(display_name, email, locale, ())


@pytest.mark.parametrize("support_traits", [("",), ("concise", "concise")])
def test_persona_requires_non_empty_unique_support_traits(
    support_traits: tuple[str, ...],
) -> None:
    with pytest.raises(DomainError, match="support traits"):
        persona(support_traits=support_traits)


def test_persona_and_canonical_state_are_immutable_boundaries() -> None:
    generated_persona = persona(support_traits=("concise", "delivery-focused"))
    customer = Customer(
        id=UUID("1f5ab725-e20c-4a40-aa45-75ec7842fab5"),
        email=generated_persona.email,
        display_name=generated_persona.display_name,
        created_at=CREATED_AT,
    )
    product = Product(
        id=UUID("c30d6b41-c352-477b-b9f0-5f30b8865db5"),
        sku="LAB-001",
        name="Travel mug",
        price_amount=Decimal("19.90"),
        currency="EUR",
    )
    state = CanonicalInitialState(
        definition=scenario_definition(),
        seed=42,
        persona=generated_persona,
        customer=customer,
        products=(product,),
        orders=(),
    )

    with pytest.raises(FrozenInstanceError):
        assign_attribute(generated_persona, "display_name", "Changed")
    with pytest.raises(FrozenInstanceError):
        assign_attribute(state, "seed", 43)

    assert state.products == (product,)
    # ADR 0007 excludes the operational generation timestamp from the hash input.
    assert not hasattr(state, "created_at")


def test_canonical_state_requires_customer_identity_derived_from_persona() -> None:
    generated_persona = persona()
    customer = Customer(
        id=UUID("1f5ab725-e20c-4a40-aa45-75ec7842fab5"),
        email="different@example.test",
        display_name=generated_persona.display_name,
        created_at=CREATED_AT,
    )

    with pytest.raises(DomainError, match="exactly match the persona"):
        CanonicalInitialState(
            definition=scenario_definition(),
            seed=42,
            persona=generated_persona,
            customer=customer,
            products=(),
            orders=(),
        )


def test_canonical_state_rejects_duplicate_product_and_order_ids() -> None:
    generated_persona = persona()
    customer = Customer(
        id=UUID("1f5ab725-e20c-4a40-aa45-75ec7842fab5"),
        email=generated_persona.email,
        display_name=generated_persona.display_name,
        created_at=CREATED_AT,
    )
    product = Product(
        id=UUID("c30d6b41-c352-477b-b9f0-5f30b8865db5"),
        sku="LAB-001",
        name="Travel mug",
        price_amount=Decimal("19.90"),
        currency="EUR",
    )
    order = Order(
        id=UUID("4d00aa94-18b7-4b0f-89ff-008657dd71c5"),
        customer_id=customer.id,
        created_at=CREATED_AT,
    )
    state = CanonicalInitialState(
        definition=scenario_definition(),
        seed=42,
        persona=generated_persona,
        customer=customer,
        products=(product,),
        orders=(order,),
    )

    with pytest.raises(DomainError, match="products must have unique IDs"):
        replace(state, products=(product, product))
    with pytest.raises(DomainError, match="orders must have unique IDs"):
        replace(state, orders=(order, order))


def test_canonical_state_requires_orders_owned_by_canonical_customer() -> None:
    generated_persona = persona()
    customer = Customer(
        id=UUID("1f5ab725-e20c-4a40-aa45-75ec7842fab5"),
        email=generated_persona.email,
        display_name=generated_persona.display_name,
        created_at=CREATED_AT,
    )
    foreign_order = Order(
        id=UUID("4d00aa94-18b7-4b0f-89ff-008657dd71c5"),
        customer_id=UUID("ee5ab725-e20c-4a40-aa45-75ec7842fab5"),
        created_at=CREATED_AT,
    )

    with pytest.raises(DomainError, match="belong to the canonical customer"):
        CanonicalInitialState(
            definition=scenario_definition(),
            seed=42,
            persona=generated_persona,
            customer=customer,
            products=(),
            orders=(foreign_order,),
        )


def test_canonical_state_requires_unique_skus_and_entity_ids() -> None:
    state = canonical_state()
    duplicate_sku = replace(
        state.products[0],
        id=UUID("2b3d6b41-c352-477b-b9f0-5f30b8865db5"),
    )
    colliding_id = replace(
        state.products[0],
        id=state.customer.id,
        sku="LAB-002",
    )

    with pytest.raises(DomainError, match="unique SKUs"):
        replace(state, products=(*state.products, duplicate_sku))
    with pytest.raises(DomainError, match="globally unique"):
        replace(state, products=(*state.products, colliding_id))


def test_canonical_state_rejects_order_that_predates_customer() -> None:
    state = canonical_state()
    predating_order = replace(
        state.orders[0],
        created_at=state.customer.created_at - timedelta(microseconds=1),
    )

    with pytest.raises(DomainError, match="cannot predate"):
        replace(state, orders=(predating_order,))


@pytest.mark.parametrize(
    ("seed", "scenario_version", "message"),
    [(-1, "v1", "scenario seed"), (42, "latest", "scenario version")],
)
def test_conversation_session_reuses_scenario_metadata_validation(
    seed: int,
    scenario_version: str,
    message: str,
) -> None:
    with pytest.raises(DomainError, match=message):
        ConversationSession(
            id=UUID("308d5e20-1319-4c00-ad4f-8d97dfa8b07b"),
            customer_id=UUID("1f5ab725-e20c-4a40-aa45-75ec7842fab5"),
            seed=seed,
            scenario_id="retail-profile",
            scenario_version=scenario_version,
            framework_id="fake",
            initial_state_hash="0" * 64,
            created_at=CREATED_AT,
        )


@pytest.mark.parametrize("initial_state_hash", ["g" * 64, "A" * 64, "0" * 63])
def test_conversation_session_requires_lowercase_sha256_hash(initial_state_hash: str) -> None:
    with pytest.raises(DomainError, match="SHA-256 hex digest"):
        ConversationSession(
            id=UUID("308d5e20-1319-4c00-ad4f-8d97dfa8b07b"),
            customer_id=UUID("1f5ab725-e20c-4a40-aa45-75ec7842fab5"),
            seed=42,
            scenario_id="retail-profile",
            scenario_version="v1",
            framework_id="fake",
            initial_state_hash=initial_state_hash,
            created_at=CREATED_AT,
        )


def test_registry_resolves_two_versions_of_the_same_scenario() -> None:
    version_one = scenario_definition("v1")
    version_two = ScenarioDefinition(
        scenario_id="retail-profile",
        scenario_version="v2",
        policy_set_version="v2",
        canonical_schema_version="v1",
    )
    registry = ScenarioRegistry([version_one, version_two])

    assert registry.resolve("retail-profile", "v1") is version_one
    assert registry.resolve("retail-profile", "v2") is version_two


def test_registry_rejects_duplicate_scenario_key() -> None:
    definition = scenario_definition()
    conflicting_definition = ScenarioDefinition(
        scenario_id="retail-profile",
        scenario_version="v1",
        policy_set_version="v2",
        canonical_schema_version="v1",
    )

    with pytest.raises(DuplicateScenarioDefinitionError, match="retail-profile@v1"):
        ScenarioRegistry([definition, conflicting_definition])


def test_registry_reports_unknown_scenario_key() -> None:
    registry = ScenarioRegistry([scenario_definition()])

    with pytest.raises(ScenarioNotFoundError, match="retail-profile@v2"):
        registry.resolve("retail-profile", "v2")
