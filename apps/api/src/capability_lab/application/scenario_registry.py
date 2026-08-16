from __future__ import annotations

from collections.abc import Iterable, Mapping
from types import MappingProxyType

from capability_lab.domain.entities import ScenarioDefinition

ScenarioRegistryKey = tuple[str, str]


class DuplicateScenarioDefinitionError(ValueError):
    """Raised when two definitions claim the same immutable registry key."""


class ScenarioNotFoundError(LookupError):
    """Raised when a requested scenario definition is not registered."""


class ScenarioRegistry:
    """Immutable application registry of versioned scenario definitions."""

    __slots__ = ("_definitions",)

    _definitions: Mapping[ScenarioRegistryKey, ScenarioDefinition]

    def __init__(self, definitions: Iterable[ScenarioDefinition]) -> None:
        indexed: dict[ScenarioRegistryKey, ScenarioDefinition] = {}
        for definition in definitions:
            key = (definition.scenario_id, definition.scenario_version)
            if key in indexed:
                raise DuplicateScenarioDefinitionError(
                    f"scenario definition {definition.scenario_id}@{definition.scenario_version} "
                    "is already registered"
                )
            indexed[key] = definition
        self._definitions = MappingProxyType(indexed)

    def resolve(self, scenario_id: str, scenario_version: str) -> ScenarioDefinition:
        key = (scenario_id, scenario_version)
        try:
            return self._definitions[key]
        except KeyError as error:
            raise ScenarioNotFoundError(
                f"scenario definition {scenario_id}@{scenario_version} is not registered"
            ) from error
