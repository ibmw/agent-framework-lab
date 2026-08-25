"""Public contract for materializing and reading a shop's sandbox snapshots."""

from collections.abc import AsyncGenerator
from pathlib import Path
from uuid import uuid4

import pytest
from httpx import AsyncClient, Response

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
    async with api_client(tmp_path, "snapshot-api.db") as active:
        yield active


@pytest.fixture
async def lab(client: AsyncClient) -> dict[str, str]:
    return await seed_lab(client)


async def publish_scenario(client: AsyncClient, lab: dict[str, str]) -> tuple[str, int]:
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
    return scenario_id, int(published.json()["version"])


async def materialize(
    client: AsyncClient, lab: dict[str, str], scenario_id: str, version: int, seed: int = SEED
) -> Response:
    return await client.post(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/versions/{version}/snapshots",
        json={"seed": seed},
    )


# -- materializing ---------------------------------------------------------


async def test_a_snapshot_reports_what_it_pinned_and_what_it_copied(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario_id, version = await publish_scenario(client, lab)

    response = await materialize(client, lab, scenario_id, version)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["scenario_id"] == scenario_id
    assert body["scenario_version"] == version
    assert body["seed"] == SEED
    assert body["canonical_schema_version"] == "sandbox-v2"
    assert len(body["sandbox_fingerprint"]) == 64

    pinned = {pin["definition_type"]: pin["version"] for pin in body["pins"]}
    assert pinned == {
        "shop": 1,
        "customer_profile": 1,
        "ticket": 1,
        "objective_block": 1,
        "mutation_block": 1,
        "scenario": 1,
    }
    assert all(len(pin["content_fingerprint"]) == 64 for pin in body["pins"])

    state = body["state"]
    assert state["customer_profile_id"] == lab["profile_id"]
    assert [order["order_id"] for order in state["orders"]] == [lab["order_id"]]
    order = state["orders"][0]
    assert order["payment_status"] == "paid"
    assert order["fulfilment_status"] == "unfulfilled"
    assert "Bordeaux" in (order["shipping_label"] or "")


async def test_the_interaction_carries_an_identifier_and_no_resource_copy(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario_id, version = await publish_scenario(client, lab)

    interaction = (await materialize(client, lab, scenario_id, version)).json()["state"][
        "interaction"
    ]

    assert interaction["origin_kind"] == "order_page"
    assert interaction["order_id"] == lab["order_id"]
    assert interaction["product_handle"] is None
    assert set(interaction) == {
        "origin_kind",
        "product_handle",
        "order_id",
        "channel",
        "ticket_reference",
    }


async def test_materializing_twice_returns_the_same_snapshot(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario_id, version = await publish_scenario(client, lab)

    first = await materialize(client, lab, scenario_id, version)
    second = await materialize(client, lab, scenario_id, version)

    assert second.status_code == 201, second.text
    assert second.json()["snapshot_id"] == first.json()["snapshot_id"]

    listed = await client.get(f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/snapshots")
    assert listed.status_code == 200, listed.text
    assert [row["snapshot_id"] for row in listed.json()["snapshots"]] == [
        first.json()["snapshot_id"]
    ]


async def test_a_deleted_order_refuses_the_freeze_with_its_findings(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario_id, version = await publish_scenario(client, lab)
    removed = await client.delete(f"/api/v1/shops/{lab['shop_id']}/orders/{lab['order_id']}")
    assert removed.status_code == 204, removed.text

    response = await materialize(client, lab, scenario_id, version)

    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "sandbox_not_materializable"
    assert "binding_order_missing_from_shop" in {issue["code"] for issue in body["issues"]}


async def test_an_unpublished_version_cannot_be_materialized(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    await publish_everything(client, lab)
    scenario_id = await create_scenario(client, lab)

    response = await materialize(client, lab, scenario_id, 1)

    assert response.status_code == 404, response.text
    assert response.json()["code"] == "scenario_version_not_found"


async def test_an_out_of_range_seed_is_refused_by_the_schema(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario_id, version = await publish_scenario(client, lab)

    response = await materialize(client, lab, scenario_id, version, seed=-1)

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_error"


# -- reading ---------------------------------------------------------------


async def test_a_snapshot_is_read_back_exactly_as_it_was_frozen(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario_id, version = await publish_scenario(client, lab)
    created = (await materialize(client, lab, scenario_id, version)).json()

    response = await client.get(
        f"/api/v1/shops/{lab['shop_id']}/snapshots/{created['snapshot_id']}"
    )

    assert response.status_code == 200, response.text
    assert response.json() == created


async def test_one_shop_never_reads_another_shops_snapshot(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario_id, version = await publish_scenario(client, lab)
    created = (await materialize(client, lab, scenario_id, version)).json()

    response = await client.get(f"/api/v1/shops/{uuid4()}/snapshots/{created['snapshot_id']}")

    assert response.status_code == 404, response.text
    assert response.json()["code"] == "sandbox_snapshot_not_found"


async def test_an_unknown_snapshot_is_not_found(client: AsyncClient, lab: dict[str, str]) -> None:
    response = await client.get(f"/api/v1/shops/{lab['shop_id']}/snapshots/{uuid4()}")

    assert response.status_code == 404, response.text
    assert response.json()["code"] == "sandbox_snapshot_not_found"
