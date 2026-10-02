"""The shop's images, over in-memory ports: what an upload accepts, keeps and logs (ADR 0076)."""

import hashlib
import io
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from capability_lab.application.shop_media import (
    MediaClaim,
    MediaTooLargeError,
    MediaType,
    MediaTypeUnsupportedError,
    ShopMediaAsset,
    ShopMediaNotFoundError,
    ShopMediaService,
    clean_file_name,
    describe_byte_size,
    media_type_of,
)
from capability_lab.application.shops import ShopNotFoundError

MAX_BYTES = 5 * 1024 * 1024

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR"
JPEG = b"\xff\xd8\xff\xe0" + b"\x00\x10JFIF"
WEBP = b"RIFF" + b"\x24\x00\x00\x00" + b"WEBPVP8 "
GIF = b"GIF89a" + b"\x01\x00\x01\x00"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
TEXT = b"just some words, not an image"


@dataclass(slots=True)
class AdvancingClock:
    value: datetime = datetime(2026, 10, 2, 9, 0, tzinfo=UTC)

    def now(self) -> datetime:
        self.value += timedelta(seconds=1)
        return self.value


@dataclass(slots=True)
class MemoryMediaRepository:
    """The port as SQL answers it: a row per shop and hash, claimed only while a draft stands."""

    drafts: set[UUID] = field(default_factory=set[UUID])
    rows: dict[tuple[UUID, str], ShopMediaAsset] = field(
        default_factory=dict[tuple[UUID, str], ShopMediaAsset]
    )

    def insert(self, asset: ShopMediaAsset) -> MediaClaim | None:
        if asset.shop_id not in self.drafts:
            return None
        key = (asset.shop_id, asset.sha256)
        if key in self.rows:
            return MediaClaim(asset=self.rows[key], inserted=False)
        self.rows[key] = asset
        return MediaClaim(asset=asset, inserted=True)

    def list_for_shop(self, shop_id: UUID) -> tuple[ShopMediaAsset, ...]:
        held = [asset for (shop, _), asset in self.rows.items() if shop == shop_id]
        return tuple(sorted(held, key=lambda asset: asset.created_at, reverse=True))

    def get(self, shop_id: UUID, sha256: str) -> ShopMediaAsset | None:
        return self.rows.get((shop_id, sha256))


@dataclass(slots=True)
class MemoryMediaStore:
    files: dict[tuple[UUID, str], bytes] = field(default_factory=dict[tuple[UUID, str], bytes])
    puts: int = 0

    def put(self, shop_id: UUID, sha256: str, content: bytes) -> None:
        self.puts += 1
        self.files.setdefault((shop_id, sha256), content)

    def open(self, shop_id: UUID, sha256: str) -> bytes | None:
        return self.files.get((shop_id, sha256))

    def remove_shop(self, shop_id: UUID) -> None:
        for key in [key for key in self.files if key[0] == shop_id]:
            del self.files[key]


@dataclass(slots=True)
class MemoryShopDirectory:
    repository: MemoryMediaRepository

    def exists(self, shop_id: UUID) -> bool:
        return shop_id in self.repository.drafts


@dataclass(slots=True)
class Lab:
    service: ShopMediaService
    repository: MemoryMediaRepository
    store: MemoryMediaStore
    shop_id: UUID


@pytest.fixture
def lab() -> Lab:
    repository = MemoryMediaRepository()
    store = MemoryMediaStore()
    shop_id = uuid4()
    repository.drafts.add(shop_id)
    service = ShopMediaService(
        repository, store, MemoryShopDirectory(repository), AdvancingClock(), max_bytes=MAX_BYTES
    )
    return Lab(service=service, repository=repository, store=store, shop_id=shop_id)


def upload(lab: Lab, content: bytes, name: str | None = "ocean-blue-front.png"):
    return lab.service.upload(lab.shop_id, name, io.BytesIO(content))


@pytest.mark.parametrize(
    ("content", "media_type"),
    [(PNG, MediaType.PNG), (JPEG, MediaType.JPEG), (WEBP, MediaType.WEBP)],
)
def test_each_type_is_told_by_its_first_bytes(
    lab: Lab, content: bytes, media_type: MediaType
) -> None:
    stored = upload(lab, content, "picture")

    assert stored.created
    assert stored.asset.content_type is media_type
    assert stored.asset.sha256 == hashlib.sha256(content).hexdigest()
    assert stored.asset.reference == f"asset:sha256:{stored.asset.sha256}"
    assert stored.asset.byte_size == len(content)
    assert lab.store.files[(lab.shop_id, stored.asset.sha256)] == content


def test_the_name_says_nothing_about_the_type(lab: Lab) -> None:
    """A PNG named `.gif` is a PNG; the bytes decide, and the label is kept as given."""
    stored = upload(lab, PNG, "not-really.gif")

    assert stored.asset.content_type is MediaType.PNG
    assert stored.asset.file_name == "not-really.gif"


@pytest.mark.parametrize("content", [GIF, SVG, TEXT, b"", b"RIFF\x00\x00\x00\x00WAVE"])
def test_anything_but_png_jpeg_and_webp_is_refused(lab: Lab, content: bytes) -> None:
    with pytest.raises(MediaTypeUnsupportedError):
        upload(lab, content, "image.png")

    assert lab.repository.rows == {}
    assert lab.store.files == {}


def test_exactly_the_cap_is_accepted_and_one_byte_more_refused(lab: Lab) -> None:
    at_cap = PNG + b"\x00" * (MAX_BYTES - len(PNG))
    assert len(at_cap) == MAX_BYTES

    assert upload(lab, at_cap).asset.byte_size == MAX_BYTES

    with pytest.raises(MediaTooLargeError):
        upload(lab, at_cap + b"\x00")
    assert len(lab.repository.rows) == 1


def test_a_stream_past_the_cap_is_read_no_further_than_one_byte_beyond_it(lab: Lab) -> None:
    """The service counts what it reads, so a stream larger than its declared length is cut."""
    stream = io.BytesIO(PNG + b"\x00" * (MAX_BYTES * 3))

    with pytest.raises(MediaTooLargeError):
        lab.service.upload(lab.shop_id, "huge.png", stream)

    assert stream.tell() == MAX_BYTES + 1


def test_the_same_bytes_twice_are_one_image_under_the_first_file_name(lab: Lab) -> None:
    first = upload(lab, PNG, "ocean-blue-front.png")
    second = upload(lab, PNG, "renamed-copy.png")

    assert first.created
    assert not second.created
    assert second.asset == first.asset
    assert second.asset.file_name == "ocean-blue-front.png"
    assert lab.service.list(lab.shop_id) == (first.asset,)


def test_an_unknown_shop_is_refused_and_nothing_is_written(lab: Lab) -> None:
    stranger = uuid4()

    with pytest.raises(ShopNotFoundError):
        lab.service.upload(stranger, "ocean.png", io.BytesIO(PNG))
    with pytest.raises(ShopNotFoundError):
        lab.service.list(stranger)

    assert lab.store.files == {}
    assert lab.store.puts == 0


@pytest.mark.parametrize(
    ("raw", "cleaned"),
    [
        ("C:\\Users\\olivier\\Pictures\\ocean-blue-front.png", "ocean-blue-front.png"),
        ("/home/olivier/../../etc/ocean.png", "ocean.png"),
        ("ocean\x00blue\x07.png", "oceanblue.png"),
        ("ocean\u202egnp.exe", "oceangnp.exe"),
        ("  padded name.png  ", "padded name.png"),
        ("x" * 250 + ".png", "x" * 200),
        ("", "image.png"),
        (None, "image.png"),
        ("photos/", "image.png"),
        ("..", "image.png"),
        ("\x01\x02", "image.png"),
        ("ocean\u2028blue\u2029.png", "oceanblue.png"),
    ],
)
def test_a_file_name_is_cleaned_into_a_label(raw: str | None, cleaned: str) -> None:
    assert clean_file_name(raw, MediaType.PNG) == cleaned


def test_an_empty_name_takes_the_extension_of_the_type_the_bytes_say(lab: Lab) -> None:
    assert upload(lab, JPEG, "").asset.file_name == "image.jpg"
    assert upload(lab, WEBP, None).asset.file_name == "image.webp"


def test_nothing_is_logged_but_the_hash_the_type_and_the_size(
    lab: Lab, caplog: pytest.LogCaptureFixture
) -> None:
    name = "private-holiday-photo-of-camille.png"
    with caplog.at_level(logging.DEBUG):
        stored = upload(lab, PNG, name)

    records = [record for record in caplog.records if record.name.startswith("capability_lab")]
    assert records, "the upload logged nothing at all"
    text = " ".join(record.getMessage() for record in records)
    assert stored.asset.sha256 in text
    assert "image/png" in text
    assert str(len(PNG)) in text
    assert "camille" not in text
    assert name not in text
    for record in records:
        assert name not in repr(record.__dict__)


def test_an_image_is_listed_newest_first_and_opened_only_by_the_shop_that_holds_it(
    lab: Lab,
) -> None:
    older = upload(lab, PNG).asset
    newer = upload(lab, JPEG).asset

    assert lab.service.list(lab.shop_id) == (newer, older)
    assert lab.service.open(lab.shop_id, older.sha256).content == PNG

    other_shop = uuid4()
    lab.repository.drafts.add(other_shop)
    with pytest.raises(ShopMediaNotFoundError):
        lab.service.open(other_shop, older.sha256)
    with pytest.raises(ShopMediaNotFoundError):
        lab.service.open(lab.shop_id, "not-a-hash")


def test_a_file_no_row_claims_is_never_served(lab: Lab) -> None:
    """Serving reads the row first: bytes in the store with no claim on them answer nothing."""
    sha256 = hashlib.sha256(PNG).hexdigest()
    lab.store.files[(lab.shop_id, sha256)] = PNG

    with pytest.raises(ShopMediaNotFoundError):
        lab.service.open(lab.shop_id, sha256)


def test_the_first_bytes_alone_decide() -> None:
    assert media_type_of(PNG) is MediaType.PNG
    assert media_type_of(b"\x89PNG\r\n\x1a") is None  # one byte short of the signature
    assert media_type_of(b"RIFF\x00\x00\x00\x00WEB") is None


def test_the_cap_is_said_as_an_operator_reads_it(lab: Lab) -> None:
    with pytest.raises(MediaTooLargeError) as refused:
        upload(lab, PNG + b"\x00" * MAX_BYTES)

    assert str(refused.value) == "an image can be at most 5 MiB"
    assert describe_byte_size(64 * 1024) == "64 KiB"
    assert describe_byte_size(1000) == "1000 bytes"


@dataclass(slots=True)
class FrozenClock:
    value: datetime = datetime(2026, 10, 2, 9, 0, tzinfo=UTC)

    def now(self) -> datetime:
        return self.value


def test_a_repeat_is_told_by_the_claim_not_by_a_moved_clock() -> None:
    """Same bytes, same name, same instant: the second upload is still not a creation."""
    repository = MemoryMediaRepository()
    shop_id = uuid4()
    repository.drafts.add(shop_id)
    service = ShopMediaService(
        repository,
        MemoryMediaStore(),
        MemoryShopDirectory(repository),
        FrozenClock(),
        max_bytes=MAX_BYTES,
    )

    first = service.upload(shop_id, "ocean.png", io.BytesIO(PNG))
    second = service.upload(shop_id, "ocean.png", io.BytesIO(PNG))

    assert first.created
    assert second.asset == first.asset
    assert not second.created


def test_a_repeat_writes_the_bytes_again_and_restores_a_lost_file(lab: Lab) -> None:
    """The store is written on every upload, so a held row's bytes are there when it answers."""
    first = upload(lab, PNG)
    upload(lab, PNG)
    assert lab.store.puts == 2

    del lab.store.files[(lab.shop_id, first.asset.sha256)]
    again = upload(lab, PNG)

    assert not again.created
    assert lab.store.files[(lab.shop_id, first.asset.sha256)] == PNG
    assert lab.service.open(lab.shop_id, first.asset.sha256).content == PNG
