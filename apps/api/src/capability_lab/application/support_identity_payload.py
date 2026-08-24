"""Canonical serialization of the support-identity definition payload.

`support-identity-payload-v1` follows the ADR 0013 pattern: a lossless canonical document
under the ADR 0007 serialization rules, so a published version's content fingerprint is
stable across processes and a stored version round-trips back into the typed aggregate.
"""

from __future__ import annotations

from capability_lab.application.canonical_document import (
    DocumentReader,
    require_schema_version,
)
from capability_lab.application.canonical_json import (
    CanonicalValue,
    canonical_json_bytes,
    canonical_sha256,
)
from capability_lab.domain.support_identity import (
    EscalationPolicy,
    GuidanceNote,
    SupportIdentityPayload,
    SupportPermission,
    SupportRole,
)

SUPPORT_IDENTITY_PAYLOAD_CANONICAL_SCHEMA_VERSION = "support-identity-payload-v1"


def support_identity_document(payload: SupportIdentityPayload) -> dict[str, CanonicalValue]:
    """Render one support identity as its canonical `support-identity-payload-v1` document."""
    return {
        "canonical_schema_version": SUPPORT_IDENTITY_PAYLOAD_CANONICAL_SCHEMA_VERSION,
        "escalation": {
            "conditions": list(payload.escalation.conditions),
            "escalate_to": payload.escalation.escalate_to,
        },
        "guidance": [
            {"body": note.body, "id": note.id, "title": note.title} for note in payload.guidance
        ],
        "permissions": [permission.value for permission in payload.permissions],
        "role": {
            "description": payload.role.description,
            "name": payload.role.name,
            "title": payload.role.title,
        },
    }


def support_identity_canonical_json(payload: SupportIdentityPayload) -> bytes:
    return canonical_json_bytes(support_identity_document(payload))


def support_identity_content_fingerprint(payload: SupportIdentityPayload) -> str:
    """The SHA-256 content fingerprint a published support-identity version records."""
    return canonical_sha256(support_identity_canonical_json(payload))


def support_identity_from_document(document: object) -> SupportIdentityPayload:
    """Rebuild the typed aggregate from a stored canonical document."""
    root = DocumentReader(document, "support identity payload")
    require_schema_version(
        root, SUPPORT_IDENTITY_PAYLOAD_CANONICAL_SCHEMA_VERSION, "support identity payload"
    )
    role = root.reader("role")
    escalation = root.reader("escalation")
    return SupportIdentityPayload(
        role=SupportRole(
            name=role.text("name"),
            title=role.text("title"),
            description=role.text("description"),
        ),
        permissions=root.enums(SupportPermission, "permissions"),
        guidance=tuple(
            GuidanceNote(id=note.text("id"), title=note.text("title"), body=note.text("body"))
            for note in root.readers("guidance")
        ),
        escalation=EscalationPolicy(
            escalate_to=escalation.text("escalate_to"),
            conditions=escalation.texts("conditions"),
        ),
    )
