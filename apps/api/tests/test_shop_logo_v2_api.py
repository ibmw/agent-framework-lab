"""A logo stored before its colour was chosen (`shop-payload-v2`), through the API (ADR 0070).

The workspace answers a v2 logo with the colour the lab derived and echoes that colour back on
every save. An unchanged logo must stay byte-identical, so a save that changes nothing, or
changes something else, leaves the v2 document and its fingerprint where they were.
"""

import json
from collections.abc import AsyncGenerator
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import Engine, text

from capability_lab.application.shop_payload import (
    shop_content_fingerprint,
    shop_payload_document,
    shop_payload_from_document,
)
from capability_lab.domain.shop import ShopLogo, ShopLogoBackground, ShopMark
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
)
from capability_lab.presentation.api import create_app
from test_shop_api import IDENTITY, PAYLOAD

V2_LOGO = ShopLogo(mark=ShopMark.COMPASS, background=ShopLogoBackground.OCHRE, mark_colour=None)


@dataclass(frozen=True, slots=True)
class Lab:
    client: AsyncClient
    engine: Engine

    def stored_draft(self) -> dict[str, Any]:
        with self.engine.connect() as connection:
            payload = connection.execute(
                text("SELECT payload FROM definition_drafts WHERE definition_type = 'shop'")
            ).scalar_one()
        return json.loads(payload) if isinstance(payload, str) else payload


@pytest.fixture
async def lab(tmp_path: Path) -> AsyncGenerator[Lab, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'shop-logo-v2.db'}")
    Base.metadata.create_all(engine)
    application = create_app(session_factory=create_session_factory(engine))
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://lab.test"
    ) as client:
        yield Lab(client=client, engine=engine)


async def published_v2_shop(lab: Lab) -> tuple[str, dict[str, Any]]:
    """A shop whose draft and version 1 hold the same v2 document, as main's code wrote it."""
    shop_id = str(
        (await lab.client.post("/api/v1/shops", json={"identity": IDENTITY})).json()["shop_id"]
    )
    assert (
        await lab.client.put(f"/api/v1/shops/{shop_id}/draft", json={"payload": PAYLOAD})
    ).status_code == 200
    assert (await lab.client.post(f"/api/v1/shops/{shop_id}/versions")).status_code == 201

    payload = replace(shop_payload_from_document(lab.stored_draft()), logo=V2_LOGO)
    document = shop_payload_document(payload)
    assert document["canonical_schema_version"] == "shop-payload-v2"
    with lab.engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE definition_versions SET payload = json(:payload), "
                "content_fingerprint = :fingerprint"
            ),
            {"payload": json.dumps(document), "fingerprint": shop_content_fingerprint(payload)},
        )
        connection.execute(
            text("UPDATE definition_drafts SET payload = json(:payload)"),
            {"payload": json.dumps(document)},
        )
    return shop_id, document


def as_written(content: dict[str, Any]) -> dict[str, Any]:
    """What the workspace writes back: the answer without its derived evidence."""
    payload = {key: value for key, value in content.items() if key != "default_tone_of_voice_id"}
    payload["products"] = [
        {key: value for key, value in product.items() if key != "ratings"}
        for product in content["products"]
    ]
    return payload


async def preview(lab: Lab, shop_id: str) -> dict[str, Any]:
    return (await lab.client.get(f"/api/v1/shops/{shop_id}/draft/preview")).json()


async def test_a_v2_logo_saved_back_unchanged_keeps_its_bytes_and_fingerprint(lab: Lab) -> None:
    shop_id, stored = await published_v2_shop(lab)
    content = (await lab.client.get(f"/api/v1/shops/{shop_id}/draft")).json()["content"]
    assert content["logo"] == {"mark": "compass", "background": "ochre", "mark_colour": "ink"}

    saved = await lab.client.put(
        f"/api/v1/shops/{shop_id}/draft", json={"payload": as_written(content)}
    )

    assert saved.status_code == 200
    assert lab.stored_draft() == stored
    gate = await preview(lab, shop_id)
    assert gate["changes"] == []
    assert gate["matches_latest_published"] is True


async def test_a_product_edit_leaves_a_v2_logo_where_it_was(lab: Lab) -> None:
    shop_id, stored = await published_v2_shop(lab)
    content = (await lab.client.get(f"/api/v1/shops/{shop_id}/draft")).json()["content"]
    payload = as_written(content)
    payload["products"][0]["title"] = "Alpine Shell Jacket II"

    assert (
        await lab.client.put(f"/api/v1/shops/{shop_id}/draft", json={"payload": payload})
    ).status_code == 200

    assert lab.stored_draft()["canonical_schema_version"] == "shop-payload-v2"
    assert lab.stored_draft()["logo"] == stored["logo"]
    changes = (await preview(lab, shop_id))["changes"]
    assert [change["path"] for change in changes if change["path"] == "logo"] == []
    assert changes != []


async def test_an_old_writer_resending_a_v2_logo_without_a_colour_keeps_it_v2(lab: Lab) -> None:
    shop_id, stored = await published_v2_shop(lab)
    content = (await lab.client.get(f"/api/v1/shops/{shop_id}/draft")).json()["content"]
    payload = {**as_written(content), "logo": {"mark": "compass", "background": "ochre"}}

    assert (
        await lab.client.put(f"/api/v1/shops/{shop_id}/draft", json={"payload": payload})
    ).status_code == 200

    assert lab.stored_draft() == stored
    assert (await preview(lab, shop_id))["matches_latest_published"] is True


@pytest.mark.parametrize(
    ("logo", "written"),
    [
        (
            {"mark": "compass", "background": "ochre", "mark_colour": "white"},
            {"mark": "compass", "background": "ochre", "mark_colour": "white"},
        ),
        (
            {"mark": "anchor", "background": "ochre", "mark_colour": "ink"},
            {"mark": "anchor", "background": "ochre", "mark_colour": "ink"},
        ),
        (
            {"mark": "compass", "background": "stone"},
            {"mark": "compass", "background": "stone", "mark_colour": "ink"},
        ),
    ],
)
async def test_a_v2_logo_changed_in_any_way_is_written_as_v3(
    lab: Lab, logo: dict[str, Any], written: dict[str, Any]
) -> None:
    shop_id, _ = await published_v2_shop(lab)
    content = (await lab.client.get(f"/api/v1/shops/{shop_id}/draft")).json()["content"]

    assert (
        await lab.client.put(
            f"/api/v1/shops/{shop_id}/draft",
            json={"payload": {**as_written(content), "logo": logo}},
        )
    ).status_code == 200

    stored = lab.stored_draft()
    assert stored["canonical_schema_version"] == "shop-payload-v3"
    assert {key: value for key, value in stored["logo"].items()} == {
        "background": written["background"],
        "mark": written["mark"],
        "mark_colour": written["mark_colour"],
    }
    gate = await preview(lab, shop_id)
    assert gate["matches_latest_published"] is False
    assert [change["description"] for change in gate["changes"]] == ["Updated shop logo"]


async def test_a_new_logo_without_a_colour_is_stored_as_v3_with_the_derived_one(lab: Lab) -> None:
    response = await lab.client.post(
        "/api/v1/shops",
        json={"identity": IDENTITY, "logo": {"mark": "anchor", "background": "ochre"}},
    )

    assert response.status_code == 201
    stored = lab.stored_draft()
    assert stored["canonical_schema_version"] == "shop-payload-v3"
    assert stored["logo"] == {"background": "ochre", "mark": "anchor", "mark_colour": "ink"}


async def put_logo(lab: Lab, shop_id: str, logo: dict[str, Any]) -> None:
    content = (await lab.client.get(f"/api/v1/shops/{shop_id}/draft")).json()["content"]
    response = await lab.client.put(
        f"/api/v1/shops/{shop_id}/draft", json={"payload": {**as_written(content), "logo": logo}}
    )
    assert response.status_code == 200


@pytest.mark.parametrize(
    "back",
    [
        {"mark": "compass", "background": "ochre", "mark_colour": "ink"},
        # An old writer sends no colour; the lab gives it the derived one.
        {"mark": "compass", "background": "ochre"},
    ],
)
async def test_a_colour_changed_and_changed_back_returns_to_the_published_v2_logo(
    lab: Lab, back: dict[str, Any]
) -> None:
    shop_id, published = await published_v2_shop(lab)
    await put_logo(lab, shop_id, {"mark": "compass", "background": "ochre", "mark_colour": "white"})
    assert lab.stored_draft()["canonical_schema_version"] == "shop-payload-v3"

    await put_logo(lab, shop_id, back)

    assert lab.stored_draft() == published
    gate = await preview(lab, shop_id)
    assert gate["changes"] == []
    assert gate["matches_latest_published"] is True
    version = (await lab.client.get(f"/api/v1/shops/{shop_id}/versions/1")).json()
    assert gate["content_fingerprint"] == version["content_fingerprint"]


async def test_a_published_v3_logo_is_left_as_v3(lab: Lab) -> None:
    shop_id, _ = await published_v2_shop(lab)
    chosen = {"mark": "compass", "background": "ochre", "mark_colour": "ink"}
    await put_logo(lab, shop_id, {**chosen, "mark_colour": "white"})
    assert (await lab.client.post(f"/api/v1/shops/{shop_id}/versions")).status_code == 201
    await put_logo(lab, shop_id, chosen)
    assert (await lab.client.post(f"/api/v1/shops/{shop_id}/versions")).status_code == 201

    await put_logo(lab, shop_id, {**chosen, "mark_colour": "white"})
    await put_logo(lab, shop_id, chosen)

    stored = lab.stored_draft()
    assert stored["canonical_schema_version"] == "shop-payload-v3"
    assert stored["logo"] == {"background": "ochre", "mark": "compass", "mark_colour": "ink"}
    assert (await preview(lab, shop_id))["matches_latest_published"] is True


async def test_a_corrupt_published_version_does_not_block_a_draft_save(lab: Lab) -> None:
    shop_id, _ = await published_v2_shop(lab)
    await put_logo(lab, shop_id, {"mark": "compass", "background": "ochre", "mark_colour": "white"})
    with lab.engine.begin() as connection:
        connection.execute(
            text("UPDATE definition_versions SET content_fingerprint = :bad"), {"bad": "0" * 64}
        )

    await put_logo(lab, shop_id, {"mark": "compass", "background": "ochre", "mark_colour": "ink"})

    # Saved as it would be without a published version to compare with.
    stored = lab.stored_draft()
    assert stored["canonical_schema_version"] == "shop-payload-v3"
    assert stored["logo"]["mark_colour"] == "ink"
    # The corruption is still reported where the version is read.
    assert (await lab.client.get(f"/api/v1/shops/{shop_id}/versions/1")).status_code == 500
