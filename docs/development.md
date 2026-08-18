# Development

The project follows a trunk-based workflow: create a short-lived branch from an up-to-date `main`
before making changes, keep one coherent change and its tests together, then fast-forward it into
`main`. Do not work directly on `main` or combine multiple phases or frameworks on a long-lived
branch.

Recommended loop:

1. synchronize with `main` and create a short-lived branch;
2. write the behavior test closest to the rule;
3. implement without crossing architecture boundaries;
4. run targeted checks, then `make check`;
5. run Playwright only when an essential human journey changes;
6. integrate only with linear history and green CI.

Commits follow Conventional Commits and remain atomic. They never mention a `PLAN.md` step number,
an AI assistant, a generation tool, or an attribution trailer. Use the project-local
`create-git-commit` skill to prepare, split, or create commits, and create no commit without an
explicit user request or approval.

The `prek` hooks run Ruff, Pyright, Biome, and TypeScript without a server, real database, E2E test,
or network call. Before any development-server command, inspect ports 8000 and 5173 and reuse a
healthy stack. A restart must have an identified reason and be announced.

The Vite development server proxies same-origin `/api` requests to `http://localhost:8000`, matching
the production reverse-proxy shape. `VITE_API_BASE_URL` is optional and reserved for frontend build
environments that intentionally use a different API origin.
