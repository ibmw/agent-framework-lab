import pytest
from pydantic import SecretStr, ValidationError

from capability_lab.infrastructure.config import LOCAL_TELEMETRY_HASH_SALT, Settings


def test_local_telemetry_hash_salt_is_limited_to_development() -> None:
    development = Settings(
        environment="development",
        telemetry_hash_salt=SecretStr(LOCAL_TELEMETRY_HASH_SALT),
    )

    with pytest.raises(ValidationError, match="must be configured outside"):
        Settings(
            environment="production",
            telemetry_hash_salt=SecretStr(LOCAL_TELEMETRY_HASH_SALT),
        )

    production = Settings(
        environment="production",
        telemetry_hash_salt=SecretStr("production-specific-telemetry-salt"),
    )

    assert development.environment == "development"
    assert production.environment == "production"
