from __future__ import annotations

import json
import unicodedata
from datetime import datetime, timedelta
from hashlib import sha256
from typing import cast

type CanonicalValue = bool | int | str | list[CanonicalValue] | dict[str, CanonicalValue] | None


class CanonicalSerializationError(ValueError):
    """Raised when state cannot be represented by the pinned canonical schema."""


def canonical_timestamp(value: datetime) -> str:
    if value.utcoffset() != timedelta(0):
        raise CanonicalSerializationError("canonical timestamps must be timezone-aware UTC")
    return value.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def normalize_canonical_value(value: object) -> CanonicalValue:
    if isinstance(value, str):
        return unicodedata.normalize("NFC", value)
    if value is None or isinstance(value, bool | int):
        return value
    if isinstance(value, list):
        return [normalize_canonical_value(item) for item in cast("list[object]", value)]
    if isinstance(value, dict):
        normalized: dict[str, CanonicalValue] = {}
        for key, item in cast("dict[object, object]", value).items():
            if not isinstance(key, str):
                raise CanonicalSerializationError("canonical object keys must be strings")
            normalized_key = unicodedata.normalize("NFC", key)
            if normalized_key in normalized:
                raise CanonicalSerializationError(
                    "canonical object keys must be unique after NFC normalization"
                )
            normalized[normalized_key] = normalize_canonical_value(item)
        return normalized
    # ADR 0007 forbids binary floats and any value outside the canonical union.
    raise CanonicalSerializationError(
        f"canonical state cannot contain {type(value).__name__} values"
    )


def canonical_json_bytes(payload: dict[str, CanonicalValue]) -> bytes:
    normalized = normalize_canonical_value(payload)
    return json.dumps(
        normalized,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def canonical_sha256(canonical_json: bytes) -> str:
    return sha256(canonical_json).hexdigest()
