import type { ConversationResponse } from "@agent-lab/contracts";
import {
  AssistantRuntimeProvider,
  type ChatModelAdapter,
  ComposerPrimitive,
  MessagePrimitive,
  type ThreadMessageLike,
  ThreadPrimitive,
  useLocalRuntime,
} from "@assistant-ui/react";
import { Bot, Send, UserRound, Wrench } from "lucide-react";
import { useMemo } from "react";
import { sendConversationMessage } from "./api/conversations";

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

export function SupportConversation({
  conversation,
  onConversationUpdated,
}: {
  conversation: ConversationResponse;
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

  return (
    <section className="mt-8" aria-labelledby="support-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 font-mono text-xs font-bold text-lab-accent uppercase">
            {conversation.framework_id} · persisted session
          </p>
          <h2 className="font-display text-3xl font-medium" id="support-title">
            Read-only support conversation
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
                <div className="m-auto max-w-md py-12 text-center text-lab-muted">
                  Ask about the generated customer, catalog, or order history. This agent cannot
                  modify state.
                </div>
              </ThreadPrimitive.Empty>
              <ThreadPrimitive.Messages components={{ Message: ConversationMessage }} />
              <ThreadPrimitive.ViewportFooter className="mt-auto pt-5">
                <ComposerPrimitive.Root className="flex items-end gap-2 rounded-xl border border-lab-border bg-lab-paper p-2 focus-within:ring-3 focus-within:ring-lab-accent/15">
                  <ComposerPrimitive.Input
                    className="min-h-11 flex-1 resize-none bg-transparent px-2 py-2 outline-none"
                    aria-label="Support message"
                    placeholder="Ask about this customer’s account…"
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
      </div>
    </section>
  );
}
