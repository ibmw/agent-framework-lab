# ADR 0054 — The lab is a mode, and the routes say so

Status: accepted — 2026-09-20; amended 2026-10-25

Splits the workspace into two modes — the **shop fixture** and the **experiment lab** — and moves
every lab surface out of shop scope into its own `/lab` route, where it has always belonged: an
agent configuration, a judge, a support identity and the two block libraries are shared by every
shop in the lab, and they have been addressed since Milestone 1 as though each shop owned a copy.

Records six decisions. That the workspace has two modes rather than one rail with a cross-shop
section at its foot. That the lab's routes sit under `/lab` and carry no shop, except the two that
are *about* one experiment, which carry the shop of the run in the path. That the lab keeps a
**current shop** — the browser preference ADR 0044 already licensed — resolved against the shop
list rather than trusted, and that a surface needing one says so rather than composing for nobody.
That every old `/shops/:shopId/…` lab path redirects to its new one and carries its shop into that
preference on the way, so a bookmark is not merely rescued but arrives with the context it held.
That the shop rail becomes the prototype's ten entries and loses its cross-shop section. And that
`/` resolves through a *where the app opens* preference whose only implemented path, until the
control that sets it exists, is the remembered shop.

Written before the code, as ADR 0052 was, because this moves every lab route in the application
and every later slice, Playwright spec and tour anchor is written against what it leaves behind.

## Context

The application has one rail. `AppShell`'s `studioSections` builds it from `/shops/:shopId`, and
its third section is titled **"Experiment lab · cross-shop"** — five entries whose paths are
shop-scoped and whose contents are not. `/shops/A/agent-configurations` and
`/shops/B/agent-configurations` are the same list. So are the two judge indexes, the two support
identity indexes, and both block libraries; `listAgentConfigurations`, `listJudgeConfigurations`,
`listSupportIdentities` and the block listings take no shop at all, and the editors behind them
reach shop-free routes. The shop in those URLs is decoration: it decides which rail is drawn and
nothing else.

Two of the five are genuinely about a shop, and differently. The bench composes an experiment
*for* one shop, because a scenario belongs to a shop; and a started experiment belongs to the shop
it was started in for good, because its snapshot was cloned from that shop's world. History is a
third case again: it is cross-shop by design (ADR 0034) and has filtered by shop through a URL
parameter since it was built.

The section heading is the tell. A rail section that has to announce that its contents are not
what the rail is about is a section in the wrong rail, and the shop-home tour says so in as many
words — *"The experiment lab at the foot of the rail is marked cross-shop, and what it holds is
shared by every shop in this lab."* The prototype handed over on 19 September 2026 draws the
conclusion the heading was working around: two rails, two modes, and a tab pair in the top bar to
move between them (`Workspace.dc.html` :4753 and :4822).

Three things make this worth doing as one slice rather than absorbing it into later ones. The
routes are the coordinate system every other slice of Milestone 8 is written in. The eleven
Playwright specs navigate by rail link name and by path, so a route that moves twice costs the
suite twice. And the shop in a lab URL is currently load-bearing in a way nothing declares: it is
what `AgentConfigurationEditorPage` seeds its preview shop from and what `ExperimentSetupPage`
lists scenarios for, both read from the shop workspace context, which will not exist where those
pages are going.

## Decision

### The workspace has two modes

**Shop fixture** is one shop's world: its catalog, its people, its incidents and the recipes
composed on them. **Experiment lab** is everything shared across shops: the bench, the history,
and a library of agent configurations, judges, support identities and the two block libraries.

A mode is not a preference and not state. It is *which branch of the route tree you are standing
in*, so it cannot disagree with the address bar, cannot be stale after a back button, and needs
nothing stored. `/shops/:shopId/…` is shop mode, `/lab/…` is lab mode, and the three frameless
lab-level surfaces — `/shops`, `/settings`, `/glossary` — are in neither and draw no rail, which
is the rule ADR 0044 established and the README's *Chrome* section restates.

The two shells are siblings: `ShopWorkspace` keeps the shop draft and the shop rail, `LabWorkspace`
keeps the shop list and the lab rail, and both render the same `AppShell`. `AppShell` gains the
mode as a parameter rather than inferring it from a shop id, because "no shop" and "lab" are now
two different answers and the collapsed-rail control, the switcher and the tabs each need to tell
them apart.

### The lab's routes carry no shop, except where the shop is the subject

| Route | Surface |
| --- | --- |
| `/lab/bench` | New experiment — composes for the **current shop** |
| `/lab/bench/:shopId/:experimentId` | The live bench for one run |
| `/lab/bench/:shopId/:experimentId/results` (+ `conversation`, `timeline`, `traces`; amended 2026-10-25) | That run's comparison |
| `/lab/history` | Experiment history, cross-shop, filtered by URL as before |
| `/lab/agent-configurations(/:configurationId)` | The configuration library and its editor |
| `/lab/judges(/:judgeId)` | The judge library and its editor |
| `/lab/support-identities(/:identityId)` | The identity library and its editor |
| `/lab/objective-blocks(/:blockId)` | The objective-block library and its editor |
| `/lab/mutation-blocks(/:blockId)` | The mutation-block library and its editor |

The shop is in the path of exactly the two surfaces that read one experiment, and it is there
because **the API requires it**: `getExperiment`, its evaluation, its timeline, its traces, every
advance, every participant turn, the replay and the fork are all addressed under
`/api/v1/shops/{shop_id}/experiments/{experiment_id}`. A lab route that dropped the shop would
have to look it up before it could ask for the run, which is a round trip to recover a fact the
link already had. It is also the honest record: a started experiment *is* the property of one
shop's world, and an address that said otherwise would be the first place somebody read it wrong.

The bench at `/lab/bench` is the opposite case. It composes for whichever shop is current, that
shop is not part of the identity of anything yet, and a shop in the path would mean two addresses
for one screen with nothing to distinguish them.

**Scenario snapshots stay in shop scope.** `/shops/:shopId/scenarios/:scenarioId/snapshots`
freezes one shop's world from one shop's recipe and is reached from that recipe's editor; nothing
about it is shared.

### The lab keeps a current shop, and resolves rather than trusts it

The lab's **current shop** is `agent-lab.last-visited-shop` — the `localStorage` preference ADR
0044 licensed for exactly this kind of per-viewer convenience and refused a database row for.
Nothing about this ADR reopens that refusal: the preference gains readers, not a table.

Three rules, so that no surface has to invent a fourth:

- **It is resolved against the shop list, never trusted.** A remembered identifier can name a shop
  that has since been removed, which is why `useLabSurface` already resolves rather than
  dereferences; the lab shell does the same, and an unresolvable identifier means *no current
  shop* rather than a broken link. Until the list has answered, "there is no current shop" is a
  fact the shell has not established and does not assert.
- **It is written wherever the operator stands in a shop.** A shop workspace writes it on load, as
  it does today. The switcher writes it. A lab route that carries a `:shopId` writes it, so the
  switcher on a bench names the shop that bench is for. A redirect from an old shop-scoped lab
  path writes it, which is what makes a bookmark arrive with its context and not merely arrive.
- **Two surfaces carry the notice.** The bench says the lab has no current shop and links to
  the shops index, and so does the history's shop filter. Only the bench *uses* a current shop;
  history's filter never names it, and carries the notice because it is where a reader of that
  page looks for the lab's shop — and finds a control of the same accessible name saying "All
  shops". Neither **guesses**: a bench that silently composed for the first shop in the list
  would freeze a snapshot of a world the operator never chose, and an experiment is not a thing
  to be wrong about quietly. The library screens name no shop and say nothing.

  What follows from the fact is not the same on the two surfaces, and the clause each passes
  says which. The bench has nothing to compose for. History says what the top bar's switcher
  holds and what its own filter does with it — **nothing** — and deliberately says nothing about
  how many runs are on screen: the notice renders on the lab's shop alone, while the list is
  narrowed by the URL alone, so any sentence mixing the two is false at `?shop=…`, which is
  precisely the state people share. The filter is **not** preselected from the current shop:
  that narrowing is URL-backed so a finding can be shared at the narrowing it was found in
  (ADR 0033), and seeding it from a browser preference would hand two operators two different
  lists behind one link.

The switcher is present in both modes and means different things in each, which is a distinction
worth writing down: in shop mode it **navigates** to the chosen shop, as it does today; in lab mode
it **sets the current shop** and stays where it is, because there is nowhere in the lab to navigate
a shop to. A library screen would not change if it did.

### Every old lab path redirects, carrying its shop

Every `/shops/:shopId/…` path this ADR moves keeps a route whose whole job is to write `:shopId`
into the remembered-shop preference and replace itself with the new address. **Sixteen routes**,
from one table, cover every lab path the shop layout held: the bench, the live bench, the results
and each of its two tabs, history, and the index and the editor of each of the five libraries.

They are declared as **top-level routes rather than children of the shop layout**, and the shop
layout loses those children entirely. Two branches matching one URL would be resolved by the
router's ranking, which is not a thing a route table should depend on to be read correctly; more
practically, a redirect nested in the shop layout would load the whole shop draft on the way to a
screen that does not want it.

They redirect with `replace`, so the back button returns to wherever the operator came from rather
than to a URL that only bounces. **The query and the fragment travel with the path.** Experiment
history keeps its narrowing in the URL exactly so a finding can be shared at the narrowing it was
found in (ADR 0033), and a redirect that rebuilt the path from its parameters and dropped the rest
would rescue the page while discarding the reason the link was kept.

They are one component reading one table rather than sixteen `<Navigate>` elements, because the
write and the move have to happen in that order and a `<Navigate>` beside a `useEffect` is two
places to read for one sequence. They are permanent rather than a deprecation window: this
application is a POC with no external consumers, the cost is one table, and a bookmarked results
page is exactly the artefact somebody keeps for months.

### The shop rail becomes the prototype's, and loses its cross-shop section

Ten entries, from `Workspace.dc.html` :4753: **Overview, Products, Orders, Customers, Tickets,
Scenarios**; under *Shop setup*, **Policies & FAQ, Support identities, Tone of voice, Shop
details**.

Four changes, each with its reason:

- **"Home" is renamed "Overview."** The prototype's word, and only the word — the page's
  composition is a later slice's.
- **The cross-shop section goes.** Its five entries are the lab rail.
- **The two block libraries leave the Scenarios nest.** They were nested under Scenarios because a
  scenario is what composes them, and the nest was always in tension with their being shared; the
  lab's *Library* is where the prototype puts them, and Scenarios has no children.
- **Support identities is on both rails, at one address.** The prototype draws it on both, and
  there is one library, so both rails point at `/lab/support-identities`. Following the shop
  rail's entry therefore changes mode. That is a real consequence and is preferred to the
  alternative, which is two routes rendering one list and a mode that depends on which door was
  used.

**Support guidelines leaves the rail** and its route stays. The prototype draws no such entry;
Slice 16 folds guidelines into the Documents table and redirects `/setup/support` to it. Until
then the page is reachable by address and by nothing else, which is a deliberate week of being
hard to find rather than a route deleted twice.

The lab rail is the second section table, from :4822: **Bench, History**; under *Library*, **Agent
configurations, Judges, Support identities, Objective blocks, Mutation blocks**. It is a second
landmark and needs a name of its own: `nav[aria-label="Experiment lab workspace"]`, beside
`nav[aria-label="Shop workspace"]`, which **does not move** — eleven Playwright specs reach the
application by it (`docs/design-direction.md`, *Navigation and chrome*).

### `/` resolves through a preference with one implemented path

`/` no longer redirects unconditionally to `/shops`. It reads *where the app opens* — the
remembered shop, the shops index, or the lab — and defaults to **the remembered shop**, falling
back to the shops index when none is remembered. The control that sets the preference is Slice
18's; until it exists the default is the only path the application can take, and the resolution is
written once here rather than twice.

This is what the slice's second piece of evidence describes: a new operator with no shop lands on
the shops index, and is not offered a bench that would compose for nobody.

## Deliberately not here

- **The top bar.** The mode tabs need somewhere to live for the lab to be reachable at all, so
  they ship here as two plain links in the existing header. Their glyph, underline, inactive ink
  and the switcher's panel are Slice 10's, and so is moving *Show me around* into the bar.
- **Counts on either rail.** Slice 11.
- **The preference control for where the app opens.** Slice 18. A preference no surface writes is
  half a slice, and the half that reads it is the half the routes need.
- **Any change to what a lab surface does.** The bench, the history, the five libraries and the
  results tabs render exactly what they rendered, from exactly the reads they made. This slice
  moves addresses and rails. In particular history's shop filter keeps its URL-backed default of
  every shop; preselecting the current shop would be a change to what the surface does, and it is
  refused above on its own merits as well.
- **A lab-scoped API.** The shop-scoped experiment routes are unchanged, and the shop-free library
  routes were already shop-free. No contract moves, and this slice carries no backend.
- **A `:shopId` on `/lab/bench`.** Above.
- **Deleting `/shops/:shopId/setup/support`.** Above.
- **A stored mode, a stored rail-per-mode collapse, or a remembered last lab screen.** The mode is
  the route; the collapse is one preference for both rails, because it is a statement about how
  much room the operator wants and not about where they are standing (ADR 0044).

## Consequences

Three pages lose the shop workspace context they read today and take the current shop from the lab
shell instead: `ExperimentSetupPage` (which scenarios and experiments to list),
`ExperimentBenchPage` and `ExperimentResultsLayout` (from the path, not the preference, because
the run's shop is in the address), and `AgentConfigurationEditorPage` (which shop to resolve its
preview against: what the author picked, else the lab's current shop, else the first the
resources offer, each of them only if the resources offer it).

That last one is *derived* rather than stored, and the reason generalises to every surface that
reads the current shop. Two answers decide it — the shop list the lab resolves against, and the
resources the picker is drawn from — and they arrive in either order. State seeded from the
first render settles the question before either has come back, which reads as a lab with a
remembered shop opening an editor on somebody else's.

The shop-home tour's first step describes a rail that no longer has a cross-shop foot, and is
rewritten to describe the rail as it now stands. `lib/tours.ts` gains the route each surface is
found at, so the sweep in `tour-anchors.spec.ts` composes its address from the table rather than
from a second list beside it — which is the shape ADR 0023 established and the reason a tour added
without a way to reach it fails to compile.

An operator who follows *Support identities* from the shop rail is in the lab afterwards, and the
mode tabs say so.

## Verification

- `App.test.tsx` asserts the route tree: every `/lab/…` surface renders, every old shop-scoped lab
  path lands on its new address with the shop preserved in the preference, and `/` resolves to the
  remembered shop, to the shops index with none remembered, and to the shops index when the
  remembered shop no longer exists.
- `AppShell.test.tsx` asserts both rails by their landmark name, every entry of each in order, and
  that every destination is still named when the rail is collapsed — the `sr-only` label rather
  than `title`, which is the assertion ADR 0044's collapsed-rail rule earns.
- The lab shell is asserted in all three shop states: a remembered shop that resolves, one that
  does not, and none at all; and the bench and the history filter are asserted to say so and to
  offer the shops index in the last two.
- The switcher is asserted to navigate in shop mode and to set the current shop without navigating
  in lab mode.
- `tours.test.ts` asserts every tour names a route and that the ten chain surfaces' routes equal
  the chain's own `stepHref`; `tour-anchors.spec.ts` sweeps every step on the new paths.
- All eleven Playwright specs pass. Those that reached a lab surface through the shop rail reach
  it through the lab rail instead, and every name they move to is a name this decision changed on
  purpose rather than one bent to make a spec green. Three rail labels move, and only those:
  *Home* becomes *Overview* (six specs — `agent-configuration`, `experiment-start`,
  `scenario-authoring`, `shop-publication`, `ticket-authoring`, `workspace-shell`), *All
  scenarios* becomes *Scenarios* now that the nest is gone (`experiment-start`,
  `scenario-authoring`), and *Support guidelines* leaves the rail (`workspace-shell`).
  `nav[aria-label="Shop workspace"]`, every tour anchor and every button name stay where they
  are; `nav[aria-label="Experiment lab workspace"]` and the mode tabs are new landmarks beside
  them (`docs/PLAN-UX.md`, *Accessible names do not move casually*).

## Migration

None in the database and none in the contracts. The migration is the sixteen redirects and the
preference they write, and the one browser key involved — `agent-lab.last-visited-shop` — already
exists and already holds the right value for any operator who has opened a shop.

A lab that is opened for the first time after this lands has no remembered shop, lands on the
shops index, and is told on the bench that it has no current shop. That is the same first-run path
the application has always had, arrived at through the preference rather than through a constant.

## Amendment — 2026-10-25

The results gain a fourth depth tab, `…/results/conversation`, between General and the execution
timeline: both arms' threads, read-only, one row per composition. It is a child of the results
route like the other tabs and needs no redirect: the shop layout never held it, so no bookmark to
a `/shops/:shopId/bench/…/results/conversation` exists to rescue.
