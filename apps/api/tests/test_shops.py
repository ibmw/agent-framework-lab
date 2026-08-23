from collections.abc import Generator
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from capability_lab.application.definition_resolution import (
    MissingDraftError,
    PublishedVersionExistsError,
)
from capability_lab.application.shop_payload import shop_content_fingerprint
from capability_lab.application.shops import (
    ShopNotFoundError,
    ShopNotPublishableError,
    ShopService,
    ShopVersionNotFoundError,
    ShopVersionRecord,
    shop_definition_id,
)
from capability_lab.domain.definitions import DefinitionType
from capability_lab.domain.shop import ShopPayload
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.repositories import (
    PersistedDefinitionIntegrityError,
    SqlAlchemyShopRepository,
)
from shop_factories import identity, product, publishable_shop, variant


@dataclass(slots=True)
class AdvancingClock:
    value: datetime = datetime(2026, 8, 23, 12, 0, tzinfo=UTC)

    def now(self) -> datetime:
        self.value += timedelta(seconds=1)
        return self.value


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'shops.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def service(session: Session) -> ShopService:
    return ShopService(SqlAlchemyShopRepository(session), AdvancingClock())


def test_a_new_shop_starts_as_one_incomplete_draft(service: ShopService) -> None:
    record = service.create_shop(identity())

    assert record.definition.definition_type is DefinitionType.SHOP
    assert record.payload == ShopPayload(identity=identity())
    assert service.get_draft(record.definition.id) == record
    assert service.list_versions(record.definition.id) == ()


def test_listing_shops_projects_draft_identity_and_published_provenance(
    service: ShopService,
) -> None:
    first = service.create_shop(identity())
    service.create_shop(identity(name="Second", slug="second"))
    service.replace_draft(first.definition.id, publishable_shop())
    service.publish(first.definition.id)

    summaries = service.list_shops()

    assert [summary.slug for summary in summaries] == ["northstar", "second"]
    assert summaries[0].latest_published_version == 1
    assert summaries[0].published_version_count == 1
    assert summaries[1].latest_published_version is None


def test_an_unknown_shop_is_reported_rather_than_created(service: ShopService) -> None:
    with pytest.raises(ShopNotFoundError):
        service.get_draft(uuid4())
    with pytest.raises(ShopNotFoundError):
        service.list_versions(uuid4())
    with pytest.raises(MissingDraftError):
        service.publish(uuid4())


def test_publishing_is_refused_while_the_draft_has_gate_errors(service: ShopService) -> None:
    record = service.create_shop(identity())

    with pytest.raises(ShopNotPublishableError) as refusal:
        service.publish(record.definition.id)

    assert not refusal.value.validation.publishable
    assert "shop_without_product" in {issue.code for issue in refusal.value.validation.errors}
    assert service.list_versions(record.definition.id) == ()


def test_publishing_freezes_the_draft_content_and_its_fingerprint(service: ShopService) -> None:
    record = service.create_shop(identity())
    payload = publishable_shop()
    service.replace_draft(record.definition.id, payload)

    published = service.publish(record.definition.id)

    assert published.published.version == 1
    assert published.published.content_fingerprint == shop_content_fingerprint(payload)
    assert published.published.shop is None
    assert published.published.references == ()
    assert published.payload == payload


def test_a_published_version_never_changes_when_the_draft_is_edited(
    service: ShopService,
) -> None:
    record = service.create_shop(identity())
    service.replace_draft(record.definition.id, publishable_shop())
    published = service.publish(record.definition.id)

    service.replace_draft(
        record.definition.id,
        replace(publishable_shop(), products=(product(title="Renamed Jacket"),)),
    )

    assert service.get_version(record.definition.id, 1) == published
    assert service.get_draft(record.definition.id).payload != published.payload


def test_versions_increase_monotonically_and_list_newest_first(service: ShopService) -> None:
    record = service.create_shop(identity())
    service.replace_draft(record.definition.id, publishable_shop())
    service.publish(record.definition.id)
    service.replace_draft(
        record.definition.id,
        replace(publishable_shop(), products=(product(title="Renamed Jacket"),)),
    )
    service.publish(record.definition.id)

    versions = service.list_versions(record.definition.id)

    assert [published.version for published in versions] == [2, 1]
    assert versions[0].content_fingerprint != versions[1].content_fingerprint


def test_an_unknown_version_is_reported(service: ShopService) -> None:
    record = service.create_shop(identity())

    with pytest.raises(ShopVersionNotFoundError):
        service.get_version(record.definition.id, 1)


def test_the_storage_boundary_refuses_to_overwrite_a_published_version(
    tmp_path: Path,
) -> None:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'overwrite.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with session_scope(factory) as writing:
        service = ShopService(SqlAlchemyShopRepository(writing), AdvancingClock())
        record = service.create_shop(identity())
        service.replace_draft(record.definition.id, publishable_shop())
        published = service.publish(record.definition.id)

    with pytest.raises(PublishedVersionExistsError), session_scope(factory) as overwriting:
        SqlAlchemyShopRepository(overwriting).save_version(
            ShopVersionRecord(
                published=published.published,
                payload=replace(publishable_shop(), products=(product(title="Rewritten"),)),
            )
        )

    with session_scope(factory) as reading:
        stored = ShopService(SqlAlchemyShopRepository(reading), AdvancingClock()).get_version(
            record.definition.id, 1
        )
    assert stored.payload == publishable_shop()


def test_reading_a_tampered_published_version_is_refused(tmp_path: Path) -> None:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'tampered.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with session_scope(factory) as writing:
        service = ShopService(SqlAlchemyShopRepository(writing), AdvancingClock())
        record = service.create_shop(identity())
        service.replace_draft(record.definition.id, publishable_shop())
        service.publish(record.definition.id)

    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE definition_versions SET payload = json_set(payload, "
                "'$.identity.name', 'Rewritten') WHERE version = 1"
            )
        )

    with (
        pytest.raises(PersistedDefinitionIntegrityError),
        session_scope(factory) as reading,
    ):
        ShopService(SqlAlchemyShopRepository(reading), AdvancingClock()).get_version(
            record.definition.id, 1
        )


def test_the_preview_reports_the_gate_and_the_version_publishing_would_create(
    service: ShopService,
) -> None:
    record = service.create_shop(identity())
    empty = service.preview_draft(record.definition.id)

    assert not empty.validation.publishable
    assert empty.latest_published_version is None
    assert empty.next_version == 1
    assert not empty.matches_latest_published
    assert [change.description for change in empty.changes] == [
        "First published version of Northstar Outfitters"
    ]

    service.replace_draft(record.definition.id, publishable_shop())
    service.publish(record.definition.id)
    unchanged = service.preview_draft(record.definition.id)

    assert unchanged.validation.publishable
    assert unchanged.latest_published_version == 1
    assert unchanged.next_version == 2
    assert unchanged.matches_latest_published
    assert unchanged.changes == ()


def test_the_preview_names_the_catalog_edits_a_publish_would_freeze(
    service: ShopService,
) -> None:
    record = service.create_shop(identity())
    service.replace_draft(record.definition.id, publishable_shop())
    service.publish(record.definition.id)
    service.replace_draft(
        record.definition.id,
        replace(
            publishable_shop(),
            products=(
                product(
                    variants=(
                        variant(),
                        variant(
                            sku="NS-ASJ-CH-L",
                            option_values=(("color", "Charcoal"), ("size", "L")),
                        ),
                    )
                ),
            ),
        ),
    )

    preview = service.preview_draft(record.definition.id)

    assert not preview.matches_latest_published
    assert "Added variant NS-ASJ-CH-L" in {change.description for change in preview.changes}


def test_published_content_survives_a_new_repository_and_session(tmp_path: Path) -> None:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'durable.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    payload = publishable_shop()

    with session_scope(factory) as writing:
        service = ShopService(SqlAlchemyShopRepository(writing), AdvancingClock())
        record = service.create_shop(identity())
        service.replace_draft(record.definition.id, payload)
        service.publish(record.definition.id)
        shop_id = record.definition.id

    with session_scope(factory) as reading:
        reloaded = ShopService(SqlAlchemyShopRepository(reading), AdvancingClock()).get_version(
            shop_id, 1
        )

    assert reloaded.payload == payload
    assert reloaded.published.definition == shop_definition_id(shop_id)
    assert reloaded.published.content_fingerprint == shop_content_fingerprint(payload)
