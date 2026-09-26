# ADR 0062 — A product is deleted and duplicated by its key, and its Delete reads the orders when asked

Status: accepted — 2026-09-26

Builds what ADR 0060 deferred (*A product's own Delete and Duplicate are deferred*) on the
identity ADR 0061 gave a product. A new record rather than an amendment of 0060, because the
decisions below are not the removal policy's and not the key's: they are what a product's own
Delete reads and says, how it leaves the editor, where its notice is kept true, and what a copy is
named. Everything else — the confirm, focus, *Keep it*, the preference, `ShopDraft`, the keyring,
the stamp, "key gone → catalog", the guard's exemption, the key as removal scope — is inherited
and not restated. The acceptance list is `docs/history/2026-09-25-product-identity-reproductions.md`.

Records five decisions: the Delete reads which orders name the product's variants once, at the
first press; it says the four findings a product's absence raises; it leaves the editor through the
"key gone" door; the catalog's notice is kept true by the product key rather than cleared by every
discard; and a copy is a draft under a stepped handle, SKUs derived again, a freshly minted key, one
per intent.

## Decision

### The Delete reads the orders on demand, once, at the first press

`OrderSummarySchema` carries a line count and not the lines, so which orders name one of the
product's variants is the orders listing the workspace already holds (ADR 0056) — read directly
only while it has not answered — and one `getOrder` behind each row, at most six at a time. An
order that answers 404 was deleted since the listing and names nothing. Lines are matched by SKU,
which is what `line_sku_missing_from_catalog` matches by, against the product's SKUs as they stand
at each render: the lines are read once and matched again, so a variant renamed while the confirm
stands is matched as it now is without asking the lab again. *Delete it* is withheld, with its
reason beside it, until the reads answer; a read that fails says so and lets the delete through,
because the delete is a draft edit that *Discard changes* reverts until it is saved.

`docs/design-direction.md` refuses a figure that costs one read per row — the *Required by a
scenario* chip, whose subset needs a scenario draft per row and would be paid by every render of
the Documents table for a chip nobody asked about. This read is not that: it is made by
`ProductDeleteConfirm`'s mount, which is the first press, never by a render of the catalog or the
editor, and never per row — one confirm stands at a time per list. It is paid once, by the operator
who has just asked to delete, at the one moment the answer changes what they do next, and dropped
if they walk the confirm back. With the preference off nothing is asked first, so nothing is read.
ADR 0056's refusal of an additive counts endpoint stands: SKUs on the order summary would be a
contract change for one confirm, and it is not made.

A late answer never lands elsewhere. The read belongs to the confirm's mount — the header's
confirm is inside a page keyed by the product, a row's is keyed by it — and is aborted with it;
and the answer is held under the product key it was read for and shown only for that key.

### It says the four findings a product's absence raises

Every `issue_error` and `issue_warning` that reads the shop's products was read call site by call
site; a product leaving the draft can raise four, all errors, and the confirm says each through
`REMOVAL_FINDINGS`:

- `shop_without_product` (`domain/shop.py`) — only when it is the draft's last product;
- `line_sku_missing_from_catalog` (`domain/order_fixture.py`) — for each order the read names, as
  that order being unable to seed a sandbox once the draft is saved;
- `origin_product_missing_from_catalog` (`domain/ticket.py`) and
  `binding_product_missing_from_catalog` (`domain/scenario.py`, the one `code_prefix` its
  `_entity_issues` is called with) — always, conditionally worded ("a ticket opened from it", "a
  scenario with a block bound to it"): both read the shop *draft's* handles, so they arise once the
  draft is saved, and neither listing carries the product a ticket or a scenario names.

The other seventeen codes of `validate_shop` are per product or per shop and are taken away with
the product or not touched by it. No other domain module reads the catalog.

### The header's Delete leaves by the door a discard uses

The header's act takes the product out of the draft by its key and records the notice; the page's
own effect, which already sends a page whose key has left the draft to the catalog (ADR 0061), goes
there carrying the notice (`removedState`, keyed by the product key). One way out, so a Delete and
a discard can never send the page two places. It `replace`s, like every other move that effect
makes: the entry of a product that no longer exists is not left behind for Back to find. Because
the effect runs after the commit that unmounted the cards, an open row of the deleted product has
unregistered itself by then, and the guard has nothing to ask — the Delete was asked to take the
product, and its rows go with it.

### The catalog's notice is kept true by the product key

The catalog's `useRemoval` passes `noticeByKey`: a landed discard still drops an armed row, whose
confirm was read off the draft the discard threw away, but the "Deleted …" notice — from a row, or
carried from the editor — is keyed by the product key and marked present for **every** product in
the draft, not only the rows the search and chips draw. It clears exactly when the product is back
(R9, whatever its title now reads), and stays through a discard that restored nothing, which has
left it true. The Documents table keeps ADR 0060's blanket clear.

### A copy is a draft, under names nothing holds, keyed afresh, once per intent

`duplicateProduct` appends a copy with everything authored — description, category, options,
media, attributes, reviews, each variant's values, price, stock and availability — titled
"… (copy)", as a **draft** whatever the source was, so an agent is never handed two identical
active products before anyone has said how they differ. Its handle is the source's cut to leave
room for `-copy` (`COPY_SUFFIX`), then made free among the draft's handles (`-copy-2`, `-copy-3`)
— except at the 64-character cap, where a stepped copy reads `<…>-co-2`, because `uniqueId` cuts
the whole base again to make room for its own suffix; every SKU is derived again from that handle
and the variant's own values and made free among every SKU in the draft and every SKU the copy has
already taken, so no SKU in the draft is held twice. Both are clamped to 64 characters before
they are made unique (`uniqueId`, `uniqueVariantSku`), so two that agree only after the cut stay
distinct. The copy's key is minted by the workspace (`mintProductKey`) and is never one the keyring
knows as saved, so a discard that takes the copy back sends its page to the catalog (S4).

One copy per intent, guarded where it appends (`useDuplicateProduct`): the second click of a
double-click (`detail > 1`) is ignored — it lands on the copy's own Duplicate, a new mount no state
of the source could hold back — and a press answered by the draft the last copy was appended to, or
appended from, makes no second copy and goes to the one it made, which is also what a press does
after the unsaved-work prompt kept the operator on the source.

## Deliberately not here

- **Orders created by another writer after the listing was read** can be missed. The single-writer
  assumption of ADR 0061 holds, and the delete is a reversible draft edit.
- **Duplicate's glyph.** Frame 2c draws a copy mark; it is outside the verb vocabulary
  (`lib/ui.ts`, `buttonIcon`), as *Test connection*'s bolt is.
- **An Undo on the notice**, for ADR 0060's reason.
- **A SKU that only a deleted product had**, and that an order line still names, can be taken
  again by a later copy: a copy is made free among the SKUs in the draft, not the SKUs orders
  froze. Out of scope, like the single-writer assumption.

## Known and not changed here

- Pressing *Delete it* while a Discard is in flight cancels the Discard, the same as every
  `useRemoval` confirm on `main`; it deletes the product it named, never another.

## Consequences

- The product editor's header carries Delete, Duplicate, then Save; the catalog gains an Actions
  column. A header confirm stands under the header, as the order editor's does.
- `useRemoval` gains `noticeByKey`; every other caller is unchanged.

## Verification

- `App.test.tsx`, *deleting and duplicating a product*: R3, R4, S7, S1, R9 (and R9 with the
  product searched out of view), S4 and S9 as operator steps; NS-10482 and NS-ASJ-OB-M named before
  the second press and NS-10483 not; *Keep it* and Escape walk back to Delete and write nothing;
  *Delete it* withheld while reading, let through on a failed read — no further order read
  after it — a 404 skipped; a row's notice kept through a discard that did not restore it; the orders read
  once, at the first press; the last-product clause only for the last product, and the ticket and
  scenario clauses; landing on the catalog with focus on the notice, no prompt, an open row taken
  with it, not said again on Back and Forward, saved without the product; one press with the
  preference off, reading nothing; the row's confirm, walk-back, Delete it and Duplicate; an armed
  row dropped by a discard; the copy's payload, `-copy-2`, one copy per double-click from the
  header and the row, none after a stayed prompt; no confirm onto the copy or back; no late read on
  the copy.
- `ProductDeleteConfirm.test.tsx`: a read answering after the confirm moved to another product is
  not shown on it.
- `lib/shop.test.ts`: removal by key; the copy's fields, fresh key and draft status; `-copy-3`
  past a `-copy-2`; no SKU in the draft held twice; 60- to 64-character handles within the cap
  and distinct.
- `lib/removal.test.tsx`: the four clauses; `noticeByKey` keeps a notice through a discard that
  restored nothing and clears it when its entry is back, and still drops an armed row.

## Migration

None. No contract, payload, table or fingerprint changes.
