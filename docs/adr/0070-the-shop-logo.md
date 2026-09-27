# ADR 0070 — The shop logo

Status: accepted — 2026-09-27

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

Rejected: **the prototype's coloured monogram**, chosen colours with no mark. Its letters are
text at 10.5px, so they fall under text contrast (4.5:1), a second rule for a second kind of
logo. The initials stay the no-logo state.

### The mark colour is derived, not chosen

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
- The coloured monogram, free colours, a chosen mark colour, and Brick.
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

## Consequences

The shop payload has its second token, and no stored byte moved to get it. This sets a
precedent for any later optional member of a canonical payload: absent means unwritten, and the
token names what the document holds.
