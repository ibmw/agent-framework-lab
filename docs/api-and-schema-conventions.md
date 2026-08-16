# Conventions d'API et de schémas

- Préfixer les routes publiques avec `/api/v{major}`.
- Utiliser `snake_case` sur le fil et des noms métier stables.
- Donner un `operationId` explicite et unique à chaque opération.
- Valider entrées et sorties avec Pydantic ; refuser les champs inconnus pour les commandes métier.
- Représenter les dates en ISO 8601 UTC, l'argent par montant décimal et devise ISO 4217, et les
  identifiants par UUID textuel.
- Retourner une erreur structurée contenant `code`, `message`, `request_id` et éventuellement
  `details`; ne jamais exposer d'exception, de secret ou de prompt interne.
- Exiger `Idempotency-Key` pour toute commande modifiante rejouable.
- Utiliser `409 Conflict` pour une version de commande obsolète et `422` pour une entrée invalide.

La source publiée est `packages/contracts/openapi/v1/openapi.yaml`. Tout changement compatible
met à jour ce fichier et ses tests dans le même changement. Une rupture crée une nouvelle version
majeure de route et un ADR de migration ; elle ne modifie jamais silencieusement `v1`.
Régénérer le snapshot depuis l'application avec `make contracts`, puis relire les descriptions
humaines avant de valider le diff.

Les outils d'agent sont aussi des contrats versionnés. Leur nom inclut un namespace métier, leur
schéma possède une version documentée, et leur résultat distingue succès métier, refus et panne
technique. Un outil modifiant des données doit accepter une clé d'idempotence et une confirmation
préalable vérifiable.
