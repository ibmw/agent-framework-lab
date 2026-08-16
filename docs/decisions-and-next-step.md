# Décisions, périmètre et prochaine étape

## Décisions prises

- Monorepo pnpm/uv avec deux lockfiles versionnés.
- Clean architecture pragmatique et contrat d'agent commun défini avant les SDK.
- SQLite + SQLAlchemy + Alembic, avec types et migrations portables vers PostgreSQL.
- OpenAPI v1 comme contrat publié et OpenTelemetry comme format de traces.
- Configuration typée au démarrage, exemples d'environnement sans secret.
- Concurrence optimiste des commandes et clés d'idempotence prévues dans les ports et le schéma.
- τ³-bench Retail comme inspiration pour les scénarios et politiques, adaptés et versionnés
  localement sans dépendance d'exécution initiale.
- Les bibliothèques frontend et de fixtures décidées dans la stack sont verrouillées dès les
  fondations pour valider leur compatibilité. Elles ne constituent pas une capacité livrée tant
  qu'aucun scénario et test ne les exercent. Les dépendances d'exécution OpenTelemetry attendront
  l'implémentation de l'adaptateur de traces.

## Explicitement reporté

Agent Pydantic AI, chat assistant-ui final, génération complète de personas, comparaison Vercel AI
SDK, runtime Temporal, PostgreSQL, Phoenix en exécution, simulation automatique et intégration
approfondie des datasets ou du harness τ³-bench.

## Prochaine tâche recommandée

Implémenter verticalement la génération déterministe d'une persona : cas d'usage pur piloté par
`seed` et `scenario_version`, repository client SQLite, endpoint v1, écran minimal, contrats et
tests unitaires/intégration/RTL. Cette tranche valide toutes les frontières sans introduire encore
de framework d'agent.
