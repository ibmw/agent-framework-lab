import type {
  AgentFrameworkListResponse,
  ConversationSummaryResponse,
  GeneratedScenarioResponse,
} from "@agent-lab/contracts";
import { ArrowLeft, LoaderCircle, MessageCircle, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  ConversationApiError,
  type ConversationHistoryQuery,
  deleteConversation,
  listAgentFrameworks,
  listConversations,
  startConversation,
} from "../api/conversations";
import { getGeneratedScenario, ScenarioApiError } from "../api/scenarios";
import { Pagination } from "../components/Pagination";
import { PersonaSummary } from "../components/PersonaSummary";
import { ACTIVITY_WINDOWS, activeSinceFromWindow, PAGE_SIZES } from "../lib/filters";
import {
  conversationPath,
  decodePersonaRef,
  findScenarioOption,
  type PersonaRef,
} from "../lib/scenarios";
import {
  clearLastConversationIfMatches,
  fieldControlClasses,
  filterControlClasses,
  filterLabelClasses,
  formatActivity,
  panelClasses,
} from "../lib/ui";

type Framework = AgentFrameworkListResponse["frameworks"][number];

function pickDefaultFramework(frameworks: Framework[]): string {
  const available = frameworks.filter((framework) => framework.available);
  const preferred = available.find((framework) => framework.framework_id === "pydantic-ai");
  return (preferred ?? available[0])?.framework_id ?? "";
}

function ConversationRow({
  conversation,
  personaRef,
  confirming,
  deleting,
  onConfirm,
  onCancel,
  onDelete,
}: {
  conversation: ConversationSummaryResponse;
  personaRef: PersonaRef;
  confirming: boolean;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-lab-border bg-lab-subtle px-4 py-3">
      <div className="grid min-w-0 gap-0.5">
        <span className="font-mono text-xs font-bold text-lab-accent uppercase">
          {conversation.framework_id}
        </span>
        <span className="font-mono text-xs text-lab-muted">
          {conversation.turn_count} {conversation.turn_count === 1 ? "turn" : "turns"} · active{" "}
          {formatActivity(conversation.last_activity_at)}
        </span>
      </div>
      {confirming ? (
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-lab-muted">Delete permanently?</span>
          <button
            className="min-h-9 rounded-lg border border-lab-border px-3 text-sm font-bold text-lab-ink-soft transition hover:bg-lab-paper disabled:opacity-60"
            type="button"
            onClick={onCancel}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            className="min-h-9 rounded-lg bg-lab-error px-3 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
            type="button"
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Confirm delete"}
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <Link
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-bold text-lab-ink-soft transition hover:bg-lab-paper hover:text-lab-ink"
            to={conversationPath(personaRef, conversation.id)}
          >
            <RotateCcw aria-hidden="true" size={15} /> Resume
          </Link>
          <button
            className="grid size-9 place-items-center rounded-lg text-lab-muted transition hover:bg-lab-error-soft hover:text-lab-error"
            type="button"
            aria-label="Delete conversation"
            onClick={onDelete}
          >
            <Trash2 aria-hidden="true" size={16} />
          </button>
        </div>
      )}
    </li>
  );
}

function ConversationHistory({
  personaRef,
  frameworkOptions,
}: {
  personaRef: PersonaRef;
  frameworkOptions: string[];
}) {
  const { scenarioId, scenarioVersion, seed } = personaRef;
  const [conversations, setConversations] = useState<ConversationSummaryResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [frameworkFilter, setFrameworkFilter] = useState("");
  const [windowFilter, setWindowFilter] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const [confirmingId, setConfirmingId] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();

  const query = useMemo<ConversationHistoryQuery>(
    () => ({
      frameworkId: frameworkFilter || undefined,
      activeSince: activeSinceFromWindow(windowFilter),
      pageSize,
      page,
    }),
    [frameworkFilter, windowFilter, pageSize, page],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken forces a manual refetch after a delete
  useEffect(() => {
    let active = true;
    setState("loading");
    listConversations({ scenario_id: scenarioId, scenario_version: scenarioVersion, seed }, query)
      .then((result) => {
        if (active) {
          setConversations(result.conversations);
          setTotal(result.total);
          setState("ready");
        }
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [scenarioId, scenarioVersion, seed, query, reloadToken]);

  function updateFilter(apply: () => void) {
    apply();
    setPage(1);
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteConversation(id);
      clearLastConversationIfMatches(conversationPath(personaRef, id));
      setConfirmingId(undefined);
      // Step back a page if the last item on a later page was removed; otherwise refetch in place.
      if (conversations.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        setReloadToken((token) => token + 1);
      }
    } catch {
      setState("error");
    } finally {
      setDeletingId(undefined);
    }
  }

  return (
    <div className="grid content-start gap-3">
      <div className="grid gap-3 min-[420px]:grid-cols-3">
        <label className={filterLabelClasses}>
          Framework
          <select
            className={filterControlClasses}
            value={frameworkFilter}
            onChange={(event) => updateFilter(() => setFrameworkFilter(event.target.value))}
          >
            <option value="">All frameworks</option>
            {frameworkOptions.map((framework) => (
              <option key={framework} value={framework}>
                {framework}
              </option>
            ))}
          </select>
        </label>
        <label className={filterLabelClasses}>
          Active within
          <select
            className={filterControlClasses}
            value={windowFilter}
            onChange={(event) => updateFilter(() => setWindowFilter(event.target.value))}
          >
            <option value="">Any time</option>
            {ACTIVITY_WINDOWS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={filterLabelClasses}>
          Per page
          <select
            className={filterControlClasses}
            value={pageSize}
            onChange={(event) => updateFilter(() => setPageSize(Number(event.target.value)))}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state === "loading" && (
        <p className="flex items-center gap-2 text-sm text-lab-muted" role="status">
          <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" size={16} />
          Loading conversations…
        </p>
      )}

      {state === "error" && (
        <p className="text-sm text-lab-error" role="alert">
          The conversation history could not be loaded.
        </p>
      )}

      {state === "ready" && conversations.length === 0 && (
        <p className="text-sm text-lab-muted">No conversations match these filters yet.</p>
      )}

      {state === "ready" && conversations.length > 0 && (
        <ul className="grid gap-2">
          {conversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              personaRef={personaRef}
              confirming={confirmingId === conversation.id}
              deleting={deletingId === conversation.id}
              onConfirm={() => handleDelete(conversation.id)}
              onCancel={() => setConfirmingId(undefined)}
              onDelete={() => setConfirmingId(conversation.id)}
            />
          ))}
        </ul>
      )}

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        noun="conversation"
        label="Conversation pages"
        onPageChange={setPage}
      />
    </div>
  );
}

export function PersonaPage() {
  const { ref } = useParams();
  const personaRef = decodePersonaRef(ref);
  const navigate = useNavigate();

  const [persona, setPersona] = useState<GeneratedScenarioResponse>();
  const [personaState, setPersonaState] = useState<"loading" | "ready" | "error">("loading");
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [selectedFramework, setSelectedFramework] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();
  const startCommandId = useRef<string | null>(null);

  const scenarioId = personaRef?.scenarioId;
  const scenarioVersion = personaRef?.scenarioVersion;
  const seed = personaRef?.seed;

  useEffect(() => {
    if (scenarioId === undefined || scenarioVersion === undefined || seed === undefined) {
      return;
    }
    let active = true;
    setPersonaState("loading");
    getGeneratedScenario({ id: scenarioId, version: scenarioVersion }, seed)
      .then((result) => {
        if (active) {
          setPersona(result);
          setPersonaState("ready");
        }
      })
      .catch(() => active && setPersonaState("error"));
    listAgentFrameworks()
      .then((response) => {
        if (active) {
          setFrameworks(response.frameworks);
          setSelectedFramework(pickDefaultFramework(response.frameworks));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [scenarioId, scenarioVersion, seed]);

  if (!personaRef) {
    return <Navigate to="/" replace />;
  }

  const scenarioOption = findScenarioOption(personaRef.scenarioId, personaRef.scenarioVersion);
  const availableFrameworks = frameworks.filter((framework) => framework.available);

  async function handleStartConversation() {
    if (
      scenarioId === undefined ||
      scenarioVersion === undefined ||
      seed === undefined ||
      !selectedFramework
    ) {
      return;
    }
    setStartError(undefined);
    setStarting(true);
    if (startCommandId.current === null) {
      startCommandId.current = crypto.randomUUID();
    }
    try {
      const started = await startConversation(
        {
          scenario_id: scenarioId,
          scenario_version: scenarioVersion,
          seed,
          framework_id: selectedFramework,
        },
        startCommandId.current,
      );
      startCommandId.current = null;
      navigate(conversationPath(personaRef as PersonaRef, started.id));
    } catch (error) {
      // Keep the command id so a retry recovers the same session instead of duplicating it.
      setStartError(
        error instanceof ConversationApiError || error instanceof ScenarioApiError
          ? error.message
          : "Could not start the conversation. Check the connection and try again.",
      );
      setStarting(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Link
        className="inline-flex w-fit items-center gap-2 text-sm font-bold text-lab-ink-soft hover:text-lab-ink"
        to="/"
      >
        <ArrowLeft aria-hidden="true" size={16} /> Back to library
      </Link>

      {personaState === "loading" && (
        <div className={`${panelClasses} flex items-center gap-3 p-6`} role="status">
          <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" size={22} />
          <span className="text-sm">Loading persona…</span>
        </div>
      )}

      {personaState === "error" && (
        <div className={`${panelClasses} grid gap-3 p-6`} role="alert">
          <strong className="text-sm">This persona could not be found.</strong>
          <p className="m-0 text-sm text-lab-muted">
            Generate it again with scenario {personaRef.scenarioId}@{personaRef.scenarioVersion} and
            seed {personaRef.seed}, or return to the library.
          </p>
          <Link className="text-sm font-bold text-lab-accent hover:underline" to="/">
            Back to library
          </Link>
        </div>
      )}

      {personaState === "ready" && persona && (
        <>
          <PersonaSummary result={persona} source="retrieved" />

          <section className={`${panelClasses} p-6`} aria-labelledby="conversations-title">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-lab-ink/15 pb-5">
              <div>
                <h2 className="font-display text-2xl font-medium" id="conversations-title">
                  Conversations
                </h2>
                <p className="m-0 text-sm text-lab-muted">
                  Resume an existing conversation or start a new one against a framework.
                </p>
              </div>
            </div>

            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]">
              <ConversationHistory
                personaRef={personaRef}
                frameworkOptions={frameworks.map((framework) => framework.framework_id)}
              />

              <aside className="grid content-start gap-3 rounded-lg border border-lab-border bg-lab-subtle p-4">
                <h3 className="flex items-center gap-2 text-sm font-bold">
                  <Plus aria-hidden="true" size={16} /> Start a new conversation
                </h3>
                {scenarioOption && (
                  <p className="m-0 text-xs leading-snug text-lab-muted">{scenarioOption.goal}</p>
                )}
                <label className={filterLabelClasses} htmlFor="framework">
                  Agent framework
                </label>
                <select
                  className={fieldControlClasses}
                  id="framework"
                  value={selectedFramework}
                  onChange={(event) => setSelectedFramework(event.target.value)}
                  disabled={starting || availableFrameworks.length === 0}
                >
                  {availableFrameworks.length === 0 && (
                    <option value="">No framework available</option>
                  )}
                  {availableFrameworks.map((framework) => (
                    <option key={framework.framework_id} value={framework.framework_id}>
                      {framework.framework_id}
                    </option>
                  ))}
                </select>

                {startError && (
                  <p className="m-0 text-xs text-lab-error" role="alert">
                    {startError}
                  </p>
                )}

                <button
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-lab-ink px-4 font-bold text-lab-paper transition hover:bg-lab-ink-hover disabled:cursor-not-allowed disabled:opacity-65"
                  type="button"
                  onClick={handleStartConversation}
                  disabled={starting || !selectedFramework}
                >
                  {starting ? (
                    <LoaderCircle
                      className="motion-safe:animate-spin"
                      aria-hidden="true"
                      size={16}
                    />
                  ) : (
                    <MessageCircle aria-hidden="true" size={16} />
                  )}
                  {starting ? "Starting…" : "Start new conversation"}
                </button>
              </aside>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
