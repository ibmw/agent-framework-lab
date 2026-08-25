"""HTTP fixtures and seeding helpers shared by the contract suites.

The scenario contract needs the same published shop, customer, order, and ticket the ticket
contract does, so both read them from here rather than one suite importing another's
internals. Each suite still owns its own client fixture, and with it its own database file.
"""

from pathlib import Path
from typing import Any

from httpx import ASGITransport, AsyncClient

from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
)
from capability_lab.presentation.api import create_app

PLACED_AT = "2026-08-20T14:55:00Z"
CAPTURED_AT = "2026-08-21T13:12:00Z"
HISTORY_AT = "2026-08-21T09:14:00Z"
TRIGGER_AT = "2026-08-21T13:40:00Z"

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

POLICY: dict[str, Any] = {
    "id": "address-change",
    "title": "Address-change policy",
    "kind": "shipping",
    "body": "A shipping address can change before dispatch.",
}

BORDEAUX: dict[str, Any] = {
    "id": "bordeaux-previous-flat",
    "label": "Bordeaux — previous flat",
    "recipient": "Maya Laurent",
    "line1": "42 cours de la Marne",
    "line2": None,
    "postal_code": "33800",
    "city": "Bordeaux",
    "region": None,
    "country": "FR",
    "is_default": True,
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
    "addresses": [BORDEAUX],
    "background": [],
    "hidden_facts": [],
}

TRIGGER: dict[str, Any] = {
    "id": "trigger",
    "author": "customer",
    "body": "I just noticed this is going to my old address. Can you change it before it ships?",
    "sent_at": TRIGGER_AT,
}

HISTORY: list[dict[str, Any]] = [
    {
        "id": "payment-question",
        "author": "customer",
        "body": "Did my payment go through? I got an error at checkout.",
        "sent_at": HISTORY_AT,
    },
    {
        "id": "payment-answer",
        "author": "support_agent",
        "body": "Your order NS-10482 is confirmed and paid — no action needed.",
        "sent_at": "2026-08-21T09:16:00Z",
    },
]


def ticket_body(order_id: str, **overrides: Any) -> dict[str, Any]:
    """The wrong-address incident, opened from the order page of the stale-address order."""
    body: dict[str, Any] = {
        "reference": "T-204",
        "subject": "Wrong address concern",
        "channel": "chat",
        "status": "open",
        "origin": {"kind": "order_page", "product_handle": None, "order_id": order_id},
        "tags": ["address-change", "pre-fulfilment"],
        "history": HISTORY,
        "trigger": TRIGGER,
        "linked_order_ids": [order_id],
        "suggested_documents": [{"kind": "policy", "document_id": "address-change"}],
    }
    body.update(overrides)
    return body


def api_client(tmp_path: Path, database_name: str) -> AsyncClient:
    """One suite's app over its own database file; use it as an async context manager."""
    engine = create_database_engine(f"sqlite:///{tmp_path / database_name}")
    Base.metadata.create_all(engine)
    return AsyncClient(
        transport=ASGITransport(app=create_app(session_factory=create_session_factory(engine))),
        base_url="http://lab.test",
    )


async def make_shop(client: AsyncClient) -> str:
    created = await client.post("/api/v1/shops", json={"identity": SHOP_IDENTITY})
    shop_id = str(created.json()["shop_id"])
    draft = (await client.get(f"/api/v1/shops/{shop_id}/draft")).json()["content"]
    draft.pop("default_tone_of_voice_id", None)
    payload = {
        **draft,
        "products": [PRODUCT],
        "policies": [POLICY],
        "faq": [
            {
                "id": "delivery",
                "question": "When does my order ship?",
                "answer": "Within two working days.",
            }
        ],
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
        json={"reference": "NS-10482", "customer_profile_id": profile_id, "placed_at": PLACED_AT},
    )
    order_id = str(created.json()["order_id"])
    response = await client.put(
        f"/api/v1/shops/{shop_id}/orders/{order_id}",
        json={
            "reference": "NS-10482",
            "placed_at": PLACED_AT,
            "lines": [{"sku": "NS-ASJ-OB-M", "quantity": 1}],
            "payment": {"status": "paid", "method_id": "card", "paid_at": CAPTURED_AT},
            "fulfilment": {"status": "unfulfilled", "method_id": "standard", "shipped_at": None},
            "shipping_fee_amount": "0.00",
            "shipping_address_id": "bordeaux-previous-flat",
            "events": [],
        },
    )
    assert response.status_code == 200, response.text
    return order_id


async def make_ticket(client: AsyncClient, shop_id: str, profile_id: str) -> str:
    created = await client.post(
        f"/api/v1/shops/{shop_id}/tickets",
        json={
            "reference": "T-204",
            "subject": "Wrong address concern",
            "customer_profile_id": profile_id,
            "channel": "chat",
        },
    )
    assert created.status_code == 201, created.text
    return str(created.json()["ticket_id"])


async def publish_prerequisites(client: AsyncClient, shop_id: str, profile_id: str) -> None:
    assert (await client.post(f"/api/v1/shops/{shop_id}/versions")).status_code == 201
    assert (
        await client.post(f"/api/v1/customer-profiles/{profile_id}/versions")
    ).status_code == 201
