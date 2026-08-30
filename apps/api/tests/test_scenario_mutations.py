"""What the lab can actually carry out, and the schedule it reads off a recipe (ADR 0028)."""

from uuid import UUID, uuid4

from block_factories import parameter, publishable_mutation, timing_parameter
from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.application.sandbox_tool_contracts import ORDER_DETAIL, ORDER_LIST
from capability_lab.application.sandbox_tools import ToolOutcome
from capability_lab.application.scenario_mutations import (
    APPLIABLE_MUTATIONS,
    MUTATION_APPLIERS,
    PinnedTemplate,
    entities_read,
    mutation_issues,
    schedule_of,
)
from capability_lab.domain.blocks import (
    BlockParameterKind,
    MutationBlockPayload,
    MutationEffect,
    MutationTimingKind,
)
from capability_lab.domain.scenario import BoundMutation, ScenarioBinding, ScenarioEntityKind
from scenario_factories import (
    MUTATION_BLOCK_ID,
    ORDER_ID,
    ORDER_REFERENCE,
    concurrent_mutation,
    publishable_scenario,
)


def templates(
    payload: MutationBlockPayload | None = None, version: int = 1
) -> dict[UUID, PinnedTemplate]:
    return {
        MUTATION_BLOCK_ID: PinnedTemplate(
            payload=payload or publishable_mutation(), version=version
        )
    }


def bound(**bindings: str) -> BoundMutation:
    return BoundMutation(
        id="order-moves-under-the-arm",
        block_id=MUTATION_BLOCK_ID,
        bindings=tuple(
            ScenarioBinding(parameter=name, value=value) for name, value in bindings.items()
        ),
    )


def codes(scenario_mutations: tuple[BoundMutation, ...], **template: object) -> list[str]:
    scenario = publishable_scenario(mutations=scenario_mutations)
    pinned = templates(publishable_mutation(**template) if template else None)
    return [issue.code for issue in mutation_issues(scenario, pinned)]


# -- what this build can carry out ---------------------------------------------


def test_the_wrong_address_fault_is_one_this_build_applies() -> None:
    assert codes((concurrent_mutation(),)) == []


def test_an_effect_no_build_injects_yet_refuses_the_experiment() -> None:
    """Authoring stays free; starting an experiment that would never fault does not."""
    findings = codes((concurrent_mutation(),), effect=MutationEffect.TOOL_FAULT)

    assert findings == ["mutation_effect_not_appliable"]


def test_a_moment_no_run_can_observe_refuses_the_experiment() -> None:
    findings = codes((bound(entity_ref=ORDER_REFERENCE, timing="at_offset:PT30M"),))

    assert findings == ["mutation_timing_not_observable"]


def test_an_entity_the_applier_cannot_move_refuses_the_experiment() -> None:
    findings = codes((bound(entity_ref=f"customer:{uuid4()}", timing="after_first_read"),))

    assert findings == ["mutation_entity_not_appliable"]


def test_a_template_that_names_no_single_entity_refuses_the_experiment() -> None:
    """One bound entity is the applier's requirement, so it is checked where the applier is."""
    findings = codes((concurrent_mutation(),), parameters=(timing_parameter(),))

    assert findings == ["mutation_without_single_entity"]


def test_a_fault_named_too_long_to_record_its_own_history_refuses_the_experiment() -> None:
    """An order's event IDs are unique, so a name that cannot fit is a finding, not a crash."""
    named = BoundMutation(
        id=f"order-moves-under-the-arm-{'x' * 30}",
        block_id=MUTATION_BLOCK_ID,
        bindings=(
            ScenarioBinding(parameter="entity_ref", value=ORDER_REFERENCE),
            ScenarioBinding(parameter="timing", value="after_first_read"),
        ),
    )

    assert codes((named,)) == ["mutation_id_too_long_to_record"]


def test_a_fault_the_gate_refuses_for_its_name_never_reaches_the_schedule() -> None:
    named = BoundMutation(
        id=f"order-moves-under-the-arm-{'x' * 30}",
        block_id=MUTATION_BLOCK_ID,
        bindings=(
            ScenarioBinding(parameter="entity_ref", value=ORDER_REFERENCE),
            ScenarioBinding(parameter="timing", value="after_first_read"),
        ),
    )

    assert schedule_of(publishable_scenario(mutations=(named,)), templates()) == ()


def test_a_template_the_scenario_does_not_pin_refuses_the_experiment() -> None:
    scenario = publishable_scenario(mutations=(concurrent_mutation(),))

    findings = [issue.code for issue in mutation_issues(scenario, {})]

    assert findings == ["mutation_template_unresolvable"]


def test_a_recipe_with_no_mutations_refuses_nothing() -> None:
    assert mutation_issues(publishable_scenario(mutations=()), templates()) == ()


def test_every_appliable_effect_names_the_code_that_performs_it() -> None:
    """The table the timeline resolves a source location from is the table that runs."""
    assert set(MUTATION_APPLIERS) == set(APPLIABLE_MUTATIONS)
    for effect, contract in APPLIABLE_MUTATIONS.items():
        assert MUTATION_APPLIERS[effect] is contract.applier
        assert contract.entity_kinds


def test_the_entity_mutation_is_applied_to_orders_alone() -> None:
    contract = APPLIABLE_MUTATIONS[MutationEffect.ENTITY_MUTATION]

    assert contract.entity_kinds == frozenset({ScenarioEntityKind.ORDER})


# -- the schedule --------------------------------------------------------------


def test_the_schedule_resolves_each_fault_against_the_template_it_pinned() -> None:
    scenario = publishable_scenario(mutations=(concurrent_mutation(),))

    scheduled = schedule_of(scenario, templates(version=4))

    assert len(scheduled) == 1
    fault = scheduled[0]
    assert fault.mutation_id == "order-moves-under-the-arm"
    assert fault.block_id == MUTATION_BLOCK_ID
    assert fault.block_version == 4
    assert fault.effect is MutationEffect.ENTITY_MUTATION
    assert fault.timing.kind is MutationTimingKind.AFTER_FIRST_READ
    assert fault.timing_value == "after_first_read"
    assert fault.target_id == ORDER_ID


def test_the_schedule_keeps_the_order_the_recipe_composed() -> None:
    """Mutation order is the run timeline (ADR 0018), so it is content rather than a sort."""
    first, second = concurrent_mutation("first-fault"), concurrent_mutation("second-fault")

    scheduled = schedule_of(publishable_scenario(mutations=(first, second)), templates())

    assert [fault.mutation_id for fault in scheduled] == ["first-fault", "second-fault"]


def test_the_schedule_leaves_out_what_this_build_cannot_carry_out() -> None:
    """A promise nothing keeps is worse than an absence: the gate already refused this."""
    scenario = publishable_scenario(
        mutations=(bound(entity_ref=ORDER_REFERENCE, timing="at_offset:PT30M"),)
    )

    assert schedule_of(scenario, templates()) == ()


def test_a_template_parameter_is_read_by_kind_rather_than_by_name() -> None:
    """An author names the parameters; the runtime finds them by what they are."""
    renamed = publishable_mutation(
        parameters=(
            parameter(
                "moves_this",
                kind=BlockParameterKind.ENTITY_REFERENCE,
                description="The order that moves under the arm.",
            ),
            timing_parameter("fires_when"),
        )
    )

    scheduled = schedule_of(
        publishable_scenario(
            mutations=(bound(moves_this=ORDER_REFERENCE, fires_when="at_turn:2"),)
        ),
        templates(renamed),
    )

    assert [fault.timing_value for fault in scheduled] == ["at_turn:2"]
    assert [fault.target_id for fault in scheduled] == [ORDER_ID]


# -- what a call revealed ------------------------------------------------------


def result(
    outcome: ToolOutcome = ToolOutcome.SUCCESS, **data: CanonicalValue
) -> dict[str, CanonicalValue]:
    """One `tool-result-v1` envelope, as the recorded event stores it."""
    return {"outcome": outcome.value, "data": dict(data)}


def test_reading_the_order_is_what_makes_a_read_bound_fault_due() -> None:
    assert entities_read(ORDER_DETAIL, result(order_id=str(ORDER_ID))) == frozenset({ORDER_ID})


def test_a_refused_read_reveals_nothing() -> None:
    assert entities_read(ORDER_DETAIL, result(ToolOutcome.REFUSED)) == frozenset()


def test_listing_the_customer_s_orders_is_not_reading_one() -> None:
    """A listing says an order exists; reading it is what puts the address in front of the agent."""
    answered = result(orders=[{"order_id": str(ORDER_ID)}])

    assert entities_read(ORDER_LIST, answered) == frozenset()
