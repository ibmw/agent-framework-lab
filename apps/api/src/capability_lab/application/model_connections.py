"""The lab's own connection to a model provider: where it points, and under which key.

ADR 0052 moves the provider connection out of the process environment and into the lab's
database. ADR 0044 had refused a credential form on the reading that `docs/observability.md`
forbids this application from recording a secret at all; that reading was too wide —
`observability.md` is a rule about what leaves the process as telemetry — and what survives
from it is kept here whole: **the key is never logged, never traced, never served, never
echoed in an error, and never written to a canonical document.**

Four rules shape this module.

**A connection is a property of the installation, not a definition.** It has no draft, no
published version and no fingerprint, and nothing here may enter one (ADR 0005, ADR 0007).

**It is keyed by the provider id the lab already uses** — the `providers` of
`PROVEN_FRAMEWORKS` and the `provider` of `PROVEN_JUDGES`. `openai` names the protocol this
lab has proven it can speak rather than the company, so Ollama, vLLM, OpenRouter and Together
are base URLs under that same id rather than new providers. A provider the proven tables do
not know gets no connection: a connection is where a key lives, not a claim that the lab can
run something (ADR 0053 keeps that door).

**It holds no model.** The model is authored content, resolved from each arm's published
configuration (ADR 0024); a model on the connection would be the environment's model
substituting for an authored input in a friendlier hat.

**No fact about the key is ever served.** Not the value, not a prefix or a suffix, not a
length, not a hash, not a mask. `key_configured` and `key_added_at`, and nothing else. The
cost is named rather than hidden: an operator who has forgotten which key is installed cannot
tell from this lab, and their path is to save the one they mean.

**The environment stays the bootstrap, and the chain says which won.** Per provider, in
order: the saved connection; else `AGENT_LAB_OPENAI_API_KEY` with that provider's own
endpoint; else offline. `ModelConnectionResolver` is that chain and `ResolvedConnection` is
its answer, resolved per request because a connection can change while the process runs.

Testing a connection is a question about a moment, so its answer is not stored. A stored
green tick would be read as a promise the lab cannot keep.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from types import MappingProxyType
from typing import Protocol

from capability_lab.application.agent_capabilities import PROVEN_FRAMEWORKS
from capability_lab.application.judge_capabilities import (
    CONTROL_JUDGE_PROVIDER,
    OPENAI_JUDGE_PROVIDER,
    PROVEN_JUDGES,
)
from capability_lab.application.ports import Clock
from capability_lab.domain.model_connection import (
    ModelConnectionConfigurationError,
    normalize_base_url,
)

__all__ = [
    "CONNECTABLE_PROVIDERS",
    "ENVIRONMENT_BOOTSTRAP_ENDPOINTS",
    "KNOWN_PROVIDERS",
    "OPENAI_PROVIDER",
    "CredentialCipher",
    "CredentialDecryptionError",
    "CredentialEncryptionUnavailableError",
    "HttpStatusClass",
    "ModelConnection",
    "ModelConnectionNotConnectableError",
    "ModelConnectionRecord",
    "ModelConnectionRepository",
    "ModelConnectionResolver",
    "ModelConnectionService",
    "ModelConnectionSource",
    "ModelEndpointOutcome",
    "ModelEndpointProbe",
    "ModelEndpointProbeResult",
    "ProviderConnection",
    "ResolvedConnection",
]

KNOWN_PROVIDERS: frozenset[str] = frozenset(
    {provider for framework in PROVEN_FRAMEWORKS for provider in framework.providers}
    | {judge.provider for judge in PROVEN_JUDGES}
)
"""Every provider id the two proven tables use, read from them rather than restated.

A provider declared publishable joins this set on the day it is declared, which is the
registry-driven rule every other sweep in this project follows (ADR 0023).
"""

CONNECTABLE_PROVIDERS: tuple[str, ...] = tuple(sorted(KNOWN_PROVIDERS - {CONTROL_JUDGE_PROVIDER}))
"""The providers a connection can be saved for: every known one that reaches a provider.

The declared control — the deterministic fake framework and the control judge share one id —
reaches nothing at all, so a base URL and a key for it would describe a call that is never
made. Today this leaves exactly one, which is why "one connection per lab" is true and true
for a reason that generalizes rather than as a limit somebody imposed.
"""


class ModelConnectionNotConnectableError(ModelConnectionConfigurationError):
    """Raised for a provider id that cannot hold a connection.

    Unknown to the proven tables, or known and offline. Both are refusals about the provider
    rather than about the endpoint, so the field they name is the provider.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message, field="provider_id")


class CredentialEncryptionUnavailableError(Exception):
    """Raised when the lab is asked to store a key with no encryption key configured.

    Declared here because it is part of the `CredentialCipher` contract, and raised by the
    adapter that knows which variable supplies it. There is deliberately no default: a shipped
    default encryption key is encryption theatre, and theatre is worse than the plain refusal
    because somebody would believe it (ADR 0052).
    """


class CredentialDecryptionError(Exception):
    """Raised when a stored key cannot be read back.

    Which in practice means the environment's encryption key has changed since the credential
    was saved. Re-saving the key is the way back, and it is the same path as rotation: a lab
    holding one credential does not need a second mechanism to replace it.
    """


class CredentialCipher(Protocol):
    """Encrypt and decrypt one credential at rest.

    A port rather than a helper because the primitive belongs to infrastructure and the rule
    belongs here: nothing above this line ever holds the stored form, and nothing below it
    decides whether a key may be stored.
    """

    def encrypt(self, plaintext: str) -> str:
        """Return the stored form of a key, or raise `CredentialEncryptionUnavailableError`."""
        ...

    def decrypt(self, ciphertext: str) -> str:
        """Return the key a stored form holds, or raise if it cannot be read back."""
        ...


@dataclass(frozen=True, slots=True)
class ModelConnectionRecord:
    """One connection exactly as it is stored.

    `encrypted_key` is the only shape the key has anywhere outside the cipher. It is never
    returned to a caller of this module, never rendered and never logged: this record is what
    the repository reads and writes, and `ModelConnection` is what everything else sees.
    """

    provider_id: str
    base_url: str
    encrypted_key: str | None
    key_added_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class ModelConnection:
    """One connection as the lab may describe it: where it points, and *that* it has a key."""

    provider_id: str
    base_url: str
    key_configured: bool
    key_added_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, record: ModelConnectionRecord) -> ModelConnection:
        return cls(
            provider_id=record.provider_id,
            base_url=record.base_url,
            key_configured=record.encrypted_key is not None,
            key_added_at=record.key_added_at,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )


@dataclass(frozen=True, slots=True)
class ProviderConnection:
    """A provider that can hold a connection, and the one it holds if any.

    An absent connection is `None` rather than a missing row, because "this lab is not
    pointed anywhere yet" is an answer rather than a not-found.
    """

    provider_id: str
    connection: ModelConnection | None


OPENAI_PROVIDER: str = OPENAI_JUDGE_PROVIDER
"""The one connectable provider today, named once so the chain and the tables cannot drift.

`openai` is the protocol the lab has proven it can speak rather than the company (ADR 0052),
which is why Ollama, vLLM, OpenRouter and Together are base URLs under this same id.
"""

ENVIRONMENT_BOOTSTRAP_ENDPOINTS: Mapping[str, str] = MappingProxyType(
    {OPENAI_PROVIDER: "https://api.openai.com/v1"}
)
"""The providers `AGENT_LAB_OPENAI_API_KEY` can bootstrap, and the endpoint that reaches.

A mapping rather than a single default, because the bootstrap is a claim about **one**
variable: the environment supplies an OpenAI key, so it can only stand in for the provider
whose own endpoint that key is for. A second connectable provider would need its own variable
before it could appear here, and until it does the honest answer for it is offline rather than
"the environment's key, pointed somewhere it was never issued for".

The value is the endpoint the SDK reaches when it is handed no base URL, written out because a
run pins what it reached and `None` would be the record for *no provider was reached*.
"""


class ModelConnectionSource(StrEnum):
    """Which answer to *where is this lab pointed* is in force, for one provider.

    Enumerated rather than inferred from a pair of booleans at each reader, because the states
    do not decompose. A lab holding both a saved connection and an environment key "otherwise
    answers in a way neither one explains" (ADR 0052), and a saved connection whose key will
    not decrypt is a third fact again — not an absent connection, and not a working one.

    This is what `getLabStatus` serves beside the run mode, and it is a fact about *which
    configuration won*, never a fact about the key: no value, prefix, suffix, length or hash
    of a secret is derivable from any member here.
    """

    SAVED = "saved"
    """A connection saved in this lab is in force, and the lab can reach its endpoint.

    Including one saved with no key at all. That is not an oversight: a local endpoint needs
    no credential, and "an arm against a local model with no credential leaving the machine"
    is the case ADR 0052 exists for.
    """

    SAVED_UNREADABLE = "saved_unreadable"
    """A connection is saved and its key cannot be read back, so the lab reaches nothing.

    In practice `AGENT_LAB_CREDENTIAL_KEY` has changed or been unset since the key was saved.
    The saved connection still wins — falling through to the environment would send the
    environment's key to the endpoint the operator pointed at, which is the split ADR 0052
    refuses — so it wins as an *offline* lab, and the remedy is to save the key again.

    This member is why `key_configured` could not be left to carry the whole answer. That flag
    reports presence and not readability (ADR 0052 accepts that the page cannot distinguish
    two keys), and a run mode computed from presence alone would promise a lab that is ready
    while every advance refuses.
    """

    ENVIRONMENT = "environment"
    """No connection is saved and `AGENT_LAB_OPENAI_API_KEY` is set: the bootstrap is in force.

    Which is what keeps a fresh checkout and CI working unattended, and what a lab that never
    opens `/settings` runs on.
    """

    NONE = "none"
    """Neither is configured. Only the deterministic control arm can be advanced."""


@dataclass(frozen=True, slots=True)
class ResolvedConnection:
    """Where one provider is reached, resolved for one request.

    Resolved per request rather than at start-up, and read **once per advance**: an advance
    runs to completion against what it resolved, so a save landing halfway through cannot move
    the endpoint underneath a model call (ADR 0052).

    `base_url` is the whole of "does this lab reach a provider": it is set exactly for `SAVED`
    and `ENVIRONMENT`, and `None` for the two states that reach nothing. The invariant is
    checked rather than documented, because run mode, the composed runtimes and the endpoint a
    run is pinned to are all read off it and three readers agreeing by convention is three
    chances to disagree.
    """

    provider_id: str
    source: ModelConnectionSource
    base_url: str | None = None
    api_key: str | None = field(default=None, repr=False)
    """The credential this resolution reaches under, and the one field that never prints.

    Kept out of the generated `repr` and replaced below by a word, because this is the only
    structure in the lab that holds a *decrypted* key: `Settings` keeps both of its secrets in
    `SecretStr` for exactly this reason, and resolving one into a plain dataclass field would
    have undone that the first time anything formatted a `ResolvedConnection` — a dependency in
    a traceback, a log record, an error payload. Nothing does today. The rule ADR 0052 states
    is absolute rather than conditional on nobody doing it, so it is enforced by the type
    rather than by the absence of a caller.

    A plain `str` rather than `SecretStr`: the application layer takes no pydantic dependency,
    and `repr=False` with the `__repr__` below buys the same protection without one.
    """

    def __post_init__(self) -> None:
        reaches = self.source in _REACHING_SOURCES
        if reaches != (self.base_url is not None):
            raise ValueError(
                f"a {self.source.value} connection must {'name' if reaches else 'name no'} endpoint"
            )
        if not reaches and self.api_key is not None:
            raise ValueError("a connection that reaches no endpoint carries no key")

    def __repr__(self) -> str:
        """Everything about this resolution except the credential, which is named not shown.

        Written out rather than left to `repr=False` alone, because a silently shorter repr
        makes a reader wonder whether a key is held. Whether one is held is the same fact
        `key_configured` already serves publicly; what it *is* appears nowhere.
        """
        held = "None" if self.api_key is None else "<redacted>"
        return (
            f"ResolvedConnection(provider_id={self.provider_id!r}, source={self.source!r}, "
            f"base_url={self.base_url!r}, api_key={held})"
        )

    @property
    def reaches_provider(self) -> bool:
        """Whether an arm or a judge can actually be run against this resolution."""
        return self.base_url is not None


_REACHING_SOURCES = frozenset({ModelConnectionSource.SAVED, ModelConnectionSource.ENVIRONMENT})


class ModelConnectionResolver:
    """The chain ADR 0052 writes: the saved connection; else the environment; else offline.

    A saved connection wins **whole**. It wins when it carries no key, because a local
    endpoint needs none; and it wins when its key cannot be decrypted, as an offline lab,
    because the alternative is quietly sending the environment's key to an endpoint the
    operator pointed somewhere else.

    Deliberately not the test environment's short-circuit. Selecting the SDK doubles happens
    before this chain is consulted at all (`infrastructure/agents/registry.py`), which is what
    keeps a suite from depending on a resolution and keeps this class a statement about the
    operator's configuration rather than about the process's.
    """

    def __init__(
        self,
        connections: ModelConnectionRepository,
        cipher: CredentialCipher,
        *,
        environment_key: str | None,
    ) -> None:
        self._connections = connections
        self._cipher = cipher
        self._environment_key = environment_key

    def resolve(self, provider_id: str) -> ResolvedConnection:
        record = self._connections.get(provider_id)
        if record is not None:
            return self._saved(record)
        bootstrap = ENVIRONMENT_BOOTSTRAP_ENDPOINTS.get(provider_id)
        if bootstrap is not None and self._environment_key is not None:
            return ResolvedConnection(
                provider_id=provider_id,
                source=ModelConnectionSource.ENVIRONMENT,
                base_url=bootstrap,
                api_key=self._environment_key,
            )
        return ResolvedConnection(provider_id=provider_id, source=ModelConnectionSource.NONE)

    def _saved(self, record: ModelConnectionRecord) -> ResolvedConnection:
        if record.encrypted_key is None:
            return ResolvedConnection(
                provider_id=record.provider_id,
                source=ModelConnectionSource.SAVED,
                base_url=record.base_url,
            )
        try:
            api_key = self._cipher.decrypt(record.encrypted_key)
        except (CredentialDecryptionError, CredentialEncryptionUnavailableError):
            # Swallowed rather than raised, and this is the one place in the lab that does it:
            # every *other* path to the cipher is an operator asking for something, where the
            # refusal naming `AGENT_LAB_CREDENTIAL_KEY` is the answer. This path is composition
            # answering "what can this process run", and a lab that refused to serve its own
            # settings page because a stored key will not open could not show the operator the
            # control that fixes it.
            return ResolvedConnection(
                provider_id=record.provider_id,
                source=ModelConnectionSource.SAVED_UNREADABLE,
            )
        return ResolvedConnection(
            provider_id=record.provider_id,
            source=ModelConnectionSource.SAVED,
            base_url=record.base_url,
            api_key=api_key,
        )


class ModelEndpointOutcome(StrEnum):
    """What one probe of an endpoint established, and the whole of what it may say."""

    REACHABLE = "reachable"
    """The endpoint answered and accepted the credential it was given."""

    REFUSED = "refused"
    """The endpoint answered and rejected the credential."""

    UNREACHABLE = "unreachable"
    """Nothing usable answered: no connection, a timeout, or an answer that is not an endpoint."""


class HttpStatusClass(StrEnum):
    """The class of the status an endpoint answered with, when one answered.

    A class rather than a code, and never the body. A provider's error text is a string this
    lab did not write and cannot promise the contents of, which is the same rule a tool result
    follows when it refuses to describe a failure in the provider's words.
    """

    INFORMATIONAL = "1xx"
    SUCCESS = "2xx"
    REDIRECTION = "3xx"
    CLIENT_ERROR = "4xx"
    SERVER_ERROR = "5xx"

    @classmethod
    def of(cls, status_code: int) -> HttpStatusClass | None:
        return _STATUS_CLASSES.get(status_code // 100)


_STATUS_CLASSES: dict[int, HttpStatusClass] = {
    1: HttpStatusClass.INFORMATIONAL,
    2: HttpStatusClass.SUCCESS,
    3: HttpStatusClass.REDIRECTION,
    4: HttpStatusClass.CLIENT_ERROR,
    5: HttpStatusClass.SERVER_ERROR,
}


@dataclass(frozen=True, slots=True)
class ModelEndpointProbeResult:
    """What one throwaway call established about one endpoint at one moment."""

    outcome: ModelEndpointOutcome
    latency_ms: int
    status_class: HttpStatusClass | None


class ModelEndpointProbe(Protocol):
    """One cheap call to one endpoint, classified.

    The classification is a closed table declared here and the mapping onto it is the
    adapter's, exactly as a framework's failures are classified into the recorded taxonomy
    rather than recorded in the framework's own words (ADR 0026).
    """

    async def probe(self, *, base_url: str, api_key: str | None) -> ModelEndpointProbeResult: ...


class ModelConnectionRepository(Protocol):
    """Read and write the lab's connections, keyed by provider."""

    def get(self, provider_id: str) -> ModelConnectionRecord | None: ...

    def list_all(self) -> tuple[ModelConnectionRecord, ...]: ...

    def upsert(self, record: ModelConnectionRecord) -> None:
        """Write this provider's connection, replacing whatever it held.

        Idempotent over the provider: saving the same connection twice leaves one row saying
        the same thing, which is what makes the operator's *Replace* path safe to repeat.
        """
        ...


class ModelConnectionService:
    """Read, save and test the lab's connection to a provider."""

    def __init__(
        self,
        connections: ModelConnectionRepository,
        cipher: CredentialCipher,
        probe: ModelEndpointProbe,
        clock: Clock,
    ) -> None:
        self._connections = connections
        self._cipher = cipher
        self._probe = probe
        self._clock = clock

    def list_providers(self) -> tuple[ProviderConnection, ...]:
        """Every provider that can hold a connection, with the one it holds.

        The whole table rather than only the saved rows: what a reader is asking is where this
        lab can be pointed, and a listing of rows would answer that with silence on a lab
        nobody has configured yet.
        """
        saved = {
            record.provider_id: ModelConnection.of(record)
            for record in self._connections.list_all()
        }
        return tuple(
            ProviderConnection(provider_id=provider_id, connection=saved.get(provider_id))
            for provider_id in CONNECTABLE_PROVIDERS
        )

    def get(self, provider_id: str) -> ProviderConnection:
        self._require_connectable(provider_id)
        record = self._connections.get(provider_id)
        return ProviderConnection(
            provider_id=provider_id,
            connection=None if record is None else ModelConnection.of(record),
        )

    def save(
        self,
        provider_id: str,
        *,
        base_url: str,
        api_key: str | None,
    ) -> ProviderConnection:
        """Point the lab at one endpoint, optionally replacing the key it reaches under.

        An absent key leaves the stored one in place, which is what makes changing a base URL
        an operation an operator can perform without retyping a credential they cannot read
        back. A key that *is* supplied is encrypted before anything is written, so a lab with
        no `AGENT_LAB_CREDENTIAL_KEY` refuses the save whole rather than storing half of it.
        """
        self._require_connectable(provider_id)
        endpoint = normalize_base_url(base_url)
        existing = self._connections.get(provider_id)
        now = self._clock.now()

        if api_key is None:
            encrypted = None if existing is None else existing.encrypted_key
            key_added_at = None if existing is None else existing.key_added_at
        else:
            if not api_key.strip():
                raise ModelConnectionConfigurationError(
                    "api_key must not be blank; leave it out to keep the stored key",
                    field="api_key",
                )
            encrypted = self._cipher.encrypt(api_key)
            key_added_at = now

        record = ModelConnectionRecord(
            provider_id=provider_id,
            base_url=endpoint,
            encrypted_key=encrypted,
            key_added_at=key_added_at,
            created_at=now if existing is None else existing.created_at,
            updated_at=now,
        )
        self._connections.upsert(record)
        return ProviderConnection(provider_id=provider_id, connection=ModelConnection.of(record))

    async def test(
        self,
        provider_id: str,
        *,
        base_url: str,
        api_key: str | None,
    ) -> ModelEndpointProbeResult:
        """Make one throwaway call to what the operator has typed, and store nothing.

        The key falls back to the saved one so that an operator can change a base URL and
        check it before saving, without retyping a credential the lab will not show them. That
        fallback is a repository read and deliberately not the resolution chain: the
        environment is the bootstrap for *running* an arm, and a test is a question about the
        connection in front of the operator rather than about what a run would resolve.
        """
        self._require_connectable(provider_id)
        endpoint = normalize_base_url(base_url)
        return await self._probe.probe(
            base_url=endpoint,
            api_key=api_key if api_key is not None else self._saved_key(provider_id),
        )

    def _saved_key(self, provider_id: str) -> str | None:
        record = self._connections.get(provider_id)
        if record is None or record.encrypted_key is None:
            return None
        return self._cipher.decrypt(record.encrypted_key)

    @staticmethod
    def _require_connectable(provider_id: str) -> None:
        if provider_id in CONNECTABLE_PROVIDERS:
            return
        if provider_id in KNOWN_PROVIDERS:
            raise ModelConnectionNotConnectableError(
                f"provider {provider_id} reaches no endpoint, so it holds no connection"
            )
        raise ModelConnectionNotConnectableError(
            f"provider {provider_id} is not a provider this lab has proven it can run"
        )
