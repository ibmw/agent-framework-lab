# Repository instructions

Read `docs/architecture.md` before changing code and the relevant guideline/ADR for the task.

- Preserve the dependency rule: presentation/infrastructure -> application -> domain. Domain and
  application must not import FastAPI, SQLAlchemy, agent SDKs, Phoenix or Temporal.
- Treat `packages/contracts/openapi/v1/openapi.yaml` and tool schemas as versioned public contracts.
- Keep writes idempotent and order updates concurrency-safe. Never log or trace secrets or raw
  sensitive customer content.
- Add behavior-focused tests with every change. Use unit tests first, integration tests at I/O
  boundaries, and Playwright only for essential human journeys.
- Run `make check` before handoff; run `pnpm build` for frontend/build changes and `pnpm test:e2e`
  when a covered journey changes.
- Before starting, stopping or restarting a server, inspect ports 8000/5173 and reuse a healthy
  existing process. Do not change a developer-owned process without an identified reason.
- Before editing, confirm the work is on a short-lived branch created from an up-to-date `main`.
  Keep changes cohesive and do not mix future frameworks or phases into a task.

## Git commits

- Create commits only when the user explicitly requests or approves them.
- Keep every commit atomic, independently reviewable, and limited to one logical purpose.
- Use `<type>(<scope>): <imperative description>` with one of: `feat`, `fix`, `docs`, `chore`,
  `refactor`, `test`, `style`, `perf`, or `ci`. Omit the scope for cross-cutting changes.
- Keep required tests, contracts, migrations, and documentation with the behavior they support.
- Do not name `PLAN.md` steps or milestones in commit messages; describe the technical outcome.
- Never mention AI assistance or add AI/tool attribution, generation metadata, or trailers.
- Never amend, squash, rewrite, or force-push history without explicit user approval.

Use the project-local skills under `.codex/skills/` for Python backend, React frontend, agent
framework integration, and Git commit work.
