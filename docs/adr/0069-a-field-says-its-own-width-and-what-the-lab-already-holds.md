# ADR 0069 — A field says its own width, and what the lab already holds

Status: accepted, amended by ADR 0074 (the order line's quantity is `w-full` in the form below the list) — 2026-09-27

Amendment: 2026-10-04 — The order's shipping fee moved onto a row. It was the totals' one typed
figure, drawn narrow beside its currency; it is now a `Field` row of the payment run, named by its
visible label, above the totals it feeds, so it composes `w-full` like every row's control, as the
order line's quantity did when it left its table's column (ADR 0074). The totals show it as a
figure between Subtotal and Total. `ui.test.ts` holds that no order field keeps `w-32`.

Amendment: 2026-10-02 — A select is drawn by the workspace, not the browser. The operator asked
that Safari's select match the others: Safari draws its own rounded, gradient control whatever
the surface says, so the shared field surface this record settles carries `select-chevron`
(`styles.css`), which applies to a `<select>` alone — the same string paints inputs — and
gives it `appearance: none`, the right padding a chevron needs and a chevron in `admin-muted`
(4.9:1 on the surface) as an inline SVG, pinned to the token by `ui.test.ts`. On the shared
surface rather than a select-only string because all 71 selects are already drawn from
`fieldControlClasses`, and a second class would be one more for the next select to forget;
`ui.test.ts` sweeps every select to it. A list box (`multiple`, `size`) is not a dropdown and is
left native. Under forced colours a `url()` background image is kept in its fixed grey, which a
high-contrast ground can make illegible, so there the select goes back to `appearance: auto`
and the system's own arrow, with the control's own `px-3.5` restored.

Settles `docs/PLAN-UX.md` Slice 27, the three workspace defects `docs/decisions-and-next-step.md`
listed as found and not fixed: three fields whose width never reached the screen, a product
category row with no list of the draft's categories and therefore no hint, and a Shop details
slug that took a value the create page refuses. Each was reported by a layout or copy slice that
was right not to add behaviour; this is where the behaviour is added.

Records four decisions: the shared field surface declares no width and every consumer states
one; the product editor's category offers the spellings the draft's other products use, kept
as the lab keeps them; Shop details refuses a slug another shop holds, off the listing the create
page reads, and the lab is not changed to refuse it; and the six uncomputed chips stay
uncomputed.

## Context

**The widths.** `fieldSurfaceClasses` in `lib/ui.ts` carried `w-full`, and both field exports
(`fieldControlClasses`, `textAreaClasses`) are built on it. Three call sites composed a narrower
width after it — `w-20` on an order line's quantity, `w-32` on the order's shipping fee, `w-48`
on the results tag box — and none of them had any effect: Tailwind emits its utilities in one
fixed order whatever order a class string writes them in, and `.w-full` is emitted after
`.w-20`, `.w-32` and `.w-48`, so the shared width won every time. The source read as three narrow
fields and each of the three filled its cell.

The prototype draws all three narrow. The order detail frame (`DEPRECADED/OrderDetail.dc.html`,
the lines grid) gives the quantity a `0.6fr` column and draws it as a small bordered box, and the
money as right-aligned figures; the current order page (`Workspace.dc.html` :2705) draws the
line's total as a tabular figure at the row's end. The tag box (`:2650`) is an input inside a
chip strip at `flex: 1; min-width: 130px` — the rest of the strip, not the whole card.

**The category.** `PRODUCT_CATEGORY_RULE` reads "Pick one the draft already uses, or type a new
one", which only the products create card had made true, with a `<datalist>` of the draft's
categories. When creating a product became a page that appends an empty product and opens its
editor, the card and its list went, and the editor's Category row — now the only surface that
asks for a category — was left bare on purpose, with a test pinning it bare and
`fieldRules.test.ts` carrying the rule as its one allowed orphan.

**The slug.** `NewShopPage` reads `GET /shops`, holds the other shops' slugs, and
`DerivedIdField` refuses a taken one before Create. Shop details was a plain input over
`identity.slug` that wrote anything to the draft.

## Decision

### The shared surface declares no width; every consumer states one

The three widths are wanted — the frames draw each of them narrow — so the width is lifted off
`fieldSurfaceClasses` rather than the three overrides deleted. With no width on the shared
string, the call site's is the only one and the one drawn.

Every consumer now says how wide it is. That is 190 call sites: 150 `fieldControlClasses` and 16
`textAreaClasses` that used them bare and now compose `w-full`, and 24 that already composed
something — 21 of which gain `w-full` in front of what they had (`font-mono`, a `max-w-*` cap, a
`flex-1` and a `min-w-*`), and three that state a width of their own:

- the order line's quantity keeps `w-20`; (Amended by ADR 0074: the quantity left the table's
  column for the form below the list and composes `w-full`, as the methods handoff draws it.)
- the shipping fee keeps `w-32`; (Amended 2026-10-04: the fee moved onto a row of the payment
  run and composes `w-full`.)
- the results tag box takes the prototype's own values, `w-auto min-w-[130px] flex-1`, in place
  of `w-48`: the rest of its row at a 130px floor, so it sits beside *Add tag* rather than above
  it. `w-48` was never the frame's width, only the nearest fixed one.

Every other consumer gains exactly the `w-full` it had been getting from the shared string, so
nothing but those three changes on screen. The flex items (the experiment setup's rows, the
scenario editor's parameter pair, the settings key field) keep `w-full` beside their `flex-1`
for the same reason: their basis was set by the flex before and still is.

Rejected: deleting the three overrides. It would have made the source honest by making the
screen permanently disagree with the frames, and a quantity box stretched across its table
column is the drawing the frame does not make.

Rejected: a narrow variant export beside a full-width one. It would keep a width on a shared
string, which is the arrangement that failed silently; the next override written against it
would fail the same way.

`lib/ui.test.ts`, *the width of a field*, pins the rule from both ends: neither shared string
matches a width utility, every place a module composes one into a class states a `w-*`, and no
module uses either bare. The sweep reads the sources, not a render, because which call sites
exist is a fact about the repository; it is shown catching both ways a width goes missing on a
synthetic source before its silence is trusted.

### The product category offers the draft's other spellings

The editor's Category row renders a `<datalist>` of `draftCategories(content, productKey)`
(`lib/shop.ts`) and carries `PRODUCT_CATEGORY_RULE` as its hint. A datalist rather than a select,
as on the removed card: a catalog's first product has nothing to pick, and a new category is as
legitimate as an existing one, so the list suggests and never refuses.

What it offers follows what the lab stores, which is the whole of the rule it holds a category
to: `Product.__post_init__` in `domain/shop.py` calls `_require_label(self.category, "product
category")` and nothing else, and `require_label` in `domain/content.py` refuses a value that is
empty, padded (`value != value.strip()`), or longer than `MAX_LABEL_LENGTH`. There is no
vocabulary and no case folding; the contract's `category` is `minLength: 1, maxLength: 200`. So:

- **Case is kept.** `Jackets` and `jackets` are two categories to the lab and to every tool that
  answers with one, and both are offered. Seeing the two side by side is how an operator
  correcting a category finds the spelling the catalog settled on; folding them would pick one
  silently and hide the fragmentation the list exists to prevent. (The sandbox's product search
  matches a case-folded query, `_matches` in `application/sandbox_tools.py`, which is a reason
  the split is invisible to an agent and not a reason to merge the spellings here.)
- **Padding is trimmed** and spellings that differ only by it are one. The lab refuses a padded
  category, so a padded spelling in the draft can only be an unsaved edit, and the spelling
  offered is the one it would have to become.
- **An empty or blank category offers nothing.** A new product arrives with none.
- **Inner whitespace is kept**, as the lab keeps it.
- **The product being edited is left out**: its own spelling is already in its field.

The list is sorted, so it reads as a vocabulary rather than as the order products were added.
The test that pinned the row bare is inverted, and `fieldRules.test.ts` has no allowed orphan
left: its sweep now asserts that every rule the module publishes is imported by a shipping
module, with no exception.

### Shop details refuses a slug another shop holds, and the lab is not changed

**The lab does not refuse a duplicate slug, on create or on a draft write, and this decision
does not make it.** ADR 0013 records it: "Cross-shop slug uniqueness is deliberately not
enforced; shops are identified by their definition UUID and the slug is content." `require_slug`
(`domain/content.py`) checks the shape and the length and nothing else, and no repository or
service compares one shop's slug with another's. The create page's refusal is therefore already
the workspace's own rule rather than a mirror of the lab's; what Shop details lacked was the same
rule once the shop exists. The slice keeps that rule where the create page keeps it — in the
workspace — rather than moving it into the lab, which would be a contract change (a new refusal
on `PUT /shops/{id}/draft` and `POST /shops`) and a reversal of ADR 0013 that no slice has asked
for.

It reads **the listing the create page reads**. `ShopWorkspace` already reads `GET /shops` for
the top bar's switcher and exposes it as `shops`, so Shop details makes no new request; the
workspace now also says `shopsPending` until that listing has first answered.

- **This shop's own slug is never taken from it.** The other shops are told apart by
  `shop_id`, not by spelling, so the shop whose details these are is filtered out by id.
- **Only a change is refused.** The slug the lab holds for this shop is never refused, even when
  another shop holds it too — written before this rule, or by a direct write. It is read off the
  listing's own row for the shop: `GET /shops` reports each shop's saved draft slug
  (`ShopService.list_shops` over the draft rows), and the workspace reads the listing again after
  every save (`afterSave`), so a shop that saves its way off a shared slug is refused it back,
  and one that has only typed its way off it, unsaved, is not. A shop in
  that state saves every other edit from Shop details as it does from every other page, and can
  be moved off the duplicate. `docs/design-direction.md` refuses a *second, stricter gate* — a
  page refusing what the lab would store and other surfaces accept — and this rule stays clear
  of it by being the workspace's own and by applying only to a slug the operator types: it never
  stands between the operator and a save of what the lab already holds.
- **A taken slug never reaches the draft.** The row is a `DerivedIdField` that follows nothing
  (`follows={false}`, no "Saved as" preview): a free slug is written as it is typed, a taken one is
  held on the field — `aria-invalid`, and the create page's own sentence, "northstar is already
  used by another shop.", as the row's second line — as the product editor holds a taken handle
  (ADR 0061). No Save anywhere in the workspace can write it, not only the one on this page.
- **A held value leaves no prefix behind.** Every free value is written as it is typed, so typing
  a taken slug key by key passes through prefixes nobody meant: `northsta` on the way to
  `northstar`. The rule is that the draft keeps the slug it had **when this run of typing began**
  — the run ends when the operator leaves the field — whenever the field holds something it will
  not write: the moment the field holds a taken slug, or nothing, the draft goes back to that
  slug. So each way of letting the held value go — the prompt's *Discard and leave*, emptying the
  field and leaving it, the header's Discard — leaves the draft on the slug the operator started
  from, and a Save from another page stores it rather than the last prefix. A free slug typed and
  left is meant, and is where the next run starts.
- **Save is refused with its reason** (ADR 0063) while the field shows a taken slug: the header's
  Save is a `PrimaryAction` with the refusal, naming the field's line through `DerivedIdField`'s
  new `extraId` rather than writing the sentence twice. A held slug is unsaved work — the header
  offers Save and Discard over it, and leaving asks, naming what the field holds — as a held
  handle is.
- **The prompt says why a held value cannot be saved from it.** `UnsavedWork` gains `unsavable`,
  the reason *Save and leave* is refused with for work that carries no `save`. An open row keeps
  the reason it had ("press the row's own Save or Cancel"); a value held on a field — this slug,
  and the product editor's held Handle — says `HELD_VALUE_REASON` instead, because there is no row
  and no Cancel. Those two are every registration without a `save`: the draft editors, the order
  editor and a create's owed second write all carry one.
- **While the listing is being read** the field is closed and says "Reading what is already used
  by another shop…", as the create page's is.
- **When the listing failed**, the field refuses nothing, because nothing is known to be taken,
  and the failure is in the header's error line — as the create page proceeds with its load error
  shown. A refusal read off a list that did not arrive would be invented.

`SHOP_SLUG_DETAIL_RULE` now says the refusal: "Lowercase with hyphens, and not one another shop
already uses. The shops index searches it beside the name." The phrase both pages complete the
taken sentence with is one constant, `SHOP_SLUG_TAKEN_PLACE`.

### The six uncomputed chips stay uncomputed

No listing gained the figure for a reason of its own in this slice, and none was made to. The
six chips UI-4 could not compute, and the three figures `docs/decisions-and-next-step.md` prices,
stay as they are under *Lists and counts*: a figure the payload lacks is not faked.

## Deliberately not here

- **A lab-side slug constraint.** Two tabs, a direct API write or a create racing a rename can
  still leave two shops on one slug, which is what ADR 0013 accepted; the workspace refuses
  what it can see. If a slice ever needs the slug unique — for addressing a shop by it, say — that
  slice changes ADR 0013, the contract and both endpoints together.
- **A shape refusal on Shop details' slug.** A slug that is not kebab-case still reaches the
  draft and is refused by the lab at save, as before; the row's hint states the shape. Holding it
  on the field like a taken one is a separate behaviour for whoever next touches the row.
- **The chip strip.** The tag box takes the strip's width, not its shape; a borderless input in a
  bordered composite is the component slice `lib/ui.ts` already defers.
- **The tag form at phone width.** At a 390px viewport the tag input's 130px floor overflows the
  card it sits in. Accepted: the floor is the prototype's own value, the workspace is desktop
  first (`docs/design-direction.md`, *Desktop first, usable narrower*), and the field stays
  usable; a narrower floor would be a width the frame does not draw.
- **The product Handle's prefixes.** The Handle has the same defect: typing another product's
  handle key by key writes every free prefix (`storm-park` on the way to `storm-parka`), and a
  *Discard and leave* followed by a Save on the catalog stores it. The same rule fixes it, but a
  handle is the product's address — each prefix written moves the page (ADR 0061) — and going back
  to the run's first handle is one more address move under the title-follow and keyring rules,
  which is its own change with its own tests. `docs/decisions-and-next-step.md` lists it.

## Verification

- `lib/ui.test.ts`, *the width of a field*: the sweep found the consumers (more than 150, the
  quantity among them); neither shared string declares a width; every composed consumer states a
  `w-*`; no consumer is bare; the sweep catches a bare use and a width-less composition on a
  synthetic source; the quantity, the fee and the tag box state their narrow widths.
- `lib/shop.test.ts`, *draftCategories*: once each and sorted; the edited product left out; two
  case spellings kept; padding trimmed into one; blank and empty offering nothing; and the rule
  read out of `domain/shop.py` and `domain/content.py` — the category's only check is
  `_require_label`, which refuses padding and folds no case.
- `App.test.tsx`: the editor's Category offers the other products' spellings and says
  `PRODUCT_CATEGORY_RULE`, takes one of them and a new one, and offers nothing when no other
  product has a category.
- `App.test.tsx`, *a shop's slug on Shop details*: on Alpenglow, Northstar's slug is refused on
  the field and Save is refused with the reason and writes nothing, while a free slug saves; a
  pasted taken slug is held out of the draft — Save refused over an otherwise clean draft,
  leaving asks and names it, and a save after it is handed back carries the draft's own slug;
  the field is closed while the listing loads; and a failed listing refuses nothing and says the
  read failed. The binding test pins the hint's new clause. A taken slug typed key by key, then
  *Discard and leave* onto the catalog and its Save, stores the shop's own slug; emptying the field
  hands back the slug the typing began from, and a slug typed and left is where the next run
  starts; the header's Discard over a held slug puts the shop's back; a shop already sharing its
  slug saves a Name edit from Shop details, is refused the shared slug back once it has saved
  another, and takes it back while the lab still holds it after an unsaved edit and a page
  change. The prompt over a held slug, and over a held Handle,
  gives `HELD_VALUE_REASON` and not the open row's reason.
- `fieldRules.test.ts`: no rule the module publishes is left unimported.
