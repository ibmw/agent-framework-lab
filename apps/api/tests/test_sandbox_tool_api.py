"""Public contract for the versioned read tools an arm interrogates its sandbox through."""

from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any
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
ORDER_REFERENCE = "NS-10482"


@pytest.fixture
async def client(tmp_path: Path) -> AsyncGenerator[AsyncClient, None]:
    async with api_client(tmp_path, "sandbox-tool-api.db") as active:
        yield active


@pytest.fixture
async def lab(client: AsyncClient) -> dict[str, str]:
    return await seed_lab(client)


@pytest.fixture
async def arm(client: AsyncClient, lab: dict[str, str]) -> dict[str, Any]:
    """One arm of the frozen wrong-address starting state, cloned over the contract."""
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
    snapshot = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/versions/"
        f"{published.json()['version']}/snapshots",
        json={"seed": SEED},
    )
    assert snapshot.status_code == 201, snapshot.text
    cloned = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/snapshots/{snapshot.json()['snapshot_id']}/sandboxes",
        json={"label": "Arm A"},
    )
    assert cloned.status_code == 201, cloned.text
    return cloned.json()


async def run(
    client: AsyncClient,
    lab: dict[str, str],
    arm: dict[str, Any],
    tool: str,
    version: str = "v1",
    **arguments: str | None,
):
    return await client.post(
        f"/api/v1/shops/{lab['shop_id']}/sandboxes/{arm['sandbox_id']}/tool-calls",
        json={"tool": tool, "version": version, "arguments": arguments},
    )


async def test_the_published_tool_set_says_what_each_tool_accepts(client: AsyncClient) -> None:
    response = await client.get("/api/v1/tools")

    assert response.status_code == 200, response.text
    tools = {tool["name"]: tool for tool in response.json()["tools"]}
    assert set(tools) == {
        "interaction.read_context",
        "catalog.search_products",
        "catalog.read_product",
        "customer.read_profile",
        "orders.list_orders",
        "orders.read_order",
        "support.search_knowledge",
        "support.read_document",
    }
    assert {tool["version"] for tool in tools.values()} == {"v1"}
    assert tools["support.read_document"]["arguments"] == [
        {
            "name": "kind",
            "kind": "enum",
            "description": "The collection the document lives in.",
            "required": True,
            "choices": ["policy", "support_guideline", "faq_entry"],
        },
        {
            "name": "document_id",
            "kind": "text",
            "description": "The shop's own ID for the document, such as 'shipping'.",
            "required": True,
            "choices": [],
        },
    ]


async def test_a_tool_answers_from_the_arms_own_state_and_says_where_that_arm_stood(
    client: AsyncClient, lab: dict[str, str], arm: dict[str, Any]
) -> None:
    response = await run(client, lab, arm, "orders.read_order", order_reference=ORDER_REFERENCE)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["outcome"] == "success"
    assert body["canonical_schema_version"] == "tool-result-v1"
    assert body["tool"] == "orders.read_order"
    assert body["version"] == "v1"
    assert body["arguments"] == {"order_reference": ORDER_REFERENCE}
    assert body["refusal"] is None
    assert body["data"]["shipping_address"]["city"] == "Bordeaux"
    # Provenance, not part of the answer: the token this milestone's first writer presents.
    assert body["sandbox_revision"] == arm["revision"]
    assert body["state_fingerprint"] == arm["state_fingerprint"]


async def test_the_interaction_reference_is_resolved_through_a_tool_not_the_prompt(
    client: AsyncClient, lab: dict[str, str], arm: dict[str, Any]
) -> None:
    context = await run(client, lab, arm, "interaction.read_context")

    assert context.status_code == 200, context.text
    origin = context.json()["data"]["origin"]
    assert origin["kind"] == "order_page"
    assert origin["order_id"] == lab["order_id"]
    assert origin["order_reference"] == ORDER_REFERENCE

    order = await run(client, lab, arm, "orders.read_order", order_id=origin["order_id"])
    assert order.status_code == 200, order.text
    assert order.json()["data"]["reference"] == ORDER_REFERENCE


async def test_a_refusal_is_an_answer_rather_than_an_http_failure(
    client: AsyncClient, lab: dict[str, str], arm: dict[str, Any]
) -> None:
    """The tool ran and declined, which is a domain answer the agent has to reason about."""
    response = await run(client, lab, arm, "orders.read_order", order_reference="NS-00000")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["outcome"] == "refused"
    assert body["data"] is None
    assert body["refusal"]["code"] == "not_found"
    # A refusal still says what was asked, so the record explains itself without the request.
    assert body["arguments"] == {"order_reference": "NS-00000"}


async def test_a_tool_this_lab_does_not_publish_is_a_contract_error(
    client: AsyncClient, lab: dict[str, str], arm: dict[str, Any]
) -> None:
    unknown = await run(client, lab, arm, "orders.delete_order")
    assert unknown.status_code == 404
    assert unknown.json()["code"] == "tool_not_found"

    stale = await run(client, lab, arm, "orders.list_orders", version="v0")
    assert stale.status_code == 404
    assert stale.json()["code"] == "tool_not_found"


async def test_an_arm_of_another_shop_is_not_found(
    client: AsyncClient, lab: dict[str, str], arm: dict[str, Any]
) -> None:
    response = await client.post(
        f"/api/v1/shops/{uuid4()}/sandboxes/{arm['sandbox_id']}/tool-calls",
        json={"tool": "orders.list_orders", "version": "v1", "arguments": {}},
    )

    assert response.status_code == 404
    assert response.json()["code"] == "sandbox_not_found"


async def test_the_customer_tool_never_serves_the_simulation_side_of_the_profile(
    client: AsyncClient, lab: dict[str, str], arm: dict[str, Any]
) -> None:
    response = await run(client, lab, arm, "customer.read_profile")

    assert response.status_code == 200, response.text
    profile = response.json()["data"]
    assert profile["identity"]["email"] == "maya.laurent@example.org"
    assert [entry["id"] for entry in profile["addresses"]] == ["bordeaux-previous-flat"]
    assert "persona" not in profile
    assert "hidden_facts" not in profile
    assert "Direct and mildly anxious" not in response.text
