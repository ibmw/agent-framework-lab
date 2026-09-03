"""The usage a framework reports and the price table the lab converts it with (ADR 0032)."""

from decimal import Decimal

import pytest

from capability_lab.application.agent_capabilities import PROVEN_FRAMEWORKS
from capability_lab.application.model_cost import (
    COST_CURRENCY,
    MODEL_PRICES,
    ModelCostError,
    ModelUsage,
    estimate_cost,
    price_for,
    total_usage,
)


def test_usage_counts_cannot_be_negative() -> None:
    with pytest.raises(ModelCostError):
        ModelUsage(input_tokens=-1, output_tokens=0, model_requests=1)


def test_tokens_cannot_be_spent_without_a_request_that_spent_them() -> None:
    """The one incoherence worth refusing: a meter reading nobody could have produced."""
    with pytest.raises(ModelCostError):
        ModelUsage(input_tokens=10, output_tokens=0, model_requests=0)


def test_calling_no_model_is_zero_rather_than_unknown() -> None:
    """The control arm's reading. `none()` is a measurement; `None` is the absence of one."""
    assert ModelUsage.none() == ModelUsage(input_tokens=0, output_tokens=0, model_requests=0)


def test_usage_totals_only_what_was_actually_reported() -> None:
    """An unreported attempt is skipped, never counted as zero: the total is what is known."""
    reported = (
        ModelUsage(input_tokens=100, output_tokens=20, model_requests=1),
        None,
        ModelUsage(input_tokens=50, output_tokens=10, model_requests=2),
    )

    assert total_usage(reported) == ModelUsage(input_tokens=150, output_tokens=30, model_requests=3)


def test_an_arm_nobody_metered_has_no_total_at_all() -> None:
    """The difference between "this cost nothing" and "nobody said"."""
    assert total_usage((None, None)) is None


def test_a_cost_is_the_declared_rate_applied_to_the_reported_tokens() -> None:
    price = price_for("openai", "gpt-5-mini")
    assert price is not None

    cost = estimate_cost(
        ModelUsage(input_tokens=1_000_000, output_tokens=1_000_000, model_requests=4),
        "openai",
        "gpt-5-mini",
    )

    assert cost is not None
    assert cost.amount == price.input_per_million + price.output_per_million
    assert cost.currency == COST_CURRENCY


def test_a_short_run_is_priced_below_a_cent_rather_than_rounded_away() -> None:
    """Two fractional digits would report most of this lab's runs as free."""
    cost = estimate_cost(
        ModelUsage(input_tokens=1_000, output_tokens=200, model_requests=2),
        "openai",
        "gpt-5-mini",
    )

    assert cost is not None
    assert cost.amount == Decimal("0.000650")
    assert cost.canonical_amount == "0.000650"


def test_the_control_arm_costs_nothing_rather_than_being_unpriced() -> None:
    cost = estimate_cost(ModelUsage.none(), "fake", "deterministic")

    assert cost is not None
    assert cost.amount == Decimal("0")


def test_a_model_the_lab_never_priced_has_no_estimate() -> None:
    """Never a zero. A missing rate is the lab not knowing, and zero is a claim."""
    assert estimate_cost(ModelUsage.none(), "openai", "some-unpriced-model") is None


def test_usage_nobody_reported_has_no_estimate_however_well_priced_the_model_is() -> None:
    assert estimate_cost(None, "openai", "gpt-5-mini") is None


def test_every_proven_model_carries_a_declared_rate() -> None:
    """The table and the capability catalog are edited together or this fails.

    A model an author may publish is a model a run can spend at, so an unpriced one would
    produce a comparison with an empty cost column and no explanation for it.
    """
    proven = {
        (provider, model)
        for framework in PROVEN_FRAMEWORKS
        for provider in framework.providers
        for model in framework.models
    }

    assert proven <= set(MODEL_PRICES)


def test_an_estimate_carries_the_date_of_the_rate_that_produced_it() -> None:
    """A price nobody can date is a number nobody can check, so the date travels with it."""
    price = price_for("openai", "gpt-5-mini")
    assert price is not None

    cost = estimate_cost(ModelUsage.none(), "openai", "gpt-5-mini")

    assert cost is not None
    assert cost.recorded_on == price.recorded_on
