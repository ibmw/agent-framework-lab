"""What the lab may say about what it can reach, and what it must never say.

What each field *means* is asserted against `read_lab_status`, which is where the reading is
decided. What the lab may *serve* is asserted against the payload: a field that leaked a fact
about a credential would leak it over HTTP, and that is the boundary a reader is on the other
side of.

The assertion this file exists for after ADR 0052 is the one at the bottom: run mode changes
between two requests to **one process**, because composition moved from start-up to the
request. It is the test that fails if it ever moves back.
"""

from pathlib import Path
from typing import Any

from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr

from capability_lab.application.model_connections import (
    OPENAI_PROVIDER,
    ModelConnectionSource,
    ResolvedConnection,
)
from capability_lab.infrastructure.config import Settings
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
)
from capability_lab.presentation.api import create_app
from capability_lab.presentation.lab_status import LabRunMode, read_lab_status

API_KEY = "sk-lab-9d41c0e7b6a24f8fae3c15d2708b6c93"
ENCRYPTION_KEY = "ck+Ux1Hw5yKQJ7oPz0m2N8aVbEfRtGuIcDlSwXyZnAk="
OTHER_ENCRYPTION_KEY = "Rk9DYxT2mQpL7wVuA0sZ3eN8hJ5rG1bK4dY6cX9fPiM="
OTLP_ENDPOINT = "http://collector.invalid:4318/v1/traces"
OLLAMA = "http://localhost:11434/v1"
OPENAI_ENDPOINT = "https://api.openai.com/v1"

RESOLUTIONS: dict[str, ResolvedConnection] = {
    "saved": ResolvedConnection(OPENAI_PROVIDER, ModelConnectionSource.SAVED, OLLAMA),
    "environment": ResolvedConnection(
        OPENAI_PROVIDER, ModelConnectionSource.ENVIRONMENT, OPENAI_ENDPOINT, API_KEY
    ),
    "saved_unreadable": ResolvedConnection(OPENAI_PROVIDER, ModelConnectionSource.SAVED_UNREADABLE),
    "none": ResolvedConnection(OPENAI_PROVIDER, ModelConnectionSource.NONE),
}
"""One resolution per member of the chain's answer, so the reading below is a table."""


def settings(tmp_path: Path, *, name: str = "lab-status.db", **overrides: Any) -> Settings:
    """Settings for one lab, stated whole so a developer's own `.env` cannot reach it.

    `environment="test"` keeps composition on each SDK's own offline seam, so a credentialed
    lab can be exercised without a provider anywhere near it — and `openai_api_key` is
    declared rather than left out, because pydantic reads `.env` and a machine that has one
    would otherwise read *credentialed* from a test that is about an unpointed lab.

    The database is a file rather than `sqlite://`. Reading the run mode now reads a table,
    and a sync dependency runs in a worker thread, where an in-memory SQLite is a second
    empty database.
    """
    declared: dict[str, Any] = {
        "environment": "test",
        "database_url": f"sqlite:///{tmp_path / name}",
        "telemetry_hash_salt": SecretStr("test-only-telemetry-salt"),
        "openai_api_key": None,
        "otel_exporter_otlp_endpoint": None,
    }
    declared.update(overrides)
    return Settings(**declared)


async def read_status(configured: Settings) -> tuple[dict[str, Any], str]:
    """The payload as a client receives it, over a lab holding no saved connection.

    The resolution is not injectable through `create_app` and deliberately is not: what the
    route answers has to come from the chain a running lab consults, so the environment half
    is driven through settings and the saved half through the route that saves one. Which is
    also why this needs a schema now — reading the run mode reads the connections table.
    """
    engine = create_database_engine(configured.database_url)
    Base.metadata.create_all(engine)
    application = create_app(configured, session_factory=create_session_factory(engine))
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/lab-status")

    assert response.status_code == 200
    return response.json(), response.text


# -- the payload ------------------------------------------------------------------


async def test_an_unpointed_lab_names_the_run_mode_the_source_and_the_model(
    tmp_path: Path,
) -> None:
    payload, _ = await read_status(settings(tmp_path))

    assert payload == {
        "run_mode": "offline",
        "connection_source": "none",
        "model_id": "gpt-5-mini",
        "trace_export_configured": False,
    }


async def test_a_bootstrapped_lab_says_only_that_the_environment_is_in_force(
    tmp_path: Path,
) -> None:
    payload, body = await read_status(settings(tmp_path, openai_api_key=SecretStr(API_KEY)))

    assert payload["run_mode"] == "credentialed"
    assert payload["connection_source"] == "environment"
    # The narrow claim: no whole key, and no prefix, suffix, length or hash of one either.
    # Every fragment of a secret is a fact about it, so the payload is asserted to be exactly
    # the four composition facts and nothing that could be derived from the credential.
    assert sorted(payload) == [
        "connection_source",
        "model_id",
        "run_mode",
        "trace_export_configured",
    ]
    assert API_KEY not in body
    for length in (4, 6, 8, 12):
        assert API_KEY[:length] not in body
        assert API_KEY[-length:] not in body
    assert str(len(API_KEY)) not in body


async def test_trace_export_is_a_boolean_and_never_the_endpoint(tmp_path: Path) -> None:
    unconfigured, _ = await read_status(settings(tmp_path, name="off.db"))
    configured, body = await read_status(
        settings(tmp_path, name="on.db", otel_exporter_otlp_endpoint=OTLP_ENDPOINT)
    )

    assert unconfigured["trace_export_configured"] is False
    assert configured["trace_export_configured"] is True
    assert OTLP_ENDPOINT not in body
    assert "collector.invalid" not in body


# -- the reading ------------------------------------------------------------------


def test_run_mode_follows_whether_the_lab_reaches_an_endpoint_and_nothing_else(
    tmp_path: Path,
) -> None:
    """A table over every answer the chain can give, rather than one case per rule.

    The two offline members are the reason it is written this way. *Nothing configured* and
    *a saved key that will not decrypt* are different facts about the lab and the same fact
    about what it can run, and a reading that collapsed them would have to be rewritten the
    day one of them changed.
    """
    reading = {
        name: read_lab_status(settings(tmp_path), connection)
        for name, connection in RESOLUTIONS.items()
    }

    assert reading["saved"].run_mode is LabRunMode.CREDENTIALED
    assert reading["environment"].run_mode is LabRunMode.CREDENTIALED
    assert reading["saved_unreadable"].run_mode is LabRunMode.OFFLINE
    assert reading["none"].run_mode is LabRunMode.OFFLINE
    assert {name: status.connection_source for name, status in reading.items()} == {
        name: connection.source for name, connection in RESOLUTIONS.items()
    }
    assert set(RESOLUTIONS) == {source.value for source in ModelConnectionSource}


def test_a_saved_connection_with_an_unreadable_key_reads_as_offline_not_credentialed(
    tmp_path: Path,
) -> None:
    """`key_configured` reports presence; run mode has to report readability.

    The connection resource may say a key is installed and nothing more — ADR 0052 accepts
    that it cannot distinguish two keys. Run mode is the other question, and a credentialed
    answer over a key that will not decrypt would tell an operator the lab is ready while
    every advance refuses. The source is what keeps the two offline labs distinguishable.
    """
    status = read_lab_status(settings(tmp_path), RESOLUTIONS["saved_unreadable"])

    assert status.run_mode is LabRunMode.OFFLINE
    assert status.connection_source is ModelConnectionSource.SAVED_UNREADABLE


def test_trace_export_is_read_the_way_the_exporter_is_installed(tmp_path: Path) -> None:
    """A blank endpoint installs no exporter, so the lab must not report one.

    `AGENT_LAB_OTEL_EXPORTER_OTLP_ENDPOINT=` — a blanked `.env` line, or a compose file
    passing an unset variable through — reaches settings as an empty string rather than as
    `None`. `create_telemetry` reads it truthily and adds no span processor; a read-out that
    tested against `None` would tell an operator their spans are leaving a process that is
    exporting nothing.
    """
    for unconfigured in ("", None):
        status = read_lab_status(
            settings(tmp_path, otel_exporter_otlp_endpoint=unconfigured), RESOLUTIONS["none"]
        )
        assert status.trace_export_configured is False

    configured = read_lab_status(
        settings(tmp_path, otel_exporter_otlp_endpoint=OTLP_ENDPOINT), RESOLUTIONS["none"]
    )
    assert configured.trace_export_configured is True


def test_a_blank_environment_key_is_an_absent_one_rather_than_an_empty_credential(
    tmp_path: Path,
) -> None:
    """`AGENT_LAB_OPENAI_API_KEY=` must not report a credentialed lab.

    The environment delivers a blanked line as an empty string rather than as an absence, and
    against `None` alone that answers *yes, this lab has a key*. It would compose a
    model-backed runtime over a credential of no characters and tell the operator the lab is
    ready, which is the same shape of theatre a default encryption key would be.
    """
    for blank in ("", "   "):
        assert settings(tmp_path, openai_api_key=SecretStr(blank)).openai_api_key is None


# -- the assertion that composition moved to the request --------------------------


async def test_run_mode_changes_between_two_requests_to_one_process(tmp_path: Path) -> None:
    """One app, one process, one lifetime — and two different answers, without a restart.

    This is the whole of "composition moves from start-up to the request", stated as the
    thing an operator experiences. It fails if any of the three factories, or this route, is
    ever composed once at start-up again: an app built that way answers `offline` both times
    however many connections are saved in between.

    The connection saved here carries no key on purpose. It needs none — a local endpoint is
    the case this feature exists for — so the state the second request reads is reached with
    nothing about `AGENT_LAB_CREDENTIAL_KEY` involved.
    """
    configured = settings(tmp_path, credential_key=SecretStr(ENCRYPTION_KEY))
    engine = create_database_engine(configured.database_url)
    Base.metadata.create_all(engine)
    application = create_app(configured, session_factory=create_session_factory(engine))

    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        before = await client.get("/api/v1/lab-status")
        saved = await client.put(
            f"/api/v1/model-connections/{OPENAI_PROVIDER}", json={"base_url": OLLAMA}
        )
        after = await client.get("/api/v1/lab-status")
        frameworks = await client.get("/api/v1/agent-frameworks")

    assert saved.status_code == 200, saved.text
    assert before.json()["run_mode"] == "offline"
    assert before.json()["connection_source"] == "none"
    assert after.json()["run_mode"] == "credentialed"
    assert after.json()["connection_source"] == "saved"
    # The POC's own registry moved with it, in the same process and the same lifetime: a lab
    # pointed at Ollama whose conversation routes still answered "not configured" would be
    # the split ADR 0052 refuses, and it would be invisible from the settings page.
    assert frameworks.status_code == 200, frameworks.text
    assert saved.json()["connection"]["key_configured"] is False


async def test_a_lab_whose_encryption_key_changed_reads_offline_and_says_why(
    tmp_path: Path,
) -> None:
    """The whole path, from a key saved under one encryption key to a page read under another.

    A lab in this state holds `key_configured: true` — the connection resource may say
    nothing else about the key — and reaches nothing at all. Reporting *credentialed* here
    would tell the operator the lab is ready while every advance refuses, so it reports
    offline and names the source that says which offline this is.
    """
    configured = settings(tmp_path, credential_key=SecretStr(ENCRYPTION_KEY))
    engine = create_database_engine(configured.database_url)
    Base.metadata.create_all(engine)
    session_factory = create_session_factory(engine)

    transport = ASGITransport(app=create_app(configured, session_factory=session_factory))
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        saved = await client.put(
            f"/api/v1/model-connections/{OPENAI_PROVIDER}",
            json={"base_url": OLLAMA, "api_key": API_KEY},
        )
        working = await client.get("/api/v1/lab-status")

    rotated = settings(tmp_path, credential_key=SecretStr(OTHER_ENCRYPTION_KEY))
    transport = ASGITransport(app=create_app(rotated, session_factory=session_factory))
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        broken = await client.get("/api/v1/lab-status")
        connection = await client.get(f"/api/v1/model-connections/{OPENAI_PROVIDER}")

    assert saved.status_code == 200, saved.text
    assert working.json() == {
        "run_mode": "credentialed",
        "connection_source": "saved",
        "model_id": "gpt-5-mini",
        "trace_export_configured": False,
    }
    assert broken.json()["run_mode"] == "offline"
    assert broken.json()["connection_source"] == "saved_unreadable"
    # The connection resource still reports a key as installed, which is the fact it is
    # allowed to report and the reason run mode could not be computed from it.
    assert connection.json()["connection"]["key_configured"] is True


async def test_a_saved_connection_outranks_the_environment_in_one_running_process(
    tmp_path: Path,
) -> None:
    """Both configured is the state neither one explains, so the page has to name the winner."""
    configured = settings(
        tmp_path,
        openai_api_key=SecretStr(API_KEY),
        credential_key=SecretStr(ENCRYPTION_KEY),
    )
    engine = create_database_engine(configured.database_url)
    Base.metadata.create_all(engine)
    application = create_app(configured, session_factory=create_session_factory(engine))

    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        before = await client.get("/api/v1/lab-status")
        await client.put(
            f"/api/v1/model-connections/{OPENAI_PROVIDER}",
            json={"base_url": OLLAMA, "api_key": API_KEY},
        )
        after = await client.get("/api/v1/lab-status")

    assert before.json()["connection_source"] == "environment"
    assert after.json()["connection_source"] == "saved"
    assert after.json()["run_mode"] == "credentialed"
    assert API_KEY not in after.text
