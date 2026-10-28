import type {
  ExperimentTracesResponse,
  RunTraceSchema,
  RunTraceSpanSchema,
} from "@agent-lab/contracts";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { describeApiError } from "../api/client";
import { getExperimentTraces } from "../api/experiments";
import { SheetCard, SheetLineStrip } from "../components/ArmSheet";
import { breakable } from "../lib/breakable";
import { armsInOrder } from "../lib/comparison";
import { labelOf, TOOL_OUTCOME } from "../lib/enumLabels";
import { describeFailure, TOOL_MARK } from "../lib/evidence";
import { sheetArmsOf } from "../lib/sheet";
import {
  sheetAttemptArmClasses,
  sheetAttemptClasses,
  sheetAttemptLabelClasses,
  sheetAttemptListClasses,
  sheetCellLineClasses,
  sheetGroupEmptyClasses,
  sheetSpanPanelClasses,
  sheetSpanTitleClasses,
  sheetTraceLayoutClasses,
  sheetTraceMainClasses,
} from "../lib/ui";
import { useExperimentResults } from "./useExperimentResults";

const UNAVAILABLE = "This experiment's traces are unavailable.";

/**
 * What each kind of span is, in the lab's words rather than a framework's.
 *
 * These are the names the backend gives the spans it exports, letter for letter. The trace
 * id on this page is what an operator carries into an exporter such as Phoenix, and a span
 * named one thing here and another there would make that correlation fail exactly when it
 * is being used.
 */
const KINDS: Record<RunTraceSpanSchema["kind"], string> = {
  attempt: "experiment.attempt",
  runtime: "agent.answer",
  tool: "agent.tool",
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
  const [params, setParams] = useSearchParams();
  const selected = params.get("attempt");
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
  const firstArm = experiment.runs[0]?.run_id ?? null;
  const current = useMemo(
    () =>
      attempts.find((entry) => traceKey(entry) === selected) ?? firstAttemptOf(attempts, firstArm),
    [attempts, selected, firstArm],
  );

  /**
   * The attempt is in the address, so a trace an operator found can be shared or reopened at
   * that attempt. Choosing one replaces the history entry rather than pushing one, as the
   * Documents table's chips do: Back leaves the tab instead of walking the attempts read on it.
   */
  function select(entry: RunTraceSchema) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("attempt", traceKey(entry));
        return next;
      },
      { replace: true },
    );
    setSpan(null);
  }

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
  const letters = sheetArmsOf(armsInOrder(experiment));
  const letter = (runId: string) => letters.find((arm) => arm.key === runId)?.letter ?? "·";

  return (
    // One page scroll (ADR 0080): the strip is the column's first child and holds over the tab;
    // the attempts, the waterfall and the span's detail are one section under it.
    <div className="grid min-w-0 gap-6">
      {current === null ? null : (
        <SheetLineStrip
          label="Traces"
          letter={letter(current.run_id)}
          arm={current.arm_label}
          detail={[
            `Turn ${current.ordinal + 1} · attempt ${current.attempt}`,
            detail === undefined ? null : `span ${describeSpan(detail)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      )}
      <SheetCard
        id="traces"
        title="Traces"
        note="OpenTelemetry is the normalized format and an exporter such as Phoenix is a replaceable consumer of it. A stored span carries no payload, no address, and no free-form customer text — only the shape of the attempt and how long each part of it took."
      >
        {attempts.length === 0 ? (
          <p className={sheetGroupEmptyClasses}>
            Neither arm has been run yet, so there is nothing to trace.
          </p>
        ) : (
          <div className={sheetTraceLayoutClasses}>
            <Attempts attempts={attempts} selected={current} onSelect={select} />
            <div className={sheetTraceMainClasses}>
              {current === null ? null : (
                <Waterfall trace={current} selected={detail?.span_id ?? null} onSelect={setSpan} />
              )}
              <SpanDetail trace={current} span={detail} />
            </div>
          </div>
        )}
      </SheetCard>
    </div>
  );
}

/**
 * The span being read, under the waterfall (sheet mockup :347–352): the region "Span", its
 * title naming the span, what it covered, and the note that says where its tool came from.
 */
function SpanDetail({
  trace,
  span,
}: {
  trace: RunTraceSchema | null;
  span: RunTraceSpanSchema | undefined;
}) {
  return (
    <section aria-label="Span" className={sheetSpanPanelClasses}>
      <h3 className={sheetSpanTitleClasses}>
        Span{" "}
        {span === undefined ? null : (
          <span className="font-mono font-medium [overflow-wrap:anywhere]">
            {breakable(describeSpan(span))}
          </span>
        )}
      </h3>
      {trace === null || span === undefined ? (
        <p className="text-[13px] text-admin-muted">Select a span to read what it covered.</p>
      ) : (
        <Attributes trace={trace} span={span} />
      )}
      <p className={sheetCellLineClasses}>
        Which tool a span timed and what it answered are joined from the recorded tool event, never
        stored on the span. The span itself is identifiers and milliseconds.
      </p>
    </section>
  );
}

/**
 * Every attempt both arms made, most recent last, as a list on the left (sheet mockup :330–336):
 * each a press naming its arm over its turn and attempt, the one whose waterfall is drawn kept
 * pressed and drawn on the selected chip's ground, so which it is is seen and not only announced.
 * Pressed buttons rather than the mockup's `listbox`: a choice made by pressing needs no arrow-key
 * model of its own, and each press is named whole, its arm, turn, attempt and failure.
 */
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
    <fieldset className={sheetAttemptListClasses} aria-label="Traced attempts">
      {attempts.map((trace) => {
        const active = selected !== null && traceKey(trace) === traceKey(selected);
        return (
          <button
            key={traceKey(trace)}
            className={sheetAttemptClasses[active ? "selected" : "unselected"]}
            type="button"
            aria-pressed={active}
            aria-label={describeAttempt(trace)}
            onClick={() => onSelect(trace)}
          >
            <span className={sheetAttemptArmClasses}>{trace.arm_label}</span>
            <span className={sheetAttemptLabelClasses}>
              {`Turn ${trace.ordinal + 1} · attempt ${trace.attempt}`}
              {trace.outcome === "failed" ? " · failed" : ""}
            </span>
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
              // Named explicitly: the name, the outcome and the duration are separate elements
              // with a gap between them rather than a character, so the computed name ran them
              // together ("agent.tool · orders.read_order310 ms").
              aria-label={[describeSpan(span), outcomeOf(span), `${span.duration_ms} ms`]
                .filter(Boolean)
                .join(" · ")}
              onClick={() => onSelect(span.span_id)}
              className={`grid w-full grid-cols-[minmax(0,14rem)_minmax(0,1fr)_8.5rem] items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-admin-canvas ${
                // The selected span is marked as the selected tab is, by a clay rule and a
                // heavier name (below), and not by its ground alone.
                active ? "bg-admin-canvas shadow-[inset_2px_0_0_var(--color-lab-accent)]" : ""
              }`}
            >
              <span
                className={`font-mono text-[11.5px] [overflow-wrap:anywhere] text-admin-ink ${
                  active ? "font-semibold" : ""
                }`}
                style={{ paddingLeft: `${depthOf(span) * 14}px` }}
              >
                {breakable(describeSpan(span))}
              </span>
              <span className="relative flex h-3 items-center rounded-sm bg-admin-border/40">
                <span
                  className="absolute h-3 rounded-sm bg-lab-accent"
                  // Each interval was rounded to a millisecond on its own, so a child can
                  // end a millisecond past the parent it sits inside. Clamped here rather
                  // than in the record: the numbers are the ones the runner measured, and
                  // only the drawing has to fit inside the track.
                  style={bar(span.started_offset_ms, span.duration_ms, total)}
                />
              </span>
              {/* Beside the track rather than on it, so no bar is ever drawn over the words; one
                  width on every row, so every track is the same length and one scale. */}
              <span className="whitespace-nowrap text-right text-[11px] text-admin-muted">
                {span.tool_outcome === null ? null : (
                  <>
                    <span aria-hidden="true">{`${TOOL_MARK[span.tool_outcome]} `}</span>
                    <span className="font-semibold text-admin-ink-soft">{outcomeOf(span)}</span>
                    {" · "}
                  </>
                )}
                {span.duration_ms} ms
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
  // The identifiers are hex and have no joints to wrap at, so they alone break anywhere.
  const hex = new Set(["span id", "trace id"]);
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
    rows.splice(2, 0, ["outcome", labelOf(TOOL_OUTCOME, span.tool_outcome)]);
  }
  if (span.kind === "attempt" && trace.outcome === "failed") {
    rows.splice(1, 0, ["ended", describeFailure(trace.failure)]);
  }
  return (
    <dl className="grid gap-1 text-[13px]">
      {rows.map(([term, value]) => (
        <div key={term} className="flex items-baseline gap-2">
          <dt className="w-24 shrink-0 text-admin-muted">{term}</dt>
          <dd className="min-w-0 font-mono text-[11.5px] [overflow-wrap:anywhere] text-admin-ink">
            {hex.has(term) ? value : breakable(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Where a bar starts and how wide it is, never past the end of the track it sits in. */
function bar(offset: number, duration: number, total: number): { left: string; width: string } {
  const left = Math.min((offset / total) * 100, 100);
  return {
    left: `${left}%`,
    width: `${Math.min(Math.max((duration / total) * 100, 1), 100 - left)}%`,
  };
}

/** A tool span is named by the tool it timed; the other two are named by what they are. */
function describeSpan(span: RunTraceSpanSchema): string {
  return span.tool === null ? KINDS[span.kind] : `${KINDS[span.kind]} · ${span.tool}`;
}

/** What the call a tool span timed answered, in words; nothing for the other two kinds. */
function outcomeOf(span: RunTraceSpanSchema): string {
  return span.tool_outcome === null ? "" : labelOf(TOOL_OUTCOME, span.tool_outcome);
}

/**
 * Where the tab opens: the first attempt of the first arm, which is where the run began.
 * Falls back to the first attempt recorded when that arm has none.
 */
function firstAttemptOf(attempts: RunTraceSchema[], runId: string | null): RunTraceSchema | null {
  const ofArm = attempts
    .filter((entry) => entry.run_id === runId)
    .sort((left, right) => left.ordinal - right.ordinal || left.attempt - right.attempt);
  return ofArm[0] ?? attempts[0] ?? null;
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
