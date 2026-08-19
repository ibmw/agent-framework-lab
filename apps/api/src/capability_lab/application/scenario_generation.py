from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType

from capability_lab.application.canonical_state import (
    CanonicalStateFingerprint,
    fingerprint_initial_state,
)
from capability_lab.application.ports import (
    Clock,
    GeneratedScenarioRepository,
    ScenarioGenerationIdempotencyRepository,
)
from capability_lab.application.scenario_registry import ScenarioRegistry, ScenarioRegistryKey
from capability_lab.domain.entities import (
    CanonicalInitialState,
    ScenarioDefinition,
    ScenarioMetadata,
)
from capability_lab.domain.scenario_generation import (
    RETAIL_ORDER_CANCELLATION_V1,
    RETAIL_PROFILE_V1,
    generate_retail_order_cancellation_v1,
    generate_retail_profile_v1,
)

StateGenerator = Callable[[ScenarioDefinition, int], CanonicalInitialState]


class ScenarioGeneratorNotConfiguredError(LookupError):
    """Raised when a registered scenario has no state generator in this composition."""


class GeneratedScenarioNotFoundError(LookupError):
    """Raised when a generated scenario has not been persisted."""


class GeneratedScenarioDeletedError(RuntimeError):
    """Raised when a command targets a permanently deleted generated persona."""


class IdempotencyConflictError(ValueError):
    """Raised when an idempotency key is reused for different generation inputs."""


class InvalidIdempotencyKeyError(ValueError):
    """Raised when a generation command has no usable idempotency key."""


class IdempotencyStateNotFoundError(RuntimeError):
    """Raised when a completed idempotency claim has no generated state."""


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


@dataclass(frozen=True, slots=True)
class GeneratedScenarioSummary:
    """A framework-neutral read model for one persona in the library listing."""

    scenario_id: str
    scenario_version: str
    seed: int
    display_name: str
    locale: str
    initial_state_hash: str
    created_at: datetime
    last_activity_at: datetime
    conversation_count: int


@dataclass(frozen=True, slots=True)
class PersonaLibraryFilter:
    """Optional narrowing for the persona library listing.

    ``framework_id`` restricts the listing to personas that have at least one conversation on
    that framework, and the conversation count and activity then reflect only that framework.
    ``active_since`` keeps personas whose most recent activity is at or after the given instant.
    """

    scenario_id: str | None = None
    scenario_version: str | None = None
    framework_id: str | None = None
    active_since: datetime | None = None


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


class ScenarioGenerationService:
    """Persist deterministic generation and make command retries idempotent."""

    __slots__ = ("_clock", "_idempotency", "_kernel", "_scenarios")

    def __init__(
        self,
        kernel: ScenarioGenerationKernel,
        scenarios: GeneratedScenarioRepository,
        idempotency: ScenarioGenerationIdempotencyRepository,
        clock: Clock,
    ) -> None:
        self._kernel = kernel
        self._scenarios = scenarios
        self._idempotency = idempotency
        self._clock = clock

    def generate(
        self,
        scenario_id: str,
        scenario_version: str,
        seed: int,
        *,
        idempotency_key: str,
    ) -> GeneratedScenario:
        if (
            not idempotency_key.strip()
            or idempotency_key != idempotency_key.strip()
            or len(idempotency_key) > 128
        ):
            raise InvalidIdempotencyKeyError(
                "idempotency key must contain 1 to 128 characters without surrounding whitespace"
            )

        request_identity = (scenario_id, scenario_version, seed)
        if self._scenarios.was_deleted(*request_identity):
            raise GeneratedScenarioDeletedError(
                f"generated scenario {scenario_id}@{scenario_version} "
                f"with seed {seed} was permanently deleted"
            )
        replay_identity = self._idempotency.claim(
            idempotency_key,
            scenario_id,
            scenario_version,
            seed,
            self._clock.now(),
        )
        if replay_identity is not None:
            if replay_identity != request_identity:
                raise IdempotencyConflictError(
                    "idempotency key was already used for different generation inputs"
                )
            replay = self._scenarios.get(*request_identity)
            if replay is None:
                raise IdempotencyStateNotFoundError(
                    "idempotency record references missing generated state"
                )
            return replay

        persisted = self._scenarios.get(*request_identity)
        if persisted is None:
            persisted = self._kernel.generate(scenario_id, scenario_version, seed)
            self._scenarios.save(persisted)

        return persisted

    def get(self, scenario_id: str, scenario_version: str, seed: int) -> GeneratedScenario:
        persisted = self._scenarios.get(scenario_id, scenario_version, seed)
        if persisted is None:
            raise GeneratedScenarioNotFoundError(
                f"generated scenario {scenario_id}@{scenario_version} "
                f"with seed {seed} was not found"
            )
        return persisted

    def delete(self, scenario_id: str, scenario_version: str, seed: int) -> None:
        """Permanently delete a generated persona and its dependent conversations."""
        if not self._scenarios.delete(
            scenario_id,
            scenario_version,
            seed,
            deleted_at=self._clock.now(),
        ):
            raise GeneratedScenarioNotFoundError(
                f"generated scenario {scenario_id}@{scenario_version} "
                f"with seed {seed} was not found"
            )

    def list_summaries(
        self,
        *,
        limit: int,
        page: int,
        filters: PersonaLibraryFilter | None = None,
    ) -> tuple[list[GeneratedScenarioSummary], int]:
        """Return one page of personas and the total count for the same filters."""
        offset = (page - 1) * limit
        return self._scenarios.list_summaries(
            limit=limit,
            offset=offset,
            filters=filters or PersonaLibraryFilter(),
        )


def create_retail_profile_kernel(clock: Clock) -> ScenarioGenerationKernel:
    return ScenarioGenerationKernel(
        registry=ScenarioRegistry((RETAIL_PROFILE_V1, RETAIL_ORDER_CANCELLATION_V1)),
        generators={
            (RETAIL_PROFILE_V1.scenario_id, RETAIL_PROFILE_V1.scenario_version): (
                generate_retail_profile_v1
            ),
            (
                RETAIL_ORDER_CANCELLATION_V1.scenario_id,
                RETAIL_ORDER_CANCELLATION_V1.scenario_version,
            ): generate_retail_order_cancellation_v1,
        },
        clock=clock,
    )
