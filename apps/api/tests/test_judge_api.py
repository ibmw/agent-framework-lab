"""Public contract for authoring a judge and scoring an experiment with it."""

from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient

from api_factories import api_client
from capability_lab.domain.judge import MAX_RUBRIC_LENGTH

JUDGES = "/api/v1/judge-configurations"
RUBRIC = (
    "Score whether the support agent resolved the incident: it must identify the order and "
    "say plainly what it changed."
)


@pytest.fixture
async def client(tmp_path: Path) -> AsyncGenerator[AsyncClient, None]:
    async with api_client(tmp_path, "judge-api.db") as active:
        yield active


async def create(client: AsyncClient, name: str = "Resolution quality") -> dict[str, Any]:
    created = await client.post(JUDGES, json={"name": name})
    assert created.status_code == 201, created.text
    return created.json()


async def authored(client: AsyncClient, **overrides: Any) -> str:
    created = await create(client)
    judge_id = str(created["judge_id"])
    saved = await client.put(
        f"{JUDGES}/{judge_id}/draft",
        json={
            "payload": {
                **created["content"],
                "rubric": RUBRIC,
                "model": {
                    "provider": "fake",
                    "model_id": "deterministic",
                    "temperature": "0.00",
                },
                **overrides,
            }
        },
    )
    assert saved.status_code == 200, saved.text
    return judge_id


async def test_a_new_judge_is_a_draft_with_no_rubric(client: AsyncClient) -> None:
    created = await create(client)

    assert created["lifecycle_state"] == "draft"
    assert created["content"]["rubric"] == ""
    assert created["content"]["evidence"]


async def test_a_rubric_is_kept_to_its_own_cap_rather_than_the_text_cap(
    client: AsyncClient,
) -> None:
    # Past the 4000 every other prose field stops at, and as long as the contract allows.
    rubric = "a" * MAX_RUBRIC_LENGTH
    judge_id = await authored(client, rubric=rubric)
    draft = (await client.get(f"{JUDGES}/{judge_id}/draft")).json()

    refused = await client.put(
        f"{JUDGES}/{judge_id}/draft",
        json={"payload": {**draft["content"], "rubric": rubric + "a"}},
    )

    assert draft["content"]["rubric"] == rubric
    assert refused.status_code == 422


async def test_the_resources_say_what_a_judge_may_name(client: AsyncClient) -> None:
    response = await client.get(f"{JUDGES}/resources")
    body = response.json()

    assert response.status_code == 200, response.text
    assert {judge["provider"] for judge in body["judges"]} == {"openai", "fake"}
    assert "agent_replies" in body["evidence"]
    assert "pydantic-ai" in body["reserved_terms"]


async def test_the_gate_refuses_a_rubric_that_names_what_an_arm_runs(
    client: AsyncClient,
) -> None:
    judge_id = await authored(client, rubric="Prefer the pydantic-ai arm.")

    preview = await client.get(f"{JUDGES}/{judge_id}/draft/preview")
    body = preview.json()

    assert body["publishable"] is False
    assert "rubric_names_an_arm" in {issue["code"] for issue in body["issues"]}


async def test_publishing_freezes_the_rubric_the_draft_carried(client: AsyncClient) -> None:
    judge_id = await authored(client)

    published = await client.post(f"{JUDGES}/{judge_id}/versions")
    assert published.status_code == 201, published.text

    await client.put(
        f"{JUDGES}/{judge_id}/draft",
        json={
            "payload": {
                **published.json()["content"],
                "rubric": "Score whether the arm was brief.",
            }
        },
    )
    frozen = await client.get(f"{JUDGES}/{judge_id}/versions/1")

    assert frozen.json()["content"]["rubric"] == RUBRIC
    draft = await client.get(f"{JUDGES}/{judge_id}/draft")
    assert draft.json()["content"]["rubric"] == "Score whether the arm was brief."


async def test_an_unpublishable_draft_is_refused_with_its_findings(
    client: AsyncClient,
) -> None:
    created = await create(client)

    refused = await client.post(f"{JUDGES}/{created['judge_id']}/versions")

    assert refused.status_code == 422, refused.text
    assert refused.json()["code"] == "judge_configuration_not_publishable"


async def test_the_index_lists_a_judge_with_its_provenance(client: AsyncClient) -> None:
    judge_id = await authored(client)
    await client.post(f"{JUDGES}/{judge_id}/versions")

    listed = await client.get(JUDGES)
    (row,) = listed.json()["judges"]

    assert row["judge_id"] == judge_id
    assert row["latest_published_version"] == 1
    assert row["provider_label"] == "Deterministic control"


async def test_a_judge_that_does_not_exist_is_a_404(client: AsyncClient) -> None:
    missing = await client.get(f"{JUDGES}/{uuid4()}/draft")

    assert missing.status_code == 404
    assert missing.json()["code"] == "judge_configuration_not_found"
