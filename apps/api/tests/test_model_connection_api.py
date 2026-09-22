"""What the model-connection routes may serve, and what they must never serve.

`test_model_connections.py` asserts what each rule means. This suite asserts the boundary a
reader is on the other side of: the payload, the stored column, the refusals, and a sweep over
everything this lab emits while a key is being saved and used.
"""

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import pytest
import yaml
from httpx import ASGITransport, AsyncClient
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from pydantic import SecretStr
from sqlalchemy import Engine, text

from capability_lab.application.model_connections import (
    HttpStatusClass,
    ModelEndpointOutcome,
    ModelEndpointProbeResult,
)
from capability_lab.infrastructure.config import Settings
from capability_lab.infrastructure.credentials import CREDENTIAL_KEY_VARIABLE
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
)
from capability_lab.infrastructure.telemetry import Telemetry
from capability_lab.presentation.api import create_app

API_KEY = "sk-lab-9d41c0e7b6a24f8fae3c15d2708b6c93"
ENCRYPTION_KEY = "an-operator-supplied-passphrase"
OLLAMA = "http://localhost:11434/v1"
OPENAI = "https://api.openai.com/v1"

CONNECTION_FIELDS = [
    "base_url",
    "created_at",
    "key_added_at",
    "key_configured",
    "provider_id",
    "updated_at",
]
"""Exactly what a saved connection may say about itself.

Asserted as a whole list rather than by naming the fields that must be absent: a mask, a
prefix, a length or a hash added to this model would be a fact about a secret served over an
unauthenticated route, and the only assertion that catches all of them at once is one that
refuses anything new (ADR 0044's rule for `getLabStatus`, ADR 0052's for a key the operator
typed).
"""


_formatter = logging.Formatter("%(name)s %(levelname)s %(message)s")
"""Renders a record whole, traceback included, for the sweeps below."""


class StubProbe:
    """Answers as told, so all three outcomes can be asserted without a network."""

    def __init__(self, result: ModelEndpointProbeResult) -> None:
        self.result = result
        self.calls: list[tuple[str, str | None]] = []

    async def probe(self, *, base_url: str, api_key: str | None) -> ModelEndpointProbeResult:
        self.calls.append((base_url, api_key))
        return self.result


@dataclass
class Lab:
    """One app over one database file, with the engine kept so the row can be read raw."""

    client: AsyncClient
    engine: Engine

    def stored(self) -> list[tuple[Any, ...]]:
        with self.engine.connect() as connection:
            rows = connection.execute(text("SELECT * FROM model_connections"))
            return [tuple(row) for row in rows]

    def stored_text(self) -> str:
        return repr(self.stored())


def lab(
    tmp_path: Path,
    name: str = "connections.db",
    *,
    credential_key: str | None = ENCRYPTION_KEY,
    probe: StubProbe | None = None,
    telemetry: Telemetry | None = None,
) -> Lab:
    engine = create_database_engine(f"sqlite:///{tmp_path / name}")
    Base.metadata.create_all(engine)
    settings = Settings(
        environment="test",
        database_url=f"sqlite:///{tmp_path / name}",
        telemetry_hash_salt=SecretStr("test-only-telemetry-salt"),
        credential_key=None if credential_key is None else SecretStr(credential_key),
    )
    application = create_app(
        settings,
        session_factory=create_session_factory(engine),
        model_endpoint_probe=probe,
        telemetry=telemetry,
    )
    return Lab(
        client=AsyncClient(transport=ASGITransport(app=application), base_url="http://lab.test"),
        engine=engine,
    )


# --- the round trip -----------------------------------------------------------------------


async def test_a_saved_connection_reads_back_with_no_fact_about_the_key(tmp_path: Path) -> None:
    environment = lab(tmp_path)
    async with environment.client as client:
        saved = await client.put(
            "/api/v1/model-connections/openai",
            json={"base_url": OPENAI, "api_key": API_KEY},
        )
        read = await client.get("/api/v1/model-connections/openai")
        listed = await client.get("/api/v1/model-connections")

    assert saved.status_code == 200, saved.text
    assert read.status_code == 200, read.text
    connection = read.json()["connection"]
    assert connection["provider_id"] == "openai"
    assert connection["base_url"] == OPENAI
    assert connection["key_configured"] is True
    assert connection["key_added_at"] is not None
    assert sorted(connection) == CONNECTION_FIELDS
    assert saved.json() == read.json()
    assert listed.json()["providers"] == [read.json()]

    # No whole key, and no prefix or suffix of one either — in any of the three.
    for body in (saved.text, read.text, listed.text):
        assert API_KEY not in body
        for length in (4, 6, 8, 12):
            assert API_KEY[:length] not in body
            assert API_KEY[-length:] not in body

    # The length of a key is a fact about it too. The field list above already pins the
    # payload to six fields, so a length could only hide inside one of their values — and the
    # three that are timestamps are read past rather than swept, because any two-digit number
    # turns up inside one of those by accident at some hour of some day.
    told = {
        key: value
        for key, value in connection.items()
        if key not in {"created_at", "updated_at", "key_added_at"}
    }
    assert str(len(API_KEY)) not in json.dumps(told)


async def test_an_unconfigured_provider_answers_rather_than_going_missing(
    tmp_path: Path,
) -> None:
    """A lab on the environment bootstrap alone is a supported state, not a 404."""
    environment = lab(tmp_path)
    async with environment.client as client:
        read = await client.get("/api/v1/model-connections/openai")
        listed = await client.get("/api/v1/model-connections")

    assert read.status_code == 200
    assert read.json() == {"provider_id": "openai", "connection": None}
    assert listed.json() == {"providers": [{"provider_id": "openai", "connection": None}]}


async def test_saving_twice_leaves_one_connection_saying_one_thing(tmp_path: Path) -> None:
    environment = lab(tmp_path)
    async with environment.client as client:
        first = await client.put(
            "/api/v1/model-connections/openai", json={"base_url": OPENAI, "api_key": API_KEY}
        )
        second = await client.put(
            "/api/v1/model-connections/openai", json={"base_url": OPENAI, "api_key": API_KEY}
        )

    assert first.status_code == 200 and second.status_code == 200
    assert len(environment.stored()) == 1


async def test_a_provider_that_holds_no_connection_is_refused(tmp_path: Path) -> None:
    environment = lab(tmp_path)
    async with environment.client as client:
        offline = await client.put(
            "/api/v1/model-connections/fake", json={"base_url": OPENAI, "api_key": None}
        )
        unknown = await client.get("/api/v1/model-connections/anthropic")

    assert offline.status_code == 422, offline.text
    assert offline.json()["code"] == "model_connection_configuration_error"
    # A path segment, named the way `_validation_error_handler` names one. `body.provider_id`
    # would point a form at a control no request body has.
    assert offline.json()["details"][0]["location"] == "path.provider_id"
    assert unknown.status_code == 422, unknown.text
    assert environment.stored() == []


# --- the base URL table, at the door ------------------------------------------------------

REFUSED_URLS = [
    "https://maya:hunter2@api.example.com/v1",
    "https://api.example.com/v1?api_key=hunter2",
    "https://api.example.com/v1#hunter2",
    "ftp://api.example.com/v1",
    "http://api.example.com/v1",
]


@pytest.mark.parametrize("base_url", REFUSED_URLS)
async def test_an_endpoint_the_lab_refuses_names_the_field_and_stores_nothing(
    tmp_path: Path, base_url: str
) -> None:
    environment = lab(tmp_path)
    async with environment.client as client:
        refusal = await client.put(
            "/api/v1/model-connections/openai", json={"base_url": base_url, "api_key": None}
        )

    assert refusal.status_code == 422, refusal.text
    payload = refusal.json()
    assert payload["code"] == "model_connection_configuration_error"
    assert payload["details"][0]["location"] == "body.base_url"
    # The refusal names the rule and never the value, which is what keeps a password written
    # into a URL out of the error, the log and the browser's history.
    assert "hunter2" not in refusal.text
    assert environment.stored() == []


async def test_an_endpoint_the_lab_accepts_is_accepted(tmp_path: Path) -> None:
    environment = lab(tmp_path)
    async with environment.client as client:
        local = await client.put(
            "/api/v1/model-connections/openai", json={"base_url": OLLAMA, "api_key": None}
        )

    assert local.status_code == 200, local.text
    assert local.json()["connection"]["base_url"] == OLLAMA
    assert local.json()["connection"]["key_configured"] is False


async def test_two_spellings_of_one_endpoint_are_saved_as_one_value(tmp_path: Path) -> None:
    environment = lab(tmp_path)
    async with environment.client as client:
        first = await client.put(
            "/api/v1/model-connections/openai",
            json={"base_url": "HTTPS://Api.OpenAI.com:443/v1/", "api_key": None},
        )
        second = await client.put(
            "/api/v1/model-connections/openai", json={"base_url": OPENAI, "api_key": None}
        )

    assert first.json()["connection"]["base_url"] == OPENAI
    assert second.json()["connection"]["base_url"] == OPENAI


# --- the key at rest ----------------------------------------------------------------------


async def test_saving_a_key_with_no_encryption_key_is_refused_and_names_the_variable(
    tmp_path: Path,
) -> None:
    environment = lab(tmp_path, credential_key=None)
    async with environment.client as client:
        refusal = await client.put(
            "/api/v1/model-connections/openai",
            json={"base_url": OPENAI, "api_key": API_KEY},
        )
        read = await client.get("/api/v1/model-connections/openai")

    assert refusal.status_code == 422, refusal.text
    assert refusal.json()["code"] == "credential_key_unconfigured"
    assert CREDENTIAL_KEY_VARIABLE in refusal.json()["message"]
    assert API_KEY not in refusal.text
    # Refused whole: no base URL landed without the key it was saved with.
    assert environment.stored() == []
    assert read.json()["connection"] is None


async def test_a_blank_encryption_key_is_no_encryption_key(tmp_path: Path) -> None:
    """`AGENT_LAB_CREDENTIAL_KEY=` must refuse exactly as an unset variable does.

    Pydantic hands composition `SecretStr('')` rather than `None` for an empty environment or
    `.env` value, so an operator who uncomments the line without filling it in would otherwise
    get a working cipher under a key anybody can derive — and ciphertext in the column to
    persuade them it had worked.
    """
    for blank in ("", "   "):
        environment = lab(tmp_path, f"blank-{len(blank)}.db", credential_key=blank)
        async with environment.client as client:
            refusal = await client.put(
                "/api/v1/model-connections/openai",
                json={"base_url": OPENAI, "api_key": API_KEY},
            )

        assert refusal.status_code == 422, refusal.text
        assert refusal.json()["code"] == "credential_key_unconfigured"
        assert CREDENTIAL_KEY_VARIABLE in refusal.json()["message"]
        assert environment.stored() == []


async def test_a_lab_with_no_encryption_key_can_still_save_an_endpoint(tmp_path: Path) -> None:
    """The environment bootstrap keeps working, and so does a local endpoint needing no key."""
    environment = lab(tmp_path, credential_key=None)
    async with environment.client as client:
        saved = await client.put(
            "/api/v1/model-connections/openai", json={"base_url": OLLAMA, "api_key": None}
        )

    assert saved.status_code == 200, saved.text
    assert saved.json()["connection"]["key_configured"] is False


async def test_the_stored_column_never_holds_the_key_the_operator_typed(
    tmp_path: Path,
) -> None:
    """The assertion the whole encryption decision exists for.

    A copy of this database — a backup, a file dropped into a bug report, a checkout shared
    between machines — must not carry a usable credential.
    """
    environment = lab(tmp_path)
    async with environment.client as client:
        saved = await client.put(
            "/api/v1/model-connections/openai",
            json={"base_url": OPENAI, "api_key": API_KEY},
        )

    assert saved.status_code == 200, saved.text
    row = environment.stored_text()
    assert API_KEY not in row
    for length in (6, 8, 12, 16):
        assert API_KEY[:length] not in row
        assert API_KEY[-length:] not in row
    # And the row is not empty of a key either: something was stored, it is just not readable.
    assert environment.stored()[0][2]


async def test_a_key_saved_under_another_encryption_key_refuses_rather_than_failing(
    tmp_path: Path,
) -> None:
    saved_under = lab(tmp_path, "rotated.db")
    async with saved_under.client as client:
        await client.put(
            "/api/v1/model-connections/openai",
            json={"base_url": OPENAI, "api_key": API_KEY},
        )

    moved_on = lab(
        tmp_path, "rotated.db", credential_key="a-different-passphrase", probe=_reachable()
    )
    async with moved_on.client as client:
        refusal = await client.post(
            "/api/v1/model-connections/openai/test", json={"base_url": OPENAI, "api_key": None}
        )

    assert refusal.status_code == 422, refusal.text
    assert refusal.json()["code"] == "credential_key_mismatch"
    assert CREDENTIAL_KEY_VARIABLE in refusal.json()["message"]
    assert API_KEY not in refusal.text


# --- testing a connection -----------------------------------------------------------------


def _reachable() -> StubProbe:
    return StubProbe(
        ModelEndpointProbeResult(
            outcome=ModelEndpointOutcome.REACHABLE,
            latency_ms=880,
            status_class=HttpStatusClass.SUCCESS,
        )
    )


OUTCOMES = [
    (ModelEndpointOutcome.REACHABLE, HttpStatusClass.SUCCESS, "reachable", "2xx"),
    (ModelEndpointOutcome.REFUSED, HttpStatusClass.CLIENT_ERROR, "refused", "4xx"),
    (ModelEndpointOutcome.UNREACHABLE, None, "unreachable", None),
]


@pytest.mark.parametrize(("outcome", "status_class", "served", "served_class"), OUTCOMES)
async def test_the_test_route_serves_each_classified_outcome(
    tmp_path: Path,
    outcome: ModelEndpointOutcome,
    status_class: HttpStatusClass | None,
    served: str,
    served_class: str | None,
) -> None:
    environment = lab(
        tmp_path,
        probe=StubProbe(
            ModelEndpointProbeResult(outcome=outcome, latency_ms=910, status_class=status_class)
        ),
    )
    async with environment.client as client:
        answered = await client.post(
            "/api/v1/model-connections/openai/test",
            json={"base_url": OPENAI, "api_key": API_KEY},
        )

    assert answered.status_code == 200, answered.text
    assert answered.json() == {
        "outcome": served,
        "latency_ms": 910,
        "status_class": served_class,
    }
    # Nothing about a moment is written down.
    assert environment.stored() == []


async def test_the_test_route_answers_with_the_classification_and_nothing_else(
    tmp_path: Path,
) -> None:
    """Three fields, and deliberately no fourth.

    A field for the upstream message would be a field carrying a string this lab did not write
    and cannot promise the contents of — the credential that was sent among them.
    """
    environment = lab(tmp_path, probe=_reachable())
    async with environment.client as client:
        answered = await client.post(
            "/api/v1/model-connections/openai/test",
            json={"base_url": OPENAI, "api_key": API_KEY},
        )

    assert sorted(answered.json()) == ["latency_ms", "outcome", "status_class"]
    assert API_KEY not in answered.text


async def test_the_test_route_uses_the_saved_key_when_none_is_typed(tmp_path: Path) -> None:
    probe = _reachable()
    environment = lab(tmp_path, probe=probe)
    async with environment.client as client:
        await client.put(
            "/api/v1/model-connections/openai",
            json={"base_url": OPENAI, "api_key": API_KEY},
        )
        await client.post(
            "/api/v1/model-connections/openai/test",
            json={"base_url": OLLAMA, "api_key": None},
        )

    assert probe.calls == [(OLLAMA, API_KEY)]


async def test_an_endpoint_the_lab_refuses_is_never_called(tmp_path: Path) -> None:
    probe = _reachable()
    environment = lab(tmp_path, probe=probe)
    async with environment.client as client:
        refusal = await client.post(
            "/api/v1/model-connections/openai/test",
            json={"base_url": "https://maya:hunter2@api.example.com/v1", "api_key": None},
        )

    assert refusal.status_code == 422
    assert probe.calls == []


# --- the sweep ----------------------------------------------------------------------------


async def test_no_span_log_line_or_error_payload_carries_the_key_or_its_ciphertext(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    """The standing rule ADR 0044 reached for and ADR 0052 keeps whole.

    The key is never logged, never traced, never served and never echoed in an error. This
    walks a whole session — saving, reading, listing, testing, and three refusals — and sweeps
    everything the lab emitted while doing it: every log record at DEBUG and above from every
    logger, rendered through a formatter so that a logged traceback is swept and not only the
    message somebody formatted; every response body, including the refusals; and every exported
    span.

    Three things about the reach of this sweep, said plainly rather than implied:

    - **These four routes open no span of their own today**, so the span dimension finds an
      empty list and passes on it. It is a forward guard — the exporter is wired, and a span
      added to this resource joins the sweep on the day it is opened — and it is not evidence
      about today. The response bodies and the log records are what carries the weight here,
      and the realness guard below is satisfied by them.
    - **The probe is a stub**, so the one component that puts a key on a socket is outside this
      session. `test_a_probe_never_carries_the_upstream_body_back` sweeps the real one against
      a loopback endpoint that answers with a leaky body, which is where that leg is proven.
    - The ciphertext is swept as well as the key, because a stored envelope served or logged
      would be a fact about the secret even though it is not the secret.

    The haystack is asserted to be real before it is asserted to be clean: the base URL, which
    this lab *may* say, has to be findable in it, or the sweep would pass on an empty string.
    """
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    environment = lab(
        tmp_path,
        probe=_reachable(),
        telemetry=Telemetry(provider.get_tracer("sweep"), b"sweep-salt"),
    )

    with caplog.at_level(logging.DEBUG):
        async with environment.client as client:
            bodies = [
                (
                    await client.put(
                        "/api/v1/model-connections/openai",
                        json={"base_url": OPENAI, "api_key": API_KEY},
                    )
                ).text,
                (await client.get("/api/v1/model-connections/openai")).text,
                (await client.get("/api/v1/model-connections")).text,
                (
                    await client.post(
                        "/api/v1/model-connections/openai/test",
                        json={"base_url": OPENAI, "api_key": API_KEY},
                    )
                ).text,
                (
                    await client.put(
                        "/api/v1/model-connections/openai",
                        json={"base_url": f"https://maya:{API_KEY}@api.example.com/v1"},
                    )
                ).text,
                (
                    await client.put(
                        "/api/v1/model-connections/openai",
                        json={"base_url": f"https://api.example.com/v1?key={API_KEY}"},
                    )
                ).text,
                (
                    await client.put(
                        "/api/v1/model-connections/fake",
                        json={"base_url": OPENAI, "api_key": API_KEY},
                    )
                ).text,
            ]

    ciphertext = str(environment.stored()[0][2])
    swept = "\n".join(
        [
            *bodies,
            # `format` rather than `getMessage`: a record carrying `exc_info` renders its
            # traceback only through a formatter, and a credential reaching a log by way of an
            # exception is exactly the path a message-only sweep would walk past.
            *(_formatter.format(record) for record in caplog.records),
            repr(
                [
                    (span.name, span.attributes, span.events)
                    for span in exporter.get_finished_spans()
                ]
            ),
        ]
    )

    assert OPENAI in swept, "the sweep read nothing, so it proves nothing"
    assert ciphertext
    assert API_KEY not in swept
    assert ciphertext not in swept
    for length in (6, 8, 12, 16):
        assert API_KEY[:length] not in swept
        assert API_KEY[-length:] not in swept


# --- the published contract ---------------------------------------------------------------


def _contract() -> dict[str, Any]:
    path = Path(__file__).parents[3] / "packages" / "contracts" / "openapi" / "v1" / "openapi.yaml"
    return cast(dict[str, Any], yaml.safe_load(path.read_text()))


def test_the_contract_publishes_the_four_operations() -> None:
    paths = cast(dict[str, dict[str, Any]], _contract()["paths"])
    published = {
        operation["operationId"]
        for path, operations in paths.items()
        for method, operation in operations.items()
        if path.startswith("/api/v1/model-connections") and method in {"get", "put", "post"}
    }

    assert published == {
        "listModelConnections",
        "getModelConnection",
        "saveModelConnection",
        "testModelConnection",
    }


def test_the_contract_carries_the_key_inwards_only() -> None:
    """`api_key` is publishable on a request body and on no response.

    Read off the contract rather than off the Python models, because the contract is what a
    client generates from: a response schema that grew a mask would be a mask every consumer
    of this lab could render.
    """
    schemas = cast(dict[str, dict[str, Any]], _contract()["components"]["schemas"])

    assert sorted(schemas["ModelConnectionSchema"]["properties"]) == CONNECTION_FIELDS
    assert sorted(schemas["ModelConnectionTestResponse"]["properties"]) == [
        "latency_ms",
        "outcome",
        "status_class",
    ]
    carrying = {
        name for name, schema in schemas.items() if "api_key" in schema.get("properties", {})
    }
    assert carrying == {"SaveModelConnectionRequest", "ModelConnectionTestRequest"}
