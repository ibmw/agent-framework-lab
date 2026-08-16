# ADR 0001 — pnpm and uv monorepo

Status: accepted — 2026-08-16

The lab combines TypeScript and Python. pnpm workspaces manage the frontend and contracts, while the
uv workspace manages the API and Python tooling. Both lockfiles are versioned and CI consumes them
in frozen mode. This separation preserves each ecosystem's native workflow while providing common
root-level commands.
