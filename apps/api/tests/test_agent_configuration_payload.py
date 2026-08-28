"""Canonical serialization of `agent-configuration-payload-v1`."""

from decimal import Decimal
from uuid import UUID

import pytest

from agent_factories import model_settings, publishable_configuration
from capability_lab.application.agent_configuration_payload import (
    AGENT_CONFIGURATION_PAYLOAD_CANONICAL_SCHEMA_VERSION,
    agent_configuration_canonical_json,
    agent_configuration_content_fingerprint,
    agent_configuration_document,
    agent_configuration_from_document,
)
from capability_lab.application.canonical_json import CanonicalSerializationError
from capability_lab.domain.agent_configuration import (
    MemoryMode,
    ToneOfVoiceSelection,
    ToneOfVoiceSource,
)

IDENTITY_ID = UUID("2f1c7b7a-5f2f-4c4f-9c1e-1f7c2a9b3d10")


def test_the_document_names_its_schema_and_carries_every_authored_field() -> None:
    payload = publishable_configuration(IDENTITY_ID)
    document = agent_configuration_document(payload)

    assert (
        document["canonical_schema_version"] == AGENT_CONFIGURATION_PAYLOAD_CANONICAL_SCHEMA_VERSION
    )
    assert document["support_identity_id"] == str(IDENTITY_ID)
    assert document["model"] == {
        "max_tool_rounds": 8,
        "model_id": "gpt-5-mini",
        "provider": "openai",
        "temperature": "0.20",
    }
    assert document["tone_of_voice"] == {"guideline_id": "", "source": "shop_default"}


def test_the_temperature_is_a_decimal_string_and_never_a_binary_float() -> None:
    """ADR 0007 admits no float into a canonical document, and this payload is hashed."""
    payload = publishable_configuration(model=model_settings(temperature=Decimal("0.7")))

    assert b'"temperature":"0.70"' in agent_configuration_canonical_json(payload)


def test_a_stored_document_round_trips_back_into_the_typed_aggregate() -> None:
    payload = publishable_configuration(
        IDENTITY_ID,
        memory=MemoryMode.NONE,
        tone_of_voice=ToneOfVoiceSelection(
            source=ToneOfVoiceSource.OVERRIDE, guideline_id="warm-and-efficient"
        ),
    )

    assert agent_configuration_from_document(agent_configuration_document(payload)) == payload


def test_the_fingerprint_is_stable_across_equal_payloads_and_moves_with_content() -> None:
    first = publishable_configuration(IDENTITY_ID)
    same = publishable_configuration(IDENTITY_ID)
    moved = publishable_configuration(IDENTITY_ID, model=model_settings(max_tool_rounds=9))

    assert agent_configuration_content_fingerprint(first) == (
        agent_configuration_content_fingerprint(same)
    )
    assert agent_configuration_content_fingerprint(moved) != (
        agent_configuration_content_fingerprint(first)
    )


def test_a_document_written_under_another_schema_is_refused() -> None:
    document = agent_configuration_document(publishable_configuration(IDENTITY_ID))
    document["canonical_schema_version"] = "agent-configuration-payload-v2"

    with pytest.raises(CanonicalSerializationError, match="unsupported"):
        agent_configuration_from_document(document)


def test_a_corrupted_identifier_or_temperature_names_the_failing_path() -> None:
    document = agent_configuration_document(publishable_configuration(IDENTITY_ID))
    document["support_identity_id"] = "not-a-uuid"

    with pytest.raises(CanonicalSerializationError, match="support_identity_id must be a UUID"):
        agent_configuration_from_document(document)

    document = agent_configuration_document(publishable_configuration(IDENTITY_ID))
    model = document["model"]
    assert isinstance(model, dict)
    model["temperature"] = "warm"

    with pytest.raises(CanonicalSerializationError, match=r"model\.temperature"):
        agent_configuration_from_document(document)
