# Frontend/backend boundaries

The frontend owns rendering, input, ephemeral view state, and HTTP transport. It never decides
whether an e-commerce action is allowed, reconstructs durable memory, or knows about agent SDKs.

The backend owns invariants, authorization, confirmation, idempotency, sessions, memory, and traces.
A domain refusal is computed on the backend even when the UI has already disabled the action.

Integration rules:

- consume only `/api/v1/...` from the frontend;
- isolate HTTP calls in adapters under `apps/web/src/api` when they are introduced;
- share schemas, never domain entities or SQLAlchemy models;
- generate TypeScript types from OpenAPI when the contract grows;
- keep assistant-ui as a presentation/runtime layer behind the lab's API adapter;
- mock the network with MSW in component tests; do not mock domain rules.
