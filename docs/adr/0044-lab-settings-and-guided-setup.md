# ADR 0044 — Lab settings, and a guide that reads the record rather than remembering the reader

Status: accepted, partially superseded by ADR 0045 and ADR 0046 — 2026-09-11

Opens Milestone 7. Every milestone before it was about what the lab records; this one is the first
about the person operating it. It adds a lab-level settings surface outside shop scope, a guide
mode, and a guided path from an empty database to a two-arm comparison.

Records six decisions: that lab settings are not shop settings and therefore do not live inside a
shop, that the guide's progress is projected from the record rather than stored, that the stored
preference is an override rather than a state, that the guide hands over a command wherever the
product deliberately refuses a route, that the settings surface reports composition and never edits
it, and that lab-level surfaces sit outside the 18-frame shop-workspace set while the guide strip
does not.

ADR 0045 changes three of them, in three different ways, and "reverses" is only right about one.
What it **reverses** is the refusal recorded under "Deliberately not here": the overlay product
tour is built. What it **voids** is the second decision above — the guide's progress was projected
from the record rather than stored, and there is now no guide progress at all, because the reading
was deleted rather than relocated. What it **retires** is the second half of the sixth: the strip's
frame leaves the authoritative set, which returns to eighteen. The other three — that lab settings
are not shop settings, that the stored preference is an override rather than a state, and that the
settings surface reports composition and never edits it — stand untouched, as do the
command-not-a-route rule and the glossary. The narrowing notes below say what each of the three
leaves standing.

ADR 0046 then **voids the third**: guide mode is removed outright and the *Show me around* controls
are unconditional, so there is no override left to be an override rather than a state. What survives
of that decision is its reasoning about where a browser preference lives, which now governs the two
view preferences this ADR introduced alongside the mode — the rail's default collapsed state and the
last-visited shop — and those are unchanged. The notes below mark what ADR 0046 reaches.

## Context

The chain a first-time operator has to walk is the one ADR 0043 measured when it automated it: a
shop with a catalog and a default tone of voice, a customer profile, an order, a ticket, three
objective templates and a fault template, a composed recipe, a support identity, two agent
configurations differing in one dimension, a judge, and then an experiment driven to completion.
Nine kinds of definition, twelve published versions, and a dependency order in which almost every
gate refuses until the one before it has been satisfied. (Nine is the number of definitions the
contract publishes; the guided path below walks ten steps, eight of which end in a publication,
because the two block libraries are one step and the order fixture and the experiment are not
definitions.) ADR 0043 called doing it by hand "roughly
an afternoon of clicking through gates in dependency order", and built `make seed` so that nobody in
this repository would have to.

`make seed` solves that for a developer with a terminal open in the checkout. It does not solve it
for the person who is looking at the product, because nothing in the product says the command
exists, what order the gates come in, or what any of the vocabulary means. The words the application
uses on screen — objective block, mutation block, canonical snapshot, arm, starting- state
fingerprint, participant driver — are defined in `docs/PLAN.md` under "Stable target vocabulary" and
nowhere a reader of the application can reach them.

Two further things the lab knows about itself are invisible on every screen. The first is which
frameworks, architectures, providers and models this build has actually proven it can run:
`PROVEN_FRAMEWORKS` in `application/agent_capabilities.py`, already served at `GET
/api/v1/agent-configurations/resources` and read today only by the agent-configuration editor's
framework picker, which renders one label per entry and none of the envelope around it. `GET
/api/v1/agent-frameworks` answers a different question — which adapters *this process* has
registered, which depends on the machine — and is deliberately not the table a settings surface
reports, for the same reason the catalog is kept apart from the registry in the first place. The
second is the standing consequence of running without a credential. ADR 0042 established that
offline both arms' decisions are identical by construction, so what an offline comparison
establishes is the evidence model rather than a difference between frameworks, and ADR 0043 put that
qualification onto the seeded run in three places a viewer reads. But it is a property of the build,
not of one run: every comparison produced without `AGENT_LAB_OPENAI_API_KEY` inherits it, including
ones an operator drives themselves, and none of those carry a label anybody wrote.

There is also a naming problem waiting for any lab-level surface. `shell/AppShell.tsx` already has a
sidebar entry labelled **Settings**, under the "Shop setup" section, routing to
`/shops/:shopId/setup/identity` — the shop's own name, slug, locale, currencies and channels. A
second thing called Settings, meaning the lab, would collide with it in the one place this product
spends most of its vocabulary keeping apart: what is scoped to a shop and what is not.

## Decision

### Lab settings are not shop settings, and do not live inside a shop

The lab surface is `/settings`, a top-level route beside `/shops`, reached from a control in the
header next to the `Synthetic sandbox` badge. It renders through `AppShell` with no `currentShopId`,
which is the no-rail layout `ShopsPage` already uses. The guides live beside it at `/guides`, on the
same footing.

The rejected alternative was a fourth sidebar section — a "Lab" group under "Experiment lab ·
cross-shop", at `/shops/:shopId/settings`. It is not obviously wrong: that section is itself the
precedent, since support identities, agent configurations and judges are all shop-*independent*
definitions served today at shop-scoped URLs, with the section title carrying the distinction the
path does not.

It was refused for the guide's sake rather than the settings'. A new operator has no shop. The first
step of the guided path is *create a shop*, performed on `/shops`, where `AppShell` draws no
navigation at all because `currentShopId` is undefined. A guide reachable only from inside a shop
workspace would become reachable exactly one step after the step it exists to explain, which is the
one step somebody opening this product for the first time is actually standing on.

Leaving shop scope costs the operator their place, so `/settings` and `/guides` carry a link back to
the shop they were opened from. The last-visited shop is a stored preference this slice is
introducing anyway, so the return path costs nothing extra.

The shop-scoped entry is renamed to what it edits — shop details — and its route is unchanged. Two
entries named Settings, one of which silently means "this shop", is the ambiguity; removing it is a
label change, not a migration.

### The guide's progress is projected from the record, never stored

> Voided by ADR 0045 (2026-09-12), and not into its opposite: no progress is stored, because no
> progress is read. `deriveSetupPath` and the ten listing reads behind it are deleted with the
> strip, so nothing in the application projects how far a lab has walked the chain — the written
> setup guide at `/guides/setup` walks the ten steps without knowing which of them this lab has
> satisfied. ADR 0045 records that as the cost of the reversal rather than as a simplification.
> The reasoning below is why the reading was a projection rather than a checklist, and it stands
> as the argument to return to if the reading is ever wanted back.

A checklist with stored checkbox state is the obvious implementation and it is the wrong one here,
for the reason this project has already given twice. ADR 0027 refused to store the execution
timeline because "a second stored shape is a second chance to disagree with the first"; ADR 0034
projects every row of the history listing from the record the bench and the results screen read. A
guide is a third reader of the same chain, and it gets the same rule.

A step is complete when the thing it asks for exists, read through the listings the product already
serves: the shop has a published version when `listShopVersions` returns one, the block libraries
are stocked when they hold a template, the scenario step is done when a scenario has a published
version, the experiment step when the history listing holds a row. Nothing is written when a step is
satisfied, and nothing has to be reconciled when an operator does the work in a different order,
does it through `make seed`, does it against a database seeded by somebody else, or deletes
something afterwards.

Publication is additive, so a step stays complete once a published version exists even while the
draft beside it moves on. That is the correct reading rather than a concession: what an experiment
would pin is the published version, and it is still there.

Where a step is *not* complete, the reason is not invented either. The publish gate already computes
it — `preview.issues`, `canPublish`, and the `IssueList` and `PublishReasons` components in
`components/WorkspaceChrome.tsx` are a per-definition readiness engine that every authoring surface
already renders. The guide is that engine read one level up, with its existing vocabulary. A second
set of words for why a shop is not publishable would be a second gate to keep in agreement with the
first.

### The toggle stores an override, not a state

> Voided by ADR 0046 (2026-09-12). Guide mode is removed: the controls it gated do nothing until
> they are pressed, and a mode whose only remaining job was to hide a button hid it from a seeded
> lab's operator — the reader least likely to find the switch that brings it back. There is no
> override because there is no state to disagree with. What still stands is the *second* half of
> this subsection, which is about storage rather than about the mode: the two view preferences that
> remain — the rail's default collapsed state and the last-visited shop — live in `localStorage` for
> exactly the reasons given below, and a `lab_settings` table is still refused on both of them.
> The stale `agent-lab.guide-mode` key is left in the browsers that hold it, unread, because
> erasing it would be a migration mechanism for a browser preference and these values were put in
> `localStorage` so that none would ever be owed (ADR 0046).

Guide mode's default is derived like everything else: on while the lab holds no completed
experiment, off once it does. What is stored is only an operator's disagreement with that default —
the explicit on or the explicit off — together with the two view preferences the settings page
introduces, the navigation rail's default collapsed state (today `useState(false)` in `AppShell`,
reset on every load) and the last-visited shop.

That storage is `localStorage`. The whole slice therefore adds no table, no migration, no canonical
document and no published-version semantics, and the preference cannot participate in a fingerprint
by accident.

A `lab_settings` table was rejected on two grounds. It would put per-viewer view state into the
database whose every other row is evidence an experiment pins, and there is no user to key it to:
multi-user authentication and tenancy are explicitly deferred in `docs/decisions-and-next-step.md`,
so a settings row would be a singleton pretending to be a preference. If a preference ever needs to
survive a browser, the derived half already does, and only the override would have to move.

### What the guide changes, and what it refuses to be

> Narrowed by ADR 0045 (2026-09-12). The next-step strip and the inline explainers described in
> this subsection are removed. Guide mode now decides whether each surface offers a *Show me
> around* control that runs a tour of that one screen; the glossary, and the rule that a term has
> one definition, are unchanged. The paragraphs below stay as the record of what was built and of
> the reasoning the replacement had to answer.

> Narrowed again by ADR 0046 (2026-09-12). Guide mode decides nothing, because it is gone: the
> *Show me around* control is on every surface that has a tour, unconditionally. The glossary and
> its one-definition rule are still unchanged.

With guide mode on, three things appear, and they are the same three whichever surface is open:

- a **next-step strip** at the top of the shop home and the shops index, naming the one action that
  unblocks the chain and linking to it, with the gate's own reason underneath when there is one;
- **inline explainers** on the surfaces whose vocabulary is not transferable from a commerce admin —
  the block libraries, the scenario composition editor, the snapshot listing, the bench and the
  results screen;
- **glossary terms**, sourced from one module carrying `docs/PLAN.md`'s stable vocabulary, rendered
  as definitions on `/guides/glossary` and as hover definitions in the explainers.

The setup guide is a page under `/guides`, at `/guides/setup`, with `/guides` indexing it beside
the glossary. `/guides` is already a namespace rather than a page — the glossary has lived at
`/guides/glossary` since the slice that introduced it — and the two follow-up guides below get
routes of their own without that index having to be rebuilt around them.

What the guide walks is `lib/setupPath.ts`'s own table of the chain, not a restatement of it. That
module already had to know what the steps are and what order they come in, because the strip reads
them; the guide adds the half a surface with nothing to read can still say — the label, the surface
the work is done on, and the vocabulary the step speaks — and reads it with no record to decorate
it with. A step added to the table and not explained by the guide fails to compile, because the
guide's copy is keyed exhaustively by the step's identifier.

The explainers are written as plain text carrying `[[term-id]]` references into the glossary
module, rather than as markup with the terms already resolved. That is what makes the verification
below mechanical: every word a note sends a reader to look up can be read back out of the copy and
checked against the one module that defines it, so a term added to a note without a definition
fails a test instead of rendering as a link to an anchor nobody wrote. The notes are drawn on the
band the strip introduced rather than on a shape of their own, so a guide that appears on six
screens reads as one thing.

A term's hover definition is the element's own `title`, and the word is a link to its full entry
beside it. A panel of this project's own would have to be positioned against a word that can sit
anywhere on a line, inside cards that hide their overflow and a content column that scrolls, and
the first thing it would need is the layout rule this slice is explicitly not entitled to invent.
The browser places a `title` where it fits, no surface can clip it, it is the link's accessible
description rather than only a drawn shape, and the link is the way in for a reader with no
pointer.

What it is not is an overlay tour. Coach marks that highlight a control and advance to the next one
were rejected: they pin the guide to the exact geometry of surfaces that are still being designed,
they go stale silently when a control moves, and staleness in a tour is invisible to every test this
project runs. A derived strip cannot go stale in that way, because the thing it reads is the record.

> Reversed by ADR 0045 (2026-09-12). The first clause was overruled by the product owner. The
> second and third were correct as written and are answered rather than withdrawn: a tour does go
> stale when a control moves, and staleness *was* invisible to every test this project ran, so
> ADR 0045 makes the tours one declarative table and sweeps every step's anchor in Playwright the
> way ADR 0023 sweeps the tool registry. The last sentence stands, and is now the recorded cost of
> the reversal rather than an argument against it: the derived reading could not go stale, and it
> is gone.

### The guide hands over a command wherever the product refuses a route

The fastest path from an empty database to every populated screen is `make seed`, and the guide says
so — as text, with the command to run in a terminal, at the top of the setup guide.

It never offers a button. ADR 0043 decided that the seed "is a command, and never a route", because
"a running lab must never be one request away from being overwritten with a fixture". A guide that
grew a *Load demo data* action would be exactly the HTTP seed route that ADR refused, reintroduced
as a convenience, and the refusal it is subject to — an empty database at migration head — is one an
operator has to be able to read and act on in a shell anyway.

The same rule governs every other action the guide names: it links to the surface where the work is
done and never performs the work. The guide is a reader of the chain, and gains no privilege over
it.

### The settings surface reports composition and never edits it

`/settings` carries four read-outs, and none of them is a control.

- **This build.** The frameworks, architectures, providers, models and proven capabilities from
  `PROVEN_FRAMEWORKS`, served already by `readAgentConfigurationResources`. It answers "what can
  this actually run" without opening the agent-configuration editor to find out from a validation
  error.
- **Run mode.** Offline or credentialed, and the configured model name.
- **Trace export.** Whether an OTLP endpoint is configured, with the `infra/phoenix/compose.yaml`
  and `http://localhost:6006` path from `docs/observability.md` shown when it is not.
- **Workspace.** The two view preferences above, which are the only writable things on the page.

Run mode and trace export are process configuration: they are read from the environment at
composition and cannot change while the process runs. The page therefore reports them, and a
settings UI that offered a field for `AGENT_LAB_OPENAI_API_KEY` was rejected outright — it would
mean this application storing a provider secret in its own database, which `docs/observability.md`
forbids it from so much as recording.

`GET /api/v1/agent-frameworks`'s published summary is corrected in the same change, from "List
agent frameworks and proven capabilities" to what it serves — the adapters this *process* has
registered — so that a reader comparing the two routes in the contract does not find "proven" on
both.

They need one new route, `GET /api/v1/lab-status` (`getLabStatus`), an additive contract change in
`packages/contracts/openapi/v1/openapi.yaml` with regenerated types. What it serves is deliberately
narrow: a run-mode enum, the non-secret model name, and a boolean for trace export. It reports no
prefix, suffix, length or hash of the API key, because each of those is a fact about a secret. It
reports no OTLP endpoint either, even though the documented local one is a localhost address — a
collector URL is a place a deployment can put a token, and a route that serves it is a route that
serves that token the day somebody does.

### The standing offline qualification

While run mode is offline, the settings page states the limit as a property of the build: every
comparison produced here has both arms' decisions held identical by construction, so it establishes
the evidence model rather than a difference between frameworks, and only a credentialed run answers
how two frameworks actually choose.

The read-out says *why* that holds rather than leaving it to be inferred, because the obvious
inference is wrong. Offline, this API registers one experiment runtime — the deterministic control —
since both model-backed frameworks reach their provider under the same credential and appear and
disappear together (`create_support_agent_runtimes`); an arm running either is refused the moment it
is advanced. "Every framework runs offline against its own model seam" is true of `make seed`, which
composes the scripted runtimes itself, and of the test environment, and of neither the process an
operator is looking at nor the sentence they would act on. A surface that said it would send a new
operator to author a two-arm framework comparison this build will refuse.

ADR 0042 established that limit and ADR 0043 wrote it onto the seeded run — a label, a tag and a
note — because a viewer reads a run, not a docstring. Those stay where they are. What they cannot
cover is a run an operator drove themselves without a key, which carries no label because nobody
wrote one. The read-out is the standing version of the same sentence, in the one place that is about
the build rather than about a run.

### Lab-level surfaces are outside the 18-frame set; the guide strip is not

> Narrowed by ADR 0045 (2026-09-12). The band is removed, and with it the nineteenth frame it was
> drawn for; `docs/design-direction.md` records the set returning to eighteen and why the tour does
> not ask for a frame of its own. The half of this subsection about `/settings`, `/guides` and the
> glossary being outside the authoritative set is unchanged.

`docs/PLAN.md` requires every UI-bearing slice to name the frames it implements from the Milestone
0.5 authoritative set. That set, read back from `tmp/design-frames/canvas.json`, is eighteen
*shop-workspace* frames, and several shipped surfaces already sit outside it: the shops index, the
four shop-setup pages, the support-identities listing and the judges listing were all built from the
existing primitives — `PageHeader`, `Card`, `IssueList`, the chips and tokens in
`components/WorkspaceChrome.tsx` and `styles.css` — without a frame and without anyone treating it
as an exception.

`/settings`, `/guides` and the glossary are the same case, and are built the same way. They invent
no layout language; a settings page that needed one would be the signal that this reasoning has
stopped applying.

The guide strip is not the same case. It appears *on* frames 1, 4, 7 and 9 — a cross-cutting band
across the top of surfaces that were designed without one — and it is precisely the kind of element
that goes wrong when each page invents its own. It gets one frame on the canvas before it lands, and
`docs/design-direction.md` gains a revision paragraph recording both halves of this split so the
eighteen-frame claim keeps meaning what it says.

Where it is *drawn* and where it is first *mounted* are deliberately not the same list, and the two
sentences above about the strip's placement — "the shop home and the shops index" under what the
guide changes, and "frames 1, 4, 7 and 9" here — are both true of different things. Frames 1, 4, 7
and 9 are the surfaces the band is designed to be able to host on, which is why it gets a frame of
its own rather than four. The shop home (frame 1) and the shops index are where it is mounted first,
because they are what a first run walks through and the shops index is where an operator with no
shop is standing; the shops index is not itself a frame, and hosting the band there invents no
layout for the same reason the other lab-level surfaces invent none. Frames 4, 7 and 9 host it in a
later slice.

Slice 3 hosts the band again, for the other reading: the inline explainers are drawn on it, below
each page's header rather than above it. The surfaces they land on are this decision's list of
untransferable vocabulary rather than the frames the band was drawn on, and the two lists differ —
the notes reach frames 4, 4a, 4b, 8 and 9 and the frameless starting-states page, while frame 7
carries none and the next-step reading is still mounted only on frame 1 and the shops index. The
set stays at nineteen because the band is one element in both readings; `docs/design-direction.md`
records which surfaces host which.

## Deliberately not here

- **A seed route, or any button that populates the lab.** ADR 0043's refusal is load-bearing and is
  not relaxed by being inconvenient.
- **Editable credentials, model selection, or OTLP endpoint.** Process configuration stays in the
  environment; the page reads it.
- **Stored guide progress, per-step dismissal, or a completion percentage.** All three are the
  stored second shape this ADR exists to refuse.
- **Any table, migration, canonical document or fingerprint change.**
- **Per-user preferences.** There is no user. Tenancy is deferred.
- **An overlay product tour.** Rejected above, on staleness. *(Built by ADR 0045, which answers
  the staleness half with an anchor sweep driven off the tour table.)*
- **Theme, dark mode, or a density scale.** The visual language is fixed by
  `docs/design-direction.md`; a theme switcher is a design decision wearing a settings control.
- **Reset, wipe, or reseed.** `docs/development.md` owns the reset path and it is three commands.
- **The two follow-up guides** — reading a comparison, and replay and fork. They are worth writing
  and they are worth writing after the setup guide has been walked by somebody who has never seen
  this product.

## Verification

> Narrowed by ADR 0045 (2026-09-12). The first four bullets and the glossary-coverage bullet
> describe the derived strip, the explainers and the targeted first-run journey, all of which are
> removed with the code they covered; the glossary's own coverage assertion survives over the tour
> copy that replaced the notes. Everything about `getLabStatus`, the offline qualification and the
> setup guide is unchanged and still asserted.

> Narrowed again by ADR 0046 (2026-09-12). The guide-mode bullet — the derived default asserted in
> both directions and the stored override asserted to win over both — goes with the mode. What
> replaces it asserts the other thing: that the launch control is present on every surface in the
> tour table and that mounting it reads nothing at all.

- The derived checklist is tested over mocked listings rather than over a stored flag: an empty lab
  reports "create a shop"; a lab holding a published shop and nothing else reports the next step and
  not the last one; a lab in the state `make seed` leaves reports the path complete without anything
  having been written to say so.
- A step blocked by a gate is asserted to render the gate's own reason, read from the same
  `preview.issues` the authoring surface renders, so a guide that grew a second explanation of why a
  shop cannot be published fails here.
- A published definition whose draft has since been edited is asserted to leave its step complete,
  which is the reading publication actually supports.
- Guide mode's default is asserted from the record in both directions — on in a lab with no
  completed experiment, off in a lab with one — and the stored override is asserted to win over
  both.
- `getLabStatus` is asserted never to serve the key, in any form: the response model is checked to
  carry no field derived from `AGENT_LAB_OPENAI_API_KEY` beyond the run-mode enum, and the offline
  and credentialed cases are both exercised. The trace-export field is asserted to be a boolean and
  the endpoint asserted absent from the payload.
- The offline qualification is asserted on the surface a reader reads, not on the constant that
  produces it, the way ADR 0043 asserts the run's three.
- The setup guide is asserted to name `make seed` as a command and to expose no control that
  performs it, so the route ADR 0043 refused cannot reappear as a button without failing a test.
- The glossary is asserted to cover the vocabulary it claims: every term the explainers reference
  resolves to a definition, so a term added to an explainer without a definition fails rather than
  rendering bare.
- One targeted Playwright journey covers the first run only — an empty lab, guide mode on by
  derivation, the next-step strip leading to shop creation, and the strip advancing afterwards.
  Everything below that is a unit concern.
- `make check` passes; `pnpm build` runs for the frontend change; the generated contract types are
  regenerated with the new route.

## Migration

None. One additive HTTP route and its generated types; no table, column, canonical document,
fingerprint, tool contract or published-version semantics changes, and every stored preference this
slice introduces lives in the operator's browser.
