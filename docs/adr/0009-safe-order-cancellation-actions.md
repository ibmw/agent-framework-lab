# ADR 0009 — Safe order cancellation actions

Status: accepted — 2026-08-18

## Context

Milestone 3 needs one human-operated business-changing action without granting an agent model or UI
authority to mutate retail state. The action must preserve immutable scenario replay, bind consent to
the exact proposed command, survive duplicate requests, reject stale order versions, and expose
failures without framework-specific public types.

Adding cancellation behavior to `retail-profile@v1` would silently change an immutable read-only
scenario. Mutating its persisted order row would also invalidate the canonical initial-state hash if
the replay snapshot continued to read operational state directly.

## Decision

The lab adds `retail-order-cancellation@v1`, pinned to policy set `v2` and canonical schema `v1`.
Its deterministic initial state contains one paid order. The only modifying tool contract is
`cancel_order@v1`; policy permits a transition from `paid` to `cancelled`, increments the order
version exactly once, and refuses every other status.

Both available agent adapters map a framework-neutral action request to the same proposal draft.
They never execute it. The application validates the draft against the scoped session and current
order, then persists an exact proposal containing the tool name/version, order ID, and expected
version. Its confirmation token is the SHA-256 digest of canonical proposal identity fields. The
token is a binding value, not an authentication secret.

Confirmation/cancellation and execution are separate versioned HTTP commands. Confirmation must
return the exact proposal token. Execution requires the persisted `confirmed` state, uses an
`Idempotency-Key`, and updates the order with an expected-version predicate. A completed execution
is replayed without another update; a stale version returns a visible conflict. Transient writes
receive at most two safe in-request attempts with the same action identity. If both fail, the
proposal remains confirmed so the user can retry with the same execution key.

Generated-scenario order associations now store the immutable initial order snapshot. The existing
`orders` row remains operational state, so conversation tools see the cancellation while canonical
generation retrieval continues to verify and return the original paid-order fingerprint.

Common `agent.action.propose`, `agent.action.confirm`, `agent.action.cancel`, and
`agent.action.execute` spans record only allowlisted stage, tool/version, outcome, attempt, and
pseudonymized session attributes.

## Observed behavior and limitations

- Pydantic AI has no role in authorizing or committing the write. Keeping proposal mapping at its
  adapter boundary makes that limitation explicit and keeps both adapters semantically equivalent.
- Confirmation binding and safe retries are application-protocol guarantees, not framework
  capabilities, so the adapter capability vocabulary does not include them. The shared adapter
  suite proves only equivalent proposal mapping; application/API tests prove confirmation and
  retries.
- The UI deliberately makes confirmation and execution two visible user steps. It exposes proposal,
  confirmation, execution, cancellation, refusal, conflict, and retry states.
- A confirmed decision is immutable: the user may leave it unexecuted, but changing it to cancelled
  requires a new proposal against still-compatible order state.
- Deterministic generations with the same scenario version and seed share one operational order row.
  A cancellation from one session is therefore visible to other sessions over that generated state.
- Only order cancellation is supported. Payments, external commerce APIs, multi-action plans,
  autonomous execution, and durable workflow orchestration remain out of scope.
