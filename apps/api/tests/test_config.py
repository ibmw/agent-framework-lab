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


BLANK_VALUES = ("", " ", "\t", "\n  ")
"""Every way an unset variable arrives as a value: a blanked `.env` line, or a compose file
passing one through. Enumerated because the fix strips as well as tests for empty."""


@pytest.mark.parametrize("blank", BLANK_VALUES)
def test_a_blank_provider_key_is_an_absent_one_rather_than_an_empty_credential(
    blank: str,
) -> None:
    """`AGENT_LAB_OPENAI_API_KEY=` must not answer *yes, this lab has a key*.

    Pydantic reads it as `SecretStr('')` rather than as `None`, and every reader of this field
    asks whether the lab can reach a provider. Against `None` alone the empty value answers
    yes: the resolution chain would report a credentialed run mode and compose a model-backed
    runtime over a credential of no characters (ADR 0052).
    """
    assert Settings(openai_api_key=SecretStr(blank)).openai_api_key is None


def test_a_provider_key_that_was_actually_set_survives_untouched() -> None:
    """Non-vacuity: the rule above removes blanks and nothing else."""
    key = "sk-lab-9d41c0e7b6a24f8fae3c15d2708b6c93"
    configured = Settings(openai_api_key=SecretStr(key))

    assert configured.openai_api_key is not None
    assert configured.openai_api_key.get_secret_value() == key
