"""Contract shapes shared by every authorable definition resource.

Publish-gate findings, change summaries, and published-version provenance mean the same
thing for every definition type (ADR 0012), so they are one set of schemas rather than a
near-identical set per resource.
"""

from __future__ import annotations

from typing import Annotated, Any, Self

from fastapi import Path
from pydantic import Field

from capability_lab.domain.definitions import (
    DefinitionChange,
    DefinitionChangeKind,
    DefinitionIssue,
    DefinitionIssueSeverity,
    PublishedDefinitionVersion,
)
from capability_lab.presentation.base import ErrorResponse, StrictApiModel

DefinitionVersionPath = Annotated[
    int, Path(ge=1, description="Immutable published version number.")
]

Slug = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")]
Label = Annotated[str, Field(min_length=1, max_length=200)]
Body = Annotated[str, Field(min_length=1, max_length=4000)]
Locale = Annotated[str, Field(pattern=r"^[a-z]{2}(?:-[A-Z]{2})?$")]


class DefinitionIssueSchema(StrictApiModel):
    severity: DefinitionIssueSeverity
    code: str
    message: str
    path: str

    @classmethod
    def from_domain(cls, issue: DefinitionIssue) -> Self:
        return cls(severity=issue.severity, code=issue.code, message=issue.message, path=issue.path)


class DefinitionChangeSchema(StrictApiModel):
    kind: DefinitionChangeKind
    path: str
    description: str

    @classmethod
    def from_domain(cls, change: DefinitionChange) -> Self:
        return cls(kind=change.kind, path=change.path, description=change.description)


class DefinitionVersionSummarySchema(StrictApiModel):
    version: int
    content_fingerprint: str
    published_at: str

    @classmethod
    def from_domain(cls, published: PublishedDefinitionVersion) -> Self:
        return cls(
            version=published.version,
            content_fingerprint=published.content_fingerprint,
            published_at=published.published_at.isoformat(),
        )


class DefinitionValidationErrorResponse(ErrorResponse):
    """A publish refusal that carries the exact publish-gate findings."""

    issues: list[DefinitionIssueSchema]


NotFoundResponses: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse, "description": "The definition is not found"}
}
ShopNotFoundResponses: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse, "description": "The definition or the shop is not found"}
}
InvalidResponses: dict[int | str, dict[str, Any]] = {
    422: {"model": ErrorResponse, "description": "Invalid definition content"}
}
PublishFailureResponses: dict[int | str, dict[str, Any]] = {
    409: {"model": ErrorResponse, "description": "The version already exists"},
    422: {
        "model": DefinitionValidationErrorResponse,
        "description": "The draft has publish-gate errors",
    },
}

__all__ = [
    "Body",
    "DefinitionChangeSchema",
    "DefinitionIssueSchema",
    "DefinitionValidationErrorResponse",
    "DefinitionVersionPath",
    "DefinitionVersionSummarySchema",
    "InvalidResponses",
    "Label",
    "Locale",
    "NotFoundResponses",
    "PublishFailureResponses",
    "ShopNotFoundResponses",
    "Slug",
]
