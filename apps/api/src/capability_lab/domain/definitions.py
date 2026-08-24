from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from uuid import UUID

from capability_lab.domain.entities import DomainError


class DefinitionLifecycleError(DomainError):
    """Raised when a draft or published-version lifecycle rule is violated."""


class InvalidDefinitionReferenceError(DefinitionLifecycleError):
    """Raised when a definition references a target its type may not reference."""


class CrossShopReferenceError(DefinitionLifecycleError):
    """Raised when a shop-scoped reference crosses shop boundaries."""


class RequiredReferenceCountError(DefinitionLifecycleError):
    """Raised when a published version misses a required reference cardinality."""


class DefinitionType(StrEnum):
    SHOP = "shop"
    CUSTOMER_PROFILE = "customer_profile"
    SUPPORT_IDENTITY = "support_identity"
    TICKET = "ticket"
    SCENARIO = "scenario"
    OBJECTIVE_BLOCK = "objective_block"
    MUTATION_BLOCK = "mutation_block"
    AGENT_CONFIGURATION = "agent_configuration"


SHOP_SCOPED_DEFINITION_TYPES: frozenset[DefinitionType] = frozenset(
    {DefinitionType.TICKET, DefinitionType.SCENARIO}
)

# Which definition types may hold pinned references to which target types. Same-shop
# parameter bindings inside scenario payloads arrive with later slices; this table governs
# definition-to-definition references only.
ALLOWED_REFERENCE_TARGETS: dict[DefinitionType, frozenset[DefinitionType]] = {
    DefinitionType.SHOP: frozenset(),
    DefinitionType.CUSTOMER_PROFILE: frozenset(),
    DefinitionType.SUPPORT_IDENTITY: frozenset(),
    DefinitionType.TICKET: frozenset({DefinitionType.CUSTOMER_PROFILE}),
    DefinitionType.SCENARIO: frozenset(
        {
            DefinitionType.TICKET,
            DefinitionType.OBJECTIVE_BLOCK,
            DefinitionType.MUTATION_BLOCK,
        }
    ),
    DefinitionType.OBJECTIVE_BLOCK: frozenset(),
    DefinitionType.MUTATION_BLOCK: frozenset(),
    DefinitionType.AGENT_CONFIGURATION: frozenset({DefinitionType.SUPPORT_IDENTITY}),
}

# References whose source and target are both shop-scoped must stay inside one shop.
SAME_SHOP_REFERENCE_PAIRS: frozenset[tuple[DefinitionType, DefinitionType]] = frozenset(
    {(DefinitionType.SCENARIO, DefinitionType.TICKET)}
)

# Exact reference counts a published version must satisfy; drafts may stay incomplete.
# Block references remain 0..N and are not listed.
REQUIRED_REFERENCE_COUNTS: dict[DefinitionType, dict[DefinitionType, int]] = {
    DefinitionType.TICKET: {DefinitionType.CUSTOMER_PROFILE: 1},
    DefinitionType.SCENARIO: {DefinitionType.TICKET: 1},
    DefinitionType.AGENT_CONFIGURATION: {DefinitionType.SUPPORT_IDENTITY: 1},
}

_SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")


def _require_utc(value: datetime, field_name: str) -> None:
    if value.utcoffset() != timedelta(0):
        raise DomainError(f"{field_name} must be timezone-aware UTC")


def _require_definition_type(value: object) -> None:
    if not isinstance(value, DefinitionType):
        raise DomainError("definition type must be a supported definition type")


def _require_uuid(value: object) -> None:
    if not isinstance(value, UUID):
        raise DomainError("definition ID must be a UUID")


@dataclass(frozen=True, slots=True)
class DefinitionId:
    """Stable identity of an authorable definition across its draft and every version."""

    definition_type: DefinitionType
    id: UUID

    def __post_init__(self) -> None:
        _require_definition_type(self.definition_type)
        _require_uuid(self.id)


@dataclass(frozen=True, slots=True)
class VersionRef:
    """Reference to one exact published version of a definition."""

    definition: DefinitionId
    version: int

    def __post_init__(self) -> None:
        _require_published_version_number(self.version)


def _require_published_version_number(value: object) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise DomainError("definition version must be a positive integer")


def _require_shop_scope(definition: DefinitionId, shop: DefinitionId | None) -> None:
    if definition.definition_type in SHOP_SCOPED_DEFINITION_TYPES:
        if shop is None:
            raise DefinitionLifecycleError(
                f"{definition.definition_type} definitions must declare their owning shop"
            )
        if shop.definition_type is not DefinitionType.SHOP:
            raise DefinitionLifecycleError("definition scope must reference a shop definition")
    elif shop is not None:
        raise DefinitionLifecycleError(
            f"{definition.definition_type} definitions are shop-independent"
        )


def _require_allowed_references(
    definition: DefinitionId, targets: tuple[DefinitionId, ...]
) -> None:
    allowed = ALLOWED_REFERENCE_TARGETS[definition.definition_type]
    seen: set[DefinitionId] = set()
    for target in targets:
        if target.definition_type not in allowed:
            raise InvalidDefinitionReferenceError(
                f"{definition.definition_type} definitions cannot reference "
                f"{target.definition_type} definitions"
            )
        if target in seen:
            raise InvalidDefinitionReferenceError(
                "definition references must be unique per target definition"
            )
        seen.add(target)


def _require_reference_counts(definition: DefinitionId, targets: tuple[DefinitionId, ...]) -> None:
    for target_type, required in REQUIRED_REFERENCE_COUNTS.get(
        definition.definition_type, {}
    ).items():
        count = sum(1 for target in targets if target.definition_type is target_type)
        if count != required:
            raise RequiredReferenceCountError(
                f"a published {definition.definition_type} must reference exactly "
                f"{required} {target_type} definition(s), found {count}"
            )


@dataclass(frozen=True, slots=True)
class DefinitionDraft:
    """The single editable draft of a definition; editing replaces the draft value."""

    definition: DefinitionId
    shop: DefinitionId | None = None
    references: tuple[DefinitionId, ...] = ()

    def __post_init__(self) -> None:
        _require_shop_scope(self.definition, self.shop)
        _require_allowed_references(self.definition, self.references)


@dataclass(frozen=True, slots=True)
class PublishedDefinitionVersion:
    """An immutable published version; every reference is pinned to an exact version."""

    definition: DefinitionId
    version: int
    content_fingerprint: str
    published_at: datetime
    shop: DefinitionId | None = None
    shop_version: int | None = None
    references: tuple[VersionRef, ...] = ()

    def __post_init__(self) -> None:
        _require_published_version_number(self.version)
        if _SHA256_PATTERN.fullmatch(self.content_fingerprint) is None:
            raise DomainError("content fingerprint must be a SHA-256 hex digest")
        _require_shop_scope(self.definition, self.shop)
        if self.shop is None:
            if self.shop_version is not None:
                raise DefinitionLifecycleError(
                    "a shop-independent published version cannot pin a shop version"
                )
        else:
            _require_published_version_number(self.shop_version)
        targets = tuple(reference.definition for reference in self.references)
        _require_allowed_references(self.definition, targets)
        _require_reference_counts(self.definition, targets)
        _require_utc(self.published_at, "published_at")

    @property
    def ref(self) -> VersionRef:
        return VersionRef(definition=self.definition, version=self.version)

    @property
    def scope_ref(self) -> VersionRef | None:
        """The pinned shop version this shop-scoped version was published against."""
        if self.shop is None or self.shop_version is None:
            return None
        return VersionRef(definition=self.shop, version=self.shop_version)


def publish_draft(
    draft: DefinitionDraft,
    *,
    latest_published_version: int | None,
    pinned_scope: PublishedDefinitionVersion | None,
    pinned_references: tuple[PublishedDefinitionVersion, ...],
    content_fingerprint: str,
    published_at: datetime,
) -> PublishedDefinitionVersion:
    """Freeze the draft into the next published version with fully pinned references."""
    if latest_published_version is not None:
        _require_published_version_number(latest_published_version)

    if draft.shop is None:
        if pinned_scope is not None:
            raise DefinitionLifecycleError(
                f"{draft.definition.definition_type} definitions are shop-independent "
                "and cannot pin a shop version"
            )
    elif pinned_scope is None or pinned_scope.definition != draft.shop:
        raise DefinitionLifecycleError(
            "publishing a shop-scoped definition requires a published version of its shop"
        )

    pinned_by_definition = {pinned.definition: pinned for pinned in pinned_references}
    if len(pinned_by_definition) != len(pinned_references):
        raise InvalidDefinitionReferenceError(
            "pinned references must be unique per target definition"
        )
    if set(pinned_by_definition) != set(draft.references):
        raise InvalidDefinitionReferenceError(
            "pinned references must cover exactly the draft's referenced definitions"
        )
    for pinned in pinned_references:
        pair = (draft.definition.definition_type, pinned.definition.definition_type)
        if pair in SAME_SHOP_REFERENCE_PAIRS and pinned.shop != draft.shop:
            raise CrossShopReferenceError(
                f"a {pair[0]} can only reference a {pair[1]} in the same shop"
            )

    next_version = 1 if latest_published_version is None else latest_published_version + 1
    return PublishedDefinitionVersion(
        definition=draft.definition,
        version=next_version,
        content_fingerprint=content_fingerprint,
        published_at=published_at,
        shop=draft.shop,
        shop_version=None if pinned_scope is None else pinned_scope.version,
        references=tuple(pinned_by_definition[reference].ref for reference in draft.references),
    )


class DefinitionIssueSeverity(StrEnum):
    ERROR = "error"
    WARNING = "warning"


@dataclass(frozen=True, slots=True)
class DefinitionIssue:
    """One publish-gate finding. Errors block publication; warnings never do."""

    severity: DefinitionIssueSeverity
    code: str
    message: str
    path: str


@dataclass(frozen=True, slots=True)
class DefinitionValidation:
    """Every publish-gate finding for one draft payload."""

    issues: tuple[DefinitionIssue, ...] = ()

    @property
    def errors(self) -> tuple[DefinitionIssue, ...]:
        return tuple(
            issue for issue in self.issues if issue.severity is DefinitionIssueSeverity.ERROR
        )

    @property
    def warnings(self) -> tuple[DefinitionIssue, ...]:
        return tuple(
            issue for issue in self.issues if issue.severity is DefinitionIssueSeverity.WARNING
        )

    @property
    def publishable(self) -> bool:
        return not self.errors


def issue_error(code: str, message: str, path: str) -> DefinitionIssue:
    return DefinitionIssue(
        severity=DefinitionIssueSeverity.ERROR, code=code, message=message, path=path
    )


def issue_warning(code: str, message: str, path: str) -> DefinitionIssue:
    return DefinitionIssue(
        severity=DefinitionIssueSeverity.WARNING, code=code, message=message, path=path
    )


def validation_of(issues: list[DefinitionIssue]) -> DefinitionValidation:
    """Order findings deterministically: errors before warnings, then path and code."""
    return DefinitionValidation(
        issues=tuple(
            sorted(
                issues,
                key=lambda issue: (
                    issue.severity is DefinitionIssueSeverity.WARNING,
                    issue.path,
                    issue.code,
                ),
            )
        )
    )


class DefinitionChangeKind(StrEnum):
    ADDED = "added"
    REMOVED = "removed"
    UPDATED = "updated"


@dataclass(frozen=True, slots=True)
class DefinitionChange:
    """One authored difference between a draft and its latest published version."""

    kind: DefinitionChangeKind
    path: str
    description: str


def keyed[EntryT](entries: tuple[EntryT, ...], key: Callable[[EntryT], str]) -> dict[str, EntryT]:
    return {key(entry): entry for entry in entries}


def diff_keyed_collection[EntryT](
    previous: tuple[EntryT, ...],
    current: tuple[EntryT, ...],
    *,
    key: Callable[[EntryT], str],
    label: Callable[[EntryT], str],
    path: str,
    noun: str,
    include_updates: bool = True,
) -> list[DefinitionChange]:
    """Diff one keyed collection.

    `include_updates=False` reports only membership, for collections whose entries are
    diffed field by field elsewhere; otherwise one edit would be reported twice.
    """
    before = keyed(previous, key)
    after = keyed(current, key)
    changes: list[DefinitionChange] = []
    for identifier in sorted(after.keys() - before.keys()):
        changes.append(
            DefinitionChange(
                kind=DefinitionChangeKind.ADDED,
                path=f"{path}.{identifier}",
                description=f"Added {noun} {label(after[identifier])}",
            )
        )
    for identifier in sorted(before.keys() - after.keys()):
        changes.append(
            DefinitionChange(
                kind=DefinitionChangeKind.REMOVED,
                path=f"{path}.{identifier}",
                description=f"Removed {noun} {label(before[identifier])}",
            )
        )
    if include_updates:
        for identifier in sorted(before.keys() & after.keys()):
            if before[identifier] != after[identifier]:
                changes.append(
                    DefinitionChange(
                        kind=DefinitionChangeKind.UPDATED,
                        path=f"{path}.{identifier}",
                        description=f"Updated {noun} {label(after[identifier])}",
                    )
                )
    return changes


def field_changes(
    path: str,
    fields: tuple[tuple[str, object, object], ...],
    describe: Callable[[str], str],
) -> list[DefinitionChange]:
    """Report each scalar field whose value differs between two payload entries."""
    return [
        DefinitionChange(
            kind=DefinitionChangeKind.UPDATED,
            path=f"{path}.{name}",
            description=describe(name),
        )
        for name, before, after in fields
        if before != after
    ]
