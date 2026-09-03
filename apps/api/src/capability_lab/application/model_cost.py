"""What one attempt spent at the model, and what the lab estimates that was worth.

`PLAN.md` Milestone 5 asks a run to record token usage and an estimated cost "when
available". This is the vocabulary that makes both halves of that sentence expressible: a
neutral usage shape a framework reports into, and a declared price table the lab converts it
with. Neither is evidence about the agent's behavior — they are the meter beside the run.

Four decisions shape it.

**Usage is reported, never inferred.** A framework meters its own provider calls, so the
value comes back through the runtime port and is written down. Nothing here counts tokens,
estimates them from message lengths, or reconstructs them from a transcript: a number the
lab guessed would be indistinguishable, in a comparison, from one a provider billed.

**"No model was called" and "nothing was reported" are different absences.** The
deterministic control arm calls no provider at all, which is a *fact* about it and is
recorded as `ModelUsage.none()` — zeros, with zero requests. A framework the lab cannot get
usage out of reports `None`, and every total it takes part in says so. Collapsing the two
would let a free arm and an unmetered arm read alike, which is exactly the confusion a cost
comparison exists to avoid.

**The price table is declared apart from the adapters**, in the same spirit as
`PROVEN_FRAMEWORKS` (ADR 0024) and `sandbox_tool_contracts` (ADR 0021): it is the lab's own
record of what a model was listed at, testable offline, and it changes when someone edits it
rather than when a provider's API answers differently. A model absent from it has no
estimate — never a zero, because zero is a claim.

**A cost is an estimate and is labeled one.** It is derived from listed per-token rates at
the date each one records, and is never stored: it is recomputed from the usage that *is*
stored, so correcting a rate corrects every historical estimate at once and no record ever
holds two prices for one run.

It ignores caching, batching, and negotiated pricing, and the direction of that error is
knowable rather than unknown: a provider that reports cached reads *inside* its prompt token
count is billed less for them than the listed input rate, so an estimate over a cached
conversation is an **upper bound**. It is never an under-statement, which is the half that
would matter — a cost reading that could quietly be too low is worse than one that cannot.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from functools import partial
from types import MappingProxyType

from capability_lab.domain.content import require_non_negative_int
from capability_lab.domain.entities import DomainError

__all__ = [
    "COST_CURRENCY",
    "COST_EXPONENT",
    "MODEL_PRICES",
    "EstimatedCost",
    "ModelCostError",
    "ModelPrice",
    "ModelUsage",
    "estimate_cost",
    "price_for",
    "total_usage",
]


class ModelCostError(DomainError):
    """Raised when reported usage or a declared price is incoherent."""


_require_non_negative_int = partial(require_non_negative_int, error=ModelCostError)

COST_CURRENCY = "USD"
"""The one currency the lab's declared rates are listed in.

Not `domain.shop.Currency`: that is a shop's commerce currency and a synthetic shop may
price in euros while the models it is compared with are billed in dollars. A run's cost is
the lab's, not the shop's."""

COST_EXPONENT = Decimal("0.000001")
"""Six fractional digits, because a short run genuinely costs less than a cent.

`domain.shop.Money` stops at two, which is right for an order total and would round most of
this lab's runs to zero."""

_PER_MILLION = Decimal(1_000_000)


@dataclass(frozen=True, slots=True)
class ModelUsage:
    """What one attempt asked of a provider, in the units every provider bills in.

    Deliberately three numbers and no provider detail. Cache reads, audio tokens, and
    reasoning breakdowns differ by provider and by model generation, and a comparison across
    two frameworks needs the columns to line up more than it needs any one of them to be
    complete. What a framework reports beyond this is not lost — it is simply not evidence
    the lab claims to compare.

    `model_requests` is how many times the provider was actually called, which is the
    "model calls" half of the frame's `model / tool calls` reading. One attempt is one turn
    and many requests: a tool-using agent asks again after every answer it gets back.
    """

    input_tokens: int
    output_tokens: int
    model_requests: int

    def __post_init__(self) -> None:
        _require_non_negative_int(self.input_tokens, "input tokens")
        _require_non_negative_int(self.output_tokens, "output tokens")
        _require_non_negative_int(self.model_requests, "model requests")
        if self.model_requests == 0 and (self.input_tokens or self.output_tokens):
            raise ModelCostError("tokens cannot be spent without a request that spent them")

    @classmethod
    def none(cls) -> ModelUsage:
        """An attempt that called no model at all — the control arm's honest reading."""
        return cls(input_tokens=0, output_tokens=0, model_requests=0)

    def __add__(self, other: ModelUsage) -> ModelUsage:
        return ModelUsage(
            input_tokens=self.input_tokens + other.input_tokens,
            output_tokens=self.output_tokens + other.output_tokens,
            model_requests=self.model_requests + other.model_requests,
        )

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


@dataclass(frozen=True, slots=True)
class EstimatedCost:
    """What the declared rates say one usage total was worth, and how old they are.

    `recorded_on` travels with the amount rather than being left in the table, because the
    two are one reading: an operator comparing a cost has to be able to see that the rate
    behind it was read months ago, and a client that had to look the rate up again could
    show a number and a date that were never computed together.
    """

    amount: Decimal
    recorded_on: date
    currency: str = COST_CURRENCY

    def __post_init__(self) -> None:
        if not self.amount.is_finite():
            raise ModelCostError("an estimated cost must be a finite decimal")
        if self.amount < 0:
            raise ModelCostError("an estimated cost cannot be negative")

    @property
    def canonical_amount(self) -> str:
        return f"{self.amount:f}"


@dataclass(frozen=True, slots=True)
class ModelPrice:
    """One model's listed rate, per million tokens, as the lab recorded it."""

    provider: str
    model_id: str
    input_per_million: Decimal
    output_per_million: Decimal
    recorded_on: date
    """The date the rate was read off the provider's public pricing page.

    A price without a date is a number nobody can check. It travels with every estimate it
    produces, so an operator reading a cost knows how old the rate behind it is rather than
    discovering months later that a comparison was priced at a rate that had since moved."""

    def cost(self, usage: ModelUsage) -> EstimatedCost:
        amount = (
            Decimal(usage.input_tokens) * self.input_per_million
            + Decimal(usage.output_tokens) * self.output_per_million
        ) / _PER_MILLION
        return EstimatedCost(amount=amount.quantize(COST_EXPONENT), recorded_on=self.recorded_on)


# Every (provider, model) pair the lab has proven it can run, and nothing else. A model an
# author cannot publish is a model no run can spend anything at, so a rate for it would be a
# claim about a comparison that cannot happen. `test_model_cost` holds the table and
# `PROVEN_FRAMEWORKS` to that agreement, so a newly proven model arrives priced or is
# deliberately recorded as unpriced.
MODEL_PRICES: Mapping[tuple[str, str], ModelPrice] = MappingProxyType(
    {
        ("openai", "gpt-5-mini"): ModelPrice(
            provider="openai",
            model_id="gpt-5-mini",
            input_per_million=Decimal("0.25"),
            output_per_million=Decimal("2.00"),
            recorded_on=date(2026, 9, 1),
        ),
        # The control arm calls no provider, so its rate is zero rather than absent: an arm
        # that spends nothing has an estimate of nothing, and a comparison against a
        # model-backed arm should read "$0.00" rather than "unknown".
        ("fake", "deterministic"): ModelPrice(
            provider="fake",
            model_id="deterministic",
            input_per_million=Decimal("0"),
            output_per_million=Decimal("0"),
            recorded_on=date(2026, 9, 1),
        ),
    }
)


def price_for(provider: str, model_id: str) -> ModelPrice | None:
    """The declared rate for one model, or nothing when the lab has not recorded one."""
    return MODEL_PRICES.get((provider, model_id))


def estimate_cost(usage: ModelUsage | None, provider: str, model_id: str) -> EstimatedCost | None:
    """What this usage was worth, or nothing when either half of the answer is missing.

    Two different absences produce the same `None` on purpose: usage nobody reported and a
    model nobody priced are both "the lab cannot say", and a client that had to tell them
    apart to render a dash would be rendering the difference between two things it cannot
    act on either way. Which one it was is readable from the usage beside it.
    """
    if usage is None:
        return None
    price = price_for(provider, model_id)
    return None if price is None else price.cost(usage)


def total_usage(reported: tuple[ModelUsage | None, ...]) -> ModelUsage | None:
    """Sum what was reported, and report nothing when nothing was.

    An unreported attempt is skipped rather than counted as zero — the total is what the
    lab actually knows was spent — but a run in which *no* attempt reported anything has no
    total at all, which is the difference between "this cost nothing" and "nobody said".
    """
    known = tuple(entry for entry in reported if entry is not None)
    if not known:
        return None
    total = known[0]
    for entry in known[1:]:
        total = total + entry
    return total
