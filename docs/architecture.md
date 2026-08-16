# Architecture

## Structure minimale

```text
apps/
  api/                    API FastAPI et composition des adaptateurs
    src/capability_lab/
      domain/             entités, invariants et règles e-commerce
      application/        cas d'usage et ports
      infrastructure/     SQLAlchemy, configuration, traces, agents
      presentation/       routes et schémas HTTP
    migrations/           historique Alembic portable
  web/                    playground React/Vite
packages/
  contracts/              contrat OpenAPI v1 et types partagés générables
infra/
  phoenix/                configuration d'observabilité locale future
docs/                     guidelines et ADR
.codex/skills/            procédures project-local spécialisées
```

## Règle de dépendance

```text
presentation ──> application ──> domain
      │                 ▲
      └──> infrastructure ┘
```

- `domain` n'importe aucune bibliothèque web, ORM, agent ou observabilité.
- `application` ne dépend que du domaine et définit les ports nécessaires.
- `infrastructure` implémente ces ports. Un adaptateur n'en importe pas un autre.
- `presentation` traduit HTTP/UI vers les cas d'usage et compose les implémentations.
- La composition est le seul endroit autorisé à choisir SQLite, Phoenix ou un framework d'agent.

Le contrat `AgentAdapter` appartient à l'application. Pydantic AI et Vercel AI SDK seront deux
implémentations isolées sous `infrastructure/agents/<framework>/`. Le playground consommera le
même protocole d'API et le même modèle de capacités, quel que soit l'adaptateur sélectionné.

## Reproductibilité et écritures

Chaque session enregistre `seed`, `scenario_version` et `initial_state_hash`. Les futures données
générées doivent provenir exclusivement de ce contexte. Toute action modifiante reçoit une clé
d'idempotence. Les mises à jour de commande comparent une version attendue et incrémentent la
version atomiquement ; un conflit est exposé comme erreur métier, jamais écrasé silencieusement.
Les entités de domaine reçoivent leurs timestamps UTC explicitement : elles ne lisent jamais
l'horloge système par défaut. Le futur cas d'usage de scénario injectera son horloge à la
composition.

SQLite reste l'adaptateur local. Les identifiants, dates, nombres et JSON utilisent les types
SQLAlchemy portables. Les tests de migration couvrent une base vide et une base déjà existante.
