from pathlib import Path
from typing import cast

import pytest
import yaml

from capability_lab.infrastructure.config import get_default_settings
from capability_lab.presentation.api import API_TITLE, create_app


def test_published_openapi_matches_application_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_LAB_API_TITLE", "HOSTILE")
    monkeypatch.setenv("AGENT_LAB_FRONTEND_ORIGIN", "https://ambient.invalid")
    contract_path = (
        Path(__file__).parents[3] / "packages" / "contracts" / "openapi" / "v1" / "openapi.yaml"
    )
    published = cast(dict[str, object], yaml.safe_load(contract_path.read_text()))
    application = create_app(get_default_settings())

    assert application.title == API_TITLE
    assert published == application.openapi()
