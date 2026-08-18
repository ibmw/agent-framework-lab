import type {
  ActionProposalResponse,
  ConversationResponse,
  GeneratedScenarioResponse,
} from "@agent-lab/contracts";
import {
  AssistantRuntimeProvider,
  type ChatModelAdapter,
  ComposerPrimitive,
  MessagePrimitive,
  type ThreadMessageLike,
  ThreadPrimitive,
  useLocalRuntime,
} from "@assistant-ui/react";
import {
  Bot,
  CheckCircle2,
  RotateCcw,
  Send,
  ShieldCheck,
  Target,
  UserRound,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ConversationApiError,
  decideOrderAction,
  executeOrderAction,
  getOrderAction,
  proposeOrderAction,
  sendConversationMessage,
} from "./api/conversations";

type ScenarioOrder = GeneratedScenarioResponse["initial_state"]["orders"][number];

function actionProposalStorageKey(conversationId: string): string {
  return `agent-lab:action-proposal:${conversationId}`;
}

function initialMessages(conversation: ConversationResponse): ThreadMessageLike[] {
  return conversation.turns.flatMap((turn) => [
    {
      id: `${turn.id}:user`,
      role: "user" as const,
      content: turn.request_message,
      createdAt: new Date(turn.created_at),
    },
    {
      id: turn.id,
      role: "assistant" as const,
      content: turn.response_message,
      createdAt: new Date(turn.created_at),
      metadata: { custom: { traceId: turn.trace_id } },
    },
  ]);
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

function ConversationMessage() {
  return (
    <MessagePrimitive.Root className="mb-4 flex w-full">
      <MessagePrimitive.If user>
        <div className="ml-auto flex max-w-[82%] gap-2 rounded-2xl rounded-br-sm bg-lab-ink px-4 py-3 text-lab-paper">
          <UserRound className="mt-0.5 shrink-0" aria-hidden="true" size={16} />
          <MessagePrimitive.Parts />
        </div>
      </MessagePrimitive.If>
      <MessagePrimitive.If assistant>
        <div className="mr-auto flex max-w-[88%] gap-2 rounded-2xl rounded-bl-sm border border-lab-border bg-lab-paper px-4 py-3 text-lab-ink">
          <Bot className="mt-0.5 shrink-0 text-lab-accent" aria-hidden="true" size={17} />
          <MessagePrimitive.Parts />
        </div>
      </MessagePrimitive.If>
    </MessagePrimitive.Root>
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
      className="rounded-panel border border-lab-ink/20 bg-lab-paper/90 p-5 shadow-panel"
      aria-labelledby="order-action-title"
    >
      <h3 className="mb-2 flex items-center gap-2 font-bold" id="order-action-title">
        <ShieldCheck aria-hidden="true" size={17} /> Safe order action
      </h3>
      <p className="mb-4 text-sm text-lab-muted">
        Cancel order <code className="break-all text-xs">{order.id}</code> at version{" "}
        {order.version}.
      </p>

      {busy && (
        <p className="mb-3 rounded-lg bg-lab-subtle px-3 py-2 text-sm" role="status">
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
          className="mb-3 rounded-lg border border-lab-error/30 bg-lab-error-soft p-3 text-sm text-lab-error"
          role="alert"
        >
          <strong className="block">{errorTitle}</strong>
          <span>{error.message}</span>
        </div>
      )}

      {!proposal && (
        <button
          className="min-h-11 w-full rounded-lg bg-lab-ink px-4 font-bold text-lab-paper disabled:opacity-60"
          type="button"
          onClick={propose}
          disabled={busy !== undefined}
        >
          Propose order cancellation
        </button>
      )}

      {proposal?.status === "proposed" && (
        <div className="grid gap-3">
          <div className="rounded-lg border border-lab-accent/30 bg-lab-accent-soft p-3 text-sm">
            <strong className="block">Proposal ready</strong>
            <span>{proposal.summary}</span>
            <code className="mt-2 block break-all text-[0.68rem]">
              {proposal.tool_name}@{proposal.tool_version} · expected version{" "}
              {proposal.expected_version}
            </code>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="min-h-11 rounded-lg border border-lab-border px-3 font-bold disabled:opacity-60"
              type="button"
              onClick={() => decide("cancel")}
              disabled={busy !== undefined}
            >
              Cancel proposal
            </button>
            <button
              className="min-h-11 rounded-lg bg-lab-ink px-3 font-bold text-lab-paper disabled:opacity-60"
              type="button"
              onClick={() => decide("confirm")}
              disabled={busy !== undefined}
            >
              Confirm exact action
            </button>
          </div>
        </div>
      )}

      {proposal?.status === "confirmed" && (
        <div className="grid gap-3">
          <p className="flex items-center gap-2 text-sm font-bold text-lab-success">
            <CheckCircle2 aria-hidden="true" size={16} /> Confirmed
          </p>
          {error?.code !== "action_transient_error" && (
            <button
              className="min-h-11 w-full rounded-lg bg-lab-accent px-4 font-bold text-white disabled:opacity-60"
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
        <p className="text-sm font-bold text-lab-muted">
          Cancelled by user — no order change was made.
        </p>
      )}

      {proposal?.status === "executed" && (
        <div className="rounded-lg bg-lab-subtle p-3 text-sm text-lab-success">
          <strong className="flex items-center gap-2">
            <CheckCircle2 aria-hidden="true" size={16} /> Executed
          </strong>
          <span className="mt-1 block">
            Order is {proposal.result_order_status} at version {proposal.result_order_version}.
            Attempts: {proposal.attempts}.
          </span>
          {proposal.trace_id && (
            <code className="mt-2 block break-all text-[0.68rem]">Trace {proposal.trace_id}</code>
          )}
        </div>
      )}

      {error?.code === "action_transient_error" && proposal?.status === "confirmed" && (
        <button
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-lab-border px-4 font-bold disabled:opacity-60"
          type="button"
          onClick={execute}
          disabled={busy !== undefined}
        >
          <RotateCcw aria-hidden="true" size={16} /> Retry execution safely
        </button>
      )}
    </aside>
  );
}

export function SupportConversation({
  conversation,
  suggestedCustomerMessage,
  scenarioGoal,
  order,
  onConversationUpdated,
}: {
  conversation: ConversationResponse;
  suggestedCustomerMessage?: string;
  scenarioGoal?: string;
  order?: ScenarioOrder;
  onConversationUpdated: (conversation: ConversationResponse) => void;
}) {
  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async run({ messages }) {
        const updated = await sendConversationMessage(conversation.id, lastUserText(messages));
        onConversationUpdated(updated);
        const turn = updated.turns.at(-1);
        if (!turn) {
          throw new Error("The support service returned no assistant turn.");
        }
        return {
          content: [{ type: "text", text: turn.response_message }],
          metadata: { custom: { traceId: turn.trace_id } },
        };
      },
    }),
    [conversation.id, onConversationUpdated],
  );
  const runtime = useLocalRuntime(adapter, {
    initialMessages: initialMessages(conversation),
  });
  const latestTurn = conversation.turns.at(-1);
  const suggestedCustomerMessageId = `suggested-customer-message-${conversation.id}`;

  return (
    <section className="mt-8" aria-labelledby="support-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 font-mono text-xs font-bold text-lab-accent uppercase">
            {conversation.framework_id} · persisted session
          </p>
          <h2 className="font-display text-3xl font-medium" id="support-title">
            Support conversation
          </h2>
        </div>
        <code className="max-w-full overflow-hidden text-ellipsis rounded bg-lab-fingerprint px-2 py-1 text-xs">
          {conversation.id}
        </code>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <AssistantRuntimeProvider runtime={runtime}>
          <ThreadPrimitive.Root className="rounded-panel border border-lab-ink/20 bg-lab-paper/90 shadow-panel">
            <ThreadPrimitive.Viewport className="flex min-h-[420px] max-h-[620px] flex-col overflow-y-auto p-5">
              <ThreadPrimitive.Empty>
                <div className="m-auto grid max-w-md gap-4 py-8 text-center">
                  <div>
                    <p className="font-bold text-lab-ink">
                      Start the conversation as the customer.
                    </p>
                    <p className="mt-1 text-sm text-lab-muted">
                      Use the scenario suggestion or write a different opening message.
                    </p>
                  </div>
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
                      <span className="text-xs font-bold text-lab-muted">Use and edit</span>
                    </ThreadPrimitive.Suggestion>
                  )}
                </div>
              </ThreadPrimitive.Empty>
              <ThreadPrimitive.Messages components={{ Message: ConversationMessage }} />
              <ThreadPrimitive.ViewportFooter className="mt-auto pt-5">
                <ComposerPrimitive.Root className="flex items-end gap-2 rounded-xl border border-lab-border bg-lab-paper p-2 focus-within:ring-3 focus-within:ring-lab-accent/15">
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
              </ThreadPrimitive.ViewportFooter>
            </ThreadPrimitive.Viewport>
          </ThreadPrimitive.Root>
        </AssistantRuntimeProvider>

        <div className="grid content-start gap-4">
          {scenarioGoal && (
            <aside
              className="rounded-panel border border-lab-accent/30 bg-lab-accent-soft/60 p-5 shadow-panel"
              aria-labelledby="scenario-goal-title"
            >
              <h3
                className="mb-2 flex items-center gap-2 font-bold text-lab-ink"
                id="scenario-goal-title"
              >
                <Target className="text-lab-accent" aria-hidden="true" size={17} /> Your goal as the
                customer
              </h3>
              <p className="text-sm leading-relaxed text-lab-ink-soft">{scenarioGoal}</p>
            </aside>
          )}
          <aside className="rounded-panel border border-lab-ink/20 bg-lab-paper/90 p-5 shadow-panel">
            <h3 className="mb-4 flex items-center gap-2 font-bold">
              <Wrench aria-hidden="true" size={17} /> Evidence
            </h3>
            {!latestTurn ? (
              <p className="text-sm text-lab-muted">
                Tool activity and structured output appear here.
              </p>
            ) : (
              <div className="grid gap-5 text-sm">
                <div>
                  <p className="mb-2 text-xs font-bold tracking-wide text-lab-muted uppercase">
                    Structured result
                  </p>
                  <p>{latestTurn.structured_result.summary}</p>
                </div>
                <div>
                  <p className="mb-2 text-xs font-bold tracking-wide text-lab-muted uppercase">
                    Tools
                  </p>
                  <ul className="grid gap-2">
                    {latestTurn.tool_activity.map((activity) => (
                      <li
                        className="rounded-lg bg-lab-subtle px-3 py-2 font-mono text-xs"
                        key={`${latestTurn.id}:${activity.tool_name}`}
                      >
                        {activity.tool_name}@{activity.tool_version} · {activity.outcome}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-2 text-xs font-bold tracking-wide text-lab-muted uppercase">
                    Trace
                  </p>
                  <code className="break-all text-xs">
                    {latestTurn.trace_id ?? "Tracing disabled"}
                  </code>
                </div>
              </div>
            )}
          </aside>
          {order && <OrderActionPanel conversationId={conversation.id} order={order} />}
        </div>
      </div>
    </section>
  );
}
