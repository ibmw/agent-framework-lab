# Product identity: the reproductions behind deferring product Delete and Duplicate

Recorded 2026-09-25. `feat/deliberate-removal` built product Delete and Duplicate for PLAN-UX
Slice 21, and four reviews took them back out (ADR 0060, *A product's own Delete and Duplicate
are deferred*). This note is what those reviews found, written as operator steps, and it is the
acceptance list for *Slice 21 (remainder)* in `docs/PLAN-UX.md`. The code and tests that produced
it are on the branch's history: the full implementation at `e90041b` and `9188dc8`.

The root is one fact: a product has no identity in the editor steadier than its handle, which is
both its address and what the draft is keyed by, and which follows the title as it is typed.

## Fixture

A shop draft holding, in order, **X first** (handle `x-first`) and **Alpine Shell Jacket**
(handle `alpine-shell-jacket`, variants `NS-ASJ-OB-M` and `NS-ASJ-OB-L`). The lab holds the same
draft, so *Discard changes* restores it. "Delete X first on the catalog" means with *Confirm
before anything is deleted* turned off, so it is one press and stays unsaved.

## What failed or exposed a defect

Each is numbered by the review test that found it. "Observed" is the branch at the SHA named.

**R3 — a rename onto a deleted product's handle, then Discard** (observed at `e90041b`)
1. Delete X first on the catalog. 2. Open Alpine Shell Jacket. 3. Change its Handle to `x-first`.
4. Discard changes.
- Expected: the page is on Alpine Shell Jacket at `/products/alpine-shell-jacket`.
- Observed: the page is on **X first** at `/products/x-first` — the restored product that now
  holds the address the page was standing on.

**R4 — the same, with the header Delete armed** (`e90041b`)
Steps 1–3 of R3, then turn the preference back on, press Delete, then Discard changes.
- Expected: no confirm is armed after the discard.
- Observed: the confirm reads **"Delete “X first”?"** — armed on a product nobody asked about.

**S7 / S1 — a product created onto a deleted product's handle** (`9188dc8`; review 4, High 1)
1. Delete X first on the catalog. 2. New product. 3. Type the Title "X first" (the handle follows
to `x-first`). 4. Turn the preference on and press Delete. 5. Discard changes. 6. Press Delete it.
- Expected: after step 5 no confirm is armed; nothing is deleted.
- Observed: after step 5 the confirm still stands, now reading "It leaves the catalog with its
  **2** variants" (it read 0 before the discard); step 6 deletes **X first** — the restored
  product — and the catalog says "Deleted “X first”".
- S1 is the same sequence reached by renaming Alpine Shell Jacket onto `x-first` and reopening it
  from the catalog; at `9188dc8` its discard lands on X first.

**R8 — a second rename while a save is in flight** (`e90041b`)
1. Open Alpine Shell Jacket; change the Handle to `saved-b`. 2. Save draft. 3. Before the save
answers, change the Handle to `third-c`. 4. Let the save land. 5. Discard changes.
- Expected: the page is on Alpine Shell Jacket at `/products/saved-b`, what the lab now holds.
- Observed: "**Product not found**" at `/products/third-c`.

**R1 — rename, save, rename, Discard** (passed at `e90041b`; the defect R8 exposes, reached
without the race): rename to `saved-one`, Save, rename to `second-name`, Discard. Expected
`/products/saved-one`. A page that records the saved handle only when the draft is clean after
the save fails R8 and passes R1; one that never records it fails both.

**R9 — a deleted product's notice outlives the discard that undoes it** (`e90041b`)
1. Open Alpine Shell Jacket; type " Pro" into the Title. 2. Turn the preference off; press
Delete. 3. On the catalog, Discard changes.
- Expected: the catalog's "Deleted …" line is gone, since the product is back.
- Observed: **"Deleted “Alpine Shell Jacket Pro”"** stays, beside the restored product.

**S10 — typing in an open row is lost by a discard** (`9188dc8`; review 4, High 2; **also true
on `main`**)
1. Open Alpine Shell Jacket; type " Pro" into the Title. 2. Press Edit on the Size option and type
" typed" into its name. 3. Discard changes.
- Expected: the open row, and what was typed in it, survive the discard (ADR 0051 — Discard
  leaves open rows alone).
- Observed: the lists remount on the discard and the open row is gone with its typing. At
  `9188dc8` the page counted the discard a new visit; on `main`, with no Delete at all, the same
  steps lose the typing too, because main's slot-follow renders "Product not found" for one
  commit while the page follows the product back to its old handle, which unmounts the cards.
  The identity work has to fix this on `main`, not only avoid it.

**S3 — the same through a rename** (**also true on `main`**, for the same reason as S10): rename
to `ren`, open Edit Size, Discard. Observed at `9188dc8`: the page returns to
`alpine-shell-jacket`, the open row is gone and focus is on `<body>`.

**S4 — Duplicate, then Discard** (`9188dc8`)
1. Open Alpine Shell Jacket; press Duplicate (lands on the copy). 2. Discard changes.
- Expected: the page returns to a product that exists — the source, or the catalog.
- Observed: "**Product not found**" at `/products/alpine-shell-jacket-copy`.

**S5 — a save whose preview read fails** (`9188dc8`)
1. Rename to `saved-one`; Save; the draft write lands but the preview read after it fails.
2. Rename to `second`. 3. Discard changes.
- Expected: `/products/saved-one`.
- Observed: "**Product not found**" at `/products/second` — the failed preview surfaces as a save
  error, so the landed rename is never recorded.

**S9 — a product renamed onto a deleted one's handle, reopened, renamed again** (`9188dc8`)
With X first and a product "jk" (`jk`): 1. Delete X first on the catalog. 2. Open jk; rename to
`x-first`. 3. Back to the catalog; open jk again from its link. 4. Rename to `jk-two`. 5. Discard.
- Expected: the page is on jk.
- Observed: the page is on **X first** at `/products/x-first`.

**S8 — opening a product whose handle is not its title's slug** (also true on `main`)
Open a product whose handle is `custom-handle` and whose title is "Alpine Shell Jacket".
- Expected: the product opens as it is, clean.
- Observed: the page moves to `/products/alpine-shell-jacket` and the draft is **dirty** — the
  Handle field followed the title on mount and renamed the product. S1's reopening shows the same
  (`PUSH x-first`, then `REPLACE alpine-shell-jacket`). This is on `main` today, independently of
  Delete and Duplicate, and any identity scheme has to decide it first.

R2, R5, R6, R7, S0, S2 and S6 passed or showed nothing wrong at the SHAs above; they stay in the
acceptance list as regressions: R2 rename–Discard twice; R5 rename, leave to the catalog, reopen,
Discard; R6 rename, a save refused with 422, Discard; R7 rename, Save, type in the Title while it
is in flight, Discard; S2 an open row survives a plain discard; S6 Back after a discard that
undid a rename returns to the catalog.

## What the set-aside tests asserted Delete and Duplicate do

**Delete names the orders it would leave naming a gone variant** — the slice evidence.
1. Open Alpine Shell Jacket; press Delete. Orders: NS-10482 with a line for `NS-ASJ-OB-M`,
   NS-10483 with a line for a SKU of another product.
- The confirm holds focus and reads "It leaves the catalog with its 2 variants…" and "Order
  NS-10482 names one of its variants, NS-ASJ-OB-M. That order keeps its line as frozen, and
  reports a SKU the catalog no longer has once the draft is saved." NS-10483 is not named.
- *Delete it* stays disabled, with its reason, until the orders are read; a read that fails says
  so and lets the delete proceed; an order that answers 404 is skipped.
- It also says the product is the shop's last, where it is, and that a ticket opened from it or a
  scenario bound to it is refused at publication.
- *Keep it* walks it back, returns focus to Delete, and writes nothing (no Save draft offered).
- *Delete it* removes the product from the draft, lands on the catalog with no unsaved-work
  prompt, and says "Deleted “Alpine Shell Jacket” from the draft." with focus on that line;
  saving writes a draft without the product. A Back-then-Forward to the catalog does not say it
  again.
- The same Delete, as a catalog row action named "Delete Alpine Shell Jacket", replaces the row
  with the confirm; *Keep it* returns focus to the row's Delete.

**Duplicate copies everything authored, under names nothing holds, as a draft.**
- From the header or the row action "Duplicate Alpine Shell Jacket": the copy is appended and
  opened at `/products/alpine-shell-jacket-copy`, titled "Alpine Shell Jacket (copy)", status
  **draft**, with the source's options, media, attributes and reviews, and each variant copied
  except its SKU, which is derived again from the copy's handle and the variant's own values:
  `ALPINE-SHELL-JACKET-COPY-OCEAN-BLUE-M`, `ALPINE-SHELL-JACKET-COPY-OCEAN-BLUE-L`. The source
  is saved unchanged.
- A second copy steps its handle (`-copy-2`, then `-copy-3` past an existing `-copy-2`), and no
  SKU in the shop is ever reused.
- Handles and SKUs stay within 64 characters (`MAX_SLUG_LENGTH`): a copy of a 60- to
  64-character handle cuts the source to leave room for `-copy`, and two SKUs that agree only
  after the cut stay distinct (clamp before making unique).
- A double-click on Duplicate makes one copy.
- An armed confirm does not follow the operator onto the copy, nor back to the source.

**The preference.** With *Confirm before anything is deleted* off, Delete removes the product
and lands on the catalog on one press; with it on, it asks as above.
