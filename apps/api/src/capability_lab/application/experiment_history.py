"""Experiment-first history: every run this lab has made, narrowed and paged.

The bench lists what has been started in one shop, newest first, so an operator can get
back to what they were driving. History answers a different question — "what has this lab
run, and which of those runs is worth reopening" — and it answers it across shops, because
an operator comparing two frameworks is not comparing two shops.

Five rules live here.

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
another. The tag list follows the same rule one step further: it offers the shelves runs are
actually filed on, so it is empty in a lab where nobody has tagged anything rather than
offering a vocabulary nobody uses.

**What an operator wrote is searched, and only the tags are shown.** A note is prose about
one run and belongs on the screen that holds the evidence it is about, but it is the most
specific thing anyone ever writes down — so the text box matches it. A tag is the opposite:
it exists to be narrowed by, so it is a column, a filter, and a facet.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from capability_lab.application.agent_capabilities import PROVEN_FRAMEWORKS_BY_ID
from capability_lab.application.definition_authoring import DefinitionRepository
from capability_lab.application.evaluation import ExperimentEvaluationService
from capability_lab.application.experiment_annotations import (
    EMPTY_ANNOTATIONS,
    ExperimentAnnotationRepository,
    ExperimentAnnotations,
)
from capability_lab.application.experiments import (
    ArmRuntime,
    ExperimentOrigin,
    ExperimentRecord,
    ExperimentRepository,
    ExperimentService,
    RunRecord,
)
from capability_lab.application.pagination import DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT
from capability_lab.domain.agent_configuration import AgentConfigurationPayload
from capability_lab.domain.definitions import DefinitionId, DefinitionType
from capability_lab.domain.evaluation import (
    ArmEvaluation,
    ExperimentStatus,
    ObjectiveOutcome,
    stand_experiment,
)
from capability_lab.domain.experiment import ArmAwaiting, normalize_tag
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
    beacon — plus the notes and tags written on it, which are the words an operator chose
    for this run and so the ones they are most likely to come back with.
    """

    shop_id: UUID | None = None
    scenario_id: UUID | None = None
    framework_id: str = ""
    tag: str = ""
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
    configuration_latest_version: int | None
    """The newest published version of this arm's configuration, or `None` if it has none.

    Beside the version the arm pinned rather than replacing it, and read for the same reason
    `scenario_superseded` is: a historical run stays reproducible from what it pinned
    (ADR 0025), and this is what tells an operator there is a newer configuration to fork
    this run onto — and what makes the row's fork action refuse to offer a derivation that
    would change nothing (ADR 0039)."""
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
    derived_from: ExperimentOrigin | None
    """The experiment this row was derived from, and `None` for one an operator started.

    On the row rather than only on the screen it opens, because a listing of every run this
    lab has made would otherwise show a derived run and its source as two unrelated
    experiments that happen to share a fingerprint (ADR 0038, ADR 0039)."""
    status: ExperimentStatus
    arms: tuple[HistoryArm, ...]
    tags: tuple[str, ...]
    note_count: int
    """How many notes this run carries, never the notes themselves.

    A listing is about the runs; a note is about one of them, and it reads as itself only
    beside the evidence it was written against. The count is what tells an operator there is
    something written here to open, and the text box is what finds it."""


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
    tags: tuple[HistoryFacet, ...]


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
        annotations: ExperimentAnnotationRepository,
        shops: DefinitionRepository[ShopPayload],
        scenarios: DefinitionRepository[ScenarioPayload],
        configurations: DefinitionRepository[AgentConfigurationPayload],
    ) -> None:
        self._experiments = experiments
        self._details = details
        self._evaluations = evaluations
        self._annotations = annotations
        self._shops = shops
        self._scenarios = scenarios
        self._configurations = configurations

    def history(self, query: ExperimentHistoryQuery) -> ExperimentHistoryPage:
        # Resolved once per listing rather than per row: a lab's experiments cluster on a
        # handful of shops and scenarios, and the name of one does not change mid-read.
        shop_names: dict[UUID, str] = {}
        latest_scenarios: dict[UUID, int | None] = {}
        # Resolved once per listing for the reason the scenario versions are: a lab's runs
        # cluster on a handful of configurations, and none of them is published mid-read.
        latest_configurations: dict[UUID, int | None] = {}
        # Two statements for the whole listing rather than two per row: what an operator
        # wrote is stored beside the experiment (ADR 0036) rather than read back through it,
        # so it is the one part of a row that does not arrive with the record.
        written = self._annotations.list_all()
        projected = tuple(
            self._project(record, written, shop_names, latest_scenarios, latest_configurations)
            for record in self._experiments.list_all()
        )
        # Normalized once for the whole listing rather than per row: the needle does not
        # change between two rows of one read.
        needle = query.text.strip().lower()
        # Normalized by the same step a write folds through, but without the slug refusal at
        # the end of it: a filter that only lowered would narrow correctly for the spellings
        # the dropdown emits and find nothing for a hand-typed `Read check gap`, while a
        # filter that refused would turn a link shared after a refiling into an error page.
        tag = normalize_tag(query.tag)
        matching = tuple(row for row in projected if _matches(row, query, needle, tag))
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
            # A tag is its own label: it is stored folded, so there is no second spelling of
            # it for a facet to have to choose between.
            tags=_facets((tag, tag) for row in projected for tag in row.entry.tags),
        )

    def _project(
        self,
        record: ExperimentRecord,
        written: Mapping[UUID, ExperimentAnnotations],
        shop_names: dict[UUID, str],
        latest_scenarios: dict[UUID, int | None],
        latest_configurations: dict[UUID, int | None],
    ) -> _Projected:
        detail = self._details.get_experiment(record.shop_id, record.experiment_id)
        evaluation = self._evaluations.evaluate_detail(detail)
        arms = tuple(
            _arm(
                run,
                runtime,
                standing.awaiting,
                judged,
                self._latest_configuration(run.agent_configuration_id, latest_configurations),
            )
            for run, runtime, standing, judged in zip(
                detail.runs, detail.arm_runtimes, detail.standings, evaluation.arms, strict=True
            )
        )
        annotations = written.get(record.experiment_id, EMPTY_ANNOTATIONS)
        entry = ExperimentHistoryEntry(
            record=record,
            shop_name=self._shop_name(record.shop_id, shop_names),
            scenario_name=detail.scenario.payload.name,
            scenario_superseded=self._superseded(record, latest_scenarios),
            # Already resolved by the reading this row is projected from, so a listing never
            # asks a second question about where a run came from.
            derived_from=detail.derived_from,
            status=stand_experiment(detail.standings, evaluation.arms),
            arms=arms,
            tags=annotations.tags,
            note_count=len(annotations.notes),
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
                    *annotations.tags,
                    *(note.body for note in annotations.notes),
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

    def _latest_configuration(
        self, configuration_id: UUID, cache: dict[UUID, int | None]
    ) -> int | None:
        if configuration_id not in cache:
            cache[configuration_id] = self._configurations.latest_published_version(
                DefinitionId(DefinitionType.AGENT_CONFIGURATION, configuration_id)
            )
        return cache[configuration_id]

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
    latest_version: int | None,
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
        configuration_latest_version=latest_version,
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


def _matches(row: _Projected, query: ExperimentHistoryQuery, needle: str, tag: str) -> bool:
    """Whether one projected row survives every filter the operator has set.

    `needle` and `tag` are `query.text` and `query.tag` already trimmed and lowered, because
    they are the same two strings for every row this listing walks."""
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
    if tag and tag not in entry.tags:
        return False
    if query.outcome is not None and query.outcome not in row.outcomes:
        return False
    if query.started_after is not None and record.created_at < query.started_after:
        return False
    if query.started_before is not None and record.created_at > query.started_before:
        return False
    return needle in row.haystack
