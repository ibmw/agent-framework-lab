from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


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


def get_default_settings() -> Settings:
    """Return declared defaults without consulting environment settings sources."""
    return Settings.model_construct()


@lru_cache
def get_settings() -> Settings:
    return Settings()
