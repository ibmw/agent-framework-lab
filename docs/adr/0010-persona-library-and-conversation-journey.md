# ADR 0010 — Persona library and conversation journey

Status: superseded as target product journey by ADR 0011 — 2026-08-23

This ADR remains an accurate record of the implemented POC routes and persistence behavior. Its
frontend was removed by ADR 0013 when the Studio shell replaced persona-first navigation; the HTTP
contracts it describes are still published and tested. New product work uses experiment-first
history and the authoring journey in `docs/product-direction.md`.

## Context

Milestone 3.5 makes every generated persona and support conversation reachable from the UI. Before
it, the playground kept only the single most recent session, in one `localStorage` key, and cleared
that key whenever a new persona was generated. All persona, conversation, and turn state was already
persisted, but no list endpoint surfaced it, and a conversation's opaque session id was recoverable
only from browser storage. The lab exists to compare how frameworks behave across runs, so losing
access to past runs undercut its purpose.

The work is a surfacing change. It must not alter deterministic generation, the canonical
initial-state fingerprint, or the framework-neutral public contracts, and it must not require a
database migration.

## Decision

Two read endpoints are added under the existing versioned prefix:

- `GET /api/v1/scenarios/generations` lists generated personas.
- `GET /api/v1/conversations` lists conversations, optionally filtered by a persona reference
  (`scenario_id`, `scenario_version`, `seed` supplied together; a partial filter is a validation
  error).

Both order by `(last_activity_at DESC, id DESC)`. `last_activity_at` is derived, not stored: a
conversation's is its latest turn time falling back to session creation; a persona's is the most
recent activity across its conversations falling back to generation time. This keeps an actively
resumed old run visible instead of buried by creation order. Page size is bounded (1–100).

Both lists use **offset pagination with a total count** (`page` / `page_size`, returning `total`)
so each UI can render Prev/Next and numbered pages and jump to an arbitrary page; the stable
secondary id key keeps the order deterministic under ties. Offset trades concurrent-write stability
(immaterial for a single-user lab) for the random page access the numbered controls need, and every
record stays reachable — the original motivation for paginating at all.

Both listings accept the same shape of optional filters. The persona library filters by scenario,
framework, and an `active_since` instant; the conversation history (already scoped to one persona)
filters by framework and `active_since`. The framework filter on the persona library has the one
semantics worth stating: it restricts to personas that have at least one conversation on that
framework, and the conversation count and activity then reflect only that framework (an inner join
to the per-framework aggregate); without it, personas with no conversations still appear.
`active_since` keeps records whose derived activity is at or after the given instant, surfaced in the
UI as relative windows (last hour through last year).

Conversations can be **hard-deleted** (`DELETE /api/v1/conversations/{id}`). Foreign keys are
enforced on SQLite, so the session's turns, memory records, and action proposals are removed before
the session row; the deterministic generated persona is untouched, so the same scenario and seed
still replay. A tombstone in the existing idempotency-record table preserves the deleted session
identity, preventing a delayed retry of the original start command from recreating it. The UI
confirms inline before deleting, clears a matching local fallback, and refetches the current page.

Generated personas can also be hard-deleted through the existing resource path
(`DELETE /api/v1/scenarios/{scenario_id}/versions/{scenario_version}/generations/{seed}`). The
delete runs as one unit of work: it removes every matching conversation graph first, then the
generated scenario links and aggregate, and finally identity, product, order, and customer rows that
are no longer referenced. Conversation tombstones remain, and a generated-scenario tombstone in the
existing idempotency table prevents delayed generation retries from recreating a persona the user
explicitly removed. The library confirms this destructive action inline and clears its conversation
fallback when it points into the deleted persona.

Listings return framework-neutral application read models — `GeneratedScenarioSummary` and
`ConversationSummary` — computed by the repositories with grouped subqueries, deliberately not by
reconstructing the heavier generated aggregate. Pydantic response models map from those read models
and stay presentation-only. The persona summary omits the persona email; the full persona endpoint
already provides it for the detail view.

Multiple conversations per persona require no schema change: a session's identity is
`uuid5(idempotency_key)`, and no uniqueness ties a persona to one session. The client supplies a
retained command id in the idempotency key when the user starts a new conversation — generated once
at initiation and reused across retries — so a retried start recovers the committed session instead
of duplicating it. "Resume" is navigation to an existing session id; "new conversation" mints a
fresh one.

The journey becomes URL-addressable with React Router: a persona library, a per-persona view listing
its conversations, and the conversation view. Route parameters are the source of truth; `localStorage`
is only a fallback default. The conversation view verifies that its loaded conversation belongs to
the persona reference in the route and rejects mismatched URLs.

## Observed behavior and limitations

- The listing API is global: it has no owner scoping and returns every persona and conversation in
  the database. This is acceptable for a single-user local lab and is explicitly **not tenant-safe**.
  Introducing authentication or multi-user scoping is deferred and would change these endpoints.
- Activity ordering and conversation counts are computed per request from turns and sessions; there
  is no denormalized `last_activity_at` column to keep in sync.
- Offset paging orders by `(last_activity_at, id)`; the secondary id key breaks ties when two rows
  share an activity timestamp, so page numbers stay stable. A row inserted while paging can shift
  items across a page boundary — acceptable for a single-user lab.
- Persona and conversation deletion are hard deletes with no undo. Archiving and cross-persona
  search remain out of scope.
