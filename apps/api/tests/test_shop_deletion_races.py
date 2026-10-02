"""A write that races its shop's deletion leaves no row naming the shop, and answers 404.

ADR 0077: each write below reads the shop, then the deletion of the shop commits on another
connection, then the write writes. pysqlite takes no lock for a read, so nothing orders the two
until the write's first write. That first write is the shop's claim — a no-op `UPDATE` of its
draft — which finds the draft gone, so the write is the 404 an unknown shop is, and nothing it
would have written lands.

The delete is injected after the write's last read of the store, by wrapping the repository
method that makes it; for a write whose only shop check is the claim itself, just before it.
"""

from collections.abc import AsyncGenerator, Callable
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from api_factories import (
    PLACED_AT,
    PRODUCT,
    PROFILE,
    api_client,
    create_scenario,
    scenario_body,
    seed_lab,
    ticket_body,
)
from capability_lab.application.order_fixtures import OrderFixtureService
from capability_lab.application.shops import ShopNotFoundError
from capability_lab.infrastructure.database import create_session_factory, session_scope
from capability_lab.infrastructure.repositories import (
    SqlAlchemyDefinitionRepository,
    SqlAlchemyDefinitionShopAttachmentRepository,
    SqlAlchemyOrderFixtureRepository,
    SqlAlchemyShopDirectory,
    SqlAlchemyShopMediaRepository,
    customer_profile_repository,
    shop_repository,
)
from capability_lab.presentation.orders import ReplaceOrderRequest
from test_shop_deletion import EMPTIED, FixedClock, deletion_service, engine_of, rows_of

DATABASE = "shop-deletion.db"

type Lab = dict[str, str]

CANONICAL_PLACED_AT = "2026-08-20T14:55:00.000000Z"
ORDER_EDIT: dict[str, Any] = {
    "reference": "NS-10482",
    "placed_at": PLACED_AT,
    "lines": [{"sku": "NS-ASJ-OB-M", "quantity": 2}],
    "payment": {"status": "paid", "method_id": "card", "paid_at": "2026-08-21T13:12:00Z"},
    "fulfilment": {"status": "unfulfilled", "method_id": "standard", "shipped_at": None},
    "shipping_fee_amount": "0.00",
    "shipping_address_id": None,
    "events": [],
}


@pytest.fixture
async def client(tmp_path: Path) -> AsyncGenerator[AsyncClient, None]:
    async with api_client(tmp_path, DATABASE) as active:
        yield active


@pytest.fixture
async def lab(client: AsyncClient) -> Lab:
    """A shop that never published, with a customer, an order, a ticket and a scenario."""
    seeded = await seed_lab(client)
    return {**seeded, "scenario_id": await create_scenario(client, seeded)}


def deletion_of(tmp_path: Path, shop_id: str) -> Callable[[], None]:
    """Delete the shop on another connection, committed, the first time it is called."""
    fired: list[bool] = []

    def delete() -> None:
        if fired:
            return
        fired.append(True)
        factory = create_session_factory(engine_of(tmp_path))
        with session_scope(factory) as other:
            deletion_service(other).delete_shop(UUID(shop_id))

    return delete


def after(monkeypatch: pytest.MonkeyPatch, owner: type, name: str, race: Callable[[], None]):
    """Run `race` once `owner.name` has answered: the read came before the delete committed."""
    original = getattr(owner, name)

    def racing(self: object, *args: Any, **kwargs: Any) -> Any:
        answer = original(self, *args, **kwargs)
        race()
        return answer

    monkeypatch.setattr(owner, name, racing)


def before(monkeypatch: pytest.MonkeyPatch, owner: type, name: str, race: Callable[[], None]):
    """Run `race` before `owner.name` runs: the delete commits just ahead of the claim."""
    original = getattr(owner, name)

    def racing(self: object, *args: Any, **kwargs: Any) -> Any:
        race()
        return original(self, *args, **kwargs)

    monkeypatch.setattr(owner, name, racing)


def nothing_names(tmp_path: Path, shop_id: str) -> dict[str, int]:
    engine = engine_of(tmp_path)
    return {table: rows_of(engine, table, shop_id) for table in sorted(EMPTIED)}


def none_left() -> dict[str, int]:
    return dict.fromkeys(sorted(EMPTIED), 0)


def assert_unknown_shop(response: Any) -> None:
    assert response.status_code == 404, response.text
    assert response.json()["code"] == "shop_not_found"


async def test_an_order_created_as_its_shop_is_deleted_lands_nothing(
    client: AsyncClient, lab: Lab, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    race = deletion_of(tmp_path, lab["shop_id"])
    after(monkeypatch, SqlAlchemyOrderFixtureRepository, "reference_owner", race)

    response = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/orders",
        json={
            "reference": "NS-20001",
            "customer_profile_id": lab["profile_id"],
            "placed_at": PLACED_AT,
        },
    )

    assert_unknown_shop(response)
    assert nothing_names(tmp_path, lab["shop_id"]) == none_left()


async def test_an_order_edited_as_its_shop_is_deleted_answers_404(
    client: AsyncClient, lab: Lab, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    race = deletion_of(tmp_path, lab["shop_id"])
    after(monkeypatch, SqlAlchemyOrderFixtureRepository, "reference_owner", race)

    response = await client.put(
        f"/api/v1/shops/{lab['shop_id']}/orders/{lab['order_id']}", json=ORDER_EDIT
    )

    assert_unknown_shop(response)
    assert nothing_names(tmp_path, lab["shop_id"]) == none_left()


async def test_a_ticket_created_as_its_shop_is_deleted_lands_nothing(
    client: AsyncClient, lab: Lab, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    race = deletion_of(tmp_path, lab["shop_id"])
    # The reference check lists the shop's tickets: the last read before the ticket is written.
    after(monkeypatch, SqlAlchemyDefinitionRepository, "list_in_shop", race)

    response = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/tickets",
        json={
            "reference": "T-999",
            "subject": "Where is my parcel",
            "customer_profile_id": lab["profile_id"],
            "channel": "chat",
        },
    )

    assert_unknown_shop(response)
    assert nothing_names(tmp_path, lab["shop_id"]) == none_left()


async def test_a_ticket_draft_saved_as_its_shop_is_deleted_answers_404(
    client: AsyncClient, lab: Lab, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    race = deletion_of(tmp_path, lab["shop_id"])
    after(monkeypatch, SqlAlchemyDefinitionRepository, "list_in_shop", race)

    response = await client.put(
        f"/api/v1/shops/{lab['shop_id']}/tickets/{lab['ticket_id']}/draft",
        json={"payload": ticket_body(lab["order_id"])},
    )

    assert_unknown_shop(response)
    assert nothing_names(tmp_path, lab["shop_id"]) == none_left()


async def test_a_scenario_created_as_its_shop_is_deleted_lands_nothing(
    client: AsyncClient, lab: Lab, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    race = deletion_of(tmp_path, lab["shop_id"])
    # The name check lists the shop's scenarios: the last read before the scenario is written.
    after(monkeypatch, SqlAlchemyDefinitionRepository, "list_in_shop", race)

    response = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/scenarios",
        json={"name": "Parcel lost in transit", "ticket_id": lab["ticket_id"]},
    )

    assert_unknown_shop(response)
    assert nothing_names(tmp_path, lab["shop_id"]) == none_left()


async def test_a_scenario_draft_saved_as_its_shop_is_deleted_answers_404(
    client: AsyncClient, lab: Lab, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    race = deletion_of(tmp_path, lab["shop_id"])
    after(monkeypatch, SqlAlchemyDefinitionRepository, "list_in_shop", race)

    response = await client.put(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{lab['scenario_id']}/draft",
        json={"payload": scenario_body(lab)},
    )

    assert_unknown_shop(response)
    assert nothing_names(tmp_path, lab["shop_id"]) == none_left()


def race_the_shop_check(monkeypatch: pytest.MonkeyPatch, race: Callable[[], None]) -> None:
    """The attach's only shop check: a read before it, or the claim that replaced the read."""
    after(monkeypatch, SqlAlchemyShopDirectory, "exists", race)
    if hasattr(SqlAlchemyShopDirectory, "claim"):
        before(monkeypatch, SqlAlchemyShopDirectory, "claim", race)


async def test_a_profile_attached_as_its_shop_is_deleted_lands_no_attachment(
    client: AsyncClient, lab: Lab, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    other = await client.post(
        "/api/v1/customer-profiles",
        json={"identity": PROFILE["identity"], "customer_since": "2024-03-14", "shop_id": None},
    )
    assert other.status_code == 201, other.text
    profile_id = other.json()["profile_id"]
    race_the_shop_check(monkeypatch, deletion_of(tmp_path, lab["shop_id"]))

    response = await client.post(
        f"/api/v1/customer-profiles/{profile_id}/shops", json={"shop_id": lab["shop_id"]}
    )

    assert_unknown_shop(response)
    assert nothing_names(tmp_path, lab["shop_id"]) == none_left()
    shops = await client.get(f"/api/v1/customer-profiles/{profile_id}/shops")
    assert shops.json()["shop_ids"] == []


async def test_a_profile_created_into_a_shop_being_deleted_lands_nothing(
    client: AsyncClient, lab: Lab, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with engine_of(tmp_path).connect() as connection:
        profiles_before = connection.scalar(
            text("SELECT COUNT(*) FROM definition_drafts WHERE definition_type='customer_profile'")
        )
    race_the_shop_check(monkeypatch, deletion_of(tmp_path, lab["shop_id"]))

    response = await client.post(
        "/api/v1/customer-profiles",
        json={
            "identity": PROFILE["identity"],
            "customer_since": "2024-03-14",
            "shop_id": lab["shop_id"],
        },
    )

    assert_unknown_shop(response)
    assert nothing_names(tmp_path, lab["shop_id"]) == none_left()
    with engine_of(tmp_path).connect() as connection:
        assert (
            connection.scalar(
                text(
                    "SELECT COUNT(*) FROM definition_drafts "
                    "WHERE definition_type='customer_profile'"
                )
            )
            == profiles_before
        )


async def test_a_shop_draft_saved_as_the_shop_is_deleted_answers_404(
    client: AsyncClient, lab: Lab, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The save read the draft before the delete; it used to update a gone row, a 500."""
    draft = (await client.get(f"/api/v1/shops/{lab['shop_id']}/draft")).json()["content"]
    draft.pop("default_tone_of_voice_id", None)
    draft["products"] = [PRODUCT]
    # The held images are the save's last read before its write.
    after(
        monkeypatch,
        SqlAlchemyShopMediaRepository,
        "list_for_shop",
        deletion_of(tmp_path, lab["shop_id"]),
    )

    response = await client.put(f"/api/v1/shops/{lab['shop_id']}/draft", json={"payload": draft})

    assert_unknown_shop(response)
    assert nothing_names(tmp_path, lab["shop_id"]) == none_left()


# The order routes answer through `validate_order`, which reads the shop again after the write,
# under the write lock, and so already refused these races over HTTP. The service is what the
# claim guards, whatever its caller reads afterwards.


def order_service(session: Session) -> OrderFixtureService:
    return OrderFixtureService(
        SqlAlchemyOrderFixtureRepository(session),
        shop_repository(session),
        customer_profile_repository(session),
        SqlAlchemyDefinitionShopAttachmentRepository(session),
        FixedClock(),
    )


async def test_the_order_service_creates_no_order_for_a_shop_deleted_since_its_reads(
    lab: Lab, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    after(
        monkeypatch,
        SqlAlchemyOrderFixtureRepository,
        "reference_owner",
        deletion_of(tmp_path, lab["shop_id"]),
    )
    factory = create_session_factory(engine_of(tmp_path))

    with pytest.raises(ShopNotFoundError), session_scope(factory) as session:
        order_service(session).create_order(
            UUID(lab["shop_id"]), "NS-20001", UUID(lab["profile_id"]), CANONICAL_PLACED_AT
        )

    assert nothing_names(tmp_path, lab["shop_id"]) == none_left()


async def test_the_order_service_edits_no_order_of_a_shop_deleted_since_its_reads(
    lab: Lab, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    after(
        monkeypatch,
        SqlAlchemyOrderFixtureRepository,
        "reference_owner",
        deletion_of(tmp_path, lab["shop_id"]),
    )
    factory = create_session_factory(engine_of(tmp_path))

    with pytest.raises(ShopNotFoundError), session_scope(factory) as session:
        order_service(session).replace_order(
            UUID(lab["shop_id"]),
            UUID(lab["order_id"]),
            ReplaceOrderRequest.model_validate(ORDER_EDIT).to_edit(),
        )

    assert nothing_names(tmp_path, lab["shop_id"]) == none_left()


async def test_a_delete_cannot_land_between_a_draft_saves_claim_and_its_update(
    client: AsyncClient, lab: Lab, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The window the claim closes inside the save: once it is taken, the delete waits.

    The delete is tried as the save flushes its update. Before the claim it committed there,
    and the update matched no row: `StaleDataError`, a 500. Now the save holds the write lock,
    so a delete given a short busy timeout (`timeout=0.2`) is refused with `database is
    locked`, which is how the test sees the lock held, and the save answers 200. A real
    concurrent delete waits up to pysqlite's 5 s default instead, and deletes once the save has
    committed.
    """
    draft = (await client.get(f"/api/v1/shops/{lab['shop_id']}/draft")).json()["content"]
    draft.pop("default_tone_of_voice_id", None)
    draft["products"] = [PRODUCT]
    impatient = create_engine(f"sqlite:///{tmp_path / DATABASE}", connect_args={"timeout": 0.2})
    refused: list[str] = []

    def delete_while_flushing(session: Session, *_: object) -> None:
        if refused or session.bind is impatient:
            return
        try:
            with session_scope(create_session_factory(impatient)) as other:
                deletion_service(other).delete_shop(UUID(lab["shop_id"]))
        except OperationalError as error:
            refused.append(str(error.orig))
        else:
            refused.append("committed")

    event.listen(Session, "before_flush", delete_while_flushing)
    try:
        response = await client.put(
            f"/api/v1/shops/{lab['shop_id']}/draft", json={"payload": draft}
        )
    finally:
        event.remove(Session, "before_flush", delete_while_flushing)

    assert response.status_code == 200, response.text
    assert refused == ["database is locked"]
    assert rows_of(engine_of(tmp_path), "definition_drafts", lab["shop_id"]) > 0
