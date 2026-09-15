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

## Local data

`make migrate` brings the local SQLite database at `var/agent-lab.db` to the current head. It creates
the schema and nothing else, and every screen of the Studio reads a chain that starts at a published
shop and ends at a run with evidence on it — so a freshly migrated database shows empty lists
everywhere.

`make seed` fills it with one complete example: the wrong-address incident, authored end to end and
driven to completion under both agent frameworks (ADR 0043). It writes a shop with a catalog, policies
and a voice, the customer and the order the incident is about, the published ticket and recipe, two
agent configurations differing only in the framework, a published judge, and one finished two-arm
experiment carrying tool calls, a fired fault, decided objectives, a judge verdict, measured cost, a
note and three tags. It goes through the same application services the API's routes call, so every
publish gate and the setup gate apply to it exactly as they apply to an operator.

The seed needs no credential and contacts no provider: both arms run their real framework adapters
against a double at each SDK's own model seam, so the run costs nothing and tells the same story with
the same timestamps and figures every time. It does use the process's configured telemetry, so if
`AGENT_LAB_OTEL_EXPORTER_OTLP_ENDPOINT` is set the demo's spans are exported to that collector like
any other run's — deliberately, so a local Phoenix has something in it too.

Because both arms follow one scripted incident, the demo shows two frameworks making the same
decisions, and the token counts and cost beside them are figures the two offline models reported
about themselves. They show that each framework's meter is wired through to the record and say
nothing about what either would spend on a real provider. The run says so itself: its label ends in
`(offline demo)`, it is tagged `offline-scripted`, and its first note spells it out. Keep that
qualification on the run if you re-author the seed's copy.

It refuses rather than merging. A database that is not at the migration head, or that holds any row
in a table the story writes — seeded before, or authored by hand — is left untouched, and the tables
that stopped it are named. To start again, delete the database file and run `make migrate` before
`make seed`:

```sh
rm -f var/agent-lab.db && make migrate && make seed
```

The same seed is a button, on `/settings` under *The fast path* (ADR 0047). It posts to
`/api/v1/lab-seed`, which awaits the function the command awaits and is subject to both refusals
unchanged, so a lab holding anything at all is declined with its occupied tables named and keeps
every row. Use whichever is in front of you; the command is what CI and `test_demo_seed.py` run.
The reset above stays a terminal operation — deleting a database file is not something a page
should offer — which makes it the thing to go looking for when the button refuses.

The same chain is what each screen's *Show me around* tour opens with: which link of the ten this
is, and what stays refused until the work here is done, composed from one table rather than written
per surface (ADR 0048). There is no page that lists all ten in one place (ADR 0049).
`/glossary` defines the vocabulary those steps use, reached by following a defined word in a
popover. The launch control is on every one of those screens, for everybody: there is no mode to
turn it on (ADR 0046).

`/settings` in the Studio reports what the running build is composed to do: the frameworks it has
proven it can run and the envelope each was proven inside, whether a provider credential is
configured and with which model, and whether traces are exported anywhere. It edits none of them.
The proven-framework table is a code constant deliberately kept apart from the machine, so that
what an author may publish does not change with where the Studio runs; the credential and the
exporter are read from the environment when the API starts. While no credential is configured the
page states what that means for what this lab can advance and for any comparison it holds
(ADR 0044).

The `prek` hooks run Ruff, Pyright, Biome, and TypeScript without a server, real database, E2E test,
or network call. Before any development-server command, inspect ports 8000 and 5173 and reuse a
healthy stack. A restart must have an identified reason and be announced.

The Vite development server proxies same-origin `/api` requests to `http://localhost:8000`, matching
the production reverse-proxy shape. `VITE_API_BASE_URL` is optional and reserved for frontend build
environments that intentionally use a different API origin.

## Two stacks

There are two stacks, and they never share a port or a database. The developer stack is the one
`make dev-api` and `make dev-web` bring up: the API on 8000, reading `.env` and so writing
`var/agent-lab.db`, and Vite on 5173 proxying to it. The E2E stack is the one `pnpm test:e2e`
brings up for itself, and it is one stack *per Playwright worker*: worker *n* gets the API on
`8001 + n` and Vite on `5174 + n`, each API migrated onto its own temporary SQLite file named for
the run and the worker under the system temporary directory, which the run's global teardown
removes along with any that a killed run left behind. The whole block 8001-8004 and 5174-5177 is
Playwright's, and a worker count of four is what `apps/web/tests/e2e/support/stack.ts` declares
(two in CI); `docs/testing-strategy.md` says why a worker owns a database rather than sharing one.

Playwright starts every one of those servers itself and reuses none, in CI and locally
alike. Reusing a server that answers on the expected port was how a local run came to drive the
developer's API — and write hundreds of rows into the developer's database — while still reporting
green, because the isolated database it had prepared was never the one being served. The case that
still bites is a Vite left on 5174 by someone who started it by hand against the API on 8000:
adopting that one reproduces the defect exactly, which is why the frontend refuses reuse as firmly
as the API does.

So a process left on any of those ports fails the run. Playwright's own message ends by offering
`reuseExistingServer: true` as the remedy; it is not one here, and taking it puts the defect back.
Find the leftover and kill it — `lsof -nP -iTCP:8001-8004 -iTCP:5174-5177 -sTCP:LISTEN` — and
leave the flag alone.
`apps/web/tests/config/e2e-isolation.test.ts` fails under `make check` if a server starts reusing,
moves onto a developer port, stops naming a temporary database, or shares one with another
worker.

Three variables carry the difference, all read from the environment by `apps/web/vite.config.ts`,
all defaulting to the developer stack so no development command needs them: `AGENT_LAB_WEB_PORT`
is the port Vite binds (strictly — an occupied port is an error, not a silent increment),
`AGENT_LAB_API_ORIGIN` is the origin it proxies `/api` to, and `AGENT_LAB_WEB_CACHE_DIR` is the
directory its dependency optimizer caches into, which each E2E worker's server needs to itself so
that four servers on one project do not re-optimize under each other. They are read from the
process environment, not from `.env`: Vite does not load that file when it evaluates its config,
and the API's settings ignore all three names, so writing them into `.env` does nothing. Export
them in the shell to use them by hand. `apps/web/playwright.config.ts` sets all three, alongside
the `AGENT_LAB_` settings that point each E2E API at its own temporary database, and an empty
`VITE_API_BASE_URL` so that a value exported in a developer's shell cannot send the E2E browser
past the proxy to another origin.

Run the suite with the developer stack up and nothing about it should move: same processes on 8000
and 5173, and `var/agent-lab.db` byte for byte as it was.
