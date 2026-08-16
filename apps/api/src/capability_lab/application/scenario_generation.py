from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import MappingProxyType

from capability_lab.application.canonical_state import (
    CanonicalStateFingerprint,
    fingerprint_initial_state,
)
from capability_lab.application.ports import Clock
from capability_lab.application.scenario_registry import ScenarioRegistry, ScenarioRegistryKey
from capability_lab.domain.entities import (
    CanonicalInitialState,
    ScenarioDefinition,
    ScenarioMetadata,
)
from capability_lab.domain.scenario_generation import RETAIL_PROFILE_V1, generate_retail_profile_v1

StateGenerator = Callable[[ScenarioDefinition, int], CanonicalInitialState]


class ScenarioGeneratorNotConfiguredError(LookupError):
    """Raised when a registered scenario has no state generator in this composition."""


@dataclass(frozen=True, slots=True)
class GeneratedScenario:
    metadata: ScenarioMetadata
    state: CanonicalInitialState
    fingerprint: CanonicalStateFingerprint

    @property
    def canonical_json(self) -> bytes:
        return self.fingerprint.canonical_json

    @property
    def initial_state_hash(self) -> str:
        return self.fingerprint.initial_state_hash


class ScenarioGenerationKernel:
    """Resolve and generate a scenario without persistence or infrastructure dependencies."""

    __slots__ = ("_clock", "_generators", "_registry")

    def __init__(
        self,
        registry: ScenarioRegistry,
        generators: Mapping[ScenarioRegistryKey, StateGenerator],
        clock: Clock,
    ) -> None:
        self._registry = registry
        self._generators = MappingProxyType(dict(generators))
        self._clock = clock

    def generate(self, scenario_id: str, scenario_version: str, seed: int) -> GeneratedScenario:
        definition = self._registry.resolve(scenario_id, scenario_version)
        key = (definition.scenario_id, definition.scenario_version)
        try:
            generator = self._generators[key]
        except KeyError as error:
            raise ScenarioGeneratorNotConfiguredError(
                f"scenario generator {scenario_id}@{scenario_version} is not configured"
            ) from error

        state = generator(definition, seed)
        fingerprint = fingerprint_initial_state(state)
        metadata = ScenarioMetadata(
            definition=definition,
            seed=seed,
            created_at=self._clock.now(),
        )
        return GeneratedScenario(metadata=metadata, state=state, fingerprint=fingerprint)


def create_retail_profile_kernel(clock: Clock) -> ScenarioGenerationKernel:
    return ScenarioGenerationKernel(
        registry=ScenarioRegistry((RETAIL_PROFILE_V1,)),
        generators={
            (RETAIL_PROFILE_V1.scenario_id, RETAIL_PROFILE_V1.scenario_version): (
                generate_retail_profile_v1
            )
        },
        clock=clock,
    )
