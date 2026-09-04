"""Experiment-first history: every run this lab has made, narrowed and paged.

The bench lists what has been started in one shop, newest first, so an operator can get
back to what they were driving. History answers a different question — "what has this lab
run, and which of those runs is worth reopening" — and it answers it across shops, because
an operator comparing two frameworks is not comparing two shops.

Three rules live here.

**A row is projected, never stored.** Every number on a history row is the reading the bench
and the results screen already show: the arm standing (ADR 0029), the objective evaluation
(ADR 0030), and the versions the experiment pinned (ADR 0025). A denormalized summary column
beside the record would be free to disagree with the screen the operator opens next, which is
the contradiction ADR 0033 refused one level in.

**A filter that needs a reading is applied over the reading.** Shop, scenario, and date are
record columns and could be narrowed in SQL; status, objective outcome, and framework exist
only once an experiment has been read. Rather than filter in two places by two rules, every
experiment is projected and every filter is applied here. That is the honest cost of a
history whose columns are projections, and it is where a lab with thousands of experiments
would first need work — the record columns are indexed and the pre-filter is the obvious
first move.

**The filter options are the history's own.** The dropdowns are built from every experiment
in the record rather than from the definition libraries, so they offer exactly what has
actually been run: a scenario nobody ran is not a way to narrow history, and a shop deleted
from the studio would still name the runs it produced. They are deliberately not narrowed by
the current filters — an operator who has chosen one shop must still be able to choose
another.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from capability_lab.application.agent_capabilities import PROVEN_FRAMEWORKS_BY_ID
from capability_lab.application.definition_authoring import DefinitionRepository
from capability_lab.application.evaluation import ExperimentEvaluationService
from capability_lab.application.experiments import (
    ArmRuntime,
    ExperimentRecord,
    ExperimentRepository,
    ExperimentService,
    RunRecord,
)
from capability_lab.application.pagination import DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT
from capability_lab.domain.definitions import DefinitionId, DefinitionType
from capability_lab.domain.evaluation import (
    ArmEvaluation,
    ExperimentStatus,
    ObjectiveOutcome,
    stand_experiment,
)
from capability_lab.domain.experiment import ArmAwaiting
from capability_lab.domain.scenario import ScenarioPayload
from capability_lab.domain.shop import ShopPayload

__all__ = [
    "ExperimentHistoryEntry",
    "ExperimentHistoryPage",
    "ExperimentHistoryQuery",
    "ExperimentHistoryService",
    "HistoryArm",
    "HistoryFacet",
]


@dataclass(frozen=True, slots=True)
class ExperimentHistoryQuery:
    """How an operator narrows history, and which page of what is left they are on.

    Every filter is optional and they combine by conjunction. `text` matches what a row
    *shows* — its name, its scenario, its shop, and what each arm ran — because the search
    box sits above those columns and an operator searching "beacon" means the row that says
    beacon.
    """

    shop_id: UUID | None = None
    scenario_id: UUID | None = None
    framework_id: str = ""
    status: ExperimentStatus | None = None
    outcome: ObjectiveOutcome | None = None
    started_after: datetime | None = None
    started_before: datetime | None = None
    text: str = ""
    page: int = 1
    page_size: int = DEFAULT_PAGE_LIMIT


@dataclass(frozen=True, slots=True)
class HistoryArm:
    """One arm as a history row shows it: what it ran, where it stopped, and how it did.

    `met` out of `decided` per arm and never added across them, for the reason ADR 0033 gave
    the results screen: two arms driven to different depths hold different denominators, so
    a sum would report the operator's own pacing as a difference between configurations.
    """

    run_id: UUID
    label: str
    configuration_id: UUID
    configuration_version: int
    configuration_name: str
    framework_id: str
    framework_label: str
    model_id: str
    awaiting: ArmAwaiting
    met: int
    decided: int
    failed: bool


@dataclass(frozen=True, slots=True)
class ExperimentHistoryEntry:
    """One experiment as history shows it, over the record it is projected from.

    `scenario_name` is the name the version this experiment pinned was published under, so a
    row keeps saying what it ran after the recipe is renamed. `shop_name` is deliberately the
    other way round: the shop is an identity here rather than a version — it is what the
    shop filter narrows by — and a row filed under a shop should carry the name that shop
    answers to now.

    `scenario_superseded` says a newer version of that recipe has since been published. It is
    provenance, not a warning: a historical experiment stays reproducible from the versions
    it pinned (ADR 0025), and this is what tells an operator that rerunning the scenario as it
    reads today would not be rerunning this.
    """

    record: ExperimentRecord
    shop_name: str
    scenario_name: str
    scenario_superseded: bool
    status: ExperimentStatus
    arms: tuple[HistoryArm, ...]


@dataclass(frozen=True, slots=True)
class HistoryFacet:
    """One option a history filter offers, as the runs themselves name it."""

    id: str
    label: str


@dataclass(frozen=True, slots=True)
class ExperimentHistoryPage:
    """One page of history, what it was cut out of, and what else could be asked for."""

    entries: tuple[ExperimentHistoryEntry, ...]
    page: int
    page_size: int
    total: int
    shops: tuple[HistoryFacet, ...]
    scenarios: tuple[HistoryFacet, ...]
    frameworks: tuple[HistoryFacet, ...]


@dataclass(frozen=True, slots=True)
class _Projected:
    """A row and the two things filtering it needs that the row itself does not show."""

    entry: ExperimentHistoryEntry
    outcomes: frozenset[ObjectiveOutcome]
    haystack: str


class ExperimentHistoryService:
    """Read every experiment in the lab as one narrowable, paged listing.

    Takes the same `ExperimentService` the evaluation is built over, deliberately: the
    standing on a history row and the objectives beside it must be one reading of one
    experiment, exactly as they are on the bench.
    """

    def __init__(
        self,
        experiments: ExperimentRepository,
        details: ExperimentService,
        evaluations: ExperimentEvaluationService,
        shops: DefinitionRepository[ShopPayload],
        scenarios: DefinitionRepository[ScenarioPayload],
    ) -> None:
        self._experiments = experiments
        self._details = details
        self._evaluations = evaluations
        self._shops = shops
        self._scenarios = scenarios

    def history(self, query: ExperimentHistoryQuery) -> ExperimentHistoryPage:
        # Resolved once per listing rather than per row: a lab's experiments cluster on a
        # handful of shops and scenarios, and the name of one does not change mid-read.
        shop_names: dict[UUID, str] = {}
        latest_scenarios: dict[UUID, int | None] = {}
        projected = tuple(
            self._project(record, shop_names, latest_scenarios)
            for record in self._experiments.list_all()
        )
        # Normalized once for the whole listing rather than per row: the needle does not
        # change between two rows of one read.
        needle = query.text.strip().lower()
        matching = tuple(row for row in projected if _matches(row, query, needle))
        # The contract already refuses a page or a size outside these bounds; clamping here
        # keeps a caller that is not the HTTP layer from asking for a page that cannot exist.
        page_size = min(MAX_PAGE_LIMIT, max(1, query.page_size))
        page = max(1, query.page)
        start = (page - 1) * page_size
        return ExperimentHistoryPage(
            entries=tuple(row.entry for row in matching[start : start + page_size]),
            page=page,
            page_size=page_size,
            total=len(matching),
            shops=_facets(
                (str(row.entry.record.shop_id), row.entry.shop_name) for row in projected
            ),
            scenarios=_facets(
                (str(row.entry.record.scenario_id), row.entry.scenario_name) for row in projected
            ),
            frameworks=_facets(
                (arm.framework_id, arm.framework_label)
                for row in projected
                for arm in row.entry.arms
            ),
        )

    def _project(
        self,
        record: ExperimentRecord,
        shop_names: dict[UUID, str],
        latest_scenarios: dict[UUID, int | None],
    ) -> _Projected:
        detail = self._details.get_experiment(record.shop_id, record.experiment_id)
        evaluation = self._evaluations.evaluate_detail(detail)
        arms = tuple(
            _arm(run, runtime, standing.awaiting, judged)
            for run, runtime, standing, judged in zip(
                detail.runs, detail.arm_runtimes, detail.standings, evaluation.arms, strict=True
            )
        )
        entry = ExperimentHistoryEntry(
            record=record,
            shop_name=self._shop_name(record.shop_id, shop_names),
            scenario_name=detail.scenario.payload.name,
            scenario_superseded=self._superseded(record, latest_scenarios),
            status=stand_experiment(detail.standings, evaluation.arms),
            arms=arms,
        )
        return _Projected(
            entry=entry,
            outcomes=frozenset(
                result.outcome for judged in evaluation.arms for result in judged.results
            ),
            haystack=" ".join(
                (
                    entry.record.label,
                    entry.scenario_name,
                    entry.shop_name,
                    *(arm.configuration_name for arm in arms),
                    *(arm.framework_label for arm in arms),
                    *(arm.model_id for arm in arms),
                )
            ).lower(),
        )

    def _shop_name(self, shop_id: UUID, cache: dict[UUID, str]) -> str:
        if shop_id not in cache:
            draft = self._shops.get_draft(DefinitionId(DefinitionType.SHOP, shop_id))
            # A shop whose draft is gone still named the runs it produced, so the row falls
            # back to the identifier rather than dropping out of its own history.
            cache[shop_id] = str(shop_id) if draft is None else draft.payload.identity.name
        return cache[shop_id]

    def _superseded(self, record: ExperimentRecord, cache: dict[UUID, int | None]) -> bool:
        if record.scenario_id not in cache:
            cache[record.scenario_id] = self._scenarios.latest_published_version(
                DefinitionId(DefinitionType.SCENARIO, record.scenario_id)
            )
        latest = cache[record.scenario_id]
        return latest is not None and latest > record.scenario_version


def _arm(
    run: RunRecord,
    runtime: ArmRuntime,
    awaiting: ArmAwaiting,
    judged: ArmEvaluation,
) -> HistoryArm:
    """One arm's row: the version it pinned, where it stopped, and what its record answered.

    The configuration is named from the run and from the runtime together — the identity and
    version the arm was started with, and the name and framework read out of that exact
    published version — so a row says what ran rather than what that configuration is now.
    """
    return HistoryArm(
        run_id=run.run_id,
        label=run.label,
        configuration_id=run.agent_configuration_id,
        configuration_version=run.agent_configuration_version,
        configuration_name=runtime.configuration_name,
        framework_id=runtime.framework_id,
        framework_label=_framework_label(runtime.framework_id),
        model_id=runtime.model_id,
        awaiting=awaiting,
        met=judged.met,
        decided=len(judged.decided),
        failed=judged.failed,
    )


def _framework_label(framework_id: str) -> str:
    framework = PROVEN_FRAMEWORKS_BY_ID.get(framework_id)
    return framework_id if framework is None else framework.label


def _facets(values: Iterable[tuple[str, str]]) -> tuple[HistoryFacet, ...]:
    """The distinct options a set of rows offers, in the order a person reads them.

    First name wins where two rows disagree, and the rows arrive newest first: a definition
    renamed between two runs is offered under the name it answers to most recently.
    """
    seen: dict[str, str] = {}
    for identifier, label in values:
        seen.setdefault(identifier, label)
    return tuple(
        HistoryFacet(id=identifier, label=label)
        for identifier, label in sorted(seen.items(), key=lambda item: item[1].lower())
    )


def _matches(row: _Projected, query: ExperimentHistoryQuery, needle: str) -> bool:
    """Whether one projected row survives every filter the operator has set.

    `needle` is `query.text` already trimmed and lowered, because it is the same string for
    every row this listing walks."""
    entry = row.entry
    record = entry.record
    if query.shop_id is not None and record.shop_id != query.shop_id:
        return False
    if query.scenario_id is not None and record.scenario_id != query.scenario_id:
        return False
    if query.status is not None and entry.status is not query.status:
        return False
    if query.framework_id and all(arm.framework_id != query.framework_id for arm in entry.arms):
        return False
    if query.outcome is not None and query.outcome not in row.outcomes:
        return False
    if query.started_after is not None and record.created_at < query.started_after:
        return False
    if query.started_before is not None and record.created_at > query.started_before:
        return False
    return needle in row.haystack
