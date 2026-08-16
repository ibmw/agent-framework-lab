from pathlib import Path

import yaml

from capability_lab.infrastructure.config import get_default_settings
from capability_lab.presentation.api import create_app

CONTRACT_PATH = Path(__file__).parents[1] / "openapi" / "v1" / "openapi.yaml"


def main() -> None:
    schema = create_app(get_default_settings()).openapi()
    CONTRACT_PATH.write_text(
        yaml.safe_dump(schema, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
