"""Where this lab is pointed, and what it composes once it knows (ADR 0052).

Two questions, asserted apart because they are answered apart.

`ModelConnectionResolver` answers *where is this lab pointed* — the chain ADR 0052 writes:
the saved connection; else `AGENT_LAB_OPENAI_API_KEY` with that provider's own endpoint; else
offline. It is written here as a **table** of every state, rather than as a case per rule,
because the states do not decompose: "saved" and "an environment key" are not two independent
booleans a reader can reason from, and a saved connection whose key will not decrypt is a
fourth answer rather than a shade of one of the others.

The three factories answer *what can this process run*, from that resolution — and the test
environment's short-circuit is asserted to come **first**, which is the assertion that fails
if a suite in this repository ever started depending on what an operator had saved.
"""

from datetime import UTC, datetime
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from opentelemetry.sdk.trace import TracerProvider
from pydantic import SecretStr

from capability_lab.application.agent_capabilities import (
    FAKE_FRAMEWORK_ID,
    OPENAI_AGENTS_FRAMEWORK_ID,
    PYDANTIC_AI_FRAMEWORK_ID,
)
from capability_lab.application.conversations import AgentRegistry
from capability_lab.application.judge_capabilities import (
    CONTROL_JUDGE_PROVIDER,
    OPENAI_JUDGE_PROVIDER,
)
from capability_lab.application.model_connections import (
    ENVIRONMENT_BOOTSTRAP_ENDPOINTS,
    OPENAI_PROVIDER,
    CredentialDecryptionError,
    ModelConnectionRecord,
    ModelConnectionResolver,
    ModelConnectionSource,
    ResolvedConnection,
)
from capability_lab.domain.model_connection import normalize_base_url
from capability_lab.infrastructure.agents.registry import (
    ComposedPerConnection,
    create_agent_registry,
    create_judge_runtimes,
    create_support_agent_runtimes,
)
from capability_lab.infrastructure.config import Settings
from capability_lab.infrastructure.credentials import (
    AesGcmCredentialCipher,
    UnconfiguredCredentialCipher,
)
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
)
from capability_lab.infrastructure.telemetry import Telemetry
from capability_lab.presentation import api as api_module
from capability_lab.presentation.api import create_app

SAVED_ENDPOINT = "http://localhost:11434/v1"
SAVED_KEY = "sk-saved-1f4c2b90d7e34a55b8c1e6f20973ad48"
ENVIRONMENT_KEY = "sk-env-6b3d0a71c94e4f28ad55e0c7b1f93624"
ENVIRONMENT_ENDPOINT = ENVIRONMENT_BOOTSTRAP_ENDPOINTS[OPENAI_PROVIDER]
ENCRYPTION_KEY = "6TDBMFFf0eAfNqmt6IrGLM1fSZbwKl3NPEO8T4sHXi0="
MOMENT = datetime(2026, 9, 22, 9, 30, tzinfo=UTC)


def telemetry() -> Telemetry:
    """A tracer the POC's registry decorates its adapters with, and nothing else."""
    return Telemetry(TracerProvider().get_tracer("composition"), b"composition-test-salt")


class InMemoryConnections:
    """The repository port, held in a dict so the chain's rules are what is under test."""

    def __init__(self, *records: ModelConnectionRecord) -> None:
        self.rows = {record.provider_id: record for record in records}

    def get(self, provider_id: str) -> ModelConnectionRecord | None:
        return self.rows.get(provider_id)

    def list_all(self) -> tuple[ModelConnectionRecord, ...]:
        return tuple(self.rows[key] for key in sorted(self.rows))

    def upsert(self, record: ModelConnectionRecord) -> None:
        self.rows[record.provider_id] = record


def saved(
    *, key: str | None = SAVED_KEY, cipher_key: str = ENCRYPTION_KEY
) -> ModelConnectionRecord:
    return ModelConnectionRecord(
        provider_id=OPENAI_PROVIDER,
        base_url=SAVED_ENDPOINT,
        encrypted_key=None if key is None else AesGcmCredentialCipher(cipher_key).encrypt(key),
        key_added_at=None if key is None else MOMENT,
        created_at=MOMENT,
        updated_at=MOMENT,
    )


def resolve(
    *,
    record: ModelConnectionRecord | None = None,
    environment_key: str | None = None,
    encryption_key: str | None = ENCRYPTION_KEY,
) -> ResolvedConnection:
    connections = InMemoryConnections(*(() if record is None else (record,)))
    cipher = (
        UnconfiguredCredentialCipher()
        if encryption_key is None
        else AesGcmCredentialCipher(encryption_key)
    )
    resolver = ModelConnectionResolver(connections, cipher, environment_key=environment_key)
    return resolver.resolve(OPENAI_PROVIDER)


# -- the chain, as a table of every state ----------------------------------------


def test_a_saved_connection_alone_is_in_force() -> None:
    connection = resolve(record=saved())

    assert connection.source is ModelConnectionSource.SAVED
    assert connection.base_url == SAVED_ENDPOINT
    assert connection.api_key == SAVED_KEY
    assert connection.reaches_provider is True


def test_the_environment_alone_bootstraps_the_provider_s_own_endpoint() -> None:
    connection = resolve(environment_key=ENVIRONMENT_KEY)

    assert connection.source is ModelConnectionSource.ENVIRONMENT
    assert connection.base_url == ENVIRONMENT_ENDPOINT
    assert connection.api_key == ENVIRONMENT_KEY
    assert connection.reaches_provider is True


def test_a_saved_connection_wins_over_the_environment_and_the_source_says_so() -> None:
    """The state a lab holding both is in, which neither configuration explains alone.

    Both halves are asserted: the endpoint *and* the key are the saved ones, so a lab
    repointed at a local model cannot still be sending the environment's credential — and the
    source is the fact `getLabStatus` serves, because an operator looking at a credentialed
    lab with a key still in their shell has no other way to tell which one is in force.
    """
    connection = resolve(record=saved(), environment_key=ENVIRONMENT_KEY)

    assert connection.source is ModelConnectionSource.SAVED
    assert connection.base_url == SAVED_ENDPOINT
    assert connection.api_key == SAVED_KEY
    assert connection.api_key != ENVIRONMENT_KEY
    assert connection.base_url != ENVIRONMENT_ENDPOINT


def test_neither_is_offline_and_reaches_nothing() -> None:
    connection = resolve()

    assert connection.source is ModelConnectionSource.NONE
    assert connection.base_url is None
    assert connection.api_key is None
    assert connection.reaches_provider is False


def test_the_table_covers_every_source_the_chain_can_answer_with() -> None:
    """Enumerated rather than trusted: a fifth answer arrives with a test or not at all."""
    answered = {
        resolve(record=saved()).source,
        resolve(environment_key=ENVIRONMENT_KEY).source,
        resolve(record=saved(), environment_key=ENVIRONMENT_KEY).source,
        resolve().source,
        resolve(record=saved(cipher_key="7yZq0OYBRiWkTb9VzPz6fF7dDX3EoyfHBEJL6sMmJjE=")).source,
    }

    assert answered == set(ModelConnectionSource)


# -- a saved connection wins whole -----------------------------------------------


def test_a_saved_connection_with_no_key_still_points_the_lab_at_its_endpoint() -> None:
    """A local endpoint needs no credential, which is the case this feature exists for."""
    connection = resolve(record=saved(key=None), environment_key=ENVIRONMENT_KEY)

    assert connection.source is ModelConnectionSource.SAVED
    assert connection.base_url == SAVED_ENDPOINT
    assert connection.api_key is None
    assert connection.reaches_provider is True


def test_a_saved_key_that_will_not_decrypt_leaves_the_lab_offline_and_says_which() -> None:
    """`key_configured` reports presence; this reports readability, and they differ.

    The saved connection still wins — falling through to the environment would send the
    environment's key to the endpoint the operator pointed somewhere else — so it wins as an
    offline lab. A run mode computed from presence alone would promise an operator a lab that
    is ready while every advance refuses.
    """
    stale = saved(cipher_key="7yZq0OYBRiWkTb9VzPz6fF7dDX3EoyfHBEJL6sMmJjE=")
    connection = resolve(record=stale, environment_key=ENVIRONMENT_KEY)

    assert connection.source is ModelConnectionSource.SAVED_UNREADABLE
    assert connection.base_url is None
    assert connection.api_key is None
    assert connection.reaches_provider is False


def test_a_lab_that_lost_its_encryption_key_reads_the_same_way() -> None:
    """`AGENT_LAB_CREDENTIAL_KEY` unset is the same fact as one that changed: unreadable."""
    connection = resolve(record=saved(), encryption_key=None)

    assert connection.source is ModelConnectionSource.SAVED_UNREADABLE
    assert connection.reaches_provider is False


def test_resolving_never_raises_what_the_operator_s_own_requests_raise() -> None:
    """Composition cannot refuse to answer, or the page holding the remedy would not load."""
    stale = saved(cipher_key="7yZq0OYBRiWkTb9VzPz6fF7dDX3EoyfHBEJL6sMmJjE=")
    with pytest.raises(CredentialDecryptionError):
        AesGcmCredentialCipher(ENCRYPTION_KEY).decrypt(str(stale.encrypted_key))

    assert resolve(record=stale).source is ModelConnectionSource.SAVED_UNREADABLE


def test_the_bootstrap_endpoint_is_one_the_lab_would_store() -> None:
    """A run is pinned to it and compared against it, so it has to be canonical already."""
    assert normalize_base_url(ENVIRONMENT_ENDPOINT) == ENVIRONMENT_ENDPOINT


def test_a_resolution_that_reaches_nothing_cannot_carry_an_endpoint_or_a_key() -> None:
    """The invariant three readers depend on, checked rather than left to convention."""
    for source in (ModelConnectionSource.NONE, ModelConnectionSource.SAVED_UNREADABLE):
        with pytest.raises(ValueError):
            ResolvedConnection(OPENAI_PROVIDER, source, base_url=SAVED_ENDPOINT)
    for source in (ModelConnectionSource.SAVED, ModelConnectionSource.ENVIRONMENT):
        with pytest.raises(ValueError):
            ResolvedConnection(OPENAI_PROVIDER, source)


# -- what the three factories compose from it ------------------------------------

STATES: tuple[tuple[str, ResolvedConnection], ...] = (
    ("saved", ResolvedConnection(OPENAI_PROVIDER, ModelConnectionSource.SAVED, SAVED_ENDPOINT)),
    (
        "environment",
        ResolvedConnection(
            OPENAI_PROVIDER,
            ModelConnectionSource.ENVIRONMENT,
            ENVIRONMENT_ENDPOINT,
            ENVIRONMENT_KEY,
        ),
    ),
    (
        "saved_unreadable",
        ResolvedConnection(OPENAI_PROVIDER, ModelConnectionSource.SAVED_UNREADABLE),
    ),
    ("none", ResolvedConnection(OPENAI_PROVIDER, ModelConnectionSource.NONE)),
)
STATE_IDS = [name for name, _ in STATES]
REACHING = {"saved", "environment"}


def test_the_factory_table_covers_every_source_too() -> None:
    """The bind the resolver table has, given to the table that drives the factory sweeps.

    `STATES` is written by hand, so without this a fifth member of the enum would silently
    skip every parametrised test below while the resolver's own exhaustiveness assertion went
    on passing — coverage that looks complete because the list it iterates is complete.
    """
    assert {name for name, _ in STATES} == {source.value for source in ModelConnectionSource}
    assert {name for name, _ in STATES} >= REACHING


@pytest.mark.parametrize(("name", "connection"), STATES, ids=STATE_IDS)
def test_the_model_backed_arms_appear_exactly_when_the_lab_reaches_an_endpoint(
    name: str, connection: ResolvedConnection
) -> None:
    runtimes = create_support_agent_runtimes(connection)

    assert FAKE_FRAMEWORK_ID in runtimes.framework_ids()
    modelled = {PYDANTIC_AI_FRAMEWORK_ID, OPENAI_AGENTS_FRAMEWORK_ID}
    registered = modelled & set(runtimes.framework_ids())
    assert registered == (modelled if name in REACHING else set())


@pytest.mark.parametrize(("name", "connection"), STATES, ids=STATE_IDS)
def test_the_model_backed_judge_appears_on_the_same_rule(
    name: str, connection: ResolvedConnection
) -> None:
    judges = create_judge_runtimes(connection)

    assert CONTROL_JUDGE_PROVIDER in judges.providers()
    assert (OPENAI_JUDGE_PROVIDER in judges.providers()) is (name in REACHING)


@pytest.mark.parametrize(("name", "connection"), STATES, ids=STATE_IDS)
def test_the_poc_s_own_registry_moves_with_the_other_two(
    name: str, connection: ResolvedConnection
) -> None:
    """A lab pointed at Ollama that still sent the POC's conversations to OpenAI would be a
    split nobody would predict from the settings page, so all three factories move together.
    """
    registry = create_agent_registry(connection, telemetry(), model_id="gpt-5-mini")
    available = {
        declaration.framework_id for declaration in registry.declarations() if declaration.available
    }

    assert FAKE_FRAMEWORK_ID in available
    assert (PYDANTIC_AI_FRAMEWORK_ID in available) is (name in REACHING)


def test_an_unreachable_lab_says_why_the_framework_is_absent_without_naming_a_variable() -> None:
    """The remedy is the settings page now, not a shell and a restart (ADR 0052)."""
    registry = create_agent_registry(
        ResolvedConnection(OPENAI_PROVIDER, ModelConnectionSource.NONE),
        telemetry(),
        model_id="gpt-5-mini",
    )
    absent = next(
        declaration
        for declaration in registry.declarations()
        if declaration.framework_id == PYDANTIC_AI_FRAMEWORK_ID
    )

    assert absent.available is False
    assert absent.unavailability_reason is not None
    assert "AGENT_LAB_OPENAI_API_KEY" not in absent.unavailability_reason


@pytest.mark.parametrize(("name", "connection"), STATES, ids=STATE_IDS)
def test_the_arms_are_built_against_the_endpoint_the_lab_resolved(
    name: str, connection: ResolvedConnection
) -> None:
    """What a runtime reports is what a run is pinned to, so it has to be the resolved one."""
    runtimes = create_support_agent_runtimes(connection)

    assert runtimes.get(FAKE_FRAMEWORK_ID).model_base_url is None
    if name not in REACHING:
        return
    for framework_id in (PYDANTIC_AI_FRAMEWORK_ID, OPENAI_AGENTS_FRAMEWORK_ID):
        assert runtimes.get(framework_id).model_base_url == connection.base_url


def test_the_judge_is_built_against_the_same_endpoint_and_the_control_against_none() -> None:
    judges = create_judge_runtimes(
        ResolvedConnection(OPENAI_PROVIDER, ModelConnectionSource.SAVED, SAVED_ENDPOINT)
    )

    assert judges.get(OPENAI_JUDGE_PROVIDER).model_base_url == SAVED_ENDPOINT
    assert judges.get(CONTROL_JUDGE_PROVIDER).model_base_url is None


# -- a registry is held per resolution, not rebuilt per request -------------------


def test_one_resolution_composes_one_registry_however_often_it_is_asked_for() -> None:
    """What moved to the request is the reading; composing is what that reading costs.

    The POC's adapter takes a `Model` rather than a factory, so composing its registry builds
    a provider client and its connection pool eagerly. Rebuilt per request, every conversation
    turn and every framework listing would open one and drop it unclosed — invisible to this
    suite, because the test environment takes the doubles branch, and live in the only lab an
    operator actually runs.

    Asserted on identity and over an *equal but distinct* resolution, which is the shape a
    per-request read produces: two requests that resolve the same connection build two objects
    that compare equal, and a cache keyed by identity rather than by value would rebuild on
    every one of them.
    """
    built: list[ResolvedConnection] = []
    held = ComposedPerConnection(lambda connection: (built.append(connection), object())[1])

    saved_now = ResolvedConnection(OPENAI_PROVIDER, ModelConnectionSource.SAVED, SAVED_ENDPOINT)
    saved_again = ResolvedConnection(OPENAI_PROVIDER, ModelConnectionSource.SAVED, SAVED_ENDPOINT)
    assert saved_now == saved_again
    assert saved_now is not saved_again

    first = held(saved_now)
    second = held(saved_again)

    assert first is second
    assert len(built) == 1


def test_a_repointed_lab_composes_again_rather_than_serving_what_it_held() -> None:
    """The half that makes the cache safe: it is keyed by the whole resolution.

    A new endpoint, a new source and — the case a base-URL key would get wrong — **the same
    endpoint under a replaced credential** each compose again. Serving a client built with a
    key the operator has just replaced would be a staleness bug worse than the rebuild it
    saved.
    """
    held = ComposedPerConnection(lambda _connection: object())
    at_ollama = ResolvedConnection(
        OPENAI_PROVIDER, ModelConnectionSource.SAVED, SAVED_ENDPOINT, SAVED_KEY
    )

    first = held(at_ollama)

    assert held(at_ollama) is first
    for moved in (
        ResolvedConnection(
            OPENAI_PROVIDER, ModelConnectionSource.SAVED, SAVED_ENDPOINT, "sk-replaced-key"
        ),
        ResolvedConnection(
            OPENAI_PROVIDER, ModelConnectionSource.SAVED, "http://localhost:8000/v1", SAVED_KEY
        ),
        ResolvedConnection(OPENAI_PROVIDER, ModelConnectionSource.NONE),
    ):
        assert held(moved) is not first


async def test_an_app_composes_one_registry_for_two_requests_to_one_resolution(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The same claim at the seam that had the defect: two requests, one composition.

    Counted at the factory rather than compared by identity, because what went wrong was the
    wiring — a registry composed inside a per-request dependency — and what an operator paid
    for it was one provider client per request. A unit test of the holder alone would pass
    over an app that never used it.
    """
    composed: list[ResolvedConnection] = []
    building = create_agent_registry

    def counting(
        connection: ResolvedConnection,
        telemetry: Telemetry,
        *,
        model_id: str,
        sdk_doubles: bool = False,
    ) -> AgentRegistry:
        composed.append(connection)
        return building(connection, telemetry, model_id=model_id, sdk_doubles=sdk_doubles)

    monkeypatch.setattr(api_module, "create_agent_registry", counting)

    database = f"sqlite:///{tmp_path / 'composition.db'}"
    engine = create_database_engine(database)
    Base.metadata.create_all(engine)
    application = create_app(
        Settings(
            environment="test",
            database_url=database,
            telemetry_hash_salt=SecretStr("test-only-telemetry-salt"),
            openai_api_key=None,
        ),
        session_factory=create_session_factory(engine),
    )

    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.get("/api/v1/agent-frameworks")
        second = await client.get("/api/v1/agent-frameworks")

    assert first.status_code == 200, first.text
    assert second.json() == first.json()
    assert len(composed) == 1


# -- the test environment's short-circuit, which precedes all four ----------------


@pytest.mark.parametrize(("name", "connection"), STATES, ids=STATE_IDS)
def test_the_sdk_doubles_are_selected_before_the_chain_is_consulted_at_all(
    name: str, connection: ResolvedConnection
) -> None:
    """The assertion that fails if the short-circuit ever became the second branch.

    Two halves, and the second is the load-bearing one. The doubles are composed for *every*
    state of the chain, including the two that reach nothing — and the runtimes they compose
    report **no** endpoint even where the resolution names one, which is what proves the
    resolved connection was not consulted rather than merely overridden. A double that
    claimed the lab's endpoint would pin a run to a call nobody made.
    """
    runtimes = create_support_agent_runtimes(connection, sdk_doubles=True)
    judges = create_judge_runtimes(connection, sdk_doubles=True)
    registry = create_agent_registry(
        connection, telemetry(), model_id="gpt-5-mini", sdk_doubles=True
    )

    assert set(runtimes.framework_ids()) == {
        FAKE_FRAMEWORK_ID,
        PYDANTIC_AI_FRAMEWORK_ID,
        OPENAI_AGENTS_FRAMEWORK_ID,
    }
    assert set(judges.providers()) == {CONTROL_JUDGE_PROVIDER, OPENAI_JUDGE_PROVIDER}
    assert {
        declaration.framework_id for declaration in registry.declarations() if declaration.available
    } == {FAKE_FRAMEWORK_ID, PYDANTIC_AI_FRAMEWORK_ID}

    for framework_id in runtimes.framework_ids():
        assert runtimes.get(framework_id).model_base_url is None
    for provider in judges.providers():
        assert judges.get(provider).model_base_url is None
