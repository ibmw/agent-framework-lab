# Repository instructions

Read `docs/product-direction.md`, `docs/architecture.md`, and `docs/PLAN.md` before changing code,
plus the relevant guideline/ADR for the task. The plans (`docs/PLAN.md`, `docs/PLAN-UX.md`) hold
open work only, and `docs/design-direction.md` holds the design rules in force; how either was
reached is under `docs/history/`, read on demand and never by default. The running application
is a POC; do not extend its persona-first scenario model or treat the old Vercel milestone as
current direction unless a new roadmap slice explicitly requires it.

- Preserve the dependency rule: presentation/infrastructure -> application -> domain. Domain and
  application must not import FastAPI, SQLAlchemy, agent SDKs, Phoenix or Temporal.
- Treat `packages/contracts/openapi/v1/openapi.yaml` and tool schemas as versioned public contracts.
- Treat the current persona/scenario/conversation contracts as implemented POC contracts, not the
  target product model. Replace them only in a cohesive versioned slice with implementation,
  migration behavior, consumers, tests, and documentation together.
- Keep writes idempotent and order updates concurrency-safe. Never log or trace secrets or raw
  sensitive customer content.
- Add behavior-focused tests with every change. Use unit tests first, integration tests at I/O
  boundaries, and Playwright only for essential human journeys.
- Run `make check` before handoff; run `pnpm build` for frontend/build changes and `pnpm test:e2e`
  when a covered journey changes.
- Before starting, stopping or restarting a server, inspect ports 8000/5173 and reuse a healthy
  existing process. Do not change a developer-owned process without an identified reason.
- Ports 8001-8004 and 5174-5177 belong to Playwright, which starts and stops every one of them
  itself: the suite runs a whole stack per worker so that no two workers share a database. Never
  reuse or serve from them: anything found listening there is a leftover to remove, not a stack to
  adopt.
- Before editing, confirm the work is on a short-lived branch created from an up-to-date `main`.
  Keep changes cohesive and do not mix future frameworks or phases into a task.
- When a slice lands, remove it from the plan it came from; its commit, ADR and tests are the
  record. Reasoning goes to an ADR or to `docs/history/`, never into a plan or a rules document.

## Git commits

- Create commits only when the user explicitly requests or approves them, with one standing
  exception: work on a short-lived task branch is committed as it goes, so that a review can be
  handed one round of changes rather than a whole branch. Those commits are scaffolding.
- In the supervised loop, one implementor owns a slice from its first commit to its landing and
  commits on the task branch as it works. Each round of review fixes is **one commit** whose
  subject is `fixup: review round N`, never `fix:`, so that a fresh reviewer can be handed that
  round alone (`git diff <SHA the last reviewer saw>..HEAD`) and can tell a scaffolding round
  from a landed bug fix by the subject.
- Keep every commit atomic, independently reviewable, and limited to one logical purpose. That
  is a rule about what **lands**; an iteration commit on a task branch is exempt from it and
  does not survive to the main branch.
- Use `<type>(<scope>): <imperative description>` with one of: `feat`, `fix`, `docs`, `chore`,
  `refactor`, `test`, `style`, `perf`, or `ci`. Omit the scope for cross-cutting changes.
- Keep required tests, contracts, migrations, and documentation with the behavior they support.
- Do not name `PLAN.md` steps or milestones in commit messages; describe the technical outcome.
- Never mention AI assistance or add AI/tool attribution, generation metadata, or trailers.
- Collapse a task branch's iteration commits before landing it, so the main branch records the
  finished work and not how it was reached. The implementor that wrote the branch does this,
  because it is the one that knows which purposes the branch holds. Use `git reset --soft` onto
  the merge base and commit again: it moves the pointer without touching the working tree, so
  the tree that passed `make check` is the tree that lands. Prove it — `git diff <the branch
  tip you recorded> HEAD` must be empty — and record the tip in the report before resetting.
- The main branch is linear: a branch lands by `git merge --ff-only` and nothing else, never a
  merge commit. The implementor lands it; the supervisor then verifies with its own commands —
  the empty diff recomputed from the recorded tip, and the checks re-run on the main branch —
  before accepting the landing.
- Never amend, squash, rewrite, or force-push history without explicit user approval, outside
  that one case: a short-lived, unpushed task branch being cleaned immediately before it
  fast-forwards into the main branch. The main branch, any pushed branch, and anything another
  person or session may hold are immutable.

Use the project-local skills under `.codex/skills/` for Python backend, React frontend, agent
framework integration, and Git commit work.
