"""Public contract for customer-profile authoring, publication, and shop attachment."""

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

IDENTITY: dict[str, Any] = {
    "given_name": "Maya",
    "family_name": "Laurent",
    "email": "maya.laurent@example.org",
    "locale": "fr-FR",
    "phone": "+33 6 00 00 00 00",
}

HOME: dict[str, Any] = {
    "id": "home",
    "label": "Home",
    "recipient": "Maya Laurent",
    "line1": "18 rue des Écoles",
    "line2": None,
    "postal_code": "69005",
    "city": "Lyon",
    "region": None,
    "country": "FR",
    "is_default": True,
}

OFFICE: dict[str, Any] = {**HOME, "id": "office", "label": "Office", "is_default": False}

PAYLOAD: dict[str, Any] = {
    "identity": IDENTITY,
    "account": {
        "customer_since": "2024-03-14",
        "status": "active",
        "loyalty_tier": "silver",
        "marketing_opt_in": True,
        "notes": "Prefers written confirmation of every change.",
    },
    "persona": {
        "summary": "Direct, mildly anxious under uncertainty; wants concrete answers.",
        "traits": ["frequent", "direct"],
    },
    "addresses": [HOME, OFFICE],
    "background": [
        {
            "id": "moved-in-june",
            "kind": "life_event",
            "occurred_on": "2026-06-02",
            "note": "Moved to Lyon and has not updated every saved address.",
        }
    ],
    "hidden_facts": [
        {
            "id": "believes-address-updated",
            "note": "She believes the order already ships to Lyon.",
            "revealed_when": "The agent reads the shipping address back to her.",
        }
    ],
}


SHOP_IDENTITY: dict[str, Any] = {
    "name": "Northstar Outfitters",
    "slug": "northstar",
    "locale": "en-GB",
    "currencies": ["EUR"],
    "channels": ["chat"],
}


@pytest.fixture
async def client(tmp_path: Path) -> AsyncGenerator[AsyncClient, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'profile-api.db'}")
    Base.metadata.create_all(engine)
    application = create_app(session_factory=create_session_factory(engine))
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://lab.test"
    ) as active:
        yield active


async def create_shop(client: AsyncClient, slug: str) -> str:
    """Attachment refuses a shop that does not exist, so tests attach to a real one."""
    response = await client.post(
        "/api/v1/shops", json={"identity": {**SHOP_IDENTITY, "slug": slug, "name": slug.title()}}
    )
    assert response.status_code == 201
    return str(response.json()["shop_id"])


async def create_profile(client: AsyncClient, shop_id: str | None = None) -> str:
    response = await client.post(
        "/api/v1/customer-profiles",
        json={"identity": IDENTITY, "customer_since": "2024-03-14", "shop_id": shop_id},
    )
    assert response.status_code == 201
    return str(response.json()["profile_id"])


async def test_creating_a_profile_returns_an_incomplete_draft(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/customer-profiles",
        json={"identity": IDENTITY, "customer_since": "2024-03-14", "shop_id": None},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["lifecycle_state"] == "draft"
    assert body["content"]["identity"] == IDENTITY
    assert body["content"]["display_name"] == "Maya Laurent"
    assert body["content"]["addresses"] == []
    assert body["content"]["default_address_id"] is None


async def test_a_malformed_email_is_rejected_by_the_contract(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/customer-profiles",
        json={
            "identity": {**IDENTITY, "email": "maya at example.org"},
            "customer_since": "2024-03-14",
            "shop_id": None,
        },
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_a_second_default_address_is_refused_as_a_structural_invariant(
    client: AsyncClient,
) -> None:
    """The contract cannot express "at most one default"; the domain refuses the write."""
    profile_id = await create_profile(client)

    response = await client.put(
        f"/api/v1/customer-profiles/{profile_id}/draft",
        json={"payload": {**PAYLOAD, "addresses": [HOME, {**OFFICE, "is_default": True}]}},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "customer_profile_configuration_error"


async def test_an_author_publishes_a_profile_and_reads_back_the_same_immutable_version(
    client: AsyncClient,
) -> None:
    profile_id = await create_profile(client)

    blocked = await client.get(f"/api/v1/customer-profiles/{profile_id}/draft/preview")
    assert blocked.status_code == 200
    assert blocked.json()["publishable"] is False

    refused = await client.post(f"/api/v1/customer-profiles/{profile_id}/versions")
    assert refused.status_code == 422
    assert refused.json()["code"] == "customer_profile_not_publishable"
    assert "profile_without_address" in {issue["code"] for issue in refused.json()["issues"]}

    saved = await client.put(
        f"/api/v1/customer-profiles/{profile_id}/draft", json={"payload": PAYLOAD}
    )
    assert saved.status_code == 200
    assert saved.json()["content"]["default_address_id"] == "home"

    ready = await client.get(f"/api/v1/customer-profiles/{profile_id}/draft/preview")
    assert ready.json()["publishable"] is True
    assert ready.json()["next_version"] == 1

    published = await client.post(f"/api/v1/customer-profiles/{profile_id}/versions")
    assert published.status_code == 201
    assert published.json()["version"] == 1
    assert len(published.json()["content_fingerprint"]) == 64

    fetched = await client.get(f"/api/v1/customer-profiles/{profile_id}/versions/1")
    assert fetched.status_code == 200
    assert fetched.json() == published.json()


async def test_editing_the_draft_never_changes_a_published_version(client: AsyncClient) -> None:
    profile_id = await create_profile(client)
    await client.put(f"/api/v1/customer-profiles/{profile_id}/draft", json={"payload": PAYLOAD})
    published = await client.post(f"/api/v1/customer-profiles/{profile_id}/versions")

    moved = {
        **PAYLOAD,
        "addresses": [{**HOME, "line1": "42 cours de la Marne", "city": "Bordeaux"}],
    }
    await client.put(f"/api/v1/customer-profiles/{profile_id}/draft", json={"payload": moved})

    frozen = await client.get(f"/api/v1/customer-profiles/{profile_id}/versions/1")
    assert frozen.json() == published.json()

    preview = await client.get(f"/api/v1/customer-profiles/{profile_id}/draft/preview")
    assert preview.json()["matches_latest_published"] is False
    assert preview.json()["next_version"] == 2
    assert "addresses.office" in {change["path"] for change in preview.json()["changes"]}


async def test_the_persona_and_hidden_facts_survive_a_publish_round_trip(
    client: AsyncClient,
) -> None:
    profile_id = await create_profile(client)
    await client.put(f"/api/v1/customer-profiles/{profile_id}/draft", json={"payload": PAYLOAD})
    await client.post(f"/api/v1/customer-profiles/{profile_id}/versions")

    content = (await client.get(f"/api/v1/customer-profiles/{profile_id}/versions/1")).json()[
        "content"
    ]

    assert content["persona"] == PAYLOAD["persona"]
    assert content["hidden_facts"] == PAYLOAD["hidden_facts"]


async def test_a_profile_is_listed_per_shop_and_reused_across_shops(client: AsyncClient) -> None:
    northstar = await create_shop(client, "northstar")
    aurora = await create_shop(client, "aurora")
    shared = await create_profile(client, shop_id=northstar)
    await client.post(f"/api/v1/customer-profiles/{shared}/shops", json={"shop_id": aurora})
    unattached = await create_profile(client)

    scoped = await client.get("/api/v1/customer-profiles", params={"shop_id": northstar})
    assert [row["profile_id"] for row in scoped.json()["profiles"]] == [shared]
    assert scoped.json()["profiles"][0]["attached_shop_count"] == 2

    everything = await client.get("/api/v1/customer-profiles")
    assert {row["profile_id"] for row in everything.json()["profiles"]} == {shared, unattached}

    detached = await client.delete(f"/api/v1/customer-profiles/{shared}/shops/{northstar}")
    assert detached.status_code == 200
    assert detached.json()["shop_ids"] == [aurora]

    assert (await client.get(f"/api/v1/customer-profiles/{shared}/draft")).status_code == 200


async def test_attaching_twice_is_idempotent(client: AsyncClient) -> None:
    shop_id = await create_shop(client, "northstar")
    profile_id = await create_profile(client, shop_id=shop_id)

    repeated = await client.post(
        f"/api/v1/customer-profiles/{profile_id}/shops", json={"shop_id": shop_id}
    )

    assert repeated.status_code == 200
    assert repeated.json()["shop_ids"] == [shop_id]


async def test_an_unknown_profile_answers_404(client: AsyncClient) -> None:
    missing = uuid4()
    shop_id = await create_shop(client, "northstar")

    for response in (
        await client.get(f"/api/v1/customer-profiles/{missing}/draft"),
        await client.get(f"/api/v1/customer-profiles/{missing}/versions"),
        await client.get(f"/api/v1/customer-profiles/{missing}/shops"),
        await client.get(f"/api/v1/customer-profiles/{missing}/draft/preview"),
        # Publishing answers the same family as every read, never another resource's code.
        await client.post(f"/api/v1/customer-profiles/{missing}/versions"),
        await client.post(f"/api/v1/customer-profiles/{missing}/shops", json={"shop_id": shop_id}),
        await client.put(f"/api/v1/customer-profiles/{missing}/draft", json={"payload": PAYLOAD}),
        await client.delete(f"/api/v1/customer-profiles/{missing}/shops/{shop_id}"),
    ):
        assert response.status_code == 404
        assert response.json()["code"] == "customer_profile_not_found"

    unknown_version = await client.get(f"/api/v1/customer-profiles/{missing}/versions/1")
    assert unknown_version.status_code == 404
    assert unknown_version.json()["code"] == "customer_profile_version_not_found"


async def test_attaching_to_an_unknown_shop_answers_404(client: AsyncClient) -> None:
    profile_id = await create_profile(client)

    unknown_shop = str(uuid4())

    refused = await client.post(
        f"/api/v1/customer-profiles/{profile_id}/shops", json={"shop_id": unknown_shop}
    )
    created = await client.post(
        "/api/v1/customer-profiles",
        json={"identity": IDENTITY, "customer_since": "2024-03-14", "shop_id": unknown_shop},
    )

    for response in (refused, created):
        assert response.status_code == 404
        assert response.json()["code"] == "shop_not_found"
    assert (await client.get(f"/api/v1/customer-profiles/{profile_id}/shops")).json()[
        "shop_ids"
    ] == []


async def test_a_draft_write_rejects_derived_read_only_evidence(client: AsyncClient) -> None:
    """`display_name` and `default_address_id` are derived; echoing them back is a bug."""
    profile_id = await create_profile(client)

    response = await client.put(
        f"/api/v1/customer-profiles/{profile_id}/draft",
        json={"payload": {**PAYLOAD, "display_name": "Maya Laurent"}},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
