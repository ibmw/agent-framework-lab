from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LOCAL_TELEMETRY_HASH_SALT = "agent-lab-local-only"


class Settings(BaseSettings):
    """Everything this process reads from its environment, and how blanks are read.

    Two of these are secrets the environment supplies, and **a blank value means unset for
    both** — the environment delivers `AGENT_LAB_X=` as an empty string rather than as an
    absence, and against `None` alone that answers *yes, this is configured*. They are
    normalized in two different places on purpose. `openai_api_key` is normalized here, by the
    validator below, because after ADR 0052 several readers ask the same question of it.
    `credential_key` is normalized at `create_credential_cipher`, its single consumer, which is
    also the one place that decides what an unconfigured lab does. A later reader meeting them
    apart should read that as the difference between a field with many readers and a field with
    one, and not as two rules.

    `telemetry_hash_salt` looks like a third and is not: it carries a non-empty default and its
    own validator, so a blank value there is a different question from either of these.
    """

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
    """The environment's bootstrap credential: what a lab runs on until one is saved.

    Second in the resolution chain, behind the connection the lab holds and ahead of offline
    (ADR 0052). It is what keeps a fresh checkout, CI and an unattended seed working with no
    settings page ever opened.
    """

    media_root: Path = Path("./var/media")
    """Where a shop's uploaded images are stored, as `shops/{shop_id}/{sha256}` (ADR 0076).

    The database names what the root holds: a row of `shop_media_assets` per image, which
    serving reads first. Reset the two together (`docs/development.md`).
    """

    media_max_bytes: int = Field(default=5 * 1024 * 1024, gt=0)
    """The most bytes one uploaded image may hold: 5 MiB unless the environment says less."""

    openai_model: Literal["gpt-5-mini"] = "gpt-5-mini"
    otel_exporter_otlp_endpoint: str | None = None
    telemetry_hash_salt: SecretStr = SecretStr(LOCAL_TELEMETRY_HASH_SALT)

    @field_validator("openai_api_key", mode="after")
    @classmethod
    def blank_api_key_is_unset(cls, value: SecretStr | None) -> SecretStr | None:
        """`AGENT_LAB_OPENAI_API_KEY=` is an absent credential, not an empty one.

        Pydantic reads a blanked `.env` line, or a compose file passing an unset variable
        through, as `SecretStr('')` rather than as `None`. Every reader of this field asks the
        same question — *can this lab reach a provider* — and against `None` alone an empty
        value answers yes: the resolution chain would report a credentialed run mode and
        compose a model-backed runtime over a key of no characters, so an operator would be
        told the lab is ready and every advance would fail at the provider.

        Normalized here rather than at the chain, because the field is what is wrong: it is
        the same hazard, and the same answer, `create_credential_cipher` gives
        `AGENT_LAB_CREDENTIAL_KEY` — that one is decided at its single consumer because a
        cipher is the one thing that reads it. Whitespace is stripped for the same reason: a
        value that is only spaces was not configured by anybody on purpose.

        `telemetry_hash_salt` below carries the identical shape and is deliberately left
        alone: it has a non-empty default and its own validator, so a blank value there is a
        different question from this one.
        """
        if value is None or not value.get_secret_value().strip():
            return None
        return value

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
