"""Support-identity invariants, permission publish gate, and change summary."""

from dataclasses import replace

import pytest

from capability_lab.domain.definitions import DefinitionChangeKind
from capability_lab.domain.support_identity import (
    EscalationPolicy,
    SupportIdentityConfigurationError,
    SupportIdentityPayload,
    SupportPermission,
    summarize_support_identity_changes,
    validate_support_identity,
)
from definition_factories import guidance_note, publishable_identity, support_role


def codes(payload: SupportIdentityPayload) -> set[str]:
    return {issue.code for issue in validate_support_identity(payload).issues}


def test_an_identity_rejects_duplicate_permissions_and_guidance_ids() -> None:
    with pytest.raises(SupportIdentityConfigurationError, match="support permissions must"):
        publishable_identity(
            permissions=(SupportPermission.READ_ORDERS, SupportPermission.READ_ORDERS)
        )
    with pytest.raises(SupportIdentityConfigurationError, match="guidance note IDs must"):
        publishable_identity(guidance=(guidance_note(), guidance_note()))


def test_a_role_requires_a_name_and_a_title() -> None:
    with pytest.raises(SupportIdentityConfigurationError, match="support identity name"):
        support_role(name="  ")
    with pytest.raises(SupportIdentityConfigurationError, match="support identity title"):
        support_role(title="")


def test_a_complete_identity_has_no_publish_gate_findings() -> None:
    assert validate_support_identity(publishable_identity()).issues == ()


def test_publication_requires_at_least_one_permission() -> None:
    assert "identity_without_permission" in codes(publishable_identity(permissions=()))


def test_publication_refuses_an_identity_that_can_only_mutate() -> None:
    """An agent that cannot look anything up cannot be audited against what it saw."""
    payload = publishable_identity(permissions=(SupportPermission.APPLY_DISCOUNT,))

    assert "identity_without_read_permission" in codes(payload)


def test_publication_refuses_an_order_mutation_without_reading_orders() -> None:
    payload = publishable_identity(
        permissions=(
            SupportPermission.READ_POLICIES,
            SupportPermission.CHANGE_SHIPPING_ADDRESS,
            SupportPermission.ISSUE_REFUND,
        )
    )
    validation = validate_support_identity(payload)

    assert not validation.publishable
    messages = [issue.message for issue in validation.errors]
    assert any("change_shipping_address" in message for message in messages)
    assert any("issue_refund" in message for message in messages)


def test_escalation_conditions_without_a_target_block_publication() -> None:
    payload = publishable_identity(
        escalation=EscalationPolicy(escalate_to="", conditions=("Refund above 200 EUR",))
    )

    assert "escalation_without_target" in codes(payload)


def test_missing_guidance_and_escalation_only_warn() -> None:
    payload = publishable_identity(guidance=(), escalation=EscalationPolicy())
    validation = validate_support_identity(payload)

    assert validation.publishable
    assert {issue.code for issue in validation.warnings} == {
        "identity_without_guidance",
        "identity_without_escalation_condition",
    }


def test_the_first_version_is_summarized_as_a_whole_identity() -> None:
    changes = summarize_support_identity_changes(None, publishable_identity())

    assert len(changes) == 1
    assert changes[0].kind is DefinitionChangeKind.ADDED
    assert "Northstar tier 1" in changes[0].description


def test_the_change_summary_reports_granted_and_revoked_permissions() -> None:
    published = publishable_identity()
    draft = replace(
        published,
        permissions=(
            SupportPermission.READ_ORDERS,
            SupportPermission.READ_POLICIES,
            SupportPermission.CANCEL_ORDER,
        ),
    )

    changes = {
        change.path: change.kind for change in summarize_support_identity_changes(published, draft)
    }

    assert changes["permissions.cancel_order"] is DefinitionChangeKind.ADDED
    assert changes["permissions.change_shipping_address"] is DefinitionChangeKind.REMOVED


def test_the_change_summary_reports_role_and_escalation_edits() -> None:
    published = publishable_identity()
    draft = replace(
        published,
        role=support_role(title="Senior support representative"),
        escalation=EscalationPolicy(
            escalate_to="Tier 3 support", conditions=("Refund above 200 EUR",)
        ),
    )

    paths = {change.path for change in summarize_support_identity_changes(published, draft)}

    assert paths == {"role.title", "escalation.escalate_to", "escalation.conditions"}
