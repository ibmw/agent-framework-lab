"""Customer-profile service and storage: immutability, versions, and shop attachment."""

from collections.abc import Generator
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from capability_lab.application.customer_profile_payload import (
    customer_profile_content_fingerprint,
)
from capability_lab.application.customer_profiles import (
    CustomerProfileNotFoundError,
    CustomerProfileNotPublishableError,
    CustomerProfileService,
    CustomerProfileVersionNotFoundError,
    CustomerProfileVersionRecord,
    customer_profile_definition_id,
)
from capability_lab.application.definition_resolution import PublishedVersionExistsError
from capability_lab.application.shops import ShopNotFoundError, ShopService
from capability_lab.domain.customer_profile import BehavioralPersona
from capability_lab.domain.definitions import DefinitionType
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.repositories import (
    PersistedDefinitionIntegrityError,
    SqlAlchemyDefinitionShopAttachmentRepository,
    SqlAlchemyShopDirectory,
    SqlAlchemyShopMediaRepository,
    customer_profile_repository,
    shop_repository,
)
from definition_factories import address, customer_identity, publishable_profile
from shop_factories import identity


@dataclass(slots=True)
class AdvancingClock:
    value: datetime = datetime(2026, 8, 23, 12, 0, tzinfo=UTC)

    def now(self) -> datetime:
        self.value += timedelta(seconds=1)
        return self.value


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'profiles.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


def build_service(session: Session) -> CustomerProfileService:
    return CustomerProfileService(
        customer_profile_repository(session),
        SqlAlchemyDefinitionShopAttachmentRepository(session),
        SqlAlchemyShopDirectory(session),
        AdvancingClock(),
    )


def make_shop(session: Session, slug: str) -> UUID:
    """A real shop, because attachment refuses a shop that does not exist."""
    service = ShopService(
        shop_repository(session), AdvancingClock(), SqlAlchemyShopMediaRepository(session)
    )
    return service.create_shop(identity(slug=slug, name=slug.title())).definition.id


@pytest.fixture
def service(session: Session) -> CustomerProfileService:
    return build_service(session)


def test_a_new_profile_starts_as_one_incomplete_draft(service: CustomerProfileService) -> None:
    record = service.create_profile(customer_identity(), "2024-03-14")

    assert record.definition.definition_type is DefinitionType.CUSTOMER_PROFILE
    assert record.payload.identity == customer_identity()
    assert record.payload.addresses == ()
    assert record.payload.persona.summary == ""
    assert service.list_versions(record.definition.id) == ()


def test_an_incomplete_draft_can_be_saved_but_not_published(
    service: CustomerProfileService,
) -> None:
    record = service.create_profile(customer_identity(), "2024-03-14")

    preview = service.preview_draft(record.definition.id)
    assert not preview.validation.publishable
    assert {issue.code for issue in preview.validation.errors} == {
        "profile_without_address",
        "persona_without_summary",
    }

    with pytest.raises(CustomerProfileNotPublishableError) as raised:
        service.publish(record.definition.id)
    assert raised.value.validation.errors


def test_publishing_freezes_the_draft_and_editing_never_changes_it(
    service: CustomerProfileService,
) -> None:
    record = service.create_profile(customer_identity(), "2024-03-14")
    profile_id = record.definition.id
    service.replace_draft(profile_id, publishable_profile())

    published = service.publish(profile_id)
    assert published.published.version == 1

    service.replace_draft(
        profile_id,
        replace(publishable_profile(), persona=BehavioralPersona(summary="Rewritten.")),
    )

    frozen = service.get_version(profile_id, 1)
    assert frozen.payload == publishable_profile()
    assert frozen.published.content_fingerprint == customer_profile_content_fingerprint(
        publishable_profile()
    )


def test_versions_increase_monotonically(service: CustomerProfileService) -> None:
    record = service.create_profile(customer_identity(), "2024-03-14")
    profile_id = record.definition.id
    service.replace_draft(profile_id, publishable_profile())
    service.publish(profile_id)
    service.replace_draft(profile_id, publishable_profile(addresses=(address(),)))
    service.publish(profile_id)

    assert [published.version for published in service.list_versions(profile_id)] == [2, 1]


def test_a_preview_reports_what_publishing_would_freeze(service: CustomerProfileService) -> None:
    record = service.create_profile(customer_identity(), "2024-03-14")
    profile_id = record.definition.id
    service.replace_draft(profile_id, publishable_profile())
    service.publish(profile_id)

    unchanged = service.preview_draft(profile_id)
    assert unchanged.matches_latest_published
    assert unchanged.next_version == 2

    service.replace_draft(
        profile_id,
        publishable_profile(
            addresses=(address(), address("parents", label="Parent's house", is_default=False))
        ),
    )
    changed = service.preview_draft(profile_id)
    assert not changed.matches_latest_published
    assert "addresses.parents" in {change.path for change in changed.changes}


def test_an_unknown_profile_and_version_are_reported_separately(
    service: CustomerProfileService,
) -> None:
    with pytest.raises(CustomerProfileNotFoundError):
        service.get_draft(uuid4())
    with pytest.raises(CustomerProfileNotFoundError):
        service.publish(uuid4())

    record = service.create_profile(customer_identity(), "2024-03-14")
    with pytest.raises(CustomerProfileVersionNotFoundError):
        service.get_version(record.definition.id, 1)


def test_the_storage_boundary_refuses_to_overwrite_a_published_version(tmp_path: Path) -> None:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'overwrite.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with session_scope(factory) as writing:
        service = build_service(writing)
        record = service.create_profile(customer_identity(), "2024-03-14")
        profile_id = record.definition.id
        service.replace_draft(profile_id, publishable_profile())
        published = service.publish(profile_id)

    with pytest.raises(PublishedVersionExistsError), session_scope(factory) as overwriting:
        customer_profile_repository(overwriting).save_version(
            CustomerProfileVersionRecord(
                published=published.published,
                payload=publishable_profile(addresses=(address(),)),
            )
        )

    with session_scope(factory) as reading:
        stored = build_service(reading).get_version(profile_id, 1)
    assert stored.payload == publishable_profile()


def test_a_published_version_whose_stored_content_drifted_is_refused(tmp_path: Path) -> None:
    """A published version is historical evidence; a mismatch fails instead of being served."""
    engine = create_database_engine(f"sqlite:///{tmp_path / 'tampered.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with session_scope(factory) as writing:
        service = build_service(writing)
        record = service.create_profile(customer_identity(), "2024-03-14")
        profile_id = record.definition.id
        service.replace_draft(profile_id, publishable_profile())
        service.publish(profile_id)

    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE definition_versions SET payload = json_set(payload, "
                "'$.identity.given_name', 'Rewritten') WHERE version = 1"
            )
        )

    with pytest.raises(PersistedDefinitionIntegrityError), session_scope(factory) as reading:
        build_service(reading).get_version(profile_id, 1)


def test_published_content_survives_a_new_session(tmp_path: Path) -> None:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'durable.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)

    with session_scope(factory) as writing:
        service = build_service(writing)
        record = service.create_profile(customer_identity(), "2024-03-14")
        profile_id = record.definition.id
        service.replace_draft(profile_id, publishable_profile())
        service.publish(profile_id)

    with session_scope(factory) as reading:
        reloaded = build_service(reading).get_version(profile_id, 1)

    assert reloaded.payload == publishable_profile()


def test_a_profile_created_from_a_shop_is_attached_to_it(
    session: Session, service: CustomerProfileService
) -> None:
    shop_id = make_shop(session, "northstar")
    record = service.create_profile(customer_identity(), "2024-03-14", shop_id=shop_id)

    assert service.attached_shops(record.definition.id) == (shop_id,)


def test_attaching_the_same_shop_twice_changes_nothing(
    session: Session, service: CustomerProfileService
) -> None:
    shop_id = make_shop(session, "northstar")
    record = service.create_profile(customer_identity(), "2024-03-14", shop_id=shop_id)

    assert service.attach_to_shop(record.definition.id, shop_id) == (shop_id,)


def test_attach_survives_losing_the_insert_race(
    session: Session, service: CustomerProfileService
) -> None:
    """The composite primary key already guarantees the row; a lost race is still success."""
    shop_id = make_shop(session, "northstar")
    record = service.create_profile(customer_identity(), "2024-03-14")
    attachments = SqlAlchemyDefinitionShopAttachmentRepository(session)

    # Another writer wins the insert between this caller's check and its flush.
    attachments.attach(record.definition, shop_id, datetime(2026, 8, 23, 12, 0, tzinfo=UTC))
    session.expunge_all()
    attachments.attach(record.definition, shop_id, datetime(2026, 8, 23, 12, 5, tzinfo=UTC))

    assert service.attached_shops(record.definition.id) == (shop_id,)


def test_a_profile_is_reusable_across_shops_and_detaching_keeps_it(
    session: Session, service: CustomerProfileService
) -> None:
    northstar = make_shop(session, "northstar")
    aurora = make_shop(session, "aurora")
    record = service.create_profile(customer_identity(), "2024-03-14", shop_id=northstar)
    profile_id = record.definition.id
    service.attach_to_shop(profile_id, aurora)

    assert set(service.attached_shops(profile_id)) == {northstar, aurora}

    assert service.detach_from_shop(profile_id, northstar) == (aurora,)
    assert service.get_draft(profile_id).payload.identity == customer_identity()


def test_listing_scopes_to_a_shop_while_counting_every_attachment(
    session: Session, service: CustomerProfileService
) -> None:
    northstar = make_shop(session, "northstar")
    aurora = make_shop(session, "aurora")
    shared = service.create_profile(customer_identity(), "2024-03-14", shop_id=northstar)
    service.attach_to_shop(shared.definition.id, aurora)
    service.replace_draft(shared.definition.id, publishable_profile())
    aurora_only = service.create_profile(
        customer_identity(given_name="Tomás", family_name="Rivera", email="tomas@example.org"),
        "2025-01-09",
        shop_id=aurora,
    )
    service.create_profile(
        customer_identity(given_name="Léa", family_name="Fontaine", email="lea@example.org"),
        "2025-02-01",
    )

    northstar_rows = service.list_profiles(shop_id=northstar)
    assert [row.definition_id for row in northstar_rows] == [shared.definition.id]
    assert northstar_rows[0].attached_shop_count == 2
    assert northstar_rows[0].display_name == "Maya Laurent"
    assert northstar_rows[0].default_address_label == "Home"
    assert northstar_rows[0].address_count == 2

    assert {row.definition_id for row in service.list_profiles(shop_id=aurora)} == {
        shared.definition.id,
        aurora_only.definition.id,
    }
    assert len(service.list_profiles()) == 3


def test_attaching_an_unknown_profile_is_refused(
    session: Session, service: CustomerProfileService
) -> None:
    shop_id = make_shop(session, "northstar")

    with pytest.raises(CustomerProfileNotFoundError):
        service.attach_to_shop(uuid4(), shop_id)
    with pytest.raises(CustomerProfileNotFoundError):
        service.attached_shops(uuid4())


def test_attaching_to_an_unknown_shop_is_refused_rather_than_left_dangling(
    service: CustomerProfileService,
) -> None:
    """A typo must not create an attachment Milestone 2's pickers would have to filter."""
    record = service.create_profile(customer_identity(), "2024-03-14")

    with pytest.raises(ShopNotFoundError):
        service.attach_to_shop(record.definition.id, uuid4())
    with pytest.raises(ShopNotFoundError):
        service.create_profile(customer_identity(), "2024-03-14", shop_id=uuid4())

    assert service.attached_shops(record.definition.id) == ()


def test_the_definition_identity_is_stable_across_the_draft_and_every_version(
    service: CustomerProfileService,
) -> None:
    record = service.create_profile(customer_identity(), "2024-03-14")
    profile_id = record.definition.id
    service.replace_draft(profile_id, publishable_profile())
    published = service.publish(profile_id)

    assert published.published.definition == customer_profile_definition_id(profile_id)
    assert service.get_draft(profile_id).definition == published.published.definition
