"""Canonical serialization of the scenario payload: round-trip, order, and fingerprints."""

import json
from dataclasses import replace

import pytest

from capability_lab.application.canonical_json import CanonicalSerializationError
from capability_lab.application.scenario_payload import (
    SCENARIO_PAYLOAD_CANONICAL_SCHEMA_VERSION,
    scenario_canonical_json,
    scenario_content_fingerprint,
    scenario_document,
    scenario_from_document,
)
from capability_lab.domain.blocks import ObjectiveSeverity
from capability_lab.domain.scenario import CompletionConditions, unclassified_paths
from scenario_factories import (
    GUIDELINE_REFERENCE,
    ORDER_REFERENCE,
    POLICY_REFERENCE,
    binding,
    concurrent_mutation,
    publishable_scenario,
    read_check,
)


def test_a_scenario_round_trips_through_its_canonical_document() -> None:
    payload = publishable_scenario()

    assert scenario_from_document(scenario_document(payload)) == payload


def test_the_document_declares_its_own_schema_version() -> None:
    assert (
        scenario_document(publishable_scenario())["canonical_schema_version"]
        == SCENARIO_PAYLOAD_CANONICAL_SCHEMA_VERSION
    )


def test_the_canonical_json_is_sorted_and_compact() -> None:
    encoded = scenario_canonical_json(publishable_scenario()).decode()

    assert encoded == json.dumps(
        json.loads(encoded), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )


def test_the_document_carries_neither_its_shop_nor_any_pinned_version() -> None:
    """Scope and pins are provenance, not content (ADR 0018): both live on the version."""
    document = scenario_document(publishable_scenario())

    assert set(document) == {
        "canonical_schema_version",
        "completion",
        "context_documents",
        "hidden_facts",
        "mutations",
        "name",
        "objectives",
        "ticket_id",
    }


def test_bound_block_order_is_content_but_binding_order_is_not() -> None:
    payload = publishable_scenario()
    reordered_blocks = replace(payload, objectives=tuple(reversed(payload.objectives)))
    reordered_bindings = replace(
        payload,
        mutations=(
            replace(payload.mutations[0], bindings=tuple(reversed(payload.mutations[0].bindings))),
        ),
    )

    assert scenario_content_fingerprint(reordered_blocks) != scenario_content_fingerprint(payload)
    assert scenario_content_fingerprint(reordered_bindings) == scenario_content_fingerprint(payload)


def test_two_identical_recipes_in_two_shops_hash_alike() -> None:
    """The shop is scope, not content: the published version is what says which shop."""
    assert scenario_content_fingerprint(publishable_scenario()) == scenario_content_fingerprint(
        publishable_scenario()
    )


def test_severity_is_part_of_the_frozen_content() -> None:
    required = publishable_scenario(objectives=(read_check(),), mutations=())
    expected = publishable_scenario(
        objectives=(read_check(severity=ObjectiveSeverity.EXPECTED),), mutations=()
    )

    assert scenario_content_fingerprint(required) != scenario_content_fingerprint(expected)


def test_a_bound_instance_serializes_its_template_its_severity_and_its_bindings() -> None:
    document = scenario_document(
        publishable_scenario(
            objectives=(read_check(),),
            mutations=(concurrent_mutation(),),
        )
    )
    objectives = document["objectives"]
    mutations = document["mutations"]

    assert isinstance(objectives, list)
    assert objectives[0] == {
        "bindings": [{"parameter": "doc_ref", "value": POLICY_REFERENCE}],
        "block_id": str(read_check().block_id),
        "id": "read-address-change-policy",
        "severity": "required",
    }
    assert isinstance(mutations, list)
    assert mutations[0] == {
        "bindings": [
            {"parameter": "entity_ref", "value": ORDER_REFERENCE},
            {"parameter": "timing", "value": "after_first_read"},
        ],
        "block_id": str(concurrent_mutation().block_id),
        "id": "order-moves-under-the-arm",
    }


def test_completion_keeps_both_halves_of_what_done_means() -> None:
    document = scenario_document(
        publishable_scenario(
            completion=CompletionConditions(statement="Shipped and acknowledged.", max_turns=9)
        )
    )

    assert document["completion"] == {
        "max_turns": 9,
        "statement": "Shipped and acknowledged.",
    }


def test_a_document_written_under_another_schema_is_refused() -> None:
    document = scenario_document(publishable_scenario())
    document["canonical_schema_version"] = "scenario-payload-v2"

    with pytest.raises(CanonicalSerializationError, match="unsupported scenario payload schema"):
        scenario_from_document(document)


def test_a_malformed_identifier_names_the_failing_path() -> None:
    document = scenario_document(publishable_scenario())
    document["ticket_id"] = "not-a-uuid"

    with pytest.raises(CanonicalSerializationError, match=r"scenario payload\.ticket_id"):
        scenario_from_document(document)


def test_every_document_leaf_carries_a_sensitivity_decision() -> None:
    """A newly authored field cannot arrive without a decision about logs and spans."""
    payload = publishable_scenario(
        objectives=(read_check(), read_check("read-guidelines", GUIDELINE_REFERENCE)),
        mutations=(replace(concurrent_mutation(), bindings=(binding("timing", "at_turn:3"),)),),
    )

    assert unclassified_paths(scenario_document(payload)) == frozenset()
