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
  contract check beside Vitest and Playwright. Slice 43 says so.
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
  (snapshots are never deleted) stand; ADR 0077 records the exception for a shop that
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
first four slices are delivered, and their record is ADR 0076, its amendments for the shop's
library and for *Replace* and the thumbnails, ADR 0077, and their commits; what the last slice
stands on — the store, the reference, the table, the settings, the routes and their contract, the
write rule, the gate, the library the form picks from, the image drawn on the item, the frozen
version and the catalog, and the delete of a shop that never published — is there. Its one
remaining slice runs on a branch of its own:

- **43** makes the seed ship real images through ADR 0076's store. It needs nothing else.

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
  changed or deleted (ADR 0012, ADR 0019, ADR 0060); the only removal is ADR 0077's delete of a
  shop that never published, which takes the whole directory. A file no row claims is never
  served, because serving reads the row first, and goes with its shop's directory.
- **Only uploads are written.** A draft write whose media reference is not an image the shop
  holds is refused; a stored version's written references still read.
- **Served as an image and nothing else**, with its stored type, `nosniff`, a sandboxing
  `Content-Security-Policy`, `inline` and `immutable`, and logged by hash, type and size only.

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
