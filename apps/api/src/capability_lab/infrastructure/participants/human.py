"""The human operator driving one arm's customer turns.

The first implementation of the participant-driver port, and deliberately the thinnest one
that can exist: the operator's words arrive with the HTTP request, and this relays them.

It is still an adapter rather than a shortcut in the service. Composition selects the
driver (`docs/architecture.md`), and the runner has to be written against a driver that
*might* generate, refuse, or take time — otherwise the day an LLM driver lands, the runner
is the thing that has to change. Holding the operator's message on the instance rather than
passing it through the port is what keeps that true: a generating driver is constructed
with a model client where this one is constructed with a sentence, and neither shape leaks
into `ParticipantRequest`.
"""

from __future__ import annotations

from capability_lab.application.participants import (
    ParticipantRequest,
    ParticipantTurnUnavailableError,
)
from capability_lab.domain.experiment import ParticipantDriverType

__all__ = ["HumanParticipantDriver"]


class HumanParticipantDriver:
    """Relay one message the operator wrote for this arm.

    Constructed per delivery, because that is the lifetime of what it holds. An instance
    that outlived one request would be a driver holding a message it has already sent.
    """

    def __init__(self, message: str) -> None:
        self._message = message

    @property
    def driver_type(self) -> ParticipantDriverType:
        return ParticipantDriverType.HUMAN

    def next_turn(self, request: ParticipantRequest) -> str:
        """The operator's words, trimmed and otherwise unchanged.

        The turns already in the arm are ignored on purpose: a person composing a reply has
        read the thread on the bench, so re-deriving anything from it here would be the lab
        second-guessing the participant.

        Two things it does do. It checks there is something to send — an empty compose box is
        a run that has not been driven, not a customer who said nothing. And it trims, because
        a recorded turn carries no surrounding whitespace and a compose box collects it freely:
        every raw client sends the trailing newline its input ends with, and refusing that
        would be refusing the message rather than the padding.
        """
        if not self._message.strip():
            raise ParticipantTurnUnavailableError(
                f"the operator has not written {request.arm_label}'s next message"
            )
        return self._message.strip()
