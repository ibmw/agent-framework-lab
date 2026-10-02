# UX plan — a product's images are files the shop holds

Status: proposed — 2026-10-02. Open slices only: a slice that lands is removed from this file.
Supersedes the 13 September plan, whose delivered Slices 1–8 and reread Slices 9–16 are in
`docs/history/PLAN-UX-2026-09-13.md`; the 20 September plan, whose delivered Milestone 8's goal
and acceptance criteria are in `docs/history/PLAN-UX-2026-09-20.md`; the 28 September plan,
whose delivered Milestone 9's are in `docs/history/PLAN-UX-2026-09-28.md`; and the 29 September
plan, whose delivered Milestone 10's are in `docs/history/PLAN-UX-2026-09-29.md`.

## Purpose and authority

`docs/PLAN.md` records what the lab holds; this plan records how the operator's workspace reaches
the design it was handed on 19 September 2026: the whole-workspace prototype in
`tmp/design-frames/Workspace.html`, its handoff `README.md`, and `form-decisions.md`. Since
2 October 2026 it also records how a product's images become files the shop holds — dropped,
browsed for or picked from the shop's own library, and replaced on their item — and how a shop
that never published is deleted with everything it holds (Milestone 11). The prototype draws
neither, so each of those slices writes its departure. Milestone 11 is the first milestone of
this plan that moves the backend, a contract and a migration. Read, in
order, `AGENTS.md`, `docs/product-direction.md`, `docs/architecture.md`, `docs/PLAN.md`'s delivery
rules, `docs/design-direction.md` (its *Authority* section settles which authority governs where the
prototype, the README and the codebase disagree), then a slice's brief and the ADRs it names.
ADR 0052 and ADR 0053 decide the model connection and the provider, and both are implemented;
ADR 0054 is the route scheme every slice is written against.

The plan sits under `docs/PLAN.md`'s delivery rules and changes none of them.

## What every slice observes

- **One branch, one slice.** Branch from an up-to-date `main`, land by fast-forward, delete the
  branch. The suggested branch name is given per slice.
- **The prototype is the frame.** A `Frames:` line names the screen by its line in
  `Workspace.dc.html` and the numbered frame under `tmp/design-frames/DEPRECADED/` where one
  still describes the surface's composition. Where the prototype, the README and the codebase
  disagree, `docs/design-direction.md`'s *Authority* section decides, and the slice writes
  the departure in one sentence. "The handoff is silent" is not a licence.
- **The primitive ships with its first consumers.** A component or a token no page uses is not a
  slice.
- **Behaviour tests first.** Vitest with React Testing Library for what the operator sees, MSW
  where HTTP participates, Playwright only where a covered journey changes. `make check` and
  `pnpm build` pass before handoff, and `pnpm test:e2e` when the *Checks* line names a spec.
- **No new UI dependency.** The primitives are the class sets in `lib/ui.ts` and the chrome in
  `components/WorkspaceChrome.tsx` and `shell/AppShell.tsx`. A drop zone and the operating
  system's file picker are the platform's own — `<input type="file">` and the drag events —
  and ADR 0076's `python-multipart` is the API's dependency, not the UI's.
- **No backend change unless the slice says so.** A slice that says so ships its contract, its
  persistence and migration, and its frontend consumer together, as `docs/PLAN.md`'s delivery
  rules require, and its *Checks* line names the backend tests, the migration test and the
  contract check beside Vitest and Playwright. Slices 42 and 43 say so; Slice 41 does not.
- **Standing decisions hold.** ADR 0044 refused a stored checklist and ADR 0045 removed the
  derived progress strip; ADR 0049 keeps the tours per surface; ADR 0051 asks about unsaved work
  once; ADR 0052 and ADR 0053 decide the connection and the provider; ADR 0054 decides the two
  modes and the routes, ADR 0055 the top bar — the switcher's menu, the one tour mount that
  reads the route, and Settings as a toggle over a remembered location — and ADR 0056 puts the
  listings a rail counts on the workspace, with the index reading the same one. Where a slice
  takes a decision of its own — a route scheme, a confirm policy, a preference — it writes an
  ADR.
- **Accessible names do not move casually.** `nav[aria-label="Shop workspace"]`, the tour
  anchors and every button's name are what eleven Playwright specs reach the app by — as is
  `nav[aria-label="Experiment lab workspace"]` beside it. A slice that renames one lists the
  specs it touched.

## Decisions already taken

Three things the prototype draws are decided outside this plan, so that no slice has to:

- **The lab is a mode, and the routes say so** — ADR 0054: the two modes, the `/lab` route
  scheme, the current-shop rule, the redirects, and what the shop rail lost. Landed; every
  slice below is written against the routes it left behind.
- **The overview's readiness card reads one listing** — `docs/design-direction.md`,
  *Navigation and chrome*. Built with the overview. The setup pages' checklist reads the shop's
  own gate and nothing else (ADR 0071).
- **A rail entry's count comes from the listing its index renders**, held by the workspace —
  ADR 0056, which also measured and refused the additive counts read. Landed.
- **Three of the five proposed preferences earn a consumer**, and the logo was built as a shop
  customization — `docs/design-direction.md`, *Proposals, not decisions*. Two landed with the
  settings zones, and how a timestamp is written and what a reset puts back are ADR 0058;
  confirm-before-delete landed with the confirm it governs (ADR 0060); the logo is ADR 0070.

Milestone 11's were taken by the operator on 2 October 2026, so that no slice has to:

- **Only a shop that never published, and so never ran an experiment, can be deleted** — and
  then everything it holds goes: its draft, its orders, its tickets, its scenarios, and its
  uploaded images with their directory. A published shop cannot be deleted and says why.
  ADR 0060 ("a published shop version and a recorded run are never deletable") and ADR 0019
  (snapshots are never deleted) stand; Slice 42's ADR records the exception for a shop that
  never published. The delete is offered on the shops index's row and nowhere else.
- **An image is dropped, browsed for, or picked from the shop's library** — the images already
  uploaded to this shop, reused without uploading them again.
- **Written references are refused outright.** Since ADR 0076, every media reference a draft
  write carries that is not an image the shop holds is refused, whatever the stored draft held.
  Stored versions and snapshots still read the written references they hold, and
  `catalog.product` still returns them, because a version is immutable. Narrowing what
  `PUT /api/v1/shops/{shop_id}/draft` accepts inside `v1` is accepted
  because the lab is in development and the operator decided it; ADR 0076 records it against
  `docs/api-and-schema-conventions.md`'s "never silently changes `v1`" (:16). The development
  database is reset and reseeded when ADR 0076 lands, by the steps it wrote into
  `docs/development.md`, and once more after Slice 43 to give the QA lab the seed's images.
- **An image keeps its original file name, for display only.** It names the image on the item
  and on its controls; it is never a path, never logged and never in telemetry. No pixel
  dimensions are kept.
- **An uploaded file is removed only with its shop.** No sweep on save and no button; a file
  any published version names is kept for as long as the version is, which is forever.
- **PNG, JPEG and WebP, told by their first bytes, at most 5 MiB** in a typed setting. No SVG
  and no GIF.
- **No uploaded logo in this milestone.** ADR 0070's *Deliberately not here* stands for the
  logo.

The assessment that produced this plan — the prototype read screen by screen against the
application, and the verdict on each slice of the 13 September plan — is
`docs/history/PLAN-UX-2026-09-13.md`.

## Sequencing

Milestones 8, 9 and 10 are delivered. Their record is the commits and ADR 0052–0074; their goals
and acceptance criteria are `docs/history/PLAN-UX-2026-09-20.md`,
`docs/history/PLAN-UX-2026-09-28.md` and `docs/history/PLAN-UX-2026-09-29.md`. Milestone 11's
first two slices are delivered, and their record is ADR 0076, its amendment for the shop's
library, and their commits; what every later slice stands on — the store, the reference, the
table, the settings, the routes and their contract, the write rule, the gate, and the library
the form picks from — is there. Its three remaining slices run in order, 41, 42 and 43, one
branch each:

- **41** gives the item *Replace* and draws the image wherever a reference is shown today. It is
  the frontend's only.
- **42** deletes a shop that never published. It needs ADR 0076's store to remove the directory
  and nothing of 41.
- **43** makes the seed ship real images through ADR 0076's store. It needs nothing else, and
  may land before 41 and 42 if the operator wants the QA lab's images sooner.

## Milestone 11 — A product's images are files the shop holds

### Goal

An operator giving a product an image drags a file onto the form, browses for one, or picks one
the shop already holds, and sees it — on the item, in the library, on the frozen version and in
the catalog — rather than typing a path to a file nothing serves. Every image is a file the shop
holds, stored by its content and never overwritten, so a published version and a snapshot keep
the exact bytes they were frozen with. An image is replaced on its item without retyping its alt
text. A shop that never published can be deleted, and its images go with it. The seed ships real
images. The operator asked for it on 2 October 2026, as a replacement of every media attachment
rather than a second way beside the old one.

The model every slice builds on, which ADR 0076 records with its reasons:

- **The reference stays a string.** A media entry is still `{reference, alt_text}`
  (`MediaReference`, `domain/shop.py:236–244`; `MediaReferenceSchema`, `openapi.yaml:8853`), and
  an uploaded image's reference is `asset:sha256:<64 lowercase hex>`. The payload's shape and its
  token (`application/shop_payload.py:63–65`) do not move, and `catalog.product`
  (`application/sandbox_tool_views.py:141–143`) returns the same `{reference, alt_text}`.
- **Storage is content-addressed.** The bytes live at `${media_root}/shops/{shop_id}/{sha256}`,
  written once and never overwritten; a row of `shop_media_assets(shop_id, sha256, content_type,
  byte_size, file_name, created_at)`, unique on `(shop_id, sha256)`, is the shop's claim on them.
  The same bytes uploaded twice are one image, under the file name of the first upload.
- **Nothing removes a file while its shop stands.** Published versions and snapshots are never
  changed or deleted (ADR 0012, ADR 0019, ADR 0060); the only removal is Slice 42's delete of a
  shop that never published, which takes the whole directory. A file no row claims is never
  served, because serving reads the row first, and goes with its shop's directory.
- **Only uploads are written.** A draft write whose media reference is not an image the shop
  holds is refused; a stored version's written references still read.
- **Served as an image and nothing else**, with its stored type, `nosniff`, a sandboxing
  `Content-Security-Policy`, `inline` and `immutable`, and logged by hash, type and size only.

### Slice 41 — Replace an image on its item, and see it wherever it is listed

An image is replaced on its item keeping its alt text, and the frozen version and the catalog
draw the image instead of a path.

- [ ] **Replace** on each item of the Media card, before the pencil: a verb that is neither Edit
  nor Remove, so it keeps its written word, as *Duplicate* does (ADR 0075), named "Replace {name}".
  It loads the form as "Replace {name}": *Image* the drop zone, *Browse…* and the library of
  ADR 0076, the current image marked and not choosable; *Alt text* the entry's, kept
  and editable; the submit *Replace image*. Refused after the buttons, in order: no other image
  chosen, an image another entry of this product holds, the alt text empty. Saving swaps the
  entry's reference where it stands, in its place in the list, and focus returns to the new
  item's *Replace*. The draft's change summary reads it as a removal and an addition
  (`domain/shop.py:918–926` keys the diff by reference); the published version keeps the old
  hash, and the shop keeps its file.
- [ ] **The frozen version** (`ShopVersionPage.tsx:148–158`) draws each entry as a 48px thumbnail,
  its alt text as `alt`, with the file name and the alt text beside it; a written reference a
  stored version holds stays code with no image.
- [ ] **The catalog** (`ProductsPage.tsx`) draws a product's first image as a 30px tile before its
  title, as the shops index draws a shop's logo tile before its name (`Workspace.dc.html` :181);
  a product without one draws no tile and no placeholder.
- [ ] `docs/design-direction.md`: the media clause of the list rule (:507) names *Replace*, and
  the *Departures* row *A product's images* gains the catalog's tile and the version's thumbnails.

Frames: `Workspace.dc.html` :842–846 (the catalog's Product cell: title and category, no image),
:181 (the shops index's logo tile, the tile's measure); methods handoff
`shop-details.template.html` :160–186 (the form below the list).

Authority: ADR 0051, ADR 0063, ADR 0074, ADR 0075, ADR 0076.

Departures to record: *Replace* and the thumbnails are drawn nowhere in the handoff, on the
operator's decision of 2 October 2026; the catalog's tile beside the title, which the prototype
draws for a shop's logo and not for a product.

Backend change: none. Replace is an upload through `uploadShopMedia` and a draft save.

Branch: `feat/replace-media-and-thumbnails`. Checks: Vitest — `App.test.tsx` *media references*
(:3076) for *Replace* (the alt text kept, the image swapped in place, each refusal in order,
focus returned, the prompt for a chosen image), *shows a published version as read-only frozen
content* (:1635) for the thumbnails and a stored written reference's code, and the catalog's
tests (:5146, :5188, the row actions :6309) for the tile and its absence. Playwright —
`shop-publication.spec.ts` reads the frozen version back (:133) and now sees the image Slice
the spec's media step uploaded, by its alt text; no accessible name a spec reaches moves.

Slice evidence: on a product, the operator presses *Replace* on an image, drops another, keeps
the alt text, and saves; the item shows the new image in the same place; the published version
still shows the old one; the catalog row shows the product's first image beside its title.

### Slice 42 — A shop that never published can be deleted

The shops index deletes a shop that never published, with its draft, orders, tickets, scenarios
and images; a published shop is refused and says why.

- [ ] Write ADR 0077 (the next free number after ADR 0076; check `docs/adr/` at branch time) with
  the slice. It amends ADR 0060 with the lab's first delete of a whole definition: a shop with no
  published version — and so no ticket or scenario version, no snapshot and no experiment, each of
  which needs a published shop version (ADR 0012, ADR 0016, ADR 0019) — can be deleted whole. The
  service checks both conditions the operator named, no published version and no experiment
  naming the shop. What goes: the shop's draft, the drafts of its tickets and scenarios
  (`definition_drafts` by `shop_id`), its orders (`shop_order_fixtures`), its attachments
  (`definition_shop_attachments`), its media rows and its directory. What stays: the
  shop-independent definitions it had attached — profiles, identities, blocks, configurations and
  judges. It accepts one risk: a directory whose removal fails after the commit is left behind,
  holding files no row names, never served, and logged by shop ID. ADR 0060's sentence on a
  published shop version and ADR 0019 stand.
- [ ] **Application.** `ShopService` (`application/shops.py:90`) gains `delete_shop(shop_id)` over
  ports declared in `application/`. Its first write is one conditional statement — delete the
  shop's draft where no published version of it and no experiment naming it exists — and the rest
  follow only when that one removed a row; otherwise it answers 404 for an unknown shop and 409
  `shop_published`, naming how many versions, for a published one. SQLite's single writer orders
  it against a publish: a publish that commits first makes the delete's condition false, and a
  publish after it finds no draft. An upload racing it lands no row, because the media insert is
  conditional on the draft too (ADR 0076). A repeated delete answers 404, as an order's does.
- [ ] **The directory goes after the commit.** The route's dependency (`presentation/api.py:1866`
  opens a `session_scope` per service; `infrastructure/database.py:35–42` commits when it exits)
  gains a deletion dependency that yields the use case inside its own `session_scope` and, after
  that block has committed, removes the directory of the shop the use case reports deleted through
  `MediaStore`. Nothing is removed when the scope rolls back.
- [ ] **Infrastructure.** The repositories in `infrastructure/repositories.py` gain the deletes the
  ports declare, each on its own tables; no schema change and no migration.
- [ ] **Route and contract.** `DELETE /api/v1/shops/{shop_id}` (`deleteShop`, 204; 404; 409 with
  `shop_published`), registered as the order's is (`presentation/orders.py:495–503`); the
  contract and its types regenerated.
- [ ] **The shops index** (`ShopsPage.tsx:120`, a row :183) gains a last column holding the trash,
  "Delete {name}" (ADR 0075, as the catalog's `RemoveButton` with its `label`,
  `ProductsPage.tsx:298`), the only place a shop is deleted from. On a shop with a published
  version it is held (`RemoveButton`'s `held`, `components/ItemList.tsx:166–193`; ADR 0063): "A
  published shop is kept: its versions are what experiments are explained by." The confirm takes
  the row's place in the warm red (ADR 0075), "Delete {name} and everything it holds?", its
  consequence counting what goes — products, orders, tickets, scenarios, images — from the shop's
  listings and `listShopMedia`, read once when the confirm opens and never per row (ADR 0062's
  rule), and saying "Customers, identities and blocks it used are kept." The preference removes
  the second press (ADR 0060). After it the row goes and the notice line takes focus.
- [ ] **The switcher after a delete.** The index reads its listing again (`useShops`,
  `ShopsPage.tsx:91`). The other shop lists read on mount — the shop workspace's
  (`refreshShops`, `shell/ShopWorkspace.tsx:69`), the lab's (`shell/LabWorkspace.tsx:125`) and
  the lab surfaces' (`shell/useLabSurface.ts:22`) — and `/shops` mounts neither mode, so the
  switcher next drawn lists the shops that remain. The stored last-visited shop is cleared with
  `forgetLastVisitedShop` (`lib/preferences.ts:79`) when it names the deleted shop, so no surface
  holds a dead identifier between reads; resolving it against the list (ADR 0054,
  `useLabSurface.ts:44`) stays the guard for one deleted elsewhere.
- [ ] `docs/design-direction.md`: *Removing is deliberate* names the shop's delete, and a
  *Departures* row says the prototype's shops index draws no row action; `docs/architecture.md`
  says a definition is never deleted except a shop that never published (ADR 0077).

Frames: `Workspace.dc.html` :148–200 (the shops index; a row :178–196, no row action), :3927
(Settings' "A published shop version and a recorded run are never deletable").

Authority: ADR 0012, ADR 0019, ADR 0054, ADR 0060, ADR 0062, ADR 0063, ADR 0075, ADR 0076.

Departures to record: the shops index's trash, which the prototype does not draw, on the
operator's decision of 2 October 2026; ADR 0060's exception for a shop that never published, in
ADR 0077.

Backend change: yes — a use case, repository deletes, a deletion dependency and a route with its
contract; no migration.

Branch: `feat/delete-unpublished-shop`. Checks: backend — a new `test_shop_deletion.py`: it
enumerates every mapped table with a `shop_id` column from `Base.metadata` and asserts each holds
no row for the deleted shop — emptied, or provably empty for a shop that never published
(`definition_versions`, `sandbox_snapshots`, `sandboxes`, `sandbox_action_proposals`,
`experiments`, `experiment_runs`) — and still holds the other shop's; the attached profile,
identity and block kept; a published shop refused; a shop an experiment names refused; a publish
and a delete racing, one winning; an upload after the delete landing no row; the directory removed
after the commit and kept when the scope rolls back. `test_shop_api.py` (204, then 404; 409 and
its body). `test_migrations.py`'s `test_model_metadata_matches_migrated_schema` (:535) unchanged
and green. Contract — `make check-contracts` and `test_api_contract.py`. Vitest — the shops
index's tests (`Indexes.test.tsx`, `App.test.tsx`) for the trash held with its reason, the
confirm and its counts, the preference, the focus after; a new test that after a delete the
switcher lists the remaining shops and the last-visited shop is forgotten when it was the deleted
one; `App.test.tsx` *opens on the shops index when the remembered shop is no longer there*
(:5332). Playwright — a new `shop-deletion.spec.ts`: a shop is created, given an order and an
image, and deleted from the index through its confirm; and `shop-publication.spec.ts` sees its
published shop's trash held.

Slice evidence: on the shops index, the operator presses the trash on a shop never published;
the confirm counts its orders and images; *Delete* takes the row away, the switcher no longer
offers it, and the shop's media directory is gone. A published shop's trash says why it is kept.

### Slice 43 — The seed ships real images

The seed's catalog carries real images, stored through the same service an upload uses.

- [ ] Four small images, made for the lab — flat drawings with no photograph and no third-party
  work in them, so their licence is the repository's — each under 16 KiB, at
  `apps/api/src/capability_lab/presentation/seed/images/`, named after the products and colours
  they show: `alpine-shell-ocean-blue.jpg`, `alpine-shell-detail-seams.jpg`,
  `fjord-base-layer-slate.png` and `harbour-dry-bag-sand.webp`, so the seed exercises all three
  types. The file name each upload keeps is that name.
- [ ] `presentation/seed/content.py` names each product's images by file and alt text, the alt
  texts kept (:233–240, :313–318, :372–377). `_shop` (`presentation/seed/demo.py:137`) creates the
  shop, uploads each file through `ShopMediaService.upload` — never the route: the seed reaches
  the world through application services (ADR 0043) — writes the draft with the references the
  uploads returned, and publishes. `SeedServices` (`presentation/seed/services.py:81`) and
  `build_services` (:105) gain the service composed from `Settings.media_root`, which
  `run_seed` and the lab seed route (`presentation/lab_seed.py:79–90`) already hold.
  `SEEDED_TABLES` (`presentation/seed/runner.py:84`) counts `shop_media_assets` already, being
  derived from the mapped metadata.
- [ ] The refusal (`DatabaseNotEmptyError`, `runner.py:104–115`) names the media root beside the
  database file, as `docs/development.md`'s reset does since ADR 0076. The seed still never
  wipes, truncates or reseeds (ADR 0043, ADR 0047). The operator runs that reset once more when
  this slice lands, so the QA lab carries the seed's images.
- [ ] *Use an example shop* (`ShopsPage.tsx:403`) fills the create form's fields and creates
  nothing; it holds no image and is unchanged. The shop with a catalog and images is the seed's.

Frames: none; no surface moves.

Authority: ADR 0043, ADR 0047, ADR 0076.

Departures to record: none.

Backend change: yes — the seed's content, its composition and four committed images; no route,
contract or migration.

Branch: `feat/seed-ships-images`. Checks: backend — `test_demo_seed.py`
*the seeded shop carries the content the studio screens read* (:431) puts `product.media` back
(:442) and asserts each reference is an image the shop holds whose bytes hash to it, under its
file name; *refuses a database that already holds one* (:458) for the message; *runs the whole
story with the network removed* (:570) with a temporary media root; `test_lab_seed_api.py` (:74,
:93) the same, through `api_client`'s `tmp_path` root; a test that the four images ship inside the
package (`importlib.resources`), so a built wheel seeds too. No Vitest or Playwright spec seeds
the lab, and none changes.

Slice evidence: on a fresh database, `make migrate && make seed`; the seeded shop's catalog shows
the Alpine Shell Jacket's image beside its title, its editor's Media card both images named by
their files, and its version 1 page the same; the history run reads as before.

### Acceptance criteria

- A media entry is added by dropping a file, browsing for one, or picking one from the shop's
  library, and only as an uploaded image; a written reference is refused on every write and still
  reads wherever a stored version holds it.
- Every image is stored once per shop under its hash, never overwritten, and served with its own
  type and the headers ADR 0076 names; PNG, JPEG and WebP only, at most the cap, refused at the
  route before an oversized body is parsed.
- An image is named by its original file name, cleaned, which is never a path, a log line or a
  span attribute.
- A draft holding a media reference that is not a held image cannot publish.
- *Replace* swaps an entry's image and keeps its alt text, and the published version keeps the
  old one.
- The editor's items, the library, the frozen version and the catalog draw the image.
- A shop that never published is deleted from the shops index with its draft, orders, tickets,
  scenarios and images; a published one is refused with the reason, and its files are kept.
- The seed ships real images through the store; the reset is documented and run by the operator,
  and nothing in the lab wipes.
- ADR 0076 and ADR 0077 record the decisions; every contract, migration and setting ships with its
  consumer; no test writes under the checkout's `var/`; the Playwright journeys pass, each worker
  with its own media root.

## Deliberately not here

- **Any reading of what the lab still lacks across listings.** ADR 0044 and ADR 0045 stand; the
  overview's readiness card reads one listing and says one sentence, and the setup checklist
  reads the shop's own gate only (ADR 0071).
- **Checklist lines in an editor's Publish gate card.** The card is a frame over the findings
  `IssueList` draws; only the setup pages carry lines (ADR 0071).
- **Counts on History's status chips.** The listing carries none.
- **Auto-offered tours and table density.** Neither preference decides anything a surface reads;
  ADR 0049 refused the first outright.
- **A model on the connection, a masked key, a per-configuration endpoint.** Refused in ADR 0052
  and ADR 0053 with the reasons; the prototype's rows for them are departures already recorded.
- **Merging the three document lists in the payload.** The Documents table is a presentation of
  three lists and not a new canonical shape; `lib/documents.ts` writes every row back into the
  collection it came from, and a document is named by its kind and its slug (ADR 0057).
- **The next-step sentence from `SETUP_CHAIN`**, `GuideProse` card footers, the matrix's per-cell
  evidence sentence and a copy control on `Fingerprint` — the parts of the old Slices 13 and 16
  the prototype does not draw.
- **A component library or a new UI dependency.** The `CreatePage` layout, `ConfirmRemove` and
  `ActionStatus` are small components on the existing chrome, as the switcher's panel was.
- **The product's variants, a scenario's composed blocks, the create pages' rows and a ticket's
  thread in the form below them.** Outside Milestone 10 as the operator scoped it; they keep
  `EntryCard` and `EntryEditButtons`, and the thread its composer (ADR 0073).
- **Read-only version pages for configurations and scenarios.** The results link a pinned
  version to its definition's editor (ADR 0068); a frozen view per definition is worth its own
  slice in `docs/PLAN.md` if a review journey needs it.
- **An uploaded shop logo.** ADR 0070 keeps the logo a drawn mark on a chosen ground; Milestone 11
  stores a product's images and nothing else.
- **Removing an image from the library, or a sweep of the ones no entry names.** A file goes with
  its shop and only then, and a published version's are kept for as long as it is.
- **Converting the written references a stored version holds, accepting them on write, or
  migrating the QA lab.** A version is immutable, so they still read; the lab is reset and
  reseeded instead (ADR 0076 and Slice 43).
- **SVG, GIF, resizing, cropping, generated thumbnails or pixel dimensions.** The browser scales
  the stored bytes; the file name is kept for display only.
- **Deleting a shop from anywhere but its row on the shops index.**
- **The image in what an agent, a tool result or a judge reads**, beyond the reference string
  `catalog.product` already returns.
- **Deleting a published shop, a version, a snapshot or a run.** ADR 0060 and ADR 0019 stand.
- ***Use an example shop* creating a catalog.** It fills the create form; the shop with a catalog
  and images is the seed's.
