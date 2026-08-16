# Agent Framework Capability Lab

An e-commerce playground designed to make agent-framework capabilities visible and comparable.
This initial foundation does not include a working agent or final chat experience; it establishes
the boundaries, contracts, quality gates, and reproducibility needed by future demonstrations.

## Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/)
- Node.js 24+
- pnpm 11+

## Installation

```bash
uv sync --all-packages
pnpm install --frozen-lockfile
cp .env.example .env
uv run prek install
```

## Commands

```bash
make check          # complete fast quality gate
make test           # Python and frontend tests
make test-migrations
make dev-api        # API at http://localhost:8000
make dev-web        # frontend at http://localhost:5173
make test-e2e       # targeted Playwright journeys
```

Before running `make dev-api` or `make dev-web`, check whether the corresponding server is already
running. Commands must never start, stop, or restart a service implicitly.

## Documentation

- [`docs/architecture.md`](docs/architecture.md): structure and allowed dependencies.
- [`docs/PLAN.md`](docs/PLAN.md): future milestones and completed outcomes.
- [`docs/development.md`](docs/development.md): trunk-based workflow and local development loop.
- [`docs/decisions-and-next-step.md`](docs/decisions-and-next-step.md): decisions and deferred scope.
- [`.codex/skills`](.codex/skills): project-local skills for recurring changes.
