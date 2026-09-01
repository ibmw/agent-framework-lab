"""Public contract for starting an experiment, reading it, and driving its arms."""

from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient

from api_factories import (
    api_client,
    create_scenario,
    make_identity,
    publish_everything,
    scenario_body,
    seed_lab,
)
from capability_lab.application.agent_runtime import SupportAgentRuntimeRegistry
from capability_lab.infrastructure.agents.fake import FakeSupportAgentRuntime

SEED = 20260825
CONFIGURATIONS = "/api/v1/agent-configurations"
PROMPT = (
    "You are {{support_identity.role}} for {{shop.name}}.\n\n"
    "Write in the shop's tone of voice: {{shop.tone_of_voice}}."
)


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


async def test_an_arm_reports_the_framework_and_model_its_configuration_pinned(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """Read from the version the arm pinned, not from what this process can run today."""
    experiment = await control_experiment(client, lab)

    assert [run["framework_id"] for run in experiment["runs"]] == ["fake", "fake"]
    assert {run["model_id"] for run in experiment["runs"]} == {CONTROL_MODEL["model_id"]}


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
