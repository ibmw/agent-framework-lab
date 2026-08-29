"""The port a run's customer turns arrive through, and nothing about who produces them.

The support agent is one half of a simulated incident; the customer is the other. The lab
compares agents, so the customer side has to be reproducible independently of it: the same
scenario must be drivable by a person today and by a simulator later, with the run record
saying which drove it (ADR 0011).

That is the whole reason this is a port and not a function. There is exactly one
implementation — the human operator — and the port exists so the runner never learns that.
`ExperimentService` asks for the next turn and records what it gets; whether a person typed
it, a model generated it, or a script replayed it is composition's choice and the
experiment's recorded input.

**What the port is not.** It does not deliver the trigger. A published ticket carries the
first message every arm receives (ADR 0016), and both arms receiving it identically is what
makes the comparison a comparison; a driver that could produce it could break that. The
runner opens each arm with the pinned ticket's trigger and asks a driver only for the turns
after it.

**What a driver may see.** The turns this arm has already received, and nothing else. Not
the agent's replies, not the arm's commerce state, not the arm beside it — the reply
channel arrives with the runner that produces replies (Milestone 4), and the rest is
deliberately withheld: a customer simulator that could read the sandbox would answer
questions the customer has no way to know the answer to, and the scenario's hidden facts
exist precisely so that reaching them is the agent's job.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from capability_lab.domain.experiment import ParticipantDriverType, ParticipantTurn

__all__ = [
    "ParticipantDriver",
    "ParticipantDriverError",
    "ParticipantRequest",
    "ParticipantTurnUnavailableError",
]


class ParticipantDriverError(RuntimeError):
    """Raised when a participant driver cannot produce the turn it was asked for."""


class ParticipantTurnUnavailableError(ParticipantDriverError):
    """Raised when the driver has nothing to say and the run must wait for it.

    A human driver raises this when it is asked for a turn without the operator having
    written one. It is a refusal to invent a customer turn, not a failure: the run is intact
    and simply has not been driven yet.
    """


@dataclass(frozen=True, slots=True)
class ParticipantRequest:
    """What a driver is told about the arm it is answering in.

    Deliberately per-arm. The operator composing one message for both arms is a decision
    made *above* this port — the runner asks each arm's driver separately and records which
    arms one composition reached — so a driver never has to know that two arms exist, and a
    future simulator cannot accidentally answer for the arm beside it.
    """

    run_id: UUID
    arm_label: str
    driver: ParticipantDriverType
    turns: tuple[ParticipantTurn, ...]


class ParticipantDriver(Protocol):
    """The source of one arm's next customer turn.

    Returning the body rather than a `ParticipantTurn` is deliberate: the ordinal, the
    composition identity, and the recorded driver type are the runner's to assign, and a
    driver that could set them could renumber a run's history.
    """

    @property
    def driver_type(self) -> ParticipantDriverType: ...

    def next_turn(self, request: ParticipantRequest) -> str:
        """The customer's next words in this arm.

        Raises `ParticipantTurnUnavailableError` when the driver has nothing to send yet.
        """
        ...
