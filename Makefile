.PHONY: install check check-contracts lint typecheck test test-migrations test-e2e contracts dev-api dev-web migrate

install:
	uv sync --all-packages
	pnpm install --frozen-lockfile

lint:
	uv run ruff check .
	uv run ruff format --check .
	pnpm lint

typecheck:
	uv run pyright
	pnpm typecheck

test:
	uv run pytest -m "not migration and not live_model"
	pnpm test

test-migrations:
	uv run pytest -m migration

check-contracts:
	pnpm --filter @agent-lab/contracts check:generated

test-e2e:
	pnpm test:e2e

check: lint typecheck test test-migrations check-contracts

contracts:
	uv run python packages/contracts/scripts/export_openapi.py
	pnpm --filter @agent-lab/contracts generate

dev-api:
	uv run uvicorn capability_lab.presentation.api:app --app-dir apps/api/src --reload

dev-web:
	pnpm dev

migrate:
	mkdir -p var
	uv run alembic -c apps/api/alembic.ini upgrade head
