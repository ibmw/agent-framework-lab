"""Public contract for agent-configuration authoring, validation, and publication."""

from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient

from api_factories import SUPPORT_IDENTITY, api_client, make_identity, make_shop

CONFIGURATIONS = "/api/v1/agent-configurations"
WRITE_TOOL = "orders.propose_address_change"

PROMPT = (
    "You are {{support_identity.role}} for {{shop.name}}.\n\n"
    "Write in the shop's tone of voice: {{shop.tone_of_voice}}."
)


@pytest.fixture
async def client(tmp_path: Path) -> AsyncGenerator[AsyncClient, None]:
    async with api_client(tmp_path, "agent-configuration-api.db") as active:
        yield active


async def create_configuration(client: AsyncClient, identity_id: str) -> str:
    response = await client.post(
        CONFIGURATIONS,
        json={"name": "Frontline single agent", "support_identity_id": identity_id},
    )
    assert response.status_code == 201, response.text
    return str(response.json()["configuration_id"])


async def authored(client: AsyncClient, **overrides: Any) -> tuple[str, dict[str, Any]]:
    """A configuration whose draft carries a publishable payload."""
    identity = await make_identity(client)
    configuration_id = await create_configuration(client, identity["support_identity_id"])
    draft = (await client.get(f"{CONFIGURATIONS}/{configuration_id}/draft")).json()["content"]
    payload = {**draft, "prompt": PROMPT, **overrides}
    saved = await client.put(
        f"{CONFIGURATIONS}/{configuration_id}/draft", json={"payload": payload}
    )
    assert saved.status_code == 200, saved.text
    return configuration_id, saved.json()["content"]


async def test_creating_a_configuration_returns_a_read_only_draft(client: AsyncClient) -> None:
    identity = await make_identity(client)

    response = await client.post(
        CONFIGURATIONS,
        json={
            "name": "Frontline single agent",
            "support_identity_id": identity["support_identity_id"],
        },
    )

    assert response.status_code == 201
    content = response.json()["content"]
    assert response.json()["lifecycle_state"] == "draft"
    assert content["framework_id"] == "pydantic-ai"
    assert content["architecture"] == "single_agent"
    assert content["memory"] == "conversation"
    assert content["tone_of_voice"] == {"source": "shop_default", "guideline_id": ""}
    assert content["model"] == {
        "provider": "openai",
        "model_id": "gpt-5-mini",
        "temperature": "0.20",
        "max_tool_rounds": 8,
    }
    assert WRITE_TOOL not in content["tools"]
    assert "orders.read_order" in content["tools"]


async def test_naming_a_support_identity_that_does_not_exist_is_refused(
    client: AsyncClient,
) -> None:
    response = await client.post(
        CONFIGURATIONS, json={"name": "Frontline", "support_identity_id": str(uuid4())}
    )

    # The missing resource is the identity, and no configuration was involved at all.
    assert response.status_code == 404
    assert response.json()["code"] == "support_identity_not_found"


async def test_the_temperature_travels_as_an_exact_decimal_string(client: AsyncClient) -> None:
    _, content = await authored(client)
    assert content["model"]["temperature"] == "0.20"


async def test_a_temperature_that_is_not_a_decimal_string_is_refused(client: AsyncClient) -> None:
    configuration_id, content = await authored(client)

    response = await client.put(
        f"{CONFIGURATIONS}/{configuration_id}/draft",
        json={"payload": {**content, "model": {**content["model"], "temperature": "warm"}}},
    )

    assert response.status_code == 422


async def test_a_temperature_beyond_the_supported_range_is_refused(client: AsyncClient) -> None:
    configuration_id, content = await authored(client)

    response = await client.put(
        f"{CONFIGURATIONS}/{configuration_id}/draft",
        json={"payload": {**content, "model": {**content["model"], "temperature": "3.00"}}},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "agent_configuration_error"


async def test_the_preview_reports_the_gate_and_what_a_run_would_inject(
    client: AsyncClient,
) -> None:
    shop_id = await make_shop(client)
    assert (await client.post(f"/api/v1/shops/{shop_id}/versions")).status_code == 201
    configuration_id, _ = await authored(client)

    response = await client.get(
        f"{CONFIGURATIONS}/{configuration_id}/draft/preview",
        params={"preview_shop_id": shop_id},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["publishable"] is True
    resolution = body["resolution"]
    assert resolution["shop_name"] == "Northstar Outfitters"
    assert resolution["shop_version"] == 1
    assert resolution["support_identity_version"] == 1
    assert resolution["tone_of_voice_label"] == "Warm and precise"
    values = {entry["name"]: entry for entry in resolution["variables"]}
    assert values["shop.name"]["value"] == "Northstar Outfitters"
    assert values["shop.name"]["used"] is True
    assert values["customer.name"]["injectable"] is False
    assert values["customer.name"]["value"] is None


async def test_the_preview_says_which_tools_the_identity_could_never_use(
    client: AsyncClient,
) -> None:
    read_only = {
        **SUPPORT_IDENTITY,
        "permissions": ["read_orders", "read_policies"],
    }
    identity = await make_identity(client, read_only)
    configuration_id = await create_configuration(client, identity["support_identity_id"])

    body = (await client.get(f"{CONFIGURATIONS}/{configuration_id}/draft/preview")).json()
    binding = next(tool for tool in body["resolution"]["tools"] if tool["name"] == WRITE_TOOL)

    assert binding["required_permission"] == "change_shipping_address"
    assert binding["permitted"] is False
    assert binding["enabled"] is False


async def test_publishing_freezes_the_draft_and_pins_the_identity_version(
    client: AsyncClient,
) -> None:
    configuration_id, content = await authored(client)

    published = await client.post(f"{CONFIGURATIONS}/{configuration_id}/versions")

    assert published.status_code == 201, published.text
    body = published.json()
    assert body["version"] == 1
    assert body["support_identity_version"] == 1
    assert body["content"] == content

    await client.put(
        f"{CONFIGURATIONS}/{configuration_id}/draft",
        json={"payload": {**content, "prompt": "Rewritten for {{shop.name}}."}},
    )
    frozen = await client.get(f"{CONFIGURATIONS}/{configuration_id}/versions/1")

    assert frozen.json()["content"] == content


async def test_publishing_a_configuration_the_lab_cannot_run_reports_the_findings(
    client: AsyncClient,
) -> None:
    configuration_id, content = await authored(client)
    await client.put(
        f"{CONFIGURATIONS}/{configuration_id}/draft",
        json={"payload": {**content, "framework_id": "langgraph"}},
    )

    response = await client.post(f"{CONFIGURATIONS}/{configuration_id}/versions")

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "agent_configuration_not_publishable"
    assert "framework_not_proven" in {issue["code"] for issue in body["issues"]}


async def test_publishing_a_write_the_identity_may_never_use_is_refused(
    client: AsyncClient,
) -> None:
    read_only = {**SUPPORT_IDENTITY, "permissions": ["read_orders", "read_policies"]}
    identity = await make_identity(client, read_only)
    configuration_id = await create_configuration(client, identity["support_identity_id"])
    draft = (await client.get(f"{CONFIGURATIONS}/{configuration_id}/draft")).json()["content"]
    await client.put(
        f"{CONFIGURATIONS}/{configuration_id}/draft",
        json={"payload": {**draft, "prompt": PROMPT, "tools": [*draft["tools"], WRITE_TOOL]}},
    )

    response = await client.post(f"{CONFIGURATIONS}/{configuration_id}/versions")

    assert response.status_code == 422
    assert "tool_without_permission" in {issue["code"] for issue in response.json()["issues"]}


async def test_a_prompt_that_injects_a_tool_discovered_fact_is_refused(
    client: AsyncClient,
) -> None:
    configuration_id, content = await authored(client)
    await client.put(
        f"{CONFIGURATIONS}/{configuration_id}/draft",
        json={"payload": {**content, "prompt": "Greet {{customer.name}}."}},
    )

    response = await client.post(f"{CONFIGURATIONS}/{configuration_id}/versions")

    assert response.status_code == 422
    assert "prompt_non_injectable_variable" in {
        issue["code"] for issue in response.json()["issues"]
    }


async def test_the_index_and_the_version_list_carry_the_published_provenance(
    client: AsyncClient,
) -> None:
    configuration_id, _ = await authored(client)
    await client.post(f"{CONFIGURATIONS}/{configuration_id}/versions")

    listed = (await client.get(CONFIGURATIONS)).json()["configurations"]
    versions = (await client.get(f"{CONFIGURATIONS}/{configuration_id}/versions")).json()

    assert listed[0]["configuration_id"] == configuration_id
    assert listed[0]["framework_label"] == "Pydantic AI"
    assert listed[0]["latest_published_version"] == 1
    assert [version["version"] for version in versions["versions"]] == [1]


async def test_the_resources_publish_the_frameworks_tools_and_variables(
    client: AsyncClient,
) -> None:
    shop_id = await make_shop(client)
    identity = await make_identity(client)

    body = (await client.get(f"{CONFIGURATIONS}/resources")).json()

    assert {framework["framework_id"] for framework in body["frameworks"]} == {
        "pydantic-ai",
        "openai-agents",
        "fake",
    }
    write = next(tool for tool in body["tools"] if tool["name"] == WRITE_TOOL)
    assert write["effect"] == "write"
    assert write["required_permission"] == "change_shipping_address"
    assert [option["shop_id"] for option in body["preview_shops"]] == [shop_id]
    assert [option["identity_id"] for option in body["support_identities"]] == [
        identity["support_identity_id"]
    ]
    interaction = [variable for variable in body["variables"] if variable["group"] == "interaction"]
    assert interaction and all(not variable["injectable"] for variable in interaction)


async def test_reading_a_configuration_that_was_never_created_is_a_named_refusal(
    client: AsyncClient,
) -> None:
    response = await client.get(f"{CONFIGURATIONS}/{uuid4()}/draft")

    assert response.status_code == 404
    assert response.json()["code"] == "agent_configuration_not_found"


async def test_reading_a_version_that_was_never_published_is_a_named_refusal(
    client: AsyncClient,
) -> None:
    configuration_id, _ = await authored(client)

    response = await client.get(f"{CONFIGURATIONS}/{configuration_id}/versions/4")

    assert response.status_code == 404
    assert response.json()["code"] == "agent_configuration_version_not_found"


async def test_an_unknown_field_is_refused_by_the_strict_contract(client: AsyncClient) -> None:
    configuration_id, content = await authored(client)

    response = await client.put(
        f"{CONFIGURATIONS}/{configuration_id}/draft",
        json={"payload": {**content, "seed": 1234}},
    )

    assert response.status_code == 422
