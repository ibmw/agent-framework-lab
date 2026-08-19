import type {
  ActionProposalResponse,
  ConversationResponse,
  GeneratedScenarioResponse,
} from "@agent-lab/contracts";
import {
  AssistantRuntimeProvider,
  type ChatModelAdapter,
  ComposerPrimitive,
  ThreadPrimitive,
  useLocalRuntime,
} from "@assistant-ui/react";
import { RotateCcw, Send, Target } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ConversationApiError,
  decideOrderAction,
  executeOrderAction,
  getOrderAction,
  proposeOrderAction,
  sendConversationMessage,
} from "./api/conversations";
import { accentButtonClasses, outlineButtonClasses } from "./lib/ui";

type ScenarioOrder = GeneratedScenarioResponse["initial_state"]["orders"][number];

function actionProposalStorageKey(conversationId: string): string {
  return `agent-lab:action-proposal:${conversationId}`;
}

function lastUserText(messages: Parameters<ChatModelAdapter["run"]>[0]["messages"]): string {
  const message = [...messages].reverse().find((candidate) => candidate.role === "user");
  if (!message) {
    throw new Error("A user message is required.");
  }
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function truncateId(value: string): string {
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function ActionStatusStrip({ status }: { status?: ActionProposalResponse["status"] }) {
  const steps: { id: "proposed" | "confirmed" | "executed"; label: string }[] = [
    { id: "proposed", label: "Proposed" },
    { id: "confirmed", label: "Confirmed" },
    { id: "executed", label: "Executed" },
  ];
  const rank = { proposed: 0, confirmed: 1, cancelled: 1, executed: 2 } as const;
  const current = status ? rank[status] : -1;

  return (
    <div>
      <div className="flex items-center" aria-hidden="true">
        {steps.map((step, index) => {
          const cancelled = status === "cancelled" && index === 1;
          const reached = current > index;
          const isCurrent = current === index;
          const rounded =
            index === 0 ? "rounded-l-md" : index === steps.length - 1 ? "rounded-r-md" : "";
          let tone = "bg-lab-subtle text-lab-muted";
          if (cancelled) {
            tone = "bg-lab-error-soft text-lab-error";
          } else if (reached || (isCurrent && status === "executed")) {
            tone = "bg-lab-ink text-lab-canvas-top";
          } else if (isCurrent) {
            tone = "bg-lab-accent-soft text-lab-accent";
          }
          return (
            <span
              className={`flex-1 py-2 text-center text-xs font-semibold ${rounded} ${tone}`}
              key={step.id}
            >
              {step.label}
            </span>
          );
        })}
      </div>
      <p className="sr-only" aria-live="polite">
        Safe order action {status ?? "not started"}
      </p>
    </div>
  );
}

function OrderActionPanel({
  conversationId,
  order,
}: {
  conversationId: string;
  order: ScenarioOrder;
}) {
  const [proposal, setProposal] = useState<ActionProposalResponse>();
  const [busy, setBusy] = useState<"proposing" | "confirming" | "cancelling" | "executing">();
  const [error, setError] = useState<{ code?: string; message: string }>();

  useEffect(() => {
    let active = true;
    const storageKey = actionProposalStorageKey(conversationId);
    const proposalId = localStorage.getItem(storageKey);
    setProposal(undefined);
    setError(undefined);
    if (!proposalId) return;

    void getOrderAction(conversationId, proposalId)
      .then((persisted) => {
        if (active) setProposal(persisted);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof ConversationApiError && caught.status === 404) {
          localStorage.removeItem(storageKey);
          return;
        }
        if (caught instanceof ConversationApiError) {
          setError({ code: caught.code, message: caught.message });
          return;
        }
        setError({ message: "The persisted action could not be restored." });
      });

    return () => {
      active = false;
    };
  }, [conversationId]);

  function captureError(caught: unknown) {
    if (caught instanceof ConversationApiError) {
      setError({ code: caught.code, message: caught.message });
      return;
    }
    setError({ message: "The action service could not complete the request." });
  }

  async function propose() {
    setBusy("proposing");
    setError(undefined);
    try {
      const proposed = await proposeOrderAction(conversationId, {
        action_type: "cancel_order",
        order_id: order.id,
        expected_version: order.version,
      });
      localStorage.setItem(actionProposalStorageKey(conversationId), proposed.id);
      setProposal(proposed);
    } catch (caught) {
      captureError(caught);
    } finally {
      setBusy(undefined);
    }
  }

  async function decide(decision: "confirm" | "cancel") {
    if (!proposal) return;
    setBusy(decision === "confirm" ? "confirming" : "cancelling");
    setError(undefined);
    try {
      setProposal(await decideOrderAction(conversationId, proposal, decision));
    } catch (caught) {
      captureError(caught);
    } finally {
      setBusy(undefined);
    }
  }

  async function execute() {
    if (!proposal) return;
    setBusy("executing");
    setError(undefined);
    try {
      setProposal(await executeOrderAction(conversationId, proposal.id));
    } catch (caught) {
      captureError(caught);
    } finally {
      setBusy(undefined);
    }
  }

  const errorTitle =
    error?.code === "action_refused"
      ? "Refused"
      : error?.code === "action_conflict"
        ? "Conflict"
        : error?.code === "action_transient_error"
          ? "Retry available"
          : "Action unavailable";

  return (
    <aside
      className="flex flex-col gap-3 rounded-xl border border-lab-accent bg-lab-paper p-4"
      aria-labelledby="order-action-title"
    >
      <div className="flex items-center gap-2">
        <h3
          className="m-0 text-xs font-extrabold tracking-[0.06em] text-lab-accent uppercase"
          id="order-action-title"
        >
          Safe order action
        </h3>
        <span className="ml-auto font-mono text-[11px] text-lab-muted">cancel_order v1</span>
      </div>

      <ActionStatusStrip status={proposal?.status} />

      {busy && (
        <p className="m-0 rounded-md bg-lab-subtle px-3 py-2 text-sm" role="status">
          {busy === "proposing"
            ? "Creating an exact proposal…"
            : busy === "confirming"
              ? "Confirming the exact action…"
              : busy === "cancelling"
                ? "Cancelling the proposal…"
                : "Executing with safe retries…"}
        </p>
      )}

      {error && (
        <div
          className="rounded-lg border border-lab-error/30 bg-lab-error-soft p-3 text-sm text-lab-error"
          role="alert"
        >
          <strong className="block">{errorTitle}</strong>
          <span>{error.message}</span>
        </div>
      )}

      {proposal && (
        <div className="rounded-md bg-lab-fingerprint p-[11px] font-mono text-xs leading-relaxed">
          order {truncateId(proposal.order_id)} · expected_version {proposal.expected_version}
          <br />
          confirmation_token {truncateId(proposal.confirmation_token)} · attempts{" "}
          {proposal.attempts}
        </div>
      )}

      {!proposal && (
        <button
          className={accentButtonClasses}
          type="button"
          onClick={propose}
          disabled={busy !== undefined}
        >
          Propose order cancellation
        </button>
      )}

      {proposal?.status === "proposed" && (
        <div className="grid gap-3">
          <div>
            <strong className="block text-sm">Proposal ready</strong>
            <span className="text-sm">{proposal.summary}</span>
          </div>
          <div className="flex gap-2">
            <button
              className={`${accentButtonClasses} px-4 py-[9px] text-[13px]`}
              type="button"
              onClick={() => decide("confirm")}
              disabled={busy !== undefined}
            >
              Confirm exact action
            </button>
            <button
              className={`${outlineButtonClasses} px-4 py-[9px] text-[13px]`}
              type="button"
              onClick={() => decide("cancel")}
              disabled={busy !== undefined}
            >
              Cancel proposal
            </button>
          </div>
        </div>
      )}

      {proposal?.status === "confirmed" && (
        <div className="grid gap-3">
          <p className="m-0 text-sm font-bold text-lab-success">Confirmed</p>
          {error?.code !== "action_transient_error" && (
            <button
              className={`${accentButtonClasses} px-4 py-[9px] text-[13px]`}
              type="button"
              onClick={execute}
              disabled={busy !== undefined}
            >
              Execute cancellation
            </button>
          )}
        </div>
      )}

      {proposal?.status === "cancelled" && (
        <p className="m-0 text-sm font-bold text-lab-muted">
          Cancelled by user — no order change was made.
        </p>
      )}

      {proposal?.status === "executed" && (
        <p className="m-0 text-sm text-lab-success">
          <strong className="block">Executed</strong>
          <span>
            Order is {proposal.result_order_status} at version {proposal.result_order_version}.
            Attempts: {proposal.attempts}.
          </span>
        </p>
      )}

      {error?.code === "action_transient_error" && proposal?.status === "confirmed" && (
        <button
          className={`${outlineButtonClasses} gap-2`}
          type="button"
          onClick={execute}
          disabled={busy !== undefined}
        >
          <RotateCcw aria-hidden="true" size={16} /> Retry execution safely
        </button>
      )}

      <p className="m-0 text-xs text-lab-muted">
        Nothing is written until the exact action is confirmed, then executed.
      </p>
    </aside>
  );
}

export function SupportConversation({
  conversation,
  suggestedCustomerMessage,
  scenarioGoal,
  fingerprint,
  order,
  onConversationUpdated,
}: {
  conversation: ConversationResponse;
  suggestedCustomerMessage?: string;
  scenarioGoal?: string;
  fingerprint: string;
  order?: ScenarioOrder;
  onConversationUpdated: (conversation: ConversationResponse) => void;
}) {
  const [pendingUserText, setPendingUserText] = useState<string>();
  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async run({ messages }) {
        const text = lastUserText(messages);
        setPendingUserText(text);
        try {
          const updated = await sendConversationMessage(conversation.id, text);
          onConversationUpdated(updated);
          const turn = updated.turns.at(-1);
          if (!turn) {
            throw new Error("The support service returned no assistant turn.");
          }
          return {
            content: [{ type: "text", text: turn.response_message }],
            metadata: { custom: { traceId: turn.trace_id } },
          };
        } finally {
          setPendingUserText(undefined);
        }
      },
    }),
    [conversation.id, onConversationUpdated],
  );
  const runtime = useLocalRuntime(adapter, { initialMessages: [] });
  const latestTurn = conversation.turns.at(-1);
  const [selectedTurnId, setSelectedTurnId] = useState(latestTurn?.id);
  useEffect(() => {
    setSelectedTurnId(latestTurn?.id);
  }, [latestTurn?.id]);
  const selectedTurn = conversation.turns.find((turn) => turn.id === selectedTurnId) ?? latestTurn;
  const viewingLatest = selectedTurn?.id === latestTurn?.id;
  const suggestedCustomerMessageId = `suggested-customer-message-${conversation.id}`;
  const turnLabel = selectedTurn
    ? `turn ${selectedTurn.ordinal} of ${conversation.turns.length}`
    : undefined;
  const pendingVisible =
    pendingUserText !== undefined &&
    !conversation.turns.some((turn) => turn.request_message === pendingUserText);

  return (
    <div className="flex max-[999px]:flex-col">
      <div className="flex min-w-0 flex-[1.3] flex-col gap-3.5 border-r border-lab-ink/15 p-6 max-[999px]:border-r-0 max-[999px]:border-b">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2
            className="font-display m-0 text-[26px] font-medium tracking-[-0.035em]"
            id="support-title"
          >
            Support conversation
          </h2>
          {turnLabel && (
            <span className="rounded bg-lab-fingerprint px-2 py-1 font-mono text-[11px] text-lab-ink-soft">
              {turnLabel}
            </span>
          )}
        </div>

        {conversation.turns.map((turn) => (
          <div className="flex flex-col gap-3.5" key={turn.id}>
            <div className="max-w-[78%] self-end rounded-[12px] rounded-br-[3px] bg-lab-subtle px-3.5 py-3 text-sm leading-normal">
              {turn.request_message}
            </div>
            <div className="flex max-w-[84%] flex-col gap-2.5 rounded-[12px] rounded-bl-[3px] border border-lab-border bg-lab-paper px-3.5 py-3 text-sm leading-normal">
              <span>{turn.response_message}</span>
              {turn.tool_activity.length > 0 && (
                <span className="flex flex-wrap gap-1.5">
                  {turn.tool_activity.map((activity) => (
                    <span
                      className="rounded bg-lab-fingerprint px-[7px] py-[3px] font-mono text-[10.5px] text-lab-success"
                      key={`${turn.id}:${activity.tool_name}`}
                    >
                      {activity.tool_name} {activity.tool_version}
                    </span>
                  ))}
                </span>
              )}
            </div>
          </div>
        ))}

        {pendingVisible && pendingUserText && (
          <div className="flex flex-col gap-3.5">
            <div className="max-w-[78%] self-end rounded-[12px] rounded-br-[3px] bg-lab-subtle px-3.5 py-3 text-sm leading-normal">
              {pendingUserText}
            </div>
            <div
              className="flex max-w-[84%] flex-col gap-2.5 rounded-[12px] rounded-bl-[3px] border border-lab-border bg-lab-paper px-3.5 py-3 text-sm leading-normal text-lab-muted"
              role="status"
            >
              Thinking…
            </div>
          </div>
        )}

        <AssistantRuntimeProvider runtime={runtime}>
          <ThreadPrimitive.Root className="flex flex-col">
            {conversation.turns.length === 0 && !pendingVisible && (
              <ThreadPrimitive.Empty>
                <div className="grid max-w-md gap-4 py-4">
                  <p className="m-0 font-bold text-lab-ink">
                    Start the conversation as the customer.
                  </p>
                  {suggestedCustomerMessage && (
                    <ThreadPrimitive.Suggestion
                      className="grid min-h-11 gap-2 rounded-xl border border-lab-accent/30 bg-lab-accent-soft p-4 text-left transition hover:border-lab-accent hover:bg-lab-paper"
                      prompt={suggestedCustomerMessage}
                      send={false}
                      aria-label="Use suggested customer message"
                      aria-describedby={suggestedCustomerMessageId}
                    >
                      <span className="text-[0.68rem] font-extrabold tracking-wide text-lab-accent uppercase">
                        Suggested customer message
                      </span>
                      <span className="text-sm text-lab-ink" id={suggestedCustomerMessageId}>
                        “{suggestedCustomerMessage}”
                      </span>
                    </ThreadPrimitive.Suggestion>
                  )}
                </div>
              </ThreadPrimitive.Empty>
            )}
            <ComposerPrimitive.Root
              className="mt-2 flex items-end gap-2 rounded-xl border border-lab-border bg-lab-paper p-2 focus-within:ring-3 focus-within:ring-lab-accent/15"
              aria-label="Message composer"
            >
              <ComposerPrimitive.Input
                className="min-h-11 flex-1 resize-none bg-transparent px-2 py-2 outline-none"
                aria-label="Support message"
                placeholder="Write the customer’s message…"
              />
              <ComposerPrimitive.Send className="grid size-11 shrink-0 place-items-center rounded-lg bg-lab-ink text-lab-paper disabled:opacity-50">
                <Send aria-hidden="true" size={18} />
                <span className="sr-only">Send message</span>
              </ComposerPrimitive.Send>
            </ComposerPrimitive.Root>
          </ThreadPrimitive.Root>
        </AssistantRuntimeProvider>

        {order && <OrderActionPanel conversationId={conversation.id} order={order} />}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 bg-lab-subtle p-6">
        <div className="flex items-baseline gap-2.5">
          <h3 className="m-0 text-[11px] font-extrabold tracking-[0.08em] text-lab-muted uppercase">
            Evidence
          </h3>
          {turnLabel && <span className="font-mono text-[11px] text-lab-muted">{turnLabel}</span>}
        </div>

        {scenarioGoal && (
          <aside aria-labelledby="scenario-goal-title">
            <h3
              className="mb-2 flex items-center gap-2 text-sm font-bold text-lab-ink"
              id="scenario-goal-title"
            >
              <Target className="text-lab-accent" aria-hidden="true" size={17} /> Your goal as the
              customer
            </h3>
            <p className="m-0 text-sm leading-relaxed text-lab-ink-soft">{scenarioGoal}</p>
          </aside>
        )}

        {!selectedTurn ? (
          <p className="m-0 text-sm text-lab-muted">
            Tool activity and structured output appear here.
          </p>
        ) : (
          <div className="grid gap-4">
            {conversation.turns.length > 1 && (
              <nav aria-label="Evidence turn selector" className="flex flex-wrap gap-1">
                {conversation.turns.map((turn) => (
                  <button
                    className={`rounded-lg border px-3 py-2 text-xs font-bold ${
                      turn.id === selectedTurn.id
                        ? "border-lab-accent bg-lab-accent-soft text-lab-accent"
                        : "border-lab-border bg-lab-paper text-lab-ink-soft"
                    }`}
                    type="button"
                    key={turn.id}
                    aria-pressed={turn.id === selectedTurn.id}
                    aria-label={`Turn ${turn.ordinal}`}
                    onClick={() => setSelectedTurnId(turn.id)}
                  >
                    Turn {turn.ordinal}
                  </button>
                ))}
                {!viewingLatest && (
                  <button
                    className="text-xs font-bold text-lab-accent"
                    type="button"
                    onClick={() => setSelectedTurnId(latestTurn?.id)}
                  >
                    View latest
                  </button>
                )}
              </nav>
            )}

            <div className="flex flex-col gap-[7px]">
              {selectedTurn.tool_activity.map((activity) => {
                const pendingWrite =
                  activity.tool_name === "cancel_order" && activity.outcome !== "success";
                return (
                  <div
                    className={`flex items-center gap-2.5 rounded-[9px] border bg-lab-paper px-[13px] py-[11px] ${
                      pendingWrite ? "border-lab-accent" : "border-lab-border"
                    }`}
                    key={`${selectedTurn.id}:${activity.tool_name}`}
                  >
                    <span className="flex-1 font-mono text-xs">{activity.tool_name}</span>
                    <span className="font-mono text-[11px] text-lab-muted">
                      {activity.tool_version}
                    </span>
                    <span
                      className={`text-xs ${pendingWrite ? "text-lab-accent" : "text-lab-success"}`}
                    >
                      {pendingWrite ? "proposed" : "ok"}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="rounded-[10px] border border-lab-border bg-lab-paper p-3.5">
              <div className="mb-2 text-[10px] font-extrabold tracking-[0.08em] text-lab-muted uppercase">
                Structured result
              </div>
              <p className="m-0 text-[13px] leading-normal text-lab-ink-soft">
                {selectedTurn.structured_result.summary}
              </p>
            </div>

            <div className="font-mono text-[11px] leading-relaxed break-all text-lab-muted">
              <code className="block">{selectedTurn.trace_id ?? "Tracing disabled"}</code>
              <code className="block">{fingerprint}</code>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
