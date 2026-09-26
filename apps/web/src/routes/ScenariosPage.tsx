import type {
  BlockParameterSchema,
  BlockSummarySchema,
  ScenarioContentSchema,
  ScenarioSummarySchema,
} from "@agent-lab/contracts";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { mutationBlocks, objectiveBlocks } from "../api/blocks";
import { describeApiError } from "../api/client";
import { createScenario, replaceScenarioDraft } from "../api/scenarios";
import { ChipListField } from "../components/ChipListField";
import { CreatePage } from "../components/CreatePage";
import { Field, FieldRows } from "../components/FieldHint";
import { type FilterChipDefinition, FilterChips } from "../components/FilterChips";
import { SearchField, SearchRow } from "../components/SearchField";
import { Card, PageHeader } from "../components/WorkspaceChrome";
import { useCreateThenComplete } from "../lib/createDefinition";
import { CHIP_LABEL_MAX_LENGTH } from "../lib/fieldRules";
import { filterList } from "../lib/filters";
import {
  addMutation,
  addObjective,
  bindingsOwed,
  libraryOption,
  MAX_MUTATIONS,
  MAX_OBJECTIVES,
  toScenarioRequest,
} from "../lib/scenarios";
import {
  accentButtonClasses,
  fieldControlClasses,
  focusRingClasses,
  formatTimestamp,
  readOnlyValueClasses,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/useShopWorkspace";

/**
 * The Studio's scenario index (the rail's "Scenarios").
 *
 * A scenario is created on a ticket and never moves off it. Creating one is a page
 * (`NewScenarioPage` below), not a side card here (PLAN-UX Slice 14).
 */
type Filter = "all" | "published" | "draft";

/**
 * The prototype's scenario chips (`tmp/design-frames/Workspace.dc.html`:6862–6865), less one.
 *
 * *Behind the shop* is not here. It counts scenarios pinned to an older shop version than the
 * one published now, and `ScenarioSummarySchema` carries no pinned shop version — the index
 * cannot tell a current scenario from a stale one, so the chip would answer a question this
 * page has no figure for.
 */
const FILTERS: FilterChipDefinition<Filter, ScenarioSummarySchema>[] = [
  { id: "all", label: "All", kind: "all", matches: () => true },
  {
    id: "published",
    label: "Runnable",
    kind: "published",
    matches: (scenario) => scenario.latest_published_version !== null,
  },
  {
    id: "draft",
    label: "Draft",
    kind: "draft",
    matches: (scenario) => scenario.latest_published_version === null,
  },
];

export function ScenariosPage() {
  // The listing this page renders is the one the rail counts, read once by the shop's shell
  // and read again here whenever this page changes what it lists (ADR 0056). The tickets a
  // scenario is built on are the create page's question now, so this index no longer reads
  // that listing at all.
  const { listings } = useShopWorkspace();
  const scenarios = listings.scenarios.rows;
  const loading = listings.scenarios.loading;
  const loadError = listings.scenarios.error;
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  // Name, and the customer the scenario is about — the two the prototype's scenarios search
  // reads (`x.name` and `x.who` in its `shownScenarios` filter).
  const { chips, visible } = filterList(scenarios, FILTERS, filter, {
    query,
    fields: (scenario) => [scenario.name, scenario.customer_display_name],
  });

  return (
    <>
      <PageHeader
        title="Scenarios"
        description="An experiment recipe: one ticket, the documents that matter for it, the objectives it is judged by, and the faults the runtime injects."
        actions={
          <Link className={accentButtonClasses} to="new">
            New scenario
          </Link>
        }
      />

      {loadError ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {loadError}
        </p>
      ) : null}

      <section className={`${surfaceClasses} overflow-hidden`}>
        {/* Only once there are rows to search and count. A chip is a filter, and a row of
            zeros over "Loading…" — or over a listing that failed — filters nothing and
            answers nothing; it is the stat band this slice exists to avoid, drawn at its
            least useful moment. The search box keeps the same company: a box that can only
            narrow nothing is a control that does nothing. Both arrive with the table they
            belong to. */}
        {loading || loadError ? null : (
          <>
            <SearchRow>
              <SearchField label="Search scenarios" onChange={setQuery} value={query} />
            </SearchRow>
            <FilterChips
              legend="Filter scenarios"
              chips={chips}
              selected={filter}
              onSelect={setFilter}
            />
          </>
        )}
        {loading ? (
          <p className="p-4 text-[13px] text-admin-muted">Loading scenarios…</p>
        ) : scenarios.length === 0 ? (
          <p className="p-4 text-[13px] text-admin-muted">
            No scenario yet. Build one on a ticket to turn the incident into an experiment.
          </p>
        ) : visible.length === 0 ? (
          <p className="p-4 text-[13px] text-admin-muted">No scenario matches this view.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={tableHeadClasses}>Scenario</th>
                  <th className={tableHeadClasses}>Ticket</th>
                  <th className={tableHeadClasses}>Composed</th>
                  <th className={tableHeadClasses}>Version</th>
                  <th className={tableHeadClasses}>Draft updated</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((scenario) => (
                  <tr key={scenario.scenario_id}>
                    <td className={tableCellClasses}>
                      <Link
                        className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                        to={scenario.scenario_id}
                      >
                        {scenario.name}
                      </Link>
                      <div className="text-admin-muted">
                        {scenario.context_document_count} context document(s) · completes by turn{" "}
                        {scenario.max_turns}
                      </div>
                    </td>
                    <td className={tableCellClasses}>
                      <span className="font-mono">{scenario.ticket_reference}</span>
                      <div className="text-admin-muted">
                        {scenario.ticket_subject} · {scenario.customer_display_name}
                      </div>
                    </td>
                    <td className={tableCellClasses}>
                      {scenario.objective_count} objective(s)
                      <div className="text-admin-muted">{scenario.mutation_count} mutation(s)</div>
                    </td>
                    <td className={tableCellClasses}>
                      {scenario.latest_published_version === null
                        ? "Draft"
                        : `v${scenario.latest_published_version} · ${scenario.published_version_count} version(s)`}
                    </td>
                    <td className={tableCellClasses}>{formatTimestamp(scenario.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/**
 * The compose chip, in its two states (`Workspace.dc.html`:2986 and :2989).
 *
 * Module-private and deliberately not in `lib/ui.ts`: it is not the filter-chip row — 40px
 * and monospace against that row's 34px sans, because these name templates and the library
 * indexes print a template's name in mono too — and whether the workspace wants one chip
 * table is a question for the slice that looks at every chip, not one to answer from the one
 * surface that draws these. `ChipListField` keeps its own pill for the same reason.
 */
const composeChipBaseClasses = `inline-flex min-h-10 items-center gap-[7px] rounded-lg border px-[13px] font-mono text-[12.5px] transition disabled:cursor-not-allowed disabled:opacity-55 ${focusRingClasses}`;

const composeChipClasses = {
  on: `${composeChipBaseClasses} border-admin-chip-border bg-admin-chip font-bold text-lab-primary hover:bg-admin-chip-hover`,
  off: `${composeChipBaseClasses} border-admin-field-border bg-admin-surface font-semibold text-admin-ink-soft hover:bg-[#f6f7f8]`,
};

/**
 * What a composed template binds to this shop, counted off the listing (`bindingsOwed`).
 *
 * Scoped to what the figure actually counts rather than hedged: a required literal with no
 * default is also answered in the editor and is not one of these, so the line says "to this
 * shop's objects" instead of claiming the entry has nothing left to do.
 */
function owedLabel(summary: BlockSummarySchema): string {
  const owed = bindingsOwed(summary);
  return owed === 0
    ? "nothing of this shop's to bind"
    : `${owed} binding${owed === 1 ? "" : "s"} to this shop's objects, made in the editor`;
}

function versionLabel(summary: BlockSummarySchema): string {
  return summary.latest_published_version === null
    ? "draft"
    : `v${summary.latest_published_version}`;
}

/**
 * One library, composed: the chips that toggle a template in, and the ordered list of what is
 * in and what each entry owes.
 *
 * The chips are the frame's; the list under them is this workspace's answer to *Objectives
 * composed from the library **with a binding each*** (PLAN-UX Slice 14). A binding cannot be
 * *made* here, and the reason is not that the page is short of the template: every binding a
 * scenario writes is to an object of its own shop, and the pickers that offer those read
 * `ScenarioResourcesSchema`, which is addressed under a scenario that does not exist until
 * Create is pressed. What composing *can* carry it does — the severity and the literal
 * defaults the template's author chose, read from that template's draft — so each entry
 * names the bindings it still owes and where they are answered, rather than the page
 * pretending to ask.
 */
function ComposeFromLibrary({
  legend,
  composedLabel,
  blocks,
  chosen,
  reading,
  loading,
  max,
  atCapacity,
  onToggle,
}: {
  /** Names the chip group: what pressing one of them does. */
  legend: string;
  /** Names the list of what is composed, which is a different thing from the chips. */
  composedLabel: string;
  blocks: readonly BlockSummarySchema[];
  /** Block ids, in the order they were composed, which is the order the draft keeps. */
  chosen: readonly string[];
  /**
   * Block ids whose template is being read right now.
   *
   * Composing reads the template's own draft, because the listing carries no parameters and
   * the severity default decides what the objective means (`libraryOption`). The chip is not
   * pressed until that answer is in, so `chosen` never holds a template the page cannot
   * compose faithfully — and while any of these are in flight Create is refused, because a
   * press then would compose the payload without them.
   */
  reading: readonly string[];
  loading: boolean;
  max: number;
  atCapacity: string;
  onToggle: (blockId: string) => void;
}) {
  if (loading) {
    return <p className="text-[13px] text-admin-muted">Loading the library…</p>;
  }
  if (blocks.length === 0) {
    return (
      <p className="text-[13px] text-admin-muted">
        The library holds no template yet. Author one first — a scenario composes templates and
        never restates what they assert.
      </p>
    );
  }

  const full = chosen.length >= max;

  return (
    <>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">{legend}</legend>
        {blocks.map((block) => {
          const on = chosen.includes(block.block_id);
          const busy = reading.includes(block.block_id);
          return (
            <button
              key={block.block_id}
              type="button"
              aria-pressed={on}
              // Busy, never disabled: a browser blurs a focused control the moment it is
              // disabled, so a keyboard operator would lose their place on every compose.
              // `toggleTemplate` is what ignores a second press while the read is in flight.
              aria-busy={busy || undefined}
              disabled={!on && full}
              className={on ? composeChipClasses.on : composeChipClasses.off}
              onClick={() => onToggle(block.block_id)}
            >
              {on ? <span aria-hidden>✓</span> : null}
              {block.name}
            </button>
          );
        })}
      </fieldset>
      {/* The cap is the contract's (`MAX_SCENARIO_OBJECTIVES`, `MAX_SCENARIO_MUTATIONS`), and
          the chip that would exceed it is off rather than refused by the write that follows.
          The picker says the cap once it is reached; no running "N of" its cap is drawn. */}
      {full ? <p className="text-xs text-admin-muted">{atCapacity}</p> : null}
      {chosen.length > 0 ? (
        <ol aria-label={composedLabel} className="grid gap-1.5 text-[13px]">
          {chosen.map((blockId, index) => {
            const block = blocks.find((entry) => entry.block_id === blockId);
            if (block === undefined) {
              return null;
            }
            return (
              <li
                key={blockId}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-admin-border bg-admin-canvas/40 p-2.5"
              >
                <span className="rounded-full bg-admin-border px-2 py-0.5 text-[11px] font-bold text-admin-ink-soft">
                  {index + 1}
                </span>
                <span className="font-semibold">{block.statement || block.name}</span>
                <code className="rounded bg-admin-border/60 px-1.5 py-0.5 font-mono text-[11px] text-admin-ink-soft">
                  {block.name} {versionLabel(block)}
                </code>
                <span className="ml-auto text-[11.5px] text-admin-muted">{owedLabel(block)}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </>
  );
}

/**
 * `/shops/:shopId/scenarios/new` — the recipe, authored on a page (`Workspace.dc.html`:2925).
 *
 * **Built on is the whole of what creation decides.** The name and the ticket are what
 * `CreateScenarioRequest` carries, and the customer and the shop version are read off the
 * ticket and the shop rather than typed: a scenario is the one definition whose subject is
 * another definition, so asking for the customer would be asking an operator to restate what
 * the incident already says — and to be able to say it wrong.
 *
 * **Creating a scenario is therefore always two writes.** `CreateScenarioRequest` carries a
 * name and a ticket and nothing else, while the hidden facts, the objectives and the
 * mutations live in the payload a `PUT` replaces; Create is refused without an objective, so
 * the second write is owed on every press that goes through. `useCreateThenComplete` holds
 * that shape — the retry that finishes the first press rather than making a second scenario,
 * the unsaved work declared between the two, and the stand-down when the operator leaves
 * (ADR 0051, ADR 0056).
 *
 * **What the second write sends is what the editor would save**: `compose` folds the editor's
 * own `addObjective` and `addMutation` over the draft the lab made, and `toScenarioRequest`
 * is the same payload builder the editor's Save uses, so the two surfaces cannot come to
 * answer one question differently. Composing a template reads that template's own draft for
 * the parameters the listing does not carry, because an objective's severity is decided by
 * its template's default and defaulting it here would quietly make every objective
 * `required` (`libraryOption`).
 */
export function NewScenarioPage() {
  const { shopId, listings, preview } = useShopWorkspace();
  const formId = useId();
  const tickets = listings.tickets.rows;
  const [library, setLibrary] = useState<{
    objectives: BlockSummarySchema[];
    mutations: BlockSummarySchema[];
  } | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [facts, setFacts] = useState<string[]>([]);
  const [objectives, setObjectives] = useState<string[]>([]);
  const [mutations, setMutations] = useState<string[]>([]);
  /**
   * What each template this page has composed declares, keyed by block id.
   *
   * Never evicted, so taking a template off and putting it back costs one read rather than
   * two, and a template is only ever added to `objectives` or `mutations` once its entry is
   * here — which is what lets `compose` be sound without a gate of its own.
   */
  const [declared, setDeclared] = useState<Record<string, readonly BlockParameterSchema[]>>({});
  const [reading, setReading] = useState<readonly string[]>([]);
  const [composeError, setComposeError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([objectiveBlocks.list(controller.signal), mutationBlocks.list(controller.signal)])
      .then(([objectiveLibrary, mutationLibrary]) => {
        setLibrary({ objectives: objectiveLibrary.blocks, mutations: mutationLibrary.blocks });
        setLibraryError(null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setLibraryError(describeApiError(cause, "The block libraries are unavailable."));
        }
      });
    return () => controller.abort();
  }, []);

  // Opened on the first incident this shop holds, as the prototype's create page is. Written
  // only while the field is still empty, so a late listing never overwrites a choice made.
  const firstTicketId = tickets[0]?.ticket_id ?? "";
  useEffect(() => {
    setTicketId((current) => current || firstTicketId);
  }, [firstTicketId]);

  /**
   * Compose a template, or take it back off.
   *
   * Reading the template's draft is part of composing it rather than part of creating: the
   * chip goes down only once the parameters are in hand, so the two lists this page keeps
   * hold nothing `compose` cannot build faithfully — including on a second press after a
   * refused write, when the create itself no longer runs. A read that fails composes
   * nothing and says so; the chip stays up, which is the truth about what the page holds.
   *
   * A template already being read is left alone, which is the whole of what the chip's
   * `disabled` used to do and does not cost a keyboard operator their focus: a second press,
   * and a press meaning "take it off again" before it was ever on, both do nothing while the
   * answer is on its way.
   */
  async function toggleTemplate(
    blockId: string,
    chosen: readonly string[],
    setChosen: (next: (current: string[]) => string[]) => void,
    source: typeof objectiveBlocks | typeof mutationBlocks,
  ) {
    if (reading.includes(blockId)) {
      return;
    }
    if (chosen.includes(blockId)) {
      setChosen((current) => current.filter((entry) => entry !== blockId));
      return;
    }
    if (declared[blockId] === undefined) {
      setReading((current) => [...current, blockId]);
      try {
        const template = await source.getDraft(blockId);
        setDeclared((current) => ({ ...current, [blockId]: template.content.parameters }));
        setComposeError(null);
      } catch (cause: unknown) {
        setComposeError(
          describeApiError(cause, "That template could not be read, so it was not composed."),
        );
        return;
      } finally {
        setReading((current) => current.filter((entry) => entry !== blockId));
      }
    }
    setChosen((current) => [...current, blockId]);
  }

  const ticket = tickets.find((entry) => entry.ticket_id === ticketId);
  const taken = listings.scenarios.rows.map((scenario) => scenario.name);
  // One predicate for the gate and for the two compose cards, so a failed read can never be
  // reported as a read still in flight.
  const libraryLoading = library === null && libraryError === null;
  const shopVersion =
    preview === null
      ? "…"
      : preview.latest_published_version === null
        ? "Never published"
        : `v${preview.latest_published_version}`;

  const creating = useCreateThenComplete<ScenarioContentSchema>(
    {
      create: async () => {
        const made = await createScenario(shopId, { name: name.trim(), ticket_id: ticketId });
        return { id: made.scenario_id, draft: made.content };
      },
      // The draft the editor would save for these answers, built over the one the lab made —
      // so the context documents the ticket pre-filled travel through untouched, and the
      // instances are the editor's own `addObjective`/`addMutation` rather than a second
      // spelling of them.
      compose: (made) => {
        const named: ScenarioContentSchema = {
          ...made,
          name: name.trim(),
          // One fact to a line: `hidden_facts` is one piece of operator-only prose, and the
          // editor renders it in a textarea where these read back as the lines they were.
          hidden_facts: facts.join("\n"),
        };
        const withObjectives = objectives.reduce<ScenarioContentSchema>(
          (content, blockId) =>
            composeInto(content, library?.objectives, declared, blockId, addObjective),
          named,
        );
        return mutations.reduce<ScenarioContentSchema>(
          (content, blockId) =>
            composeInto(content, library?.mutations, declared, blockId, addMutation),
          withObjectives,
        );
      },
      replace: (id, payload) => replaceScenarioDraft(shopId, id, toScenarioRequest(payload)),
      refresh: listings.scenarios.refresh,
      editorAt: (id) => `/shops/${shopId}/scenarios/${id}`,
      owes: () => `Scenario ${name.trim()} was created without the objectives composed for it.`,
      standing: "created · what it composes is not saved yet",
      whenCreateFails: "The scenario could not be created.",
      whenCompleteFails: "The scenario was created, but what it composes could not be saved.",
    },
    // The listing is re-read the moment the scenario exists, so once it does it holds this
    // page's own row — and counting that against the operator would refuse the retry of the
    // create that made it.
    // A failed read is answered before a read in flight, because a listing that failed stays
    // empty and unsettled for ever: asked the other way round, the reason on the button would
    // say the page was still reading while the alert above it said the request failed.
    (made) =>
      libraryError !== null
        ? "The block libraries could not be read, so there is nothing to compose from yet."
        : listings.tickets.error !== null
          ? "This shop's incidents could not be read, so there is nothing to build on yet."
          : listings.scenarios.error !== null
            ? "This shop's scenarios could not be read, so a free name cannot be told from a taken one."
            : listings.tickets.loading || listings.scenarios.loading || libraryLoading
              ? "Reading this shop's incidents and the block libraries…"
              : tickets.length === 0
                ? "A scenario is built on a ticket, and this shop has none yet."
                : name.trim() === ""
                  ? "Give the scenario a name first."
                  : made === null && taken.includes(name.trim())
                    ? `${name.trim()} is the name of a scenario this shop already holds.`
                    : // A press while a template's draft is still coming would compose the
                      // payload without it: `run` reads `compose` from the render the press
                      // happened in, and the objective landing a moment later would be an
                      // answer on screen that never reaches the draft and registers nothing
                      // to prompt about (ADR 0051). Asked before the objectives check,
                      // because a page reading its first template has none yet and this is
                      // the truer reason.
                      reading.length > 0
                      ? "Reading what the template just composed declares…"
                      : // The select seeds itself from the first incident and offers no empty
                        // option, so this is the render between the listing landing and that
                        // effect committing — and the guard that keeps an empty `ticket_id` off
                        // the wire if either of those ever changes.
                        ticketId === ""
                        ? "Pick the incident this scenario is built on."
                        : objectives.length === 0
                          ? "Compose at least one objective — a run needs something to be scored against."
                          : undefined,
  );

  return (
    <CreatePage
      backTo={`/shops/${shopId}/scenarios`}
      backLabel="Scenarios"
      breadcrumb="creating a scenario"
      title={name}
      untitled="New scenario"
      standing={creating.standing}
      formId={formId}
      createLabel="Create scenario"
      creating={creating.busy}
      creatingLabel="Creating…"
      blockedBy={creating.blockedBy}
      error={
        creating.error ??
        composeError ??
        libraryError ??
        listings.tickets.error ??
        listings.scenarios.error
      }
    >
      <form id={formId} className="grid gap-4" onSubmit={creating.submit}>
        <Card
          title="Built on"
          footer={
            <p className="text-xs text-admin-muted">
              One ticket, plus the shop objects that ticket already links to. The customer and the
              shop version follow from it.
            </p>
          }
        >
          {tickets.length === 0 && !listings.tickets.loading && listings.tickets.error === null ? (
            <p className="text-[13px] text-admin-muted">
              A scenario is built on a ticket, and this shop has none yet.{" "}
              <Link className="font-semibold text-lab-ink" to={`/shops/${shopId}/tickets`}>
                Open an incident first.
              </Link>
            </p>
          ) : null}
          <FieldRows>
            <Field
              label="Name"
              hint="What the bench and every report will call it. A shop answers to one scenario of each name, so this one has to be free."
            >
              <input
                className={fieldControlClasses}
                value={name}
                required
                placeholder="Wrong shipping address"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field
              label="Ticket"
              // The prototype writes "Creating the scenario freezes the ticket at its current
              // version". Half of that is this lab's: `replace_scenario` refuses a ticket
              // change and the draft-write shape carries no ticket at all, and the ticket's
              // suggested documents are copied into the new scenario at creation. The version
              // is not — `ScenarioResolution.ticket_version` reads the ticket's latest
              // published version, and `publish_scenario` is what pins it. A hint names the
              // code that makes it true (`docs/design-direction.md`, *The form language*), so
              // it says which of the two happens when.
              hint="Fixed by creating: a scenario never moves off its ticket, and the documents this ticket suggests are copied into it now. Publishing the scenario is what pins the ticket version — whichever is published then."
              // The option is the bare reference and the composed label is here, under the
              // control, where the prototype draws it (`Workspace.dc.html`:2956).
              extra={ticket ? `${ticket.subject} · ${ticket.customer_display_name}` : undefined}
            >
              <select
                className={fieldControlClasses}
                value={ticketId}
                required
                disabled={creating.made !== null}
                onChange={(event) => setTicketId(event.target.value)}
              >
                {tickets.map((entry) => (
                  <option key={entry.ticket_id} value={entry.ticket_id}>
                    {entry.reference}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Customer"
              hint="The profile the incident is about. It follows the ticket, and a scenario that named a second one could contradict the thread it was built on."
            >
              {/* Not a control: derived from the ticket above, and the prototype draws a
                  derived row as a read-only box. */}
              <output className={readOnlyValueClasses}>
                {ticket?.customer_display_name ?? "—"}
              </output>
            </Field>
            <Field
              label="Shop version"
              hint="What this shop has published now. A run reads the shop the scenario's own published version pinned, so an unpublished shop is a recipe nothing can run yet."
            >
              <output className={readOnlyValueClasses}>{shopVersion}</output>
            </Field>
          </FieldRows>
        </Card>

        <Card title="Hidden facts">
          <ChipListField
            legend="Hidden facts"
            label="New hidden fact"
            hint="What is true in the world but not in the ticket. One per chip, saved as the scenario's operator-only prose, one to a line. Never shown to the support agent, never logged, and never traced — it steers whoever drives the customer."
            addLabel="Add fact"
            placeholder="Something true that the ticket does not say…"
            empty="No hidden fact yet."
            values={facts}
            maxLength={CHIP_LABEL_MAX_LENGTH}
            onChange={setFacts}
          />
        </Card>

        <Card
          title="Objectives"
          footer={
            <p className="text-xs text-admin-muted">
              At least one is required: it is what a run is scored against. Order is priority, not a
              script. Each one is bound to this shop's own objects in the editor, which is the only
              place the pickers can offer them.
            </p>
          }
        >
          <ComposeFromLibrary
            legend="Compose objectives"
            composedLabel="Composed objectives"
            blocks={library?.objectives ?? []}
            chosen={objectives}
            reading={reading}
            loading={libraryLoading}
            max={MAX_OBJECTIVES}
            atCapacity={`A scenario asserts at most ${MAX_OBJECTIVES} objectives.`}
            onToggle={(blockId) =>
              void toggleTemplate(blockId, objectives, setObjectives, objectiveBlocks)
            }
          />
        </Card>

        <Card
          title="Mutations"
          footer={
            <p className="text-xs text-admin-muted">
              Optional. Both arms always receive the identical schedule, so a difference in outcome
              stays the agent's. A mutation's trigger — when the runtime injects it — is bound in
              the editor beside whatever object it moves.
            </p>
          }
        >
          <ComposeFromLibrary
            legend="Compose mutations"
            composedLabel="Composed mutations"
            blocks={library?.mutations ?? []}
            chosen={mutations}
            reading={reading}
            loading={libraryLoading}
            max={MAX_MUTATIONS}
            atCapacity={`A scenario schedules at most ${MAX_MUTATIONS} mutations.`}
            onToggle={(blockId) =>
              void toggleTemplate(blockId, mutations, setMutations, mutationBlocks)
            }
          />
        </Card>

        <Card title="It starts as a draft">
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            Creating it opens the editor, where every binding is made, the context documents are
            chosen and what a resolved incident looks like is written. A draft can be edited freely;
            only a published scenario can be picked on the bench.
          </p>
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            What it will pin: ticket{" "}
            <span className="font-mono font-semibold">{ticket?.reference ?? "—"}</span>,{" "}
            {ticket?.customer_display_name ?? "—"} and shop {shopVersion}. Publishing the scenario
            is what freezes them, at whatever versions are published then.
          </p>
        </Card>
      </form>
    </CreatePage>
  );
}

/**
 * Compose one library row into the draft with the editor's own helper.
 *
 * Two things are skipped rather than guessed at. A block id the **listing** no longer answers
 * for: the libraries are cross-shop and a template can leave one while this page is open, and
 * an instance naming a block that is gone is the `template no longer in the library` state
 * the editor draws, which is not a thing a create should author from nothing. And a block
 * whose **parameters** were never read: composing it from an empty parameter list would give
 * it the strictest severity there is rather than the one its author chose (`libraryOption`).
 * Neither is reachable: `toggleTemplate` puts a chip down only once both are in hand, and the
 * unsaved-work prompt's own save composes through the same two lists and sees the same
 * invariant. They are defence, and they fail the safe way — dropping an entry the page could
 * not have built rather than building it from nothing.
 */
function composeInto(
  content: ScenarioContentSchema,
  blocks: readonly BlockSummarySchema[] | undefined,
  declared: Record<string, readonly BlockParameterSchema[]>,
  blockId: string,
  add: (
    content: ScenarioContentSchema,
    option: ReturnType<typeof libraryOption>,
  ) => ScenarioContentSchema,
): ScenarioContentSchema {
  const block = blocks?.find((entry) => entry.block_id === blockId);
  const parameters = declared[blockId];
  return block === undefined || parameters === undefined
    ? content
    : add(content, libraryOption(block, parameters));
}
