from __future__ import annotations

import random
import uuid
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from hashlib import sha256

import pytest

from capability_lab.application.canonical_state import (
    CanonicalSerializationError,
    fingerprint_initial_state,
)
from capability_lab.application.scenario_generation import (
    ScenarioGenerationKernel,
    ScenarioGeneratorNotConfiguredError,
    create_retail_profile_kernel,
)
from capability_lab.application.scenario_registry import ScenarioRegistry
from capability_lab.domain.entities import DomainError, ScenarioDefinition
from capability_lab.domain.scenario_generation import (
    RETAIL_ORDER_CANCELLATION_V1,
    RETAIL_PROFILE_V1,
    generate_retail_profile_v1,
)

OPERATIONAL_TIME = datetime(2026, 8, 16, 12, 30, tzinfo=UTC)
EXPECTED_CANONICAL_JSON = (
    b'{"canonical_schema_version":"v1","customer":{"created_at":"2024-03-11T14:26:'
    b'16.845925Z","display_name":"Taylor Wilson","email":"taylor.wilson.1234@example.'
    b'test","id":"cb69d723-6aff-8bee-a248-bac5aad75487"},"orders":[{"created_at":"2024-'
    b'05-09T22:15:56.500050Z","customer_id":"cb69d723-6aff-8bee-a248-bac5aad75487","id"'
    b':"7852c4e3-1eba-8672-a381-a50ea3fe3b9c","status":"paid","version":1}],"persona":'
    b'{"display_name":"Taylor Wilson","email":"taylor.wilson.1234@example.test","id":"3ba3'
    b'0adb-a302-85f7-808d-486d16ae5452","locale":"en-US","support_traits":["concise","'
    b'detail-oriented"]},"products":[{"currency":"EUR","id":"5282eabe-f154-8110-88fe-eb3e'
    b'42bc1be0","name":"Recycled paper notebook","price_amount":"8.75","sku":"LAB-NOTE-001"'
    b'},{"currency":"EUR","id":"b5c538df-562f-85ed-b493-7c45512b5386","name":"Insulated '
    b'travel mug","price_amount":"19.90","sku":"LAB-MUG-001"}],"scenario":{"id":"retail-'
    b'profile","policy_set_version":"v1","version":"v1"},"seed":1234}'
)
EXPECTED_HASH = "11f76952f3ff05c7134fd4fd1bd5dbd602c077ec307320a3e38cf276bd6f15f7"


@dataclass(slots=True)
class FakeClock:
    value: datetime
    calls: int = 0

    def now(self) -> datetime:
        self.calls += 1
        return self.value


def test_same_inputs_produce_byte_identical_state_and_hash() -> None:
    first_clock = FakeClock(OPERATIONAL_TIME)
    later_clock = FakeClock(datetime(2030, 1, 1, tzinfo=UTC))

    first = create_retail_profile_kernel(first_clock).generate("retail-profile", "v1", 1234)
    second = create_retail_profile_kernel(later_clock).generate("retail-profile", "v1", 1234)

    assert first.state == second.state
    assert first.canonical_json == second.canonical_json == EXPECTED_CANONICAL_JSON
    assert first.initial_state_hash == second.initial_state_hash == EXPECTED_HASH
    assert sha256(first.canonical_json).hexdigest() == first.initial_state_hash
    assert first.metadata.created_at == OPERATIONAL_TIME
    assert second.metadata.created_at == datetime(2030, 1, 1, tzinfo=UTC)
    assert first_clock.calls == later_clock.calls == 1


def test_order_cancellation_scenario_is_immutable_deterministic_and_independent() -> None:
    kernel = create_retail_profile_kernel(FakeClock(OPERATIONAL_TIME))

    first = kernel.generate("retail-order-cancellation", "v1", 1234)
    replay = kernel.generate("retail-order-cancellation", "v1", 1234)
    read_only = kernel.generate("retail-profile", "v1", 1234)

    assert first.metadata.definition == RETAIL_ORDER_CANCELLATION_V1
    assert first.metadata.policy_set_version == "v2"
    assert first.canonical_json == replay.canonical_json
    assert first.initial_state_hash == replay.initial_state_hash
    assert first.initial_state_hash != read_only.initial_state_hash
    assert first.state.orders[0].status.value == "paid"


def test_different_seeds_produce_independent_coherent_state() -> None:
    kernel = create_retail_profile_kernel(FakeClock(OPERATIONAL_TIME))

    first = kernel.generate("retail-profile", "v1", 1)
    second = kernel.generate("retail-profile", "v1", 2)

    first_ids = {
        first.state.persona.id,
        first.state.customer.id,
        *(product.id for product in first.state.products),
        *(order.id for order in first.state.orders),
    }
    second_ids = {
        second.state.persona.id,
        second.state.customer.id,
        *(product.id for product in second.state.products),
        *(order.id for order in second.state.orders),
    }
    assert first_ids.isdisjoint(second_ids)
    assert all(identifier.version == 8 for identifier in first_ids | second_ids)
    assert first.initial_state_hash != second.initial_state_hash
    assert first.state.customer.email == first.state.persona.email
    assert first.state.customer.display_name == first.state.persona.display_name
    assert len(first.state.products) == 2
    assert len(first.state.orders) == 1
    assert first.state.orders[0].customer_id == first.state.customer.id
    assert first.state.orders[0].created_at > first.state.customer.created_at


def test_generation_does_not_use_global_randomness(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden(*_args: object, **_kwargs: object) -> None:
        pytest.fail("generation read global or OS randomness")

    monkeypatch.setattr(random, "random", forbidden)
    monkeypatch.setattr(random, "choice", forbidden)
    monkeypatch.setattr(random, "randrange", forbidden)
    monkeypatch.setattr(uuid, "uuid4", forbidden)

    generated = create_retail_profile_kernel(FakeClock(OPERATIONAL_TIME)).generate(
        "retail-profile", "v1", 1234
    )

    assert generated.initial_state_hash == EXPECTED_HASH


def test_invalid_seed_is_rejected_before_reading_the_clock() -> None:
    clock = FakeClock(OPERATIONAL_TIME)

    with pytest.raises(DomainError, match="scenario seed"):
        create_retail_profile_kernel(clock).generate("retail-profile", "v1", -1)

    assert clock.calls == 0


def test_canonical_collection_order_does_not_change_fingerprint() -> None:
    generated = create_retail_profile_kernel(FakeClock(OPERATIONAL_TIME)).generate(
        "retail-profile", "v1", 1234
    )
    reordered_persona = replace(
        generated.state.persona,
        support_traits=tuple(reversed(generated.state.persona.support_traits)),
    )
    reordered_state = replace(
        generated.state,
        persona=reordered_persona,
        products=tuple(reversed(generated.state.products)),
    )

    reordered = fingerprint_initial_state(reordered_state)

    assert reordered == generated.fingerprint


def test_canonical_serializer_normalizes_strings_to_unicode_nfc() -> None:
    generated = create_retail_profile_kernel(FakeClock(OPERATIONAL_TIME)).generate(
        "retail-profile", "v1", 1234
    )
    decomposed_persona = replace(
        generated.state.persona,
        display_name="Cafe\u0301",
        support_traits=("Cafe\u0301", "Cafz"),
    )
    decomposed_customer = replace(generated.state.customer, display_name="Cafe\u0301")
    composed_persona = replace(
        generated.state.persona,
        display_name="Caf\u00e9",
        support_traits=("Caf\u00e9", "Cafz"),
    )
    composed_customer = replace(generated.state.customer, display_name="Caf\u00e9")

    decomposed = fingerprint_initial_state(
        replace(
            generated.state,
            persona=decomposed_persona,
            customer=decomposed_customer,
        )
    )
    composed = fingerprint_initial_state(
        replace(
            generated.state,
            persona=composed_persona,
            customer=composed_customer,
        )
    )

    assert decomposed == composed
    assert "Caf\u00e9".encode() in decomposed.canonical_json
    assert '"support_traits":["Cafz","Caf\u00e9"]'.encode() in decomposed.canonical_json


def test_canonical_serializer_rejects_naive_timestamp_at_its_boundary() -> None:
    generated = create_retail_profile_kernel(FakeClock(OPERATIONAL_TIME)).generate(
        "retail-profile", "v1", 1234
    )
    # Simulate corrupted state from an adapter without weakening domain construction invariants.
    object.__setattr__(generated.state.customer, "created_at", datetime(2024, 3, 11))

    with pytest.raises(CanonicalSerializationError, match="timezone-aware UTC"):
        fingerprint_initial_state(generated.state)


def test_behaviorally_relevant_change_changes_fingerprint() -> None:
    generated = create_retail_profile_kernel(FakeClock(OPERATIONAL_TIME)).generate(
        "retail-profile", "v1", 1234
    )
    changed_persona = replace(generated.state.persona, locale="fr-FR")
    changed_state = replace(generated.state, persona=changed_persona)

    changed = fingerprint_initial_state(changed_state)

    assert changed.initial_state_hash != generated.initial_state_hash


def test_canonical_serializer_rejects_unknown_schema_version() -> None:
    generated = create_retail_profile_kernel(FakeClock(OPERATIONAL_TIME)).generate(
        "retail-profile", "v1", 1234
    )
    unsupported_definition = ScenarioDefinition(
        scenario_id="retail-profile",
        scenario_version="v1",
        policy_set_version="v1",
        canonical_schema_version="v2",
    )

    with pytest.raises(CanonicalSerializationError, match="canonical schema v2"):
        fingerprint_initial_state(replace(generated.state, definition=unsupported_definition))


def test_registered_scenario_requires_a_configured_generator() -> None:
    clock = FakeClock(OPERATIONAL_TIME)
    kernel = ScenarioGenerationKernel(
        registry=ScenarioRegistry((RETAIL_PROFILE_V1,)),
        generators={},
        clock=clock,
    )

    with pytest.raises(ScenarioGeneratorNotConfiguredError, match="retail-profile@v1"):
        kernel.generate("retail-profile", "v1", 1234)

    assert clock.calls == 0


def test_retail_profile_v1_generator_requires_exact_pinned_definition() -> None:
    changed_policy = replace(RETAIL_PROFILE_V1, policy_set_version="v2")

    with pytest.raises(DomainError, match="exact versioned definition"):
        generate_retail_profile_v1(changed_policy, 1234)
