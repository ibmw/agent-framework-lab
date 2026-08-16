# ADR 0005 — Versioned replay context

Status: accepted — 2026-08-16

Every session persists a seed, scenario ID and version, policy-set version, and the initial-state
SHA-256 fingerprint defined by ADR 0007. A replay explicitly selects that registry entry instead of
using current logic. This makes demonstrations explainable and comparable; retaining historical
definitions is the accepted cost when a scenario evolves.
