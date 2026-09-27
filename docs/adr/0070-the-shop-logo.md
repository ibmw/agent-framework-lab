# ADR 0070 — The shop logo

Status: accepted — 2026-09-27

Amendment: 2026-09-27 — The operator chooses the mark colour, a pair under 3:1 is warned about
and never refused, Brick is offered, and the monogram takes the chosen colours
(`shop-payload-v3`). See *Amendment — 2026-09-27: the logo's colours are chosen* below; the
sections it reverses are marked where they stand.

Settles `docs/PLAN-UX.md` Slice 28: an icon from the prototype's twenty-eight marks and a
background on the shop payload, drawn on the switcher's badge, the shops index and the two
editors that set it. The plan said to drop the slice "if the badge reads well on initials". It
does read well, and the user chose to build the logo anyway, as a customization. This ADR
records that evidence, the choice, and what building the logo does to a canonical document
whose fingerprints are historical evidence.

## Context

**The badge before this change.** `ShopBadge` (`shell/ShopSwitcher.tsx`) drew the first letters
of the name's first two words, white on `lab-ink`, for every shop: 30px in the bar and 26px in
the panel. It was `aria-hidden`, because the full name sits beside it in both places. White on
`#173c34` is 12.1:1. The shops index drew no badge at all. The frames draw a badge in five
places: the bar (`Workspace.dc.html` :30), the panel (:44, :51), the index row (:179), and a
46px preview on the create page (:266) and Shop details (:2043).

**How initials hold up.** Every badge shared one ground, so a badge carried one or two letters
and nothing else. "Northstar Outfitters", "Northstar Outfitters FR", "Northstar Outfitters
(strict returns)" and "North Outdoor" all read `NO`; "Harbour & Home" reads `H&`. Variants of
one shop are the lab's likeliest way of holding several, and they collide. But no surface
identifies a shop by its badge alone: the name is beside it in the bar and in every panel row,
and the index is a list of names. **The badge reads well on initials.** A logo buys recognition
at a glance, which a lab of a handful of shops needs little. **The user chose to build it as a
customization.**

**The payload.** `shop_payload_document` (`application/shop_payload.py`) writes every key it
knows. `canonical_json_text` (`application/canonical_json.py`) sorts keys and writes `None` as
`null`. `get_version` (`infrastructure/repositories.py`) recomputes a published version's
fingerprint from the re-rendered aggregate on every read, not from the stored bytes, and it
refuses a mismatch ("no longer matches its recorded content fingerprint"). ADR 0013 says "any
change to the document shape requires a new schema token".

## Decision

### The payload: an optional `logo` of a mark and a background

`ShopPayload.logo: ShopLogo | None`, default `None`. `ShopLogo` has two fields:

- `mark`: `ShopMark`, a `StrEnum` of the frame's 28 keys (`storefront`, `compass`, `anchor`,
  `mountain`, `leaf`, `wave`, `spark`, `bolt`, `cube`, `bag`, `tag`, `shirt`, `shoe`, `gem`,
  `cup`, `bread`, `bottle`, `pill`, `heart`, `scissors`, `tools`, `book`, `ticket`, `camera`,
  `paw`, `home`, `truck`, `globe`), extended deliberately, as `Currency` is.
- `background`: `ShopLogoBackground`, seven named tokens with their hex held beside them in
  `domain/shop.py`. These are the frame's `SHOP_BGS` minus Brick: Brick is `#9d3028`, the
  workspace's validation and destructive red, and "the warm red is destructive and nothing
  else".

The canonical document stores token names, never hex. A token's hex is frozen once it is
published, and a different colour is a new token.

The logo sits at the payload's top level, beside `identity`, because the frames draw it as a
card of its own. The shop view an agent reads (`sandbox_tool_views.py`) and the prompt values
(`agent_prompt.py`) take shop fields by name, so the logo reaches neither.

A shop without a logo is drawn as before: initials on `lab-ink`. Both editors offer "None —
initials" as the first tile, and the create page opens on it. A logo nobody chose is not a
choice the lab can make for the operator (ADR 0064). Picking a mark on a shop without a logo
puts it on Pine, the prototype's default for a new shop.

Rejected: **free hex.** It needs a colour picker, which means a new UI dependency or a bare text
field. It needs a contrast rule computed over an unbounded space in two languages. And it lets a
badge land on the pine of a primary action or the red of a refusal.

Rejected (reversed by the amendment below): **the prototype's coloured monogram**, chosen
colours with no mark. Its letters are
text at 10.5px, so they fall under text contrast (4.5:1), a second rule for a second kind of
logo. The initials stay the no-logo state.

### The mark colour is derived, not chosen

*Reversed by the amendment below: the mark colour is chosen, and this section is the record of
why it once was not.*

The plan asked for a background, a mark colour and a contrast check in the editor. **This
departs from it:** the mark colour is not authored. The lab draws the mark in White (`#ffffff`)
or Ink (`#16332d`), whichever is higher in contrast against the background
(`mark_colour_for`). The standard is WCAG 2.2 SC 1.4.11, non-text contrast of 3:1, because the
mark is a stroked glyph. Over the palette:

| Background | White | Ink | Drawn in |
|---|---|---|---|
| Clay `#c2532d` | 4.60 | 2.96 | White, 4.60:1 |
| Pine `#1d6241` | 7.30 | 1.86 | White, 7.30:1 |
| Indigo `#2f4a7a` | 8.82 | 1.54 | White, 8.82:1 |
| Plum `#6b3f8c` | 7.74 | 1.76 | White, 7.74:1 |
| Forest `#16332d` | 13.59 | 1.00 | White, 13.59:1 |
| Ochre `#a8802a` | 3.63 | 3.74 | Ink, 3.74:1 |
| Stone `#eceef0` | 1.16 | 11.68 | Ink, 11.68:1 |

Every background has at least one mark colour that passes, and only Ochre has two. So a chosen
mark colour would be a choice with one readable answer six times in seven, and the prototype's
warning ("Hard to read against that background. Try the other one.") would exist only to steer
the operator to that answer. Deriving it removes the *Mark colour* row, the contrast check, the
refusal, and the ADR 0063 question of whether the backend mirrors that refusal. No logo the
payload can hold is unreadable, so there is nothing to refuse.

The derivation is written twice, in `domain/shop.py` and `lib/shopLogo.ts`. `test_shop_logo.py`
and `shopLogo.test.ts` each enumerate every background, compute both ratios, and assert that the
derived colour is the higher of the two, that it is at least 3:1, and that it matches one shared
expected table. `shopLogo.test.ts` also reads the palette's tokens, hex values and marks out of
`domain/shop.py`, so the two sides cannot drift apart silently.

Strictly, no success criterion requires even 3:1 of an `aria-hidden` badge beside its name. The
floor is a legibility guarantee, not a conformance claim.

### The canonical document: absent means unwritten, and the token says which

`shop_payload_document` writes no `logo` key when the shop has no logo, and keeps the token
`shop-payload-v1`. A shop with a logo is written as `shop-payload-v2`, which is v1 plus a
required `logo` object `{"background", "mark"}`. The reader dispatches on the token. A v1
document must not carry `logo` at all, `null` included, and reads as no logo. A v2 document
must carry `logo` as an object. Each refusal names its path.

As a result, a shop without a logo renders to the same bytes it had before this change. The
fingerprint of every existing draft and published version is unchanged, and `get_version`'s
recomputation still matches. `test_shop_payload.py` holds, as recorded constants, the bytes and
fingerprint the pre-logo codec (commit 8105c27) wrote for an identity-only shop and the
fingerprint it wrote for the publishable fixture. `test_shops.py` rewrites a published row to
exactly those bytes and fingerprint and reads it back through `get_version`.

A document with a logo carries a token that pre-logo code refuses by name through
`require_schema_version`, instead of dropping the logo and saving the draft back without it.
That keeps ADR 0013's rule. The earlier shop test that fed the codec `shop-payload-v2` as an
unknown token now uses v3.

Rejected: **v1 with an optional key.** The bytes would be identical, but ADR 0013's rule breaks.
Pre-logo code would read a draft with a logo, drop it, and save the draft back, and no
fingerprint guards a draft.

Rejected: **v2 for every document, or `"logo": null` always written.** Either moves the
fingerprint of every published shop version. `get_version` would then refuse them all, unless a
migration rewrote recorded fingerprints, and a recorded fingerprint is historical evidence.

**Migration: none.** No table, column or Alembic revision, and no stored row is touched. A
stored v1 document reads as a shop without a logo, at read time, by its token.

**Versions.** A logo is content. Setting, changing or removing one changes the draft's
fingerprint, so `matches_latest_published` goes false and publishing mints a new version.
`summarize_shop_changes` reports it once, at the path `logo`: "Added shop logo", "Updated shop
logo" or "Removed shop logo". Scenarios pin shop versions when they are published, and
snapshots (`sandbox-v2`, `definitions[]`) record each pinned version's content fingerprint.
Neither moves for anything already pinned. A scenario published after a logo change, or a fork
taking newer versions, pins the new shop version. Its snapshot fingerprint then differs from an
earlier one even though nothing an arm reads is different. That is the cost of making the logo
versioned content.

### Where it is drawn

The logo is drawn where the frames draw it and nowhere else. `components/ShopBadge.tsx` takes a
logo or `null` and a name, at 30px (the bar and the index row), 26px (the panel) and 46px (the
editor preview), with glyphs of 17, 15 and 24px as the frames size them. It is `aria-hidden`
everywhere, so the switcher is still named "Switch shop, current: …" and an index row's link is
still the shop's name. The frame's index row (:179) draws the badge for every shop, as the logo
or as the initials, so the index shows initials for a shop without a logo. `ShopSummarySchema`
carries the draft's logo, as it already carries the draft's name, so the switcher shows what the
draft holds.

The 28 glyphs are the frame's own path data (`lib/shopLogo.ts`), stroked at 1.7 as the frame's
`glyphEl` strokes them. Lucide has no shoe, and a mixed set would not match the frames.

`components/ShopLogoCard.tsx` is the frame's Logo card, minus the *Mark colour* row. It holds a
46px preview with one sentence naming the drawn colour and its ratio, then a radio group of 29
tiles (None and the 28 marks), and a radio group of the seven backgrounds, drawn only once a
mark is chosen. The create page places it between Identity and Commerce, as the frame does.
Shop details places it after the identity card, and the draft carries it through the
workspace's one save.

### Contract diff: additive

- `ShopLogoSchema` is new: `mark` (`ShopMark`) and `background` (`ShopLogoBackground`), both
  required, with `additionalProperties: false`.
- `ShopPayloadSchema` (the request) gains an optional `logo`, nullable, with default `null`.
  Existing writers stay valid. A draft replace is whole-payload, so a writer that omits the key
  removes the logo, as it would any field.
- `CreateShopRequest` gains the same optional `logo`. The workspace omits the key when there is
  no logo.
- `ShopContentSchema` and `ShopSummarySchema` (responses) gain `logo` as required and nullable,
  under ADR 0013's rule that a response carries every key.

No field is removed or retyped, and no route is added.

## Deliberately not here

- An uploaded image. Binary media stays deferred (ADR 0013).
- The logo in reports, experiment results or anywhere else the frames do not draw it. The frame's
  Logo card says "every report it appears in", but no frame draws one.
- The logo in anything an agent, a tool result or a judge reads.
- Free colours. The coloured monogram, a chosen mark colour and Brick were listed here until
  the amendment below brought them in.
- Optimistic concurrency on a draft write. Replacing a draft was last-write-wins before the
  logo, and it still is. Keeping a v2 logo changes only how a write is encoded, and loses no
  logo content.
- A logo on the seeded shop. `make seed` writes what it wrote before, so a seeded lab keeps its
  published fingerprints.

## Verification

- `test_shop_logo.py`: every background's derived colour, computed and at least 3:1; the palette
  is seven backgrounds without the destructive red and 28 marks; an unknown mark or background
  is refused; adding, changing and removing a logo is each one change; the prompt values, the
  knowledge documents and the product views of a shop with a logo equal those of the same shop
  without one.
- `test_shop_payload.py`: the recorded pre-logo bytes and fingerprints; v2 round-trips, and its
  fingerprint moves with the mark and with the background; a v1 reader refuses v2 by name; `logo`
  in v1 (including `null`), v2 without `logo`, v2 with `null`, and an unknown token are each
  refused with a path.
- `test_shops.py`: a row holding the pre-logo document and fingerprint reads through
  `get_version`; a logo edit previews as "Added shop logo", publishes version 2, reads back, and
  is listed; a shop is created with its logo.
- `test_shop_api.py`: the logo is optional on create and on a draft write and answered on every
  response; a write without it removes it; a mark, background or key outside the closed sets is
  a 422.
- `shopLogo.test.ts`: the palette and marks read out of `domain/shop.py`, and every
  background's derived colour, computed.
- `Shops.test.tsx`: an index row draws the mark in its derived colour, or the initials; the
  create page opens on None, creates without a `logo` key, and creates with the logo chosen.
  `AppShell.test.tsx`: the bar and the panel draw the logo `aria-hidden`, and the switcher's name
  is unchanged. `App.test.tsx`: Shop details opens on the initials, takes a mark and a
  background, names the drawn colour, saves both, and gives the logo back to None.

## Amendment — 2026-09-27: the logo's colours are chosen

**The reversal.** The user chose to follow the mockup (`Workspace.dc.html` :255–325 and
:2043–2100, `SHOP_BGS`, `SHOP_FGS`, `logoVals` at ~:5520). The operator picks the mark colour,
White (`#ffffff`) or Ink (`#16332d`), from a row of swatches under *Mark colour* ("What the
icon or the letters are drawn in."). The original decision above treated a choice with one
readable answer as a choice the lab could make. The reversal accepts that the pair is the
operator's customization, as the mockup draws it, and that a readable default does not justify
taking the choice away.

**Low contrast is a warning.** Under 3:1 (WCAG 2.2 SC 1.4.11, the mockup's
`contrastOf(bg, fg) < 3`), the card says the mockup's sentence, "Hard to read against that
background. Try the other one.", under *Mark colour*. Save and Create still work, and the
backend accepts every pair. Nothing is refused, so ADR 0063 does not apply. The sentence is
drawn in the field row's warning tone (`admin-draft-ink`, normal weight), not in the mockup's
red at 600, because the warm red is destructive and nothing else and this is not a refusal. It
is the *Mark colour* group's second description line, so a reader hears it on the group, and it
is announced politely when it appears. `is_low_contrast` (`domain/shop.py`) and `isLowContrast`
(`lib/shopLogo.ts`) hold the rule. `test_shop_logo.py` and `shopLogo.test.ts` each enumerate all
sixteen pairs against one shared table, and the TypeScript side reads the palette out of
`domain/shop.py`:

| Background | White | Ink | Warned |
|---|---|---|---|
| Clay `#c2532d` | 4.60 | 2.96 | Ink |
| Pine `#1d6241` | 7.30 | 1.86 | Ink |
| Indigo `#2f4a7a` | 8.82 | 1.54 | Ink |
| Plum `#6b3f8c` | 7.74 | 1.76 | Ink |
| Forest `#16332d` | 13.59 | 1.00 | Ink |
| Ochre `#a8802a` | 3.63 | 3.74 | neither |
| Brick `#9d3028` | 7.27 | 1.87 | Ink |
| Stone `#eceef0` | 1.16 | 11.68 | White |

**Brick is offered.** Eight backgrounds, in the mockup's order, with Brick between Ochre and
Stone. The original exclusion read "the warm red is destructive and nothing else" as covering a
shop's own colour. That rule governs the workspace's controls and messages, and a logo is
neither: it is the operator's content, drawn `aria-hidden` beside the shop's name, and it never
signals an outcome. `brick` is a new token. No stored document holds it, so no hex moved.

**The monogram takes the colours.** The mockup's first mark tile is "Monogram — the first
letters of the name". Its preview, the switcher and the index draw the initials on the chosen
background in the chosen colour (`shopIsMono`/`sh.isMono` paint `shopMark` in `sh.fg` on
`sh.bg`), and the *Background* and *Mark colour* rows are shown whatever the mark. So a
monogram is a logo with no mark: `ShopLogo.mark` is `None`, and the document writes
`"mark": null`. The earlier objection, that letters are text and would need 4.5:1, is set
aside for the reason the original decision already gave: no success criterion covers an
`aria-hidden` badge beside its name. The warning applies the mockup's one threshold to letters
and marks alike.

**No logo still exists.** A shop that never chose a logo is still written as `shop-payload-v1`
and drawn as before, in white initials on `lab-ink`. The card opens it on the monogram tile
with no background and no colour checked. The first background, colour or icon picked gives it
a logo: a background starts the monogram in the colour that reads on it, a colour starts it on
Pine, and an icon starts on Pine in White. Choosing the monogram again is not a choice of
colours, so it does nothing. **The card has no way back to no logo.** The mockup draws none,
and a monogram on Forest in White looks like the default badge. The API still takes
`logo: null` or an absent key.

### The payload: `shop-payload-v3`, and v2 kept as stored

- **v1** (no logo) is unchanged: the same bytes, and `PRE_LOGO_*` still pins them.
- **v3** is v1 plus a required `logo` of `{"background", "mark", "mark_colour"}`. `mark` is a
  `ShopMark` or `null` for the monogram, and `mark_colour` is `white` or `ink`. Every logo
  authored now is written as v3.
- **v2** documents already stored are read, never rewritten. Their `logo` is
  `{"background", "mark"}`, which reads as `ShopLogo(mark, background, mark_colour=None)` and
  is drawn in the colour the v2 rule derived (`mark_colour_for`, the higher contrast of the
  two). A `ShopLogo` with no chosen colour renders back to v2, so a v2 published version
  re-renders to its stored bytes and `get_version`'s recomputed fingerprint still matches.
  `test_shop_payload.py` and `test_shops.py` pin this with a v2 document and fingerprint
  recorded from the codec at commit fcaa115 (`V2_LOGO_DOCUMENT`, `V2_LOGO_FINGERPRINT`), read
  as a draft, as a published version and in the listing. A logo without a chosen colour and
  without a mark cannot be constructed, because v2 had no monogram.
- **An unchanged v2 logo stays v2.** The API answers a v2 logo with its derived colour, and
  every writer that reads a draft before writing it sends that colour back: the workspace
  does on every save, from any page. So `ShopService.replace_draft` keeps the stored logo
  (`keep_unchosen_logo`, `domain/shop.py`) when the stored logo has no chosen colour and the
  incoming one has the same mark, the same background and the colour the lab derived. The
  echo is measured against the stored draft and then against the latest published version. A
  colour changed and changed back (White saved, then Ink) leaves a v3 draft that draws exactly
  what the published v2 version draws. Compared with the draft alone it would stay v3, the
  preview would report "Updated shop logo" against an unchanged drawing, and Discard could not
  bring it back, because Discard re-reads the server draft. Compared with the published version
  too, it becomes that v2 logo again: the same bytes, the same fingerprint, no changes. A
  published version that no longer matches its fingerprint does not block the save. The
  comparison is skipped, and every read of that version still reports the corruption. The
  rule is on the server so it covers every writer, not only the workspace. A save that leaves
  the logo alone therefore leaves its bytes, its draft fingerprint and the preview's
  `matches_latest_published` alone, and an edit to a product reports the product and nothing
  about the logo. The other colour, another mark or another background is a change: it is
  written as v3 and reported as "Updated shop logo".
- **A writer that sends no colour.** `ShopLogoSchema.to_domain` gives an absent colour the
  derived one, and the rule above then applies to the result. An old client re-sending
  `{mark, background}` for an unchanged v2 logo keeps it v2, exactly as the workspace's echo
  does. The same request for any other logo, a new shop's included, stores v3 with the derived
  colour. The request never says whether a colour was chosen, so the same logo gets the same
  document whichever way it arrived.
- **The workspace still echoes the colour.** `toPayload` strips the derived evidence it can
  recognise (ratings, the resolved default tone). The answer does not mark a v2 logo's colour
  as derived, and adding such a marker would be one more response field for the server to
  keep in agreement. The rule is on the server anyway, so the echo is harmless.
- The reader refuses what a token does not promise, naming the path: `logo` under v1,
  `mark_colour` under v2 (even `null`), a v2 `mark` of `null`, and a v3 logo without
  `mark_colour` or with an unknown one. v1 and v2 code refuses a v3 document by its token.

The change summary is unchanged: a different colour, a different mark (monogram included) or a
different background is one "Updated shop logo".

### Contract diff

- `ShopLogoSchema`, the request, gains an optional `mark_colour` (`ShopMarkColour`, nullable,
  default `null`). Absent or `null` takes the colour of the higher contrast against the
  background, so a writer that sends `{mark, background}` keeps working. `mark` may now be
  `null` for the monogram, which widens the request.
- `ShopLogoViewSchema`, new, is the response logo: `mark` (nullable), `background`, and a
  required `mark_colour`, which is the chosen colour or, for a stored v2 logo, the derived one.
  `ShopContentSchema.logo` and `ShopSummarySchema.logo` now reference it. This follows the
  `ProductSchema`/`ProductViewSchema` split.
- `ShopMarkColour` is new: `white` and `ink`. `ShopLogoBackground` gains `brick`.

Three things widen on responses. `logo.mark` can be `null` (a monogram), `logo.background` can
be `brick`, and the logo is `ShopLogoViewSchema` rather than `ShopLogoSchema`, with a required
`mark_colour` added. `docs/api-and-schema-conventions.md` does not define "compatible", so the
reasoning is stated here. The only consumer of this contract is the workspace, and its types
are regenerated and its code updated in this same change. A `null` mark or `brick` appears only
once a writer that knows about them stores one, and no document stored before this change holds
either. A response gaining a required field is additive for a reader. No existing field is
removed or retyped for anything already stored.

### Verification of the amendment

- `test_shop_logo.py`: the eight backgrounds in order and the two colours; all sixteen pairs,
  each ratio and each warning; the derived colour a v2 logo is drawn in; any pair constructs,
  and a monogram without a colour does not.
- `test_shop_payload.py`: v1 bytes unchanged; the recorded v2 document reads with the derived
  Ink and renders back to its bytes and fingerprint; v3 round-trips with a mark and with the
  monogram; the fingerprint moves with each of the three fields; v1 and v2 readers refuse v3 by
  name; every refusal listed above.
- `test_shops.py`: the recorded v2 row reads through `get_version` with its fingerprint, as the
  draft and in the listing, and its preview still matches the published version; a v2 draft
  sent back with its derived colour keeps the recorded bytes and fingerprint, and the other
  colour or another mark stores v3.
- `test_shop_logo_v2_api.py`: through the API, a colour changed and changed back returns the
  draft to the published v2 bytes and fingerprint with no changes, whether the writer sends
  the colour or not; a published v3 logo stays v3; a corrupt published version does not block
  a draft save and is still refused on read. A v2 draft read and written back unchanged keeps
  its stored document, with no changes and a preview that matches the published version; a
  product edit reports no logo change and keeps v2; an old writer's `{mark, background}` keeps
  v2; the other colour, another mark or another background stores v3 and reports "Updated
  shop logo"; a new logo without a colour is stored as v3 with the derived one.
- `test_shop_logo.py`: `keep_unchosen_logo` keeps the stored logo for the echo alone.
- `test_shop_api.py`: a chosen colour round-trips; `{mark, background}` alone answers the
  derived colour; a low-contrast pair and a monogram save and publish; a stored v2 logo is
  answered with its derived colour.
- `shopLogo.test.ts`: the palette read out of `domain/shop.py`; the sixteen pairs and their
  warnings. `App.test.tsx`: the three rows, the warning appearing and going with the pair,
  Save working through it, the monogram on Brick, a v2 logo opening on its derived Ink.
  `Shops.test.tsx`: the swatches named by their colours, Brick's hex, arrow keys and one tab
  stop per group, the badge in the chosen colour, a create through the warning, the warning
  announced politely in the warning ink and never as an alert, and the monogram chosen again
  on a shop without a logo leaving it without one. `App.test.tsx` also has a save from
  Products sending a v2 logo back exactly as it was answered.
  `AppShell.test.tsx`: a monogram logo in the switcher.

## Consequences

The shop payload has its second token, and no stored byte moved to get it. This sets a
precedent for any later optional member of a canonical payload: absent means unwritten, and the
token names what the document holds.
