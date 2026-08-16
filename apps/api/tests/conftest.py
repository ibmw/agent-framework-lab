from collections.abc import Generator

import pytest

from capability_lab.infrastructure.config import get_settings


@pytest.fixture(autouse=True)
def isolated_settings(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    monkeypatch.setenv("AGENT_LAB_ENVIRONMENT", "test")
    monkeypatch.setenv("AGENT_LAB_DATABASE_URL", "sqlite://")
    monkeypatch.setenv("AGENT_LAB_FRONTEND_ORIGIN", "http://localhost:5173")
    monkeypatch.setenv("AGENT_LAB_LOG_LEVEL", "INFO")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
