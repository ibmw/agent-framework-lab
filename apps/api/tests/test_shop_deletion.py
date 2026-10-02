"""Deleting a shop that never published, with everything it holds (ADR 0077).

The cascade is proven by enumeration rather than by a list typed here: every mapped table with a
column whose name says `shop` is read from `Base.metadata`, and each must either be emptied for
the deleted shop or be provably empty for a shop that never published. A table added later that
holds a shop's rows fails `test_every_table_a_shop_can_fill_is_one_the_delete_empties` until it
is placed in one of the two sets — and so until someone has decided which.
"""

import hashlib
import logging
from collections.abc import AsyncGenerator, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import Engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from api_factories import (
    OBJECTIVE_TEMPLATE,
    PROFILE,
    SHOP_IDENTITY,
    api_client,
    make_block,
    make_customer,
    make_identity,
    make_order,
    make_shop,
    make_ticket,
    media_root,
)
from capability_lab.application.shop_deletion import (
    DeletedShop,
    ShopDeletionService,
    ShopPublishedError,
)
from capability_lab.application.shops import SHOP_CODEC, ShopNotFoundError, ShopService
from capability_lab.domain.definitions import DefinitionId
from capability_lab.domain.shop import ShopPayload
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.media_store import FilesystemMediaStore
from capability_lab.infrastructure.models import ExperimentModel
from capability_lab.infrastructure.repositories import (
    SqlAlchemyDefinitionRepository,
    SqlAlchemyDefinitionShopAttachmentRepository,
    SqlAlchemyOrderFixtureRepository,
    SqlAlchemyShopDirectory,
    SqlAlchemyShopMediaRepository,
    shop_repository,
)
from shop_factories import saved_shop

DATABASE = "shop-deletion.db"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR-harbour"
OTHER_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR-fjord"

# The tables the delete empties for its shop, each by its own repository.
EMPTIED = frozenset(
    {
        "definition_drafts",
        "definition_shop_attachments",
        "shop_order_fixtures",
        "shop_media_assets",
    }
)
# The tables a shop that never published cannot have filled: each row needs a published shop
# version, directly or through a snapshot or an experiment (ADR 0012, ADR 0016, ADR 0019).
PROVABLY_EMPTY = frozenset(
    {
        "definition_versions",
        "sandbox_snapshots",
        "sandboxes",
        "sandbox_action_proposals",
        "experiments",
        "experiment_runs",
    }
)


# Columns whose name says "shop" but that hold no shop's identifier, excluded by hand: a
# definition version's `shop_version` is the version number its shop pin names, beside the
# `shop_id` that the enumeration already reads. A new column is read as naming a shop unless it
# is added here, deliberately.
NOT_A_SHOP_IDENTIFIER = frozenset({("definition_versions", "shop_version")})


def shop_columns() -> dict[str, tuple[str, ...]]:
    """Every mapped table with a column whose name contains `shop`, and those columns."""
    found: dict[str, tuple[str, ...]] = {}
    for table in Base.metadata.sorted_tables:
        columns = tuple(
            column.name
            for column in table.columns
            if "shop" in column.name and (table.name, column.name) not in NOT_A_SHOP_IDENTIFIER
        )
        if columns:
            found[table.name] = columns
    return found


def tables_naming_a_shop() -> frozenset[str]:
    return frozenset(shop_columns())


def engine_of(tmp_path: Path) -> Engine:
    return create_database_engine(f"sqlite:///{tmp_path / DATABASE}")


def rows_of(engine: Engine, table: str, shop_id: str) -> int:
    """Rows of `table` naming the shop: by any column naming a shop, and the shop's own draft
    or versions by their `definition_id`."""
    with engine.connect() as connection:
        count = 0
        for column in shop_columns().get(table, ("shop_id",)):
            count += (
                connection.scalar(
                    text(f"SELECT COUNT(*) FROM {table} WHERE {column} = :shop_id"),
                    {"shop_id": shop_id},
                )
                or 0
            )
        if table in {"definition_drafts", "definition_versions"}:
            count += connection.scalar(
                text(
                    f"SELECT COUNT(*) FROM {table} "
                    "WHERE definition_type = 'shop' AND definition_id = :shop_id"
                ),
                {"shop_id": shop_id},
            )
    return int(count or 0)


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


@pytest.fixture
async def client(tmp_path: Path) -> AsyncGenerator[AsyncClient, None]:
    async with api_client(tmp_path, DATABASE) as active:
        yield active


async def upload(client: AsyncClient, shop_id: str, content: bytes) -> None:
    answered = await client.post(
        f"/api/v1/shops/{shop_id}/media",
        files={"file": ("harbour.png", content, "application/octet-stream")},
    )
    assert answered.status_code == 201, answered.text


async def furnished_shop(client: AsyncClient, slug: str, image: bytes) -> dict[str, str]:
    """A shop that never published, holding one of everything a shop can hold before it does."""
    shop_id = await make_shop(client, {**SHOP_IDENTITY, "name": slug.title(), "slug": slug})
    profile_id = await make_customer(client, shop_id)
    order_id = await make_order(client, shop_id, profile_id)
    ticket_id = await make_ticket(client, shop_id, profile_id)
    scenario = await client.post(
        f"/api/v1/shops/{shop_id}/scenarios",
        json={"name": "Wrong shipping address", "ticket_id": ticket_id},
    )
    assert scenario.status_code == 201, scenario.text
    await upload(client, shop_id, image)
    return {
        "shop_id": shop_id,
        "profile_id": profile_id,
        "order_id": order_id,
        "ticket_id": ticket_id,
        "scenario_id": str(scenario.json()["scenario_id"]),
    }


def test_every_table_a_shop_can_fill_is_one_the_delete_empties() -> None:
    """A table added later with a column naming a shop fails here until it is placed in a set."""
    assert tables_naming_a_shop() == EMPTIED | PROVABLY_EMPTY
    assert not EMPTIED & PROVABLY_EMPTY


async def test_a_never_published_shop_goes_with_everything_it_holds(
    client: AsyncClient, tmp_path: Path
) -> None:
    deleted = await furnished_shop(client, "harbour-lane", PNG)
    kept = await furnished_shop(client, "fjord-supply", OTHER_PNG)
    identity = await make_identity(client)
    block_id = await make_block(client, "objective-blocks", OBJECTIVE_TEMPLATE)
    engine = engine_of(tmp_path)
    for table in EMPTIED:
        assert rows_of(engine, table, deleted["shop_id"]) > 0, table
    directory = media_root(tmp_path) / "shops" / deleted["shop_id"]
    assert (directory / digest(PNG)).read_bytes() == PNG

    answered = await client.delete(f"/api/v1/shops/{deleted['shop_id']}")

    assert answered.status_code == 204, answered.text
    assert answered.content == b""
    for table in sorted(tables_naming_a_shop()):
        assert rows_of(engine, table, deleted["shop_id"]) == 0, table
    for table in EMPTIED:
        assert rows_of(engine, table, kept["shop_id"]) > 0, table
    assert not directory.exists()
    assert (media_root(tmp_path) / "shops" / kept["shop_id"] / digest(OTHER_PNG)).exists()
    # What the shop used and did not own stays: the profile, the identity and the block.
    profile = await client.get(f"/api/v1/customer-profiles/{deleted['profile_id']}/draft")
    assert profile.status_code == 200
    assert profile.json()["content"]["identity"] == PROFILE["identity"]
    support = identity["support_identity_id"]
    assert (await client.get(f"/api/v1/support-identities/{support}/draft")).status_code == 200
    assert (await client.get(f"/api/v1/objective-blocks/{block_id}/draft")).status_code == 200
    # And every surface reading the shop now says it is not there.
    listed = (await client.get("/api/v1/shops")).json()["shops"]
    assert [shop["shop_id"] for shop in listed] == [kept["shop_id"]]
    shop_id = deleted["shop_id"]
    for path in ("draft", "orders", "tickets", "scenarios", "media"):
        assert (await client.get(f"/api/v1/shops/{shop_id}/{path}")).status_code == 404, path


async def test_a_published_shop_is_refused_and_keeps_everything(
    client: AsyncClient, tmp_path: Path
) -> None:
    shop_id = await make_shop(client)
    await upload(client, shop_id, PNG)
    assert (await client.post(f"/api/v1/shops/{shop_id}/versions")).status_code == 201

    refused = await client.delete(f"/api/v1/shops/{shop_id}")

    assert refused.status_code == 409
    body = refused.json()
    assert body["code"] == "shop_published"
    assert f"shop {shop_id} is kept because it has published 1 version" in body["message"]
    assert (await client.get(f"/api/v1/shops/{shop_id}/draft")).status_code == 200
    assert (await client.get(f"/api/v1/shops/{shop_id}/media")).json()["media"]
    assert (media_root(tmp_path) / "shops" / shop_id / digest(PNG)).exists()


async def test_a_shop_an_experiment_names_is_refused(client: AsyncClient, tmp_path: Path) -> None:
    """The operator's second condition, checked on its own: no published version, but a run.

    The API cannot reach this state — an experiment needs a published shop — so the row is
    written straight to the store, to prove the statement reads `experiments` and not only
    `definition_versions`.
    """
    shop_id = await make_shop(client)
    with session_scope(create_session_factory(engine_of(tmp_path))) as session:
        session.add(experiment_row(shop_id))

    refused = await client.delete(f"/api/v1/shops/{shop_id}")

    assert refused.status_code == 409
    assert refused.json()["code"] == "shop_published"
    assert refused.json()["message"] == (
        f"shop {shop_id} is kept because an experiment names it: "
        "a recorded run is explained by the shop it ran on"
    )
    assert (await client.get(f"/api/v1/shops/{shop_id}/draft")).status_code == 200


def experiment_row(shop_id: str) -> ExperimentModel:
    return ExperimentModel(
        experiment_id=str(uuid4()),
        shop_id=shop_id,
        label="Prompt comparison",
        scenario_id=str(uuid4()),
        scenario_version=1,
        seed=20261002,
        snapshot_id=str(uuid4()),
        sandbox_fingerprint="a" * 64,
        resolution_fingerprint="b" * 64,
        participant_driver="human",
        document={},
        created_at=datetime(2026, 10, 2, 12, 0, tzinfo=UTC),
    )


async def test_an_upload_after_the_delete_lands_no_row_and_no_file(
    client: AsyncClient, tmp_path: Path
) -> None:
    shop_id = await make_shop(client)
    assert (await client.delete(f"/api/v1/shops/{shop_id}")).status_code == 204

    late = await client.post(
        f"/api/v1/shops/{shop_id}/media",
        files={"file": ("harbour.png", PNG, "application/octet-stream")},
    )

    assert late.status_code == 404
    assert rows_of(engine_of(tmp_path), "shop_media_assets", shop_id) == 0
    assert not (media_root(tmp_path) / "shops" / shop_id).exists()


def test_a_publish_that_read_the_draft_before_the_delete_committed_is_refused(
    tmp_path: Path,
) -> None:
    """A publish and a delete racing: one wins, and no version outlives its shop's draft.

    The publish reads the draft, then the delete commits on another connection, then the
    publish writes its version. pysqlite takes no lock for the read, so nothing orders the two
    until the version is written; the publish reads the draft again under its write lock and
    refuses, rolling its version back.
    """
    engine = engine_of(tmp_path)
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with session_scope(factory) as session:
        shop_id = seeded_publishable_shop(session)

    def delete_on_another_connection() -> None:
        with session_scope(factory) as other:
            deletion_service(other).delete_shop(shop_id)

    with (
        pytest.raises(ShopNotFoundError, match="deleted while it was publishing"),
        session_scope(factory) as session,
    ):
        racing = RacingRepository(session, delete_on_another_connection)
        ShopService(racing, FixedClock(), SqlAlchemyShopMediaRepository(session)).publish(shop_id)

    assert rows_of(engine, "definition_versions", str(shop_id)) == 0
    assert rows_of(engine, "definition_drafts", str(shop_id)) == 0


def test_a_delete_after_a_publish_committed_is_refused(tmp_path: Path) -> None:
    engine = engine_of(tmp_path)
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with session_scope(factory) as session:
        shop_id = seeded_publishable_shop(session)
    with session_scope(factory) as session:
        ShopService(
            shop_repository(session), FixedClock(), SqlAlchemyShopMediaRepository(session)
        ).publish(shop_id)

    with (
        pytest.raises(ShopPublishedError, match="published 1 version"),
        session_scope(factory) as session,
    ):
        deletion_service(session).delete_shop(shop_id)

    assert rows_of(engine, "definition_drafts", str(shop_id)) == 1


def test_a_publish_after_the_delete_committed_finds_no_draft(tmp_path: Path) -> None:
    engine = engine_of(tmp_path)
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with session_scope(factory) as session:
        shop_id = seeded_publishable_shop(session)
    with session_scope(factory) as session:
        deletion_service(session).delete_shop(shop_id)

    with pytest.raises(ShopNotFoundError), session_scope(factory) as session:
        ShopService(
            shop_repository(session), FixedClock(), SqlAlchemyShopMediaRepository(session)
        ).publish(shop_id)

    assert rows_of(engine, "definition_versions", str(shop_id)) == 0


async def test_a_failed_commit_answers_no_204_and_removes_no_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The route commits before it answers, and the files go only after that commit."""

    def failing_commit(_session: Session) -> None:
        raise OperationalError("COMMIT", {}, Exception("disk I/O error"))

    async with api_client(tmp_path, DATABASE, raise_app_exceptions=False) as client:
        shop_id = await make_shop(client)
        await upload(client, shop_id, PNG)
        monkeypatch.setattr(Session, "commit", failing_commit)

        answered = await client.delete(f"/api/v1/shops/{shop_id}")
        monkeypatch.undo()

        assert answered.status_code == 500
        assert (media_root(tmp_path) / "shops" / shop_id / digest(PNG)).read_bytes() == PNG
        assert (await client.get(f"/api/v1/shops/{shop_id}/draft")).status_code == 200
        assert (await client.get(f"/api/v1/shops/{shop_id}/media")).json()["media"]


async def test_the_directory_is_removed_only_once_the_rows_are_committed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """At the moment the directory goes, another connection already reads the shop as gone."""
    seen: list[int] = []
    remove_shop = FilesystemMediaStore.remove_shop

    def recording_remove(store: FilesystemMediaStore, shop_id: UUID) -> None:
        seen.append(rows_of(engine_of(tmp_path), "definition_drafts", str(shop_id)))
        remove_shop(store, shop_id)

    async with api_client(tmp_path, DATABASE) as client:
        shop_id = await make_shop(client)
        await upload(client, shop_id, PNG)
        monkeypatch.setattr(FilesystemMediaStore, "remove_shop", recording_remove)

        answered = await client.delete(f"/api/v1/shops/{shop_id}")

    assert answered.status_code == 204
    assert seen == [0]
    assert not (media_root(tmp_path) / "shops" / shop_id).exists()


async def test_a_refused_delete_removes_no_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    removed: list[UUID] = []

    def recording_remove(_store: FilesystemMediaStore, shop_id: UUID) -> None:
        removed.append(shop_id)

    monkeypatch.setattr(FilesystemMediaStore, "remove_shop", recording_remove)
    async with api_client(tmp_path, DATABASE) as client:
        shop_id = await make_shop(client)
        assert (await client.post(f"/api/v1/shops/{shop_id}/versions")).status_code == 201

        assert (await client.delete(f"/api/v1/shops/{shop_id}")).status_code == 409
        assert (await client.delete(f"/api/v1/shops/{uuid4()}")).status_code == 404

    assert removed == []


async def test_a_directory_that_cannot_be_removed_is_left_and_logged_by_shop_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def stuck(_store: FilesystemMediaStore, _shop_id: UUID) -> None:
        raise PermissionError(13, "Permission denied")

    async with api_client(tmp_path, DATABASE) as client:
        shop_id = await make_shop(client)
        await upload(client, shop_id, PNG)
        monkeypatch.setattr(FilesystemMediaStore, "remove_shop", stuck)

        with caplog.at_level(logging.WARNING):
            answered = await client.delete(f"/api/v1/shops/{shop_id}")

        assert answered.status_code == 204
        assert (await client.get(f"/api/v1/shops/{shop_id}/draft")).status_code == 404
    assert (media_root(tmp_path) / "shops" / shop_id / digest(PNG)).exists()
    assert [record.getMessage() for record in caplog.records if record.levelno >= 30] == [
        f"left the media directory of deleted shop {shop_id} behind"
    ]


# The use case over fakes: the order of its writes and what a refusal leaves untouched.


@dataclass
class FakeDrafts:
    shops: dict[UUID, int] = field(default_factory=dict[UUID, int])
    calls: list[str] = field(default_factory=list[str])

    def exists(self, shop_id: UUID) -> bool:
        return shop_id in self.shops

    def delete_unpublished(self, shop_id: UUID) -> bool:
        self.calls.append("delete_unpublished")
        if self.shops.get(shop_id) == 0:
            del self.shops[shop_id]
            return True
        return False

    def delete_scoped_to(self, shop_id: UUID) -> int:
        self.calls.append("delete_scoped_to")
        return 3

    def published_version_count(self, shop_id: UUID) -> int:
        return self.shops[shop_id]


@dataclass
class FakeRemoval:
    name: str
    calls: list[str]
    count: int

    def delete_for_shop(self, shop_id: UUID) -> int:
        self.calls.append(self.name)
        return self.count

    def detach_shop(self, shop_id: UUID) -> int:
        self.calls.append(self.name)
        return self.count


def fake_service(shops: dict[UUID, int]) -> tuple[ShopDeletionService, list[str]]:
    drafts = FakeDrafts(shops)
    calls = drafts.calls
    return (
        ShopDeletionService(
            drafts,
            FakeRemoval("orders", calls, 2),
            FakeRemoval("attachments", calls, 1),
            FakeRemoval("media", calls, 4),
        ),
        calls,
    )


def test_the_guarded_draft_delete_is_the_first_write_and_the_rest_follow_it() -> None:
    shop_id = uuid4()
    service, calls = fake_service({shop_id: 0})

    removed = service.delete_shop(shop_id)

    assert calls[0] == "delete_unpublished"
    assert sorted(calls[1:]) == ["attachments", "delete_scoped_to", "media", "orders"]
    assert removed == DeletedShop(shop_id, scoped_drafts=3, orders=2, attachments=1, images=4)
    assert service.deleted == shop_id


def test_a_refusal_writes_nothing_more_and_reports_nothing_deleted() -> None:
    published, unknown = uuid4(), uuid4()
    service, calls = fake_service({published: 2})

    with pytest.raises(ShopPublishedError, match="published 2 versions") as refusal:
        service.delete_shop(published)
    assert refusal.value.published_versions == 2
    with pytest.raises(ShopNotFoundError):
        service.delete_shop(unknown)

    assert calls == ["delete_unpublished", "delete_unpublished"]
    assert service.deleted is None


# The repository's guarded statement, on a real store.


def test_the_guarded_statement_deletes_only_a_shop_nothing_published_or_ran_on(
    tmp_path: Path,
) -> None:
    engine = engine_of(tmp_path)
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with session_scope(factory) as session:
        free, published, experimented = (seeded_publishable_shop(session) for _ in range(3))
        ShopService(
            shop_repository(session), FixedClock(), SqlAlchemyShopMediaRepository(session)
        ).publish(published)
        session.add(experiment_row(str(experimented)))

    with session_scope(factory) as session:
        drafts = SqlAlchemyShopDirectory(session)
        assert drafts.delete_unpublished(published) is False
        assert drafts.delete_unpublished(experimented) is False
        assert drafts.delete_unpublished(uuid4()) is False
        assert drafts.delete_unpublished(free) is True
        assert drafts.delete_unpublished(free) is False
        assert drafts.published_version_count(published) == 1

    with engine.connect() as connection:
        remaining = connection.scalars(
            text("SELECT definition_id FROM definition_drafts WHERE definition_type = 'shop'")
        ).all()
    assert sorted(remaining) == sorted([str(published), str(experimented)])


def test_each_repository_deletes_only_its_own_shops_rows(tmp_path: Path) -> None:
    engine = engine_of(tmp_path)
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    target, other = uuid4(), uuid4()
    with session_scope(factory) as session:
        for shop_id in (target, other):
            session.execute(
                text(
                    "INSERT INTO definition_shop_attachments "
                    "(definition_type, definition_id, shop_id, attached_at) "
                    "VALUES ('customer_profile', :profile, :shop, '2026-10-02 12:00:00')"
                ),
                {"profile": str(uuid4()), "shop": str(shop_id)},
            )

    with session_scope(factory) as session:
        assert SqlAlchemyDefinitionShopAttachmentRepository(session).detach_shop(target) == 1
        assert SqlAlchemyOrderFixtureRepository(session).delete_for_shop(target) == 0
        assert SqlAlchemyShopMediaRepository(session).delete_for_shop(target) == 0
        assert SqlAlchemyShopDirectory(session).delete_scoped_to(target) == 0

    with engine.connect() as connection:
        left = connection.scalar(text("SELECT COUNT(*) FROM definition_shop_attachments"))
    assert left == 1


# Helpers for the service-level races.


@dataclass
class FixedClock:
    value: datetime = datetime(2026, 10, 2, 12, 0, tzinfo=UTC)

    def now(self) -> datetime:
        return self.value


class RacingRepository(SqlAlchemyDefinitionRepository[ShopPayload]):
    """The shop repository, with another connection's commit between the read and the write.

    `latest_published_version` is what `publish` asks after it has read the draft and before
    it writes the version, which is the window a racing delete lands in.
    """

    def __init__(self, session: Session, between: Callable[[], None]) -> None:
        super().__init__(session, SHOP_CODEC)
        self._between = between

    def latest_published_version(self, definition: DefinitionId) -> int | None:
        self._between()
        return super().latest_published_version(definition)


def seeded_publishable_shop(session: Session) -> UUID:
    service = ShopService(
        shop_repository(session), FixedClock(), SqlAlchemyShopMediaRepository(session)
    )
    created = service.create_shop(saved_shop().identity)
    shop_id = created.definition.id
    payload = saved_shop()
    service.replace_draft(shop_id, payload)
    return shop_id


def deletion_service(session: Session) -> ShopDeletionService:
    return ShopDeletionService(
        SqlAlchemyShopDirectory(session),
        SqlAlchemyOrderFixtureRepository(session),
        SqlAlchemyDefinitionShopAttachmentRepository(session),
        SqlAlchemyShopMediaRepository(session),
    )
