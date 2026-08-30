"""The record one fired mutation leaves, and the append-only store that keeps it.

Split out from the runtime that writes them and the service that reads them back, exactly as
the agent turn and its tool calls are (ADR 0026): the runner produces them while advancing an
arm, and `ExperimentService` serves them beside the calls they interleave with, so one read of
an experiment is one execution rather than two halves a client has to align.

What a mutation event does *not* carry is as deliberate as what it does. There is no copy of
the order it moved and no description of the change beyond the two revisions: the arm's state
document is the world after the write, the effect names what the lab did, and a second stored
description could disagree with both. Same rule ADR 0026 applied to confirmations and state
changes.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from capability_lab.domain.blocks import MutationEffect

__all__ = ["MutationEvent", "MutationEventRecord", "MutationEventRepository"]


@dataclass(frozen=True, slots=True)
class MutationEvent:
    """One mutation firing into one arm, and what it did to that arm.

    `ordinal` and `attempt` place it in the arm's history the way a tool event is placed, and
    `after_calls` is how many calls the attempt had already made when it fired — zero when it
    fired before the agent asked anything. Together they order a fault *between* two of an
    agent's calls, which is the case the whole mechanism exists for: the agent proposes
    against a world, the fault moves that world, and the write it computed no longer applies
    (ADR 0022).

    `mutation_id` is the scenario's own name for this bound instance and `block` the exact
    template version it named, so a historical run is explainable after the library moves on.
    `timing` is the literal that was bound rather than the parsed form, because what the
    scenario said is the evidence and the parse is this build's reading of it.
    """

    mutation_id: str
    block_id: UUID
    block_version: int
    effect: MutationEffect
    timing: str
    target: str
    ordinal: int
    attempt: int
    after_calls: int
    revision_before: int
    revision_after: int
    state_fingerprint: str

    @property
    def moved_the_arm(self) -> bool:
        """Always true for a recorded firing, and asked rather than assumed.

        A mutation that changed nothing is never recorded: the applier refuses a world it
        cannot move and the runtime settles that fault without writing a row, rather than
        writing one that claims the world moved when it did not. So this reads the revisions
        for the same reason a tool event does, and cannot drift from them.
        """
        return self.revision_after != self.revision_before


@dataclass(frozen=True, slots=True)
class MutationEventRecord:
    """One fired mutation as it is stored, bound to the arm it fired into."""

    run_id: UUID
    experiment_id: UUID
    event: MutationEvent
    created_at: datetime


class MutationEventRepository(Protocol):
    """Append-only per arm; `(run, mutation)` is the identity of one firing.

    A bound mutation fires at most once in an arm, which is the store's rule rather than the
    runtime's: a scenario's fault is a thing that happens to a world, and a world it has
    already happened to is a different world.
    """

    def list_for_experiment(self, experiment_id: UUID) -> tuple[MutationEventRecord, ...]: ...

    def append_all(
        self, records: tuple[MutationEventRecord, ...]
    ) -> tuple[MutationEventRecord, ...]:
        """Write one attempt's firings together, after the attempt they belong to."""
        ...
