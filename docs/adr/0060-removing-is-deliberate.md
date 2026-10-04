# ADR 0060 — Removing is deliberate: the confirm takes the row's place, and a preference can remove it

Status: accepted, amended by ADR 0077 (a shop that never published can be deleted, with everything it holds) — 2026-09-23

Amendment: 2026-10-04 — A ticket's unresolved linked order is not trivially re-added — no order
of the ticket's customer in this shop matches it, whether it was deleted or moved to another
customer, so no checkbox links it again — so its *Unlink* asks twice, on the grey panel a detach
uses (`destroys={false}`, the press *Unlink*), and names it in the list's notice. Unlinking
the ticket's last link on an origin that names nothing raises `ticket_without_resource_reference`,
whose clause is now in `REMOVAL_FINDINGS`. A resolved linked order stays its checkbox, one press.

Settles `docs/design-direction.md`'s rule *Removing is deliberate* (`form-decisions.md` 9.2) for
every Remove, Delete and Detach in the workspace, and the sixth browser preference that governs
it. It is the confirm policy `docs/PLAN-UX.md` says a slice writes an ADR for.

Records five decisions: which removals ask twice; what the second press looks like and where
focus goes; that one browser preference removes the second press and *Reset to defaults* puts it
back; that removing a product option takes the value its variants chose with it; and that a
product's own Delete and Duplicate are deferred until the editor has a product identity to build
them on.

## Context

Every list in the workspace removed an entry on one press. The shop draft, the profile, the
ticket and the definitions are all drafts, so a removal was recoverable by *Discard changes* —
but only by throwing away every other unsaved edit with it, and a policy's three paragraphs or a
hidden fact are not something an operator types twice without cost. The order editor was the one
exception: its Delete already asked "Delete this order permanently?" in the header, because it is
the one removal that cannot be undone — an order is not a draft. Detaching a profile writes at
once too, but it is undone by attaching it again.

The prototype draws the second press once, on a product option (`Workspace.dc.html` :971): a
tinted panel asking "Remove option “Colour”?", a sentence saying what happens to the variants that
choose it, *Remove it* and *Keep it*. `form-decisions.md` 9.2 says the confirm takes the row's
place and states the whole consequence, and notes that every removable row therefore needs a
confirm state of its own height. The settings page proposes *Confirm before anything is deleted*
with the sentence "Turning this off removes the second press on deletes. A published shop version
and a recorded run are never deletable, whichever way this is set." (:3926), on by default.

## Decision

### Every removal that is not trivially re-added asks twice

A removal asks a second time unless what it removes is **one value re-typed in the field beside
it**: an option value, an attribute choice, a persona trait, a ticket tag, a run's tag — and
anything removed on a create page before the create has been pressed, which is ADR 0051's
half-typed create form: a new block's parameters (`BlockLibraryPage`) and a new scenario's
*Hidden facts* chips (`ScenariosPage`).
Everything else asks: addresses, background entries, hidden facts, guidance notes, escalation
conditions, payment and fulfilment methods, tone-of-voice guidelines, documents, the ticket's
messages — the trigger and the history alike, since both are authored prose with an instant —,
composed objectives and mutations and the bindings they carry, a block's parameters, an order's
lines (the frozen price goes with the line) and events, a product's options, variants, media,
attributes and reviews, an order, and detaching a profile from a shop.

Escalation conditions are the one chip list that asks. They are values of a `ChipListField` like
traits, but each is a sentence an identity's behaviour turns on, and PLAN-UX names them;
`ChipListField` takes an optional `confirmRemoval` for that list and draws the others as before.

### The confirm stands where the row stood, and holds focus

`ConfirmRemove` replaces the row — a list item, a table row spanning its columns, or a block — with
the prototype's panel: the question in the warm red, the whole consequence, the destructive press
and *Keep it*. It is a `<fieldset>` named by the question and described by the consequence, and
**it takes focus when it appears** — the group, not either button — so the question and the
consequence are read out, and an Enter that armed it cannot also finish it. Escape and *Keep it*
walk it back and focus returns to the control that asked. `useRemoval` (`lib/removal.ts`) holds
one armed row per list; arming another walks the first back.

**After the removal, focus goes to the list's notice line** (`RemovalNotice`), which says
"Removed … from the draft." — the prototype's own notice (:982), without its Undo. Focus is what
announces it, so a keyboard reader is left on the list rather than on the document (WCAG 2.4.3,
*every workflow keyboard-reachable*); it is deliberately **not** also a live region, because a
live region that takes focus is read twice. The same happens when the preference has removed
the second press. The notice clears itself once the entry it names is on screen again —
*Discard changes* put it back — so it never says an entry was removed while it is there.

**A removal that writes to the lab says so only once the write has landed.** A detach is the one
removal whose act is a request rather than a draft edit, so its act answers a promise of whether
it landed (`RemovalAct`). The notice and its focus wait for that answer: said before it, the row
would still be drawn and the notice cleared as soon as it was set; after a failure, it would be
untrue, and the page's own error says why instead. A write that fails — or throws — is walked
back like *Keep it*: focus returns to the control that asked, drawn again on its row. A late
answer speaks only to the list that sent it: `removed()` captures the list's scope, and says
nothing and moves no focus once the list has unmounted or moved to another subject; a walk-back
still owed when another row is armed or removed is dropped rather than delivered later. On this
page, one write per shop is in flight at a time: a second press while the first is pending
sends nothing, since it would supersede the first write's refresh and read as a failure. A
removal that navigates away — a document, an order — sets no notice of its own; the list it
lands on says it.

**The customer editor is keyed by profile**, so every profile is a fresh page: without it, a
detach of one profile that answered after the operator had opened another landed on the other —
its alert on his card, and focus on his own Detach, one Enter from detaching the wrong customer.
Keyed, the page that sent the write has unmounted, and a write that settles after that neither
navigates, nor sets state, nor says anything; the unsaved-work guard is asked before the move,
so a dirty profile still asks.

A removal that leaves the page — a document, an order, a profile detached from this shop —
carries its notice to the list it lands on, in the navigation's location state
(`removedState`), and that list's notice says it once, takes focus and clears the state
(`useArrivedRemoval`), so a reload or a return does not say it again: the Documents table, the
orders index, Customers. On the Documents table, which is the shop draft's, a discard that lands
drops the notice too, because the removal it speaks of may be undone.

**A confirm belongs to one subject.** `useRemoval(scope)` takes what its list belongs to — the
product, the profile, the order, the ticket — and drops what was armed or said when the scope
changes, because a page that moves to another subject without remounting would otherwise stand
an armed row of the same key on the other one. And a key no row asked about in the last render
is dropped, so a row taken away by a search or by *Discard changes* does not return already
armed. Most editors draw no rows while they load the next subject, so there the second rule
already covers a move; `lib/removal.test.tsx` proves the scope by itself.

The product editor's lists are scoped by the product's **handle**, because that is the only
identity the page gives a product: it is addressed by its handle, follows a rename by the handle,
and after *Discard changes* undoes a rename it follows the product back by its place in the draft
(unchanged by this ADR). So a rename — a title edit drives the handle — drops an armed row
confirm and its notice, which only ever errs toward asking again. (Superseded by ADR 0061: the lists are
scoped by the product's key, and a rename keeps an armed row.) And those lists pass the draft's
`discarding` flag to `useRemoval`, which drops what was armed or said once a discard lands: the
draft under the list has been read again, and a discard can put back a different product under
the handle the page stands on.

The act is never captured at the first press. The first press only arms a key, and the confirm
is handed the act again when it renders, so the removal written is against the draft as it
stands at the second press rather than a copy from the first that would put back every edit made
in between.

A **header's** Delete — the order editor's — has no row to replace. Its confirm stands directly
under the header, full width, while the Delete is withdrawn.

Every consequence says only what the lab does: which gate finding the removal will raise and on
what, that nothing is written until the draft is saved, and that a published version keeps what
the draft loses. The finding clauses are written once, in `REMOVAL_FINDINGS` (`lib/removal.ts`),
keyed by the code the domain raises and naming its severity — *refused at publication* for an
error, *warned about* for a warning — and a removal adds a clause only when it would raise that
finding: the last address, background entry, guidance note or escalation condition; the default
address — and every address, which warns on each order shipped to it
(`shipping_address_source_removed`); the last enabled payment method, fulfilment method, policy, FAQ entry, support
guideline or tone-of-voice guideline (`shop_without_tone_of_voice`), and the default one
(`tone_of_voice_without_default` — said, though the default carries no Remove today); the last
variant or media reference; a mutation block's only timing parameter
(`mutation_without_timing`); the last line or event of an order, or the event its payment or
fulfilment status needs; the ticket's trigger; the scenario's last objective. Some removals
always raise one: a method (`payment_method_missing_from_shop`,
`fulfilment_method_missing_from_shop`, warnings on the orders that recorded it), a document
(`context_document_missing_from_shop` and `binding_document_missing_from_shop`, errors on a
scenario that names it; `suggested_document_missing_from_shop`, a warning on a ticket that
suggests it), an order (`linked_order_missing_from_shop`,
`binding_order_missing_from_shop`), a detach (`customer_not_attached_to_shop`,
`binding_customer_missing_from_shop`). Every other
`issue_error` and `issue_warning` in the domain was read call site by call site; they are raised
by fields, selects and toggles — a summary, a completion, a permission, a tool, a suggested
document — or by a Remove this ADR gives no second press: an option value removed from its chip
list leaves the variants that chose it on `variant_unknown_option_value`, and a persona's last
trait raises `persona_without_trait`. Those are the one-value chip lists, re-typed in the field
beside them, and they stay one press.

### One preference removes the second press

`agent-lab.confirm-before-delete` is a browser preference (ADR 0044, ADR 0058), on by default,
read at the press rather than threaded through a context for the reason the timestamp format is:
it is changed only on `/settings`, which removes nothing. Anything but `"false"` reads as on, so
a hand-edited value can only put the second press back. Off, the first press acts; what the
confirm would have said is still true and simply not said first.

**The order editor's Delete obeys it too, knowingly.** It is the lab's one removal that cannot be
undone, so keeping it at two presses whatever the preference said was weighed and refused: the
prototype's sentence is "Turning this off removes the second press on deletes", and the one
exception it names — a published shop version and a recorded run are never deletable — is about
what cannot be deleted at all, not about what still asks. A preference that kept one delete at two
presses would make that sentence false on the one delete an operator is most likely to test it
on.

It is **chosen**, so *Reset to defaults* puts it back on. ADR 0058's rule stands whole: a reset
returns what an operator chose — now four preferences — and touches neither value the shell
records. The row is the fourth of *Your preferences*, with the prototype's sentence as its hint.
Both halves of that sentence are true here: nothing in this workspace offers to delete a published
version or a recorded run, and no route would take the request.

### A product's own Delete and Duplicate are deferred

Frame 2c draws Delete and Duplicate on the product editor's header, and PLAN-UX asked for them
there and as catalog row actions, with Delete naming any order line that references one of the
product's variants. They were built and reviewed four times and taken out again, because a
product has **no stable identity** in this editor: its handle is both its address and its
identity, and it moves with every title edit, so "the product this confirm is about" could not be
held across a rename, a delete elsewhere in the catalog and a discard. Each fix to how the page
followed a product across those — by position, then by a remembered handle, then by a visit
re-anchored after each discard — let the review find another sequence in which an armed Delete
survived onto a different product and deleted it. They also showed that a discard following a
renamed product back remounts the lists and throws away what is being typed in an open row —
and that this is true on `main` as it stands, without any Delete, because the page draws
"Product not found" for one commit on the way back; it is a defect the identity work must fix,
not one the removed machinery alone caused. The deletes that remain are of rows inside one
product, scoped as above. Deleting and duplicating a product is its own slice (`docs/PLAN-UX.md`,
*Slice 21 (remainder)*), which settles how the editor tracks a product across renames, deletes
and discards in an ADR of its own before building on it. The sequences the reviews found are
`docs/history/2026-09-25-product-identity-reproductions.md`. (Settled by ADR 0061, and built by
ADR 0062: a product's Delete and Duplicate, on its key.)

### Removing an option takes the value its variants chose

A variant that kept the value would be choosing for an option the product no longer declares —
`variant_unknown_option`, an error — and no control on the variant row can take a value out. So
`removeOption` removes the option and every variant's value for it, and the confirm says how many
variants choose it and that they will lose it, which is the prototype's own sentence.

Losing it can leave two variants choosing the same values, which `validate_shop` refuses as
`duplicate_variant_options`. **Nothing is deleted to avoid that** — which of the two to keep, or
what to tell them apart by, is the operator's — so the confirm names each group that would become
identical, with the values they would share, and says the shop is refused at publication until
they differ again or one of them is removed. Variants that are already identical are said to
be, with the values they share today — every such part, where two merge — and the removal is
blamed only for what it adds, a new group or a variant joining a part the gate already refuses;
every variant it adds is named, and so is what all of them would then share ("…makes NS-C
identical to them too; all three would share M"). A
variant with no values reads "no option values" wherever it appears.
Several new groups are counted as groups ("4 variants would become identical in 2 groups"), so
the count never reads as all of them identical to each other; values are written in each
variant's own order, as the variant table writes them. Two variants are compared as `validate_shop`
compares them: their values sorted by option, spelled exactly. The sort is JavaScript's UTF-16
order rather than Python's code points, which differ only past the Basic Multilingual Plane and
cannot change an equality between two signatures sorted the same way.

### Detaching a profile from this shop returns to Customers

The customer editor is this shop's view of the profile, so once it is no longer one of the shop's
customers the page has nothing to stand on: detaching from *this* shop refreshes the Customers
listing, waits for it, and navigates there carrying its notice — waiting, so the index it lands
on no longer lists the profile its notice names. If that read fails, the listing would still
list the profile beside a notice saying it was detached, so the page does not go: it stays on the
profile, its notice says what was detached, and an alert says only the new fact — the customer
list could not be refreshed, so the page stays on the profile. `refresh` answers whether its read
landed (`shell/listings.ts`): a read that failed, was superseded or outlived its subject answers
`false`. The navigation goes through the one unsaved-work guard (ADR 0051), which
is the sharing that ADR anticipated: an unsaved edit to the profile is still an edit to something
the lab holds, and is asked about. Detaching from another shop stays on the page, and its notice
says so once the detach has landed.

## Deliberately not here

- **The Undo on the notice.** The prototype draws "Removed Colour from the draft. Undo"; the
  notice is built and the Undo is not. A draft removal is already reverted by *Discard changes*,
  the order's delete is the one that cannot be, and an Undo per removal would be a second history
  to keep in agreement with the draft's.
- **A confirm on the chip lists and on a create page's removals**, for the reason above.
- **A product's own Delete and Duplicate**, for the reason above (since built, ADR 0062).
- **A preference that reaches the lab.** It is this browser's, like the other five.

## Consequences

- Every removal that asks costs one more press and one read of a sentence; turning the
  preference off is the way out for an operator who finds that slower than it is worth.
- Several lists now render a ternary per row, which is the cost of the confirm taking the row's
  place rather than opening beside it.

## Verification

- `Customers.test.tsx`: an address needs two presses, the confirm holds focus and states the
  consequence — including its order warning — *Keep it* and Escape walk it back to the Remove,
  and only the second press reaches the saved payload; with the preference off one press removes;
  after the second press focus is on the notice, which is not a live region; detaching from this
  shop needs the second press and lands on Customers, named there with focus on it, and detaching
  from another shop stays.
- `App.test.tsx`: removing an option says how many variants choose it, names the groups it would
  leave identical — a Size × Color product's two pairs, a pair already identical, a variant
  joining one — and strips their values; the last guideline's clause; with the preference off one
  press removes a variant; an armed row confirm is dropped when a discard lands, and — since
  ADR 0061 — kept through a rename; the notice clears when *Discard changes* puts the variant back.
- `SupportIdentities.test.tsx` and `Tickets.test.tsx`: an escalation condition and the first
  message ask, while `ChipListField.test.tsx` still removes an option value on one press.
  `Tickets.test.tsx` (amendment of 2026-10-04): an unresolved linked order's *Unlink* asks twice,
  *Keep it* keeps it, and an order of another customer is named the same way; the
  `ticket_without_resource_reference` clause is said only for the last link on an origin that
  names nothing; a resolved order still unlinks on one press.
- `Documents.test.tsx`, `Orders.test.tsx`: a document and an order are named on the list the page
  lands on, with focus there; the document confirm tells a scenario's error from a ticket's
  warning; a carried notice is not said again on a return through history.
- `lib/preferences.test.ts` and `LabSettings.test.tsx`: the key's default, round trip and
  hand-edited value; the row's sentence as its accessible description; *Reset to defaults* puts it
  back on and leaves the recorded two alone.
- `lib/removal.test.tsx`: an armed row is dropped when the scope changes to a subject with a row
  of the same key, and when its row leaves the list; the tone-of-voice clauses.
  `Blocks.test.tsx`: of three parameters, the one asked about is removed from the draft as it
  stands after a neighbour moved, and the move is kept.
- `lib/shop.test.ts`: `removeOption` leaves every other value; `variantCollisions` names the groups
  and nothing where every variant still differs; values listed in another order are one
  combination, and Red is not red. `lib/entryIds.test.ts`: a derived SKU is clamped before it is
  made unique.

## Migration

None. One `localStorage` key that no browser holds yet and every reader defaults; no table, no
column, no canonical document, no fingerprint and no contract.
