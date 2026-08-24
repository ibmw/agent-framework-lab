"""Customer-profile invariants, publish gate, change summary, and data sensitivity."""

from dataclasses import replace
from typing import cast

import pytest

from capability_lab.application.customer_profile_payload import customer_profile_document
from capability_lab.domain.content import FieldSensitivity, leaf_paths
from capability_lab.domain.customer_profile import (
    FIELD_SENSITIVITY,
    MAX_PERSONA_TRAITS,
    AccountStatus,
    BehavioralPersona,
    CustomerProfileConfigurationError,
    CustomerProfilePayload,
    LoyaltyTier,
    restricted_values,
    summarize_customer_profile_changes,
    telemetry_attributes,
    unclassified_paths,
    validate_customer_profile,
)
from capability_lab.domain.definitions import DefinitionChangeKind
from definition_factories import (
    account_facts,
    address,
    customer_identity,
    hidden_fact,
    persona,
    publishable_profile,
)


def codes(payload: CustomerProfilePayload) -> set[str]:
    return {issue.code for issue in validate_customer_profile(payload).issues}


def test_a_profile_rejects_an_address_book_with_two_defaults() -> None:
    with pytest.raises(CustomerProfileConfigurationError, match="at most one default address"):
        publishable_profile(
            addresses=(address(), address("office", label="Office", is_default=True))
        )


def test_a_profile_rejects_duplicate_entry_identifiers() -> None:
    with pytest.raises(CustomerProfileConfigurationError, match="address IDs must be unique"):
        publishable_profile(addresses=(address(), address()))
    with pytest.raises(CustomerProfileConfigurationError, match="hidden fact IDs must be unique"):
        publishable_profile(hidden_facts=(hidden_fact(), hidden_fact()))


def test_an_identity_rejects_a_malformed_email_without_echoing_it() -> None:
    with pytest.raises(CustomerProfileConfigurationError) as raised:
        customer_identity(email="maya at example.org")

    assert "maya at example.org" not in str(raised.value)


def test_an_account_rejects_a_date_that_is_not_a_real_calendar_day() -> None:
    with pytest.raises(CustomerProfileConfigurationError, match="real calendar date"):
        account_facts(customer_since="2026-02-30")


def test_a_persona_rejects_duplicate_and_excessive_traits() -> None:
    with pytest.raises(CustomerProfileConfigurationError, match="persona traits must be unique"):
        persona(traits=("direct", "direct"))
    with pytest.raises(CustomerProfileConfigurationError, match="at most 12 traits"):
        persona(traits=tuple(f"trait-{index}" for index in range(MAX_PERSONA_TRAITS + 1)))


def test_a_complete_profile_has_no_publish_gate_findings() -> None:
    assert validate_customer_profile(publishable_profile()).issues == ()


def test_publication_requires_an_address_book_with_a_default() -> None:
    assert "profile_without_address" in codes(publishable_profile(addresses=()))

    without_default = publishable_profile(
        addresses=(address(is_default=False), address("office", label="Office", is_default=False))
    )
    assert "address_book_without_default" in codes(without_default)
    assert not validate_customer_profile(without_default).publishable


def test_publication_requires_a_persona_summary_but_only_warns_about_traits() -> None:
    without_summary = publishable_profile(persona=BehavioralPersona(summary=""))
    assert "persona_without_summary" in codes(without_summary)

    without_traits = publishable_profile(persona=persona(traits=()))
    validation = validate_customer_profile(without_traits)
    assert validation.publishable
    assert {issue.code for issue in validation.warnings} == {"persona_without_trait"}


def test_duplicate_address_labels_warn_because_the_order_picker_becomes_ambiguous() -> None:
    payload = publishable_profile(
        addresses=(address(), address("second-home", label="Home", is_default=False))
    )
    validation = validate_customer_profile(payload)

    assert validation.publishable
    assert "duplicate_address_label" in {issue.code for issue in validation.warnings}


def test_an_empty_background_only_warns() -> None:
    validation = validate_customer_profile(publishable_profile(background=()))

    assert validation.publishable
    assert "profile_without_background" in {issue.code for issue in validation.warnings}


def test_the_first_version_is_summarized_as_a_whole_profile() -> None:
    changes = summarize_customer_profile_changes(None, publishable_profile())

    assert len(changes) == 1
    assert changes[0].kind is DefinitionChangeKind.ADDED
    assert "Maya Laurent" in changes[0].description


def test_the_change_summary_names_the_edited_field_without_repeating_its_value() -> None:
    published = publishable_profile()
    draft = replace(
        published,
        identity=customer_identity(email="maya.laurent+new@example.org"),
        account=account_facts(loyalty_tier=LoyaltyTier.GOLD, status=AccountStatus.DORMANT),
    )

    changes = summarize_customer_profile_changes(published, draft)
    paths = {change.path for change in changes}
    descriptions = " ".join(change.description for change in changes)

    assert paths == {"identity.email", "account.loyalty_tier", "account.status"}
    assert "maya.laurent+new@example.org" not in descriptions


def test_the_change_summary_reports_address_book_membership_and_edits() -> None:
    published = publishable_profile()
    draft = replace(
        published,
        addresses=(
            address(line1="42 cours de la Marne"),
            address("parents", label="Parent's house", is_default=False),
        ),
    )

    changes = {
        change.path: change.kind for change in summarize_customer_profile_changes(published, draft)
    }

    assert changes["addresses.parents"] is DefinitionChangeKind.ADDED
    assert changes["addresses.office"] is DefinitionChangeKind.REMOVED
    assert changes["addresses.home"] is DefinitionChangeKind.UPDATED


def test_every_document_leaf_is_classified_as_sensitive_or_operational() -> None:
    """A newly authored field must not slip past the log/trace sensitivity decision."""
    document = customer_profile_document(publishable_profile())

    assert unclassified_paths(document) == frozenset()


def test_the_classification_covers_no_field_the_document_does_not_carry() -> None:
    document = customer_profile_document(publishable_profile())

    assert frozenset(FIELD_SENSITIVITY) == leaf_paths(document)


def test_telemetry_attributes_disclose_no_authored_customer_text() -> None:
    payload = publishable_profile()
    attributes = telemetry_attributes(payload)
    emitted = " ".join(str(value) for value in attributes.values())

    for restricted in restricted_values(payload):
        assert restricted not in emitted

    assert attributes["lab.customer_profile.address_count"] == 2
    assert attributes["lab.customer_profile.has_default_address"] is True
    assert attributes["lab.customer_profile.hidden_fact_count"] == 1
    assert attributes["lab.customer_profile.address_countries"] == "FR"


def test_restricted_values_cover_every_sensitive_and_customer_only_leaf() -> None:
    payload = publishable_profile()
    document = customer_profile_document(payload)
    restricted = set(restricted_values(payload))

    for path, sensitivity in FIELD_SENSITIVITY.items():
        if sensitivity is FieldSensitivity.OPERATIONAL:
            continue
        for value in _values_at(document, path):
            assert value in restricted, path


def test_the_persona_and_hidden_facts_are_customer_only() -> None:
    """They guide the operator and the future simulator, never the support agent."""
    customer_only = {
        path
        for path, sensitivity in FIELD_SENSITIVITY.items()
        if sensitivity is FieldSensitivity.CUSTOMER_ONLY
    }

    assert customer_only == {
        "persona.summary",
        "persona.traits[]",
        "hidden_facts[].note",
        "hidden_facts[].revealed_when",
    }


def _values_at(document: object, path: str) -> list[str]:
    """Collect every string value a `foo[].bar` document path resolves to."""
    if not path:
        return [document] if isinstance(document, str) else []
    if not isinstance(document, dict):
        return []
    entries = cast("dict[str, object]", document)
    head, _, rest = path.partition(".")
    if head.endswith("[]"):
        items = entries.get(head[:-2])
        if not isinstance(items, list):
            return []
        return [value for entry in cast("list[object]", items) for value in _values_at(entry, rest)]
    child = entries.get(head)
    if rest:
        return _values_at(child, rest)
    if isinstance(child, list):
        return [value for value in cast("list[object]", child) if isinstance(value, str)]
    return [child] if isinstance(child, str) else []
