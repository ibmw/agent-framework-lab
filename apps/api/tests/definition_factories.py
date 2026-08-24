"""Shared customer-profile and support-identity fixtures for the Slice 3 test modules."""

from capability_lab.domain.customer_profile import (
    AccountFacts,
    AccountStatus,
    AddressEntry,
    BackgroundEntry,
    BackgroundKind,
    BehavioralPersona,
    CustomerIdentity,
    CustomerProfilePayload,
    HiddenFact,
    LoyaltyTier,
)
from capability_lab.domain.support_identity import (
    EscalationPolicy,
    GuidanceNote,
    SupportIdentityPayload,
    SupportPermission,
    SupportRole,
)


def customer_identity(**overrides: object) -> CustomerIdentity:
    fields: dict[str, object] = {
        "given_name": "Maya",
        "family_name": "Laurent",
        "email": "maya.laurent@example.org",
        "locale": "fr-FR",
        "phone": "+33 6 00 00 00 00",
    }
    fields.update(overrides)
    return CustomerIdentity(**fields)  # type: ignore[arg-type]


def account_facts(**overrides: object) -> AccountFacts:
    fields: dict[str, object] = {
        "customer_since": "2024-03-14",
        "status": AccountStatus.ACTIVE,
        "loyalty_tier": LoyaltyTier.SILVER,
        "marketing_opt_in": True,
        "notes": "Prefers written confirmation of every change.",
    }
    fields.update(overrides)
    return AccountFacts(**fields)  # type: ignore[arg-type]


def address(
    entry_id: str = "home",
    *,
    label: str = "Home",
    is_default: bool = True,
    **overrides: object,
) -> AddressEntry:
    fields: dict[str, object] = {
        "id": entry_id,
        "label": label,
        "recipient": "Maya Laurent",
        "line1": "18 rue des Écoles",
        "line2": None,
        "postal_code": "69005",
        "city": "Lyon",
        "region": None,
        "country": "FR",
        "is_default": is_default,
    }
    fields.update(overrides)
    return AddressEntry(**fields)  # type: ignore[arg-type]


def persona(**overrides: object) -> BehavioralPersona:
    fields: dict[str, object] = {
        "summary": (
            "Frequent customer. Direct, mildly anxious under uncertainty; wants quick, "
            "concrete answers and confirms a suggested address rather than dictating one."
        ),
        "traits": ("frequent", "direct", "mildly anxious"),
    }
    fields.update(overrides)
    return BehavioralPersona(**fields)  # type: ignore[arg-type]


def background_entry(entry_id: str = "moved-in-june", **overrides: object) -> BackgroundEntry:
    fields: dict[str, object] = {
        "id": entry_id,
        "kind": BackgroundKind.LIFE_EVENT,
        "occurred_on": "2026-06-02",
        "note": "Moved from Bordeaux to Lyon and has not updated every saved address.",
    }
    fields.update(overrides)
    return BackgroundEntry(**fields)  # type: ignore[arg-type]


def hidden_fact(fact_id: str = "old-address-still-default", **overrides: object) -> HiddenFact:
    fields: dict[str, object] = {
        "id": fact_id,
        "note": "She believes the order already ships to Lyon and has not checked.",
        "revealed_when": "The agent reads the shipping address back to her.",
    }
    fields.update(overrides)
    return HiddenFact(**fields)  # type: ignore[arg-type]


def publishable_profile(**overrides: object) -> CustomerProfilePayload:
    """A profile with no publish-gate errors; tests break exactly one rule at a time."""
    fields: dict[str, object] = {
        "identity": customer_identity(),
        "account": account_facts(),
        "persona": persona(),
        "addresses": (address(), address("office", label="Office", is_default=False)),
        "background": (background_entry(),),
        "hidden_facts": (hidden_fact(),),
    }
    fields.update(overrides)
    return CustomerProfilePayload(**fields)  # type: ignore[arg-type]


def support_role(**overrides: object) -> SupportRole:
    fields: dict[str, object] = {
        "name": "Northstar tier 1",
        "title": "Customer support representative",
        "description": "Handles order and delivery questions before escalation.",
    }
    fields.update(overrides)
    return SupportRole(**fields)  # type: ignore[arg-type]


def guidance_note(note_id: str = "confirm-before-changing", **overrides: object) -> GuidanceNote:
    fields: dict[str, object] = {
        "id": note_id,
        "title": "Confirm before changing an order",
        "body": "Read the current shipping address back before proposing any change.",
    }
    fields.update(overrides)
    return GuidanceNote(**fields)  # type: ignore[arg-type]


def publishable_identity(**overrides: object) -> SupportIdentityPayload:
    """A support identity with no publish-gate errors."""
    fields: dict[str, object] = {
        "role": support_role(),
        "permissions": (
            SupportPermission.READ_ORDERS,
            SupportPermission.READ_POLICIES,
            SupportPermission.CHANGE_SHIPPING_ADDRESS,
        ),
        "guidance": (guidance_note(),),
        "escalation": EscalationPolicy(
            escalate_to="Tier 2 support",
            conditions=("The customer asks for a refund above 200 EUR",),
        ),
    }
    fields.update(overrides)
    return SupportIdentityPayload(**fields)  # type: ignore[arg-type]
