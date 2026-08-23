"""Shared HTTP response shapes used by every router in the public v1 contract."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class StrictApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ValidationIssue(StrictApiModel):
    location: str
    message: str
    type: str


class ErrorResponse(StrictApiModel):
    code: str
    message: str
    request_id: str
    details: list[ValidationIssue] | None = None
