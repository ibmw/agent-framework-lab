# ADR 0001 — Monorepo pnpm et uv

Statut : accepté — 2026-08-16

Le laboratoire mélange TypeScript et Python. Les workspaces pnpm gèrent le frontend et les contrats,
le workspace uv gère l'API et les outils Python. Les deux lockfiles sont versionnés et la CI les
consomme en mode figé. Cette séparation garde les boucles natives tout en offrant des commandes
racine communes.
