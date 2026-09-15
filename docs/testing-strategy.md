# Testing strategy

Choose the fastest test that proves the behavior:

1. pure unit tests for domain invariants, definition versioning, sandbox resolution, scenarios,
   objectives, and application behavior with in-memory ports;
2. integration tests for FastAPI, SQLAlchemy adapters, migrations, tool contracts, and OpenTelemetry
   export;
3. React Testing Library tests with MSW for visible states and network failures;
4. Playwright only for essential human journeys involving authoring/publication, experiment start
   and resume, split-view interaction, or confirmed actions.

Unit tests depend on no server. Integration tests create temporary resources and document every
external dependency. Playwright starts its own API and frontend on their own ports and reuses
neither, locally as in CI, so a suite is never served by a developer's stack or writing to a
developer's database (`docs/development.md`). Initialize synthetic generators from the recorded
generation context, and use factory-boy to express relevant variants rather than hide asserted
values.

## One stack per Playwright worker

The suite runs `fullyParallel`, and it used to run every worker against one API process holding
one SQLite file. That made it untrustworthy rather than parallel. Every write in every journey
queued on that file's single writer lock, and a long write — an arm answering a turn, a judge
scoring one — could hold it past SQLite's busy timeout, so a request that was merely waiting came
back `database is locked`. The API answered 500, the Studio folded it into its error banner, and
the spec sat out its timeout waiting for a reply its arm had never been given. Three different
assertions in `experiment-start.spec.ts` failed that way on different runs; none of them had
anything to do with the code under test. The same shared database also let two workers starting in
the same millisecond mint the same `Date.now()` suffix and so the same shop slug.

So each worker now owns a whole stack: its own frontend, its own API, its own database file.
`apps/web/tests/e2e/support/stack.ts` declares how many and computes each one's ports and database
URL; `playwright.config.ts` declares that many servers; `apps/web/tests/e2e/support/e2e.ts` exports
the `test` that hands a worker the base URL of its own frontend. Workers cannot contend, and no
worker can see another's rows.

Two rules follow for anyone writing a spec:

- Take `test` and `expect` from `./support/e2e`, never from `@playwright/test`. The config names no
  `baseURL`, so a spec that imports the wrong one has none and fails on its first navigation.
  `tests/config/e2e-isolation.test.ts` fails first, by name.
- A worker's database is still shared by every spec that lands on that worker, one after another.
  So anything the lab makes globally unique — block names, support-identity and configuration
  names, the names a dropdown is selected by — still carries a per-spec suffix. Anything scoped to
  a shop (a ticket reference, an order reference, a customer) needs nothing, because each spec
  builds its own shop.

Two shapes of test carry more weight than their size suggests, and both are load-bearing (ADR 0023).
**Recorded fingerprints** pin the canonical serializer's bytes and the `sandbox-v2` and
`sandbox-state-v1` envelopes of one fixed, locally owned starting state; when one fails, answer
whether every starting state frozen before the change is now a different one before touching the
constant. **Registry-driven sweeps** parameterize over the published contract set rather than over a
list of names, with a sample-call table asserted to cover that set exactly and every sweep asserted
to be non-empty, so a newly published tool joins every shared invariant on the day it is declared.

Required agent-adapter suites use an injected deterministic test double and make no live-model call.
Provider smoke tests are optional, explicitly marked, credential-gated, and separate from
reproducible capability evidence in CI.

Every framework the lab can run an arm with is swept the same way the tools are (ADR 0041): the
runtime conformance suite, the runner's record-shape suite and the live smoke suite each assert
their table against `PROVEN_FRAMEWORKS`, so a framework declared publishable either joins all
three or fails them. What the sweeps hold constant is the *shape* of a framework's evidence — the
call vocabulary, the string arguments, the classified failures, the neutral usage, the stored
record — because what a comparison reads is the difference between two arms, and a difference in
shape would be a difference between two adapters.

`test_framework_comparison.py` is the one suite that runs an experiment rather than an adapter
(ADR 0042): two arms differing only in framework, driven through the whole wrong-address incident
and read through every surface the lab serves. Offline it can only hold the arms' *decisions*
identical — both follow one declared script through each SDK's own model seam — so what it proves
is that identical decisions leave identical evidence, that what each framework contributed is
separately attributable, and that neither arm's world or vocabulary reaches the other. Two models
choosing differently is what the credential-gated live suite is for, and no offline suite may be
read as having shown it.

LLM-judge integration tests use an injected deterministic judge. Live judge calls are optional and
credential-gated. Tests must prove that deterministic outcomes do not change when a judge fails or
is rerun, anonymized inputs omit framework labels, and every judge result records its configuration
and input fingerprint. Those three are held as properties rather than as examples (ADR 0040): the
failure sweep is over the port's own error classes and the recorded failure taxonomy, the anonymity
sweep is over `PROVEN_FRAMEWORKS` and runs an arm per declared framework, and "unchanged" is the
canonical bytes of every field of every rule-decided row rather than an equality over the fields
somebody chose. Each sweep asserts what it covered, for the reason every registry-driven sweep
does.

CI starts from a clean environment, installs from `uv.lock` and `pnpm-lock.yaml`, then runs lint,
formatting, type checking, tests, migrations, build, and E2E. Coverage helps identify gaps; no global
threshold replaces assertions about domain rules and advertised capabilities.
