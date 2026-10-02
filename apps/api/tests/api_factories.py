"""HTTP fixtures and seeding helpers shared by the contract suites.

The scenario contract needs the same published shop, customer, order, and ticket the ticket
contract does, and the snapshot contract needs the published scenario on top of them, so each
suite reads them from here rather than importing another suite's internals. Each suite still
owns its own client fixture, and with it its own database file.
"""

from pathlib import Path
from typing import Any

from httpx import ASGITransport, AsyncClient

from capability_lab.application.agent_runtime import SupportAgentRuntimeRegistry
from capability_lab.application.judge_runtime import JudgeRuntimeRegistry
from capability_lab.infrastructure.config import get_settings
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
)
from capability_lab.presentation.api import create_app

POLICY_REFERENCE = "policy:address-change"
GUIDELINE_REFERENCE = "support_guideline:escalation"
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
    "is_default": False,
}

# The address the customer actually lives at now. The wrong-address incident needs both:
# without somewhere correct to move to, there is no change for an agent to propose.
LYON: dict[str, Any] = {
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

# A third entry, so a test can propose two competing changes against one arm and reach a
# genuine revision conflict instead of the "nothing to change" refusal.
PARIS: dict[str, Any] = {
    "id": "office",
    "label": "Office",
    "recipient": "Maya Laurent",
    "line1": "3 rue de Valois",
    "line2": None,
    "postal_code": "75001",
    "city": "Paris",
    "region": None,
    "country": "FR",
    "is_default": False,
}

SUPPORT_IDENTITY: dict[str, Any] = {
    "role": {
        "name": "Northstar tier 1",
        "title": "Customer support representative",
        "description": "Handles order and delivery questions before escalation.",
    },
    "permissions": ["read_orders", "read_policies", "change_shipping_address"],
    "guidance": [
        {
            "id": "confirm-before-changing",
            "title": "Confirm before changing an order",
            "body": "Read the current shipping address back before proposing any change.",
        }
    ],
    "escalation": {"escalate_to": "Tier 2 support", "conditions": []},
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
    "addresses": [LYON, BORDEAUX, PARIS],
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


def media_root(tmp_path: Path) -> Path:
    """Where `api_client`'s app stores the images uploaded through it."""
    return tmp_path / "api-media"


def api_client(
    tmp_path: Path,
    database_name: str,
    agent_runtimes: SupportAgentRuntimeRegistry | None = None,
    judge_runtimes: JudgeRuntimeRegistry | None = None,
    media_max_bytes: int | None = None,
    raise_app_exceptions: bool = True,
) -> AsyncClient:
    """One suite's app over its own database file; use it as an async context manager.

    `agent_runtimes` is how a test says which frameworks this lab can run, because that is
    composition's decision (`docs/architecture.md`) — a suite proving what happens to an arm
    nothing can run says so here rather than reaching inside the runner. `judge_runtimes`
    says the same about which providers can score. `media_max_bytes` lowers the upload cap,
    so a suite can send a body past it without building megabytes. `raise_app_exceptions`
    off answers an unhandled failure as the 500 a browser would see, rather than raising it.
    """
    engine = create_database_engine(f"sqlite:///{tmp_path / database_name}")
    Base.metadata.create_all(engine)
    # The suite's images go under its own temporary directory, never the checkout's `var/`.
    overrides: dict[str, object] = {"media_root": media_root(tmp_path)}
    if media_max_bytes is not None:
        overrides["media_max_bytes"] = media_max_bytes
    settings = get_settings().model_copy(update=overrides)
    return AsyncClient(
        transport=ASGITransport(
            app=create_app(
                settings,
                session_factory=create_session_factory(engine),
                agent_runtimes=agent_runtimes,
                judge_runtimes=judge_runtimes,
            ),
            raise_app_exceptions=raise_app_exceptions,
        ),
        base_url="http://lab.test",
    )


async def make_shop(client: AsyncClient, identity: dict[str, Any] | None = None) -> str:
    """One publishable shop, named as the caller asks or as this workspace's default shop."""
    created = await client.post(
        "/api/v1/shops", json={"identity": identity if identity is not None else SHOP_IDENTITY}
    )
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


async def make_identity(
    client: AsyncClient, payload: dict[str, Any] | None = None
) -> dict[str, Any]:
    """A published support identity, ready to be named as the actor of a write.

    Support identities are shop-independent (ADR 0014), so this takes no shop: what a write
    authorizes against is the granted permissions, not where the identity was authored.
    """
    body = SUPPORT_IDENTITY if payload is None else payload
    created = await client.post("/api/v1/support-identities", json={"role": body["role"]})
    assert created.status_code == 201, created.text
    identity_id = str(created.json()["identity_id"])
    saved = await client.put(
        f"/api/v1/support-identities/{identity_id}/draft", json={"payload": body}
    )
    assert saved.status_code == 200, saved.text
    published = await client.post(f"/api/v1/support-identities/{identity_id}/versions")
    assert published.status_code == 201, published.text
    return {"support_identity_id": identity_id, "version": published.json()["version"]}


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


async def seed_lab(client: AsyncClient) -> dict[str, str]:
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
