# Architecture

## Minimal structure

```text
apps/
  api/                    FastAPI API and adapter composition
    src/capability_lab/
      domain/             entities, invariants, and e-commerce rules
      application/        use cases and ports
      infrastructure/     SQLAlchemy, configuration, traces, and agents
      presentation/       HTTP routes and schemas
    migrations/           portable Alembic history
  web/                    playground React/Vite
packages/
  contracts/              OpenAPI v1 contract and generated shared types
infra/
  phoenix/                future local observability configuration
docs/                     guidelines and ADRs
.codex/skills/            specialized project-local procedures
```

## Dependency rule

```text
presentation ──> application ──> domain
      │                 ▲
      └──> infrastructure ┘
```

- `domain` imports no web, ORM, agent, or observability library.
- `application` depends only on the domain and defines the required ports.
- `infrastructure` implements those ports. One adapter does not import another.
- `presentation` translates HTTP/UI interactions into use cases and composes implementations.
- Composition is the only layer allowed to select SQLite, Phoenix, or an agent framework.

The `AgentAdapter` contract belongs to the application. Pydantic AI and Vercel AI SDK will be
isolated implementations under `infrastructure/agents/<framework>/`. The playground will consume
the same API protocol and capability model regardless of the selected adapter.

## Reproducibility and writes

Every session records `seed`, scenario ID/version, policy-set version, and `initial_state_hash`. An
application registry retains historical definitions under `(scenario_id, scenario_version)`.
Future generated data must derive exclusively from that context, and its fingerprint follows the
canonical serialization in ADR 0007. Every modifying action receives an idempotency key. Order
updates compare an expected version and increment it atomically; a conflict is exposed as a domain
error and never silently overwritten. Domain entities receive their UTC timestamps explicitly and
never read the system clock by default. The future scenario use case will receive its clock through
composition.

SQLite remains the local adapter. Identifiers, dates, numbers, and JSON use portable SQLAlchemy
types. Migration tests cover both an empty database and a database with existing unmanaged state.
