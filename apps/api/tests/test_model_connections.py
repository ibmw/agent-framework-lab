"""Where this lab may be pointed, what it does with the key, and what one probe may say.

The HTTP boundary is asserted in `test_model_connection_api.py`; what each rule *means* is
asserted here, against the domain function, the cipher and the service that use them.
"""

import json
import logging
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ipaddress import ip_address
from pathlib import Path
from threading import Thread
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import pytest
from openai import OpenAIError

from capability_lab.application.agent_capabilities import PROVEN_FRAMEWORKS
from capability_lab.application.judge_capabilities import PROVEN_JUDGES
from capability_lab.application.model_connections import (
    CONNECTABLE_PROVIDERS,
    KNOWN_PROVIDERS,
    CredentialDecryptionError,
    CredentialEncryptionUnavailableError,
    HttpStatusClass,
    ModelConnectionNotConnectableError,
    ModelConnectionRecord,
    ModelConnectionService,
    ModelEndpointOutcome,
    ModelEndpointProbeResult,
)
from capability_lab.domain.model_connection import (
    ModelConnectionConfigurationError,
    normalize_base_url,
)
from capability_lab.infrastructure.agents.openai_agents import create_openai_agents_model
from capability_lab.infrastructure.agents.pydantic_ai.adapter import create_openai_model
from capability_lab.infrastructure.credentials import (
    CREDENTIAL_KEY_VARIABLE,
    AesGcmCredentialCipher,
    UnconfiguredCredentialCipher,
    create_credential_cipher,
)
from capability_lab.infrastructure.model_endpoints import (
    UNCREDENTIALED_API_KEY,
    OpenAiProtocolEndpointProbe,
)

API_KEY = "sk-lab-9d41c0e7b6a24f8fae3c15d2708b6c93"
OLLAMA_ENDPOINT = "http://localhost:11434/v1"
"""A keyless local endpoint, which is the case the placeholder above exists for."""
UPSTREAM_BODY = "invalid_api_key: the key sk-lab-9d41 was rejected by upstream"
"""What a provider might answer with, written to look like what providers actually answer
with: a message quoting a fragment of the credential that was sent. It is the string the probe
must never carry back, which is why it is worth having a leaky one to assert against."""


class FixedClock:
    def __init__(self, moment: datetime) -> None:
        self._moment = moment

    def now(self) -> datetime:
        return self._moment

    def set(self, moment: datetime) -> None:
        self._moment = moment


class InMemoryConnections:
    """The repository port, held in a dict so the service's rules are what is under test."""

    def __init__(self) -> None:
        self.rows: dict[str, ModelConnectionRecord] = {}

    def get(self, provider_id: str) -> ModelConnectionRecord | None:
        return self.rows.get(provider_id)

    def list_all(self) -> tuple[ModelConnectionRecord, ...]:
        return tuple(self.rows[key] for key in sorted(self.rows))

    def upsert(self, record: ModelConnectionRecord) -> None:
        self.rows[record.provider_id] = record


class RecordingProbe:
    """A probe that answers as told and remembers what it was handed."""

    def __init__(self, result: ModelEndpointProbeResult | None = None) -> None:
        self.calls: list[tuple[str, str | None]] = []
        self._result = result or ModelEndpointProbeResult(
            outcome=ModelEndpointOutcome.REACHABLE,
            latency_ms=12,
            status_class=HttpStatusClass.SUCCESS,
        )

    async def probe(self, *, base_url: str, api_key: str | None) -> ModelEndpointProbeResult:
        self.calls.append((base_url, api_key))
        return self._result


def service(
    connections: InMemoryConnections,
    *,
    probe: RecordingProbe | None = None,
    secret: str | None = "unit-test-encryption-key",
    clock: FixedClock | None = None,
) -> ModelConnectionService:
    cipher = UnconfiguredCredentialCipher() if secret is None else AesGcmCredentialCipher(secret)
    return ModelConnectionService(
        connections,
        cipher,
        probe or RecordingProbe(),
        clock or FixedClock(datetime(2026, 9, 21, 9, 0, tzinfo=UTC)),
    )


# --- the base URL table -------------------------------------------------------------------

ACCEPTED = [
    ("https://api.openai.com/v1", "https://api.openai.com/v1"),
    ("http://localhost:11434/v1", "http://localhost:11434/v1"),
    ("http://127.0.0.1:11434/v1", "http://127.0.0.1:11434/v1"),
    ("http://192.168.1.14:8000/v1", "http://192.168.1.14:8000/v1"),
    ("http://[::1]:11434/v1", "http://[::1]:11434/v1"),
    # RFC 4291 §2.2: one address, three spellings. Stored apart they would fire unit B's pin
    # refusal on a lab nobody repointed, which is the hazard the whole fold exists for.
    ("http://[0:0:0:0:0:0:0:1]:11434/v1", "http://[::1]:11434/v1"),
    ("http://[0000:0000:0000:0000:0000:0000:0000:0001]:11434/v1", "http://[::1]:11434/v1"),
    ("https://openrouter.ai/api/v1", "https://openrouter.ai/api/v1"),
    # The endpoint with no path at all is a legitimate base URL; an SDK appends to it.
    ("https://api.example.com", "https://api.example.com"),
    # The two loopback forms this lab does admit over http, beside the private ranges above.
    ("http://127.0.0.1/v1", "http://127.0.0.1/v1"),
    ("http://ollama.localhost:11434/v1", "http://ollama.localhost:11434/v1"),
    # An inner `//` and a percent-encoded path survive, because they are different request
    # targets rather than different spellings of one. The comment at the folding line argues
    # it; this pins the behaviour so that changing the argument has to change a test.
    ("https://api.example.com//v1//", "https://api.example.com//v1"),
    ("https://api.example.com/%76%31", "https://api.example.com/%76%31"),
]

REFUSED = [
    ("ftp://api.example.com/v1", "scheme"),
    ("file:///etc/passwd", "scheme"),
    ("https://user:hunter2@api.example.com/v1", "username or password"),
    ("https://api.example.com/v1?api_key=hunter2", "query"),
    ("https://api.example.com/v1#hunter2", "fragment"),
    # Plain http to a public host would put a typed key on the wire in clear text.
    ("http://api.example.com/v1", "loopback or private"),
    # Link-local is a third category ADR 0052 does not name, and this is the address it would
    # have admitted: the cloud instance-metadata endpoint, which `POST …/test` would then make
    # a server-side call to from a route nobody authenticates.
    ("http://169.254.169.254/latest", "loopback or private"),
    ("http://[fe80::1]/v1", "loopback or private"),
    # A name is decided by `localhost` alone, because resolving one would make a stored value
    # depend on the DNS of the moment it was saved. These are the common self-hosted spellings
    # that costs, and they are refused deliberately rather than by omission.
    ("http://ollama.internal/v1", "loopback or private"),
    ("http://gpu-box.lan:11434/v1", "loopback or private"),
    ("https:///v1", "host"),
    # Bracketed and not an IP literal: `urlsplit` refuses it eagerly with a bare ValueError,
    # which reached the route as a 500 until it was caught.
    ("http://[localhost]/v1", "host"),
    ("http://[not-an-ip]/v1", "host"),
    # `2001::/23` is subtracted whole. CPython counts the block as private, and `address.teredo`
    # matches only the `/32` inside it — so a rule written against that attribute admitted the
    # seven blocks IANA marks Globally Reachable. Both ends of the block are pinned here:
    # teredo, whose packets leave over a tunnel to a public relay, and AMT, which is simply
    # routed. Either would carry a typed key off the machine in the clear.
    ("http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/v1", "loopback or private"),
    ("http://[2001:3::1]/v1", "loopback or private"),
    ("", "empty"),
]


@pytest.mark.parametrize(("written", "stored"), ACCEPTED)
def test_an_endpoint_the_lab_will_store_is_stored_as_written(written: str, stored: str) -> None:
    assert normalize_base_url(written) == stored


def mapped_spelling(url: str) -> str | None:
    """The same URL with its IPv4 host written as an IPv4-mapped IPv6 literal, or `None`.

    Derived from the tables rather than written out beside them, so that an address added to
    either one is swept in both spellings on the day it is added. That is the rule every
    registry-driven sweep in this project follows (ADR 0023), and it is here because reasoning
    about this line has now been wrong twice: the mapped spelling of a refused address was
    admitted, because `ipaddress` reports `is_link_local` as `False` for it.
    """
    try:
        parts = urlsplit(url)
        host = parts.hostname
    except ValueError:
        # A row the standard library will not even parse — a bracketed host that is not an IP
        # literal — has no address to respell, and generating from it would raise at import.
        return None
    if host is None:
        return None
    # A row whose point is its userinfo, query or fragment cannot be rebuilt from its parts
    # here without dropping exactly that, which would generate a URL that normalises fine and
    # fail the refusal sweep for a reason the row was never about. Declining to generate one
    # keeps the derivation safe for rows nobody has written yet.
    if parts.query or parts.fragment or parts.username or parts.password:
        return None
    try:
        address = ip_address(host)
    except ValueError:
        return None
    if address.version != 4:
        return None
    authority = f"[::ffff:{address}]"
    if parts.port is not None:
        authority = f"{authority}:{parts.port}"
    return urlunsplit((parts.scheme, authority, parts.path, "", ""))


MAPPED_ACCEPTED = [
    (mapped, stored) for written, stored in ACCEPTED if (mapped := mapped_spelling(written))
]
MAPPED_REFUSED = [
    (mapped, reason) for written, reason in REFUSED if (mapped := mapped_spelling(written))
]


def test_every_address_in_the_tables_is_swept_in_both_spellings() -> None:
    """Non-vacuity, in both directions.

    A sweep that generated nothing would pass every assertion below it while proving nothing,
    and both directions have to be populated: one of them is the bypass.
    """
    assert len(MAPPED_ACCEPTED) >= 3
    assert len(MAPPED_REFUSED) >= 1


@pytest.mark.parametrize(("written", "stored"), MAPPED_ACCEPTED)
def test_the_mapped_spelling_of_an_accepted_address_stores_as_the_plain_one(
    written: str, stored: str
) -> None:
    """One address, one stored value, whichever way the operator typed it.

    RFC 4291 makes `::ffff:10.0.0.5` a representation of `10.0.0.5`, so storing them apart
    would leave unit B's pin refusal firing on a retyped spelling of the endpoint a run
    already reached.
    """
    assert normalize_base_url(written) == stored


@pytest.mark.parametrize(("written", "reason"), MAPPED_REFUSED)
def test_the_mapped_spelling_of_a_refused_address_is_refused_too(written: str, reason: str) -> None:
    """The bypass this sweep exists for: rewriting the address must not defeat the rule."""
    with pytest.raises(ModelConnectionConfigurationError) as refusal:
        normalize_base_url(written)

    assert reason in str(refusal.value)


@pytest.mark.parametrize(("written", "reason"), REFUSED)
def test_an_endpoint_the_lab_refuses_says_which_rule_stopped_it(written: str, reason: str) -> None:
    with pytest.raises(ModelConnectionConfigurationError) as refusal:
        normalize_base_url(written)

    assert reason in str(refusal.value)
    assert refusal.value.field == "base_url"


def test_two_spellings_of_one_endpoint_compare_equal() -> None:
    """The assertion the pin depends on.

    A run pins the endpoint it reached and refuses an advance against a different one
    (ADR 0052). If `HTTPS://Api.Example.com:443/v1/` and `https://api.example.com/v1` were two
    values, that refusal would fire on a lab nobody had repointed — so the case of the scheme
    and host, the scheme's default port, and a trailing slash are all folded away.
    """
    spellings = (
        "HTTPS://Api.Example.com:443/v1/",
        "https://api.example.com/v1",
        "  https://API.example.com:443/v1//  ",
        "https://api.example.com./v1",
    )

    assert {normalize_base_url(spelling) for spelling in spellings} == {
        "https://api.example.com/v1"
    }


def test_a_refused_endpoint_is_never_quoted_back() -> None:
    """A URL carrying userinfo carries a password, so the refusal names the rule, not the value.

    Echoing it would put a credential into an error payload, a log line and a browser's
    history — which is the whole reason userinfo is refused in the first place.
    """
    with pytest.raises(ModelConnectionConfigurationError) as refusal:
        normalize_base_url("https://maya:hunter2@api.example.com/v1?token=hunter2")

    assert "hunter2" not in str(refusal.value)
    assert "maya" not in str(refusal.value)


# --- which providers can hold a connection ------------------------------------------------


def test_the_connectable_providers_are_read_off_the_proven_tables() -> None:
    """A registry-driven sweep rather than a list somebody maintains (ADR 0023).

    A provider declared publishable joins this set on the day it is declared, so a lab that
    learns to reach a second one does not also need somebody to remember this module.
    """
    declared = {provider for framework in PROVEN_FRAMEWORKS for provider in framework.providers}
    declared |= {judge.provider for judge in PROVEN_JUDGES}

    assert declared == KNOWN_PROVIDERS
    assert CONNECTABLE_PROVIDERS
    assert set(CONNECTABLE_PROVIDERS) <= KNOWN_PROVIDERS
    # The declared control reaches nothing at all, so it holds no connection.
    assert "fake" not in CONNECTABLE_PROVIDERS
    assert "openai" in CONNECTABLE_PROVIDERS


def test_a_provider_that_reaches_nothing_holds_no_connection() -> None:
    connections = InMemoryConnections()

    with pytest.raises(ModelConnectionNotConnectableError) as refusal:
        service(connections).save("fake", base_url="https://api.example.com/v1", api_key=None)

    assert refusal.value.field == "provider_id"
    assert connections.rows == {}


def test_a_provider_the_lab_has_never_proven_holds_no_connection() -> None:
    with pytest.raises(ModelConnectionNotConnectableError):
        service(InMemoryConnections()).get("anthropic")


# --- the key at rest ----------------------------------------------------------------------


def test_a_key_round_trips_through_the_cipher_and_never_looks_the_same_twice() -> None:
    cipher = AesGcmCredentialCipher("an-operator-supplied-passphrase")

    first = cipher.encrypt(API_KEY)
    second = cipher.encrypt(API_KEY)

    assert cipher.decrypt(first) == API_KEY
    assert cipher.decrypt(second) == API_KEY
    # A fresh nonce per encryption, so two stored values cannot be compared to learn that two
    # labs hold the same credential.
    assert first != second
    for stored in (first, second):
        assert API_KEY not in stored
        assert API_KEY[:8] not in stored


def test_a_key_stored_under_another_encryption_key_cannot_be_read_back() -> None:
    stored = AesGcmCredentialCipher("the-passphrase-it-was-saved-under").encrypt(API_KEY)

    with pytest.raises(CredentialDecryptionError) as refusal:
        AesGcmCredentialCipher("a-different-passphrase").decrypt(stored)

    assert CREDENTIAL_KEY_VARIABLE in str(refusal.value)
    assert API_KEY not in str(refusal.value)


def test_a_lab_with_no_encryption_key_refuses_to_store_one_and_names_the_variable() -> None:
    """There is deliberately no default: a shipped one would be encryption theatre."""
    cipher = create_credential_cipher(_settings(credential_key=None))

    with pytest.raises(CredentialEncryptionUnavailableError) as refusal:
        cipher.encrypt(API_KEY)

    assert CREDENTIAL_KEY_VARIABLE in str(refusal.value)
    assert API_KEY not in str(refusal.value)


def _settings(**overrides: Any) -> Any:
    from pydantic import SecretStr

    from capability_lab.infrastructure.config import Settings

    base: dict[str, Any] = {
        "environment": "test",
        "database_url": "sqlite://",
        "telemetry_hash_salt": SecretStr("test-only-telemetry-salt"),
    }
    base.update(overrides)
    return Settings(**base)


def test_composition_picks_the_real_cipher_only_when_the_variable_is_set() -> None:
    """And an empty or blank value counts as unset, which is the whole point of this test.

    `AGENT_LAB_CREDENTIAL_KEY=` reaches settings as `SecretStr('')`, not as `None`. A check
    against `None` alone would build a live cipher keyed on `HKDF(b"")` — publicly derivable
    and identical everywhere — for an operator who uncommented the line and never filled it in.
    """
    from pydantic import SecretStr

    for unset in (None, SecretStr(""), SecretStr("   ")):
        assert isinstance(
            create_credential_cipher(_settings(credential_key=unset)),
            UnconfiguredCredentialCipher,
        )
    assert isinstance(
        create_credential_cipher(_settings(credential_key=SecretStr("set"))),
        AesGcmCredentialCipher,
    )


# --- saving and reading a connection ------------------------------------------------------


def test_saving_a_connection_stores_the_endpoint_and_the_encrypted_key() -> None:
    connections = InMemoryConnections()
    saved = service(connections).save(
        "openai", base_url="HTTPS://Api.OpenAI.com/v1/", api_key=API_KEY
    )

    assert saved.connection is not None
    assert saved.connection.base_url == "https://api.openai.com/v1"
    assert saved.connection.key_configured is True
    assert saved.connection.key_added_at is not None
    stored = connections.rows["openai"]
    assert stored.encrypted_key is not None
    assert API_KEY not in stored.encrypted_key


def test_saving_without_a_key_keeps_the_one_already_stored() -> None:
    """The path an operator takes to change a base URL they cannot re-read the key for."""
    connections = InMemoryConnections()
    clock = FixedClock(datetime(2026, 9, 21, 9, 0, tzinfo=UTC))
    connected = service(connections, clock=clock)
    connected.save("openai", base_url="https://api.openai.com/v1", api_key=API_KEY)
    first = connections.rows["openai"]

    clock.set(datetime(2026, 9, 22, 9, 0, tzinfo=UTC))
    moved = connected.save("openai", base_url="http://localhost:11434/v1", api_key=None)

    assert moved.connection is not None
    assert moved.connection.base_url == "http://localhost:11434/v1"
    assert moved.connection.key_configured is True
    # The same stored bytes and the same date: nothing about the key moved.
    assert connections.rows["openai"].encrypted_key == first.encrypted_key
    assert moved.connection.key_added_at == first.key_added_at
    assert connections.rows["openai"].created_at == first.created_at
    assert connections.rows["openai"].updated_at == datetime(2026, 9, 22, 9, 0, tzinfo=UTC)


def test_a_lab_with_no_encryption_key_stores_nothing_at_all() -> None:
    """The save is refused whole rather than landing a base URL without its key."""
    connections = InMemoryConnections()

    with pytest.raises(CredentialEncryptionUnavailableError):
        service(connections, secret=None).save(
            "openai", base_url="https://api.openai.com/v1", api_key=API_KEY
        )

    assert connections.rows == {}


def test_a_connection_with_no_key_is_an_ordinary_connection_to_hold() -> None:
    """A local Ollama needs no credential, and saying so is not the same as having one."""
    connections = InMemoryConnections()
    saved = service(connections).save("openai", base_url="http://localhost:11434/v1", api_key=None)

    assert saved.connection is not None
    assert saved.connection.key_configured is False
    assert saved.connection.key_added_at is None


def test_listing_answers_for_every_connectable_provider_including_the_unconfigured() -> None:
    listed = service(InMemoryConnections()).list_providers()

    assert [provider.provider_id for provider in listed] == list(CONNECTABLE_PROVIDERS)
    assert all(provider.connection is None for provider in listed)


# --- testing a connection -----------------------------------------------------------------


async def test_testing_a_connection_falls_back_to_the_saved_key() -> None:
    connections = InMemoryConnections()
    probe = RecordingProbe()
    connected = service(connections, probe=probe)
    connected.save("openai", base_url="https://api.openai.com/v1", api_key=API_KEY)

    await connected.test("openai", base_url="https://api.openai.com/v1", api_key=None)

    assert probe.calls == [("https://api.openai.com/v1", API_KEY)]


async def test_a_typed_key_is_tested_instead_of_the_saved_one() -> None:
    """So an operator can check a key before saving it over the one that works."""
    connections = InMemoryConnections()
    probe = RecordingProbe()
    connected = service(connections, probe=probe)
    connected.save("openai", base_url="https://api.openai.com/v1", api_key=API_KEY)

    await connected.test("openai", base_url="HTTP://LocalHost:11434/v1/", api_key="typed-key")

    assert probe.calls == [("http://localhost:11434/v1", "typed-key")]


async def test_testing_a_connection_stores_nothing() -> None:
    connections = InMemoryConnections()
    connected = service(connections, probe=RecordingProbe())

    result = await connected.test(
        "openai", base_url="https://api.openai.com/v1", api_key="typed-key"
    )

    assert result.outcome is ModelEndpointOutcome.REACHABLE
    # A reachability result is true of a moment; a stored green tick would be read as a
    # promise the lab cannot keep.
    assert connections.rows == {}


async def test_an_endpoint_the_lab_would_not_store_is_not_one_it_will_call() -> None:
    probe = RecordingProbe()

    with pytest.raises(ModelConnectionConfigurationError):
        await service(InMemoryConnections(), probe=probe).test(
            "openai", base_url="https://user:hunter2@api.example.com/v1", api_key=None
        )

    assert probe.calls == []


# --- the probe against a real endpoint ----------------------------------------------------


class _StubProviderHandler(BaseHTTPRequestHandler):
    """An OpenAI-protocol endpoint that answers by path, so each outcome can be provoked."""

    def do_GET(self) -> None:  # the name the base class dispatches to
        if self.path == "/ok/models":
            body = json.dumps({"object": "list", "data": []}).encode()
            status = 200
        elif self.path == "/refuse/models":
            body = UPSTREAM_BODY.encode()
            status = 401
        elif self.path == "/broken/models":
            body = UPSTREAM_BODY.encode()
            status = 503
        else:
            body = UPSTREAM_BODY.encode()
            status = 404
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        del format, args


@pytest.fixture
def stub_provider() -> Any:
    """One throwaway endpoint on an ephemeral loopback port, torn down with the test.

    Port 0 rather than a fixed one: the suite runs under `pytest-xdist -n auto`, and a test
    that claimed a port would fail whenever another worker had claimed it first.
    """
    server = ThreadingHTTPServer(("127.0.0.1", 0), _StubProviderHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


async def test_an_endpoint_that_answers_is_reachable(stub_provider: str) -> None:
    result = await OpenAiProtocolEndpointProbe().probe(
        base_url=f"{stub_provider}/ok", api_key="any-key"
    )

    assert result.outcome is ModelEndpointOutcome.REACHABLE
    assert result.status_class is HttpStatusClass.SUCCESS
    assert result.latency_ms >= 0


async def test_an_endpoint_that_needs_no_credential_is_probed_with_the_placeholder(
    stub_provider: str,
) -> None:
    """Testing a keyless local endpoint is the scenario ADR 0052 exists for, and it is one
    line away from a 500.

    `AsyncOpenAI` refuses to construct with no credential *and* refuses an empty string,
    raising before any request is made — so a probe that passed `""` for an absent key would
    answer this route with an unhandled error rather than a reachability result. Every other
    probe test hands a key, so this is the only one that holds `UNCREDENTIALED_API_KEY` in
    place.
    """
    result = await OpenAiProtocolEndpointProbe().probe(base_url=f"{stub_provider}/ok", api_key=None)

    assert result.outcome is ModelEndpointOutcome.REACHABLE
    assert result.status_class is HttpStatusClass.SUCCESS


def test_the_placeholder_is_what_every_client_this_lab_builds_will_accept() -> None:
    """The other half of the same constant: what an *arm* and a *judge* are built with.

    The registry's Pydantic AI path constructs its client eagerly, so the composition sweep
    already holds it. Both other paths sit behind a lambda nothing in the suite calls, which
    left the constant free to be tidied back to `""` for them. Asserted as a pair — the empty
    string refused, the placeholder accepted — so it is the placeholder that is pinned rather
    than merely the absence of a crash.
    """
    for build in (create_openai_model, create_openai_agents_model):
        with pytest.raises(OpenAIError):
            build("gpt-5-mini", "", OLLAMA_ENDPOINT)
        assert build("gpt-5-mini", UNCREDENTIALED_API_KEY, OLLAMA_ENDPOINT) is not None


async def test_an_endpoint_that_rejects_the_credential_is_refused(stub_provider: str) -> None:
    result = await OpenAiProtocolEndpointProbe().probe(
        base_url=f"{stub_provider}/refuse", api_key="a-rejected-key"
    )

    assert result.outcome is ModelEndpointOutcome.REFUSED
    assert result.status_class is HttpStatusClass.CLIENT_ERROR


async def test_an_endpoint_that_answers_with_something_else_is_unreachable(
    stub_provider: str,
) -> None:
    """A 404 or a 503 is an answer from something that is not an endpoint this lab can use.

    Reported as unreachable *with its status class*, so an operator can tell a host that said
    404 from a host that said nothing at all.
    """
    missing = await OpenAiProtocolEndpointProbe().probe(
        base_url=f"{stub_provider}/missing", api_key="any-key"
    )
    broken = await OpenAiProtocolEndpointProbe().probe(
        base_url=f"{stub_provider}/broken", api_key="any-key"
    )

    assert missing.outcome is ModelEndpointOutcome.UNREACHABLE
    assert missing.status_class is HttpStatusClass.CLIENT_ERROR
    assert broken.outcome is ModelEndpointOutcome.UNREACHABLE
    assert broken.status_class is HttpStatusClass.SERVER_ERROR


async def test_nothing_listening_is_unreachable_with_no_status_at_all() -> None:
    result = await OpenAiProtocolEndpointProbe().probe(
        base_url="http://127.0.0.1:1/v1", api_key="any-key"
    )

    assert result.outcome is ModelEndpointOutcome.UNREACHABLE
    assert result.status_class is None


async def test_a_probe_never_carries_the_upstream_body_back(
    stub_provider: str, caplog: pytest.LogCaptureFixture
) -> None:
    """A provider's error text is a string this lab did not write and cannot promise.

    The stub answers with a message quoting a fragment of the credential, which is what real
    providers do; none of it may survive into the classified result.

    This is the leg of the telemetry sweep that the HTTP-level one cannot reach. That sweep
    runs against a stub probe, so the component that actually puts a key on a socket — this
    one, with a real SDK client and a real exception carrying the upstream body — is swept
    here instead, over the same three things: what is returned, what is logged, and the
    traceback a record carries rather than only the message it formatted.
    """
    with caplog.at_level(logging.DEBUG):
        results = [
            await OpenAiProtocolEndpointProbe().probe(
                base_url=f"{stub_provider}/{path}", api_key=API_KEY
            )
            for path in ("refuse", "broken", "missing")
        ]

    formatter = logging.Formatter("%(name)s %(levelname)s %(message)s")
    swept = "\n".join([repr(results), *(formatter.format(record) for record in caplog.records)])
    assert UPSTREAM_BODY not in swept
    assert "invalid_api_key" not in swept
    assert API_KEY not in swept
    assert API_KEY[:8] not in swept
    # Non-vacuity: the probe really did reach the stub and classify three answers, so a sweep
    # over an empty run cannot be what passed.
    assert [result.outcome for result in results] == [
        ModelEndpointOutcome.REFUSED,
        ModelEndpointOutcome.UNREACHABLE,
        ModelEndpointOutcome.UNREACHABLE,
    ]


_SPELLINGS = json.loads(
    (Path(__file__).parent / "fixtures" / "base_url_spellings.json").read_text(encoding="utf-8")
)
"""The table `apps/web/src/lib/modelConnections.test.ts` holds the settings page's preset fold to.

The page lights a preset chip from its own fold of the typed endpoint, and that fold must agree
with this module about which spellings are one endpoint, or a chip is lit for a URL the lab
stores as something else. The web suite asserts the chip against `preset` and the fold against
`stored`; this asserts `stored` and `preset` against `normalize_base_url` itself, so neither
column can drift."""


def test_the_shared_spelling_table_is_there_to_be_held_to() -> None:
    # A sweep over a set that silently became empty reports as passing (ADR 0023).
    assert len(_SPELLINGS["spellings"]) > 40
    assert {normalize_base_url(url) for url in _SPELLINGS["presets"].values()} == set(
        _SPELLINGS["presets"].values()
    )


@pytest.mark.parametrize(
    "row",
    _SPELLINGS["spellings"],
    ids=lambda row: f"{row['case']}: {row['input'][:40]!r}",
)
def test_every_spelling_the_page_folds_is_what_the_lab_stores(row: dict[str, Any]) -> None:
    presets = {url: preset for preset, url in _SPELLINGS["presets"].items()}
    if row["stored"] is None:
        with pytest.raises(ModelConnectionConfigurationError):
            normalize_base_url(row["input"])
        assert row["preset"] == "custom"
        return
    assert normalize_base_url(row["input"]) == row["stored"]
    assert presets.get(row["stored"], "custom") == row["preset"]


_CUT_EXPOSES_WHITESPACE = [
    "http://localhost:11434/v1 /",
    "https://api.openai.com/v1\xa0/",
    "https://api.openai.com /",
    "https://api.openai.com. /",
    "https://api.openai.com/v1/ / /",
]
"""Spellings whose trailing-slash cut leaves whitespace, or a dot, at the end of the value.

One pass of strip-then-cut stored `…/v1 ` for `…/v1 /`, which a second pass reads as `…/v1`:
the stored value was not its own spelling, so the page folding it lit a preset, called the form
clean, and sent a value the lab would store differently."""


@pytest.mark.parametrize(
    "spelling",
    # Once each: every row of the list but one is also a row of the fixture.
    list(
        dict.fromkeys(
            [row["input"] for row in _SPELLINGS["spellings"] if row["stored"] is not None]
            + _CUT_EXPOSES_WHITESPACE
        )
    ),
    ids=repr,
)
def test_the_stored_spelling_is_its_own_spelling(spelling: str) -> None:
    stored = normalize_base_url(spelling)
    assert normalize_base_url(stored) == stored
