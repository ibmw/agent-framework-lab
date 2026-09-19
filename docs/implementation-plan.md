# Landing this mockup in `agent-framework-lab`

Written against the repo's own conventions: `docs/PLAN.md` delivery rules, `docs/PLAN-UX.md`
slice format, `docs/design-direction.md` frame authority, ADRs for decisions. Nothing below
invents a new process — it puts this work into the one already there.

---

## 0. First, separate the three kinds of change

The mockup looks like one thing. It is three, and they land differently.

**A — Pure presentation.** Button colour, icons, hover states, stat strip removal, field
alignment, rail icons, page-header alignment. No contract, no migration, no ADR. These are
edits to `lib/ui.ts` and the route files that consume it.

**B — Behaviour the backend already supports.** Guideline editing, scenario creation, binding
the product/customer editors to the clicked row. The API and contracts already carry these;
the mock exposes what the UI was not reaching.

**C — Genuine architecture decisions.** Two of them, and they are the long pole:

1. **Model provider becomes lab state, not environment state.** Today the provider, base URL,
   key and model are composed at start-up from `AGENT_LAB_OPENAI_API_KEY`, and
   `LabSettingsPage` reports them read-only. The mock makes them editable and lab-wide.
   That contradicts ADR 0044's refusal of a settings table, so it needs its own ADR, not a
   UI slice.
2. **`provider` on an agent configuration.** Additive contract + migration + validation
   against the proven-framework table, and a pin at publication so a recorded run keeps the
   provider it ran against.

Do C's ADRs before any of C's code. A and B can land in parallel and do not wait on them.

---

## 1. Make the mockup citable

`docs/design-direction.md` already says the authoritative frames live in `tmp/design-frames/`,
one self-contained `.dc.html` per frame, and that **UI slices cite frames**. This mockup is a
single document holding ~40 screens, so it does not fit that shape as-is.

Do this:

- Export the workspace mock into `tmp/design-frames/` as `Workspace.dc.html` (the standalone
  bundle already produced), and add it to the README index as the **navigation, chrome and
  form-pattern reference** — explicitly superseding the per-screen frames where they disagree.
- Update `docs/design-direction.md`'s **Implications** section. Its recorded token list says
  accent `#c2532d`; the mock moves primary actions to pine `#1d6241` and reserves the warm red
  for destructive. That is a change to the selected direction and belongs in that document,
  with the reasoning (red carried "safe expected action", which blurred the one signal a UI
  should not blur).
- Every slice below names the part of the frame it implements.

---

## 2. The slices

House rules apply to each: one branch, behaviour tests first, `make check` and `pnpm build`
green, no new UI dependency, the primitive ships with its first consumers.

### UI-1 · The button and colour layer
`branch: ui/primary-pine`

`lib/ui.ts` is the whole surface: `accentButtonClasses` moves off `bg-lab-accent` to pine,
`inkButtonClasses` stays, a destructive variant is added, and every variant gains its hover and
`focus-visible` ring. Add `iconLeadingClasses` so a button's glyph sizing is one decision rather
than 75.

Also: the mock gives ~75 buttons an icon on a fixed vocabulary — plus for create/add, check for
save/confirm, counter-clockwise for discard, pencil/trash/star, play for start, upload for
publish. Encode that as a small `buttonIcon` map next to the class sets so the pairing cannot
drift per page.

*Checks:* `FieldHint.test.tsx` style assertions if any, plus a new `ui.test.ts` asserting each
variant carries a hover and a focus ring.

### UI-2 · The field pattern
`branch: ui/field-pattern`

The mock's 107 rows share one shape: label and hint in a single left column, control right,
both top-aligned, wrapping to stacked below ~540px, label `for`/`id`-bound, visible focus ring.

Add a `Field` component beside `FieldHint.tsx` taking `{ label, hint, htmlFor, children }`,
and adopt it in the editor routes named in the same branch — start with
`ProductEditorPage`, `CustomerEditorPage`, `OrderEditorPage`, `ShopSetupPages`. Later slices
extend adoption; a `Field` no page uses is not a slice.

*Watch:* 44 of the mock's rows label a chip group or a custom widget, not a native control.
Those need `role="group"` + `aria-labelledby`, not a dangling `for`.

### UI-3 · Navigation rail
`branch: ui/rail-icons-collapse`

Icons per destination, expanded and collapsed; collapse control at the foot; collapsed rail is
a 52px strip of centred icons with the label on hover. `readNavigationCollapsed` /
`writeNavigationCollapsed` in `lib/preferences.ts` already exist — this slice is the consumer
they were written for. Touches `shell/ShopWorkspace.tsx` and `shell/LabSurface.tsx`.

### UI-4 · List pages: counts move into the filters
`branch: ui/filter-counts`

Delete the KPI stat strip from all eleven index routes; the filter chips carry the counts and
gain the matching icon. Five counts have no chip today and must gain one or the number is lost:
*Without a default address* (customers), *Required by a scenario* (policies), *Referenced by a
ticket* (orders), *Not composed yet* (both block libraries). Delete the now-unused count
selectors rather than leaving them computed.

*Checks:* each index page's existing spec asserts the count renders — repoint the assertion at
the chip.

### UI-5 · Page header alignment
`branch: ui/page-header-full-width`

`PageHeader` in `WorkspaceChrome.tsx` gains the variant the mock uses on Tone of voice, Shop
details and Tickets: title and actions span the full content width, side panel starts below.
This is why the Save button currently sits in a different place on three pages.

### UI-6 · Search affordance
`branch: ui/search-field`

One `SearchField` component: magnifier, 36px left padding, the `Search <thing>` placeholder
convention. Eleven consumers.

### UI-7 · The field control itself
`branch: ui/field-control`

The three input rules UI-2 could not reach: `min-height:44px`, a field border `#c9cccf` distinct
from the card border, and `14.5px` text. They live in `fieldControlClasses` and `textAreaClasses`
in `lib/ui.ts`, which every route shares, so a four-route slice may not apply them — the same
string paints a create form, an in-place row editor and a compact add-form. Its own slice, whose
consumer is the whole workspace.

The focus ring the handoff asks for on fields is already there from UI-1 and is not part of this.

*Checks:* the existing page tests, which assert on controls rather than on their metrics, plus
the whole Playwright suite — a 44px minimum changes where things sit on every surface a spec
scrolls.

### UI-8 · The rules the rows are missing
`branch: ui/field-hint-copy`

UI-2 shipped the row and authored no copy, which was the right line for a layout slice and leaves
the pattern half-delivered: the handoff writes a hint for all 107 rows and the workspace shows two
of them. This slice writes the rest, and it is a content slice — each hint is read against what
the surface actually renders, not transcribed.

Two things it must fix on the way, both found while adopting UI-2:

- **Five create-form hints are inline string literals, not exports** — Title
  (`ProductsPage.tsx:165`), Given name, Family name, Email, Customer since
  (`CustomersPage.tsx:208,217,227,240`) and the shop's own at `ShopsPage.tsx:185`. They are
  written, but not written once, so an editor row cannot reuse one without first pulling it into
  `lib/fieldRules.ts`. That is what makes them drift.
- **A rule is shown only where it is true.** `PRODUCT_CATEGORY_RULE` offers a pick list of the
  draft's categories; the product editor renders no datalist, so UI-2 left the rule off that row
  rather than promise what is not there. Either this slice's copy accounts for the difference or
  the datalist lands first — see the defect recorded in `docs/decisions-and-next-step.md`.

*Checks:* a sweep asserting every rule in `lib/fieldRules.ts` is consumed somewhere, so an export
nothing shows fails; per-page tests that the hint is in its control's accessible description, the
pattern Slice 1 of `docs/PLAN-UX.md` established.

---

## 3. The behaviour slices

### B-1 · Guideline editing
`ShopSetupPages.tsx`. Inline expand-in-place per row — name + body + slug preview, Done/Cancel,
Delete with the shop default protected. New-then-cancel must remove the appended row, and a
nameless guideline must not be committable or selectable as default. (Both were bugs in the
mock; the tests should encode them.)

### B-2 · Scenario creation
`ScenariosPage` gains a real create route matching the mock: name, ticket (customer and shop
version derived), hidden facts, objective blocks, mutation blocks. Blocked until name + at
least one objective, with the reason on the disabled control. Ticket select values are the
bare ref — the composed label belongs in the hint, not the option value.

### B-3 · Editors bind to the clicked row
`ProductEditorPage` and `CustomerEditorPage` load the record from the route param rather than a
single fixture. Likely already correct in the real app; confirm before writing a slice for it.

---

## 4. The two ADRs

### ADR · Where the model connection lives
The decision, not the form: does the provider connection move into the lab's database, and if
so how is the key stored, who may change it, and what does a run pin?

The mock's position, worth arguing for or against explicitly:

- One connection per lab, OpenAI-compatible only. Presets for OpenAI, Ollama, vLLM, OpenRouter,
  Together, plus Custom; base URL editable in every case.
- The key is per provider, stored encrypted, never returned — the API returns a mask and an
  added-date, never the value.
- Saving a connection affects runs started afterwards. A recorded run keeps provider, base URL
  and model, and Results reads them back from the run.
- Env remains the bootstrap: a lab with no saved connection falls back to
  `AGENT_LAB_OPENAI_API_KEY`, which is what keeps `make seed` and CI working unattended.

This is where ADR 0044's "no settings table" is revisited. The distinction that lets both hold:
0044 refused *stored operator progress*; this stores *a capability of the lab*. Say so in the
ADR or the two decisions will read as contradictory later.

Backend work it implies: contract types, a migration, secret handling, a `POST .../test`
endpoint for the connection check, and provider/base-URL/model columns on the run record.

### ADR · Provider on an agent configuration
Additive field, validated against the proven table: an unproven *framework, architecture or
provider* is refused at publication; an unproven *model* is a warning that publishes anyway —
that asymmetry already exists and should be stated rather than re-derived. A configuration
naming a provider the lab is not currently pointed at is valid but unrunnable, and the editor
says so.

---

## 5. Suggested order

1. Two ADRs (parallel, no code).
2. UI-1, UI-2 — everything else inherits them.
3. UI-3, UI-4, UI-5, UI-6 — independent, parallelisable.
4. UI-7, then UI-8 — both fell out of UI-2 and neither blocks anything above.
5. B-1, B-2, B-3.
6. Provider milestone: contracts → migration → API → `LabSettingsPage` → agent configuration
   field.

UI-1 and UI-2 first is the load-bearing call: every later slice touches buttons and fields, and
doing them last means editing the same lines twice.

UI-7 sits after the independent four rather than beside UI-2 because it repaints every control in
the workspace: doing it while four branches are open would make each of them answer for a
diff it did not cause. UI-8 follows UI-7 because a hint is written against the control the reader
is looking at.

---

## 6. Two things in the mock that are proposals, not requirements

- **Five new browser preferences** — where the app opens, auto-offer tour, confirm before
  delete, timestamp format, table density. Each needs a real consumer to exist, per the house
  rule. Cut any that do not earn one.
- **Shop logo** (icon, background, mark colour) — three columns on the shop record and a
  contrast check in the editor. Pleasant, not load-bearing; sequence it last or drop it.
