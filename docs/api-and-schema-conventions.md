# API and schema conventions

- Prefix public routes with `/api/v{major}`.
- Use `snake_case` on the wire and stable domain names.
- Give every operation an explicit, unique `operationId`.
- Validate inputs and outputs with Pydantic; reject unknown fields in domain commands.
- Represent dates as ISO 8601 UTC, money as a decimal amount plus ISO 4217 currency, and identifiers
  as textual UUIDs.
- Return structured errors containing `code`, `message`, `request_id`, and optional `details`; never
  expose exceptions, secrets, or internal prompts.
- Require `Idempotency-Key` for every replayable modifying command.
- Use `409 Conflict` for a stale command version and `422` for invalid input.

The published source is `packages/contracts/openapi/v1/openapi.yaml`. Every compatible change
updates that file and its tests in the same change. A breaking change creates a new major route
version and a migration ADR; it never silently changes `v1`. Regenerate the snapshot from the
application with `make contracts`, then review human-authored descriptions before accepting the
diff.

Agent tools are versioned contracts as well. Their names include a domain namespace, their schemas
have documented versions, and their results distinguish domain success, refusal, and technical
failure. A data-modifying tool must accept an idempotency key and verifiable prior confirmation. One
value may serve as both when the lab issues it: a confirmation that is the hash of the proposed
change names exactly one change and can be applied exactly once, and a key the caller chose could
collapse two different changes into one (ADR 0022). A tool call reports its own outcome in the
result: a refusal — including a write refused because the world moved under it — answers 200 with
`outcome: "refused"`, and the HTTP status says only whether the tool ran.
