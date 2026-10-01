# ADR 0075 — A row's Edit and Remove are icons named by the row, and the confirm is the warm red

Status: accepted — 2026-10-01

On 1 October 2026 the operator asked that every row-level Edit and Remove be the 30px pencil and
trash Milestone 10's lists draw (ADR 0074), never a written *Edit* or a red-bordered *Remove
NS-ASJ-OB-M*, and that removing read red everywhere. Asked how red the trash should be, they
chose *neutral until hover*: the trash stays grey and warms on hover, and the confirm it asks
for is the solid red. This amends two rules of `docs/design-direction.md`, *Tokens, type and
glyphs* — *a destructive control keeps its glyph and its verb*, and *a button names a verb*,
whose word the `buttonIcon` table's glyphs (`lib/ui.ts`) only accompany — for a row's actions,
and settles what ADR 0074 left on `EntryCard`.

## Decision

### Every row's Edit and Remove is the item's icon, its verb in its name

A row's Edit is `EditButton` and a row's Remove is `TrashButton` — `RemoveButton` where it asks
twice (ADR 0060), bare where the row removes in one press — all in `components/ItemList.tsx` on
`itemEditButtonClasses` and `itemRemoveButtonClasses`. The verb is not drawn: it is the
button's accessible name and its `title`, and the glyph is `aria-hidden`. The names do not move —
"Edit {name}", "Remove {name}", the catalog's "Delete {title}", the background entry's and a
ticket message's own words — so every spec and test that reached a row action by its name still
does. A held trash keeps its reason in its `title` and its description (ADR 0063); a pencil that
cannot open while another row is open is natively disabled and described by the list's notice,
and fades as the held trash does.

This reaches what ADR 0074 left on `EntryCard`: the product's variants table, a scenario's
composed objectives and mutations (whose ↑/↓ become `MoveButton`, as a template's parameters'
are), and a new block's parameters on its create page; and the rows that were never on
`EntryCard`: the catalog's Delete, a ticket's messages, and a ticket's unresolved suggested
document. The row's icons stand 11px apart, as an item's do.

### What keeps its words

- **An open row's *Save* and *Cancel*.** They are the row's form answering, not an action on the
  row, and they stand under the fields as the item form's *Save changes* and *Cancel* do.
- **A page's or a card's own action**: the product's and the order's header *Delete*, *Duplicate*,
  *Discard changes*, and the document editor's *Remove* in its card's footer, which removes the
  page's whole subject. The small red-bordered weight (`destructiveSubtleButtonClasses`) is left to
  that one Remove.
- **A verb that is not Edit or Remove**: *Duplicate* on a catalog row, *Detach*, *Unlink*,
  *Make default*, *Forget*.
- **A chip's ×** — a tag on the results, a value in a `ChipListField` — which is part of the chip.

### The confirm's press is the solid warm red

`ConfirmRemove`'s press — *Remove it*, *Delete it*, *Delete permanently* — is
`destructiveButtonClasses`: `lab-paper` on `lab-error` (`#fffdf8` on `#9d3028`, 7.16:1), and on
`lab-error-hover` (`#86271f`, 8.89:1) under the pointer, both above AA's 4.5:1 for its 14px
words. *Keep it* stays the neutral outline. The trash itself stays grey with a red hover, and so
does a chip's ✕: the red says *this destroys* at the press that does, and a list of entries is
not a column of red.

A second press that destroys nothing — *Detach*, which leaves the profile whole
(`destroys={false}`) — spends no red at all, because the warm red is destructive and nothing
else: the panel is grey (`admin-border` on `admin-canvas`), the question in ink, and the press
the forest `ink` weight, set apart from *Keep it*'s outline without claiming the pine of the
expected action. It carried the trash glyph's absence before; it now carries the colour's too.

## Consequences

- No behaviour moves: the confirm-twice preference (ADR 0060), focus on the confirm group and
  back on the trash, and every notice are as they were.
- A new row action is the pencil or the trash. `lib/ui.test.ts` reads every `<button>`,
  `<PrimaryAction>`, `<Link>` and `<a>` in the workspace's `.tsx` sources — the text between the
  element's tags and every string or template literal in its `{…}` expressions — and refuses a
  run of words beginning *Edit*, *Remove* or *Delete* on any but the three page and card actions
  above. It does not read a label passed through an identifier or a prop (`{confirmLabel}`), words
  inside JSX nested in an expression, or another component's own buttons by their call site.
  The pencil glyph, however its verb is quoted, is `EditButton`'s alone.

## Departures

- **A composed block's ↑/↓ are `MoveButton`**, the 30px arrows a template's parameters carry,
  with their names kept: the brief named Edit and Remove, and a row of icons with two small text
  arrows beside them would be two geometries on one row.
- **A ticket message's trash stands at the end of its row**, not in the 11px line under the
  bubble where its written *Remove* stood: a 30px box would have made that line the row's tallest.
- **The *Detach* confirm is neutral** where it was solid red (above).
- **A chip's ✕ warms to the red on hover** in `ChipListField`, where it went to ink, as the
  results' tag × already did.
- **A ticket's unresolved suggested document keeps its one-press removal** on an editor, where
  ADR 0060 exempts only a create page's rows: it was one press before this record, which moves
  no behaviour, and it is now the bare `TrashButton`.

## Verification

- `lib/ui.test.ts`, *a row's Edit and Remove*: the source sweep, its floor, and a synthetic case
  proving it reads a verb past an arrow and a `>` in an attribute, in a string and a template
  literal, in either arm of a conditional, on a `Link` and an `a`, and the pencil however quoted; the small red weight's
  one consumer; the pencil's disabled fade; *the confirm's press*: its classes and both grounds'
  contrast read off `styles.css`.
- `ItemList.test.tsx`: the trash writes no verb, the confirm's press is the solid red and *Keep
  it* the outline; a detach's confirm has no red on its press, ground or question; a one-press
  trash removes once and a held one says why. `ChipListField.test.tsx`: the ✕'s red hover.
- `EntryCard.test.tsx` and `ButtonIcon.test.tsx`: the row's Edit is the pencil under its name,
  and the open row's Save and Cancel keep their words.
