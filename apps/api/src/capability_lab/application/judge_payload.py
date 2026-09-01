"""Canonical serialization of the judge-configuration definition payload.

`judge-configuration-payload-v1` follows the ADR 0013 pattern: a lossless canonical document
under the ADR 0007 serialization rules, so a published judge's content fingerprint is stable
across processes and a stored version round-trips back into the typed aggregate.

The evidence scopes are carried as a sorted list of their literal values, which is what makes
"the same judge shown different things" a different fingerprint rather than a footnote. The
temperature is a decimal string for the reason a price is: ADR 0007 admits no binary float
into a canonical document.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from capability_lab.application.canonical_document import (
    DocumentReader,
    require_schema_version,
)
from capability_lab.application.canonical_json import (
    CanonicalSerializationError,
    CanonicalValue,
    canonical_json_bytes,
    canonical_sha256,
)
from capability_lab.domain.judge import (
    JudgeConfigurationPayload,
    JudgeEvidenceScope,
    JudgeModel,
)

JUDGE_CONFIGURATION_PAYLOAD_CANONICAL_SCHEMA_VERSION = "judge-configuration-payload-v1"


def judge_configuration_document(payload: JudgeConfigurationPayload) -> dict[str, CanonicalValue]:
    """Render one judge as its canonical `judge-configuration-payload-v1` document."""
    return {
        "canonical_schema_version": JUDGE_CONFIGURATION_PAYLOAD_CANONICAL_SCHEMA_VERSION,
        "description": payload.description,
        "evidence": [scope.value for scope in payload.evidence],
        "model": {
            "model_id": payload.model.model_id,
            "provider": payload.model.provider,
            "temperature": payload.model.canonical_temperature,
        },
        "name": payload.name,
        "rubric": payload.rubric,
    }


def judge_configuration_canonical_json(payload: JudgeConfigurationPayload) -> bytes:
    return canonical_json_bytes(judge_configuration_document(payload))


def judge_configuration_content_fingerprint(payload: JudgeConfigurationPayload) -> str:
    """The SHA-256 content fingerprint a published judge version records."""
    return canonical_sha256(judge_configuration_canonical_json(payload))


def _decimal(value: str, path: str) -> Decimal:
    try:
        return Decimal(value)
    except InvalidOperation as cause:
        raise CanonicalSerializationError(f"{path} must be a decimal number") from cause


def judge_configuration_from_document(document: object) -> JudgeConfigurationPayload:
    """Rebuild the typed aggregate from a stored canonical document."""
    root = DocumentReader(document, "judge configuration payload")
    require_schema_version(
        root,
        JUDGE_CONFIGURATION_PAYLOAD_CANONICAL_SCHEMA_VERSION,
        "judge configuration payload",
    )
    model = root.reader("model")
    return JudgeConfigurationPayload(
        name=root.text("name"),
        model=JudgeModel(
            provider=model.text("provider"),
            model_id=model.text("model_id"),
            temperature=_decimal(
                model.text("temperature"), "judge configuration payload.model.temperature"
            ),
        ),
        description=root.text("description"),
        rubric=root.text("rubric"),
        evidence=root.enums(JudgeEvidenceScope, "evidence"),
    )


__all__ = [
    "JUDGE_CONFIGURATION_PAYLOAD_CANONICAL_SCHEMA_VERSION",
    "judge_configuration_canonical_json",
    "judge_configuration_content_fingerprint",
    "judge_configuration_document",
    "judge_configuration_from_document",
]
