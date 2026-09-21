# ADR 0051 — Unsaved work is asked about once: a data router, one register, one prompt

Status: accepted — 2026-09-15

Moves the application from `BrowserRouter` to `createBrowserRouter` and `RouterProvider` with the
route tree unchanged, and adds the guard that PLAN-UX Slice 8 asks for: a navigation that would
strand unsaved work is blocked and offers Save, Discard and Stay, a reload is preceded by the
browser's own question, and every editor gains a "Discard changes" beside its Save and reports its
clean state as a status rather than as a disabled button.

Records three decisions and one concession: that the blocker is one and sits above the route tree
rather than inside `useDefinitionEditor` as the plan's wording has it, because a router consults
exactly one; that a row opened by `EntryCard` edit mode declares itself into the same register as
a dirty draft; and that the prompt does not offer to save such a row. The concession is that the
prompt is therefore not always a three-way choice.

## Context

Every editor in the workspace could lose work to a click. `useDefinitionEditor` tracked `dirty` and
used it to gate Publish, and nothing else read it; the order editor tracked its own and used it to
disable Save. A rail link, the shop switcher, a reload — each threw the edits away without a word.
PLAN-UX's acceptance criteria name it directly: *no navigation, reload or Remove discards an edit
without asking once.*

`useBlocker` is the mechanism, and it exists only on a data router, so the migration comes with it.

Slice 7 left a second, harder half. `EntryCard` edit mode holds an open row's typing **outside**
the draft's `content` on purpose: Cancel then has nothing to undo, the page's Save cannot half-write
a row, and the list can say so in one sentence. The consequence is that `dirty` is false while an
operator retypes three paragraphs of the returns policy in an open row, and a guard reading `dirty`
would let them walk away from it. That slice's revision in `docs/design-direction.md` says so, names
the three shapes the registration could take — a page counting its open rows into `dirty`, holding
them beside it, or lifting the editors into a context — and leaves the choice here. A page holds
several of these lists: five on the product editor, two each on Shop details and Policies & FAQ,
one each on Support guidelines and Tone of voice, plus the customer editor's two and the variants
table. None of them is reachable from the hook the plan puts the guard in.

## Decision

### The route tree moves to a data router and stays the tree it was

`App.tsx` builds `createBrowserRouter(routeTree)` and renders `RouterProvider`; `main.tsx` mounts
`<App />`. `routeTree.tsx` exports `routeTree`, still written as `<Route>` elements and translated
by `createRoutesFromElements`, so the diff on the routes themselves is an indentation change and a
wrapper. The forty-three URL patterns the application answered before are the forty-three it
answers now, asserted as a list rather than assumed.

The one structural addition is a **pathless root layout** holding `UnsavedChangesGuard`. It matches
no URL, contributes no segment, and exists so there is a component above every route that is inside
the router — which is what `useBlocker` requires and what the prompt has to be drawn from.

Component tests that mounted the tree under `MemoryRouter` now build a memory **data** router
(`src/test/app.tsx`), because a suite driving a router the application does not use would prove
nothing about the thing this slice adds.

### The hook declares; one guard asks

PLAN-UX says to guard `dirty` *inside* `useDefinitionEditor`. Taken literally that does not work,
and the reason is in the router rather than in the hook: `shouldBlockNavigation` in
`@remix-run/router` warns "a router only supports one blocker at a time" and consults the last one
registered. `ShopWorkspace` holds a `useDefinitionEditor` for the shop draft on the **layout** route,
so it is mounted at the same time as the customer, ticket, scenario, block, judge, agent-configuration
and support-identity editors, each of which holds one of its own. A `useBlocker` per hook would be
two to three blockers on most screens, of which one would be consulted and the rest silently ignored.

So the placement is split, and the half that matters is kept where the plan puts it:

- **`useDefinitionEditor` declares its unsaved draft** while `dirty`, through
  `useRegisterUnsavedWork` (`lib/unsavedWork.ts`). That is one call, written once, in the hook —
  every editor that runs on it is guarded by existing, and none of them wires anything.
- **`UnsavedChangesGuard` asks**, once, from the pathless root: one `useBlocker` over the register,
  one `beforeunload` listener, one prompt.

The order editor, which is a fixture rather than a versioned definition and tracks its own `dirty`,
declares itself the same way from the page.

This is recorded as a **departure** from the plan's wording, not a reinterpretation of it: the
sentence is right about where the flag lives and wrong about where the one question can be asked.

### An open row declares itself, held beside the draft rather than counted into it

`useEntryEdit` declares the open row — one declaration per list, made by the hook every editable
list already calls. That is Slice 7's second option, *held beside it*, and the other two were
refused for reasons that are about correctness rather than taste:

- **Counting an open row into `dirty`** would make the page's own "Save draft" claim to carry work
  it does not write. Slice 7 put a line under every such list saying the opposite — "nothing in the
  open row reaches the draft until you press Save" — and the publish gate reads the same flag, so a
  page would refuse to publish over typing that no payload contains.
- **Lifting the editors into a context** moves thirteen pieces of genuinely local state up a level
  to buy a fact that one line of the hook already knows. It would also blur Slice 7's "one row at a
  time, **per list**" into one per page, which is a different product.

Declaring from the hook has the property the other two were reaching for: **no page can hold an
editable list and forget to guard it.** There is nothing per-page to write, and a list added
tomorrow is guarded on the day it is written.

### What the prompt offers, and what it declines to offer

A blocked navigation draws one modal `role="dialog"` naming the work *this* navigation would strand
— work the destination can still save is not touched, because discarding a draft the operator never
asked to leave would be the loss the prompt exists to prevent.

- **Save and leave** runs each piece's own save and proceeds when every one lands.
- **Discard and leave** throws each piece away — a draft by re-reading what the lab holds, an open
  row by closing — and proceeds.
- **Stay on this page** resets the blocker. Escape does the same thing; focus moves into the dialog
  on open, cycles inside it on Tab, and returns to where it was on close.

**A refused save keeps the navigation pending.** A save can 409 or 422, and the prompt is over the
page that would explain it, so `save` answers with the refusal rather than setting it aside: the
message is shown *in* the prompt, the page is not left, and the same three choices stand. (The
message is returned rather than read back off the editor afterwards because the prompt is an
ancestor of the editor and therefore renders before it in the commit that records the failure.)

**An open row is not saved from the prompt.** It carries no `save`, so while one is open "Save and
leave" is disabled and says why, on the `PublishReasons` model: *a row that is open for editing
cannot be saved from here; nothing typed in it has reached the draft yet — stay, then press the
row's own Save or Cancel.* The prompt is therefore sometimes a two-way choice, and that is the
concession this ADR records.

The alternative was a Save that commits the open rows and then saves the drafts. It cannot be done
in one press without either sending the draft as it was *before* the row was committed — silent
data loss, the exact failure being guarded against — or re-entering the prompt for the draft the
commit just dirtied. A second press dressed as one is worse than a disabled button that says what
to press instead, and it would contradict the sentence Slice 7 already prints under every list.

### A read that outlives its editor is dropped

Two of these editors are reused across a change of `id` rather than remounted: the shop draft,
which lives on the `/shops/:shopId` layout, and the ticket editor beside its list. The order
editor *would* be — nothing in the workspace links one order editor to another today, so two
`/orders/:orderId` entries are never adjacent in history and an address-bar entry is a full load
that remounts, but the reuse is a property of the route rather than of the links that happen to
exist, and PLAN-UX Slice 9 puts a row action on the orders index. It keeps the token; it costs a
comparison. Discard-and-leave fires the re-read
and navigates without waiting for it, so a re-read of A can still be in flight when the load
effect's read of B lands — and applying it would put A's content under B's id, report it clean,
and let the next Save write it there. Nothing orders two independent GETs.

`save` already carried the rule, in the edit token it takes before the request and checks
before applying the echo. `discard` did not, and now does — in `useDefinitionEditor` and in the
order editor, over its success path, its failure path's `setDirty(true)`, and its error. The
load effect and `edit` both bump the token, so a response that outlived either is dropped; the
same check is what makes typing during a slow re-read survive it. Only the busy flag is cleared
unconditionally, because it is the control's state rather than content and a stuck one would
disable the buttons of a draft that has nothing to do with the request.

This is what `AGENTS.md` means by keeping updates concurrency-safe, and it is invisible to a
suite whose transport answers in issue order — so the test holds two reads open and chooses
which lands first.

### Reach, not route: what strands the shop draft

Every editor but one is mounted by the page it edits, so leaving that page strands it and any
change of pathname blocks. The shop draft is the exception: `ShopWorkspace` holds it on the layout
route and it survives every move inside the shop, but only Home, Products, the product editor and
the four setup pages draw its Save. So the question for it is not *am I leaving the page* but *can
the destination still save this*, answered by `shopDraftIsSavableAt` in `lib/shop.ts`. Moving from
the catalog into a product asks nothing; clicking Orders in the rail asks — which is exactly the
journey PLAN-UX's evidence describes.

One consequence is worth naming because it bit once already. The order editor deletes the order
and then navigates, in the same handler: the router asks the blocker before React has committed
anything, so clearing a `dirty` held in state would not have been seen and the prompt would have
asked whether to save an order the lab no longer holds. Its registration answers `reaches` from a
ref set by the delete instead — nothing strands edits to something that is gone — and a test
asserts the prompt stays away.

### A create that navigates does it once, and the flag it reads is a ref

The data router changed one thing beyond the guard: `navigate()` is no longer a synchronous
`history.push` but an asynchronous run through the router's own state machine. Anything that
navigates twice for one action was previously two synchronous pushes to the same URL and is now
two interruptible navigations, and the workspace had one such place — the Tickets page, which
PLAN-UX Slice 10 names as the model for eight more surfaces.

Creating a ticket navigates into it. The page also opens the most recently updated ticket when
it is given none, from an effect. That effect is scheduled from the render the reloaded list
produces, and in that render `ticketId` is still undefined although the create's navigation is
already on its way — so it fired **behind every single create**, sending a second navigation
after the first. Instrumenting the suite showed it at a rate of one per create, twelve for
twelve.

Both navigations named the same ticket, so no interleaving of them could land on the wrong page,
and no failure was ever reproduced from it. It is removed anyway: a redundant asynchronous
navigation issued while the page it lands on is mounting and fetching is not a thing to leave in
place on the strength of not having caught it misbehaving. The effect now skips while a create
is opening a ticket, and reads that from a **ref** — the same lesson as the order editor's
delete above, and for the same reason: an effect cannot read state it is racing.

What Slice 10 should copy from this is **"reload, then navigate once"**, and not the ref. The
ref exists only because this page owns an auto-open redirect effect that competes with its own
create; none of the eight surfaces Slice 10 names has one, and a ref added there would be
guarding against nothing.

The flag is cleared only when a ticket is named. Clearing it after awaiting the navigation — so
that a create the guard blocked hands the redirect back — puts the double navigation straight
back, because the reload's own render has not necessarily flushed by the time the navigation
resolves and its effect then finds the flag already down. The accepted cost, named precisely: a
create whose navigation was blocked leaves that page's auto-open idle for the rest of the visit,
so a filter change that empties and refills the list will not re-open the most recent ticket the
way it otherwise would. Reaching it needs a blocked create, which needs something stranded in
the register while standing on a list page that registers nothing.

A third shape removes the ref altogether — run the auto-open once per *arrival*, keyed on the
location — and it is the one a later slice should take if this page is opened again. It is out
of scope here because it also changes what happens on a filter change, which is behaviour this
slice has no business moving.

### `beforeunload` is armed by the register, and by nothing else

One listener, live while the register holds anything. An open row counts: a reload destroys it
exactly as it destroys a dirty draft, and the browser's own question is the only ask available.
A half-typed create form does not: it is not an edit to something that exists, and arming on every
keystroke in every field would make the prompt mean nothing.

### The clean state is a status, and Discard undoes what Save would have written

`EditorSaveActions` replaces eleven hand-written headers. A dirty editor shows **Discard changes**
beside **Save draft**; a clean one shows neither and reports "All changes saved" in a polite live
region, so a save that lands is announced to a reader whose focus was on the button that has just
gone. What it replaces — a disabled accent button reading "Saved" — was a control offering an action
it would not perform, in the place the eye looks for an action.

A save is the editor's, not the button's: `DefinitionGuard` carries an optional `afterSave`,
which the hook runs after any save that landed. Both editors that had a wrapper use it. The shop
workspace refreshes the switcher's list of shop names, and the ticket editor re-reads its context
panel and its list — and the ticket is the one that shows why this is not cosmetic, because the
list and the related-ticket links move between tickets *inside* one page: renaming a ticket and
answering the prompt with Save left the list showing the old subject without the operator going
anywhere.

It runs **outside** the write's own error handling and its failure is swallowed. Inside, a
follow-up that threw would be returned as a refusal: the prompt would show its message and hold
the navigation over a draft that had already landed, telling the operator their edit had not been
saved when it had. A contract that instead asked every caller to remember not to throw is the
kind of rule this work keeps finding broken.

Discard re-reads the draft from the lab and **leaves open rows alone**, which is the same rule read
backwards: it undoes exactly what Save would have written, and Save has never carried an open row.
A row whose entry the re-read has dropped still closes, by the derived rule Slice 7 built for it.

It marks the draft clean before the request rather than after it. Otherwise a navigation the
operator has already chosen — *Discard and leave* — would be blocked a second time by the very
edits they just threw away. A re-read that fails puts the flag back, because the edits are then
still on screen and still the only copy of themselves.

## Deliberately not here

- **A `useBlocker` per editor.** The router consults one. Two is a warning and a silently ignored
  guard.
- **Guarding a create form's half-typed fields.** Nothing exists yet to lose; see above.
- **A two-step confirm on Remove.** PLAN-UX Slice 9 adds `ConfirmRemove` and shares this blocker
  where a removal navigates. Nothing here is shaped against it.
- **Navigating into what was just created.** Slice 10. `reaches` is what keeps such a navigation
  from meeting a prompt raised by the draft the create itself dirtied.
- **A focus-trap dependency, or `<dialog>`.** The prompt is thirty lines of focus handling on the
  existing chrome; `<dialog>`'s `showModal` is unimplemented in jsdom, so adopting it would have
  meant a polyfill in the suite to test a modality the workspace can express itself.
- **A browser proof of `beforeunload`.** It is available — Chromium dismisses that dialog on its
  own only while no `page.on("dialog")` listener is registered, and `page.close({ runBeforeUnload:
  true })` fires one for a page that has the user activation Chromium requires, which an edited
  field supplies. It is not taken: the unit test already asserts the event is preventable only
  while there is unsaved work, and closing a page mid-spec is machinery this suite does not
  otherwise have. Recorded so the next reader knows the option exists rather than believing it
  was impossible.
- **Blocking a change of search parameters.** History's filters navigate; the blocker is only asked
  about a pathname that differs from the current one.

## Consequences

An editor's header is two controls and a status line instead of one button, on every editor at
once. Eleven pages lost their own copy of that header and share one component; the eleven were
already identical, which is why they could.

Nothing in the workspace can now leave unsaved work without asking, and the one thing it cannot
offer to save from the prompt — an open row — is named where it can be saved. The cost is that an
operator who has a row open and wants to leave with it saved presses Stay, saves the row, saves the
draft, and then leaves: three presses where a dirty draft alone takes one.

## Verification

- `definitionEditor.test.tsx` drives the guard over a stub client on a memory data router: a clean
  editor is left without a word; a dirty one is asked and Stay keeps the page and the edit; Save
  and leave saves and proceeds; a refused save keeps the navigation pending and shows the refusal
  inside the prompt; Discard and leave re-reads the draft and proceeds; a destination the draft's
  `reaches` covers is silent; the prompt takes focus, cycles Tab inside itself and answers Escape
  as Stay; `beforeunload` is preventable only while there is an edit. Two more cover the header:
  Discard restores what the lab holds and the editor reports itself saved, and a clean editor
  offers neither control.
- `App.test.tsx` asserts the route tree: one pathless root holding the guard, and the exact list of
  URL patterns the tree answers, so the migration is verified rather than assumed. It then drives
  the real pages — a product edit asked about on the way to Orders and not on the way to the
  catalog, and a policy row left open, named in the prompt, with "Save and leave" disabled and
  carrying its reason as an accessible description.
- Every Playwright test asserts on its way out that the unsaved-changes prompt is not still on
  screen (`tests/e2e/support/e2e.ts`). A blocked navigation simply does not happen, so a spec
  that met the prompt by accident would wait out its timeout on a page it never reached and
  report a missing heading — a symptom that says nothing about the guard. This turns the slice's
  evidence sentence, *no spec drove a page through the new prompt unintentionally*, from an
  observation made once into a check every run makes. A test that has already failed is
  annotated rather than failed again, so it can only add a reason and never replace one.
- `Tickets.test.tsx` asserts that creating a ticket produces exactly one new location, which
  fails on the effect this ADR removes; and that a ticket renamed and then left through the
  prompt's Save leaves the list showing the new subject, which fails without `afterSave`.
- `definitionEditor.test.tsx` holds both reads open and releases B's before A's, asserting that
  A's content never reaches B's editor and that the Save which follows writes B's; it asserts
  the same token drops a re-read that typing has overtaken. Both fail without the check. It also
  drives the refused re-read that puts the flag back, and a second Save-and-leave after a
  refusal.
- `App.test.tsx` pins each URL to the **component** that answers it, not only to the path, so a
  tree that kept every path while swapping two elements fails; and it sweeps
  `shopDraftIsSavableAt` over the tree's own shop routes rather than over a list somebody keeps.
  It also drives one prompt holding both kinds of unsaved work at once — a dirty draft and an
  open row — asserting both are named, that Save is refused for the pair, and that Discard
  leaves nothing behind.
- `workspace-shell.spec.ts` walks the slice's own evidence in a browser: an operator edits a
  product description, moves to the catalog unasked, is asked on the way to Orders, stays, is asked
  again, discards, and finds the description the lab actually holds.
- The whole Playwright suite runs, twice, in parallel. The slice's evidence is partly that no
  existing spec drove a page through the new prompt, which only running all of them shows. Eleven
  spec assertions changed for two honest reasons: the disabled "Saved" button they waited on no
  longer exists, and an unscoped `getByRole("status")` is now ambiguous on an editor page because
  the header carries a status line of its own.
- `make check` passes and `pnpm build` runs.

## Migration

None a database, a contract or a published version would notice. No table, column, canonical
document, fingerprint, tool contract or HTTP contract changes. A bookmark to any URL resolves to
the same page it did.
