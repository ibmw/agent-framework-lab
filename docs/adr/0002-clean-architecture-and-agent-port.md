# ADR 0002 — Clean architecture et port d'agent

Statut : accepté — 2026-08-16

Le domaine et l'application restent indépendants des frameworks. Les repositories et
`AgentAdapter` sont des ports d'application, implémentés sous infrastructure. Ce choix ajoute un
petit coût de mapping mais permet de comparer Pydantic AI et Vercel AI SDK sans réécrire le
playground ou les règles e-commerce.
