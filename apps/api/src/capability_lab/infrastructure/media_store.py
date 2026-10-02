"""The filesystem behind `MediaStore`: a shop's images under `{root}/shops/{shop_id}/{sha256}`.

A file is written once and never rewritten (ADR 0076). The bytes go to a temporary file in the
shop's own directory and are then hard-linked to the hash's name: `os.link` refuses a name that
already exists, so an existing file is kept exactly as it was, where `os.replace` would swap
it. The temporary file is unlinked either way, and nothing ever reads a half-written image under
its hash.
"""

from __future__ import annotations

import contextlib
import os
import shutil
import tempfile
from pathlib import Path
from uuid import UUID

from capability_lab.domain.shop import is_sha256_hex


class MalformedMediaHashError(ValueError):
    """Raised before any path is built from a hash that is not 64 lowercase hex digits."""


class FilesystemMediaStore:
    def __init__(self, root: Path) -> None:
        self._root = root

    def _directory(self, shop_id: UUID) -> Path:
        # A `UUID` renders as hex and hyphens only, so it can name nothing but one directory.
        return self._root / "shops" / str(UUID(str(shop_id)))

    def _path(self, shop_id: UUID, sha256: str) -> Path:
        if not is_sha256_hex(sha256):
            raise MalformedMediaHashError("a media hash must be 64 lowercase hexadecimal digits")
        return self._directory(shop_id) / sha256

    def put(self, shop_id: UUID, sha256: str, content: bytes) -> None:
        target = self._path(shop_id, sha256)
        target.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(dir=target.parent, prefix=".upload-")
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            # Same hash, same bytes: a file already there is the one every version naming it
            # was frozen with, so `link` refusing the name is the outcome, not a failure.
            with contextlib.suppress(FileExistsError):
                os.link(temporary, target)
        finally:
            os.unlink(temporary)

    def open(self, shop_id: UUID, sha256: str) -> bytes | None:
        path = self._path(shop_id, sha256)
        try:
            return path.read_bytes()
        except FileNotFoundError:
            return None

    def remove_shop(self, shop_id: UUID) -> None:
        directory = self._directory(shop_id)
        if directory.exists():
            shutil.rmtree(directory)
