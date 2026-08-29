from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from capability_lab.infrastructure import models
from capability_lab.infrastructure.config import get_settings

config = context.config
config.set_main_option(
    "sqlalchemy.url",
    get_settings().database_url.replace("%", "%%"),
)

if config.config_file_name is not None:
    # `disable_existing_loggers` defaults to true, which would switch off every logger the
    # process had already created — including the application's own. That is harmless for the
    # CLI, where migrating is all the process does, but this environment also runs in-process:
    # a test session that migrates and then exercises the application, or any startup path
    # that migrates before serving, would afterwards log nothing and give no sign of it.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = models.CustomerModel.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
