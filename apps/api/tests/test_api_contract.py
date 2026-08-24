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


def test_no_route_advertises_fastapis_default_validation_shape() -> None:
    """Every documented status uses the contract's own `ErrorResponse`.

    FastAPI documents `HTTPValidationError` by default, but this application answers 422 with
    `code`/`message`/`request_id` through its own handlers. A route that omits its `responses`
    therefore publishes a body shape the server never sends.
    """
    schema = cast(dict[str, object], create_app(get_default_settings()).openapi())
    paths = cast(dict[str, dict[str, dict[str, object]]], schema["paths"])

    advertised = [
        f"{method.upper()} {path} -> {status}"
        for path, operations in paths.items()
        for method, operation in operations.items()
        for status, response in cast(
            dict[str, dict[str, object]], operation.get("responses", {})
        ).items()
        if "HTTPValidationError" in str(response.get("content", ""))
    ]

    assert advertised == []
