from functools import lru_cache
from typing import Literal, Self

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LOCAL_TELEMETRY_HASH_SALT = "agent-lab-local-only"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="AGENT_LAB_",
        extra="ignore",
    )

    environment: Literal["development", "test", "production"] = "development"
    database_url: str = "sqlite:///./var/agent-lab.db"
    frontend_origin: str = "http://localhost:5173"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    credential_key: SecretStr | None = None
    """What the lab encrypts a saved provider key with, and deliberately has no default.

    Unlike `telemetry_hash_salt` below, which carries a local development default, there is
    none here: a shipped default encryption key is encryption theatre, and theatre is worse
    than the plain refusal because somebody would believe it. With this unset, saving a key is
    refused with 422 naming the variable and the environment bootstrap keeps working
    (ADR 0052).

    It holds **key material**, such as `openssl rand -base64 32`, and not a phrase somebody
    chose. Nothing validates that — see `infrastructure/credentials.py` for why a length check
    would promise more than it can check — and ADR 0052's qualification states what the
    difference costs.
    """

    openai_api_key: SecretStr | None = None
    openai_model: Literal["gpt-5-mini"] = "gpt-5-mini"
    otel_exporter_otlp_endpoint: str | None = None
    telemetry_hash_salt: SecretStr = SecretStr(LOCAL_TELEMETRY_HASH_SALT)

    @model_validator(mode="after")
    def require_private_telemetry_hash_salt(self) -> Self:
        if (
            self.environment != "development"
            and self.telemetry_hash_salt.get_secret_value() == LOCAL_TELEMETRY_HASH_SALT
        ):
            raise ValueError(
                "telemetry hash salt must be configured outside the development environment"
            )
        return self


def get_default_settings() -> Settings:
    """Return declared defaults without consulting environment settings sources."""
    return Settings.model_construct()


@lru_cache
def get_settings() -> Settings:
    return Settings()
