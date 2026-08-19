import type { ConversationResponse, GeneratedScenarioResponse } from "@agent-lab/contracts";
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ConversationApiError, getConversation } from "../api/conversations";
import { getGeneratedScenario } from "../api/scenarios";
import {
  conversationPath,
  decodePersonaRef,
  findScenarioOption,
  personaPath,
} from "../lib/scenarios";
import {
  clearLastConversationIfMatches,
  LAST_CONVERSATION_KEY,
  notifyLabStorageChanged,
  panelClasses,
} from "../lib/ui";
import { SupportConversation } from "../SupportConversation";

export function ConversationPage() {
  const { ref, conversationId } = useParams();
  const personaRef = decodePersonaRef(ref);

  const [conversation, setConversation] = useState<ConversationResponse>();
  const [persona, setPersona] = useState<GeneratedScenarioResponse>();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const scenarioId = personaRef?.scenarioId;
  const scenarioVersion = personaRef?.scenarioVersion;
  const seed = personaRef?.seed;

  useEffect(() => {
    if (
      scenarioId === undefined ||
      scenarioVersion === undefined ||
      seed === undefined ||
      !conversationId
    ) {
      return;
    }
    let active = true;
    const routePath = conversationPath({ scenarioId, scenarioVersion, seed }, conversationId);
    setState("loading");
    Promise.all([
      getConversation(conversationId),
      getGeneratedScenario({ id: scenarioId, version: scenarioVersion }, seed),
    ])
      .then(([resumedConversation, resumedPersona]) => {
        if (!active) {
          return;
        }
        if (
          resumedConversation.scenario_id !== scenarioId ||
          resumedConversation.scenario_version !== scenarioVersion ||
          resumedConversation.seed !== seed
        ) {
          clearLastConversationIfMatches(routePath);
          setState("error");
          return;
        }
        setConversation(resumedConversation);
        setPersona(resumedPersona);
        setState("ready");
        window.localStorage.setItem(LAST_CONVERSATION_KEY, routePath);
        notifyLabStorageChanged();
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        if (error instanceof ConversationApiError && error.status === 404) {
          clearLastConversationIfMatches(routePath);
        }
        setState("error");
      });
    return () => {
      active = false;
    };
  }, [scenarioId, scenarioVersion, seed, conversationId]);

  const handleConversationUpdated = useCallback((updated: ConversationResponse) => {
    setConversation(updated);
  }, []);

  if (!personaRef) {
    return <Navigate to="/" replace />;
  }

  const scenarioOption = findScenarioOption(personaRef.scenarioId, personaRef.scenarioVersion);
  const latestTurn = conversation?.turns.at(-1);
  const traceId = latestTurn?.trace_id;

  return (
    <div className="grid gap-6">
      <Link
        className="inline-flex w-fit text-sm font-bold text-lab-ink-soft no-underline hover:text-lab-ink"
        to={personaPath(personaRef)}
      >
        Back to persona
      </Link>

      {state === "loading" && (
        <div className={`${panelClasses} flex items-center gap-3 p-6`} role="status">
          <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" size={22} />
          <span className="text-sm">Loading conversation…</span>
        </div>
      )}

      {state === "error" && (
        <div className={`${panelClasses} grid gap-3 p-6`} role="alert">
          <strong className="text-sm">This conversation could not be loaded.</strong>
          <Link
            className="text-sm font-bold text-lab-accent hover:underline"
            to={personaPath(personaRef)}
          >
            Back to persona
          </Link>
        </div>
      )}

      {state === "ready" && conversation && (
        <section className={`${panelClasses} overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-4 border-b border-lab-ink/15 px-[22px] py-[13px] font-mono text-[11px] text-lab-muted">
            <span className="font-extrabold text-lab-accent">04</span>
            <span>framework {conversation.framework_id}</span>
            <span>seed {conversation.seed}</span>
            {persona && <span>policy set {persona.metadata.policy_set_version}</span>}
            {persona && <span>schema {persona.initial_state.canonical_schema_version}</span>}
            <span className="ml-auto break-all">{conversation.id}</span>
            {traceId && <span title={traceId}>trace {traceId.slice(0, 12)}</span>}
          </div>
          <SupportConversation
            key={`${conversation.id}:${conversation.turns.length === 0 ? "empty" : "active"}`}
            conversation={conversation}
            suggestedCustomerMessage={scenarioOption?.suggestedCustomerMessage}
            scenarioGoal={scenarioOption?.goal}
            fingerprint={conversation.initial_state_hash}
            order={
              personaRef.scenarioId === "retail-order-cancellation"
                ? persona?.initial_state.orders[0]
                : undefined
            }
            onConversationUpdated={handleConversationUpdated}
          />
        </section>
      )}
    </div>
  );
}
