# ADR 0076 — A product's images are files the shop holds

Status: accepted — 2026-10-02

Amendment: 2026-10-02 — The shop's library (Slice 40b). Under the drop zone in *Image*, "This
shop's images" is a radio group of every image the shop holds, newest first, each a 72px tile
whose radio is named "{file name}, {type}, {size}" — the file name told apart by its hash's first
eight digits where two of the shop's images share it. It is read when the card opens and again
after every upload, the upload put first at once so it is chosen in it before the listing
answers, and only the latest read lands. Picking one fills *Image* as an upload does and sends
nothing, so one image serves several products. An image this product's entries show is marked
"Already an image of this product" and is `disabled`, not `aria-disabled` as the picker is while it
uploads: the picker is unavailable for a moment under a reader's focus, a held image for the
whole of the form's filling, and a native group's arrow keys pass over a disabled radio and would
check an `aria-disabled` one. A held radio is never checked, not even when an upload the lab
answers with bytes this product shows puts it in the form: Chromium and Firefox give a radio
group whose checked radio is disabled no tab stop at all, so the keyboard would lose the library.
The drop zone shows that image and the form's own refusal says why. When this product shows
every image the shop holds, a line under the group says so. A pick made while an upload runs is the
form's choice: the upload lands in the library and is not chosen over it, and an upload started
after a pick takes the form's choice in turn. An empty library says "No image uploaded to this
shop yet." only once a listing has said so; one that cannot be read says so in the lab's words,
and the drop zone uploads all the same. While an entry is edited its image is fixed, and the
library is not drawn.

Amendment: 2026-10-02 — *Replace* and the image wherever it is listed (Slice 41). Each item of
the Media card carries *Replace* before its pencil, a written verb named "Replace {name}", as
*Duplicate* keeps its word (ADR 0075). It opens the same form as "Replace {name}" on the entry,
its alt text kept and editable and focus on *Browse…*: the drop zone shows the entry's image
until another is chosen, and takes a file, and the library is drawn, the entry's own image
marked as every image this product shows is and so not choosable. The submit is *Replace
image*, refused after the buttons, in order: no other image chosen ("Choose another image to
replace this one with."), an image another entry of this product shows, the alt text empty.
Saving swaps the entry's reference where it stands, in its place in the list, and focus goes
to the new item's *Replace*; *Cancel* hands it back to the *Replace* that opened the form. An
upload or a refusal that answers after the form was cancelled, opened on another entry or
given another image is dropped, as it is from an add. The old image stays the shop's and is
offered again by the library once no entry shows it; a published version keeps the old hash,
and the draft's change summary reads the swap as a removal and an addition, because the diff
keys an entry by its reference. The frozen version draws each entry as a 48px thumbnail, its
alt text as `alt`, with the file name — read from the shop's images, as the Media card names
its items — and the alt text beside it; a written reference a stored version holds stays code
with no image. The thumbnail is drawn from the reference alone, since the publish gate let a
published version name only images the shop held and nothing removes one; only the file name
waits for the listing, and the short hash names the image until it answers or if it cannot. The
catalog draws a product's first uploaded image — the first entry that is one, past any written
reference — as a 30px tile, rounded as the shops index's logo tile is, before its title,
decorative because the title beside it names the row; a product with no uploaded image draws no
tile and no placeholder. The catalog reads no listing for it: a draft write takes only images
the shop holds and nothing removes one while the shop stands.

Amendment: 2026-10-03 — Why the claim is one statement. The paragraph "It is not a savepoint"
below gave pysqlite's early commit of a first-write savepoint as the reason; ADR 0003's amendment
of this date removes that early commit, and `attach`'s with it. The statement stays, and its reason
is now its own: one `INSERT … SELECT … WHERE EXISTS … ON CONFLICT DO NOTHING` checks the shop's
draft and absorbs a duplicate inside the same write, which holds SQLite's write lock from its
start, so an upload racing its shop's deletion lands nothing and an upload losing a race on the
same hash has no refused insert to recover from. A savepoint would need the draft read as a
separate statement and an `IntegrityError` to roll back to. The claim stays inside the request's
transaction and is rolled back with it, as the paragraph says.

Supersedes ADR 0013's "Media stores URL/reference metadata only; managed binary upload remains
deferred" (:46), and the two sentences of `docs/product-direction.md` that deferred managed
upload. ADR 0070's *Deliberately not here* stands: the shop logo stays a drawn mark.

On 2 October 2026 the operator asked that a product's media stop being a path typed into a field
that nothing serves, and become an image the shop holds: dropped on the form, browsed for with
the operating system's picker, or picked from the images the shop already holds, and shown on its
item, the frozen version and the catalog. It is a replacement of every media attachment, not a
second way beside the old one. Milestone 11 of `docs/PLAN-UX.md` delivers it in five slices; this
record is written with the first, which lays down what the others stand on.

## Decision

### The store: content-addressed, written once, never overwritten

An image's bytes live at `${media_root}/shops/{shop_id}/{sha256}`, where `sha256` is the SHA-256
of the bytes. `application/shop_media.py` declares the port, `MediaStore` (put bytes under a
shop's `UUID` and a hash, open them, remove a shop's directory); `infrastructure/media_store.py`
is its filesystem adapter, `FilesystemMediaStore(root)`, and composition chooses the root from
`Settings.media_root` (`./var/media`, `AGENT_LAB_MEDIA_ROOT`).

The adapter writes the bytes to a temporary file in the shop's own directory, flushes and syncs
it, then `os.link`s it to its hash's name and unlinks the temporary file whether or not the link
succeeded. `os.link` refuses a name that exists, so a file already there is kept exactly as it was
— the inode and the bytes of the first write — where `os.replace` would swap it. Nothing ever
reads a half-written image under its hash. A hash that is not 64 lowercase hex digits is refused
before a path is built, and the shop's directory is named by the `UUID`'s own rendering, so
neither can name anything but one file in one directory.

A row of `shop_media_assets(shop_id, sha256, content_type, byte_size, file_name, created_at)`,
keyed on `(shop_id, sha256)`, is the shop's claim on the bytes. The same bytes uploaded twice are
one image, under the file name of the first upload. The repository's insert is one conditional
statement — `INSERT … SELECT … WHERE EXISTS` the shop's draft `ON CONFLICT DO NOTHING` on the
key: an upload racing the deletion of its shop lands no row, and an upload that loses a race on
the same hash lands nothing and reads back the row the key kept. The repository answers whether
its own statement inserted the row, so a repeat is told by the claim and never by a clock.

It is not a savepoint, as attaching a profile is, though Milestone 11's plan asked for one. Under
pysqlite a `SAVEPOINT` opened before any other write in the request *begins* the transaction, and
its `RELEASE` then commits it: the claim would be committed before the bytes were written, and a
failed write could no longer take it back. `ON CONFLICT DO NOTHING` (SQLite 3.24 and PostgreSQL
alike) keeps the claim inside the request's transaction. `attach` has the same shape and is left
as it is; it holds no claim anything else depends on.

The upload claims the row first and writes the bytes second, so an unknown shop writes nothing —
writing first would let any UUID fill the disk — and a write that fails rolls the claim back with
the request's transaction. The media routes take their session with
`Depends(..., scope="function")`, so the transaction commits when the handler returns and
**before** the response is sent: a commit that fails is the upload's 500, never a 201 for a claim
that was then lost. What a failed commit leaves is the file it had just written and no row naming
it, which is harmless: serving reads the row first and never serves it, a later upload of the same
bytes claims it again, and it goes with its shop's directory.

### The reference: `asset:sha256:<hex>`, and why the payload token does not move

A media entry is still `{reference, alt_text}` (`MediaReference`, `MediaReferenceSchema`), and an
uploaded image's reference is `asset:sha256:<64 lowercase hex>`. `MediaAssetReference` in
`domain/shop.py` renders and parses that spelling and refuses any other; `MediaReference.asset`
is the hash, or none for a written reference. `MediaReference` still takes any text, so a stored
version that holds a written reference still reads.

The payload's shape and its canonical tokens (`shop-payload-v1` to `-v3`, which the logo
chooses, `application/shop_payload.py`) do not move: the entry is the same two strings, and only
what one of them may say on write narrowed. A version's content
fingerprint already covers the reference, and because the hash is inside the reference the
fingerprint covers its images' bytes too — two versions naming different bytes have different
fingerprints, with no new field to say so. `catalog.product` returns the same
`{reference, alt_text}` an agent always read.

### Only uploads are written, and the gate holds the rest

`ShopService.replace_draft` refuses every media entry whose reference is not a row the shop holds
— a written reference included, whatever the stored draft held — with 422 `media_not_uploaded`
and one `details` entry per refused entry, at its path `products.{handle}.media.{reference}`.
Stored versions and snapshots keep reading the written references they hold, because a version
is immutable (ADR 0012, ADR 0019).

The preview and the publish gate raise `media_asset_missing`, an error, at the same path for an
entry whose reference is not a held image — a draft saved before this rule, or one whose row went
away. It is `ShopService._validate`'s finding rather than `validate_shop`'s, because only the
shop's rows can answer it; `product_without_media` stays a warning, and now says "has no image".
The frontend mirrors the sentence character for character and sends the finding to the
product's Media card.

**Narrowing `PUT /api/v1/shops/{shop_id}/draft` inside `v1`.**
`docs/api-and-schema-conventions.md` says a breaking change "never silently changes `v1`" (:16).
This one is not silent — it is this record, the contract's rewritten description of
`MediaReferenceSchema.reference`, and the reset in `docs/development.md` — and it is accepted
inside `v1` because the lab is in development, has one operator and no other client, and the
operator decided it. The development database is reset and reseeded rather than migrated: a lab
whose shops carry written references would refuse every save of their drafts.

### Removed only with its shop

Nothing removes a file while its shop stands: no sweep on save, no button, and a file any
published version names is kept for as long as the version is, which is forever (ADR 0012,
ADR 0019, ADR 0060). The only removal is Milestone 11's delete of a shop that never published,
which takes the shop's whole directory after its rows (ADR 0077, to come). A file no row claims
is harmless, for the reason above.

### The file name, for display only

The original file name names the image on its item and on its controls ("Edit
ocean-blue-front.jpg"), and nothing else: it is never a path, never logged, never a span
attribute and never in an error body. It is cleaned as a label: the last path component only,
whichever separator the sending system used; control and format characters stripped — a
right-to-left override would make `gpj.exe` read as `exe.jpg`, so format characters go with the
control characters the plan named; outer whitespace stripped; capped at `MAX_LABEL_LENGTH`; and a
name left empty, `.` or `..` becomes `image.{ext}`. When two entries of one product carry the
same file name, each is named "{file name} ({first eight hex of its hash})". No pixel
dimensions are kept.

### Three types, told by their first bytes, and a cap

PNG (`89 50 4E 47 0D 0A 1A 0A`), JPEG (`FF D8 FF`) and WebP (`RIFF····WEBP`), told by the first
bytes and nothing else — not the name, not the declared type, so a PNG named `.gif` is a PNG.
Anything else is 415 `media_type_unsupported`. Not SVG, because an SVG is a document that can
carry script, and the lab would be serving it from its own origin; not GIF, which is neither a
photograph's format nor a drawing's any longer and would bring animation the lab has no use for.

At most 5 MiB, `Settings.media_max_bytes` (`AGENT_LAB_MEDIA_MAX_BYTES`). The route refuses on
the request's `Content-Length` before the multipart body is parsed: 411 when there is none, 413
`media_too_large` when it exceeds the cap plus 64 KiB of multipart overhead. The service counts
what it reads all the same, reading at most the cap and one byte more, so a length that lied buys
nothing. The header is read as ASCII digits only; anything else is 411.

What the route's check does not bound: uvicorn reads a request with both `Transfer-Encoding:
chunked` and `Content-Length` as chunked under h11, so a small declared length does not limit the
body there (httptools, which `uvicorn[standard]` installs and uvicorn prefers, answers that
combination 400). And Starlette spools a file part — in memory to 1 MiB, then to a temporary
file — before the service reads a byte of it, so the service's cap refuses such a body after it
has been received, not before. `python-multipart` is the API's dependency for that one route.

### Served as an image and nothing else

`GET /api/v1/shops/{shop_id}/media/{sha256}` reads the row first — 404 for a malformed hash, for
one another shop holds and for one this shop does not — and serves the stored type with:

- `X-Content-Type-Options: nosniff`, so the browser keeps to the stored type;
- `Content-Security-Policy: default-src 'none'; sandbox`, so the response opened as a document
  runs nothing and loads nothing;
- `Content-Disposition: inline`, shown rather than downloaded;
- `Cache-Control: public, max-age=31536000, immutable`, because a hash's bytes never change;
- the hash as its `ETag`.

The upload is logged by its hash, its type and its size only.

### The hash is the upload's idempotency key

`POST /api/v1/shops/{shop_id}/media` asks for no `Idempotency-Key`
(`docs/api-and-schema-conventions.md`:11). The hash of the bytes names exactly one image and can
be stored exactly once, as ADR 0022's confirmation is the hash of the change it confirms: a key
the caller chose could collapse two different uploads into one, and the hash cannot. A repeat
answers 200 with the image as first uploaded, a first upload 201.

### The routes

`uploadShopMedia` (multipart field `file`), `listShopMedia` (newest first, which the Media card
reads to name and describe its items) and `getShopMedia`, in `presentation/shop_media.py`, under
`/api/v1` — the prefix Vite proxies. `ShopMediaAssetSchema` carries `reference`, `sha256`,
`content_type`, `byte_size`, `file_name` and `created_at`.

### The Media card

The product editor's card is titled *Media* (ADR 0074's pattern). Each item leads with a 48px
thumbnail whose `alt` is the entry's alt text — the item's `lead`, which ADR 0074 gave to a
control, holds an image here — is named by its file name, and says its alt text, type and size.
The form, "Add an image" / "Edit {name}", asks *Image* and *Alt text*. *Image* is a drop zone
saying "Drop an image here" over a visually hidden `<input type="file">` reached by its *Browse…*
label, so the keyboard and a screen reader open the system's picker; a file is checked against the
mirrored types and cap, uploaded at once and chosen, and "Uploading…" or the lab's refusal in its
own words is said under the zone in `ActionStatus`. While an entry is edited its image is shown
and fixed. The form is unsaved work while it holds a chosen image or typed alt text (ADR 0051);
the uploaded file is the shop's already, so leaving loses the entry and not the image. Neither the
drop zone nor the picker is in the handoff; both are built on the operator's decision, a
departure `docs/design-direction.md` records.

### Why 40a and 40b are two slices

40a lays down everything the milestone stands on — the store, the reference, the table, the
settings, the three routes and their contract, the write rule and the gate — with the one consumer
that proves them, the drop zone and the picker. 40b adds the shop's library to the same form,
reading 40a's `listShopMedia` with no backend change. Together they would be one branch moving a
contract, a migration and two form controls at once; apart, each is reviewable and the second is
the frontend's only.

### What the later slices do on this

- *Replace* (Slice 41) is an upload through the same route followed by a swap of the entry's
  reference where it stands, keeping its alt text. The draft's change summary reads it as a
  removal and an addition, because the diff keys an entry by its reference; the published version
  keeps the old hash and the shop keeps its file.
- The seed (Slice 43) stores its images through `ShopMediaService.upload`, never the route, so the
  seed reaches the world through application services as ADR 0043 requires: four flat drawings
  shipped in the package, one per type the lab stores, each keeping its file name.

## Consequences

- Every write of a shop draft reads the shop's media rows. They are few per shop, and the read is
  one indexed query.
- A test composes its media root under its own temporary directory: the API suite's environment
  points `AGENT_LAB_MEDIA_ROOT` there, `api_client` hands one to `create_app`, and a test that
  leaves a file under the checkout's `var/media` fails. Each Playwright worker has a media root
  of its own under the run's prefix, which the teardown removes recursively.
- `product()` and `publishable_shop()` in the test factories keep their written reference byte
  for byte, so the recorded fingerprints taken over them hold; a suite that saves through
  `ShopService` saves `saved_shop()` or uploads first.
- The QA lab is reset when this lands, by the steps in `docs/development.md`, and once more when
  the seed ships its images.

## Deliberately not here

- An uploaded shop logo (ADR 0070).
- Removing an image from the library, or a sweep of the ones no entry names.
- Converting the written references a stored version holds, or accepting them on write.
- SVG, GIF, resizing, cropping, generated thumbnails or pixel dimensions: the browser scales the
  stored bytes.
- The image in what an agent, a tool result or a judge reads, beyond the reference string.
