"""Canonical serialization of the customer-profile definition payload.

`customer-profile-payload-v1` follows the ADR 0013 pattern established by the shop: a
lossless canonical document under the ADR 0007 serialization rules, so a published version's
content fingerprint is stable across processes and a stored version round-trips back into
the typed domain aggregate.
"""

from __future__ import annotations

from capability_lab.application.canonical_document import (
    DocumentReader,
    require_schema_version,
)
from capability_lab.application.canonical_json import (
    CanonicalValue,
    canonical_json_bytes,
    canonical_sha256,
)
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

CUSTOMER_PROFILE_PAYLOAD_CANONICAL_SCHEMA_VERSION = "customer-profile-payload-v1"


def customer_profile_document(payload: CustomerProfilePayload) -> dict[str, CanonicalValue]:
    """Render one customer profile as its canonical `customer-profile-payload-v1` document."""
    return {
        "account": {
            "customer_since": payload.account.customer_since,
            "loyalty_tier": payload.account.loyalty_tier.value,
            "marketing_opt_in": payload.account.marketing_opt_in,
            "notes": payload.account.notes,
            "status": payload.account.status.value,
        },
        "addresses": [
            {
                "city": entry.city,
                "country": entry.country,
                "id": entry.id,
                "is_default": entry.is_default,
                "label": entry.label,
                "line1": entry.line1,
                "line2": entry.line2,
                "postal_code": entry.postal_code,
                "recipient": entry.recipient,
                "region": entry.region,
            }
            for entry in payload.addresses
        ],
        "background": [
            {
                "id": entry.id,
                "kind": entry.kind.value,
                "note": entry.note,
                "occurred_on": entry.occurred_on,
            }
            for entry in payload.background
        ],
        "canonical_schema_version": CUSTOMER_PROFILE_PAYLOAD_CANONICAL_SCHEMA_VERSION,
        "hidden_facts": [
            {"id": fact.id, "note": fact.note, "revealed_when": fact.revealed_when}
            for fact in payload.hidden_facts
        ],
        "identity": {
            "email": payload.identity.email,
            "family_name": payload.identity.family_name,
            "given_name": payload.identity.given_name,
            "locale": payload.identity.locale,
            "phone": payload.identity.phone,
        },
        "persona": {
            "summary": payload.persona.summary,
            "traits": list(payload.persona.traits),
        },
    }


def customer_profile_canonical_json(payload: CustomerProfilePayload) -> bytes:
    return canonical_json_bytes(customer_profile_document(payload))


def customer_profile_content_fingerprint(payload: CustomerProfilePayload) -> str:
    """The SHA-256 content fingerprint a published customer-profile version records."""
    return canonical_sha256(customer_profile_canonical_json(payload))


def customer_profile_from_document(document: object) -> CustomerProfilePayload:
    """Rebuild the typed aggregate from a stored canonical document."""
    root = DocumentReader(document, "customer profile payload")
    require_schema_version(
        root, CUSTOMER_PROFILE_PAYLOAD_CANONICAL_SCHEMA_VERSION, "customer profile payload"
    )
    identity = root.reader("identity")
    account = root.reader("account")
    persona = root.reader("persona")
    return CustomerProfilePayload(
        identity=CustomerIdentity(
            given_name=identity.text("given_name"),
            family_name=identity.text("family_name"),
            email=identity.text("email"),
            locale=identity.text("locale"),
            phone=identity.optional_text("phone"),
        ),
        account=AccountFacts(
            customer_since=account.text("customer_since"),
            status=account.enum(AccountStatus, "status"),
            loyalty_tier=account.enum(LoyaltyTier, "loyalty_tier"),
            marketing_opt_in=account.boolean("marketing_opt_in"),
            notes=account.text("notes"),
        ),
        persona=BehavioralPersona(
            summary=persona.text("summary"),
            traits=persona.texts("traits"),
        ),
        addresses=tuple(
            AddressEntry(
                id=entry.text("id"),
                label=entry.text("label"),
                recipient=entry.text("recipient"),
                line1=entry.text("line1"),
                postal_code=entry.text("postal_code"),
                city=entry.text("city"),
                country=entry.text("country"),
                line2=entry.optional_text("line2"),
                region=entry.optional_text("region"),
                is_default=entry.boolean("is_default"),
            )
            for entry in root.readers("addresses")
        ),
        background=tuple(
            BackgroundEntry(
                id=entry.text("id"),
                kind=entry.enum(BackgroundKind, "kind"),
                occurred_on=entry.text("occurred_on"),
                note=entry.text("note"),
            )
            for entry in root.readers("background")
        ),
        hidden_facts=tuple(
            HiddenFact(
                id=entry.text("id"),
                note=entry.text("note"),
                revealed_when=entry.text("revealed_when"),
            )
            for entry in root.readers("hidden_facts")
        ),
    )
