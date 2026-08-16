# ADR 0005 — Contexte de rejeu versionné

Statut : accepté — 2026-08-16

Chaque session persiste une graine, une version de scénario et l'empreinte SHA-256 de l'état
initial. Un rejeu sélectionne explicitement cette version au lieu de la logique courante. Cela rend
les démos explicables et comparables ; conserver les implémentations de scénarios historiques sera
le coût assumé lorsqu'un scénario évoluera.
