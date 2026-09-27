"""Scenario invariants, the reference grammar, the publish gate, and change summaries."""

from dataclasses import replace
from uuid import UUID, uuid4

import pytest

from capability_lab.domain.blocks import (
    BlockParameter,
    BlockParameterKind,
    ObjectiveSeverity,
)
from capability_lab.domain.definitions import DefinitionChangeKind
from capability_lab.domain.scenario import (
    DATA_FIELDS,
    MAX_COMPLETION_TURNS,
    MAX_CONTEXT_DOCUMENTS,
    MAX_SCENARIO_BINDINGS,
    MAX_SCENARIO_MUTATIONS,
    MAX_SCENARIO_OBJECTIVES,
    MIN_COMPLETION_TURNS,
    BoundObjective,
    CompletionConditions,
    ContextDocument,
    ScenarioBinding,
    ScenarioConfigurationError,
    ScenarioEntityKind,
    ScenarioPayload,
    parse_data_reference,
    parse_document_reference,
    parse_entity_reference,
    restricted_values,
    summarize_scenario_changes,
    telemetry_attributes,
    validate_scenario,
    validate_scenario_content,
)
from capability_lab.domain.shop import ShopDocumentKind
from scenario_factories import (
    CUSTOMER_ID,
    GUIDELINE_REFERENCE,
    MUTATION_BLOCK_ID,
    ORDER_ID,
    ORDER_REFERENCE,
    POLICY_REFERENCE,
    READ_BLOCK_ID,
    binding,
    concurrent_mutation,
    context,
    mutation_template,
    objective_template,
    publishable_scenario,
    read_check,
)

OTHER_ORDER_ID = UUID("9e1d5b3a-77c4-4d21-bb0e-6f7a2c9d4e55")
OTHER_CUSTOMER_ID = UUID("41f0a2b8-3c5d-4e6f-9a1b-2c3d4e5f6a77")


def codes(payload: ScenarioPayload, **overrides: object) -> set[str]:
    return {issue.code for issue in validate_scenario(payload, context(**overrides)).issues}


# -- structural invariants -------------------------------------------------


def test_a_scenario_must_be_built_on_a_ticket_and_carry_a_readable_name() -> None:
    with pytest.raises(ScenarioConfigurationError, match="scenario name"):
        publishable_scenario(name="  ")
    with pytest.raises(ScenarioConfigurationError, match="built on a ticket"):
        publishable_scenario(ticket_id="not-a-uuid")


def test_bound_instance_ids_are_unique_within_their_collection() -> None:
    with pytest.raises(ScenarioConfigurationError, match="bound objective IDs"):
        publishable_scenario(objectives=(read_check(), read_check()))
    with pytest.raises(ScenarioConfigurationError, match="bound mutation IDs"):
        publishable_scenario(mutations=(concurrent_mutation(), concurrent_mutation()))


def test_every_collection_a_scenario_carries_is_bounded() -> None:
    with pytest.raises(ScenarioConfigurationError, match="at most"):
        publishable_scenario(
            objectives=tuple(
                read_check(f"read-{index}") for index in range(MAX_SCENARIO_OBJECTIVES + 1)
            )
        )
    with pytest.raises(ScenarioConfigurationError, match="at most"):
        publishable_scenario(
            mutations=tuple(
                concurrent_mutation(f"mutation-{index}")
                for index in range(MAX_SCENARIO_MUTATIONS + 1)
            )
        )
    with pytest.raises(ScenarioConfigurationError, match="at most"):
        publishable_scenario(
            context_documents=tuple(
                ContextDocument(kind=ShopDocumentKind.POLICY, document_id=f"policy-{index}")
                for index in range(MAX_CONTEXT_DOCUMENTS + 1)
            )
        )
    with pytest.raises(ScenarioConfigurationError, match="at most"):
        BoundObjective(
            id="over-bound",
            block_id=READ_BLOCK_ID,
            bindings=tuple(
                binding(f"p_{index}", "x") for index in range(MAX_SCENARIO_BINDINGS + 1)
            ),
        )


def test_each_cap_is_refused_in_the_sentence_the_scenario_editor_repeats() -> None:
    """The `*_CAP_RULE` sentences in `apps/web/src/lib/fieldRules.ts`, and the caps they name.

    Refused at the write, one past the cap, and not at the cap itself.
    """
    documents = tuple(
        ContextDocument(kind=ShopDocumentKind.POLICY, document_id=f"policy-{index}")
        for index in range(MAX_CONTEXT_DOCUMENTS + 1)
    )
    objectives = tuple(read_check(f"read-{index}") for index in range(MAX_SCENARIO_OBJECTIVES + 1))
    mutations = tuple(
        concurrent_mutation(f"mutation-{index}") for index in range(MAX_SCENARIO_MUTATIONS + 1)
    )
    assert (MAX_CONTEXT_DOCUMENTS, MAX_SCENARIO_OBJECTIVES, MAX_SCENARIO_MUTATIONS) == (12, 24, 8)

    publishable_scenario(
        context_documents=documents[:-1], objectives=objectives[:-1], mutations=mutations[:-1]
    )
    with pytest.raises(ScenarioConfigurationError) as refused_documents:
        publishable_scenario(context_documents=documents)
    with pytest.raises(ScenarioConfigurationError) as refused_objectives:
        publishable_scenario(objectives=objectives)
    with pytest.raises(ScenarioConfigurationError) as refused_mutations:
        publishable_scenario(mutations=mutations)

    assert str(refused_documents.value) == "a scenario carries at most 12 context documents"
    assert str(refused_objectives.value) == "a scenario composes at most 24 objectives"
    assert str(refused_mutations.value) == "a scenario composes at most 8 mutations"


def test_one_document_cannot_be_listed_as_context_twice() -> None:
    entry = ContextDocument(kind=ShopDocumentKind.POLICY, document_id="address-change")

    with pytest.raises(ScenarioConfigurationError, match="context documents"):
        publishable_scenario(context_documents=(entry, entry))


def test_a_turn_cap_is_what_guarantees_a_run_terminates() -> None:
    # Both ends of the range are legal; one step outside either is not.
    assert CompletionConditions(statement="Done.", max_turns=MIN_COMPLETION_TURNS).max_turns == 1
    assert CompletionConditions(statement="Done.", max_turns=MAX_COMPLETION_TURNS).max_turns == 100
    with pytest.raises(ScenarioConfigurationError, match="completion turn cap"):
        CompletionConditions(statement="Done.", max_turns=MIN_COMPLETION_TURNS - 1)
    with pytest.raises(ScenarioConfigurationError, match="completion turn cap"):
        CompletionConditions(statement="Done.", max_turns=MAX_COMPLETION_TURNS + 1)


def test_bindings_are_a_map_so_their_order_is_not_content() -> None:
    """Two authoring orders are the same scenario and must publish as one version."""
    forwards = concurrent_mutation()
    backwards = replace(forwards, bindings=tuple(reversed(forwards.bindings)))
    assert forwards == backwards
    assert [entry.parameter for entry in backwards.bindings] == ["entity_ref", "timing"]


def test_a_binding_cannot_name_one_parameter_twice() -> None:
    with pytest.raises(ScenarioConfigurationError, match="binding parameter names"):
        BoundObjective(
            id="read-it",
            block_id=READ_BLOCK_ID,
            bindings=(binding("doc_ref", POLICY_REFERENCE), binding("doc_ref", "policy:returns")),
        )


def test_a_template_bound_twice_is_still_one_reference() -> None:
    """A published scenario pins one version per template, not one per instance."""
    payload = publishable_scenario()
    assert payload.objective_block_ids == (READ_BLOCK_ID,)
    assert payload.mutation_block_ids == (MUTATION_BLOCK_ID,)


# -- the reference grammar -------------------------------------------------


def test_a_document_reference_names_the_collection_it_lives_in() -> None:
    reference = parse_document_reference(POLICY_REFERENCE)
    assert reference is not None
    assert reference.kind is ShopDocumentKind.POLICY
    assert reference.document_id == "address-change"
    assert reference.value == POLICY_REFERENCE


@pytest.mark.parametrize(
    "value", ["address-change", "unknown_kind:address-change", "policy:Not A Slug", "policy:"]
)
def test_a_value_that_is_not_a_document_reference_reads_as_none(value: str) -> None:
    assert parse_document_reference(value) is None


def test_an_entity_reference_names_an_order_a_customer_or_a_product() -> None:
    order = parse_entity_reference(ORDER_REFERENCE)
    assert order is not None
    assert order.kind is ScenarioEntityKind.ORDER
    assert order.entity_id == ORDER_ID

    product = parse_entity_reference("product:alpine-shell-jacket")
    assert product is not None
    # A product is the shop's own key, so there is no identifier to resolve by UUID.
    assert product.entity_id is None


@pytest.mark.parametrize("value", ["order:not-a-uuid", "supplier:1", str(ORDER_ID)])
def test_a_value_that_is_not_an_entity_reference_reads_as_none(value: str) -> None:
    assert parse_entity_reference(value) is None


def test_a_data_reference_names_one_field_of_one_entity() -> None:
    data = parse_data_reference(f"{ORDER_REFERENCE}#shipping_address")
    assert data is not None
    assert data.entity.entity_id == ORDER_ID
    assert data.field == "shipping_address"
    assert data.field in DATA_FIELDS[ScenarioEntityKind.ORDER]


@pytest.mark.parametrize("value", [ORDER_REFERENCE, "order:x#shipping_address", "#field"])
def test_a_value_that_is_not_a_data_reference_reads_as_none(value: str) -> None:
    assert parse_data_reference(value) is None


# -- the publish gate ------------------------------------------------------


def test_a_complete_scenario_has_no_publish_gate_errors() -> None:
    validation = validate_scenario(publishable_scenario(), context())
    assert validation.publishable, validation.issues
    assert validation.issues == ()


def test_a_scenario_that_asserts_nothing_produces_no_evidence() -> None:
    assert "scenario_without_objective" in codes(publishable_scenario(objectives=()))


def test_publication_requires_saying_what_a_resolved_incident_looks_like() -> None:
    payload = publishable_scenario(completion=CompletionConditions(statement="", max_turns=8))
    assert "scenario_without_completion" in codes(payload)


def test_missing_context_and_hidden_facts_only_warn() -> None:
    payload = publishable_scenario(
        context_documents=(),
        hidden_facts="",
        objectives=(read_check(),),
    )
    validation = validate_scenario(payload, context())
    warnings = {issue.code for issue in validation.warnings}
    assert {"scenario_without_context_document", "scenario_without_hidden_facts"} <= warnings
    assert validation.errors == ()


def test_the_content_gate_alone_never_consults_a_shop() -> None:
    """What a pure caller can assert with no shop, ticket, or library loaded."""
    validation = validate_scenario_content(publishable_scenario())
    assert validation.publishable
    assert validation.issues == ()


# -- what the surrounding shop answers -------------------------------------


def test_a_scenario_can_only_be_built_on_its_own_shops_ticket() -> None:
    assert "ticket_not_in_shop" in codes(publishable_scenario(), ticket_in_shop=False)


def test_publishing_pins_a_ticket_and_a_shop_version_that_must_exist() -> None:
    assert "ticket_unpublished" in codes(publishable_scenario(), ticket_published=False)
    assert "shop_unpublished" in codes(publishable_scenario(), shop_published=False)


def test_a_context_document_the_shop_no_longer_configures_is_an_error() -> None:
    payload = publishable_scenario(
        context_documents=(
            ContextDocument(kind=ShopDocumentKind.POLICY, document_id="retired-policy"),
        )
    )
    assert "context_document_missing_from_shop" in codes(payload)


def test_a_binding_must_resolve_inside_the_scenarios_own_shop() -> None:
    payload = publishable_scenario(
        objectives=(read_check(document="policy:not-in-this-shop"),),
        context_documents=(
            ContextDocument(kind=ShopDocumentKind.POLICY, document_id="not-in-this-shop"),
        ),
    )
    assert "binding_document_missing_from_shop" in codes(payload)


def test_a_binding_that_is_not_a_reference_at_all_says_what_one_looks_like() -> None:
    payload = publishable_scenario(objectives=(read_check(document="address-change"),))
    issues = [
        issue
        for issue in validate_scenario(payload, context()).issues
        if issue.code == "binding_document_malformed"
    ]
    assert issues and "policy:address-change" in issues[0].message


def test_an_entity_binding_resolves_against_this_shop_and_this_customer() -> None:
    gone = publishable_scenario(
        mutations=(
            replace(
                concurrent_mutation(),
                bindings=(
                    binding("entity_ref", f"order:{OTHER_ORDER_ID}"),
                    binding("timing", "after_first_read"),
                ),
            ),
        )
    )
    assert "binding_order_missing_from_shop" in codes(gone)
    assert "binding_order_of_another_customer" in codes(
        gone, shop_order_ids=frozenset({ORDER_ID, OTHER_ORDER_ID})
    )


def test_a_customer_binding_must_be_the_customer_the_ticket_is_about() -> None:
    payload = publishable_scenario(
        objectives=(
            BoundObjective(
                id="identify-the-customer",
                block_id=READ_BLOCK_ID,
                bindings=(binding("doc_ref", f"customer:{OTHER_CUSTOMER_ID}"),),
            ),
        )
    )
    # The reference is bound to a document parameter, so the shape check fires first; what
    # matters here is the entity rule, exercised through an entity parameter below.
    assert "binding_document_malformed" in codes(payload)

    entity_template = objective_template(
        parameters=(
            BlockParameter(
                name="entity_ref",
                kind=BlockParameterKind.ENTITY_REFERENCE,
                description="The object the arm must identify.",
            ),
        )
    )
    identify = publishable_scenario(
        objectives=(
            BoundObjective(
                id="identify-the-customer",
                block_id=READ_BLOCK_ID,
                bindings=(binding("entity_ref", f"customer:{OTHER_CUSTOMER_ID}"),),
            ),
        )
    )
    assert "binding_customer_missing_from_shop" in codes(
        identify, objective_blocks={READ_BLOCK_ID: entity_template}
    )
    assert "binding_customer_not_the_ticket_customer" in codes(
        identify,
        objective_blocks={READ_BLOCK_ID: entity_template},
        shop_customer_profile_ids=frozenset({CUSTOMER_ID, OTHER_CUSTOMER_ID}),
    )


def test_a_binding_that_is_not_a_reference_of_its_kind_says_what_one_looks_like() -> None:
    """Each shop-bound kind names its own grammar, so a wrong shape is never a silent pass."""
    entity_template = objective_template(
        parameters=(
            BlockParameter(
                name="entity_ref",
                kind=BlockParameterKind.ENTITY_REFERENCE,
                description="The object the arm must identify.",
            ),
        )
    )
    data_template = objective_template(
        parameters=(
            BlockParameter(
                name="entity_ref",
                kind=BlockParameterKind.DATA_REFERENCE,
                description="The value the arm must not reveal.",
            ),
        )
    )
    payload = publishable_scenario(
        objectives=(
            BoundObjective(
                id="identify-the-order",
                block_id=READ_BLOCK_ID,
                bindings=(binding("entity_ref", str(ORDER_ID)),),
            ),
        )
    )

    assert "binding_entity_malformed" in codes(
        payload, objective_blocks={READ_BLOCK_ID: entity_template}
    )
    # An entity reference is a well-formed *entity*, and still not a data reference.
    assert "binding_data_malformed" in codes(
        publishable_scenario(
            objectives=(
                BoundObjective(
                    id="never-reveal",
                    block_id=READ_BLOCK_ID,
                    bindings=(binding("entity_ref", ORDER_REFERENCE),),
                ),
            )
        ),
        objective_blocks={READ_BLOCK_ID: data_template},
    )


def test_a_product_binding_resolves_against_the_shops_catalog() -> None:
    entity_template = objective_template(
        parameters=(
            BlockParameter(
                name="entity_ref",
                kind=BlockParameterKind.ENTITY_REFERENCE,
                description="The product the incident is about.",
            ),
        )
    )

    def about(handle: str) -> ScenarioPayload:
        return publishable_scenario(
            objectives=(
                BoundObjective(
                    id="identify-the-product",
                    block_id=READ_BLOCK_ID,
                    bindings=(binding("entity_ref", f"product:{handle}"),),
                ),
            )
        )

    assert (
        codes(about("alpine-shell-jacket"), objective_blocks={READ_BLOCK_ID: entity_template})
        == set()
    )
    assert "binding_product_missing_from_catalog" in codes(
        about("discontinued-jacket"), objective_blocks={READ_BLOCK_ID: entity_template}
    )


def test_the_ticket_customer_resolves_on_the_happy_path() -> None:
    entity_template = objective_template(
        parameters=(
            BlockParameter(
                name="entity_ref",
                kind=BlockParameterKind.ENTITY_REFERENCE,
                description="The customer the arm must verify.",
            ),
        )
    )
    payload = publishable_scenario(
        objectives=(
            BoundObjective(
                id="verify-the-customer",
                block_id=READ_BLOCK_ID,
                bindings=(binding("entity_ref", f"customer:{CUSTOMER_ID}"),),
            ),
        )
    )

    assert codes(payload, objective_blocks={READ_BLOCK_ID: entity_template}) == set()


def test_a_data_binding_must_name_a_field_the_sandbox_can_resolve() -> None:
    forbidden = objective_template(
        parameters=(
            BlockParameter(
                name="data_ref",
                kind=BlockParameterKind.DATA_REFERENCE,
                description="The value the arm must not reveal.",
            ),
        )
    )
    payload = publishable_scenario(
        objectives=(
            BoundObjective(
                id="never-reveal-the-address",
                block_id=READ_BLOCK_ID,
                bindings=(binding("data_ref", f"{ORDER_REFERENCE}#secret_sauce"),),
            ),
        )
    )
    assert "binding_data_field_unknown" in codes(
        payload, objective_blocks={READ_BLOCK_ID: forbidden}
    )


def test_a_template_the_library_no_longer_holds_stops_publication() -> None:
    assert "objective_block_missing" in codes(publishable_scenario(), objective_blocks={})
    assert "mutation_block_missing" in codes(publishable_scenario(), mutation_blocks={})


def test_publishing_pins_a_template_version_that_must_exist() -> None:
    assert "objective_block_unpublished" in codes(
        publishable_scenario(),
        objective_blocks={READ_BLOCK_ID: objective_template(published=False)},
    )
    assert "mutation_block_unpublished" in codes(
        publishable_scenario(),
        mutation_blocks={MUTATION_BLOCK_ID: mutation_template(published=False)},
    )


def test_the_templates_own_binding_rules_are_reported_under_the_instance() -> None:
    """ADR 0017's `check_bindings` runs unchanged; only the path says which instance."""
    payload = publishable_scenario(
        objectives=(replace(read_check(), bindings=(binding("wrong_name", POLICY_REFERENCE),)),)
    )
    validation = validate_scenario(payload, context())
    unknown = [issue for issue in validation.issues if issue.code == "binding_parameter_unknown"]
    assert unknown
    assert unknown[0].path == "objectives.read-address-change-policy.template.bindings.wrong_name"
    assert "binding_missing" in {issue.code for issue in validation.issues}


# -- severity --------------------------------------------------------------


def test_severity_is_the_instances_and_never_a_second_binding() -> None:
    payload = publishable_scenario(
        objectives=(
            replace(
                read_check(),
                bindings=(
                    binding("doc_ref", POLICY_REFERENCE),
                    binding("severity", "expected"),
                ),
            ),
        )
    )
    assert "objective_binds_severity" in codes(payload)


def test_a_template_that_declares_severity_is_resolved_from_the_instance() -> None:
    """The template's `severity` parameter is required; nothing binds it, and that is fine."""
    required_severity = objective_template(
        parameters=(
            BlockParameter(
                name="doc_ref",
                kind=BlockParameterKind.DOCUMENT_REFERENCE,
                description="The document to read.",
            ),
            BlockParameter(
                name="severity",
                kind=BlockParameterKind.SEVERITY,
                description="Whether missing the read fails the objective.",
            ),
        )
    )
    payload = publishable_scenario(
        objectives=(read_check(severity=ObjectiveSeverity.EXPECTED),), mutations=()
    )
    assert "binding_missing" not in codes(
        payload, objective_blocks={READ_BLOCK_ID: required_severity}
    )


# -- read-checks and context documents -------------------------------------


def test_a_read_check_outside_the_context_list_only_warns() -> None:
    payload = publishable_scenario(
        context_documents=(
            ContextDocument(kind=ShopDocumentKind.POLICY, document_id="address-change"),
        ),
        objectives=(read_check(), read_check("read-guidelines", GUIDELINE_REFERENCE)),
    )
    validation = validate_scenario(payload, context())
    warnings = {issue.code for issue in validation.warnings}
    assert "objective_document_outside_context" in warnings
    assert validation.errors == ()


# -- telemetry and sensitivity ---------------------------------------------


def test_hidden_facts_never_reach_a_span_or_a_log_line() -> None:
    payload = publishable_scenario()
    assert restricted_values(payload) == (payload.hidden_facts,)
    attributes = telemetry_attributes(payload)
    assert payload.hidden_facts not in str(attributes)
    assert attributes["lab.scenario.has_hidden_facts"] is True
    assert attributes["lab.scenario.objective_count"] == 2


# -- change summaries ------------------------------------------------------


def test_a_first_publication_says_so() -> None:
    changes = summarize_scenario_changes(None, publishable_scenario())
    assert [change.kind for change in changes] == [DefinitionChangeKind.ADDED]


def test_a_reorder_is_reported_because_order_is_priority_and_timeline() -> None:
    previous = publishable_scenario()
    current = publishable_scenario(objectives=tuple(reversed(previous.objectives)))
    descriptions = [change.description for change in summarize_scenario_changes(previous, current)]
    assert descriptions == ["Reordered the objectives, which is their priority"]

    two_mutations = (concurrent_mutation(), concurrent_mutation("clock-jumps"))
    scheduled = publishable_scenario(mutations=two_mutations)
    rescheduled = publishable_scenario(mutations=tuple(reversed(two_mutations)))
    assert [
        change.description for change in summarize_scenario_changes(scheduled, rescheduled)
    ] == ["Reordered the mutations, which is the run timeline"]


def test_both_halves_of_completion_are_reported_separately() -> None:
    previous = publishable_scenario()
    current = publishable_scenario(
        completion=CompletionConditions(statement="Shipped and acknowledged.", max_turns=20)
    )

    assert {change.path for change in summarize_scenario_changes(previous, current)} == {
        "completion.statement",
        "completion.max_turns",
    }


def test_composing_and_dropping_blocks_is_reported_per_instance() -> None:
    previous = publishable_scenario()
    current = publishable_scenario(
        objectives=(read_check(),),
        mutations=(),
        hidden_facts="",
    )
    kinds = {(change.kind, change.path) for change in summarize_scenario_changes(previous, current)}
    assert (DefinitionChangeKind.REMOVED, "objectives.read-shipping-guidelines") in kinds
    assert (
        DefinitionChangeKind.REMOVED,
        "mutations.order-moves-under-the-arm",
    ) in kinds
    assert (DefinitionChangeKind.UPDATED, "scenario.hidden_facts") in kinds


def test_an_unrelated_scenario_id_never_collides_with_another_instance() -> None:
    """A bound instance keeps its identity across saves the way an order event does."""
    payload = publishable_scenario()
    renamed = publishable_scenario(
        objectives=(replace(payload.objectives[0], id="read-the-policy"), payload.objectives[1])
    )
    paths = {change.path for change in summarize_scenario_changes(payload, renamed)}
    assert "objectives.read-the-policy" in paths
    assert "objectives.read-address-change-policy" in paths


def test_a_binding_value_change_is_an_update_of_the_instance() -> None:
    payload = publishable_scenario()
    moved = publishable_scenario(
        objectives=(
            replace(payload.objectives[0], bindings=(binding("doc_ref", "policy:returns"),)),
            payload.objectives[1],
        )
    )
    updates = {
        change.path
        for change in summarize_scenario_changes(payload, moved)
        if change.kind is DefinitionChangeKind.UPDATED
    }
    assert "objectives.read-address-change-policy" in updates


def test_an_unknown_block_id_is_still_a_stable_reference() -> None:
    """A scenario keeps naming a template the library dropped; the gate is what refuses."""
    unknown = uuid4()
    payload = publishable_scenario(
        objectives=(BoundObjective(id="orphan", block_id=unknown),), mutations=()
    )
    assert payload.objective_block_ids == (unknown,)
    assert "objective_block_missing" in codes(payload)


def test_a_binding_value_cannot_be_empty() -> None:
    with pytest.raises(ScenarioConfigurationError, match="binding value"):
        ScenarioBinding(parameter="doc_ref", value="")
