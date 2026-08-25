"""Public contract for authoring a shop's scenarios."""

from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient

from api_factories import (
    api_client,
    make_customer,
    make_order,
    make_shop,
    make_ticket,
    publish_prerequisites,
    ticket_body,
)

POLICY_REFERENCE = "policy:address-change"
GUIDELINE_REFERENCE = "support_guideline:escalation"

OBJECTIVE_TEMPLATE: dict[str, Any] = {
    "name": "read-required-document",
    "statement": "Read document",
    "description": "Passes when the arm reads the bound document through its tool.",
    "assessment": "deterministic",
    "evidence": "event",
    "parameters": [
        {
            "name": "doc_ref",
            "kind": "document_reference",
            "description": "The shop document the arm has to read.",
            "required": True,
            "default": None,
        },
        {
            "name": "severity",
            "kind": "severity",
            "description": "Whether missing the read fails the objective.",
            "required": True,
            "default": "required",
        },
    ],
}

MUTATION_TEMPLATE: dict[str, Any] = {
    "name": "concurrent-entity-mutation",
    "statement": "Concurrent mutation of",
    "description": "Mutates the bound entity out of band, bumping the version an arm holds.",
    "effect": "entity_mutation",
    "parameters": [
        {
            "name": "entity_ref",
            "kind": "entity_reference",
            "description": "The order that moves under the arm.",
            "required": True,
            "default": None,
        },
        {
            "name": "timing",
            "kind": "timing",
            "description": "When the runtime injects the mutation.",
            "required": True,
            "default": "after_first_read",
        },
    ],
}


async def make_block(client: AsyncClient, collection: str, payload: dict[str, Any]) -> str:
    created = await client.post(f"/api/v1/{collection}", json={"name": payload["name"]})
    assert created.status_code == 201, created.text
    block_id = str(created.json()["block_id"])
    saved = await client.put(f"/api/v1/{collection}/{block_id}/draft", json={"payload": payload})
    assert saved.status_code == 200, saved.text
    return block_id


async def publish_ticket(client: AsyncClient, shop_id: str, ticket_id: str, order_id: str) -> None:
    saved = await client.put(
        f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/draft",
        json={"payload": ticket_body(order_id)},
    )
    assert saved.status_code == 200, saved.text
    published = await client.post(f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/versions")
    assert published.status_code == 201, published.text


@pytest.fixture
async def client(tmp_path: Path) -> AsyncGenerator[AsyncClient, None]:
    async with api_client(tmp_path, "scenario-api.db") as active:
        yield active


@pytest.fixture
async def lab(client: AsyncClient) -> dict[str, str]:
    """One publishable shop, ticket, and template in each library."""
    shop_id = await make_shop(client)
    profile_id = await make_customer(client, shop_id)
    order_id = await make_order(client, shop_id, profile_id)
    ticket_id = await make_ticket(client, shop_id, profile_id)
    await client.put(
        f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/draft",
        json={"payload": ticket_body(order_id)},
    )
    return {
        "shop_id": shop_id,
        "profile_id": profile_id,
        "order_id": order_id,
        "ticket_id": ticket_id,
        "objective_block_id": await make_block(client, "objective-blocks", OBJECTIVE_TEMPLATE),
        "mutation_block_id": await make_block(client, "mutation-blocks", MUTATION_TEMPLATE),
    }


def scenario_body(lab: dict[str, str], **overrides: Any) -> dict[str, Any]:
    """The wrong-address recipe, bound to this workspace's shop objects."""
    body: dict[str, Any] = {
        "name": "Wrong shipping address",
        "context_documents": [{"kind": "policy", "document_id": "address-change"}],
        "objectives": [
            {
                "id": "read-address-change-policy",
                "block_id": lab["objective_block_id"],
                "severity": "required",
                "bindings": [{"parameter": "doc_ref", "value": POLICY_REFERENCE}],
            }
        ],
        "mutations": [
            {
                "id": "order-moves-under-the-arm",
                "block_id": lab["mutation_block_id"],
                "bindings": [
                    {"parameter": "entity_ref", "value": f"order:{lab['order_id']}"},
                    {"parameter": "timing", "value": "after_first_read"},
                ],
            }
        ],
        "hidden_facts": "Maya confirms the Lyon address only if asked.",
        "completion": {
            "statement": "The order ships to the confirmed address.",
            "max_turns": 12,
        },
    }
    body.update(overrides)
    return body


async def create_scenario(client: AsyncClient, lab: dict[str, str]) -> str:
    created = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/scenarios",
        json={"name": "Wrong shipping address", "ticket_id": lab["ticket_id"]},
    )
    assert created.status_code == 201, created.text
    return str(created.json()["scenario_id"])


async def publish_everything(client: AsyncClient, lab: dict[str, str]) -> None:
    await publish_prerequisites(client, lab["shop_id"], lab["profile_id"])
    await publish_ticket(client, lab["shop_id"], lab["ticket_id"], lab["order_id"])
    for collection, key in (
        ("objective-blocks", "objective_block_id"),
        ("mutation-blocks", "mutation_block_id"),
    ):
        published = await client.post(f"/api/v1/{collection}/{lab[key]}/versions")
        assert published.status_code == 201, published.text


# -- creation and reading --------------------------------------------------


async def test_a_new_scenario_starts_from_its_tickets_suggested_documents(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario_id = await create_scenario(client, lab)

    response = await client.get(f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/draft")

    assert response.status_code == 200, response.text
    content = response.json()["content"]
    assert content["ticket_id"] == lab["ticket_id"]
    assert content["context_documents"] == [{"kind": "policy", "document_id": "address-change"}]
    assert content["objective_count"] == 0


async def test_a_new_scenario_reports_what_it_still_needs(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario_id = await create_scenario(client, lab)

    preview = await client.get(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/draft/preview"
    )

    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["publishable"] is False
    assert {"scenario_without_objective", "scenario_without_completion"} <= {
        issue["code"] for issue in body["issues"]
    }


async def test_a_duplicate_name_is_a_conflict(client: AsyncClient, lab: dict[str, str]) -> None:
    await create_scenario(client, lab)

    response = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/scenarios",
        json={"name": "Wrong shipping address", "ticket_id": lab["ticket_id"]},
    )

    assert response.status_code == 409, response.text
    assert response.json()["code"] == "scenario_name_exists"


async def test_a_ticket_from_another_shop_is_refused(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    response = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/scenarios",
        json={"name": "Elsewhere", "ticket_id": str(uuid4())},
    )

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "scenario_ticket_error"


# -- editing ---------------------------------------------------------------


async def test_a_saved_scenario_carries_its_bound_blocks_and_derived_counts(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario_id = await create_scenario(client, lab)

    response = await client.put(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/draft",
        json={"payload": scenario_body(lab)},
    )

    assert response.status_code == 200, response.text
    content = response.json()["content"]
    assert content["objective_count"] == 1
    assert content["mutation_count"] == 1
    assert content["objectives"][0]["severity"] == "required"
    # Bindings are a map, so the wire order is the normalized one.
    assert [entry["parameter"] for entry in content["mutations"][0]["bindings"]] == [
        "entity_ref",
        "timing",
    ]


async def test_a_client_cannot_rebuild_a_scenario_on_another_ticket(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The ticket is not on the wire for a draft write, so the field is simply refused."""
    scenario_id = await create_scenario(client, lab)

    response = await client.put(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/draft",
        json={"payload": scenario_body(lab, ticket_id=str(uuid4()))},
    )

    assert response.status_code == 422, response.text


async def test_renaming_onto_another_scenarios_name_is_a_conflict(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The create path is not the only way to take a name; the draft write refuses it too."""
    first = await create_scenario(client, lab)
    second = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/scenarios",
        json={"name": "Damaged delivery", "ticket_id": lab["ticket_id"]},
    )
    assert second.status_code == 201, second.text

    response = await client.put(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{second.json()['scenario_id']}/draft",
        json={"payload": scenario_body(lab, name="Wrong shipping address")},
    )

    assert response.status_code == 409, response.text
    assert response.json()["code"] == "scenario_name_exists"
    # Keeping its own name is not a conflict.
    kept = await client.put(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{first}/draft",
        json={"payload": scenario_body(lab)},
    )
    assert kept.status_code == 200, kept.text


async def test_a_version_that_was_never_published_answers_its_own_404(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario_id = await create_scenario(client, lab)

    response = await client.get(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/versions/2"
    )

    assert response.status_code == 404, response.text
    assert response.json()["code"] == "scenario_version_not_found"


async def test_an_out_of_range_turn_cap_is_refused_by_the_schema(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario_id = await create_scenario(client, lab)

    response = await client.put(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/draft",
        json={"payload": scenario_body(lab, completion={"statement": "Shipped.", "max_turns": 0})},
    )

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_error"


async def test_a_duplicate_binding_answers_the_scenario_configuration_code(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario_id = await create_scenario(client, lab)
    objective = {
        "id": "read-address-change-policy",
        "block_id": lab["objective_block_id"],
        "severity": "required",
        "bindings": [
            {"parameter": "doc_ref", "value": POLICY_REFERENCE},
            {"parameter": "doc_ref", "value": "policy:returns"},
        ],
    }

    response = await client.put(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/draft",
        json={"payload": scenario_body(lab, objectives=[objective])},
    )

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "scenario_configuration_error"


# -- the pickers -----------------------------------------------------------


async def test_the_resources_answer_what_a_binding_may_name(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario_id = await create_scenario(client, lab)

    response = await client.get(f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/resources")

    assert response.status_code == 200, response.text
    resources = response.json()
    assert [document["reference_value"] for document in resources["documents"]] == [
        POLICY_REFERENCE,
        GUIDELINE_REFERENCE,
        "faq_entry:delivery",
    ]
    assert resources["orders"][0]["reference_value"] == f"order:{lab['order_id']}"
    assert resources["customers"][0]["reference_value"] == f"customer:{lab['profile_id']}"
    assert resources["product_handles"] == ["alpine-shell-jacket"]
    read_option = resources["objective_blocks"][0]
    # The parameter's shop-binding rule travels with it, so a picker knows what to offer.
    assert [
        (parameter["name"], parameter["shop_bound"]) for parameter in read_option["parameters"]
    ] == [("doc_ref", True), ("severity", False)]


# -- the publish gate and the resolved state -------------------------------


async def test_the_preview_carries_the_gate_and_the_state_it_would_freeze(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    await publish_everything(client, lab)
    scenario_id = await create_scenario(client, lab)
    await client.put(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/draft",
        json={"payload": scenario_body(lab)},
    )

    response = await client.get(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/draft/preview"
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["publishable"] is True
    resolution = body["resolution"]
    assert resolution["shop_version"] == 1
    assert resolution["ticket_version"] == 1
    assert resolution["ticket_reference"] == "T-204"
    assert resolution["customer_profile_version"] == 1
    assert {template["name"]: template["version"] for template in resolution["templates"]} == {
        "read-required-document": 1,
        "concurrent-entity-mutation": 1,
    }
    assert resolution["documents"][0]["title"] == "Address-change policy"
    assert resolution["entities"][0]["label"] == "NS-10482"


async def test_a_binding_outside_the_shop_blocks_publication(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    await publish_everything(client, lab)
    scenario_id = await create_scenario(client, lab)
    objective = {
        "id": "read-a-missing-document",
        "block_id": lab["objective_block_id"],
        "severity": "required",
        "bindings": [{"parameter": "doc_ref", "value": "policy:not-in-this-shop"}],
    }
    await client.put(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/draft",
        json={"payload": scenario_body(lab, objectives=[objective])},
    )

    response = await client.post(f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/versions")

    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "scenario_not_publishable"
    assert "binding_document_missing_from_shop" in {issue["code"] for issue in body["issues"]}


async def test_publishing_freezes_the_scenario_and_names_every_version_it_pinned(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    await publish_everything(client, lab)
    scenario_id = await create_scenario(client, lab)
    await client.put(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/draft",
        json={"payload": scenario_body(lab)},
    )

    response = await client.post(f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/versions")

    assert response.status_code == 201, response.text
    version = response.json()
    assert version["lifecycle_state"] == "published"
    assert version["version"] == 1
    assert version["shop_version"] == 1
    assert version["ticket_version"] == 1
    assert {
        template["definition_type"]: template["version"] for template in version["templates"]
    } == {"objective_block": 1, "mutation_block": 1}


async def test_a_published_version_stays_frozen_while_the_draft_moves_on(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    await publish_everything(client, lab)
    scenario_id = await create_scenario(client, lab)
    base = f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}"
    await client.put(f"{base}/draft", json={"payload": scenario_body(lab)})
    await client.post(f"{base}/versions")

    await client.put(
        f"{base}/draft",
        json={"payload": scenario_body(lab, hidden_facts="Maya volunteers nothing.")},
    )

    frozen = await client.get(f"{base}/versions/1")
    assert frozen.status_code == 200, frozen.text
    assert (
        frozen.json()["content"]["hidden_facts"] == "Maya confirms the Lyon address only if asked."
    )
    listed = await client.get(f"{base}/versions")
    assert [entry["version"] for entry in listed.json()["versions"]] == [1]


async def test_a_scenario_of_another_shop_is_simply_not_found(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario_id = await create_scenario(client, lab)
    other_shop = await make_shop(client)

    response = await client.get(f"/api/v1/shops/{other_shop}/scenarios/{scenario_id}/draft")

    assert response.status_code == 404, response.text
    assert response.json()["code"] == "scenario_not_found"


async def test_listing_shows_the_ticket_and_customer_behind_each_recipe(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario_id = await create_scenario(client, lab)
    await client.put(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{scenario_id}/draft",
        json={"payload": scenario_body(lab)},
    )

    response = await client.get(f"/api/v1/shops/{lab['shop_id']}/scenarios")

    assert response.status_code == 200, response.text
    (summary,) = response.json()["scenarios"]
    assert summary["ticket_reference"] == "T-204"
    assert summary["customer_display_name"] == "Maya Laurent"
    assert summary["objective_count"] == 1
    assert summary["mutation_count"] == 1
    assert summary["latest_published_version"] is None
