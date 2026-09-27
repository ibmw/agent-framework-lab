# ADR 0067 — A ticket names what it points at by its title

Status: accepted — 2026-09-27

The ticket editor showed a product-page origin by its handle and each suggested document by its
slug, because the context payload carried nothing else. The frames name both by title
(`Workspace.dc.html` :2293 and its `docs` data; DEPRECADED frame 3's *Suggested documents*), a
document with its kind beside it. This records the one additive change to the v1 contract that
closes that gap, and three decisions it had to make.

## Decision

### The titles travel with the pickers, not beside the references

`TicketShopResourcesSchema` gains `products: [{handle, title}]` and
`documents: [{kind, document_id, title}]`. It does **not** gain a resolved `origin_product` or a
list of resolved suggestions beside the ticket's own references.

The editor holds the ticket as unsaved local state and changes its origin and suggestions before
any save; a resolution of the *stored* draft would name the product the ticket pointed at before
the author's last pick until the next save, and the context is re-read only after one. The
resources are what the pickers already read, they list everything the ticket may name, and
looking a reference up in them is right for every value the editor can hold. It is also how the
same page already treats an unresolved linked order (`resources.orders`).

A scenario's pickers made the same choice (`ScenarioResourcesSchema.documents`), so the title a
document is read by is computed once, in `application/shop_documents.py`, for both: an FAQ
entry's title is its question.

### The titles are the shop draft's

The context already resolves every picker against the shop **draft** (`_require_shop` reads
`get_draft`), and so does the ticket's publish gate. A published title would name a product the
draft has since renamed, beside a picker that offers the new name. The snapshot a run takes pins
the published shop; that is where the published names are read, not here.

### A missing reference is an absence, and the editor says so

There is no nullable title and no `resolved` flag. A handle or a `(kind, id)` pair absent from
the titled lists is one the shop draft no longer holds, which the gate already reports
(`origin_product_missing_from_catalog`, `suggested_document_missing_from_shop`). The editor
names it by its identifier and marks it unresolved: the origin in the header and as the picker's
selected option, a suggestion as a row of its own with *Remove*, matching the unresolved-order
row. Without that row a suggestion the shop dropped had no checkbox left to uncheck.

| Case | Payload | Editor |
| --- | --- | --- |
| Origin product in the draft catalog | in `products` with its title | header and picker show the title |
| Origin product renamed in the draft | in `products` with the new title | the new title |
| Origin product removed from the draft (or never there) | absent from `products` | header `handle (unresolved)`; picker keeps it selected as `handle (unresolved)` |
| Context not yet read, or its read failed | no context | header shows the handle; the panel is absent, as before |
| Suggested document in the draft | in `documents` with its title | a checked row, title then kind |
| Suggested document removed from the draft | absent from `documents` | an *Unresolved document* row, `kind · slug`, with *Remove* |
| Same slug held under another kind only | the pair is absent | unresolved: the pair is the identity (ADR 0057) |

### The untitled lists stay

`product_handles`, `policy_ids`, `support_guideline_ids` and `faq_entry_ids` stay in the
contract, now derived in the presentation layer from the titled lists so the two cannot disagree.
Removing them is a breaking change to v1 and belongs to a versioned slice if ever. The contract's
`info.version` stays `1.0.0`: the repository has shipped every additive v1 change without a bump
and keeps no contract changelog (`docs/api-and-schema-conventions.md`).

## Deliberately not here

- **Titles on a scenario's product picker.** `ScenarioResourcesSchema.product_handles` is the
  same gap on another definition; this change is the ticket's.
- **The handle beside the title in the product picker.** Titles are not unique in a catalog and
  a select option has no secondary line. The frames draw neither the picker nor a handle; two
  products with one title would read alike there, and the gate still judges by handle.
- **The slug beside the title in the suggested documents.** A document's title is not unique
  inside its collection either: two policies both titled "Same" draw as two identical rows, a
  title and the same kind, told apart only by position. The frames draw the title and the kind
  and no slug, and the suggestion is still stored and judged by its `(kind, id)` pair.

## Verification

- `apps/api/tests/test_tickets.py`: the titles, an FAQ entry's question, the draft over the
  published version, and a removed product and document absent from the lists while the ticket
  keeps its references.
- `apps/api/tests/test_ticket_api.py`: the context response validated against the published
  `TicketContextSchema` with `jsonschema`, the titled and untitled lists agreeing, and the
  published schema refusing a document without a title.
- `apps/web/src/lib/tickets.test.ts` and `apps/web/src/Tickets.test.tsx`: titles in the header,
  the picker and the documents card, the unresolved origin, and the removable unresolved
  suggestion named by its pair.
