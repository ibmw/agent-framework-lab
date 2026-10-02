# ADR 0077 — A shop that never published can be deleted, with everything it holds

Status: accepted — 2026-10-02

Amendment: 2026-10-03 — The races this record accepted are closed. It supersedes three passages
of the body: "It is not a savepoint" under *One guarded statement first*, the paragraph **What
this does not guard**, and the PostgreSQL paragraph after it.

- **Every other write that names the shop claims it first.** An order created or edited, a
  ticket or a scenario created or its draft saved, and a profile attached or created into a shop
  each read what they need, then *claim* the shop before their first write:
  `DefinitionRepository.claim_draft`, or `ShopClaims.claim` for an attach, both a no-op `UPDATE`
  of the shop's draft (`claim_draft_statement`) that answers whether it matched a row.
  `claim_shop` in `application/shops.py` turns a miss into 404 `shop_not_found`. On SQLite the
  `UPDATE` takes the write lock, held to the commit, so the draft it matches is the committed
  truth: a delete that committed after the write's reads leaves nothing to match, and the write
  is refused with nothing written; a delete that comes later waits for the write to commit, then
  removes its row with the shop's.
- **Every draft save claims its own draft** before it writes
  (`DefinitionAuthoringService.replace_draft`). A delete can no longer commit between the save's
  read of the row and its update, where the update matched nothing and failed with
  `StaleDataError`, a 500; a shop's draft saved as the shop is deleted answers 404.
- **The order routes were already refused over HTTP**, by accident: they answer through
  `validate_order`, which reads the shop again after the write and under its lock. The order
  service itself was not, and is now.
- **What remains.** `get_order`, `_require_ticket` and `_require_scenario` still return a stored
  record without asking whether its shop stands, and `attached_shop_count` and `attached_shops`
  still count every attachment. No write can now leave such a row, so all they could reach is a
  row a race left before 3 October 2026, and none is known.
- **Not a savepoint, for a different reason.** A savepoint no longer commits early (ADR 0003's
  amendment of this date). The guarded delete still runs as one statement in the request's own
  transaction, because its condition must be inside the `DELETE`.
- **PostgreSQL.** Under READ COMMITTED the claim still holds, because its `UPDATE` locks the
  draft's row and the guarded `DELETE` must lock it too. The guard and the publish's recheck
  would still need the row locked (`SELECT … FOR UPDATE`) for a delete and a publish to exclude
  each other.
- **Verification.** `test_shop_deletion_races.py` commits the delete after the last read of an
  order created and one edited (over HTTP and through the service), a ticket created and its
  draft saved, a scenario created and its draft saved, a profile attached and one created into
  the shop, and the shop's own draft saved: each is refused as `shop_not_found` and leaves no
  row naming the shop. It also tries a delete while a draft save flushes its update. That delete
  is given a short busy timeout (`timeout=0.2`), so being refused with `database is locked`
  proves the save holds the lock, and the save answers 200; a real concurrent delete waits up to
  pysqlite's 5 s default instead, and deletes once the save has committed.

Amends ADR 0060 with the lab's first delete of a whole definition. ADR 0060's sentence — "A
published shop version and a recorded run are never deletable" — and ADR 0019's (snapshots are
never deleted) stand unchanged: what this record allows is a shop that has neither.

On 2 October 2026 the operator asked that a shop that never published, and so never ran an
experiment, can be deleted, and that everything it holds goes with it — its draft, its orders,
its tickets, its scenarios and its uploaded images with their directory — while a published shop
cannot be deleted and says why. The delete is offered on the shops index's row and nowhere else.
`docs/PLAN-UX.md` Milestone 11 Slice 42 delivered it.

## Decision

### Which shop can go

A shop with no published version can be deleted whole. It has, therefore, no ticket or scenario
version, no snapshot and no experiment: each of those needs a published shop version (ADR 0012,
ADR 0016, ADR 0019). The service checks both conditions the operator named — no published version
of the shop, and no experiment naming it — though the second follows from the first today, so a
future path that let an experiment stand on a draft would still be refused.

What goes: the shop's own draft; the drafts scoped to it in `definition_drafts` (its tickets and
scenarios); its orders (`shop_order_fixtures`); its attachments (`definition_shop_attachments`);
its image rows (`shop_media_assets`); and its media directory. What stays: the shop-independent
definitions it had attached — customer profiles, support identities, objective and mutation
blocks, agent configurations and judges — because they are not the shop's and another shop may
use them.

`test_shop_deletion.py` holds the line by enumeration: every mapped table with a `shop_id` column
is read from `Base.metadata` and must be one the delete empties or one a never-published shop
cannot fill (`definition_versions`, `sandbox_snapshots`, `sandboxes`, `sandbox_action_proposals`,
`experiments`, `experiment_runs`). A table added later with a `shop_id` fails that test until it is
placed in one set or the other.

### One guarded statement first, the rest after it

`ShopDeletionService.delete_shop` (`application/shop_deletion.py`) writes first through one
conditional statement — delete the shop's draft where no published version of it and no
experiment naming it exists — and the other deletes follow only when that one removed a row.
Otherwise it answers 404 `shop_not_found` for a shop that has no draft, and 409 `shop_published`
for one that has published, its message naming how many versions ("shop … is kept because it has
published 2 versions: its versions are what experiments are explained by"), or, for a shop an
experiment names with no version, "… is kept because an experiment names it: a recorded run is
explained by the shop it ran on". A repeated delete answers 404, as an order's does.

The condition is in the `DELETE`, not in a read before it, so nothing can publish the shop between
the check and the write. SQLite's single writer orders it against the writes that race it:

- **A publish that commits first** makes the condition false: 409.
- **A publish whose version is written after the delete committed** reads the draft again once it
  holds the write lock, and is refused as an unknown shop, its version rolled back. Under pysqlite
  a request's reads take no lock until its first write, so a publish can read the draft, the delete
  commit, and the publish write a version for a shop with no draft; `ShopService.publish` closes
  that window with `DefinitionRepository.draft_exists`, a query rather than `Session.get`, whose
  identity map would answer with the draft the publish had already loaded.
- **An upload** lands no row: its claim is `INSERT … SELECT … WHERE EXISTS` the shop's draft
  (ADR 0076). One that claimed first is committed before the delete can write, and its row goes
  with the shop's.

It is not a savepoint: under pysqlite a `SAVEPOINT` opened as the request's first write begins the
transaction and its `RELEASE` commits it (ADR 0076), so the guarded delete runs in the request's
own transaction. Each repository deletes on its own table: `SqlAlchemyShopDirectory` the shop's
draft and the drafts scoped to it, `SqlAlchemyOrderFixtureRepository` the orders,
`SqlAlchemyDefinitionShopAttachmentRepository` the attachments, `SqlAlchemyShopMediaRepository`
the image rows. No schema change and no migration.

### The directory goes after the commit, and a 204 means committed

`DELETE /api/v1/shops/{shop_id}` (`deleteShop`, 204) takes its service with
`Depends(..., scope="function")`, as the media routes do, so the dependency exits — and commits —
before the response is sent. The dependency yields the use case inside its own `session_scope`
and, once that block has committed, removes the directory of the shop the use case reports
deleted through `MediaStore.remove_shop`. A refusal, a failure and a commit that raises all leave
through the `with` and never reach the removal, so no file goes while a row could still name it,
and a failed commit is the request's 500, never a 204.

**The risk accepted**: a directory whose removal fails after the commit is left behind, holding
files no row names. It is never served, because serving reads the row first (ADR 0076); it is
logged by the shop's ID alone; and the delete has happened, so the request still answers 204.

**What this does not guard**: a write other than a publish or an upload — an order, a ticket or a
scenario created, a profile attached — whose read of the shop came before the delete committed and
whose write came after it can land one row naming a shop that has no draft. Such a row is never
listed: every listing is read under a shop the index no longer offers. It is reachable by its ID —
`OrderFixtureService.get_order`, `_require_ticket` and `_require_scenario` return a stored record
without asking whether its shop stands, so GET, the preview, the versions and a PUT on it answer
200 — and an orphan attachment shows through a profile's `attached_shop_count` and
`attached_shops`, which `create_profile(shop_id=…)` can make too. A draft PUT that races the
delete fails its update with `StaleDataError` and answers 500, harming no data. The lab has one
operator, who would have to delete a shop in one tab while writing to it in another, so this is
accepted. The follow-up that would close it is a claim primitive: a no-op `UPDATE` of the shop's
draft as the first write of every order, ticket, scenario and attach write — taking the write lock
and failing on a draft that is gone — or conditional inserts like the media claim (`INSERT … SELECT
… WHERE EXISTS` the draft). Neither is built here.

The ordering above relies on SQLite's single writer. Under PostgreSQL's READ COMMITTED, both the
guard and the publish's recheck would need the shop's draft row locked (`SELECT … FOR UPDATE`) for
a delete and a publish to exclude each other.

### The shops index's row is the only place a shop is deleted from

The index gains a last column holding the trash, "Delete {name}", `RemoveButton` with its `label`
as the catalog's Delete (ADR 0075). On a shop with a published version it is held — natively
`disabled`, its reason "A published shop is kept: its versions are what experiments are explained
by." in its `title` and in the line under the table its `aria-describedby` names (ADR 0063,
ADR 0075's held trash).

The confirm takes the row's place in the warm red (ADR 0060, ADR 0075): "Delete {name} and
everything it holds?", then what goes, counted from the shop's own listings — the draft's
products, `listShopOrders`, `listTickets`, `listScenarios` and `listShopMedia` — read once when the
confirm opens and never per row, ADR 0062's rule; *Delete it* waits for the count with its reason
beside it, and a count that cannot be read says so and lets the delete through, as ADR 0062 does,
because the lab decides whether the shop may go. Then "A deleted shop cannot be brought back.
Customers, identities and blocks it used are kept." The preference removes the second press
(ADR 0060). The delete is a write, so the notice waits for it: the row leaves the listing the page
holds, focus goes to the notice line, "Deleted {name} and everything it held.", and the listing is
read again. While the delete is in flight the row's trash is held, natively `disabled` with
"Deleting this shop…" (ADR 0063), so the row does not look idle and cannot arm the confirm again,
and one delete is in flight at a time. A refusal says the lab's sentence in an alert over the table
and walks the confirm back; when the trash cannot take focus back — held because the shop was
published meanwhile, or gone because it was deleted elsewhere — the alert takes it.

### The switcher after a delete

`/shops` mounts neither workspace, and each workspace's shop list — the shop workspace's, the
lab's and the lab surfaces' — is read when it mounts, so the switcher next drawn lists the shops
that remain. The stored last-visited shop is cleared with `forgetLastVisitedShop` when it names
the deleted shop, so no surface holds a dead identifier between reads; resolving it against the
list (ADR 0054) stays the guard for a shop deleted elsewhere.

## Departures

- **The shops index's trash**, which the prototype does not draw (`Workspace.dc.html` :178–196, a
  row with no action), on the operator's decision of 2 October 2026.
- **ADR 0060's exception** for a shop that never published, recorded here.
- **The use case is `ShopDeletionService`, not a method on `ShopService`** as the plan named it:
  `ShopService` is composed in some twenty places none of which deletes, and the deletion
  dependency yields only the deletion's ports.

## Consequences

- Settings' sentence (:3927, "A published shop version and a recorded run are never deletable")
  stays true.
- `DefinitionRepository` gains `draft_exists`; the one adapter answers it with a query.

## Verification

- `test_shop_deletion.py`: the enumeration; a never-published shop with a customer, an order, a
  ticket, a scenario and an image emptied from every table while another shop keeps its rows, the
  profile, identity and block kept, its directory gone; a published shop and a shop an experiment
  names refused with their files kept; a publish that read the draft before the delete committed
  refused with no version left, a delete after a publish refused, a publish after a delete finding
  no draft; an upload after the delete landing no row and no file; a failed commit answering 500
  with the directory kept; the directory removed only when another connection already reads the
  shop as gone; a refused delete removing nothing; a removal that fails leaving the directory and
  one warning naming the shop's ID; the use case's write order over fakes; the guarded statement
  and each repository's delete on a real store.
- `test_shop_api.py`: 204 then 404; 409 `shop_published` and its whole body; an unknown shop 404.
- `Shops.test.tsx`: the held trash with its reason; the confirm in the red, its counts read once
  when it opens and *Delete it* held until they answer, *Keep it* sending nothing; the second press
  deleting, the row gone, focus on the notice, the listing read again; the preference's one press;
  a refusal said and the row kept, focus on the alert after a 409 or a 404 and on the trash after a
  500; a count that could not be read said, and *Delete it* still deleting; the trash held while
  its delete is in flight and a second delete not sent; after a delete the switcher listing what remains, the
  remembered shop forgotten when it was the deleted one and kept otherwise.
- `shop-deletion.spec.ts`: a shop is created, given an image and an order, and deleted from the
  index through its confirm; its directory is gone and the switcher no longer offers it.
  `shop-publication.spec.ts` sees its published shop's trash held.

## Migration

None. One route and its contract; no table, column or stored value changes.
