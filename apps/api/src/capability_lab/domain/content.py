"""Structural text and value rules shared by every authored definition payload.

Each payload module raises its own `DomainError` subtype so the HTTP layer can name the
resource that refused the write. These helpers therefore take the error type as a
keyword argument, and a payload module binds it once with `functools.partial` instead of
restating the same guards.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import date
from decimal import Decimal
from enum import StrEnum
from typing import cast

from capability_lab.domain.entities import DomainError

MAX_TEXT_LENGTH = 4000
MAX_LABEL_LENGTH = 200
MAX_SLUG_LENGTH = 64

_SLUG_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
_LOCALE_PATTERN = re.compile(r"[a-z]{2}(?:-[A-Z]{2})?")
_EMAIL_PATTERN = re.compile(r"[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+")
_PHONE_PATTERN = re.compile(r"\+?[0-9][0-9 ()./-]{4,30}")
_COUNTRY_PATTERN = re.compile(r"[A-Z]{2}")
_DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}")


def require_slug(value: object, field_name: str, *, error: type[DomainError]) -> str:
    if not isinstance(value, str) or _SLUG_PATTERN.fullmatch(value) is None:
        raise error(f"{field_name} must be a lowercase kebab-case identifier")
    if len(value) > MAX_SLUG_LENGTH:
        raise error(f"{field_name} must contain at most {MAX_SLUG_LENGTH} characters")
    return value


def require_label(value: object, field_name: str, *, error: type[DomainError]) -> str:
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        raise error(f"{field_name} must be non-empty text without padding")
    if len(value) > MAX_LABEL_LENGTH:
        raise error(f"{field_name} must contain at most {MAX_LABEL_LENGTH} characters")
    return value


def require_text(
    value: object,
    field_name: str,
    *,
    error: type[DomainError],
    allow_empty: bool = False,
) -> str:
    if not isinstance(value, str) or value != value.strip():
        raise error(f"{field_name} must be text without surrounding whitespace")
    if not allow_empty and not value:
        raise error(f"{field_name} must not be empty")
    if len(value) > MAX_TEXT_LENGTH:
        raise error(f"{field_name} must contain at most {MAX_TEXT_LENGTH} characters")
    return value


def require_unique(values: tuple[str, ...], field_name: str, *, error: type[DomainError]) -> None:
    if len(set(values)) != len(values):
        raise error(f"{field_name} must be unique")


def require_non_negative_int(value: object, field_name: str, *, error: type[DomainError]) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise error(f"{field_name} must be a non-negative integer")
    return value


def require_instance(
    value: object, expected: type, message: str, *, error: type[DomainError]
) -> None:
    """Guard a typed field against callers that bypass static checking."""
    if not isinstance(value, expected):
        raise error(message)


def require_bool(value: object, field_name: str, *, error: type[DomainError]) -> None:
    require_instance(value, bool, f"{field_name} must be a boolean", error=error)


def require_integer_in_range(
    value: object,
    minimum: int,
    maximum: int,
    field_name: str,
    *,
    error: type[DomainError],
) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise error(f"{field_name} must be an integer between {minimum} and {maximum}")


def require_decimal_text(value: str, field_name: str, *, error: type[DomainError]) -> None:
    try:
        parsed = Decimal(value)
    except ArithmeticError as cause:
        raise error(f"{field_name} must be a decimal number") from cause
    if not parsed.is_finite():
        raise error(f"{field_name} must be a finite decimal number")


def require_locale(value: object, field_name: str, *, error: type[DomainError]) -> str:
    if not isinstance(value, str) or _LOCALE_PATTERN.fullmatch(value) is None:
        raise error(f"{field_name} must look like 'en' or 'en-GB'")
    return value


def require_email(value: object, field_name: str, *, error: type[DomainError]) -> str:
    """Accept a fictional address shape without echoing the value into the message."""
    if not isinstance(value, str) or _EMAIL_PATTERN.fullmatch(value) is None:
        raise error(f"{field_name} must be an email address")
    if len(value) > MAX_LABEL_LENGTH:
        raise error(f"{field_name} must contain at most {MAX_LABEL_LENGTH} characters")
    return value


def require_phone(value: object, field_name: str, *, error: type[DomainError]) -> str:
    if not isinstance(value, str) or _PHONE_PATTERN.fullmatch(value) is None:
        raise error(f"{field_name} must be a phone number")
    return value


def require_country_code(value: object, field_name: str, *, error: type[DomainError]) -> str:
    """Check the *shape* of an alpha-2 code, not membership of the ISO 3166-1 register.

    Same trade-off as `require_locale`: the sandbox is synthetic, and a closed country list
    would have to be maintained for no simulation benefit. A real register belongs with the
    first rule that depends on the country meaning something (tax, carrier coverage).
    """
    if not isinstance(value, str) or _COUNTRY_PATTERN.fullmatch(value) is None:
        raise error(f"{field_name} must be two uppercase letters, like an ISO 3166-1 alpha-2 code")
    return value


def require_iso_date(value: object, field_name: str, *, error: type[DomainError]) -> str:
    """A calendar date as `YYYY-MM-DD`; ADR 0007 forbids non-string canonical scalars."""
    if not isinstance(value, str) or _DATE_PATTERN.fullmatch(value) is None:
        raise error(f"{field_name} must be a calendar date formatted as YYYY-MM-DD")
    try:
        date.fromisoformat(value)
    except ValueError as cause:
        raise error(f"{field_name} must be a real calendar date") from cause
    return value


class FieldSensitivity(StrEnum):
    """Whether a canonical-document leaf may ever leave the authoring surface."""

    SENSITIVE = "sensitive"
    """Synthetic personal data: never logged, traced, or embedded in an error message."""

    CUSTOMER_ONLY = "customer_only"
    """Simulation-side content the support agent must never see, and never logged."""

    OPERATIONAL = "operational"
    """Non-identifying content that may appear in a span attribute or a log line."""


RESTRICTED_SENSITIVITIES: frozenset[FieldSensitivity] = frozenset(
    {FieldSensitivity.SENSITIVE, FieldSensitivity.CUSTOMER_ONLY}
)


def unclassified_paths(
    document: object, classification: Mapping[str, FieldSensitivity]
) -> frozenset[str]:
    """Document leaves with no sensitivity decision; empty for a complete classification."""
    return leaf_paths(document) - frozenset(classification)


def leaf_paths(document: object, prefix: str = "") -> frozenset[str]:
    """Every scalar path of a canonical document, with `[]` standing for a list index.

    Used to prove that a payload's field-sensitivity classification covers the whole
    document, so a new authored field cannot arrive unclassified.
    """
    if isinstance(document, dict):
        entries = cast("dict[str, object]", document)
        paths: set[str] = set()
        for key, value in entries.items():
            paths |= leaf_paths(value, f"{prefix}.{key}" if prefix else key)
        return frozenset(paths)
    if isinstance(document, list):
        items = cast("list[object]", document)
        paths = set()
        for value in items:
            paths |= leaf_paths(value, f"{prefix}[]")
        return frozenset(paths)
    return frozenset({prefix})
