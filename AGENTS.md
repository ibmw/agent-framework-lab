# Repository instructions

The application is the lab that `docs/product-direction.md` describes. What remains of the
original POC is listed at the end of `docs/architecture.md`: keep it working, never extend it, and
replace it only in a cohesive versioned slice.

Read `docs/architecture.md` for the layer you touch, plus the ADR or guideline the task cites.
`docs/product-direction.md` is for product-shaped changes; `docs/PLAN.md` and `docs/PLAN-UX.md`
hold open work only and are read when working from a plan. `docs/design-direction.md` holds the
design rules in force. `docs/history/` is read on demand and never by default.

- Preserve the dependency rule: presentation/infrastructure -> application -> domain. Domain and
  application must not import FastAPI, SQLAlchemy, agent SDKs, Phoenix or Temporal.
- Treat `packages/contracts/openapi/v1/openapi.yaml` and tool schemas as versioned public contracts.
- Treat the persona/scenario/conversation contracts as implemented POC contracts, not the target
  product model. Replace them only in a cohesive versioned slice with implementation, migration
  behavior, consumers, tests, and documentation together.
- Keep writes idempotent and order updates concurrency-safe. Never log or trace secrets or raw
  sensitive customer content.
- Add behavior-focused tests with every change; `docs/testing-strategy.md` says which kind.
- Run `make check` before handoff; `pnpm build` for frontend changes and `pnpm test:e2e` when a
  covered journey changes.
- Work on a short-lived branch from an up-to-date `main`. Keep changes cohesive and do not mix
  future frameworks or phases into a task.
- When a slice lands, remove it from its plan; the commit, ADR and tests are the record.
  Reasoning goes to an ADR or to `docs/history/`, never into a plan or a rules document.

## Git

- Create commits only when the user requests or approves them. The one standing exception is
  work-in-progress on a short-lived task branch, which is scaffolding for review and is
  collapsed before the branch lands.
- Conventional Commits, atomic, no `PLAN.md` step numbers, and never any AI attribution,
  generation metadata or trailers.
- `main` is linear: a branch lands by `git merge --ff-only`, never a merge commit.
- Never amend, squash, rewrite or force-push history that is on `main`, pushed, or held by
  anyone else. The full commit and landing procedure, including the supervised review loop, is
  the `create-git-commit` skill.

## Skills

The project skills live under `.codex/skills/` and are exposed to Claude Code through
`.claude/skills/`: `develop-python-backend`, `develop-react-frontend`,
`integrate-agent-framework`, `create-git-commit`. Each names the documents its task needs.
