# ADR 0016 — Tickets: the first shop-scoped definition, and the trigger every arm receives

Status: accepted, partially superseded by ADR 0073 (*The helpdesk workspace*) — 2026-08-24

Implements the ticket half of `docs/PLAN.md` Milestone 2's second outcome under ADR 0011, the
lifecycle fixed by ADR 0012, and the payload pattern established by ADR 0013 and generalized by
ADR 0014. Records the `ticket-payload-v1` schema, the decision that a ticket **is** a versioned
definition where the order fixture beside it is not, the split between prior history and the
triggering first message, the minimal origin reference, and the extension of the shared authoring
lifecycle to shop-scoped types that pin references.

The scenario recipe built on top of a ticket is deliberately **not** in this ADR; see
"Deliberately not here" below.

## Context

Milestone 2 needs the wrong-address incident to be authorable end to end. ADR 0015 delivered the
order fixture; what is still missing is the incident itself — the channel, the page the customer was
on, the conversation that came before, and the exact first message a comparison sends to both arms.

ADR 0012 already fixed the model: a ticket is a shop-scoped definition referencing exactly one
customer profile. Nothing had implemented that half of the lifecycle. Every definition shipped so
far (shop, customer profile, support identity) is shop-independent and reference-free, so
`DefinitionAuthoringService.publish` passed `pinned_scope=None, pinned_references=()` and the
repository wrote `shop_id=None, references=[]`. The ticket is the first type for which those are
real values.

## Decision

### A ticket is a definition; an order fixture is not

ADR 0015 argued an order is authored state rather than a definition: a run mutates it, and frame 2b
shows `Save`, not `Publish`. A ticket is the opposite case and gets the opposite answer. Its content
is the recipe's opening move, and **both arms must receive a byte-identical trigger** — which is
precisely what an immutable published version guarantees. Frame 3 agrees: the ticket header carries
`ticket v1 · frozen by scenario v1`.

So a ticket has drafts, published versions, and a publish gate; an order fixture has none of those
and is frozen by copy when a scenario publishes.

### The shop-scoped half of the lifecycle, implemented once

`DefinitionAuthoringService` now covers both halves of ADR 0012 rather than growing a parallel
service:

- **The owning shop is fixed at creation and never moves.** A shop-scoped definition names same-shop
  objects throughout its content, so relocating it would strand every one of them.
- **References are derived from the payload, not tracked beside it.** `PayloadCodec` gained a
  `references` callable; the ticket's returns its `customer_profile_id`. Two sources for one fact
  would eventually disagree, and a draft could hold a reference its content no longer makes. Every
  draft write re-derives them; the scope, being identity, is never rewritten.
- **Publishing pins the shop version and every reference version** through a new
  `PublishedVersionDirectory` port. Publishing a ticket has to pin its shop and its customer profile,
  and neither shares the ticket's payload type; only the version provenance is needed, so the port
  reads a version row without a codec instead of forcing the caller to hold three typed repositories.
  A target with no published version raises the existing `UnpublishedReferenceError`
  (`definition_reference_unpublished`, 422) rather than freezing a dangling pointer.
- **What a publication must pin is part of the gate, not only of the pin step.**
  `TicketAuthoringContext` carries `shop_published` and `customer_published`, and a target
  with no version yields a `shop_unpublished` / `customer_profile_unpublished` error. Without
  them an author whose customer profile is still a draft would read "no validation findings",
  click Publish, and get a 422 — the exact split this ADR argues against. `_pin` keeps its own
  refusal: the gate reads current state, the pin runs inside the write, and only the second one
  can see a version that went away in between.
- **The publish gate became an overridable service hook.** `PayloadCodec.validate` stays the rules a
  payload can be judged on alone; `DefinitionAuthoringService._validate(record)` is what the preview
  and the publish gate both call. The ticket overrides it and validates against its shop, so the
  findings an author reads and the rules that refuse publication can never be two different sets.
  The domain splits accordingly: `validate_ticket_content` holds the shop-independent rules and
  `validate_ticket` adds the shop's answers.

No migration: `definition_drafts` and `definition_versions` already carry `shop_id`, `shop_version`,
and `references` from the ADR 0012 lifecycle migration. This slice starts writing them.

### `ticket-payload-v1`

`reference` (a shop-unique business identifier such as `T-204`, not a UUID), `subject`,
`customer_profile_id`, `channel`, `status`, `origin`, `tags`, `history`, `trigger`,
`linked_order_ids`, and `suggested_documents`.

**The owning shop is not in the document.** A shop is the ticket's scope, not its content: the draft
record carries it and the published version pins the exact shop version beside the fingerprint. Two
identical incidents authored in two shops therefore hash alike, and it is the published version —
not the payload — that says which catalog they belong to.

Instants are canonical UTC RFC 3339 with six fractional digits, matching ADR 0007 and ADR 0015. The
HTTP layer reuses the order contract's `AwareTimestamp`: a naive value is refused rather than assumed
to be UTC.

`reference` reuses the order's pattern. `require_order_reference` and the ticket's guard now share
`require_business_reference` in `domain/content.py`; one regex, two callers.

### History and trigger are separate fields

`history` is the prior conversation and `trigger` is the single message every arm receives at
experiment start. They are separate fields rather than one flagged list because they have different
lifetimes: history is context an agent may read, while the trigger is the one input a comparison
holds identical across arms. The frame's ticket list shows `No first message yet` for a ticket
without one — a real draft state, which the codec preserves as an explicit null.

Two rules follow, and both are structural rather than cosmetic:

- **The trigger comes from the customer.** A trigger authored as a support agent is refused in the
  domain (`ticket_configuration_error`), because a trigger *is* what the customer says to open the
  incident.
- **The trigger is the newest message.** A trigger older than the history it opens is a publish-gate
  error (`trigger_precedes_history`): the history it is supposed to open already answers it.

The editor never builds either state. The composer appends a message, and a customer message newer
than everything else becomes the trigger while the previous one falls back into history.

A trigger-only ticket is fully publishable — the frame shows the trigger even when it is the only
message.

### The origin is a minimal resource reference

`origin` is `kind` (`product_page`, `order_page`, `checkout`, `faq`, `support_entry`) plus at most one
target. Minimal on purpose: the agent resolves "this product" or "this order" through tools, so the
ticket carries an identifier and never an embedded copy of the resource.

- A **product** is named by its catalog handle, the shop's own key for it.
- An **order** is named by its stable identifier rather than its reference, because an author may
  rename an order's reference and a renamed order is still the same order.

A *contradictory* origin — an order-page origin that also names a product — is a domain refusal: it
is structurally impossible, not incomplete. A *missing* target is a publish-gate error instead, so a
draft may sit incomplete between picking the page and picking the resource. An origin that names
nothing at all (`checkout`, `faq`, `support_entry`) is a legitimate incident and publishes cleanly.

### An unresolvable reference is an error, not drift

ADR 0015 reported a removed source address as a *warning*, because the order keeps a frozen copy and
nothing is broken. A ticket carries no frozen copy of an order — it holds an identifier the sandbox
resolves — so the same event is an error here:
`origin_product_missing_from_catalog`, `linked_order_missing_from_shop`, and
`linked_order_of_another_customer` all block publication. The last one is a scoping rule, not
bookkeeping: a ticket may only show the agent its own customer's orders.

`channel_not_offered_by_shop` blocks too. A ticket's channel *is* the shop's channel — the same
`SupportChannel` enum — and a run could not receive a ticket on a channel the shop does not offer.

Suggested documents are the exception, and warn:
`suggested_document_missing_from_shop`. A suggestion pre-fills the context documents of a scenario
built on this ticket; it never enters the sandbox, so a stale one should not block freezing an
incident that is otherwise fine.

The remaining warnings are `ticket_without_resource_reference` (the incident points at no shop object
at all, so the agent has nothing to resolve from it) and `ticket_without_suggested_document` (a
scenario built on this ticket would start with no context documents).

### No transition graph for a ticket's status

An order has two forward-only status axes because money and goods move in one direction. A ticket is
reopened all the time, and a fixture authored after the fact may legitimately record either state, so
`open`/`resolved` is a plain enum. A resolved ticket is publishable: the frames show resolved tickets
as the prior context of a customer.

### The customer is fixed at creation

`create_ticket` validates that the profile is attached to the shop; `replace_ticket` refuses a
different customer (`ticket_customer_error`). The linked orders, the origin, and the prior
conversation are all that customer's, so moving the ticket would leave every one of them pointing at
somebody else's incident. Delete and recreate is the honest path — the same rule ADR 0015 made for an
order's customer. The customer is not even on the wire for a draft write: the response carries it as
derived evidence, and the request has no field a client could set.

### No delete

An order fixture can be deleted; a ticket cannot. ADR 0012 makes published versions immutable
forever, and a published ticket version is what a scenario pins — deleting one would destroy the
evidence a historical experiment is explained by. A ticket that turns out to be wrong is superseded
by publishing a new version.

### Data sensitivity

`FIELD_SENSITIVITY` classifies every leaf of the document, and a test asserts the classification's key
set equals the document's leaf paths, so a newly authored field fails the suite until someone decides
whether it may leave the authoring surface. Selected identifiers — channel, status, origin kind,
handles, order IDs, tags, document IDs — are `OPERATIONAL`: they name shop configuration, not a
person. What a human wrote in their own words about this incident is `SENSITIVE`: the `subject` and
every message `body`. `telemetry_attributes` emits the reference, channel, status, origin kind, and
counts only, and a test asserts no restricted value appears in it.

### Public contract

Nine operations under `/api/v1/shops/{shop_id}/tickets`: list, create, read/replace/preview the draft,
publish, list versions, read one version, and read the ticket's context.

The context endpoint answers what the helpdesk workspace shows beside the thread and the ticket never
stores: the customer, the linked orders as they read right now, this customer's other tickets in this
shop, and the exact same-shop resources a picker may offer. Derived on every read rather than stored —
all of it lives elsewhere and would go stale the moment it changed. Orders in the pickers are already
filtered to this ticket's customer: a picker that offered somebody else's order would be offering a
publish-gate error.

A published ticket version response names both pins explicitly — `shop_version` and
`customer_profile_version` — because "which catalog and which customer was this frozen against" is the
question a reproducibility claim rests on.

### The editor holds only threads the lab would take

ADR 0015 made the order editor hold only values the contract accepts, so the totals on screen
always describe an order the lab would take. The thread composer follows the same rule, which
takes two things:

- **A message that would break the trigger rule is refused, not saved.** The backend needs the
  trigger *strictly* newer than every history message, and the composer's `datetime-local` input
  has minute precision, so an exact tie is easy to type. `appendMessage` returns either the new
  thread or a reason, and the composer shows the reason and keeps the draft text so the moment
  can be corrected. A past support reply dated after the trigger is refused by the same rule —
  a recorded agent answering the triggering message means the incident is already handled.
- **The client normalizes an authored instant to the canonical six-digit form.** Thread order is
  decided by comparing these strings on both sides of the wire, and `"…00.000Z" > "…00.000000Z"`
  lexicographically. Without normalizing, a browser-authored message at *exactly* the stored
  trigger's moment sorts as newer, quietly takes its place, and the demoted trigger then ties
  with it once the backend canonicalizes both — reintroducing `trigger_precedes_history` through
  the back door. Normalizing first makes the comparison mean the moment rather than the
  punctuation.

A linked order the shop can no longer resolve is likewise kept removable. It renders as its own
row with an Unlink control rather than only as a checkbox in the resolvable list, because a
deleted or reassigned order blocks publication and would otherwise leave the author reading a
finding with no affordance to act on it.

### The helpdesk workspace

Superseded by ADR 0073 as to the anatomy: Tickets are an index, a create page and an editor. The
composer still authors history, and the two paragraphs on the shell and the rail stand.

Frame 3's three-pane anatomy: ticket list, conversation thread, context panel. The thread renders
every fixture message as a chat bubble with the prior-history divider and the badged trigger, and the
composer authors **history** with a role switch (as the customer, as a past support agent) — live
replies happen on the Bench, one independent thread per arm.

The shell also had to start owning the viewport. It was sized `min-h-screen` and let the page do the
scrolling, so a section taller than the window stretched the rail down the document and parked its
bottom control below the fold — the collapse control read as missing on exactly the longest sections,
which are the ones most in need of the room. The shell is now `h-screen`, the rail and the content
pane scroll independently, and the rail's own control sits in a non-scrolling footer so it stays on
screen even when the entries themselves overflow.

The rail collapses to icons **only when the author asks**. An earlier version folded the rail automatically on the ticket
routes to give the context panel room; that made one shared control mean different things depending
on which section you had navigated to, and an author who had never collapsed the menu arrived to find
it collapsed. The rail is one component for every section, it starts expanded everywhere, and the
toggle is the only thing that changes it. The collapsed state stays first-class: every label survives
as an accessible name.

## Deliberately not here

The **scenario recipe** — hidden facts, context documents, bound objective and mutation blocks, and
completion conditions — is the other half of the roadmap outcome and is deferred to the slice that
also delivers the block libraries and the scenario editor (Milestone 2 outcomes 3 and 4). A scenario's
payload is mostly *block bindings*, whose shape is fixed by the block templates, and the delivery
rules forbid publishing a contract without its consumer. Defining it now would be guesswork twice
over.

Frame 3's "Used by" card is therefore partial: this slice shows the customer's other tickets, and
scenario usage arrives with scenarios.

## Verification

- Domain tests (`test_ticket_domain.py`) cover the unpublished-shop and unpublished-customer
  findings and the paths they name, the thread and its derived opening moment, the
  customer-only trigger, the trigger-ordering rule, the trigger-only ticket, every origin combination
  in both directions, each publish-gate finding, the structural limits, the completeness of the
  sensitivity classification, the absence of every restricted value from the telemetry attributes, and
  change summaries that name what moved without quoting the thread.
- Serialization tests (`test_ticket_payload.py`) prove the document round-trips, is sorted and compact,
  keeps an absent trigger as an explicit null, excludes the owning shop and the derived thread facts,
  changes its fingerprint for every behaviourally relevant edit including history reordering, and
  reports the failing path for a drifted document or a malformed identifier.
- Service tests (`test_tickets.py`) prove a new ticket starts incomplete and scoped, the customer
  becomes a pinned draft reference, a ticket can only be opened for an attached customer, a reference
  names one ticket per shop while two shops may reuse one, another shop's ticket is not found here,
  the gate is judged against the live shop, a deleted or foreign order turns the ticket into an error,
  an unpublished shop or customer is a finding the preview carries before it is a refusal,
  publishing pins the shop and the latest customer version, a published version stays frozen while
  the draft moves on, and the context carries the customer, the
  linked orders, the pickers, and this customer's other tickets.
- Contract tests (`test_ticket_api.py`) prove the derived opening moment is normalized, a client
  cannot move a ticket to another customer, a naive timestamp and a contradictory origin answer their
  own codes, a duplicate reference is a 409, an unpublished reference names itself, a refused publish
  carries its findings, the index is scoped to one shop, and unknown shops, tickets, and versions
  answer their own 404s.
- Frontend tests cover the list with its status filter and counts, ticket creation restricted to this
  shop's channels and customers, the thread's history/trigger dividers and badge, a support reply that
  never becomes the trigger, a refused message that adds no bubble and keeps its draft text, the
  missing-trigger state and its finding, the context panel's customer, linked order and document
  cards, an unresolvable link that stays removable, the origin picker that only offers what the chosen
  page can carry, a save that omits the derived facts and the customer, a refused publish that stays
  visible, and the collapsible rail. `lib/tickets.ts` has its own unit tests for the request
  projection, origin retargeting, thread appending and refusal, canonical-instant normalization, and
  removal.
- One Playwright journey publishes the wrong-address ticket end to end — shop, customer, and order
  first — and proves the published version stays frozen while the draft moves on.

## Consequences

- The scenario slice binds a published ticket version and inherits its suggested documents as the
  scenario's context documents; it also freezes the order fixtures the ticket references, per
  ADR 0015.
- The sandbox slice materializes a ticket's thread into the run's opening conversation, and the
  trigger is what the runner sends to both arms.
- `POST /shops/{shop_id}/tickets` and `PUT .../draft` check the shop-unique reference in the service
  only; unlike an order fixture, a ticket has no dedicated table to carry a unique constraint. Two
  concurrent creations could both pass. This is the same class of gap as ADR 0013's last-write-wins
  caveat, and the first slice with a real concurrent-authoring requirement should close both together.
  A dedicated table is not required to close it: a unique index over `(definition_type, shop_id,
  json_extract(payload, '$.reference'))` on `definition_drafts` would hang the constraint on the row
  that already exists.
- Every existing definition service keeps working unchanged: the codec's `references` defaults to
  none, `create` takes no shop, and `_validate` falls through to the codec.
- Local databases keep working; this slice adds no migration and no table.
