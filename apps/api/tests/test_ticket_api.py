"""Public contract for authoring a shop's support tickets."""

from collections.abc import AsyncGenerator
from pathlib import Path
from uuid import uuid4

import pytest
from httpx import AsyncClient

from api_factories import (
    PROFILE,
    TRIGGER,
    api_client,
    make_customer,
    make_order,
    make_shop,
    make_ticket,
    publish_prerequisites,
    ticket_body,
)


@pytest.fixture
async def client(tmp_path: Path) -> AsyncGenerator[AsyncClient, None]:
    async with api_client(tmp_path, "ticket-api.db") as active:
        yield active


@pytest.fixture
async def workspace(client: AsyncClient) -> tuple[str, str, str, str]:
    shop_id = await make_shop(client)
    profile_id = await make_customer(client, shop_id)
    order_id = await make_order(client, shop_id, profile_id)
    ticket_id = await make_ticket(client, shop_id, profile_id)
    return shop_id, profile_id, order_id, ticket_id


async def test_a_new_ticket_reports_what_it_still_needs(
    client: AsyncClient, workspace: tuple[str, str, str, str]
) -> None:
    shop_id, _, _, ticket_id = workspace

    response = await client.get(f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/draft")
    preview = await client.get(f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/draft/preview")

    assert response.status_code == 200, response.text
    content = response.json()["content"]
    assert content["trigger"] is None
    assert content["opened_at"] is None
    assert content["message_count"] == 0
    assert preview.json()["publishable"] is False
    assert "ticket_without_trigger" in {issue["code"] for issue in preview.json()["issues"]}


async def test_a_saved_ticket_carries_its_thread_and_derived_opening_moment(
    client: AsyncClient, workspace: tuple[str, str, str, str]
) -> None:
    shop_id, _, order_id, ticket_id = workspace

    response = await client.put(
        f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/draft",
        json={"payload": ticket_body(order_id)},
    )

    assert response.status_code == 200, response.text
    content = response.json()["content"]
    assert [entry["id"] for entry in content["history"]] == ["payment-question", "payment-answer"]
    assert content["trigger"]["id"] == "trigger"
    assert content["message_count"] == 3
    # Normalized into the canonical instant the fingerprint is computed over.
    assert content["opened_at"] == "2026-08-21T13:40:00.000000Z"


async def test_a_client_cannot_move_a_ticket_to_another_customer(
    client: AsyncClient, workspace: tuple[str, str, str, str]
) -> None:
    """The customer is not on the wire for a draft write, so the field is simply refused."""
    shop_id, _, order_id, ticket_id = workspace

    response = await client.put(
        f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/draft",
        json={"payload": ticket_body(order_id, customer_profile_id=str(uuid4()))},
    )

    assert response.status_code == 422, response.text


async def test_a_naive_message_time_is_refused_by_the_schema(
    client: AsyncClient, workspace: tuple[str, str, str, str]
) -> None:
    shop_id, _, order_id, ticket_id = workspace
    naive = {**TRIGGER, "sent_at": "2026-08-21T13:40:00"}

    response = await client.put(
        f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/draft",
        json={"payload": ticket_body(order_id, trigger=naive)},
    )

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_error"


async def test_a_contradictory_origin_answers_the_ticket_configuration_code(
    client: AsyncClient, workspace: tuple[str, str, str, str]
) -> None:
    shop_id, _, order_id, ticket_id = workspace
    contradiction = {
        "kind": "order_page",
        "order_id": order_id,
        "product_handle": "alpine-shell-jacket",
    }

    response = await client.put(
        f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/draft",
        json={"payload": ticket_body(order_id, origin=contradiction)},
    )

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "ticket_configuration_error"


async def test_a_duplicate_reference_is_a_conflict(
    client: AsyncClient, workspace: tuple[str, str, str, str]
) -> None:
    shop_id, profile_id, _, _ = workspace

    response = await client.post(
        f"/api/v1/shops/{shop_id}/tickets",
        json={
            "reference": "T-204",
            "subject": "Another incident",
            "customer_profile_id": profile_id,
            "channel": "chat",
        },
    )

    assert response.status_code == 409, response.text
    assert response.json()["code"] == "ticket_reference_exists"


async def test_a_customer_the_shop_does_not_use_is_refused(
    client: AsyncClient, workspace: tuple[str, str, str, str]
) -> None:
    shop_id, _, _, _ = workspace
    created = await client.post(
        "/api/v1/customer-profiles",
        json={
            "identity": {**PROFILE["identity"], "email": "stranger@example.org"},
            "customer_since": "2024-03-14",
            "shop_id": None,
        },
    )

    response = await client.post(
        f"/api/v1/shops/{shop_id}/tickets",
        json={
            "reference": "T-900",
            "subject": "Stranger",
            "customer_profile_id": created.json()["profile_id"],
            "channel": "chat",
        },
    )

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "ticket_customer_error"


async def test_the_context_answers_the_customer_the_orders_and_the_pickers(
    client: AsyncClient, workspace: tuple[str, str, str, str]
) -> None:
    shop_id, profile_id, order_id, ticket_id = workspace
    await client.put(
        f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/draft",
        json={"payload": ticket_body(order_id)},
    )

    response = await client.get(f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/context")

    assert response.status_code == 200, response.text
    context = response.json()
    assert context["customer"]["profile_id"] == profile_id
    assert context["customer"]["order_count"] == 1
    assert [order["reference"] for order in context["linked_orders"]] == ["NS-10482"]
    assert context["linked_orders"][0]["shipping_label"] == "Bordeaux — previous flat"
    assert context["resources"]["policy_ids"] == ["address-change"]
    assert context["resources"]["channels"] == ["chat"]


async def test_publishing_freezes_the_ticket_and_names_what_it_pinned(
    client: AsyncClient, workspace: tuple[str, str, str, str]
) -> None:
    shop_id, profile_id, order_id, ticket_id = workspace
    await publish_prerequisites(client, shop_id, profile_id)
    await client.put(
        f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/draft",
        json={"payload": ticket_body(order_id)},
    )

    response = await client.post(f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/versions")

    assert response.status_code == 201, response.text
    published = response.json()
    assert published["version"] == 1
    assert published["shop_version"] == 1
    assert published["customer_profile_version"] == 1
    assert len(published["content_fingerprint"]) == 64


async def test_a_published_version_stays_frozen_while_the_draft_moves_on(
    client: AsyncClient, workspace: tuple[str, str, str, str]
) -> None:
    shop_id, profile_id, order_id, ticket_id = workspace
    await publish_prerequisites(client, shop_id, profile_id)
    await client.put(
        f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/draft",
        json={"payload": ticket_body(order_id)},
    )
    await client.post(f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/versions")
    await client.put(
        f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/draft",
        json={"payload": ticket_body(order_id, subject="Something else entirely")},
    )

    frozen = await client.get(f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/versions/1")
    draft = await client.get(f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/draft")

    assert frozen.json()["content"]["subject"] == "Wrong address concern"
    assert draft.json()["content"]["subject"] == "Something else entirely"


async def test_an_unpublished_shop_is_a_finding_the_preview_already_carries(
    client: AsyncClient, workspace: tuple[str, str, str, str]
) -> None:
    """The author reads why the freeze cannot happen before clicking Publish."""
    shop_id, profile_id, order_id, ticket_id = workspace
    assert (
        await client.post(f"/api/v1/customer-profiles/{profile_id}/versions")
    ).status_code == 201
    await client.put(
        f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/draft",
        json={"payload": ticket_body(order_id)},
    )

    preview = await client.get(f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/draft/preview")
    response = await client.post(f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/versions")

    assert preview.json()["publishable"] is False
    assert "shop_unpublished" in {issue["code"] for issue in preview.json()["issues"]}
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "ticket_not_publishable"
    assert "shop_unpublished" in {issue["code"] for issue in body["issues"]}


async def test_an_unpublished_customer_profile_is_a_finding_too(
    client: AsyncClient, workspace: tuple[str, str, str, str]
) -> None:
    shop_id, _profile_id, order_id, ticket_id = workspace
    assert (await client.post(f"/api/v1/shops/{shop_id}/versions")).status_code == 201
    await client.put(
        f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/draft",
        json={"payload": ticket_body(order_id)},
    )

    preview = await client.get(f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/draft/preview")

    assert "customer_profile_unpublished" in {issue["code"] for issue in preview.json()["issues"]}


async def test_a_draft_with_errors_is_refused_with_its_findings(
    client: AsyncClient, workspace: tuple[str, str, str, str]
) -> None:
    shop_id, profile_id, _, ticket_id = workspace
    await publish_prerequisites(client, shop_id, profile_id)

    response = await client.post(f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/versions")

    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "ticket_not_publishable"
    assert "ticket_without_trigger" in {issue["code"] for issue in body["issues"]}


async def test_the_index_lists_this_shops_tickets_only(
    client: AsyncClient, workspace: tuple[str, str, str, str]
) -> None:
    shop_id, _profile_id, order_id, ticket_id = workspace
    await client.put(
        f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/draft",
        json={"payload": ticket_body(order_id)},
    )
    other_shop = await make_shop(client)
    other_profile = await make_customer(client, other_shop)
    await make_ticket(client, other_shop, other_profile)

    response = await client.get(f"/api/v1/shops/{shop_id}/tickets")

    assert response.status_code == 200, response.text
    tickets = response.json()["tickets"]
    assert [ticket["ticket_id"] for ticket in tickets] == [ticket_id]
    assert tickets[0]["customer_display_name"] == "Maya Laurent"
    assert tickets[0]["preview"].startswith("I just noticed")


async def test_a_ticket_of_another_shop_is_not_found_here(
    client: AsyncClient, workspace: tuple[str, str, str, str]
) -> None:
    shop_id, _, _, _ = workspace
    other_shop = await make_shop(client)
    other_profile = await make_customer(client, other_shop)
    foreign_ticket = await make_ticket(client, other_shop, other_profile)

    response = await client.get(f"/api/v1/shops/{shop_id}/tickets/{foreign_ticket}/draft")

    assert response.status_code == 404, response.text
    assert response.json()["code"] == "ticket_not_found"


async def test_an_unknown_shop_answers_its_own_not_found(client: AsyncClient) -> None:
    response = await client.get(f"/api/v1/shops/{uuid4()}/tickets")

    assert response.status_code == 404, response.text
    assert response.json()["code"] == "shop_not_found"


async def test_an_unknown_version_answers_its_own_not_found(
    client: AsyncClient, workspace: tuple[str, str, str, str]
) -> None:
    shop_id, _, _, ticket_id = workspace

    response = await client.get(f"/api/v1/shops/{shop_id}/tickets/{ticket_id}/versions/7")

    assert response.status_code == 404, response.text
    assert response.json()["code"] == "ticket_version_not_found"
