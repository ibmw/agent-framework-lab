"""What an operator writes on a run: the notes they leave and the shelves they file it on.

Everything else this lab holds about an experiment is a record of what happened or a
reading of one. This is the first thing that is neither: it is what a person concluded, and
it arrives after the run is over.

Four rules shape it.

**It never touches the experiment.** An experiment is written once and never updated
(ADR 0025) because its inputs are what explain its result. A note is stored beside it, in
its own rows, so the document the experiment is fingerprinted from cannot move when someone
annotates it — and a run tagged six months later still says exactly what it ran.

**A note is appended, a tag set is replaced.** They are different kinds of statement. A note
is an observation made at a moment, so it is written once and never edited, the way a judge
execution is never overwritten (ADR 0031). Tags are how the run is currently filed, and
refiling is an ordinary thing to do — so setting them is idempotent over the set, and the
last set is the whole answer.

**Both writes answer with the whole annotation.** For the reason a scoring pass answers with
the whole evaluation (ADR 0031): a client that had to merge one appended note into a list it
read separately would be holding two readings of one run.

**It is read on its own rather than on the experiment.** The standing, the metrics, and the
state diff travel with the run because each is a projection of documents that read already
resolved (ADR 0029, ADR 0032, ADR 0035). This is the opposite: a stored document with its
own lifecycle, which the runner, the timeline, and every history row would otherwise carry
without asking for it. The experiment is looked up rather than resolved for the same reason
— attaching a note needs to know the run exists in this shop and nothing else.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID, uuid4

from capability_lab.application.definition_resolution import DefinitionResolutionError
from capability_lab.application.experiments import (
    ExperimentNotFoundError,
    ExperimentRepository,
)
from capability_lab.application.ports import Clock
from capability_lab.domain.experiment import ExperimentNote, fold_tags

__all__ = [
    "EMPTY_ANNOTATIONS",
    "ExperimentAnnotationRepository",
    "ExperimentAnnotationService",
    "ExperimentAnnotations",
    "ExperimentNoteRecord",
    "ExperimentTagConflictError",
]


class ExperimentTagConflictError(DefinitionResolutionError):
    """Raised when another request replaced this run's tags while this one was replacing them.

    Replacing a set is a delete followed by inserts, so two crossing requests that both file
    the run under one shelf can meet the primary key on the second commit. SQLite serializes
    writers and never shows it; PostgreSQL under READ COMMITTED does.

    It reaches the operator as a conflict rather than as a failure because that is what it is:
    the store refused to write the row twice, exactly as it is meant to, and the operator's
    move is to read the chips and set them again. Setting a tag set is idempotent, so the
    retry is safe by construction — which is only true if the conflict is legible enough to
    be retried.
    """


@dataclass(frozen=True, slots=True)
class ExperimentNoteRecord:
    """One note as it is stored: the run it is about, the words, and when they were written."""

    note_id: UUID
    experiment_id: UUID
    body: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class ExperimentAnnotations:
    """Everything an operator has written on one run.

    Notes oldest first, because they are read as a thread of what successive reviewers
    noticed; tags in the one order the domain folds them into, because they are a set.
    """

    notes: tuple[ExperimentNoteRecord, ...]
    tags: tuple[str, ...]


EMPTY_ANNOTATIONS = ExperimentAnnotations(notes=(), tags=())
"""What a run nobody has written on carries — an absence, never a missing document."""


class ExperimentAnnotationRepository(Protocol):
    """Notes appended, tags replaced, and both read back for one run or for the whole lab."""

    def get(self, experiment_id: UUID) -> ExperimentAnnotations: ...

    def list_all(self) -> Mapping[UUID, ExperimentAnnotations]:
        """Every annotated run in the lab, keyed by experiment.

        Beside `get` rather than replacing it for the reason `list_all` sits beside
        `list_for_shop` on the experiments themselves: history reads a whole lab, and a
        listing that fetched notes one experiment at a time would be doing per row what two
        statements answer for the page.
        """
        ...

    def append_note(self, record: ExperimentNoteRecord) -> None: ...

    def replace_tags(self, experiment_id: UUID, tags: tuple[str, ...]) -> None: ...


class ExperimentAnnotationService:
    """Write and read the notes and tags one experiment carries."""

    def __init__(
        self,
        experiments: ExperimentRepository,
        annotations: ExperimentAnnotationRepository,
        clock: Clock,
    ) -> None:
        self._experiments = experiments
        self._annotations = annotations
        self._clock = clock

    def get(self, shop_id: UUID, experiment_id: UUID) -> ExperimentAnnotations:
        self._require_experiment(shop_id, experiment_id)
        return self._annotations.get(experiment_id)

    def add_note(self, shop_id: UUID, experiment_id: UUID, body: str) -> ExperimentAnnotations:
        """Append one note to a run, and answer with everything written on it.

        Deliberately not idempotent, the way delivering a customer turn is not: two reviewers
        who wrote the same sentence wrote two notes, and collapsing them would delete the
        second person's reading of the run.
        """
        self._require_experiment(shop_id, experiment_id)
        # Built through the domain before anything is stored, so a body the record could not
        # hold is refused here rather than at the column width.
        note = ExperimentNote(note_id=uuid4(), body=body)
        self._annotations.append_note(
            ExperimentNoteRecord(
                note_id=note.note_id,
                experiment_id=experiment_id,
                body=note.body,
                created_at=self._clock.now(),
            )
        )
        return self._annotations.get(experiment_id)

    def set_tags(
        self, shop_id: UUID, experiment_id: UUID, tags: tuple[str, ...]
    ) -> ExperimentAnnotations:
        """Replace how a run is filed, and answer with everything written on it.

        The whole set rather than one tag at a time: the operator is looking at the chips and
        saying what they should be, and an add-and-remove pair would let two requests that
        crossed leave a set neither of them asked for.

        Two requests that cross here still conflict rather than interleave — the store says
        so, and `ExperimentTagConflictError` carries it out as something to retry.
        """
        self._require_experiment(shop_id, experiment_id)
        self._annotations.replace_tags(experiment_id, fold_tags(tags))
        return self._annotations.get(experiment_id)

    def _require_experiment(self, shop_id: UUID, experiment_id: UUID) -> None:
        if self._experiments.get(shop_id, experiment_id) is None:
            raise ExperimentNotFoundError(f"experiment {experiment_id} is not in shop {shop_id}")
