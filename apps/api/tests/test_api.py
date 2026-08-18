import asyncio
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import Mock
from uuid import UUID

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from opentelemetry.sdk.trace import TracerProvider

from capability_lab.application.ports import (
    AgentResponse,
    ConversationTurn,
    OrderWriteTransientError,
    StructuredSupportResult,
)
from capability_lab.application.scenario_generation import (
    ScenarioGenerationKernel,
    create_retail_profile_kernel,
)
from capability_lab.application.scenario_registry import ScenarioRegistry
from capability_lab.domain.entities import (
    CanonicalInitialState,
    ConversationSession,
    Order,
    ScenarioDefinition,
)
from capability_lab.domain.scenario_generation import (
    RETAIL_PROFILE_V1,
    generate_retail_profile_v1,
)
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
)
from capability_lab.infrastructure.models import IdempotencyRecordModel, ProductModel
from capability_lab.infrastructure.repositories import (
    ConversationTurnConflictError,
    SqlAlchemyConversationTurnRepository,
    SqlAlchemyGeneratedScenarioRepository,
    SqlAlchemyOrderRepository,
    SqlAlchemySessionRepository,
)
from capability_lab.infrastructure.telemetry import Telemetry
from capability_lab.presentation.api import create_app


class FixedClock:
    def now(self) -> datetime:
        return datetime(2026, 8, 16, 12, 30, tzinfo=UTC)


@dataclass(slots=True)
class MutableClock:
    value: datetime

    def now(self) -> datetime:
        return self.value


def integration_app(tmp_path: Path) -> FastAPI:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'api.db'}")
    Base.metadata.create_all(engine)
    return create_app(
        session_factory=create_session_factory(engine),
        generation_kernel=create_retail_profile_kernel(FixedClock()),
    )


async def test_health_contract() -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "api_version": "v1"}


async def test_local_frontend_origin_is_allowed() -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.options(
            "/api/v1/health",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


async def test_application_lifespan_flushes_and_shuts_down_telemetry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = TracerProvider()
    force_flush = Mock(return_value=True)
    shutdown = Mock()
    monkeypatch.setattr(provider, "force_flush", force_flush)
    monkeypatch.setattr(provider, "shutdown", shutdown)
    telemetry = Telemetry(provider.get_tracer("test"), b"unit-test-salt", provider)
    application = create_app(telemetry=telemetry)

    async with application.router.lifespan_context(application):
        pass

    force_flush.assert_called_once_with()
    shutdown.assert_called_once_with()


async def test_unmatched_route_and_method_use_structured_errors() -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        missing = await client.get("/api/v1/missing")
        unsupported = await client.delete("/api/v1/health")

    assert missing.status_code == 404
    assert missing.json()["code"] == "not_found"
    assert missing.json()["request_id"] == missing.headers["x-request-id"]
    assert unsupported.status_code == 405
    assert unsupported.json()["code"] == "method_not_allowed"
    assert unsupported.json()["request_id"] == unsupported.headers["x-request-id"]


async def test_generate_replay_and_retrieve_persisted_scenario(tmp_path: Path) -> None:
    transport = ASGITransport(app=integration_app(tmp_path))
    path = "/api/v1/scenarios/retail-profile/versions/v1/generations"
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.post(
            path,
            headers={"Idempotency-Key": "generation-1234"},
            json={"seed": 1234},
        )
        replay = await client.post(
            path,
            headers={"Idempotency-Key": "generation-1234"},
            json={"seed": 1234},
        )
        duplicate = await client.post(
            path,
            headers={"Idempotency-Key": "generation-1234-alias"},
            json={"seed": 1234},
        )
        retrieved = await client.get(f"{path}/1234")

    assert first.status_code == replay.status_code == duplicate.status_code == 201
    assert retrieved.status_code == 200
    assert first.json() == replay.json() == duplicate.json() == retrieved.json()
    payload = first.json()
    assert payload["metadata"] == {
        "scenario_id": "retail-profile",
        "scenario_version": "v1",
        "policy_set_version": "v1",
        "canonical_schema_version": "v1",
        "seed": 1234,
        "created_at": "2026-08-16T12:30:00Z",
    }
    assert payload["initial_state"]["persona"]["email"].endswith("@example.test")
    assert len(payload["initial_state_hash"]) == 64
    assert first.headers["x-request-id"]


async def test_generation_rejects_unknown_scenario_and_unknown_fields(tmp_path: Path) -> None:
    transport = ASGITransport(app=integration_app(tmp_path))
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        unknown = await client.post(
            "/api/v1/scenarios/unknown/versions/v1/generations",
            headers={"Idempotency-Key": "unknown-scenario"},
            json={"seed": 1},
        )
        invalid = await client.post(
            "/api/v1/scenarios/retail-profile/versions/v1/generations",
            headers={"Idempotency-Key": "unknown-field"},
            json={"seed": 1, "unexpected": "rejected"},
        )
        whitespace_key = await client.post(
            "/api/v1/scenarios/retail-profile/versions/v1/generations",
            headers={"Idempotency-Key": " padded "},
            json={"seed": 1},
        )
        missing_generation = await client.get(
            "/api/v1/scenarios/retail-profile/versions/v1/generations/999"
        )

    assert unknown.status_code == 404
    assert unknown.json()["code"] == "scenario_not_found"
    assert unknown.json()["request_id"] == unknown.headers["x-request-id"]
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "validation_error"
    assert invalid.json()["details"][0]["location"] == "body.unexpected"
    assert whitespace_key.status_code == 422
    assert whitespace_key.json()["code"] == "validation_error"
    assert missing_generation.status_code == 404
    assert missing_generation.json()["code"] == "generated_scenario_not_found"


async def test_generation_rejects_idempotency_key_reuse_for_other_inputs(
    tmp_path: Path,
) -> None:
    transport = ASGITransport(app=integration_app(tmp_path))
    path = "/api/v1/scenarios/retail-profile/versions/v1/generations"
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            path,
            headers={"Idempotency-Key": "same-key"},
            json={"seed": 1},
        )
        conflict = await client.post(
            path,
            headers={"Idempotency-Key": "same-key"},
            json={"seed": 2},
        )

    assert created.status_code == 201
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "idempotency_conflict"


async def test_api_keeps_two_scenario_versions_independently_retrievable(
    tmp_path: Path,
) -> None:
    version_two = ScenarioDefinition(
        scenario_id="retail-profile",
        scenario_version="v2",
        policy_set_version="v2",
        canonical_schema_version="v1",
    )

    def generate_version_two(
        definition: ScenarioDefinition,
        seed: int,
    ) -> CanonicalInitialState:
        generated = generate_retail_profile_v1(RETAIL_PROFILE_V1, seed)
        return replace(generated, definition=definition)

    kernel = ScenarioGenerationKernel(
        ScenarioRegistry((RETAIL_PROFILE_V1, version_two)),
        {
            ("retail-profile", "v1"): generate_retail_profile_v1,
            ("retail-profile", "v2"): generate_version_two,
        },
        FixedClock(),
    )
    engine = create_database_engine(f"sqlite:///{tmp_path / 'versions.db'}")
    Base.metadata.create_all(engine)
    application = create_app(
        session_factory=create_session_factory(engine),
        generation_kernel=kernel,
    )
    transport = ASGITransport(app=application)
    base_path = "/api/v1/scenarios/retail-profile/versions"
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.post(
            f"{base_path}/v1/generations",
            headers={"Idempotency-Key": "version-one"},
            json={"seed": 1},
        )
        second = await client.post(
            f"{base_path}/v2/generations",
            headers={"Idempotency-Key": "version-two"},
            json={"seed": 1},
        )
        first_retrieved = await client.get(f"{base_path}/v1/generations/1")
        second_retrieved = await client.get(f"{base_path}/v2/generations/1")

    assert first.status_code == second.status_code == 201
    assert first_retrieved.json()["metadata"]["scenario_version"] == "v1"
    assert first_retrieved.json()["metadata"]["policy_set_version"] == "v1"
    assert second_retrieved.json()["metadata"]["scenario_version"] == "v2"
    assert second_retrieved.json()["metadata"]["policy_set_version"] == "v2"


async def test_unexpected_persistence_error_uses_structured_error_contract(
    tmp_path: Path,
) -> None:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'integrity-error.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    application = create_app(
        session_factory=factory,
        generation_kernel=create_retail_profile_kernel(FixedClock()),
        command_clock=FixedClock(),
    )
    transport = ASGITransport(app=application, raise_app_exceptions=False)
    path = "/api/v1/scenarios/retail-profile/versions/v1/generations"
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            path,
            headers={"Idempotency-Key": "tampered-state"},
            json={"seed": 1234},
        )
        product_id = created.json()["initial_state"]["products"][0]["id"]
        with factory() as session:
            product = session.get(ProductModel, product_id)
            assert product is not None
            product.name = "Tampered outside the aggregate"
            session.commit()
        response = await client.get(
            f"{path}/1234",
            headers={"Origin": "http://localhost:5173"},
        )

    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"
    assert response.json()["message"] == "An internal server error occurred"
    assert response.json()["request_id"] == response.headers["x-request-id"]
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


async def test_generated_entity_conflict_returns_cors_visible_409(tmp_path: Path) -> None:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'entity-conflict.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    kernel = create_retail_profile_kernel(FixedClock())
    generated = kernel.generate("retail-profile", "v1", 1234)
    product = generated.state.products[0]
    with factory() as session:
        session.add(
            ProductModel(
                id=str(product.id),
                sku=product.sku,
                name="Conflicting product state",
                price_amount=product.price_amount,
                currency=product.currency,
            )
        )
        session.commit()
    application = create_app(
        session_factory=factory,
        generation_kernel=kernel,
        command_clock=FixedClock(),
    )
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/scenarios/retail-profile/versions/v1/generations",
            headers={
                "Idempotency-Key": "entity-conflict",
                "Origin": "http://localhost:5173",
            },
            json={"seed": 1234},
        )

    assert response.status_code == 409
    assert response.json()["code"] == "generated_scenario_conflict"
    assert response.json()["request_id"] == response.headers["x-request-id"]
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


async def test_concurrent_same_key_generation_replays_one_result(tmp_path: Path) -> None:
    transport = ASGITransport(app=integration_app(tmp_path))
    path = "/api/v1/scenarios/retail-profile/versions/v1/generations"
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        first, second = await asyncio.gather(
            client.post(
                path,
                headers={"Idempotency-Key": "concurrent-generation"},
                json={"seed": 77},
            ),
            client.post(
                path,
                headers={"Idempotency-Key": "concurrent-generation"},
                json={"seed": 77},
            ),
        )

    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()


async def test_new_idempotency_key_records_command_time_for_existing_state(
    tmp_path: Path,
) -> None:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'command-time.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    january = datetime(2026, 1, 1, tzinfo=UTC)
    august = datetime(2026, 8, 16, tzinfo=UTC)
    clock = MutableClock(january)
    application = create_app(
        session_factory=factory,
        generation_kernel=create_retail_profile_kernel(clock),
        command_clock=clock,
    )
    transport = ASGITransport(app=application)
    path = "/api/v1/scenarios/retail-profile/versions/v1/generations"
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.post(
            path,
            headers={"Idempotency-Key": "key-january"},
            json={"seed": 45},
        )
        clock.value = august
        second = await client.post(
            path,
            headers={"Idempotency-Key": "key-august"},
            json={"seed": 45},
        )

    assert first.status_code == second.status_code == 201
    with factory() as session:
        january_record = session.get(
            IdempotencyRecordModel,
            ("key-january", "generate_scenario_v1"),
        )
        august_record = session.get(
            IdempotencyRecordModel,
            ("key-august", "generate_scenario_v1"),
        )
        assert january_record is not None
        assert august_record is not None
        assert january_record.created_at == january
        assert august_record.created_at == august


async def test_support_conversation_starts_sends_and_resumes_with_neutral_contract(
    tmp_path: Path,
) -> None:
    transport = ASGITransport(app=integration_app(tmp_path))
    generation_path = "/api/v1/scenarios/retail-profile/versions/v1/generations"
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        frameworks = await client.get("/api/v1/agent-frameworks")
        generated = await client.post(
            generation_path,
            headers={"Idempotency-Key": "support-state"},
            json={"seed": 1234},
        )
        started = await client.post(
            "/api/v1/conversations",
            headers={"Idempotency-Key": "support-session"},
            json={
                "scenario_id": "retail-profile",
                "scenario_version": "v1",
                "seed": 1234,
                "framework_id": "fake",
            },
        )
        replayed_start = await client.post(
            "/api/v1/conversations",
            headers={"Idempotency-Key": "support-session"},
            json={
                "scenario_id": "retail-profile",
                "scenario_version": "v1",
                "seed": 1234,
                "framework_id": "fake",
            },
        )
        session_id = started.json()["id"]
        read_only_order = generated.json()["initial_state"]["orders"][0]
        refused_action = await client.post(
            f"/api/v1/conversations/{session_id}/actions/proposals",
            headers={"Idempotency-Key": "read-only-action"},
            json={
                "action_type": "cancel_order",
                "order_id": read_only_order["id"],
                "expected_version": read_only_order["version"],
            },
        )
        sent = await client.post(
            f"/api/v1/conversations/{session_id}/messages",
            headers={"Idempotency-Key": "support-turn-1"},
            json={"message": "What orders and products are on my account?"},
        )
        replayed_turn = await client.post(
            f"/api/v1/conversations/{session_id}/messages",
            headers={"Idempotency-Key": "support-turn-1"},
            json={"message": "What orders and products are on my account?"},
        )
        resumed = await client.get(f"/api/v1/conversations/{session_id}")

    assert frameworks.status_code == 200
    declarations = {item["framework_id"]: item for item in frameworks.json()["frameworks"]}
    assert declarations["fake"]["available"] is True
    assert "tool_calls" in declarations["fake"]["capabilities"]
    assert declarations["pydantic-ai"]["available"] is True
    assert generated.status_code == 201
    assert started.status_code == replayed_start.status_code == 201
    assert started.json() == replayed_start.json()
    assert refused_action.status_code == 422
    assert refused_action.json()["code"] == "action_refused"
    assert sent.status_code == replayed_turn.status_code == 200
    assert sent.json() == replayed_turn.json() == resumed.json()
    payload = sent.json()
    assert payload["framework_id"] == "fake"
    assert payload["initial_state_hash"] == generated.json()["initial_state_hash"]
    assert len(payload["turns"]) == 1
    turn = payload["turns"][0]
    assert turn["response_message"]
    assert turn["structured_result"]["customer_id"] == payload["customer_id"]
    assert {activity["tool_name"] for activity in turn["tool_activity"]} == {
        "read_customer",
        "list_products",
        "list_customer_orders",
    }
    assert len(turn["trace_id"]) == 32


async def test_confirmed_order_cancellation_is_safe_idempotent_and_preserves_replay_state(
    tmp_path: Path,
) -> None:
    transport = ASGITransport(app=integration_app(tmp_path))
    generation_path = "/api/v1/scenarios/retail-order-cancellation/versions/v1/generations"
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        generated = await client.post(
            generation_path,
            headers={"Idempotency-Key": "action-state"},
            json={"seed": 3300},
        )
        order = generated.json()["initial_state"]["orders"][0]
        started = await client.post(
            "/api/v1/conversations",
            headers={"Idempotency-Key": "action-session"},
            json={
                "scenario_id": "retail-order-cancellation",
                "scenario_version": "v1",
                "seed": 3300,
                "framework_id": "fake",
            },
        )
        session_id = started.json()["id"]
        proposal_path = f"/api/v1/conversations/{session_id}/actions/proposals"
        proposed = await client.post(
            proposal_path,
            headers={"Idempotency-Key": "cancel-proposal"},
            json={
                "action_type": "cancel_order",
                "order_id": order["id"],
                "expected_version": order["version"],
            },
        )
        replayed_proposal = await client.post(
            proposal_path,
            headers={"Idempotency-Key": "cancel-proposal"},
            json={
                "action_type": "cancel_order",
                "order_id": order["id"],
                "expected_version": order["version"],
            },
        )
        proposal = proposed.json()
        decision_path = f"/api/v1/conversations/{session_id}/actions/{proposal['id']}/decision"
        wrong_confirmation = await client.post(
            decision_path,
            headers={"Idempotency-Key": "wrong-confirmation"},
            json={"decision": "confirm", "confirmation_token": "0" * 64},
        )
        confirmed = await client.post(
            decision_path,
            headers={"Idempotency-Key": "exact-confirmation"},
            json={
                "decision": "confirm",
                "confirmation_token": proposal["confirmation_token"],
            },
        )
        execution_path = f"/api/v1/conversations/{session_id}/actions/{proposal['id']}/execution"
        executed = await client.post(
            execution_path,
            headers={"Idempotency-Key": "cancel-execution"},
        )
        replayed_execution = await client.post(
            execution_path,
            headers={"Idempotency-Key": "cancel-execution"},
        )
        initial_state = await client.get(f"{generation_path}/3300")
        support = await client.post(
            f"/api/v1/conversations/{session_id}/messages",
            headers={"Idempotency-Key": "post-action-support"},
            json={"message": "What is the current order status?"},
        )
        refused = await client.post(
            proposal_path,
            headers={"Idempotency-Key": "cancel-again"},
            json={
                "action_type": "cancel_order",
                "order_id": order["id"],
                "expected_version": order["version"] + 1,
            },
        )

    assert proposed.status_code == replayed_proposal.status_code == 201
    assert proposal["status"] == replayed_proposal.json()["status"] == "proposed"
    assert proposal["tool_name"] == "cancel_order"
    assert proposal["tool_version"] == "v1"
    assert len(proposal["trace_id"]) == 32
    assert wrong_confirmation.status_code == 422
    assert wrong_confirmation.json()["code"] == "action_confirmation_required"
    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "confirmed"
    assert executed.status_code == replayed_execution.status_code == 200
    assert executed.json()["status"] == replayed_execution.json()["status"] == "executed"
    assert executed.json()["result_order_status"] == "cancelled"
    assert executed.json()["result_order_version"] == order["version"] + 1
    assert executed.json()["attempts"] == 1
    assert initial_state.json()["initial_state"]["orders"][0] == order
    order_activity = next(
        activity
        for activity in support.json()["turns"][-1]["tool_activity"]
        if activity["tool_name"] == "list_customer_orders"
    )
    assert order_activity["result"]["orders"][0]["status"] == "cancelled"
    assert order_activity["result"]["orders"][0]["version"] == order["version"] + 1
    assert refused.status_code == 422
    assert refused.json()["code"] == "action_refused"


async def test_order_action_exposes_cancellation_refusal_and_stale_conflict(tmp_path: Path) -> None:
    transport = ASGITransport(app=integration_app(tmp_path))
    generation_path = "/api/v1/scenarios/retail-order-cancellation/versions/v1/generations"
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        generated = await client.post(
            generation_path,
            headers={"Idempotency-Key": "cancelled-proposal-state"},
            json={"seed": 4400},
        )
        order = generated.json()["initial_state"]["orders"][0]
        started = await client.post(
            "/api/v1/conversations",
            headers={"Idempotency-Key": "cancelled-proposal-session"},
            json={
                "scenario_id": "retail-order-cancellation",
                "scenario_version": "v1",
                "seed": 4400,
                "framework_id": "fake",
            },
        )
        session_id = started.json()["id"]
        proposal_path = f"/api/v1/conversations/{session_id}/actions/proposals"
        proposed = await client.post(
            proposal_path,
            headers={"Idempotency-Key": "cancelled-proposal"},
            json={
                "action_type": "cancel_order",
                "order_id": order["id"],
                "expected_version": 1,
            },
        )
        proposal = proposed.json()
        decision_path = f"/api/v1/conversations/{session_id}/actions/{proposal['id']}/decision"
        cancelled = await client.post(
            decision_path,
            headers={"Idempotency-Key": "declined-action"},
            json={"decision": "cancel"},
        )
        replayed_cancel = await client.post(
            decision_path,
            headers={"Idempotency-Key": "declined-action"},
            json={"decision": "cancel"},
        )
        changed_decision = await client.post(
            decision_path,
            headers={"Idempotency-Key": "declined-action"},
            json={
                "decision": "confirm",
                "confirmation_token": proposal["confirmation_token"],
            },
        )
        unconfirmed_execution = await client.post(
            f"/api/v1/conversations/{session_id}/actions/{proposal['id']}/execution",
            headers={"Idempotency-Key": "declined-execution"},
        )
        stale = await client.post(
            proposal_path,
            headers={"Idempotency-Key": "stale-action"},
            json={
                "action_type": "cancel_order",
                "order_id": order["id"],
                "expected_version": 2,
            },
        )

    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert replayed_cancel.status_code == 200
    assert replayed_cancel.json()["status"] == "cancelled"
    assert changed_decision.status_code == 409
    assert changed_decision.json()["code"] == "action_conflict"
    assert unconfirmed_execution.status_code == 422
    assert unconfirmed_execution.json()["code"] == "action_confirmation_required"
    assert stale.status_code == 409
    assert stale.json()["code"] == "action_conflict"


async def test_transient_order_write_retries_without_duplicate_cancellation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_save = SqlAlchemyOrderRepository.save
    calls = 0

    def flaky_save(
        repository: SqlAlchemyOrderRepository,
        order: Order,
        *,
        expected_version: int,
        idempotency_key: str,
    ) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise OrderWriteTransientError("offline transient failure")
        original_save(
            repository,
            order,
            expected_version=expected_version,
            idempotency_key=idempotency_key,
        )

    monkeypatch.setattr(SqlAlchemyOrderRepository, "save", flaky_save)
    transport = ASGITransport(app=integration_app(tmp_path))
    generation_path = "/api/v1/scenarios/retail-order-cancellation/versions/v1/generations"
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        generated = await client.post(
            generation_path,
            headers={"Idempotency-Key": "retry-state"},
            json={"seed": 5500},
        )
        order = generated.json()["initial_state"]["orders"][0]
        started = await client.post(
            "/api/v1/conversations",
            headers={"Idempotency-Key": "retry-session"},
            json={
                "scenario_id": "retail-order-cancellation",
                "scenario_version": "v1",
                "seed": 5500,
                "framework_id": "fake",
            },
        )
        session_id = started.json()["id"]
        proposed = await client.post(
            f"/api/v1/conversations/{session_id}/actions/proposals",
            headers={"Idempotency-Key": "retry-proposal"},
            json={
                "action_type": "cancel_order",
                "order_id": order["id"],
                "expected_version": 1,
            },
        )
        proposal = proposed.json()
        await client.post(
            f"/api/v1/conversations/{session_id}/actions/{proposal['id']}/decision",
            headers={"Idempotency-Key": "retry-confirmation"},
            json={
                "decision": "confirm",
                "confirmation_token": proposal["confirmation_token"],
            },
        )
        executed = await client.post(
            f"/api/v1/conversations/{session_id}/actions/{proposal['id']}/execution",
            headers={"Idempotency-Key": "retry-execution"},
        )

    assert executed.status_code == 200
    assert executed.json()["status"] == "executed"
    assert executed.json()["attempts"] == 2
    assert executed.json()["result_order_version"] == 2
    assert calls == 2


async def test_support_conversation_rejects_missing_state_and_idempotency_reuse(
    tmp_path: Path,
) -> None:
    transport = ASGITransport(app=integration_app(tmp_path))
    command = {
        "scenario_id": "retail-profile",
        "scenario_version": "v1",
        "seed": 7,
        "framework_id": "fake",
    }
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        missing = await client.post(
            "/api/v1/conversations",
            headers={"Idempotency-Key": "missing-state"},
            json=command,
        )
        await client.post(
            "/api/v1/scenarios/retail-profile/versions/v1/generations",
            headers={"Idempotency-Key": "state-seven"},
            json={"seed": 7},
        )
        started = await client.post(
            "/api/v1/conversations",
            headers={"Idempotency-Key": "reused-conversation"},
            json=command,
        )
        conflict = await client.post(
            "/api/v1/conversations",
            headers={"Idempotency-Key": "reused-conversation"},
            json={**command, "framework_id": "pydantic-ai"},
        )
        session_id = started.json()["id"]
        first_turn = await client.post(
            f"/api/v1/conversations/{session_id}/messages",
            headers={"Idempotency-Key": "reused-turn"},
            json={"message": "First normalized question"},
        )
        turn_conflict = await client.post(
            f"/api/v1/conversations/{session_id}/messages",
            headers={"Idempotency-Key": "reused-turn"},
            json={"message": "Different question"},
        )

    assert missing.status_code == 404
    assert started.status_code == 201
    assert first_turn.status_code == 200
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "conversation_conflict"
    assert turn_conflict.status_code == 409
    assert turn_conflict.json()["code"] == "conversation_conflict"


def test_conversation_turn_repository_translates_advanced_ordinal_conflict(
    tmp_path: Path,
) -> None:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'turn-conflict.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    generated = create_retail_profile_kernel(FixedClock()).generate(
        "retail-profile",
        "v1",
        1234,
    )
    session_id = UUID("10000000-0000-4000-8000-000000000000")
    response = AgentResponse(
        message="A grounded answer",
        structured_result=StructuredSupportResult(
            summary="Account summary",
            customer_id=generated.state.customer.id,
            product_ids=(),
            order_ids=(),
        ),
        tool_activity=(),
    )

    with factory() as database_session:
        SqlAlchemyGeneratedScenarioRepository(database_session).save(generated)
        SqlAlchemySessionRepository(database_session).save(
            ConversationSession(
                id=session_id,
                customer_id=generated.state.customer.id,
                seed=generated.metadata.seed,
                scenario_id=generated.metadata.scenario_id,
                scenario_version=generated.metadata.scenario_version,
                framework_id="fake",
                initial_state_hash=generated.initial_state_hash,
                created_at=FixedClock().now(),
            )
        )
        turns = SqlAlchemyConversationTurnRepository(database_session)
        turns.save(
            ConversationTurn(
                id=UUID("20000000-0000-4000-8000-000000000001"),
                session_id=session_id,
                ordinal=1,
                request_message="First message",
                response=response,
                created_at=FixedClock().now(),
            )
        )

        with pytest.raises(
            ConversationTurnConflictError,
            match=f"conversation {session_id} advanced past ordinal 1",
        ):
            turns.save(
                ConversationTurn(
                    id=UUID("20000000-0000-4000-8000-000000000002"),
                    session_id=session_id,
                    ordinal=1,
                    request_message="Concurrent message",
                    response=response,
                    created_at=FixedClock().now(),
                )
            )


async def test_advanced_conversation_turn_is_a_retryable_conflict(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    application = integration_app(tmp_path)
    transport = ASGITransport(app=application)
    generation_path = "/api/v1/scenarios/retail-profile/versions/v1/generations"
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post(
            generation_path,
            headers={"Idempotency-Key": "advanced-turn-state"},
            json={"seed": 81},
        )
        started = await client.post(
            "/api/v1/conversations",
            headers={"Idempotency-Key": "advanced-turn-session"},
            json={
                "scenario_id": "retail-profile",
                "scenario_version": "v1",
                "seed": 81,
                "framework_id": "fake",
            },
        )

        def reject_advanced_turn(
            _repository: SqlAlchemyConversationTurnRepository,
            turn: ConversationTurn,
        ) -> None:
            raise ConversationTurnConflictError(
                f"conversation {turn.session_id} advanced past ordinal {turn.ordinal}"
            )

        monkeypatch.setattr(
            SqlAlchemyConversationTurnRepository,
            "save",
            reject_advanced_turn,
        )
        conflict = await client.post(
            f"/api/v1/conversations/{started.json()['id']}/messages",
            headers={"Idempotency-Key": "advanced-turn-message"},
            json={"message": "What is on my account?"},
        )

    assert conflict.status_code == 409
    assert conflict.json()["code"] == "conversation_advanced"
    assert "retry" in conflict.json()["message"]
