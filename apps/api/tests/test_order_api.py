"""Public contract for authoring a shop's order fixtures."""

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

PLACED_AT = "2026-08-20T14:55:00Z"
CAPTURED_AT = "2026-08-21T13:12:00Z"

SHOP_IDENTITY: dict[str, Any] = {
    "name": "Northstar Outfitters",
    "slug": "northstar",
    "locale": "en-GB",
    "currencies": ["EUR"],
    "channels": ["chat"],
}

PRODUCT: dict[str, Any] = {
    "handle": "alpine-shell-jacket",
    "title": "Alpine Shell Jacket",
    "description": "A three-layer shell.",
    "status": "active",
    "category": "Outerwear",
    "options": [{"key": "color", "name": "Color", "values": ["Ocean Blue"]}],
    "variants": [
        {
            "sku": "NS-ASJ-OB-M",
            "option_values": [{"key": "color", "value": "Ocean Blue"}],
            "availability": "in_stock",
            "stock_quantity": 12,
            "price": {"amount": "249.00", "currency": "EUR"},
        }
    ],
    "media": [],
    "attributes": [],
    "reviews": [],
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

BORDEAUX: dict[str, Any] = {
    **HOME,
    "id": "bordeaux-previous-flat",
    "label": "Bordeaux — previous flat",
    "line1": "42 cours de la Marne",
    "postal_code": "33800",
    "city": "Bordeaux",
    "is_default": False,
}

PROFILE: dict[str, Any] = {
    "identity": {
        "given_name": "Maya",
        "family_name": "Laurent",
        "email": "maya.laurent@example.org",
        "locale": "fr-FR",
        "phone": None,
    },
    "account": {
        "customer_since": "2024-03-14",
        "status": "active",
        "loyalty_tier": "silver",
        "marketing_opt_in": True,
        "notes": "",
    },
    "persona": {"summary": "Direct and mildly anxious.", "traits": ["direct"]},
    "addresses": [HOME, BORDEAUX],
    "background": [],
    "hidden_facts": [],
}


def replace_order_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "reference": "NS-10482",
        "placed_at": PLACED_AT,
        "lines": [{"sku": "NS-ASJ-OB-M", "quantity": 1}],
        "payment": {"status": "paid", "method_id": "card", "paid_at": CAPTURED_AT},
        "fulfilment": {"status": "unfulfilled", "method_id": "standard", "shipped_at": None},
        "shipping_fee_amount": "0.00",
        "shipping_address_id": "bordeaux-previous-flat",
        "events": [
            {
                "id": "order-created",
                "kind": "placed",
                "occurred_at": PLACED_AT,
                "summary": "Order created — checkout, order page",
            },
            {
                "id": "payment-captured",
                "kind": "payment_captured",
                "occurred_at": CAPTURED_AT,
                "summary": "Payment captured — order marked paid",
            },
        ],
    }
    body.update(overrides)
    return body


@pytest.fixture
async def client(tmp_path: Path) -> AsyncGenerator[AsyncClient, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'order-api.db'}")
    Base.metadata.create_all(engine)
    application = create_app(session_factory=create_session_factory(engine))
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://lab.test"
    ) as active:
        yield active


async def make_shop(client: AsyncClient) -> str:
    created = await client.post("/api/v1/shops", json={"identity": SHOP_IDENTITY})
    shop_id = str(created.json()["shop_id"])
    draft = (await client.get(f"/api/v1/shops/{shop_id}/draft")).json()["content"]
    # The shop's draft response carries derived evidence a write must not echo back.
    draft.pop("default_tone_of_voice_id", None)
    payload = {
        **draft,
        "products": [PRODUCT],
        "payment_methods": [
            {"id": "card", "name": "Card · synthetic", "kind": "card", "enabled": True}
        ],
        "fulfilment_methods": [
            {
                "id": "standard",
                "name": "Standard 3-5 days",
                "carrier": "Nordic Post",
                "min_transit_days": 3,
                "max_transit_days": 5,
            }
        ],
    }
    response = await client.put(f"/api/v1/shops/{shop_id}/draft", json={"payload": payload})
    assert response.status_code == 200, response.text
    return shop_id


async def make_customer(client: AsyncClient, shop_id: str) -> str:
    created = await client.post(
        "/api/v1/customer-profiles",
        json={
            "identity": PROFILE["identity"],
            "customer_since": "2024-03-14",
            "shop_id": shop_id,
        },
    )
    profile_id = str(created.json()["profile_id"])
    response = await client.put(
        f"/api/v1/customer-profiles/{profile_id}/draft", json={"payload": PROFILE}
    )
    assert response.status_code == 200, response.text
    return profile_id


async def make_order(client: AsyncClient, shop_id: str, profile_id: str) -> str:
    created = await client.post(
        f"/api/v1/shops/{shop_id}/orders",
        json={
            "reference": "NS-10482",
            "customer_profile_id": profile_id,
            "placed_at": PLACED_AT,
        },
    )
    assert created.status_code == 201, created.text
    return str(created.json()["order_id"])


@pytest.fixture
async def workspace(client: AsyncClient) -> tuple[str, str, str]:
    shop_id = await make_shop(client)
    profile_id = await make_customer(client, shop_id)
    order_id = await make_order(client, shop_id, profile_id)
    return shop_id, profile_id, order_id


async def test_a_new_order_reports_what_it_still_needs(
    client: AsyncClient, workspace: tuple[str, str, str]
) -> None:
    shop_id, _, order_id = workspace

    response = await client.get(f"/api/v1/shops/{shop_id}/orders/{order_id}")

    body = response.json()
    assert response.status_code == 200
    assert body["content"]["total"] == {"amount": "0.00", "currency": "EUR"}
    assert {issue["code"] for issue in body["issues"]} >= {
        "order_without_line",
        "order_without_shipping_address",
    }
    assert body["payment_status_options"] == ["pending", "authorized", "paid", "refunded"]


async def test_saving_an_order_materializes_lines_totals_and_the_frozen_address(
    client: AsyncClient, workspace: tuple[str, str, str]
) -> None:
    shop_id, _, order_id = workspace

    response = await client.put(
        f"/api/v1/shops/{shop_id}/orders/{order_id}", json=replace_order_body()
    )

    assert response.status_code == 200, response.text
    content = response.json()["content"]
    assert content["lines"][0]["title"] == "Alpine Shell Jacket"
    assert content["lines"][0]["line_total"] == {"amount": "249.00", "currency": "EUR"}
    assert content["subtotal"] == {"amount": "249.00", "currency": "EUR"}
    assert content["total"] == {"amount": "249.00", "currency": "EUR"}
    assert content["shipping_address"]["source_label"] == "Bordeaux — previous flat"
    assert content["shipping_address"]["city"] == "Bordeaux"
    assert content["allows_address_change"] is True
    assert response.json()["issues"] == []


async def test_a_line_price_is_never_accepted_from_the_client(
    client: AsyncClient, workspace: tuple[str, str, str]
) -> None:
    """The contract has no field for it: an order's money comes from the catalog."""
    shop_id, _, order_id = workspace

    response = await client.put(
        f"/api/v1/shops/{shop_id}/orders/{order_id}",
        json=replace_order_body(
            lines=[{"sku": "NS-ASJ-OB-M", "quantity": 1, "unit_price": "1.00"}]
        ),
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_an_unresolvable_selection_is_refused_with_its_own_code(
    client: AsyncClient, workspace: tuple[str, str, str]
) -> None:
    shop_id, _, order_id = workspace

    unknown_variant = await client.put(
        f"/api/v1/shops/{shop_id}/orders/{order_id}",
        json=replace_order_body(lines=[{"sku": "NS-GHOST", "quantity": 1}]),
    )
    unknown_address = await client.put(
        f"/api/v1/shops/{shop_id}/orders/{order_id}",
        json=replace_order_body(shipping_address_id="warehouse"),
    )

    assert unknown_variant.status_code == 422
    assert unknown_variant.json()["code"] == "order_selection_error"
    assert unknown_address.json()["code"] == "order_selection_error"


async def test_an_illegal_status_transition_is_refused_by_the_backend(
    client: AsyncClient, workspace: tuple[str, str, str]
) -> None:
    shop_id, _, order_id = workspace
    await client.put(f"/api/v1/shops/{shop_id}/orders/{order_id}", json=replace_order_body())

    response = await client.put(
        f"/api/v1/shops/{shop_id}/orders/{order_id}",
        json=replace_order_body(
            payment={"status": "pending", "method_id": "card", "paid_at": None}
        ),
    )

    assert response.status_code == 422
    assert response.json()["code"] == "order_transition_error"


async def test_a_fulfilled_order_no_longer_allows_an_address_change(
    client: AsyncClient, workspace: tuple[str, str, str]
) -> None:
    shop_id, _, order_id = workspace

    response = await client.put(
        f"/api/v1/shops/{shop_id}/orders/{order_id}",
        json=replace_order_body(
            fulfilment={
                "status": "fulfilled",
                "method_id": "standard",
                "shipped_at": "2026-08-22T08:00:00Z",
            }
        ),
    )

    assert response.status_code == 200, response.text
    assert response.json()["content"]["allows_address_change"] is False
    assert response.json()["fulfilment_status_options"] == ["fulfilled"]


async def test_a_naive_timestamp_is_refused_rather_than_assumed_to_be_utc(
    client: AsyncClient, workspace: tuple[str, str, str]
) -> None:
    shop_id, _, order_id = workspace

    response = await client.put(
        f"/api/v1/shops/{shop_id}/orders/{order_id}",
        json=replace_order_body(placed_at="2026-08-20T14:55:00"),
    )

    assert response.status_code == 422
    assert "UTC offset" in response.text


async def test_a_duplicate_reference_is_a_conflict(
    client: AsyncClient, workspace: tuple[str, str, str]
) -> None:
    shop_id, profile_id, _ = workspace

    response = await client.post(
        f"/api/v1/shops/{shop_id}/orders",
        json={
            "reference": "NS-10482",
            "customer_profile_id": profile_id,
            "placed_at": PLACED_AT,
        },
    )

    assert response.status_code == 409
    assert response.json()["code"] == "order_reference_exists"


async def test_an_order_cannot_be_created_for_an_unattached_customer(
    client: AsyncClient, workspace: tuple[str, str, str]
) -> None:
    shop_id, _, _ = workspace
    elsewhere = await client.post(
        "/api/v1/customer-profiles",
        json={"identity": PROFILE["identity"], "customer_since": "2024-03-14", "shop_id": None},
    )

    response = await client.post(
        f"/api/v1/shops/{shop_id}/orders",
        json={
            "reference": "NS-10999",
            "customer_profile_id": str(elsewhere.json()["profile_id"]),
            "placed_at": PLACED_AT,
        },
    )

    assert response.status_code == 422
    assert response.json()["code"] == "order_selection_error"


async def test_an_unknown_shop_or_order_answers_its_own_code(client: AsyncClient) -> None:
    shop_id = await make_shop(client)

    missing_shop = await client.get(f"/api/v1/shops/{uuid4()}/orders")
    missing_order = await client.get(f"/api/v1/shops/{shop_id}/orders/{uuid4()}")

    assert missing_shop.status_code == 404
    assert missing_shop.json()["code"] == "shop_not_found"
    assert missing_order.status_code == 404
    assert missing_order.json()["code"] == "order_not_found"


async def test_the_index_lists_orders_with_their_customer_and_total(
    client: AsyncClient, workspace: tuple[str, str, str]
) -> None:
    shop_id, _, order_id = workspace
    await client.put(f"/api/v1/shops/{shop_id}/orders/{order_id}", json=replace_order_body())

    response = await client.get(f"/api/v1/shops/{shop_id}/orders")

    rows = response.json()["orders"]
    assert len(rows) == 1
    assert rows[0]["reference"] == "NS-10482"
    assert rows[0]["customer_display_name"] == "Maya Laurent"
    assert rows[0]["payment_status"] == "paid"
    assert rows[0]["fulfilment_status"] == "unfulfilled"
    assert rows[0]["total"] == {"amount": "249.00", "currency": "EUR"}


async def test_deleting_an_order_leaves_the_customer_and_catalog_untouched(
    client: AsyncClient, workspace: tuple[str, str, str]
) -> None:
    shop_id, profile_id, order_id = workspace
    await client.put(f"/api/v1/shops/{shop_id}/orders/{order_id}", json=replace_order_body())

    deleted = await client.delete(f"/api/v1/shops/{shop_id}/orders/{order_id}")

    assert deleted.status_code == 204
    assert (await client.get(f"/api/v1/shops/{shop_id}/orders")).json()["orders"] == []
    profile = await client.get(f"/api/v1/customer-profiles/{profile_id}/draft")
    assert len(profile.json()["content"]["addresses"]) == 2
    assert (await client.delete(f"/api/v1/shops/{shop_id}/orders/{order_id}")).status_code == 404


async def test_removing_the_source_address_warns_without_moving_the_order(
    client: AsyncClient, workspace: tuple[str, str, str]
) -> None:
    """ADR 0014 deferred this check here; the frozen copy is what the order ships to."""
    shop_id, profile_id, order_id = workspace
    await client.put(f"/api/v1/shops/{shop_id}/orders/{order_id}", json=replace_order_body())

    await client.put(
        f"/api/v1/customer-profiles/{profile_id}/draft",
        json={"payload": {**PROFILE, "addresses": [HOME]}},
    )

    response = await client.get(f"/api/v1/shops/{shop_id}/orders/{order_id}")
    body = response.json()
    assert body["content"]["shipping_address"]["line1"] == "42 cours de la Marne"
    assert [issue["code"] for issue in body["issues"]] == ["shipping_address_source_removed"]
    assert all(issue["severity"] == "warning" for issue in body["issues"])
