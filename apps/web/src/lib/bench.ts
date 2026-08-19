import { decodePersonaRef, parseConversationPath, personaPath } from "./scenarios";
import { LAST_CONVERSATION_KEY, readLastComparison } from "./ui";

export const AGENT_CAPABILITIES = [
  "tool_calls",
  "conversation_memory",
  "durable_memory",
  "session_resume",
  "structured_output",
  "tracing",
] as const;

export type AgentCapabilityName = (typeof AGENT_CAPABILITIES)[number];

export const FRAMEWORK_DESCRIPTORS: Record<string, string> = {
  fake: "deterministic offline adapter",
};

export const BENCH_STEPS = [
  {
    id: 1,
    number: "01",
    label: "Generate persona",
    shortLabel: "Generate persona",
    sublabel: "scenario + seed",
  },
  {
    id: 2,
    number: "02",
    label: "Persona library",
    shortLabel: "Persona library",
    sublabel: "revisit or resume",
  },
  {
    id: 3,
    number: "03",
    label: "Framework",
    shortLabel: "Framework",
    sublabel: "proven capabilities",
  },
  {
    id: 4,
    number: "04",
    label: "Conversation & evidence",
    shortLabel: "Conversation",
    sublabel: "tools + safe action",
  },
  {
    id: 5,
    number: "05",
    label: "Compare frameworks",
    shortLabel: "Compare",
    sublabel: "same fingerprint",
  },
] as const;

export type BenchStepId = (typeof BENCH_STEPS)[number]["id"];

export interface BenchLocation {
  pathname: string;
  hash: string;
  search: string;
  personaRef?: string;
  conversationId?: string;
}

export interface BenchStepTarget {
  to: string;
  enabled: boolean;
}

export function activeBenchStep(location: BenchLocation): BenchStepId {
  if (location.pathname.includes("/compare")) {
    return 5;
  }
  if (location.conversationId) {
    return 4;
  }
  if (location.pathname === "/frameworks") {
    return 3;
  }
  if (location.personaRef) {
    return location.hash === "#frameworks" ? 3 : 2;
  }
  if (location.hash === "#library") {
    return 2;
  }
  return 1;
}

export function lastConversationHref(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(LAST_CONVERSATION_KEY);
}

export function benchStepTarget(step: BenchStepId, location: BenchLocation): BenchStepTarget {
  const lastConversation = lastConversationHref();
  const lastParsed = parseConversationPath(lastConversation);
  const lastComparison = readLastComparison();
  const currentPersonaPath = location.personaRef
    ? personaPathFromRefParam(location.personaRef)
    : undefined;
  const personaFromConversation = lastParsed?.personaPath;
  const personaHref = currentPersonaPath ?? personaFromConversation;

  switch (step) {
    case 1:
      return { to: "/#generate", enabled: true };
    case 2:
      return { to: "/#library", enabled: true };
    case 3:
      return {
        to: personaHref ? `${personaHref}#frameworks` : "/frameworks",
        enabled: Boolean(personaHref) || location.pathname === "/frameworks",
      };
    case 4: {
      if (location.conversationId && currentPersonaPath) {
        return {
          to: `${currentPersonaPath}/conversations/${location.conversationId}`,
          enabled: true,
        };
      }
      if (
        lastConversation &&
        (!currentPersonaPath || lastParsed?.personaPath === currentPersonaPath)
      ) {
        return { to: lastConversation, enabled: true };
      }
      return { to: personaHref ?? "/", enabled: false };
    }
    case 5: {
      const params = new URLSearchParams(location.search);
      if (params.get("a") && params.get("b") && currentPersonaPath) {
        return {
          to: `${currentPersonaPath}/compare?${params.toString()}`,
          enabled: true,
        };
      }
      if (
        lastComparison &&
        (!currentPersonaPath || lastComparison.personaPath === currentPersonaPath)
      ) {
        return {
          to: `${lastComparison.personaPath}/compare?a=${lastComparison.a}&b=${lastComparison.b}`,
          enabled: true,
        };
      }
      return { to: personaHref ?? "/", enabled: false };
    }
  }
}

function personaPathFromRefParam(ref: string): string | undefined {
  const decoded = decodePersonaRef(ref);
  return decoded ? personaPath(decoded) : undefined;
}
