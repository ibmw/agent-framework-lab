# Développement

Le projet suit un flux trunk-based : une branche courte créée depuis un `main` à jour avant toute
modification, une évolution cohérente et ses tests dans le même changement, puis intégration
fast-forward sur `main`. Ne pas travailler directement sur `main`, ni regrouper plusieurs phases ou
frameworks sur une branche longue.

Boucle recommandée :

1. synchroniser depuis `main` et créer une branche courte ;
2. écrire le test comportemental le plus proche de la règle ;
3. implémenter sans franchir les frontières d'architecture ;
4. exécuter les vérifications ciblées, puis `make check` ;
5. lancer le parcours Playwright seulement si un parcours humain essentiel change ;
6. intégrer uniquement avec un historique linéaire et une CI verte.

Les commits suivent Conventional Commits et restent atomiques. Ils ne mentionnent jamais un numéro
d'étape de `PLAN.md`, un assistant IA, un outil de génération ou un trailer d'attribution. Utiliser
le skill project-local `create-git-commit` pour préparer, découper ou créer des commits, et ne créer
aucun commit sans demande ou approbation explicite de l'utilisateur.

Les hooks `prek` lancent Ruff, Pyright, Biome et TypeScript, sans serveur, base réelle, test E2E ou
appel réseau. Avant toute commande de développement, tester d'abord les ports 8000 et 5173 et
réutiliser une stack saine. Un redémarrage doit avoir une cause identifiée et être annoncé.
