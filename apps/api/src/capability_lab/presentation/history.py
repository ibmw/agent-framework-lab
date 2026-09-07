"""Public v1 contract for experiment history: every run this lab has made, narrowed.

One operation, and it is deliberately not under a shop. `GET /shops/{id}/experiments` is the
bench's listing — what has been started here, newest first — and this is the lab's: an
operator reviewing what a framework did is looking across every shop they have authored, so
the shop is a filter on this listing rather than a path segment above it.

The response carries the filter options beside the rows. They are read off the experiments
themselves rather than off the definition libraries, so a dropdown offers what has actually
been run, and one read fills the whole screen — a page that fetched shops, scenarios, and
frameworks separately would render its filters against a lab it had not listed.

Every row is a projection of the same record the bench and the results screen read
(ADR 0034). Nothing here is stored, and nothing here counts anything the evaluation does not
already count: `met` out of `decided` is per arm, and the two are never added together.

The one exception is what an operator wrote: tags and notes are stored beside the experiment
rather than projected from it (ADR 0036). A row shows the tags and how many notes there are,
and the search text matches both — the note itself belongs on the screen that holds the
evidence it was written about.
"""

from collections.abc import Callable, Generator
from datetime import UTC, datetime
from typing import Annotated, Any, Self
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from capability_lab.application.experiment_history import (
    ExperimentHistoryEntry,
    ExperimentHistoryPage,
    ExperimentHistoryQuery,
    ExperimentHistoryService,
    HistoryArm,
    HistoryFacet,
)
from capability_lab.application.pagination import DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT
from capability_lab.domain.evaluation import ExperimentStatus, ObjectiveOutcome
from capability_lab.domain.experiment import ArmAwaiting, ParticipantDriverType
from capability_lab.presentation.base import ErrorResponse, StrictApiModel

# The only 422 a listing can answer with is a filter or a page it cannot read, so it says
# that rather than borrowing the definitions' "invalid content" wording.
HistoryResponses: dict[int | str, dict[str, Any]] = {
    422: {"model": ErrorResponse, "description": "Invalid filter or page"}
}


def _utc(moment: datetime | None) -> datetime | None:
    """Read a moment written without an offset as UTC.

    Every timestamp this lab records is UTC, so a naive value has exactly one sensible
    reading and refusing it would only make an operator type a `Z`. Normalized here, at the
    boundary, because the comparison downstream is against an aware timestamp and Python
    raises rather than guessing when the two are mixed."""
    if moment is None or moment.tzinfo is not None:
        return moment
    return moment.replace(tzinfo=UTC)


class HistoryArmSchema(StrictApiModel):
    """One arm of one historical experiment: what it ran, where it stopped, how it did."""

    run_id: UUID
    label: str
    agent_configuration_id: UUID
    agent_configuration_version: int
    agent_configuration_name: str
    framework_id: str
    framework_label: str
    model_id: str
    awaiting: ArmAwaiting
    met: int
    decided: int
    """How many of this arm's objectives something actually decided — its own denominator.

    Never added to the arm beside it: two arms driven to different depths were asked
    different numbers of questions, so a total would report the operator's pacing as a
    difference between configurations (ADR 0033)."""
    failed: bool
    """Whether this arm missed something its scenario marked required (ADR 0030)."""

    @classmethod
    def from_domain(cls, arm: HistoryArm) -> Self:
        return cls(
            run_id=arm.run_id,
            label=arm.label,
            agent_configuration_id=arm.configuration_id,
            agent_configuration_version=arm.configuration_version,
            agent_configuration_name=arm.configuration_name,
            framework_id=arm.framework_id,
            framework_label=arm.framework_label,
            model_id=arm.model_id,
            awaiting=arm.awaiting,
            met=arm.met,
            decided=arm.decided,
            failed=arm.failed,
        )


class ExperimentHistoryEntrySchema(StrictApiModel):
    """One row of history: an experiment, what it ran, and where each arm ended."""

    experiment_id: UUID
    shop_id: UUID
    shop_name: str
    label: str
    scenario_id: UUID
    scenario_name: str
    scenario_version: int
    scenario_superseded: bool
    """Whether a newer version of this recipe has since been published.

    Provenance rather than a warning: this experiment stays reproducible from the versions
    it pinned, and running the scenario as it reads today would be running something else."""
    seed: int
    sandbox_fingerprint: str
    resolution_fingerprint: str
    participant_driver: ParticipantDriverType
    status: ExperimentStatus
    arms: list[HistoryArmSchema]
    tags: list[str]
    """The shelves this run is filed on, folded and in one order (ADR 0036)."""
    note_count: int
    """How many notes this run carries, never the notes themselves.

    A listing is about the runs; a note reads as itself only beside the evidence it was
    written against. The count says there is something written here to open, and the search
    text matches the words in it.

    Named apart from the annotation document's `notes`, which is the list: one field name
    holding a number on one response and an array on another is a trap a generated client
    walks into once and a person walks into every time."""
    created_at: str

    @classmethod
    def from_domain(cls, entry: ExperimentHistoryEntry) -> Self:
        record = entry.record
        return cls(
            experiment_id=record.experiment_id,
            shop_id=record.shop_id,
            shop_name=entry.shop_name,
            label=record.label,
            scenario_id=record.scenario_id,
            scenario_name=entry.scenario_name,
            scenario_version=record.scenario_version,
            scenario_superseded=entry.scenario_superseded,
            seed=record.seed,
            sandbox_fingerprint=record.sandbox_fingerprint,
            resolution_fingerprint=record.resolution_fingerprint,
            participant_driver=record.participant_driver,
            status=entry.status,
            arms=[HistoryArmSchema.from_domain(arm) for arm in entry.arms],
            tags=list(entry.tags),
            note_count=entry.note_count,
            created_at=record.created_at.isoformat(),
        )


class HistoryFacetSchema(StrictApiModel):
    """One value a history filter offers, as the runs themselves name it."""

    id: str
    label: str

    @classmethod
    def from_domain(cls, facet: HistoryFacet) -> Self:
        return cls(id=facet.id, label=facet.label)


class ExperimentHistoryResponse(StrictApiModel):
    """One page of history, and every value its filters can be narrowed to."""

    experiments: list[ExperimentHistoryEntrySchema]
    page: int
    page_size: int
    total: int
    shops: list[HistoryFacetSchema]
    scenarios: list[HistoryFacetSchema]
    frameworks: list[HistoryFacetSchema]
    tags: list[HistoryFacetSchema]
    """The shelves runs are actually filed on — empty in a lab where nobody has tagged."""

    @classmethod
    def from_domain(cls, listing: ExperimentHistoryPage) -> Self:
        return cls(
            experiments=[
                ExperimentHistoryEntrySchema.from_domain(entry) for entry in listing.entries
            ],
            page=listing.page,
            page_size=listing.page_size,
            total=listing.total,
            shops=[HistoryFacetSchema.from_domain(facet) for facet in listing.shops],
            scenarios=[HistoryFacetSchema.from_domain(facet) for facet in listing.scenarios],
            frameworks=[HistoryFacetSchema.from_domain(facet) for facet in listing.frameworks],
            tags=[HistoryFacetSchema.from_domain(facet) for facet in listing.tags],
        )


class ExperimentHistoryRoutes:
    """The cross-shop history listing, over the reading the bench and results screen share."""

    def __init__(self, service: Callable[[], Generator[ExperimentHistoryService, None, None]]):
        self._service = service

    def register(self, router: APIRouter) -> None:
        dependency = Depends(self._service)

        def list_experiment_history(
            service: Annotated[ExperimentHistoryService, dependency],
            shop_id: Annotated[UUID | None, Query(description="Only this shop's runs.")] = None,
            scenario_id: Annotated[
                UUID | None, Query(description="Only runs of this scenario.")
            ] = None,
            framework_id: Annotated[
                str | None, Query(description="Only runs with an arm on this framework.")
            ] = None,
            tag: Annotated[
                str | None,
                Query(
                    description="Only runs filed under this tag. Matched against the stored "
                    "folded value, so a tag no run carries narrows to nothing rather than "
                    "refusing the request."
                ),
            ] = None,
            status: Annotated[
                ExperimentStatus | None,
                Query(description="Only runs standing here: running, completed, or failed."),
            ] = None,
            outcome: Annotated[
                ObjectiveOutcome | None,
                Query(description="Only runs where an arm holds an objective with this outcome."),
            ] = None,
            started_after: Annotated[
                datetime | None, Query(description="Only runs started at or after this moment.")
            ] = None,
            started_before: Annotated[
                datetime | None, Query(description="Only runs started at or before this moment.")
            ] = None,
            q: Annotated[
                str | None,
                Query(
                    description="Match the name, scenario, shop, or arms of a run, and the "
                    "notes and tags written on it."
                ),
            ] = None,
            page: Annotated[int, Query(ge=1)] = 1,
            page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_LIMIT)] = DEFAULT_PAGE_LIMIT,
        ) -> ExperimentHistoryResponse:
            return ExperimentHistoryResponse.from_domain(
                service.history(
                    ExperimentHistoryQuery(
                        shop_id=shop_id,
                        scenario_id=scenario_id,
                        framework_id=framework_id or "",
                        tag=tag or "",
                        status=status,
                        outcome=outcome,
                        started_after=_utc(started_after),
                        started_before=_utc(started_before),
                        text=q or "",
                        page=page,
                        page_size=page_size,
                    )
                )
            )

        router.add_api_route(
            "/experiments",
            list_experiment_history,
            methods=["GET"],
            response_model=ExperimentHistoryResponse,
            operation_id="listExperimentHistory",
            summary="List every experiment this lab has run, most recently started first",
            description=(
                "Experiment-first history across every shop. Each row is projected from the "
                "experiment's own record — the arms it pinned, where each one stands, and "
                "what each one's objectives say — so a row can never disagree with the bench "
                "or the results screen it opens into. Counts are per arm and are never "
                "combined into a score. The filter options travel with the page and are read "
                "from the experiments themselves rather than from the definition libraries — "
                "the tags among them, so the shelves offered are the ones runs are on."
            ),
            responses=HistoryResponses,
        )
