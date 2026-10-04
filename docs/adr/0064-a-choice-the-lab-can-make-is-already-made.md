# ADR 0064 — A choice the lab can make without guessing is already made

Status: accepted — 2026-09-27

Settles `docs/PLAN-UX.md` Slice 23: the defaults the prototype draws and the codebase did not
have, and the order New experiment asks its questions in (`Workspace.dc.html` :2327; the
`DEPRECADED/BenchSetup.dc.html` frame). It builds on ADR 0063, whose Start lists every cause and
waits for the reads it depends on, and on ADR 0061's *follows while it is the suggestion*.

Records six decisions: every version select opens on the newest published version; a select
whose set holds one record opens on it and says so; the experiment setup asks in the
prototype's order and chooses the arms when there is only one comparison to make; the
experiment's name is proposed from the scenario and the arms and followed until typed; a
half-chosen arm is refused by its letter and never dropped; and a new customer's locale and
*customer since* come from the shop and from the operator's own calendar.

## Context

An operator with one published scenario and two published configurations opened New experiment
on an empty form: *Choose a scenario…*, then *Choose a configuration…* and *Choose…* for a
version, an *Add a second arm* button, and an empty name that Start refused. Every one of those
choices had exactly one sensible answer, which the prototype draws already made — the scenario
row says "This one is the only published scenario in the shop, so it is already chosen", Arm A
says "Defaults to the newest published version of the configuration", and the name reads
"Wrong shipping address — atlas v4 vs beacon v2", "derived from the scenario and the two arms
until you edit it".

Three defects sat under the same form:

- **A stale version.** Choosing a scenario started a read of its versions, and the previous
  scenario's version number stayed in state until that read answered. For that moment the
  setup was (new scenario, old version), which the preview sent to the gate and the gate
  refused with a 404 reason Start then listed.
- **A silent drop.** `setupOf` built the request from the arms that had both a configuration
  and a version, so an arm with a configuration and no version was left out of the request
  rather than refused: a start pressed then would have run one arm of the two on screen.
- **Hard-coded customer defaults.** The new-customer page created every profile in `en-GB` and
  opened *customer since* on 1 January 2024, whatever the shop's language and whatever the day.

The rest of the workspace already defaulted in places, by one rule each: the snapshot page's
version opened on the newest; the tool console chose a lone published identity; the new
scenario, the new configuration and the bench's judge picker opened on the first candidate.
None said so, and no two used the same code.

## Decision

### Every version select opens on the newest published version

The newest is computed, never read off an end of the list (`lib/versions.ts`, `newestVersion`),
and the option carries it: "v2 (newest published)". A version already chosen is never replaced
by a list that answers later: every default is written only into an empty value.

The version selects, all of them (`apps/web`, line numbers as of this ADR):

| Select | Where | Before | After |
| --- | --- | --- | --- |
| New experiment · Scenario · Published version | `routes/ExperimentSetupPage.tsx:557` | the newest once the list answered, but the previous scenario's number stood in until then | cleared in the same update that chooses the scenario, "Reading published versions…" while its list is read, then the newest |
| New experiment · Arm A · Published version | `routes/ExperimentSetupPage.tsx:857` | empty, *Choose…*, picked by hand | the newest, as soon as the configuration's list is read — at once where it already was |
| New experiment · Arm B · Published version | the same line, the second arm | arm B did not exist until *Add a second arm*, then empty | the newest, as arm A |
| Starting states · Scenario version | `routes/SnapshotsPage.tsx:189` | the newest on the first read, kept on a reload | unchanged — **already right**; the option now says which is the newest, and the page reads `newestVersion` from the one module |
| Fork panel · an arm's Published version | `routes/ExperimentResultsLayout.tsx:549` | the version the run pinned; moving the arm to another configuration moves it to that configuration's newest | unchanged — **already right** (below) |

The fork panel is not an exception to the rule but outside it: it edits a record, and what the
run pinned is the value it holds, not a default. Opened on the newest it would silently be *Fork
with newer versions* — which History offers as its own button, and which also moves each arm to
the newest — and its refusal "a fork that changes nothing is a replay" could never be said.
Moving an arm to another configuration is a choice with nothing recorded to hold, and there it
opens on the newest.

Selects that show a version beside a record are not version selects: the judge picker
(`components/ObjectiveEvidence.tsx:150`), the tool console's acting identity
(`components/SandboxToolConsole.tsx:251`), the scenario editor's template picker
(`routes/ScenarioEditorPage.tsx:1037`), the configuration editor's support identity and preview
context (`routes/AgentConfigurationEditorPage.tsx:441`, `:480`). Each picks a record and pins
its latest publication, which is the only one it offers.

### A select whose set holds one record opens on it, and says so

`lib/singleChoice.ts`: `useSingleChoice(candidates, value, choose)` writes the sole candidate
into an empty value when the sole candidate *changes* — a listing arriving, or a set shrinking
to one — and answers whether the value on screen is that candidate. `onlyChoiceNote(what)` is
the hint's sentence, in the prototype's words: "This one is the only {what}, so it is already
chosen." It is appended to the row's hint, or, where the select has none, to a muted line its
`aria-describedby` names.

**What counts as a candidate.** An option the operator could pick. A placeholder — *Select a
customer*, *Choose a scenario…* — is the absence of a choice and does not count; a disabled
option cannot be picked and does not count. A lab with one published scenario and one
unpublished one has one candidate, and the unpublished one stays in the list, disabled, marked
*(unpublished)*, as an unpublished configuration already was.

**What it never overwrites.** A value is only written while it is empty, and only when the sole
candidate changes, so a choice the operator made survives any later load, and a placeholder
they picked on purpose is not filled in behind them while the set stays what it was. A form
that resets after an add — the scenario editor's template picker, whose set an add does not
change — resets to the sole candidate rather than to the placeholder, since that is the state
it opens in.

**Which selects this is.** A select that picks *a record* — something with its own identity in
the lab: a scenario, a configuration, a profile, a customer, a variant, a template, a ticket, a
support identity, a judge — on a create form, an add form, or the bench. Not a select bound to
saved content, whose value is the saved one and which no load may write; not a filter, whose
*All* is a value; not a vocabulary — a contract union, a proven catalog, a shop's channels, a
product option's values — which `docs/design-direction.md` already governs: *a choice of one is
not a choice*, and a vocabulary of one is drawn as a value. The enumeration of all 73 selects
is under *The selects*, below.

### New experiment asks in the prototype's order, and chooses the arms when there is one comparison

One card, on the form pattern: **Scenario**, with what it resolves against; **Arm A**; **Arm
B**; **Name**; **Seed**, with its meaning ("A whole number between 0 and 4294967295. The same
seed over the same starting state replays the same run."). The comparison matrix, *Before
starting* and *Recent experiments* are where they were.

- *Resolves against* is read, not composed: the chosen scenario version's pins
  (`GET …/scenarios/{id}/versions/{v}` — `shop_version`, `ticket_version`) and the customer
  version that ticket version pinned (`GET …/tickets/{id}/versions/{v}` —
  `customer_profile_version`): "Resolves against shop v3, ticket T-204 v1, customer Maya Laurent
  v2." A read that fails says nothing, or stops after the ticket. (Amended 2026-10-04, below:
  every name in it is the one its pinned version was published under.)
- **Both arms are always on the form.** Arm B's empty option is *No second arm*, and a run with
  arm B left empty is a one-arm run, which the contract allows; *Add a second arm* is gone.
- **The arms default by the same rule as a single choice, read over the comparison.** One
  published configuration is arm A, and arm B stays empty — two arms running one configuration
  compare nothing. Two published configurations are the only comparison there is to make, so
  they are arm A and arm B, in the order the lab lists them; arm B's hint says "These two are
  the only published agent configurations in the lab, so both arms are already chosen." Three or
  more is a choice the lab does not make, and both arms open empty. Written only into arms
  nobody has touched.

### The name is proposed from the scenario and the arms, and followed until typed

The format is the prototype's — its `expName`, "Wrong shipping address — atlas v4 vs beacon v2" —
with the configuration named as the lab names it rather than stripped of a `cfg-` prefix, which
was the fixture's spelling: **`{scenario} — {configuration A} v{n} vs {configuration B} v{m}`**,
or `{scenario} — {configuration} v{n}` for one arm (`lib/experimentStart.ts`,
`proposedExperimentName`). An arm whose version is not chosen yet is not in it, and the
proposal is cut to `MAX_LABEL_LENGTH`, so it is never a name the lab refuses.

The field is `DerivedIdField`, the house pattern and ADR 0061's rule: it follows the proposal
while it is the proposal, stops at the operator's first keystroke, hands the proposal back when
emptied and left, and follows again from there. It takes two new props for a name that is not
an identifier — `maxLength`, and `preview={false}`, because "Saved as `…`" under a display name
would say the field's own contents twice.

### A half-chosen arm is refused by its letter, never dropped

`setupOf` (now `lib/experimentStart.ts`) makes **no** request while any arm has a configuration
and no version, rather than a request without it. `startRefusals` takes the arms instead of a
count and says "Choose the published version arm B runs." for each such arm — unless its
versions are still being read, which, like the scenario's, is a wait: Start is a press in flight
(ADR 0063), not refused. With newest-version defaults an arm only stays half-chosen when its
configuration's versions could not be read; the version select then says *No published
version*, the page's alert says the read failed, and Start names the arm.

### A new customer writes in the shop's locale, and became one today

The new-customer page gains the prototype's **Locale** row (`LocaleField`, after *Customer
since*), opening on the shop draft's `identity.locale`. *Customer since* opens on today.

**Whose today:** the operator's, on their own calendar and in their own time zone —
`todayInput` in `lib/orders.ts`, which the order's *Placed on* and the profile's background
entries already use. A date field shows and takes a local calendar day, and near midnight
UTC's date is yesterday or tomorrow for half the world; a default the operator would read as the
wrong day is not a default they would have chosen. The lab stores the date as the day typed
and checks only that it is an ISO date, so no zone is lost between them.

## The selects

Every `<select>` in `apps/web/src` (73), and which rule governs it. *Record* rows are this
ADR's single choice; *already* means it opened on its candidate before and gains only the
sentence.

| Select | Governed by |
| --- | --- |
| `routes/ExperimentSetupPage.tsx:537` Scenario | single choice — **new** |
| `routes/ExperimentSetupPage.tsx:836` Arm A / Arm B · Agent configuration | single choice over the comparison — **new** |
| `routes/CustomersPage.tsx:226` Profile to attach | single choice — **new** |
| `routes/OrdersPage.tsx:416` New order · Customer | single choice — **new** |
| `routes/OrdersPage.tsx:470` New order · Variant | single choice — **new** |
| `routes/OrderEditorPage.tsx:556` Add product | single choice — **new**; reopens on the one left after a line is removed |
| `routes/TicketsPage.tsx:388` New ticket · Customer | single choice — **new** |
| `routes/ScenarioEditorPage.tsx:1037` Add objective / mutation block | single choice — **new**; resets to it after an add |
| `routes/ScenariosPage.tsx:640` New scenario · Ticket | single choice — already (opens on the first); sentence added |
| `routes/AgentConfigurationsPage.tsx:375` New configuration · Adopted identity | single choice — already; sentence added |
| `components/SandboxToolConsole.tsx:251` Acting support identity | single choice — already; sentence added |
| `components/ObjectiveEvidence.tsx:150` Judge | single choice — already; sentence added |
| `routes/ExperimentSetupPage.tsx:557`, `:857`; `routes/SnapshotsPage.tsx:189`; `routes/ExperimentResultsLayout.tsx:549` | the version rule, above |
| `routes/ExperimentResultsLayout.tsx:520` Fork · Agent configuration | a record's value — what the run pinned |
| `routes/ExperimentHistoryPage.tsx:330`, `:351`, `:367`, `:383`, `:399`, `:415`, `:431` | filters — *All* is a value |
| `routes/TicketsPage.tsx:181` Filter tickets | a filter |
| `components/ParameterForm.tsx:72`; `routes/BlockLibraryPage.tsx:428`, `:445`, `:491`; `routes/DocumentsPage.tsx:315`; `routes/AgentConfigurationsPage.tsx:327`; `routes/JudgeConfigurationsPage.tsx:289`; `components/SandboxToolConsole.tsx:229`, `:342`; `routes/TicketsPage.tsx:406` (the shop's channels); `routes/ProductEditorPage.tsx:1304` (an option's values), `:1342` (drawn only when there are two currencies) | a vocabulary — a contract union, a proven catalog, a tool contract, or the values of one field |
| `routes/AgentConfigurationEditorPage.tsx:406`, `:421`, `:441`, `:553`, `:679`; `:480` (the preview's shop, view state that opens on the current shop); `routes/BlockEditorPage.tsx:410`, `:441`, `:511`, `:541`, `:582`; `routes/CustomerEditorPage.tsx:141`, `:610`, `:621`; `routes/DocumentEditorPage.tsx:204`; `routes/JudgeConfigurationEditorPage.tsx:337`; `routes/OrderEditorPage.tsx:590`, `:610`, `:704`, `:724`, `:790`, `:881`; `routes/ProductEditorPage.tsx:495`, `:1110`, `:1184`, `:1604`; `routes/ScenarioEditorPage.tsx:466`, `:881`, `:899`, `:939`; `routes/ShopSetupPages.tsx:349`; `routes/TicketsPage.tsx:910`, `:925`, `:942`, `:963`, `:986` | saved content — the value is the draft's, and no load writes a draft |

## Deliberately not here

- **One select per arm, configuration and version together**, as the prototype draws
  ("cfg-atlas v4 — Pydantic AI · gpt-5-mini"). Each configuration's versions are a read of their
  own, so one list of every configuration's every version would be one read per configuration
  before the select could open; the row keeps two selects, and the framework and model are the
  row's second line. Recorded as a departure in `docs/design-direction.md`.
- **Moving a default to a newer version published while the page is open.** A version is
  written once, into an empty value, from the list read for it; a publication after that read is
  seen on the next visit.
- **The seed.** It keeps its fixed default: a seed is a behavioural input the operator reads,
  not a choice with a best answer.
- **Where Start sits.** The prototype draws it in a card under the form; it stays in *Before
  starting*, beside the reasons and the gate's findings it is refused with. Slice 24 owns how it
  reports a run.

## Consequences

- `docs/design-direction.md`, *The form language*, gains the rule, and *Departures* the two
  selects per arm.
- The labels on New experiment follow the prototype's rows: *Recipe* becomes *Scenario*, and
  *Experiment name* becomes *Name*. Playwright `experiment-start` reaches them by role within
  the row, no longer presses *Add a second arm*, and no longer picks an arm's version: it asserts
  the default one.
- `ExperimentSetupPage` holds each configuration's versions itself, read once per configuration,
  so two arms on one configuration read its versions once.

## Verification

- `Experiments.test.tsx`, *experiment setup's defaults*: the slice's evidence — one published
  scenario and two published configurations open with all three chosen at their newest, the
  scenario resolving against its pins, a name proposed, and Start free once the gate answers;
  the rows in order; an unpublished scenario not counted; nothing chosen where there is a choice;
  one configuration as arm A alone; the name following the arms until typed, and again once
  emptied and left; an arm moved onto a configuration already read opening on its newest at
  once; a list answering late going only to the arm still waiting on it; the scenario switch
  clearing its version and never sending the old one to the gate; an arm whose versions cannot be read refused
  by its letter with no request made without it.
- `lib/experimentStart.test.ts`: every combination of the causes, now 4 · 3 · 2 · 16 · 3 · 2 · 2 =
  4608 with arm A and arm B each empty, being read, half-chosen or whole, written out pair by
  pair; `setupOf` for every half-chosen arm; the proposed name case by case and at the cap.
- Start's reasons follow the form's order — scenario and its version, arm A, arm B, name, seed —
  which ADR 0063's amendment now names; a list no arm waits on asks the gate nothing again; the
  proposal is cut by whole characters and never ends on a separator; a late failure for a
  scenario the page moved off says nothing; `lib/singleChoice.test.tsx` keeps a held value when
  the sole candidate changes.
- `lib/versions.test.ts`: the newest whatever the list's order; the option's label.
- `Customers.test.tsx`: the shop's `fr-FR` and the operator's today in Tokyo when UTC is a day
  behind, both sent; both overridable; the one attachable profile opened on and said.
  `lib/orders.test.ts`: `todayInput` in four zones either side of UTC and across a year.
- `Orders.test.tsx`, `Tickets.test.tsx`, `Scenarios.test.tsx`, `AgentConfigurations.test.tsx`,
  `Snapshots.test.tsx`: each single choice opened on and said; a placeholder picked on purpose
  left alone; a choice of several left unchosen.
- Playwright `experiment-start`: the scenario already chosen, and each arm on its default
  version.

## Migration

None. No contract, payload or stored value changes. The two reads *Resolves against* makes were
already served; the web gains their callers (`getScenarioVersion`, `getTicketVersion`). (The
2026-10-04 amendment below adds a third, `getCustomerProfileVersion`, also already served.)

## Amendment — 2026-10-04: the names are the pinned versions' own

*Resolves against* took its version numbers from the pins and its names from the scenario
listing — `ticket_reference` and `customer_display_name`, which are today's. A ticket or a
customer renamed after the scenario was published then read under a name its pinned version
never had, and the proposed experiment name carried the scenario's current name beside versions
it was not published with. Each name is now read off the version it names:

- **The ticket** is read as the scenario version names it (`content.ticket_id`, beside its
  `ticket_version` pin), named by that ticket version's `content.reference`, and **the
  customer** by the customer version that ticket version pinned — `GET
  /customer-profiles/{id}/versions/{v}`, its `content.display_name`, the profile read through the
  ticket version's `content.customer_profile_id`. That is one more read per choice, three in
  all, chained; the web gains `getCustomerProfileVersion`. No backend change: the route was
  already served.
- **The scenario's name is pinned the same way** (`ScenarioContentSchema.name`), so the
  proposal's scenario part is the chosen version's `content.name`, read in the call the pins
  already came from. The Scenario select keeps the listing's name: it picks the record, not a
  version of it.
- **Each arm is named the same way.** The proposal's configuration parts are each arm's pinned
  version's `content.name`, read in the call the arm already makes for its provider, so it
  costs no read; the Agent configuration select keeps the listing's names, for the reason the
  Scenario select does. An arm is in the proposal once its version has answered — Start already
  waits on the read, for the provider — and an answer counts only for the configuration and
  version it was read for, so an arm moved to another version is unnamed until that one
  answers. **A failed arm read proposes no name at all**: a settled proposal never leaves an
  arm out, since it would then state a run with one arm fewer than it has, so the field is
  empty and Start's *name the experiment* refusal asks the operator for one. While an arm's
  read is pending the proposal lacks it for that moment, and Start is busy meanwhile — a wait
  under ADR 0063, so no run starts under that proposal.
- **While the reads are in flight, nothing is said, and today's names never.** A listing name
  shown first and replaced when the version answers would, for that moment, be a name the
  version may never have had — evidence the page cannot vouch for — and a note beside it would
  only say so. The line appears whole once the reads answer; the proposal carries the scenario
  once its version has. **Start waits on the scenario version's read** as it waits on an arm's
  (ADR 0063: busy, never refused), since a run started before it answers would take a proposal
  without its scenario; once that read has answered or failed, it holds nothing up.
- **A read that fails says nothing it cannot vouch for.** The scenario version failing says
  nothing, and leaves the scenario out of the proposal; the ticket version failing says no line,
  since the ticket's frozen reference is unknown; the customer version failing stops after the
  ticket, every name in what remains being the one its version froze.
- **Latest read wins.** The reads share one abort signal per (scenario, version) choice, and
  nothing they answer — success or failure — is written once the choice has moved on; a new
  choice clears what the last one said before its own reads start.

Verified in `Experiments.test.tsx`, *what the experiment setup resolves against*: a scenario
whose name, ticket and customer were all renamed after publishing reads its pinned names, in the
line and the proposal; a configuration renamed after publishing proposed by its pinned name;
Start busy, with no reason, while the scenario version is held after the gate has answered, and
free once it answers, and free once it fails and the run is named; a failed arm read proposing
no name and refused for the name alone; an arm moved to a version still being read never named
by the version it left; nothing while the customer read is held; each of the three reads failing;
a version switch taking the last version's line down while the next is read; and a scenario
switch whose abandoned read answers while the next scenario's versions are still being read,
landing nothing.
