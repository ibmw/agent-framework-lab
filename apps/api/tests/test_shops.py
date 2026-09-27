from collections.abc import Generator
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from capability_lab.application.definition_resolution import PublishedVersionExistsError
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
from capability_lab.domain.shop import (
    ShopLogo,
    ShopLogoBackground,
    ShopMark,
    ShopMarkColour,
    ShopPayload,
)
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.repositories import (
    PersistedDefinitionIntegrityError,
    shop_repository,
)
from shop_factories import (
    PRE_LOGO_IDENTITY_ONLY_DOCUMENT,
    PRE_LOGO_IDENTITY_ONLY_FINGERPRINT,
    V2_LOGO_DOCUMENT,
    V2_LOGO_FINGERPRINT,
    identity,
    product,
    publishable_shop,
    variant,
)


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
    return ShopService(shop_repository(session), AdvancingClock())


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
    with pytest.raises(ShopNotFoundError):
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
        service = ShopService(shop_repository(writing), AdvancingClock())
        record = service.create_shop(identity())
        service.replace_draft(record.definition.id, publishable_shop())
        published = service.publish(record.definition.id)

    with pytest.raises(PublishedVersionExistsError), session_scope(factory) as overwriting:
        shop_repository(overwriting).save_version(
            ShopVersionRecord(
                published=published.published,
                payload=replace(publishable_shop(), products=(product(title="Rewritten"),)),
            )
        )

    with session_scope(factory) as reading:
        stored = ShopService(shop_repository(reading), AdvancingClock()).get_version(
            record.definition.id, 1
        )
    assert stored.payload == publishable_shop()


def test_reading_a_tampered_published_version_is_refused(tmp_path: Path) -> None:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'tampered.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with session_scope(factory) as writing:
        service = ShopService(shop_repository(writing), AdvancingClock())
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
        ShopService(shop_repository(reading), AdvancingClock()).get_version(record.definition.id, 1)


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
        service = ShopService(shop_repository(writing), AdvancingClock())
        record = service.create_shop(identity())
        service.replace_draft(record.definition.id, payload)
        service.publish(record.definition.id)
        shop_id = record.definition.id

    with session_scope(factory) as reading:
        reloaded = ShopService(shop_repository(reading), AdvancingClock()).get_version(shop_id, 1)

    assert reloaded.payload == payload
    assert reloaded.published.definition == shop_definition_id(shop_id)
    assert reloaded.published.content_fingerprint == shop_content_fingerprint(payload)


def test_a_version_published_before_logos_existed_still_reads(tmp_path: Path) -> None:
    """A row holding the exact document and fingerprint the pre-logo codec wrote (ADR 0070)."""
    engine = create_database_engine(f"sqlite:///{tmp_path / 'pre-logo.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with session_scope(factory) as writing:
        service = ShopService(shop_repository(writing), AdvancingClock())
        record = service.create_shop(identity())
        service.replace_draft(record.definition.id, publishable_shop())
        service.publish(record.definition.id)

    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE definition_versions SET payload = json(:payload), "
                "content_fingerprint = :fingerprint WHERE version = 1"
            ),
            {
                "payload": PRE_LOGO_IDENTITY_ONLY_DOCUMENT.decode(),
                "fingerprint": PRE_LOGO_IDENTITY_ONLY_FINGERPRINT,
            },
        )

    with session_scope(factory) as reading:
        stored = ShopService(shop_repository(reading), AdvancingClock()).get_version(
            record.definition.id, 1
        )

    assert stored.payload == ShopPayload(identity=identity())
    assert stored.payload.logo is None
    assert stored.published.content_fingerprint == PRE_LOGO_IDENTITY_ONLY_FINGERPRINT


V2_LOGO = ShopLogo(mark=ShopMark.COMPASS, background=ShopLogoBackground.OCHRE, mark_colour=None)


def test_a_logo_stored_before_the_colour_was_chosen_still_reads(tmp_path: Path) -> None:
    """Rows holding the exact v2 document and fingerprint the codec wrote at fcaa115."""
    engine = create_database_engine(f"sqlite:///{tmp_path / 'v2-logo.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with session_scope(factory) as writing:
        service = ShopService(shop_repository(writing), AdvancingClock())
        record = service.create_shop(identity())
        service.replace_draft(record.definition.id, publishable_shop())
        service.publish(record.definition.id)

    with engine.begin() as connection:
        for statement in (
            "UPDATE definition_versions SET payload = json(:payload), "
            "content_fingerprint = :fingerprint WHERE version = 1",
            "UPDATE definition_drafts SET payload = json(:payload)",
        ):
            connection.execute(
                text(statement),
                {"payload": V2_LOGO_DOCUMENT.decode(), "fingerprint": V2_LOGO_FINGERPRINT},
            )

    with session_scope(factory) as reading:
        reader = ShopService(shop_repository(reading), AdvancingClock())
        published = reader.get_version(record.definition.id, 1)
        draft = reader.get_draft(record.definition.id)
        preview = reader.preview_draft(record.definition.id)
        listed = reader.list_shops()

    for payload in (published.payload, draft.payload):
        assert payload == ShopPayload(identity=identity(), logo=V2_LOGO)
        assert payload.logo is not None
        assert payload.logo.drawn_mark_colour is ShopMarkColour.INK
    assert published.published.content_fingerprint == V2_LOGO_FINGERPRINT
    assert preview.matches_latest_published
    assert [summary.logo for summary in listed] == [V2_LOGO]
    with engine.connect() as connection:
        stored = connection.execute(
            text("SELECT content_fingerprint FROM definition_versions WHERE version = 1")
        ).scalar_one()
    assert stored == V2_LOGO_FINGERPRINT


@pytest.mark.parametrize(
    ("sent", "token"),
    [
        # The colour the lab answered for the v2 logo, echoed back: not a choice.
        (replace(V2_LOGO, mark_colour=ShopMarkColour.INK), "shop-payload-v2"),
        # The other colour is a choice, and a chosen colour is written as v3.
        (replace(V2_LOGO, mark_colour=ShopMarkColour.WHITE), "shop-payload-v3"),
        (replace(V2_LOGO, mark=ShopMark.ANCHOR, mark_colour=ShopMarkColour.INK), "shop-payload-v3"),
    ],
)
def test_a_v2_draft_keeps_its_bytes_unless_its_logo_changes(
    tmp_path: Path, sent: ShopLogo, token: str
) -> None:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'v2-draft.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with session_scope(factory) as writing:
        record = ShopService(shop_repository(writing), AdvancingClock()).create_shop(identity())
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE definition_drafts SET payload = json(:payload)"),
            {"payload": V2_LOGO_DOCUMENT.decode()},
        )

    with session_scope(factory) as writing:
        service = ShopService(shop_repository(writing), AdvancingClock())
        service.replace_draft(record.definition.id, ShopPayload(identity=identity(), logo=sent))

    with engine.connect() as connection:
        document = connection.execute(text("SELECT payload FROM definition_drafts")).scalar_one()
    assert f'"{token}"' in document
    with session_scope(factory) as reading:
        reread = ShopService(shop_repository(reading), AdvancingClock()).get_draft(
            record.definition.id
        )
    assert reread.payload.logo == (V2_LOGO if token == "shop-payload-v2" else sent)
    if token == "shop-payload-v2":
        assert shop_content_fingerprint(reread.payload) == V2_LOGO_FINGERPRINT


def test_a_logo_edit_mints_a_new_version_that_reads_back(tmp_path: Path) -> None:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'logo.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    logo = ShopLogo(
        mark=ShopMark.TRUCK, background=ShopLogoBackground.OCHRE, mark_colour=ShopMarkColour.WHITE
    )
    with session_scope(factory) as writing:
        service = ShopService(shop_repository(writing), AdvancingClock())
        record = service.create_shop(identity())
        service.replace_draft(record.definition.id, publishable_shop())
        first = service.publish(record.definition.id)

        service.replace_draft(record.definition.id, replace(publishable_shop(), logo=logo))
        preview = service.preview_draft(record.definition.id)
        assert not preview.matches_latest_published
        assert [change.description for change in preview.changes] == ["Added shop logo"]
        second = service.publish(record.definition.id)

    with session_scope(factory) as reading:
        reader = ShopService(shop_repository(reading), AdvancingClock())
        stored = reader.get_version(record.definition.id, 2)
        listed = reader.list_shops()

    assert second.published.version == 2
    assert stored.payload.logo == logo
    assert stored.published.content_fingerprint == shop_content_fingerprint(stored.payload)
    assert stored.published.content_fingerprint != first.published.content_fingerprint
    assert [summary.logo for summary in listed] == [logo]


def test_a_shop_can_be_created_with_its_logo(service: ShopService) -> None:
    logo = ShopLogo(
        mark=None, background=ShopLogoBackground.BRICK, mark_colour=ShopMarkColour.WHITE
    )
    record = service.create_shop(identity(), logo)

    assert service.get_draft(record.definition.id).payload.logo == logo
