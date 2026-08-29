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


async def published_scenario(client: AsyncClient, lab: dict[str, str]) -> dict[str, Any]:
    await publish_everything(client, lab)
    scenario_id = await create_scenario(client, lab)
    saved = await client.put(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/draft",
        json={"payload": scenario_body(lab)},
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
