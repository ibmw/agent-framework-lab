import dataclasses
from datetime import UTC, datetime, timedelta, timezone
from uuid import uuid4

import pytest

from capability_lab.domain.definitions import (
    CrossShopReferenceError,
    DefinitionDraft,
    DefinitionId,
    DefinitionLifecycleError,
    DefinitionType,
    InvalidDefinitionReferenceError,
    PublishedDefinitionVersion,
    RequiredReferenceCountError,
    VersionRef,
    publish_draft,
)
from capability_lab.domain.entities import DomainError

PUBLISHED_AT = datetime(2026, 8, 23, 12, 0, tzinfo=UTC)
FINGERPRINT = "a" * 64


def shop_id() -> DefinitionId:
    return DefinitionId(definition_type=DefinitionType.SHOP, id=uuid4())


def definition_id(definition_type: DefinitionType) -> DefinitionId:
    return DefinitionId(definition_type=definition_type, id=uuid4())


def published(
    definition: DefinitionId,
    *,
    version: int = 1,
    shop: DefinitionId | None = None,
    shop_version: int | None = None,
    references: tuple[VersionRef, ...] = (),
) -> PublishedDefinitionVersion:
    return PublishedDefinitionVersion(
        definition=definition,
        version=version,
        content_fingerprint=FINGERPRINT,
        published_at=PUBLISHED_AT,
        shop=shop,
        shop_version=shop_version,
        references=references,
    )


def test_definition_id_requires_supported_type_and_uuid() -> None:
    with pytest.raises(DomainError, match="supported definition type"):
        DefinitionId(definition_type="shop", id=uuid4())  # type: ignore[arg-type]
    with pytest.raises(DomainError, match="must be a UUID"):
        DefinitionId(definition_type=DefinitionType.SHOP, id="not-a-uuid")  # type: ignore[arg-type]


def test_version_ref_requires_positive_integer_version() -> None:
    definition = definition_id(DefinitionType.SCENARIO)
    for version in (0, -1, True, "v1"):
        with pytest.raises(DomainError, match="positive integer"):
            VersionRef(definition=definition, version=version)  # type: ignore[arg-type]


def test_shop_scoped_drafts_require_their_owning_shop() -> None:
    with pytest.raises(DefinitionLifecycleError, match="must declare their owning shop"):
        DefinitionDraft(definition=definition_id(DefinitionType.TICKET))
    with pytest.raises(DefinitionLifecycleError, match="must reference a shop definition"):
        DefinitionDraft(
            definition=definition_id(DefinitionType.SCENARIO),
            shop=definition_id(DefinitionType.CUSTOMER_PROFILE),
        )


def test_shop_independent_drafts_reject_a_shop_scope() -> None:
    with pytest.raises(DefinitionLifecycleError, match="shop-independent"):
        DefinitionDraft(
            definition=definition_id(DefinitionType.AGENT_CONFIGURATION),
            shop=shop_id(),
        )


@pytest.mark.parametrize(
    ("source_type", "target_type"),
    [
        (DefinitionType.SHOP, DefinitionType.CUSTOMER_PROFILE),
        (DefinitionType.SCENARIO, DefinitionType.SHOP),
        (DefinitionType.SCENARIO, DefinitionType.AGENT_CONFIGURATION),
        (DefinitionType.TICKET, DefinitionType.SCENARIO),
        (DefinitionType.AGENT_CONFIGURATION, DefinitionType.CUSTOMER_PROFILE),
        (DefinitionType.OBJECTIVE_BLOCK, DefinitionType.OBJECTIVE_BLOCK),
    ],
)
def test_drafts_reject_disallowed_reference_targets(
    source_type: DefinitionType, target_type: DefinitionType
) -> None:
    scope = shop_id() if source_type in {DefinitionType.TICKET, DefinitionType.SCENARIO} else None
    with pytest.raises(InvalidDefinitionReferenceError, match="cannot reference"):
        DefinitionDraft(
            definition=definition_id(source_type),
            shop=scope,
            references=(definition_id(target_type),),
        )


def test_drafts_reject_duplicate_references() -> None:
    profile = definition_id(DefinitionType.CUSTOMER_PROFILE)
    with pytest.raises(InvalidDefinitionReferenceError, match="unique"):
        DefinitionDraft(
            definition=definition_id(DefinitionType.TICKET),
            shop=shop_id(),
            references=(profile, profile),
        )


def test_published_version_is_immutable() -> None:
    version = published(definition_id(DefinitionType.SHOP))
    with pytest.raises(dataclasses.FrozenInstanceError):
        version.version = 2  # type: ignore[misc]
    with pytest.raises(dataclasses.FrozenInstanceError):
        version.content_fingerprint = "b" * 64  # type: ignore[misc]


def test_published_version_validates_fingerprint_and_timestamp() -> None:
    definition = definition_id(DefinitionType.SHOP)
    with pytest.raises(DomainError, match="SHA-256"):
        published(definition).__class__(
            definition=definition,
            version=1,
            content_fingerprint="not-a-digest",
            published_at=PUBLISHED_AT,
        )
    with pytest.raises(DomainError, match="timezone-aware UTC"):
        PublishedDefinitionVersion(
            definition=definition,
            version=1,
            content_fingerprint=FINGERPRINT,
            published_at=datetime(2026, 8, 23, 12, 0, tzinfo=timezone(timedelta(hours=2))),
        )


def test_published_shop_scoped_version_pins_its_shop_version() -> None:
    ticket = definition_id(DefinitionType.TICKET)
    with pytest.raises(DomainError, match="positive integer"):
        published(ticket, shop=shop_id(), shop_version=None)
    with pytest.raises(DefinitionLifecycleError, match="cannot pin a shop version"):
        published(definition_id(DefinitionType.SHOP), shop_version=3)


def test_publish_draft_assigns_the_next_version() -> None:
    draft = DefinitionDraft(definition=definition_id(DefinitionType.CUSTOMER_PROFILE))
    first = publish_draft(
        draft,
        latest_published_version=None,
        pinned_scope=None,
        pinned_references=(),
        content_fingerprint=FINGERPRINT,
        published_at=PUBLISHED_AT,
    )
    assert first.version == 1
    second = publish_draft(
        draft,
        latest_published_version=4,
        pinned_scope=None,
        pinned_references=(),
        content_fingerprint=FINGERPRINT,
        published_at=PUBLISHED_AT,
    )
    assert second.version == 5


def test_publish_draft_requires_a_published_shop_for_scoped_definitions() -> None:
    shop = shop_id()
    profile = definition_id(DefinitionType.CUSTOMER_PROFILE)
    draft = DefinitionDraft(
        definition=definition_id(DefinitionType.TICKET), shop=shop, references=(profile,)
    )
    with pytest.raises(DefinitionLifecycleError, match="published version of its shop"):
        publish_draft(
            draft,
            latest_published_version=None,
            pinned_scope=None,
            pinned_references=(published(profile),),
            content_fingerprint=FINGERPRINT,
            published_at=PUBLISHED_AT,
        )
    with pytest.raises(DefinitionLifecycleError, match="published version of its shop"):
        publish_draft(
            draft,
            latest_published_version=None,
            pinned_scope=published(shop_id()),
            pinned_references=(published(profile),),
            content_fingerprint=FINGERPRINT,
            published_at=PUBLISHED_AT,
        )
    result = publish_draft(
        draft,
        latest_published_version=None,
        pinned_scope=published(shop, version=3),
        pinned_references=(published(profile),),
        content_fingerprint=FINGERPRINT,
        published_at=PUBLISHED_AT,
    )
    assert result.shop == shop
    assert result.shop_version == 3


def test_publish_draft_rejects_a_scope_pin_for_shop_independent_definitions() -> None:
    draft = DefinitionDraft(definition=definition_id(DefinitionType.CUSTOMER_PROFILE))
    with pytest.raises(DefinitionLifecycleError, match="cannot pin a shop version"):
        publish_draft(
            draft,
            latest_published_version=None,
            pinned_scope=published(shop_id()),
            pinned_references=(),
            content_fingerprint=FINGERPRINT,
            published_at=PUBLISHED_AT,
        )


def test_publish_draft_pins_references_to_exact_versions() -> None:
    shop = shop_id()
    profile = definition_id(DefinitionType.CUSTOMER_PROFILE)
    draft = DefinitionDraft(
        definition=definition_id(DefinitionType.TICKET),
        shop=shop,
        references=(profile,),
    )
    result = publish_draft(
        draft,
        latest_published_version=None,
        pinned_scope=published(shop),
        pinned_references=(published(profile, version=7),),
        content_fingerprint=FINGERPRINT,
        published_at=PUBLISHED_AT,
    )
    assert result.references == (VersionRef(definition=profile, version=7),)


def test_publish_draft_rejects_incomplete_or_extra_pins() -> None:
    shop = shop_id()
    profile = definition_id(DefinitionType.CUSTOMER_PROFILE)
    draft = DefinitionDraft(
        definition=definition_id(DefinitionType.TICKET),
        shop=shop,
        references=(profile,),
    )
    with pytest.raises(InvalidDefinitionReferenceError, match="cover exactly"):
        publish_draft(
            draft,
            latest_published_version=None,
            pinned_scope=published(shop),
            pinned_references=(),
            content_fingerprint=FINGERPRINT,
            published_at=PUBLISHED_AT,
        )
    with pytest.raises(InvalidDefinitionReferenceError, match="cover exactly"):
        publish_draft(
            draft,
            latest_published_version=None,
            pinned_scope=published(shop),
            pinned_references=(
                published(profile),
                published(definition_id(DefinitionType.CUSTOMER_PROFILE)),
            ),
            content_fingerprint=FINGERPRINT,
            published_at=PUBLISHED_AT,
        )


def published_ticket(shop: DefinitionId) -> PublishedDefinitionVersion:
    profile = definition_id(DefinitionType.CUSTOMER_PROFILE)
    ticket = definition_id(DefinitionType.TICKET)
    return published(
        ticket,
        shop=shop,
        shop_version=1,
        references=(VersionRef(definition=profile, version=1),),
    )


def test_publish_draft_rejects_cross_shop_ticket_references() -> None:
    shop = shop_id()
    cross_shop_ticket = published_ticket(shop_id())
    draft = DefinitionDraft(
        definition=definition_id(DefinitionType.SCENARIO),
        shop=shop,
        references=(cross_shop_ticket.definition,),
    )
    with pytest.raises(CrossShopReferenceError, match="same shop"):
        publish_draft(
            draft,
            latest_published_version=None,
            pinned_scope=published(shop),
            pinned_references=(cross_shop_ticket,),
            content_fingerprint=FINGERPRINT,
            published_at=PUBLISHED_AT,
        )

    same_shop_ticket = published_ticket(shop)
    same_shop_draft = DefinitionDraft(
        definition=definition_id(DefinitionType.SCENARIO),
        shop=shop,
        references=(same_shop_ticket.definition,),
    )
    result = publish_draft(
        same_shop_draft,
        latest_published_version=None,
        pinned_scope=published(shop),
        pinned_references=(same_shop_ticket,),
        content_fingerprint=FINGERPRINT,
        published_at=PUBLISHED_AT,
    )
    assert result.references == (same_shop_ticket.ref,)


def test_publish_draft_rejects_duplicate_pinned_references() -> None:
    shop = shop_id()
    profile = definition_id(DefinitionType.CUSTOMER_PROFILE)
    draft = DefinitionDraft(
        definition=definition_id(DefinitionType.TICKET),
        shop=shop,
        references=(profile,),
    )
    with pytest.raises(InvalidDefinitionReferenceError, match="unique per target definition"):
        publish_draft(
            draft,
            latest_published_version=None,
            pinned_scope=published(shop),
            pinned_references=(published(profile), published(profile, version=2)),
            content_fingerprint=FINGERPRINT,
            published_at=PUBLISHED_AT,
        )


def test_published_versions_enforce_required_reference_counts() -> None:
    shop = shop_id()
    with pytest.raises(RequiredReferenceCountError, match="exactly 1 customer_profile"):
        published(definition_id(DefinitionType.TICKET), shop=shop, shop_version=1)
    with pytest.raises(RequiredReferenceCountError, match="exactly 1 ticket"):
        published(definition_id(DefinitionType.SCENARIO), shop=shop, shop_version=1)
    with pytest.raises(RequiredReferenceCountError, match="exactly 1 ticket"):
        published(
            definition_id(DefinitionType.SCENARIO),
            shop=shop,
            shop_version=1,
            references=(
                VersionRef(definition=definition_id(DefinitionType.TICKET), version=1),
                VersionRef(definition=definition_id(DefinitionType.TICKET), version=1),
            ),
        )
    with pytest.raises(RequiredReferenceCountError, match="exactly 1 support_identity"):
        published(definition_id(DefinitionType.AGENT_CONFIGURATION))
