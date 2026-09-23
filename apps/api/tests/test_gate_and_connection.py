"""The publish gate does not change with where the lab is pointed (ADR 0053).

*May this be published?* and *can this lab run it now?* are two questions answered by two
authorities. The first is the gate, offline and identical on every machine; the second is the
registry, composed from the resolved connection. If the gate read the connection, two labs would
disagree about one draft, and a version would stop meaning the same thing wherever it is read.
This module is the guard on that rule: one agent draft and one judge draft are previewed under
every answer of ADR 0052's resolution chain, and each preview must be equal.

Every state is reached the way a real lab reaches it — the settings route, and the process
environment the API composes itself from (`AGENT_LAB_OPENAI_API_KEY`, `AGENT_LAB_CREDENTIAL_KEY`)
through `get_settings()` — rather than by stubbing the resolver or handing the app a `Settings`,
so a gate that read the key from the process, from `get_settings()` or from its own composition
would all answer differently here. `getLabStatus` is asserted to report each state, so the
comparison is between states that really differ.

**One departure from ADR 0053's list.** It asks for the same preview "with one for a different
provider". Only `openai` is connectable (ADR 0052, `CONNECTABLE_PROVIDERS`) and the route refuses
any other id, so no such lab can be built; a second endpoint under a second key stands in for it.
"""

import json
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from api_factories import make_identity
from capability_lab.application.model_connections import CONNECTABLE_PROVIDERS
from capability_lab.infrastructure.config import get_settings
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
)
from capability_lab.presentation.api import create_app

CONFIGURATIONS = "/api/v1/agent-configurations"
JUDGES = "/api/v1/judge-configurations"
CONNECTION = "/api/v1/model-connections/openai"
LAB_STATUS_PROVIDER = json.loads(
    (Path(__file__).parent / "fixtures" / "lab_status_provider.json").read_text(encoding="utf-8")
)["provider_id"]

CREDENTIAL_KEY = "an-operator-supplied-passphrase"
ROTATED_CREDENTIAL_KEY = "a-passphrase-the-key-was-not-saved-under"
ENVIRONMENT_KEY = "sk-environment-5f0c2a9e41d84b7c"
SAVED_KEY = "sk-saved-8b3e61d0c7a94f25"


@asynccontextmanager
async def lab(
    monkeypatch: pytest.MonkeyPatch,
    database: Path,
    *,
    credential_key: str = CREDENTIAL_KEY,
    environment_key: str | None = None,
) -> AsyncGenerator[AsyncClient]:
    """One app over a shared database file, composed from the process environment.

    The environment key is set to an empty string rather than deleted when absent, because a
    blank value is treated as unset and an empty variable also outranks a developer's `.env`.
    """
    monkeypatch.setenv("AGENT_LAB_DATABASE_URL", f"sqlite:///{database}")
    monkeypatch.setenv("AGENT_LAB_CREDENTIAL_KEY", credential_key)
    monkeypatch.setenv("AGENT_LAB_OPENAI_API_KEY", environment_key or "")
    get_settings.cache_clear()
    engine = create_database_engine(get_settings().database_url)
    Base.metadata.create_all(engine)
    application = create_app(session_factory=create_session_factory(engine))
    try:
        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="http://lab.test"
        ) as client:
            yield client
    finally:
        engine.dispose()


async def author_drafts(client: AsyncClient) -> tuple[str, str]:
    """An agent draft and a judge draft, both naming `openai` and each with a gate finding.

    Each carries a model the lab has not exercised, so the gate has something to say — a
    preview with no findings would stay identical however much the gate consulted the lab.
    """
    identity = await make_identity(client)
    created = await client.post(
        CONFIGURATIONS,
        json={
            "name": "Frontline single agent",
            "support_identity_id": identity["support_identity_id"],
        },
    )
    assert created.status_code == 201, created.text
    configuration_id = str(created.json()["configuration_id"])
    content = created.json()["content"]
    saved = await client.put(
        f"{CONFIGURATIONS}/{configuration_id}/draft",
        json={
            "payload": {
                **content,
                "prompt": "You are {{support_identity.role}} for {{shop.name}}.",
                "model": {**content["model"], "provider": "openai", "model_id": "llama3.1:8b"},
            }
        },
    )
    assert saved.status_code == 200, saved.text

    judge = await client.post(JUDGES, json={"name": "Resolution quality"})
    assert judge.status_code == 201, judge.text
    judge_id = str(judge.json()["judge_id"])
    saved = await client.put(
        f"{JUDGES}/{judge_id}/draft",
        json={
            "payload": {
                **judge.json()["content"],
                "rubric": "Score whether the incident the customer opened was resolved.",
                "model": {"provider": "openai", "model_id": "llama3.1:8b", "temperature": "0.00"},
            }
        },
    )
    assert saved.status_code == 200, saved.text
    return configuration_id, judge_id


async def previews(client: AsyncClient, configuration_id: str, judge_id: str) -> dict[str, Any]:
    agent = await client.get(f"{CONFIGURATIONS}/{configuration_id}/draft/preview")
    judge = await client.get(f"{JUDGES}/{judge_id}/draft/preview")
    assert agent.status_code == 200, agent.text
    assert judge.status_code == 200, judge.text
    return {"agent": agent.json(), "judge": judge.json()}


async def source(client: AsyncClient) -> str:
    status = await client.get("/api/v1/lab-status")
    assert status.status_code == 200, status.text
    return str(status.json()["connection_source"])


async def test_the_same_draft_previews_identically_whatever_the_lab_is_pointed_at(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database = tmp_path / "gate-and-connection.db"
    seen: dict[str, dict[str, Any]] = {}

    # Neither a saved connection nor an environment key: the lab reaches nothing.
    async with lab(monkeypatch, database) as offline:
        configuration_id, judge_id = await author_drafts(offline)
        assert await source(offline) == "none"
        seen["none"] = await previews(offline, configuration_id, judge_id)

    # The environment's key, at the endpoint it was issued for.
    async with lab(monkeypatch, database, environment_key=ENVIRONMENT_KEY) as bootstrapped:
        assert await source(bootstrapped) == "environment"
        seen["environment"] = await previews(bootstrapped, configuration_id, judge_id)

        # A saved connection at a local endpoint with no key, which wins over the environment.
        saved = await bootstrapped.put(CONNECTION, json={"base_url": "http://localhost:11434/v1"})
        assert saved.status_code == 200, saved.text
        assert await source(bootstrapped) == "saved"
        seen["saved, local endpoint"] = await previews(bootstrapped, configuration_id, judge_id)

        # Re-pointed at another endpoint entirely, under a key of its own.
        saved = await bootstrapped.put(
            CONNECTION,
            json={"base_url": "https://openrouter.ai/api/v1", "api_key": SAVED_KEY},
        )
        assert saved.status_code == 200, saved.text
        assert await source(bootstrapped) == "saved"
        seen["saved, another endpoint"] = await previews(bootstrapped, configuration_id, judge_id)

    # The same saved key under an encryption key it was not saved with: an offline lab.
    async with lab(monkeypatch, database, credential_key=ROTATED_CREDENTIAL_KEY) as unreadable:
        assert await source(unreadable) == "saved_unreadable"
        seen["saved_unreadable"] = await previews(unreadable, configuration_id, judge_id)

    # The gate had something to say, so the comparison below is about content, not emptiness.
    reference = seen["none"]
    assert "model_not_exercised" in {issue["code"] for issue in reference["agent"]["issues"]}
    assert "judge_model_not_exercised" in {issue["code"] for issue in reference["judge"]["issues"]}
    for state, answer in seen.items():
        assert answer == reference, f"the gate answered differently with the lab on {state}"


async def test_lab_status_reports_the_one_provider_the_studio_applies_it_to(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The Studio reads `connection_source` as this provider's, and nothing else's.

    The contract does not key the source by provider, so `LAB_STATUS_PROVIDER` in
    `apps/web/src/lib/modelConnections.ts` is held to the shared fixture, and the fixture is held
    here to what the API does: saving a connection for that provider is what moves the source,
    and it is the only provider a connection can be saved for.
    """
    assert CONNECTABLE_PROVIDERS == (LAB_STATUS_PROVIDER,)

    async with lab(monkeypatch, tmp_path / "lab-status-provider.db") as client:
        assert await source(client) == "none"
        saved = await client.put(
            f"/api/v1/model-connections/{LAB_STATUS_PROVIDER}",
            json={"base_url": "http://localhost:11434/v1"},
        )
        assert saved.status_code == 200, saved.text
        assert await source(client) == "saved"
