"""Public contract for starting an experiment, reading it, and driving its arms."""

import logging
from collections.abc import AsyncGenerator, Generator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from unittest.mock import patch
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from api_factories import (
    OBJECTIVE_TEMPLATE,
    api_client,
    create_scenario,
    make_block,
    make_identity,
    publish_everything,
    scenario_body,
    seed_lab,
)
from capability_lab.application.agent_runtime import SupportAgentRuntimeRegistry
from capability_lab.application.judge_runs import ExperimentJudgeService
from capability_lab.application.judge_runtime import JudgeRuntimeRegistry
from capability_lab.application.model_connections import OPENAI_PROVIDER
from capability_lab.infrastructure.agents.fake import FakeSupportAgentRuntime
from capability_lab.infrastructure.config import get_settings
from capability_lab.infrastructure.credentials import CREDENTIAL_KEY_VARIABLE
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
)
from capability_lab.infrastructure.telemetry import Telemetry
from capability_lab.presentation import api as api_module
from capability_lab.presentation.api import create_app

SEED = 20260825
CONFIGURATIONS = "/api/v1/agent-configurations"
OLLAMA = "http://localhost:11434/v1"
VLLM = "http://localhost:8000/v1"
SWEPT_KEY = "sk-swept-4a7e1c93b06d45f2ae8c27d150936bf4"
"""A key saved, resolved and composed against while the sweep below watches everything."""
PROMPT = (
    "You are {{support_identity.role}} for {{shop.name}}.\n\n"
    "Write in the shop's tone of voice: {{shop.tone_of_voice}}."
)


class _ReachingRuntime(FakeSupportAgentRuntime):
    """The control runtime, reporting an endpoint the way a model-backed one would.

    A subclass of the real control rather than a stub, so what this suite drives through the
    HTTP boundary is the runner's own path with one fact changed: where the arm reached.
    """

    def __init__(self, model_base_url: str) -> None:
        self._model_base_url = model_base_url

    @property
    def model_base_url(self) -> str | None:
        return self._model_base_url


def _reaching(model_base_url: str) -> SupportAgentRuntimeRegistry:
    runtime = _ReachingRuntime(model_base_url)
    return SupportAgentRuntimeRegistry({runtime.framework_id: runtime})


@pytest.fixture
async def client(tmp_path: Path) -> AsyncGenerator[AsyncClient, None]:
    async with api_client(tmp_path, "experiment-api.db") as active:
        yield active


@pytest.fixture
async def lab(client: AsyncClient) -> dict[str, str]:
    return await seed_lab(client)


async def published_scenario(
    client: AsyncClient, lab: dict[str, str], **overrides: Any
) -> dict[str, Any]:
    await publish_everything(client, lab)
    scenario_id = await create_scenario(client, lab)
    saved = await client.put(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/draft",
        json={"payload": scenario_body(lab, **overrides)},
    )
    assert saved.status_code == 200, saved.text
    published = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/versions"
    )
    assert published.status_code == 201, published.text
    return {"scenario_id": scenario_id, "scenario_version": int(published.json()["version"])}


async def published_configuration(
    client: AsyncClient, identity: dict[str, Any] | None = None, **overrides: Any
) -> dict[str, Any]:
    """One published agent configuration, ready to be selected as an arm."""
    adopted = identity if identity is not None else await make_identity(client)
    created = await client.post(
        CONFIGURATIONS,
        json={
            "name": "Frontline single agent",
            "support_identity_id": adopted["support_identity_id"],
        },
    )
    assert created.status_code == 201, created.text
    configuration_id = str(created.json()["configuration_id"])
    draft = created.json()["content"]
    saved = await client.put(
        f"{CONFIGURATIONS}/{configuration_id}/draft",
        json={"payload": {**draft, "prompt": PROMPT, **overrides}},
    )
    assert saved.status_code == 200, saved.text
    published = await client.post(f"{CONFIGURATIONS}/{configuration_id}/versions")
    assert published.status_code == 201, published.text
    return {"configuration_id": configuration_id, "version": published.json()["version"]}


def start_body(scenario: dict[str, Any], *arms: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "label": "Framework comparison",
        **scenario,
        "seed": SEED,
        "arms": list(arms),
    }
    body.update(overrides)
    return body


async def start(client: AsyncClient, lab: dict[str, str], body: dict[str, Any]) -> dict[str, Any]:
    response = await client.post(f"/api/v1/shops/{lab['shop_id']}/experiments", json=body)
    assert response.status_code == 201, response.text
    return response.json()


async def two_arm_experiment(client: AsyncClient, lab: dict[str, str]) -> dict[str, Any]:
    scenario = await published_scenario(client, lab)
    identity = await make_identity(client)
    arms = (
        await published_configuration(client, identity),
        await published_configuration(client, identity),
    )
    return await start(client, lab, start_body(scenario, *arms))


# -- starting ------------------------------------------------------------------


async def test_starting_answers_with_both_arms_cloned_and_both_threads_open(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    body = await two_arm_experiment(client, lab)

    assert body["participant_driver"] == "human"
    assert body["canonical_schema_version"] == "experiment-v1"
    assert [run["label"] for run in body["runs"]] == ["Arm A", "Arm B"]
    assert {run["snapshot_fingerprint"] for run in body["runs"]} == {body["sandbox_fingerprint"]}
    assert len({run["state_fingerprint"] for run in body["runs"]}) == 1
    assert {turn["source"] for turn in body["turns"]} == {"trigger"}
    assert len({turn["turn_id"] for turn in body["turns"]}) == 1


async def test_the_response_separates_what_the_world_pinned_from_what_each_arm_runs(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    body = await two_arm_experiment(client, lab)

    shared = {entry["definition_type"] for entry in body["sandbox_inputs"]}

    assert "scenario" in shared
    assert "agent_configuration" not in shared
    assert [entry["definition_type"] for entry in body["arm_inputs"][0]] == [
        "agent_configuration",
        "support_identity",
    ]
    assert body["tool_contracts"]["orders.read_order"]


async def test_the_setup_matrix_reports_every_dimension(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario = await published_scenario(client, lab)
    identity = await make_identity(client)
    left = await published_configuration(client, identity)
    right = await published_configuration(
        client, identity, prompt="You are support for {{shop.name}}."
    )

    response = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments/preview",
        json=start_body(scenario, left, right),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["arm_labels"] == ["Arm A", "Arm B"]
    assert [row["dimension"] for row in body["comparison"] if row["differs"]] == ["prompt"]
    # A preview freezes nothing.
    listed = await client.get(f"/api/v1/shops/{lab['shop_id']}/experiments")
    assert listed.json()["experiments"] == []


async def test_a_tone_override_the_shop_does_not_publish_is_reported_as_a_finding(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario = await published_scenario(client, lab)
    arm = await published_configuration(
        client, tone_of_voice={"source": "override", "guideline_id": "never-authored"}
    )

    response = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments", json=start_body(scenario, arm)
    )

    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "experiment_not_startable"
    assert [issue["code"] for issue in body["issues"]] == ["tone_override_unknown_in_shop"]


async def test_an_arm_naming_an_unpublished_configuration_version_is_not_found(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario = await published_scenario(client, lab)
    arm = {**await published_configuration(client), "version": 99}

    response = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments", json=start_body(scenario, arm)
    )

    assert response.status_code == 404, response.text


async def test_a_preview_does_not_need_the_name_a_start_requires(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """An operator compares two configurations before deciding what to call the experiment.

    One request shape for both operations, so a preview judges what a start would run; the
    name is the one field they read differently, and the rule lives where starting happens.
    """
    scenario = await published_scenario(client, lab)
    arm = await published_configuration(client)
    unnamed = start_body(scenario, arm, label="")

    judged = await client.post(f"/api/v1/shops/{lab['shop_id']}/experiments/preview", json=unnamed)
    started = await client.post(f"/api/v1/shops/{lab['shop_id']}/experiments", json=unnamed)

    assert judged.status_code == 200, judged.text
    assert started.status_code == 422, started.text
    assert started.json()["code"] == "experiment_setup_invalid"


async def test_a_third_arm_is_refused_by_the_contract(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario = await published_scenario(client, lab)
    arm = await published_configuration(client)

    response = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments", json=start_body(scenario, arm, arm, arm)
    )

    assert response.status_code == 422, response.text


async def test_the_contract_refuses_an_unknown_field(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario = await published_scenario(client, lab)
    arm = await published_configuration(client)

    response = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments",
        json=start_body(scenario, arm, framework="pydantic-ai"),
    )

    assert response.status_code == 422, response.text


# -- driving -------------------------------------------------------------------


async def test_a_linked_turn_reaches_both_arms_as_one_composition(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)

    response = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        "/participant-turns",
        json={
            "run_ids": [run["run_id"] for run in experiment["runs"]],
            "message": "Any update on the address?",
        },
    )

    assert response.status_code == 201, response.text
    turns = response.json()["turns"]
    assert len({turn["turn_id"] for turn in turns}) == 1
    assert [turn["ordinal"] for turn in turns] == [1, 1]
    assert {turn["driver"] for turn in turns} == {"human"}


async def test_an_arm_specific_reply_is_a_composition_the_other_arm_never_received(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)
    arm_a = experiment["runs"][0]["run_id"]

    delivered = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        "/participant-turns",
        json={"run_ids": [arm_a], "message": "Only arm A hears this."},
    )
    assert delivered.status_code == 201, delivered.text

    read = await client.get(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
    )
    turns = read.json()["turns"]
    diverged = delivered.json()["turns"][0]["turn_id"]

    assert [turn["run_id"] for turn in turns if turn["turn_id"] == diverged] == [arm_a]


async def test_a_message_the_client_padded_is_accepted_and_recorded_trimmed(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The newline every raw client sends is padding, not a malformed request."""
    experiment = await two_arm_experiment(client, lab)

    response = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        "/participant-turns",
        json={
            "run_ids": [experiment["runs"][0]["run_id"]],
            "message": "  Any update on the address?\n",
        },
    )

    assert response.status_code == 201, response.text
    assert response.json()["turns"][0]["body"] == "Any update on the address?"


async def test_a_driver_the_experiment_did_not_record_says_which_mistake_it_is(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """A run recorded for a scripted participant cannot be driven by the human operator.

    Its own code rather than the unavailable one: "write something first" and "you are
    driving this run with the wrong participant" are different mistakes, and a client that
    could not tell them apart would retry the second forever.
    """
    scenario = await published_scenario(client, lab)
    arm = await published_configuration(client)
    experiment = await start(client, lab, start_body(scenario, arm, participant_driver="scripted"))

    response = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        "/participant-turns",
        json={"run_ids": [experiment["runs"][0]["run_id"]], "message": "Hello"},
    )

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "participant_driver_mismatch"


async def test_the_response_reports_the_schema_token_its_document_carries(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)

    read = await client.get(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
    )

    assert read.json()["canonical_schema_version"] == "experiment-v1"


async def test_an_empty_composition_is_refused_without_moving_the_run(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)

    response = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        "/participant-turns",
        json={"run_ids": [experiment["runs"][0]["run_id"]], "message": "   "},
    )

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "participant_turn_unavailable"
    read = await client.get(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
    )
    assert len(read.json()["turns"]) == 2


async def test_an_arm_of_another_experiment_is_not_found(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)

    response = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        "/participant-turns",
        json={"run_ids": [str(uuid4())], "message": "Hello"},
    )

    assert response.status_code == 404, response.text
    assert response.json()["code"] == "experiment_run_not_found"


# -- advancing an arm ----------------------------------------------------------


CONTROL_MODEL = {
    "provider": "fake",
    "model_id": "deterministic",
    "temperature": "0.20",
    "max_tool_rounds": 8,
}
EVERY_TOOL = [
    "interaction.read_context",
    "catalog.search_products",
    "catalog.read_product",
    "customer.read_profile",
    "orders.list_orders",
    "orders.read_order",
    "support.search_knowledge",
    "support.read_document",
    "orders.propose_address_change",
    "orders.apply_address_change",
]


async def control_arm(
    client: AsyncClient, identity: dict[str, Any] | None = None, **overrides: Any
) -> dict[str, Any]:
    """An arm the offline lab can actually run: the deterministic control framework."""
    return await published_configuration(
        client,
        identity,
        framework_id="fake",
        model=CONTROL_MODEL,
        tools=EVERY_TOOL,
        **overrides,
    )


async def control_experiment(client: AsyncClient, lab: dict[str, str]) -> dict[str, Any]:
    scenario = await published_scenario(client, lab)
    identity = await make_identity(client)
    arms = (await control_arm(client, identity), await control_arm(client, identity))
    return await start(client, lab, start_body(scenario, *arms))


async def advance(
    client: AsyncClient, lab: dict[str, str], experiment: dict[str, Any], arm: int = 0
) -> Any:
    return await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        f"/runs/{experiment['runs'][arm]['run_id']}/agent-turns"
    )


async def test_advancing_an_arm_answers_with_the_turn_and_the_calls_it_made(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_experiment(client, lab)

    response = await advance(client, lab, experiment)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["turn"]["ordinal"] == 0
    assert body["turn"]["attempt"] == 1
    assert body["turn"]["outcome"] == "answered"
    assert body["turn"]["failure"] is None
    assert [event["tool"] for event in body["tool_events"]] == [
        "interaction.read_context",
        "orders.read_order",
        "customer.read_profile",
        "orders.propose_address_change",
        "orders.apply_address_change",
    ]
    assert body["tool_events"][0]["result"]["canonical_schema_version"] == "tool-result-v1"


async def test_advancing_an_arm_answers_with_the_faults_that_fired_into_it(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """A refusal with no visible cause is the one thing a fault must never look like."""
    experiment = await control_experiment(client, lab)

    body = (await advance(client, lab, experiment)).json()

    assert [event["mutation_id"] for event in body["mutation_events"]] == [
        "order-moves-under-the-arm"
    ]
    fired = body["mutation_events"][0]
    assert fired["run_id"] == experiment["runs"][0]["run_id"]
    assert fired["effect"] == "entity_mutation"
    assert fired["timing"] == "after_first_read"
    assert fired["target"] == f"order:{lab['order_id']}"
    assert fired["after_calls"] == 2
    assert fired["revision_after"] == fired["revision_before"] + 1


async def test_an_experiment_reads_back_the_faults_its_arms_have_met(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_experiment(client, lab)
    await advance(client, lab, experiment)

    read = (
        await client.get(
            f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        )
    ).json()

    assert [event["run_id"] for event in read["mutation_events"]] == [
        experiment["runs"][0]["run_id"]
    ]
    assert read["mutation_events"][0]["block_version"] == 1


async def test_the_write_is_reported_as_the_state_change_it_is(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_experiment(client, lab)

    body = (await advance(client, lab, experiment)).json()

    applied = body["tool_events"][-1]
    assert applied["revision_after"] == applied["revision_before"] + 1
    assert applied["result"]["data"]["applied"] is True
    # And it moved this arm alone.
    read = (
        await client.get(
            f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        )
    ).json()
    # Two revisions on the advanced arm: the scenario's fault moved it once while the agent
    # was reading, and the agent's own write moved it again. The arm beside it has neither,
    # because a fault fires into the arm being advanced and no other.
    assert [run["revision"] for run in read["runs"]] == [2, 0]
    assert len({run["state_fingerprint"] for run in read["runs"]}) == 2


async def test_an_arm_reads_back_what_its_world_became_field_by_field(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The half of "verified, not claimed" a revision counter cannot say (ADR 0035)."""
    experiment = await control_experiment(client, lab)
    await advance(client, lab, experiment)

    read = (
        await client.get(
            f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        )
    ).json()

    advanced, untouched = read["runs"]
    moved = advanced["state_diff"]["orders"]
    assert [order["reference"] for order in moved] == ["NS-10482"]
    changes = {
        change["path"]: (change["before"], change["after"]) for change in moved[0]["changes"]
    }
    # The agent's own write: the stale Bordeaux copy replaced by the customer's default.
    assert changes["shipping_address.source_address_id"] == ("bordeaux-previous-flat", "home")
    assert changes["shipping_address.city"] == ("Bordeaux", "Lyon")
    # And the scenario's fault beside it, which no agent asked for and none was told about.
    assert changes["fulfilment.status"] == ("unfulfilled", "partially_fulfilled")
    # Nothing outside the orders moved, which is the claim the card makes.
    assert advanced["state_diff"]["other"] == []
    # The arm beside it is still in the world it was cloned into.
    assert untouched["state_diff"] == {"orders": [], "other": []}


async def test_an_experiment_reads_back_both_sides_of_its_threads(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_experiment(client, lab)
    await advance(client, lab, experiment)

    body = (
        await client.get(
            f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        )
    ).json()

    assert len(body["turns"]) == 2
    assert [turn["ordinal"] for turn in body["agent_turns"]] == [0]
    assert body["agent_turns"][0]["run_id"] == experiment["runs"][0]["run_id"]
    assert len(body["tool_events"]) == 5


async def test_advancing_an_answered_arm_returns_the_same_turn(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """Idempotent over an answer: a second advance must not cost a second model call."""
    experiment = await control_experiment(client, lab)

    first = (await advance(client, lab, experiment)).json()
    again = (await advance(client, lab, experiment)).json()

    assert again["turn"] == first["turn"]
    assert len(again["tool_events"]) == len(first["tool_events"])


async def test_a_framework_this_lab_cannot_run_is_refused_before_anything_is_recorded(
    tmp_path: Path,
) -> None:
    """A lab with no model provider configured can still run its control arm, and only that.

    422 and no recorded turn: an arm this process cannot run is a fact about the process,
    and writing it into the run's evidence would put the operator's machine into a
    comparison.
    """
    control = FakeSupportAgentRuntime()
    async with api_client(
        tmp_path,
        "offline-lab.db",
        agent_runtimes=SupportAgentRuntimeRegistry({control.framework_id: control}),
    ) as offline:
        lab = await seed_lab(offline)
        scenario = await published_scenario(offline, lab)
        experiment = await start(
            offline, lab, start_body(scenario, await published_configuration(offline))
        )

        response = await advance(offline, lab, experiment)

        assert response.status_code == 422, response.text
        assert response.json()["code"] == "agent_runtime_unavailable"
        read = await offline.get(
            f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        )
        assert read.json()["agent_turns"] == []


async def test_an_advance_that_would_reach_another_endpoint_is_refused_naming_both(
    tmp_path: Path,
) -> None:
    """Two processes over one database, pointed at two endpoints, one after the other.

    Two `create_app` calls rather than one, because that is the shape of what happens: a lab
    is repointed, and the arm it produced yesterday is advanced today. The refusal names both
    endpoints, records no turn, and leaves the arm advanceable against the one it was
    produced on (ADR 0052).
    """
    database = "repointed-lab.db"
    async with api_client(tmp_path, database, agent_runtimes=_reaching(OLLAMA)) as first:
        lab = await seed_lab(first)
        scenario = await published_scenario(first, lab)
        identity = await make_identity(first)
        experiment = await start(
            first, lab, start_body(scenario, await control_arm(first, identity))
        )
        opened = await advance(first, lab, experiment)
        assert opened.status_code == 201, opened.text
        delivered = await first.post(
            f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
            "/participant-turns",
            json={
                "run_ids": [experiment["runs"][0]["run_id"]],
                "message": "Any update on the address?",
            },
        )
        assert delivered.status_code == 201, delivered.text

    async with api_client(tmp_path, database, agent_runtimes=_reaching(VLLM)) as repointed:
        refused = await advance(repointed, lab, experiment)
        read = await repointed.get(
            f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        )

    assert refused.status_code == 422, refused.text
    assert refused.json()["code"] == "model_endpoint_mismatch"
    assert OLLAMA in refused.json()["message"]
    assert VLLM in refused.json()["message"]
    # One attempt, from before the lab was repointed: the refusal recorded nothing.
    assert len(read.json()["agent_turns"]) == 1


async def test_no_log_line_span_or_error_payload_carries_the_key_an_advance_resolved(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """ADR 0052's sweep, extended to the two paths this slice added (`test_model_connection_api`
    holds the original).

    That sweep walks the four `model-connections` routes, where a key travels *inwards* and
    the lab decides what to say back. It could not reach these two, because neither existed:
    `GET /lab-status` now resolves the connection to answer, and every advance decrypts the
    stored key into a `ResolvedConnection` before it composes anything. That object is the
    only structure in the lab holding a **decrypted** key — `Settings` keeps both of its
    secrets in `SecretStr` precisely so a repr cannot print one — so the rule has to be held
    where the plaintext now lives rather than only where it arrived.

    The haystack is asserted to be real before it is asserted to be clean: the endpoint, which
    this lab *may* say, has to be findable in it.
    """
    monkeypatch.setenv(CREDENTIAL_KEY_VARIABLE, "qO8yb2Xr7TgPzKw1LmN4vC6sDhF0jEuAiRlYpZ3aBtQ=")
    get_settings.cache_clear()

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    engine = create_database_engine(f"sqlite:///{tmp_path / 'swept-advance.db'}")
    Base.metadata.create_all(engine)
    application = create_app(
        session_factory=create_session_factory(engine),
        telemetry=Telemetry(provider.get_tracer("sweep"), b"sweep-salt"),
    )

    with caplog.at_level(logging.DEBUG):
        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="http://lab.test"
        ) as client:
            lab = await seed_lab(client)
            scenario = await published_scenario(client, lab)
            experiment = await start(client, lab, start_body(scenario, await control_arm(client)))
            bodies = [
                (
                    await client.put(
                        f"/api/v1/model-connections/{OPENAI_PROVIDER}",
                        json={"base_url": OLLAMA, "api_key": SWEPT_KEY},
                    )
                ).text,
                (await client.get("/api/v1/lab-status")).text,
                (await client.get("/api/v1/agent-frameworks")).text,
                (await advance(client, lab, experiment)).text,
                # Advanced twice: the second one resolves the saved connection again and
                # takes the already-answered path, so both branches of the advance are swept.
                (await advance(client, lab, experiment)).text,
                (
                    await client.get(
                        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
                    )
                ).text,
            ]

    with engine.connect() as connection:
        ciphertext = str(
            connection.execute(text("SELECT encrypted_key FROM model_connections")).scalar()
        )

    swept = "\n".join(
        [
            *bodies,
            # `format` rather than `getMessage`: a record carrying `exc_info` renders its
            # traceback only through a formatter, and a credential reaching a log by way of a
            # repr in an exception is exactly the path a message-only sweep would walk past.
            *(
                logging.Formatter("%(name)s %(levelname)s %(message)s").format(record)
                for record in caplog.records
            ),
            repr(
                [
                    (span.name, span.attributes, span.events)
                    for span in exporter.get_finished_spans()
                ]
            ),
        ]
    )

    # One guard per haystack. The endpoint is echoed by the save, so finding it proves the
    # *bodies* were read and nothing at all about the other two — a change that silenced
    # logging or dropped the span processor would hollow out two-thirds of this sweep while
    # it went on passing.
    assert OLLAMA in swept, "no response body was read, so the bodies prove nothing"
    assert caplog.records, "no log record was captured, so the log dimension proves nothing"
    assert exporter.get_finished_spans(), "no span was exported, so the spans prove nothing"
    assert ciphertext and ciphertext != "None"
    assert SWEPT_KEY not in swept
    assert ciphertext not in swept
    for length in (6, 8, 12, 16):
        assert SWEPT_KEY[:length] not in swept
        assert SWEPT_KEY[-length:] not in swept


async def test_an_arm_of_another_experiment_cannot_be_advanced(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_experiment(client, lab)

    response = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        f"/runs/{uuid4()}/agent-turns"
    )

    assert response.status_code == 404, response.text
    assert response.json()["code"] == "experiment_run_not_found"


# -- reading -------------------------------------------------------------------


async def test_a_shop_lists_its_experiments_and_another_shop_does_not_see_them(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)

    listed = await client.get(f"/api/v1/shops/{lab['shop_id']}/experiments")
    elsewhere = await client.get(f"/api/v1/shops/{uuid4()}/experiments")

    assert [row["experiment_id"] for row in listed.json()["experiments"]] == [
        experiment["experiment_id"]
    ]
    assert elsewhere.json()["experiments"] == []


async def test_an_experiment_of_another_shop_is_not_found(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)

    response = await client.get(
        f"/api/v1/shops/{uuid4()}/experiments/{experiment['experiment_id']}"
    )

    assert response.status_code == 404, response.text
    assert response.json()["code"] == "experiment_not_found"


# -- the execution timeline ----------------------------------------------------


async def timeline(client: AsyncClient, lab: dict[str, str], experiment: dict[str, Any]) -> Any:
    return await client.get(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}/timeline"
    )


async def test_the_timeline_reports_one_arm_s_execution_in_the_order_it_happened(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_experiment(client, lab)
    await advance(client, lab, experiment)

    response = await timeline(client, lab, experiment)

    assert response.status_code == 200, response.text
    entries = response.json()["entries"]
    # The fault sits where it fired: after the read that made it due, and before the call the
    # agent asked next against the world it left behind.
    assert [entry["kind"] for entry in entries] == [
        "trigger",
        *["tool_call"] * 2,
        "mutation",
        *["tool_call"] * 3,
        "agent_turn",
    ]
    assert entries[0]["run_ids"] == [run["run_id"] for run in experiment["runs"]]
    applied = entries[6]
    assert applied["tool"] == "orders.apply_address_change"
    assert applied["categories"] == ["tool", "state"]
    assert applied["revision_after"] == applied["revision_before"] + 1


async def test_every_entry_names_the_project_owned_code_that_ran_it(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """Resolved from the recorded event, and never a path outside this project."""
    experiment = await control_experiment(client, lab)
    await advance(client, lab, experiment)

    entries = (await timeline(client, lab, experiment)).json()["entries"]

    located = [entry for entry in entries if entry["kind"] != "trigger"]
    assert located
    for entry in located:
        assert entry["source"] is not None, entry["kind"]
        assert entry["source"]["path"].startswith("capability_lab/")
        assert entry["source"]["line"] > 0


async def test_the_timeline_carries_no_message_body(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """What was said is the thread's; this stream is what happened.

    Checked against the response rather than the projection, because the contract is what a
    judge, an export, and a future evaluation will actually read.
    """
    experiment = await control_experiment(client, lab)
    await advance(client, lab, experiment)

    rendered = (await timeline(client, lab, experiment)).text

    assert "NS-10482" not in rendered
    assert "Lyon" not in rendered


async def test_a_timeline_for_an_experiment_of_another_shop_is_not_found(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)

    response = await client.get(
        f"/api/v1/shops/{uuid4()}/experiments/{experiment['experiment_id']}/timeline"
    )

    assert response.status_code == 404, response.text
    assert response.json()["code"] == "experiment_not_found"


# -- the recorded traces -------------------------------------------------------


async def traces(client: AsyncClient, lab: dict[str, str], experiment: dict[str, Any]) -> Any:
    return await client.get(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}/traces"
    )


async def test_an_advance_records_the_span_tree_of_the_attempt_it_made(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The root, the framework's turn inside it, and one span per call it made."""
    experiment = await control_experiment(client, lab)
    await advance(client, lab, experiment)

    response = await traces(client, lab, experiment)

    assert response.status_code == 200, response.text
    (trace,) = response.json()["traces"]
    assert trace["outcome"] == "answered"
    assert len(trace["trace_id"]) == 32
    assert trace["arm_label"] == experiment["runs"][0]["label"]
    kinds = [span["kind"] for span in trace["spans"]]
    assert kinds[:2] == ["attempt", "runtime"]
    assert set(kinds[2:]) == {"tool"}
    assert trace["spans"][0]["parent_span_id"] is None
    assert trace["spans"][1]["parent_span_id"] == trace["spans"][0]["span_id"]
    assert [span["tool"] for span in trace["spans"][2:]] == [
        "interaction.read_context",
        "orders.read_order",
        "customer.read_profile",
        "orders.propose_address_change",
        "orders.apply_address_change",
    ]


async def test_a_traced_call_says_where_inside_the_attempt_it_ran(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The fact the record cannot supply: an attempt and its calls share one clock reading."""
    experiment = await control_experiment(client, lab)
    await advance(client, lab, experiment)

    (trace,) = (await traces(client, lab, experiment)).json()["traces"]

    calls = [span for span in trace["spans"] if span["kind"] == "tool"]
    offsets = [span["started_offset_ms"] for span in calls]
    assert offsets == sorted(offsets)
    assert trace["spans"][0]["started_offset_ms"] == 0
    assert trace["spans"][1]["duration_ms"] == trace["duration_ms"]
    assert all(span["sequence"] is not None for span in calls)
    assert all(span["tool_version"] for span in calls)


async def test_a_trace_carries_no_message_body(client: AsyncClient, lab: dict[str, str]) -> None:
    """A stored span has no attribute column, and the contract is where that has to show.

    Checked against the rendered response for the reason the timeline's equivalent is: this
    is what an export and a future evaluation will actually read.
    """
    experiment = await control_experiment(client, lab)
    await advance(client, lab, experiment)

    rendered = (await traces(client, lab, experiment)).text

    assert "NS-10482" not in rendered
    assert "Lyon" not in rendered


async def test_an_arm_that_has_not_run_contributes_no_trace(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)

    assert (await traces(client, lab, experiment)).json()["traces"] == []


async def test_traces_for_an_experiment_of_another_shop_are_not_found(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)

    response = await client.get(
        f"/api/v1/shops/{uuid4()}/experiments/{experiment['experiment_id']}/traces"
    )

    assert response.status_code == 404, response.text
    assert response.json()["code"] == "experiment_not_found"


async def test_an_arm_reports_the_framework_and_model_its_configuration_pinned(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """Read from the version the arm pinned, not from what this process can run today."""
    experiment = await control_experiment(client, lab)

    assert [run["framework_id"] for run in experiment["runs"]] == ["fake", "fake"]
    assert {run["model_id"] for run in experiment["runs"]} == {CONTROL_MODEL["model_id"]}


async def test_an_arm_that_has_not_run_reports_a_cost_of_nothing_measured(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """A started arm has a metrics block from the first read, with the trigger it received.

    Zero attempts and a null duration rather than an absent object: an arm that has not run
    is a real reading, and a client should not have to tell "no arm here" from "this arm has
    not run yet". What the *bench* does with it is its own decision — it draws no strip until
    the first attempt, because a row of zeros reads as a measurement nobody took.
    """
    experiment = await control_experiment(client, lab)

    metrics = experiment["runs"][0]["metrics"]
    assert metrics["turns"] == 1
    assert metrics["attempts"] == 0
    assert metrics["tool_calls"] == 0
    assert metrics["duration_ms"] is None
    assert metrics["usage"] is None
    assert metrics["estimated_cost"] is None


async def test_an_arm_that_ran_reports_what_it_spent_beside_the_arm_that_did_not(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The control arm calls no provider, so its cost is zero rather than unknown."""
    experiment = await control_experiment(client, lab)
    await advance(client, lab, experiment)

    body = (
        await client.get(
            f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        )
    ).json()

    ran, waiting = (run["metrics"] for run in body["runs"])
    assert ran["attempts"] == 1
    assert ran["answered_turns"] == 1
    assert ran["tool_calls"] > 0
    assert ran["tool_writes"] == 1
    assert ran["duration_ms"] is not None
    assert ran["usage"] == {"input_tokens": 0, "output_tokens": 0, "model_requests": 0}
    assert ran["metered_attempts"] == 1
    # The rate's own date travels with the amount: an estimate whose age is invisible is a
    # number an operator cannot weigh.
    assert ran["estimated_cost"] == {
        "amount": "0.000000",
        "currency": "USD",
        "recorded_on": "2026-09-01",
    }
    assert waiting["attempts"] == 0
    assert waiting["duration_ms"] is None


async def test_every_arm_says_what_it_is_waiting_for(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """A freshly started experiment owes two answers and has skipped nothing."""
    experiment = await control_experiment(client, lab)

    assert [run["standing"] for run in experiment["runs"]] == [
        {"awaiting": "agent", "ordinal": 0, "attempts": 0, "unanswered": []},
        {"awaiting": "agent", "ordinal": 0, "attempts": 0, "unanswered": []},
    ]


async def test_an_experiment_reopened_after_one_arm_ran_says_which_arm_is_still_owed(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The resume read: one arm answered, the arm beside it still waiting on its agent."""
    experiment = await control_experiment(client, lab)
    await advance(client, lab, experiment)

    body = (
        await client.get(
            f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        )
    ).json()

    assert [run["standing"]["awaiting"] for run in body["runs"]] == ["customer", "agent"]
    assert body["runs"][0]["standing"]["attempts"] == 1


async def test_a_turn_sent_before_the_agent_ran_leaves_the_earlier_one_unanswered(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The arm now stands on turn 1, and its standing reports the question it passed over."""
    experiment = await control_experiment(client, lab)
    await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        "/participant-turns",
        json={
            "run_ids": [experiment["runs"][0]["run_id"]],
            "message": "Yes, the Lyon address please.",
        },
    )

    body = (
        await client.get(
            f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        )
    ).json()

    assert body["runs"][0]["standing"] == {
        "awaiting": "agent",
        "ordinal": 1,
        "attempts": 0,
        "unanswered": [0],
    }


async def evaluation(client: AsyncClient, lab: dict[str, str], experiment: dict[str, Any]) -> Any:
    return await client.get(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}/evaluation"
    )


async def test_an_experiment_is_judged_against_the_objectives_its_scenario_composed(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The control arm never opens a document, so the read-check is pending, not missed."""
    experiment = await control_experiment(client, lab)
    await advance(client, lab, experiment)

    response = await evaluation(client, lab, experiment)

    assert response.status_code == 200, response.text
    body = response.json()
    assert [arm["run_id"] for arm in body["arms"]] == [run["run_id"] for run in experiment["runs"]]
    ran = body["arms"][0]
    assert ran["settled"] is False
    assert ran["decided"] == 0
    assert ran["failed"] is False
    (objective,) = ran["objectives"]
    assert objective["objective_id"] == "read-address-change-policy"
    assert objective["outcome"] == "pending"
    assert objective["severity"] == "required"
    assert objective["assessment"] == "deterministic"
    assert objective["evidence"] == "event"
    assert objective["block_version"] == 1
    assert "support.read_document" in objective["detail"]


TOOL_TEMPLATE: dict[str, Any] = {
    **OBJECTIVE_TEMPLATE,
    "name": "look-the-order-up",
    "statement": "Look the order up",
    "description": "Passes when the bound tool answered the arm.",
    "parameters": [
        {**OBJECTIVE_TEMPLATE["parameters"][0], "name": "tool_ref", "kind": "tool_reference"},
        OBJECTIVE_TEMPLATE["parameters"][1],
    ],
}


async def test_a_verdict_names_the_timeline_event_that_decided_it(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The deciding call is the arm's own `tool_call` entry, addressed by its coordinate."""
    block_id = await make_block(client, "objective-blocks", TOOL_TEMPLATE)
    assert (await client.post(f"/api/v1/objective-blocks/{block_id}/versions")).status_code == 201
    body = scenario_body(lab)
    scenario = await published_scenario(
        client,
        lab,
        objectives=[
            *body["objectives"],
            {
                "id": "look-the-order-up",
                "block_id": block_id,
                "severity": "required",
                "bindings": [{"parameter": "tool_ref", "value": "orders.read_order"}],
            },
        ],
    )
    identity = await make_identity(client)
    experiment = await start(client, lab, start_body(scenario, await control_arm(client, identity)))
    await advance(client, lab, experiment)

    arm = (await evaluation(client, lab, experiment)).json()["arms"][0]
    entries = (await timeline(client, lab, experiment)).json()["entries"]
    rows = {row["objective_id"]: row for row in arm["objectives"]}
    decided = rows["look-the-order-up"]["decided_by"]
    matching = [
        entry
        for entry in entries
        if entry["kind"] == "tool_call"
        and entry["run_ids"] == [arm["run_id"]]
        and (entry["ordinal"], entry["attempt"], entry["sequence"])
        == (decided["ordinal"], decided["attempt"], decided["sequence"])
    ]

    assert rows["look-the-order-up"]["outcome"] == "met"
    assert [entry["tool"] for entry in matching] == ["orders.read_order"]
    assert rows["read-address-change-policy"]["outcome"] == "pending"
    assert rows["read-address-change-policy"]["decided_by"] is None


async def test_an_arm_driven_past_its_cap_settles_what_it_never_did(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """One turn is all this scenario allows, so the second answer ends the arm."""
    scenario = await published_scenario(
        client,
        lab,
        completion={"statement": "The order ships to the confirmed address.", "max_turns": 1},
    )
    identity = await make_identity(client)
    experiment = await start(client, lab, start_body(scenario, await control_arm(client, identity)))
    await advance(client, lab, experiment)
    delivered = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        "/participant-turns",
        json={"run_ids": [experiment["runs"][0]["run_id"]], "message": "Any update?"},
    )
    assert delivered.status_code == 201, delivered.text
    await advance(client, lab, experiment)

    body = (await evaluation(client, lab, experiment)).json()
    reopened = (
        await client.get(
            f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        )
    ).json()

    assert reopened["runs"][0]["standing"]["awaiting"] == "completed"
    arm = body["arms"][0]
    assert arm["settled"] is True
    assert arm["decided"] == 1
    assert arm["met"] == 0
    assert arm["failed"] is True
    assert arm["objectives"][0]["outcome"] == "missed"


JUDGES = "/api/v1/judge-configurations"
JUDGE_TEMPLATE: dict[str, Any] = {
    "name": "resolve-the-incident",
    "statement": "Resolve the incident the customer opened",
    "description": "A judge reads the thread and says whether the incident was resolved.",
    "assessment": "judge",
    "evidence": "dimension",
    "parameters": [],
}


async def judged_scenario(client: AsyncClient, lab: dict[str, str]) -> dict[str, Any]:
    """The wrong-address recipe with one more objective, the kind only a judge decides."""
    block_id = await make_block(client, "objective-blocks", JUDGE_TEMPLATE)
    published = await client.post(f"/api/v1/objective-blocks/{block_id}/versions")
    assert published.status_code == 201, published.text
    body = scenario_body(lab)
    return await published_scenario(
        client,
        lab,
        objectives=[
            *body["objectives"],
            {
                "id": "resolve-the-incident",
                "block_id": block_id,
                "severity": "required",
                "bindings": [],
            },
        ],
    )


async def published_judge(client: AsyncClient) -> str:
    created = await client.post(JUDGES, json={"name": "Resolution quality"})
    assert created.status_code == 201, created.text
    judge_id = str(created.json()["judge_id"])
    saved = await client.put(
        f"{JUDGES}/{judge_id}/draft",
        json={
            "payload": {
                **created.json()["content"],
                "rubric": "Score whether the incident the customer opened was resolved.",
                "model": {
                    "provider": "fake",
                    "model_id": "deterministic",
                    "temperature": "0.00",
                },
            }
        },
    )
    assert saved.status_code == 200, saved.text
    assert (await client.post(f"{JUDGES}/{judge_id}/versions")).status_code == 201
    return judge_id


async def judged_experiment(client: AsyncClient, lab: dict[str, str]) -> dict[str, Any]:
    scenario = await judged_scenario(client, lab)
    identity = await make_identity(client)
    return await start(client, lab, start_body(scenario, await control_arm(client, identity)))


async def score(
    client: AsyncClient, lab: dict[str, str], experiment: dict[str, Any], judge_id: str
) -> Any:
    return await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}/judgements",
        json={"judge_id": judge_id},
    )


async def test_an_objective_a_judge_owns_waits_for_one_rather_than_counting(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await judged_experiment(client, lab)
    await advance(client, lab, experiment)

    body = (await evaluation(client, lab, experiment)).json()
    judged = next(
        entry
        for entry in body["arms"][0]["objectives"]
        if entry["objective_id"] == "resolve-the-incident"
    )

    assert judged["outcome"] == "deferred"
    assert judged["judgement"] is None
    assert body["arms"][0]["decided"] == 0


async def test_scoring_answers_with_the_evaluation_the_verdict_now_reads(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """One reading of an experiment: the judged row comes back beside the rules' own rows."""
    experiment = await judged_experiment(client, lab)
    await advance(client, lab, experiment)
    judge_id = await published_judge(client)

    response = await score(client, lab, experiment, judge_id)

    assert response.status_code == 201, response.text
    arm = response.json()["arms"][0]
    judged = next(
        entry for entry in arm["objectives"] if entry["objective_id"] == "resolve-the-incident"
    )
    assert judged["outcome"] == "met"
    assert judged["judgement"]["judge_id"] == judge_id
    assert judged["judgement"]["judge_version"] == 1
    assert judged["judgement"]["attempt"] == 1
    assert judged["judgement"]["provider"] == "fake"
    assert len(judged["judgement"]["brief_fingerprint"]) == 64
    assert arm["decided"] == 1


async def test_scoring_again_records_a_second_attempt(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await judged_experiment(client, lab)
    await advance(client, lab, experiment)
    judge_id = await published_judge(client)

    await score(client, lab, experiment, judge_id)
    body = (await score(client, lab, experiment, judge_id)).json()

    judged = next(
        entry
        for entry in body["arms"][0]["objectives"]
        if entry["objective_id"] == "resolve-the-incident"
    )
    assert judged["judgement"]["attempt"] == 2


async def test_a_pass_that_meets_a_stored_attempt_is_a_conflict_rather_than_a_failure(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The store refusing to overwrite a verdict has to read as something to act on.

    Two operators scoring at once number the same attempt. Provoked here by a judge whose
    verdict is written twice under one attempt number, which is the same collision.
    """
    experiment = await judged_experiment(client, lab)
    await advance(client, lab, experiment)
    judge_id = await published_judge(client)
    assert (await score(client, lab, experiment, judge_id)).status_code == 201

    with patch.object(ExperimentJudgeService, "_attempts", return_value={}):
        response = await score(client, lab, experiment, judge_id)

    assert response.status_code == 409, response.text
    assert response.json()["code"] == "judgement_conflict"


async def test_a_judge_with_no_published_version_cannot_score(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await judged_experiment(client, lab)
    created = await client.post(JUDGES, json={"name": "Unfinished"})

    response = await score(client, lab, experiment, str(created.json()["judge_id"]))

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "judge_configuration_unpublished"


async def test_a_judge_this_lab_cannot_reach_is_refused_rather_than_recorded(
    tmp_path: Path,
) -> None:
    """A missing provider key is a fact about the process, never an arm's evidence."""
    async with api_client(
        tmp_path, "judge-unavailable.db", judge_runtimes=JudgeRuntimeRegistry({})
    ) as offline:
        lab = await seed_lab(offline)
        experiment = await judged_experiment(offline, lab)
        await advance(offline, lab, experiment)
        judge_id = await published_judge(offline)

        response = await score(offline, lab, experiment, judge_id)

        assert response.status_code == 422, response.text
        assert response.json()["code"] == "judge_runtime_unavailable"
        body = (await evaluation(offline, lab, experiment)).json()
        judged = next(
            entry
            for entry in body["arms"][0]["objectives"]
            if entry["objective_id"] == "resolve-the-incident"
        )
        assert judged["judgement"] is None


async def test_a_completed_arm_refuses_another_customer_turn(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The cap is what guarantees a run terminates, so it refuses rather than warns."""
    scenario = await published_scenario(
        client,
        lab,
        completion={"statement": "The order ships to the confirmed address.", "max_turns": 1},
    )
    identity = await make_identity(client)
    experiment = await start(client, lab, start_body(scenario, await control_arm(client, identity)))
    await advance(client, lab, experiment)

    async def drive() -> Any:
        return await client.post(
            f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
            "/participant-turns",
            json={"run_ids": [experiment["runs"][0]["run_id"]], "message": "Any update?"},
        )

    assert (await drive()).status_code == 201
    response = await drive()

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "experiment_completed"
    assert "1 turns this scenario allows" in response.json()["message"]


# -- what an operator writes on a run ------------------------------------------


def annotations_path(lab: dict[str, str], experiment: dict[str, Any], suffix: str) -> str:
    return f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}/{suffix}"


async def add_note(
    client: AsyncClient, lab: dict[str, str], experiment: dict[str, Any], body: str
) -> Any:
    return await client.post(annotations_path(lab, experiment, "notes"), json={"body": body})


async def set_tags(
    client: AsyncClient, lab: dict[str, str], experiment: dict[str, Any], tags: list[str]
) -> Any:
    return await client.put(annotations_path(lab, experiment, "tags"), json={"tags": tags})


async def test_a_run_nobody_has_written_on_reads_as_empty_rather_than_missing(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)

    response = await client.get(annotations_path(lab, experiment, "annotations"))

    assert response.status_code == 200, response.text
    assert response.json() == {"notes": [], "tags": []}


async def test_a_note_answers_with_everything_written_on_the_run(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)
    await set_tags(client, lab, experiment, ["read-check-gap"])

    response = await add_note(client, lab, experiment, "Beacon acts before reading the policy.")

    assert response.status_code == 201, response.text
    body = response.json()
    assert [note["body"] for note in body["notes"]] == ["Beacon acts before reading the policy."]
    assert body["tags"] == ["read-check-gap"]


async def test_two_reviewers_who_wrote_the_same_sentence_wrote_two_notes(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """Deliberately not idempotent: collapsing them would delete the second reading."""
    experiment = await two_arm_experiment(client, lab)
    await add_note(client, lab, experiment, "Worth rerunning with the policy tool renamed.")

    response = await add_note(
        client, lab, experiment, "Worth rerunning with the policy tool renamed."
    )

    assert response.status_code == 201, response.text
    notes = response.json()["notes"]
    assert len(notes) == 2
    assert notes[0]["note_id"] != notes[1]["note_id"]


async def test_notes_read_back_in_the_order_they_were_written(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)
    await add_note(client, lab, experiment, "First read: arm B never opened the policy.")
    await add_note(client, lab, experiment, "Second read: its prompt does not name the tool.")

    body = (await client.get(annotations_path(lab, experiment, "annotations"))).json()

    assert [note["body"][:5] for note in body["notes"]] == ["First", "Secon"]


async def test_the_run_the_note_is_about_is_not_changed_by_writing_it(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """An annotation is stored beside the record, so the document it pinned cannot move."""
    experiment = await two_arm_experiment(client, lab)
    await add_note(client, lab, experiment, "Beacon acts before reading the policy.")
    await set_tags(client, lab, experiment, ["read-check-gap"])

    reread = await client.get(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
    )

    assert reread.status_code == 200, reread.text
    assert reread.json()["resolution_fingerprint"] == experiment["resolution_fingerprint"]
    assert reread.json()["sandbox_fingerprint"] == experiment["sandbox_fingerprint"]


async def test_tags_are_folded_to_one_spelling_and_deduplicated(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)

    response = await set_tags(
        client, lab, experiment, ["Read check gap", "two-arm", "read_check_gap"]
    )

    assert response.status_code == 200, response.text
    assert response.json()["tags"] == ["read-check-gap", "two-arm"]


async def test_setting_the_tags_replaces_the_whole_set(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)
    await set_tags(client, lab, experiment, ["read-check-gap", "two-arm"])

    response = await set_tags(client, lab, experiment, ["two-arm"])

    assert response.json()["tags"] == ["two-arm"]


async def test_filing_a_run_the_same_way_twice_changes_nothing(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)
    first = await set_tags(client, lab, experiment, ["two-arm", "read-check-gap"])

    second = await set_tags(client, lab, experiment, ["read-check-gap", "two-arm"])

    assert second.json()["tags"] == first.json()["tags"]


async def test_a_tag_the_fold_cannot_make_a_slug_of_is_refused(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)

    response = await set_tags(client, lab, experiment, ["écoles"])

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "experiment_configuration_error"


@pytest.mark.parametrize("body", ["", "   ", "\n\t "])
async def test_a_note_with_nothing_in_it_is_refused_by_the_contract(
    client: AsyncClient, lab: dict[str, str], body: str
) -> None:
    """Padding is a fact about a text box, so it is stripped before the length is judged.

    That makes a body of spaces the contract's own refusal rather than a domain error the
    422 description does not describe."""
    experiment = await two_arm_experiment(client, lab)

    response = await add_note(client, lab, experiment, body)

    assert response.status_code == 422, response.text


async def test_a_note_the_client_padded_is_recorded_trimmed(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)

    response = await add_note(client, lab, experiment, "  Beacon acts before reading.  ")

    assert response.status_code == 201, response.text
    assert [note["body"] for note in response.json()["notes"]] == ["Beacon acts before reading."]


async def test_an_experiment_of_another_shop_cannot_be_annotated(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await two_arm_experiment(client, lab)

    response = await client.post(
        f"/api/v1/shops/{uuid4()}/experiments/{experiment['experiment_id']}/notes",
        json={"body": "Filed against the wrong shop."},
    )

    assert response.status_code == 404, response.text
    assert response.json()["code"] == "experiment_not_found"


# -- replaying a run (ADR 0038) ------------------------------------------------


async def replay(client: AsyncClient, lab: dict[str, str], experiment: dict[str, Any]) -> Any:
    return await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}/replays"
    )


async def test_replaying_a_run_answers_with_a_new_experiment_in_the_same_world(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The derived run is a new experiment that starts where the old one started."""
    experiment = await control_experiment(client, lab)
    assert (await advance(client, lab, experiment)).status_code == 201

    response = await replay(client, lab, experiment)

    assert response.status_code == 201, response.text
    derived = response.json()
    assert derived["experiment_id"] != experiment["experiment_id"]
    assert derived["snapshot_id"] == experiment["snapshot_id"]
    assert derived["sandbox_fingerprint"] == experiment["sandbox_fingerprint"]
    assert derived["participant_driver"] == "scripted"
    assert derived["derived_from"] == {
        "experiment_id": experiment["experiment_id"],
        "label": experiment["label"],
        "kind": "replay",
        # A replay pins every arm to the version its source ran, so it moved nothing.
        "changed": [],
    }


async def test_a_replay_reruns_the_arm_the_source_ran_and_leaves_the_other_where_it_was(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_experiment(client, lab)
    answered = (await advance(client, lab, experiment)).json()

    derived = (await replay(client, lab, experiment)).json()

    assert [turn["body"] for turn in derived["agent_turns"]] == [answered["turn"]["body"]]
    assert [event["tool"] for event in derived["tool_events"]] == [
        event["tool"] for event in answered["tool_events"]
    ]
    assert [run["standing"]["awaiting"] for run in derived["runs"]] == ["customer", "agent"]


async def test_a_replay_carries_the_recorded_composition_into_the_derived_thread(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_experiment(client, lab)
    assert (await advance(client, lab, experiment)).status_code == 201
    assert (await advance(client, lab, experiment, arm=1)).status_code == 201
    delivered = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        "/participant-turns",
        json={
            "run_ids": [run["run_id"] for run in experiment["runs"]],
            "message": "Any update on the address?",
        },
    )
    assert delivered.status_code == 201, delivered.text

    derived = (await replay(client, lab, experiment)).json()

    driven = [turn for turn in derived["turns"] if turn["source"] == "participant"]
    assert [turn["body"] for turn in driven] == ["Any update on the address?"] * 2
    assert {turn["driver"] for turn in driven} == {"scripted"}
    # One send in the source is one composition in the derived run, which is what makes the
    # divergence record of the two experiments the same shape.
    assert len({turn["turn_id"] for turn in driven}) == 1


async def test_replaying_a_run_leaves_the_run_it_replayed_exactly_as_it_was(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_experiment(client, lab)
    assert (await advance(client, lab, experiment)).status_code == 201
    reading = f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
    before = (await client.get(reading)).json()

    assert (await replay(client, lab, experiment)).status_code == 201

    assert (await client.get(reading)).json() == before
    assert before["derived_from"] is None


async def test_a_replay_is_listed_beside_the_run_it_derives_from(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_experiment(client, lab)
    derived = (await replay(client, lab, experiment)).json()

    listed = await client.get(f"/api/v1/shops/{lab['shop_id']}/experiments")

    assert listed.status_code == 200, listed.text
    assert {row["experiment_id"] for row in listed.json()["experiments"]} == {
        experiment["experiment_id"],
        derived["experiment_id"],
    }
    history = await client.get("/api/v1/experiments")
    rows = {row["experiment_id"]: row for row in history.json()["experiments"]}
    derived_row = rows[derived["experiment_id"]]
    assert derived_row["derived_from"]["experiment_id"] == experiment["experiment_id"]
    assert derived_row["derived_from"]["kind"] == "replay"
    assert rows[experiment["experiment_id"]]["derived_from"] is None


async def test_an_experiment_of_another_shop_cannot_be_replayed(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_experiment(client, lab)

    response = await client.post(
        f"/api/v1/shops/{uuid4()}/experiments/{experiment['experiment_id']}/replays"
    )

    assert response.status_code == 404, response.text
    assert response.json()["code"] == "experiment_not_found"


async def test_a_replay_whose_store_refuses_the_commit_never_answers_created(
    client: AsyncClient, lab: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The 201 has to be a claim about what was stored, not about what was attempted.

    A `yield` dependency left on the request stack commits after the response is on the
    wire, so a refused commit would leave the caller holding an identifier for an experiment
    nothing can read. This route's dependency ends around the path operation, so the failure
    is the answer."""
    experiment = await control_experiment(client, lab)
    listed = f"/api/v1/shops/{lab['shop_id']}/experiments"
    before = len((await client.get(listed)).json()["experiments"])

    @contextmanager
    def refusing_commit(factory: sessionmaker[Session]) -> Generator[Session]:
        with factory() as session:
            yield session
            session.rollback()
            raise OperationalError("COMMIT", {}, Exception("database is locked"))

    monkeypatch.setattr(api_module, "session_scope", refusing_commit)
    response = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}/replays"
    )
    monkeypatch.undo()

    assert response.status_code == 500, response.text
    assert len((await client.get(listed)).json()["experiments"]) == before


# -- forking -------------------------------------------------------------------


async def republish(client: AsyncClient, arm: dict[str, Any], **changes: Any) -> dict[str, Any]:
    """A newer published version of the configuration one arm ran — what a fork moves to."""
    configuration_id = arm["agent_configuration_id"]
    draft = (await client.get(f"{CONFIGURATIONS}/{configuration_id}/draft")).json()["content"]
    saved = await client.put(
        f"{CONFIGURATIONS}/{configuration_id}/draft", json={"payload": {**draft, **changes}}
    )
    assert saved.status_code == 200, saved.text
    published = await client.post(f"{CONFIGURATIONS}/{configuration_id}/versions")
    assert published.status_code == 201, published.text
    return {"configuration_id": configuration_id, "version": published.json()["version"]}


def fork_body(experiment: dict[str, Any], position: int, arm: dict[str, Any]) -> dict[str, Any]:
    """The source's own arms, with one of them pointed somewhere else."""
    arms = [
        {
            "configuration_id": run["agent_configuration_id"],
            "version": run["agent_configuration_version"],
        }
        for run in experiment["runs"]
    ]
    arms[position] = {"configuration_id": arm["configuration_id"], "version": arm["version"]}
    return {"arms": arms}


async def fork(
    client: AsyncClient, lab: dict[str, str], experiment: dict[str, Any], body: dict[str, Any]
) -> Any:
    return await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}/forks",
        json=body,
    )


async def test_forking_a_run_answers_with_the_arms_chosen_in_the_world_it_started_in(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The one variable a fork moves, in a world and a script it does not."""
    experiment = await control_experiment(client, lab)
    assert (await advance(client, lab, experiment)).status_code == 201
    newer = await republish(client, experiment["runs"][1], prompt="Read the policy first.")

    response = await fork(client, lab, experiment, fork_body(experiment, 1, newer))

    assert response.status_code == 201, response.text
    derived = response.json()
    assert derived["experiment_id"] != experiment["experiment_id"]
    assert derived["snapshot_id"] == experiment["snapshot_id"]
    assert derived["sandbox_fingerprint"] == experiment["sandbox_fingerprint"]
    assert derived["participant_driver"] == "scripted"
    assert [run["agent_configuration_version"] for run in derived["runs"]] == [
        experiment["runs"][0]["agent_configuration_version"],
        newer["version"],
    ]
    assert [run["label"] for run in derived["runs"]] == [run["label"] for run in experiment["runs"]]
    assert derived["derived_from"] == {
        "experiment_id": experiment["experiment_id"],
        "label": experiment["label"],
        "kind": "fork",
        "changed": ["prompt"],
    }


async def test_a_forked_arm_reruns_the_recorded_script_and_the_other_arm_stays_where_it_was(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The script is the source's, so the arms are the only thing that moved."""
    experiment = await control_experiment(client, lab)
    answered = (await advance(client, lab, experiment)).json()
    newer = await republish(client, experiment["runs"][0], prompt="Read the policy first.")

    derived = (await fork(client, lab, experiment, fork_body(experiment, 0, newer))).json()

    assert [turn["body"] for turn in derived["agent_turns"]] == [answered["turn"]["body"]]
    assert derived["runs"][0]["standing"]["awaiting"] == "customer"
    assert derived["runs"][1]["standing"]["awaiting"] == "agent"


async def test_a_fork_that_changes_nothing_is_refused(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_experiment(client, lab)

    response = await fork(
        client,
        lab,
        experiment,
        fork_body(
            experiment,
            0,
            {
                "configuration_id": experiment["runs"][0]["agent_configuration_id"],
                "version": experiment["runs"][0]["agent_configuration_version"],
            },
        ),
    )

    assert response.status_code == 422, response.text
    assert "replay" in response.json()["message"]


async def test_a_fork_naming_the_wrong_number_of_arms_is_refused(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_experiment(client, lab)
    newer = await republish(client, experiment["runs"][0], prompt="Read the policy first.")

    response = await fork(
        client,
        lab,
        experiment,
        {"arms": [{"configuration_id": newer["configuration_id"], "version": newer["version"]}]},
    )

    assert response.status_code == 422, response.text


async def test_a_fork_onto_a_version_nobody_published_is_answered_as_not_found(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The same 404 a start answers for an arm it cannot resolve (ADR 0024).

    An arm is an exact published version, and a caller has to be able to tell a stale arm
    from a stale experiment — so this is a not-found rather than a gate refusal, and the
    fork route's contract says 404 because that is what it does."""
    experiment = await control_experiment(client, lab)
    arm = experiment["runs"][0]

    absent_version = await fork(
        client,
        lab,
        experiment,
        fork_body(
            experiment,
            0,
            {
                "configuration_id": arm["agent_configuration_id"],
                "version": arm["agent_configuration_version"] + 99,
            },
        ),
    )
    absent_configuration = await fork(
        client,
        lab,
        experiment,
        fork_body(experiment, 0, {"configuration_id": str(uuid4()), "version": 1}),
    )

    assert absent_version.status_code == 404, absent_version.text
    assert absent_version.json()["code"] == "agent_configuration_version_not_found"
    assert absent_configuration.status_code == 404, absent_configuration.text


async def test_forking_a_run_leaves_it_as_it_was_and_lists_the_derived_one_beside_it(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_experiment(client, lab)
    assert (await advance(client, lab, experiment)).status_code == 201
    newer = await republish(client, experiment["runs"][0], prompt="Read the policy first.")
    reading = f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
    before = (await client.get(reading)).json()

    derived = (await fork(client, lab, experiment, fork_body(experiment, 0, newer))).json()

    assert (await client.get(reading)).json() == before
    history = await client.get("/api/v1/experiments")
    rows = {row["experiment_id"]: row for row in history.json()["experiments"]}
    assert rows[derived["experiment_id"]]["derived_from"]["kind"] == "fork"
    assert rows[experiment["experiment_id"]]["derived_from"] is None
    # The row says what there is to fork onto without pretending the run was forked onto it.
    assert (
        rows[experiment["experiment_id"]]["arms"][0]["agent_configuration_latest_version"]
        == newer["version"]
    )


async def test_an_experiment_of_another_shop_cannot_be_forked(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_experiment(client, lab)
    newer = await republish(client, experiment["runs"][0], prompt="Read the policy first.")

    response = await client.post(
        f"/api/v1/shops/{uuid4()}/experiments/{experiment['experiment_id']}/forks",
        json=fork_body(experiment, 0, newer),
    )

    assert response.status_code == 404, response.text
