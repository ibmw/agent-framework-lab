# Ajouter un framework d'agent

1. Créer `infrastructure/agents/<framework>/` et n'y importer le SDK que localement.
2. Implémenter `AgentAdapter` sans étendre le contrat pour refléter une API propriétaire.
3. Mapper outils, messages, mémoire et sorties structurées vers les contrats versionnés du lab.
4. Déclarer uniquement les `AgentCapability` prouvées par un test d'intégration.
5. Tester succès, erreur transitoire/retry, refus métier, confirmation et reprise applicables.
6. Émettre les spans OpenTelemetry communs et vérifier le masquage des données sensibles.
7. Ajouter l'adaptateur au registre de composition et exposer son indisponibilité proprement.
8. Documenter dans un ADR les compromis, limitations et comportements réellement observés.

Un framework ne doit pas modifier le domaine, les routes publiques, le format de session ou l'UI.
Si une capacité n'existe pas, l'adaptateur la déclare absente ; il ne la simule pas silencieusement.
Comparer l'expérience développeur dans un compte-rendu factuel (code de glue, contraintes,
observabilité, erreurs), jamais dans un score global.
