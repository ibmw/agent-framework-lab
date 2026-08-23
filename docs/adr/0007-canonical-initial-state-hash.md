# ADR 0007 — Canonical initial-state fingerprint

Status: accepted — 2026-08-16

Amendment: 2026-08-16 — Defined the concrete `v1` canonical fields and collection semantics.

Amendment: 2026-08-23 — The concrete schema below remains authoritative for POC replay only. The
Simulation Studio requires a new canonical schema version covering its resolved sandbox; ADR 0011
retains the canonical-fingerprint principle but does not extend `v1` implicitly.

## Context

Replaying a generated sandbox requires more than storing a seed. The lab must detect whether two
executions produced exactly the same scenario-relevant initial state across Python processes,
database round trips, and future implementations. Hashing an ORM model or an incidental Pydantic
dump would make the fingerprint depend on field order, serializer defaults, or local formatting.

## Decision

`initial_state_hash` is the lowercase hexadecimal SHA-256 digest of the UTF-8 bytes of one canonical
JSON document. Generation builds this document at the application boundary before persistence; ORM
rows and public response serialization are not hash inputs.

The canonical document has this versioned envelope:

```json
{
  "canonical_schema_version": "v1",
  "scenario": {
    "id": "retail-profile",
    "version": "v1",
    "policy_set_version": "v1"
  },
  "seed": 1234,
  "persona": {},
  "customer": {},
  "products": [],
  "orders": []
}
```

The concrete `v1` fields are:

- `persona`: `id`, `display_name`, `email`, `locale`, and `support_traits`;
- `customer`: `id`, `email`, `display_name`, and `created_at`;
- each product: `id`, `sku`, `name`, `price_amount`, and `currency`;
- each order: `id`, `customer_id`, `created_at`, `status`, and `version`.

Every field that can change scenario behavior belongs in this document. Persona support traits are
set-like in `v1` and serialize in Unicode code-point order. Products and orders serialize by their
stable ID. No other array order is behaviorally meaningful in this schema.

Canonical serialization follows these rules:

- encode UTF-8 without a byte-order mark;
- normalize every string to Unicode NFC, emit non-ASCII code points directly, and escape only
  characters required by JSON;
- sort object keys by Unicode code point and use JSON separators `,` and `:` without insignificant
  whitespace;
- use the schema to decide field presence; do not interchange an omitted field and explicit `null`;
- represent UUIDs as lowercase hyphenated strings;
- represent money as decimal strings with exactly two fractional digits and the currency as a
  separate uppercase ISO 4217 string;
- represent timestamps as UTC RFC 3339 strings with exactly six fractional digits and a trailing
  `Z`;
- forbid binary floating-point values in canonical state;
- represent integers in base 10 without a plus sign or leading zeroes, except the value zero;
- serialize enums by their stable string value;
- order products and orders by their stable deterministic ID before serialization; preserve array
  order only when the schema declares it behaviorally meaningful;
- derive every included identifier and scenario timestamp deterministically from the scenario
  definition and seed.

The Python reference serialization is `json.dumps(payload, sort_keys=True, separators=(",", ":"),
ensure_ascii=False, allow_nan=False).encode("utf-8")` after recursive NFC normalization and schema
normalization of UUID, decimal, timestamp, enum, and collection values. Other implementations must
produce the same bytes; they do not need to use Python.

The document excludes the hash itself, database row order, ORM metadata, request/trace IDs, the
conversation session ID, persistence timestamps, and the operational timestamp recording when the
generation request ran. Those values do not define the fictional starting state.

Changing the envelope, field-presence rules, normalization rules, or behavioral content requires a
new `canonical_schema_version`. Changing scenario fixtures or policies requires a new scenario or
policy-set version even when the canonical schema remains `v1`.

## Verification

Milestone 1 tests must prove:

- the same scenario registry key, policy-set version, and seed produce byte-identical canonical JSON
  and the same digest in separate generation calls;
- map insertion order and database retrieval order cannot change the digest;
- a behaviorally relevant field change changes the digest;
- unsupported values such as floats, naive timestamps, or nondeterministic identifiers are rejected;
- persisted state can be reconstructed, canonicalized, and verified against the recorded digest.

## Consequences

The lab owns a small canonical serializer and a versioned initial-state DTO instead of hashing
framework objects directly. This adds an explicit compatibility boundary, but it makes replay drift
diagnosable and allows future adapters or storage engines to verify the same state independently.
