# Agent Framework Capability Lab

Playground e-commerce destiné à rendre visibles et comparables les capacités de frameworks
d'agents. Cette première étape ne contient ni agent fonctionnel ni chat final : elle pose les
frontières, les contrats, la qualité et la reproductibilité nécessaires aux futures démos.

## Prérequis

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

## Commandes

```bash
make check          # vérifications rapides complètes
make test           # tests Python et frontend
make test-migrations
make dev-api        # API sur http://localhost:8000
make dev-web        # frontend sur http://localhost:5173
make test-e2e       # parcours Playwright ciblés
```

Avant `make dev-api` ou `make dev-web`, vérifier qu'aucun serveur correspondant n'est déjà actif.
Les commandes ne démarrent, n'arrêtent ou ne redémarrent jamais un service implicitement.

## Repères

- [`docs/architecture.md`](docs/architecture.md) : structure et dépendances autorisées.
- [`docs/PLAN.md`](docs/PLAN.md) : jalons futurs et résultats terminés.
- [`docs/development.md`](docs/development.md) : workflow trunk-based et boucle locale.
- [`docs/decisions-and-next-step.md`](docs/decisions-and-next-step.md) : périmètre reporté.
- [`.codex/skills`](.codex/skills) : skills project-local pour les évolutions récurrentes.
