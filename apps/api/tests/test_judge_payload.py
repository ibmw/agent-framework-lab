"""Canonical serialization of a judge, and what its fingerprint is sensitive to."""

from decimal import Decimal

import pytest

from capability_lab.application.canonical_json import CanonicalSerializationError
from capability_lab.application.judge_payload import (
    JUDGE_CONFIGURATION_PAYLOAD_CANONICAL_SCHEMA_VERSION,
    judge_configuration_content_fingerprint,
    judge_configuration_document,
    judge_configuration_from_document,
)
from capability_lab.domain.judge import JudgeEvidenceScope, JudgeModel
from judge_factories import publishable_judge


def test_a_judge_round_trips_through_its_canonical_document() -> None:
    payload = publishable_judge()

    assert judge_configuration_from_document(judge_configuration_document(payload)) == payload


def test_the_document_names_its_schema_version() -> None:
    document = judge_configuration_document(publishable_judge())

    assert (
        document["canonical_schema_version"] == JUDGE_CONFIGURATION_PAYLOAD_CANONICAL_SCHEMA_VERSION
    )


def test_a_temperature_is_a_decimal_string_and_never_a_binary_float() -> None:
    document = judge_configuration_document(
        publishable_judge(
            model=JudgeModel(provider="openai", model_id="gpt-5-mini", temperature=Decimal("0.2"))
        )
    )
    model = document["model"]

    assert isinstance(model, dict)
    assert model["temperature"] == "0.20"


def test_a_judge_shown_different_things_is_a_different_judge() -> None:
    """The evidence scope is part of the fingerprint: it changes the question that is asked."""
    words_only = publishable_judge(evidence=(JudgeEvidenceScope.AGENT_REPLIES,))
    with_calls = publishable_judge(
        evidence=(JudgeEvidenceScope.AGENT_REPLIES, JudgeEvidenceScope.TOOL_CALLS)
    )

    assert judge_configuration_content_fingerprint(
        words_only
    ) != judge_configuration_content_fingerprint(with_calls)


def test_the_order_scopes_were_ticked_in_does_not_move_the_fingerprint() -> None:
    one = publishable_judge(
        evidence=(JudgeEvidenceScope.TOOL_CALLS, JudgeEvidenceScope.AGENT_REPLIES)
    )
    other = publishable_judge(
        evidence=(JudgeEvidenceScope.AGENT_REPLIES, JudgeEvidenceScope.TOOL_CALLS)
    )

    assert judge_configuration_content_fingerprint(one) == judge_configuration_content_fingerprint(
        other
    )


def test_a_document_from_another_schema_is_refused() -> None:
    document = judge_configuration_document(publishable_judge())
    document["canonical_schema_version"] = "judge-configuration-payload-v2"

    with pytest.raises(CanonicalSerializationError):
        judge_configuration_from_document(document)
