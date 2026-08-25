"""Public contract for cloning a snapshot into the sandbox one arm works in (ADR 0020)."""

from collections.abc import AsyncGenerator
from pathlib import Path
from uuid import uuid4

import pytest
from httpx import AsyncClient

from api_factories import (
    api_client,
    create_scenario,
    publish_everything,
    scenario_body,
    seed_lab,
)

SEED = 20260825


@pytest.fixture
async def client(tmp_path: Path) -> AsyncGenerator[AsyncClient, None]:
    async with api_client(tmp_path, "sandbox-api.db") as active:
        yield active


@pytest.fixture
async def lab(client: AsyncClient) -> dict[str, str]:
    return await seed_lab(client)


async def frozen_snapshot(client: AsyncClient, lab: dict[str, str]) -> dict[str, object]:
    """Publish the wrong-address recipe and freeze it, as the previous slice does."""
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
    version = int(published.json()["version"])
    snapshot = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/versions/{version}/snapshots",
        json={"seed": SEED},
    )
    assert snapshot.status_code == 201, snapshot.text
    return snapshot.json()


async def clone(
    client: AsyncClient, lab: dict[str, str], snapshot_id: object, label: str = "Arm A"
):
    return await client.post(
        f"/api/v1/shops/{lab['shop_id']}/snapshots/{snapshot_id}/sandboxes",
        json={"label": label},
    )


async def test_a_clone_carries_the_starting_state_and_where_it_came_from(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    snapshot = await frozen_snapshot(client, lab)

    response = await clone(client, lab, snapshot["snapshot_id"])

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["snapshot_id"] == snapshot["snapshot_id"]
    assert body["snapshot_fingerprint"] == snapshot["sandbox_fingerprint"]
    assert body["label"] == "Arm A"
    assert body["revision"] == 0
    assert body["canonical_schema_version"] == "sandbox-state-v1"
    assert len(body["state_fingerprint"]) == 64

    # The state is the same projection the snapshot answers with, field for field.
    assert body["state"] == snapshot["state"]


async def test_two_arms_are_two_sandboxes_that_start_together(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    snapshot = await frozen_snapshot(client, lab)

    first = await clone(client, lab, snapshot["snapshot_id"], "Arm A")
    second = await clone(client, lab, snapshot["snapshot_id"], "Arm B")

    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["sandbox_id"] != second.json()["sandbox_id"]
    assert first.json()["state_fingerprint"] == second.json()["state_fingerprint"]

    listed = await client.get(
        f"/api/v1/shops/{lab['shop_id']}/snapshots/{snapshot['snapshot_id']}/sandboxes"
    )
    assert listed.status_code == 200, listed.text
    assert [arm["label"] for arm in listed.json()["sandboxes"]] == ["Arm A", "Arm B"]


async def test_one_arm_is_read_back_by_the_shop_that_holds_it(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    snapshot = await frozen_snapshot(client, lab)
    created = (await clone(client, lab, snapshot["snapshot_id"])).json()

    response = await client.get(f"/api/v1/shops/{lab['shop_id']}/sandboxes/{created['sandbox_id']}")

    assert response.status_code == 200, response.text
    assert response.json() == created

    other_shop = await client.get(f"/api/v1/shops/{uuid4()}/sandboxes/{created['sandbox_id']}")
    assert other_shop.status_code == 404
    assert other_shop.json()["code"] == "sandbox_not_found"


async def test_an_arm_is_refused_without_a_label(client: AsyncClient, lab: dict[str, str]) -> None:
    snapshot = await frozen_snapshot(client, lab)

    response = await clone(client, lab, snapshot["snapshot_id"], "")

    assert response.status_code == 422, response.text


async def test_an_unknown_snapshot_cannot_be_cloned(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    response = await clone(client, lab, uuid4())

    assert response.status_code == 404
    assert response.json()["code"] == "sandbox_snapshot_not_found"


async def test_a_sandbox_has_no_public_write_operation(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The tools and the safe address-change action are the writers, and both arrive later."""
    snapshot = await frozen_snapshot(client, lab)
    created = (await clone(client, lab, snapshot["snapshot_id"])).json()

    response = await client.put(
        f"/api/v1/shops/{lab['shop_id']}/sandboxes/{created['sandbox_id']}",
        json={"label": "Arm B"},
    )

    assert response.status_code == 405
