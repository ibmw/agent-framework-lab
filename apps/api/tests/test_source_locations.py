"""Where the lab's own code lives, and what it refuses to point at (ADR 0027)."""

import json

from capability_lab.application import sandbox_tools
from capability_lab.application.sandbox_actions import SandboxActionService
from capability_lab.application.source_locations import locate


def test_a_project_function_is_located_relative_to_the_import_root() -> None:
    """Relative, never absolute: an absolute path is a fact about one machine."""
    location = locate(sandbox_tools.parse_arguments)

    assert location is not None
    assert location.path == "capability_lab/application/sandbox_tools.py"
    assert location.module == "capability_lab.application.sandbox_tools"
    assert location.symbol == "parse_arguments"
    assert location.line > 0


def test_a_method_names_the_class_it_belongs_to() -> None:
    location = locate(SandboxActionService.execute)

    assert location is not None
    assert location.symbol == "SandboxActionService.execute"


def test_code_this_project_does_not_own_has_no_location() -> None:
    """A framework's internals are not the lab's to explain.

    Answered as absent rather than as a path outside the package, because a timeline showing
    one would invite a reader to compare two arms on code the lab did not write.
    """
    assert locate(json.dumps) is None


def test_nothing_to_point_at_is_answered_rather_than_raised() -> None:
    """A tool this build no longer publishes names no handler, and that is a valid answer."""
    assert locate(None) is None
    assert locate(object()) is None
