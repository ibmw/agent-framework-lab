"""Typed reading of a stored canonical definition document.

Every definition payload is persisted as one canonical document (ADR 0013). Rebuilding the
typed aggregate from it must fail loudly and say *where*, because a document that no longer
matches its schema is corrupted historical evidence, not an input to guess at.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import cast

from capability_lab.application.canonical_json import CanonicalSerializationError


def require_document_text(value: object, path: str) -> str:
    if not isinstance(value, str):
        raise CanonicalSerializationError(f"{path} must be a string")
    return value


class DocumentReader:
    """Typed access to one canonical object, reporting the failing path on mismatch."""

    __slots__ = ("_document", "_path")

    def __init__(self, value: object, path: str) -> None:
        if not isinstance(value, Mapping):
            raise CanonicalSerializationError(f"{path} must be an object")
        self._document = cast("Mapping[str, object]", value)
        self._path = path

    @property
    def path(self) -> str:
        return self._path

    def has(self, key: str) -> bool:
        """Whether the key is present at all, `null` included."""
        return key in self._document

    def text(self, key: str) -> str:
        value = self._document.get(key)
        if not isinstance(value, str):
            raise CanonicalSerializationError(f"{self._path}.{key} must be a string")
        return value

    def optional_text(self, key: str) -> str | None:
        return None if self._document.get(key) is None else self.text(key)

    def integer(self, key: str) -> int:
        value = self._document.get(key)
        if isinstance(value, bool) or not isinstance(value, int):
            raise CanonicalSerializationError(f"{self._path}.{key} must be an integer")
        return value

    def boolean(self, key: str) -> bool:
        value = self._document.get(key)
        if not isinstance(value, bool):
            raise CanonicalSerializationError(f"{self._path}.{key} must be a boolean")
        return value

    def enum[EnumT: StrEnum](self, enum_type: type[EnumT], key: str) -> EnumT:
        try:
            return enum_type(self.text(key))
        except ValueError as error:
            raise CanonicalSerializationError(
                f"{self._path}.{key} is not a supported {enum_type.__name__}"
            ) from error

    def texts(self, key: str) -> tuple[str, ...]:
        return tuple(
            require_document_text(value, f"{self._path}.{key}[{index}]")
            for index, value in enumerate(self.sequence(key))
        )

    def enums[EnumT: StrEnum](self, enum_type: type[EnumT], key: str) -> tuple[EnumT, ...]:
        values: list[EnumT] = []
        for index, item in enumerate(self.sequence(key)):
            path = f"{self._path}.{key}[{index}]"
            try:
                values.append(enum_type(require_document_text(item, path)))
            except ValueError as error:
                raise CanonicalSerializationError(
                    f"{path} is not a supported {enum_type.__name__}"
                ) from error
        return tuple(values)

    def sequence(self, key: str) -> Sequence[object]:
        value = self._document.get(key)
        if not isinstance(value, Sequence) or isinstance(value, str | bytes):
            raise CanonicalSerializationError(f"{self._path}.{key} must be a list")
        return cast("Sequence[object]", value)

    def readers(self, key: str) -> tuple[DocumentReader, ...]:
        return tuple(
            DocumentReader(value, f"{self._path}.{key}[{index}]")
            for index, value in enumerate(self.sequence(key))
        )

    def reader(self, key: str) -> DocumentReader:
        return DocumentReader(self._document.get(key), f"{self._path}.{key}")

    def embedded(self, key: str) -> object:
        """The raw nested value, for handing an embedded document to the codec that owns it.

        The sandbox envelope embeds whole `order-fixture-v1` documents (ADR 0019); their
        codec reads from its own root, so it takes the value rather than a reader.
        """
        value = self._document.get(key)
        if not isinstance(value, Mapping):
            raise CanonicalSerializationError(f"{self._path}.{key} must be an object")
        return cast("Mapping[str, object]", value)

    def optional_reader(self, key: str) -> DocumentReader | None:
        """A nested object that the schema allows to be explicitly null."""
        if self._document.get(key) is None:
            return None
        return self.reader(key)


def require_schema_version(reader: DocumentReader, expected: str, noun: str) -> None:
    """Refuse a document written under a schema token this codec does not implement."""
    schema_version = reader.text("canonical_schema_version")
    if schema_version != expected:
        raise CanonicalSerializationError(f"unsupported {noun} schema version {schema_version}")
