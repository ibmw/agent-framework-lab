"""Block-template invariants, the two publish gates, bindings, and change summaries."""

from dataclasses import replace

import pytest

from block_factories import (
    parameter,
    publishable_mutation,
    publishable_objective,
    severity_parameter,
    timing_parameter,
)
from capability_lab.domain.blocks import (
    SHOP_BOUND_PARAMETER_KINDS,
    BlockConfigurationError,
    BlockParameter,
    BlockParameterKind,
    MutationBlockPayload,
    MutationTiming,
    MutationTimingKind,
    ObjectiveAssessment,
    ObjectiveBlockPayload,
    ObjectiveEvidence,
    check_bindings,
    is_duration,
    is_timing,
    new_mutation_block,
    new_objective_block,
    parse_timing,
    shop_bound_parameters,
    summarize_mutation_block_changes,
    summarize_objective_block_changes,
    validate_mutation_block,
    validate_objective_block,
)
from capability_lab.domain.definitions import DefinitionChangeKind


def objective_codes(payload: ObjectiveBlockPayload) -> set[str]:
    return {issue.code for issue in validate_objective_block(payload).issues}


def mutation_codes(payload: MutationBlockPayload) -> set[str]:
    return {issue.code for issue in validate_mutation_block(payload).issues}


# -- structural invariants -------------------------------------------------


def test_a_block_name_is_a_kebab_case_slug_and_a_parameter_name_is_snake_case() -> None:
    """The name is the key a scenario binds by; the parameter name is looked up in code."""
    with pytest.raises(BlockConfigurationError, match="objective block name"):
        publishable_objective(name="Read Required Document")
    with pytest.raises(BlockConfigurationError, match="block parameter name"):
        parameter("doc-ref")


def test_parameter_names_are_unique_within_a_block() -> None:
    with pytest.raises(BlockConfigurationError, match="block parameter names must"):
        publishable_objective(parameters=(parameter(), parameter()))


def test_a_block_declares_a_bounded_number_of_parameters() -> None:
    too_many = tuple(parameter(f"ref_{index}") for index in range(9))

    with pytest.raises(BlockConfigurationError, match="at most 8 parameters"):
        publishable_objective(parameters=too_many)


def test_a_new_block_is_saveable_while_it_is_still_incomplete() -> None:
    """A draft may be empty prose; only the publish gate refuses to freeze it."""
    objective = new_objective_block("identify-entity")
    mutation = new_mutation_block("tool-timeout")

    assert objective.statement == ""
    assert objective.parameters == ()
    assert mutation.parameters == ()
    assert {"block_without_statement", "block_without_description"} <= objective_codes(objective)
    assert {"block_without_statement", "block_without_description"} <= mutation_codes(mutation)


# -- shop-independence -----------------------------------------------------


def test_a_parameter_knows_whether_a_scenario_must_bind_it_inside_its_own_shop() -> None:
    """This classification is the whole shop-independence rule a template can state."""
    assert parameter(kind=BlockParameterKind.DOCUMENT_REFERENCE).binds_shop_object
    assert parameter(kind=BlockParameterKind.ENTITY_REFERENCE).binds_shop_object
    assert parameter(kind=BlockParameterKind.DATA_REFERENCE).binds_shop_object
    # A tool belongs to the lab, and a literal names nothing at all.
    assert not parameter(kind=BlockParameterKind.TOOL_REFERENCE).binds_shop_object
    assert not severity_parameter().binds_shop_object
    assert {
        kind for kind in BlockParameterKind if parameter(kind=kind).binds_shop_object
    } == SHOP_BOUND_PARAMETER_KINDS


def test_shop_bound_parameters_name_what_a_scenario_must_resolve() -> None:
    assert shop_bound_parameters(publishable_objective().parameters) == ("doc_ref",)
    assert shop_bound_parameters(publishable_mutation().parameters) == ("entity_ref",)


def test_a_template_cannot_default_a_parameter_that_names_a_shop_object() -> None:
    """A default reference would hand one shop's object to every other shop."""
    payload = publishable_objective(
        parameters=(parameter(default="policy/address-change"), severity_parameter())
    )

    assert "reference_parameter_with_default" in objective_codes(payload)


def test_a_literal_default_must_fit_its_kind() -> None:
    assert "parameter_default_invalid" in objective_codes(
        publishable_objective(parameters=(parameter(), severity_parameter(default="mandatory")))
    )
    assert "parameter_default_invalid" in mutation_codes(
        publishable_mutation(
            parameters=(
                parameter("entity_ref", kind=BlockParameterKind.ENTITY_REFERENCE),
                timing_parameter(default="whenever"),
            )
        )
    )


def test_an_optional_parameter_without_a_default_leaves_the_runtime_with_nothing() -> None:
    payload = publishable_objective(
        parameters=(parameter(), severity_parameter(required=False, default=None))
    )

    assert "optional_parameter_without_default" in objective_codes(payload)


def test_the_optional_parameter_remedy_depends_on_the_kind() -> None:
    """A reference may never carry a default, so "add one" would be advice it cannot take."""
    literal = validate_objective_block(
        publishable_objective(
            parameters=(parameter(), severity_parameter(required=False, default=None))
        )
    )
    reference = validate_objective_block(
        publishable_objective(
            parameters=(parameter(required=False), severity_parameter()),
        )
    )

    assert "give it a default" in literal.errors[0].message
    assert "make it required" in reference.errors[0].message


def test_a_parameter_without_a_description_only_warns() -> None:
    payload = publishable_objective(parameters=(parameter(description=""), severity_parameter()))
    validation = validate_objective_block(payload)

    assert validation.publishable
    assert [issue.code for issue in validation.warnings] == ["parameter_without_description"]


# -- objective publish gate ------------------------------------------------


def test_a_complete_objective_block_has_no_publish_gate_findings() -> None:
    assert validate_objective_block(publishable_objective()).issues == ()


def test_publication_requires_a_statement_and_a_description() -> None:
    assert objective_codes(publishable_objective(statement="")) == {"block_without_statement"}
    assert objective_codes(publishable_objective(description="")) == {"block_without_description"}


def test_a_judge_objective_is_scored_on_a_dimension_and_nothing_else() -> None:
    for evidence in (
        ObjectiveEvidence.EVENT,
        ObjectiveEvidence.POLICY,
        ObjectiveEvidence.STATE,
        ObjectiveEvidence.FORBIDDEN,
    ):
        payload = publishable_objective(
            assessment=ObjectiveAssessment.JUDGE, evidence=evidence, parameters=()
        )
        assert objective_codes(payload) == {"objective_assessment_evidence_mismatch"}

    judged = publishable_objective(
        assessment=ObjectiveAssessment.JUDGE,
        evidence=ObjectiveEvidence.DIMENSION,
        parameters=(),
    )
    assert validate_objective_block(judged).issues == ()


def test_a_deterministic_objective_cannot_be_scored_on_a_rubric_dimension() -> None:
    payload = publishable_objective(evidence=ObjectiveEvidence.DIMENSION)

    assert "objective_assessment_evidence_mismatch" in objective_codes(payload)


def test_an_objective_cannot_be_scheduled() -> None:
    """Objective order is priority; a scheduled objective would be a scripted conversation."""
    payload = publishable_objective(parameters=(parameter(), timing_parameter()))

    assert "objective_parameter_schedules" in objective_codes(payload)


# -- mutation publish gate -------------------------------------------------


def test_a_complete_mutation_block_has_no_publish_gate_findings() -> None:
    assert validate_mutation_block(publishable_mutation()).issues == ()


def test_a_mutation_must_say_when_it_fires() -> None:
    """Mutation order is the run timeline, so a mutation with no moment has no place on it."""
    payload = publishable_mutation(
        parameters=(parameter("entity_ref", kind=BlockParameterKind.ENTITY_REFERENCE),)
    )

    assert "mutation_without_timing" in mutation_codes(payload)


def test_a_mutation_fires_once_so_only_one_parameter_may_say_when() -> None:
    payload = publishable_mutation(parameters=(timing_parameter(), timing_parameter("window")))

    assert "mutation_with_several_timings" in mutation_codes(payload)


# -- literal value shapes --------------------------------------------------


@pytest.mark.parametrize("value", ["PT30S", "PT5M", "PT1H30M", "P1D", "P1DT2H"])
def test_a_duration_covers_the_spans_the_sandbox_can_advance_by(value: str) -> None:
    assert is_duration(value)


@pytest.mark.parametrize("value", ["P", "PT", "P1DT", "30S", "P1M", "P1Y", "", "PT1.5S"])
def test_a_duration_refuses_an_empty_calendar_or_dangling_span(value: str) -> None:
    """Months and years have no fixed length, so the sandbox cannot advance by one.

    `P1DT` is the subtler one: it claims a time part and then supplies none, which is
    malformed rather than merely unsupported.
    """
    assert not is_duration(value)


@pytest.mark.parametrize(
    "value", ["after_first_read", "at_turn:1", "at_turn:12", "at_offset:PT30S"]
)
def test_a_timing_names_a_moment_the_runtime_can_observe(value: str) -> None:
    assert is_timing(value)


@pytest.mark.parametrize(
    "value", ["at_turn:0", "at_turn:-1", "at_turn:", "at_offset:soon", "eventually"]
)
def test_a_timing_refuses_a_moment_the_runtime_cannot_place(value: str) -> None:
    assert not is_timing(value)


@pytest.mark.parametrize(
    ("value", "kind"),
    [
        ("after_first_read", MutationTimingKind.AFTER_FIRST_READ),
        ("at_turn:3", MutationTimingKind.AT_TURN),
        ("at_offset:PT30S", MutationTimingKind.AT_OFFSET),
    ],
)
def test_a_timing_is_parsed_into_the_form_a_runtime_branches_on(
    value: str, kind: MutationTimingKind
) -> None:
    """One reading of the grammar, so the gate cannot accept what the runtime cannot place."""
    parsed = parse_timing(value)

    assert parsed is not None
    assert parsed.kind is kind
    assert parsed.value == value


def test_a_turn_timing_carries_the_turn_it_names() -> None:
    parsed = parse_timing("at_turn:12")

    assert parsed is not None
    assert parsed.turn == 12
    assert parsed.offset is None


def test_a_timing_the_grammar_refuses_parses_to_nothing() -> None:
    assert parse_timing("eventually") is None


def test_a_timing_cannot_claim_a_form_and_carry_another_s_value() -> None:
    with pytest.raises(BlockConfigurationError):
        MutationTiming(kind=MutationTimingKind.AFTER_FIRST_READ, turn=2)


# -- bindings --------------------------------------------------------------


def test_a_complete_binding_set_has_no_findings() -> None:
    validation = check_bindings(
        publishable_objective().parameters,
        {"doc_ref": "policy/address-change", "severity": "required"},
    )

    assert validation.issues == ()


def test_a_binding_may_omit_a_parameter_the_template_defaults() -> None:
    validation = check_bindings(
        publishable_objective().parameters, {"doc_ref": "policy/address-change"}
    )

    assert validation.issues == ()


def test_a_required_parameter_without_a_default_must_be_bound() -> None:
    validation = check_bindings(publishable_objective().parameters, {"severity": "expected"})

    assert [issue.code for issue in validation.errors] == ["binding_missing"]
    assert validation.errors[0].path == "bindings.doc_ref"


def test_a_binding_the_template_never_declared_is_refused() -> None:
    validation = check_bindings(
        publishable_objective().parameters,
        {"doc_ref": "policy/address-change", "urgency": "high"},
    )

    assert [issue.code for issue in validation.errors] == ["binding_parameter_unknown"]
    assert validation.errors[0].path == "bindings.urgency"


def test_a_literal_binding_must_fit_its_kind_and_an_empty_one_never_does() -> None:
    validation = check_bindings(
        publishable_objective().parameters,
        {"doc_ref": "", "severity": "whenever-convenient"},
    )

    assert [issue.code for issue in validation.errors] == [
        "binding_empty",
        "binding_value_invalid",
    ]


def test_a_reference_binding_is_not_judged_here() -> None:
    """Only a scenario knows its shop, so resolving a reference is its question, not ours."""
    validation = check_bindings(
        publishable_objective().parameters,
        {"doc_ref": "a document that does not exist", "severity": "required"},
    )

    assert validation.issues == ()


# -- change summaries ------------------------------------------------------


def test_the_first_version_is_summarized_as_the_block_itself() -> None:
    changes = summarize_objective_block_changes(None, publishable_objective())

    assert [change.kind for change in changes] == [DefinitionChangeKind.ADDED]
    assert "read-required-document" in changes[0].description


def test_a_change_summary_names_the_type_axis_and_every_parameter_that_moved() -> None:
    previous = publishable_objective()
    current = replace(
        previous,
        evidence=ObjectiveEvidence.STATE,
        parameters=(
            parameter(description="A different instruction."),
            parameter("policy_ref", kind=BlockParameterKind.DOCUMENT_REFERENCE),
        ),
    )

    changes = summarize_objective_block_changes(previous, current)
    paths = {change.path for change in changes}

    assert "evidence" in paths
    assert "parameters.doc_ref" in paths
    assert "parameters.policy_ref" in paths
    assert "parameters.severity" in paths


def test_a_mutation_change_summary_names_its_own_type_axis() -> None:
    previous = publishable_mutation()
    current = replace(previous, statement="Concurrent write to")

    changes = summarize_mutation_block_changes(previous, current)

    assert [change.path for change in changes] == ["statement"]


def test_a_parameter_kind_change_is_reported_as_an_update() -> None:
    previous = publishable_objective()
    current = replace(
        previous,
        parameters=(
            replace(parameter(), kind=BlockParameterKind.DATA_REFERENCE),
            severity_parameter(),
        ),
    )

    changes = summarize_objective_block_changes(previous, current)
    updated = [change for change in changes if change.path == "parameters.doc_ref"]

    assert [change.kind for change in updated] == [DefinitionChangeKind.UPDATED]
    assert "data_reference" in updated[0].description


def test_a_parameter_entry_carries_its_kind_into_the_summary_label() -> None:
    changes = summarize_objective_block_changes(
        replace(publishable_objective(), parameters=(severity_parameter(),)),
        publishable_objective(),
    )
    added = [change for change in changes if change.kind is DefinitionChangeKind.ADDED]

    assert [change.description for change in added] == [
        "Added parameter doc_ref (document_reference)"
    ]


def test_a_block_parameter_rejects_a_value_that_bypasses_static_checking() -> None:
    with pytest.raises(BlockConfigurationError, match="supported kind"):
        BlockParameter(name="doc_ref", kind="document_reference")  # type: ignore[arg-type]
