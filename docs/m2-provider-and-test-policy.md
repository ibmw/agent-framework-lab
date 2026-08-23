# Historical POC policy — M2 retail support scenario and model

Status: implemented POC record; not the current product roadmap. See `docs/product-direction.md`
and ADR 0011 before adding scenarios, models, or agent frameworks.

## Selected scenario

Milestone 2 uses `retail-profile@v1` as a human-operated, τ³-inspired read-only support
scenario. The customer can ask the agent to identify the generated customer profile, inspect the
two-product sandbox catalog, and list the customer's paid order history. The scenario deliberately
has no modifying action, shipment promise, external τ³ dataset, simulator, or evaluator.

The framework-neutral tool contracts are `read_customer@v1`, `list_products@v1`, and
`list_customer_orders@v1`. Every tool is scoped to the generated session state; callers cannot
supply an arbitrary customer ID.

## Provider and models

- Provider: OpenAI through Pydantic AI's Responses API model adapter.
- Supported live model family/version: `gpt-5-mini` only for M2. Adding or changing a model is a
  reviewed configuration and evidence change, not an arbitrary environment override.
- Local credential: `AGENT_LAB_OPENAI_API_KEY`.
- Model setting: `AGENT_LAB_OPENAI_MODEL=gpt-5-mini` (the typed setting rejects other values).
- Required tests: Pydantic AI `TestModel` plus the lab's deterministic fake `AgentAdapter`. They
  make no network call and need no credential.

The fake and Pydantic AI adapters run through the same adapter-conformance suite. `TestModel` is an
SDK-owned deterministic model, while the fake proves that the common contract is not merely a
Pydantic AI facade.

## Live-test policy

Live smoke tests are separate and skipped unless `AGENT_LAB_RUN_LIVE_MODEL_TESTS=1` and
`AGENT_LAB_OPENAI_API_KEY` are both present. Run them explicitly with:

```shell
AGENT_LAB_RUN_LIVE_MODEL_TESTS=1 uv run pytest -m live_model
```

They are diagnostic only: a live result never replaces deterministic capability evidence and is
not part of `make check` or required CI. Do not print, log, record, or commit the credential.
