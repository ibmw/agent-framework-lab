"""The driver that speaks lines an earlier run recorded.

The second implementation of the participant-driver port, and the one ADR 0025 said would
have to arrive before the port's `scripted` type meant anything: "an experiment may record
`llm` or `scripted`; nothing can then drive it". A replay is what finally drives one
(ADR 0038), and `docs/product-direction.md` named this driver from the start — "a scripted
driver may provide deterministic regression evidence".

It is as thin as the human driver beside it and for the same reason: the ordinal, the
composition identity, and the recorded driver type are the runner's to assign, so a driver
returns a body and nothing else. What differs is only where the body comes from — a
sentence an operator typed, or a sentence an arm of an earlier experiment received.

Holding the lines per run rather than one line for the delivery is what keeps a divergent
composition replayable: two arms sent different words by one call are one composition in the
record (ADR 0025), and a driver that could return only one string would have flattened them.
"""

from __future__ import annotations

from collections.abc import Mapping
from uuid import UUID

from capability_lab.application.participants import (
    ParticipantRequest,
    ParticipantTurnUnavailableError,
)
from capability_lab.domain.experiment import ParticipantDriverType

__all__ = ["ScriptedParticipantDriver"]


class ScriptedParticipantDriver:
    """Speak one recorded line into each arm of one delivery.

    Constructed per delivery, like the human driver: an instance that outlived one
    composition would be a driver holding lines it has already spoken.
    """

    def __init__(self, lines: Mapping[UUID, str]) -> None:
        self._lines = dict(lines)

    @property
    def driver_type(self) -> ParticipantDriverType:
        return ParticipantDriverType.SCRIPTED

    def next_turn(self, request: ParticipantRequest) -> str:
        """The line recorded for this arm.

        An arm this delivery has no line for is a refusal rather than an invented turn, for
        the reason an empty compose box is: the script says which arms this composition
        reached, and answering for one it did not reach would write a turn that never
        happened into the derived run.

        The turns the arm already holds are ignored on purpose, exactly as they are for the
        operator: the script was read from a complete record before anything was delivered,
        so re-deriving a line from the thread would be the lab second-guessing the run it
        is reproducing.
        """
        line = self._lines.get(request.run_id)
        if line is None:
            raise ParticipantTurnUnavailableError(
                f"this composition has no recorded line for {request.arm_label}"
            )
        return line
