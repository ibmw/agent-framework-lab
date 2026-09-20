import type { ScenarioSummarySchema, TicketSummarySchema } from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { describeApiError } from "../api/client";
import { createScenario, listScenarios } from "../api/scenarios";
import { listTickets } from "../api/tickets";
import { ButtonIcon } from "../components/ButtonIcon";
import { FieldHint } from "../components/FieldHint";
import { type FilterChipDefinition, FilterChips, filterList } from "../components/FilterChips";
import { TourLaunch } from "../components/TourLaunch";
import { Card, PageHeader } from "../components/WorkspaceChrome";
import {
  accentButtonClasses,
  fieldControlClasses,
  formatTimestamp,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/ShopWorkspace";

const UNAVAILABLE = "The scenario workspace is unavailable.";

/**
 * The Studio's scenario index (the rail's "All scenarios").
 *
 * A scenario is created on a ticket and never moves off it, so the create form's only real
 * choice is which incident to build on — the name is the index's own key.
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
  const { shopId } = useShopWorkspace();
  const [scenarios, setScenarios] = useState<ScenarioSummarySchema[]>([]);
  const [tickets, setTickets] = useState<TicketSummarySchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const [scenarioList, ticketList] = await Promise.all([
        listScenarios(shopId, signal),
        listTickets(shopId, signal),
      ]);
      setScenarios(scenarioList.scenarios);
      setTickets(ticketList.tickets);
      setLoadError(null);
    },
    [shopId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    reload(controller.signal)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(describeApiError(cause, UNAVAILABLE));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [reload]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setFormError(null);
    try {
      await createScenario(shopId, { name, ticket_id: ticketId });
      setName("");
    } catch (cause: unknown) {
      setFormError(describeApiError(cause, "The scenario could not be created."));
      setCreating(false);
      return;
    }
    try {
      await reload();
    } catch (cause: unknown) {
      setLoadError(describeApiError(cause, UNAVAILABLE));
    } finally {
      setCreating(false);
    }
  }

  const { chips, visible } = filterList(scenarios, FILTERS, filter);

  return (
    <>
      <PageHeader
        title="Scenarios"
        description="An experiment recipe: one ticket, the documents that matter for it, the objectives it is judged by, and the faults the runtime injects."
        actions={<TourLaunch id="scenarios" />}
      />

      {loadError ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {loadError}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={`${surfaceClasses} overflow-hidden`}>
          {/* Only once there are rows to count. A chip is a filter, and a row of zeros over
              "Loading…" — or over a listing that failed — filters nothing and answers nothing;
              it is the stat band this slice exists to avoid, drawn at its least useful moment.
              The row arrives with the table it belongs to. */}
          {loading || loadError ? null : (
            <FilterChips
              legend="Filter scenarios"
              chips={chips}
              selected={filter}
              onSelect={setFilter}
            />
          )}
          {loading ? (
            <p className="p-4 text-[13px] text-admin-muted">Loading scenarios…</p>
          ) : scenarios.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">
              No scenario yet. Build one on a ticket to turn the incident into an experiment.
            </p>
          ) : visible.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">No scenario matches this filter.</p>
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
                        <div className="text-admin-muted">
                          {scenario.mutation_count} mutation(s)
                        </div>
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

        <Card title="New scenario">
          {tickets.length === 0 ? (
            <p className="text-[13px] text-admin-muted">
              A scenario is built on a ticket, and this shop has none yet.{" "}
              <Link className="font-semibold text-lab-ink" to="../tickets">
                Open an incident first.
              </Link>
            </p>
          ) : (
            <form className="grid gap-3" onSubmit={submit}>
              <FieldHint label="Name" hint="How this scenario is listed.">
                <input
                  className={fieldControlClasses}
                  value={name}
                  required
                  placeholder="Wrong shipping address"
                  onChange={(event) => setName(event.target.value)}
                />
              </FieldHint>
              <FieldHint
                label="Built on ticket"
                hint="Fixed here. Context, bindings, and hidden facts all describe this incident."
              >
                <select
                  className={fieldControlClasses}
                  value={ticketId}
                  required
                  onChange={(event) => setTicketId(event.target.value)}
                >
                  <option value="">Select a ticket</option>
                  {tickets.map((ticket) => (
                    <option key={ticket.ticket_id} value={ticket.ticket_id}>
                      {ticket.reference} — {ticket.subject}
                    </option>
                  ))}
                </select>
              </FieldHint>
              {formError ? (
                <p role="alert" className="text-[13px] text-lab-error">
                  {formError}
                </p>
              ) : null}
              <button className={accentButtonClasses} type="submit" disabled={creating}>
                <ButtonIcon verb="save" />
                {creating ? "Creating…" : "Create scenario"}
              </button>
              <p className="text-xs text-admin-muted">
                The ticket is fixed here and never moves: the context, bindings, and hidden facts
                all describe the incident it was built on. The ticket's suggested documents pre-fill
                the new scenario's context.
              </p>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}
