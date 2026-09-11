import type { AgentArchitecture } from "@agent-lab/contracts";

/**
 * How the lab's agent vocabulary is spelled for a reader.
 *
 * One table rather than one per surface: the architecture picker and the settings page's
 * read-out name the same closed set, and two hand-written spellings of it would drift the
 * first time a second architecture is implemented.
 */
export const ARCHITECTURE_LABELS: Record<AgentArchitecture, string> = {
  single_agent: "Single agent",
};

export const ARCHITECTURES = Object.keys(ARCHITECTURE_LABELS) as AgentArchitecture[];

export function describeArchitecture(value: string): string {
  return ARCHITECTURE_LABELS[value as AgentArchitecture] ?? readableTerm(value);
}

/** A payload's own term, spelled for a reader rather than for the wire. */
export function readableTerm(value: string): string {
  return value.replaceAll("_", " ");
}
