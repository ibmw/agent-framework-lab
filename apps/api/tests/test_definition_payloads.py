"""Canonical serialization of the two payload schemas introduced with this slice."""

import json
from collections.abc import Callable
from dataclasses import replace

import pytest

from capability_lab.application.canonical_json import CanonicalSerializationError
from capability_lab.application.customer_profile_payload import (
    CUSTOMER_PROFILE_PAYLOAD_CANONICAL_SCHEMA_VERSION,
    customer_profile_canonical_json,
    customer_profile_content_fingerprint,
    customer_profile_document,
    customer_profile_from_document,
)
from capability_lab.application.support_identity_payload import (
    SUPPORT_IDENTITY_PAYLOAD_CANONICAL_SCHEMA_VERSION,
    support_identity_canonical_json,
    support_identity_content_fingerprint,
    support_identity_document,
    support_identity_from_document,
)
from capability_lab.domain.customer_profile import (
    AccountStatus,
    BackgroundKind,
    BehavioralPersona,
    CustomerProfilePayload,
    LoyaltyTier,
)
from capability_lab.domain.support_identity import (
    EscalationPolicy,
    SupportIdentityPayload,
    SupportPermission,
)
from definition_factories import (
    account_facts,
    address,
    background_entry,
    customer_identity,
    guidance_note,
    hidden_fact,
    persona,
    publishable_identity,
    publishable_profile,
    support_role,
)


def test_a_customer_profile_round_trips_through_its_canonical_document() -> None:
    payload = publishable_profile()

    assert customer_profile_from_document(customer_profile_document(payload)) == payload


def test_a_support_identity_round_trips_through_its_canonical_document() -> None:
    payload = publishable_identity()

    assert support_identity_from_document(support_identity_document(payload)) == payload


def test_a_profile_without_optional_fields_round_trips_with_nulls_preserved() -> None:
    payload = publishable_profile(
        identity=customer_identity(phone=None),
        addresses=(address(line2=None, region=None),),
        background=(),
        hidden_facts=(),
    )
    document = customer_profile_document(payload)

    assert document["identity"]["phone"] is None  # type: ignore[index]
    assert customer_profile_from_document(document) == payload


def test_both_documents_declare_their_schema_version() -> None:
    profile = json.loads(customer_profile_canonical_json(publishable_profile()))
    identity = json.loads(support_identity_canonical_json(publishable_identity()))

    assert profile["canonical_schema_version"] == CUSTOMER_PROFILE_PAYLOAD_CANONICAL_SCHEMA_VERSION
    assert identity["canonical_schema_version"] == (
        SUPPORT_IDENTITY_PAYLOAD_CANONICAL_SCHEMA_VERSION
    )


def test_canonical_json_is_sorted_and_compact() -> None:
    encoded = customer_profile_canonical_json(publishable_profile()).decode()

    assert encoded == json.dumps(
        json.loads(encoded), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )


type ProfileEdit = Callable[[CustomerProfilePayload], CustomerProfilePayload]
type IdentityEdit = Callable[[SupportIdentityPayload], SupportIdentityPayload]

# One behaviourally relevant edit per authored section; each must change the fingerprint.
PROFILE_EDITS: dict[str, ProfileEdit] = {
    "identity-given-name": lambda payload: replace(
        payload, identity=customer_identity(given_name="Maja")
    ),
    "identity-email": lambda payload: replace(
        payload, identity=customer_identity(email="maya.l@example.org")
    ),
    "identity-phone-cleared": lambda payload: replace(
        payload, identity=customer_identity(phone=None)
    ),
    "identity-locale": lambda payload: replace(payload, identity=customer_identity(locale="fr")),
    "account-customer-since": lambda payload: replace(
        payload, account=account_facts(customer_since="2024-03-15")
    ),
    "account-loyalty-tier": lambda payload: replace(
        payload, account=account_facts(loyalty_tier=LoyaltyTier.GOLD)
    ),
    "account-marketing-opt-in": lambda payload: replace(
        payload, account=account_facts(marketing_opt_in=False)
    ),
    "account-notes": lambda payload: replace(payload, account=account_facts(notes="")),
    "account-status": lambda payload: replace(
        payload, account=account_facts(status=AccountStatus.DORMANT)
    ),
    "persona-traits": lambda payload: replace(payload, persona=persona(traits=("direct",))),
    "persona-summary": lambda payload: replace(
        payload, persona=BehavioralPersona(summary="Different.")
    ),
    "address-city": lambda payload: replace(payload, addresses=(address(city="Bordeaux"),)),
    "address-default": lambda payload: replace(payload, addresses=(address(is_default=False),)),
    "hidden-fact": lambda payload: replace(payload, hidden_facts=(hidden_fact(revealed_when=""),)),
    "address-label": lambda payload: replace(payload, addresses=(address(label="Main"),)),
    "address-optional-line": lambda payload: replace(
        payload, addresses=(address(line2="Bâtiment B"),)
    ),
    "background-note": lambda payload: replace(
        payload, background=(background_entry(note="Different note."),)
    ),
    "background-date": lambda payload: replace(
        payload, background=(background_entry(occurred_on="2026-06-03"),)
    ),
    "background-kind": lambda payload: replace(
        payload, background=(background_entry(kind=BackgroundKind.PURCHASE),)
    ),
    "background-removed": lambda payload: replace(payload, background=()),
}


@pytest.mark.parametrize("edit_id", sorted(PROFILE_EDITS))
def test_every_behaviorally_relevant_profile_edit_changes_the_fingerprint(edit_id: str) -> None:
    payload = publishable_profile(addresses=(address(),))
    baseline = customer_profile_content_fingerprint(payload)

    assert customer_profile_content_fingerprint(PROFILE_EDITS[edit_id](payload)) != baseline


def test_granting_a_permission_changes_the_support_identity_fingerprint() -> None:
    payload = publishable_identity()
    granted = replace(payload, permissions=(*payload.permissions, SupportPermission.ISSUE_REFUND))

    assert support_identity_content_fingerprint(granted) != support_identity_content_fingerprint(
        payload
    )


def test_reordering_the_address_book_is_an_authored_change() -> None:
    """Order is content: it drives how the order editor's picker lists the entries."""
    payload = publishable_profile()
    reordered = replace(payload, addresses=tuple(reversed(payload.addresses)))

    assert customer_profile_content_fingerprint(reordered) != customer_profile_content_fingerprint(
        payload
    )


IDENTITY_EDITS: dict[str, IdentityEdit] = {
    "guidance-title": lambda payload: replace(
        payload, guidance=(guidance_note(title="Different"),)
    ),
    "guidance-removed": lambda payload: replace(payload, guidance=()),
    "escalation-target": lambda payload: replace(
        payload, escalation=EscalationPolicy(escalate_to="Tier 3", conditions=("A",))
    ),
    "escalation-conditions": lambda payload: replace(
        payload, escalation=EscalationPolicy(escalate_to="Tier 2 support", conditions=())
    ),
}


@pytest.mark.parametrize("edit_id", sorted(IDENTITY_EDITS))
def test_every_behaviorally_relevant_identity_edit_changes_the_fingerprint(edit_id: str) -> None:
    payload = publishable_identity()
    baseline = support_identity_content_fingerprint(payload)

    assert support_identity_content_fingerprint(IDENTITY_EDITS[edit_id](payload)) != baseline


def test_reordering_permissions_is_an_authored_change_not_a_normalization() -> None:
    """Permission order is content; the codec never silently sorts a stored list."""
    payload = publishable_identity()
    reordered = replace(payload, permissions=tuple(reversed(payload.permissions)))

    assert support_identity_content_fingerprint(reordered) != support_identity_content_fingerprint(
        payload
    )


def test_renaming_a_support_role_changes_the_fingerprint() -> None:
    payload = publishable_identity()
    renamed = replace(payload, role=support_role(name="Northstar tier 2"))

    assert support_identity_content_fingerprint(renamed) != support_identity_content_fingerprint(
        payload
    )


def test_a_stored_document_from_another_schema_version_is_refused() -> None:
    document = customer_profile_document(publishable_profile())
    document["canonical_schema_version"] = "customer-profile-payload-v2"

    with pytest.raises(CanonicalSerializationError, match="unsupported customer profile payload"):
        customer_profile_from_document(document)


def test_a_malformed_stored_document_reports_the_failing_path() -> None:
    document = customer_profile_document(publishable_profile())
    document["addresses"][0]["postal_code"] = 69005  # type: ignore[index]

    with pytest.raises(CanonicalSerializationError) as raised:
        customer_profile_from_document(document)

    assert "customer profile payload.addresses[0].postal_code" in str(raised.value)


def test_an_unsupported_permission_value_reports_the_failing_path() -> None:
    document = support_identity_document(publishable_identity())
    document["permissions"] = ["delete_shop"]  # type: ignore[index]

    with pytest.raises(CanonicalSerializationError) as raised:
        support_identity_from_document(document)

    assert "support identity payload.permissions[0]" in str(raised.value)
