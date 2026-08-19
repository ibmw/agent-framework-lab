import type { AgentFrameworkListResponse, ConversationSummaryResponse } from "@agent-lab/contracts";
import { LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
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
import { FrameworkPicker } from "../components/FrameworkPicker";
import { Pagination } from "../components/Pagination";
import { PersonaSummary } from "../components/PersonaSummary";
import { ACTIVITY_WINDOWS, activeSinceFromWindow, PAGE_SIZES } from "../lib/filters";
import { comparePath, conversationPath, decodePersonaRef, type PersonaRef } from "../lib/scenarios";
import {
  clearLastConversationIfMatches,
  filterControlClasses,
  formatActivity,
  panelClasses,
  writeLastComparison,
} from "../lib/ui";

type Framework = AgentFrameworkListResponse["frameworks"][number];

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
    <section className={`${panelClasses} p-6`} aria-labelledby="conversations-title">
      <div className="mb-5 border-b border-lab-ink/15 pb-5">
        <h2 className="font-display text-2xl font-medium" id="conversations-title">
          Conversations
        </h2>
        <p className="m-0 text-sm text-lab-muted">
          Resume an existing run or delete one you no longer need.
        </p>
      </div>
      <div className="grid content-start gap-3">
        <div className="grid gap-3 min-[420px]:grid-cols-3">
          <label className="grid gap-1 text-[0.68rem] font-extrabold tracking-wide text-lab-muted uppercase">
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
          <label className="grid gap-1 text-[0.68rem] font-extrabold tracking-wide text-lab-muted uppercase">
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
          <label className="grid gap-1 text-[0.68rem] font-extrabold tracking-wide text-lab-muted uppercase">
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
    </section>
  );
}

export function PersonaPage() {
  const { ref } = useParams();
  const personaRef = decodePersonaRef(ref);
  const navigate = useNavigate();

  const [personaState, setPersonaState] = useState<"loading" | "ready" | "error">("loading");
  const [persona, setPersona] = useState<Awaited<ReturnType<typeof getGeneratedScenario>>>();
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [frameworksLoading, setFrameworksLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();
  const startCommandIds = useRef<Record<string, string>>({});

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
    setFrameworksLoading(true);
    listAgentFrameworks()
      .then((response) => {
        if (active) {
          setFrameworks(response.frameworks);
          setSelected(
            response.frameworks
              .filter((framework) => framework.available)
              .slice(0, 2)
              .map((framework) => framework.framework_id),
          );
          setFrameworksLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setFrameworksLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [scenarioId, scenarioVersion, seed]);

  if (!personaRef) {
    return <Navigate to="/" replace />;
  }

  function toggleFramework(frameworkId: string) {
    setSelected((current) => {
      if (current.includes(frameworkId)) {
        return current.filter((id) => id !== frameworkId);
      }
      if (current.length >= 2) {
        return [current[1], frameworkId];
      }
      return [...current, frameworkId];
    });
  }

  async function handleRunSelected() {
    if (scenarioId === undefined || scenarioVersion === undefined || seed === undefined) {
      return;
    }
    const chosen = selected.filter((id) =>
      frameworks.some((framework) => framework.framework_id === id && framework.available),
    );
    if (chosen.length === 0) {
      return;
    }
    setStartError(undefined);
    setStarting(true);
    try {
      const started = await Promise.all(
        chosen.map(async (frameworkId) => {
          if (!startCommandIds.current[frameworkId]) {
            startCommandIds.current[frameworkId] = crypto.randomUUID();
          }
          return startConversation(
            {
              scenario_id: scenarioId,
              scenario_version: scenarioVersion,
              seed,
              framework_id: frameworkId,
            },
            startCommandIds.current[frameworkId],
          );
        }),
      );
      startCommandIds.current = {};
      if (started.length === 1) {
        navigate(conversationPath(personaRef as PersonaRef, started[0].id));
        return;
      }
      writeLastComparison({
        personaPath: `/personas/${ref}`,
        a: started[0].id,
        b: started[1].id,
      });
      navigate(comparePath(personaRef as PersonaRef, started[0].id, started[1].id));
    } catch (error) {
      setStartError(
        error instanceof ConversationApiError || error instanceof ScenarioApiError
          ? error.message
          : "Could not start the conversation. Check the connection and try again.",
      );
      setStarting(false);
    }
  }

  const runLabel = selected.length >= 2 ? "Run both on this fingerprint" : "Start conversation";

  return (
    <div className="grid gap-6">
      <Link
        className="inline-flex w-fit text-sm font-bold text-lab-ink-soft no-underline hover:text-lab-ink"
        to="/#library"
      >
        Back to library
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
          <PersonaSummary
            result={persona}
            onChooseFramework={() => {
              document.getElementById("frameworks")?.scrollIntoView({ behavior: "smooth" });
            }}
          />
          <div className="scroll-mt-6" id="frameworks">
            <FrameworkPicker
              frameworks={frameworks}
              selected={selected}
              onToggle={toggleFramework}
              onRunSelected={handleRunSelected}
              running={starting}
              error={startError}
              loading={frameworksLoading}
              runLabel={runLabel}
              helper={
                selected.length >= 2
                  ? "one conversation per framework"
                  : "one conversation on this fingerprint"
              }
            />
          </div>
          <ConversationHistory
            personaRef={personaRef}
            frameworkOptions={frameworks.map((framework) => framework.framework_id)}
          />
        </>
      )}
    </div>
  );
}
