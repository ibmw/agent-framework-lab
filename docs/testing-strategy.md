# Testing strategy

Choose the fastest test that proves the behavior:

1. pure unit tests for domain invariants, personas, scenarios, and application behavior with
   in-memory ports;
2. integration tests for FastAPI, SQLAlchemy adapters, migrations, tool contracts, and OpenTelemetry
   export;
3. React Testing Library tests with MSW for visible states and network failures;
4. Playwright only for essential human journeys involving generation, resume, or confirmed actions.

Unit tests depend on no server. Integration tests create temporary resources and document every
external dependency. Playwright reuses the local server when it already responds; in CI it starts an
isolated instance. Initialize Faker with the session seed, and use factory-boy to express relevant
variants rather than hide asserted values.

Required agent-adapter suites use an injected deterministic test double and make no live-model call.
Provider smoke tests are optional, explicitly marked, credential-gated, and separate from
reproducible capability evidence in CI.

CI starts from a clean environment, installs from `uv.lock` and `pnpm-lock.yaml`, then runs lint,
formatting, type checking, tests, migrations, build, and E2E. Coverage helps identify gaps; no global
threshold replaces assertions about domain rules and advertised capabilities.
