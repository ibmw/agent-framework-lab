"""What the lab may say about its own composition, and what it must never say.

What each field *means* is asserted against `read_lab_status`, which is where the reading is
decided. What the lab may *serve* is asserted against the payload: a field that leaked a fact
about the credential would leak it over HTTP, and that is the boundary a reader is on the
other side of.
"""

from typing import Any

from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr

from capability_lab.infrastructure.config import Settings
from capability_lab.presentation.api import create_app
from capability_lab.presentation.lab_status import LabRunMode, read_lab_status

API_KEY = "sk-lab-9d41c0e7b6a24f8fae3c15d2708b6c93"
OTLP_ENDPOINT = "http://collector.invalid:4318/v1/traces"


def settings(**overrides: Any) -> Settings:
    # `environment="test"` keeps composition on each SDK's own offline seam, so the
    # credentialed case below can be exercised without a provider anywhere near it.
    return Settings(
        environment="test",
        database_url="sqlite://",
        telemetry_hash_salt=SecretStr("test-only-telemetry-salt"),
        **overrides,
    )


async def read_status(configured: Settings) -> tuple[dict[str, Any], str]:
    transport = ASGITransport(app=create_app(configured))
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/lab-status")

    assert response.status_code == 200
    return response.json(), response.text


async def test_offline_status_names_the_run_mode_and_the_model() -> None:
    payload, _ = await read_status(settings(openai_api_key=None))

    assert payload == {
        "run_mode": "offline",
        "model_id": "gpt-5-mini",
        "trace_export_configured": False,
    }


async def test_credentialed_status_says_only_that_a_credential_is_configured() -> None:
    payload, body = await read_status(settings(openai_api_key=SecretStr(API_KEY)))

    assert payload["run_mode"] == "credentialed"
    # The narrow claim: no whole key, and no prefix, suffix, length or hash of one either.
    # Every fragment of a secret is a fact about it, so the payload is asserted to be exactly
    # the three composition facts and nothing that could be derived from the credential.
    assert sorted(payload) == ["model_id", "run_mode", "trace_export_configured"]
    assert API_KEY not in body
    for length in (4, 6, 8, 12):
        assert API_KEY[:length] not in body
        assert API_KEY[-length:] not in body
    assert str(len(API_KEY)) not in body


async def test_trace_export_is_a_boolean_and_never_the_endpoint() -> None:
    unconfigured, _ = await read_status(settings(otel_exporter_otlp_endpoint=None))
    configured, body = await read_status(settings(otel_exporter_otlp_endpoint=OTLP_ENDPOINT))

    assert unconfigured["trace_export_configured"] is False
    assert configured["trace_export_configured"] is True
    assert OTLP_ENDPOINT not in body
    assert "collector.invalid" not in body


def test_run_mode_follows_the_credential_and_nothing_else() -> None:
    assert read_lab_status(settings(openai_api_key=None)).run_mode is LabRunMode.OFFLINE
    assert (
        read_lab_status(settings(openai_api_key=SecretStr(API_KEY))).run_mode
        is LabRunMode.CREDENTIALED
    )


def test_trace_export_is_read_the_way_the_exporter_is_installed() -> None:
    """A blank endpoint installs no exporter, so the lab must not report one.

    `AGENT_LAB_OTEL_EXPORTER_OTLP_ENDPOINT=` — a blanked `.env` line, or a compose file
    passing an unset variable through — reaches settings as an empty string rather than as
    `None`. `create_telemetry` reads it truthily and adds no span processor; a read-out that
    tested against `None` would tell an operator their spans are leaving a process that is
    exporting nothing.
    """
    for unconfigured in ("", None):
        status = read_lab_status(settings(otel_exporter_otlp_endpoint=unconfigured))
        assert status.trace_export_configured is False

    configured = read_lab_status(settings(otel_exporter_otlp_endpoint=OTLP_ENDPOINT))
    assert configured.trace_export_configured is True
