"""A product's images as files the shop holds (ADR 0076).

An image is uploaded once per shop and stored under the SHA-256 of its bytes, so the same
bytes uploaded twice are one image and a published version naming `asset:sha256:<hex>` keeps
the exact bytes it was frozen with. Two ports carry it: `MediaStore` holds the bytes and
`ShopMediaRepository` holds the shop's claim on them, one row per shop and hash. Serving reads
the row first, so a file no row claims is never served.

Nothing here knows about HTTP, SQL or a filesystem: the route hands over a stream and a file
name, and composition chooses where the bytes go.
"""

from __future__ import annotations

import hashlib
import logging
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from capability_lab.application.customer_profiles import ShopDirectory
from capability_lab.application.ports import Clock
from capability_lab.application.shops import ShopNotFoundError
from capability_lab.domain.content import MAX_LABEL_LENGTH
from capability_lab.domain.shop import MediaAssetReference, is_sha256_hex

_logger = logging.getLogger(__name__)

# Read in pieces rather than at once, so a stream longer than the cap is never read whole.
_READ_CHUNK = 64 * 1024


class MediaType(StrEnum):
    """The three image types the lab stores, told by their first bytes and nothing else."""

    PNG = "image/png"
    JPEG = "image/jpeg"
    WEBP = "image/webp"

    @property
    def extension(self) -> str:
        return _EXTENSIONS[self]


_EXTENSIONS: dict[MediaType, str] = {
    MediaType.PNG: "png",
    MediaType.JPEG: "jpg",
    MediaType.WEBP: "webp",
}

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_JPEG_SIGNATURE = b"\xff\xd8\xff"


def media_type_of(content: bytes) -> MediaType | None:
    """The type the first bytes say, or none. The file name and the declared type are not read.

    SVG and GIF are refused by having no signature here: an SVG is a document that can carry
    script, and a GIF is neither a photograph's format nor a drawing's any longer.
    """
    if content.startswith(_PNG_SIGNATURE):
        return MediaType.PNG
    if content.startswith(_JPEG_SIGNATURE):
        return MediaType.JPEG
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return MediaType.WEBP
    return None


# Control and format characters, and the line and paragraph separators U+2028 and U+2029.
_STRIPPED_CATEGORIES = frozenset({"Cc", "Cf", "Zl", "Zp"})


def clean_file_name(raw: str | None, media_type: MediaType) -> str:
    """The original file name as a label for display, never as a path.

    The last path component only, whichever separator the sending system used; control and
    format characters and the line and paragraph separators stripped (a right-to-left override
    would make `gpj.exe` read as `exe.jpg`, and U+2028 would break a label onto two lines);
    outer whitespace stripped; capped at a label's length. A name left empty — or
    one that is only `.` or `..` — becomes `image.{ext}`.
    """
    name = (raw or "").replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(
        character
        for character in name
        if unicodedata.category(character) not in _STRIPPED_CATEGORIES
    )
    name = name.strip()[:MAX_LABEL_LENGTH].strip()
    if name in {"", ".", ".."}:
        return f"image.{media_type.extension}"
    return name


@dataclass(frozen=True, slots=True)
class ShopMediaAsset:
    """One image a shop holds: its claim on the bytes stored under `sha256`."""

    shop_id: UUID
    sha256: str
    content_type: MediaType
    byte_size: int
    file_name: str
    created_at: datetime

    @property
    def reference(self) -> str:
        return MediaAssetReference(self.sha256).reference


@dataclass(frozen=True, slots=True)
class MediaClaim:
    """The row a shop holds under one hash after an insert, and whether this insert made it."""

    asset: ShopMediaAsset
    inserted: bool


@dataclass(frozen=True, slots=True)
class StoredMedia:
    """What an upload answers: the image the shop holds, and whether this upload added it."""

    asset: ShopMediaAsset
    created: bool


@dataclass(frozen=True, slots=True)
class MediaContent:
    """An image's bytes with the type they were stored as."""

    asset: ShopMediaAsset
    content: bytes


class ReadableStream(Protocol):
    def read(self, size: int = -1, /) -> bytes: ...


class MediaStore(Protocol):
    """Where an image's bytes live, by shop and hash, written once and never overwritten."""

    def put(self, shop_id: UUID, sha256: str, content: bytes) -> None:
        """Store the bytes under their hash; an existing file is kept and never rewritten."""
        ...

    def open(self, shop_id: UUID, sha256: str) -> bytes | None: ...

    def remove_shop(self, shop_id: UUID) -> None:
        """Remove a shop's directory and every file in it."""
        ...


class ShopMediaRepository(Protocol):
    """The shop's claim on its images, one row per shop and hash."""

    def insert(self, asset: ShopMediaAsset) -> MediaClaim | None:
        """Claim the image while the shop's draft stands.

        Answers the row the shop now holds under that hash — this one, inserted, or the one
        already there, which keeps its first file name — and none when the shop has no draft.
        """
        ...

    def list_for_shop(self, shop_id: UUID) -> tuple[ShopMediaAsset, ...]:
        """Newest first."""
        ...

    def get(self, shop_id: UUID, sha256: str) -> ShopMediaAsset | None: ...


def describe_byte_size(size: int) -> str:
    """A cap as an operator reads it: whole mebibytes or kibibytes where it is one, else bytes."""
    if size % (1024 * 1024) == 0:
        return f"{size // (1024 * 1024)} MiB"
    if size % 1024 == 0:
        return f"{size // 1024} KiB"
    return f"{size} bytes"


def media_too_large_message(max_bytes: int) -> str:
    return f"an image can be at most {describe_byte_size(max_bytes)}"


class MediaTooLargeError(ValueError):
    """Raised when an upload holds more bytes than the lab stores for one image."""

    def __init__(self, max_bytes: int) -> None:
        super().__init__(media_too_large_message(max_bytes))
        self.max_bytes = max_bytes


class MediaTypeUnsupportedError(ValueError):
    """Raised when the first bytes are not a PNG, a JPEG or a WebP image."""

    def __init__(self) -> None:
        super().__init__("an image must be a PNG, a JPEG or a WebP file")


class ShopMediaNotFoundError(LookupError):
    """Raised when a shop does not hold the image asked for."""


class ShopMediaService:
    def __init__(
        self,
        repository: ShopMediaRepository,
        store: MediaStore,
        shops: ShopDirectory,
        clock: Clock,
        *,
        max_bytes: int,
    ) -> None:
        self._repository = repository
        self._shops = shops
        self._store = store
        self._clock = clock
        self._max_bytes = max_bytes

    @property
    def max_bytes(self) -> int:
        return self._max_bytes

    def upload(self, shop_id: UUID, file_name: str | None, stream: ReadableStream) -> StoredMedia:
        """Store an image for a shop, once per hash.

        The hash is the upload's idempotency key: the same bytes sent again answer the image
        already held, under the file name of the first upload. The row is claimed before the
        bytes are written, so an unknown shop writes nothing; a write that fails after the
        claim rolls the claim back with the request's transaction.
        """
        content = self._read_capped(stream)
        media_type = media_type_of(content)
        if media_type is None:
            raise MediaTypeUnsupportedError()
        sha256 = hashlib.sha256(content).hexdigest()
        candidate = ShopMediaAsset(
            shop_id=shop_id,
            sha256=sha256,
            content_type=media_type,
            byte_size=len(content),
            file_name=clean_file_name(file_name, media_type),
            created_at=self._clock.now(),
        )
        claim = self._repository.insert(candidate)
        if claim is None:
            raise ShopNotFoundError(f"shop {shop_id} has no draft")
        # Written whether the row is new or not: the store never overwrites, so a repeat
        # costs one temporary file and guarantees the bytes a held row names are there.
        self._store.put(shop_id, sha256, content)
        # The hash, the type and the size, and never the file name or a byte of content.
        _logger.info(
            "stored shop image sha256=%s content_type=%s byte_size=%d",
            sha256,
            media_type.value,
            len(content),
        )
        return StoredMedia(asset=claim.asset, created=claim.inserted)

    def list(self, shop_id: UUID) -> tuple[ShopMediaAsset, ...]:
        if not self._shops.exists(shop_id):
            raise ShopNotFoundError(f"shop {shop_id} has no draft")
        return self._repository.list_for_shop(shop_id)

    def open(self, shop_id: UUID, sha256: str) -> MediaContent:
        """The bytes of an image this shop holds; a malformed hash or a stranger's is unknown."""
        if not is_sha256_hex(sha256):
            raise ShopMediaNotFoundError("no such image")
        asset = self._repository.get(shop_id, sha256)
        if asset is None:
            raise ShopMediaNotFoundError("this shop holds no such image")
        content = self._store.open(shop_id, sha256)
        if content is None:
            raise ShopMediaNotFoundError("this shop holds no such image")
        return MediaContent(asset=asset, content=content)

    def _read_capped(self, stream: ReadableStream) -> bytes:
        """Read at most the cap and one byte more, and refuse what reaches past the cap."""
        limit = self._max_bytes + 1
        chunks: list[bytes] = []
        size = 0
        while size < limit:
            chunk = stream.read(min(_READ_CHUNK, limit - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
        if size > self._max_bytes:
            raise MediaTooLargeError(self._max_bytes)
        return b"".join(chunks)
