# Frontières frontend/backend

Le frontend gère l'affichage, la saisie, l'état éphémère de vue et le transport HTTP. Il ne décide
jamais si une action e-commerce est autorisée, ne reconstruit pas la mémoire durable et ne connaît
pas les SDK d'agents.

Le backend possède les invariants, autorisations, confirmations, idempotence, sessions, mémoire et
traces. Un refus métier est calculé côté backend même si l'UI avait déjà désactivé l'action.

Règles d'intégration :

- consommer uniquement `/api/v1/...` depuis le frontend ;
- isoler les appels HTTP dans des adaptateurs sous `apps/web/src/api` lors de leur création ;
- partager des schémas, jamais des entités de domaine ni des modèles SQLAlchemy ;
- générer les types TypeScript depuis l'OpenAPI quand le contrat grandira ;
- conserver assistant-ui comme couche de présentation/runtime, derrière l'adaptateur API du lab ;
- simuler le réseau avec MSW dans les tests de composants ; ne pas simuler les règles métier.
