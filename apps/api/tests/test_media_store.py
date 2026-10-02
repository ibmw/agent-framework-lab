"""The filesystem behind `MediaStore`: written once under the hash, never rewritten (ADR 0076)."""

import hashlib
import os
from pathlib import Path
from uuid import uuid4

import pytest

from capability_lab.infrastructure.media_store import (
    FilesystemMediaStore,
    MalformedMediaHashError,
)

PNG = b"\x89PNG\r\n\x1a\n" + b"pixels"


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def test_the_bytes_are_linked_into_place_under_the_shop_and_the_hash(tmp_path: Path) -> None:
    store = FilesystemMediaStore(tmp_path)
    shop_id = uuid4()

    store.put(shop_id, digest(PNG), PNG)

    directory = tmp_path / "shops" / str(shop_id)
    assert (directory / digest(PNG)).read_bytes() == PNG
    # The temporary file it was written through is gone: the directory holds the image only.
    assert sorted(path.name for path in directory.iterdir()) == [digest(PNG)]
    assert store.open(shop_id, digest(PNG)) == PNG


def test_an_existing_file_is_kept_and_never_rewritten(tmp_path: Path) -> None:
    """`os.link` refuses a name that exists, so a second put cannot swap the file.

    The second write carries other bytes under the same name — which a content-addressed store
    should never see — precisely so that a store that overwrote would be caught: the inode and
    the bytes are the first write's.
    """
    store = FilesystemMediaStore(tmp_path)
    shop_id = uuid4()
    sha256 = digest(PNG)
    store.put(shop_id, sha256, PNG)
    target = tmp_path / "shops" / str(shop_id) / sha256
    first = os.stat(target)

    store.put(shop_id, sha256, b"other bytes entirely")

    again = os.stat(target)
    assert target.read_bytes() == PNG
    assert (again.st_ino, again.st_mtime_ns) == (first.st_ino, first.st_mtime_ns)
    assert sorted(path.name for path in target.parent.iterdir()) == [sha256]


@pytest.mark.parametrize(
    "sha256",
    [
        "../../etc/passwd",
        "A" * 64,
        "a" * 63,
        "a" * 65,
        "",
        "g" * 64,
        f"{'a' * 63}/",
    ],
)
def test_a_malformed_hash_is_refused_before_a_path_is_built(tmp_path: Path, sha256: str) -> None:
    store = FilesystemMediaStore(tmp_path)
    shop_id = uuid4()

    with pytest.raises(MalformedMediaHashError):
        store.put(shop_id, sha256, PNG)
    with pytest.raises(MalformedMediaHashError):
        store.open(shop_id, sha256)

    # Refused before anything was made: not even the shop's directory exists.
    assert not (tmp_path / "shops").exists()


def test_an_image_never_stored_reads_as_nothing(tmp_path: Path) -> None:
    assert FilesystemMediaStore(tmp_path).open(uuid4(), digest(PNG)) is None


def test_removing_a_shop_takes_its_directory_and_leaves_the_others(tmp_path: Path) -> None:
    store = FilesystemMediaStore(tmp_path)
    kept, removed = uuid4(), uuid4()
    store.put(kept, digest(PNG), PNG)
    store.put(removed, digest(PNG), PNG)

    store.remove_shop(removed)
    store.remove_shop(uuid4())  # a shop with no directory is nothing to remove

    assert not (tmp_path / "shops" / str(removed)).exists()
    assert store.open(kept, digest(PNG)) == PNG
