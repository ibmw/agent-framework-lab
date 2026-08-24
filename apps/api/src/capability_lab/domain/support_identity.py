"""Typed support identity: the role, permissions, and guidance a support agent adopts.

A support identity is the authored content of a `support_identity` definition. It is
shop-independent, so the same identity can be adopted in any shop, and an agent
configuration references exactly one of its published versions (ADR 0012).

Tone of voice is deliberately **not** part of a support identity: ADR 0012 makes tone a
shop-level concern, and an agent configuration selects the shop default or a named
override. What lives here is what the agent *is* and what it is *allowed to do*.

Permissions are a closed enumeration rather than free-form strings, because the tool layer
authorizes against them: a permission that does not exist in code can never be granted by
authored content.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from functools import partial

from capability_lab.domain.content import (
    require_instance,
    require_label,
    require_slug,
    require_text,
    require_unique,
)
from capability_lab.domain.definitions import (
    DefinitionChange,
    DefinitionChangeKind,
    DefinitionIssue,
    DefinitionValidation,
    diff_keyed_collection,
    field_changes,
    issue_error,
    issue_warning,
    validation_of,
)
from capability_lab.domain.entities import DomainError


class SupportIdentityConfigurationError(DomainError):
    """Raised when support-identity content violates a structural invariant."""


_error_type = SupportIdentityConfigurationError
_require_slug = partial(require_slug, error=_error_type)
_require_label = partial(require_label, error=_error_type)
_require_text = partial(require_text, error=_error_type)
_require_unique = partial(require_unique, error=_error_type)
_require_instance = partial(require_instance, error=_error_type)


class SupportPermission(StrEnum):
    """What a support identity is authorized to do; extended deliberately, in code."""

    READ_CATALOG = "read_catalog"
    READ_CUSTOMER = "read_customer"
    READ_ORDERS = "read_orders"
    READ_POLICIES = "read_policies"
    CANCEL_ORDER = "cancel_order"
    CHANGE_SHIPPING_ADDRESS = "change_shipping_address"
    ISSUE_REFUND = "issue_refund"
    APPLY_DISCOUNT = "apply_discount"
    ESCALATE_TO_HUMAN = "escalate_to_human"


READ_PERMISSIONS: frozenset[SupportPermission] = frozenset(
    {
        SupportPermission.READ_CATALOG,
        SupportPermission.READ_CUSTOMER,
        SupportPermission.READ_ORDERS,
        SupportPermission.READ_POLICIES,
    }
)

# A mutation an agent cannot first read is unauditable: it would have to act on an order
# it never looked at. Publishing refuses that combination.
#
# `apply_discount` is deliberately absent: it is a catalog-level offer, not an edit to an
# existing order, so it needs no `read_orders` pair. A future permission that does act on an
# order must be added here, not merely to `SupportPermission`.
ORDER_MUTATION_PERMISSIONS: frozenset[SupportPermission] = frozenset(
    {
        SupportPermission.CANCEL_ORDER,
        SupportPermission.CHANGE_SHIPPING_ADDRESS,
        SupportPermission.ISSUE_REFUND,
    }
)


@dataclass(frozen=True, slots=True)
class SupportRole:
    """Who the agent is when it answers: its name, role title, and remit."""

    name: str
    title: str
    description: str = ""

    def __post_init__(self) -> None:
        _require_label(self.name, "support identity name")
        _require_label(self.title, "support identity title")
        _require_text(self.description, "support identity description", allow_empty=True)


@dataclass(frozen=True, slots=True)
class GuidanceNote:
    """One piece of role guidance the agent is expected to follow."""

    id: str
    title: str
    body: str

    def __post_init__(self) -> None:
        _require_slug(self.id, "guidance note ID")
        _require_label(self.title, "guidance note title")
        _require_text(self.body, "guidance note body")


@dataclass(frozen=True, slots=True)
class EscalationPolicy:
    """When the agent must hand the incident to a human, and to whom."""

    escalate_to: str = ""
    conditions: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        _require_text(self.escalate_to, "escalation target", allow_empty=True)
        for condition in self.conditions:
            _require_label(condition, "escalation condition")
        _require_unique(self.conditions, "escalation conditions")


@dataclass(frozen=True, slots=True)
class SupportIdentityPayload:
    """The complete authored content of one support-identity draft or version."""

    role: SupportRole
    permissions: tuple[SupportPermission, ...] = ()
    guidance: tuple[GuidanceNote, ...] = ()
    escalation: EscalationPolicy = EscalationPolicy()

    def __post_init__(self) -> None:
        _require_instance(self.role, SupportRole, "a support identity must declare its role")
        _require_instance(
            self.escalation,
            EscalationPolicy,
            "a support identity must declare an escalation policy",
        )
        for permission in self.permissions:
            _require_instance(
                permission, SupportPermission, "permissions must be supported permissions"
            )
        _require_unique(
            tuple(permission.value for permission in self.permissions), "support permissions"
        )
        _require_unique(tuple(note.id for note in self.guidance), "guidance note IDs")

    @property
    def granted(self) -> frozenset[SupportPermission]:
        return frozenset(self.permissions)


def validate_support_identity(payload: SupportIdentityPayload) -> DefinitionValidation:
    """Report every publish-gate finding for a support-identity draft."""
    issues: list[DefinitionIssue] = []
    granted = payload.granted

    if not granted:
        issues.append(
            issue_error(
                "identity_without_permission",
                "a published support identity must grant at least one permission",
                "permissions",
            )
        )
    elif not granted & READ_PERMISSIONS:
        issues.append(
            issue_error(
                "identity_without_read_permission",
                "a support identity that can only mutate state cannot look anything up first",
                "permissions",
            )
        )

    if granted & ORDER_MUTATION_PERMISSIONS and SupportPermission.READ_ORDERS not in granted:
        for permission in sorted(granted & ORDER_MUTATION_PERMISSIONS):
            issues.append(
                issue_error(
                    "order_mutation_without_read_orders",
                    f"{permission.value} acts on an order the identity is not allowed to read",
                    "permissions",
                )
            )

    if not payload.guidance:
        issues.append(
            issue_warning(
                "identity_without_guidance",
                "the identity carries no guidance for the agent to follow",
                "guidance",
            )
        )
    if not payload.escalation.conditions:
        issues.append(
            issue_warning(
                "identity_without_escalation_condition",
                "the identity never escalates, so no incident can reach a human",
                "escalation.conditions",
            )
        )
    if payload.escalation.conditions and not payload.escalation.escalate_to:
        issues.append(
            issue_error(
                "escalation_without_target",
                "escalation conditions are defined but no target is named",
                "escalation.escalate_to",
            )
        )

    return validation_of(issues)


def summarize_support_identity_changes(
    previous: SupportIdentityPayload | None, current: SupportIdentityPayload
) -> tuple[DefinitionChange, ...]:
    """Describe what publishing this draft would freeze, against the latest version."""
    if previous is None:
        return (
            DefinitionChange(
                kind=DefinitionChangeKind.ADDED,
                path="",
                description=f"First published version of {current.role.name}",
            ),
        )

    changes: list[DefinitionChange] = []
    changes.extend(
        field_changes(
            "role",
            (
                ("name", previous.role.name, current.role.name),
                ("title", previous.role.title, current.role.title),
                ("description", previous.role.description, current.role.description),
            ),
            lambda name: f"Updated role {name}",
        )
    )

    before = previous.granted
    after = current.granted
    for permission in sorted(after - before):
        changes.append(
            DefinitionChange(
                kind=DefinitionChangeKind.ADDED,
                path=f"permissions.{permission.value}",
                description=f"Granted {permission.value}",
            )
        )
    for permission in sorted(before - after):
        changes.append(
            DefinitionChange(
                kind=DefinitionChangeKind.REMOVED,
                path=f"permissions.{permission.value}",
                description=f"Revoked {permission.value}",
            )
        )

    changes.extend(
        diff_keyed_collection(
            previous.guidance,
            current.guidance,
            key=lambda note: note.id,
            label=lambda note: note.title,
            path="guidance",
            noun="guidance note",
        )
    )
    changes.extend(
        field_changes(
            "escalation",
            (
                ("escalate_to", previous.escalation.escalate_to, current.escalation.escalate_to),
                ("conditions", previous.escalation.conditions, current.escalation.conditions),
            ),
            lambda name: f"Updated escalation {name.replace('_', ' ')}",
        )
    )
    return tuple(changes)
