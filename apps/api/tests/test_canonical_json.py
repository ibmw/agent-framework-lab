from datetime import UTC, datetime
from decimal import Decimal

import pytest

from capability_lab.application.canonical_json import (
    CanonicalSerializationError,
    canonical_json_bytes,
    normalize_canonical_value,
)


@pytest.mark.parametrize(
    "value",
    [1.5, Decimal("1.50"), datetime(2026, 8, 23, tzinfo=UTC), {1, 2}, object()],
    ids=["float", "decimal", "datetime", "set", "object"],
)
def test_values_outside_the_canonical_union_are_rejected(value: object) -> None:
    with pytest.raises(CanonicalSerializationError, match="cannot contain"):
        normalize_canonical_value(value)


def test_nested_unsupported_values_are_rejected() -> None:
    with pytest.raises(CanonicalSerializationError, match="cannot contain float"):
        normalize_canonical_value({"state": {"total": 1.5}})
    with pytest.raises(CanonicalSerializationError, match="cannot contain float"):
        normalize_canonical_value(["ok", [0.1]])


def test_object_keys_must_be_strings() -> None:
    with pytest.raises(CanonicalSerializationError, match="keys must be strings"):
        normalize_canonical_value({1: "value"})


def test_object_keys_must_stay_unique_after_nfc_normalization() -> None:
    # U+00E9 and U+0065 U+0301 both normalize to NFC "é".
    with pytest.raises(CanonicalSerializationError, match="unique after NFC"):
        canonical_json_bytes({"café": 1, "café": 2})


def test_strings_normalize_to_nfc_in_values_and_keys() -> None:
    assert canonical_json_bytes({"café": "café"}) == canonical_json_bytes({"café": "café"})
