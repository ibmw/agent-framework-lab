"""Canonical serialization of the two block payloads: round-trip, order, and fingerprints."""

import json
from dataclasses import replace

import pytest

from block_factories import (
    parameter,
    publishable_mutation,
    publishable_objective,
    severity_parameter,
)
from capability_lab.application.block_payloads import (
    MUTATION_BLOCK_PAYLOAD_CANONICAL_SCHEMA_VERSION,
    OBJECTIVE_BLOCK_PAYLOAD_CANONICAL_SCHEMA_VERSION,
    mutation_block_canonical_json,
    mutation_block_content_fingerprint,
    mutation_block_document,
    mutation_block_from_document,
    objective_block_canonical_json,
    objective_block_content_fingerprint,
    objective_block_document,
    objective_block_from_document,
)
from capability_lab.application.canonical_json import CanonicalSerializationError
from capability_lab.domain.blocks import BlockParameterKind, ObjectiveEvidence


def test_an_objective_block_round_trips_through_its_canonical_document() -> None:
    payload = publishable_objective()

    assert objective_block_from_document(objective_block_document(payload)) == payload


def test_a_mutation_block_round_trips_through_its_canonical_document() -> None:
    payload = publishable_mutation()

    assert mutation_block_from_document(mutation_block_document(payload)) == payload


def test_both_documents_declare_their_own_schema_version() -> None:
    assert (
        objective_block_document(publishable_objective())["canonical_schema_version"]
        == OBJECTIVE_BLOCK_PAYLOAD_CANONICAL_SCHEMA_VERSION
    )
    assert (
        mutation_block_document(publishable_mutation())["canonical_schema_version"]
        == MUTATION_BLOCK_PAYLOAD_CANONICAL_SCHEMA_VERSION
    )


def test_the_canonical_json_is_sorted_and_compact() -> None:
    encoded = objective_block_canonical_json(publishable_objective()).decode()

    assert ", " not in encoded
    assert '": ' not in encoded
    assert list(json.loads(encoded)) == sorted(json.loads(encoded))


def test_a_parameter_without_a_default_keeps_an_explicit_null() -> None:
    """ "This parameter has no default" is authored state a scenario reads, not an omission."""
    document = objective_block_document(publishable_objective())
    parameters = document["parameters"]

    assert isinstance(parameters, list)
    assert parameters[0] == {
        "default": None,
        "description": "The shop document the arm has to read.",
        "kind": "document_reference",
        "name": "doc_ref",
        "required": True,
    }


def test_the_derived_shop_binding_rule_is_not_stored() -> None:
    """It is decided by the kind, so storing it would be a second source that can drift."""
    document = objective_block_document(publishable_objective())
    parameters = document["parameters"]

    assert isinstance(parameters, list)
    assert all("shop_bound" not in entry for entry in parameters if isinstance(entry, dict))


def test_parameter_order_is_preserved_and_changes_the_fingerprint() -> None:
    """Order is what the editor shows and what a scenario binds in, so it is content."""
    payload = publishable_objective()
    reordered = replace(payload, parameters=(severity_parameter(), parameter()))

    assert objective_block_content_fingerprint(payload) != objective_block_content_fingerprint(
        reordered
    )


@pytest.mark.parametrize(
    "change",
    [
        {"name": "read-expected-document"},
        {"statement": "Read the document"},
        {"description": "A different rule entirely."},
        {"evidence": ObjectiveEvidence.STATE},
        {"parameters": ()},
    ],
)
def test_every_behaviourally_relevant_edit_changes_the_fingerprint(
    change: dict[str, object],
) -> None:
    baseline = objective_block_content_fingerprint(publishable_objective())

    assert objective_block_content_fingerprint(publishable_objective(**change)) != baseline


def test_a_parameter_kind_change_alone_changes_the_fingerprint() -> None:
    baseline = publishable_objective()
    retyped = replace(
        baseline,
        parameters=(
            replace(parameter(), kind=BlockParameterKind.DATA_REFERENCE),
            severity_parameter(),
        ),
    )

    assert objective_block_content_fingerprint(retyped) != objective_block_content_fingerprint(
        baseline
    )


def test_the_two_block_types_never_share_a_fingerprint_for_the_same_prose() -> None:
    """The schema token is inside the document, so one template is never the other."""
    objective = publishable_objective(name="shared", statement="Do", description="Same words.")
    mutation = publishable_mutation(
        name="shared", statement="Do", description="Same words.", parameters=()
    )

    assert objective_block_content_fingerprint(objective) != mutation_block_content_fingerprint(
        mutation
    )


def test_a_document_written_under_another_schema_is_refused() -> None:
    document = dict(objective_block_document(publishable_objective()))
    document["canonical_schema_version"] = "objective-block-payload-v2"

    with pytest.raises(CanonicalSerializationError, match="unsupported objective block payload"):
        objective_block_from_document(document)


def test_a_drifted_document_reports_the_failing_path() -> None:
    document = dict(mutation_block_document(publishable_mutation()))
    document["parameters"] = [{"name": "entity_ref", "kind": "entity_reference"}]

    with pytest.raises(
        CanonicalSerializationError, match=r"mutation block payload\.parameters\[0\]\.description"
    ):
        mutation_block_from_document(document)


def test_an_unsupported_parameter_kind_names_itself() -> None:
    document = dict(objective_block_document(publishable_objective()))
    parameters = document["parameters"]
    assert isinstance(parameters, list)
    first = parameters[0]
    assert isinstance(first, dict)
    document["parameters"] = [{**first, "kind": "shop_reference"}, *parameters[1:]]

    with pytest.raises(CanonicalSerializationError, match="not a supported BlockParameterKind"):
        objective_block_from_document(document)


def test_the_canonical_json_is_identical_across_two_equal_payloads() -> None:
    assert mutation_block_canonical_json(publishable_mutation()) == mutation_block_canonical_json(
        publishable_mutation()
    )
