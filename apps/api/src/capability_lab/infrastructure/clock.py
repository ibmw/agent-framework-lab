from datetime import UTC, datetime


class SystemClock:
    """Return the operational wall clock explicitly at the composition boundary."""

    def now(self) -> datetime:
        return datetime.now(UTC)
