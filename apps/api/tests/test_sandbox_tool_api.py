"""Public contract for the versioned tools an arm reads and changes its sandbox through."""

from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient

from api_factories import (
    SUPPORT_IDENTITY,
    api_client,
    create_scenario,
    make_identity,
    publish_everything,
    scenario_body,
    seed_lab,
)
from capability_lab.application.sandbox_tool_contracts import SANDBOX_TOOL_CONTRACTS

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
        "orders.propose_address_change",
        "orders.apply_address_change",
    }
    assert {tool["version"] for tool in tools.values()} == {"v1"}
    # The one thing a caller must know before calling: which tools can move the arm.
    assert {name for name, tool in tools.items() if tool["effect"] == "write"} == {
        "orders.propose_address_change",
        "orders.apply_address_change",
    }
    # And which grant the acting identity needs before either of them will run.
    assert {name for name, tool in tools.items() if tool["required_permission"] is not None} == {
        "orders.propose_address_change",
        "orders.apply_address_change",
    }
    assert tools["orders.apply_address_change"]["required_permission"] == "change_shipping_address"
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


async def test_the_listing_publishes_every_declared_tool_argument_for_argument(
    client: AsyncClient,
) -> None:
    """What Milestone 3 will generate a framework's JSON Schema from, checked as a whole.

    The test above states the published set the way a contract test should — by restating
    it, so a change shows up in a diff. This one states the other half: that the listing is
    the declaration table rendered, with no tool, argument, or choice list dropped on the way
    out. An adapter that generated its schema from a truncated argument list would offer a
    model a tool it cannot call correctly.
    """
    response = await client.get("/api/v1/tools")

    assert response.status_code == 200, response.text
    published = {tool["name"]: tool for tool in response.json()["tools"]}
    assert published.keys() == {contract.name for contract in SANDBOX_TOOL_CONTRACTS}

    for contract in SANDBOX_TOOL_CONTRACTS:
        tool = published[contract.name]
        assert tool["version"] == contract.version
        assert tool["summary"] == contract.summary
        assert tool["effect"] == contract.effect.value
        assert tool["required_permission"] == (
            None if contract.required_permission is None else contract.required_permission.value
        )
        assert [entry["name"] for entry in tool["arguments"]] == [
            argument.name for argument in contract.arguments
        ]
        for entry, argument in zip(tool["arguments"], contract.arguments, strict=True):
            assert entry == {
                "name": argument.name,
                "kind": argument.kind.value,
                "description": argument.description,
                "required": argument.required,
                "choices": list(argument.choices),
            }


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
    assert [entry["id"] for entry in profile["addresses"]] == [
        "home",
        "bordeaux-previous-flat",
        "office",
    ]
    assert "persona" not in profile
    assert "hidden_facts" not in profile
    assert "Direct and mildly anxious" not in response.text


# -- the safe address change ------------------------------------------------


async def write(
    client: AsyncClient,
    lab: dict[str, str],
    arm: dict[str, Any],
    tool: str,
    actor: dict[str, Any] | None,
    **arguments: str | None,
):
    return await client.post(
        f"/api/v1/shops/{lab['shop_id']}/sandboxes/{arm['sandbox_id']}/tool-calls",
        json={"tool": tool, "version": "v1", "arguments": arguments, "actor": actor},
    )


async def test_a_change_is_proposed_and_then_applied_over_the_contract(
    client: AsyncClient, lab: dict[str, str], arm: dict[str, Any]
) -> None:
    actor = await make_identity(client)

    proposed = await write(
        client,
        lab,
        arm,
        "orders.propose_address_change",
        actor,
        order_reference=ORDER_REFERENCE,
        address_id="home",
    )
    assert proposed.status_code == 200, proposed.text
    proposal = proposed.json()["data"]
    assert proposal["applied"] is False
    assert proposal["current_address"]["city"] == "Bordeaux"
    assert proposal["proposed_address"]["city"] == "Lyon"
    # The proposal changed nothing: the arm is still where it was cloned.
    assert proposed.json()["sandbox_revision"] == arm["revision"]

    applied = await write(
        client,
        lab,
        arm,
        "orders.apply_address_change",
        actor,
        confirmation=proposal["confirmation"],
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["data"]["shipping_address"]["city"] == "Lyon"

    moved = await client.get(f"/api/v1/shops/{lab['shop_id']}/sandboxes/{arm['sandbox_id']}")
    assert moved.status_code == 200, moved.text
    assert moved.json()["revision"] == 1
    assert moved.json()["state_fingerprint"] != arm["state_fingerprint"]


async def test_applying_the_same_confirmation_twice_moves_the_arm_once(
    client: AsyncClient, lab: dict[str, str], arm: dict[str, Any]
) -> None:
    actor = await make_identity(client)
    proposed = await write(
        client,
        lab,
        arm,
        "orders.propose_address_change",
        actor,
        order_reference=ORDER_REFERENCE,
        address_id="home",
    )
    confirmation = proposed.json()["data"]["confirmation"]

    first = await write(
        client, lab, arm, "orders.apply_address_change", actor, confirmation=confirmation
    )
    second = await write(
        client, lab, arm, "orders.apply_address_change", actor, confirmation=confirmation
    )

    assert first.json()["data"] == second.json()["data"]
    moved = await client.get(f"/api/v1/shops/{lab['shop_id']}/sandboxes/{arm['sandbox_id']}")
    assert moved.json()["revision"] == 1


async def test_an_identity_without_the_permission_is_refused_rather_than_forbidden(
    client: AsyncClient, lab: dict[str, str], arm: dict[str, Any]
) -> None:
    """The tool ran and declined, so the agent reads a refusal rather than a transport error."""
    reader = await make_identity(
        client, {**SUPPORT_IDENTITY, "permissions": ["read_orders", "read_policies"]}
    )

    response = await write(
        client,
        lab,
        arm,
        "orders.propose_address_change",
        reader,
        order_reference=ORDER_REFERENCE,
        address_id="home",
    )

    assert response.status_code == 200, response.text
    assert response.json()["outcome"] == "refused"
    assert response.json()["refusal"]["code"] == "not_permitted"


async def test_a_write_with_nobody_acting_is_refused_by_the_contract(
    client: AsyncClient, lab: dict[str, str], arm: dict[str, Any]
) -> None:
    response = await write(
        client,
        lab,
        arm,
        "orders.propose_address_change",
        None,
        order_reference=ORDER_REFERENCE,
        address_id="home",
    )

    assert response.status_code == 422
    assert response.json()["code"] == "tool_actor_required"


async def test_a_change_that_is_no_longer_a_change_is_refused(
    client: AsyncClient, lab: dict[str, str], arm: dict[str, Any]
) -> None:
    actor = await make_identity(client)
    proposed = await write(
        client,
        lab,
        arm,
        "orders.propose_address_change",
        actor,
        order_reference=ORDER_REFERENCE,
        address_id="home",
    )
    applied = await write(
        client,
        lab,
        arm,
        "orders.apply_address_change",
        actor,
        confirmation=proposed.json()["data"]["confirmation"],
    )
    assert applied.status_code == 200, applied.text

    again = await write(
        client,
        lab,
        arm,
        "orders.propose_address_change",
        actor,
        order_reference=ORDER_REFERENCE,
        address_id="home",
    )

    assert again.status_code == 200
    assert again.json()["outcome"] == "refused"
    # Where it already ships is not a change to make.
    assert again.json()["refusal"]["code"] == "not_allowed"


async def test_a_change_proposed_against_a_world_that_has_moved_is_refused_at_200(
    client: AsyncClient, lab: dict[str, str], arm: dict[str, Any]
) -> None:
    """A stale write is the world moving under the agent, not the transport failing.

    The convention answers a stale command with 409; a tool call does not, because the HTTP
    status says whether the tool ran and the outcome says what it concluded (ADR 0022).
    """
    actor = await make_identity(client)

    async def propose(address_id: str) -> str:
        response = await write(
            client,
            lab,
            arm,
            "orders.propose_address_change",
            actor,
            order_reference=ORDER_REFERENCE,
            address_id=address_id,
        )
        assert response.status_code == 200, response.text
        return str(response.json()["data"]["confirmation"])

    # Two competing changes, both worked out against revision 0.
    to_home = await propose("home")
    to_office = await propose("office")

    applied = await write(
        client, lab, arm, "orders.apply_address_change", actor, confirmation=to_office
    )
    assert applied.status_code == 200, applied.text

    stale = await write(
        client, lab, arm, "orders.apply_address_change", actor, confirmation=to_home
    )

    assert stale.status_code == 200
    body = stale.json()
    assert body["outcome"] == "refused"
    assert body["refusal"]["code"] == "conflict"
    # Refused, not applied: the arm is where the winning write left it.
    moved = await client.get(f"/api/v1/shops/{lab['shop_id']}/sandboxes/{arm['sandbox_id']}")
    assert moved.json()["revision"] == 1
    order = await run(client, lab, arm, "orders.read_order", order_reference=ORDER_REFERENCE)
    assert order.json()["data"]["shipping_address"]["city"] == "Paris"
