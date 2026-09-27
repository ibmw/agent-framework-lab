# Design direction

Status: current — 2026-09-24. The design rules that govern `apps/web`, stated once as rules a
slice is checked against. Values are not restated here: a measurement or a colour that is built lives
in the code that draws it (`styles.css` for tokens, `lib/ui.ts` for class sets and glyph tables,
`shell/AppShell.tsx` for the chrome), and one that is not yet built lives in its slice in
`docs/PLAN-UX.md`. How each rule was reached is `docs/history/design-direction.md`; the
exploration the direction came from is `docs/history/design-brief.md`. ADR 0050 says the
guidance conventions *are* sections of this document; they are, under *The form language*.

## Principles

Carried forward from the brief; they outrank any measurement below.

- **Evidence before opinion.** The conversation is shown beside tools, arguments, confirmations,
  state changes, errors, traces and objective results. Comparison is never an unexplained score,
  and no surface declares the fewest tokens or the shortest conversation the winner.
- **Three evidence layers, kept distinct**: deterministic, LLM-judged, quantitative. Efficiency
  is read only beside a successful outcome.
- **Progressive technical depth.** Outcome, then timeline, then trace, then project-owned source,
  without losing run context.
- **Reproducibility is visible.** Published versions, fingerprints, configuration and judge
  versions, replay and fork relationships are reachable without dominating every screen.
- **Tool-first is legible.** What the agent was handed and what it discovered through tools are
  told apart on screen.
- **Honest comparison.** Two arms start from equivalent snapshots; where operator input diverged
  is recorded and shown, never smoothed over.
- **Extensible without feeling unbounded.** Editors grow by optional sections and typed
  attributes, never into one mega-form or a JSON editor.
- **Status is never colour alone**: a glyph or a word always accompanies it. WCAG 2.2 AA
  contrast; every workflow keyboard-reachable.
- **Desktop first, usable narrower.** Every row and card row wraps; nothing is fixed width except
  the rail, the ticket side panels and the settings column cap. No narrow-width treatment of the
  live comparison is drawn.
- **Dense is fine, decorative is not.** No dashboard metrics for their own sake, no oversized
  status cards, realistic content rather than placeholder text.
- **Every state is designed for**: empty, draft with findings, published and immutable, tool in
  flight or refused or in conflict, exact-action confirmation, linked and split input, one arm
  waiting, objective passed or failed or pending, judge queued or failed or rerun, a historical
  run with newer versions available, an unsupported capability.

## Direction

**Direction A, the studio-first workbench**, with three strengths taken from the other candidates:
director's notes on the live bench, an objectives matrix on the bench and the results, and bench
zoning where the split conversation takes the width. The Studio is a **shop-scoped admin
workspace** in a neutral light admin language — persistent resource navigation, index tables
with status pills, resource detail pages — with the lab's pine and paper identity in the top bar,
the accents and the display type. Tickets use the three-pane helpdesk anatomy and author
*history*, never live replies. The scenario editor composes shared block libraries. The prompt
editor renders markdown with inline variable chips and a grouped insert menu whose customer,
order and ticket facts are visibly non-injectable.

## Authority — what a UI slice cites

The **whole-workspace prototype** handed over on 19 September 2026 is the authority for
everything that crosses screens. It lives under `tmp/design-frames/`, which is not versioned on
purpose: its values belong in the code, and this document does not copy them either.

| File | Role |
| --- | --- |
| `Workspace.html`, `Workspace.dc.html` | The design, and its markup; a `Frames:` line cites a line number of the `.dc.html` |
| `README.md` | The handoff: chrome, screens, the form pattern, interactions, tokens, type, radii, glyphs |
| `form-decisions.md` | The locked form language, variant 2 of every component, and why |
| `DEPRECADED/*.dc.html` | The eighteen per-screen frames of 23 August; still cite a surface's composition where the prototype is silent |

Where they disagree, in this order:

| Rule | Decides |
| --- | --- |
| 1. The prototype supersedes a frame | wherever the two disagree |
| 2. README silent, prototype specific | the prototype governs; the README summarises and is not a ceiling |
| 3. README states a value, prototype draws another, same role | the README wins — one value against one value, never a context; a distinction the prototype draws consistently across a class is a rule the README summarised away, and rule 2 hands it to the prototype. Flattening such a class because one component serves it is a **departure**, recorded with the prototype's rule |
| 4. A README value under a heading that scopes itself | is stated for that role only; outside it, rule 2 |
| 5. Keeping what the codebase has | is licensed by an explicit release in the handoff, a repository rule that outranks a mockup (accessible names specs click; a value that already is a token), or another slice owning the decision. "The handoff is silent" is not a licence |

Every departure is written in one sentence in the slice's record. **The primitive ships with its
first consumer**: a component, token or preference no page uses is not a slice. **Lab-level
surfaces** (`/settings`, `/glossary`) are frameless and built from the existing chrome.

## Departures from the handoff, in force

Each is a deliberate difference between what the code draws and what the handoff states, with
the rule that licensed it. A slice that touches one revisits it; none is an oversight.

| What | Handoff | Built | Why |
| --- | --- | --- | --- |
| Primary token | redefine `lab-accent` to pine | new `lab-primary`; the clay stays on trace bars, the review star, a ticket's emphasis and the armed seed | those four are not the refresh's to repaint |
| Page title | 22px bound name, 24px fixed label | one `PageHeader` at 24px, and `CreatePage`'s own header at the same size | one size for the workspace, no variant yet; rule 3 |
| Card title | sans on note cards, Georgia on table and section cards | one `Card`, Georgia 17px | same |
| Setup pages' header | *Shop details* and *Tone of voice* scroll their header away (:1893, :1993) | pinned like an editor's | each edits one object and carries Save; ADR 0066 |
| Compact controls | 42/40px in sub-editors and filters | the one 44px control | no compact component exists to size |
| Filter chips on Tickets and the block libraries | drawn | none until a table exists to filter | a chip whose figure the payload lacks is not faked. Policies & FAQ left this row when its documents became a table with four chips (ADR 0057) |
| Model on the connection, masked key | drawn | neither | ADR 0052 |
| *A support identity* on the setup checklist | a line of the panel | not drawn | identities are a lab listing, and counting them on a shop page is the cross-listing progress reading ADR 0045 removed; the panel reads the shop's own gate only (ADR 0071) |
| Identity's line under its title | "The slug was fixed at creation and cannot change." | what the two fields are for | the slug changes here and only a taken one is refused (ADR 0069) |
| A currency a variant is priced in | locked on Shop details | tickable, the gate's sentence on its chip | the lab saves the draft and refuses it at publication; a gate error refuses no write (ADR 0063's amendment, ADR 0071) |
| A new shop's channels | fixed at chat, "Fixed at creation." | asked, on chat until chosen otherwise | the create request carries them (ADR 0071) |
| Preferences | seven rows | five: where the app opens, the last-visited shop with *Forget*, the rail's collapsed default, confirm-before-delete, the timestamp format | a preference no surface reads is not a slice. Confirm-before-delete landed with the confirm it governs (ADR 0060), as a native checkbox for the reason the rail's row is one; auto-offered tours and table density are cut (*Proposals, not decisions*, and ADR 0049 refused the first outright) |
| The settings page's title | "Workspace settings" | "Lab settings" | two things called Settings, one of which silently means "this shop", is the ambiguity ADR 0044's first decision exists to remove — and *workspace* is already the word for a rail (`nav[aria-label="Shop workspace"]`). Rule 5: it is an accessible name a Playwright spec asserts on |
| The rail preference's control | a 42×25 pill switch | the native checkbox already there | the prototype's switch is a `div` with `tabIndex` and no role and no name at all, and the README's own form pattern says every label is bound to a native control; the form language has no switch to reach for. Rule 5 |
| The *Model provider* zone's rows | Provider, Base URL, API key, Default model, Connection | *Endpoint preset*, Base URL, API key, Connection — four rows on the same white surface, with Save and Discard above the card while it is dirty | the prototype's five rows minus *Default model*, which is the row above; and *Provider* is relabelled because in this lab the word names a member of `PROVEN_FRAMEWORKS.providers` that an agent configuration may be published against, and a row offering "Ollama" under it would claim what ADR 0053 keeps the door on. All six are one provider id — `openai`, which names the protocol rather than the company — so what the row actually picks is a prefilled endpoint (ADR 0052). The prototype draws Save and Discard in the zone's heading row; they sit above the card because the dirty state belongs to the connection rather than to the zone, and a zone holding a second connection would have two pairs |
| The API key row's third state | "Not required by this provider", drawn instead of the field for Ollama and vLLM | the field, always, with the preset's own note beside it | a preset is a base URL rather than a provider, so this page cannot know whether the endpoint at one authenticates — a gateway in front of Ollama does. Refusing the key the route would happily store would be a second, stricter gate, which is the reading `ProvenBuildCard` already applies to an unexercised model. The prototype's matching refusal to *save* without a key is dropped for the same reason, and because a saved connection with no key at all is in force and credentialed (ADR 0052) |
| The connection test's answer | "Answered in 380 ms as gpt-5-mini" | the classified outcome, the round trip, and the class of the status where one came back | there is no model to name, and the route serves no other fact: never the upstream body, which is a string this lab did not write (ADR 0052). A stored green tick is refused for the same reason, so the answer is also dropped the moment the endpoint under it moves |
| The Provider row's note, and the controls that start or derive a run | the agent editor notes "Matches the lab's current connection." or "The lab now runs through … Republish this configuration to move it." (`Workspace.dc.html` :431); the judge editor's Provider says nothing about the connection (:514); New experiment's Start is never blocked by it (:2327), nor are the results header's Replay and Fork (:2571–2572) | one muted line under Provider in both editors, only while the lab holds no usable connection for the chosen provider — "Published configurations naming OpenAI cannot be advanced here until the lab has a connection for it." — in the control's accessible description and never in `preview.issues` or `PublishReasons`; the same sentence as the reason Start and *Fork this run* are refused for, in `title` and in the validation-weight line their `aria-describedby` names (ADR 0063), and beside a disabled Replay and a history row's *Replay recorded versions* and *Fork with newer versions*, which are secondary and keep native `disabled`, in `title` and in one muted line — one line for a row's two when they are refused for one provider, and one per control on the results screen, where Replay sits in the header and *Fork this run* in the fork panel, two regions apart, and Fork's cause follows the arms chosen there rather than the arms the run pinned, so it is not always Replay's | ADR 0053 and its amendment: the provider is authored and never follows the connection, so "republish to move it" advises what that decision refuses, and a reachable provider is not news; the judge inherits the rule unchanged; a replay or a fork runs its arms before it answers, so an arm this lab cannot reach refuses the whole derivation. Reachability is `getLabStatus`'s source for the one provider `listModelConnections` names — `saved` and `environment` reach it, `saved_unreadable` and `none` do not |
| *Test connection* | a bolt glyph beside the label | the label alone | the bolt is outside this workspace's verb vocabulary (`lib/ui.ts`, `buttonIcon`), which gives a glyph to a verb the whole workspace shares rather than to one button |
| Replacing a configured key | *Replace* opens an empty field, with no way back but Discard | the same, plus *Keep the current key* beside the field | Replace with nothing typed changes nothing that would be saved, so the pair is not drawn; without a way back the row is an empty optional field that reads as though no key were stored, while one is — used, unless the lab cannot decrypt it, in which case the row says leaving it empty keeps the lab offline — and Discard would also throw away an endpoint being typed |
| What is in force on a lab with nothing saved | the form, opening on OpenAI with its base URL filled in | the form empty on Custom, and one sentence above it naming the environment or saying the lab reaches nothing; a saved key the lab cannot decrypt is said on the API key row instead of *Configured* | the prototype's opening state is a fixture — a real lab with nothing saved has no endpoint to fill in — and an empty form reads as *pointed nowhere* whether or not `AGENT_LAB_OPENAI_API_KEY` points it somewhere. `saved_unreadable` "wins as an offline lab, with a source that names the remedy" (ADR 0052), and the remedy belongs on the row it is acted on, not only inside the collapsed read-out |
| *Forget* on the last-visited shop | bare text turning warm red on hover; also moves *Where the app opens* from Last shop to All shops | the quiet `subtle` button, and it drops the shop and nothing else | `/` already falls back to the shops index with nothing remembered (ADR 0054), so the fallback needs no second copy in a preference — and a control that rewrote a choice the operator made would be the application editing a preference behind them. The red is not spent on it either: *the warm red is destructive and nothing else*, and a browser preference is not |
| *Reset to defaults* | also re-points the remembered shop at the first shop in the list | leaves the remembered shop and the settings-return location alone | that is a fixture's way of saying *undo*; there is no shop a real reset could pick, and neither value was chosen by anybody (ADR 0058) |
| Support identities in shop scope | drawn on both rails, filed under Shop scope | one lab address on both rails | there is one library; two routes rendering one list would make the mode depend on which door was used (ADR 0054) |
| Mode tabs on Settings | drawn — the prototype's settings is an overlay on a mode | absent | `/settings` is a route in neither mode, and tabs there would be the one place the mode is not the branch of the tree you stand in (ADR 0054); rule 5 |
| Shop logo's contrast warning | "Hard to read against that background. Try the other one." in the warm red at 600, under *Mark colour* | the same sentence in the warning ink at normal weight, as the *Mark colour* group's second description line; Save and Create are never refused for it | the pair is the operator's to choose and the lab accepts every one, so the sentence is a warning and not a refusal, and the warm red is destructive and nothing else (ADR 0070, amended) |
| A shop with no logo | none: every prototype shop has an icon or a monogram with colours | the monogram tile checked, no background or colour checked, drawn in white on `lab-ink`; the first pick gives it a logo, and the card has no way back to none | a shop stored before the logo existed has chosen nothing, and a logo nobody chose is not the lab's to make (ADR 0064, ADR 0070) |
| Count on the bench entry | "1 live" | nothing | a tally of running arms in one shop, not the length of any listing the shell reads; a figure the payload lacks is not faked (ADR 0056) |
| Focus ring on the bar | `2px solid #1d6241` offset outward, as everywhere else | the bar's paper, inset on the two controls that are the bar's full height | pine on `#16332d` is 1.86:1, under WCAG 2.2's 3:1 for a focus indicator, and an outward offset puts half the ring off the bar; *Principles* outrank a measurement (ADR 0055) |
| The create page's side column | 312px of notes beside the form — *What happens next*, *In a hurry?*, *Summary*, *Soundness* | the one 790px column; the notes that carry a rule are cards in it, the rest are not drawn | `form-decisions.md`'s layout 2b sizes the *form*, and a second column of prose beside a create form that asks four questions is a column that mostly repeats the hints under them; a note computed from a form nothing has written yet (*Summary*, *Soundness*) is a figure the page lacks |
| An untitled product's heading | the bound title, empty | "Untitled product" | *New product* appends a product with no title, and an empty `<h1>` leaves the page — and the tour's first anchor — with nothing to read; *Principles*, every state is designed for |
| *Attach existing* on Customers | a secondary header button that opens nothing | the same button, opening one inline row with the profile picker | the prototype's attach is a fixture with no panel behind it, and an attach in this workspace has to ask which profile; the row is not the side card the slice removed — it is the one control the question needs |
| A judge's rubric at creation | the field, under "Can be left empty now, but the judge cannot be published until it is written" | required: Create is refused and the reason names the rubric | *A create form asks for what constrains the work that follows*, and a judge with no rubric constrains nothing. Not rule 5: the codebase did create a rubricless judge, so this changes what was there rather than keeping it. What licenses the change is that sentence together with the slice's own stated evidence, and the lab's `new_judge_configuration` is the corroboration rather than the licence — it defaults the model and the evidence because they have a proven right answer, and deliberately defaults no rubric |
| Three cards on the lab's create pages | Tools on New configuration, Evidence on New judge, and an Architecture row beside a Provider select | none of the three; the Provider is the prototype's own read-only variant of that row | *A create form asks for what constrains the work that follows **and names where the rest lives*** — the *Created as a draft* card on each page is where the rest is named: a new draft reads through every tool and writes through none, and enabling a write is the act the editor exists for; the judge's evidence starts at what the lab has proven and is changed there. The Architecture row is the one of the three rule 5 reaches, because `AgentArchitecture` has a single member and *a choice of one is not a choice* — which is also why the Provider is drawn as a value rather than as a select |
| Two hints on New scenario | "It does not have to be unique, but two scenarios with one name are hard to tell apart"; "Creating the scenario freezes the ticket at its current version" | a shop answers to one scenario of each name, and Create is refused by a name it already holds; and the hint splits the freeze — the ticket and the documents it suggests are fixed by creating, the ticket *version* is pinned by publishing the scenario | both sentences describe a lab that is not this one: `_require_free_name` refuses a duplicate at create and at replace, and `ScenarioResolution.ticket_version` reads the ticket's latest published version, which `publish_scenario` is what pins. *Every hint names the code that makes it true* (*The form language*), which is the same reading `lib/fieldRules.ts` already applies to the prototype's product Status and Shop slug rows |
| The composed objectives and mutations | the chips alone, under "Bindings are added in the editor once the scenario exists" | the chips, and an ordered list under them naming each composed template and the bindings to this shop it still owes | *A create form asks for what constrains the work that follows **and names where the rest lives*** — the same sentence that licensed the three cards above, and the list is where the rest is named. The plan asks for the templates *with a binding each*, and a binding cannot be made before the first write: every binding a scenario writes is to an object of its own shop, and the pickers that offer those read `ScenarioResourcesSchema`, which is addressed under a scenario that does not exist until Create is pressed. What composing *can* carry it does — the page reads each composed template's own draft, so the severity and the literal defaults its author chose ride in with the instance exactly as they do in the editor |
| The overview's heading | the shop's name, 26px | "Overview" | the plan's own first bullet for this page — "`ShopHomePage` becomes *Overview*" — which is the licence; the rest is why it reads well: every other page in this workspace names the page rather than the shop, the rail entry that opens this one already said *Overview*, and the switcher names the shop on every screen anyway |
| "4 scenarios and 18 experiments read this one" under the latest version | drawn on the timeline | "What a scenario resolves against today." | neither figure is in any payload this page holds — a scenario's listing row carries no pinned shop version and nothing counts experiments per version — and a figure the payload lacks is not faked (*Lists and counts*). What is drawn instead is the fact the lab does hold: `ScenarioResolution` pins whatever is published when it resolves |
| "or open the live one →" under *Run a comparison* | drawn | not drawn | "the live one" is a running experiment, and `ExperimentSummarySchema` carries no status; the same rule, and the same reason the bench entry carries no "1 live" |
| *Run a comparison*'s sentence | "Everything this needs is ready: <scenario> against shop <version>" | "A comparison runs **<scenario> v1** against shop **v3**.", or, where the listing holds no published scenario, "No scenario is published in this shop yet, and a comparison runs a published scenario." with a link to Scenarios | the prototype's four opening words are a verdict nothing reads: a comparison also needs two arms on published agent configurations, which `start_experiment` refuses without and which this page never lists, so a lab holding one and not the other would be told it was ready. That is the derived progress reading ADR 0044 and ADR 0045 removed, drawn smaller. What is built is the fact the one listing holds — which scenario, at which version, against which shop version — and it was decided before this slice (`docs/PLAN-UX.md`, *Decisions already taken*) |
| *Recent activity*'s three sentences | "Scenario … v1 published", "Ticket T-204 opened by Maya Laurent" | "… updated", on each listing's own `updated_at`; an experiment reads "started", on its `created_at` | a scenario's listing row carries no published-at and a ticket's `opened_at` is an instant in the fiction rather than in this workspace, so neither sentence has a clock that means it; *every hint names the code that makes it true*, read here about a sentence rather than a field |
| *Required by a scenario* chip on Documents | drawn, over `DOCUMENTS.filter(d => d.required)` | not drawn; the other four are | the scenarios listing carries `context_document_count` and no document, so the subset cannot be named without one draft read per scenario — the additive read ADR 0056 measured and refused — and a figure the payload lacks is not faked (*Lists and counts*) |
| *Version* and *Read by* columns on Documents | two of the table's four columns | neither; the table is Document and Kind, with a policy's own subject under it | a shop document has no version of its own — the shop has the version — and which scenarios read one is the same figure the chip above lacks; the same rule (ADR 0056) |
| Kind on the document editor | a read-only value, beside a slug "set at creation" | the same read-only value, and the create page that sets it | the prototype draws no surface that could set either, and the plan's own bullet asks for the kind as a select. It is a select on the create page instead of a control in the editor, because a document is named by its kind and its slug together and moving either would make it a different document to every scenario that had named it (ADR 0057) |
| Remove on the document editor | not drawn | drawn in the Document card's footer, with the second press every Remove gets standing in the footer's place (ADR 0060) | the three collections this table presents each carried a Remove per row before it, and a presentation is not where an author loses their only way to delete a policy |
| The document editor's side column | two note cards beside a 790px form — *Read by*, *Never in the prompt* | the one 790px column, with *Never in the prompt* as a card in it and *Read by* not drawn | the same reading as the create page's side column above; *Read by* is the figure the chip and the column beside it also lack |
| The rows of *What this shop holds* | the whole row is a click target, with a link inside it | the row, with the link as its one control | a nested link inside a clickable row is two controls a keyboard reaches as one; *Principles*, every workflow keyboard-reachable |
| A guideline's `slug · version` line | drawn | the slug alone, as the row's `EntryId` | `ToneOfVoiceSchema` carries no version: the shop carries the version, the page header's `VersionChips` is where it is read, and a per-row copy of it would be the same figure written once per guideline. A figure the payload lacks is not faked (*Lists and counts*) |
| *Used by* under a guideline | "Resolved by 3 agent configurations" / "Named as an override by 1 configuration" | not drawn | `AgentConfigurationSummarySchema` carries no tone selection at all, and the configurations listing is the lab shell's rather than the shop's (ADR 0056), so the figure would cost one configuration draft read per row — and even then an override is a free-typed `guideline_id` on a shop-independent configuration, which may name a guideline of a shop this page is not. The one use this page does know is drawn: the *shop default* chip is which guideline a configuration with no override resolves to |
| *New guideline* on the Guidelines card | a header button appending an empty row, opened for editing | the add form below the list, as on every other list in this workspace | the prototype's row is keyed by its position in an array; a guideline is keyed by its ID, which `DerivedIdField` derives from the name, so an appended row has no key until it has a name. The prototype pays for that by writing the row into the list and marking the draft unsaved on the press, then rolling both back on Cancel — restoring the save state wholesale over anything else done meanwhile. The add form holds the new guideline outside the draft instead, which is ADR 0051's *a half-typed create form is not unsaved work* |
| The guideline editor's two validation messages | 13px 600 `#9d3028` under the Name and the Guideline field | the name's, at that weight, as one line under the row's fields, named by the Save's and the radio's `aria-describedby`; no body-empty message | *Two refusals with one cause are one sentence*: the row's Save and its default radio are refused by the one fact, so they point at one line rather than each at a copy under its own control. The body-empty message is not drawn — the rule this surface enforces is the name, and the guidance the gate still refuses on its own |
| The option's confirm | drawn under the option's chips in place of its *Remove this option* button, the rest of the option still on screen (:971) | the whole option row replaced by the confirm | `form-decisions.md` 9.2, "the confirm takes the row's place", which this document's rule states and every other removal follows; the prototype's option is the one row it draws a confirm on, and one list whose confirm left the row standing would be the exception every other list had to be read against |
| "Removed Colour from the draft. Undo" after the second press | drawn (:982) | the notice without its Undo, a line that takes focus once the row has gone | a draft removal is already reverted by *Discard changes*, the order's delete is the one removal that cannot be, and an Undo per removal would be a second history to keep in agreement with the draft's (ADR 0060) |
| A header's Delete | a confirm in place of the row | on the order editor, the confirm under the header, full width, while the Delete is withdrawn | a header has no row for the confirm to take the place of, and a panel stating a whole consequence does not fit between the header's other actions |
| Delete and Duplicate on the product editor | frame 2c draws both on the header, Duplicate with a copy mark | both, on the header and as a catalog row action, Duplicate without the mark; Delete's confirm under the header, naming the orders whose lines name one of the product's variants | the product key holds a confirm to its product across renames and discards (ADR 0061). The orders are read once, when the confirm opens — never per render or per row, which is what *Required by a scenario* is refused for — because it is paid by the operator who asked, at the moment the answer changes what they do; the mark is outside the verb vocabulary (ADR 0062) |
| A guideline's delete | *Delete guideline* (:1969) | *Remove*, named "Remove {name}", and a confirm asking to remove it | every entry list in this workspace removes under one verb and the specs reach the control by that name; rule 5 |
| The queue under the composer | a coloured letter badge per arm and the configuration beside it; the queue drawn only for the bench's send | the arm's name and what it runs, in words, and the same queue for a Run on an arm's card, a scoring pass, a replay, a fork and — without arms — a freeze | the workspace has no per-arm colour to paint a badge with, and the arm's name is what its card is titled; `form-decisions.md` 10.2 is the rule for every long action, and the prototype draws the one it had room for (ADR 0065) |
| A line beside Replay and Fork | "Same seed, same starting snapshot. Replay reproduces this exactly." in the finding's card | "Replay runs this incident again as it was recorded; Fork runs it again with the arms you choose." under the header, describing both buttons | a replay runs its arms against their models again, and a model arm does not reproduce its answer exactly; the line says what each derivation is, beside the reach line that says why one cannot run (ADR 0053, ADR 0065) |
| The Tickets page's title and count | "Tickets" and "4 in this shop" at the head of the list column (:2174), with no page header | the page header every surface has, spanning the list and the ticket beside it, with "N in this shop" as its description; the list keeps its filter select and no longer titles itself | the header holds the title and the tour anchor where every other page holds them, and the count is the whole listing the rail reads (ADR 0056). The ticket editor's own pinned header stays in its column under it (ADR 0066) |
| The Scenarios index's last chip | "Draft" (:6864) | "Never published", as on every other index | one name per thing (*Names*): the chip counts the scenarios with no published version, which is what the Shops, Customers, Agent configurations and Support identities chips call "Never published" |
| An arm's objectives figure | "5 of 6 objectives met", green on one arm and amber on the other (:2578, :2587) | "met of decided" over "decided objectives met", in one ink on both | two arms driven to different depths hold different denominators, and a colour between them is the verdict *Evidence before opinion* refuses (ADR 0068) |
| The results header's Fork | "Fork" | "Fork…" | it opens the panel that asks which versions to run, where Replay asks nothing; rule 5, the name a spec presses |
| *Clear filters* on History | drawn, pressable whatever is set (:2680) | disabled while nothing is set, with the reason in `title` and in the line beside it, which says "Filters cleared." once pressed | a secondary control that can do nothing keeps native `disabled` and says why (ADR 0063); the same line reports the press, so the reason and the outcome are one place |
| New experiment's arms and scenario | one select per row naming configuration, version, framework and model together ("cfg-atlas v4 — Pydantic AI · gpt-5-mini"), and the scenario with its version | two selects per row — the record, then its published version — with the framework and model as the row's second line; Arm B's hint adds "Leave it empty to run arm A alone." | a configuration's versions are a read of their own, so one list of every version of every configuration is one read per configuration before the select can open; and the lab runs one arm or two, which a row that could not be emptied would not say (ADR 0064) |

Georgia on the results' stat numerals landed with the surface that first draws it, the arm cards
under the results header (ADR 0068) — as the `open` button verb landed with the overview's
grouped findings and the `document` chip kind with the Documents table.

## Names

One thing has one name on every surface — its rail entry, its page title, the links that reach
it, its tour and the words around it. A reader who meets two words assumes two things.

- **Scenario**, never *recipe*. The scenario editor's first card is *Built on* — the name, and
  the ticket, customer and shop the scenario never moves off — as the prototype titles it.
- **Bench** is the lab's rail entry: the page that starts a run and lists the recent ones.
  **Live bench** is one run in progress, and the link back to it from the results says so.
- **Results** is where a run is read: the bench's *Results*, History's *Open results*, the
  results page's own title while it loads, and its tour. Its tabs keep the prototype's names —
  *General*, *Execution timeline*, *Traces* — because they name views of the results.
- **Freeze** is the verb for a snapshot, as it is for a publish: *Freeze snapshot*, "frozen",
  and never *materialize*, which is the API's word and stays there.
- **Never published** is what every index says of a definition with no published version, on
  the chip and in the row — and the shop switcher, which lists shops by what they have
  published. *Draft* stays where it is a status rather than a version — a
  product's.
- **Overview** is the shop's first page: its heading, its rail entry, its tour (*Show me around
  the overview*) and every link that opens it.

## Navigation and chrome

The values are in `shell/AppShell.tsx`; the rules are these.

- **Two modes** (ADR 0054). *Shop fixture* with the shop's rail and *Experiment lab* with a rail
  of Bench, History and a Library. Lab routes live outside shop scope under `/lab`, the two
  surfaces that read one run carry its shop in the path, every old shop-scoped lab path
  redirects and carries its shop into the remembered-shop preference, and the lab keeps a
  current shop through the switcher, present in both modes — navigating in shop mode, setting
  the lab's shop in lab mode. A lab surface that needs a shop and has none says so and links to
  the shops index; it never guesses. `/` resolves through the *where the app opens* preference,
  defaulting to the remembered shop.
- **The rail** collapses to a strip whose rows keep their accessible names; the collapsed state
  is a browser preference and never a database row (ADR 0044), and it is one preference for both
  rails. It is hidden on the shops index and on Settings. `nav[aria-label="Shop workspace"]` is
  what every spec reaches it by and does not move; the lab's is
  `nav[aria-label="Experiment lab workspace"]`. The foot control's name, copy and tooltip are one
  string. **Each entry carries its listing's count** (ADR 0056), right-aligned and muted, under
  the rule *Lists and counts* states: the whole list, absent while the listing is in flight or
  failed, zero drawn, nothing faked. The workspace holds those listings — the shop's four and
  the lab's five, plus history's total — reads each once and hands it to the rail and to the
  index that renders it, and a surface that changes what one holds reads it again. An entry's
  accessible name stays the label alone and the figure is its description; the collapsed strip
  draws no figure and still says one.
- **The top bar** (ADR 0055) sits on a token of its own and carries four things. The identity at
  the left is the shop switcher wherever there is a shop to name and the app title otherwise,
  never both; the title returns to the shops index. The **switcher is a button opening a
  `menu`** — not a select — with roving focus, `Escape`, an outside press and a navigation all
  dismissing it, and the shop's badge is its logo, or its initials without one (ADR 0070).
  The **mode tabs** are drawn in a mode and absent outside one. At the right, **one** *Show me
  around* mount resolves the surface's tour from the location and is absent where no tour exists,
  and **Settings** is a toggle: lit with a close glyph while its page is open, returning to the last
  location that was not `/settings` — a browser preference, never a row (ADR 0044) — and to the
  shops index when a browser remembers none.
- **Settings is its zones told apart by surface**, in a column capped at 1024px, under a
  "← Back to workspace" link that reads the same remembered location the bar's toggle does
  (ADR 0055). Each zone is a landmark named by its own heading, which is the same distinction
  for a reader who sees no colour. *Your preferences* is white and saved on change, with
  *Reset to defaults*; the lab-wide *Model provider* is white too, and is the page's one
  setting that is not a browser preference — endpoint presets, a base URL, a key that
  is typed to save and afterwards says only that it is configured and when, a connection test
  whose answer is dropped the moment the endpoint moves, and an explicit Save and Discard shown
  only while there is something to save (ADR 0052); *Runtime configuration · Read only* is a
  collapsed disclosure of grey
  padlocked cards, each ending in a "To change it:" line naming the variable, the file or the
  zone above (ADR 0044's character, narrowed by ADR 0052 — *Run mode* is a per-request answer
  a save moves without a restart, and it states which of the chain's **four** sources won,
  because `saved_unreadable` is an offline lab whose remedy nothing else on the page could
  give), with the disclosure's own state ephemeral; and the seed is its own zone, because it
  is an action rather than a setting (ADR 0047).
- **A browser preference is either chosen or recorded** (ADR 0058). Four are chosen on
  Settings — where the app opens, whether the rail starts collapsed, how a timestamp is
  written, whether a removal asks twice (ADR 0060) — and *Reset to defaults* puts exactly those
  four back. Two are written by the shell
  as the operator moves — the last-visited shop and the location Settings returns to — and a
  reset touches neither, because neither was chosen; the first has its own *Forget*, which
  drops the shop and rewrites no other preference. **The timestamp format reaches every
  `formatTimestamp` call**, defaulting to relative. An instant inside the fiction — an order's
  `placed_at`, a frozen address's `selected_at` — goes through `formatFixtureTimestamp` and is
  always a date, because *ago* is measured from a clock a fixture does not have.
- **Tours** (ADR 0045, 0046, 0049, 0055): one tour per surface, the same words everywhere,
  offered from one control in the bar that reads the surface's tour from the route; an overlay
  above the page, never in it; nothing starts unbidden, nothing is remembered, no tour crosses a
  screen, a popover explains and never performs; every step and every surface's route declared
  in one table and swept by Playwright against that surface.
- **Nothing about progress is stored and no surface reads it** (ADR 0044, ADR 0045), save the
  setup pages' checklist, which is the shop gate read with labels over it (ADR 0071). The
  overview's readiness card reads one listing and says one sentence: it names the shop's most
  recently edited published scenario, and the shop version it would resolve against, with a
  link to New experiment — or says none is published, with a link to Scenarios. **It names
  what a comparison would run and never says that one can run**, because whether one can is a
  verdict over gates this page does not read. That is *an empty state says why and links to
  the prerequisite*, and it is the only readiness any surface reports. The overview's four jump cards are counts
  under *Lists and counts* and judge nothing — a count is what a listing holds, and a
  readiness reading is a verdict about what it does not.

## Tokens, type and glyphs

The tokens are `apps/web/src/styles.css`; the class sets, the button and chip vocabularies and
their metrics are `apps/web/src/lib/ui.ts`. Rules:

- **Pine is the primary action; the warm red is destructive and nothing else.** Every button
  variant carries a hover and a `focus-visible` ring. A destructive control keeps its glyph and
  its verb; red is a second signal.
- **Georgia for display** (page and card titles, the thread subject, the bar's title); sans for
  UI; monospace for slugs, ids, model names and env vars. Entry-row titles, the per-arm run
  label and dialog titles stay sans.
- **A chip that names a kind is not a control** (`chipClasses`): the tool calls, attempts,
  faults and split turns on the bench and the timeline are bordered labels with no hover, no
  pointer, no ring and no tab stop. A chip that opens something — a pinned version on the
  results — is a link, and draws the link's underline and the focus ring.
- **A button names a verb and a chip names a kind, never an icon.** `buttonIcon` and
  `filterChipIcon` are two closed tables that stay apart: a chip's check means "the published
  ones", a button's means "save". Every glyph is `aria-hidden`; the word carries the meaning.
- **A colour one file uses is a literal, not a token.** A token is minted with its first
  consumer and named for its role.

## The form language

`form-decisions.md` chose variant 2 of every component; these are the choices as built.
Geometry and metrics are `Field`, `FieldGroup`, `fieldControlClasses`, `textAreaClasses` and
`searchFieldClasses`.

- **The row.** Label and hint share the left column, the control takes the right, both
  top-aligned, wrapping to stacked when narrow. A label is `for`/`id`-bound to a native control;
  a row over a chip group or custom widget is a `<fieldset>` named by `aria-labelledby`, never a
  dangling `for`. The index search box is its own class and shares no value with the form
  control.
- **Guidance lives under the field** (ADR 0050). The minority is marked: "(optional)", never a
  star. Placeholders are realistic examples. One carrier per job — tours explain a surface, hints
  explain a field — and `title=` is never the only carrier: a rule is one muted line in the
  control's accessible description. A rule about a set is a `FieldGroupHint` on the `<legend>`;
  where a rule names a derived value, a second line shows it. A row carries no hint unless the
  rule is true on that surface; every hint names the code that makes it true; a field never
  claims a severity its gate did not give; a mirrored gate sentence is the gate's, character for
  character, pinned from both ends in `lib/fieldRules.ts`.
- **Identifiers are derived, never asked first.** `DerivedIdField` follows its source until
  edited, resumes when emptied, previews as "Saved as `…`", refuses a taken value audibly, and
  stays closed while the list it derives from is loading. A saved entry's identifier is displayed
  and never asked; a SKU and a media reference are their own keys and say so. A value that is
  taken is held on its field and never written, and the page's Save names the field's line; the
  shop slug is refused on Shop details off the listing the create page reads, and only when the
  operator changes it (ADR 0069).
- **A field states its own width.** The shared control declares none; every call site composes
  one — `w-full` almost everywhere — so a narrow field is narrow on screen (ADR 0069).
- **A free-text field over a set the draft already uses offers it** as a `<datalist>`, spelled as
  the lab keeps it: the product category offers the other products' categories (ADR 0069).
- **A reference reads as what it points at.** A ticket's origin product and its suggested
  documents are named by the title the shop draft gives them, a document with its kind beside
  it. One the shop no longer resolves is named by its identifier, marked unresolved, and keeps
  the control that removes it — as an unresolved linked order does (ADR 0067).
- **No contract union reaches a reader in its wire spelling.** One table per union in
  `lib/enumLabels.ts`, keyed to the generated type and swept; free strings through
  `describeValue`. An explanation only where an operator could choose wrong, and only saying what
  the lab enforces. A status column is a `StatusPill`: glyph for the axis, word for the meaning.
- **Where a set comes from decides the control.** A contract union is a select. A register (a
  locale, a country) is a datalist that suggests and echoes the name. What the lab has proven
  follows the gate's severity: provider a select, model a datalist, tone override a datalist of
  *published* guidelines. A select still offers whatever the payload carries. The provider resets
  when it leaves its set; the model resets only when the provider moved; all else stands and is
  flagged. A choice of one is not a choice.
- **A choice the lab can make without guessing is already made** (ADR 0064). A version select
  opens on the newest published version and marks it "(newest published)". A select that picks a
  record from a listing — a scenario, a configuration, a customer, a template — opens on it when
  the listing holds one it could pick (a placeholder and a disabled option are not candidates),
  and its hint says so in the prototype's words: "This one is the only published scenario in
  the shop, so it is already chosen." A default is written only into an empty value, so no later
  load replaces a choice; a vocabulary of one is still drawn as a value, and a select bound to
  saved content holds what was saved. A name derived from other fields is a `DerivedIdField`
  without the "Saved as" preview; a date defaults to the operator's own today.
- **A list entered one value at a time is one control** (`ChipListField`): named remove
  buttons, duplicates refused and said, respelling previewed to the shape the gate wants.
- **A small closed set of toggles is one control** (`ToggleChipGroup`, ADR 0071): the
  prototype's chips — pine with a check when on, plain when off — each a native checkbox laid
  transparent over its chip, in a fieldset named by the row. The last chip of a set the lab
  will not let be empty stays on, disabled and titled with the rule its hint states; a chip that
  cannot change for its own reason says it in a line under the chips; a gate error a chip's
  state causes marks it `aria-invalid` in the gate's words and refuses nothing. The shop's
  currencies and channels, on both pages, and the bench's *Deliver to* are built on it. A set
  whose options need an explanation or carry metadata, an open-ended list, and a press that
  starts something are not this control.
- **The setup pages carry the setup checklist** (ADR 0071): beside the cards from `xl`, after
  them below it, each line a ✓ or a !, a label and a note, decided by the saved draft's gate. A
  line still to do lists the gate's findings for it as `IssueList` draws them; the last line,
  "No blocking findings", holds every finding no other line owns, grouped by product with an
  *Open*. It says when it is reading a saved draft the screen has moved past.
- **A number field says what it accepts** and refuses at the save what a pattern cannot. A
  closed set of five is five named radios.
- **A create form asks for what constrains the work that follows** and names where the rest
  lives. Creation is a **page**, not a side card — `form-decisions.md` layout 2b, `CreatePage`:
  sticky header, back arrow, breadcrumb, the typed name as the title, Cancel, and a Create that
  is refused with its reason until the form can submit (*A blocked primary action says why*) — and it lands in the editor
  of what it made, refreshing the listing its rail counts on the way (ADR 0056). A create that
  is refused keeps the operator on the page with the reason under the button. A half-typed
  create form is not unsaved work and is not asked about (ADR 0051); **a create that takes
  two writes holds unsaved work from the moment the first one lands**, declares it under
  the same rule as any editor, and its running write stands down when the operator leaves. **A
  second write is sent only where the form asked for something the create request could not
  carry**, so the same page is a one-write create when it did not, and registers nothing.
  Built for the shop, the order, the profile, the identity, the scenario, the agent
  configuration, the judge, the two block libraries and the shop document — every create the
  workspace has. **A product is the exception**: it is a row of the shop draft rather than a
  definition, so *New product* appends an empty one and opens its editor, and the handle it is
  addressed by is answered there. **A document is a row of the draft too and is still a page**,
  because it is named by its kind and its slug together and the kind is a question its editor
  cannot ask (ADR 0057); it writes by appending to the draft rather than through
  `useCreateThenComplete`, for the same three reasons the product needs no page — nothing to
  post, nothing to be refused, nothing to wait for. Ticket authoring stays inside the
  three-pane screen.
- **A finding links to the fix** (`form-decisions.md` 11.2). `IssueList` groups the gate's
  findings by the entry that is wrong, names that entry as its own surface names it, tallies
  each severity and carries one *Open* that lands on the editor and, where the path names one,
  the entry in view. One list serves the shop's overview and every editor's Publish gate card:
  the caller hands over the path-to-route map, and an editor hands over none, because there the
  entry that is wrong is a row of the page the reader is already standing on. A path the map
  does not name keeps its finding in the gate's own words and loses only its *Open*, and every
  gate code the domain raises is swept against the map (`lib/issueRoutes.test.ts`, reading
  `apps/api/src/capability_lab` the way ADR 0023 sweeps the tool registry).
- **Publishing the shop is read before it is done.** The overview's *Review N changes &
  publish* opens what becomes the next version — the gate's own change list, Publish, Keep
  editing, and what stays pinned until it is repointed — and only the Publish inside it writes.
  The published state says the version is immutable and links to New experiment. Every other
  definition still publishes on one press; a review is worth its second press where a draft
  spans a whole workspace rather than one form.
- **A saved row opens where it stands** (`EntryCard` edit mode): one payload builder per entry
  for the add form and the open row; one row open per list, siblings' Edit disabled with a line
  saying why and that an open row is not in the draft until Save; Cancel writes nothing; the row
  is a named form; a refusal one path makes the other makes too.
- **An editor says what is unsaved and asks before it is lost** (ADR 0051): *Discard changes*
  beside *Save draft* while dirty, "All changes saved" in a live region when not; one dialog
  with Save and leave, Discard and leave, Stay.
- **Removing is deliberate** (ADR 0060): two presses on every removal that is not one value
  re-typed in the field beside it. `ConfirmRemove` replaces the row with the question, the whole
  consequence — the finding the removal will raise, that nothing is written until the draft is
  saved, what a published version keeps — *Remove it* and *Keep it*; it takes focus as a group
  named by the question and described by the consequence, and Escape or *Keep it* returns focus
  to the control that asked. After the removal focus is on the list's notice line, which says
  "Removed … from the draft." — on the list the page navigates to, where the removal leaves the
  page — and is not also a live region; it clears once the entry is back. A confirm belongs to
  one subject and is dropped when the page moves to another. The order editor's Delete has no
  row, so its confirm stands under the header. *Confirm before anything is deleted* on Settings
  removes the second press, and the order editor's Delete obeys it too. A product's own Delete
  and Duplicate are not built: they wait on a product identity the editor does not yet have
  (ADR 0060, `docs/PLAN-UX.md`).
- **A blocked primary action says why** (ADR 0063): dashed, `aria-disabled` and reachable, the
  reason in `title` and inline in its accessible description, at the validation weight — 13px
  600 `#9d3028`, `validationMessageClasses`, the weight a validation message under a control
  also reads at, on a `Field` row or stacked, with the control marked `aria-invalid`. A keyboard
  reader lands on the refused control and is told why; a press, a key or Enter in its form does
  nothing, because `PrimaryAction` swallows the activation. `blockedButtonClasses` in `lib/ui.ts`
  is the weight — deliberately outside the button table, with a focus ring and no hover — and
  `PrimaryAction` the only thing that draws it, with `RefusalLine` for the sentence where the
  surface has one to write. A primary action is one at the accent or ink weight or the one
  submit of a form, a saved row's Save included; every create page (nine route files, ten
  surfaces), Publish everywhere (`PublishButton`, described by `PublishReasons`), Start, the
  connection's Save and Test, the bench's *Send as the customer*, *Attach to this shop*, *Fork
  this run*, *Save and leave*, *Add tag*, *Add note*, *Add to thread*, *Add fulfilment method*
  (a transit window the lab refuses, said under Max days), the scenario editor's *Add* at the
  objective and mutation caps (the lab's sentence, under the picker) and the add forms refused
  for a reason no field states wear it. Start is refused until it can work, and says every cause
  it waits for at once. A press in flight is not a refusal: it says nothing, and is `aria-disabled`
  rather than `disabled` so the reader who pressed keeps focus while it runs and after (ADR
  0065); a Publish whose gate has not answered for the saved draft is one too, and the gate says
  "Checking the draft…" in place of its last reasons. While a press is in flight it wins over a
  refusal that arrives meanwhile. Every submit handler also checks the refusal itself, so a submission that
  reaches the form without the press is refused too. A `type="button"` action has no route but
  the press: the connection's Save and Test, Publish and the variant row's Save rely on the
  swallow alone, and *Fork this run* and *Save and leave* keep a check of their own besides.
  Secondary buttons and native form controls keep native `disabled`, with their reason in `title`
  and a muted line their `aria-describedby` names.
  `entryEdit`'s refusal is `{ id, reason }` and never a bare `false`, so a Save that will not
  save says so in the row. **Two refusals with one cause are one sentence**: a tone-of-voice
  guideline with no name can neither be saved nor be made the shop default, and its Save and its
  default radio point at the row's single line; a media reference another entry holds is said
  on the field, and the row's Save names that line.
- **A long-running action reports itself** (`form-decisions.md` 10.2, ADR 0065). Sending a
  turn, running an arm, scoring, replaying, forking and freezing draw `ActionStatus`: the arms as
  a queue, each row saying where it stands in the prototype's words ("running…", "completed
  earlier", "waiting for the customer"), and one sentence under it — "1 of 2 running.", then,
  settled, "Arm A is waiting for the customer · Arm B has completed". The queue is one polite,
  atomic live region mounted before anything runs, and speaks only when an arm moves. "This can
  take a minute and cannot be cancelled." stands outside it while the action runs, named by the
  pressed control; no Cancel is drawn, because nothing can be cancelled. An action the lab
  answers about all arms at once says every arm is running until it answers. `aria-busy` is on
  what is about to change — an arm's card, a matrix, a list — and never on what holds the queue.
  The pressed control holds focus while it runs; where it leaves because it succeeded, focus goes
  to what changed.
- **A refusal that has a way out names the way out, where the control would have stood.** The
  shop's default tone-of-voice guideline carries no Remove at all — deleting it would leave
  the draft owing `tone_of_voice_without_default` with no control on that page to pay it — and
  the sentence naming the pointer stands in the Remove's place (`Workspace.dc.html` :1897).
  That is a refusal rather than a blocked action: nothing on the row can be pressed to make it
  proceed, so there is no control to dash, and the second press is for the Removes that are
  offered (ADR 0060).

## Lists and counts

- **Counts live on the filter that produces them** (`FilterChips`): every chip filters, a zero
  chip is drawn and pressable, the count is of the whole list, the search narrows only rows, the
  row is absent while the listing is in flight or failed, and a figure the payload lacks is not
  faked.
- **The rail counts the same way** and from the same listing the index renders, held once by the
  workspace so the two cannot disagree (ADR 0056). Experiment history is the exception its
  submitted, URL-backed form already makes it: its index reads one narrowed page and the rail
  reads the lab's total beside it, because the count is of the whole list and the page never is.
- **Every index can be searched** (`SearchField`), in the card's header opposite the title with
  the chips beneath; a miss reads "No X matches this view". Experiment history keeps its
  submitted, URL-backed form, which ends on *Clear filters* and then *Search* (:2673): Clear
  drops every filter and the query at once, says so in the line beside it, and hands focus to
  the search box.
- **A chip lives in the component unless an address has to name it.** The one exception is the
  shop's *Documents* table, whose chip is `?kind=`: the retired `/setup/support` redirects to it
  filtered to Guidelines (ADR 0054, ADR 0057), and a filter an address names has to be the
  filter that is pressed. Pressing one replaces the history entry rather than pushing one.
- **Every header spans the content width** and holds the page's actions. Every page that edits
  or creates one object pins its header — the ticket editor's own header in its column included —
  with what its actions report beneath them: the failure, the published version, the reasons
  under Publish. Index and overview pages do not, even where they carry the shop draft's Save.
  A pinned header keeps what the pane scrolls into view clear of it, and holds only where its
  name and actions take a third of the pane or less — decided when the pane is sized, never on
  what the operator does inside the page (ADR 0066). *Shop details* and *Tone of
  voice* pin theirs although the prototype draws them unpinned (`Workspace.dc.html` :1893,
  :1993): each edits one object and carries Save.

## Proposals, not decisions

The prototype proposes five browser preferences and a shop logo. Where the app opens and the
timestamp format earned a consumer and landed with the settings zones (ADR 0058);
confirm-before-delete landed with the confirm (ADR 0060); auto-offered tours and table density
are cut; the logo landed as a shop customization (ADR 0070). The reasoning for what is cut is
in `docs/PLAN-UX.md`, *Deliberately not here*.
