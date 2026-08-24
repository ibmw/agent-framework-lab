"""Public contract for support-identity authoring, validation, and publication."""

from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
)
from capability_lab.presentation.api import create_app

ROLE: dict[str, Any] = {
    "name": "Northstar tier 1",
    "title": "Customer support representative",
    "description": "Handles order and delivery questions before escalation.",
}

PAYLOAD: dict[str, Any] = {
    "role": ROLE,
    "permissions": ["read_orders", "read_policies", "change_shipping_address"],
    "guidance": [
        {
            "id": "confirm-before-changing",
            "title": "Confirm before changing an order",
            "body": "Read the current shipping address back before proposing any change.",
        }
    ],
    "escalation": {
        "escalate_to": "Tier 2 support",
        "conditions": ["The customer asks for a refund above 200 EUR"],
    },
}


@pytest.fixture
async def client(tmp_path: Path) -> AsyncGenerator[AsyncClient, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'identity-api.db'}")
    Base.metadata.create_all(engine)
    application = create_app(session_factory=create_session_factory(engine))
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://lab.test"
    ) as active:
        yield active


async def create_identity(client: AsyncClient) -> str:
    response = await client.post("/api/v1/support-identities", json={"role": ROLE})
    assert response.status_code == 201
    return str(response.json()["identity_id"])


async def test_creating_an_identity_returns_an_incomplete_draft(client: AsyncClient) -> None:
    response = await client.post("/api/v1/support-identities", json={"role": ROLE})

    assert response.status_code == 201
    body = response.json()
    assert body["lifecycle_state"] == "draft"
    assert body["content"]["role"] == ROLE
    assert body["content"]["permissions"] == []
    assert body["content"]["escalation"] == {"escalate_to": "", "conditions": []}


async def test_an_unsupported_permission_is_rejected_by_the_contract(client: AsyncClient) -> None:
    """Permissions are a closed enumeration; the tool layer authorizes against them."""
    identity_id = await create_identity(client)

    response = await client.put(
        f"/api/v1/support-identities/{identity_id}/draft",
        json={"payload": {**PAYLOAD, "permissions": ["delete_shop"]}},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_duplicate_permissions_are_refused_as_a_structural_invariant(
    client: AsyncClient,
) -> None:
    identity_id = await create_identity(client)

    response = await client.put(
        f"/api/v1/support-identities/{identity_id}/draft",
        json={"payload": {**PAYLOAD, "permissions": ["read_orders", "read_orders"]}},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "support_identity_configuration_error"


async def test_an_author_publishes_an_identity_and_reads_back_the_same_version(
    client: AsyncClient,
) -> None:
    identity_id = await create_identity(client)

    refused = await client.post(f"/api/v1/support-identities/{identity_id}/versions")
    assert refused.status_code == 422
    assert refused.json()["code"] == "support_identity_not_publishable"
    assert "identity_without_permission" in {issue["code"] for issue in refused.json()["issues"]}

    await client.put(f"/api/v1/support-identities/{identity_id}/draft", json={"payload": PAYLOAD})
    ready = await client.get(f"/api/v1/support-identities/{identity_id}/draft/preview")
    assert ready.json()["publishable"] is True

    published = await client.post(f"/api/v1/support-identities/{identity_id}/versions")
    assert published.status_code == 201
    assert published.json()["content"]["permissions"] == PAYLOAD["permissions"]

    fetched = await client.get(f"/api/v1/support-identities/{identity_id}/versions/1")
    assert fetched.json() == published.json()


async def test_an_order_mutation_without_read_orders_blocks_publication(
    client: AsyncClient,
) -> None:
    identity_id = await create_identity(client)
    await client.put(
        f"/api/v1/support-identities/{identity_id}/draft",
        json={
            "payload": {
                **PAYLOAD,
                "permissions": ["read_policies", "change_shipping_address"],
            }
        },
    )

    preview = await client.get(f"/api/v1/support-identities/{identity_id}/draft/preview")

    assert preview.json()["publishable"] is False
    assert "order_mutation_without_read_orders" in {
        issue["code"] for issue in preview.json()["issues"]
    }


async def test_revoking_a_permission_never_changes_a_published_version(
    client: AsyncClient,
) -> None:
    identity_id = await create_identity(client)
    await client.put(f"/api/v1/support-identities/{identity_id}/draft", json={"payload": PAYLOAD})
    published = await client.post(f"/api/v1/support-identities/{identity_id}/versions")

    await client.put(
        f"/api/v1/support-identities/{identity_id}/draft",
        json={"payload": {**PAYLOAD, "permissions": ["read_orders", "read_policies"]}},
    )

    frozen = await client.get(f"/api/v1/support-identities/{identity_id}/versions/1")
    assert frozen.json() == published.json()

    preview = await client.get(f"/api/v1/support-identities/{identity_id}/draft/preview")
    assert "permissions.change_shipping_address" in {
        change["path"] for change in preview.json()["changes"]
    }


async def test_listing_reports_published_provenance(client: AsyncClient) -> None:
    identity_id = await create_identity(client)
    await client.put(f"/api/v1/support-identities/{identity_id}/draft", json={"payload": PAYLOAD})
    await client.post(f"/api/v1/support-identities/{identity_id}/versions")

    listed = await client.get("/api/v1/support-identities")

    assert listed.json()["identities"] == [
        {
            "identity_id": identity_id,
            "name": ROLE["name"],
            "title": ROLE["title"],
            "permission_count": 3,
            "guidance_count": 1,
            "updated_at": listed.json()["identities"][0]["updated_at"],
            "latest_published_version": 1,
            "published_version_count": 1,
        }
    ]


async def test_an_unknown_identity_answers_404(client: AsyncClient) -> None:
    missing = uuid4()

    for response in (
        await client.get(f"/api/v1/support-identities/{missing}/draft"),
        await client.get(f"/api/v1/support-identities/{missing}/draft/preview"),
        await client.get(f"/api/v1/support-identities/{missing}/versions"),
        # Publishing answers the same family as every read, never another resource's code.
        await client.post(f"/api/v1/support-identities/{missing}/versions"),
        await client.put(f"/api/v1/support-identities/{missing}/draft", json={"payload": PAYLOAD}),
    ):
        assert response.status_code == 404
        assert response.json()["code"] == "support_identity_not_found"

    version = await client.get(f"/api/v1/support-identities/{missing}/versions/1")
    assert version.status_code == 404
    assert version.json()["code"] == "support_identity_version_not_found"
