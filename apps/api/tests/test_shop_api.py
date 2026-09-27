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
    "name": "Northstar Outfitters",
    "slug": "northstar",
    "locale": "en-GB",
    "currencies": ["EUR"],
    "channels": ["chat", "email"],
}

PRODUCT: dict[str, Any] = {
    "handle": "alpine-shell-jacket",
    "title": "Alpine Shell Jacket",
    "description": "Three-layer waterproof shell with taped seams.",
    "status": "active",
    "category": "Jackets",
    "options": [
        {"key": "color", "name": "Color", "values": ["Ocean Blue", "Charcoal"]},
        {"key": "size", "name": "Size", "values": ["M", "L"]},
    ],
    "variants": [
        {
            "sku": "NS-ASJ-OB-M",
            "option_values": [
                {"key": "color", "value": "Ocean Blue"},
                {"key": "size", "value": "M"},
            ],
            "availability": "in_stock",
            "stock_quantity": 42,
            "price": {"amount": "249.00", "currency": "EUR"},
        },
        {
            "sku": "NS-ASJ-CH-L",
            "option_values": [
                {"key": "color", "value": "Charcoal"},
                {"key": "size", "value": "L"},
            ],
            "availability": "backorder",
            "stock_quantity": 0,
            "price": {"amount": "249.00", "currency": "EUR"},
        },
    ],
    "media": [{"reference": "media/alpine-ocean.jpg", "alt_text": "Ocean Blue, front"}],
    "attributes": [
        {
            "key": "waterproof-rating",
            "label": "Waterproof rating",
            "attribute_type": "measurement",
            "value": "20000",
            "unit": "mm",
            "choices": [],
        },
        {
            "key": "fit",
            "label": "Fit",
            "attribute_type": "choice",
            "value": "Regular",
            "unit": None,
            "choices": ["Regular", "Slim"],
        },
    ],
    "reviews": [
        {
            "id": "camille",
            "author_display_name": "Camille R.",
            "rating": 5,
            "body": "Kept me dry through a full day of rain.",
        },
        {"id": "ade", "author_display_name": "Ade O.", "rating": 4, "body": "Warm enough."},
    ],
}

PAYLOAD: dict[str, Any] = {
    "identity": IDENTITY,
    "products": [PRODUCT],
    "faq": [
        {
            "id": "delivery",
            "question": "When does my order ship?",
            "answer": "Within two working days.",
        }
    ],
    "policies": [
        {
            "id": "shipping",
            "title": "Shipping policy",
            "kind": "shipping",
            "body": "A shipping address can change before dispatch.",
        }
    ],
    "payment_methods": [{"id": "visa", "name": "Visa", "kind": "card", "enabled": True}],
    "fulfilment_methods": [
        {
            "id": "standard",
            "name": "Standard",
            "carrier": "Nordic Post",
            "min_transit_days": 2,
            "max_transit_days": 5,
        }
    ],
    "support_guidelines": [
        {"id": "escalation", "title": "Escalation", "body": "Escalate refunds above 500 EUR."}
    ],
    "tone_of_voice_guidelines": [
        {
            "id": "warm-precise",
            "name": "Warm and precise",
            "guidance": "Be concise, warm, and specific.",
            "is_default": True,
        }
    ],
}


@pytest.fixture
async def client(tmp_path: Path) -> AsyncGenerator[AsyncClient, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'shop-api.db'}")
    Base.metadata.create_all(engine)
    application = create_app(session_factory=create_session_factory(engine))
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://lab.test"
    ) as active:
        yield active


async def create_shop(client: AsyncClient) -> str:
    response = await client.post("/api/v1/shops", json={"identity": IDENTITY})
    assert response.status_code == 201
    return str(response.json()["shop_id"])


async def test_creating_a_shop_returns_an_incomplete_draft(client: AsyncClient) -> None:
    response = await client.post("/api/v1/shops", json={"identity": IDENTITY})

    assert response.status_code == 201
    body = response.json()
    assert body["lifecycle_state"] == "draft"
    assert body["content"]["identity"] == IDENTITY
    assert body["content"]["products"] == []
    assert body["content"]["default_tone_of_voice_id"] is None


async def test_an_invalid_identity_is_rejected_by_the_contract(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/shops",
        json={"identity": {**IDENTITY, "slug": "Northstar Outfitters"}},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_an_unknown_shop_answers_404_on_every_operation(client: AsyncClient) -> None:
    missing = uuid4()

    for response in (
        await client.get(f"/api/v1/shops/{missing}/draft"),
        await client.get(f"/api/v1/shops/{missing}/draft/preview"),
        await client.get(f"/api/v1/shops/{missing}/versions"),
        await client.post(f"/api/v1/shops/{missing}/versions"),
    ):
        assert response.status_code == 404
        assert response.json()["code"] == "shop_not_found"


async def test_an_author_publishes_a_shop_and_reads_back_the_same_immutable_version(
    client: AsyncClient,
) -> None:
    shop_id = await create_shop(client)

    blocked = await client.get(f"/api/v1/shops/{shop_id}/draft/preview")
    assert blocked.status_code == 200
    assert blocked.json()["publishable"] is False

    refused = await client.post(f"/api/v1/shops/{shop_id}/versions")
    assert refused.status_code == 422
    assert refused.json()["code"] == "shop_not_publishable"
    assert "shop_without_product" in {issue["code"] for issue in refused.json()["issues"]}

    saved = await client.put(f"/api/v1/shops/{shop_id}/draft", json={"payload": PAYLOAD})
    assert saved.status_code == 200
    assert saved.json()["content"]["products"][0]["ratings"] == {
        "review_count": 2,
        "average_rating": "4.5",
    }
    assert saved.json()["content"]["default_tone_of_voice_id"] == "warm-precise"

    ready = await client.get(f"/api/v1/shops/{shop_id}/draft/preview")
    assert ready.json()["publishable"] is True
    assert ready.json()["next_version"] == 1

    published = await client.post(f"/api/v1/shops/{shop_id}/versions")
    assert published.status_code == 201
    assert published.json()["version"] == 1
    assert len(published.json()["content_fingerprint"]) == 64

    fetched = await client.get(f"/api/v1/shops/{shop_id}/versions/1")
    assert fetched.status_code == 200
    assert fetched.json() == published.json()

    variants = fetched.json()["content"]["products"][0]["variants"]
    assert [variant["sku"] for variant in variants] == ["NS-ASJ-OB-M", "NS-ASJ-CH-L"]
    assert [variant["option_values"] for variant in variants] == [
        PRODUCT["variants"][0]["option_values"],
        PRODUCT["variants"][1]["option_values"],
    ]


async def test_editing_the_draft_never_changes_a_published_version(client: AsyncClient) -> None:
    shop_id = await create_shop(client)
    await client.put(f"/api/v1/shops/{shop_id}/draft", json={"payload": PAYLOAD})
    published = (await client.post(f"/api/v1/shops/{shop_id}/versions")).json()

    edited = {**PAYLOAD, "products": [{**PRODUCT, "title": "Alpine Shell Jacket II"}]}
    await client.put(f"/api/v1/shops/{shop_id}/draft", json={"payload": edited})

    assert (await client.get(f"/api/v1/shops/{shop_id}/versions/1")).json() == published
    preview = (await client.get(f"/api/v1/shops/{shop_id}/draft/preview")).json()
    assert preview["matches_latest_published"] is False
    assert preview["next_version"] == 2
    assert [change["description"] for change in preview["changes"]] == [
        "Updated Alpine Shell Jacket II title"
    ]

    second = await client.post(f"/api/v1/shops/{shop_id}/versions")
    assert second.status_code == 201
    assert second.json()["version"] == 2
    listed = (await client.get(f"/api/v1/shops/{shop_id}/versions")).json()
    assert [version["version"] for version in listed["versions"]] == [2, 1]


async def test_an_unpriced_variant_keeps_the_draft_saveable_but_blocks_publication(
    client: AsyncClient,
) -> None:
    shop_id = await create_shop(client)
    unpriced = {
        **PAYLOAD,
        "products": [
            {
                **PRODUCT,
                "variants": [
                    PRODUCT["variants"][0],
                    {**PRODUCT["variants"][1], "price": None},
                ],
            }
        ],
    }

    saved = await client.put(f"/api/v1/shops/{shop_id}/draft", json={"payload": unpriced})
    assert saved.status_code == 200
    assert saved.json()["content"]["products"][0]["variants"][1]["price"] is None

    preview = (await client.get(f"/api/v1/shops/{shop_id}/draft/preview")).json()
    assert preview["publishable"] is False
    assert [
        issue["path"] for issue in preview["issues"] if issue["code"] == "variant_without_price"
    ] == ["products.alpine-shell-jacket.variants.NS-ASJ-CH-L"]

    assert (await client.post(f"/api/v1/shops/{shop_id}/versions")).status_code == 422


async def test_shop_content_that_breaks_a_domain_invariant_is_refused(
    client: AsyncClient,
) -> None:
    shop_id = await create_shop(client)
    duplicate_skus = {
        **PAYLOAD,
        "products": [
            PRODUCT,
            {**PRODUCT, "handle": "second-jacket", "title": "Second Jacket"},
        ],
    }

    response = await client.put(f"/api/v1/shops/{shop_id}/draft", json={"payload": duplicate_skus})

    assert response.status_code == 422
    assert response.json()["code"] == "shop_configuration_error"
    assert "variant SKUs across the shop" in response.json()["message"]


async def test_unknown_shops_and_versions_are_reported_as_not_found(
    client: AsyncClient,
) -> None:
    unknown = uuid4()

    assert (await client.get(f"/api/v1/shops/{unknown}/draft")).status_code == 404
    assert (await client.get(f"/api/v1/shops/{unknown}/versions")).status_code == 404
    assert (await client.post(f"/api/v1/shops/{unknown}/versions")).status_code == 404

    shop_id = await create_shop(client)
    missing_version = await client.get(f"/api/v1/shops/{shop_id}/versions/9")
    assert missing_version.status_code == 404
    assert missing_version.json()["code"] == "shop_version_not_found"


async def test_listing_shops_shows_published_provenance(client: AsyncClient) -> None:
    shop_id = await create_shop(client)
    await client.put(f"/api/v1/shops/{shop_id}/draft", json={"payload": PAYLOAD})
    await client.post(f"/api/v1/shops/{shop_id}/versions")

    listed = (await client.get("/api/v1/shops")).json()["shops"]

    assert len(listed) == 1
    assert listed[0]["name"] == "Northstar Outfitters"
    assert listed[0]["latest_published_version"] == 1
    assert listed[0]["published_version_count"] == 1


async def test_unknown_payload_fields_are_rejected(client: AsyncClient) -> None:
    shop_id = await create_shop(client)

    response = await client.put(
        f"/api/v1/shops/{shop_id}/draft",
        json={"payload": {**PAYLOAD, "storefront_theme": "dark"}},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_a_logo_is_optional_on_every_write_and_always_answered(client: AsyncClient) -> None:
    """ADR 0070: an additive field — a writer that never heard of it is still a valid writer."""
    shop_id = await create_shop(client)
    assert (await client.get(f"/api/v1/shops/{shop_id}/draft")).json()["content"]["logo"] is None

    logo = {"mark": "anchor", "background": "indigo"}
    saved = await client.put(
        f"/api/v1/shops/{shop_id}/draft", json={"payload": {**PAYLOAD, "logo": logo}}
    )
    assert saved.status_code == 200
    assert saved.json()["content"]["logo"] == logo
    listed = (await client.get("/api/v1/shops")).json()["shops"]
    assert [shop["logo"] for shop in listed] == [logo]

    preview = (await client.get(f"/api/v1/shops/{shop_id}/draft/preview")).json()
    assert preview["content"]["logo"] == logo
    published = await client.post(f"/api/v1/shops/{shop_id}/versions")
    assert published.json()["content"]["logo"] == logo

    # A whole-payload write without the key is a draft without a logo.
    cleared = await client.put(f"/api/v1/shops/{shop_id}/draft", json={"payload": PAYLOAD})
    assert cleared.json()["content"]["logo"] is None
    changes = (await client.get(f"/api/v1/shops/{shop_id}/draft/preview")).json()["changes"]
    assert {"kind": "removed", "path": "logo", "description": "Removed shop logo"} in changes


async def test_a_shop_is_created_with_its_logo(client: AsyncClient) -> None:
    logo = {"mark": "storefront", "background": "pine"}
    response = await client.post("/api/v1/shops", json={"identity": IDENTITY, "logo": logo})

    assert response.status_code == 201
    assert response.json()["content"]["logo"] == logo


@pytest.mark.parametrize(
    "logo",
    [
        {"mark": "rocket", "background": "pine"},
        {"mark": "anchor", "background": "brick"},
        {"mark": "anchor", "background": "#1d6241"},
        {"mark": "anchor", "background": "pine", "mark_colour": "white"},
        {"mark": "anchor"},
    ],
)
async def test_a_logo_outside_the_closed_sets_is_refused_by_the_contract(
    client: AsyncClient, logo: dict[str, str]
) -> None:
    response = await client.post("/api/v1/shops", json={"identity": IDENTITY, "logo": logo})

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
