"""The three media routes, the draft write rule and the gate over HTTP (ADR 0076)."""

import hashlib
import json
import logging
from collections.abc import AsyncGenerator, AsyncIterator
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from starlette.requests import Request
from starlette.types import Message

from api_factories import PRODUCT, api_client, make_shop, media_root
from capability_lab.application.definition_authoring import DefinitionVersionRecord
from capability_lab.application.shop_payload import shop_content_fingerprint
from capability_lab.domain.definitions import DefinitionId, DefinitionType, publish_draft
from capability_lab.domain.shop import MediaReference
from capability_lab.infrastructure.config import get_settings
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.media_store import FilesystemMediaStore
from capability_lab.infrastructure.repositories import shop_repository
from capability_lab.infrastructure.telemetry import Telemetry
from capability_lab.presentation.api import create_app
from capability_lab.presentation.shop_media import MULTIPART_OVERHEAD_BYTES

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR-ocean-blue"
JPEG = b"\xff\xd8\xff\xe0" + b"\x00\x10JFIF-seams"
GIF = b"GIF89a" + b"\x01\x00\x01\x00"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
DATABASE = "media-api.db"


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


@pytest.fixture
async def client(tmp_path: Path) -> AsyncGenerator[AsyncClient, None]:
    async with api_client(tmp_path, DATABASE) as active:
        yield active


async def upload(
    client: AsyncClient, shop_id: str, content: bytes, name: str = "ocean-blue-front.png"
) -> Any:
    return await client.post(
        f"/api/v1/shops/{shop_id}/media",
        files={"file": (name, content, "application/octet-stream")},
    )


async def draft_with_media(client: AsyncClient, shop_id: str, media: list[dict[str, str]]) -> Any:
    draft = (await client.get(f"/api/v1/shops/{shop_id}/draft")).json()["content"]
    draft.pop("default_tone_of_voice_id", None)
    draft["products"] = [{**PRODUCT, "media": media}]
    return await client.put(f"/api/v1/shops/{shop_id}/draft", json={"payload": draft})


def store_written_reference(tmp_path: Path, shop_id: str, reference: str) -> None:
    """A draft saved before the write rule existed: written straight to the repository."""
    engine = create_database_engine(f"sqlite:///{tmp_path / DATABASE}")
    with session_scope(create_session_factory(engine)) as session:
        repository = shop_repository(session)
        definition = DefinitionId(definition_type=DefinitionType.SHOP, id=UUID(shop_id))
        record = repository.get_draft(definition)
        assert record is not None
        product = record.payload.products[0]
        written = replace(product, media=(MediaReference(reference=reference, alt_text="Front"),))
        repository.save_draft(replace(record, payload=replace(record.payload, products=(written,))))
    engine.dispose()


async def test_an_image_is_uploaded_listed_and_served_as_its_own_type(
    client: AsyncClient, tmp_path: Path
) -> None:
    shop_id = await make_shop(client)

    created = await upload(client, shop_id, PNG)

    assert created.status_code == 201, created.text
    body = created.json()
    assert body == {
        "reference": f"asset:sha256:{digest(PNG)}",
        "sha256": digest(PNG),
        "content_type": "image/png",
        "byte_size": len(PNG),
        "file_name": "ocean-blue-front.png",
        "created_at": body["created_at"],
    }
    # Stored under the shop and the hash, in the root composition handed the app.
    assert (media_root(tmp_path) / "shops" / shop_id / digest(PNG)).read_bytes() == PNG

    listed = await client.get(f"/api/v1/shops/{shop_id}/media")
    assert listed.status_code == 200
    assert listed.json() == {"media": [body]}

    served = await client.get(f"/api/v1/shops/{shop_id}/media/{digest(PNG)}")
    assert served.status_code == 200
    assert served.content == PNG
    assert served.headers["content-type"] == "image/png"


async def test_the_served_image_carries_the_five_headers(client: AsyncClient) -> None:
    shop_id = await make_shop(client)
    await upload(client, shop_id, JPEG, "seams.jpg")

    served = await client.get(f"/api/v1/shops/{shop_id}/media/{digest(JPEG)}")

    assert served.headers["content-type"] == "image/jpeg"
    assert served.headers["x-content-type-options"] == "nosniff"
    assert served.headers["content-security-policy"] == "default-src 'none'; sandbox"
    assert served.headers["content-disposition"] == "inline"
    assert served.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert served.headers["etag"] == f'"{digest(JPEG)}"'


async def test_the_same_bytes_again_answer_200_with_the_image_as_first_uploaded(
    client: AsyncClient,
) -> None:
    shop_id = await make_shop(client)
    first = await upload(client, shop_id, PNG, "ocean-blue-front.png")

    again = await upload(client, shop_id, PNG, "a-second-name.png")

    assert again.status_code == 200
    assert again.json() == first.json()
    assert len((await client.get(f"/api/v1/shops/{shop_id}/media")).json()["media"]) == 1


@pytest.mark.parametrize("content", [GIF, SVG, b"plain text"])
async def test_a_file_that_is_not_png_jpeg_or_webp_is_refused_415(
    client: AsyncClient, content: bytes
) -> None:
    shop_id = await make_shop(client)

    refused = await upload(client, shop_id, content, "looks-fine.png")

    assert refused.status_code == 415
    assert refused.json()["code"] == "media_type_unsupported"
    assert (await client.get(f"/api/v1/shops/{shop_id}/media")).json() == {"media": []}


async def test_an_unknown_shop_answers_404_on_every_route(client: AsyncClient) -> None:
    missing = uuid4()

    for response in (
        await upload(client, str(missing), PNG),
        await client.get(f"/api/v1/shops/{missing}/media"),
        await client.get(f"/api/v1/shops/{missing}/media/{digest(PNG)}"),
    ):
        assert response.status_code == 404


async def test_another_shops_hash_and_a_malformed_one_answer_404(client: AsyncClient) -> None:
    owner = await make_shop(client)
    stranger = await make_shop(
        client,
        {
            "name": "Aurora",
            "slug": "aurora",
            "locale": "en-GB",
            "currencies": ["EUR"],
            "channels": ["chat"],
        },
    )
    await upload(client, owner, PNG)

    assert (await client.get(f"/api/v1/shops/{owner}/media/{digest(PNG)}")).status_code == 200
    foreign = await client.get(f"/api/v1/shops/{stranger}/media/{digest(PNG)}")
    assert foreign.status_code == 404
    assert foreign.json()["code"] == "shop_media_not_found"
    for malformed in ("not-a-hash", digest(PNG).upper(), digest(PNG)[:-1], "..%2F..%2Fetc"):
        response = await client.get(f"/api/v1/shops/{owner}/media/{malformed}")
        assert response.status_code == 404, malformed


async def test_a_request_with_no_file_is_refused_422(client: AsyncClient) -> None:
    shop_id = await make_shop(client)

    for response in (
        await client.post(f"/api/v1/shops/{shop_id}/media", files={"other": ("a.png", PNG)}),
        await client.post(f"/api/v1/shops/{shop_id}/media", data={"file": "not a file"}),
        await client.post(f"/api/v1/shops/{shop_id}/media", json={"file": "x"}),
    ):
        assert response.status_code == 422
        assert response.json()["details"][0]["location"] == "body.file"


async def test_an_oversized_body_is_refused_by_its_length_before_it_is_parsed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """413 from the header alone: `Request.form` is never reached, so nothing is parsed."""
    cap = 1024
    parsed: list[object] = []
    original = Request.form

    def recording_form(self: Request, *args: Any, **kwargs: Any) -> Any:
        parsed.append(self.url.path)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Request, "form", recording_form)
    async with api_client(tmp_path, DATABASE, media_max_bytes=cap) as client:
        shop_id = await make_shop(client)
        body = PNG + b"\x00" * (cap + MULTIPART_OVERHEAD_BYTES)

        refused = await upload(client, shop_id, body)

        assert refused.status_code == 413
        assert refused.json()["code"] == "media_too_large"
        assert parsed == []

        # Under the overhead the route parses, and the service's own count refuses it.
        counted = await upload(client, shop_id, PNG + b"\x00" * cap)
        assert counted.status_code == 413
        assert counted.json()["code"] == "media_too_large"
        assert parsed == [f"/api/v1/shops/{shop_id}/media"]

        at_cap = await upload(client, shop_id, PNG + b"\x00" * (cap - len(PNG)))
        assert at_cap.status_code == 201


async def test_a_request_without_a_length_is_refused_411(client: AsyncClient) -> None:
    shop_id = await make_shop(client)
    boundary = "lab-boundary"
    payload = (
        (
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n'
            f"Content-Type: image/png\r\n\r\n"
        ).encode()
        + PNG
        + f"\r\n--{boundary}--\r\n".encode()
    )

    async def chunks() -> AsyncIterator[bytes]:
        yield payload

    refused = await client.post(
        f"/api/v1/shops/{shop_id}/media",
        content=chunks(),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )

    assert refused.status_code == 411
    assert refused.json()["code"] == "length_required"


async def test_no_log_line_span_or_error_body_carries_the_file_name(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    """The original name is a label for display: never logged, traced, or echoed in an error.

    The haystack is shown to be real first — the hash this lab may log is findable in it.
    """
    name = "camille-private-holiday.png"
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    engine = create_database_engine(f"sqlite:///{tmp_path / DATABASE}")
    Base.metadata.create_all(engine)
    settings = get_settings().model_copy(update={"media_root": media_root(tmp_path)})
    application = create_app(
        settings,
        session_factory=create_session_factory(engine),
        telemetry=Telemetry(provider.get_tracer("sweep"), b"sweep-salt"),
    )

    with caplog.at_level(logging.DEBUG):
        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="http://lab.test"
        ) as client:
            shop_id = await make_shop(client)
            stored = await upload(client, shop_id, PNG, name)
            errors = [
                (await upload(client, shop_id, GIF, name)).text,
                (await upload(client, str(uuid4()), PNG, name)).text,
            ]

    logged = "\n".join(
        f"{record.getMessage()} {record.args!r} {getattr(record, '__dict__', {})!r}"
        for record in caplog.records
    )
    traced = json.dumps(
        [
            {"name": span.name, "attributes": dict(span.attributes or {})}
            for span in exporter.get_finished_spans()
        ]
    )
    assert digest(PNG) in logged
    assert name not in logged
    assert name not in traced
    # The image's own answer names it — that is what the label is for — and no refusal does.
    assert stored.json()["file_name"] == name
    for body in errors:
        assert name not in body


async def test_a_written_reference_is_refused_on_write_with_its_path(
    client: AsyncClient, tmp_path: Path
) -> None:
    shop_id = await make_shop(client)
    held = (await upload(client, shop_id, PNG)).json()

    refused = await draft_with_media(
        client,
        shop_id,
        [
            {"reference": held["reference"], "alt_text": "Ocean Blue, front"},
            {"reference": "media/alpine-ocean.jpg", "alt_text": "Written"},
            {"reference": f"asset:sha256:{digest(JPEG)}", "alt_text": "Never uploaded"},
        ],
    )

    assert refused.status_code == 422
    body = refused.json()
    assert body["code"] == "media_not_uploaded"
    assert [detail["location"] for detail in body["details"]] == [
        "products.alpine-shell-jacket.media.media/alpine-ocean.jpg",
        f"products.alpine-shell-jacket.media.asset:sha256:{digest(JPEG)}",
    ]
    assert {detail["type"] for detail in body["details"]} == {"media_not_uploaded"}

    accepted = await draft_with_media(
        client, shop_id, [{"reference": held["reference"], "alt_text": "Ocean Blue, front"}]
    )
    assert accepted.status_code == 200, accepted.text


async def test_a_written_reference_the_stored_draft_held_is_refused_all_the_same(
    client: AsyncClient, tmp_path: Path
) -> None:
    shop_id = await make_shop(client)
    store_written_reference(tmp_path, shop_id, "media/alpine-ocean.jpg")
    stored = (await client.get(f"/api/v1/shops/{shop_id}/draft")).json()["content"]
    assert stored["products"][0]["media"] == [
        {"reference": "media/alpine-ocean.jpg", "alt_text": "Front"}
    ]

    resent = await draft_with_media(client, shop_id, stored["products"][0]["media"])

    assert resent.status_code == 422
    assert resent.json()["code"] == "media_not_uploaded"


async def test_the_gate_holds_a_draft_whose_media_the_shop_does_not_hold(
    client: AsyncClient, tmp_path: Path
) -> None:
    shop_id = await make_shop(client)
    store_written_reference(tmp_path, shop_id, "media/alpine-ocean.jpg")
    path = "products.alpine-shell-jacket.media.media/alpine-ocean.jpg"

    preview = (await client.get(f"/api/v1/shops/{shop_id}/draft/preview")).json()
    refused = await client.post(f"/api/v1/shops/{shop_id}/versions")

    expected = {
        "severity": "error",
        "code": "media_asset_missing",
        "message": "product Alpine Shell Jacket names an image this shop does not hold",
        "path": path,
    }
    assert preview["publishable"] is False
    assert expected in preview["issues"]
    assert refused.status_code == 422
    assert expected in refused.json()["issues"]
    # `product_without_media` stays a warning, and is not raised for a product that has media.
    assert "product_without_media" not in {issue["code"] for issue in preview["issues"]}


async def test_a_product_without_an_image_still_publishes_with_a_warning(
    client: AsyncClient,
) -> None:
    shop_id = await make_shop(client)

    preview = (await client.get(f"/api/v1/shops/{shop_id}/draft/preview")).json()

    assert preview["publishable"] is True
    assert {
        "severity": "warning",
        "code": "product_without_media",
        "message": "product Alpine Shell Jacket has no image",
        "path": "products.alpine-shell-jacket",
    } in preview["issues"]


async def test_an_uploaded_image_publishes_and_the_version_holds_its_reference(
    client: AsyncClient,
) -> None:
    shop_id = await make_shop(client)
    held = (await upload(client, shop_id, PNG)).json()
    saved = await draft_with_media(
        client, shop_id, [{"reference": held["reference"], "alt_text": "Ocean Blue, front"}]
    )
    assert saved.status_code == 200, saved.text

    published = await client.post(f"/api/v1/shops/{shop_id}/versions")

    assert published.status_code == 201, published.text
    media = published.json()["content"]["products"][0]["media"]
    assert media == [{"reference": f"asset:sha256:{digest(PNG)}", "alt_text": "Ocean Blue, front"}]


async def test_a_length_that_is_not_ascii_digits_is_refused_411_not_500(
    tmp_path: Path,
) -> None:
    """`"²".isdigit()` is true and `int("²")` raises: the header is read as ASCII digits only.

    Sent as raw ASGI, because an HTTP client refuses to put a non-ASCII byte in a header; a
    server reading Latin-1 header bytes hands the application exactly this string.
    """
    engine = create_database_engine(f"sqlite:///{tmp_path / DATABASE}")
    Base.metadata.create_all(engine)
    settings = get_settings().model_copy(update={"media_root": media_root(tmp_path)})
    application = create_app(settings, session_factory=create_session_factory(engine))
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://lab.test"
    ) as client:
        shop_id = await make_shop(client)
    sent: list[Message] = []

    async def receive() -> Message:
        return {"type": "http.request", "body": b"x", "more_body": False}

    async def send(message: Message) -> None:
        sent.append(message)

    await application(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": f"/api/v1/shops/{shop_id}/media",
            "raw_path": f"/api/v1/shops/{shop_id}/media".encode(),
            "query_string": b"",
            "root_path": "",
            "headers": [
                (b"host", b"lab.test"),
                (b"content-type", b"multipart/form-data; boundary=b"),
                (b"content-length", "²".encode("latin-1")),
            ],
            "client": ("127.0.0.1", 1),
            "server": ("lab.test", 80),
        },
        receive,
        send,
    )

    start = next(message for message in sent if message["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    assert start["status"] == 411
    assert json.loads(body)["code"] == "length_required"


async def test_a_lost_file_is_restored_by_uploading_the_same_bytes_again(
    client: AsyncClient, tmp_path: Path
) -> None:
    shop_id = await make_shop(client)
    await upload(client, shop_id, PNG)
    stored = media_root(tmp_path) / "shops" / shop_id / digest(PNG)
    stored.unlink()
    assert (await client.get(f"/api/v1/shops/{shop_id}/media/{digest(PNG)}")).status_code == 404

    again = await upload(client, shop_id, PNG, "another-name.png")

    assert again.status_code == 200
    assert again.json()["file_name"] == "ocean-blue-front.png"
    assert stored.read_bytes() == PNG
    assert (await client.get(f"/api/v1/shops/{shop_id}/media/{digest(PNG)}")).content == PNG


async def test_a_store_that_fails_leaves_no_claim(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The row is claimed before the bytes are written; a failed write rolls the claim back."""

    def full_disk(*_args: object) -> None:
        raise OSError(28, "No space left on device")

    async with api_client(tmp_path, DATABASE, raise_app_exceptions=False) as client:
        shop_id = await make_shop(client)
        monkeypatch.setattr(FilesystemMediaStore, "put", full_disk)

        failed = await upload(client, shop_id, PNG)

        assert failed.status_code == 500
        monkeypatch.undo()
        assert (await client.get(f"/api/v1/shops/{shop_id}/media")).json() == {"media": []}
        assert (await client.get(f"/api/v1/shops/{shop_id}/media/{digest(PNG)}")).status_code == 404


async def test_the_upload_commits_before_it_answers(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A commit that fails is the upload's failure, never a 201 for a claim that was lost.

    The media routes take their session with `Depends(..., scope="function")`, which exits the
    dependency — and so commits — before the response is sent. Under the default request scope
    the 201 would already be on the wire when the commit failed.
    """

    def failing_commit(_session: Session) -> None:
        raise OperationalError("COMMIT", {}, Exception("disk I/O error"))

    async with api_client(tmp_path, DATABASE, raise_app_exceptions=False) as client:
        shop_id = await make_shop(client)
        monkeypatch.setattr(Session, "commit", failing_commit)

        answered = await upload(client, shop_id, PNG)
        monkeypatch.undo()

        assert answered.status_code == 500
        assert (await client.get(f"/api/v1/shops/{shop_id}/media")).json() == {"media": []}


async def test_a_published_version_holding_a_written_reference_still_reads(
    client: AsyncClient, tmp_path: Path
) -> None:
    """A version is immutable: the write rule narrows drafts and never what a version holds."""
    shop_id = await make_shop(client)
    engine = create_database_engine(f"sqlite:///{tmp_path / DATABASE}")
    with session_scope(create_session_factory(engine)) as session:
        repository = shop_repository(session)
        definition = DefinitionId(definition_type=DefinitionType.SHOP, id=UUID(shop_id))
        record = repository.get_draft(definition)
        assert record is not None
        written = (MediaReference(reference="media/alpine-ocean.jpg", alt_text="Front"),)
        payload = replace(
            record.payload,
            products=(replace(record.payload.products[0], media=written),),
        )
        repository.save_version(
            DefinitionVersionRecord(
                published=publish_draft(
                    record.draft,
                    latest_published_version=None,
                    pinned_scope=None,
                    pinned_references=(),
                    content_fingerprint=shop_content_fingerprint(payload),
                    published_at=datetime(2026, 9, 1, 12, 0, tzinfo=UTC),
                ),
                payload=payload,
            )
        )
    engine.dispose()

    read = await client.get(f"/api/v1/shops/{shop_id}/versions/1")

    assert read.status_code == 200, read.text
    assert read.json()["content"]["products"][0]["media"] == [
        {"reference": "media/alpine-ocean.jpg", "alt_text": "Front"}
    ]
