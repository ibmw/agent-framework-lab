# ADR 0061 — A product is held by a key the browser gives it, and its address follows it

Status: accepted — 2026-09-26

Settles what ADR 0060 deferred: how the product editor tracks one product across renames,
deletes, duplicates and discards, before *Slice 21 (remainder)* builds Delete and Duplicate on it.
The acceptance list is `docs/history/2026-09-25-product-identity-reproductions.md`.

Records five decisions: a product in the shop draft carries a **client key** that never reaches
the lab; a **keyring** from saved handle to key is what gives a re-read draft back the same keys;
the address stays the handle and **follows** the key, and the editor route is keyed by it — and
the unsaved-work guard lets the editor move its own address; the handle follows the title **only
from the Title's own edit, and only while it is the title's**; and the product lists' removal
scope is the key.

## Context

A product's handle is its address, the draft's lookup key and — through `DerivedIdField` —
something that moves with the title. The editor is one unkeyed page that finds its product by a
remembered handle and, when that vanishes, by its position (`slot`), on the stated assumption that
"nothing renames, adds or reorders products behind this page". A discard renames behind it, and
Delete and Duplicate add and remove. Three schemes built on that — position, remembered handle,
re-anchored visit — each let an armed Delete land on another product (ADR 0060).

Two defects are on `main` without any Delete. The page looks its product up by handle, so a
discard that undoes a rename draws "Product not found" for one commit, which unmounts the cards
and every open row (S10, S3). And `DerivedIdField` reports its suggestion on mount, so opening a
product whose handle is not its title's slug renames it and dirties the draft (S8).

The lab stores a product as its handle and nothing more (`domain/shop.py` `Product`), and
requires the handles of one shop to be unique. So between two writes, **a saved handle already
names exactly one saved product**; what is missing is a name for it that survives the operator
changing the handle before the next write.

## Decision

### A product in the draft carries a key, and the key never leaves the browser

The shop workspace holds its draft as `ShopDraft`: the contract's `ShopContentSchema` whose
products each carry `key: string`. The key rides inside the product object, so every edit that
spreads a product (`{ ...product, title }`) keeps it by construction, a removal takes it with the
product, and a new product or a copy (the product's Duplicate, *Slice 21 (remainder)* in
`docs/PLAN-UX.md`) is given a fresh one at the moment it is appended.
`toPayload` strips it with the derived ratings, so no request, canonical document, fingerprint or
contract sees it. Draft lookups (`findProduct`, `replaceProduct`) go by key; the handle is data.

**No contract change.** A persisted product id would change the payload, the canonical JSON and
every fingerprint, and need a migration of stored drafts and published versions — to solve a
problem that exists only in one browser tab editing a draft. The lab's saved handle is already a
unique name between writes; the client only needs to remember which key it gave to it.

### The keyring gives a re-read draft back the same keys

Beside the draft, per shop, the workspace keeps a **keyring**: saved handle → key, plus the set of
keys this load has minted. It is the only place keys are joined to what the lab holds:

- **Every draft that comes from the lab is keyed through it** — the first read, a save's echo and
  a discard's re-read. A handle the keyring knows gets its key; one it does not gets a new key.
- **Every write that lands rewrites it** from the keyed products that were *sent*: each written
  handle maps to its product's key, and handles not written are dropped. It is rewritten in the
  write's own continuation, the moment the `PUT` answers, before the preview read and whether or
  not the echo is applied — so a save that raced a keystroke (R8), or whose preview read failed
  (S5), still records the rename that landed.
- **A write the lab refused** — a 4xx answer (R6) — wrote nothing and leaves it untouched.
- **A write whose outcome is unknown** — a lost answer, a network error, a 5xx — may have landed
  or not, and a keyring that guessed either way could give one product's key to another: after
  such a write lands a rename onto a handle another product gave up, the old record hands the
  renamed product's key to whichever product the lab now holds under that handle. So the
  keyring keeps **only what is true both ways**: an entry whose handle the write sent under the
  same key the record already gave it (`old.get(h) === key sent under h`) — the lab holds that
  product under that handle whether the write landed or not — and drops every other. The next
  read keys the dropped products afresh, and a page whose product that read no longer names by
  its key leaves for the catalog rather than show another product; a write that renamed nothing
  drops nothing, and Discard stays where it is.

The keyring assumes this tab is the lab's only writer between two reads. Another tab, or a tool,
swapping handles behind it is out of scope — it is no worse than `main`, which addressed the
product by handle alone — and the product's Delete inherits the assumption.

So *Discard changes* gives every saved product the key it had while it was being edited, and a
product that is not saved — new, copied, or holding a handle it only has in the draft — comes back
under no key it ever had. A product deleted in the draft keeps its entry until a write lands,
which is what gives it back under its own key when a discard restores it.

### The address is the handle, stamped with the key, and the route is keyed by it

The address stays `/products/:handle`: it is what an operator reads and bookmarks and what the
tools name. Every history entry the workspace makes for a product carries its key in the
router's location state — the catalog's links, *New product*, Duplicate, and the editor's own
`replace`. A `ProductEditorRoute` resolves the key and renders
`<ProductEditorPage key={productKey} />`, as `CustomerEditorRoute` does for a profile (ADR 0060):

- **An entry carrying a key this load minted names that product**, whatever handle the address
  spells. The handle is never consulted for it.
- **An entry without one** — typed, bookmarked, or from before a reload, whose keys this load
  never minted — resolves by handle in the draft once, and the route stamps the key onto the entry
  with a `replace` **before the page mounts**, so the page never stands on an entry without its
  key: the address effect and the guard's exemption below both compare keys, and neither has
  an unstamped case to get wrong. (A stamp from inside the mounted page also exposed a removal
  notice losing its focus to an unrelated commit; that is fixed where it was, in `useRemoval`,
  which now keys the focus it owes on the notice itself.)
- **The page finds its product by key**, so it can never read "not found" for a product that is
  in the draft under another handle. When the product's handle differs from the address — a
  rename, or a discard that undid one — the page `replace`s the address with the product's handle,
  encoded as a path segment, and the same key, so the element key never changes and nothing
  remounts. The effect depends on the handle and the address only — never on the entry's state,
  which every stamp makes new — and asks for one handle at most once until the address has
  caught up with it, so it cannot re-fire on its own navigation.
- **The Handle field writes into the draft only what the lab would store**: a lowercase
  kebab-case slug within 64 characters (`_SLUG_PATTERN`, `isSlug`) that no other product holds.
  Anything else — `#b`, `?b`, `/b`, `.`, `..`, `Summit Parka`, a handle another product holds —
  stays in the field, and the draft, and so the address, keep the last handle that was valid. A
  handle is an address, and those characters are addresses of other pages.
- **A value the field holds and the draft does not is refused on the field and is unsaved
  work.** The field is `aria-invalid` and says why in its description — the rule for a value
  that is no handle, the draft's own "… is already in the draft." for a taken one — and never
  previews it as "Saved as …". And it is counted as the product editor counts an open row
  (`lib/entryEdit.ts` registers an open row with `useRegisterUnsavedWork`; ADR 0051): the
  header does not say "All changes saved" while it is held, and leaving asks, naming it.
  *Save draft* stays available, as it does beside an open row, and writes the draft as it is —
  it does not claim the held value, because the header goes on counting it. Refusing Save
  instead would be a second, product-only rule for an identifier the operator is mid-way
  through typing; every other editor lets its draft be saved while a row is open.
- **When its key is no longer in the draft** — a discard took away an unsaved new product or copy,
  or, once that slice lands, it was deleted — the page `replace`s itself with the catalog. It never falls back to
  the handle, which may by then name another product.
- "Product not found" is drawn only for an address with no key whose handle the draft does not
  hold.

Moving to another product is a new key and a remount, so nothing a page holds for one product —
an armed confirm, an open row, a late answer — lands on another.

**The unsaved-work guard does not ask about the editor moving its own address.** An open row is
unsaved work that no destination can save (ADR 0051), so the guard blocks every change of pathname
while one is open — including the `replace` that follows a rename or a discard, which would leave
the page standing on a handle the draft no longer holds, with the prompt offering to discard the
row. A navigation between two entries of **the product editor's route** that carry the **same
product key** leaves nothing behind: the page stays mounted, and so do its rows. The guard lets
exactly those through (`sameProductEntry`); a navigation to any other product, to the catalog —
even one carrying the key — or from an entry with no key is asked about as before.

### The handle follows the title from the Title's edit, while it is the title's

A product's handle **follows** when it equals what the Title row would suggest for it now:
`uniqueSuggestion(slugify(title), other handles)` — a fact about the product, so it survives a
remount, a discard and a reload.

A title that derives no slug — empty, or punctuation alone — says nothing about the handle, and
there no fact is enough: a new product's `my-custom` and a cleared `alpine` look alike. So the
editor keeps **one memory**, the smallest that is honest: the handle as the last title edit on
this page left it, if it was then the title's (`titled`). Through such a title the handle
follows only while it is still that handle — cleared from a title it followed, it goes on
following; typed over, or never the title's, it stays. A page opened on such a title has no
memory, and falls back on the one fact there is: a product **new to the draft** (the keyring does
not know the lab to hold it) whose handle is **still the placeholder** *New product* gave it
(`new-product`, `new-product-2`, …) follows its first title; any other handle stays. A landed
discard forgets the memory with the rest of what was typed.

Derivation has **one trigger**: the Title's change handler, which, if the product follows
before the keystroke, writes the new title and the new suggestion in one `edit`. Nothing else
derives — not opening the page, not a discard or an echo landing: the Handle field's own follow
effect is switched off for this field (`DerivedIdField`'s `follows={false}`), every other
`DerivedIdField` keeps it. A handle the operator types stops the following unless it is the
suggestion. A Handle field the operator has emptied follows the title again — the next Title
keystroke writes the suggestion — and leaving it empty gives the suggestion back, as on every
other surface.

### The removal scope is the key

The product cards and the header call `useRemoval(product.key, discarding)`. A rename is the same
product, so it no longer drops an armed row — ADR 0060's "dropped when the product is renamed"
was the cost of a scope that moved with the handle, and it goes with it. A landed discard still
drops every armed row and notice on the page, because what the confirm states was computed from
the draft the discard threw away.

## The acceptance list

The product's Delete, Duplicate and catalog row actions, which that slice builds, are assumed
where a sequence needs them.

- **R1** rename, Save, rename, Discard: the landed write mapped `saved-one` to the key; the
  re-read keys it back; the page `replace`s to `/products/saved-one`.
- **R2** rename–Discard twice: each discard re-reads the saved handle under the same key; no
  remount, the address follows back each time.
- **R3** delete X first, rename Alpine onto `x-first`, Discard: the page is keyed by Alpine's key,
  which the keyring gives back to `alpine-shell-jacket`; `x-first` gets X first's own key. The page
  stays on Alpine at its handle.
- **R4** the same with Delete armed: the page is still Alpine's, and the landed discard drops the
  armed confirm.
- **R5** rename, leave, reopen from the catalog, Discard: the catalog link carries the key; the
  discard gives it back at the old handle.
- **R6** a 422 on Save: the keyring is untouched; Discard gives the key back at the old handle.
- **R7** Save, type in the Title while it is in flight, Discard: the landed write recorded the
  saved handle before the echo was declined; the discard lands there.
- **R8** a second rename while the save is in flight: the keyring is rewritten when the `PUT`
  answers, not when the draft is clean; Discard lands on `/products/saved-b`.
- **R9** the catalog's "Deleted …" notice is keyed by the product's key; the discard gives the
  product back under that key, so the notice's row is on screen again and it clears, whatever the
  title reads.
- **S0** was a debugging variant of R5 (rename, the Products link, reopen from the catalog,
  Discard) and passes as R5 does; it has no test of its own.
- **S1** Alpine renamed onto `x-first` and reopened from the catalog: the link carries Alpine's
  key, and reopening derives nothing (S8), so there is no `REPLACE` rename; the discard lands on
  Alpine.
- **S2** a plain discard: the key and the element are unchanged, so the open row stays.
- **S3** rename, open Edit Size, Discard: the product is found by key in every commit; the address
  is `replace`d between two entries of the same key, which the guard does not ask about; nothing
  remounts, the row and focus stay.
- **S4** Duplicate, then Discard: the copy's key was never in the keyring, so it is not in the
  re-read draft, and the page `replace`s itself with the catalog.
- **S5** the preview read after a landed write fails: the keyring was rewritten before that read;
  Discard lands on `/products/saved-one`.
- **S6** Back after a discard that undid a rename: renames and the discard only `replace`, so the
  entry behind is the catalog.
- **S7** a new product titled onto a deleted one's handle, Delete armed, Discard: the new
  product's key is not in the re-read draft, so its page leaves for the catalog and its confirm
  goes with it; X first comes back under its own key, and nothing can delete it without being
  asked about it.
- **S8** a product whose handle is not its title's slug: it does not follow, and opening derives
  nothing, so it opens clean at its own address.
- **S9** jk renamed onto `x-first`, reopened, renamed again, Discard: every entry carries jk's
  key, and the keyring gives it back at `jk`.
- **S10** type " Pro", open Edit Size, type, Discard: as S3 — the product is found by key in the
  commit the draft is restored, the address follows without a remount, and the typing stays.
- **The set-aside Delete and Duplicate assertions** are that slice's. What they need from here: an
  armed confirm scoped by key cannot follow the operator onto the copy or back, since each is a
  separate key and a separate mount; a double-click on Duplicate is guarded where it appends.

## Deliberately not here

- **Delete and Duplicate themselves** — the header buttons, the catalog row actions, the order
  lookup, handle and SKU stepping for a copy, and their notices. That is *Slice 21 (remainder)*,
  since built (ADR 0062), and it inherits:
  `ShopDraft` and its keyed lookups, minting a key when appending, the keyring, the location-state
  stamp, the "key gone → catalog" rule, the guard's same-product exemption, and removal scoped by
  key. A notice carried to a page on its history entry (`useArrivedRemoval`) is taken off that
  entry without the product key beside it.
- **A persisted product id**, for the reason above. If a surface other than this editor ever
  needs a product identity steadier than its handle across writes, that is a contract change of
  its own.
- **The preview's issues for an unsaved rename.** `issuesForProduct` reads `products.<handle>`
  from the lab's last preview, which names the saved handle; that is unchanged.
- **The other editors.** Only the shop draft holds a list whose entries' addresses move with
  their content.
- **Links from a finding to its product** (`lib/issueRoutes.ts`) carry no key. They name the
  saved handle the preview reports, and resolve by handle like any address typed in — which is
  what they are.

## Consequences

- `ProductEditorPage` loses `shown`, `slot` and both following effects; the route wrapper and one
  address effect replace them.
- `useArrivedRemoval` used to replace its entry's state with nothing; it now removes only the
  notice, so any other surface's state on the entry survives it.
- Every reader of the workspace's `content` gets keyed products. The type makes a product without a
  key a compile error, which is how a future surface that appends one is told to mint it.
- A rename keeps an armed row armed, which ADR 0060's verification asserted the opposite of; that
  assertion is rewritten.
- A reload re-mints every key. Nothing outlives the load that minted a key except a history entry,
  and an entry with a key this load never minted resolves by handle.

## Verification

- `App.test.tsx` reproduces, as operator steps against MSW, every sequence that needs no Delete or
  Duplicate: R1, R2, R5 (and so S0), R6, R7, R8, S2, S3, S5, S6, S8, S10 — S2, S3 and S10 asserting
  the open row is the same element, with its typing and its focus, S8 that the draft stays clean
  and the address unchanged. A new product titled onto a handle Alpine gave up, then discarded,
  leaves for the catalog rather than becoming Alpine's editor — S7 without a Delete. The rename
  case of ADR 0060 now asserts the armed confirm stays.
- `App.test.tsx`, further: a handle typed on a new product stays through its first
  title and through a cleared and retyped one, while a new product's handle that followed its
  title goes on following through a cleared one; `Summit Parka`, `-summit` and 65 characters
  are `aria-invalid` with the rule and no "Saved as"; a taken handle says it is taken; with
  either held, the header never says "All changes saved", Save writes the draft's handle and not
  the held one, and leaving asks, naming it; a lost answer and a 500 alike, after a write that
  renamed nothing, leave Discard on the product, and after one that moved handles leave for the
  catalog. `lib/productKeys.test.ts`: an unsure write keeps what it sent unmoved and drops what
  it moved.
- `lib/productKeys.test.ts`: a re-read draft is keyed as the one that was edited; a landed write
  rewrites the keyring from what was sent; a refused write leaves it; a handle vacated in the draft
  and retaken by another product is keyed as the saved product, not the retaker — the core of R3,
  S7, S1 and S9, proven before Delete exists to walk them; another load's keys are never this one's; two
  entries are the same product only when both carry the same key.
- `lib/removal.test.tsx`: a notice carried to a product editor's entry is taken off it and the
  product key stays.
- `lib/shop.test.ts`: `toPayload` strips `key`, and a product payload has exactly the properties
  `openapi.yaml`'s closed `ProductSchema` declares. The suite's draft `PUT` refuses a keyed product.
- `App.test.tsx`, further: `#b`, `?b`, `/b`, `.` and `..` typed into the Handle
  leave the address, the heading and the draft alone, with no navigation at all, and the field
  refuses the value; `.` typed with a row open leaves the row open and asks nothing; a write
  whose answer is lost after a rename onto a handle another product gave up sends the page to the
  catalog rather than onto that product; a saved product's title cleared, or made punctuation,
  and retyped leaves a handle that was not the title's where it was, while a new product still
  takes its first title's handle. `lib/productKeys.test.ts`: whether the lab holds a product; the guard's exemption is the editor's route
  on both sides. `lib/removal.test.tsx`: a notice said after an unrelated commit, before that
  commit's effects, is still focused.
- Mutation proof: recording the keyring only when the echo is applied fails R8; only once the
  preview read after the write succeeds fails S5; resolving by handle when a keyed entry's key is
  gone fails the discarded-new-product case; deriving the handle in the field's effect fails S8;
  looking the product up by the address fails S3 and S10; not stripping the key fails the payload
  test.

## Migration

None. The key exists only in the browser's memory and in its history entries; no table, column,
canonical document, fingerprint or contract changes.
