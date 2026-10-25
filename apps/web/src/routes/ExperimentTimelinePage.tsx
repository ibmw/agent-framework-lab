import type {
  ExperimentResponse,
  ExperimentRunSchema,
  ExperimentTimelineResponse,
  SourceLocationSchema,
  TimelineCategory,
  TimelineEntrySchema,
} from "@agent-lab/contracts";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { describeApiError } from "../api/client";
import { getExperimentTimeline } from "../api/experiments";
import { Card } from "../components/WorkspaceChrome";
import { breakable } from "../lib/breakable";
import { labelOf as enumLabel, TOOL_OUTCOME } from "../lib/enumLabels";
import { describeFailure, TOOL_MARK } from "../lib/evidence";
import { timelineAnchor } from "../lib/timelineAnchors";
import { chipClasses, filterChipStateClasses } from "../lib/ui";
import { useExperimentResults } from "./useExperimentResults";

const UNAVAILABLE = "This experiment's timeline is unavailable.";

/** The lenses of frame 9a, in the order the frame offers them. */
const LENSES: { category: TimelineCategory; label: string }[] = [
  { category: "customer", label: "Customer" },
  { category: "model", label: "Model" },
  { category: "tool", label: "Tools" },
  { category: "state", label: "State" },
  { category: "refusal", label: "Refusals" },
  { category: "error", label: "Errors" },
];

/**
 * What a scenario fault did, in the lab's words rather than the template's.
 *
 * The effect is the closed set the backend publishes, so this is a lookup rather than an
 * echo of anything an author typed: a mutation template's own prose is authored text, and
 * this stream is built to carry none.
 */
const EFFECTS: Record<string, string> = {
  entity_mutation: "moved the order it is bound to, out of band",
  tool_fault: "made a tool fail",
  clock_shift: "moved sandbox time forward",
  service_outage: "took a dependency offline",
};

/**
 * The execution timeline (frame 9a), the results screen's second depth tab.
 *
 * One ordered, framework-neutral stream for the whole experiment: the trigger both arms
 * opened on, every customer composition and the arms it reached, each arm's attempts, and
 * every tool call with what it did to that arm. The backend normalizes it — a framework's
 * own events have no route to this page — so what is rendered here is the lab's vocabulary
 * and nothing else.
 *
 * It carries no message body on purpose, which is why every row is a description built from
 * structural facts rather than an echo of what anyone said. The thread — on the bench, and on
 * the results' Conversation tab — is where the words live; this is where the order and the code
 * paths do.
 *
 * Each arm runs in its own lane, and the lanes share one clock: the customer composition, the
 * coordinate ADR 0027 gave both arms, drawn as a band per turn with what the customer said
 * across its top. Two arms' answers to one message therefore sit side by side, whatever depth
 * each arm had reached — a wall clock would have put them wherever their providers happened to
 * answer. A scenario fault sits in its arm's lane at the point it fired, between the calls it
 * came between.
 *
 * Every event carries an anchor built from its own coordinates (`timelineAnchor`), and a URL
 * that names one lands on it: scrolled to, focused, and marked in words as the event the
 * operator followed — the results matrices link each verdict to the call that decided it.
 *
 * The experiment itself comes from the results layout rather than from a read of its own:
 * depth is a tab on one screen, and a header that reloaded under the operator as they moved
 * between tabs would be a second reading of the run they are trying to follow.
 */
export function ExperimentTimelinePage() {
  const { shopId, experimentId, experiment } = useExperimentResults();
  const [timeline, setTimeline] = useState<ExperimentTimelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lenses, setLenses] = useState<TimelineCategory[]>([]);
  // The anchors are ASCII, so the fragment is read as written: decoding a hand-typed `#%`
  // would throw during render and take the page down with it.
  const target = useLocation().hash.slice(1);

  useEffect(() => {
    const controller = new AbortController();
    getExperimentTimeline(shopId, experimentId, controller.signal)
      .then(setTimeline)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(describeApiError(cause, UNAVAILABLE));
        }
      });
    return () => controller.abort();
  }, [shopId, experimentId]);

  if (timeline === null) {
    return error ? (
      <p role="alert" className="text-[13px] text-lab-error">
        {error}
      </p>
    ) : (
      <p className="text-sm text-admin-muted">Loading timeline…</p>
    );
  }

  const shown =
    lenses.length === 0
      ? timeline.entries
      : timeline.entries.filter((entry) =>
          entry.categories.some((category) => lenses.includes(category)),
        );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid min-w-0 content-start gap-4">
        <Card
          title="Execution timeline"
          footer={
            <p className="text-xs text-admin-muted">
              Normalized events: a framework's own payloads never enter this stream, and no message
              body does either. What was said is on the{" "}
              <Link className="font-semibold text-lab-ink" to="../conversation">
                Conversation
              </Link>{" "}
              tab; this is what happened.
            </p>
          }
        >
          <Lenses selected={lenses} onChange={setLenses} />
          {shown.length === 0 ? (
            <p className="text-[13px] text-admin-muted">No event matches this lens yet.</p>
          ) : (
            <Lanes
              entries={shown}
              experiment={experiment}
              target={target}
              filtered={lenses.length > 0}
            />
          )}
        </Card>
      </div>

      <div className="grid content-start gap-4">
        <CodePaths entries={timeline.entries} />

        <Card
          title="Arms"
          footer={
            <p className="text-xs text-admin-muted">
              Each arm ran the framework and model its published configuration named, not whichever
              this lab happens to be configured for now.
            </p>
          }
        >
          <ul className="grid gap-2 text-[13px]">
            {experiment.runs.map((run) => (
              <li key={run.run_id} className="grid gap-0.5">
                <span className="font-semibold text-lab-ink">{run.label}</span>
                <span className="text-xs text-admin-muted">
                  {run.framework_id} · {run.model_id}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

/** The category filter: nothing selected means every event, as the frame's "All events" is. */
function Lenses({
  selected,
  onChange,
}: {
  selected: TimelineCategory[];
  onChange: (next: TimelineCategory[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        className={lensClasses(selected.length === 0)}
        type="button"
        aria-pressed={selected.length === 0}
        onClick={() => onChange([])}
      >
        All events
      </button>
      {LENSES.map((lens) => {
        const active = selected.includes(lens.category);
        return (
          <button
            key={lens.category}
            className={lensClasses(active)}
            type="button"
            aria-pressed={active}
            onClick={() =>
              onChange(
                active
                  ? selected.filter((category) => category !== lens.category)
                  : [...selected, lens.category],
              )
            }
          >
            {lens.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A lens is drawn as the workspace's filter chip: the selected one on the refresh's chip ground
 * and the others plain, so which lenses are on is seen and not only announced.
 */
function lensClasses(active: boolean): string {
  return active ? filterChipStateClasses.selected : filterChipStateClasses.unselected;
}

/** One band of the shared clock: a customer composition and what each arm did with it. */
interface Band {
  step: number;
  customer: TimelineEntrySchema | null;
  lanes: Map<string, TimelineEntrySchema[]>;
}

function bandsOf(entries: TimelineEntrySchema[]): Band[] {
  const bands = new Map<number, Band>();
  for (const entry of entries) {
    const band = bands.get(entry.step) ?? { step: entry.step, customer: null, lanes: new Map() };
    bands.set(entry.step, band);
    if (entry.kind === "trigger" || entry.kind === "customer_turn") {
      band.customer = entry;
      continue;
    }
    // An arm's own event names that arm alone; the stream's order is kept inside the lane.
    for (const runId of entry.run_ids) {
      band.lanes.set(runId, [...(band.lanes.get(runId) ?? []), entry]);
    }
  }
  return [...bands.values()].sort((left, right) => left.step - right.step);
}

/**
 * The arms in lanes on one clock: a band per turn, the arms side by side inside it.
 *
 * Desktop first: the lanes are columns from `md` up and stack beneath each other narrower,
 * each still named by its arm, so a phone reads one arm's turn and then the other's.
 */
function Lanes({
  entries,
  experiment,
  target,
  filtered,
}: {
  entries: TimelineEntrySchema[];
  experiment: ExperimentResponse;
  target: string;
  filtered: boolean;
}) {
  const runs = experiment.runs;
  const lanes = { "--lanes": runs.length } as CSSProperties;
  const laneGrid = "grid gap-3 md:grid-cols-[repeat(var(--lanes),minmax(0,1fr))] md:gap-4";
  return (
    <div className="grid gap-3">
      <div aria-hidden="true" className={`hidden ${laneGrid} md:grid`} style={lanes}>
        {runs.map((run) => (
          <p
            key={run.run_id}
            className="border-b-2 border-admin-border pb-1 text-[11px] font-semibold uppercase tracking-wide text-admin-muted"
          >
            {run.label} · {run.framework_id} · {run.model_id}
          </p>
        ))}
      </div>
      {bandsOf(entries).map((band) => {
        const turn = `Turn ${band.step + 1}`;
        return (
          <section
            key={band.step}
            aria-label={turn}
            className="grid gap-2 rounded-[10px] border border-admin-border bg-admin-canvas p-3"
          >
            <h3 className="text-xs font-bold text-admin-ink">{turn}</h3>
            {band.customer ? (
              <ol className="grid gap-2">
                <Row
                  entry={band.customer}
                  experiment={experiment}
                  target={target}
                  className="border-b border-admin-border/60 px-1 pb-2"
                />
              </ol>
            ) : null}
            <div className={laneGrid} style={lanes}>
              {runs.map((run) => {
                const own = band.lanes.get(run.run_id) ?? [];
                const heard = band.customer === null || band.customer.run_ids.includes(run.run_id);
                const name = `${run.label}, ${turn.toLowerCase()}`;
                return (
                  <div key={run.run_id} className="grid min-w-0 content-start gap-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-admin-muted md:sr-only">
                      {run.label}
                    </p>
                    {own.length === 0 ? (
                      <p className="text-[12px] text-admin-muted">
                        {!heard
                          ? "Never received this turn."
                          : filtered
                            ? "Nothing under this lens."
                            : "Nothing recorded yet."}
                      </p>
                    ) : (
                      <ol aria-label={name} className="grid gap-2">
                        {own.map((entry) => (
                          <Row
                            key={entryKey(entry)}
                            entry={entry}
                            experiment={experiment}
                            target={target}
                            className="rounded-lg border border-admin-border bg-admin-surface px-2.5 py-2"
                          />
                        ))}
                      </ol>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * One event: which arms it belongs to, what it was, and where the lab's code ran.
 *
 * The event a followed link names is focused and scrolled to, and says so in words beside a
 * heavier outline — the mark is never its colour alone.
 */
function Row({
  entry,
  experiment,
  target,
  className,
}: {
  entry: TimelineEntrySchema;
  experiment: ExperimentResponse;
  target: string;
  className: string;
}) {
  const anchor = timelineAnchor(entry);
  const landed = anchor === target;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (landed) {
      ref.current?.focus({ preventScroll: true });
      ref.current?.scrollIntoView?.({ block: "center" });
    }
  }, [landed]);
  const arms = entry.run_ids.map((runId) => labelOf(experiment.runs, runId));
  const split = entry.kind === "customer_turn" && entry.run_ids.length < experiment.runs.length;
  return (
    <li
      id={anchor}
      ref={ref}
      tabIndex={landed ? -1 : undefined}
      aria-current={landed ? "location" : undefined}
      className={`grid scroll-mt-40 gap-1 outline-none ${className} ${
        landed ? "ring-2 ring-lab-primary ring-offset-2" : ""
      }`}
    >
      <p className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-admin-muted">
        <span>{arms.join(" · ")}</span>
        {split ? <span className={`${chipClasses.mark} normal-case`}>this arm only</span> : null}
        {entry.kind === "mutation" ? (
          <span className={`${chipClasses.mark} normal-case`}>scenario fault</span>
        ) : null}
        {landed ? (
          <span className={`${chipClasses.mark} normal-case`}>the event you followed</span>
        ) : null}
      </p>
      <p className="text-[13px] leading-relaxed text-admin-ink">
        {/* The outcome's glyph beside its word, as the thread and the traces draw it, so a
            refusal is never told by its word alone. */}
        {entry.kind === "tool_call" && entry.tool_outcome !== null ? (
          <span aria-hidden="true">{`${TOOL_MARK[entry.tool_outcome]} `}</span>
        ) : null}
        {describe(entry)}
      </p>
      {entry.source ? <Source location={entry.source} /> : null}
    </li>
  );
}

function Source({ location }: { location: SourceLocationSchema }) {
  return (
    <p className="font-mono text-[11px] [overflow-wrap:anywhere] text-admin-muted">
      {breakable(`${location.path}:${location.line} · ${location.symbol}`)}
    </p>
  );
}

/**
 * Every project-owned location this experiment executed, with how often it was reached.
 *
 * Derived from the stream rather than fetched: the locations are already on the events that
 * reached them, so a separate listing could only ever disagree with the timeline beside it.
 */
function CodePaths({ entries }: { entries: TimelineEntrySchema[] }) {
  const counted = new Map<string, { location: SourceLocationSchema; calls: number }>();
  for (const entry of entries) {
    if (entry.source === null) {
      continue;
    }
    const key = `${entry.source.path}:${entry.source.symbol}`;
    const seen = counted.get(key);
    counted.set(key, { location: entry.source, calls: (seen?.calls ?? 0) + 1 });
  }
  const paths = [...counted.values()].sort((left, right) => right.calls - left.calls);
  return (
    <Card
      title="Executed project code"
      footer={
        <p className="text-xs text-admin-muted">
          Resolved from the recorded events, never from a map kept by hand. A framework's own
          internals are deliberately absent: they are not this project's to explain.
        </p>
      }
    >
      {paths.length === 0 ? (
        <p className="text-[13px] text-admin-muted">Nothing has run yet.</p>
      ) : (
        <ul className="grid gap-2 text-[13px]">
          {paths.map(({ location, calls }) => (
            <li key={`${location.path}:${location.symbol}`} className="grid gap-0.5">
              <span className="font-semibold text-lab-ink [overflow-wrap:anywhere]">
                {breakable(location.symbol)}
              </span>
              <span className="font-mono text-[11px] [overflow-wrap:anywhere] text-admin-muted">
                {breakable(`${location.path}:${location.line}`)} · {calls}{" "}
                {calls === 1 ? "call" : "calls"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * One event in words, built from what the record says rather than from what anyone wrote.
 *
 * Every branch reads structural fields only. That is what keeps the promise the endpoint
 * makes: a page that had to echo a message here would have needed one in the contract.
 */
function describe(entry: TimelineEntrySchema): string {
  if (entry.kind === "trigger") {
    return "The ticket's triggering message opened every arm.";
  }
  if (entry.kind === "customer_turn") {
    return "The customer sent a message.";
  }
  if (entry.kind === "mutation") {
    const effect = EFFECTS[entry.mutation_effect ?? ""] ?? "changed this arm's world";
    return `The scenario's ${entry.mutation ?? "fault"} fired: it ${effect}${movement(entry)}.`;
  }
  if (entry.kind === "agent_turn") {
    const attempt = entry.attempt === null ? "" : ` (attempt ${entry.attempt})`;
    if (entry.turn_outcome === "answered") {
      return `The agent replied${attempt}.`;
    }
    return `The attempt produced no reply${attempt}: ${describeFailure(entry.failure)}.`;
  }
  // One entry shape serves five kinds, so every field below is optional in the contract even
  // though a tool call always fills them. Falling back keeps a malformed entry readable
  // instead of rendering the word "null" at an operator, which is what the branches above do.
  const call = [entry.tool, entry.tool_version].filter(Boolean).join(" ");
  const outcome =
    entry.tool_outcome === null
      ? "no recorded outcome"
      : enumLabel(TOOL_OUTCOME, entry.tool_outcome);
  return `${call || "an unnamed tool call"} → ${outcome}${movement(entry)}`;
}

/** The revisions an entry moved this arm through, or nothing when it moved none. */
function movement(entry: TimelineEntrySchema): string {
  return entry.revision_after !== null &&
    entry.revision_before !== null &&
    entry.revision_after > entry.revision_before
    ? ` · moved this arm r${entry.revision_before} → r${entry.revision_after}`
    : "";
}

function labelOf(runs: ExperimentRunSchema[], runId: string): string {
  return runs.find((run) => run.run_id === runId)?.label ?? "Unknown arm";
}

function entryKey(entry: TimelineEntrySchema): string {
  return [
    entry.step,
    entry.kind,
    entry.run_ids.join("+"),
    entry.attempt ?? "-",
    entry.sequence ?? "-",
  ].join(":");
}
