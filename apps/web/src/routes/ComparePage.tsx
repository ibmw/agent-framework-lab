import type {
  ActionProposalResponse,
  AgentFrameworkListResponse,
  ConversationResponse,
} from "@agent-lab/contracts";
import { LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { getConversation, getOrderAction, listAgentFrameworks } from "../api/conversations";
import {
  buildComparisonDiff,
  type ComparisonDiff,
  comparisonSide,
  frameworkColumnLabel,
} from "../lib/comparison";
import { decodePersonaRef, personaPath, truncateHash } from "../lib/scenarios";
import { inkButtonClasses, panelClasses, writeLastComparison } from "../lib/ui";

type Framework = AgentFrameworkListResponse["frameworks"][number];

function toneClass(tone: "agree" | "differs" | "muted"): string {
  if (tone === "agree") {
    return "font-semibold text-lab-success";
  }
  if (tone === "differs") {
    return "font-semibold text-lab-error";
  }
  return "font-mono text-[12.5px] text-lab-muted";
}

function actionProposalStorageKey(conversationId: string): string {
  return `agent-lab:action-proposal:${conversationId}`;
}

async function loadProposal(conversationId: string): Promise<ActionProposalResponse | undefined> {
  const proposalId = window.localStorage.getItem(actionProposalStorageKey(conversationId));
  if (!proposalId) {
    return undefined;
  }
  try {
    return await getOrderAction(conversationId, proposalId);
  } catch {
    return undefined;
  }
}

export function ComparePage() {
  const { ref } = useParams();
  const [params] = useSearchParams();
  const personaRef = decodePersonaRef(ref);
  const sessionA = params.get("a") ?? "";
  const sessionB = params.get("b") ?? "";
  const scenarioId = personaRef?.scenarioId;
  const scenarioVersion = personaRef?.scenarioVersion;
  const seed = personaRef?.seed;

  const [state, setState] = useState<"loading" | "ready" | "error" | "mismatch">("loading");
  const [error, setError] = useState<string>();
  const [left, setLeft] = useState<ConversationResponse>();
  const [right, setRight] = useState<ConversationResponse>();
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [leftProposal, setLeftProposal] = useState<ActionProposalResponse>();
  const [rightProposal, setRightProposal] = useState<ActionProposalResponse>();

  useEffect(() => {
    if (scenarioId === undefined || scenarioVersion === undefined || seed === undefined) {
      return;
    }
    if (!sessionA || !sessionB) {
      return;
    }
    const currentRef = { scenarioId, scenarioVersion, seed };
    let active = true;
    setState("loading");
    Promise.all([
      getConversation(sessionA),
      getConversation(sessionB),
      listAgentFrameworks().catch(() => ({ frameworks: [] as Framework[] })),
      loadProposal(sessionA),
      loadProposal(sessionB),
    ])
      .then(([conversationA, conversationB, frameworkList, proposalA, proposalB]) => {
        if (!active) {
          return;
        }
        const belongs = (conversation: ConversationResponse) =>
          conversation.scenario_id === currentRef.scenarioId &&
          conversation.scenario_version === currentRef.scenarioVersion &&
          conversation.seed === currentRef.seed;
        if (!belongs(conversationA) || !belongs(conversationB)) {
          setError("Both conversations must belong to this persona.");
          setState("error");
          return;
        }
        if (conversationA.initial_state_hash !== conversationB.initial_state_hash) {
          setLeft(conversationA);
          setRight(conversationB);
          setState("mismatch");
          return;
        }
        setLeft(conversationA);
        setRight(conversationB);
        setFrameworks(frameworkList.frameworks);
        setLeftProposal(proposalA);
        setRightProposal(proposalB);
        writeLastComparison({
          personaPath: personaPath(currentRef),
          a: conversationA.id,
          b: conversationB.id,
        });
        setState("ready");
      })
      .catch(() => {
        if (active) {
          setError("The comparison could not be loaded.");
          setState("error");
        }
      });
    return () => {
      active = false;
    };
  }, [scenarioId, scenarioVersion, seed, sessionA, sessionB]);

  const diff = useMemo<ComparisonDiff | undefined>(() => {
    if (!left || !right) {
      return undefined;
    }
    const frameworkOf = (frameworkId: string) =>
      frameworks.find((framework) => framework.framework_id === frameworkId);
    return buildComparisonDiff(
      comparisonSide(
        left,
        frameworkOf(left.framework_id)?.capabilities ?? [],
        leftProposal,
        frameworkOf(left.framework_id)?.model_id ?? null,
      ),
      comparisonSide(
        right,
        frameworkOf(right.framework_id)?.capabilities ?? [],
        rightProposal,
        frameworkOf(right.framework_id)?.model_id ?? null,
      ),
    );
  }, [left, right, frameworks, leftProposal, rightProposal]);

  if (!personaRef) {
    return <Navigate to="/" replace />;
  }

  if (!sessionA || !sessionB) {
    return (
      <div className={`${panelClasses} grid gap-3 p-6`} role="alert">
        <strong className="text-sm">Choose two conversations to compare.</strong>
        <Link
          className="text-sm font-bold text-lab-accent hover:underline"
          to={personaPath(personaRef)}
        >
          Back to persona
        </Link>
      </div>
    );
  }

  function exportComparison() {
    if (!left || !right || !diff) {
      return;
    }
    const payload = {
      fingerprint: left.initial_state_hash,
      left: { id: left.id, framework_id: left.framework_id, turns: left.turns },
      right: { id: right.id, framework_id: right.framework_id, turns: right.turns },
      verdict: { title: diff.verdictTitle, body: diff.verdictBody },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `afcl-comparison-${left.framework_id}-${right.framework_id}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  const hash = left?.initial_state_hash ?? right?.initial_state_hash;

  return (
    <section className={`${panelClasses} overflow-hidden`} aria-labelledby="compare-title">
      <div className="flex flex-wrap items-center gap-4 bg-lab-ink px-[22px] py-3.5 font-mono text-[11px] text-lab-canvas-top">
        <span className="font-extrabold text-lab-accent-soft">05</span>
        <span>same scenario · same seed · same fingerprint</span>
        {hash && (
          <span className="ml-auto break-all" title={hash}>
            {truncateHash(hash)}
          </span>
        )}
      </div>

      {state === "loading" && (
        <div className="grid gap-6 px-6 py-[26px]" role="status">
          <p className="m-0 flex items-center gap-2 text-sm text-lab-muted">
            <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" size={16} />
            Loading comparison…
          </p>
          <div className="overflow-hidden rounded-xl border border-lab-border">
            <div className="grid grid-cols-1 border-b border-lab-border bg-lab-subtle md:grid-cols-[190px_1fr_1fr]">
              <div className="px-3.5 py-3 text-[10px] font-extrabold tracking-[0.08em] text-lab-muted uppercase">
                Signal
              </div>
              <div className="border-lab-border px-3.5 py-3 font-mono text-[13px] font-semibold md:border-l">
                {left?.framework_id ?? "—"}
              </div>
              <div className="border-lab-border px-3.5 py-3 font-mono text-[13px] font-semibold md:border-l">
                {right?.framework_id ?? "—"}
              </div>
            </div>
            <div className="h-40 bg-lab-paper" />
          </div>
        </div>
      )}

      {state === "error" && (
        <div className="grid gap-3 p-6" role="alert">
          <strong className="text-sm">{error ?? "The comparison could not be loaded."}</strong>
          <Link
            className="text-sm font-bold text-lab-accent hover:underline"
            to={personaPath(personaRef)}
          >
            Back to persona
          </Link>
        </div>
      )}

      {state === "mismatch" && (
        <div className="grid gap-3 p-6" role="alert">
          <strong className="text-sm">These conversations do not share a fingerprint.</strong>
          <p className="m-0 text-sm text-lab-muted">
            Comparison is refused when initial_state_hash values differ. Generate both runs from the
            same scenario and seed.
          </p>
          <Link
            className="text-sm font-bold text-lab-accent hover:underline"
            to={personaPath(personaRef)}
          >
            Back to persona
          </Link>
        </div>
      )}

      {state === "ready" && diff && (
        <div className="flex flex-col gap-[22px] px-6 py-[26px]">
          <div className="flex flex-wrap items-start gap-[22px]">
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              <h2
                className="font-display m-0 text-[28px] leading-[1.1] font-medium tracking-[-0.035em]"
                id="compare-title"
              >
                {diff.verdictTitle}
              </h2>
              <p className="m-0 max-w-[660px] text-sm text-lab-muted">{diff.verdictBody}</p>
            </div>
            <button
              className={`${inkButtonClasses} px-4 py-2.5 text-[13px]`}
              type="button"
              onClick={exportComparison}
            >
              Export comparison
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border border-lab-border">
            <table className="hidden w-full table-fixed border-collapse md:table">
              <caption className="sr-only">Framework comparison signals</caption>
              <colgroup>
                <col className="w-[190px]" />
                <col />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th
                    className="bg-lab-subtle px-3.5 py-3 text-left text-[10px] font-extrabold tracking-[0.08em] text-lab-muted uppercase"
                    scope="col"
                  >
                    Signal
                  </th>
                  <th
                    className="border-l border-lab-border bg-lab-subtle px-3.5 py-3 text-left font-mono text-[13px] font-semibold"
                    scope="col"
                  >
                    {frameworkColumnLabel(diff.left)}
                  </th>
                  <th
                    className="border-l border-lab-border bg-lab-subtle px-3.5 py-3 text-left font-mono text-[13px] font-semibold"
                    scope="col"
                  >
                    {frameworkColumnLabel(diff.right)}
                  </th>
                </tr>
              </thead>
              <tbody>
                <SignalRow
                  label="Proven capabilities"
                  left={`${diff.left.provenCount} of 6`}
                  right={`${diff.right.provenCount} of 6`}
                  tone="agree"
                />
                <SignalRow
                  label="Unproven"
                  left={diff.left.unproven.join(" · ") || "none"}
                  right={diff.right.unproven.join(" · ") || "none"}
                  tone="muted"
                />
                <SignalRow
                  label="Read tools called"
                  left={diff.left.readToolsLabel}
                  right={diff.right.readToolsLabel}
                  tone="muted"
                />
                <SignalRow
                  label="Turns to proposal"
                  left={diff.left.turnsToProposal == null ? "—" : String(diff.left.turnsToProposal)}
                  right={
                    diff.right.turnsToProposal == null ? "—" : String(diff.right.turnsToProposal)
                  }
                  tone="muted"
                />
                <SignalRow
                  label="Confirmation respected"
                  left={diff.left.confirmation.text}
                  right={diff.right.confirmation.text}
                  leftTone={diff.left.confirmation.tone}
                  rightTone={diff.right.confirmation.tone}
                />
                <SignalRow
                  label="Determinism"
                  left={diff.left.determinism.text}
                  right={diff.right.determinism.text}
                  leftTone={diff.left.determinism.tone}
                  rightTone={diff.right.determinism.tone}
                />
              </tbody>
            </table>
            <div className="grid gap-4 p-4 md:hidden">
              <StackedSide side={diff.left} />
              <StackedSide side={diff.right} />
            </div>
          </div>

          {diff.divergence.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <div className="text-[10px] font-extrabold tracking-[0.08em] text-lab-muted uppercase">
                Where the two runs split
              </div>
              <div className="flex overflow-x-auto rounded-[10px] border border-lab-border">
                {diff.divergence.map((cell) => (
                  <div
                    className={`min-w-[8rem] border-l border-lab-border px-3 py-3 font-mono text-xs first:border-l-0 ${
                      cell.divergent
                        ? "flex-[1.5] bg-lab-accent-soft text-lab-accent"
                        : "flex-1 bg-lab-fingerprint"
                    }`}
                    key={cell.label}
                  >
                    {cell.label}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SignalRow({
  label,
  left,
  right,
  tone,
  leftTone,
  rightTone,
}: {
  label: string;
  left: string;
  right: string;
  tone?: "agree" | "differs" | "muted";
  leftTone?: "agree" | "differs" | "muted";
  rightTone?: "agree" | "differs" | "muted";
}) {
  const resolvedLeft = leftTone ?? tone ?? "muted";
  const resolvedRight = rightTone ?? tone ?? "muted";
  return (
    <tr>
      <th
        className="border-t border-lab-ink/12 px-3.5 py-3 text-left text-[13px] font-normal text-lab-muted"
        scope="row"
      >
        {label}
      </th>
      <td
        className={`border-t border-l border-lab-ink/12 px-3.5 py-3 text-[13px] ${toneClass(resolvedLeft)}`}
      >
        {left}
      </td>
      <td
        className={`border-t border-l border-lab-ink/12 px-3.5 py-3 text-[13px] ${toneClass(resolvedRight)}`}
      >
        {right}
      </td>
    </tr>
  );
}

function StackedSide({ side }: { side: ComparisonDiff["left"] }) {
  return (
    <section className="grid gap-2 rounded-lg border border-lab-border bg-lab-paper p-3">
      <h3 className="m-0 font-mono text-[13px] font-semibold">{frameworkColumnLabel(side)}</h3>
      <div className="text-sm text-lab-muted">Proven capabilities</div>
      <div className="font-semibold text-lab-success">{side.provenCount} of 6</div>
      <div className="text-sm text-lab-muted">Read tools called</div>
      <div className="font-mono text-[12.5px] text-lab-muted">{side.readToolsLabel}</div>
    </section>
  );
}
