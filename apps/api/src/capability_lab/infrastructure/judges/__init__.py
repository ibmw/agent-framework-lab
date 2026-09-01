"""Judge runtimes composed by the presentation layer."""

from capability_lab.infrastructure.judges.control import ControlJudgeRuntime
from capability_lab.infrastructure.judges.pydantic_ai import PydanticAiJudgeRuntime

__all__ = ["ControlJudgeRuntime", "PydanticAiJudgeRuntime"]
