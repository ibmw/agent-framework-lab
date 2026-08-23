# ADR 0013 — Shop payload schema, publish gate, document persistence, and the Studio shell

Status: accepted — 2026-08-23

Implements `docs/PLAN.md` Milestone 1 Slice 2 under ADR 0011 and the lifecycle fixed by ADR 0012.
Records the first concrete definition payload (`shop-payload-v1`), the publish gate that separates
draft freedom from published completeness, the persistence shape for definition drafts and
versions, and the application shell that replaces the POC's persona-first navigation.

## Context

ADR 0012 fixed identifiers, the draft/published lifecycle, reference pinning, experiment
resolution, and the `sandbox-v1` boundary, and deliberately left every definition payload schema to
the slice that introduces it. The shop is the first such payload and the first target UI, so this
slice has to decide four things at once: what a shop contains, when it may be published, how it is
stored, and what the Studio looks like.

The design direction (`docs/design-direction.md`, revision "shop workspace and ticket model")
requires the shop to be the entry point of a commerce-admin workspace, with the product editor
acting on the shop draft and version chips surviving the admin skin.

## Decision

### `shop-payload-v1`

A shop payload is a typed domain aggregate (`capability_lab.domain.shop`), not JSON with a schema
bolted on:

- **Identity** — name, slug, locale, a non-empty currency list, and a non-empty support-channel
  list. Currencies and channels are closed enumerations, extended deliberately in code.
- **Products** — handle, title, description, status, category, option definitions, sellable
  variants, media references, typed attributes, and reviews.
- **Variants** — SKU, option-value pairs, availability, stock quantity, and an **optional** price.
- **Money** — an exact `Decimal` of at most two fractional digits plus a supported currency; never a
  binary float, serialized as a decimal string.
- **Typed attributes** — the first bounded set is `text`, `number`, `boolean`, `choice`, and
  `measurement`. A measurement must carry a unit, a choice must declare its choices and hold one of
  them, and other types may carry neither. This is the administrator-defined extension point;
  prices, variants, inventory, and status stay typed fields.
- **Ratings are derived**, never authored: the rating summary is computed from the product's
  reviews, so the two can never drift.
- **Support knowledge and commerce configuration** — FAQ entries, policy documents (typed by kind),
  payment methods, fulfilment methods, support guidelines, and named tone-of-voice guidelines with
  at most one default.

Media stores URL/reference metadata only; managed binary upload remains deferred.

The canonical document (`application/shop_payload.py`) is lossless and round-trips back into the
typed aggregate. It is serialized under the ADR 0007 rules, so a published version's
`content_fingerprint` is the SHA-256 of that canonical JSON and is stable across processes. Any
change to the document shape requires a new schema token.

This slice materializes no sandbox state, so `sandbox-v1` is unchanged: `state` stays empty and
only resolution identity, seed, and tool contracts are fingerprinted.

### Structural invariants versus the publish gate

Two different kinds of rule are deliberately separated:

- **Structural invariants** are enforced in dataclass construction and can never be true of a
  coherent shop — a negative price, a measurement without a unit, duplicate product handles,
  duplicate SKUs across the shop, two default tone-of-voice guidelines. Violating one is an error
  at every layer, including a draft write, and surfaces as HTTP 422 `shop_configuration_error`.
- **Publish-gate findings** (`validate_shop`) are completeness rules an author satisfies over time.
  Errors block publication — no product, an unpriced variant, a variant priced in a currency the
  shop does not sell, a variant whose option values do not match the product's options, an in-stock
  variant with no inventory, duplicate option combinations, no enabled payment method, no
  fulfilment method, no policy, no tone-of-voice guideline or none marked default. Warnings never
  block — an empty FAQ, a product without a description or media, no support guideline.

A draft may therefore be saved incomplete (that is what makes an editor usable); a published
version may not. Publication refusal answers 422 `shop_not_publishable` with the exact findings
rather than a bare status, so the UI shows what to fix.

### Publishing acts on the saved draft

Publication freezes what the server holds, so the workspace refuses to publish while it carries
unsaved edits and offers the save instead; it also refuses to mint a second version from content
identical to the latest published one (`matches_latest_published`). Neither rule is a server
invariant — an identical republish is a legal, if pointless, immutable version — but silently
freezing a stale draft would break the author's contract with the version chips.

A published version's stored document is re-fingerprinted on read and refused on mismatch, the way
generated-scenario reads already are: a published version is historical evidence, so serving content
that no longer hashes to its recorded fingerprint is worse than failing.

### Draft preview

`GET /shops/{id}/draft/preview` is the single publish gate for both the API and the UI. It returns
the validation findings, the content fingerprint the draft would freeze, the latest published
version, the next version number, whether the draft still matches the latest published version, and
a typed change summary (`summarize_shop_changes`) naming what publication would freeze — added
variants, added attributes, edited fields, per keyed collection. Each edit is reported exactly once:
products are diffed for membership only at the collection level, because a changed product is
already described by its own field-level and sub-entry diff. The summary is domain logic, not a UI
concern, so the same evidence is available to later slices.

### Persistence: one canonical document per draft and per version

Two tables arrive alongside the POC tables, for every definition type rather than for shops alone:

- `definition_drafts` — primary key `(definition_type, definition_id)`, plus the owning shop, the
  pinned-reference list, the canonical payload document, and timestamps.
- `definition_versions` — primary key `(definition_type, definition_id, version)`, plus the content
  fingerprint, the pinned shop scope, the reference list, the canonical payload document, and the
  publication timestamp.

The composite primary key **is** the ADR 0012 overwrite guard: a published version can only ever be
inserted, and the integrity error is translated into `PublishedVersionExistsError` instead of an
upsert. The migration's `downgrade` refuses to run while any published version exists, because
published versions are immutable historical evidence.

Storing the payload as one canonical document — rather than fifteen normalized catalog tables — is
chosen because a definition version is only ever read as a whole aggregate, because immutability is
then structural, and because every invariant is re-checked by the typed constructors on read. It is
not a licence to treat commerce state as free-form JSON: the sandbox commerce state that later
slices materialize is a separate concern with its own schema decisions.

### Public contract

Eight additive operations under `/api/v1/shops` cover list, create, read draft, replace draft,
preview draft, publish, list versions, and read one version. Every field of every shop schema is
required in the contract: a draft write sends the whole payload, and a response always carries every
key, so optional-by-default fields would only make the generated client types lie. Nullable-but-
required (`price`, `unit`, `average_rating`, `default_tone_of_voice_id`) expresses "absent" where
absence is meaningful.

Responses carry derived read-only evidence (`ratings`, `default_tone_of_voice_id`) that draft writes
must not echo back; the frontend strips it in one tested projection.

### Studio shell and the POC UI

The frontend adopts the selected direction's shop workspace: a pine top bar with the lab identity,
a shop switcher, and the synthetic-sandbox badge; a left resource sidebar with the shop's own
sections, a "Shop setup" group, and a cross-shop "Experiment lab" group whose not-yet-built entries
stay visible but inert; and index tables plus resource detail pages on neutral admin surfaces.
Draft and published state is never carried by colour alone — every chip pairs colour with a glyph
and a label.

The POC's persona-first UI (persona library, conversation, comparison, framework pages, and their
journeys) is **removed** in this slice rather than carried alongside the new shell. Its backend
routes, contracts, and tests remain, so the POC evidence is intact and Milestone 2 can build the
ticket and scenario surfaces on the target navigation instead of migrating two information
architectures.

## Verification

- Domain tests (`test_shop_domain.py`) cover money precision, typed-attribute rules, derived
  ratings, duplicate keys, the default-tone rule, every publish-gate error and warning, and the
  change summary.
- Serialization tests (`test_shop_payload.py`) prove the canonical document round-trips, is sorted
  and compact with decimal-string money, changes its fingerprint for every behaviourally relevant
  edit, declares its schema version, and reports the failing path for malformed stored documents.
- Service and repository tests (`test_shops.py`) prove that a published version never changes when
  the draft is edited, versions increase monotonically, the storage boundary refuses an overwrite,
  and published content survives a new session.
- Contract tests (`test_shop_api.py`) prove the publish refusal carries its findings, an unpriced
  variant keeps a draft saveable but blocks publication, and a published version reads back
  byte-identical after the draft moves on.
- Migration tests cover the new tables on a clean and an existing database, the overwrite guard at
  the SQL level, and the downgrade refusal.
- Frontend tests cover the derived-evidence projection and the workspace journey, including the
  refusal to publish unsaved edits, the refusal to republish identical content, and pricing a new
  variant in the shop's own currency; one Playwright journey publishes a shop with size/colour
  variants and reads the frozen version back.

## Consequences

- Milestone 1 Slice 3 (customer profiles and support identities) and Milestone 2 (tickets and
  scenarios) reuse `definition_drafts`/`definition_versions` and add their own payload schema and
  publish gate; only the payload codec and validation are per-type.
- The reference columns on both tables are unused by shops (a shop holds no references) and exist
  for the reference-bearing types that follow; the ADR 0012 same-shop re-check at the storage
  boundary lands with the first shop-scoped definition.
- Cross-shop slug uniqueness is deliberately not enforced; shops are identified by their definition
  UUID and the slug is content.
- Because the shop payload is one document, a future need to query across catalogs (for example a
  global product search) will require a projection rather than a join, and that projection must be
  derived from the published document rather than becoming a second source of truth.
- Existing local POC databases keep working: the migration only adds tables. Developers running a
  server before this change must run `make migrate` for the new endpoints to work.
- `PUT /shops/{id}/draft` is last-write-wins: it carries no expected version or `If-Match`. That is
  acceptable for the single local author this slice targets, but two browser tabs will silently
  overwrite each other. The first slice with a real concurrent-authoring requirement should add an
  expected-`updated_at` precondition in the same style as the existing idempotency keys.
- Variant prices are minted in the shop's own currencies, so a shop that stops selling a currency
  leaves already-priced variants failing `variant_currency_unsupported` at the publish gate rather
  than being silently repriced. That is the intended direction: repricing is an authoring decision.
