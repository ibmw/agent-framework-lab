import type {
  ExperimentTracesResponse,
  RunTraceSchema,
  RunTraceSpanSchema,
} from "@agent-lab/contracts";
import { useEffect, useMemo, useState } from "react";
import { describeApiError } from "../api/client";
import { getExperimentTraces } from "../api/experiments";
import { Card } from "../components/WorkspaceChrome";
import { describeFailure } from "../lib/evidence";
import { subtleButtonClasses } from "../lib/ui";
import { useExperimentResults } from "./ExperimentResultsLayout";

const UNAVAILABLE = "This experiment's traces are unavailable.";

/** What each kind of span is, in the lab's words rather than a framework's. */
const KINDS: Record<RunTraceSpanSchema["kind"], string> = {
  attempt: "run.turn",
  runtime: "agent.answer",
  tool: "agent.tool",
};

const OUTCOMES: Record<string, string> = {
  success: "ok",
  refused: "refused",
  failed: "failed",
};

/**
 * The Traces tab (frame 9b), the results screen's third depth tab.
 *
 * A waterfall of one attempt: the advance, the framework's turn inside it, and every tool
 * call it made, each drawn where inside the attempt it actually ran. That last part is the
 * whole reason this tab exists rather than being another view of the timeline — the record
 * timestamps an attempt and its calls from one reading of the clock, so it can say what a
 * call cost and never when it happened, and the space between two bars here is the framework
 * thinking rather than the lab working.
 *
 * Nothing is computed from the record on this page. The backend joins each span to the call
 * it timed, so the tool, its version, and what it answered are read rather than re-derived —
 * the rule ADR 0033 gave the results screen, one tab over.
 */
export function ExperimentTracesPage() {
  const { shopId, experimentId, experiment } = useExperimentResults();
  const [traces, setTraces] = useState<ExperimentTracesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [span, setSpan] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getExperimentTraces(shopId, experimentId, controller.signal)
      .then(setTraces)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(describeApiError(cause, UNAVAILABLE));
        }
      });
    return () => controller.abort();
  }, [shopId, experimentId]);

  const attempts = traces?.traces ?? [];
  const current = useMemo(
    () => attempts.find((entry) => traceKey(entry) === selected) ?? attempts.at(-1) ?? null,
    [attempts, selected],
  );

  if (traces === null) {
    return error ? (
      <p role="alert" className="text-[13px] text-lab-error">
        {error}
      </p>
    ) : (
      <p className="text-sm text-admin-muted">Loading traces…</p>
    );
  }

  const detail = current?.spans.find((entry) => entry.span_id === span) ?? current?.spans[0];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid min-w-0 content-start gap-4">
        <Card
          title="Traces"
          footer={
            <p className="text-xs text-admin-muted">
              OpenTelemetry is the normalized format and an exporter such as Phoenix is a
              replaceable consumer of it. A stored span carries no payload, no address, and no
              free-form customer text — only the shape of the attempt and how long each part of it
              took.
            </p>
          }
        >
          {attempts.length === 0 ? (
            <p className="text-[13px] text-admin-muted">
              Neither arm has been run yet, so there is nothing to trace.
            </p>
          ) : (
            <div className="grid gap-3">
              <Attempts
                attempts={attempts}
                selected={current}
                onSelect={(entry) => {
                  setSelected(traceKey(entry));
                  setSpan(null);
                }}
              />
              {current === null ? null : (
                <Waterfall trace={current} selected={detail?.span_id ?? null} onSelect={setSpan} />
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="grid content-start gap-4">
        <Card
          title="Span"
          footer={
            <p className="text-xs text-admin-muted">
              Which tool a span timed and what it answered are joined from the recorded tool event,
              never stored on the span. The span itself is identifiers and milliseconds.
            </p>
          }
        >
          {current === null || detail === undefined ? (
            <p className="text-[13px] text-admin-muted">Select a span to read what it covered.</p>
          ) : (
            <Attributes trace={current} span={detail} />
          )}
        </Card>

        <Card
          title="Arms"
          footer={
            <p className="text-xs text-admin-muted">
              A trace belongs to one arm's attempt. The arm beside it is traced by its own advances
              and never by this one.
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

/** Every attempt both arms made, most recent last, as the frame's turn picker offers them. */
function Attempts({
  attempts,
  selected,
  onSelect,
}: {
  attempts: RunTraceSchema[];
  selected: RunTraceSchema | null;
  onSelect: (trace: RunTraceSchema) => void;
}) {
  return (
    <fieldset
      className="m-0 flex flex-wrap items-center gap-1.5 border-0 p-0"
      aria-label="Traced attempts"
    >
      {attempts.map((trace) => {
        const active = selected !== null && traceKey(trace) === traceKey(selected);
        return (
          <button
            key={traceKey(trace)}
            className={`${subtleButtonClasses} ${active ? "bg-admin-canvas text-admin-ink" : ""}`}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(trace)}
          >
            {describeAttempt(trace)}
          </button>
        );
      })}
    </fieldset>
  );
}

/**
 * One attempt drawn to scale, each bar placed where inside the attempt it ran.
 *
 * The scale is the root span's own duration, so the bars are read against the attempt rather
 * than against the widest of them — which is what makes a gap between two calls legible as
 * the framework's time.
 */
function Waterfall({
  trace,
  selected,
  onSelect,
}: {
  trace: RunTraceSchema;
  selected: string | null;
  onSelect: (spanId: string) => void;
}) {
  if (trace.trace_id === null || trace.spans.length === 0) {
    return (
      <p className="text-[13px] text-admin-muted">
        This attempt was recorded before the lab traced its runs, so it has no spans. Nothing has
        been reconstructed for it: the calls it made are still on the execution timeline.
      </p>
    );
  }
  const total = Math.max(trace.spans[0].duration_ms, 1);
  return (
    <ol className="grid gap-1" aria-label="Span waterfall">
      {trace.spans.map((span) => {
        const active = span.span_id === selected;
        return (
          <li key={span.span_id}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(span.span_id)}
              className={`grid w-full grid-cols-[minmax(0,14rem)_minmax(0,1fr)] items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-admin-canvas ${
                active ? "bg-admin-canvas" : ""
              }`}
            >
              <span
                className="truncate font-mono text-[11.5px] text-admin-ink"
                style={{ paddingLeft: `${depthOf(span) * 14}px` }}
              >
                {describeSpan(span)}
              </span>
              <span className="relative flex h-3 items-center rounded-sm bg-admin-border/40">
                <span
                  className="absolute h-3 rounded-sm bg-lab-accent"
                  style={{
                    left: `${(span.started_offset_ms / total) * 100}%`,
                    width: `${Math.max((span.duration_ms / total) * 100, 1)}%`,
                  }}
                />
                <span className="ml-auto pr-1 text-[10px] text-admin-muted">
                  {span.duration_ms} ms
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** What one span covered, read off the record it was joined to. */
function Attributes({ trace, span }: { trace: RunTraceSchema; span: RunTraceSpanSchema }) {
  const rows: [string, string][] = [
    ["span", describeSpan(span)],
    ["arm", trace.arm_label],
    ["framework", trace.framework_id],
    ["attempt", `turn ${trace.ordinal + 1} · attempt ${trace.attempt}`],
    ["started", `+${span.started_offset_ms} ms into the attempt`],
    ["duration", `${span.duration_ms} ms`],
    ["span id", span.span_id],
    ["trace id", trace.trace_id ?? "not traced"],
  ];
  if (span.tool !== null) {
    rows.splice(1, 0, ["tool", `${span.tool} · ${span.tool_version ?? "unversioned"}`]);
  }
  if (span.tool_outcome !== null) {
    rows.splice(2, 0, ["outcome", OUTCOMES[span.tool_outcome] ?? span.tool_outcome]);
  }
  if (span.kind === "attempt" && trace.outcome === "failed") {
    rows.splice(1, 0, ["ended", describeFailure(trace.failure)]);
  }
  return (
    <dl className="grid gap-1 text-[13px]">
      {rows.map(([term, value]) => (
        <div key={term} className="flex items-baseline gap-2">
          <dt className="w-24 shrink-0 text-admin-muted">{term}</dt>
          <dd className="min-w-0 break-words font-mono text-[11.5px] text-admin-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A tool span is named by the tool it timed; the other two are named by what they are. */
function describeSpan(span: RunTraceSpanSchema): string {
  return span.tool === null ? KINDS[span.kind] : `${KINDS[span.kind]} · ${span.tool}`;
}

function describeAttempt(trace: RunTraceSchema): string {
  const failed = trace.outcome === "failed" ? " · failed" : "";
  return `${trace.arm_label} · turn ${trace.ordinal + 1} · attempt ${trace.attempt}${failed}`;
}

/** Indentation is the stored parentage rather than the order the rows happen to arrive in. */
function depthOf(span: RunTraceSpanSchema): number {
  return span.kind === "attempt" ? 0 : span.kind === "runtime" ? 1 : 2;
}

function traceKey(trace: RunTraceSchema): string {
  return `${trace.run_id}:${trace.ordinal}:${trace.attempt}`;
}
