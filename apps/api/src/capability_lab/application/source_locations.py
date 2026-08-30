"""Where the lab's own code that did something lives.

`PLAN.md` Milestone 4 asks an experiment to show "project-owned source locations where
available". This is the "where available" half: given the thing that ran — a tool handler,
a runtime adapter — say which file and line of *this project* it is, or say nothing.

Three rules, and each one is the reason a location can be trusted as evidence.

**Only the lab's own code has a location.** A resolved file outside the `capability_lab`
package answers `None`, whatever it is. A framework's internals are not this project's to
explain, and a timeline that pointed into an SDK would invite a reader to compare two arms
on code the lab did not write and cannot change.

**A location is read from the callable, never from a map somebody keeps.** The recorded
event names the tool; the tool registry names the function that answers it; `inspect` says
where that function is. Nothing in between is authored, so a location cannot go stale
against a rename the way a hand-maintained list would.

**A location is resolved, never stored.** A path and a line number are facts about the
checkout that is running, not about the run that happened. Writing them into a record would
freeze one machine's layout into evidence and make every later refactor look like history
changing; resolving them on read means a location is simply absent when the build no longer
has the code — which is the honest answer.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from pathlib import Path
from typing import Any

__all__ = ["SourceLocation", "locate"]

_PACKAGE_ROOT = Path(__file__).resolve().parent.parent
"""The `capability_lab` package directory: everything this project owns, and nothing else."""

_SOURCE_ROOT = _PACKAGE_ROOT.parent
"""The import root, so a reported path reads `capability_lab/...` on every checkout."""


@dataclass(frozen=True, slots=True)
class SourceLocation:
    """One place in this project's source, named the way a reader can open it.

    `path` is relative to the import root rather than absolute, deliberately: an absolute
    path is a fact about one machine, and the same run read on another would report a
    different location for identical code.
    """

    module: str
    path: str
    symbol: str
    line: int


def locate(target: object) -> SourceLocation | None:
    """Where `target` is defined, when this project defines it.

    Answers `None` for anything the lab does not own, anything with no source to point at
    (a builtin, a C extension, a callable defined in a REPL), and anything whose file has
    gone missing since it was imported. The caller shows a location or does not; there is
    no third answer, and no placeholder pretending to one.
    """
    if target is None:
        # A tool this build no longer publishes names no handler, so there is nothing to
        # point at. Answered here rather than by every caller checking first.
        return None
    # Unwrapped so a decorated handler points at the function that was written rather than
    # at the wrapper that took its name. Typed `Any` at this one line on purpose: reflection
    # accepts a handful of concrete runtime types, and a caller holding a callable cannot
    # prove which of them it is — `inspect` says so by raising, and that is the answer here.
    subject: Any = inspect.unwrap(target) if callable(target) else target
    try:
        file = inspect.getsourcefile(subject)
        if file is None:
            return None
        _, line = inspect.getsourcelines(subject)
    except (OSError, TypeError):
        return None

    resolved = Path(file).resolve()
    if not resolved.is_relative_to(_PACKAGE_ROOT):
        return None
    return SourceLocation(
        module=getattr(subject, "__module__", "") or "",
        path=resolved.relative_to(_SOURCE_ROOT).as_posix(),
        symbol=_symbol(subject),
        line=line,
    )


def _symbol(subject: object) -> str:
    """The qualified name a reader searches for, falling back to the type's.

    An instance passed where a function was expected — a runtime object rather than its
    `answer` — still names something findable, because `inspect` located its class.
    """
    qualified = getattr(subject, "__qualname__", None)
    if isinstance(qualified, str) and qualified:
        return qualified
    return type(subject).__qualname__
