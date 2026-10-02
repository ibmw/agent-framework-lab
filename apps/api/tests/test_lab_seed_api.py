"""The seed reached over HTTP: what it writes, and the two databases it still declines.

`test_demo_seed.py` holds what the story contains; this suite holds only what the route adds
to it. The claim worth testing here is the one ADR 0047 rests on — that the refusal, and not
the absence of a URL, is what keeps a populated lab safe — so a database with anything in it
is posted at and asserted to come back untouched with its occupied tables named.
"""

from __future__ import annotations

import hashlib
from collections.abc import AsyncGenerator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from capability_lab.infrastructure.config import Settings, get_default_settings
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
)
from capability_lab.presentation.api import create_app
from capability_lab.presentation.seed import content
from capability_lab.presentation.seed.runner import default_alembic_config, head_revision

_TYPES = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


@pytest.fixture
def alembic_config() -> Path:
    located = default_alembic_config()
    assert located is not None, "the suite runs from a checkout that has apps/api/alembic.ini"
    return located


def _media_root_for(url: str) -> Path:
    """Beside the suite's database, under the test's own temporary directory."""
    return Path(url.removeprefix("sqlite:///")).parent / "lab-seed-media"


def _settings_for(url: str) -> Settings:
    """Declared defaults with the database and the media root moved, so no `.env` reaches
    this suite and nothing the route seeds lands in the checkout's `var/media`."""
    return get_default_settings().model_copy(
        update={"database_url": url, "media_root": _media_root_for(url)}
    )


def _database(path: Path, *, stamp: str | None) -> str:
    url = f"sqlite:///{path}"
    engine = create_database_engine(url)
    Base.metadata.create_all(engine)
    if stamp is not None:
        with engine.begin() as connection:
            connection.execute(
                text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)")
            )
            connection.execute(
                text("INSERT INTO alembic_version (version_num) VALUES (:revision)"),
                {"revision": stamp},
            )
    engine.dispose()
    return url


def _client_for(url: str) -> AsyncClient:
    """An app composed on one database, so the route and the screens read the same rows."""
    engine = create_database_engine(url)
    application = create_app(
        _settings_for(url),
        session_factory=create_session_factory(engine),
    )
    return AsyncClient(transport=ASGITransport(app=application), base_url="http://lab.test")


@pytest.fixture
async def client(tmp_path: Path, alembic_config: Path) -> AsyncGenerator[AsyncClient, None]:
    url = _database(tmp_path / "lab-seed-api.db", stamp=head_revision(alembic_config))
    async with _client_for(url) as active:
        yield active


async def test_seeding_an_empty_lab_writes_the_demo_and_names_what_it_wrote(
    client: AsyncClient,
) -> None:
    response = await client.post("/api/v1/lab-seed")

    assert response.status_code == 201
    body = response.json()
    assert len(body["configuration_ids"]) == 2
    assert len(body["run_ids"]) == 2

    # The identifiers are the point of the payload: each one has to open the thing it names.
    shop = await client.get(f"/api/v1/shops/{body['shop_id']}/draft")
    assert shop.status_code == 200
    experiment = await client.get(
        f"/api/v1/shops/{body['shop_id']}/experiments/{body['experiment_id']}"
    )
    assert experiment.status_code == 200


async def test_the_seeded_catalog_names_images_the_api_serves_as_their_own_type(
    client: AsyncClient,
) -> None:
    """The route stores the seed's images where the app serves them from (ADR 0076).

    Read as a browser reads them: the published version names each image, and the media
    route answers its bytes — the very file the package ships — under the type its first
    bytes say. The gate passed, so version 1 exists, and it warns of no product without one.
    """
    shop_id = (await client.post("/api/v1/lab-seed")).json()["shop_id"]

    version = await client.get(f"/api/v1/shops/{shop_id}/versions/1")
    assert version.status_code == 200
    products = version.json()["content"]["products"]
    library = (await client.get(f"/api/v1/shops/{shop_id}/media")).json()["media"]
    file_name_of = {item["reference"]: item["file_name"] for item in library}

    # Each product names the images it was written with, by file and alt text, in order.
    assert {
        product["handle"]: [
            (file_name_of[entry["reference"]], entry["alt_text"]) for entry in product["media"]
        ]
        for product in products
    } == {
        handle: [(image.file_name, image.alt_text) for image in images]
        for handle, images in content.PRODUCT_IMAGES.items()
    }

    # And each is served as the file the package ships, under the type its bytes say.
    for product in products:
        for entry in product["media"]:
            sha256 = entry["reference"].removeprefix("asset:sha256:")
            response = await client.get(f"/api/v1/shops/{shop_id}/media/{sha256}")
            assert response.status_code == 200
            assert hashlib.sha256(response.content).hexdigest() == sha256
            file_name = file_name_of[entry["reference"]]
            assert response.content == content.image_bytes(_shipped(file_name))
            assert response.headers["content-type"] == _TYPES[Path(file_name).suffix]

    preview = (await client.get(f"/api/v1/shops/{shop_id}/draft/preview")).json()
    assert preview["publishable"] is True
    assert [issue for issue in preview["issues"] if issue["code"] == "product_without_media"] == []


async def test_seeding_a_lab_that_holds_anything_refuses_and_leaves_it_alone(
    client: AsyncClient,
) -> None:
    seeded = await client.post("/api/v1/lab-seed")
    assert seeded.status_code == 201
    shop_id = seeded.json()["shop_id"]

    refused = await client.post("/api/v1/lab-seed")

    assert refused.status_code == 409
    assert refused.json()["code"] == "seed_refused"
    # Named tables and the remedy, the way the command says it: a reader has to be able to act
    # on this without opening the source that raised it.
    message = refused.json()["message"]
    assert "already holds seeded data" in message
    assert "definition_drafts" in message
    assert "delete the database file" in message
    assert "the media root" in message
    # And the refusal is a refusal: what was there before is still there, unmerged.
    assert (await client.get(f"/api/v1/shops/{shop_id}/draft")).status_code == 200
    assert len((await client.get("/api/v1/shops")).json()["shops"]) == 1


async def test_seeding_a_database_behind_the_migration_head_refuses(tmp_path: Path) -> None:
    """The gate ADR 0043 put first, which the route inherits rather than re-implements."""
    url = _database(tmp_path / "stale.db", stamp="20260905_0017")

    async with _client_for(url) as client:
        response = await client.post("/api/v1/lab-seed")

    assert response.status_code == 409
    assert response.json()["code"] == "seed_refused"
    assert "migration head" in response.json()["message"]
    assert _drafts_in(url) == 0


def _shipped(file_name: str) -> content.ProductImage:
    [image] = [image for image in content.product_images() if image.file_name == file_name]
    return image


def _drafts_in(url: str) -> int:
    """Shops, customers and scenarios are all rows in this table (`docs/architecture.md`)."""
    engine = create_database_engine(url)
    with engine.begin() as connection:
        count = connection.execute(text("SELECT COUNT(*) FROM definition_drafts")).scalar_one()
    engine.dispose()
    return int(count)
