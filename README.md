# Agent Framework Capability Lab

A controlled customer-support simulation lab for configuring synthetic e-commerce environments,
running one or two agent implementations against equivalent isolated state, and comparing their
behavior with objective evidence.

The backend still carries a proof of concept for deterministic fixtures, safe tool-mediated actions,
durable conversations, traces, and framework-neutral adapters. The approved target product is the
Simulation Studio and Experiment Lab described in
[`docs/product-direction.md`](docs/product-direction.md); its first surfaces — the versioned shop
and extensible catalog, and the Studio workspace shell — are implemented. The POC's persona-first
workflow and hard-coded scenarios are not the target roadmap.

The web app opens on the shop workspace: create a shop, author its catalog and support knowledge,
check the publish gate, and publish an immutable version.

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

- [`docs/product-direction.md`](docs/product-direction.md): authoritative product scope, vocabulary,
  journeys, and comparison principles.
- [`docs/design-brief.md`](docs/design-brief.md): brief for three distinct product-design directions.
- [`docs/architecture.md`](docs/architecture.md): structure and allowed dependencies.
- [`docs/PLAN.md`](docs/PLAN.md): current redesign roadmap and POC baseline.
- [`docs/development.md`](docs/development.md): trunk-based workflow and local development loop.
- [`docs/decisions-and-next-step.md`](docs/decisions-and-next-step.md): accepted direction,
  superseded assumptions, and next task.
- [`.codex/skills`](.codex/skills): project-local skills for recurring changes.
