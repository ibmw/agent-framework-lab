"""Canonical serialization of the agent-configuration definition payload.

`agent-configuration-payload-v1` follows the ADR 0013 pattern: a lossless canonical document
under the ADR 0007 serialization rules, so a published version's content fingerprint is
stable across processes and a stored version round-trips back into the typed aggregate.

The model temperature is carried as a decimal string for the same reason a price is: ADR
0007 admits no binary float into a canonical document, and this payload is hashed like
every other.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from uuid import UUID

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
from capability_lab.domain.agent_configuration import (
    AgentArchitecture,
    AgentConfigurationPayload,
    MemoryMode,
    ModelSettings,
    ToneOfVoiceSelection,
    ToneOfVoiceSource,
)

AGENT_CONFIGURATION_PAYLOAD_CANONICAL_SCHEMA_VERSION = "agent-configuration-payload-v1"


def agent_configuration_document(
    payload: AgentConfigurationPayload,
) -> dict[str, CanonicalValue]:
    """Render one configuration as its canonical `agent-configuration-payload-v1` document."""
    return {
        "architecture": payload.architecture.value,
        "canonical_schema_version": AGENT_CONFIGURATION_PAYLOAD_CANONICAL_SCHEMA_VERSION,
        "description": payload.description,
        "framework_id": payload.framework_id,
        "memory": payload.memory.value,
        "model": {
            "max_tool_rounds": payload.model.max_tool_rounds,
            "model_id": payload.model.model_id,
            "provider": payload.model.provider,
            "temperature": payload.model.canonical_temperature,
        },
        "name": payload.name,
        "prompt": payload.prompt,
        "support_identity_id": str(payload.support_identity_id),
        "tone_of_voice": {
            "guideline_id": payload.tone_of_voice.guideline_id,
            "source": payload.tone_of_voice.source.value,
        },
        "tools": list(payload.tools),
    }


def agent_configuration_canonical_json(payload: AgentConfigurationPayload) -> bytes:
    return canonical_json_bytes(agent_configuration_document(payload))


def agent_configuration_content_fingerprint(payload: AgentConfigurationPayload) -> str:
    """The SHA-256 content fingerprint a published agent-configuration version records."""
    return canonical_sha256(agent_configuration_canonical_json(payload))


def _uuid(value: str, path: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as cause:
        raise CanonicalSerializationError(f"{path} must be a UUID") from cause


def _decimal(value: str, path: str) -> Decimal:
    try:
        return Decimal(value)
    except InvalidOperation as cause:
        raise CanonicalSerializationError(f"{path} must be a decimal number") from cause


def agent_configuration_from_document(document: object) -> AgentConfigurationPayload:
    """Rebuild the typed aggregate from a stored canonical document."""
    root = DocumentReader(document, "agent configuration payload")
    require_schema_version(
        root,
        AGENT_CONFIGURATION_PAYLOAD_CANONICAL_SCHEMA_VERSION,
        "agent configuration payload",
    )
    model = root.reader("model")
    tone = root.reader("tone_of_voice")
    return AgentConfigurationPayload(
        name=root.text("name"),
        framework_id=root.text("framework_id"),
        support_identity_id=_uuid(
            root.text("support_identity_id"),
            "agent configuration payload.support_identity_id",
        ),
        model=ModelSettings(
            provider=model.text("provider"),
            model_id=model.text("model_id"),
            temperature=_decimal(
                model.text("temperature"), "agent configuration payload.model.temperature"
            ),
            max_tool_rounds=model.integer("max_tool_rounds"),
        ),
        architecture=root.enum(AgentArchitecture, "architecture"),
        description=root.text("description"),
        prompt=root.text("prompt"),
        tone_of_voice=ToneOfVoiceSelection(
            source=tone.enum(ToneOfVoiceSource, "source"),
            guideline_id=tone.text("guideline_id"),
        ),
        tools=root.texts("tools"),
        memory=root.enum(MemoryMode, "memory"),
    )
