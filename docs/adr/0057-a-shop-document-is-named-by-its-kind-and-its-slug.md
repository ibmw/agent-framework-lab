# ADR 0057 — A shop document is named by its kind and its slug

Status: accepted — 2026-09-21

Decides what a shop document's identity is now that the three collections are drawn as one
table, and what follows from that for the surfaces that create and edit one.

Three decisions. That a document's identity is the **pair** — the collection it is in and the
slug inside it — so the kind is a value in its editor and never a control. That **creating one
is therefore a page**, the tenth, rather than the append-and-open a product gets, because the
kind is a question the editor cannot ask. And that the retired `/setup/support` **redirects**
to the table filtered to Guidelines rather than answering nothing.

## Context

PLAN-UX Slice 16 draws `content.policies`, `content.support_guidelines` and `content.faq` as
one *Documents* table on Policies & FAQ, with an editor per document at
`/shops/:id/setup/documents/:kind/:docId`. The plan's first bullet ends "with the kind as a
select", and the prototype's own document editor (`Workspace.dc.html`:3163) draws Kind and
Slug as **read-only values**, with "Set at creation" written under the slug. The prototype has
no create screen for a document at all — it has nine `atNew…` screens and its *New document*
control has no handler — so the two together describe a document whose kind is chosen
somewhere the prototype never drew.

Something has to decide where. The question is not cosmetic, because the kind is not a
property of a document the way its body is:

- **Three collections, three shapes.** A policy has a title, a body and a `PolicyKind`
  (Returns, Shipping, …); a guideline has a title and a body; an FAQ entry has a question and
  an answer. Moving a document between them drops the `PolicyKind` on the way out and has to
  invent one on the way in.
- **A reference names both halves.** `ContextDocumentSchema` is `{kind, document_id}`, and it
  is the one enumeration every resource that points at a shop document uses: a ticket suggests
  one, a scenario includes one as context, an objective binds one as a read-check. The id
  alone is not unique — this workspace's own test fixture has a policy and an FAQ entry both
  called `shipping`.
- **The breakage surfaces somewhere else.** A scenario's context documents are validated
  against the shop's **draft** — `authoring_context` calls `_require_shop`, which is
  `self._shops.get_draft(…)` (`application/scenarios.py`:638), and hands
  `shop_document_ids(shop)` to `validate_scenario`; the materialization pass checks the same
  rule again against the published shop when a snapshot is taken. So moving a document's kind
  in the draft is not silent: the scenario's own gate reports the dangling `(kind, id)` on its
  next preview. What is silent is **this** side of it. The shop's publish gate says nothing
  about scenarios and cannot, so an author who moved a kind here would publish a clean shop
  and learn what they had done on another definition's screen, if they opened it.
- **Order is part of the payload.** `canonical_json_text` sorts object keys and leaves arrays
  in the order they were given, and the fingerprint is a hash of those bytes. Taking a
  document out of one list and appending it to another moves two lists; moving it back does
  not restore either. A round trip through a select would leave a shop with a different
  fingerprint and not one word changed on screen.

Against that, this workspace already has a rule for exactly this class of field: *a saved
entry's identifier is displayed and never asked* (`docs/design-direction.md`, *The form
language*). Policies, guidelines and FAQ entries have observed it since their ids were derived
— the edit-in-place row this slice replaces asked for the title, the kind-of-policy and the
body, and never for the id.

## Decision

### The identity is the pair, and the editor shows it

A shop document is named by `(kind, id)`. Both are answered once, when the document is
created, and both are drawn in its editor as values on the read-only row — the prototype's own
rendering, reached here by the rule that already governs the slug beside it. Changing a kind is
not offered, so no surface in this workspace can move a document between collections; removing
it and creating another is what that is, and it reads as a removal and an addition against the
published version, which is the truth.

A policy's own subject stays a **select**. It is a field of the policy rather than part of its
name: nothing references a policy by it, moving it moves nothing between lists, and the
collection it belongs to is the only one with a column for it.

### Creating one is a page, and it is the tenth

*New document* opens `/shops/:id/setup/documents/new`, a `CreatePage` asking the title, the
kind and the slug the title derives, and landing in the editor of what it made.

This is deliberately **not** what a product gets. `docs/design-direction.md` records the
product as the one exception to creation-as-a-page — "it is a row of the shop draft rather
than a definition, so *New product* appends an empty one and opens its editor, and the handle
it is addressed by is answered there" — and a document is a row of the shop draft too. What
separates them is the last clause: a product's handle is answered in its editor because
renaming one is a rename *inside one list*, which the editor can do and the address can
follow. A document's kind cannot be answered there, because answering it is a move between
lists, and the four consequences above are what that move costs. A question the editor cannot
ask is a question a create page exists for.

The page is subtly different from the other nine and says so where it is written: it uses
`CreatePage` and **not** `useCreateThenComplete`. That hook is for a create the lab makes with
a `POST` and the page completes with a `PUT`; a document is appended to the shop draft the
shell already holds, so there is nothing to post, nothing to be refused and nothing to wait
for — the same three facts the product exception rests on. One press appends one row and
navigates, so nothing is owed and nothing registers as unsaved work (ADR 0051); the draft is
left dirty, and `shopDraftIsSavableAt` already reaches every address under `/setup`.

The body is not asked for. *A create form asks for what constrains the work that follows and
names where the rest lives*: the kind and the slug are what a scenario binds to and cannot be
moved afterwards, the text is the work itself, and the *Created as a draft* card says where it
is written.

### The retired address redirects, and carries its filter

`/setup/support` answers with a redirect to `/setup/policies?kind=guidelines`. ADR 0054 took
*Support guidelines* off the rail, kept its route, and said this slice would fold it in — "a
deliberate week of being hard to find rather than a route deleted twice". A 404 would end that
week by throwing away every bookmark made during it, and the work the address named still
exists; it is three rows of another table.

The filter travels with it, which is why the Documents table is the one index in this
workspace whose chip lives in the address (`?kind=`) rather than in component state. A
redirect that landed on all three collections would be answering a narrower question with a
broader screen, and a filter an address names has to be the filter that is pressed. Pressing a
chip replaces the history entry rather than pushing one, so Back leaves the table instead of
walking the chips.

The tour goes with the route. `support-guidelines` is removed from `lib/tours.ts`, and the one
thing it said that nothing else says — what a guideline is, against what a support identity is
— is the second step of the Documents table's own tour. A retired surface whose tour still
named it is the defect Slice 10 shipped; `tours.test.ts` now asserts that no tour names
`/shops/:shopId/setup/support`, that the address is offered none, and that the sentence
survived the merge.

## Deliberately not here

- **A kind select on the editor, with the address following it.** The plan's own sentence
  reads that way and the product editor proves the mechanism exists. It is refused for the
  four reasons under *Context*, of which the scenario breakage is the one that matters: the
  cost of being wrong is a recipe that stops resolving, reported on the scenario's gate and
  never on the shop's, so the surface that caused it is the one surface that will not say so —
  and the benefit is saving one page on the rare occasion an author files a document under the
  wrong kind.
- **Merging the three collections in the payload.** `docs/PLAN-UX.md` rules it out by name and
  this ADR does not reopen it. `lib/documents.ts` is a projection: every read composes the
  three in a fixed order and every write goes back into the one list its document came from,
  in the slot it already held, which `lib/documents.test.ts` holds to the byte.
- **A *Required by a scenario* chip.** The plan names it and the prototype draws it. The
  scenarios listing this workspace holds carries `context_document_count` and no document at
  all (`ScenarioSummarySchema`), so computing it would be one draft read per scenario — the
  additive read ADR 0056 measured and refused — and a figure the payload lacks is not faked. A
  departure, recorded in `docs/design-direction.md`.
- **A second press on the document's Remove.** The three lists each carried a one-press Remove
  before this slice and the editor keeps one, so a presentation is not where an author loses
  their only way to delete a policy. PLAN-UX Slice 21 owns the second press and gives it to
  every Remove at once.

## Consequences

`PoliciesAndFaqPage` and `SupportGuidelinesPage` are gone, and with them the three add forms
and three edit-in-place rows that ADR 0051 counted. Three surfaces replace them:
`DocumentsPage`, `NewDocumentPage` and `DocumentEditorPage`, over one projection in
`lib/documents.ts`.

The rail's *Policies & FAQ* figure counts all three collections, which ends the departure ADR
0056 opened and `docs/design-direction.md` recorded. The `document` filter-chip kind — the
seventh of the handoff's *Assets* list, held back until something drew it — lands with the
table. Three shop gate codes resolve to the same page with three different chips
(`lib/issueRoutes.ts`), which is *where the path names one, the entry in view* read at the
granularity the gate writes.

Five Playwright specs authored a policy through the old add form and now go through
`addDocument` in `tests/e2e/support/authoring.ts`, which is one place rather than five the next
slice has to move.

## Verification

- `src/lib/documents.test.ts`: the projection's order, the pair-identity (one id in two
  collections), and the byte-identity of the canonical payload after every document is read
  out and written back.
- `src/Documents.test.tsx`: the chips' counts against the three lists, the absence of the
  required-by chip against a shop whose scenario *does* read two of its documents, the
  editor's kind and slug drawn as values, the whole payload after one edit, the redirect with
  its chip pressed, and the slice's own evidence — "returns" finding a policy and a guideline
  in one list, and the guideline opening on a page.
- `src/App.test.tsx`: the route tree, the ten create routes swept against `CREATE_ROUTES`, the
  shop draft's reach over the two new addresses, and the rail's figure over three lists.
- `src/lib/tours.test.ts` and `tests/e2e/tour-anchors.spec.ts`: the retired surface's tour, and
  the two anchors the table's tour lights.
