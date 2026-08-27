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
external dependency. Playwright reuses the local server when it already responds; in CI it starts an
isolated instance. Initialize synthetic generators from the recorded generation context, and use
factory-boy to express relevant variants rather than hide asserted values.

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

LLM-judge integration tests use an injected deterministic judge. Live judge calls are optional and
credential-gated. Tests must prove that deterministic outcomes do not change when a judge fails or
is rerun, anonymized inputs omit framework labels, and every judge result records its configuration
and input fingerprint.

CI starts from a clean environment, installs from `uv.lock` and `pnpm-lock.yaml`, then runs lint,
formatting, type checking, tests, migrations, build, and E2E. Coverage helps identify gaps; no global
threshold replaces assertions about domain rules and advertised capabilities.
