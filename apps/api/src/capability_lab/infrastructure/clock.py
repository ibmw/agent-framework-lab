from dataclasses import dataclass
from datetime import UTC, datetime, timedelta


class SystemClock:
    """Return the operational wall clock explicitly at the composition boundary."""

    def now(self) -> datetime:
        return datetime.now(UTC)


@dataclass(slots=True)
class SteppingClock:
    """A clock that starts where it is told and advances a fixed step per read.

    An adapter of the same `Clock` port `SystemClock` implements, for the one composition
    that needs a reproducible record rather than a true one: the demo seed writes an
    experiment whose durations, timestamps and ordering must read the same on every
    machine, and a wall clock would make two developers' screenshots disagree about a story
    they both ran from the same command.

    It steps rather than stands still because time is measured over it. A clock that
    answered one instant would report every run as having taken nothing, which is a
    measurement rather than an absence (ADR 0032) and a false one.
    """

    value: datetime
    step: timedelta = timedelta(seconds=1)

    def now(self) -> datetime:
        self.value += self.step
        return self.value
