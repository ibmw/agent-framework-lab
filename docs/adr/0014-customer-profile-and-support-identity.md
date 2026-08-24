# ADR 0014 — Customer-profile and support-identity payloads, data sensitivity, and the shared authoring lifecycle

Status: accepted — 2026-08-24

Implements `docs/PLAN.md` Milestone 1 Slice 3 under ADR 0011, the lifecycle fixed by ADR 0012, and
the payload pattern established by ADR 0013. Records two new payload schemas
(`customer-profile-payload-v1`, `support-identity-payload-v1`), the field-sensitivity
classification that keeps synthetic personal data out of logs and traces, the per-shop attachment
that scopes the Studio's customer list, and the extraction of the draft/published lifecycle that
ADR 0013 anticipated.

## Context

ADR 0013 delivered the first payload and predicted this slice: "Milestone 1 Slice 3 (customer
profiles and support identities) and Milestone 2 (tickets and scenarios) reuse
`definition_drafts`/`definition_versions` and add their own payload schema and publish gate; only
the payload codec and validation are per-type."

Two of the three shop-independent, reference-free definition types arrive together here, so this is
the point at which "only the codec is per-type" is either made true in code or abandoned. It also
introduces the first authored content that *looks* like personal data — names, addresses, phone
numbers — which the roadmap requires be clearly labelled synthetic and provably excluded from logs
and traces.

The design direction (`docs/design-direction.md`, frames 6 and 6b) additionally requires the
customer list to be scoped to a shop — "profiles attached to this shop" — while the profile itself
travels across shops. That relation has no home in ADR 0012's reference table.

## Decision

### `customer-profile-payload-v1`

A customer profile keeps four kinds of fact deliberately apart, because later slices treat them
very differently:

- **Personal facts** — `identity` (given name, family name, email, locale, optional phone),
  `account` (customer-since date, status, loyalty tier, marketing opt-in, notes), and `addresses`.
  These are what a support agent may legitimately discover through tools.
- **Address book** — named entries with a free-text label, recipient, street lines, postal code,
  city, optional region, an alpha-2 country code, and at most one default. The country is
  shape-checked (two uppercase letters), not validated against the ISO 3166-1 register — the same
  trade-off the locale rule already makes, and one to revisit when a rule depends on the country
  meaning something. ADR 0012's rule
  holds: an order selects an entry and keeps a frozen, source-labeled copy, so editing or removing
  an entry never rewrites an existing order, published scenario, or snapshot.
- **Behavioral persona** — a summary and up to twelve traits. It guides the operator and the future
  customer simulator and is never injected into the support agent's prompt: an agent that could
  read the persona would be evaluated against a script rather than against a customer.
- **Background and hidden facts** — `background` is authored fictional history that predates the
  sandbox (typed by kind, dated, with a note); `hidden_facts` are known to the customer side of a
  simulation only.

Shop-scoped commerce and support history — orders and tickets — is deliberately **not** part of the
profile. The design direction is explicit that history belongs to the shop and never travels with
the profile, so it arrives with the order and ticket editors in Milestone 2. `background` is the
profile-level equivalent: authored context that explains who the customer already is.

Dates are canonical `YYYY-MM-DD` strings, validated as real calendar days. ADR 0007 forbids
non-string canonical scalars for anything that is not an integer or boolean, and a profile's
"customer since" is a calendar date, not an instant.

### `support-identity-payload-v1`

A support identity carries `role` (name, title, remit), `permissions`, `guidance` notes, and an
`escalation` policy (target plus conditions).

**Tone of voice is deliberately absent.** `docs/PLAN.md` Slice 3 lists "role, tone, permissions, and
guidance", but ADR 0012 moved tone of voice to the shop, where a named guideline has one shop
default and an agent configuration selects the default or an override. Following the roadmap
literally would give a support identity a second, conflicting source of tone. ADR 0012 governs.

**Permissions are a closed enumeration**, not free-form strings, because the tool layer authorizes
against them: a permission that does not exist in code can never be granted by authored content.
The first set is `read_catalog`, `read_customer`, `read_orders`, `read_policies`, `cancel_order`,
`change_shipping_address`, `issue_refund`, `apply_discount`, and `escalate_to_human`.

### Publish gates

Structural invariants versus publish-gate findings are separated exactly as in ADR 0013: an
invariant that can never be true of a coherent definition is enforced in dataclass construction and
answers HTTP 422 (`customer_profile_configuration_error`, `support_identity_configuration_error`);
completeness rules an author satisfies over time are reported by `validate_*` and only block
publication.

Customer-profile errors: no address (orders select their shipping address from the address book, so
a published profile without one cannot be used), an address book with no default, and an empty
persona summary. Warnings: duplicate address labels (the order editor's picker becomes ambiguous),
a persona with no traits, and no authored background.

Support-identity errors: no permission at all; only mutation permissions, because an agent that
cannot look anything up cannot be audited against what it saw; an order mutation
(`cancel_order`, `change_shipping_address`, `issue_refund`) without `read_orders`, which would let
an agent act on an order it may not read; and escalation conditions with no named target.
Warnings: no guidance, and no escalation condition.

### Field sensitivity: what may reach a log or a span

`FIELD_SENSITIVITY` classifies **every leaf of the canonical document**, not a hand-picked subset:

- `SENSITIVE` — synthetic personal data (names, email, phone, address lines, account notes,
  background notes). Never logged, traced, or exported.
- `CUSTOMER_ONLY` — persona and hidden facts: simulation-side content the support agent must never
  see, and equally never logged.
- `OPERATIONAL` — non-identifying content (locale, country code, account status, loyalty tier,
  entry identifiers, dates, flags) that may appear in a span attribute or a log line.

Three things follow, and each is tested:

1. `telemetry_attributes` is the only customer-profile shape the lab may attach to a span or log
   line. It emits locale, account status, loyalty tier, opt-in, address and country counts, and
   persona/background/hidden-fact counts — derived values and counts only, so a trace can describe
   a profile without disclosing it. Nothing calls it yet: no span or log line names a profile in
   this slice, so it is a tested contract waiting for its first caller rather than live code. The
   slice that first traces a profile goes through it instead of assembling attributes ad hoc.
2. `restricted_values` collects every `SENSITIVE` and `CUSTOMER_ONLY` value of a payload, and a
   test asserts none of them appears in the emitted attributes.
3. A test asserts the classification's key set **equals** the document's leaf paths. A newly
   authored field therefore fails the suite until someone decides whether it may leave the
   authoring surface. This is the mechanism, not a convention.

The boundary is **telemetry and durable evidence, not the authoring surface**. A publish-gate
message and a change summary are read by the author who typed the content, so
`duplicate_address_label` naming the ambiguous label, and `Added address Home`, are helpful rather
than disclosures. What `restricted_values` governs is anything that outlives the session: log lines,
span attributes, and exported evidence.

Within that, messages still avoid echoing a value where naming the field is enough — a rejected
email reports "customer email must be an email address" and never the address itself, and a change
summary says `Updated identity email` rather than repeating the new address. That keeps the
low-value disclosures out even on the authoring surface.

### Shop attachment is not a definition reference

A customer profile is shop-independent (ADR 0012), but the Studio lists "profiles attached to this
shop" and Milestone 2 needs the same relation to scope a ticket's customer picker to same-shop
objects.

An attachment pins no version, never enters a content or sandbox fingerprint, and does not
participate in publish-time reference pinning. It is therefore **not** an ADR 0012 reference and
does not belong in `ALLOWED_REFERENCE_TARGETS`. It is a separate relation with its own port and its
own table, `definition_shop_attachments`, keyed `(definition_type, definition_id, shop_id)` and
constrained to the shop-independent types — a ticket or scenario already carries its owning shop on
the definition itself. The composite primary key makes attach idempotent at the storage boundary,
which matters because the Studio's "attach existing profile" control is a plain button.

Attaching — and creating a profile into a shop — validates that the shop exists and answers
`shop_not_found` otherwise. Attach stays idempotent even when it loses the insert race: the
composite primary key already guarantees the row, so an `IntegrityError` on flush is rolled back to
a savepoint and reported as success rather than a 500. Reading with an unknown `shop_id` filter is
deliberately *not* a 404 — it is a filter over attachments, and an empty list is the true answer. The table
deliberately carries no foreign key — that would make an unversioned relation look like a pinned
one — so the service performs the check itself through a narrow `ShopDirectory` port rather than
letting a mistyped identifier leave a dangling row for Milestone 2's same-shop pickers to filter.

Detaching removes the relation and never the profile: a profile is reusable, and its history in
another shop is that shop's own.

### The authoring lifecycle is extracted, not copied three times

`application/definition_authoring.py` now owns create/get/replace/preview/publish/list for every
shop-independent, reference-free definition type, and
`infrastructure.SqlAlchemyDefinitionRepository` owns the six statements behind them. Each type
supplies a `PayloadCodec` (document, from-document, fingerprint, validate, summarize-changes), an
error family so the HTTP layer can still name the refused resource
(`shop_not_found` versus `customer_profile_not_found`), and its own list projection.

Every operation on an unknown definition — reads, preview, attach, and **publish** — raises that
type's own `not_found`. The shared `MissingDraftError` belongs to reference resolution, which has no
resource of its own to name and answers the neutral `definition_draft_missing`; routing a publish
through it would have made an unknown customer profile answer `shop_not_found`.

Shops were migrated onto this core in the same slice rather than left as a fourth copy; their
public contract, behavior, and tests are unchanged. Shop-scoped types that pin references — tickets
and scenarios — extend `publish` with a reference-pinning step in Milestone 2 rather than copying
this one.

Three consequences of the extraction are contract-visible and deliberate:

- `ShopIssue`, `ShopValidation`, `ShopChange`, and their enums are now the shared
  `DefinitionIssue`/`DefinitionValidation`/`DefinitionChange` vocabulary in
  `domain/definitions.py`; `domain/shop.py` keeps the old names as aliases.
- The published contract renames four component schemas — `ShopIssueSchema`,
  `ShopChangeSchema`, `ShopVersionSummarySchema`, and the `ShopIssueSeverity`/`ShopChangeKind`
  enums — to their `Definition*` equivalents. Every field, value, and wire shape is identical; only
  the generated type names change, and the frontend was updated in the same change.
- Structural text rules (slug, label, text, email, phone, locale, country, date) live in
  `domain/content.py` and are bound per payload module with `functools.partial`, so each module
  keeps raising its own error type without restating the guards. `domain/shop.py` was migrated onto
  them in the same change, so there is one implementation rather than one per payload; its error
  messages and every test asserting them are unchanged.

### Public contract

Twelve additive operations under `/api/v1/customer-profiles` (list with an optional `shop_id`
filter, create, read draft, replace draft, preview, publish, list versions, read one version, list
attached shops, attach, detach) and eight under `/api/v1/support-identities` mirroring the shop's
eight.

As with shops, every field of every schema is required, and nullable-but-required (`phone`, `line2`,
`region`, `default_address_label`) expresses "absent" where absence is meaningful.

Every operation documents the contract's own `ErrorResponse` for the statuses it can answer, so no
route advertises FastAPI's default `HTTPValidationError` — a shape the application's handlers never
produce. A test asserts that across the whole published schema. Customer-profile
responses carry derived read-only evidence (`display_name`, `default_address_id`) that draft writes
must not echo back; the frontend strips it in one tested projection. A support identity carries no
derived evidence, so its content *is* its payload.

### Studio surfaces

Frame 6 (Customers) is the shop-scoped index: persona traits, address count with the default
label, attached-shop count, published provenance, plus "New customer" (created into this shop) and
"Attach existing profile".

Frame 6b (Customer editor) is the resource editor: identity, account facts, the address book with
per-entry editing, a "Make default" control that moves the single default rather than adding a
second one, the persona with removable trait chips, editable and removable background and
hidden-fact entries, the publish gate, the attached-shops card, and a freezing note. Every field the
payload persists is authored here, so nothing requires a raw API call to change.

A new address-book entry is authored, never seeded: the add form asks for street, postal code, city,
and country, defaulting the country from the profile's locale where the locale names a region. The
alternative — inserting a plausible placeholder address — would put fiction the author never wrote
into a definition that orders later freeze. Support identities have no dedicated frame and follow the
same shell conventions, with permissions grouped into Read and Act.

All three surfaces — the shop workspace included — share `useDefinitionEditor`, the frontend half of
the same generalization: load draft plus preview, edit locally, save the whole payload, refuse to
publish while unsaved edits are in the editor, then freeze. `canPublish` and `PublishReasons` are
likewise one definition of "may this draft be frozen", so a new resource cannot ship a weaker gate
than the shop's, and the button can never disagree with the explanation under it. The hook also
discards a save response that arrives after further typing, so an in-flight save cannot silently
overwrite newer edits. `ShopWorkspace` adds only what is
genuinely its own, the cross-shop list the top bar's switcher needs.

## Verification

- Domain tests (`test_customer_profile_domain.py`, `test_support_identity_domain.py`) cover the
  address-book invariants, the date and email rules, every publish-gate error and warning, the
  change summaries, the completeness of the sensitivity classification, and the absence of every
  restricted value from the telemetry attributes.
- Serialization tests (`test_definition_payloads.py`) prove both documents round-trip, are sorted
  and compact, preserve explicit nulls, declare their schema version, change their fingerprint for
  every behaviourally relevant edit — including reordering permissions, which is authored content
  and never silently normalized — and report the failing path for malformed stored documents.
- Service and repository tests (`test_customer_profiles.py`, `test_support_identities.py`) prove a
  published version never changes when the draft is edited, versions increase monotonically, the
  storage boundary refuses an overwrite, a drifted stored payload is refused on read, published
  content survives a new session, and attachment is idempotent, reversible, and scopes the listing
  without copying the profile.
- Contract tests (`test_customer_profile_api.py`, `test_support_identity_api.py`, and the shop's
  own) prove the publish refusals carry their findings, structural invariants answer their own error
  codes, derived evidence is rejected in a draft write, an unsupported permission is refused by the
  contract, a published version reads back byte-identical after the draft moves on, attaching to an
  unknown shop answers `shop_not_found` and leaves no attachment, and **every** operation on an
  unknown definition — including `POST .../versions` — answers that resource's own 404 code.
- Migration tests cover the new table on a clean and an existing database, the attachable-type
  check constraint, and the duplicate-attachment guard at the SQL level.
- Frontend tests cover both new workspaces: the shop-scoped listing (the stub honours `shop_id`, so
  a profile attached elsewhere is proven absent), the attach-existing picker, the publish gate on
  both resources, the refusal to publish unsaved edits, moving the default address, attaching to a
  second shop, granting a permission, publishing a clean draft, and an added address carrying what
  the author typed rather than a placeholder. `toProfilePayload` has its own unit test for the
  derived-evidence projection, matching the shop's. The pre-existing shop-workspace suite is
  unchanged and still passes after that workspace moved onto the shared editor. One Playwright journey publishes a customer profile
  with an address book and persona and shows the published version staying frozen as the draft
  moves to v2.

## Consequences

- Milestone 2's tickets and scenarios reference published customer-profile versions and scope their
  pickers through `definition_shop_attachments`; their own payloads and the reference-pinning
  publish step are the only new lifecycle code they need.
- Milestone 3's agent configurations reference a published support-identity version and read tone
  of voice from the shop, as ADR 0012 requires.
- `docs/PLAN.md` Slice 3's "tone" on the support identity is superseded by ADR 0012's shop-level
  tone of voice, and its "commerce/support history" is delivered as profile-level authored
  background, with shop-scoped order and ticket history deferred to Milestone 2 where the design
  direction places it.
- The `Definition*` contract renames are a one-time, wire-compatible break for any external consumer
  of the generated TypeScript names; there is none outside this repository today.
- `PUT /customer-profiles/{id}/draft` and `PUT /support-identities/{id}/draft` are last-write-wins,
  inheriting ADR 0013's decision and its caveat: two browser tabs silently overwrite each other, and
  the first slice with a real concurrent-authoring requirement should add an expected-`updated_at`
  precondition for all three resources at once.
- Existing local databases keep working: the migration only adds a table. Developers running a
  server before this change must run `make migrate` for the new endpoints to work.
- Address, background, hidden-fact, and guidance entry identifiers are derived from their label or
  title when the entry is created in the Studio, de-duplicated against the entries already present,
  and stable thereafter — so two entries may share a label while their IDs stay unique, and
  relabelling an entry does not orphan an order's frozen copy provenance.
  Nothing yet enforces that a deleted entry was not referenced by an order; that check belongs with
  the order editor in Milestone 2.
