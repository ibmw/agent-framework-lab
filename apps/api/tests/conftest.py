from collections.abc import Generator
from pathlib import Path

import pytest

from capability_lab.infrastructure.config import get_settings

# The media root a test would write into if it composed the API with the declared default
# (`./var/media`, relative to where pytest runs). Nothing a test runs may leave a file there.
_CHECKOUT_MEDIA_ROOT = Path("var/media")


def _files_under(root: Path) -> frozenset[Path]:
    if not root.exists():
        return frozenset()
    return frozenset(path for path in root.rglob("*") if path.is_file())


@pytest.fixture(autouse=True)
def isolated_settings(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> Generator[None, None, None]:
    monkeypatch.setenv("AGENT_LAB_ENVIRONMENT", "test")
    monkeypatch.setenv("AGENT_LAB_DATABASE_URL", "sqlite://")
    monkeypatch.setenv("AGENT_LAB_FRONTEND_ORIGIN", "http://localhost:5173")
    monkeypatch.setenv("AGENT_LAB_LOG_LEVEL", "INFO")
    monkeypatch.setenv("AGENT_LAB_TELEMETRY_HASH_SALT", "test-only-telemetry-salt")
    # Every test's images go under its own temporary directory, so a suite that composes the
    # API from the environment writes nowhere in the checkout (ADR 0076).
    monkeypatch.setenv("AGENT_LAB_MEDIA_ROOT", str(tmp_path / "media"))
    get_settings.cache_clear()
    before = _files_under(_CHECKOUT_MEDIA_ROOT)
    yield
    get_settings.cache_clear()
    left = _files_under(_CHECKOUT_MEDIA_ROOT) - before
    assert not left, f"a test wrote into the checkout's media root: {sorted(left)}"
