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

Testing a connection is a question about a moment, so its answer is not stored. A stored
green tick would be read as a promise the lab cannot keep.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Protocol

from capability_lab.application.agent_capabilities import PROVEN_FRAMEWORKS
from capability_lab.application.judge_capabilities import CONTROL_JUDGE_PROVIDER, PROVEN_JUDGES
from capability_lab.application.ports import Clock
from capability_lab.domain.model_connection import (
    ModelConnectionConfigurationError,
    normalize_base_url,
)

__all__ = [
    "CONNECTABLE_PROVIDERS",
    "KNOWN_PROVIDERS",
    "CredentialCipher",
    "CredentialDecryptionError",
    "CredentialEncryptionUnavailableError",
    "HttpStatusClass",
    "ModelConnection",
    "ModelConnectionNotConnectableError",
    "ModelConnectionRecord",
    "ModelConnectionRepository",
    "ModelConnectionService",
    "ModelEndpointOutcome",
    "ModelEndpointProbe",
    "ModelEndpointProbeResult",
    "ProviderConnection",
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
