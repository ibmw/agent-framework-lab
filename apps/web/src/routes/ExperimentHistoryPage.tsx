import type { ExperimentHistoryEntrySchema, ExperimentHistoryResponse } from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { describeApiError } from "../api/client";
import { forkExperiment, listExperimentHistory, replayExperiment } from "../api/experiments";
import { ButtonIcon } from "../components/ButtonIcon";
import { PageHeader } from "../components/WorkspaceChrome";
import { OUTCOMES } from "../lib/evidence";
import {
  fieldControlClasses,
  fieldLabelClasses,
  formatTimestamp,
  subtleButtonClasses,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";
import { NoCurrentShop, useLabWorkspace } from "../shell/LabWorkspace";

const UNAVAILABLE = "Experiment history is unavailable.";
const PAGE_SIZE = 20;

/** What each status means, in the words the reading behind it is made of. */
const STATUSES: Record<ExperimentHistoryEntrySchema["status"], { label: string; tone: string }> = {
  running: { label: "Running", tone: "bg-admin-draft text-admin-draft-ink" },
  completed: { label: "Completed", tone: "bg-admin-published text-admin-published-ink" },
  failed: { label: "Failed", tone: "bg-lab-error/15 text-lab-error" },
};

/**
 * The date filters, as the spans an operator actually asks for.
 *
 * Held as a number of days rather than as a computed instant so the URL stays what the
 * operator chose: a link to "the last 30 days" shared tomorrow means the last 30 days from
 * tomorrow, not a frozen window that quietly stops moving.
 */
const SPANS: { value: string; label: string; days: number | null }[] = [
  { value: "", label: "Any time", days: null },
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
];

/** A URL value if the contract publishes it, and nothing if it does not. */
function oneOf<Value extends string>(value: string | null, allowed: readonly Value[]): Value | "" {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as Value) : "";
}

/** The keys of a closed vocabulary, keeping the type the record was declared with. */
function keysOf<Key extends string>(table: Record<Key, unknown>): Key[] {
  return Object.keys(table) as Key[];
}

/** The page a URL asks for, as a page: a whole number, at least one. */
function pageIn(value: string | null): number {
  const asked = Number(value);
  return Number.isSafeInteger(asked) && asked >= 1 ? asked : 1;
}

function startedAfter(span: string): string | undefined {
  const days = SPANS.find((entry) => entry.value === span)?.days ?? null;
  if (days === null) {
    return undefined;
  }
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Frame 10 — experiment history: every run this lab has made, narrowed.
 *
 * Experiment-first rather than persona- or conversation-first: the row is one experiment,
 * its arms are what ran, and the counts beside them are each arm's own. Every value here is
 * served by the history contract, which projects it from the same record the bench and the
 * results screen read — this page derives nothing, and in particular adds no arm's count to
 * another's (ADR 0034).
 *
 * The filters live in the URL because a finding is worth sharing at the narrowing it was
 * found in, exactly as the results screen's depth tabs are links (ADR 0033).
 */
export function ExperimentHistoryPage() {
  const [params, setParams] = useSearchParams();
  const [listing, setListing] = useState<ExperimentHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deriving, setDeriving] = useState<string | null>(null);
  const navigate = useNavigate();
  // History is cross-shop by design (ADR 0034) and stays so: the lab's current shop narrows
  // nothing here, and the filter below is URL-backed rather than seeded from a preference (ADR
  // 0033). What the notice reports is therefore the lab's state and never this list's — which
  // is why its words say what the top bar's switcher holds and what this filter does with it,
  // and say nothing about how many runs are on screen. This notice renders on the lab's shop
  // alone, and the list is narrowed by the URL alone; a sentence that mixed the two would be
  // false at `?shop=…`, which is the state people actually share (ADR 0054).
  const lab = useLabWorkspace();
  const labShopMissing = !lab.loading && lab.currentShop === null;
  // The switcher clause is true only where the switcher is drawn, and the top bar draws it
  // from the same fact: a lab with shops (`AppShell`). A lab whose list is empty or whose list
  // failed reaches this notice too, and pointing those readers at a control that is not on
  // screen is the one thing the notice must never do. What stays true of every state is the
  // second half — this filter follows the lab's shop in no state at all.
  const aboutTheTopBar =
    lab.shops.length > 0
      ? "the shop switcher in the top bar names none, and this filter does not follow it"
      : "the top bar has no shop to name, and this filter does not follow the lab's shop either";

  /**
   * Derive a new experiment from a row and open the evidence it produced.
   *
   * The derived arms are actually run before the answer comes back, so the row says so
   * while it waits. It navigates rather than refreshing the listing: what came back is a
   * different run, and the reason to replay one is to read what it did.
   */
  const replay = useCallback(
    async (experiment: ExperimentHistoryEntrySchema) => {
      setDeriving(experiment.experiment_id);
      setError(null);
      try {
        const derived = await replayExperiment(experiment.shop_id, experiment.experiment_id);
        navigate(`/lab/bench/${experiment.shop_id}/${derived.experiment_id}/results`);
      } catch (cause: unknown) {
        setError(describeApiError(cause, "This experiment could not be replayed."));
      } finally {
        setDeriving(null);
      }
    },
    [navigate],
  );

  /**
   * Fork a row onto the newest published version of every arm's configuration.
   *
   * The row's action takes no choice, which is the difference between it and the results
   * header's: the legend on the frame says "fork with newer versions", and that is one
   * decision an operator can make from a listing. Choosing a *different* configuration is a
   * question about one run, and it is asked on the screen that holds that run's evidence.
   *
   * Offered only where something is newer, because a fork that changes nothing is refused
   * by the backend — a button that can only fail is worse than one that is not there.
   */
  const fork = useCallback(
    async (experiment: ExperimentHistoryEntrySchema) => {
      setDeriving(experiment.experiment_id);
      setError(null);
      try {
        const derived = await forkExperiment(experiment.shop_id, experiment.experiment_id, {
          arms: experiment.arms.map((arm) => ({
            configuration_id: arm.agent_configuration_id,
            version: arm.agent_configuration_latest_version ?? arm.agent_configuration_version,
          })),
        });
        navigate(`/lab/bench/${experiment.shop_id}/${derived.experiment_id}/results`);
      } catch (cause: unknown) {
        setError(describeApiError(cause, "This experiment could not be forked."));
      } finally {
        setDeriving(null);
      }
    },
    [navigate],
  );

  const shopId = params.get("shop") ?? "";
  const scenarioId = params.get("scenario") ?? "";
  const frameworkId = params.get("framework") ?? "";
  const tag = params.get("tag") ?? "";
  // The closed vocabularies are checked against the values the contract actually publishes:
  // a URL is typed by anyone, and a filter the backend would refuse should narrow nothing
  // rather than turn a shared link into an error page.
  const status = oneOf(params.get("status"), keysOf(STATUSES));
  const outcome = oneOf(params.get("outcome"), keysOf(OUTCOMES));
  const span = oneOf(
    params.get("span"),
    SPANS.map((entry) => entry.value),
  );
  const query = params.get("q") ?? "";
  const page = pageIn(params.get("page"));
  const [search, setSearch] = useState(query);

  // The text box is the one filter that is not applied as it is typed: a request per
  // keystroke would read the whole lab on the way to a word nobody finished.
  useEffect(() => setSearch(query), [query]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    listExperimentHistory(
      {
        shop_id: shopId,
        scenario_id: scenarioId,
        framework_id: frameworkId,
        tag,
        status,
        outcome,
        started_after: startedAfter(span),
        q: query,
        page,
        page_size: PAGE_SIZE,
      },
      controller.signal,
    )
      .then((body) => {
        setListing(body);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(describeApiError(cause, UNAVAILABLE));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [shopId, scenarioId, frameworkId, tag, status, outcome, span, query, page]);

  function set(key: string, value: string, resetPage: boolean) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value === "") {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      if (resetPage) {
        next.delete("page");
      }
      return next;
    });
  }

  /** Narrowing always returns to the first page: page 4 of another filter is not a page. */
  function narrow(key: string, value: string) {
    set(key, value, true);
  }

  function turnTo(target: number) {
    set("page", String(target), false);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    narrow("q", search.trim());
  }

  // The footer counts the page the *answer* is of, never the one the URL asked for: the
  // backend clamps what it was sent, and a range read off an unclamped number would describe
  // a page nobody was served.
  const total = listing?.total ?? 0;
  const shown = listing?.page ?? page;
  const size = listing?.page_size ?? PAGE_SIZE;
  const first = total === 0 ? 0 : (shown - 1) * size + 1;
  const last = Math.min(shown * size, total);
  const pages = Math.max(1, Math.ceil(total / size));

  return (
    <>
      <PageHeader
        title="Experiment history"
        description="Every run this lab has made, across every shop. Each row keeps the exact published versions it pinned, the starting state it froze, and what each arm's own record says — never a score across arms."
      />

      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      {/* Each control names itself. A select wrapped in a label takes its accessible name
          from the whole label, options included, so "Framework" was announced — and matched
          by tests — as "Framework All frameworks Deterministic fake …". */}
      <form
        aria-label="Narrow history"
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={submitSearch}
      >
        <label className={`${fieldLabelClasses} min-w-64 flex-1`}>
          Search
          <input
            aria-label="Search"
            className={fieldControlClasses}
            placeholder="Name, scenario, shop, configuration, tag, or note…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button className={subtleButtonClasses} type="submit">
          Search
        </button>
        <label className={fieldLabelClasses}>
          Shop
          <select
            aria-label="Shop"
            className={fieldControlClasses}
            value={shopId}
            onChange={(event) => narrow("shop", event.target.value)}
          >
            <option value="">All shops</option>
            {(listing?.shops ?? []).map((facet) => (
              <option key={facet.id} value={facet.id}>
                {facet.label}
              </option>
            ))}
          </select>
        </label>
        {labShopMissing ? (
          <div className="basis-full">
            <NoCurrentShop what={aboutTheTopBar} />
          </div>
        ) : null}
        <label className={fieldLabelClasses}>
          Scenario
          <select
            aria-label="Scenario"
            className={fieldControlClasses}
            value={scenarioId}
            onChange={(event) => narrow("scenario", event.target.value)}
          >
            <option value="">All scenarios</option>
            {(listing?.scenarios ?? []).map((facet) => (
              <option key={facet.id} value={facet.id}>
                {facet.label}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldLabelClasses}>
          Framework
          <select
            aria-label="Framework"
            className={fieldControlClasses}
            value={frameworkId}
            onChange={(event) => narrow("framework", event.target.value)}
          >
            <option value="">All frameworks</option>
            {(listing?.frameworks ?? []).map((facet) => (
              <option key={facet.id} value={facet.id}>
                {facet.label}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldLabelClasses}>
          Tag
          <select
            aria-label="Tag"
            className={fieldControlClasses}
            value={tag}
            onChange={(event) => narrow("tag", event.target.value)}
          >
            <option value="">All tags</option>
            {(listing?.tags ?? []).map((facet) => (
              <option key={facet.id} value={facet.id}>
                {facet.label}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldLabelClasses}>
          Status
          <select
            aria-label="Status"
            className={fieldControlClasses}
            value={status}
            onChange={(event) => narrow("status", event.target.value)}
          >
            <option value="">Any status</option>
            {Object.entries(STATUSES).map(([value, meaning]) => (
              <option key={value} value={value}>
                {meaning.label}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldLabelClasses}>
          Objective outcome
          <select
            aria-label="Objective outcome"
            className={fieldControlClasses}
            value={outcome}
            onChange={(event) => narrow("outcome", event.target.value)}
          >
            <option value="">Any outcome</option>
            {Object.entries(OUTCOMES).map(([value, meaning]) => (
              <option key={value} value={value}>
                {meaning.label}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldLabelClasses}>
          Started
          <select
            aria-label="Started"
            className={fieldControlClasses}
            value={span}
            onChange={(event) => narrow("span", event.target.value)}
          >
            {SPANS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      </form>

      <section
        aria-label="Experiment history"
        // The rows of the previous narrowing stay on screen while the next one is read, so
        // the section says it is busy rather than looking settled on a stale answer.
        aria-busy={loading}
        className={`${surfaceClasses} overflow-hidden ${loading && listing !== null ? "opacity-60" : ""}`}
      >
        {loading && listing === null ? (
          <p className="p-4 text-[13px] text-admin-muted">Loading experiments…</p>
        ) : total === 0 ? (
          <p className="p-4 text-[13px] text-admin-muted">
            No experiment matches these filters. Every run this lab makes stays here with the
            versions it pinned.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={tableHeadClasses}>Experiment</th>
                  <th className={tableHeadClasses}>Scenario</th>
                  <th className={tableHeadClasses}>Arms</th>
                  <th className={tableHeadClasses}>Objectives</th>
                  <th className={tableHeadClasses}>Status</th>
                  <th className={tableHeadClasses}>Started</th>
                  <th className={tableHeadClasses}>Quick actions</th>
                </tr>
              </thead>
              <tbody>
                {(listing?.experiments ?? []).map((experiment) => (
                  <HistoryRow
                    key={experiment.experiment_id}
                    experiment={experiment}
                    onReplay={replay}
                    onFork={fork}
                    deriving={deriving === experiment.experiment_id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-admin-border px-4 py-3">
            <p className="text-xs text-admin-muted">
              Showing {first}–{last} of {total}
            </p>
            <div className="ml-auto flex items-center gap-2">
              <button
                className={subtleButtonClasses}
                type="button"
                disabled={shown <= 1}
                onClick={() => turnTo(shown - 1)}
              >
                Previous
              </button>
              <span className="text-xs text-admin-muted">
                Page {shown} of {pages}
              </span>
              <button
                className={subtleButtonClasses}
                type="button"
                disabled={shown >= pages}
                onClick={() => turnTo(shown + 1)}
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}

function HistoryRow({
  experiment,
  onReplay,
  onFork,
  deriving,
}: {
  experiment: ExperimentHistoryEntrySchema;
  onReplay: (experiment: ExperimentHistoryEntrySchema) => void;
  onFork: (experiment: ExperimentHistoryEntrySchema) => void;
  deriving: boolean;
}) {
  const bench = `/lab/bench/${experiment.shop_id}/${experiment.experiment_id}`;
  const meaning = STATUSES[experiment.status];
  // What the row's fork would actually move. Nothing newer anywhere is nothing to fork onto.
  const newer = experiment.arms.some(
    (arm) =>
      arm.agent_configuration_latest_version !== null &&
      arm.agent_configuration_latest_version > arm.agent_configuration_version,
  );
  return (
    <tr>
      <td className={tableCellClasses}>
        <Link
          className="font-semibold text-lab-ink underline-offset-2 hover:underline"
          to={`${bench}/results`}
        >
          {experiment.label}
        </Link>
        <p className="text-xs text-admin-muted">{experiment.shop_name}</p>
        {experiment.derived_from ? (
          // Provenance rather than a status: a derived run is an experiment like any other,
          // and this is what says the two rows sharing a fingerprint are related. The kind
          // is the word, because "replay of" and "fork of" are not the same sentence.
          <p className="text-xs text-admin-muted">
            {experiment.derived_from.kind} of{" "}
            <Link
              className="text-lab-ink underline-offset-2 hover:underline"
              to={`/lab/bench/${experiment.shop_id}/${experiment.derived_from.experiment_id}/results`}
            >
              {experiment.derived_from.label}
            </Link>
          </p>
        ) : null}
      </td>
      <td className={tableCellClasses}>
        {experiment.scenario_name}
        <p className="text-xs text-admin-muted">
          v{experiment.scenario_version}
          {experiment.scenario_superseded ? (
            // Provenance, not a warning: this run is still reproducible from what it pinned.
            <span className="ml-1.5 text-admin-draft-ink">· newer versions exist</span>
          ) : null}
        </p>
      </td>
      <td className={tableCellClasses}>
        <ul className="grid gap-1">
          {experiment.arms.map((arm) => (
            <li key={arm.run_id}>
              <span className="font-semibold">{arm.label}</span> · {arm.agent_configuration_name} v
              {arm.agent_configuration_version}
              {arm.agent_configuration_latest_version !== null &&
              arm.agent_configuration_latest_version > arm.agent_configuration_version ? (
                // Provenance beside the recipe's own: this run stays explained by what it
                // pinned, and this is what says there is a newer arm to fork it onto.
                <span className="text-admin-draft-ink">
                  {" "}
                  · v{arm.agent_configuration_latest_version} published
                </span>
              ) : null}
              <span className="text-admin-muted"> · {arm.framework_label}</span>
            </li>
          ))}
        </ul>
      </td>
      <td className={tableCellClasses}>
        <ul className="grid gap-1">
          {experiment.arms.map((arm) => (
            <li key={arm.run_id}>
              {/* Each arm out of what was decided for it — never added to the arm beside it. */}
              <span className="font-semibold">{arm.label}</span> {arm.met}/{arm.decided} decided
              {arm.failed ? (
                <span className="ml-1.5 text-lab-error">· missed a requirement</span>
              ) : null}
            </li>
          ))}
        </ul>
      </td>
      <td className={tableCellClasses}>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${meaning.tone}`}
        >
          {meaning.label}
        </span>
        {/* What an operator wrote, which is the one thing on a row the run did not produce.
            The tags because they are what this listing narrows by, and the notes as a count
            because a note reads as itself only beside the evidence it was written about. */}
        {experiment.tags.length > 0 || experiment.note_count > 0 ? (
          <p className="mt-1 flex flex-wrap items-center gap-1">
            {experiment.tags.map((entry) => (
              <span
                key={entry}
                className="rounded-full border border-admin-border px-2 py-0.5 text-[11px] text-admin-ink"
              >
                {entry}
              </span>
            ))}
            {experiment.note_count > 0 ? (
              <span className="text-[11px] text-admin-muted">
                {experiment.note_count} note{experiment.note_count === 1 ? "" : "s"}
              </span>
            ) : null}
          </p>
        ) : null}
      </td>
      <td className={tableCellClasses}>{formatTimestamp(experiment.created_at)}</td>
      <td className={tableCellClasses}>
        <div className="grid gap-1">
          <Link className="text-lab-ink underline-offset-2 hover:underline" to={`${bench}/results`}>
            View evidence
          </Link>
          <Link className="text-lab-ink underline-offset-2 hover:underline" to={bench}>
            Open live bench
          </Link>
          <button
            className="flex items-start gap-1.5 text-left text-lab-ink underline-offset-2 hover:underline"
            type="button"
            disabled={deriving}
            onClick={() => onReplay(experiment)}
          >
            <ButtonIcon verb="rerun" />
            {deriving ? "Deriving…" : "Replay recorded versions"}
          </button>
          <button
            className="flex items-start gap-1.5 text-left text-lab-ink underline-offset-2 hover:underline disabled:text-admin-muted disabled:no-underline"
            type="button"
            disabled={deriving || !newer}
            // Described rather than titled: a browser does not reliably show a `title` on a
            // disabled control, so the reason a row cannot be forked is real text that a
            // screen reader announces with the button.
            aria-describedby={newer ? undefined : `${experiment.experiment_id}-fork-reason`}
            onClick={() => onFork(experiment)}
          >
            <ButtonIcon verb="fork" />
            {deriving ? "Deriving…" : "Fork with newer versions"}
          </button>
          {newer ? null : (
            <span id={`${experiment.experiment_id}-fork-reason`} className="sr-only">
              Every arm already runs the newest published version of its configuration, and a
              derivation that changes nothing is a replay.
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
