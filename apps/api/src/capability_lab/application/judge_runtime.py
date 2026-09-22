"""The port a judge runs through, and nothing about which provider runs it.

The support agent got its own port in ADR 0026 because an arm discovers a world through
tools. A judge does none of that: it is shown a document, it reads a rubric, and it answers
with one verdict. So this port is deliberately much smaller, and its shape enforces the
three things the plan asks of a judge.

**It cannot reach the world.** There is no invoker, no sandbox, no repository. A judge that
could look something up would be able to see what the brief was built to hide.

**It answers in the lab's vocabulary or not at all.** The return type is a `JudgeOutcome`
and a rationale. A provider that produced something else is an `INVALID_RESPONSE`, not a
value the lab tries to interpret — a judge whose free text were parsed for a verdict would
make the scale depend on a model's phrasing.

**A failure is classified, not described.** Same discipline as an agent turn: a provider's
message is neither stable across models nor safe to store beside synthetic customer content,
so it never becomes evidence.

The registry is keyed by **provider**, not by a framework. A judge makes no tool calls and
keeps no memory, so what a judge configuration names that could change its answer is the
provider, the model, the rubric, and what it was shown — there is no framework dimension to
compare, and inventing one would be a table with a single meaningful column.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol

from capability_lab.application.canonical_json import CanonicalValue
from capability_lab.domain.judge import JudgeModel, JudgeOutcome
from capability_lab.domain.judgement import JudgeFailure

__all__ = [
    "JudgeProviderError",
    "JudgeRequest",
    "JudgeResponseError",
    "JudgeRuntime",
    "JudgeRuntimeError",
    "JudgeRuntimeRegistry",
    "JudgeTransientError",
    "JudgeUnavailableError",
    "JudgeVerdict",
]


class JudgeRuntimeError(RuntimeError):
    """A judge execution that produced no verdict, classified by where it broke.

    The base carries a value rather than a bare annotation: the recorder reads `failure`
    inside its handler, so an adapter that raised this class directly would break the
    classification machinery from inside the code that exists to classify it. An unclassified
    failure is an unusable answer, which is what the default says.
    """

    failure: JudgeFailure = JudgeFailure.INVALID_RESPONSE


class JudgeProviderError(JudgeRuntimeError):
    failure = JudgeFailure.PROVIDER


class JudgeTransientError(JudgeRuntimeError):
    failure = JudgeFailure.TRANSIENT


class JudgeResponseError(JudgeRuntimeError):
    failure = JudgeFailure.INVALID_RESPONSE


class JudgeUnavailableError(RuntimeError):
    """No runtime for this provider is running in this process.

    Deliberately **not** a `JudgeRuntimeError`, so it can never be recorded as a judgement.
    A missing API key is a fact about the operator's machine; writing it into an evaluation
    would put the lab's configuration into a result. Same separation ADR 0026 made between
    a framework this process cannot run and a run that failed.
    """


@dataclass(frozen=True, slots=True)
class JudgeVerdict:
    """What one judge answered about one objective."""

    outcome: JudgeOutcome
    rationale: str = ""


@dataclass(frozen=True, slots=True)
class JudgeRequest:
    """Everything a runtime is given to score one objective of one arm.

    The brief is the anonymized document (`judge_brief`), passed as data rather than as
    rendered prose: a runtime decides how to present it to its own provider, and the lab
    keeps one canonical input whose fingerprint travels with the verdict.
    """

    rubric: str
    model: JudgeModel
    brief: Mapping[str, CanonicalValue]


class JudgeRuntime(Protocol):
    """One provider's implementation of scoring a rubric against a brief."""

    @property
    def provider(self) -> str: ...

    @property
    def model_base_url(self) -> str | None:
        """The endpoint this judge reaches, or `None` when it reaches no provider.

        The same rule an arm's runtime answers by, because a judge reaches a provider too
        (ADR 0031) and an execution that cannot say where it went is as unexplainable as an
        arm that cannot. The declared control judge reaches nothing, and its recorded
        endpoint is `None` (ADR 0052).
        """
        return None

    async def score(self, request: JudgeRequest) -> JudgeVerdict:
        """The verdict, or a classified `JudgeRuntimeError` if none was produced."""
        ...


class JudgeRuntimeRegistry:
    """The judges this process can actually run, chosen by composition.

    Kept apart from `PROVEN_JUDGES` for the reason ADR 0024 kept the capability catalog
    apart from the adapter registry: the catalog answers "may an author publish this", which
    must not change with the machine, while this answers "can this process run it right
    now", which does.
    """

    def __init__(self, runtimes: Mapping[str, JudgeRuntime]) -> None:
        self._runtimes = dict(runtimes)

    def get(self, provider: str) -> JudgeRuntime:
        runtime = self._runtimes.get(provider)
        if runtime is None:
            raise JudgeUnavailableError(
                f"no {provider} judge runtime is available in this lab; this judge cannot "
                "score here until one is configured"
            )
        return runtime

    def providers(self) -> tuple[str, ...]:
        return tuple(sorted(self._runtimes))
