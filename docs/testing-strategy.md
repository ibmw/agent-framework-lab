# Stratégie de tests

Choisir le test le plus rapide qui prouve le comportement :

1. tests unitaires purs pour invariants du domaine, persona, scénarios et application avec ports
   en mémoire ;
2. tests d'intégration pour FastAPI, adaptateurs SQLAlchemy, migrations, contrats d'outils et
   export OpenTelemetry ;
3. tests React Testing Library avec MSW pour les états visibles et erreurs réseau ;
4. Playwright uniquement pour les parcours humains essentiels de génération, reprise et action
   confirmée.

Les tests unitaires ne dépendent d'aucun serveur. Les tests d'intégration créent leurs ressources
temporaires et documentent toute dépendance externe. Playwright réutilise le serveur local s'il
répond déjà ; en CI il démarre une instance isolée. Faker doit être initialisé avec la graine de la
session et factory-boy sert à exprimer les variantes pertinentes, pas à masquer les valeurs testées.

La CI repart de zéro, installe depuis `uv.lock` et `pnpm-lock.yaml`, puis exécute lint, format,
type-check, tests, migrations, build et E2E. La couverture guide les lacunes ; aucun seuil global ne
remplace les assertions sur les règles métier et les capacités annoncées.
